/**
 * The /products table's columns, and the two ways this has gone wrong before.
 *
 * ONE: a column exists in the registry and nothing renders it, or renders one
 * the registry has never heard of. The Columns menu and Settings › Lists both
 * read the registry, so either drift produces a switch that controls nothing —
 * or a column nobody can turn off.
 *
 * TWO: a field is taken off the table and quietly disappears. Warranty and the
 * datasheet moved into the row expansion on 2026-09-10 (owner: *"keep the
 * Warranty and Sheet inside the dropdown when users click"*). Moved, not
 * dropped — and the difference between those two is invisible in a diff that
 * only deletes.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { PRODUCT_COLS, LEGACY_PRODUCT_COLS, type ProductColKey } from '../constants/productColumns.ts';

const page = () => readFileSync(join(process.cwd(), 'app', 'products', 'page.tsx'), 'utf8');

test('every registered column is actually rendered', () => {
  const src = page();
  for (const c of PRODUCT_COLS) {
    assert.ok(src.includes(`colShown('${c.key}')`),
      `"${c.label}" is offered in the Columns menu but the table never asks for it`);
  }
});

test('the table renders no column the registry has not heard of', () => {
  const src = page();
  const asked = [...src.matchAll(/colShown\('([a-z]+)'\)/g)].map((m) => m[1]);
  const known = new Set<string>(PRODUCT_COLS.map((c) => c.key));
  for (const key of new Set(asked)) {
    assert.ok(known.has(key),
      `the table renders "${key}", which is in no menu — nobody can turn it off`);
  }
});

test('every column has a label a person could read', () => {
  for (const c of PRODUCT_COLS) {
    assert.ok(c.label?.trim(), `${c.key} has no label`);
    assert.ok(!/^[a-z]+$/.test(c.label), `${c.key}'s label is a key, not a name`);
  }
  assert.equal(new Set(PRODUCT_COLS.map((c) => c.key)).size, PRODUCT_COLS.length, 'duplicate keys');
});

/**
 * The order in the registry is the order on screen, because Settings › Lists
 * renders this list and a person matching it against the table should not have
 * to translate. Owner's spec, 2026-09-10:
 *
 *   Description | Stock | Incoming | Tier 1 | Tier 2 | Tier 3 | Category | Updated
 *
 * Brand and Capacity are absent from that list because they were already
 * switched off, not because they were withdrawn — they stay available, and
 * they sit where they do not disturb the requested order when off.
 */
test('the columns are in the order the owner asked for', () => {
  const keys = PRODUCT_COLS.map((c) => c.key);
  const at = (k: ProductColKey) => keys.indexOf(k);
  assert.ok(at('stock') < at('incoming'), 'Stock before Incoming');
  assert.ok(at('incoming') < at('tiers'), 'Incoming before the tier prices');
  assert.ok(at('tiers') < at('category'), 'tier prices before Category');
  assert.ok(at('category') < at('updated'), 'Category last but one, Updated last');
  assert.equal(keys[keys.length - 1], 'updated');
});

/**
 * The tier columns replaced a single "Sell Price" column that showed the net
 * and a "3 tiers ▾" hint. Nothing was lost in the swap ONLY because the net
 * price IS Tier 1 — `lib/tierPricing.ts`: "the price entered on an item IS the
 * NET price = Tier-1". If that ever stops being true, the first tier column
 * stops being the old Sell Price column and this table starts under-reporting.
 */
test('the first tier column is the net price, which is what tierPricing says', () => {
  const chain = readFileSync(join(process.cwd(), 'lib', 'tierPricing.ts'), 'utf8');
  assert.match(chain, /NET price = Tier-1/,
    'tierPricing no longer states that the net is Tier 1 — check the products table');
  assert.match(chain, /FIRST active tier is the[\s\S]{0,8}net tier/);
});

/**
 * Warranty and the datasheet MOVED. Both must still be on the row — in the
 * expansion, where they are also editable — and neither may be a table column.
 */
test('warranty and the datasheet left the table but not the row', () => {
  const src = page();
  assert.ok(!src.includes("colShown('warranty')"), 'Warranty is a table column again');
  assert.ok(!src.includes("colShown('sheet')"), 'Sheet is a table column again');
  // ProductDetail is what the row expands into.
  const detail = src.slice(src.indexOf('function ProductDetail'));
  assert.ok(/warrantyLabel\(c\)/.test(detail), 'the expansion no longer shows the warranty');
  assert.ok(/datasheet_url/.test(detail), 'the expansion no longer shows the datasheet');
});

test('both are still sortable, because the question survived the column', () => {
  const src = page();
  assert.match(src, /warranty: 'Warranty'/);
  assert.match(src, /sheet: 'Has datasheet'/);
});

/**
 * A retired key must map somewhere or say it maps nowhere. Silence is the
 * failure: an owner who hid "Sell Price" for a sales-support login meant "no
 * prices", and dropping the key would have turned them back on the day this
 * shipped, for everyone, with nothing to notice.
 */
test('every retired column key is accounted for, not dropped', () => {
  const known = new Set<string>(PRODUCT_COLS.map((c) => c.key));
  for (const [old_, now] of Object.entries(LEGACY_PRODUCT_COLS)) {
    assert.ok(!known.has(old_), `"${old_}" is listed as retired but is still a live column`);
    if (now !== null) assert.ok(known.has(now), `"${old_}" maps to "${now}", which does not exist`);
  }
  assert.equal(LEGACY_PRODUCT_COLS.price, 'tiers', 'hiding Sell Price must keep hiding prices');
  assert.ok(page().includes('LEGACY_PRODUCT_COLS'), 'the page must apply the migration, not just declare it');
});

/**
 * The price columns come from `21.0_price_tiers`, which is data. Switch every
 * tier off and a table that renders "one column per tier" renders NO price —
 * a price list with no prices. The net is always knowable, so there is always
 * one column.
 */
test('a catalogue with no active tiers still shows a price', () => {
  assert.match(page(), /activeTiers\.length\s*\?[\s\S]{0,200}?'Sell price'/,
    'no fallback column when the tier ladder is empty');
});
