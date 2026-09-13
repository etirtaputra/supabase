/**
 * Auto-post gate tests — what may true itself up, and what waits for a human:
 *   • an ordinary settled import posts itself, no questions;
 *   • a PO still awaiting bills is held, because the number will move;
 *   • an unexplained receipt is held — the allocation's divisor is wrong;
 *   • a negative correction is held — it takes value OUT of stock;
 *   • the 32.6% outlier that prompted the rule is held; the 7.1% beside it is not;
 *   • a PO whose stock has all sold writes nothing, so it is held as a no-op;
 *   • the order of reasons: the most diagnostic one wins;
 *   • the gate never disagrees with what posting would actually insert.
 * Hand-built variances; no fetch, no database.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  autoPostVerdict, partitionForAutoPost, HOLD_NOTE, HOLD_LABEL, OUTLIER_PCT,
  type HoldReason,
} from './landedAutoPost.ts';
import { revaluationRows, type PoVariance, type ItemVariance } from './landedCost.ts';

const item = (over: Partial<ItemVariance> = {}): ItemVariance => ({
  componentId: 'C1', location: 'MAIN',
  received: 100, bookedUnit: 1_000_000, actualUnit: 1_040_000, deltaUnit: 40_000,
  deltaValue: 4_000_000, onHand: 100, revaluable: 100, inventoryDelta: 4_000_000,
  cogsDelta: 0, oldAvg: 1_000_000, newAvg: 1_040_000, ...over,
});

/** A healthy settled import: 4% understated, all units still on the shelf. */
const variance = (over: Partial<PoVariance> = {}): PoVariance => ({
  poId: 'P1', poNumber: 'EB.41206', poDate: '2026-05-01', currency: 'USD',
  supplierId: 'S1', quoteId: null, status: 'ready',
  factor: 16_640, poolIdr: 4_000_000,
  bookedValue: 100_000_000, actualValue: 104_000_000,
  delta: 4_000_000, deltaPct: 0.04,
  inventoryDelta: 4_000_000, cogsDelta: 0,
  items: [item()], unmatched: 0, trued: false, ...over,
});

test('an ordinary settled import posts itself', () => {
  const v = autoPostVerdict(variance());
  assert.equal(v.post, true);
  assert.equal(v.hold, null);
});

test('bills still arriving: held, and NOT as an anomaly', () => {
  const v = autoPostVerdict(variance({ status: 'awaiting' }));
  assert.equal(v.post, false);
  assert.equal(v.hold, 'not_ready');
});

test('an unexplained receipt is held — the allocation cannot be trusted', () => {
  // Costs are spread over the PO's LINES. A received component no line explains
  // means the receipt and the line set disagree about what this PO contains, so
  // every per-unit correction on it is suspect.
  const v = autoPostVerdict(variance({ unmatched: 1 }));
  assert.equal(v.post, false);
  assert.equal(v.hold, 'unmatched');
});

test('a negative correction is held — it would take value OUT of stock', () => {
  const v = autoPostVerdict(variance({
    delta: -4_000_000, deltaPct: -0.04, inventoryDelta: -4_000_000,
    items: [item({ deltaUnit: -40_000, deltaValue: -4_000_000, inventoryDelta: -4_000_000 })],
  }));
  assert.equal(v.post, false);
  assert.equal(v.hold, 'credit');
});

test('the real numbers: 32.6% is held, 7.1% beside it is not', () => {
  // Both taken from the live board on 2026-09-12. The cluster of ordinary
  // imports sat at 3.5–7.1%; one PO sat at 32.6%. That gap is the whole rule.
  const outlier = autoPostVerdict(variance({ poNumber: 'PIO-012-ISL-05-2026', deltaPct: 0.326 }));
  assert.equal(outlier.post, false);
  assert.equal(outlier.hold, 'outlier');

  const biggest = autoPostVerdict(variance({ poNumber: 'EB.41875', deltaPct: 0.071 }));
  assert.equal(biggest.post, true, '7.1% is ordinary freight and duty, not an anomaly');
});

test('size alone is never an anomaly — only the percentage is', () => {
  // EB.41875 is the largest correction on the board (IDR 141m) at an entirely
  // ordinary 7.1%. Holding POs for being big would rebuild the backlog out of
  // the healthiest rows.
  const v = autoPostVerdict(variance({
    delta: 141_410_627, deltaPct: 0.071,
    bookedValue: 1_991_642_040, actualValue: 2_133_052_667,
    inventoryDelta: 141_410_627,
    items: [item({ received: 1000, deltaUnit: 141_410, revaluable: 1000, inventoryDelta: 141_410_627 })],
  }));
  assert.equal(v.post, true);
});

test('the threshold is exclusive below and inclusive at the line', () => {
  assert.equal(autoPostVerdict(variance({ deltaPct: OUTLIER_PCT - 0.001 })).post, true);
  assert.equal(autoPostVerdict(variance({ deltaPct: OUTLIER_PCT })).hold, 'outlier');
});

test('a caller may tighten the threshold without touching the rule', () => {
  assert.equal(autoPostVerdict(variance({ deltaPct: 0.08 })).post, true);
  assert.equal(autoPostVerdict(variance({ deltaPct: 0.08 }), { outlierPct: 0.05 }).hold, 'outlier');
});

test('everything sold: nothing to post, so it is held as a no-op', () => {
  const sold = variance({
    inventoryDelta: 0, cogsDelta: 4_000_000,
    items: [item({ onHand: 0, revaluable: 0, inventoryDelta: 0, cogsDelta: 4_000_000 })],
  });
  assert.equal(revaluationRows(sold).length, 0, 'nothing for the ledger to absorb');
  assert.equal(autoPostVerdict(sold).hold, 'nothing_on_hand');
});

test('the gate never disagrees with what posting would insert', () => {
  // The one invariant that matters: if the gate says post, there is a row to
  // write. A verdict that cleared a PO with nothing to insert would log a
  // success that changed nothing.
  const cases = [variance(), variance({ deltaPct: 0.071 }), variance({ deltaPct: 0.149 })];
  for (const c of cases) {
    if (autoPostVerdict(c).post) assert.ok(revaluationRows(c).length > 0, `${c.poNumber} cleared with no rows`);
  }
});

test('the most diagnostic reason wins when several apply', () => {
  // An unexplained receipt on a wildly-out PO reports the receipt: it names the
  // cause, where "unusually large" only names the symptom.
  const v = autoPostVerdict(variance({ unmatched: 2, deltaPct: 0.9, status: 'ready' }));
  assert.equal(v.hold, 'unmatched');
  // But nothing outranks "the bills are still coming" — a number that has not
  // settled cannot be judged anomalous yet.
  const early = autoPostVerdict(variance({ status: 'awaiting', unmatched: 2, deltaPct: 0.9 }));
  assert.equal(early.hold, 'not_ready');
});

test('the partition splits a board and loses nothing', () => {
  const pos = [
    variance({ poId: 'a', deltaPct: 0.035 }),
    variance({ poId: 'b', deltaPct: 0.326 }),
    variance({ poId: 'c', deltaPct: 0.041 }),
    variance({ poId: 'd', status: 'awaiting' }),
    variance({ poId: 'e', unmatched: 1 }),
  ];
  const { post, held } = partitionForAutoPost(pos);
  assert.deepEqual(post.map((p) => p.poId), ['a', 'c']);
  assert.deepEqual(held.map((h) => h.hold), ['outlier', 'not_ready', 'unmatched']);
  assert.equal(post.length + held.length, pos.length, 'every PO is accounted for');
});

test('every hold reason can be explained to a human', () => {
  const reasons: HoldReason[] = ['not_ready', 'unmatched', 'credit', 'outlier', 'nothing_on_hand'];
  for (const r of reasons) {
    assert.ok(HOLD_NOTE[r]?.length > 30, `${r} needs a real explanation, not a label`);
    assert.ok(HOLD_LABEL[r]?.length > 0, `${r} needs a short form for the row`);
  }
  // The note quotes the threshold, so changing the constant cannot leave the
  // screen telling the reader a number the code no longer uses.
  assert.match(HOLD_NOTE.outlier, new RegExp(`${Math.round(OUTLIER_PCT * 100)}%`));
});
