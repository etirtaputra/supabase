/**
 * Item Score tests — the properties the score must hold, written against
 * hand-built item sets so a weighting or ranking regression is caught.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  computeItemScores, DEFAULT_ITEM_SCORE_WEIGHTS, type ItemScoreInput,
} from './itemScore.ts';

/** A baseline item; override only what a test cares about. */
const item = (over: Partial<ItemScoreInput> & { id: string }): ItemScoreInput => ({
  category: 'cat', revenue: 1000, marginPct: 20, salesRecent: 1000, salesBaseline: 1000,
  leadDays: 30, leadSamples: 5, recoveryRatio: 0.5, superseded: false, saleEvents: 5, costCoV: 0.1, dioDays: 45, ...over,
});

/** A field of near-identical peers so a category can rank on its own (≥8). */
const peers = (n: number, over: (i: number) => Partial<ItemScoreInput> = () => ({})): ItemScoreInput[] =>
  Array.from({ length: n }, (_, i) => item({ id: `p${i}`, ...over(i) }));

test('a bigger seller outranks a small one on the volume factor', () => {
  const items = [...peers(8), item({ id: 'big', revenue: 1_000_000 }), item({ id: 'small', revenue: 1 })];
  const s = computeItemScores(items);
  assert.ok(s.get('big')!.factors.volume > s.get('small')!.factors.volume);
});

test('a fatter margin outranks a thin one', () => {
  const items = [...peers(8), item({ id: 'fat', marginPct: 45 }), item({ id: 'thin', marginPct: 3 })];
  const s = computeItemScores(items);
  assert.ok(s.get('fat')!.factors.margin > s.get('thin')!.factors.margin);
});

test('shorter lead time scores HIGHER (the inversion holds)', () => {
  const items = [...peers(8), item({ id: 'fast', leadDays: 7 }), item({ id: 'slow', leadDays: 120 })];
  const s = computeItemScores(items);
  assert.ok(s.get('fast')!.factors.leadTime > s.get('slow')!.factors.leadTime);
});

test('a faster cash cycle (lower DIO) scores higher', () => {
  const items = [...peers(8), item({ id: 'fast', dioDays: 10 }), item({ id: 'slow', dioDays: 200 })];
  const s = computeItemScores(items);
  assert.ok(s.get('fast')!.factors.cashCycle > s.get('slow')!.factors.cashCycle);
});

test('growing sales beat shrinking sales on momentum (value vs baseline)', () => {
  const items = [...peers(8), item({ id: 'up', salesRecent: 30, salesBaseline: 10 }), item({ id: 'down', salesRecent: 2, salesBaseline: 20 })];
  const s = computeItemScores(items);
  assert.ok(s.get('up')!.factors.momentum > s.get('down')!.factors.momentum);
});

test('a whole trade (in profit) scores full position; a deep unpaid one scores low', () => {
  const s = computeItemScores([item({ id: 'whole', recoveryRatio: 1.4 }), item({ id: 'deep', recoveryRatio: 0 })]);
  assert.equal(s.get('whole')!.factors.position, 100);
  assert.ok(s.get('deep')!.factors.position <= 40);
});

test('a pure-flow item (nothing held) carries no position penalty', () => {
  const s = computeItemScores([item({ id: 'flow', recoveryRatio: null })]);
  assert.ok(s.get('flow')!.factors.position >= 80);
});

test('a superseded item scores lower on consistency and never says "restock"', () => {
  const items = [...peers(8), item({ id: 'current', superseded: false }), item({ id: 'eol', superseded: true })];
  const s = computeItemScores(items);
  assert.ok(s.get('eol')!.factors.consistency < s.get('current')!.factors.consistency);
  assert.match(s.get('eol')!.action, /Superseded|Reduce/);
  assert.doesNotMatch(s.get('eol')!.action, /reorder/i);
});

test('steady purchase cost beats volatile cost on consistency', () => {
  const items = [...peers(8), item({ id: 'steady', costCoV: 0.02 }), item({ id: 'volatile', costCoV: 0.45 })];
  const s = computeItemScores(items);
  assert.ok(s.get('steady')!.factors.consistency > s.get('volatile')!.factors.consistency);
});

test('an all-round strong item lands in a higher band than an all-round weak one', () => {
  const strong = item({ id: 'strong', revenue: 5_000_000, marginPct: 40, salesRecent: 40_000, salesBaseline: 10_000, leadDays: 7, leadSamples: 6, recoveryRatio: 1.5, saleEvents: 30, costCoV: 0.02, dioDays: 10, superseded: false });
  // Confidently weak: enough sales/POs that shrinkage can't rescue it.
  const weak = item({ id: 'weak', revenue: 10, marginPct: 1, salesRecent: 0, salesBaseline: 20_000, leadDays: 150, leadSamples: 6, recoveryRatio: 0, saleEvents: 20, costCoV: 0.6, dioDays: 400, superseded: true });
  const s = computeItemScores([...peers(8), strong, weak]);
  assert.ok(s.get('strong')!.score > s.get('weak')!.score);
  assert.ok(s.get('strong')!.score >= 60);
  assert.ok(s.get('weak')!.score < 40);
  assert.equal(s.get('weak')!.band, 'reduce');
});

test('shrinkage: a thin-history item is pulled toward neutral, a proven one is not', () => {
  // Both have a bottom-tier raw margin; only the evidence behind it differs.
  const items = [
    ...peers(8, () => ({ marginPct: 25 })),
    item({ id: 'thin', marginPct: 1, saleEvents: 0 }),
    item({ id: 'proven', marginPct: 1, saleEvents: 60 }),
  ];
  const s = computeItemScores(items);
  // The thin item's weak margin is discounted (closer to 50) — we're not sure.
  assert.ok(s.get('thin')!.factors.margin > s.get('proven')!.factors.margin);
  assert.ok(s.get('thin')!.factors.margin > 40);       // pulled toward neutral
  assert.ok(s.get('proven')!.factors.margin < 30);     // trusted low
});

test('lowData and confidence reflect the sale count', () => {
  const s = computeItemScores([item({ id: 'one', saleEvents: 1 }), item({ id: 'many', saleEvents: 40 })]);
  assert.equal(s.get('one')!.lowData, true);
  assert.equal(s.get('many')!.lowData, false);
  assert.ok(s.get('many')!.confidence > s.get('one')!.confidence);
  assert.ok(s.get('one')!.confidence >= 0 && s.get('many')!.confidence <= 1);
});

test('a smoothed baseline tempers a single lumpy quarter', () => {
  // Same recent sales; one item's baseline is a steady typical quarter, the
  // other's baseline is near zero (so recent looks like a huge fake surge).
  const steady = item({ id: 'steady', salesRecent: 1000, salesBaseline: 1000, saleEvents: 20 });
  const spike = item({ id: 'spike', salesRecent: 1000, salesBaseline: 20, saleEvents: 20 });
  const s = computeItemScores([...peers(8), steady, spike]);
  assert.ok(s.get('spike')!.factors.momentum > s.get('steady')!.factors.momentum);
});

test('an item selling below cost is never Core/Solid, whatever its rank', () => {
  const great = { revenue: 5_000_000, salesRecent: 50_000, salesBaseline: 10_000, leadDays: 7, leadSamples: 8, recoveryRatio: 1.5, saleEvents: 40, costCoV: 0.02, dioDays: 10 };
  const s = computeItemScores([...peers(8), item({ id: 'loss', marginPct: -12, ...great })]);
  const r = s.get('loss')!;
  assert.ok(r.band === 'watch' || r.band === 'reduce', `band was ${r.band}`);
  assert.match(r.action, /below cost|pricing/i);
});

test('stalled stock (no recent sales but holding) can’t be Core', () => {
  const s = computeItemScores([...peers(8), item({ id: 'stalled', marginPct: 25, salesRecent: 0, saleEvents: 15, dioDays: 300, revenue: 4_000_000 })]);
  const r = s.get('stalled')!;
  assert.notEqual(r.band, 'core');
  assert.match(r.action, /stalled|clear/i);
});

test('every score is within 0–100 and carries an action', () => {
  const s = computeItemScores(peers(12, (i) => ({ revenue: i * 100, leadDays: i * 10, marginPct: i * 3 })));
  for (const r of s.values()) {
    assert.ok(r.score >= 0 && r.score <= 100);
    assert.ok(r.action.length > 0);
  }
});

test('zero weights fall back to the defaults instead of dividing by zero', () => {
  const zero = { volume: 0, margin: 0, momentum: 0, leadTime: 0, position: 0, consistency: 0, cashCycle: 0 };
  const s = computeItemScores([...peers(8), item({ id: 'x', revenue: 9_000_000 })], zero);
  assert.ok(Number.isFinite(s.get('x')!.score));
});

test('re-weighting changes the ranking — margin-only vs volume-only disagree', () => {
  const items = [
    ...peers(8),
    item({ id: 'fatThinSeller', revenue: 100, marginPct: 60 }),
    item({ id: 'bigThinMargin', revenue: 5_000_000, marginPct: 2 }),
  ];
  const marginOnly = computeItemScores(items, { ...DEFAULT_ITEM_SCORE_WEIGHTS, volume: 0, momentum: 0, leadTime: 0, position: 0, consistency: 0, cashCycle: 0, margin: 100 });
  const volumeOnly = computeItemScores(items, { ...DEFAULT_ITEM_SCORE_WEIGHTS, margin: 0, momentum: 0, leadTime: 0, position: 0, consistency: 0, cashCycle: 0, volume: 100 });
  assert.ok(marginOnly.get('fatThinSeller')!.score > marginOnly.get('bigThinMargin')!.score);
  assert.ok(volumeOnly.get('bigThinMargin')!.score > volumeOnly.get('fatThinSeller')!.score);
});
