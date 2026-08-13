/**
 * In-transit tests — goods on the water read from open POs:
 *   • lead time is measured per SUPPLIER, falling back to the global average
 *     and then 30 days;
 *   • expected arrival prefers a stamped ETA over the lead-time estimate;
 *   • a PO past its expected arrival is overdue; paid capital follows the AP
 *     rule (PRINCIPAL_CATS at the recorded rate) and an unrated PO is set aside;
 *   • per-item arrival keeps the EARLIEST expected date and goes overdue if any
 *     of the item's open POs is late.
 * A fixed "today" keeps every assertion deterministic. Hand-built rows.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  measureLead, expectedArrival, computeInTransit, itemArrivals, FALLBACK_LEAD_DAYS,
  type OpenPo, type ReceivedPo, type PoCost,
} from './inTransit.ts';

const NOW = '2026-08-13';

const po = (over: Partial<OpenPo>): OpenPo => ({
  po_id: 'P1', po_number: 'EB.1', status: 'Confirmed', po_date: '2026-08-01',
  estimated_delivery_date: null, supplier_id: 'S1', currency: 'IDR', exchange_rate: null, total_value: 0, ...over,
});
const cost = (over: Partial<PoCost>): PoCost =>
  ({ po_id: 'P1', cost_category: 'down_payment', amount: 0, currency: 'IDR', exchange_rate: null, ...over });

test('measureLead averages per supplier, falls back to global then 30d', () => {
  const received: ReceivedPo[] = [
    { supplier_id: 'S1', po_date: '2026-01-01', actual_received_date: '2026-01-11' }, // 10d
    { supplier_id: 'S1', po_date: '2026-02-01', actual_received_date: '2026-02-21' }, // 20d
    { supplier_id: 'S2', po_date: '2026-03-01', actual_received_date: '2026-04-30' }, // 60d
  ];
  const lead = measureLead(received);
  assert.equal(lead.bySupplier.get('S1'), 15);          // (10 + 20) / 2
  assert.equal(lead.bySupplier.get('S2'), 60);
  assert.equal(lead.global, 30);                        // (10 + 20 + 60) / 3
  assert.equal(measureLead([]).global, FALLBACK_LEAD_DAYS);
  // A supplier with no history is absent — the caller uses the global average
  assert.equal(lead.bySupplier.has('S9'), false);
});

test('measureLead ignores received-before-ordered bad data', () => {
  const lead = measureLead([{ supplier_id: 'S1', po_date: '2026-02-01', actual_received_date: '2026-01-01' }]);
  assert.equal(lead.bySupplier.has('S1'), false);
  assert.equal(lead.global, FALLBACK_LEAD_DAYS);
});

test('expectedArrival prefers a stamped ETA over the lead estimate', () => {
  const lead = measureLead([{ supplier_id: 'S1', po_date: '2026-01-01', actual_received_date: '2026-01-15' }]); // 14d
  const withEta = expectedArrival({ estimated_delivery_date: '2026-09-01', po_date: '2026-08-01', supplier_id: 'S1' }, lead);
  assert.deepEqual(withEta, { expected: '2026-09-01', source: 'eta', leadDays: null });

  const byLead = expectedArrival({ estimated_delivery_date: null, po_date: '2026-08-01', supplier_id: 'S1' }, lead);
  assert.equal(byLead.source, 'lead');
  assert.equal(byLead.leadDays, 14);
  assert.equal(byLead.expected, '2026-08-15');          // 1 Aug + 14d

  const noDates = expectedArrival({ estimated_delivery_date: null, po_date: null, supplier_id: 'S1' }, lead);
  assert.deepEqual(noDates, { expected: null, source: null, leadDays: null });
});

test('expectedArrival uses global lead when the supplier has no history', () => {
  const lead = measureLead([{ supplier_id: 'S2', po_date: '2026-01-01', actual_received_date: '2026-01-21' }]); // 20d, S2
  const e = expectedArrival({ estimated_delivery_date: null, po_date: '2026-08-01', supplier_id: 'S1' }, lead);
  assert.equal(e.leadDays, 20);                         // no S1 history → global 20
  assert.equal(e.expected, '2026-08-21');
});

test('computeInTransit sums paid capital and flags the overdue slice', () => {
  const pos: OpenPo[] = [
    // ETA in the past → overdue; USD, paid a deposit
    po({ po_id: 'A', status: 'Confirmed', currency: 'USD', exchange_rate: 16000, total_value: 1000, estimated_delivery_date: '2026-08-01' }),
    // ETA in the future → on the way, not late
    po({ po_id: 'B', status: 'Sent', currency: 'IDR', total_value: 5_000_000, estimated_delivery_date: '2026-12-01' }),
    // Draft is not on the water at all
    po({ po_id: 'C', status: 'Draft', total_value: 9_000_000 }),
  ];
  const costs: PoCost[] = [
    cost({ po_id: 'A', cost_category: 'down_payment', amount: 500, currency: 'USD', exchange_rate: 16000 }), // 8,000,000 IDR
    cost({ po_id: 'A', cost_category: 'admin_bank_fee', amount: 100, currency: 'USD', exchange_rate: 16000 }), // not principal — ignored
  ];
  const s = computeInTransit(pos, costs, [], NOW);
  assert.equal(s.count, 2);                              // A and B; Draft C excluded
  assert.equal(s.paidIdr, 8_000_000);                   // only the down payment, only on A
  assert.equal(s.valueIdr, 16_000_000 + 5_000_000);
  assert.equal(s.overdueCount, 1);
  assert.equal(s.overduePaidIdr, 8_000_000);
  assert.equal(s.overdueValueIdr, 16_000_000);
  assert.equal(s.maxDaysLate, 12);                       // 1 Aug → 13 Aug
  assert.equal(s.pos[0].po_id, 'A');                     // overdue sorts first
});

test('computeInTransit sets aside a PO whose rate was never recorded', () => {
  const pos: OpenPo[] = [
    po({ po_id: 'A', currency: 'USD', exchange_rate: null, total_value: 1000, estimated_delivery_date: '2026-12-01' }),
  ];
  const s = computeInTransit(pos, [], [], NOW);
  assert.equal(s.count, 1);
  assert.equal(s.excludedNoRate, 1);
  assert.equal(s.valueIdr, 0);                           // cannot be valued, never taken at face value
  assert.equal(s.pos[0].noRate, true);
});

test('itemArrivals keeps the earliest date and goes overdue if any PO is late', () => {
  const pos: OpenPo[] = [
    po({ po_id: 'P1', status: 'Confirmed', estimated_delivery_date: '2026-09-10' }),  // future
    po({ po_id: 'P2', status: 'Confirmed', estimated_delivery_date: '2026-08-05' }),  // overdue (before NOW)
    po({ po_id: 'P3', status: 'Draft', estimated_delivery_date: '2026-08-01' }),      // not open — ignored
  ];
  const lines = [
    { po_id: 'P1', component_id: 'X' },
    { po_id: 'P2', component_id: 'X' },
    { po_id: 'P3', component_id: 'X' },
    { po_id: 'P1', component_id: 'Y' },
  ];
  const m = itemArrivals(lines, pos, [], NOW);
  const x = m.get('X')!;
  assert.equal(x.nearest, '2026-08-05');                 // earliest of P1/P2
  assert.equal(x.overdue, true);                         // P2 is late
  const y = m.get('Y')!;
  assert.equal(y.nearest, '2026-09-10');
  assert.equal(y.overdue, false);
});
