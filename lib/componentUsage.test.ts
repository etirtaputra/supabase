/**
 * Deals-column tests — each one is a shape that was WRONG on the live data:
 *   • a component only ever purchased, never quoted, still has a PO count;
 *   • two POs count as two, even when only one came from a quote;
 *   • a PO raised from a quote that mentions an item it did not order is NOT
 *     counted for that item (the overstating direction);
 *   • dedup is by po_id, so two POs sharing a number stay two, and a PO with no
 *     number yet still counts;
 *   • quote lines and quotes are different numbers;
 *   • an item nobody has traded reads zero, never undefined.
 * Hand-built rows; no fetch.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { buildComponentUsage, usageOf } from './componentUsage.ts';

const C1 = 'a0fa3f7e-05f7-4641-9699-90c474c516c7';  // MIRA's NIRAX NRS11042
const C2 = 'fca1aa8e-1afd-489f-b605-d03296dc80e3';  // MIRA's NIRAX NRS8027

test('an item only ever PURCHASED still shows its PO — the five blank cells', () => {
  // The exact shape MIRA reported: one PO line, zero quote lines. The old code
  // created map entries only while looping quote items, so this component had
  // no entry at all and the cell rendered "—" over a real purchase order.
  const m = buildComponentUsage(
    [],
    [{ component_id: C1, po_id: 11 }],
    [],
    [{ po_id: 11, po_number: 'PO-NIRAX-01' }],
  );
  const u = usageOf(m, C1);
  assert.equal(u.poCount, 1);
  assert.equal(u.quoteCount, 0);
  assert.deepEqual(u.poNumbers, ['PO-NIRAX-01']);
});

test('two POs count as two even when only one came from a quote', () => {
  // MIRA's second shape: 2 distinct po_ids, 1 quote. The old code walked
  // quote → purchases.quote_id and so could only ever see the quoted one.
  const m = buildComponentUsage(
    [{ component_id: C2, quote_id: 7 }],
    [{ component_id: C2, po_id: 21 }, { component_id: C2, po_id: 22 }],
    [{ quote_id: 7, pi_number: 'PI-7' }],
    [{ po_id: 21, po_number: 'PO-A' }, { po_id: 22, po_number: 'PO-B' }],
  );
  const u = usageOf(m, C2);
  assert.equal(u.poCount, 2);
  assert.equal(u.quoteCount, 1);
  assert.deepEqual(u.poNumbers, ['PO-A', 'PO-B']);
  assert.deepEqual(u.piNumbers, ['PI-7']);
});

test('a PO that did NOT order the item is not counted for it', () => {
  // The direction nobody looked for, and the dangerous one: an understated
  // count reads as a new item, an overstated one invents a track record. Here
  // quote 7 lists BOTH items; PO 21 ordered only C1.
  const m = buildComponentUsage(
    [{ component_id: C1, quote_id: 7 }, { component_id: C2, quote_id: 7 }],
    [{ component_id: C1, po_id: 21 }],
    [{ quote_id: 7, pi_number: 'PI-7' }],
    [{ po_id: 21, po_number: 'PO-A' }],
  );
  assert.equal(usageOf(m, C1).poCount, 1);
  assert.equal(usageOf(m, C2).poCount, 0, 'quoted on the PI, never ordered');
  assert.equal(usageOf(m, C2).quoteCount, 1, 'but it WAS quoted');
});

test('dedup is by po_id, not by the number a human typed', () => {
  // A PO number is a label and can be blank on a draft or duplicated by
  // mistake; po_id is identity. Counting by number merges and drops.
  const m = buildComponentUsage(
    [],
    [{ component_id: C1, po_id: 31 }, { component_id: C1, po_id: 32 }],
    [],
    [{ po_id: 31, po_number: 'DUP' }, { po_id: 32, po_number: 'DUP' }],
  );
  assert.equal(usageOf(m, C1).poCount, 2, 'two POs that share a number are still two');
  assert.deepEqual(usageOf(m, C1).poNumbers, ['DUP'], 'but they list once');
});

test('a PO with no number yet still counts', () => {
  const m = buildComponentUsage([], [{ component_id: C1, po_id: 41 }], [], [{ po_id: 41, po_number: null }]);
  assert.equal(usageOf(m, C1).poCount, 1);
  assert.deepEqual(usageOf(m, C1).poNumbers, [], 'nothing to list, but the count is honest');
});

test('the same PO ordering an item on two lines is ONE PO', () => {
  const m = buildComponentUsage(
    [],
    [{ component_id: C1, po_id: 51 }, { component_id: C1, po_id: 51 }],
    [], [{ po_id: 51, po_number: 'PO-X' }],
  );
  assert.equal(usageOf(m, C1).poCount, 1);
});

test('quote lines and quotes are different numbers', () => {
  const m = buildComponentUsage(
    [{ component_id: C1, quote_id: 7 }, { component_id: C1, quote_id: 7 }, { component_id: C1, quote_id: 8 }],
    [], [{ quote_id: 7, pi_number: 'PI-7' }, { quote_id: 8, pi_number: null }], [],
  );
  const u = usageOf(m, C1);
  assert.equal(u.quoteCount, 2, 'distinct quotes');
  assert.equal(u.lineItemCount, 3, 'lines, including the repeat');
  assert.deepEqual(u.piNumbers, ['PI-7'], 'a quote with no PI number is not listed');
});

test('rows with no component are skipped, and an untraded item reads zero', () => {
  const m = buildComponentUsage(
    [{ component_id: null, quote_id: 7 }],
    [{ component_id: null, po_id: 21 }],
    [{ quote_id: 7, pi_number: 'PI-7' }], [{ po_id: 21, po_number: 'PO-A' }],
  );
  assert.equal(m.size, 0);
  // Never undefined: the cell has to render a number, and "—" over a real PO
  // is exactly the bug this file exists to end.
  const u = usageOf(m, 'never-traded');
  assert.equal(u.poCount, 0);
  assert.equal(u.quoteCount, 0);
  assert.deepEqual(u.poNumbers, []);
});
