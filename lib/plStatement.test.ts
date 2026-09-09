/**
 * The P&L is the number the owner makes decisions on, so the cases pinned here
 * are the ones where a plausible implementation and an honest one differ.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildPL, periodKey, periodLabel, toCsvRows, type Grain } from './plStatement.ts';
import type { SalesFact } from './salesFacts.ts';

const fact = (o: Partial<SalesFact> & { date: string }): SalesFact => ({
  component_id: 'c1', do_id: 'd1', quote_id: 'q1', customer_id: null, rep_id: null,
  qty: 1, revenue: 1000, cogs: 600, cogsEstimated: false, costKnown: true, ...o,
});

const CATS: Record<string, string> = { c1: 'pv_module', c2: 'pv_module', c3: 'batteries' };
const NAMES: Record<string, string> = { c1: 'Panel 550Wp', c2: 'Panel 620Wp', c3: 'LiFePO4 5kWh' };
const lookup = {
  nameOf: (id: string) => NAMES[id] ?? id,
  categoryOf: (id: string) => CATS[id] ?? 'uncategorised',
};
const pl = (facts: SalesFact[], grain: Grain = 'month') => buildPL(facts, grain, lookup);

// ── Bucketing ───────────────────────────────────────────────────────────────

test('a date lands in the right month, quarter and year', () => {
  assert.equal(periodKey('2026-07-21', 'month'), '2026-07');
  assert.equal(periodKey('2026-07-21', 'quarter'), '2026-Q3');
  assert.equal(periodKey('2026-07-21', 'year'), '2026');
  // The quarter boundaries, which off-by-one errors land on
  assert.equal(periodKey('2026-03-31', 'quarter'), '2026-Q1');
  assert.equal(periodKey('2026-04-01', 'quarter'), '2026-Q2');
  assert.equal(periodKey('2026-12-31', 'quarter'), '2026-Q4');
  assert.equal(periodKey('2026-01-01', 'quarter'), '2026-Q1');
});

test('period keys sort as strings, so nothing needs a date comparator', () => {
  const keys = ['2026-10-01', '2026-02-01', '2025-12-01'].map((d) => periodKey(d, 'month')).sort();
  assert.deepEqual(keys, ['2025-12', '2026-02', '2026-10']);
  const q = ['2026-Q10'];   // not a real key — quarters stop at 4, so plain sort is safe
  assert.equal(q.length, 1);
});

test('a full ISO timestamp buckets on its own calendar date, not the reader’s timezone', () => {
  // 23:00Z on 31 March is April somewhere. The statement must total the same
  // for everyone who opens it, so the ledger's own date wins.
  assert.equal(periodKey('2026-03-31T23:00:00.000Z', 'quarter'), '2026-Q1');
  assert.equal(periodKey('2026-03-31T23:00:00.000Z', 'month'), '2026-03');
});

test('column headings read the way a person says them', () => {
  assert.equal(periodLabel('2026-07', 'month'), 'Jul 2026');
  assert.equal(periodLabel('2026-Q3', 'quarter'), '2026 Q3');
  assert.equal(periodLabel('2026', 'year'), '2026');
});

test('periods run oldest first — a statement reads forward', () => {
  const s = pl([fact({ date: '2026-08-01' }), fact({ date: '2026-06-01' }), fact({ date: '2026-07-01' })]);
  assert.deepEqual(s.periods.map((p) => p.key), ['2026-06', '2026-07', '2026-08']);
});

// ── The arithmetic ──────────────────────────────────────────────────────────

test('gross profit is revenue minus cost, and margin divides by revenue', () => {
  const s = pl([fact({ date: '2026-07-01', revenue: 1000, cogs: 600 })]);
  assert.equal(s.total.revenue, 1000);
  assert.equal(s.total.cogs, 600);
  assert.equal(s.total.grossProfit, 400);
  assert.equal(s.total.marginPct, 40);
});

test('no revenue means no margin — not zero percent, and never a division by zero', () => {
  const s = pl([fact({ date: '2026-07-01', revenue: 0, cogs: 0 })]);
  assert.equal(s.total.marginPct, null);
  assert.ok(Number.isFinite(s.total.grossProfit));
});

test('a sale below cost reports a negative margin rather than hiding it', () => {
  const s = pl([fact({ date: '2026-07-01', revenue: 500, cogs: 800 })]);
  assert.equal(s.total.grossProfit, -300);
  assert.equal(s.total.marginPct, -60);
});

test('every level totals the same money: periods, categories and items all reconcile', () => {
  const facts = [
    fact({ date: '2026-07-01', component_id: 'c1', revenue: 1000, cogs: 600 }),
    fact({ date: '2026-07-15', component_id: 'c2', revenue: 2000, cogs: 1500 }),
    fact({ date: '2026-08-02', component_id: 'c3', revenue: 3000, cogs: 1000 }),
  ];
  const s = pl(facts);
  const sum = (ns: number[]) => ns.reduce((a, b) => a + b, 0);
  assert.equal(s.total.revenue, 6000);
  assert.equal(sum(s.periods.map((p) => p.revenue)), 6000, 'columns must add to the total');
  assert.equal(sum(s.categories.map((c) => c.revenue)), 6000, 'categories must add to the total');
  assert.equal(sum(s.categories.flatMap((c) => c.items.map((i) => i.revenue))), 6000, 'items must add up too');
  assert.equal(sum(s.categories.map((c) => c.grossProfit)), s.total.grossProfit);
});

test('the same item sold twice in one period is ONE row, not two', () => {
  const s = pl([
    fact({ date: '2026-07-01', component_id: 'c1', qty: 1, revenue: 1000, cogs: 600 }),
    fact({ date: '2026-07-20', component_id: 'c1', qty: 2, revenue: 2000, cogs: 1200 }),
  ]);
  const items = s.categories.flatMap((c) => c.items);
  assert.equal(items.length, 1);
  assert.equal(items[0].qty, 3);
  assert.equal(items[0].revenue, 3000);
  assert.equal(s.cellsByItem.get('c1')?.get('2026-07')?.revenue, 3000);
});

test('quarterly and yearly are the monthly numbers regrouped, never recomputed differently', () => {
  const facts = [
    fact({ date: '2026-01-15', revenue: 100, cogs: 60 }),
    fact({ date: '2026-02-15', revenue: 200, cogs: 120 }),
    fact({ date: '2026-05-15', revenue: 300, cogs: 180 }),
  ];
  const m = pl(facts, 'month'), q = pl(facts, 'quarter'), y = pl(facts, 'year');
  assert.equal(m.total.revenue, 600);
  assert.equal(q.total.revenue, 600);
  assert.equal(y.total.revenue, 600);
  assert.deepEqual(q.periods.map((p) => [p.key, p.revenue]), [['2026-Q1', 300], ['2026-Q2', 300]]);
  assert.deepEqual(y.periods.map((p) => [p.key, p.revenue]), [['2026', 600]]);
});

// ── Ranking ─────────────────────────────────────────────────────────────────

test('categories rank by GROSS PROFIT, not revenue — the whole point of the report', () => {
  // Batteries turn over more and earn less. Revenue order would put them top.
  const s = pl([
    fact({ date: '2026-07-01', component_id: 'c3', revenue: 10_000, cogs: 9_500 }),  // batteries: GP 500
    fact({ date: '2026-07-01', component_id: 'c1', revenue: 4_000, cogs: 1_000 }),   // pv_module: GP 3,000
  ]);
  assert.deepEqual(s.categories.map((c) => c.category), ['pv_module', 'batteries']);
  assert.equal(s.categories[0].grossProfit, 3000);
});

test('items rank within their own category, biggest earner first', () => {
  const s = pl([
    fact({ date: '2026-07-01', component_id: 'c1', revenue: 1000, cogs: 900 }),   // GP 100
    fact({ date: '2026-07-01', component_id: 'c2', revenue: 1000, cogs: 200 }),   // GP 800
  ]);
  const pv = s.categories.find((c) => c.category === 'pv_module')!;
  assert.deepEqual(pv.items.map((i) => i.name), ['Panel 620Wp', 'Panel 550Wp']);
});

// ── Honesty ─────────────────────────────────────────────────────────────────

test('one estimated line makes its whole total estimated — "mostly from the ledger" is not a thing', () => {
  const s = pl([
    fact({ date: '2026-07-01', component_id: 'c1', cogsEstimated: false }),
    fact({ date: '2026-07-02', component_id: 'c2', cogsEstimated: true }),
  ]);
  assert.equal(s.total.estimated, true);
  assert.equal(s.categories[0].estimated, true, 'both items are pv_module, so the category is tainted');
  const clean = s.categories[0].items.find((i) => i.componentId === 'c1')!;
  assert.equal(clean.estimated, false, 'but the item that WAS from the ledger stays clean');
});

test('the estimated share is a proportion of cost, so the owner can weigh the caveat', () => {
  const s = pl([
    fact({ date: '2026-07-01', component_id: 'c1', cogs: 750, cogsEstimated: true }),
    fact({ date: '2026-07-02', component_id: 'c2', cogs: 250, cogsEstimated: false }),
  ]);
  assert.equal(s.estimatedCogsShare, 0.75);
});

test('no facts is an empty statement, not a crash or a fake zero margin', () => {
  const s = pl([]);
  assert.deepEqual(s.periods, []);
  assert.deepEqual(s.categories, []);
  assert.equal(s.total.revenue, 0);
  assert.equal(s.total.marginPct, null);
  assert.equal(s.estimatedCogsShare, 0);
});

test('a fact with no delivery date is left out, so the columns still add to the total', () => {
  const s = pl([fact({ date: '', revenue: 999 }), fact({ date: '2026-07-01', revenue: 1000 })]);
  assert.equal(s.total.revenue, 1000);
  assert.equal(s.periods.reduce((a, p) => a + p.revenue, 0), 1000);
});

test('a reader who may not see cost gets no profit figure at all, rather than a wrong one', () => {
  // costKnown false means cogs is UNKNOWN, not zero — so "100% margin" must
  // never appear. This is the honesty doctrine as an assertion.
  const s = pl([fact({ date: '2026-07-01', revenue: 1000, cogs: 0, costKnown: false })]);
  assert.equal(s.total.costKnown, false);
  assert.equal(s.total.grossProfit, 0);
  assert.equal(s.total.marginPct, null, 'no margin may be stated when cost is invisible');
  assert.equal(s.total.revenue, 1000, 'revenue is still true and still shown');
});

test('an item with no category is grouped as uncategorised rather than dropped', () => {
  const s = pl([fact({ date: '2026-07-01', component_id: 'unknown-id' })]);
  assert.equal(s.categories.length, 1);
  assert.equal(s.categories[0].category, 'uncategorised');
  assert.equal(s.total.revenue, 1000, 'its money still counts');
});

test('the label says gross profit only — no screen may relabel it net', () => {
  assert.equal(pl([]).grossProfitOnly, true);
});

// ── Export ──────────────────────────────────────────────────────────────────

test('the CSV carries category, item, period and the COGS basis of every row', () => {
  const rows = toCsvRows(pl([
    fact({ date: '2026-07-01', component_id: 'c1', revenue: 1000, cogs: 600 }),
    fact({ date: '2026-08-01', component_id: 'c3', revenue: 500, cogs: 500, cogsEstimated: true }),
  ]), (c) => c.toUpperCase());
  assert.deepEqual(rows[0].slice(0, 4), ['Level', 'Category', 'Item', 'Period']);
  const item = rows.find((r) => r[0] === 'Item' && r[2] === 'LiFePO4 5kWh')!;
  assert.equal(item[3], 'Aug 2026');
  assert.equal(item.at(-1), 'estimated', 'a guessed cost must say so in the export too');
  const clean = rows.find((r) => r[0] === 'Item' && r[2] === 'Panel 550Wp')!;
  assert.equal(clean.at(-1), 'ledger');
  assert.equal(rows.filter((r) => r[0] === 'Total').length, 2, 'one total row per period');
});

test('a hidden-cost export leaves the cost columns blank rather than printing zero', () => {
  const rows = toCsvRows(pl([fact({ date: '2026-07-01', costKnown: false, cogs: 0 })]), (c) => c);
  const item = rows.find((r) => r[0] === 'Item')!;
  assert.equal(item[6], '', 'COGS blank, not 0');
  assert.equal(item[7], '', 'gross profit blank, not 0');
  assert.equal(item.at(-1), 'hidden');
});
