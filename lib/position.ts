/**
 * Dashboard slice 2 — the company POSITION, read at a glance before the queue:
 *   Cash (what the banks hold) · Owed to us (AR) · We owe (AP) · CCC (the runway)
 * plus "month in motion": this month-to-date against the SAME day-span of last
 * month, so the comparison is fair on the 9th and on the 30th alike.
 *
 * Nothing here is a new source of truth — every figure re-derives by the rule
 * of the screen that owns it:
 *   • Cash     = /banks:      opening balance + Σ in − Σ out per account
 *   • Owed us  = /invoices:   Σ invoice grand totals − receipts tagged to them
 *   • We owe   = the queue's unpaid-PO rule (principal categories, IDR at the
 *                recorded rate; a PO with no recorded rate is EXCLUDED and
 *                counted, never taken at face value)
 *   • CCC      = /profitability: DIO + DSO − DPO, delivery-out COGS basis
 * Pure computations are exported for tests; fetch wrappers gate per capability
 * and each tile fails alone (the action-queue pattern).
 */
import type { SupabaseClient } from '@supabase/supabase-js';
// Relative imports keep this lib runnable under `node --test` (no @/ alias there)
import type { RolePermissions } from '../constants/roles';
import { PRINCIPAL_CATS } from '../constants/costCategories.ts';
import { computeInTransit, type InTransitSummary, type OpenPo, type ReceivedPo, type PoCost } from './inTransit.ts';

// ── Row shapes (only the columns the math reads) ─────────────────────────────
export interface AccountRow { bank_account_id: string; currency: string; opening_balance: number; is_active: boolean }
export interface ReceiptRow { invoice_id: string | null; amount: number; payment_date: string | null; bank_account_id: string | null }
export interface CostRow { po_id: string; cost_category: string; amount: number; currency: string; exchange_rate: number | null; payment_date: string | null; bank_account_id: string | null }
export interface TxnRow { bank_account_id: string; direction: 'in' | 'out'; amount: number }
export interface InvoiceRow { invoice_id: string; grand_total: number; issued_at: string | null }
export interface PoRow { po_id: string; status: string | null; total_value: number; currency: string; exchange_rate: number | null; actual_received_date: string | null }
export interface BalanceRow { qty_on_hand: number; avg_cost_idr: number }
export interface MoveRow { quantity: number; unit_cost_idr: number | null; moved_at: string | null }

const days = (aIso: string, bIso: string): number =>
  Math.round((new Date(`${aIso.slice(0, 10)}T00:00:00`).getTime() - new Date(`${bIso.slice(0, 10)}T00:00:00`).getTime()) / 86400000);

// ── Cash ─────────────────────────────────────────────────────────────────────
export interface CashPosition {
  accounts: number;
  /** One entry per account currency; IDR first. Balance = opening + in − out. */
  byCurrency: { currency: string; total: number }[];
}

/**
 * Same math as /banks per account, run in bulk: receipts and manual entries
 * are in the account's own currency; a foreign-currency PO payment converts at
 * the rate recorded on the payment (no rate → face value, as the statement does).
 */
export function computeCashPosition(
  accounts: AccountRow[], receipts: ReceiptRow[], costs: CostRow[], txns: TxnRow[],
): CashPosition {
  const active = accounts.filter((a) => a.is_active !== false);
  const bal = new Map<string, number>(active.map((a) => [a.bank_account_id, Number(a.opening_balance) || 0]));
  const ccy = new Map<string, string>(active.map((a) => [a.bank_account_id, a.currency || 'IDR']));

  for (const r of receipts) {
    if (!r.bank_account_id || !bal.has(r.bank_account_id)) continue;
    bal.set(r.bank_account_id, bal.get(r.bank_account_id)! + (Number(r.amount) || 0));
  }
  for (const c of costs) {
    if (!c.bank_account_id || !bal.has(c.bank_account_id) || !c.payment_date) continue;
    const accountCcy = ccy.get(c.bank_account_id)!;
    const amt = Number(c.amount) || 0;
    const rate = Number(c.exchange_rate) || 0;
    const out = !c.currency || c.currency === accountCcy ? amt : rate > 0 ? amt * rate : amt;
    bal.set(c.bank_account_id, bal.get(c.bank_account_id)! - out);
  }
  for (const t of txns) {
    if (!bal.has(t.bank_account_id)) continue;
    const sign = t.direction === 'out' ? -1 : 1;
    bal.set(t.bank_account_id, bal.get(t.bank_account_id)! + sign * (Number(t.amount) || 0));
  }

  const byCcy = new Map<string, number>();
  for (const [id, v] of bal) {
    const c = ccy.get(id)!;
    byCcy.set(c, (byCcy.get(c) ?? 0) + v);
  }
  const byCurrency = [...byCcy.entries()].map(([currency, total]) => ({ currency, total }))
    .sort((a, b) => (a.currency === 'IDR' ? -1 : b.currency === 'IDR' ? 1 : a.currency.localeCompare(b.currency)));
  return { accounts: active.length, byCurrency };
}

// ── Owed to us (AR) ──────────────────────────────────────────────────────────
export interface ArPosition { outstanding: number; openCount: number; overdue: number; overdueCount: number }

/** Σ per-invoice outstanding (receipts tagged by invoice_id — the /invoices rule). */
export function computeAr(invoices: InvoiceRow[], receipts: ReceiptRow[], overdueCutoffIso: string): ArPosition {
  const paid = new Map<string, number>();
  for (const r of receipts) {
    if (r.invoice_id) paid.set(r.invoice_id, (paid.get(r.invoice_id) ?? 0) + (Number(r.amount) || 0));
  }
  let outstanding = 0, openCount = 0, overdue = 0, overdueCount = 0;
  for (const inv of invoices) {
    const out = (Number(inv.grand_total) || 0) - (paid.get(inv.invoice_id) ?? 0);
    if (out <= 0.5) continue;
    outstanding += out; openCount += 1;
    if (inv.issued_at && inv.issued_at.slice(0, 10) <= overdueCutoffIso) { overdue += out; overdueCount += 1; }
  }
  return { outstanding, openCount, overdue, overdueCount };
}

// ── We owe (AP) ──────────────────────────────────────────────────────────────
export interface ApPosition {
  outstanding: number; openCount: number;
  /** The urgent slice: goods already in the warehouse, supplier waiting. */
  receivedOwed: number; receivedCount: number;
  /** POs skipped because no exchange rate was ever recorded (cannot be valued). */
  excludedNoRate: number;
}

/** The queue's unpaid-PO rule across ALL active POs (not just received ones). */
export function computeAp(pos: PoRow[], costs: CostRow[]): ApPosition {
  const paid = new Map<string, number>();
  for (const c of costs) {
    if (!PRINCIPAL_CATS.has(c.cost_category)) continue;
    const idr = c.currency === 'IDR' ? Number(c.amount) : Number(c.amount) * (Number(c.exchange_rate) || 0);
    paid.set(String(c.po_id), (paid.get(String(c.po_id)) ?? 0) + (idr || 0));
  }
  const r: ApPosition = { outstanding: 0, openCount: 0, receivedOwed: 0, receivedCount: 0, excludedNoRate: 0 };
  for (const po of pos) {
    if ((po.status ?? '') === 'Cancelled' || (po.status ?? '') === 'Draft' || (po.status ?? '') === 'Replaced') continue;
    const rate = po.currency === 'IDR' ? 1 : Number(po.exchange_rate) || 0;
    const totalIdr = (Number(po.total_value) || 0) * rate;
    if ((Number(po.total_value) || 0) > 0 && rate === 0) { r.excludedNoRate += 1; continue; }
    const out = totalIdr - (paid.get(String(po.po_id)) ?? 0);
    if (totalIdr <= 0 || out <= 1000) continue;   // rounding dust, same as the queue
    r.outstanding += out; r.openCount += 1;
    if (['Fully Received', 'Partially Received'].includes(po.status ?? '')) { r.receivedOwed += out; r.receivedCount += 1; }
  }
  return r;
}

// ── CCC ──────────────────────────────────────────────────────────────────────
export interface CccPosition {
  dio: number | null; dso: number | null; dpo: number | null; ccc: number | null;
  stockValue: number; windowDays: number;
}

export interface CccInputs {
  balances: BalanceRow[];
  /** Delivery OUT movements inside the window only (pre-filtered). */
  deliveryOuts: MoveRow[];
  invoices: InvoiceRow[];
  receipts: ReceiptRow[];
  /** Principal PO payments in IDR with their dates (window-filtered by caller). */
  poPayments: { po_id: string; amount_idr: number; payment_date: string }[];
  /** po_id → actual_received_date */
  poReceived: Map<string, string>;
  windowDays: number;
  nowIso: string;
}

/** /profitability's company-CCC math on a fixed window. */
export function computeCcc(i: CccInputs): CccPosition {
  const stockValue = i.balances.reduce((s, b) => s + Math.max(0, Number(b.qty_on_hand) || 0) * (Number(b.avg_cost_idr) || 0), 0);
  const cogs = i.deliveryOuts.reduce((s, m) => s + (Number(m.quantity) || 0) * (Number(m.unit_cost_idr) || 0), 0);
  const dio = cogs > 0 ? stockValue / (cogs / i.windowDays) : null;

  const from = new Date(`${i.nowIso.slice(0, 10)}T00:00:00`);
  from.setDate(from.getDate() - i.windowDays);
  const fromIso = from.toISOString().slice(0, 10);

  // DSO: invoices ISSUED in the window and fully paid, issued→last payment, value-weighted
  const paidByInv = new Map<string, { paid: number; last: string }>();
  for (const r of i.receipts) {
    if (!r.invoice_id || !r.payment_date) continue;
    const e = paidByInv.get(r.invoice_id) ?? { paid: 0, last: '' };
    e.paid += Number(r.amount) || 0;
    if (r.payment_date > e.last) e.last = r.payment_date;
    paidByInv.set(r.invoice_id, e);
  }
  let dsoW = 0, dsoSum = 0;
  for (const inv of i.invoices) {
    if (!inv.issued_at || inv.issued_at.slice(0, 10) < fromIso) continue;
    const p = paidByInv.get(inv.invoice_id);
    const total = Number(inv.grand_total) || 0;
    if (p && p.paid >= total - 1 && p.last) { dsoW += total; dsoSum += total * days(p.last, inv.issued_at); }
  }
  const dso = dsoW > 0 ? dsoSum / dsoW : null;

  // DPO: payment date − goods received date (negative = we prepay imports)
  let dpoW = 0, dpoSum = 0;
  for (const pay of i.poPayments) {
    const rec = i.poReceived.get(pay.po_id);
    if (!rec || pay.payment_date < fromIso) continue;
    dpoW += pay.amount_idr; dpoSum += pay.amount_idr * days(pay.payment_date, rec);
  }
  const dpo = dpoW > 0 ? dpoSum / dpoW : null;

  const ccc = dio != null ? dio + (dso ?? 0) - (dpo ?? 0) : null;
  return { dio, dso, dpo, ccc, stockValue, windowDays: i.windowDays };
}

// ── Month in motion ──────────────────────────────────────────────────────────
export interface MotionRow {
  key: 'invoiced' | 'collected' | 'paid-out';
  label: string;
  now: number;      // this month, day 1 → today
  prev: number;     // last month, the SAME number of days
  /** null when last month's span was zero (no base to compare against). */
  deltaPct: number | null;
}

/** [fromIso, toIso] inclusive date-window pair: this MTD and last month's same span. */
export function motionWindows(nowIso: string): { thisFrom: string; thisTo: string; prevFrom: string; prevTo: string } {
  const now = new Date(`${nowIso.slice(0, 10)}T00:00:00`);
  const day = now.getDate();
  const thisFrom = new Date(now.getFullYear(), now.getMonth(), 1);
  const prevFrom = new Date(now.getFullYear(), now.getMonth() - 1, 1);
  // Same span; a shorter previous month naturally caps at its own end
  const prevToRaw = new Date(prevFrom.getFullYear(), prevFrom.getMonth(), day);
  const prevMonthEnd = new Date(now.getFullYear(), now.getMonth(), 0);
  const prevTo = prevToRaw > prevMonthEnd ? prevMonthEnd : prevToRaw;
  const iso = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  return { thisFrom: iso(thisFrom), thisTo: nowIso.slice(0, 10), prevFrom: iso(prevFrom), prevTo: iso(prevTo) };
}

const inSpan = (d: string | null | undefined, from: string, to: string): boolean =>
  !!d && d.slice(0, 10) >= from && d.slice(0, 10) <= to;

export function computeMonthMotion(
  nowIso: string,
  invoices: InvoiceRow[] | null,
  receipts: ReceiptRow[] | null,
  paymentsIdr: { amount_idr: number; payment_date: string }[] | null,
): MotionRow[] {
  const w = motionWindows(nowIso);
  const rows: MotionRow[] = [];
  const push = (key: MotionRow['key'], label: string, now: number, prev: number) =>
    rows.push({ key, label, now, prev, deltaPct: prev > 0 ? ((now - prev) / prev) * 100 : null });

  if (invoices) {
    const sum = (from: string, to: string) => invoices.reduce((s, i) => s + (inSpan(i.issued_at, from, to) ? Number(i.grand_total) || 0 : 0), 0);
    push('invoiced', 'Invoiced', sum(w.thisFrom, w.thisTo), sum(w.prevFrom, w.prevTo));
  }
  if (receipts) {
    const sum = (from: string, to: string) => receipts.reduce((s, r) => s + (inSpan(r.payment_date, from, to) ? Number(r.amount) || 0 : 0), 0);
    push('collected', 'Collected', sum(w.thisFrom, w.thisTo), sum(w.prevFrom, w.prevTo));
  }
  if (paymentsIdr) {
    const sum = (from: string, to: string) => paymentsIdr.reduce((s, p) => s + (inSpan(p.payment_date, from, to) ? p.amount_idr : 0), 0);
    push('paid-out', 'Paid out', sum(w.thisFrom, w.thisTo), sum(w.prevFrom, w.prevTo));
  }
  return rows;
}

// ── Fetch wrappers ───────────────────────────────────────────────────────────
export interface PositionData {
  cash?: CashPosition;
  ar?: ArPosition;
  ap?: ApPosition;
  /** Goods on the water — paid/ordered, not yet received (sits beside "we owe"). */
  inTransit?: InTransitSummary;
  ccc?: CccPosition;
  motion: MotionRow[];
}

const CCC_WINDOW_DAYS = 90;

/** Principal PO payments in IDR (payment's own rate, falling back to the PO's). */
function principalPaymentsIdr(costs: CostRow[], pos: PoRow[]): { po_id: string; amount_idr: number; payment_date: string }[] {
  const poRate = new Map(pos.map((p) => [String(p.po_id), Number(p.exchange_rate) || 0]));
  const out: { po_id: string; amount_idr: number; payment_date: string }[] = [];
  for (const c of costs) {
    if (!c.payment_date || !PRINCIPAL_CATS.has(c.cost_category)) continue;
    const rate = c.currency === 'IDR' ? 1 : Number(c.exchange_rate) || poRate.get(String(c.po_id)) || 0;
    const idr = (Number(c.amount) || 0) * rate;
    if (idr > 0) out.push({ po_id: String(c.po_id), amount_idr: idr, payment_date: c.payment_date.slice(0, 10) });
  }
  return out;
}

/**
 * One pass for the strip AND month-in-motion — the tables overlap almost
 * entirely, so fetching them separately would read the same rows twice.
 * Every tile the role cannot see is simply absent, and a failed read drops
 * only the tiles that needed it.
 */
export async function fetchPosition(
  supabase: SupabaseClient,
  perms: RolePermissions,
  opts: { arOverdueDays: number },
): Promise<PositionData> {
  const needInvoices = perms.sellSide || perms.canViewEconomics;
  const needReceipts = perms.sellSide || perms.canViewBanks || perms.canViewEconomics;
  const needCosts = perms.buySide || perms.canViewBanks || perms.canViewEconomics;
  const needPos = perms.buySide || perms.canViewEconomics;

  const nowIso = new Date().toISOString();
  const winFrom = new Date(); winFrom.setDate(winFrom.getDate() - CCC_WINDOW_DAYS);

  const [accRes, txnRes, invRes, rcpRes, costRes, poRes, balRes, moveRes] = await Promise.all([
    perms.canViewBanks ? supabase.from('41.0_bank_accounts').select('bank_account_id, currency, opening_balance, is_active') : Promise.resolve({ data: null, error: null }),
    perms.canViewBanks ? supabase.from('41.1_bank_transactions').select('bank_account_id, direction, amount') : Promise.resolve({ data: null, error: null }),
    needInvoices ? supabase.from('25.0_sales_invoices').select('invoice_id, grand_total, issued_at') : Promise.resolve({ data: null, error: null }),
    needReceipts ? supabase.from('26.0_customer_receipts').select('invoice_id, amount, payment_date, bank_account_id') : Promise.resolve({ data: null, error: null }),
    needCosts ? supabase.from('6.0_po_costs').select('po_id, cost_category, amount, currency, exchange_rate, payment_date, bank_account_id') : Promise.resolve({ data: null, error: null }),
    needPos ? supabase.from('5.0_purchases').select('po_id, po_number, status, total_value, currency, exchange_rate, actual_received_date, po_date, estimated_delivery_date, supplier_id') : Promise.resolve({ data: null, error: null }),
    perms.canViewEconomics ? supabase.from('30.1_stock_balances').select('qty_on_hand, avg_cost_idr') : Promise.resolve({ data: null, error: null }),
    perms.canViewEconomics
      ? supabase.from('30.0_stock_movements').select('quantity, unit_cost_idr, moved_at')
          .eq('direction', 'out').eq('source_type', 'delivery').gte('moved_at', winFrom.toISOString())
      : Promise.resolve({ data: null, error: null }),
  ]);

  const accounts = (accRes.data ?? null) as AccountRow[] | null;
  const txns = (txnRes.data ?? null) as TxnRow[] | null;
  const invoices = (invRes.data ?? null) as InvoiceRow[] | null;
  const receipts = (rcpRes.data ?? null) as ReceiptRow[] | null;
  const costs = (costRes.data ?? null) as CostRow[] | null;
  const pos = (poRes.data ?? null) as PoRow[] | null;

  const out: PositionData = { motion: [] };

  if (perms.canViewBanks && accounts && receipts && costs && txns) {
    out.cash = computeCashPosition(accounts, receipts, costs, txns);
  }
  if (perms.sellSide && invoices && receipts) {
    const cutoff = new Date(); cutoff.setDate(cutoff.getDate() - opts.arOverdueDays);
    out.ar = computeAr(invoices, receipts, cutoff.toISOString().slice(0, 10));
  }
  if (perms.buySide && pos && costs) {
    out.ap = computeAp(pos, costs);
    out.inTransit = computeInTransit(
      pos as unknown as OpenPo[], costs as unknown as PoCost[], pos as unknown as ReceivedPo[], nowIso,
    );
  }
  if (perms.canViewEconomics && balRes.data && moveRes.data && invoices && receipts && costs && pos) {
    out.ccc = computeCcc({
      balances: balRes.data as BalanceRow[],
      deliveryOuts: moveRes.data as MoveRow[],
      invoices, receipts,
      poPayments: principalPaymentsIdr(costs, pos),
      poReceived: new Map(pos.filter((p) => p.actual_received_date).map((p) => [String(p.po_id), p.actual_received_date!.slice(0, 10)])),
      windowDays: CCC_WINDOW_DAYS,
      nowIso,
    });
  }

  out.motion = computeMonthMotion(
    nowIso,
    perms.sellSide ? invoices : null,
    perms.sellSide ? receipts : null,
    perms.buySide && costs && pos ? principalPaymentsIdr(costs, pos) : null,
  );

  return out;
}
