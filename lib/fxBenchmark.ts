/**
 * The company benchmark exchange rate, and how each payment compares with it
 * (owner, 2026-10-23: "set a universal exchange rate for USD and CNY, in
 * settings, and it will have logs … when a new rate is used, it will only
 * affect new POs. Only then, we can compare what's the rates use during
 * payment, vs. the benchmark").
 *
 * The log is `9.1_fx_benchmark_rates`: one row per change, newest = current.
 * A PO is compared with the benchmark IN FORCE ON ITS PO DATE — the rate it
 * was planned at — so a PO raised before any benchmark existed has nothing to
 * be compared with, and says so rather than borrowing a later rate.
 *
 * Pure: no fetch, no React.
 */
import { PRINCIPAL_CATS, BALANCE_CATS } from '../constants/costCategories.ts';

export interface FxBenchmark {
  benchmark_id: number;
  currency: string;
  rate: number | string;
  note?: string | null;
  set_at: string;
  set_by_email?: string | null;
  /** 'manual' (typed by the owner) or 'bca-erate' (the morning KlikBCA check). */
  source?: string | null;
  edited_at?: string | null;
  edited_by_email?: string | null;
}

/** One morning's KlikBCA e-Rate reading (9.2_fx_reference_rates). */
export interface FxReference {
  rate_date: string;
  currency: string;
  buy: number | string | null;
  sell: number | string;
  quoted_at: string;
}

/** The benchmark currencies the screen always offers, even before one is set. */
export const BENCHMARK_CURRENCIES = ['USD', 'CNY'] as const;
/** A benchmark older than this is flagged as due for a look. */
export const STALE_AFTER_DAYS = 14;

const DAY = 86_400_000;
const num = (v: unknown) => { const x = Number(v); return Number.isFinite(x) ? x : 0; };
const day = (iso: string) => iso.slice(0, 10);
const newestFirst = (a: FxBenchmark, b: FxBenchmark) =>
  b.set_at.localeCompare(a.set_at) || b.benchmark_id - a.benchmark_id;

/** The current benchmark per currency (its newest row). */
export function currentBenchmarks(rows: FxBenchmark[]): Map<string, FxBenchmark> {
  const out = new Map<string, FxBenchmark>();
  for (const r of [...rows].sort(newestFirst)) if (!out.has(r.currency)) out.set(r.currency, r);
  return out;
}

/** The benchmark in force on a day: the newest row set on or before it. */
export function benchmarkOn(rows: FxBenchmark[], currency: string, onDay: string): FxBenchmark | null {
  const d = day(onDay);
  return [...rows].sort(newestFirst).find((r) => r.currency === currency && day(r.set_at) <= d) ?? null;
}

/** Whole days since the benchmark was set. */
export const ageDays = (r: FxBenchmark, today: string): number =>
  Math.max(0, Math.floor((Date.parse(`${day(today)}T00:00:00Z`) - Date.parse(`${day(r.set_at)}T00:00:00Z`)) / DAY));

/** One currency's log, newest first, each row with the rate it replaced. */
export function benchmarkLog(rows: FxBenchmark[]): (FxBenchmark & { previous: number | null })[] {
  const asc = [...rows].sort((a, b) => -newestFirst(a, b));
  const last = new Map<string, number>();
  const out = asc.map((r) => {
    const previous = last.get(r.currency) ?? null;
    last.set(r.currency, num(r.rate));
    return { ...r, previous };
  });
  return out.reverse();
}

// ── What a PO was actually paid at ──────────────────────────────────────────

export interface FxPo {
  po_id: string | number;
  po_number?: string | null;
  po_date?: string | null;
  currency?: string | null;
  total_value?: number | string | null;
  supplier_id?: string | number | null;
  status?: string | null;
}
export interface FxCost {
  po_id: string | number;
  cost_category: string;
  amount: number | string;
  currency?: string | null;
  exchange_rate?: number | string | null;
  payment_date?: string | null;
  bank_account_id?: string | null;
}

export interface PaidRate {
  /** Rupiah paid ÷ the foreign amount those payments covered. */
  rate: number;
  foreign: number;
  idr: number;
  /** The last principal payment — when the rate was paid. */
  paidOn: string | null;
  /** The account most of the money left from. */
  bankAccountId: string | null;
}

/**
 * The rate this PO was actually paid at, or null when the payments cannot say.
 *
 * A payment states its rate one of three ways: a foreign-currency transfer
 * with its own bank rate; a rupiah transfer that names the rate it got; or a
 * rupiah transfer with no rate at all — which can only be read once the PO is
 * fully paid (its balance payment is on record), as the rupiah that settled
 * whatever foreign amount the other payments left. Before that, a part
 * payment in rupiah has no foreign amount to divide by, and is left out.
 * Principal only: bank fees, duty, VAT and freight are rupiah costs of their
 * own, never currency conversion.
 */
export function paidRate(po: FxPo, costs: FxCost[]): PaidRate | null {
  const ccy = (po.currency ?? 'IDR').toUpperCase();
  const total = num(po.total_value);
  if (ccy === 'IDR' || total <= 0) return null;
  const mine = costs.filter((c) => String(c.po_id) === String(po.po_id)
    && PRINCIPAL_CATS.has(c.cost_category) && c.cost_category !== 'overpayment_credit');
  if (!mine.length) return null;

  let foreign = 0, idr = 0, bare = 0;
  const byBank = new Map<string, number>();
  let paidOn: string | null = null;
  for (const c of mine) {
    const amt = num(c.amount);
    const rowCcy = (c.currency ?? 'IDR').toUpperCase();
    const rate = num(c.exchange_rate);
    let rowIdr = 0;
    if (rowCcy === ccy && rate > 0) { foreign += amt; idr += amt * rate; rowIdr = amt * rate; }
    else if (rowCcy === 'IDR' && rate > 0) { foreign += amt / rate; idr += amt; rowIdr = amt; }
    else if (rowCcy === 'IDR') { bare += amt; rowIdr = amt; }
    else continue;                              // a foreign transfer with no rate says nothing
    if (c.payment_date && (!paidOn || c.payment_date > paidOn)) paidOn = c.payment_date;
    if (c.bank_account_id) byBank.set(c.bank_account_id, (byBank.get(c.bank_account_id) ?? 0) + rowIdr);
  }
  // Rupiah with no rate: readable only once the order is fully paid, as what
  // settled the rest of it. Until the balance is paid it is left out.
  const fullyPaid = mine.some((c) => BALANCE_CATS.has(c.cost_category));
  if (bare > 0 && fullyPaid && total - foreign > 0) { idr += bare; foreign = total; }
  if (foreign <= 0 || idr <= 0) return null;
  const bank = [...byBank.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;
  return { rate: idr / foreign, foreign, idr, paidOn, bankAccountId: bank };
}

export interface FxComparison {
  poId: string;
  poNumber: string;
  supplierId: string | null;
  currency: string;
  poDate: string;
  paid: PaidRate;
  benchmark: FxBenchmark;
  benchmarkRate: number;
  /** Rupiah paid above (+) or below (−) what the benchmark would have cost. */
  diffIdr: number;
  diffPct: number;
}

/** A PO's paid rate set against the benchmark in force on its PO date. */
export function compareToBenchmark(po: FxPo, costs: FxCost[], rows: FxBenchmark[]): FxComparison | null {
  const ccy = (po.currency ?? 'IDR').toUpperCase();
  if (ccy === 'IDR' || !po.po_date || po.status === 'Cancelled') return null;
  const bm = benchmarkOn(rows, ccy, po.po_date);
  if (!bm) return null;
  const paid = paidRate(po, costs);
  if (!paid) return null;
  const b = num(bm.rate);
  return {
    poId: String(po.po_id), poNumber: po.po_number ?? '', supplierId: po.supplier_id != null ? String(po.supplier_id) : null,
    currency: ccy, poDate: day(po.po_date), paid, benchmark: bm, benchmarkRate: b,
    diffIdr: (paid.rate - b) * paid.foreign, diffPct: ((paid.rate - b) / b) * 100,
  };
}

export interface FxSummaryRow { key: string; currency: string; pos: number; foreign: number; idr: number; benchmarkIdr: number; diffIdr: number }

/**
 * The comparisons rolled up by a key — the month paid, the supplier, the bank.
 * Per currency, because a CNY and a USD average side by side mean nothing.
 * Worst (most paid above the benchmark) first.
 */
export function summarise(rows: FxComparison[], keyOf: (c: FxComparison) => string | null): FxSummaryRow[] {
  const m = new Map<string, FxSummaryRow>();
  for (const c of rows) {
    const k = keyOf(c);
    if (!k) continue;
    const id = `${k}·${c.currency}`;
    const r = m.get(id) ?? { key: k, currency: c.currency, pos: 0, foreign: 0, idr: 0, benchmarkIdr: 0, diffIdr: 0 };
    r.pos += 1; r.foreign += c.paid.foreign; r.idr += c.paid.idr;
    r.benchmarkIdr += c.benchmarkRate * c.paid.foreign; r.diffIdr += c.diffIdr;
    m.set(id, r);
  }
  return [...m.values()].sort((a, b) => b.diffIdr - a.diffIdr);
}
