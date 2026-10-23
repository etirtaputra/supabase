/**
 * purchasingInbox — the late and the unpaid halves of Deal Lookup's "Needs action".
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { latePos, unpaidReceived } from './purchasingInbox.ts';
import type { SupplierLead, PoTimeline } from './supplierLeadTimes.ts';

const tl = (over: Partial<PoTimeline>): PoTimeline => ({
  poId: '1', poNumber: 'PO-1', supplierId: 's', status: 'Confirmed', currency: 'USD', via: 'Sea',
  quoteDate: null, poDate: '2026-07-01', firstPay: null, lastPay: null, received: null, receivedFrom: null,
  stages: {} as PoTimeline['stages'], odd: [], statedText: null, promised: null, lateDays: null, open: true, waitingDays: null, ...over,
});
const lead = (pos: PoTimeline[], overall: number | null, byVia: { via: 'Sea' | 'Air'; median: number }[] = []) => ({
  supplierId: 's', pos,
  stages: { poToReceived: overall == null ? null : { n: 3, median: overall, avg: overall, min: overall, max: overall } },
  byVia: byVia.map((v) => ({ via: v.via, completed: 3, open: 0, poToReceived: { n: 3, median: v.median, avg: v.median, min: v.median, max: v.median } })),
}) as unknown as SupplierLead;

test('late = past PO date + the usual time, by the same way of shipping', () => {
  const l = lead([tl({ poId: 'a', poNumber: 'PIO-013', poDate: '2026-07-01', via: 'Sea' })], 40, [{ via: 'Sea', median: 70 }]);
  // Sea usual 70 d → due 9 Sep; on 22 Oct it is 43 days late (the 40-day overall median is not used).
  const [x] = latePos([l], '2026-10-22');
  assert.equal(x.due, '2026-09-09');
  assert.equal(x.lateDays, 43);
  assert.equal(x.basis, 'usual');
});

test('a promised date wins over the usual time; not yet due is not late', () => {
  const l = lead([
    tl({ poId: 'p', poNumber: 'P', promised: '2026-10-01' }),
    tl({ poId: 'q', poNumber: 'Q', poDate: '2026-10-01' }),
  ], 70);
  const out = latePos([l], '2026-10-22');
  assert.deepEqual(out.map((o) => [o.poNumber, o.basis, o.lateDays]), [['P', 'promised', 21]]);
});

test('no promise and no history: no verdict; received POs are never late', () => {
  assert.deepEqual(latePos([lead([tl({})], null)], '2026-10-22'), []);
  assert.deepEqual(latePos([lead([tl({ open: false, received: '2026-08-01' })], 10)], '2026-10-22'), []);
});

test('goods in with money still owed is listed; paid, open or draft POs are not', () => {
  const pos = [
    { po_id: 1, po_number: 'IN-UNPAID', status: 'Fully Received', currency: 'IDR', total_value: 1000000 },
    { po_id: 2, po_number: 'IN-PAID', status: 'Fully Received', currency: 'IDR', total_value: 500000 },
    { po_id: 3, po_number: 'OPEN', status: 'Confirmed', currency: 'IDR', total_value: 900000 },
    { po_id: 4, po_number: 'DRAFT', status: 'Draft', currency: 'IDR', total_value: 900000 },
  ];
  const costs = [
    { po_id: 1, cost_category: 'down_payment', currency: 'IDR', amount: 300000 },
    { po_id: 2, cost_category: 'down_payment', currency: 'IDR', amount: 200000 },
    { po_id: 2, cost_category: 'balance_payment', currency: 'IDR', amount: 300000 },
  ];
  const out = unpaidReceived(pos, costs);
  assert.deepEqual(out.map((o) => [o.poNumber, o.remaining]), [['IN-UNPAID', 700000]]);
});
