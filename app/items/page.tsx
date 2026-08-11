'use client';
/**
 * ICAPROC — Module 29: Items (master list)
 *
 * The entry hall of the Item hub: every component, one row, one click to the
 * item's own page (/items/[componentId]). Products and Purchasing remain the
 * task-focused lists; this one exists to REACH the hub from a neutral place.
 * Filed under Analytics and OWNER ONLY (canViewAnalytics, decided 2026-07-30)
 * — the column/tab gating below stays capability-driven so widening access
 * later is a one-line flag flip in constants/roles.ts.
 */
import { useState, useEffect, useMemo, useCallback, useRef, Suspense } from 'react';
import { createSupabaseClient } from '@/lib/supabase';
import { useAuth } from '@/hooks/useAuth';
import { useRouter, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { ROLE_PERMISSIONS } from '@/constants/roles';
import BrandMenu from '@/components/ui/BrandMenu';
import { formatCategory as humanize } from '@/lib/formatCategory';
import { fmtDay, fmtInt, fmtRupiah } from '@/lib/formatters';
import { rollUpByComponent, type BalanceRow } from '@/lib/warehouses';
import { useListDefaults } from '@/hooks/useListDefaults';
import ItemCostForensics from '@/components/ui/ItemCostForensics';
import { computeTUCMap, fxFromHistory } from '@/lib/computeTUC';
import { deriveExchangeRates } from '@/lib/exchangeRates';
import { useItemScores, type ItemMetrics } from '@/hooks/useItemScores';
import { ITEM_SCORE_FACTORS, type ItemScoreResult, type ScoreBand } from '@/lib/itemScore';
import type { PriceQuote, PriceQuoteLineItem, PurchaseOrder, PurchaseLineItem, POCost, ComponentLink } from '@/types/database';

interface Comp {
  component_id: string; supplier_model: string; internal_description: string | null;
  brand?: string | null; category: string | null; unit: string | null;
  selling_price_idr: number | null; datasheet_url: string | null; updated_at: string | null;
}
interface Row { c: Comp; qty: number; avg: number; value: number; activity: number; lastMove: string | null }

const descOf = (c: Comp) => (c.internal_description && c.internal_description.trim()) || c.supplier_model || '(no description)';

type SortKey = 'score' | 'volume' | 'trend' | 'activity' | 'stock' | 'value' | 'name' | 'moved';
const SORT_LABELS: Record<SortKey, string> = {
  score: 'Item Score', volume: 'Volume · 90d (high)', trend: 'Trending (rising volume)',
  activity: 'Most traded', stock: 'On hand', value: 'Stock value', name: 'Name', moved: 'Last movement',
};
const DEFAULT_DIR: Record<SortKey, 1 | -1> = { score: -1, volume: -1, trend: -1, activity: -1, stock: -1, value: -1, name: 1, moved: -1 };

const BAND_STYLE: Record<ScoreBand, { chip: string; label: string }> = {
  core:   { chip: 'bg-emerald-500/15 text-emerald-300 border-emerald-500/30', label: 'Core' },
  solid:  { chip: 'bg-sky-500/15 text-sky-300 border-sky-500/30', label: 'Solid' },
  watch:  { chip: 'bg-amber-500/15 text-amber-300 border-amber-500/30', label: 'Watch' },
  reduce: { chip: 'bg-rose-500/15 text-rose-300 border-rose-500/30', label: 'Reduce' },
};

/** Recent sales value (the "volume") with a momentum arrow — Binance-style. */
function VolCell({ m }: { m?: ItemMetrics }) {
  if (!m || m.revenue90d <= 0) return <span className="text-slate-700">—</span>;
  return (
    <span className="whitespace-nowrap" title="Sales value in the last 90 days, and demand growth vs the prior 90 days">
      <span className="text-slate-200">{fmtRupiah(m.revenue90d)}</span>
      {m.momentumPct != null
        ? <span className={`ml-1 text-[10px] ${m.momentumPct >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>{m.momentumPct >= 0 ? '▲' : '▼'}{Math.abs(Math.round(m.momentumPct))}%</span>
        : m.units90d > 0 ? <span className="ml-1 text-[10px] text-sky-400">new</span> : null}
    </span>
  );
}

/** The Item Score as a band-coloured chip; hover shows the action + factors. */
function ScoreChip({ res }: { res?: ItemScoreResult }) {
  if (!res) return <span className="text-slate-700 text-xs">—</span>;
  const st = BAND_STYLE[res.band];
  const tip = `${res.action}\n\n${ITEM_SCORE_FACTORS.map((f) => `${f.label}: ${Math.round(res.factors[f.key])}`).join('  ·  ')}`
    + (res.lowData ? '\n\nThin sales history — score pulled toward neutral' : '');
  return (
    <span title={tip} className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-lg border tabular-nums text-xs font-bold cursor-help ${st.chip}`}>
      {Math.round(res.score)}
      <span className="text-[9px] font-semibold uppercase tracking-wide opacity-80">{st.label}</span>
      {res.lowData && <span className="text-[10px] opacity-50" title="thin data">~</span>}
    </span>
  );
}

export default function ItemsPage() {
  return (
    <Suspense fallback={<div className="min-h-screen bg-chrome" />}>
      <ItemsInner />
    </Suspense>
  );
}

function ItemsInner() {
  const supabase = createSupabaseClient();
  const router = useRouter();
  const searchParams = useSearchParams();
  const { user, profile, loading: authLoading } = useAuth();
  const perms = profile ? ROLE_PERMISSIONS[profile.role] : null;
  const canOpen = !!perms && perms.canViewAnalytics;
  const canBuy = !!perms && perms.buySide;
  const canSell = !!perms && perms.canViewSellingPrice;
  const canBrand = !!perms && perms.canViewBrand;

  const [comps, setComps] = useState<Comp[]>([]);
  const [stock, setStock] = useState<Map<string, { qty: number; avg: number; value: number }>>(new Map());
  const [activity, setActivity] = useState<Map<string, number>>(new Map());
  const [lastMove, setLastMove] = useState<Map<string, string>>(new Map());
  const [loading, setLoading] = useState(true);
  // The forensic layer (Cost Lookup's audit trail) renders inline on expand —
  // the full buy dataset backs it, exactly what Spend & Cash already loads.
  const [quotes, setQuotes] = useState<PriceQuote[]>([]);
  const [quoteItems, setQuoteItems] = useState<PriceQuoteLineItem[]>([]);
  const [pos, setPos] = useState<PurchaseOrder[]>([]);
  const [poItems, setPoItems] = useState<PurchaseLineItem[]>([]);
  const [poCosts, setPoCosts] = useState<POCost[]>([]);
  const [suppliers, setSuppliers] = useState<{ supplier_id: string; supplier_name: string }[]>([]);
  const [componentLinks, setComponentLinks] = useState<ComponentLink[]>([]);
  // ?open=<componentId> (Spotlight deep link): land with that row already
  // expanded — the search (?q=) narrows the list so the row is on screen.
  const [expanded, setExpanded] = useState<string | null>(searchParams.get('open'));

  const [search, setSearch] = useState(searchParams.get('q') ?? '');
  const [filterCategory, setFilterCategory] = useState('');
  const [stockOnly, setStockOnly] = useState(false);
  const [sort, setSort] = useState<{ key: SortKey; dir: 1 | -1 }>({ key: 'activity', dir: -1 });
  // Settings › Lists decides how the master list opens, until someone re-sorts
  const listDefaults = useListDefaults('items');
  const listTouched = useRef(false);
  useEffect(() => {
    if (listTouched.current) return;
    const key = listDefaults.sort as SortKey;
    if (SORT_LABELS[key]) setSort({ key, dir: DEFAULT_DIR[key] });
  }, [listDefaults.sort]);

  useEffect(() => { document.title = 'Items — ICAPROC'; }, []);
  useEffect(() => {
    if (authLoading) return;
    if (!user) { router.replace(`/login?next=${encodeURIComponent('/items')}`); return; }
    if (profile && !canOpen) router.replace('/unauthorized');
  }, [authLoading, user, profile, canOpen, router]);

  const load = useCallback(async () => {
    setLoading(true);
    const fetchAllComponents = async () => {
      const PAGE = 1000;
      let all: Comp[] = [];
      let from = 0;
      for (;;) {
        // Brand is buy-side sensitive — not selected for sell-side roles.
        const cols = `component_id, supplier_model, internal_description, category, unit, selling_price_idr, datasheet_url, updated_at${canBrand ? ', brand' : ''}`;
        const { data: page } = await supabase.from('3.0_components')
          .select(cols).order('supplier_model').range(from, from + PAGE - 1);
        if (!page || page.length === 0) break;
        all = all.concat(page as unknown as Comp[]);
        if (page.length < PAGE) break;
        from += PAGE;
      }
      return all;
    };
    const [allComps, balRes, movRes, piiRes, poiRes, sqiRes, pqRes, poRes, costRes, supRes, linkRes] = await Promise.all([
      fetchAllComponents(),
      // avg cost only for buy-side roles — never let landed cost reach a
      // sell-side browser's network tab (the /products leak, not repeated)
      supabase.from('30.1_stock_balances').select(`component_id, location, qty_on_hand${canBuy ? ', avg_cost_idr' : ''}`),
      supabase.from('30.0_stock_movements').select('component_id, moved_at').order('moved_at', { ascending: false }).limit(2000),
      supabase.from('4.1_price_quote_line_items').select('quote_line_id, quote_id, component_id, quantity, unit_price, currency').limit(8000),
      supabase.from('5.1_purchase_line_items').select('po_line_item_id, po_id, component_id, quantity, unit_cost, currency').limit(8000),
      supabase.from('22.1_sales_quote_items').select('quote_id, component_id'),
      supabase.from('4.0_price_quotes').select('quote_id, supplier_id, quote_date, pi_number, currency, status'),
      supabase.from('5.0_purchases').select('po_id, po_number, po_date, status, currency, exchange_rate, total_value, quote_id, supplier_id, pi_number, actual_received_date'),
      supabase.from('6.0_po_costs').select('cost_id, po_id, cost_category, amount, currency, exchange_rate, payment_date, notes'),
      supabase.from('2.0_suppliers').select('supplier_id, supplier_name'),
      supabase.from('8.0_component_links').select('*'),
    ]);
    setComps(allComps);
    setStock(rollUpByComponent((balRes.data ?? []) as unknown as BalanceRow[]));
    setQuotes((pqRes.data ?? []) as unknown as PriceQuote[]);
    setQuoteItems((piiRes.data ?? []) as unknown as PriceQuoteLineItem[]);
    setPos((poRes.data ?? []) as unknown as PurchaseOrder[]);
    setPoItems((poiRes.data ?? []) as unknown as PurchaseLineItem[]);
    setPoCosts((costRes.data ?? []) as unknown as POCost[]);
    setSuppliers((supRes.data ?? []) as { supplier_id: string; supplier_name: string }[]);
    setComponentLinks((linkRes.data ?? []) as unknown as ComponentLink[]);

    const last = new Map<string, string>();
    for (const m of ((movRes.data ?? []) as { component_id: string; moved_at: string }[])) {
      if (!last.has(m.component_id)) last.set(m.component_id, m.moved_at);
    }
    setLastMove(last);

    // Activity = distinct supplier quotes + POs + sales quotes the item appears
    // on — the same trading-activity measure Products badges on its rows.
    const sets = new Map<string, Set<string>>();
    const add = (cid: string | null, key: string) => {
      if (!cid) return;
      (sets.get(cid) ?? sets.set(cid, new Set()).get(cid)!).add(key);
    };
    for (const l of ((piiRes.data ?? []) as { quote_id: number; component_id: string | null }[])) add(l.component_id, `pi:${l.quote_id}`);
    for (const l of ((poiRes.data ?? []) as { po_id: unknown; component_id: string | null }[])) add(l.component_id, `po:${String(l.po_id)}`);
    for (const l of ((sqiRes.data ?? []) as { quote_id: string; component_id: string | null }[])) add(l.component_id, `sq:${l.quote_id}`);
    setActivity(new Map([...sets].map(([cid, s]) => [cid, s.size])));
    setLoading(false);
  }, [canBrand, canBuy]);       // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => { if (canOpen) load(); }, [canOpen, load]);

  const categories = useMemo(() => [...new Set(comps.map((c) => c.category).filter(Boolean))].sort() as string[], [comps]);

  // THE canonical engines, computed once for the whole list — every expanded
  // row's forensics reads these, so the numbers match Cost Lookup exactly.
  const tucMap = useMemo(() => computeTUCMap(pos, poItems, poCosts), [pos, poItems, poCosts]);
  const fx = useMemo(() => fxFromHistory(pos, deriveExchangeRates(pos, poItems, poCosts, quotes)), [pos, poItems, poCosts, quotes]);
  // The Item Score, ranked across the whole catalog (owner-only). Same engine
  // and basis as the Profitability dashboard.
  const { scores, metrics } = useItemScores(supabase, canOpen);

  const rows: Row[] = useMemo(() => {
    const q = search.trim().toLowerCase();
    const list = comps
      .map((c) => {
        const s = stock.get(c.component_id);
        return {
          c,
          qty: s?.qty ?? 0,
          avg: s?.avg ?? 0,
          value: s?.value ?? 0,
          activity: activity.get(c.component_id) ?? 0,
          lastMove: lastMove.get(c.component_id) ?? null,
        };
      })
      .filter(({ c, qty }) => {
        if (filterCategory && c.category !== filterCategory) return false;
        if (stockOnly && qty === 0) return false;
        if (!q) return true;
        return [c.supplier_model, c.internal_description, c.brand, c.category].filter(Boolean).join(' ').toLowerCase().includes(q);
      });
    const { key, dir } = sort;
    list.sort((a, b) => {
      let d = 0;
      if (key === 'score') d = (scores.get(a.c.component_id)?.score ?? -1) - (scores.get(b.c.component_id)?.score ?? -1);
      else if (key === 'volume') d = (metrics.get(a.c.component_id)?.revenue90d ?? -1) - (metrics.get(b.c.component_id)?.revenue90d ?? -1);
      else if (key === 'trend') d = (metrics.get(a.c.component_id)?.trend ?? -1) - (metrics.get(b.c.component_id)?.trend ?? -1);
      else if (key === 'activity') d = a.activity - b.activity;
      else if (key === 'stock') d = a.qty - b.qty;
      else if (key === 'value') d = a.value - b.value;
      else if (key === 'moved') d = (a.lastMove ?? '').localeCompare(b.lastMove ?? '');
      else d = descOf(a.c).localeCompare(descOf(b.c));
      d *= dir;
      if (d !== 0) return d;
      return (b.activity - a.activity) || descOf(a.c).localeCompare(descOf(b.c));
    });
    return list;
  }, [comps, stock, activity, lastMove, search, filterCategory, stockOnly, sort, scores, metrics]);

  const toggleSort = (key: SortKey) => {
    listTouched.current = true;
    setSort((s) => (s.key === key ? { key, dir: (s.dir * -1) as 1 | -1 } : { key, dir: DEFAULT_DIR[key] }));
  };
  const arrow = (key: SortKey) => (sort.key === key ? (sort.dir === 1 ? ' ↑' : ' ↓') : '');

  if (authLoading || !profile || !canOpen) {
    return <div className="min-h-screen bg-chrome flex items-center justify-center"><div className="w-6 h-6 border-2 border-slate-500/30 border-t-slate-300 rounded-full animate-spin" /></div>;
  }

  const cols = `1fr 96px 120px 110px${canSell ? ' 130px' : ''}${canBuy ? ' 120px 130px' : ''} 130px 90px 110px`;

  return (
    <div className="min-h-screen bg-chrome text-slate-200 font-sans text-sm">
      <div className="border-b border-slate-800/60 bg-chrome/80 backdrop-blur-md sticky top-0 z-30">
        <div className="max-w-[1400px] 2xl:max-w-[1760px] mx-auto px-3 sm:px-4 md:px-6 py-3 sm:py-4">
          <BrandMenu wordmarkClass="text-xl md:text-2xl font-extrabold" subtitle="Items · One page per stock item" />
        </div>
      </div>

      <main className="max-w-[1400px] 2xl:max-w-[1760px] mx-auto px-3 sm:px-4 md:px-6 py-6 space-y-4">
        {/* Search + filters */}
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative flex-1 min-w-[200px]">
            <svg className="w-4 h-4 text-slate-500 absolute left-3.5 top-1/2 -translate-y-1/2" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M21 21l-4.35-4.35M17 11a6 6 0 11-12 0 6 6 0 0112 0z" /></svg>
            <input value={search} onChange={(e) => setSearch(e.target.value)}
              placeholder={canBrand ? 'Search model, description, brand, category…' : 'Search description, category…'}
              className="w-full pl-10 pr-4 h-11 rounded-xl bg-slate-900/80 border border-slate-700/80 focus:border-slate-500/60 outline-none text-white text-base sm:text-sm placeholder:text-[13px] sm:placeholder:text-sm placeholder:text-slate-500 transition-colors" />
          </div>
          <select value={filterCategory} onChange={(e) => setFilterCategory(e.target.value)}
            className="h-11 px-3 rounded-xl bg-slate-900/80 border border-slate-700/80 focus:border-slate-500/60 outline-none text-slate-300 text-xs cursor-pointer">
            <option value="">All categories</option>
            {categories.map((c) => <option key={c} value={c}>{humanize(c)}</option>)}
          </select>
          <select value={`${sort.key}:${sort.dir}`}
            onChange={(e) => { listTouched.current = true; const [k, d] = e.target.value.split(':'); setSort({ key: k as SortKey, dir: Number(d) as 1 | -1 }); }}
            className="h-11 px-3 rounded-xl bg-slate-900/80 border border-slate-700/80 focus:border-slate-500/60 outline-none text-slate-300 text-xs cursor-pointer">
            {(Object.keys(SORT_LABELS) as SortKey[]).map((k) => (
              <option key={k} value={`${k}:${DEFAULT_DIR[k]}`}>{SORT_LABELS[k]} {DEFAULT_DIR[k] === -1 ? '↓' : '↑'}</option>
            ))}
          </select>
          <label className="flex items-center gap-2 text-xs text-slate-400 cursor-pointer select-none whitespace-nowrap">
            <input type="checkbox" checked={stockOnly} onChange={(e) => setStockOnly(e.target.checked)} className="accent-slate-400 w-4 h-4" />
            In stock only
          </label>
          <span className="text-xs text-slate-600 tabular-nums ml-auto">{fmtInt(rows.length)} of {fmtInt(comps.length)}</span>
        </div>

        {/* Desktop table */}
        <div className="hidden md:block bg-slate-900/40 border border-slate-800/80 rounded-2xl overflow-hidden">
          <div className="grid gap-3 px-4 py-2.5 border-b border-slate-800 text-[10px] font-semibold uppercase tracking-widest text-slate-500" style={{ gridTemplateColumns: cols }}>
            <button onClick={() => toggleSort('name')} className="text-left hover:text-slate-300 transition-colors uppercase tracking-widest">Item{arrow('name')}</button>
            <button onClick={() => toggleSort('score')} className="text-left hover:text-slate-300 transition-colors uppercase tracking-widest" title="Item Score — 0–100, higher is a better item to keep buying (hover a chip for the breakdown)">Score{arrow('score')}</button>
            <span>Category</span>
            <button onClick={() => toggleSort('stock')} className="text-right hover:text-slate-300 transition-colors uppercase tracking-widest">On hand{arrow('stock')}</button>
            {canSell && <span className="text-right">Sell price</span>}
            {canBuy && <span className="text-right">Avg cost</span>}
            {canBuy && <button onClick={() => toggleSort('value')} className="text-right hover:text-slate-300 transition-colors uppercase tracking-widest">Value{arrow('value')}</button>}
            <button onClick={() => toggleSort('volume')} className="text-right hover:text-slate-300 transition-colors uppercase tracking-widest" title="Sales value in the last 90 days — the item's recent trading volume; click to sort high→low">Vol · 90d{arrow('volume')}</button>
            <button onClick={() => toggleSort('activity')} className="text-right hover:text-slate-300 transition-colors uppercase tracking-widest" title="Distinct supplier quotes + POs + sales quotes">Traded{arrow('activity')}</button>
            <button onClick={() => toggleSort('moved')} className="text-right hover:text-slate-300 transition-colors uppercase tracking-widest">Last move{arrow('moved')}</button>
          </div>
          {loading ? (
            <div className="p-4 space-y-1.5">{[...Array(10)].map((_, i) => <div key={i} className="h-10 bg-slate-800/40 rounded-xl animate-pulse" />)}</div>
          ) : rows.length === 0 ? (
            <div className="px-4 py-12 text-center text-slate-600 text-sm">No items match.</div>
          ) : (
            <div className="divide-y divide-slate-800/60">
              {rows.slice(0, 400).map((r) => {
                const isOpen = expanded === r.c.component_id;
                return (
                  <div key={r.c.component_id}>
                    {/* Click a row to expand its cost forensics in place — the
                        Cost Lookup experience without leaving the list. */}
                    <button onClick={() => setExpanded(isOpen ? null : r.c.component_id)}
                      className={`w-full text-left grid gap-3 px-4 py-2.5 items-center transition-colors ${isOpen ? 'bg-raised' : 'hover:bg-white/[0.03]'}`}
                      style={{ gridTemplateColumns: cols }}>
                      <span className="min-w-0">
                        <span className="flex items-center gap-1.5">
                          {/* The NAME is the door to the item's hub page (owner's
                              call — clearer than a separate ↗ icon); the rest of
                              the row still expands the forensics in place. */}
                          <Link href={`/items/${r.c.component_id}`} onClick={(e) => e.stopPropagation()}
                            title="Open this item's hub — purchases, sales, pricing, FX, cash cycle, stock, specs"
                            className="text-slate-100 font-medium truncate hover:text-emerald-300 hover:underline underline-offset-2 transition-colors">
                            {descOf(r.c)}
                          </Link>
                        </span>
                        {canBrand && (r.c.supplier_model || r.c.brand) && (
                          <span className="block text-[11px] text-slate-500 truncate">
                            <span className="font-mono">{r.c.supplier_model}</span>{r.c.brand ? ` · ${r.c.brand}` : ''}
                          </span>
                        )}
                      </span>
                      <span onClick={(e) => e.stopPropagation()}><ScoreChip res={scores.get(r.c.component_id)} /></span>
                      <span className="text-[11px] text-slate-500 truncate">{r.c.category ? humanize(r.c.category) : '—'}</span>
                      <span className={`text-right tabular-nums font-semibold ${r.qty < 0 ? 'text-red-400' : r.qty === 0 ? 'text-slate-600' : 'text-slate-100'}`}>
                        {fmtInt(r.qty)}{r.c.unit && <span className="text-[10px] text-slate-600 font-normal"> {r.c.unit}</span>}
                      </span>
                      {canSell && <span className="text-right tabular-nums text-xs text-emerald-300/90 whitespace-nowrap">{r.c.selling_price_idr ? fmtRupiah(r.c.selling_price_idr) : <span className="text-slate-700">—</span>}</span>}
                      {canBuy && <span className="text-right tabular-nums text-xs text-slate-400">{r.avg > 0 ? fmtInt(r.avg) : <span className="text-slate-700">—</span>}</span>}
                      {canBuy && <span className="text-right tabular-nums text-xs text-slate-200" title={r.value !== 0 ? fmtRupiah(r.value) : undefined}>{r.value !== 0 ? fmtRupiah(r.value) : <span className="text-slate-700">—</span>}</span>}
                      <span className="text-right tabular-nums text-xs"><VolCell m={metrics.get(r.c.component_id)} /></span>
                      <span className="text-right tabular-nums text-xs text-slate-500">{r.activity || <span className="text-slate-700">—</span>}</span>
                      <span className="text-right text-[11px] text-slate-500 tabular-nums whitespace-nowrap">{r.lastMove ? fmtDay(r.lastMove) : '—'}</span>
                    </button>
                    {isOpen && (
                      <div className="px-4 pb-4 pt-2 bg-slate-950/40 space-y-3">
                        <ItemCostForensics componentId={r.c.component_id} components={comps}
                          quotes={quotes} quoteItems={quoteItems} pos={pos} poItems={poItems} poCosts={poCosts}
                          suppliers={suppliers} componentLinks={componentLinks} tucMap={tucMap} fx={fx} showLead />
                        <div className="flex items-center gap-4">
                          <Link href={`/items/${r.c.component_id}`}
                            className="inline-flex items-center gap-1 text-[11px] font-semibold text-emerald-400 hover:text-emerald-300 transition-colors">
                            Open the full item hub — sell, stock, specs, economics →
                          </Link>
                          {r.c.datasheet_url && (
                            <a href={r.c.datasheet_url} target="_blank" rel="noopener noreferrer"
                              className="text-[11px] text-sky-400 hover:text-sky-300 transition-colors">datasheet ↗</a>
                          )}
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
          {!loading && rows.length > 400 && (
            <p className="px-4 py-2.5 text-[10px] text-slate-600 border-t border-slate-800/60">Showing the first 400 — narrow the search to find the rest.</p>
          )}
        </div>

        {/* Mobile cards */}
        <div className="md:hidden space-y-2">
          {loading ? (
            [...Array(8)].map((_, i) => <div key={i} className="h-20 bg-slate-800/40 rounded-xl animate-pulse" />)
          ) : rows.length === 0 ? (
            <p className="px-4 py-12 text-center text-slate-600 text-sm">No items match.</p>
          ) : rows.slice(0, 120).map((r) => {
            const isOpen = expanded === r.c.component_id;
            return (
              <div key={r.c.component_id} className={`bg-slate-900/40 border rounded-xl transition-colors ${isOpen ? 'border-slate-600' : 'border-slate-800/80'}`}>
                <button onClick={() => setExpanded(isOpen ? null : r.c.component_id)} className="w-full text-left px-3.5 py-3">
                  <p className="text-sm text-slate-100 font-medium truncate">{descOf(r.c)}</p>
                  <p className="text-[11px] text-slate-500 truncate">
                    {[canBrand ? r.c.brand : null, r.c.category ? humanize(r.c.category) : null].filter(Boolean).join(' · ') || '—'}
                  </p>
                  <div className="flex flex-wrap gap-1.5 mt-1.5 text-[11px]">
                    <ScoreChip res={scores.get(r.c.component_id)} />
                    <span className="px-2 py-0.5 rounded-lg bg-slate-800/80 tabular-nums font-semibold">
                      <span className={r.qty < 0 ? 'text-red-300' : r.qty === 0 ? 'text-slate-500' : 'text-slate-100'}>{fmtInt(r.qty)}</span>
                      {r.c.unit && <span className="text-slate-600 font-normal"> {r.c.unit}</span>}
                    </span>
                    {canSell && r.c.selling_price_idr ? <span className="px-2 py-0.5 rounded-lg bg-emerald-500/10 text-emerald-300 tabular-nums">{fmtRupiah(r.c.selling_price_idr)}</span> : null}
                    {canBuy && r.value !== 0 ? <span className="px-2 py-0.5 rounded-lg bg-slate-800/60 text-slate-400 tabular-nums">{fmtRupiah(r.value)}</span> : null}
                    {(metrics.get(r.c.component_id)?.revenue90d ?? 0) > 0 && (
                      <span className="px-2 py-0.5 rounded-lg bg-slate-800/60 tabular-nums"><VolCell m={metrics.get(r.c.component_id)} /></span>
                    )}
                    {r.activity > 0 && <span className="px-2 py-0.5 rounded-lg bg-slate-800/60 text-slate-500 tabular-nums">{r.activity} docs</span>}
                  </div>
                </button>
                {isOpen && (
                  <div className="px-3.5 pb-3.5 space-y-3">
                    <ItemCostForensics componentId={r.c.component_id} components={comps}
                      quotes={quotes} quoteItems={quoteItems} pos={pos} poItems={poItems} poCosts={poCosts}
                      suppliers={suppliers} componentLinks={componentLinks} tucMap={tucMap} fx={fx} showLead />
                    <div className="flex items-center gap-4">
                      <Link href={`/items/${r.c.component_id}`}
                        className="inline-flex items-center gap-1 text-[11px] font-semibold text-emerald-400 hover:text-emerald-300 transition-colors">
                        Open the full item hub →
                      </Link>
                      {r.c.datasheet_url && (
                        <a href={r.c.datasheet_url} target="_blank" rel="noopener noreferrer"
                          className="text-[11px] text-sky-400 hover:text-sky-300 transition-colors">datasheet ↗</a>
                      )}
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>

        <p className="text-[11px] text-slate-600">
          Click a row for its cost forensics — quotes, PO allocations, payments and linked items — or the ↗ for the full
          item hub (sell, stock, specs, economics). Same numbers as Spend &amp; Cash › Cost Lookup, same engine.
        </p>
      </main>
    </div>
  );
}
