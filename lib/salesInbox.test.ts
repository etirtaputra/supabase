/**
 * salesInbox — the four counts of Sales Orders' "Needs action". Cases follow
 * the real orders of 23 Oct 2026.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { waitingQuotes, undeliveredOrders, deliveredNotInvoiced, unpaidInvoices } from './salesInbox.ts';

const TODAY = '2026-10-23';

test('a quote waits once it has sat a week, or the day it expires', () => {
  const out = waitingQuotes([
    { quote_id: 'old', status: 'validated', grand_total: 10545000, quote_date: '2026-08-01' },
    { quote_id: 'expired', status: 'sent', grand_total: 1, sent_at: '2026-10-20T03:00:00Z', valid_until: '2026-10-22' },
    { quote_id: 'fresh', status: 'sent', grand_total: 1, quote_date: '2026-10-01', sent_at: '2026-10-20T03:00:00Z' },
    { quote_id: 'order', status: 'ordered', grand_total: 1, quote_date: '2026-08-01' },
    { quote_id: 'draft', status: 'draft', grand_total: 1, quote_date: '2026-08-01' },
  ], TODAY);
  assert.deepEqual(out.map((q) => [q.quoteId, q.days, q.expired]), [['old', 83, false], ['expired', 3, true]]);
});

test('an accepted quote counts from the acceptance, not the first offer', () => {
  const [q] = waitingQuotes([{ quote_id: 'a', status: 'accepted', grand_total: 1, quote_date: '2026-09-01', sent_at: '2026-09-02', accepted_at: '2026-10-10' }], TODAY);
  assert.equal(q.since, '2026-10-10');
  assert.equal(q.days, 13);
});

test('confirmed orders not out yet; a delivered DO marks it partly out', () => {
  const out = undeliveredOrders([
    { quote_id: 'so13', status: 'ordered', grand_total: 23896080, ordered_at: '2026-09-06T02:00:00Z' },
    { quote_id: 'prep', status: 'preparing', grand_total: 1, ordered_at: '2026-10-20', delivery_date: '2026-10-21' },
    { quote_id: 'done', status: 'delivered', grand_total: 1, ordered_at: '2026-08-01' },
  ], [{ quote_id: 'prep', status: 'delivered' }], TODAY);
  assert.deepEqual(out.map((o) => [o.quoteId, o.days, o.partly, o.lateSince]), [['so13', 47, false, null], ['prep', 3, true, '2026-10-21']]);
});

test('delivered and not billed: SO2609-4851 had no invoice; SO-0002 was billed half', () => {
  const out = deliveredNotInvoiced(
    [
      { quote_id: '4851', status: 'delivered', grand_total: 999000 },
      { quote_id: '0002', status: 'delivered', grand_total: 4363546.53 },
      { quote_id: '0001', status: 'delivered', grand_total: 2227703.4 },
      { quote_id: 'open', status: 'ordered', grand_total: 500000 },
    ],
    [],
    [
      { invoice_id: 'i1', quote_id: '0002', invoice_number: 'INV-1', grand_total: 2181773.265 },
      { invoice_id: 'i2', quote_id: '0001', invoice_number: 'INV-2', grand_total: 2227703.4 },
    ],
  );
  assert.deepEqual(out.map((u) => [u.quoteId, Math.round(u.remaining)]), [['0002', 2181773], ['4851', 999000]]);
});

test('an order still being prepared but with a DO already delivered counts too', () => {
  const out = deliveredNotInvoiced([{ quote_id: 'p', status: 'preparing', grand_total: 100 }], [{ quote_id: 'p', status: 'delivered' }], []);
  assert.equal(out.length, 1);
});

test('unpaid invoices: a rupiah short of rounding is paid; order-level receipts pay the oldest first', () => {
  const quotes = [{ quote_id: 'q', status: 'delivered', grand_total: 300 }, { quote_id: 'x', status: 'cancelled', grand_total: 50 }];
  const invoices = [
    { invoice_id: 'dp', quote_id: 'q', invoice_number: 'INV-DP', grand_total: 100.265, issued_at: '2026-09-01', due_date: '2026-09-08' },
    { invoice_id: 'bal', quote_id: 'q', invoice_number: 'INV-BAL', grand_total: 200, issued_at: '2026-10-01', due_date: '2026-10-15' },
    { invoice_id: 'dead', quote_id: 'x', invoice_number: 'INV-X', grand_total: 50, issued_at: '2026-10-01' },
  ];
  const out = unpaidInvoices(quotes, invoices, [
    { quote_id: 'q', invoice_id: 'dp', amount: 100 },
    { quote_id: 'q', invoice_id: null, amount: 50 },
  ], TODAY);
  assert.deepEqual(out.map((i) => [i.number, i.remaining, i.overdueDays]), [['INV-BAL', 150, 8]]);
});

test('no due date: listed, never called overdue', () => {
  const [i] = unpaidInvoices([], [{ invoice_id: 'a', quote_id: 'q', invoice_number: 'A', grand_total: 10 }], [], TODAY);
  assert.equal(i.overdueDays, null);
});
