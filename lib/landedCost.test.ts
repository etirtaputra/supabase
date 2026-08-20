/**
 * Landed-cost reconciliation tests — the receipt's guess against the real bill:
 *   • the cost pool excludes local taxes and converts at the cost row's own
 *     rate, falling back to the PO's — the same rule computeTUC follows;
 *   • the factor carries the exchange rate, so a foreign PO's line cost in its
 *     own currency lands in rupiah;
 *   • the correction splits: units still on hand revalue, units already sold
 *     are reported as overstated past gross profit;
 *   • a posted true-up neutralises the variance — running it twice is a no-op;
 *   • a cheaper-than-estimated import produces a NEGATIVE correction;
 *   • rounding dust and uncosted POs never reach a human.
 * Hand-built rows; no fetch.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  computeLandedVariances, landedFactorOf, poolIdrOf, isSettled, revaluationRows,
  MATERIAL_IDR, DUST_IDR, REVALUE_DIRECTION, REVALUE_SOURCE_TYPE,
  type LcPo, type LcLine, type LcCost, type LcMovement, type LcBalance,
} from './landedCost.ts';

const po = (over: Partial<LcPo> = {}): LcPo => ({
  po_id: 'P1', po_number: 'EB.1', po_date: '2026-05-01', status: 'Fully Received',
  currency: 'USD', exchange_rate: 16_000, supplier_id: 'S1', quote_id: null, ...over,
});
const line = (over: Partial<LcLine> = {}): LcLine =>
  ({ po_id: 'P1', component_id: 'C1', quantity: 10, unit_cost: 100, ...over });
const cost = (over: Partial<LcCost> = {}): LcCost =>
  ({ po_id: 'P1', cost_category: 'balance_payment', amount: 1000, currency: 'USD', exchange_rate: null, ...over });
const move = (over: Partial<LcMovement> = {}): LcMovement => ({
  component_id: 'C1', location: 'MAIN', direction: 'in', quantity: 10,
  unit_cost_idr: 1_600_000, source_type: 'receipt', source_id: 'P1', moved_at: '2026-05-10', ...over,
});
const bal = (over: Partial<LcBalance> = {}): LcBalance =>
  ({ component_id: 'C1', location: 'MAIN', qty_on_hand: 10, avg_cost_idr: 1_600_000, ...over });

test('the pool excludes local taxes and prefers the cost row rate over the PO rate', () => {
  const costs = [
    cost({ amount: 1000, currency: 'USD', exchange_rate: null }),        // 1000 × PO 16,000 = 16,000,000
    cost({ cost_category: 'telex_bank_fee', amount: 50, currency: 'USD', exchange_rate: 17_000 }), // own rate = 850,000
    cost({ cost_category: 'local_delivery', amount: 2_000_000, currency: 'IDR' }),
    cost({ cost_category: 'local_vat', amount: 9_999_999, currency: 'IDR' }),        // excluded
    cost({ cost_category: 'local_income_tax', amount: 8_888_888, currency: 'IDR' }), // excluded
  ];
  assert.equal(poolIdrOf(costs, 16_000), 16_000_000 + 850_000 + 2_000_000);
  // No rate anywhere: an IDR-less amount is taken at face value rather than dropped
  assert.equal(poolIdrOf([cost({ amount: 5, currency: 'USD', exchange_rate: null })], null), 5);
});

test('the factor carries the exchange rate; no costs or no line value means no factor', () => {
  // 1,000 units of line value (10 × 100 USD) against a 17,000,000 IDR pool
  const f = landedFactorOf([line()], [cost({ amount: 1000 }), cost({ cost_category: 'local_delivery', amount: 1_000_000, currency: 'IDR' })], 16_000);
  assert.equal(f, 17_000);                                   // IDR per USD of line value
  assert.equal(landedFactorOf([line()], [], 16_000), null);  // nothing recorded yet
  assert.equal(landedFactorOf([], [cost()], 16_000), null);  // nothing to spread it over
  assert.equal(landedFactorOf([line({ quantity: 0 })], [cost()], 16_000), null);
});

test('freight billed separately reaches the unit cost', () => {
  // The forwarder's own invoice is landed cost, not a tax, so the pool takes
  // it — the same rule computeTUC applies, which is why adding the category
  // was the whole change.
  const withFreight = poolIdrOf([
    cost({ amount: 1000 }),                                                        // 16,000,000 principal
    cost({ cost_category: 'freight_cost', amount: 3_000_000, currency: 'IDR' }),
  ], 16_000);
  assert.equal(withFreight, 19_000_000);
  // And it moves the landed cost of the goods, rather than sitting beside them
  const s = computeLandedVariances(
    [po()], [line()],
    [cost({ amount: 1000 }), cost({ cost_category: 'freight_cost', amount: 4_000_000, currency: 'IDR' })],
    [move()], [bal({ qty_on_hand: 10 })],
  );
  assert.equal(s.pos[0].items[0].actualUnit, 2_000_000);   // 1,600,000 + 400,000 of freight
  assert.equal(s.pos[0].delta, 4_000_000);
});

test('settled means a balance payment exists — a down payment alone is not final', () => {
  assert.equal(isSettled([cost({ cost_category: 'down_payment' })]), false);
  assert.equal(isSettled([cost({ cost_category: 'down_payment' }), cost({ cost_category: 'balance_payment' })]), true);
  assert.equal(isSettled([cost({ cost_category: 'additional_balance_payment' })]), true);
});

test('freight recorded after the receipt becomes the correction, split on-hand vs sold', () => {
  // Received 10 units at 1,600,000 (principal × PO rate). The freight invoice
  // then lands: pool = 16,000,000 + 4,000,000 = 20,000,000 over 1,000 of line
  // value → 2,000,000/unit actual. 6 units are still on hand.
  const s = computeLandedVariances(
    [po()], [line()],
    [cost({ amount: 1000 }), cost({ cost_category: 'local_delivery', amount: 4_000_000, currency: 'IDR' })],
    [move()], [bal({ qty_on_hand: 6, avg_cost_idr: 1_600_000 })],
  );
  assert.equal(s.pos.length, 1);
  const v = s.pos[0];
  assert.equal(v.status, 'ready');
  assert.equal(v.bookedValue, 16_000_000);
  assert.equal(v.actualValue, 20_000_000);
  assert.equal(v.delta, 4_000_000);
  assert.equal(Math.round(v.deltaPct * 1000) / 1000, 0.25);
  // 6 of 10 units survive: 6 × 400,000 revalues, the other 4 are gone
  assert.equal(v.inventoryDelta, 2_400_000);
  assert.equal(v.cogsDelta, 1_600_000);
  const i = v.items[0];
  assert.equal(i.bookedUnit, 1_600_000);
  assert.equal(i.actualUnit, 2_000_000);
  assert.equal(i.revaluable, 6);
  // Everything on hand carries the correction: 1,600,000 + 2,400,000/6
  assert.equal(i.newAvg, 2_000_000);
  assert.equal(s.readyDelta, 4_000_000);
  assert.equal(s.readyInventoryDelta, 2_400_000);
  assert.equal(s.readyCogsDelta, 1_600_000);
});

test('the correction spreads over ALL units on hand, not just the ones received', () => {
  // 10 received against this PO, but 20 on hand (an earlier PO's units are
  // mixed in). Moving average holds no lots: the 4,000,000 correction lands on
  // the whole pool of 20.
  const s = computeLandedVariances(
    [po()], [line()],
    [cost({ amount: 1000 }), cost({ cost_category: 'local_delivery', amount: 4_000_000, currency: 'IDR' })],
    [move()], [bal({ qty_on_hand: 20, avg_cost_idr: 1_500_000 })],
  );
  const i = s.pos[0].items[0];
  assert.equal(i.revaluable, 10);                 // never more units than were received
  assert.equal(i.inventoryDelta, 4_000_000);
  assert.equal(i.cogsDelta, 0);
  assert.equal(i.newAvg, 1_500_000 + 4_000_000 / 20);
});

test('nothing left on hand: the whole correction is past gross profit, and no ledger row is written', () => {
  const s = computeLandedVariances(
    [po()], [line()],
    [cost({ amount: 1000 }), cost({ cost_category: 'local_delivery', amount: 4_000_000, currency: 'IDR' })],
    [move()], [bal({ qty_on_hand: 0, avg_cost_idr: 1_600_000 })],
  );
  const v = s.pos[0];
  assert.equal(v.inventoryDelta, 0);
  assert.equal(v.cogsDelta, 4_000_000);
  assert.equal(v.items[0].newAvg, 1_600_000);     // untouched
  assert.deepEqual(revaluationRows(v), []);       // a movement that changes nothing is noise
});

test('a posted true-up clears the variance, and posting again would change nothing', () => {
  const costs = [cost({ amount: 1000 }), cost({ cost_category: 'local_delivery', amount: 4_000_000, currency: 'IDR' })];
  const first = computeLandedVariances([po()], [line()], costs, [move()], [bal({ qty_on_hand: 6 })]);
  const rows = revaluationRows(first.pos[0]);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].direction, REVALUE_DIRECTION);
  assert.equal(rows[0].source_type, REVALUE_SOURCE_TYPE);
  assert.equal(rows[0].source_id, 'P1');
  assert.equal(rows[0].quantity, 10);             // the units the correction relates to
  assert.equal(rows[0].unit_cost_idr, 400_000);   // per-unit correction
  // Feed the posted row back in: the PO drops out of the list entirely
  const after = computeLandedVariances([po()], [line()], costs,
    [move(), { ...move(), direction: REVALUE_DIRECTION, source_type: REVALUE_SOURCE_TYPE, quantity: 10, unit_cost_idr: 400_000 }],
    [bal({ qty_on_hand: 6, avg_cost_idr: 2_000_000 })]);
  assert.equal(after.pos.length, 0);
  assert.equal(after.readyDelta, 0);
});

test('new costs after a true-up bring back only the increment', () => {
  const costs = [
    cost({ amount: 1000 }),
    cost({ cost_category: 'local_delivery', amount: 4_000_000, currency: 'IDR' }),
    cost({ cost_category: 'local_import_duty', amount: 1_000_000, currency: 'IDR' }),   // arrives later
  ];
  const s = computeLandedVariances([po()], [line()], costs,
    [move(), { ...move(), direction: REVALUE_DIRECTION, source_type: REVALUE_SOURCE_TYPE, quantity: 10, unit_cost_idr: 400_000 }],
    [bal({ qty_on_hand: 6, avg_cost_idr: 2_000_000 })]);
  assert.equal(s.pos.length, 1);
  assert.equal(s.pos[0].delta, 1_000_000);        // the duty only — not the freight again
  assert.equal(s.pos[0].trued, true);
});

test('a cheaper-than-estimated import corrects downward', () => {
  // Booked at 2,000,000/unit but the pool only ever reached 16,000,000
  const s = computeLandedVariances(
    [po()], [line()], [cost({ amount: 1000 })],
    [move({ unit_cost_idr: 2_000_000 })], [bal({ qty_on_hand: 10, avg_cost_idr: 2_000_000 })],
  );
  const v = s.pos[0];
  assert.equal(v.delta, -4_000_000);
  assert.equal(v.items[0].newAvg, 1_600_000);
  assert.equal(revaluationRows(v)[0].unit_cost_idr, -400_000);
});

test('partial receipts value only what actually arrived', () => {
  // 100 ordered, 40 received in two batches at different guesses
  const s = computeLandedVariances(
    [po()], [line({ quantity: 100, unit_cost: 100 })],
    [cost({ amount: 10_000 }), cost({ cost_category: 'local_delivery', amount: 40_000_000, currency: 'IDR' })],
    [move({ quantity: 30, unit_cost_idr: 1_600_000 }), move({ quantity: 10, unit_cost_idr: 1_700_000 })],
    [bal({ qty_on_hand: 40, avg_cost_idr: 1_625_000 })],
  );
  const v = s.pos[0];
  // pool 200,000,000 over 10,000 line value → 20,000 per USD → 2,000,000/unit
  assert.equal(v.items[0].received, 40);
  assert.equal(v.items[0].bookedUnit, (30 * 1_600_000 + 10 * 1_700_000) / 40);
  assert.equal(v.items[0].actualUnit, 2_000_000);
  assert.equal(v.actualValue, 80_000_000);        // the 60 units still at sea are not valued
  assert.equal(v.delta, 80_000_000 - 65_000_000);
});

test('each warehouse revalues against its own on-hand', () => {
  const s = computeLandedVariances(
    [po()], [line({ quantity: 20 })],
    [cost({ amount: 2000 }), cost({ cost_category: 'local_delivery', amount: 8_000_000, currency: 'IDR' })],
    [move({ quantity: 10, location: 'MAIN' }), move({ quantity: 10, location: 'WH2' })],
    [bal({ location: 'MAIN', qty_on_hand: 10 }), bal({ location: 'WH2', qty_on_hand: 2, avg_cost_idr: 1_600_000 })],
  );
  const v = s.pos[0];
  assert.equal(v.items.length, 2);
  const main = v.items.find((i) => i.location === 'MAIN')!;
  const wh2 = v.items.find((i) => i.location === 'WH2')!;
  assert.equal(main.revaluable, 10);
  assert.equal(wh2.revaluable, 2);                // only 2 left there to carry it
  assert.equal(wh2.cogsDelta, 8 * 400_000);
  assert.equal(revaluationRows(v).length, 2);
});

test('goods in, bills still arriving: shown, but not called ready', () => {
  const s = computeLandedVariances(
    [po()], [line()],
    [cost({ cost_category: 'down_payment', amount: 1000 }), cost({ cost_category: 'local_delivery', amount: 4_000_000, currency: 'IDR' })],
    [move()], [bal()],
  );
  assert.equal(s.pos[0].status, 'awaiting');
  assert.equal(s.ready.length, 0);
  assert.equal(s.awaiting.length, 1);
  assert.equal(s.readyDelta, 0);
});

test('dust, uncosted POs and unreceived POs never reach a human', () => {
  const receipts = [move()];
  // Big enough in rupiah, tiny against a 16,000,000 receipt: a bank fee that
  // moves no decision. Counted and reported, not listed.
  const small = computeLandedVariances([po()], [line()],
    [cost({ amount: 1000 }), cost({ cost_category: 'admin_bank_fee', amount: MATERIAL_IDR - 1, currency: 'IDR' })],
    receipts, [bal()]);
  assert.equal(small.pos.length, 0);
  assert.equal(small.immaterial, 1);
  assert.equal(small.immaterialDelta, MATERIAL_IDR - 1);
  // Arithmetic noise is not even counted
  const dust = computeLandedVariances([po()], [line()],
    [cost({ amount: 1000 }), cost({ cost_category: 'admin_bank_fee', amount: DUST_IDR - 1, currency: 'IDR' })],
    receipts, [bal()]);
  assert.equal(dust.pos.length, 0);
  assert.equal(dust.immaterial, 0);
  // Received, but not one bill recorded — there is nothing to allocate
  const uncosted = computeLandedVariances([po()], [line()], [], receipts, [bal()]);
  assert.equal(uncosted.pos.length, 0);
  assert.equal(uncosted.uncosted, 1);
  // Costed and settled, but nothing has arrived yet
  const unreceived = computeLandedVariances([po()], [line()], [cost({ amount: 1000 })], [], [bal()]);
  assert.equal(unreceived.pos.length, 0);
  assert.equal(unreceived.uncosted, 0);
});

test('the same rupiah on a small PO is material — the floor is proportional too', () => {
  // 10 units received at 16,000 each: a 40,000 fee is 25% of the goods
  const s = computeLandedVariances(
    [po({ exchange_rate: 160 })], [line({ unit_cost: 1 })],
    [cost({ amount: 10 }), cost({ cost_category: 'admin_bank_fee', amount: 40_000, currency: 'IDR' })],
    [move({ unit_cost_idr: 160 })], [bal({ avg_cost_idr: 160 })],
  );
  assert.equal(s.pos.length, 1);
  assert.equal(s.pos[0].delta, 40_000);           // below MATERIAL_IDR, far above MATERIAL_PCT
  assert.equal(s.immaterial, 0);
});

test('a receipt no PO line explains is counted, never guessed at', () => {
  const s = computeLandedVariances(
    [po()], [line()],
    [cost({ amount: 1000 }), cost({ cost_category: 'local_delivery', amount: 4_000_000, currency: 'IDR' })],
    [move(), move({ component_id: 'GHOST' })],
    [bal(), bal({ component_id: 'GHOST' })],
  );
  assert.equal(s.pos[0].unmatched, 1);
  assert.equal(s.pos[0].items.length, 1);
  assert.equal(s.pos[0].items[0].componentId, 'C1');
});

test('POs are ranked by the size of the correction, biggest first', () => {
  const small = computeLandedVariances(
    [po(), po({ po_id: 'P2', po_number: 'EB.2' })],
    [line(), line({ po_id: 'P2', component_id: 'C2', quantity: 100 })],
    [
      cost({ amount: 1000 }), cost({ cost_category: 'local_delivery', amount: 4_000_000, currency: 'IDR' }),
      cost({ po_id: 'P2', amount: 10_000 }), cost({ po_id: 'P2', cost_category: 'local_delivery', amount: 90_000_000, currency: 'IDR' }),
    ],
    [move(), move({ source_id: 'P2', component_id: 'C2', quantity: 100, unit_cost_idr: 1_600_000 })],
    [bal(), bal({ component_id: 'C2', qty_on_hand: 100 })],
  );
  assert.deepEqual(small.pos.map((p) => p.poNumber), ['EB.2', 'EB.1']);
});
