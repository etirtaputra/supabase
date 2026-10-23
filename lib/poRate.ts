/**
 * The estimated exchange rate a foreign-currency PO is saved with.
 *
 * OWNER, 2026-10-23: *"whenever MIRA helps to enter the PO in ICAPROC, she
 * always misses the exchange or currency rate."* The New Deal screen fills an
 * empty Exch Rate from payment history, but only in the browser — MIRA writes
 * the row directly, so EB.42538, PIO-2026020 and PIO-2026021 (KSTAR, CNY)
 * landed with `exchange_rate = null` and every page read CNY 1 as IDR 1
 * ("CNY 333.798 = IDR 333.798").
 *
 * One rule, used by both writers: the screen calls it at save, and
 * `GET /api/agent/purchasing/rate` hands the agent the same answer. The
 * database refuses a non-IDR PO without a rate (migrations/po_exchange_rate_required.sql),
 * so a writer that skips both gets told rather than saving a wrong total.
 *
 * Order — the first that exists wins:
 *   1. this supplier's latest rate in this currency (realised once a PO is
 *      settled, else that PO's estimate — `deriveExchangeRates` decides);
 *   2. the latest rate in this currency from any supplier;
 *   3. today's market rate (`lib/liveFx.ts`).
 * Rounded to whole rupiah, as the screen always has. The figure is an
 * ESTIMATE: once the PO is paid, the realised rate replaces it everywhere.
 */
import type { ExchangeRateHistory } from '../types/database';

export type PoRateSource = 'supplier' | 'currency' | 'live';

export interface PoRateEstimate {
  rate: number;
  source: PoRateSource;
  /** The PO the rate was read from (sources 1 and 2). */
  po_id: string | null;
  /** Payment date behind the rate (sources 1 and 2). */
  date: string | null;
}

function latest(rows: ExchangeRateHistory[]): ExchangeRateHistory {
  // Same tie-break as getLatestExchangeRate: the first of equal dates wins.
  return rows.reduce((a, b) => (b.payment_date > a.payment_date ? b : a));
}

export function estimatePoRate(
  history: ExchangeRateHistory[],
  supplierId: string | null | undefined,
  currency: string | null | undefined,
  live?: Record<string, number> | null,
): PoRateEstimate | null {
  if (!currency || currency === 'IDR') return null;
  const inCurrency = history.filter((r) => r.currency === currency && Number(r.implied_rate) > 0);

  const own = supplierId ? inCurrency.filter((r) => String(r.supplier_id) === String(supplierId)) : [];
  if (own.length) {
    const r = latest(own);
    return { rate: Math.round(r.implied_rate), source: 'supplier', po_id: r.po_id, date: r.payment_date };
  }
  if (inCurrency.length) {
    const r = latest(inCurrency);
    return { rate: Math.round(r.implied_rate), source: 'currency', po_id: r.po_id, date: r.payment_date };
  }
  const today = Number(live?.[currency]);
  if (today > 0) return { rate: Math.round(today), source: 'live', po_id: null, date: null };
  return null;
}
