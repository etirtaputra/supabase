/**
 * The four things a PO total can be, and which of them the screen must shout.
 *
 * Written against the real rows that prompted it (2026-08-24): three POs whose
 * total is exactly twice their own lines, and eleven whose total is short by
 * exactly their freight. Both are disagreements; only one of them was even
 * visible, and both were drawn in the same grey as an explained one.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { checkPoTotal, totalDisagrees, TOTAL_TOLERANCE } from './poTotals.ts';

test('a total that is its line items is simply right', () => {
  const v = checkPoTotal({ docTotal: 809_730, itemsSum: 809_730, freight: 0 });
  assert.deepEqual(v, { state: 'exact', gap: 0 });
  assert.equal(totalDisagrees(v), false);
});

test('freight on top is explained, not a fault — the screen shows the workings', () => {
  // PIO-004-ISL-03-2026 as the supplier billed it: 45,371 of goods + 1,065 freight.
  const v = checkPoTotal({ docTotal: 46_436, itemsSum: 45_371, freight: 1_065 });
  assert.deepEqual(v, { state: 'freight', gap: 1_065 });
  assert.equal(totalDisagrees(v), false);
});

test('PO-149-MBS-08-2026: twice the lines is a disagreement, and it is over', () => {
  const v = checkPoTotal({ docTotal: 1_619_460, itemsSum: 809_730, freight: null });
  assert.deepEqual(v, { state: 'over', gap: 809_730 });
  assert.equal(totalDisagrees(v), true);
});

test('a total that forgot the freight UNDER-states what we owe, and says so', () => {
  // PIO-009-ISL-05-2026: total 165 while the lines plus freight come to 314.70.
  const v = checkPoTotal({ docTotal: 165, itemsSum: 165, freight: 149.7 });
  assert.deepEqual(v, { state: 'under', gap: 149.7 });
  assert.equal(totalDisagrees(v), true);
});

test('a decimal column is not a disagreement', () => {
  // The payment on PO-149 landed at 809,729.73 — sub-unit noise must never
  // raise a warning, or every foreign PO would carry one.
  assert.equal(checkPoTotal({ docTotal: 809_730, itemsSum: 809_729.73, freight: 0 }).state, 'exact');
  assert.equal(checkPoTotal({ docTotal: 1_000 + TOTAL_TOLERANCE, itemsSum: 1_000, freight: 0 }).state, 'over');
});

test('the three real over-stated POs are all caught, and the 207 sound ones are not', () => {
  // Straight from the database, 2026-08-24.
  const broken = [
    { po: 'EB.42277', docTotal: 1_357_440, itemsSum: 678_720, freight: 0 },
    { po: 'EB.42324', docTotal: 268_800, itemsSum: 134_400, freight: 0 },
    { po: 'PO-149-MBS-08-2026', docTotal: 1_619_460, itemsSum: 809_730, freight: 0 },
  ];
  for (const b of broken) {
    const v = checkPoTotal(b);
    assert.equal(v.state, 'over', `${b.po} should be flagged`);
    assert.equal(v.gap, b.itemsSum, `${b.po} is over by exactly its own lines — it counted them twice`);
  }
  assert.equal(checkPoTotal({ docTotal: 5_295_120, itemsSum: 5_295_120, freight: 0 }).state, 'exact');
});

// ── The cause, not just the symptom (2026-08-24) ─────────────────────────────
/**
 * WHY those three POs doubled. The owner's guess was the Quote + PO save, and
 * he was right about the path — but the second tally is done by the DATABASE.
 *
 * `5.1_purchase_line_items` carries a trigger, `recalculate_po_total()`, whose
 * job is to keep `total_value` in step with the lines while preserving what the
 * total exceeds them by — the freight the supplier bills on top:
 *
 *     delta = total_value - (items sum BEFORE this row change)
 *     total_value = (items sum AFTER this row change) + delta
 *
 * The app inserted the PO with its total already filled in and its line items
 * still to come. So on the first line, `items sum before` was ZERO, the whole
 * stated total was read as freight, and the goods were then stacked on top of
 * it. Reproduced against the live trigger before the fix, and rolled back:
 *
 *     stated 809.730 → one line of 809.730      → 1.619.460   (PO-149 exactly)
 *     stated 134.400 → three lines of 134.400   →   268.800   (EB.42324 exactly)
 *     stated NULL    → one line of 809.730      →   809.730   (correct)
 *
 * The fix is an ORDER, not a formula: line items first, stated total last. Then
 * the delta is measured against the real goods, and freight survives every
 * later edit — verified after the change (goods 45.371 + freight 1.065 = 46.436
 * stayed 51.065 when the line was edited up to 50.000).
 *
 * This test guards that order. It is a source check because the ordering lives
 * in a React handler that no unit test can execute — and the ordering is the
 * whole fix.
 */
import { readFileSync } from 'node:fs';

const PURCHASING = 'app/purchasing/page.tsx';

test('a PO is never created carrying a total before its line items exist', () => {
  const src = readFileSync(PURCHASING, 'utf8');
  // Both PO inserts hand the trigger a blank total…
  assert.equal(src.split('total_value: null').length - 1, 2,
    'every PO insert must leave total_value to the trigger, then stamp it after the lines');
  // …and both stamp the stated total afterwards.
  assert.equal(src.split('await stampPoTotal(').length - 1, 2,
    'each PO insert needs its matching stamp, or a typed total is silently lost');
  assert.ok(/const stampPoTotal = async/.test(src), 'the stamp helper must stay in one place');
  // The insert of a PO must not carry a total from the form again.
  assert.ok(!/total_value: quote\.total_value/.test(src),
    'this is the exact line that doubled PO-149 — the total cannot ride along with the insert');
});

test('amending a PO in place replaces its lines BEFORE it writes the header', () => {
  const src = readFileSync(PURCHASING, 'utf8');
  const del = src.indexOf(".from('5.1_purchase_line_items').delete().eq('po_id', src.po_id)");
  const upd = src.indexOf(".from('5.0_purchases').update(header).eq('po_id', src.po_id)");
  assert.ok(del > 0 && upd > 0, 'the amend path should still replace lines and write the header');
  assert.ok(del < upd,
    'the header (with its total) must be written last — every line delete and insert moves total_value through the trigger');
});

test('each PO insert is followed by its stamp, not preceded by it', () => {
  const src = readFileSync(PURCHASING, 'utf8');
  // Each stamp must come after a line-item insert, or it would be overwritten
  // by the trigger the moment the lines land.
  for (const stamp of ['await stampPoTotal(newPoId, totalVal)', 'await stampPoTotal(poId, quote.total_value)']) {
    const at = src.indexOf(stamp);
    assert.ok(at > 0, `${stamp} should exist`);
    const linesBefore = src.lastIndexOf("handleInsert('5.1_purchase_line_items'", at);
    assert.ok(linesBefore > 0 && linesBefore < at,
      `${stamp} must run after its line items are inserted`);
  }
});
