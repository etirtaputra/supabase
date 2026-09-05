/**
 * The taxonomy has to stay COMPLETE, or the hierarchy quietly lies.
 *
 * A main category is derived, not stored, which is what makes it free — and
 * also what makes it easy to forget. Add a value to the `product_category`
 * enum and say nothing here and the item lands in an aisle that does not
 * exist: it vanishes from the shop index while still being in the database,
 * which is the worst of both. These tests fail the build in that case, the way
 * `access.test.ts` fails it when a gated screen stops asking.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  MAIN_CATEGORIES, CATEGORY_LABEL, SUBCATEGORY_FIELD, UNGROUPED_CATEGORIES,
  mainCategoryOf, mainCategoryByKey, categoryLabelOf, categoryPath,
} from '../constants/productTaxonomy.ts';
import { ENUMS } from '../constants/enums.ts';
import { formatCategory } from './formatCategory.ts';

const ALL = ENUMS.product_category as readonly string[];

test('every category an aisle claims is a real product category', () => {
  for (const m of MAIN_CATEGORIES) {
    for (const c of m.categories) assert.ok(ALL.includes(c), `${m.key}: unknown category ${c}`);
  }
});

test('every product category is placed, or is deliberately unplaced', () => {
  const placed = new Set<string>([...MAIN_CATEGORIES.flatMap((m) => [...m.categories]), ...UNGROUPED_CATEGORIES]);
  for (const c of ALL) assert.ok(placed.has(c), `${c} is in no main category and is not declared unplaced`);
});

test('no category sits in two aisles', () => {
  const seen = new Set<string>();
  for (const m of MAIN_CATEGORIES) {
    for (const c of m.categories) {
      assert.ok(!seen.has(c), `${c} is in two main categories`);
      seen.add(c);
    }
  }
});

test('every product category has a written name — no snake_case reaches a screen', () => {
  for (const c of ALL) {
    assert.ok(CATEGORY_LABEL[c], `${c} has no label`);
    assert.ok(!CATEGORY_LABEL[c].includes('_'), `${c}'s label still has an underscore`);
  }
});

test('aisle keys and labels are unique', () => {
  assert.equal(new Set(MAIN_CATEGORIES.map((m) => m.key)).size, MAIN_CATEGORIES.length);
  assert.equal(new Set(MAIN_CATEGORIES.map((m) => m.label)).size, MAIN_CATEGORIES.length);
  assert.equal(new Set(MAIN_CATEGORIES.map((m) => m.labelId)).size, MAIN_CATEGORIES.length);
});

test('a sub-category axis is only declared for a category that exists', () => {
  for (const c of Object.keys(SUBCATEGORY_FIELD)) {
    assert.ok(ALL.includes(c), `SUBCATEGORY_FIELD names unknown category ${c}`);
  }
});

test('the path shows both levels, and never says the same word twice', () => {
  assert.equal(categoryPath('on_grid_inverter'), 'Inverters › On-Grid Inverters');
  assert.equal(categoryPath('ac_cable'), 'Cables › AC Cables');
  // One category, same name as its aisle — the repetition is dropped.
  assert.equal(categoryPath('pv_module'), 'Solar Panels');
  assert.equal(categoryPath('mounting'), 'Mounting');
  assert.equal(categoryPath(null), '');
});

test('formatCategory answers from the taxonomy, and still humanises what it does not know', () => {
  assert.equal(formatCategory('pv_module'), 'Solar Panels');
  assert.equal(formatCategory('switchgear'), 'Switchgears');
  // Not a category — the acronym-aware fallback still applies.
  assert.equal(formatCategory('ev_something'), 'EV Something');
  assert.equal(formatCategory(''), '');
});

test('lookups agree with the declarations', () => {
  assert.equal(mainCategoryOf('inverter_charger')?.key, 'inverter');
  assert.equal(mainCategoryOf('power_inverter')?.key, 'inverter');
  assert.equal(mainCategoryOf('non_stock'), null);
  assert.equal(mainCategoryByKey('cable')?.categories.length, 2);
  assert.equal(categoryLabelOf('monitoring'), 'Monitoring & Comms');
  // A category the taxonomy has never heard of still renders as something.
  assert.equal(categoryLabelOf('made_up'), 'made_up');
});

test('non_stock is unplaced on purpose — it must never reach a storefront aisle', () => {
  assert.ok(UNGROUPED_CATEGORIES.includes('non_stock'));
  assert.equal(mainCategoryOf('non_stock'), null);
});
