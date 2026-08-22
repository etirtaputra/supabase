/**
 * What sold, what it earned, what it cost — proved without a database.
 *
 * The failures worth guarding are the ones that still look like money: revenue
 * booked on a promise instead of a delivery, a reversed shipment counted as a
 * sale, an estimated cost presented as the ledger's, or a loss-making line
 * quietly dropped out of a "top by profit" so the board only shows winners.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  buildSalesFacts, factsInPeriod, rank,
  type DoRow, type DoItemRow, type SoItemRow, type OrderRow, type MoveRow, type SalesFact,
} from './salesFacts.ts';

const NOW = '2026-08-21T00:00:00Z';

const setup = (over: Partial<{
  dos: DoRow[]; doItems: DoItemRow[]; soItems: [string, SoItemRow][];
  orders: [string, OrderRow][]; moves: MoveRow[]; avgCost: [string, number][];
}> = {}) => buildSalesFacts({
  dos: over.dos ?? [{ do_id: 'D1', quote_id: 'Q1', status: 'delivered', delivered_at: '2026-08-01' }],
  doItems: over.doItems ?? [{ do_id: 'D1', so_item_id: 'S1', component_id: 'a', qty: 4 }],
  soItems: new Map(over.soItems ?? [['S1', { item_id: 'S1', unit_price: 1_000_000 }]]),
  orders: new Map(over.orders ?? [['Q1', { quote_id: 'Q1', customer_id: 'C1', sales_rep_id: null }]]),
  moves: over.moves ?? [{ component_id: 'a', direction: 'out', quantity: 4, unit_cost_idr: 600_000, source_type: 'delivery', source_id: 'D1' }],
  avgCost: new Map(over.avgCost ?? [['a', 999_999]]),
});

test('a delivered line is a sale, priced from its sales order and costed from the ledger', () => {
  const f = setup();
  assert.equal(f.length, 1);
  assert.equal(f[0].revenue, 4_000_000);
  assert.equal(f[0].cogs, 2_400_000, 'the ledger cost, not today’s average');
  assert.equal(f[0].cogsEstimated, false);
  assert.equal(f[0].customer_id, 'C1');
});

test('an undelivered order earns nothing — a promise is not a sale', () => {
  for (const status of ['preparing', 'draft', 'cancelled']) {
    assert.deepEqual(setup({ dos: [{ do_id: 'D1', quote_id: 'Q1', status, delivered_at: null }] }), [],
      `${status} deliveries must not book revenue`);
  }
});

test('a reversed shipment nets out of the cost rather than doubling it', () => {
  // Shipped 4, 1 came back against the same delivery: the ledger nets to 3.
  const f = setup({
    doItems: [{ do_id: 'D1', so_item_id: 'S1', component_id: 'a', qty: 3 }],
    moves: [
      { component_id: 'a', direction: 'out', quantity: 4, unit_cost_idr: 600_000, source_type: 'delivery', source_id: 'D1' },
      { component_id: 'a', direction: 'in', quantity: 1, unit_cost_idr: 600_000, source_type: 'delivery', source_id: 'D1' },
    ],
  });
  assert.equal(f[0].cogs, 1_800_000, '3 units at 600k, not 4');
});

test('a delivery the ledger never saw is costed at today’s average AND says so', () => {
  const f = setup({ moves: [] });
  assert.equal(f[0].cogs, 4 * 999_999);
  assert.equal(f[0].cogsEstimated, true, 'an estimate must never pass as the ledger’s own cost');
});

test('movements from other sources never touch a delivery’s cost', () => {
  const f = setup({
    moves: [
      { component_id: 'a', direction: 'out', quantity: 4, unit_cost_idr: 600_000, source_type: 'delivery', source_id: 'D1' },
      // a stock adjustment on the same day, and a receipt — neither is a sale
      { component_id: 'a', direction: 'out', quantity: 99, unit_cost_idr: 600_000, source_type: 'adjustment', source_id: 'D1' },
      { component_id: 'a', direction: 'in', quantity: 50, unit_cost_idr: 600_000, source_type: 'receipt', source_id: 'D1' },
    ],
  });
  assert.equal(f[0].cogs, 2_400_000);
});

test('two components on one delivery are two facts, each with its own cost', () => {
  const f = setup({
    doItems: [
      { do_id: 'D1', so_item_id: 'S1', component_id: 'a', qty: 4 },
      { do_id: 'D1', so_item_id: 'S2', component_id: 'b', qty: 2 },
    ],
    soItems: [['S1', { item_id: 'S1', unit_price: 1_000_000 }], ['S2', { item_id: 'S2', unit_price: 500_000 }]],
    moves: [
      { component_id: 'a', direction: 'out', quantity: 4, unit_cost_idr: 600_000, source_type: 'delivery', source_id: 'D1' },
      { component_id: 'b', direction: 'out', quantity: 2, unit_cost_idr: 100_000, source_type: 'delivery', source_id: 'D1' },
    ],
  });
  assert.equal(f.length, 2);
  assert.deepEqual(f.map((x) => x.revenue).sort((p, q) => q - p), [4_000_000, 1_000_000]);
});

test('a line with no priced sales-order row earns nothing rather than guessing a price', () => {
  const f = setup({ doItems: [{ do_id: 'D1', so_item_id: null, component_id: 'a', qty: 4 }] });
  assert.equal(f[0].revenue, 0);
});

// ── Period ───────────────────────────────────────────────────────────────────

const fact = (over: Partial<SalesFact>): SalesFact => ({
  component_id: 'a', do_id: 'D', quote_id: 'Q', customer_id: 'C',
  rep_id: null, date: '2026-08-01', qty: 1, revenue: 1000, cogs: 600,
  cogsEstimated: false, costKnown: true, ...over,
});

test('the period keeps what falls inside it, and "all" keeps everything', () => {
  const facts = [fact({ date: '2026-08-15' }), fact({ date: '2026-01-01' }), fact({ date: '2025-03-01' })];
  assert.equal(factsInPeriod(facts, '90', NOW).length, 1);
  assert.equal(factsInPeriod(facts, '365', NOW).length, 2);
  assert.equal(factsInPeriod(facts, 'all', NOW).length, 3);
});

// ── Ranking ──────────────────────────────────────────────────────────────────

const named = (key: string) => ({ name: `Item ${key}`, sub: (a: { qty: number; orders: number }) => `${a.qty} sold` });

test('ranking by revenue and by profit can disagree — which is the point', () => {
  const facts = [
    fact({ component_id: 'big', revenue: 10_000, cogs: 9_800 }),   // lots of turnover, thin
    fact({ component_id: 'fat', revenue: 4_000, cogs: 1_000 }),    // less turnover, fat margin
  ];
  const byRev = rank(facts, 'revenue', (f) => f.component_id, named);
  const byProfit = rank(facts, 'profit', (f) => f.component_id, named);
  assert.equal(byRev.rows[0].key, 'big');
  assert.equal(byProfit.rows[0].key, 'fat', 'the biggest seller is not the biggest earner');
});

test('a loss-making name sinks to the bottom of a profit board, it does not vanish', () => {
  const facts = [
    fact({ component_id: 'good', revenue: 5_000, cogs: 3_000 }),
    fact({ component_id: 'loss', revenue: 2_000, cogs: 3_500 }),
  ];
  const b = rank(facts, 'profit', (f) => f.component_id, named);
  assert.deepEqual(b.rows.map((r) => r.key), ['good', 'loss']);
  assert.equal(b.rows[1].profit, -1_500, 'losing money is a fact, not an omission');
  assert.equal(b.rows[1].share, 0, 'a loss claims no share of the profit');
});

test('a loss cannot inflate everyone else’s share by shrinking the total', () => {
  const facts = [
    fact({ component_id: 'good', revenue: 5_000, cogs: 3_000 }),   // +2000
    fact({ component_id: 'loss', revenue: 2_000, cogs: 3_500 }),   // -1500
  ];
  const b = rank(facts, 'profit', (f) => f.component_id, named);
  // Naively 2000 / (2000 - 1500) = 400%. The denominator counts only what was
  // actually earned, so the winner's share stays a share.
  assert.equal(b.rows[0].share, 1);
  assert.ok(b.rows[0].share <= 1);
});

test('the board reports how many names it ranked, not just the ten it shows', () => {
  const facts = Array.from({ length: 14 }, (_, i) =>
    fact({ component_id: `c${i}`, revenue: (i + 1) * 1000, cogs: 0 }));
  const b = rank(facts, 'revenue', (f) => f.component_id, named);
  assert.equal(b.rows.length, 10);
  assert.equal(b.ranked, 14, 'a top ten of fourteen must say there are fourteen');
  assert.equal(b.total, facts.reduce((s, f) => s + f.revenue, 0));
  // 1k..14k sums to 105k; the top ten (5k..14k) are 95k of it.
  assert.ok(Math.abs(b.rows.reduce((s, r) => s + r.share, 0) - 95 / 105) < 0.001,
    'the shown rows carry most, not all, of the total');
});

test('several deliveries to one customer roll into one row, orders counted once', () => {
  const facts = [
    fact({ customer_id: 'C1', quote_id: 'Q1', revenue: 1000, cogs: 400 }),
    fact({ customer_id: 'C1', quote_id: 'Q1', revenue: 500, cogs: 200 }),   // same order
    fact({ customer_id: 'C1', quote_id: 'Q2', revenue: 700, cogs: 300 }),   // another order
  ];
  const b = rank(facts, 'revenue', (f) => f.customer_id,
    () => ({ name: 'Acme', sub: (a) => `${a.orders} orders` }));
  assert.equal(b.rows.length, 1);
  assert.equal(b.rows[0].revenue, 2200);
  assert.equal(b.rows[0].sub, '2 orders', 'two deliveries on one order are one order');
});

test('an estimated cost anywhere in a row is carried to the surface', () => {
  const facts = [
    fact({ component_id: 'a', cogsEstimated: false }),
    fact({ component_id: 'a', cogsEstimated: true }),
  ];
  const b = rank(facts, 'profit', (f) => f.component_id, named);
  assert.equal(b.rows[0].estimated, true);
  assert.equal(b.anyEstimated, true, 'the board must be able to say its profit is partly estimated');
});

test('a fact with no key is left out rather than bucketed under a blank name', () => {
  const b = rank([fact({ customer_id: null })], 'revenue', (f) => f.customer_id,
    () => ({ name: 'x', sub: () => '' }));
  assert.deepEqual(b.rows, []);
  assert.equal(b.ranked, 0);
});

test('a reader who may not see cost gets no profit figure, not a wrong one', () => {
  // Same delivery, fetched WITHOUT cost: cogs is unknown, so it is 0 — and the
  // board must refuse to call that a profit rather than report revenue twice.
  const facts = buildSalesFacts({
    dos: [{ do_id: 'D1', quote_id: 'Q1', status: 'delivered', delivered_at: '2026-08-01' }],
    doItems: [{ do_id: 'D1', so_item_id: 'S1', component_id: 'a', qty: 4 }],
    soItems: new Map([['S1', { item_id: 'S1', unit_price: 1_000_000 }]]),
    orders: new Map([['Q1', { quote_id: 'Q1', customer_id: 'C1', sales_rep_id: null }]]),
    moves: [],
    avgCost: new Map(),
    costKnown: false,
  });
  assert.equal(facts[0].costKnown, false);
  assert.equal(facts[0].cogsEstimated, false, 'nothing was estimated — cost was simply not read');
  const b = rank(facts, 'revenue', (f) => f.component_id, named);
  assert.equal(b.rows[0].revenue, 4_000_000);
  assert.equal(b.profitKnown, false, 'the widget uses this to hide the profit view entirely');
});

test('a sale belongs to its rep, or failing that to the customer’s account manager', () => {
  const base = {
    dos: [{ do_id: 'D1', quote_id: 'Q1', status: 'delivered', delivered_at: '2026-08-01' }],
    doItems: [{ do_id: 'D1', so_item_id: 'S1', component_id: 'a', qty: 1 }],
    soItems: new Map([['S1', { item_id: 'S1', unit_price: 100 }]]),
    moves: [], avgCost: new Map<string, number>(),
    accountManagerOf: new Map([['C1', 'AM']]),
  };
  const withRep = buildSalesFacts({ ...base,
    orders: new Map([['Q1', { quote_id: 'Q1', customer_id: 'C1', sales_rep_id: 'REP' }]]) });
  assert.equal(withRep[0].rep_id, 'REP', 'the rep named on the order wins');
  const withoutRep = buildSalesFacts({ ...base,
    orders: new Map([['Q1', { quote_id: 'Q1', customer_id: 'C1', sales_rep_id: null }]]) });
  assert.equal(withoutRep[0].rep_id, 'AM', 'otherwise the account manager owns it');
});
