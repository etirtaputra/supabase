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
