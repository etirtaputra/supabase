/**
 * priceInsight — cost trend, similar items and the restock warning behind
 * Selling Prices › Prices. Cases are the real items from the 22 Oct preview.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { costHistory, costTrend, similarTo, restockGap } from './priceInsight.ts';

const p = (label: string, date: string, unitCost: number) => ({ label, date, unitCost });

test('ICA550: the last paid PO cost 28.6% more than the one before', () => {
  const h = costHistory([p('EB.41039', '2025-07-01', 809178), p('EB.41206', '2025-08-27', 811081), p('EB.41683', '2026-01-29', 1042852)], []);
  const tr = costTrend(h);
  assert.equal(tr.last?.label, 'EB.41683');
  assert.equal(tr.prev?.label, 'EB.41206');
  assert.equal(tr.dir, 'up');
  assert.equal(Math.round(tr.changePct! * 10) / 10, 28.6);
});

test('a receipt not paid yet is the newest cost; a paid PO is never counted twice', () => {
  const h = costHistory([p('EB.1', '2026-01-01', 100)], [p('EB.1', '2026-02-01', 120), p('PIO-2026012', '2026-10-20T03:00:00Z', 388702)]);
  assert.deepEqual(h.map((x) => [x.label, x.source, x.date]), [['PIO-2026012', 'received', '2026-10-20'], ['EB.1', 'paid', '2026-01-01']]);
});

test('ICA100: one purchase has no trend yet', () => {
  const tr = costTrend(costHistory([], [p('PIO-2026012', '2026-10-20', 388702)]));
  assert.equal(tr.dir, 'first');
  assert.equal(tr.changePct, null);
});

test('QI1522: a cost far off the rest is set aside, and the trend reads flat', () => {
  const tr = costTrend(costHistory([p('PIO-008', '2026-05-13', 3072286), p('PIO-009', '2026-05-13', 7222499), p('PIO-010', '2026-05-13', 3086458)], []));
  assert.deepEqual(tr.outliers.map((o) => o.label), ['PIO-009']);
  assert.equal(tr.dir, 'flat');
  assert.equal(tr.last?.unitCost, 3086458);
});

test('small moves are flat; XTRA4210N fell 3.2%', () => {
  assert.equal(costTrend([p('b', '2026-09-22', 2150098), p('a', '2026-05-08', 2154537)].map((x) => ({ ...x, source: 'paid' as const }))).dir, 'flat');
  const tr = costTrend([p('b', '2026-03-02', 855289), p('a', '2026-01-12', 883267)].map((x) => ({ ...x, source: 'paid' as const })));
  assert.equal(tr.dir, 'down');
  assert.equal(Math.round(tr.changePct! * 10) / 10, -3.2);
});

const cat = [
  { component_id: 'ica550', category: 'pv_module', norm_value: 550, selling_price_idr: 1380000, name: 'ICA550' },
  { component_id: 'trina620', category: 'pv_module', norm_value: 620, selling_price_idr: 1600000, name: 'TRINA 620' },
  { component_id: 'trina720', category: 'pv_module', norm_value: 720, selling_price_idr: 1860000, name: 'TRINA 720' },
  { component_id: 'ica100', category: 'pv_module', norm_value: 100, selling_price_idr: 438000, name: 'ICA100' },
  { component_id: 'unpriced', category: 'pv_module', norm_value: 560, selling_price_idr: null, name: 'no price' },
  { component_id: 'cable', category: 'pv_cable', norm_value: 6, selling_price_idr: 25000, name: 'cable' },
];

test('similar = same category, half to double the size, priced; small panels are not the comparison', () => {
  const s = similarTo(cat[0], 1380000, cat)!;
  assert.deepEqual(s.peers.map((x) => x.componentId).sort(), ['trina620', 'trina720']);
  assert.equal(s.unit, 'Wp');
  assert.ok(s.diffPct < -2 && s.diffPct > -4, `about 3% cheaper, got ${s.diffPct}`);
});

test('nothing to compare: no peers, no size, or a per-metre category', () => {
  assert.equal(similarTo(cat[3], 438000, cat), null);
  assert.equal(similarTo({ component_id: 'x', category: 'pv_module', norm_value: null }, 1000, cat), null);
  assert.equal(similarTo(cat[5], 25000, cat), null);
});

test('restock warning only when the last order moves the margin by 3+ points', () => {
  const g = restockGap(1042852, 888029, 1380000)!;
  assert.equal(Math.round(g.lastMargin * 10) / 10, 24.4);
  assert.equal(Math.round(g.stockMargin * 10) / 10, 35.7);
  assert.equal(restockGap(855289, 908484, 1200000), null, 'cheaper last order: no warning');
  assert.equal(restockGap(101, 100, 1000), null, 'a hair dearer: no warning');
});
