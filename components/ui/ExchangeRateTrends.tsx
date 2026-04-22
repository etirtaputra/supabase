'use client';

import React, { useMemo } from 'react';
import type { ExchangeRateHistory, Supplier } from '../../types/database';

interface ExchangeRateTrendsProps {
  rates: ExchangeRateHistory[];
  suppliers: Supplier[];
}

export default function ExchangeRateTrends({ rates, suppliers }: ExchangeRateTrendsProps) {
  const supplierMap = useMemo(() => new Map(suppliers.map(s => [s.supplier_id, s])), [suppliers]);

  // Group rates by supplier and currency
  const groupedRates = useMemo(() => {
    const groups = new Map<string, ExchangeRateHistory[]>();
    rates.forEach(rate => {
      const key = `${rate.supplier_id}|${rate.currency}`;
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key)!.push(rate);
    });
    // Sort each group by date descending
    groups.forEach((list) => list.sort((a, b) => b.payment_date.localeCompare(a.payment_date)));
    return groups;
  }, [rates]);

  // Calculate statistics per supplier+currency
  const stats = useMemo(() => {
    const result: Record<string, {
      currency: string;
      supplier: Supplier | undefined;
      latest: number;
      latestDate: string;
      avg: number;
      min: number;
      max: number;
      count: number;
      trend: number[]; // last 10 rates for sparkline
    }> = {};

    groupedRates.forEach((rateList, key) => {
      if (rateList.length === 0) return;
      const sorted = rateList.map(r => r.implied_rate).sort((a, b) => a - b);
      const [supplier_id, currency] = key.split('|');
      result[key] = {
        currency,
        supplier: supplierMap.get(supplier_id),
        latest: rateList[0].implied_rate,
        latestDate: rateList[0].payment_date,
        avg: rateList.reduce((s, r) => s + r.implied_rate, 0) / rateList.length,
        min: sorted[0],
        max: sorted[sorted.length - 1],
        count: rateList.length,
        trend: rateList.slice(0, 10).map(r => r.implied_rate).reverse(),
      };
    });
    return result;
  }, [groupedRates, supplierMap]);

  if (rates.length === 0) {
    return (
      <div className="bg-slate-900/40 border border-slate-800/80 rounded-2xl ring-1 ring-white/5 p-6">
        <p className="text-sm text-slate-400 italic">No exchange rate history yet. Run populate-exchange-rates.js to extract from existing POs.</p>
      </div>
    );
  }

  // Sparkline component
  const Sparkline = ({ trend }: { trend: number[] }) => {
    if (trend.length < 2) return null;
    const min = Math.min(...trend);
    const max = Math.max(...trend);
    const range = max - min || 1;
    const points = trend.map((v, i) => ({
      x: (i / (trend.length - 1)) * 100,
      y: 100 - ((v - min) / range) * 100,
    }));
    const pathD = points.map((p, i) => `${i === 0 ? 'M' : 'L'} ${p.x} ${p.y}`).join(' ');
    return (
      <svg width="60" height="24" className="inline">
        <polyline points={points.map(p => `${p.x},${p.y}`).join(' ')} fill="none" stroke="currentColor" strokeWidth="1.5" vectorEffect="non-scaling-stroke" />
      </svg>
    );
  };

  return (
    <div className="bg-slate-900/40 border border-slate-800/80 rounded-2xl ring-1 ring-white/5 p-6 space-y-4">
      <div>
        <h3 className="text-lg font-bold text-white mb-4">Exchange Rate Trends</h3>
        <p className="text-xs text-slate-500 mb-4">Latest rates by supplier & currency, extracted from historical PO payments</p>
      </div>

      <div className="grid gap-3">
        {Object.entries(stats).map(([key, stat]) => (
          <div key={key} className="bg-slate-800/30 border border-slate-700/50 rounded-lg p-3">
            <div className="flex items-start justify-between mb-2">
              <div>
                <p className="text-sm font-semibold text-white">
                  {stat.supplier?.supplier_name || 'Unknown'} <span className="text-slate-400">• {stat.currency}</span>
                </p>
                <p className="text-[11px] text-slate-500 mt-0.5">{stat.count} transaction{stat.count !== 1 ? 's' : ''}</p>
              </div>
              <div className="text-right">
                <p className="text-sm font-bold text-emerald-400">{stat.latest.toFixed(4)}</p>
                <p className="text-[10px] text-slate-500">{stat.latestDate}</p>
              </div>
            </div>

            {/* Stats row */}
            <div className="flex items-center justify-between gap-2 text-[10px] bg-slate-900/40 rounded px-2 py-1.5 mb-2">
              <span className="text-slate-500">Avg: <span className="text-slate-300">{stat.avg.toFixed(4)}</span></span>
              <span className="text-slate-500">Min: <span className="text-slate-300">{stat.min.toFixed(4)}</span></span>
              <span className="text-slate-500">Max: <span className="text-slate-300">{stat.max.toFixed(4)}</span></span>
              <span className="text-slate-600">Δ {((stat.max - stat.min) / stat.avg * 100).toFixed(1)}%</span>
            </div>

            {/* Sparkline */}
            {stat.trend.length > 1 && (
              <div className="text-slate-500">
                <Sparkline trend={stat.trend} />
              </div>
            )}
          </div>
        ))}
      </div>

      {/* Summary stats */}
      <div className="pt-3 border-t border-slate-700/50">
        <p className="text-[11px] text-slate-500">
          {Object.keys(stats).length} currency-supplier pair{Object.keys(stats).length !== 1 ? 's' : ''} •
          {' '}{rates.length} total observations
        </p>
      </div>
    </div>
  );
}
