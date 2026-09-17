/**
 * A sales document's header must agree with its own lines — everywhere.
 *
 * `22.0_sales_quotes.subtotal`, `.ppn_amount` and `.grand_total` are plain
 * columns and NO trigger computes them. Whoever writes the document computes
 * the totals. That was the entire reason the schema pack said *"read the sell
 * side, do not write it — not yet"*: an agent inserting rows directly leaves a
 * header that disagrees with its lines, with no error and nothing flagged, and
 * the disagreement only surfaces when somebody invoices it.
 *
 * The prohibition is now replaced by a shared function. This file is what makes
 * that trade honest: if either the editor or the mirror endpoint grows its own
 * copy of the arithmetic, the build fails here rather than in a customer's
 * invoice.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { salesTotals, lineTotal } from './salesTotals.ts';

const read = (p: string) => readFileSync(join(process.cwd(), p), 'utf8');
const EDITOR = read('app/sales/[id]/page.tsx');
const MIRROR = read('app/api/agent/sales/mirror/route.ts');

test('the three real Dolibarr orders compute exactly', () => {
  // SO2609-4852: 12 × TRINA at the price that makes the Dolibarr total.
  // These figures came from the owner, so they are the acceptance test.
  const trina = salesTotals([{ quantity: 12, unit_price: 23_509_800 / 12 }], 0);
  assert.equal(Math.round(trina.grand), 23_509_800);

  const epever = salesTotals([{ quantity: 1, unit_price: 999_000 }], 0);
  assert.equal(epever.grand, 999_000);

  const spons = salesTotals([{ quantity: 1, unit_price: 222_000 }], 0);
  assert.equal(spons.grand, 222_000);
});

test('PPN is applied to the subtotal, and 11% is the default elsewhere', () => {
  const t = salesTotals([{ quantity: 2, unit_price: 1_000_000 }], 11);
  assert.equal(t.subtotal, 2_000_000);
  assert.equal(t.ppn, 220_000);
  assert.equal(t.grand, 2_220_000);
});

test('a section header contributes nothing — it is a heading, not a line', () => {
  const t = salesTotals([
    { is_section: true, quantity: 99, unit_price: 99 },
    { quantity: 3, unit_price: 100 },
  ], 0);
  assert.equal(t.subtotal, 300);
  assert.equal(lineTotal({ is_section: true, quantity: 99, unit_price: 99 }), 0);
});

test('junk in a field is zero, never NaN', () => {
  // A NaN would propagate into grand_total and store silently — the column is
  // numeric and nothing would complain until someone read it.
  const t = salesTotals([{ quantity: 'x' as unknown as number, unit_price: null }], 11);
  assert.equal(t.subtotal, 0);
  assert.equal(t.grand, 0);
  assert.ok(!Number.isNaN(t.ppn));
});

test('totals are NOT rounded — rounding belongs at display', () => {
  // Rounding here would make the stored grand total disagree with the sum of
  // its own lines by a rupiah or two, which is the kind of difference that
  // costs an afternoon to explain.
  const t = salesTotals([{ quantity: 3, unit_price: 333_333.33 }], 11);
  assert.ok(Math.abs(t.subtotal - 999_999.99) < 1e-6);
});

test('both writers call the shared function, neither keeps its own copy', () => {
  for (const [name, src] of [['the editor', EDITOR], ['the mirror endpoint', MIRROR]] as const) {
    assert.match(src, /salesTotals/, `${name} must import the shared totals`);
    assert.ok(!/ppnPct\s*\/\s*100/.test(src),
      `${name} has its own PPN arithmetic — that is how a header starts disagreeing with its lines`);
  }
});

test('the mirror refuses to invent a customer, and refuses a duplicate import', () => {
  assert.match(MIRROR, /unmatched_customer/);
  assert.ok(!/from\('20\.0_customers'\)[\s\S]{0,200}?\.insert\(/.test(MIRROR),
    'the mirror must never create a customer row — a duplicate is cheap to make and expensive to unpick');
  assert.match(MIRROR, /already_mirrored/);
  assert.match(MIRROR, /\.eq\('external_source', externalSource\)\.eq\('external_ref', externalRef\)/,
    'external_source + external_ref is the idempotency key');
});

test('the mirror posts NO stock, and says so in its own answer', () => {
  // The owner's split: documents first, stock as a separate deliberate step.
  // A caller must be able to see that from the response alone.
  assert.ok(!MIRROR.includes('30.0_stock_movements'),
    'the document mirror must not touch the stock ledger');
  assert.match(MIRROR, /stock_moved: false/);
});

test('a mirrored order lands at an END state, never a fabricated lifecycle', () => {
  assert.match(MIRROR, /ALLOWED_STATUS = \['ordered', 'invoiced', 'delivered', 'cancelled'\]/);
  for (const invented of ["'draft'", "'validated'", "'sent'", "'accepted'"]) {
    assert.ok(!MIRROR.includes(`${invented},`) || !MIRROR.includes('ALLOWED_STATUS'),
      `${invented} must not be a mirrorable status — it did not happen here`);
  }
  // validated_at / sent_at / accepted_at are never written: the NULL is the
  // honest record.
  for (const stamp of ['validated_at', 'sent_at', 'accepted_at']) {
    assert.ok(!MIRROR.includes(stamp), `${stamp} must stay NULL on a mirrored order`);
  }
});

test('a header that loses its lines is removed again', () => {
  // PostgREST has no transaction, so a failed line insert would otherwise leave
  // a header whose total describes lines that do not exist — the exact shape
  // this endpoint was built to prevent.
  assert.match(MIRROR, /from\(SALES\)\.delete\(\)\.eq\('quote_id', made\.quote_id\)/);
});
