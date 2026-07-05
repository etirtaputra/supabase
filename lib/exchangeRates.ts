/**
 * Exchange rate utilities
 * Lookup and management of historical exchange rates from POs
 */

import type {
  ExchangeRateHistory, PurchaseOrder, PurchaseLineItem, POCost, PriceQuote,
} from '../types/database';
import { PRINCIPAL_CATS, BALANCE_CATS } from '../constants/costCategories';

/**
 * Derive exchange rates from PO records.
 * Strategy (in priority order):
 *   1. po.exchange_rate — explicitly set by the user at PO creation; most reliable.
 *   2. Weighted average of individual payment records that carry their own exchange_rate
 *      (cost.currency ≠ IDR and cost.exchange_rate is set).
 * Avoids dividing total-IDR-paid ÷ sum-of-items, which breaks when line items are in
 * a different currency than the PO (e.g. IDR items on a USD PO).
 * Only non-IDR POs that have at least one principal payment with a payment_date are included.
 */
export function deriveExchangeRates(
  pos: PurchaseOrder[],
  poItems: PurchaseLineItem[],
  poCosts: POCost[],
  quotes: PriceQuote[],
): ExchangeRateHistory[] {
  // suppress unused-import warning — poItems kept in signature for API compatibility
  void poItems;

  const quoteMap = new Map(quotes.map((q) => [q.quote_id, q]));

  const costsByPo = new Map<number, POCost[]>();
  for (const cost of poCosts) {
    const arr = costsByPo.get(cost.po_id) ?? [];
    arr.push(cost);
    costsByPo.set(cost.po_id, arr);
  }

  const result: ExchangeRateHistory[] = [];

  for (const po of pos) {
    if (po.currency === 'IDR') continue;

    const supplierId = po.supplier_id ?? quoteMap.get(po.quote_id!)?.supplier_id;
    if (!supplierId) continue;

    const costs = costsByPo.get(po.po_id) ?? [];
    const principal = costs.filter((c) => PRINCIPAL_CATS.has(c.cost_category));
    if (!principal.length) continue;

    // Determine payment date: prefer latest balance settlement, else any principal date
    const balanceDates = costs
      .filter((c) => BALANCE_CATS.has(c.cost_category) && c.payment_date)
      .map((c) => c.payment_date!);
    const principalDates = principal.filter((c) => c.payment_date).map((c) => c.payment_date!);
    const allDates = balanceDates.length ? balanceDates : principalDates;
    if (!allDates.length) continue;
    const paymentDate = allDates.reduce((a, b) => (b > a ? b : a));

    // ── Option 1: explicit po.exchange_rate ──────────────────────────────────
    const poRate = Number(po.exchange_rate);
    if (poRate > 0) {
      const quotedForeign = Number(po.total_value) || 0;
      result.push({
        rate_id: `derived-${po.po_id}`,
        po_id: String(po.po_id),
        supplier_id: supplierId,
        currency: po.currency,
        quoted_amount_foreign: quotedForeign,
        paid_amount_idr: quotedForeign * poRate,
        implied_rate: poRate,
        payment_date: paymentDate,
      });
      continue;
    }

    // ── Option 2: weighted average from payment records with explicit rates ──
    const foreignPayments = principal.filter(
      (c) => c.currency !== 'IDR' && Number(c.exchange_rate) > 0,
    );
    if (!foreignPayments.length) continue;

    const totalForeign = foreignPayments.reduce((s, c) => s + Number(c.amount), 0);
    const totalIdr = foreignPayments.reduce(
      (s, c) => s + Number(c.amount) * Number(c.exchange_rate),
      0,
    );
    if (totalForeign <= 0) continue;

    result.push({
      rate_id: `derived-${po.po_id}`,
      po_id: String(po.po_id),
      supplier_id: supplierId,
      currency: po.currency,
      quoted_amount_foreign: totalForeign,
      paid_amount_idr: totalIdr,
      implied_rate: totalIdr / totalForeign,
      payment_date: paymentDate,
    });
  }

  return result;
}

export interface LatestRateBySupplier {
  rate: number;
  date: string;
  count: number;
  min: number;
  max: number;
  avg: number;
}

/**
 * Get the latest exchange rate for a supplier and currency
 * Returns null if no history exists
 */
export function getLatestExchangeRate(
  rates: ExchangeRateHistory[],
  supplierId: string,
  currency: string
): LatestRateBySupplier | null {
  const matching = rates.filter(
    (r) => r.supplier_id === supplierId && r.currency === currency
  );

  if (matching.length === 0) return null;

  // Sort by date descending to get latest
  const sorted = matching.sort((a, b) => b.payment_date.localeCompare(a.payment_date));
  const latest = sorted[0];

  const allRates = matching.map((r) => r.implied_rate).sort((a, b) => a - b);
  const avg = matching.reduce((sum, r) => sum + r.implied_rate, 0) / matching.length;

  return {
    rate: latest.implied_rate,
    date: latest.payment_date,
    count: matching.length,
    min: allRates[0],
    max: allRates[allRates.length - 1],
    avg,
  };
}

/**
 * Get latest rates for all currencies from a specific supplier
 */
export function getSupplierExchangeRates(
  rates: ExchangeRateHistory[],
  supplierId: string
): Record<string, LatestRateBySupplier> {
  const result: Record<string, LatestRateBySupplier> = {};

  const bySupplier = rates.filter((r) => r.supplier_id === supplierId);
  const currencies = new Set(bySupplier.map((r) => r.currency));

  currencies.forEach((currency) => {
    const latestRate = getLatestExchangeRate(rates, supplierId, currency);
    if (latestRate) {
      result[currency] = latestRate;
    }
  });

  return result;
}

/**
 * Get exchange rate statistics for trend analysis
 */
export function getExchangeRateStats(
  rates: ExchangeRateHistory[],
  supplierId: string,
  currency: string,
  limit = 10
): {
  latest: number | null;
  trend: number[];
  volatility: number; // standard deviation
} {
  const matching = rates
    .filter((r) => r.supplier_id === supplierId && r.currency === currency)
    .sort((a, b) => b.payment_date.localeCompare(a.payment_date))
    .slice(0, limit)
    .map((r) => r.implied_rate);

  if (matching.length === 0) {
    return { latest: null, trend: [], volatility: 0 };
  }

  const avg = matching.reduce((a, b) => a + b) / matching.length;
  const variance =
    matching.reduce((sum, val) => sum + Math.pow(val - avg, 2), 0) / matching.length;
  const volatility = Math.sqrt(variance);

  return {
    latest: matching[0],
    trend: matching.reverse(),
    volatility,
  };
}
