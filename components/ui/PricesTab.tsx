'use client';
import { useEffect, useMemo, useState, type ReactNode } from 'react';
import Link from 'next/link';
import { createSupabaseClient } from '@/lib/supabase';
import { useT } from '@/hooks/useT';
import { fmtDay, fmtRupiah, fmtInt, fmtMoneyCell, moneyUnit } from '@/lib/formatters';
import { BAR_INPUT, BAR_SELECT } from '@/constants/controls';
import { marginPct, belowFloor, priceForMargin } from '@/lib/priceGrid';
import { roundUpToStep } from '@/lib/tierPricing';
import { costHistory, costTrend, similarTo, restockGap, type CostPoint, type CostTrend } from '@/lib/priceInsight';
import type { ProductLead } from '@/lib/supplierLeadTimes';

/**
 * Selling Prices › Prices — the three questions on one row (owner, 2026-10-22):
 *   1. What did it last cost, when, and is cost going up or down?
 *   2. At this price, what is the margin — per tier — and is it cheaper or
 *      dearer than the similar items we sell?
 *   3. How long does it usually take to arrive?
 * The list carries only those answers; everything behind them (cost per PO,
 * tiers, what we sold it for, lead time per order, price changes) sits in the
 * item's detail: a side panel on desktop, a full screen on a phone.
 *
 * The owner's calls on the preview: the headline margin is AT LAST COST (what
 * a sale earns once you restock), the comparison is the same category at a
 * similar size, and items with no price yet sit behind their own filter.
 * "I still want to be shown margin for T2 and T3" — every tier's margin is on
 * the row and in the detail.
 *
 * Numbers come from the engines that own them (lib/priceInsight.ts says
 * which); this file only lays them out. Prices save through the page's own
 * write path, the same one Set Pricing uses.
 */

export interface PricesComp {
  component_id: string; name: string; category: string | null; norm_value: number | null;
  selling_price_idr: number | null;
}
export interface PricesTier { tier_id: string; name: string; margin_floor_pct: number }
/**
 * A tier priced under its margin floor — the Floor Audit's own verdict (landed
 * cost, or the supplier quote where nothing has landed), handed in by the page.
 * The audit was a tab until 2026-10-22; it is the "Below floor" filter now.
 */
export interface FloorBreach {
  componentId: string; tierId: string; tierName: string;
  /** The lowest price that clears the floor, on a clean rounding step. */
  minPrice: number | null;
  /** (minPrice − price) × on-hand: money at stake on stock we hold. */
  leakage: number;
  /** The cost behind it is a quote, not a landed cost. */
  provisional: boolean;
}
export interface PriceLogLite { tier_id: string | null; old_price_idr: number | null; new_price_idr: number | null; changed_at: string; changed_by_email: string | null }

type SortCol = 'item' | 'cost' | 'margin' | 'lead';
type Filter = 'priced' | 'up' | 'low' | 'one' | 'floor' | 'pinned' | 'unpriced';
const FILTERS: Filter[] = ['priced', 'up', 'low', 'one', 'floor', 'pinned', 'unpriced'];
const LOW_MARGIN = 15;
const UP_PCT = 5;

interface Row {
  c: PricesComp;
  points: CostPoint[];
  trend: CostTrend;
  /** The cost the margin is measured against: the last purchase, else the page's cost basis (a quote). */
  cost: number | null;
  costFromQuote: boolean;
  stockCost: number | null;
  stock: number;
  lead: ProductLead | null;
}

export default function PricesTab({
  comps, tiers, chainAt, paidOf, receivedOf, basisCost, stockCost, stockOf, leadOf, priceLog, tierName,
  canManage, saving, onSaveNet, showPoNumbers, canSeeCompetitors, canOpenItem, roundStep,
  floor, pinned, initialFilter, totalLeakage, bulkBusy, onRaise, onRaiseAll, onUnpin,
}: {
  comps: PricesComp[];
  tiers: PricesTier[];
  /** Every active tier's price for this item at a given net — overrides respected. */
  chainAt: (componentId: string, net: number | null) => Map<string, { price: number | null; overridden: boolean }>;
  paidOf: (componentId: string) => { label: string; date: string; unitCost: number }[];
  receivedOf: (componentId: string) => { label: string; date: string; unitCost: number }[];
  basisCost: (componentId: string) => { cost: number | null; provisional: boolean };
  stockCost: (componentId: string) => number | null;
  stockOf: (componentId: string) => number;
  leadOf: (componentId: string) => ProductLead | null;
  priceLog: Map<string, PriceLogLite[]>;
  tierName: (tierId: string | null) => string;
  canManage: boolean;
  saving: boolean;
  onSaveNet: (componentId: string, value: number) => Promise<number>;
  /** PO numbers are buy-side detail; a sell-side admin sees the cost and the date, not the order. */
  showPoNumbers: boolean;
  canSeeCompetitors: boolean;
  canOpenItem: boolean;
  roundStep: number;
  floor: Map<string, FloorBreach[]>;
  /** Tiers pinned to a price by hand (21.1 overrides), per item. */
  pinned: Map<string, { tierId: string; priceId: string }[]>;
  /** From ?filter= — Settings › Pricing links straight to the below-floor list. */
  initialFilter?: string;
  totalLeakage: number;
  bulkBusy: boolean;
  onRaise: (b: FloorBreach) => void;
  onRaiseAll: () => void;
  onUnpin: (priceId: string) => void;
}) {
  const { t, tf } = useT();
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState<Filter>(FILTERS.includes(initialFilter as Filter) ? (initialFilter as Filter) : 'priced');
  const [confirmAll, setConfirmAll] = useState(false);
  // Sorting (owner, 2026-10-23: "should allow users to sort columns Items, Last Cost, Margin,
  // and Lead Time"). No column picked = most recently bought first.
  const [sort, setSort] = useState<{ col: SortCol; dir: 'asc' | 'desc' } | null>(null);
  const sortBy = (col: SortCol) => setSort((s) => s?.col === col
    ? { col, dir: s.dir === 'asc' ? 'desc' : 'asc' }
    : { col, dir: col === 'item' ? 'asc' : 'desc' });
  const [selected, setSelected] = useState<string | null>(null);
  const [sheet, setSheet] = useState(false);        // phone: the detail is open full screen
  const [drafts, setDrafts] = useState<Map<string, string>>(new Map());

  const rows: Row[] = useMemo(() => comps.map((c) => {
    const points = costHistory(paidOf(c.component_id), receivedOf(c.component_id));
    const trend = costTrend(points);
    const basis = basisCost(c.component_id);
    return {
      c, points, trend,
      cost: trend.last?.unitCost ?? basis.cost,
      costFromQuote: !trend.last && basis.cost != null,
      stockCost: stockCost(c.component_id),
      stock: stockOf(c.component_id),
      lead: leadOf(c.component_id),
    };
  }), [comps, paidOf, receivedOf, basisCost, stockCost, stockOf, leadOf]);

  const netOf = (r: Row): number | null => {
    const d = drafts.get(r.c.component_id);
    if (d != null) { const n = Number(d.replace(/[^0-9]/g, '')); return n > 0 ? n : null; }
    return Number(r.c.selling_price_idr) > 0 ? Number(r.c.selling_price_idr) : null;
  };
  const t1Margin = (r: Row): number | null => marginPct(netOf(r), r.cost);
  const floor1 = tiers[0]?.margin_floor_pct ?? 0;

  const matches = (r: Row, f: Filter): boolean => {
    const priced = Number(r.c.selling_price_idr) > 0;
    switch (f) {
      case 'unpriced': return !priced;
      case 'priced': return priced;
      case 'up': return priced && r.trend.dir === 'up' && (r.trend.changePct ?? 0) >= UP_PCT;
      case 'low': { const m = t1Margin(r); return priced && m != null && m < LOW_MARGIN; }
      case 'one': return priced && r.trend.dir === 'first';
      case 'floor': return priced && floor.has(r.c.component_id);
      case 'pinned': return priced && pinned.has(r.c.component_id);
    }
  };
  // Plain arithmetic over ~1,000 rows on each render: cheaper than keeping a
  // memo honest about drafts typed into any of them.
  const counts: Record<Filter, number> = { priced: 0, up: 0, low: 0, one: 0, floor: 0, pinned: 0, unpriced: 0 };
  for (const r of rows) for (const f of Object.keys(counts) as Filter[]) if (matches(r, f)) counts[f] += 1;

  const q = search.trim().toLowerCase();
  const shown = rows
    .filter((r) => matches(r, filter) && (!q || r.c.name.toLowerCase().includes(q) || (r.c.category ?? '').toLowerCase().includes(q)))
    .sort((a, b) => {
      if (sort) {
        // An item with no number for this column sorts last, whichever way the column runs.
        const key = (r: Row): number | string | null => sort.col === 'item' ? r.c.name.toLowerCase()
          : sort.col === 'cost' ? r.cost
          : sort.col === 'margin' ? t1Margin(r)
          : (r.lead?.poToReceived?.median ?? null);
        const ka = key(a), kb = key(b);
        if (ka == null || kb == null) return ka == null && kb == null ? 0 : ka == null ? 1 : -1;
        const c = typeof ka === 'string' ? ka.localeCompare(kb as string) : (ka as number) - (kb as number);
        if (c) return sort.dir === 'asc' ? c : -c;
      }
      // Default: most recently bought first — the items whose cost just moved are the ones to look at.
      return (b.trend.last?.date ?? '').localeCompare(a.trend.last?.date ?? '') || a.c.name.localeCompare(b.c.name);
    });

  const sel = rows.find((r) => r.c.component_id === selected) ?? shown[0] ?? null;

  const setDraft = (cid: string, v: string | null) => setDrafts((m) => {
    const n = new Map(m);
    if (v == null) n.delete(cid); else n.set(cid, v);
    return n;
  });
  async function save(r: Row) {
    const v = netOf(r);
    if (!canManage || v == null || v === Number(r.c.selling_price_idr)) { setDraft(r.c.component_id, null); return; }
    const failed = await onSaveNet(r.c.component_id, v);
    if (!failed) setDraft(r.c.component_id, null);
  }

  const marginCls = (m: number | null, floorPct: number) =>
    m == null ? 'text-slate-500' : belowFloor(m, floorPct) ? 'text-red-400' : m < LOW_MARGIN ? 'text-amber-300' : 'text-emerald-300';

  const trendTag = (tr: CostTrend) => {
    if (tr.outliers.length && tr.dir !== 'up') return <span className="ml-1.5 text-[11px] font-semibold text-amber-300 whitespace-nowrap">⚠ {t('check')}</span>;
    if (tr.dir === 'up' || tr.dir === 'down') {
      return <span className={`ml-1.5 text-[11px] font-semibold whitespace-nowrap ${tr.dir === 'up' ? 'text-red-400' : 'text-emerald-300'}`}>
        {tr.dir === 'up' ? '↑' : '↓'} {Math.abs(tr.changePct ?? 0).toFixed(0)}%
      </span>;
    }
    if (tr.dir === 'flat') return <span className="ml-1.5 text-[11px] text-slate-500 whitespace-nowrap">→ {t('flat')}</span>;
    return null;
  };

  const otherTierMargins = (r: Row) => {
    const chain = chainAt(r.c.component_id, netOf(r));
    return tiers.slice(1).map((tr) => {
      const m = marginPct(chain.get(tr.tier_id)?.price ?? null, r.cost);
      return m == null ? null : `${tr.name.replace(/^Tier-?/i, 'T')} ${m.toFixed(0)}%`;
    }).filter(Boolean).join(' · ');
  };

  const priceInput = (r: Row, big = false) => {
    const cid = r.c.component_id;
    const dirty = drafts.has(cid) && netOf(r) !== (Number(r.c.selling_price_idr) || null);
    if (!canManage) return <span className="font-semibold tabular-nums">{netOf(r) ? fmtInt(netOf(r)!) : '—'}</span>;
    return (
      <span className={`${big ? 'inline-flex' : 'flex justify-end'} items-center gap-1.5`} onClick={(e) => e.stopPropagation()}>
        <input inputMode="numeric" aria-label={t('Net price')}
          value={drafts.get(cid) ?? (Number(r.c.selling_price_idr) > 0 ? fmtInt(Number(r.c.selling_price_idr)) : '')}
          placeholder={t('Set price')}
          onChange={(e) => setDraft(cid, e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') void save(r); if (e.key === 'Escape') setDraft(cid, null); }}
          className={`${BAR_INPUT} ${big ? 'w-40' : 'w-full min-w-0 max-w-[9rem]'} text-right tabular-nums font-semibold ${dirty ? 'border-sky-500/60' : ''}`} />
        {dirty && (
          <button type="button" disabled={saving} onClick={() => void save(r)}
            className="h-9 px-2.5 rounded-lg text-[12px] font-semibold bg-emerald-600 text-white hover:bg-emerald-500 disabled:opacity-50">
            {t('Save')}
          </button>
        )}
      </span>
    );
  };

  const open = (cid: string) => { setSelected(cid); setSheet(true); };

  return (
    <div className="space-y-3">
      <div className="flex gap-2 max-w-2xl">
        <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder={t('Search')}
          className={`${BAR_INPUT} flex-1 min-w-0`} />
        <select value={filter} onChange={(e) => setFilter(e.target.value as Filter)} className={`${BAR_SELECT} flex-shrink-0`}>
          <option value="priced">{tf('Priced items ({n})', { n: counts.priced })}</option>
          <option value="up">{tf('Cost went up ({n})', { n: counts.up })}</option>
          <option value="low">{tf('Margin under 15% ({n})', { n: counts.low })}</option>
          <option value="one">{tf('Only 1 purchase ({n})', { n: counts.one })}</option>
          <option value="floor">{tf('Below floor ({n})', { n: counts.floor })}</option>
          <option value="pinned">{tf('Pinned prices ({n})', { n: counts.pinned })}</option>
          <option value="unpriced">{tf('No price yet ({n})', { n: counts.unpriced })}</option>
        </select>
      </div>

      {filter === 'floor' && counts.floor > 0 && (() => {
        const n = [...floor.values()].reduce((s, b) => s + b.filter((x) => x.minPrice != null).length, 0);
        // A breach measured on a supplier quote is unproven — and unproven in a known
        // direction: a quote leaves out freight and duty, so the real margin is lower still.
        const provisionalViolations = [...floor.values()].reduce((s, b) => s + b.filter((x) => x.provisional).length, 0);
        return (
          <div className="flex flex-wrap items-center gap-3 rounded-xl border border-red-500/30 bg-red-500/[0.07] px-3.5 py-2.5 text-[13px]">
            <p className="text-red-200 flex-1 min-w-[14rem]">
              {n === 1 ? t('1 tier price sits under its floor.') : tf('{n} tier prices sit under their floor.', { n })}
              {totalLeakage > 0 && <> {tf('{amount} at stake on stock in hand.', { amount: fmtRupiah(totalLeakage) })}</>}
              {provisionalViolations > 0 && (
                <span className="block mt-1 text-amber-300/90 text-[12px]">
                  {tf('{n} of them rest on a supplier quote (marked QUOTE), not a landed cost. A quote leaves out freight, duty and fees, so the true margin is worse than shown, not better.', { n: provisionalViolations })}
                </span>
              )}
            </p>
            {canManage && n > 0 && (confirmAll ? (
              <span className="flex items-center gap-2">
                <button type="button" disabled={bulkBusy} onClick={() => { setConfirmAll(false); onRaiseAll(); }}
                  className="h-9 px-3 rounded-lg bg-red-600 text-white font-semibold hover:bg-red-500 disabled:opacity-50">{tf('Raise {n} prices', { n })}</button>
                <button type="button" onClick={() => setConfirmAll(false)} className="h-9 px-3 rounded-lg text-slate-300 hover:text-white">{t('Cancel')}</button>
              </span>
            ) : (
              <button type="button" disabled={bulkBusy} onClick={() => setConfirmAll(true)}
                className="h-9 px-3 rounded-lg border border-red-500/40 text-red-200 font-semibold hover:bg-red-500/10 disabled:opacity-50">{t('Raise all to the floor')}</button>
            ))}
          </div>
        );
      })()}

      <div className="md:grid md:grid-cols-[minmax(0,1fr)_380px] md:gap-4 md:items-start">
        {/* ── Desktop: the table ── */}
        <div className="hidden md:block bg-slate-900/50 border border-slate-800 rounded-xl overflow-hidden">
          <table className="w-full table-fixed text-[13px]">
            <colgroup><col className="w-[34%]" /><col className="w-[21%]" /><col className="w-[19%]" /><col className="w-[15%]" /><col className="w-[11%]" /></colgroup>
            <thead>
              <tr className="text-[10.5px] uppercase tracking-wider text-slate-500 border-b border-slate-800">
<th className="text-left font-semibold px-3 py-2.5" aria-sort={sort?.col === 'item' ? (sort.dir === 'asc' ? 'ascending' : 'descending') : 'none'}>
                  <button type="button" onClick={() => sortBy('item')} className={`inline-flex items-center gap-1 uppercase tracking-wider hover:text-slate-200 ${sort?.col === 'item' ? 'text-slate-200' : ''}`}>
                    {t('Item')}<span aria-hidden className="text-[9px]">{sort?.col === 'item' ? (sort.dir === 'asc' ? '▲' : '▼') : '↕'}</span>
                  </button>
                </th>
                <th className="text-left font-semibold px-3 py-2.5" aria-sort={sort?.col === 'cost' ? (sort.dir === 'asc' ? 'ascending' : 'descending') : 'none'}>
                  <button type="button" onClick={() => sortBy('cost')} className={`inline-flex items-center gap-1 uppercase tracking-wider hover:text-slate-200 ${sort?.col === 'cost' ? 'text-slate-200' : ''}`}>
                    {t('Last cost')} ({moneyUnit()})<span aria-hidden className="text-[9px]">{sort?.col === 'cost' ? (sort.dir === 'asc' ? '▲' : '▼') : '↕'}</span>
                  </button>
                </th>
                <th className="text-right font-semibold px-3 py-2.5">{t('Net price')} ({moneyUnit()})</th>
<th className="text-right font-semibold px-3 py-2.5" aria-sort={sort?.col === 'margin' ? (sort.dir === 'asc' ? 'ascending' : 'descending') : 'none'}>
                  <button type="button" onClick={() => sortBy('margin')} className={`inline-flex items-center gap-1 uppercase tracking-wider hover:text-slate-200 ${sort?.col === 'margin' ? 'text-slate-200' : ''}`}>
                    {t('Margin')}<span aria-hidden className="text-[9px]">{sort?.col === 'margin' ? (sort.dir === 'asc' ? '▲' : '▼') : '↕'}</span>
                  </button>
                </th>
                <th className="text-right font-semibold px-3 py-2.5" aria-sort={sort?.col === 'lead' ? (sort.dir === 'asc' ? 'ascending' : 'descending') : 'none'}>
                  <button type="button" onClick={() => sortBy('lead')} className={`inline-flex items-center gap-1 uppercase tracking-wider hover:text-slate-200 ${sort?.col === 'lead' ? 'text-slate-200' : ''}`}>
                    {t('Lead time')}<span aria-hidden className="text-[9px]">{sort?.col === 'lead' ? (sort.dir === 'asc' ? '▲' : '▼') : '↕'}</span>
                  </button>
                </th>
              </tr>
            </thead>
            <tbody>
              {shown.slice(0, 300).map((r) => {
                const m = t1Margin(r);
                return (
                  <tr key={r.c.component_id} onClick={() => setSelected(r.c.component_id)}
                    className={`border-b border-slate-800/60 cursor-pointer transition-colors ${sel?.c.component_id === r.c.component_id ? 'bg-sky-500/10' : 'hover:bg-white/[0.03]'}`}>
                    <td className="px-3 py-2.5"><p className="font-semibold text-slate-100 truncate" title={r.c.name}>{r.c.name}</p></td>
                    <td className="px-3 py-2.5 whitespace-nowrap">
                      {r.cost != null ? (<>
                        <span className="font-bold text-slate-100 tabular-nums">{fmtMoneyCell(r.cost)}</span>{trendTag(r.trend)}
                        {r.costFromQuote && <span className="ml-1.5 align-middle px-1 py-px rounded bg-amber-500/15 text-amber-300 text-[9px] font-bold tracking-wide" title={t('A supplier quote, not a landed cost: freight, duty and fees are not in it yet.')}>QUOTE</span>}
                        <p className="text-[11px] text-slate-500">{r.costFromQuote ? t('supplier quote') : fmtDay(r.trend.last?.date)}</p>
                      </>) : <span className="text-slate-600">—</span>}
                    </td>
                    <td className="px-3 py-2 text-right">{priceInput(r)}</td>
                    <td className="px-3 py-2.5 text-right whitespace-nowrap">
                      <span className={`font-bold tabular-nums ${marginCls(m, floor1)}`}>{m == null ? '—' : `${m.toFixed(1)}%`}</span>
                      {m != null && <p className="text-[11px] text-slate-500 tabular-nums">{otherTierMargins(r)}</p>}
                    </td>
                    <td className="px-3 py-2.5 text-right font-bold tabular-nums whitespace-nowrap">
                      {r.lead?.poToReceived ? `${Math.round(r.lead.poToReceived.median)} d` : <span className="text-slate-600 font-normal">—</span>}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          {shown.length === 0 && <p className="px-4 py-10 text-center text-[13px] text-slate-500">{t('Nothing matches.')}</p>}
          {shown.length > 300 && <p className="px-4 py-3 text-[12px] text-slate-500">{tf('Showing 300 of {n}. Search to narrow.', { n: shown.length })}</p>}
        </div>

        {/* ── Phone: one card per item, tap for the detail ── */}
        <div className="md:hidden bg-slate-900/50 border border-slate-800 rounded-xl divide-y divide-slate-800/70">
          {shown.slice(0, 150).map((r) => {
            const m = t1Margin(r);
            return (
              <button key={r.c.component_id} type="button" onClick={() => open(r.c.component_id)} className="w-full text-left px-3.5 py-3">
                <span className="flex items-center justify-between gap-2">
                  <span className="font-semibold text-slate-100 truncate">{r.c.name}</span>
                  <span className="text-slate-500 flex-shrink-0">›</span>
                </span>
                <span className="mt-1.5 grid grid-cols-[1.5fr_.9fr_.6fr] gap-2">
                  <span>
                    <span className="font-bold text-slate-100 tabular-nums">{r.cost != null ? fmtRupiah(r.cost) : '—'}</span>{trendTag(r.trend)}
                    {r.costFromQuote && <span className="ml-1.5 align-middle px-1 py-px rounded bg-amber-500/15 text-amber-300 text-[9px] font-bold tracking-wide" title={t('A supplier quote, not a landed cost: freight, duty and fees are not in it yet.')}>QUOTE</span>}
                    <span className="block text-[11px] text-slate-500">{r.costFromQuote ? t('supplier quote') : r.trend.last ? fmtDay(r.trend.last.date) : t('no cost yet')}</span>
                  </span>
                  <span>
                    <span className={`font-bold tabular-nums ${marginCls(m, floor1)}`}>{m == null ? '—' : `${m.toFixed(1)}%`}</span>
                    <span className="block text-[11px] text-slate-500 tabular-nums">{m == null ? t('margin') : otherTierMargins(r)}</span>
                  </span>
                  <span>
                    <span className="font-bold tabular-nums">{r.lead?.poToReceived ? `${Math.round(r.lead.poToReceived.median)} d` : '—'}</span>
                    <span className="block text-[11px] text-slate-500">{t('lead')}</span>
                  </span>
                </span>
              </button>
            );
          })}
          {shown.length === 0 && <p className="px-4 py-10 text-center text-[13px] text-slate-500">{t('Nothing matches.')}</p>}
        </div>

        {/* ── The detail: side panel on desktop, full screen on a phone ── */}
        {sel && (
          <aside className={`${sheet ? 'fixed inset-0 z-50 overflow-y-auto px-4 pb-6 bg-canvas' : 'hidden'} md:block md:inset-auto md:z-auto md:px-5 md:py-5 md:pb-5 md:bg-slate-900/50 md:border md:border-slate-800 md:rounded-xl md:sticky md:top-20`}>
            <button type="button" onClick={() => setSheet(false)}
              className="md:hidden sticky top-0 -mx-4 mb-3 flex h-12 w-[calc(100%+2rem)] items-center px-4 border-b border-slate-800 bg-canvas text-[15px] font-semibold text-sky-300">
              ‹ {t('Prices')}
            </button>
            <PriceDetail r={sel} tiers={tiers} net={netOf(sel)} chain={chainAt(sel.c.component_id, netOf(sel))}
              priceInput={priceInput(sel, true)} catalog={comps} priceLog={priceLog.get(sel.c.component_id) ?? []}
              tierName={tierName} showPoNumbers={showPoNumbers} canSeeCompetitors={canSeeCompetitors} canOpenItem={canOpenItem}
              canManage={canManage} roundStep={roundStep}
              breaches={floor.get(sel.c.component_id) ?? []} pins={pinned.get(sel.c.component_id) ?? []}
              onRaise={onRaise} onUnpin={onUnpin}
              onUsePrice={(v) => setDraft(sel.c.component_id, fmtInt(v))} marginCls={marginCls} />
          </aside>
        )}
      </div>
    </div>
  );
}

function PriceDetail({ r, tiers, net, chain, priceInput, catalog, priceLog, tierName, showPoNumbers, canSeeCompetitors, canOpenItem, canManage, roundStep, breaches, pins, onRaise, onUnpin, onUsePrice, marginCls }: {
  r: Row; tiers: PricesTier[]; net: number | null;
  chain: Map<string, { price: number | null; overridden: boolean }>;
  priceInput: ReactNode;
  catalog: PricesComp[];
  priceLog: PriceLogLite[];
  tierName: (tierId: string | null) => string;
  showPoNumbers: boolean; canSeeCompetitors: boolean; canOpenItem: boolean; canManage: boolean; roundStep: number;
  breaches: FloorBreach[];
  pins: { tierId: string; priceId: string }[];
  onRaise: (b: FloorBreach) => void;
  onUnpin: (priceId: string) => void;
  onUsePrice: (v: number) => void;
  marginCls: (m: number | null, floorPct: number) => string;
}) {
  const { t, tf } = useT();
  const supabase = useMemo(() => createSupabaseClient(), []);
  const cid = r.c.component_id;
  const [sold, setSold] = useState<{ date: string; qty: number; price: number }[] | null>(null);
  const [showChanges, setShowChanges] = useState(false);

  // What we sold it for — read when an item is opened, not for all thousand.
  useEffect(() => {
    let live = true;
    (async () => {
      const { data: lines } = await supabase.from('22.1_sales_quote_items')
        .select('quote_id, quantity, unit_price').eq('component_id', cid).limit(200);
      const ls = (lines ?? []) as { quote_id: string; quantity: number; unit_price: number }[];
      if (!ls.length) { if (live) setSold([]); return; }
      const { data: qs } = await supabase.from('22.0_sales_quotes').select('quote_id, quote_date, status')
        .in('quote_id', [...new Set(ls.map((l) => l.quote_id))]).not('status', 'in', '(draft,cancelled)');
      const byQ = new Map(((qs ?? []) as { quote_id: string; quote_date: string; status: string }[]).map((q) => [q.quote_id, q]));
      const out = ls.filter((l) => byQ.has(l.quote_id) && Number(l.unit_price) > 0)
        .map((l) => ({ date: byQ.get(l.quote_id)!.quote_date, qty: Number(l.quantity) || 0, price: Number(l.unit_price) }))
        .sort((a, b) => b.date.localeCompare(a.date)).slice(0, 3);
      if (live) setSold(out);
    })().catch(() => { if (live) setSold([]); });
    return () => { live = false; };
  }, [supabase, cid]);

  const m1 = marginPct(net, r.cost);
  const stockM = marginPct(net, r.stockCost);
  const sim = net ? similarTo(r.c, net, catalog) : null;
  const gap = net ? restockGap(r.trend.last?.unitCost ?? null, r.stockCost, net) : null;
  const keep = gap && r.cost ? priceForMargin(r.cost, gap.stockMargin) : null;
  const keepPrice = keep ? roundUpToStep(keep, roundStep) : null;
  const lead = r.lead;
  const viaOf = (l: ProductLead) => {
    const n = new Map<string, number>();
    for (const p of l.pos) if (p.via) n.set(p.via, (n.get(p.via) ?? 0) + 1);
    return [...n].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;
  };

  return (
    <div>
      <h2 className="text-[16px] font-bold text-white leading-snug">{r.c.name}</h2>
      <p className="text-[12px] text-slate-500">{tf('{n} in stock', { n: fmtInt(r.stock) })}</p>

      <div className="mt-4 flex items-center gap-4 flex-wrap">
        {priceInput}
        <div>
          <p className={`text-2xl font-bold leading-none tabular-nums ${marginCls(m1, tiers[0]?.margin_floor_pct ?? 0)}`}>{m1 == null ? '—' : `${m1.toFixed(1)}%`}</p>
          <p className="text-[11.5px] text-slate-500 mt-1">
            {r.costFromQuote ? t('margin on the supplier quote') : t('margin at last cost')}
            {stockM != null && m1 != null && Math.abs(stockM - m1) >= 1 && <><br />{tf('{pct} on current stock', { pct: `${stockM.toFixed(1)}%` })}</>}
          </p>
        </div>
      </div>

      {/* Every tier, with its own margin (owner: "I still want to be shown margin for T2 and T3"). */}
      {net != null && (
        <div className="mt-3 rounded-lg border border-slate-800 divide-y divide-slate-800/70 text-[13px]">
          {tiers.map((tr) => {
            const e = chain.get(tr.tier_id);
            const m = marginPct(e?.price ?? null, r.cost);
            const breach = breaches.find((b) => b.tierId === tr.tier_id) ?? null;
            const pin = e?.overridden ? (pins.find((p) => p.tierId === tr.tier_id) ?? null) : null;
            return (
              <div key={tr.tier_id} className="px-3 py-1.5">
                <div className="flex items-center justify-between gap-3">
                  <span className="text-slate-400">{tr.name}{e?.overridden && <span className="ml-1 text-[10.5px] text-violet-300">{t('pinned')}</span>}</span>
                  <span className="tabular-nums">
                    <span className="text-slate-200 font-semibold">{e?.price ? fmtInt(e.price) : '—'}</span>
                    <span className={`ml-3 inline-block w-14 text-right font-semibold ${marginCls(m, tr.margin_floor_pct)}`}>{m == null ? '—' : `${m.toFixed(1)}%`}</span>
                  </span>
                </div>
                {/* The Floor Audit's fix and the Overrides list's unpin, on the tier they belong to. */}
                {canManage && (breach || pin) && (
                  <div className="mt-1 flex flex-wrap justify-end gap-2 text-[11.5px]">
                    {breach?.minPrice != null && (
                      <button type="button" onClick={() => onRaise(breach)}
                        className="px-2 py-1 rounded-md border border-red-500/40 text-red-200 hover:bg-red-500/10"
                        title={breach.provisional ? t('The floor is checked against a supplier quote: nothing has landed yet.') : t('The floor is checked against the landed cost of stock in hand.')}>
                        {tf('Under the {pct}% floor: raise to {price}', { pct: tr.margin_floor_pct, price: fmtInt(breach.minPrice) })}
                      </button>
                    )}
                    {pin && (
                      <button type="button" onClick={() => onUnpin(pin.priceId)}
                        className="px-2 py-1 rounded-md border border-violet-500/40 text-violet-200 hover:bg-violet-500/10">
                        {t('Unpin')}
                      </button>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
      {/* A pinned tier does not follow the net. Raise the net past it and T2 sells for LESS than
          Tier-1 — say so where the price is being typed, not three tabs away. */}
      {net != null && tiers.some((tr, i) => {
        const e = chain.get(tr.tier_id), before = i > 0 ? chain.get(tiers[i - 1].tier_id)?.price : null;
        return i > 0 && e?.overridden && e.price != null && before != null && e.price < before;
      }) && (
        <p className="mt-2 text-[12px] text-red-300">{t('A pinned tier is now cheaper than the tier before it: unpin it or raise it.')}</p>
      )}

      {(sim || (sold && sold[0])) && (
        <p className="mt-2 text-[12px] text-slate-400">
          {sim && (Math.abs(sim.diffPct) < 2
            ? <>{tf('Same as similar items ({per}/{unit})', { per: fmtInt(sim.peerPerUnit), unit: sim.unit })}</>
            : <><b className={sim.diffPct < 0 ? 'text-emerald-300' : 'text-amber-300'}>{tf(sim.diffPct < 0 ? '{pct}% cheaper' : '{pct}% dearer', { pct: Math.abs(sim.diffPct).toFixed(0) })}</b>{' '}
                {sim.peers.length <= 2
                  ? tf('than {names}', { names: sim.peers.map((p) => p.name).join(', ') })
                  : tf('than {n} similar items', { n: sim.peers.length })}
                {' '}<span className="text-slate-500">({fmtInt(sim.perUnit)} vs {fmtInt(sim.peerPerUnit)}/{sim.unit})</span></>)}
          {sim && sold && sold[0] && ' · '}
          {sold && sold[0] && tf('last sold {price} on {date}', { price: fmtRupiah(sold[0].price), date: fmtDay(sold[0].date) })}
        </p>
      )}

      {gap && keepPrice && (
        <div className="mt-3 rounded-lg bg-amber-500/10 border border-amber-500/30 px-3 py-2.5 text-[12.5px] text-amber-200">
          {tf('The last order cost {pct}% more than the stock you hold. After restocking, margin falls to {m}.', {
            pct: (((r.trend.last!.unitCost - r.stockCost!) / r.stockCost!) * 100).toFixed(0), m: `${gap.lastMargin.toFixed(1)}%` })}
          {canManage && (
            <button type="button" onClick={() => onUsePrice(keepPrice)}
              className="mt-2 block h-9 px-3 rounded-lg border border-amber-500/40 bg-amber-500/10 font-semibold hover:bg-amber-500/20">
              {tf('Use {price} to keep {m}', { price: fmtInt(keepPrice), m: `${gap.stockMargin.toFixed(1)}%` })}
            </button>
          )}
        </div>
      )}
      {r.trend.outliers.length > 0 && (
        <p className="mt-3 rounded-lg bg-amber-500/10 border border-amber-500/30 px-3 py-2 text-[12.5px] text-amber-200">
          ⚠ {tf('{n} purchase cost far from the others and is left out of the trend: {list}', {
            n: r.trend.outliers.length,
            list: r.trend.outliers.map((o) => `${showPoNumbers ? `${o.label} ` : ''}${fmtDay(o.date)} ${fmtRupiah(o.unitCost)}`).join(', ') })}
        </p>
      )}

      <h3 className="mt-5 mb-1 text-[10.5px] font-semibold uppercase tracking-widest text-slate-500">{t('Cost per unit')}</h3>
      {r.points.length === 0 ? <p className="text-[12.5px] text-slate-500">{r.costFromQuote ? t('Not bought yet: the margin uses the supplier quote.') : t('Not bought yet.')}</p>
        : r.points.slice(0, 6).map((p, i, arr) => {
          const older = arr.slice(i + 1).find((o) => !r.trend.outliers.includes(o));
          const d = older && !r.trend.outliers.includes(p) ? (p.unitCost - older.unitCost) / older.unitCost * 100 : null;
          return (
            <div key={`${p.label}-${i}`} className="flex items-center justify-between gap-3 py-1.5 border-b border-slate-800/60 text-[13px]">
              <span className="text-slate-300">{fmtDay(p.date)}
                {showPoNumbers && <span className="ml-2 text-[11px] text-slate-500">{p.label}</span>}
                {p.source === 'received' && <span className="ml-2 text-[11px] text-slate-500">{t('not paid yet')}</span>}
              </span>
              <span className="tabular-nums">
                <b className={r.trend.outliers.includes(p) ? 'text-amber-300 line-through' : 'text-slate-100'}>{fmtRupiah(p.unitCost)}</b>
                {d != null && Math.abs(d) >= 2 && <span className={`ml-2 text-[11px] font-semibold ${d > 0 ? 'text-red-400' : 'text-emerald-300'}`}>{d > 0 ? '↑' : '↓'} {Math.abs(d).toFixed(0)}%</span>}
              </span>
            </div>
          );
        })}

      <h3 className="mt-5 mb-1 text-[10.5px] font-semibold uppercase tracking-widest text-slate-500">{t('Lead time')}</h3>
      {lead?.poToReceived ? (
        <p className="text-[13px] text-slate-200">
          {viaOf(lead)
            ? tf('{days} days by {via}', { days: Math.round(lead.poToReceived.median), via: viaOf(lead) === 'Air' ? t('air') : viaOf(lead) === 'Sea' ? t('sea') : t('local delivery') })
            : tf('{days} days', { days: Math.round(lead.poToReceived.median) })}
          <span className="text-slate-500">
            {' · '}{lead.poToReceived.n > 1
              ? tf('{min}–{max} d over {n} orders', { min: Math.round(lead.poToReceived.min), max: Math.round(lead.poToReceived.max), n: lead.poToReceived.n })
              : t('1 order')}
          </span>
        </p>
      ) : <p className="text-[12.5px] text-slate-500">{t('No order has arrived yet.')}</p>}

      <h3 className="mt-5 mb-1 text-[10.5px] font-semibold uppercase tracking-widest text-slate-500">{t('Sales history')}</h3>
      {sold === null ? <p className="text-[12.5px] text-slate-500">…</p>
        : sold.length === 0 ? <p className="text-[12.5px] text-slate-500">{t('Not sold yet.')}</p>
        : sold.map((s, i) => (
          <div key={i} className="flex justify-between gap-3 py-1.5 border-b border-slate-800/60 text-[13px]">
            <span className="text-slate-300">{fmtDay(s.date)} <span className="text-slate-500">· {fmtInt(s.qty)} pcs</span></span>
            <b className="tabular-nums text-slate-100">{fmtRupiah(s.price)}</b>
          </div>
        ))}

      <div className="mt-4 divide-y divide-slate-800/70 border-t border-slate-800/70 text-[13px] font-semibold">
        <button type="button" onClick={() => setShowChanges((v) => !v)} className="w-full flex justify-between py-2.5 text-sky-300">
          <span>{tf('Price changes ({n})', { n: priceLog.length })}</span><span>{showChanges ? '⌄' : '›'}</span>
        </button>
        {showChanges && (
          <div className="py-1 font-normal">
            {priceLog.length === 0 ? <p className="py-1.5 text-[12.5px] text-slate-500">{t('No change logged yet.')}</p>
              : priceLog.slice(0, 8).map((l, i) => (
                <p key={i} className="py-1 text-[12.5px] text-slate-300">
                  <span className="text-slate-500">{fmtDay(l.changed_at)}</span>{' '}
                  {tierName(l.tier_id)} {l.old_price_idr != null ? fmtInt(l.old_price_idr) : '—'} → <b>{l.new_price_idr != null ? fmtInt(l.new_price_idr) : '—'}</b>
                  <span className="text-slate-500"> · {(l.changed_by_email ?? '').split('@')[0]}</span>
                </p>
              ))}
          </div>
        )}
        {canSeeCompetitors && (
          <Link href="/purchasing?tab=market-intel" className="flex justify-between py-2.5 text-sky-300"><span>{t('Competitor prices')}</span><span>›</span></Link>
        )}
        {canOpenItem && (
          <Link href={`/items/${cid}`} className="flex justify-between py-2.5 text-sky-300"><span>{t('Full item page')}</span><span>›</span></Link>
        )}
      </div>
    </div>
  );
}
