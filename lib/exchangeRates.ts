/**
 * Exchange rate utilities
 * Lookup and management of historical exchange rates from POs
 */

import type {
  ExchangeRateHistory, PurchaseOrder, PurchaseLineItem, POCost, PriceQuote,
} from '../types/database';
import { PRINCIPAL_CATS, BALANCE_CATS } from '../constants/costCategories';

/**
 * Derive implied exchange rates on-the-fly from PO payment records.
 * implied_rate = total principal paid in IDR ÷ total quoted in foreign currency.
 * Only non-IDR POs with both line items and at least one principal payment are included.
 * This replaces/supplements the 9.0_exchange_rate_history table so rates always
 * reflect the current payment records in 7.0_po_costs.
 */
export function deriveExchangeRates(
  pos: PurchaseOrder[],
  poItems: PurchaseLineItem[],
  poCosts: POCost[],
  quotes: PriceQuote[],
): ExchangeRateHistory[] {
  const quoteMap = new Map(quotes.map((q) => [q.quote_id, q]));

  const itemsByPo = new Map<number, PurchaseLineItem[]>();
  for (const item of poItems) {
    const arr = itemsByPo.get(item.po_id) ?? [];
    arr.push(item);
    itemsByPo.set(item.po_id, arr);
  }
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

    const items = itemsByPo.get(po.po_id) ?? [];
    const costs = costsByPo.get(po.po_id) ?? [];
    if (!items.length || !costs.length) continue;

    const quotedForeign = items.reduce((s, i) => s + i.unit_cost * i.quantity, 0);
    if (quotedForeign === 0) continue;

    const principal = costs.filter((c) => PRINCIPAL_CATS.has(c.cost_category));
    if (!principal.length) continue;

    const poExRate = Number(po.exchange_rate) || 0;
    const paidIdr = principal.reduce((s, c) => {
      if (c.currency === 'IDR') return s + Number(c.amount);
      return s + Number(c.amount) * (Number(c.exchange_rate) || poExRate || 1);
    }, 0);
    if (paidIdr === 0) continue;

    const impliedRate = paidIdr / quotedForeign;
    if (impliedRate <= 0) continue;

    // Latest balance payment date, falling back to any principal payment date
    const balanceDates = costs
      .filter((c) => BALANCE_CATS.has(c.cost_category) && c.payment_date)
      .map((c) => c.payment_date!);
    const principalDates = principal.filter((c) => c.payment_date).map((c) => c.payment_date!);
    const allDates = balanceDates.length ? balanceDates : principalDates;
    if (!allDates.length) continue;
    const paymentDate = allDates.reduce((a, b) => (b > a ? b : a));

    result.push({
      rate_id: `derived-${po.po_id}`,
      po_id: String(po.po_id),
      supplier_id: supplierId,
      currency: po.currency,
      quoted_amount_foreign: quotedForeign,
      paid_amount_idr: paidIdr,
      implied_rate: impliedRate,
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
