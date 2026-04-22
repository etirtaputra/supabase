'use client';

import React, { useMemo } from 'react';
import { getLatestExchangeRate } from '@/lib/exchangeRates';
import type { ExchangeRateHistory, Supplier } from '../../types/database';

interface ExchangeRateSuggestionProps {
  rates: ExchangeRateHistory[];
  supplierId?: string;
  currency?: string;
  suppliers: Supplier[];
  currentRate?: number;
}

export default function ExchangeRateSuggestion({
  rates,
  supplierId,
  currency,
  suppliers,
  currentRate,
}: ExchangeRateSuggestionProps) {
  const supplier = useMemo(
    () => suppliers.find((s) => String(s.supplier_id) === supplierId),
    [supplierId, suppliers]
  );

  const latestRate = useMemo(
    () =>
      supplierId && currency && currency !== 'IDR'
        ? getLatestExchangeRate(rates, supplierId, currency)
        : null,
    [rates, supplierId, currency]
  );

  if (!supplierId || !currency || currency === 'IDR' || !latestRate) {
    return null;
  }

  const isDifferent = currentRate && Math.abs(currentRate - latestRate.rate) > 0.01;

  return (
    <div className="bg-slate-800/40 border border-slate-700/50 rounded-lg p-3 text-sm space-y-2">
      <div className="flex items-start justify-between gap-2">
        <div>
          <p className="text-[11px] font-semibold text-slate-400 uppercase tracking-wide">
            Latest Rate Suggestion
          </p>
          <p className="text-xs text-slate-600 mt-0.5">
            {supplier?.supplier_name || 'Unknown'} • {currency}
          </p>
        </div>
        {isDifferent && (
          <span className="px-2 py-0.5 text-[10px] font-bold rounded bg-amber-500/20 text-amber-300 flex-shrink-0">
            Different
          </span>
        )}
      </div>

      {/* Rate stats */}
      <div className="bg-slate-900/40 rounded px-2.5 py-2 space-y-1">
        <div className="flex items-center justify-between gap-2">
          <span className="text-slate-500 text-[10px]">Latest:</span>
          <span className="text-sm font-bold text-emerald-400">{latestRate.rate.toFixed(4)}</span>
        </div>
        <div className="flex items-center justify-between gap-2 text-[10px] text-slate-600">
          <span>Avg: {latestRate.avg.toFixed(4)}</span>
          <span>Range: {latestRate.min.toFixed(4)} - {latestRate.max.toFixed(4)}</span>
        </div>
        <p className="text-[10px] text-slate-700 mt-1">
          From {latestRate.count} transaction{latestRate.count !== 1 ? 's' : ''} • {latestRate.date}
        </p>
      </div>

      {currentRate && isDifferent && (
        <p className="text-[10px] text-slate-500 italic">
          Your current rate ({currentRate.toFixed(4)}) differs from latest ({latestRate.rate.toFixed(4)}) by{' '}
          <span className={((currentRate - latestRate.rate) / latestRate.rate) * 100 > 0 ? 'text-red-400' : 'text-green-400'}>
            {(((currentRate - latestRate.rate) / latestRate.rate) * 100).toFixed(1)}%
          </span>
        </p>
      )}
    </div>
  );
}
