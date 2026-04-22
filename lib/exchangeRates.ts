/**
 * Exchange rate utilities
 * Lookup and management of historical exchange rates from POs
 */

import type { ExchangeRateHistory } from '../types/database';

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
