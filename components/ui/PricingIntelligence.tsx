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
import type {
  Component,
  PurchaseLineItem,
  PurchaseOrder,
  PriceQuoteLineItem,
  PriceQuote,
  POCost,
  CompetitorPrice,
} from '@/types/database';

// ─── Cost allocation constants (mirrors ProductCostLookup) ───────────────────
const PRINCIPAL_CATS = new Set(['down_payment', 'balance_payment', 'additional_balance_payment', 'overpayment_credit']);
const BANK_FEE_CATS  = new Set(['full_amount_bank_fee', 'telex_bank_fee', 'value_today_bank_fee', 'admin_bank_fee', 'inter_bank_transfer_fee']);
const TAX_CATS       = new Set(['local_vat', 'local_income_tax']);
const BALANCE_CATS   = new Set(['balance_payment', 'additional_balance_payment']);

const CONFIDENCE_WEIGHT: Record<string, number> = { high: 1.0, medium: 0.6, low: 0.3 };

// ─── Helpers ─────────────────────────────────────────────────────────────────
const fmtIdr  = (n: number) => 'IDR ' + Math.round(n).toLocaleString('en-US');
const fmtNum  = (n: number, dp = 2) => n.toLocaleString('en-US', { minimumFractionDigits: dp, maximumFractionDigits: dp });
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
function TierRow({ label, desc, sellUsd, xr, tucIdr, marketAvgUsd, dimmed }: {
  label: string; desc: string;
  sellUsd: number; xr: number; tucIdr: number;
  marketAvgUsd: number | null; dimmed?: boolean;
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
      <td className="py-3 pr-4 text-sm font-semibold text-white">{fmtNum(sellUsd, 2)}</td>
      <td className="py-3 pr-4 text-sm text-slate-400">{fmtIdr(sellIdr)}</td>
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

// ─── Main component ───────────────────────────────────────────────────────────
export default function PricingIntelligence({
  components, poItems, pos, quoteItems, quotes, poCosts, competitorPrices, isLoading,
}: Props) {
  const [query,    setQuery]    = useState('');
  const [selected, setSelected] = useState<Component | null>(null);
  const [showDrop, setShowDrop] = useState(false);
  const [simPrice, setSimPrice] = useState('');
  const [minMarginPct, setMinMarginPct] = useState('15');
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
    setSimPrice('');
  };

  // ── TUC calculation (mirrors ProductCostLookup) ──────────────────────
  const { tucIdr, xrUsd, latestPoDate } = useMemo(() => {
    if (!selected) return { tucIdr: null, xrUsd: null, latestPoDate: null };

    const myItems = poItems.filter((i) => i.component_id === selected.component_id);

    const allocs = myItems.map((item) => {
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
    }).filter((a): a is NonNullable<typeof allocs[0]> => a !== null);

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

  // ── Competitor prices for this component ────────────────────────────
  const compPrices = useMemo(() => {
    if (!selected) return [];
    return competitorPrices
      .filter((p) => p.component_id === selected.component_id)
      .sort((a, b) => b.observed_at.localeCompare(a.observed_at));
  }, [selected, competitorPrices]);

  // ── Market stats (weighted by confidence) ───────────────────────────
  const market = useMemo(() => {
    if (compPrices.length === 0) return null;
    // Only USD prices for now (most useful for sell pricing)
    const usdPrices = compPrices.filter((p) => p.currency === 'USD' && p.unit_price > 0);
    if (usdPrices.length === 0) return null;

    const prices = usdPrices.map((p) => p.unit_price);
    const min = Math.min(...prices);
    const max = Math.max(...prices);

    // Confidence-weighted average
    let wSum = 0, wTotal = 0;
    for (const p of usdPrices) {
      const w = CONFIDENCE_WEIGHT[p.confidence ?? 'medium'] ?? 0.6;
      wSum   += p.unit_price * w;
      wTotal += w;
    }
    const weightedAvg = wTotal > 0 ? wSum / wTotal : null;

    // Price per Wp (if capacity_w set)
    const withWp = usdPrices.filter((p) => p.capacity_w && p.capacity_w > 0);
    const avgWp = withWp.length > 0
      ? withWp.reduce((s, p) => s + p.unit_price / p.capacity_w!, 0) / withWp.length
      : null;

    return { min, max, weightedAvg, avgWp, count: usdPrices.length };
  }, [compPrices]);

  // ── Sell price simulator ─────────────────────────────────────────────
  const sim = useMemo(() => {
    const price = parseFloat(simPrice);
    if (!price || isNaN(price) || !xrUsd) return null;
    const sellIdr  = price * xrUsd;
    const gm       = tucIdr ? ((sellIdr - tucIdr) / sellIdr) * 100 : null;
    const markup   = tucIdr ? ((sellIdr - tucIdr) / tucIdr) * 100 : null;
    const vsMarket = market?.weightedAvg ? ((price - market.weightedAvg) / market.weightedAvg) * 100 : null;
    return { sellIdr, gm, markup, vsMarket };
  }, [simPrice, xrUsd, tucIdr, market]);

  // ── Pricing tiers ────────────────────────────────────────────────────
  const minMargin = parseFloat(minMarginPct) / 100 || 0.15;
  const tiers = useMemo(() => {
    if (!tucIdr || !xrUsd || xrUsd === 0) return null;
    const tucUsd = tucIdr / xrUsd;
    const floor  = tucUsd / (1 - minMargin);

    return {
      floor,
      tucUsd,
      economy:     market ? Math.max(floor, market.min * 1.00) : null,
      competitive: market ? Math.max(floor, market.weightedAvg! * 0.97) : null,
      standard:    market ? Math.max(floor, market.weightedAvg! * 1.02) : null,
      premium:     market ? Math.max(floor, market.max * 1.05) : null,
    };
  }, [tucIdr, xrUsd, market, minMargin]);

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
            onFocus={() => query && setShowDrop(true)}
            placeholder="Search by SKU, description, or brand…"
            className="w-full bg-slate-900/80 border border-slate-700/80 rounded-2xl px-5 py-4 pl-12 text-white placeholder-slate-500 focus:outline-none focus:border-sky-500 focus:ring-4 focus:ring-sky-500/20 transition-all text-sm md:text-base"
          />
          <svg className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-slate-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
          </svg>
        </div>
        {showDrop && candidates.length > 0 && (
          <ul className="absolute z-50 mt-2 w-full bg-slate-800/95 border border-slate-700 rounded-xl shadow-2xl overflow-auto max-h-72">
            {candidates.map((c) => (
              <li key={c.component_id} onMouseDown={() => selectComp(c)}
                className="px-5 py-3.5 hover:bg-slate-700/50 cursor-pointer border-b border-slate-700/50 last:border-0 transition-colors group"
              >
                <div className="text-white text-sm font-semibold group-hover:text-sky-300 transition-colors">{c.internal_description}</div>
                <div className="text-slate-400 text-xs mt-0.5">{c.supplier_model}{c.brand ? ` · ${c.brand}` : ''}</div>
              </li>
            ))}
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
                label="Market Average (USD, weighted)"
                value={market?.weightedAvg ? `USD ${fmtNum(market.weightedAvg)}` : '—'}
                sub={market ? `${market.count} data point${market.count !== 1 ? 's' : ''} · range ${fmtNum(market.min)}–${fmtNum(market.max)}` : 'No USD competitor prices logged'}
                accent={market ? 'text-amber-300' : 'text-slate-600'}
              />
              <StatCard
                label="Avg Market Price / Wp"
                value={market?.avgWp ? `USD ${market.avgWp.toFixed(4)}/Wp` : '—'}
                sub={market?.avgWp ? 'From entries with Wp set' : 'Set Capacity (Wp) in Market Intel entries'}
              />
            </div>
          </div>

          {/* ── Min margin setting + tiers ── */}
          {tucIdr && xrUsd ? (
            <div className="bg-[#0d1829] border border-slate-800/80 rounded-2xl p-5 md:p-6">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-5">
                <div>
                  <h3 className="text-sm font-bold text-white">Pricing Tiers</h3>
                  <p className="text-xs text-slate-500 mt-0.5">Based on TUC + market data. Gross margin = (Sell − TUC) / Sell.</p>
                </div>
                <label className="flex items-center gap-2 text-xs text-slate-400 flex-shrink-0">
                  <span className="font-semibold">Min. margin floor:</span>
                  <input
                    type="number" min="0" max="100" step="1"
                    value={minMarginPct}
                    onChange={(e) => setMinMarginPct(e.target.value)}
                    className="w-16 px-2 py-1 bg-slate-900 border border-slate-700 rounded-lg text-white text-xs focus:outline-none focus:ring-2 focus:ring-sky-500/30"
                  />
                  <span>%</span>
                </label>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full border-collapse">
                  <thead>
                    <tr className="border-b border-slate-700">
                      <th className="text-left py-2 pr-4 text-[11px] font-bold uppercase tracking-wider text-slate-500">Tier</th>
                      <th className="text-left py-2 pr-4 text-[11px] font-bold uppercase tracking-wider text-slate-500">USD/unit</th>
                      <th className="text-left py-2 pr-4 text-[11px] font-bold uppercase tracking-wider text-slate-500">IDR equiv.</th>
                      <th className="text-left py-2 pr-4 text-[11px] font-bold uppercase tracking-wider text-slate-500">Gross Margin</th>
                      <th className="text-left py-2 pr-4 text-[11px] font-bold uppercase tracking-wider text-slate-500">Markup</th>
                      <th className="text-left py-2 text-[11px] font-bold uppercase tracking-wider text-slate-500">vs Market</th>
                    </tr>
                  </thead>
                  <tbody>
                    <TierRow
                      label="Floor"
                      desc={`TUC + ${minMarginPct}% min margin`}
                      sellUsd={tiers!.floor}
                      xr={xrUsd}
                      tucIdr={tucIdr}
                      marketAvgUsd={market?.weightedAvg ?? null}
                    />
                    {tiers!.economy && (
                      <TierRow label="Economy" desc="Match market low" sellUsd={tiers!.economy} xr={xrUsd} tucIdr={tucIdr} marketAvgUsd={market?.weightedAvg ?? null} />
                    )}
                    {tiers!.competitive && (
                      <TierRow label="Competitive" desc="3% below market avg" sellUsd={tiers!.competitive} xr={xrUsd} tucIdr={tucIdr} marketAvgUsd={market?.weightedAvg ?? null} />
                    )}
                    {tiers!.standard && (
                      <TierRow label="Standard" desc="At market avg (+2%)" sellUsd={tiers!.standard} xr={xrUsd} tucIdr={tucIdr} marketAvgUsd={market?.weightedAvg ?? null} />
                    )}
                    {tiers!.premium && (
                      <TierRow label="Premium" desc="Above market high (+5%)" sellUsd={tiers!.premium} xr={xrUsd} tucIdr={tucIdr} marketAvgUsd={market?.weightedAvg ?? null} />
                    )}
                    {!market && (
                      <tr>
                        <td colSpan={6} className="py-4 text-center text-xs text-slate-600">
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

          {/* ── Sell price simulator ── */}
          {tucIdr && xrUsd && (
            <div className="bg-[#0d1829] border border-slate-800/80 rounded-2xl p-5 md:p-6">
              <h3 className="text-sm font-bold text-white mb-1">Sell Price Simulator</h3>
              <p className="text-xs text-slate-500 mb-4">Enter any sell price to instantly see your margin and market positioning.</p>
              <div className="flex flex-col sm:flex-row gap-4 items-start">
                <div className="flex items-center gap-3">
                  <span className="text-sm text-slate-400 font-semibold">USD</span>
                  <input
                    type="number" min="0" step="0.01"
                    value={simPrice}
                    onChange={(e) => setSimPrice(e.target.value)}
                    placeholder="0.00"
                    className="w-36 px-4 py-2.5 bg-slate-950 border border-slate-700 rounded-xl text-white text-base font-semibold focus:outline-none focus:ring-2 focus:ring-sky-500/30 focus:border-sky-500"
                  />
                </div>
                {sim ? (
                  <div className={`flex flex-wrap gap-3`}>
                    <div className={`rounded-xl border px-4 py-2 ${marginBg(sim.gm ?? 0)}`}>
                      <p className="text-[10px] text-slate-500 uppercase font-bold tracking-wider mb-0.5">Gross Margin</p>
                      <p className={`text-lg font-extrabold ${marginColor(sim.gm ?? 0)}`}>{sim.gm !== null ? pct(sim.gm) : '—'}</p>
                    </div>
                    <div className="rounded-xl border border-slate-700 bg-slate-900/60 px-4 py-2">
                      <p className="text-[10px] text-slate-500 uppercase font-bold tracking-wider mb-0.5">Markup</p>
                      <p className="text-lg font-extrabold text-white">{sim.markup !== null ? pct(sim.markup) : '—'}</p>
                    </div>
                    <div className="rounded-xl border border-slate-700 bg-slate-900/60 px-4 py-2">
                      <p className="text-[10px] text-slate-500 uppercase font-bold tracking-wider mb-0.5">≈ IDR</p>
                      <p className="text-sm font-bold text-slate-300">{fmtIdr(sim.sellIdr)}</p>
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
                  <p className="text-slate-600 text-sm self-center">Enter a price to see results</p>
                )}
              </div>
            </div>
          )}

          {/* ── Competitor prices table ── */}
          {compPrices.length > 0 && (
            <div className="bg-[#0d1829] border border-slate-800/80 rounded-2xl overflow-hidden">
              <div className="px-5 py-4 border-b border-slate-800">
                <h3 className="text-sm font-bold text-white">All Market Intel Entries ({compPrices.length})</h3>
                <p className="text-xs text-slate-500 mt-0.5">Sorted by most recent observation</p>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full border-collapse text-xs">
                  <thead className="bg-slate-900/60">
                    <tr>
                      {['Observed', 'Competitor', 'Price', '$/Wp', 'Incoterms', 'Type', 'Source', 'Region', 'Confidence', 'Notes'].map((h) => (
                        <th key={h} className="px-4 py-2.5 text-left font-bold uppercase tracking-wider text-slate-500 whitespace-nowrap">{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-800/60">
                    {compPrices.map((p) => {
                      const pricePerWp = p.capacity_w && p.capacity_w > 0 ? p.unit_price / p.capacity_w : null;
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
                          <td className="px-4 py-3 text-slate-400 whitespace-nowrap">
                            {pricePerWp ? `${p.currency} ${pricePerWp.toFixed(4)}` : '—'}
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
            </div>
          )}

          {compPrices.length === 0 && (
            <div className="bg-slate-900/40 border border-slate-800/60 border-dashed rounded-2xl p-8 text-center">
              <p className="text-slate-500 text-sm">No competitor prices logged for this component yet.</p>
              <p className="text-slate-600 text-xs mt-1">Go to <span className="text-slate-400 font-medium">Insert → Market Intel</span> to add entries.</p>
            </div>
          )}
        </>
      )}
    </div>
  );
}
