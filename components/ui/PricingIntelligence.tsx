/**
 * PricingIntelligence
 *
 * Revenue management dashboard: connects True Unit Cost (TUC) with
 * market/competitor prices to produce margin-aware sell price recommendations.
 *
 * Design philosophy (airline/hotel yield management):
 *   - TUC = your absolute cost floor — never sell below
 *   - Market intel = demand & competition signal
 *   - Sell price = TUC + margin that the market will bear
 *   - Tiers = price points for different demand scenarios
 */
'use client';
import React, { useState, useMemo, useRef, useEffect } from 'react';
import { useSearchHistory } from '@/hooks/useSearchHistory';
import Link from 'next/link';
import type {
  Component,
  PurchaseLineItem,
  PurchaseOrder,
  PriceQuoteLineItem,
  PriceQuote,
  POCost,
  CompetitorPrice,
} from '@/types/database';

import { PRINCIPAL_CATS, BANK_FEE_CATS, TAX_CATS, BALANCE_CATS } from '@/constants/costCategories';
import { fmtIdr, fmtNum } from '@/lib/formatters';

const CONFIDENCE_WEIGHT: Record<string, number> = { high: 1.0, medium: 0.6, low: 0.3 };

const RECENCY_OPTIONS: { label: string; days: number | null }[] = [
  { label: '30d', days: 30 },
  { label: '90d', days: 90 },
  { label: '1yr', days: 365 },
  { label: 'All', days: null },
];

// ─── Helpers ─────────────────────────────────────────────────────────────────
const fmtDate = (ts?: string) => ts ? new Date(ts).toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' }) : '—';
const pct     = (n: number) => `${n >= 0 ? '+' : ''}${n.toFixed(1)}%`;

function marginColor(m: number) {
  if (m < 0)   return 'text-red-400';
  if (m < 10)  return 'text-orange-400';
  if (m < 20)  return 'text-amber-300';
  if (m < 30)  return 'text-emerald-300';
  return 'text-emerald-400';
}

function marginBg(m: number) {
  if (m < 0)   return 'bg-red-500/10 border-red-500/20';
  if (m < 10)  return 'bg-orange-500/10 border-orange-500/20';
  if (m < 20)  return 'bg-amber-500/10 border-amber-500/20';
  return 'bg-emerald-500/10 border-emerald-500/20';
}

function vsTucColor(pctVal: number) {
  if (pctVal < 0)   return 'text-red-400';
  if (pctVal < 30)  return 'text-amber-400';
  return 'text-emerald-400';
}

// ─── Type definitions ─────────────────────────────────────────────────────────
interface NormalizedCompPrice extends CompetitorPrice {
  idrPrice: number;
}

interface MarketStats {
  minIdr: number;
  maxIdr: number;
  weightedAvgIdr: number | null;
  avgWpIdr: number | null;
  count: number;
  rmbSkipped: number;
}

// ─── Props ────────────────────────────────────────────────────────────────────
interface Props {
  components:       Component[];
  poItems:          PurchaseLineItem[];
  pos:              PurchaseOrder[];
  quoteItems:       PriceQuoteLineItem[];
  quotes:           PriceQuote[];
  poCosts:          POCost[];
  competitorPrices: CompetitorPrice[];
  isLoading:        boolean;
}

// ─── Stat card ────────────────────────────────────────────────────────────────
function StatCard({ label, value, sub, accent }: { label: string; value: string; sub?: string; accent?: string }) {
  return (
    <div className="bg-slate-900/60 border border-slate-800 rounded-xl p-4">
      <p className="text-[10px] font-bold uppercase tracking-widest text-slate-500 mb-1">{label}</p>
      <p className={`text-xl font-extrabold ${accent ?? 'text-white'}`}>{value}</p>
      {sub && <p className="text-xs text-slate-500 mt-0.5">{sub}</p>}
    </div>
  );
}

// ─── Pricing tier row ─────────────────────────────────────────────────────────
function TierRow({ label, desc, sellUsd, xr, tucIdr, marketAvgUsd, dimmed, primaryIdr }: {
  label: string; desc: string;
  sellUsd: number; xr: number; tucIdr: number;
  marketAvgUsd: number | null; dimmed?: boolean; primaryIdr?: boolean;
}) {
  const sellIdr  = sellUsd * xr;
  const gm       = tucIdr > 0 ? ((sellIdr - tucIdr) / sellIdr) * 100 : null;
  const markup   = tucIdr > 0 ? ((sellIdr - tucIdr) / tucIdr) * 100 : null;
  const vsMarket = marketAvgUsd ? ((sellUsd - marketAvgUsd) / marketAvgUsd) * 100 : null;

  return (
    <tr className={`border-b border-slate-800/60 ${dimmed ? 'opacity-50' : 'hover:bg-slate-800/20'} transition-colors`}>
      <td className="py-3 pr-4">
        <div className="text-sm font-bold text-white">{label}</div>
        <div className="text-[11px] text-slate-500">{desc}</div>
      </td>
      {primaryIdr ? (
        <>
          <td className="py-3 pr-4">
            <div className="text-sm font-semibold text-white">{fmtIdr(sellIdr)}</div>
            <div className="text-[11px] text-slate-600">USD {fmtNum(sellUsd)}</div>
          </td>
        </>
      ) : (
        <>
          <td className="py-3 pr-4">
            <div className="text-sm font-semibold text-white">USD {fmtNum(sellUsd, 2)}</div>
            <div className="text-[11px] text-slate-600">{fmtIdr(sellIdr)}</div>
          </td>
        </>
      )}
      <td className="py-3 pr-4">
        {gm !== null ? (
          <span className={`text-sm font-bold ${marginColor(gm)}`}>{pct(gm)}</span>
        ) : <span className="text-slate-600 text-sm">—</span>}
      </td>
      <td className="py-3 pr-4">
        {markup !== null ? (
          <span className="text-sm text-slate-300">{pct(markup)}</span>
        ) : <span className="text-slate-600 text-sm">—</span>}
      </td>
      <td className="py-3">
        {vsMarket !== null ? (
          <span className={`text-xs font-semibold ${vsMarket < -5 ? 'text-sky-400' : vsMarket > 10 ? 'text-violet-400' : 'text-slate-400'}`}>
            {pct(vsMarket)} vs mkt
          </span>
        ) : <span className="text-slate-600 text-xs">no market avg</span>}
      </td>
    </tr>
  );
}

// ─── Price band visualisation ─────────────────────────────────────────────────
function PriceBand({ tucIdr, xrUsd, floorUsd, market }: {
  tucIdr: number; xrUsd: number; floorUsd: number; market: MarketStats | null;
}) {
  const tucUsd       = tucIdr / xrUsd;
  const marketMinUsd = market ? market.minIdr / xrUsd : null;
  const marketMaxUsd = market ? market.maxIdr / xrUsd : null;
  const marketAvgUsd = market?.weightedAvgIdr ? market.weightedAvgIdr / xrUsd : null;

  const vals = [tucUsd, floorUsd, marketMinUsd, marketMaxUsd].filter((v): v is number => v !== null);
  const raw = { min: Math.min(...vals), max: Math.max(...vals) };
  const pad = (raw.max - raw.min) * 0.1 || 1;
  const barMin = raw.min - pad;
  const barMax = raw.max + pad;
  const range = barMax - barMin;

  const pos = (val: number) => `${Math.max(0, Math.min(100, ((val - barMin) / range) * 100)).toFixed(2)}%`;

  return (
    <div className="mb-6">
      <p className="text-[10px] font-bold uppercase tracking-widest text-slate-500 mb-3">Price Band</p>
      <div className="relative h-10 bg-slate-900/60 border border-slate-800 rounded-lg overflow-hidden">
        {/* Market range zone */}
        {marketMinUsd !== null && marketMaxUsd !== null && (
          <div
            className="absolute top-0 h-full bg-emerald-500/15 border-l border-r border-emerald-500/30"
            style={{
              left: pos(marketMinUsd),
              width: `${((marketMaxUsd - marketMinUsd) / range) * 100}%`,
            }}
          />
        )}
        {/* Market avg marker */}
        {marketAvgUsd !== null && (
          <div className="absolute top-0 h-full flex flex-col items-center" style={{ left: pos(marketAvgUsd), transform: 'translateX(-50%)' }}>
            <div className="w-0.5 h-full bg-emerald-400 opacity-80" />
          </div>
        )}
        {/* TUC marker */}
        <div className="absolute top-0 h-full flex flex-col items-center" style={{ left: pos(tucUsd), transform: 'translateX(-50%)' }}>
          <div className="w-0.5 h-full bg-sky-400" />
        </div>
        {/* Floor marker */}
        <div className="absolute top-0 h-full flex flex-col items-center" style={{ left: pos(floorUsd), transform: 'translateX(-50%)' }}>
          <div className="w-0.5 h-full bg-amber-400" />
        </div>
      </div>
      {/* Legend */}
      <div className="flex flex-wrap gap-x-4 gap-y-1 mt-2 text-[10px] text-slate-500">
        <span><span className="inline-block w-2.5 h-2.5 rounded-sm bg-sky-400 mr-1 align-middle" />TUC USD {fmtNum(tucUsd)}</span>
        <span><span className="inline-block w-2.5 h-2.5 rounded-sm bg-amber-400 mr-1 align-middle" />Floor USD {fmtNum(floorUsd)}</span>
        {marketMinUsd !== null && marketMaxUsd !== null && (
          <span><span className="inline-block w-2.5 h-2.5 rounded-sm bg-emerald-500/40 border border-emerald-500/50 mr-1 align-middle" />Mkt {fmtNum(marketMinUsd)}–{fmtNum(marketMaxUsd)}</span>
        )}
        {marketAvgUsd !== null && (
          <span><span className="inline-block w-2.5 h-0.5 bg-emerald-400 mr-1 align-middle" />Mkt avg USD {fmtNum(marketAvgUsd)}</span>
        )}
      </div>
    </div>
  );
}

// ─── Main component ───────────────────────────────────────────────────────────
export default function PricingIntelligence({
  components, poItems, pos, quoteItems, quotes, poCosts, competitorPrices, isLoading,
}: Props) {
  const [query,          setQuery]          = useState('');
  const [selected,       setSelected]       = useState<Component | null>(null);
  const [showDrop,       setShowDrop]       = useState(false);
  const { history, push: pushHistory, clear: clearHistory } = useSearchHistory('pricing-lookup-history');
  const [simPriceIdr,    setSimPriceIdr]    = useState('');
  const [simXrStr,       setSimXrStr]       = useState('');
  const [targetMarginPct, setTargetMarginPct] = useState('');
  const [minMarginPct,   setMinMarginPct]   = useState('15');
  const [recencyDays,    setRecencyDays]    = useState<number | null>(90);
  const [tierShowIdr,    setTierShowIdr]    = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const h = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) setShowDrop(false);
    };
    document.addEventListener('mousedown', h);
    return () => document.removeEventListener('mousedown', h);
  }, []);

  // ── Component search candidates ──────────────────────────────────────
  const candidates = useMemo(() => {
    const q = query.toLowerCase().trim();
    if (!q) return [];
    return components.filter((c) =>
      c.supplier_model?.toLowerCase().includes(q) ||
      c.internal_description?.toLowerCase().includes(q) ||
      c.brand?.toLowerCase().includes(q)
    ).slice(0, 20);
  }, [query, components]);

  const selectComp = (c: Component) => {
    setSelected(c);
    setQuery(c.internal_description || c.supplier_model);
    setShowDrop(false);
    setSimPriceIdr('');
    setSimXrStr('');
    setTargetMarginPct('');
    pushHistory({ componentId: c.component_id, label: c.internal_description || c.supplier_model, sublabel: c.supplier_model });
  };

  // ── Components that have competitor price data (for empty-state suggestions) ──
  const withCompetitorData = useMemo(() => {
    const latestByComp: Record<string, string> = {};
    const countByComp: Record<string, number>  = {};
    for (const cp of competitorPrices) {
      if (!cp.component_id) continue;
      countByComp[cp.component_id] = (countByComp[cp.component_id] ?? 0) + 1;
      if (!latestByComp[cp.component_id] || cp.observed_at > latestByComp[cp.component_id]) {
        latestByComp[cp.component_id] = cp.observed_at;
      }
    }
    return components
      .filter((c) => countByComp[c.component_id] > 0)
      .sort((a, b) => (latestByComp[b.component_id] ?? '').localeCompare(latestByComp[a.component_id] ?? ''))
      .slice(0, 6)
      .map((c) => ({ comp: c, count: countByComp[c.component_id], latestDate: latestByComp[c.component_id] }));
  }, [components, competitorPrices]);

  // ── TUC calculation (mirrors ProductCostLookup) ──────────────────────
  const { tucIdr, xrUsd, latestPoDate } = useMemo(() => {
    if (!selected) return { tucIdr: null, xrUsd: null, latestPoDate: null };

    const myItems = poItems.filter((i) => i.component_id === selected.component_id);

    interface AllocRow {
      tuc: number;
      qty: number;
      hasBalance: boolean;
      po: PurchaseOrder;
    }

    const allocs = myItems.map((item): AllocRow | null => {
      const po = pos.find((p) => p.po_id === item.po_id);
      if (!po) return null;
      const allPoItems = poItems.filter((i) => i.po_id === item.po_id && i.quantity > 0);
      const totalForeign = allPoItems.reduce((s, i) => s + i.unit_cost * i.quantity, 0);
      const lineForeign  = item.unit_cost * item.quantity;
      const share = totalForeign > 0 ? lineForeign / totalForeign : 0;
      const costs = poCosts.filter((c) => c.po_id === item.po_id);
      const hasBalance = costs.some((c) => BALANCE_CATS.has(c.cost_category));
      const principal  = costs.filter((c) => PRINCIPAL_CATS.has(c.cost_category)).reduce((s, c) => s + c.amount, 0);
      const bankFees   = costs.filter((c) => BANK_FEE_CATS.has(c.cost_category)).reduce((s, c) => s + c.amount, 0);
      const landed     = costs.filter((c) => !PRINCIPAL_CATS.has(c.cost_category) && !BANK_FEE_CATS.has(c.cost_category) && !TAX_CATS.has(c.cost_category)).reduce((s, c) => s + c.amount, 0);
      const tuc        = item.quantity > 0 ? (share * (principal + bankFees + landed)) / item.quantity : 0;
      return { tuc, qty: item.quantity, hasBalance, po };
    }).filter((a): a is AllocRow => a !== null);

    const paidAllocs = allocs.filter((a) => a.hasBalance && a.tuc > 0);
    if (paidAllocs.length === 0) return { tucIdr: null, xrUsd: null, latestPoDate: null };

    const weighted = paidAllocs.reduce((s, a) => s + a.tuc * a.qty, 0);
    const qty      = paidAllocs.reduce((s, a) => s + a.qty, 0);
    const avgTuc   = qty > 0 ? weighted / qty : null;

    // Use exchange rate from the most recent paid PO (IDR per foreign currency)
    const latestAlloc = [...paidAllocs].sort((a, b) => b.po.po_date.localeCompare(a.po.po_date))[0];
    const xr = latestAlloc?.po.exchange_rate ?? null;
    const latestDate = latestAlloc?.po.po_date ?? null;

    return { tucIdr: avgTuc, xrUsd: xr, latestPoDate: latestDate };
  }, [selected, poItems, pos, poCosts]);

  // ── Supplier quote history for this component ───────────────────────
  const quoteHistory = useMemo(() => {
    if (!selected) return [];

    interface QuoteRow extends PriceQuoteLineItem {
      quote: PriceQuote;
    }

    return quoteItems
      .filter((qi) => qi.component_id === selected.component_id)
      .map((qi): QuoteRow | null => {
        const q = quotes.find((qr) => qr.quote_id === qi.quote_id);
        return q ? { ...qi, quote: q } : null;
      })
      .filter((qi): qi is QuoteRow => qi !== null)
      .sort((a, b) => b.quote.quote_date.localeCompare(a.quote.quote_date));
  }, [selected, quoteItems, quotes]);

  // ── All competitor prices for this component (raw, sorted by date) ───
  const compPrices = useMemo(() => {
    if (!selected) return [];
    return competitorPrices
      .filter((p) => p.component_id === selected.component_id)
      .sort((a, b) => b.observed_at.localeCompare(a.observed_at));
  }, [selected, competitorPrices]);

  // ── Recency-filtered competitor prices (for market stats + table) ────
  const filteredCompPrices = useMemo(() => {
    if (recencyDays === null) return compPrices;
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - recencyDays);
    const cutoffStr = cutoff.toISOString().slice(0, 10);
    return compPrices.filter((p) => p.observed_at >= cutoffStr);
  }, [compPrices, recencyDays]);

  // ── Market stats (IDR-normalised, confidence-weighted) ───────────────
  const market = useMemo((): MarketStats | null => {
    if (filteredCompPrices.length === 0 || !xrUsd) return null;

    const xr = xrUsd;
    const rmbSkipped = filteredCompPrices.filter((p) => p.currency === 'RMB').length;

    const normalized: NormalizedCompPrice[] = filteredCompPrices
      .filter((p) => p.unit_price > 0 && p.currency !== 'RMB')
      .map((p) => ({
        ...p,
        idrPrice: p.currency === 'IDR' ? p.unit_price : p.unit_price * xr,
      }));

    if (normalized.length === 0) return null;

    const idrPrices = normalized.map((p) => p.idrPrice);
    const minIdr = Math.min(...idrPrices);
    const maxIdr = Math.max(...idrPrices);

    let wSum = 0, wTotal = 0;
    for (const p of normalized) {
      const w = CONFIDENCE_WEIGHT[p.confidence ?? 'medium'] ?? 0.6;
      wSum   += p.idrPrice * w;
      wTotal += w;
    }
    const weightedAvgIdr = wTotal > 0 ? wSum / wTotal : null;

    const withWp = normalized.filter((p) => p.capacity_w !== undefined && p.capacity_w !== null && p.capacity_w > 0);
    const avgWpIdr = withWp.length > 0
      ? withWp.reduce((s, p) => s + p.idrPrice / p.capacity_w!, 0) / withWp.length
      : null;

    return { minIdr, maxIdr, weightedAvgIdr, avgWpIdr, count: normalized.length, rmbSkipped };
  }, [filteredCompPrices, xrUsd]);

  // ── Simulator effective exchange rate (manual override or PO-derived) ──
  const effectiveXr = useMemo(() => {
    const manual = parseFloat(simXrStr);
    if (manual > 0) return manual;
    return xrUsd;
  }, [simXrStr, xrUsd]);

  // ── Sell price simulator (IDR input) ────────────────────────────────
  const sim = useMemo(() => {
    const priceIdr = parseFloat(simPriceIdr);
    if (!priceIdr || isNaN(priceIdr) || !effectiveXr) return null;
    const priceUsd  = priceIdr / effectiveXr;
    const gm        = tucIdr ? ((priceIdr - tucIdr) / priceIdr) * 100 : null;
    const markup    = tucIdr ? ((priceIdr - tucIdr) / tucIdr) * 100 : null;
    const mktAvgIdr = market?.weightedAvgIdr ?? null;
    const vsMarket  = mktAvgIdr ? ((priceIdr - mktAvgIdr) / mktAvgIdr) * 100 : null;
    return { priceIdr, priceUsd, gm, markup, vsMarket };
  }, [simPriceIdr, effectiveXr, tucIdr, market]);

  // ── Target margin reverse calculator ────────────────────────────────
  const targetPriceIdr = useMemo(() => {
    const margin = parseFloat(targetMarginPct) / 100;
    if (!margin || isNaN(margin) || margin >= 1 || !tucIdr || !effectiveXr) return null;
    const priceIdr = tucIdr / (1 - margin);
    const priceUsd = priceIdr / effectiveXr;
    return { priceIdr, priceUsd };
  }, [targetMarginPct, tucIdr, effectiveXr]);

  // ── Pricing tiers ────────────────────────────────────────────────────
  const minMargin = parseFloat(minMarginPct) / 100 || 0.15;
  const tiers = useMemo(() => {
    if (!tucIdr || !xrUsd || xrUsd === 0) return null;
    const tucUsd = tucIdr / xrUsd;
    const floor  = tucUsd / (1 - minMargin);

    return {
      floor,
      tucUsd,
      economy:     market ? Math.max(floor, market.minIdr / xrUsd) : null,
      competitive: market?.weightedAvgIdr ? Math.max(floor, market.weightedAvgIdr / xrUsd * 0.97) : null,
      standard:    market?.weightedAvgIdr ? Math.max(floor, market.weightedAvgIdr / xrUsd * 1.02) : null,
      premium:     market ? Math.max(floor, market.maxIdr / xrUsd * 1.05) : null,
    };
  }, [tucIdr, xrUsd, market, minMargin]);

  const marketAvgUsd = market?.weightedAvgIdr && xrUsd ? market.weightedAvgIdr / xrUsd : null;
  const hasData = selected && (compPrices.length > 0 || tucIdr !== null);

  return (
    <div className="space-y-8">
      {/* ── Component search ── */}
      <div ref={containerRef} className="relative z-20 max-w-3xl">
        <label className="block text-xs font-semibold text-slate-400 mb-2 uppercase tracking-widest">
          Select Component
        </label>
        <div className="relative shadow-xl shadow-black/20 rounded-2xl">
          <input
            type="text" value={query} disabled={isLoading}
            onChange={(e) => { setQuery(e.target.value); setShowDrop(true); if (!e.target.value) { setSelected(null); } }}
            onFocus={() => setShowDrop(true)}
            placeholder="Search by SKU, description, or brand…"
            className="w-full bg-slate-900/80 border border-slate-700/80 rounded-2xl px-5 py-4 pl-12 text-white placeholder-slate-500 focus:outline-none focus:border-sky-500 focus:ring-4 focus:ring-sky-500/20 transition-all text-sm md:text-base"
          />
          <svg className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-slate-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
          </svg>
        </div>
        {showDrop && (candidates.length > 0 || (!query.trim() && (withCompetitorData.length > 0 || history.length > 0))) && (
          <ul className="absolute z-50 mt-2 w-full bg-slate-800/95 border border-slate-700 rounded-xl shadow-2xl overflow-auto max-h-80 ring-1 ring-white/10">

            {/* ── Search results ── */}
            {query.trim() && candidates.map((c) => (
              <li key={c.component_id} onMouseDown={() => selectComp(c)}
                className="px-5 py-3.5 hover:bg-slate-700/50 cursor-pointer border-b border-slate-700/50 last:border-0 transition-colors group"
              >
                <div className="text-white text-sm font-semibold group-hover:text-sky-300 transition-colors">{c.internal_description}</div>
                <div className="text-slate-400 text-xs mt-0.5">{c.supplier_model}{c.brand ? ` · ${c.brand}` : ''}</div>
              </li>
            ))}

            {/* ── Empty state: competitor data + recent searches ── */}
            {!query.trim() && (
              <>
                {withCompetitorData.length > 0 && (
                  <>
                    <li className="px-4 pt-3 pb-1.5">
                      <span className="text-[10px] font-semibold uppercase tracking-widest text-amber-500/80">Has Competitor Data</span>
                    </li>
                    {withCompetitorData.map(({ comp, count, latestDate }) => (
                      <li key={comp.component_id} onMouseDown={() => selectComp(comp)}
                        className="px-4 py-3 hover:bg-slate-700/50 cursor-pointer border-b border-slate-700/50 last:border-0 transition-colors group flex items-start gap-3"
                      >
                        <span className="text-amber-500/60 text-xs mt-0.5 flex-shrink-0">📈</span>
                        <div className="flex-1 min-w-0">
                          <p className="text-white text-sm font-semibold group-hover:text-sky-300 transition-colors truncate">{comp.internal_description}</p>
                          <p className="text-slate-400 text-xs mt-0.5">{comp.supplier_model}{comp.brand ? ` · ${comp.brand}` : ''}</p>
                        </div>
                        <div className="text-right flex-shrink-0">
                          <p className="text-[10px] text-amber-400 font-semibold">{count} price{count !== 1 ? 's' : ''}</p>
                          {latestDate && <p className="text-[10px] text-slate-600">{latestDate.slice(0, 10)}</p>}
                        </div>
                      </li>
                    ))}
                  </>
                )}

                {history.length > 0 && (
                  <>
                    <li className="px-4 pt-3 pb-1.5 flex items-center justify-between">
                      <span className="text-[10px] font-semibold uppercase tracking-widest text-slate-500">Recent Searches</span>
                      <button onMouseDown={clearHistory} className="text-[10px] text-slate-600 hover:text-slate-400 transition-colors">Clear</button>
                    </li>
                    {history.map((h) => {
                      const comp = components.find((c) => c.component_id === h.componentId);
                      if (!comp) return null;
                      return (
                        <li key={h.componentId} onMouseDown={() => selectComp(comp)}
                          className="px-4 py-3 hover:bg-slate-700/50 cursor-pointer border-b border-slate-700/50 last:border-0 transition-colors group flex items-start gap-3"
                        >
                          <span className="text-slate-500 text-xs mt-0.5 flex-shrink-0">🕐</span>
                          <div>
                            <p className="text-white text-sm font-semibold group-hover:text-sky-300 transition-colors">{h.label}</p>
                            {h.sublabel && h.sublabel !== h.label && <p className="text-slate-400 text-xs mt-0.5">{h.sublabel}</p>}
                          </div>
                        </li>
                      );
                    })}
                  </>
                )}
              </>
            )}
          </ul>
        )}
      </div>

      {/* ── Empty state ── */}
      {!selected && (
        <div className="bg-slate-900/40 border border-slate-800/60 rounded-2xl p-10 text-center">
          <p className="text-2xl mb-3">📊</p>
          <p className="text-slate-400 text-sm font-medium">Search for a component to see pricing intelligence</p>
          <p className="text-slate-600 text-xs mt-1">Shows TUC, competitor market data, margin tiers, and sell price simulator</p>
        </div>
      )}

      {selected && !hasData && (
        <div className="bg-slate-900/40 border border-slate-800/60 rounded-2xl p-8 text-center">
          <p className="text-slate-400 text-sm">No PO cost data or competitor prices found for this component.</p>
          <p className="text-slate-600 text-xs mt-1">Log PO costs in Financials and competitor prices in Market Intel to unlock analysis.</p>
          <Link href="/insert?tab=market-intel" className="inline-block mt-4 px-4 py-2 bg-sky-500/10 hover:bg-sky-500/20 border border-sky-500/30 text-sky-400 text-xs font-semibold rounded-lg transition-colors">
            + Log competitor price
          </Link>
        </div>
      )}

      {selected && hasData && (
        <>
          {/* ── Summary cards ── */}
          <div>
            <h3 className="text-sm font-bold text-white mb-3">{selected.internal_description}</h3>
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
              <StatCard
                label="True Unit Cost (TUC)"
                value={tucIdr ? fmtIdr(tucIdr) : 'Incomplete'}
                sub={tucIdr && xrUsd ? `≈ USD ${fmtNum(tucIdr / xrUsd)} @ ${xrUsd.toLocaleString()}/USD` : 'Need balance payment + landed costs'}
                accent={tucIdr ? 'text-sky-300' : 'text-slate-600'}
              />
              <StatCard
                label="Exchange Rate Used"
                value={xrUsd ? `IDR ${xrUsd.toLocaleString()}` : '—'}
                sub={latestPoDate ? `From PO: ${fmtDate(latestPoDate)}` : 'No paid PO found'}
              />
              <StatCard
                label="Market Average (IDR, weighted)"
                value={market?.weightedAvgIdr ? fmtIdr(market.weightedAvgIdr) : '—'}
                sub={
                  market
                    ? `${market.count} data point${market.count !== 1 ? 's' : ''}${market.rmbSkipped > 0 ? ` · ${market.rmbSkipped} RMB skipped` : ''} · range ${fmtIdr(market.minIdr)}–${fmtIdr(market.maxIdr)}`
                    : filteredCompPrices.length > 0
                      ? 'All entries are RMB (not supported yet)'
                      : 'No competitor prices in this period'
                }
                accent={market ? 'text-amber-300' : 'text-slate-600'}
              />
              <StatCard
                label="Avg Market Price / Wp"
                value={market?.avgWpIdr && xrUsd ? `USD ${(market.avgWpIdr / xrUsd).toFixed(4)}/Wp` : '—'}
                sub={market?.avgWpIdr ? 'From entries with Wp set' : 'Set Capacity (Wp) in Market Intel entries'}
              />
            </div>
          </div>

          {/* ── Price band + tiers ── */}
          {tucIdr && xrUsd && tiers ? (
            <div className="bg-[#0d1829] border border-slate-800/80 rounded-2xl p-5 md:p-6">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-5">
                <div>
                  <h3 className="text-sm font-bold text-white">Pricing Tiers</h3>
                  <p className="text-xs text-slate-500 mt-0.5">Based on TUC + market data. Gross margin = (Sell − TUC) / Sell.</p>
                </div>
                <div className="flex items-center gap-3 flex-wrap justify-end">
                  {/* IDR / USD toggle */}
                  <div className="flex rounded-lg overflow-hidden border border-slate-700 text-[11px] font-semibold">
                    <button
                      onClick={() => setTierShowIdr(false)}
                      className={`px-3 py-1.5 transition-colors ${!tierShowIdr ? 'bg-sky-500/20 text-sky-300' : 'bg-slate-800/60 text-slate-400 hover:text-slate-300'}`}
                    >USD</button>
                    <button
                      onClick={() => setTierShowIdr(true)}
                      className={`px-3 py-1.5 transition-colors ${tierShowIdr ? 'bg-sky-500/20 text-sky-300' : 'bg-slate-800/60 text-slate-400 hover:text-slate-300'}`}
                    >IDR</button>
                  </div>
                  <label className="flex items-center gap-2 text-xs text-slate-400 flex-shrink-0">
                    <span className="font-semibold">Min. margin:</span>
                    <input
                      type="number" min="0" max="100" step="1"
                      value={minMarginPct}
                      onChange={(e) => setMinMarginPct(e.target.value)}
                      className="w-14 px-2 py-1 bg-slate-900 border border-slate-700 rounded-lg text-white text-xs focus:outline-none focus:ring-2 focus:ring-sky-500/30"
                    />
                    <span>%</span>
                  </label>
                </div>
              </div>
              <PriceBand tucIdr={tucIdr} xrUsd={xrUsd} floorUsd={tiers.floor} market={market} />
              <div className="overflow-x-auto">
                <table className="w-full border-collapse">
                  <thead>
                    <tr className="border-b border-slate-700">
                      <th className="text-left py-2 pr-4 text-[11px] font-bold uppercase tracking-wider text-slate-500">Tier</th>
                      <th className="text-left py-2 pr-4 text-[11px] font-bold uppercase tracking-wider text-slate-500">
                        {tierShowIdr ? 'IDR / unit' : 'USD / unit'}
                      </th>
                      <th className="text-left py-2 pr-4 text-[11px] font-bold uppercase tracking-wider text-slate-500">Gross Margin</th>
                      <th className="text-left py-2 pr-4 text-[11px] font-bold uppercase tracking-wider text-slate-500">Markup</th>
                      <th className="text-left py-2 text-[11px] font-bold uppercase tracking-wider text-slate-500">vs Market</th>
                    </tr>
                  </thead>
                  <tbody>
                    <TierRow
                      label="Floor"
                      desc={`TUC + ${minMarginPct}% min margin`}
                      sellUsd={tiers.floor}
                      xr={xrUsd}
                      tucIdr={tucIdr}
                      marketAvgUsd={marketAvgUsd}
                      primaryIdr={tierShowIdr}
                    />
                    {tiers.economy !== null && (
                      <TierRow label="Economy" desc="Match market low" sellUsd={tiers.economy} xr={xrUsd} tucIdr={tucIdr} marketAvgUsd={marketAvgUsd} primaryIdr={tierShowIdr} />
                    )}
                    {tiers.competitive !== null && (
                      <TierRow label="Competitive" desc="3% below market avg" sellUsd={tiers.competitive} xr={xrUsd} tucIdr={tucIdr} marketAvgUsd={marketAvgUsd} primaryIdr={tierShowIdr} />
                    )}
                    {tiers.standard !== null && (
                      <TierRow label="Standard" desc="At market avg (+2%)" sellUsd={tiers.standard} xr={xrUsd} tucIdr={tucIdr} marketAvgUsd={marketAvgUsd} primaryIdr={tierShowIdr} />
                    )}
                    {tiers.premium !== null && (
                      <TierRow label="Premium" desc="Above market high (+5%)" sellUsd={tiers.premium} xr={xrUsd} tucIdr={tucIdr} marketAvgUsd={marketAvgUsd} primaryIdr={tierShowIdr} />
                    )}
                    {!market && (
                      <tr>
                        <td colSpan={5} className="py-4 text-center text-xs text-slate-600">
                          Add competitor prices in Market Intel to unlock Economy / Competitive / Standard / Premium tiers
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          ) : (
            <div className="bg-slate-900/40 border border-slate-800/60 rounded-xl p-5">
              <p className="text-sm text-slate-500">Pricing tiers require TUC data (balance payment + landed costs in Financials).</p>
            </div>
          )}

          {/* ── Sell price simulator + target margin calculator ── */}
          {tucIdr && xrUsd && (
            <div className="bg-[#0d1829] border border-slate-800/80 rounded-2xl p-5 md:p-6 space-y-5">
              <div>
                <h3 className="text-sm font-bold text-white mb-0.5">Sell Price Tools</h3>
                <p className="text-xs text-slate-500">Simulate any sell price in IDR, or reverse-calculate from a target margin.</p>
              </div>

              {/* FX rate override */}
              <div className="flex items-center gap-3 flex-wrap">
                <span className="text-xs text-slate-400 font-semibold flex-shrink-0">USD/IDR rate:</span>
                <div className="flex items-center gap-2">
                  <input
                    type="number" min="1" step="1"
                    value={simXrStr}
                    onChange={(e) => setSimXrStr(e.target.value)}
                    placeholder={xrUsd ? xrUsd.toLocaleString() : '—'}
                    className="w-32 px-3 py-1.5 bg-slate-950 border border-slate-700 rounded-lg text-white text-xs font-mono focus:outline-none focus:ring-2 focus:ring-amber-500/30 focus:border-amber-500/50"
                  />
                  {simXrStr && parseFloat(simXrStr) > 0 && (
                    <>
                      <span className="text-[11px] text-amber-400 font-semibold">custom rate active</span>
                      <button onClick={() => setSimXrStr('')} className="text-[11px] text-slate-500 hover:text-slate-300 transition-colors">reset</button>
                    </>
                  )}
                  {(!simXrStr || !(parseFloat(simXrStr) > 0)) && (
                    <span className="text-[11px] text-slate-600">from PO — override for scenario planning</span>
                  )}
                </div>
              </div>

              {/* Simulator: IDR input */}
              <div>
                <p className="text-[11px] font-semibold text-slate-400 uppercase tracking-widest mb-2">Price Simulator</p>
                <div className="flex flex-col sm:flex-row gap-4 items-start">
                  <div className="flex items-center gap-2">
                    <span className="text-sm text-slate-400 font-semibold w-8">IDR</span>
                    <input
                      type="number" min="0" step="1000"
                      value={simPriceIdr}
                      onChange={(e) => setSimPriceIdr(e.target.value)}
                      placeholder="e.g. 1,200,000"
                      className="w-44 px-4 py-2.5 bg-slate-950 border border-slate-700 rounded-xl text-white text-base font-semibold focus:outline-none focus:ring-2 focus:ring-sky-500/30 focus:border-sky-500"
                    />
                  </div>
                  {sim ? (
                    <div className="flex flex-wrap gap-3">
                      <div className={`rounded-xl border px-4 py-2 ${marginBg(sim.gm ?? 0)}`}>
                        <p className="text-[10px] text-slate-500 uppercase font-bold tracking-wider mb-0.5">Gross Margin</p>
                        <p className={`text-lg font-extrabold ${marginColor(sim.gm ?? 0)}`}>{sim.gm !== null ? pct(sim.gm) : '—'}</p>
                      </div>
                      <div className="rounded-xl border border-slate-700 bg-slate-900/60 px-4 py-2">
                        <p className="text-[10px] text-slate-500 uppercase font-bold tracking-wider mb-0.5">Markup</p>
                        <p className="text-lg font-extrabold text-white">{sim.markup !== null ? pct(sim.markup) : '—'}</p>
                      </div>
                      <div className="rounded-xl border border-slate-700 bg-slate-900/60 px-4 py-2">
                        <p className="text-[10px] text-slate-500 uppercase font-bold tracking-wider mb-0.5">≈ USD</p>
                        <p className="text-sm font-bold text-slate-300">USD {fmtNum(sim.priceUsd)}</p>
                        <p className="text-[10px] text-slate-600">@ {(effectiveXr ?? xrUsd)?.toLocaleString()}/USD</p>
                      </div>
                      {sim.vsMarket !== null && (
                        <div className={`rounded-xl border px-4 py-2 ${sim.vsMarket < -5 ? 'bg-sky-500/10 border-sky-500/20' : sim.vsMarket > 10 ? 'bg-violet-500/10 border-violet-500/20' : 'bg-slate-900/60 border-slate-700'}`}>
                          <p className="text-[10px] text-slate-500 uppercase font-bold tracking-wider mb-0.5">vs Market Avg</p>
                          <p className={`text-lg font-extrabold ${sim.vsMarket < -5 ? 'text-sky-400' : sim.vsMarket > 10 ? 'text-violet-400' : 'text-slate-300'}`}>
                            {pct(sim.vsMarket)}
                          </p>
                        </div>
                      )}
                    </div>
                  ) : (
                    <p className="text-slate-600 text-sm self-center">Enter an IDR price to see results</p>
                  )}
                </div>
              </div>

              {/* Target margin reverse calculator */}
              <div className="border-t border-slate-800 pt-4">
                <p className="text-[11px] font-semibold text-slate-400 uppercase tracking-widest mb-2">Target Margin → Price</p>
                <div className="flex flex-col sm:flex-row gap-4 items-start">
                  <div className="flex items-center gap-2">
                    <input
                      type="number" min="1" max="99" step="1"
                      value={targetMarginPct}
                      onChange={(e) => setTargetMarginPct(e.target.value)}
                      placeholder="e.g. 30"
                      className="w-24 px-3 py-2 bg-slate-950 border border-slate-700 rounded-xl text-white text-base font-semibold focus:outline-none focus:ring-2 focus:ring-emerald-500/30 focus:border-emerald-500/50"
                    />
                    <span className="text-sm text-slate-400 font-semibold">% margin</span>
                  </div>
                  {targetPriceIdr ? (
                    <div className="flex flex-wrap gap-3">
                      <div className="rounded-xl border border-emerald-500/30 bg-emerald-500/10 px-4 py-2">
                        <p className="text-[10px] text-emerald-600 uppercase font-bold tracking-wider mb-0.5">Sell Price (IDR)</p>
                        <p className="text-lg font-extrabold text-emerald-300">{fmtIdr(targetPriceIdr.priceIdr)}</p>
                      </div>
                      <div className="rounded-xl border border-slate-700 bg-slate-900/60 px-4 py-2">
                        <p className="text-[10px] text-slate-500 uppercase font-bold tracking-wider mb-0.5">≈ USD</p>
                        <p className="text-sm font-bold text-slate-300">USD {fmtNum(targetPriceIdr.priceUsd)}</p>
                      </div>
                      {market?.weightedAvgIdr && (
                        <div className="rounded-xl border border-slate-700 bg-slate-900/60 px-4 py-2">
                          <p className="text-[10px] text-slate-500 uppercase font-bold tracking-wider mb-0.5">vs Market Avg</p>
                          <p className={`text-sm font-bold ${vsTucColor(((targetPriceIdr.priceIdr - market.weightedAvgIdr) / market.weightedAvgIdr) * 100)}`}>
                            {pct(((targetPriceIdr.priceIdr - market.weightedAvgIdr) / market.weightedAvgIdr) * 100)}
                          </p>
                        </div>
                      )}
                    </div>
                  ) : (
                    <p className="text-slate-600 text-sm self-center">Enter a target gross margin % to get the required price</p>
                  )}
                </div>
              </div>
            </div>
          )}

          {/* ── Competitor prices table ── */}
          <div className="bg-[#0d1829] border border-slate-800/80 rounded-2xl overflow-hidden">
            {/* Header with recency filters + log link */}
            <div className="px-5 py-4 border-b border-slate-800 flex flex-col sm:flex-row sm:items-center gap-3 justify-between">
              <div>
                <h3 className="text-sm font-bold text-white">
                  Market Intel Entries ({filteredCompPrices.length}{recencyDays !== null && compPrices.length !== filteredCompPrices.length ? ` of ${compPrices.length}` : ''})
                </h3>
                <p className="text-xs text-slate-500 mt-0.5">Sorted by most recent observation · prices normalised to IDR @ {xrUsd ? xrUsd.toLocaleString() : '—'}/USD</p>
              </div>
              <div className="flex items-center gap-2 flex-wrap">
                {/* Recency chips */}
                <div className="flex gap-1">
                  {RECENCY_OPTIONS.map((opt) => (
                    <button
                      key={opt.label}
                      onClick={() => setRecencyDays(opt.days)}
                      className={`px-2.5 py-1 rounded-md text-[11px] font-semibold transition-colors ${
                        recencyDays === opt.days
                          ? 'bg-sky-500/20 border border-sky-500/40 text-sky-300'
                          : 'bg-slate-800/60 border border-slate-700/60 text-slate-400 hover:text-slate-300'
                      }`}
                    >
                      {opt.label}
                    </button>
                  ))}
                </div>
                <Link
                  href="/insert?tab=market-intel"
                  className="px-3 py-1 bg-sky-500/10 hover:bg-sky-500/20 border border-sky-500/30 text-sky-400 text-[11px] font-semibold rounded-md transition-colors whitespace-nowrap"
                >
                  + Log price
                </Link>
              </div>
            </div>

            {filteredCompPrices.length === 0 ? (
              <div className="p-8 text-center">
                <p className="text-slate-500 text-sm">
                  {compPrices.length > 0
                    ? `No entries in the last ${recencyDays === 365 ? '1 year' : `${recencyDays} days`}. Try a wider period.`
                    : 'No competitor prices logged for this component yet.'}
                </p>
                {compPrices.length === 0 && (
                  <Link href="/insert?tab=market-intel" className="inline-block mt-3 px-4 py-2 bg-sky-500/10 hover:bg-sky-500/20 border border-sky-500/30 text-sky-400 text-xs font-semibold rounded-lg transition-colors">
                    + Log competitor price
                  </Link>
                )}
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full border-collapse text-xs">
                  <thead className="bg-slate-900/60">
                    <tr>
                      {['Observed', 'Competitor', 'Price', 'Equiv.', 'vs TUC', '$/Wp', 'Incoterms', 'Type', 'Source', 'Region', 'Confidence', 'Notes'].map((h) => (
                        <th key={h} className="px-4 py-2.5 text-left font-bold uppercase tracking-wider text-slate-500 whitespace-nowrap">{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-800/60">
                    {filteredCompPrices.map((p) => {
                      const idrPrice   = p.currency === 'IDR' ? p.unit_price
                                       : p.currency === 'USD' && xrUsd ? p.unit_price * xrUsd
                                       : null;
                      const usdEquiv   = p.currency === 'USD' ? null
                                       : p.currency === 'IDR' && xrUsd ? p.unit_price / xrUsd
                                       : null;
                      const pricePerWp = p.capacity_w && p.capacity_w > 0 && idrPrice && xrUsd
                                       ? idrPrice / xrUsd / p.capacity_w
                                       : null;
                      const vsTucPct   = tucIdr && idrPrice ? (idrPrice / tucIdr) * 100 - 100 : null;
                      const confColor  = p.confidence === 'high' ? 'text-emerald-400' : p.confidence === 'low' ? 'text-rose-400' : 'text-amber-400';

                      return (
                        <tr key={p.competitor_price_id} className="hover:bg-slate-800/20 transition-colors">
                          <td className="px-4 py-3 text-slate-400 whitespace-nowrap">{fmtDate(p.observed_at)}</td>
                          <td className="px-4 py-3">
                            <div className="font-semibold text-white">{p.competitor_brand || '—'}</div>
                            {p.competitor_model && <div className="text-slate-500 text-[11px]">{p.competitor_model}</div>}
                          </td>
                          <td className="px-4 py-3 font-semibold text-white whitespace-nowrap">
                            {p.currency} {fmtNum(p.unit_price)}
                          </td>
                          <td className="px-4 py-3 whitespace-nowrap">
                            {p.currency === 'IDR' && usdEquiv !== null && (
                              <span className="text-slate-400">≈ USD {fmtNum(usdEquiv)}</span>
                            )}
                            {p.currency === 'USD' && idrPrice !== null && (
                              <span className="text-slate-400">{fmtIdr(idrPrice)}</span>
                            )}
                            {p.currency === 'RMB' && (
                              <span className="text-slate-600 text-[11px]">not converted</span>
                            )}
                            {((p.currency === 'IDR' && usdEquiv === null) || (p.currency === 'USD' && idrPrice === null)) && (
                              <span className="text-slate-600">—</span>
                            )}
                          </td>
                          <td className="px-4 py-3 whitespace-nowrap">
                            {vsTucPct !== null ? (
                              <span className={`font-semibold ${vsTucColor(vsTucPct)}`}>{pct(vsTucPct)}</span>
                            ) : <span className="text-slate-600">—</span>}
                          </td>
                          <td className="px-4 py-3 text-slate-400 whitespace-nowrap">
                            {pricePerWp ? `USD ${pricePerWp.toFixed(4)}` : '—'}
                          </td>
                          <td className="px-4 py-3 text-slate-400">{p.incoterms || '—'}</td>
                          <td className="px-4 py-3 text-slate-400">{p.price_type?.replace(/_/g, ' ') || '—'}</td>
                          <td className="px-4 py-3">
                            <div className="text-slate-300">{p.source_name || '—'}</div>
                            {p.source_type && <div className="text-slate-600 text-[11px]">{p.source_type.replace(/_/g, ' ')}</div>}
                          </td>
                          <td className="px-4 py-3 text-slate-400">{p.region || '—'}</td>
                          <td className={`px-4 py-3 font-semibold capitalize ${confColor}`}>{p.confidence || '—'}</td>
                          <td className="px-4 py-3 text-slate-500 max-w-[200px] truncate">{p.notes || '—'}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          {/* ── Supplier quote history ── */}
          {quoteHistory.length > 0 && (
            <div className="bg-[#0d1829] border border-slate-800/80 rounded-2xl overflow-hidden">
              <div className="px-5 py-4 border-b border-slate-800">
                <h3 className="text-sm font-bold text-white">Supplier Quote History ({quoteHistory.length})</h3>
                <p className="text-xs text-slate-500 mt-0.5">
                  Prices quoted by suppliers for this component · IDR equiv. uses current PO rate
                  {xrUsd ? ` @ ${xrUsd.toLocaleString()}/USD` : ''}
                </p>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full border-collapse text-xs">
                  <thead className="bg-slate-900/60">
                    <tr>
                      {['Date', 'PI / Quote #', 'Quoted Price', 'IDR Equiv.', 'vs TUC', 'Qty', 'Status'].map((h) => (
                        <th key={h} className="px-4 py-2.5 text-left font-bold uppercase tracking-wider text-slate-500 whitespace-nowrap">{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-800/60">
                    {quoteHistory.map((qi) => {
                      const idrEquiv = qi.currency === 'IDR'
                        ? qi.unit_price
                        : qi.currency === 'USD' && xrUsd
                          ? qi.unit_price * xrUsd
                          : null;
                      const vsTucPct = tucIdr && idrEquiv ? (idrEquiv / tucIdr) * 100 - 100 : null;
                      const statusColor =
                        qi.quote.status === 'Accepted' ? 'text-emerald-400' :
                        qi.quote.status === 'Rejected' || qi.quote.status === 'Expired' ? 'text-slate-600' :
                        qi.quote.status === 'Replaced' ? 'text-slate-500' :
                        'text-amber-400';

                      return (
                        <tr key={qi.quote_line_id} className="hover:bg-slate-800/20 transition-colors">
                          <td className="px-4 py-3 text-slate-400 whitespace-nowrap">
                            {fmtDate(qi.quote.quote_date)}
                          </td>
                          <td className="px-4 py-3">
                            {qi.quote.pi_number
                              ? <div className="font-semibold text-white">{qi.quote.pi_number}</div>
                              : <div className="text-slate-500">Quote #{qi.quote_id}</div>
                            }
                          </td>
                          <td className="px-4 py-3 font-semibold text-white whitespace-nowrap">
                            {qi.currency} {fmtNum(qi.unit_price)}
                          </td>
                          <td className="px-4 py-3 whitespace-nowrap">
                            {idrEquiv !== null ? (
                              <span className="text-slate-400">{fmtIdr(idrEquiv)}</span>
                            ) : (
                              <span className="text-slate-600">—</span>
                            )}
                          </td>
                          <td className="px-4 py-3 whitespace-nowrap">
                            {vsTucPct !== null ? (
                              <span className={`font-semibold ${vsTucColor(vsTucPct)}`}>{pct(vsTucPct)}</span>
                            ) : <span className="text-slate-600">—</span>}
                          </td>
                          <td className="px-4 py-3 text-slate-400 text-right tabular-nums">
                            {qi.quantity.toLocaleString()}
                          </td>
                          <td className={`px-4 py-3 font-semibold ${statusColor}`}>
                            {qi.quote.status ?? '—'}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}
