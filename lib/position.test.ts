/**
 * Position-strip tests — each tile must reproduce its owning screen's rule:
 * cash converts at the recorded rate, AR follows invoice-tagged receipts,
 * AP excludes what cannot be valued, CCC weights by value and lets a negative
 * DPO (prepaid imports) LENGTHEN the cycle, and month-in-motion compares
 * equal day-spans. Hand-built rows throughout.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  computeCashPosition, computeAr, computeAp, computeCcc, computeMonthMotion, motionWindows,
  type AccountRow, type ReceiptRow, type CostRow, type TxnRow, type InvoiceRow, type PoRow,
} from './position.ts';

const acct = (over: Partial<AccountRow>): AccountRow =>
  ({ bank_account_id: 'A', currency: 'IDR', opening_balance: 0, is_active: true, ...over });
const rcpt = (over: Partial<ReceiptRow>): ReceiptRow =>
  ({ invoice_id: null, amount: 0, payment_date: null, bank_account_id: null, ...over });
const cost = (over: Partial<CostRow>): CostRow =>
  ({ po_id: 'P1', cost_category: 'balance_payment', amount: 0, currency: 'IDR', exchange_rate: null, payment_date: '2026-08-01', bank_account_id: null, ...over });
const inv = (over: Partial<InvoiceRow>): InvoiceRow =>
  ({ invoice_id: 'I1', grand_total: 0, issued_at: '2026-08-01', ...over });
const po = (over: Partial<PoRow>): PoRow =>
  ({ po_id: 'P1', status: 'Confirmed', total_value: 0, currency: 'IDR', exchange_rate: null, actual_received_date: null, ...over });

// ── Cash ─────────────────────────────────────────────────────────────────────

test('cash: opening + receipts − payments ± manual entries, per account', () => {
  const r = computeCashPosition(
    [acct({ opening_balance: 1_000_000 })],
    [rcpt({ bank_account_id: 'A', amount: 500_000 })],
    [cost({ bank_account_id: 'A', amount: 200_000 })],
    [{ bank_account_id: 'A', direction: 'out', amount: 100_000 } as TxnRow],
  );
  assert.equal(r.byCurrency.length, 1);
  assert.equal(r.byCurrency[0].currency, 'IDR');
  assert.equal(r.byCurrency[0].total, 1_200_000);
});

test('cash: a USD payment out of an IDR account converts at the recorded rate', () => {
  const r = computeCashPosition(
    [acct({ opening_balance: 200_000_000 })],
    [],
    [cost({ bank_account_id: 'A', amount: 1_000, currency: 'USD', exchange_rate: 16_000 })],
    [],
  );
  assert.equal(r.byCurrency[0].total, 200_000_000 - 16_000_000);
});

test('cash: inactive accounts and untagged movements are ignored; currencies stay separate, IDR first', () => {
  const r = computeCashPosition(
    [acct({ opening_balance: 5 }), acct({ bank_account_id: 'B', currency: 'USD', opening_balance: 100 }),
     acct({ bank_account_id: 'C', opening_balance: 999, is_active: false })],
    [rcpt({ bank_account_id: null, amount: 777 })],   // untagged — /banks doesn't count it either
    [cost({ bank_account_id: 'A', amount: 10, payment_date: null })],   // unpaid cost row: not cash out
    [],
  );
  assert.equal(r.accounts, 2);
  assert.deepEqual(r.byCurrency.map((x) => x.currency), ['IDR', 'USD']);
  assert.equal(r.byCurrency[0].total, 5);
  assert.equal(r.byCurrency[1].total, 100);
});

// ── AR ───────────────────────────────────────────────────────────────────────

test('AR: outstanding = invoice totals minus invoice-tagged receipts; settled invoices drop out', () => {
  const r = computeAr(
    [inv({ invoice_id: 'I1', grand_total: 10_000_000 }), inv({ invoice_id: 'I2', grand_total: 4_000_000 })],
    [rcpt({ invoice_id: 'I1', amount: 6_000_000 }), rcpt({ invoice_id: 'I2', amount: 4_000_000 })],
    '2026-07-01',
  );
  assert.equal(r.outstanding, 4_000_000);
  assert.equal(r.openCount, 1);
});

test('AR: only invoices issued on/before the cutoff count as overdue', () => {
  const r = computeAr(
    [inv({ invoice_id: 'I1', grand_total: 1_000, issued_at: '2026-06-01' }),
     inv({ invoice_id: 'I2', grand_total: 2_000, issued_at: '2026-08-05' })],
    [],
    '2026-07-10',
  );
  assert.equal(r.outstanding, 3_000);
  assert.equal(r.overdue, 1_000);
  assert.equal(r.overdueCount, 1);
});

// ── AP ───────────────────────────────────────────────────────────────────────

test('AP: active POs minus principal payments, IDR at the recorded rates', () => {
  const r = computeAp(
    [po({ po_id: 'P1', total_value: 10_000, currency: 'USD', exchange_rate: 16_000, status: 'Fully Received' }),
     po({ po_id: 'P2', total_value: 50_000_000, status: 'Confirmed' })],
    [cost({ po_id: 'P1', amount: 4_000, currency: 'USD', exchange_rate: 16_000 })],
  );
  assert.equal(r.outstanding, 6_000 * 16_000 + 50_000_000);
  assert.equal(r.openCount, 2);
  assert.equal(r.receivedOwed, 6_000 * 16_000);
  assert.equal(r.receivedCount, 1);
});

test('AP: cancelled/draft/replaced POs, rounding dust, and unrated POs are excluded (unrated counted)', () => {
  const r = computeAp(
    [po({ po_id: 'P1', total_value: 9_999_999, status: 'Cancelled' }),
     po({ po_id: 'P2', total_value: 1_000_000, status: 'Draft' }),
     po({ po_id: 'P3', total_value: 5_000, currency: 'USD', exchange_rate: null }),   // no rate — cannot be valued
     po({ po_id: 'P4', total_value: 2_000_000 })],
    [cost({ po_id: 'P4', amount: 1_999_500 })],   // Rp 500 left — dust
  );
  assert.equal(r.outstanding, 0);
  assert.equal(r.openCount, 0);
  assert.equal(r.excludedNoRate, 1);
});

test('AP: non-principal costs (freight, duty) never count as principal payment', () => {
  const r = computeAp(
    [po({ po_id: 'P1', total_value: 1_000_000 })],
    [cost({ po_id: 'P1', amount: 1_000_000, cost_category: 'freight' })],
  );
  assert.equal(r.outstanding, 1_000_000);
});

// ── CCC ──────────────────────────────────────────────────────────────────────

const cccBase = () => ({
  balances: [{ qty_on_hand: 10, avg_cost_idr: 900_000 }],   // Rp 9M stock
  deliveryOuts: [{ quantity: 30, unit_cost_idr: 300_000, moved_at: '2026-08-01' }],   // Rp 9M COGS over the window
  invoices: [] as InvoiceRow[],
  receipts: [] as ReceiptRow[],
  poPayments: [] as { po_id: string; amount_idr: number; payment_date: string }[],
  poReceived: new Map<string, string>(),
  windowDays: 90,
  nowIso: '2026-08-09T00:00:00Z',
});

test('CCC: DIO = stock value ÷ daily COGS; missing DSO/DPO contribute zero', () => {
  const r = computeCcc(cccBase());
  assert.equal(r.dio, 90);   // 9M ÷ (9M/90)
  assert.equal(r.dso, null);
  assert.equal(r.dpo, null);
  assert.equal(r.ccc, 90);
});

test('CCC: DSO is value-weighted over PAID invoices issued in the window', () => {
  const i = cccBase();
  i.invoices = [
    inv({ invoice_id: 'I1', grand_total: 1_000_000, issued_at: '2026-07-01' }),   // paid in 10 days
    inv({ invoice_id: 'I2', grand_total: 3_000_000, issued_at: '2026-07-01' }),   // paid in 30 days
    inv({ invoice_id: 'I3', grand_total: 99_000_000, issued_at: '2026-07-01' }),  // unpaid — excluded
  ];
  i.receipts = [
    rcpt({ invoice_id: 'I1', amount: 1_000_000, payment_date: '2026-07-11' }),
    rcpt({ invoice_id: 'I2', amount: 3_000_000, payment_date: '2026-07-31' }),
  ];
  const r = computeCcc(i);
  assert.equal(r.dso, (1_000_000 * 10 + 3_000_000 * 30) / 4_000_000);   // 25d
  assert.equal(Math.round(r.ccc!), 90 + 25);
});

test('CCC: a prepaid import gives NEGATIVE DPO, which lengthens the cycle', () => {
  const i = cccBase();
  i.poPayments = [{ po_id: 'P1', amount_idr: 8_000_000, payment_date: '2026-07-01' }];
  i.poReceived = new Map([['P1', '2026-07-21']]);   // paid 20 days BEFORE arrival
  const r = computeCcc(i);
  assert.equal(r.dpo, -20);
  assert.equal(r.ccc, 90 - (-20));   // 110 — prepaying makes the runway longer
});

test('CCC: no COGS in the window means no DIO and no CCC (never a fake zero)', () => {
  const i = cccBase();
  i.deliveryOuts = [];
  const r = computeCcc(i);
  assert.equal(r.dio, null);
  assert.equal(r.ccc, null);
});

// ── Month in motion ──────────────────────────────────────────────────────────

test('motion windows: Aug 9 compares against Jul 1–9, not the whole of July', () => {
  const w = motionWindows('2026-08-09T10:00:00Z');
  assert.equal(w.thisFrom, '2026-08-01');
  assert.equal(w.thisTo, '2026-08-09');
  assert.equal(w.prevFrom, '2026-07-01');
  assert.equal(w.prevTo, '2026-07-09');
});

test('motion windows: a longer day-of-month caps at the previous month’s end', () => {
  const w = motionWindows('2026-03-30T00:00:00Z');
  assert.equal(w.prevTo, '2026-02-28');
});

test('motion: sums land in the right span and the delta is signed', () => {
  const rows = computeMonthMotion(
    '2026-08-09T00:00:00Z',
    [inv({ grand_total: 2_000_000, issued_at: '2026-08-03' }),
     inv({ invoice_id: 'I2', grand_total: 1_000_000, issued_at: '2026-07-05' }),
     inv({ invoice_id: 'I3', grand_total: 9_000_000, issued_at: '2026-07-20' })],   // outside last month's 1–9 span
    null, null,
  );
  assert.equal(rows.length, 1);
  assert.equal(rows[0].now, 2_000_000);
  assert.equal(rows[0].prev, 1_000_000);
  assert.equal(rows[0].deltaPct, 100);
});

test('motion: zero base yields a null delta, and null inputs render no row at all', () => {
  const rows = computeMonthMotion('2026-08-09T00:00:00Z',
    [inv({ grand_total: 5, issued_at: '2026-08-02' })],
    [rcpt({ amount: 10, payment_date: '2026-08-02' })],
    null);
  assert.equal(rows.length, 2);
  assert.equal(rows[0].deltaPct, null);
});
