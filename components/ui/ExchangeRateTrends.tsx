'use client';

import React, { useEffect, useMemo, useState } from 'react';
import type { ExchangeRateHistory, Supplier } from '../../types/database';
import { fetchLiveFx, type LiveFxSnapshot } from '@/lib/liveFx';
import { fmtDayTime } from '@/lib/formatters';

interface ExchangeRateTrendsProps {
  rates: ExchangeRateHistory[];
  suppliers: Supplier[];
}

const VIEW_KEY = 'icaproc_fx_view';

export default function ExchangeRateTrends({ rates, suppliers }: ExchangeRateTrendsProps) {
  const supplierMap = useMemo(() => new Map(suppliers.map(s => [s.supplier_id, s])), [suppliers]);

  // ── Live market rates: auto-fetched (cached ≤1h), auto-refreshed hourly
  //    while the tab stays open. The stamp shows when the provider updated.
  const [live, setLive] = useState<LiveFxSnapshot | null>(null);
  useEffect(() => {
    let cancelled = false;
    const load = () => { void fetchLiveFx().then((s) => { if (!cancelled && s) setLive(s); }); };
    load();
    const id = setInterval(load, 60 * 60 * 1000);
    return () => { cancelled = true; clearInterval(id); };
  }, []);

  // Compact by default (owner's call) — the detailed cards are one tap away.
  const [view, setView] = useState<'compact' | 'detail'>(() => {
    if (typeof window === 'undefined') return 'compact';
    try { return window.localStorage.getItem(VIEW_KEY) === 'detail' ? 'detail' : 'compact'; } catch { return 'compact'; }
  });
  const pickView = (v: 'compact' | 'detail') => {
    setView(v);
    try { window.localStorage.setItem(VIEW_KEY, v); } catch { /* private mode */ }
  };

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
        supplier: supplierMap.get(supplier_id as any),
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
    return (
      <svg width="60" height="24" viewBox="0 0 100 100" preserveAspectRatio="none" className="inline">
        <polyline points={points.map(p => `${p.x},${p.y}`).join(' ')} fill="none" stroke="currentColor" strokeWidth="1.5" vectorEffect="non-scaling-stroke" />
      </svg>
    );
  };

  // The live strip: today's market IDR rates for the currencies the business
  // actually buys in — the reference the supplier implied rates are judged by.
  const liveStrip = (
    <div className="bg-slate-800/30 border border-slate-700/50 rounded-lg px-3 py-2.5">
      <div className="flex flex-wrap items-center gap-x-5 gap-y-1.5">
        <span className="text-[10px] font-bold uppercase tracking-wider text-slate-500">Market rates · IDR</span>
        {live ? (
          <>
            {(['USD', 'CNY', 'EUR'] as const).map((c) => {
              const v = live.rates[c];
              return v ? (
                <span key={c} className="text-xs text-slate-400">
                  {c === 'CNY' ? 'RMB' : c}{' '}
                  <span className="font-bold tabular-nums text-sky-300">{Math.round(v).toLocaleString('en-US')}</span>
                </span>
              ) : null;
            })}
            <span className="text-[10px] text-slate-600 ml-auto" title={`Fetched ${fmtDayTime(live.fetchedAt)} — auto-refreshes hourly`}>
              Updated {fmtDayTime(live.providerUpdatedAt)}
            </span>
          </>
        ) : (
          <span className="text-[11px] text-slate-600">Fetching live rates…</span>
        )}
      </div>
    </div>
  );

  if (rates.length === 0) {
    return (
      <div className="bg-slate-900/40 border border-slate-800/80 rounded-2xl ring-1 ring-white/5 p-6 space-y-4">
        {liveStrip}
        <p className="text-sm text-slate-400 italic">No exchange rate history yet — supplier implied rates appear here once POs have payments.</p>
      </div>
    );
  }

  const entries = Object.entries(stats);

  return (
    <div className="bg-slate-900/40 border border-slate-800/80 rounded-2xl ring-1 ring-white/5 p-4 md:p-6 space-y-4">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <h3 className="text-lg font-bold text-white">Exchange Rate Trends</h3>
          <p className="text-xs text-slate-500 mt-1">Latest rates by supplier &amp; currency, extracted from historical PO payments</p>
        </div>
        <div className="flex rounded-lg border border-slate-700 overflow-hidden text-[11px] font-semibold">
          <button onClick={() => pickView('compact')}
            className={`px-3 py-1.5 transition-colors ${view === 'compact' ? 'bg-slate-700 text-white' : 'bg-slate-800/60 text-slate-500 hover:text-slate-300'}`}>
            Compact
          </button>
          <button onClick={() => pickView('detail')}
            className={`px-3 py-1.5 transition-colors ${view === 'detail' ? 'bg-slate-700 text-white' : 'bg-slate-800/60 text-slate-500 hover:text-slate-300'}`}>
            Detailed
          </button>
        </div>
      </div>

      {liveStrip}

      {view === 'compact' ? (
        <div className="border border-slate-700/50 rounded-lg overflow-hidden divide-y divide-slate-800/60 bg-slate-800/20">
          {entries.map(([key, stat]) => (
            <div key={key} className="flex items-center gap-3 px-3 py-2">
              <span className="min-w-0 flex-1 truncate text-xs font-medium text-slate-200">
                {stat.supplier?.supplier_name || 'Unknown'} <span className="text-slate-500">· {stat.currency}</span>
              </span>
              <span className="hidden sm:inline text-[10px] text-slate-600 tabular-nums flex-shrink-0">{stat.count}×</span>
              <span className="hidden md:inline text-[10px] text-slate-600 tabular-nums flex-shrink-0">Δ {((stat.max - stat.min) / stat.avg * 100).toFixed(1)}%</span>
              {stat.trend.length > 1 && <span className="hidden sm:inline text-slate-600 flex-shrink-0"><Sparkline trend={stat.trend} /></span>}
              <span className="text-right flex-shrink-0">
                <span className="block text-xs font-bold text-emerald-400 tabular-nums">{stat.latest.toFixed(2)}</span>
                <span className="block text-[9px] text-slate-500 tabular-nums">{stat.latestDate}</span>
              </span>
            </div>
          ))}
        </div>
      ) : (
        <div className="grid gap-3">
          {entries.map(([key, stat]) => (
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
      )}

      {/* Summary stats */}
      <div className="pt-3 border-t border-slate-700/50">
        <p className="text-[11px] text-slate-500">
          {entries.length} currency-supplier pair{entries.length !== 1 ? 's' : ''} •
          {' '}{rates.length} total observations
        </p>
      </div>
    </div>
  );
}
