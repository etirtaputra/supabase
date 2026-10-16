/**
 * Supplier lead times. The first PO is shaped on a real one (PIO-010-ISL-05-2026:
 * quote and PO 2026-05-13, "45 working days", received 2026-08-21 on the PO
 * while its goods receipt was keyed on 2026-08-28); payment dates are test inputs.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { poTimeline, supplierLeadTimes, stageStats, statedLead, type LtPo, type LtCost } from './supplierLeadTimes.ts';

const TODAY = '2026-10-16';
const po = (over: Partial<LtPo> = {}): LtPo => ({ po_id: 'p1', po_number: 'PIO-010', status: 'Fully Received', po_date: '2026-05-13', quote_id: 'q1', supplier_id: 's1', actual_received_date: '2026-08-21', currency: 'USD', ...over });
const pay = (po_id: string, date: string, cat = 'down_payment'): LtCost => ({ po_id, cost_category: cat, payment_date: date });

test('One PO: quote → PO → first payment → received, and the promise held to the stated lead time', () => {
  const t = poTimeline(po(), { quote_id: 'q1', quote_date: '2026-05-13', estimated_lead_time_days: '45 working days' },
    [pay('p1', '2026-05-20'), pay('p1', '2026-08-10', 'balance_payment'), { po_id: 'p1', cost_category: 'local_import_duty', payment_date: '2026-08-15' }],
    [{ po_id: 'p1', received_at: '2026-08-28T03:00:00Z' }], TODAY);
  assert.equal(t.received, '2026-08-21', 'the PO\'s own received date beats a receipt keyed a week later');
  assert.equal(t.receivedFrom, 'po');
  assert.deepEqual(t.stages, { quoteToPo: 0, poToPay: 7, payToPaid: 82, payToReceived: 93, poToReceived: 100, quoteToReceived: 100 });
  assert.equal(t.lastPay, '2026-08-10', 'import duty is not a payment to the supplier');
  assert.equal(t.promised, '2026-07-22', '45 working days from the deposit');
  assert.equal(t.lateDays, 30);
  assert.equal(t.open, false);
});

test('A goods receipt counts as "fully in" only once the PO says Fully Received', () => {
  const grn = [{ po_id: 'p1', received_at: '2026-09-01' }, { po_id: 'p1', received_at: '2026-09-04' }];
  const done = poTimeline(po({ actual_received_date: null }), null, [], grn, TODAY);
  assert.equal(done.received, '2026-09-04');
  assert.equal(done.receivedFrom, 'grn');
  const partial = poTimeline(po({ actual_received_date: null, status: 'Partially Received' }), null, [], grn, TODAY);
  assert.equal(partial.received, null);
  assert.equal(partial.open, true);
  assert.equal(partial.waitingDays, 156);
});

test('Dates that run backwards are shown, counted as odd, and kept out of the statistics', () => {
  // A quote dated after its PO, and a payment made before the PO was raised.
  const t = poTimeline(po({ po_date: '2026-03-01' }), { quote_id: 'q1', quote_date: '2026-03-19' }, [pay('p1', '2026-02-14')], [], TODAY);
  assert.deepEqual(t.odd.sort(), ['poToPay', 'quoteToPo']);
  assert.equal(t.stages.quoteToReceived, 155, 'the end-to-end span still holds');
  assert.equal(t.stages.quoteToPo, null);
  assert.equal(t.stages.poToReceived, 173);
});

test('The headline is the median: one stuck container does not move it a month', () => {
  const s = stageStats([40, 120, 44, 46, 42])!;
  assert.equal(s.median, 44);
  assert.equal(s.avg, 58.4);
  assert.deepEqual([s.min, s.max, s.n], [40, 120, 5]);
  assert.equal(stageStats([10, 20])!.median, 15);
  assert.equal(stageStats([]), null);
});

test('A range promise is held to its longer end', () => {
  assert.deepEqual(statedLead('50-60 days after deposit'), { days: 60, working: false });
  assert.deepEqual(statedLead('45 working days'), { days: 45, working: true });
  assert.equal(statedLead(null), null);
});

test('Per supplier: received POs measured, open POs overdue against the promise or the supplier\'s own median', () => {
  const pos: LtPo[] = [
    po({ po_id: 'a', po_date: '2026-01-01', actual_received_date: '2026-02-10' }),    // 40 days
    po({ po_id: 'b', po_date: '2026-02-01', actual_received_date: '2026-03-15' }),    // 42
    po({ po_id: 'c', po_date: '2026-03-01', actual_received_date: '2026-04-14' }),    // 44
    po({ po_id: 'd', status: 'Confirmed', po_date: '2026-08-01', actual_received_date: null }),  // 76 days waiting > 42 → overdue
    po({ po_id: 'e', status: 'Confirmed', po_date: '2026-10-01', actual_received_date: null }),  // 15 days → fine
    po({ po_id: 'f', status: 'Draft', po_date: '2026-10-10', actual_received_date: null }),      // not an order
    po({ po_id: 'g', supplier_id: null, quote_id: 'qz', po_date: '2026-04-01', actual_received_date: '2026-04-03' }), // supplier via its quote
    po({ po_id: 'h', po_date: '2026-04-05', actual_received_date: null }),            // "Fully Received", no date anywhere
  ];
  const res = supplierLeadTimes({ pos, quotes: [{ quote_id: 'qz', quote_date: '2026-03-30', supplier_id: 's2' }], costs: [], grns: [], today: TODAY });
  const s1 = res.find((s) => s.supplierId === 's1')!;
  assert.equal(s1.completed, 3);
  assert.equal(s1.open, 2);
  assert.equal(s1.stages.poToReceived?.median, 42);
  assert.equal(s1.overdue, 1);
  assert.equal(s1.pos.length, 6, 'the draft is left out');
  assert.equal(s1.noDate, 1, 'received with no date is counted, not measured');
  assert.equal(res[0].supplierId, 's1', 'most POs first');
  assert.equal(res.find((s) => s.supplierId === 's2')?.stages.quoteToReceived?.median, 4);
});

test('The bar: the typical end-to-end time, split by where the days actually go', () => {
  // Two POs paid on the PO date, two paid 60 days after: stage medians would add to 30 + 40, not the real ~100.
  const mk = (id: string, poDate: string, payDate: string, recv: string): LtPo => po({ po_id: id, po_date: poDate, actual_received_date: recv, quote_id: null });
  const pos = [mk('a', '2026-01-01', '2026-01-01', '2026-04-11'), mk('b', '2026-02-01', '2026-02-01', '2026-05-12'),
    mk('c', '2026-03-01', '2026-04-30', '2026-06-09'), mk('d', '2026-04-01', '2026-05-31', '2026-07-10')];
  const costs = [pay('a', '2026-01-01'), pay('b', '2026-02-01'), pay('c', '2026-04-30'), pay('d', '2026-05-31')];
  const [s] = supplierLeadTimes({ pos, quotes: [], costs, grns: [], today: TODAY });
  assert.equal(s.split?.total, 100, 'median PO → received of 100, 100, 100, 100');
  assert.equal(s.split?.basis, 4);
  assert.equal(s.split!.shares!.poToPay, 0.3, '120 of the 400 days are waiting to pay');
  assert.equal(s.split!.shares!.payToReceived, 0.7);
  const [noPay] = supplierLeadTimes({ pos, quotes: [], costs: [], grns: [], today: TODAY });
  assert.equal(noPay.split?.total, 100, 'with no payment recorded the total still stands');
  assert.equal(noPay.split?.shares, null);
});
