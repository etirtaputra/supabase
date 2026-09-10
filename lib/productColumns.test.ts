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


// ─────────────────────────────────────────────────────────────────────────────
// The sell-side disclosure rules, 2026-09-10.
//
// Three of these are one-line changes that a later edit could undo without
// anybody noticing, because in every case the WRONG version looks perfectly
// reasonable on screen: a supplier model reads like a helpful subtitle, a
// brand reads like useful metadata, a "New stock" badge reads like news.
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Owner: *"the rule is that we only display Our Internal Description."*
 *
 * `descOf` falls back to `supplier_model` when we have no description of our
 * own — right on the Item Editor, where naming a row by what we bought is the
 * point, and a disclosure here. `sellDescOf` refuses the fallback, so a
 * missing description shows as missing instead of borrowing the supplier's
 * words.
 */
test('the product list names items by OUR description, never the supplier model', () => {
  const src = page();
  assert.ok(src.includes('const sellDescOf'), 'the sell-side name helper is gone');
  // The row and the mobile card must both use it.
  assert.ok(src.includes('{sellDescOf(r.c)}'), 'the table row no longer uses it');
  assert.equal((src.match(/\{sellDescOf\(r\.c\)\}/g) ?? []).length, 2,
    'both the desktop row and the mobile card must name the item our way');
  // The dim mono sub-line that used to carry it.
  assert.ok(!/supplier_model && descOf\(r\.c\)/.test(src),
    'the supplier model is under the name again on a sell-side screen');
});

/**
 * Owner: *"we don't need to filter by brand because this is sensitive
 * information."* The FILTER was the disclosure — a dropdown that enumerated
 * every supplier brand we carry to whoever opened it. Sorting and the column
 * are a different act and stay gated by canViewBrand as they always were.
 */
test('there is no brand filter, and the mobile card stopped leaking the brand', () => {
  const src = page();
  assert.ok(!src.includes('filterBrand'), 'the brand filter is back');
  assert.ok(!src.includes("t('All brands')"), 'the brand dropdown is back');
  // The card's meta line was unconditional while the desktop column was gated,
  // so a sales login saw on a phone exactly what the table withheld on a laptop.
  assert.ok(!/\[r\.c\.brand,/.test(src), 'the mobile card prints the brand ungated again');
  assert.ok(/canViewBrand \? r\.c\.brand/.test(src), 'the card must gate the brand like the column does');
});

/**
 * Owner: *"'New' is only for New Product, not new Stock. New Stock will be
 * reflected in the Live Stock."*
 *
 * The filter keys on the item's FIRST-ever goods receipt, not its latest, and
 * the second "New stock" badge is gone. A badge that repeats the number in the
 * column beside it teaches people to read past both.
 */
test('"New" means a product we have never carried, not a restock', () => {
  const src = page();
  assert.ok(src.includes('function isNewProduct'), 'the new-product test is gone');
  assert.ok(!src.includes("'New stock'"), 'the restock badge is back');
  // The word survives in the comments that explain the rule, which is the
  // point; what must not survive is a 'restock' VALUE anything can branch on.
  assert.ok(!/'restock'/.test(src), "a 'restock' tag value is back");
});

/**
 * "New first" PINS, it does not filter (owner, 2026-09-10: *"it just puts the
 * new items at the top, but the rest of the items is still showing"*).
 *
 * As a filter it threw away a thousand items to show you twelve, so anyone
 * browsing had to tick it, look, and untick it to get their list back. The
 * distinction it turns on is real and general: LOOK AT THIS FIRST is not the
 * same request as SHOW ONLY THIS, and a chip that looks like the two beside it
 * must not do the opposite thing to the row count.
 */
test('New first floats new products up and hides nothing', () => {
  const src = page();
  // It must not appear in the filter predicate at all.
  const filterBlock = src.slice(src.indexOf('.filter(({ c, phys, inc })'), src.indexOf('const { key, dir } = sort;'));
  assert.ok(!/newFirst/.test(filterBlock), 'New first is subtracting rows again');
  // It must run BEFORE the sort key, or it is not a pin.
  assert.match(src, /list\.sort\(\(a, b\) => \{[\s\S]{0,900}?if \(newFirst\)[\s\S]{0,300}?if \(an !== bn\) return bn - an;[\s\S]{0,80}?let d = 0;/,
    'the pin does not run ahead of the chosen sort');
  // And it must say what it does.
  assert.ok(src.includes("t('↑ New first')"), 'the chip no longer says it reorders rather than filters');
});

/**
 * Owner: *"since the Tier 1, 2, 3 is already displayed upfront, there's no
 * need to have PRICE LIST - tap to copy again."*
 *
 * The expansion is now only what the row CANNOT show. The five props that went
 * with the price list are the measure of how much of the panel was a second
 * copy of the row above it.
 */
test('the expansion holds no second copy of the prices', () => {
  const detail = page().slice(page().indexOf('function ProductDetail'));
  assert.ok(!/Price list · tap to/.test(detail), 'the price list is back in the expansion');
  assert.ok(!/tierPrice/.test(detail), 'the expansion computes tier prices again');
  for (const gone of ['activeTiers', 'onPrice', 'pickedAt']) {
    assert.ok(!detail.includes(`${gone}:`), `ProductDetail still takes ${gone}`);
  }
  // What it must still hold.
  for (const kept of ['warrantyLabel', 'datasheet_url', 'Technical specifications', 'Last Customer Orders', 'Last Deliveries']) {
    assert.ok(detail.includes(kept), `the expansion no longer shows ${kept}`);
  }
});

/**
 * Owner: *"under Tier-1, Tier-2, Tier-3 prices, we don't need to write 'net'
 * '+5%', cause that might not be squarely true."*
 *
 * Exactly right, and the reason is worth keeping: a per-item override replaces
 * a tier's price outright, and every tier above it chains from the override.
 * So "+5%" is the CONFIGURED rule, not a promise about the row you are reading
 * — true of most rows and quietly false of the ones somebody deliberately
 * repriced, which is the worst kind of label.
 */
test('the tier headings name the tier and claim no arithmetic', () => {
  const src = page();
  assert.ok(!/\+\{Number\(pc\.tier!\.default_discount_pct\)/.test(src),
    'the header states a markup step it cannot promise for every row');
  assert.ok(!/onClick=\{\(\) => toggleSort\('price'\)\} hint="net"/.test(src),
    '"net" is back under the first tier heading');
});

/**
 * Owner: *"the filter options need to be two rows like in Selling Prices…
 * change the format to tick that applies."*
 */
test('the filter bar is two rows, and the three filters are counted chips', () => {
  const src = page();
  assert.ok(src.includes('function FilterChip'), 'the filter chips are gone');
  for (const n of ['pricedOnly', 'stockOnly', 'newFirst']) {
    assert.ok(new RegExp(`FilterChip on=\\{${n}\\}`).test(src), `${n} is not a chip`);
  }
  // The Show dropdown they replaced.
  assert.ok(!/BarMenu width=\{256\}/.test(src), 'the Show dropdown is back');
  // A phone needs a real tap target; the shared bar height gives the toolbar
  // one and the chips carry their own.
  assert.match(src, /const BAR_H\s*=\s*'h-11 sm:h-9'/, 'the toolbar lost its phone-sized tap target');
  assert.match(src, /py-2 sm:py-1/, 'the chips lost their phone-sized tap target');
});

/**
 * The chips carry a COUNT, which is the whole reason Selling Prices' chip row
 * works: you can see the size of a subset before committing to looking at it.
 * The first attempt drew a checkbox and stood the chip at toolbar height —
 * three more buttons in a bar that already had four, and no information.
 */
test('each filter chip says how many items it holds', () => {
  const src = page();
  assert.ok(src.includes('const tickCounts'), 'the chip counts are gone');
  for (const n of ['tickCounts.priced', 'tickCounts.inStock', 'tickCounts.isNew']) {
    assert.ok(src.includes(`count={${n}}`), `${n} is not on a chip`);
  }
  // Counted over the catalogue, not over what the other filters left — a count
  // that moves when you touch a different chip answers the wrong question.
  assert.match(src, /for \(const c of comps\) \{[\s\S]{0,400}?priced\+\+/,
    'the chip counts are no longer taken over the whole catalogue');
});
