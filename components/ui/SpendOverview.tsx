'use client';
import React, { useState, useMemo } from 'react';
import { PRINCIPAL_CATS } from '../../constants/costCategories';
import type { Component, Supplier, PriceQuote, PurchaseOrder, PurchaseLineItem, POCost, PriceQuoteLineItem } from '../../types/database';

const PALETTE = [
  '#818cf8', '#34d399', '#fbbf24', '#60a5fa', '#fb7185',
  '#a78bfa', '#f97316', '#22d3ee', '#a3e635', '#e879f9',
];

type Period = 'all' | '12m' | '6m' | '3m';

const fmtIDR = (n: number): string => {
  if (n >= 1e9) return `Rp ${(n / 1e9).toFixed(1)}B`;
  if (n >= 1e6) return `Rp ${(n / 1e6).toFixed(1)}M`;
  if (n >= 1e3) return `Rp ${(n / 1e3).toFixed(0)}K`;
  return `Rp ${Math.round(n).toLocaleString()}`;
};
const fmtFull = (n: number): string => 'Rp ' + Math.round(n).toLocaleString('en-US');
const share = (a: number, b: number): string => (b ? ((a / b) * 100).toFixed(1) + '%' : '—');

// ── Donut chart (pure SVG, no library) ───────────────────────────────────────
interface DonutSlice { label: string; value: number; color: string; }

function DonutChart({ slices }: { slices: DonutSlice[] }) {
  const [hovered, setHovered] = useState<number | null>(null);
  const total = slices.reduce((s, x) => s + x.value, 0);

  if (total === 0) {
    return <div className="flex items-center justify-center h-full text-slate-700 text-xs italic">No data</div>;
  }

  const R = 1, r = 0.60, GAP = 0.03;
  let angle = -Math.PI / 2;

  const paths = slices.map((slice, i) => {
    const sweep = (slice.value / total) * 2 * Math.PI;
    if (sweep < 0.01) { angle += sweep; return null; }
    const a1 = angle + GAP / 2;
    const a2 = angle + sweep - GAP / 2;
    angle += sweep;
    const la = (a2 - a1) > Math.PI ? 1 : 0;
    const d = [
      `M ${(Math.cos(a1) * R).toFixed(5)} ${(Math.sin(a1) * R).toFixed(5)}`,
      `A ${R} ${R} 0 ${la} 1 ${(Math.cos(a2) * R).toFixed(5)} ${(Math.sin(a2) * R).toFixed(5)}`,
      `L ${(Math.cos(a2) * r).toFixed(5)} ${(Math.sin(a2) * r).toFixed(5)}`,
      `A ${r} ${r} 0 ${la} 0 ${(Math.cos(a1) * r).toFixed(5)} ${(Math.sin(a1) * r).toFixed(5)}`,
      'Z',
    ].join(' ');
    return (
      <path
        key={i} d={d} fill={slice.color}
        style={{ opacity: hovered === null || hovered === i ? 0.88 : 0.25, cursor: 'default', transition: 'opacity 0.12s' }}
        onMouseEnter={() => setHovered(i)}
        onMouseLeave={() => setHovered(null)}
      />
    );
  });

  const hs = hovered !== null ? slices[hovered] : null;

  return (
    <svg viewBox="-1.3 -1.3 2.6 2.6" style={{ width: '100%', height: '100%' }}>
      {paths}
      {hs ? (
        <>
          <text x="0" y="-0.12" textAnchor="middle" fill="white" fontSize="0.2" fontWeight="bold">
            {hs.label.length > 13 ? hs.label.slice(0, 12) + '…' : hs.label}
          </text>
          <text x="0" y="0.17" textAnchor="middle" fill="#94a3b8" fontSize="0.19">
            {((hs.value / total) * 100).toFixed(1)}%
          </text>
        </>
      ) : (
        <text x="0" y="0.06" textAnchor="middle" fill="#374151" fontSize="0.17">hover a slice</text>
      )}
    </svg>
  );
}

// ── Mini bar ──────────────────────────────────────────────────────────────────
function Bar({ pct, color }: { pct: number; color: string }) {
  return (
    <div className="h-1 bg-slate-800 rounded-full overflow-hidden">
      <div className="h-full rounded-full transition-all duration-300" style={{ width: `${Math.max(1, pct)}%`, background: color, opacity: 0.7 }} />
    </div>
  );
}

// ── Main component ────────────────────────────────────────────────────────────
interface Props {
  components: Component[];
  suppliers: Supplier[];
  quotes: PriceQuote[];
  pos: PurchaseOrder[];
  poItems: PurchaseLineItem[];
  poCosts: POCost[];
  quoteItems: PriceQuoteLineItem[];
  isLoading: boolean;
}

export default function SpendOverview({ components, suppliers, quotes, pos, poItems, poCosts, quoteItems, isLoading }: Props) {
  const [period, setPeriod] = useState<Period>('all');

  const toIDR = (amount: number, currency: string, xr?: number | null) =>
    currency === 'IDR' ? amount : amount * (xr ?? 1);

  const stats = useMemo(() => {
    const cutoff = period === 'all' ? null : (() => {
      const d = new Date();
      d.setMonth(d.getMonth() - ({ '12m': 12, '6m': 6, '3m': 3 } as Record<string, number>)[period]);
      return d.toISOString().split('T')[0];
    })();

    const filteredPos = (cutoff ? pos.filter((p) => (p.po_date ?? '') >= cutoff) : pos)
      .filter((p) => p.status !== 'Cancelled');
    const poIds = new Set(filteredPos.map((p) => p.po_id));
    const filteredPoItems = poItems.filter((i) => poIds.has(i.po_id));
    const filteredPoCosts = poCosts.filter((c) => poIds.has(c.po_id));

    const poById = new Map(filteredPos.map((p) => [p.po_id, p]));
    const compById = new Map(components.map((c) => [c.component_id, c]));
    const suppById = new Map(suppliers.map((s) => [s.supplier_id, s]));

    // ── Vendor ranking ─────────────────────────────────────────────────────
    type VendorRow = { id: string; name: string; committed: number; paid: number; quoteCount: number; poCount: number };
    const vendorMap = new Map<string, VendorRow>();

    filteredPos.forEach((p) => {
      if (!p.supplier_id) return;
      const idr = toIDR(p.total_value ?? 0, p.currency, p.exchange_rate);
      if (!vendorMap.has(p.supplier_id)) {
        vendorMap.set(p.supplier_id, { id: p.supplier_id, name: suppById.get(p.supplier_id)?.supplier_name ?? '(unknown)', committed: 0, paid: 0, quoteCount: 0, poCount: 0 });
      }
      const v = vendorMap.get(p.supplier_id)!;
      v.committed += idr;
      v.poCount++;
    });

    filteredPoCosts.filter((c) => PRINCIPAL_CATS.has(c.cost_category)).forEach((c) => {
      const po = poById.get(c.po_id);
      if (!po?.supplier_id) return;
      const v = vendorMap.get(po.supplier_id);
      if (!v) return;
      v.paid += toIDR(c.amount, c.currency, c.exchange_rate ?? po.exchange_rate);
    });

    const quoteCutoff = cutoff;
    (quoteCutoff ? quotes.filter((q) => (q.quote_date ?? '') >= quoteCutoff) : quotes).forEach((q) => {
      if (!q.supplier_id) return;
      if (!vendorMap.has(q.supplier_id)) {
        vendorMap.set(q.supplier_id, { id: q.supplier_id, name: suppById.get(q.supplier_id)?.supplier_name ?? '(unknown)', committed: 0, paid: 0, quoteCount: 0, poCount: 0 });
      }
      vendorMap.get(q.supplier_id)!.quoteCount++;
    });

    const vendors = [...vendorMap.values()]
      .filter((v) => v.committed > 0 || v.quoteCount > 0)
      .sort((a, b) => b.committed - a.committed);

    // ── Category breakdown ─────────────────────────────────────────────────
    type CatRow = { name: string; committed: number; qty: number; poIds: Set<number> };
    const catMap = new Map<string, CatRow>();

    filteredPoItems.forEach((item) => {
      const po = poById.get(item.po_id);
      if (!po) return;
      const comp = compById.get(item.component_id);
      const cat = comp?.category ?? 'Uncategorized';
      const idr = toIDR((item.quantity ?? 0) * (item.unit_cost ?? 0), item.currency ?? po.currency, po.exchange_rate);
      if (!catMap.has(cat)) catMap.set(cat, { name: cat, committed: 0, qty: 0, poIds: new Set() });
      const c = catMap.get(cat)!;
      c.committed += idr;
      c.qty += item.quantity ?? 0;
      c.poIds.add(item.po_id);
    });

    const categories = [...catMap.values()]
      .map((c) => ({ ...c, poCount: c.poIds.size }))
      .sort((a, b) => b.committed - a.committed);

    // ── Top components ─────────────────────────────────────────────────────
    type CompRow = { id: string; model: string; description: string; category: string; brand: string; committed: number; qty: number; poCount: number; quoteCount: number; poIds: Set<number> };
    const compMap = new Map<string, CompRow>();

    filteredPoItems.forEach((item) => {
      const po = poById.get(item.po_id);
      if (!po) return;
      const comp = compById.get(item.component_id);
      if (!comp) return;
      const idr = toIDR((item.quantity ?? 0) * (item.unit_cost ?? 0), item.currency ?? po.currency, po.exchange_rate);
      if (!compMap.has(comp.component_id)) {
        compMap.set(comp.component_id, {
          id: comp.component_id,
          model: comp.supplier_model,
          description: comp.internal_description,
          category: comp.category ?? '—',
          brand: comp.brand ?? '—',
          committed: 0, qty: 0, poCount: 0, quoteCount: 0,
          poIds: new Set(),
        });
      }
      const c = compMap.get(comp.component_id)!;
      c.committed += idr;
      c.qty += item.quantity ?? 0;
      c.poIds.add(item.po_id);
    });

    quoteItems.forEach((qi) => {
      const c = compMap.get(qi.component_id);
      if (c) c.quoteCount++;
    });

    const topComponents = [...compMap.values()]
      .map((c) => ({ ...c, poCount: c.poIds.size }))
      .sort((a, b) => b.committed - a.committed)
      .slice(0, 20);

    // ── KPIs ───────────────────────────────────────────────────────────────
    const totalCommitted = vendors.reduce((s, v) => s + v.committed, 0);
    const totalPaid = vendors.reduce((s, v) => s + v.paid, 0);
    const openPOs = filteredPos.filter((p) => !['Fully Received', 'Completed'].includes(p.status ?? '')).length;
    const activeVendorCount = vendors.filter((v) => v.committed > 0).length;

    return { vendors, categories, topComponents, totalCommitted, totalPaid, openPOs, activeVendorCount };
  }, [pos, poItems, poCosts, quotes, quoteItems, components, suppliers, period]);

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-64 text-slate-600 text-sm animate-pulse">Loading spend data…</div>
    );
  }

  const { vendors, categories, topComponents, totalCommitted, totalPaid, openPOs, activeVendorCount } = stats;
  const topVendors = vendors.slice(0, 10);
  const topCats = categories.slice(0, 10);

  const vendorSlices: DonutSlice[] = topVendors.map((v, i) => ({ label: v.name, value: v.committed, color: PALETTE[i % PALETTE.length] }));
  const catSlices: DonutSlice[] = topCats.map((c, i) => ({ label: c.name, value: c.committed, color: PALETTE[i % PALETTE.length] }));

  const maxVendor = topVendors[0]?.committed ?? 1;
  const maxCat = topCats[0]?.committed ?? 1;
  const maxComp = topComponents[0]?.committed ?? 1;
  const vendorTotal = vendors.reduce((s, v) => s + v.committed, 0);
  const catTotal = categories.reduce((s, c) => s + c.committed, 0);

  return (
    <div className="space-y-8">

      {/* Header + period filter */}
      <div className="flex items-start justify-between flex-wrap gap-3">
        <div>
          <h2 className="text-base md:text-lg font-semibold text-white tracking-tight">Spend Overview</h2>
          <p className="text-slate-500 text-[11px] mt-0.5">
            PO-committed values converted to IDR equivalent at recorded exchange rates. Cancelled POs excluded.
          </p>
        </div>
        <div className="flex gap-1 bg-slate-900 border border-slate-800 rounded-lg p-1 flex-shrink-0">
          {(['all', '12m', '6m', '3m'] as Period[]).map((p) => (
            <button
              key={p}
              onClick={() => setPeriod(p)}
              className={`px-3 py-1 text-xs font-medium rounded-md transition-all ${period === p ? 'bg-indigo-600 text-white' : 'text-slate-400 hover:text-slate-200'}`}
            >
              {p === 'all' ? 'All time' : p}
            </button>
          ))}
        </div>
      </div>

      {/* KPI strip */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        {[
          { label: 'Total Committed', value: fmtIDR(totalCommitted), sub: fmtFull(totalCommitted), accent: 'text-indigo-400' },
          { label: 'Total Paid', value: fmtIDR(totalPaid), sub: `${share(totalPaid, totalCommitted)} of committed`, accent: 'text-emerald-400' },
          { label: 'Active Vendors', value: String(activeVendorCount), sub: 'with non-cancelled POs', accent: 'text-blue-400' },
          { label: 'Open POs', value: String(openPOs), sub: 'pending receipt', accent: 'text-amber-400' },
        ].map((k) => (
          <div key={k.label} className="bg-slate-900/60 border border-slate-800 rounded-xl p-4">
            <p className="text-[10px] font-bold uppercase tracking-wider text-slate-500 mb-1.5">{k.label}</p>
            <p className={`text-2xl font-bold tabular-nums ${k.accent}`}>{k.value}</p>
            <p className="text-[11px] text-slate-600 mt-1 truncate">{k.sub}</p>
          </div>
        ))}
      </div>

      {/* Vendor + Category charts */}
      <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">

        {/* Vendor ranking */}
        <div className="bg-slate-900/60 border border-slate-800 rounded-xl overflow-hidden">
          <div className="px-5 py-4 border-b border-slate-800/60">
            <p className="text-[11px] font-bold uppercase tracking-wider text-slate-400">Vendor Ranking</p>
            <p className="text-[10px] text-slate-600 mt-0.5">By total PO value (IDR equivalent)</p>
          </div>
          <div className="p-5">
            <div className="flex gap-5 flex-col sm:flex-row">
              <div className="flex-shrink-0 mx-auto sm:mx-0" style={{ width: 160, height: 160 }}>
                <DonutChart slices={vendorSlices} />
              </div>
              <div className="flex-1 space-y-2.5 min-w-0">
                {topVendors.map((v, i) => (
                  <div key={v.id}>
                    <div className="flex items-center justify-between gap-2 mb-0.5">
                      <div className="flex items-center gap-1.5 min-w-0">
                        <span className="w-2 h-2 rounded-full flex-shrink-0" style={{ background: PALETTE[i % PALETTE.length] }} />
                        <span className="text-[11px] text-slate-200 truncate">{v.name}</span>
                      </div>
                      <span className="text-[11px] font-bold text-slate-100 tabular-nums flex-shrink-0">{fmtIDR(v.committed)}</span>
                    </div>
                    <Bar pct={(v.committed / maxVendor) * 100} color={PALETTE[i % PALETTE.length]} />
                    <div className="flex gap-2 mt-0.5 text-[10px] text-slate-600">
                      <span>{v.poCount} PO{v.poCount !== 1 ? 's' : ''}</span>
                      <span>·</span>
                      <span>{v.quoteCount} quote{v.quoteCount !== 1 ? 's' : ''}</span>
                      <span>·</span>
                      <span>{share(v.committed, vendorTotal)}</span>
                      {v.paid > 0 && <><span>·</span><span className="text-emerald-700">{fmtIDR(v.paid)} paid</span></>}
                    </div>
                  </div>
                ))}
                {topVendors.length === 0 && <p className="text-xs text-slate-700 italic">No vendor data for this period.</p>}
              </div>
            </div>
          </div>
        </div>

        {/* Category breakdown */}
        <div className="bg-slate-900/60 border border-slate-800 rounded-xl overflow-hidden">
          <div className="px-5 py-4 border-b border-slate-800/60">
            <p className="text-[11px] font-bold uppercase tracking-wider text-slate-400">Product Category Breakdown</p>
            <p className="text-[10px] text-slate-600 mt-0.5">By PO line item value (quantity × unit cost × exchange rate)</p>
          </div>
          <div className="p-5">
            <div className="flex gap-5 flex-col sm:flex-row">
              <div className="flex-shrink-0 mx-auto sm:mx-0" style={{ width: 160, height: 160 }}>
                <DonutChart slices={catSlices} />
              </div>
              <div className="flex-1 space-y-2.5 min-w-0">
                {topCats.map((c, i) => (
                  <div key={c.name}>
                    <div className="flex items-center justify-between gap-2 mb-0.5">
                      <div className="flex items-center gap-1.5 min-w-0">
                        <span className="w-2 h-2 rounded-full flex-shrink-0" style={{ background: PALETTE[i % PALETTE.length] }} />
                        <span className="text-[11px] text-slate-200 truncate">{c.name}</span>
                      </div>
                      <span className="text-[11px] font-bold text-slate-100 tabular-nums flex-shrink-0">{fmtIDR(c.committed)}</span>
                    </div>
                    <Bar pct={(c.committed / maxCat) * 100} color={PALETTE[i % PALETTE.length]} />
                    <div className="flex gap-2 mt-0.5 text-[10px] text-slate-600">
                      <span>{c.poCount} PO{c.poCount !== 1 ? 's' : ''}</span>
                      <span>·</span>
                      <span>{c.qty.toLocaleString()} units</span>
                      <span>·</span>
                      <span>{share(c.committed, catTotal)}</span>
                    </div>
                  </div>
                ))}
                {topCats.length === 0 && <p className="text-xs text-slate-700 italic">No line item data for this period.</p>}
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Top items table */}
      <div className="bg-slate-900/60 border border-slate-800 rounded-xl overflow-hidden">
        <div className="px-5 py-4 border-b border-slate-800/60">
          <p className="text-[11px] font-bold uppercase tracking-wider text-slate-400">Top Items by Spend</p>
          <p className="text-[10px] text-slate-600 mt-0.5">
            Ranked by total PO line spend (IDR eq.). Top 20 shown.
          </p>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b border-slate-800 bg-slate-900/40">
                {['#', 'Item', 'Category', 'Brand', 'Total Spend', 'POs', 'Quotes', 'Units', 'Share'].map((h, i) => (
                  <th key={h} className={`px-3 py-2.5 text-[10px] font-bold uppercase tracking-wider text-slate-500 ${i === 0 ? 'w-8 pl-4' : ''} ${i >= 2 ? (i >= 4 ? 'text-right' : 'hidden md:table-cell') : ''} ${i >= 6 ? 'hidden sm:table-cell' : ''} ${i === 8 ? 'hidden lg:table-cell' : ''} ${i < 2 ? 'text-left' : ''}`}>
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {topComponents.map((comp, i) => (
                <tr key={comp.id} className="border-b border-slate-800/40 hover:bg-slate-800/25 transition-colors group">
                  <td className="pl-4 pr-2 py-3 text-slate-600 font-mono text-[11px] tabular-nums">{i + 1}</td>
                  <td className="px-3 py-3 min-w-[200px]">
                    <p className="font-mono text-[11px] text-slate-200 leading-tight truncate max-w-[220px]">{comp.model}</p>
                    <p className="text-[10px] text-slate-500 truncate max-w-[220px] mt-0.5">{comp.description}</p>
                    <div className="mt-1.5 h-0.5 bg-slate-800 rounded-full overflow-hidden max-w-[180px]">
                      <div className="h-full rounded-full bg-indigo-500/50 transition-all duration-300"
                        style={{ width: `${(comp.committed / maxComp) * 100}%` }} />
                    </div>
                  </td>
                  <td className="px-3 py-3 hidden md:table-cell">
                    <span className="text-[11px] text-slate-400">{comp.category}</span>
                  </td>
                  <td className="px-3 py-3 hidden md:table-cell">
                    <span className="text-[11px] text-slate-500">{comp.brand}</span>
                  </td>
                  <td className="px-3 py-3 text-right">
                    <p className="text-sm font-bold text-white tabular-nums">{fmtIDR(comp.committed)}</p>
                    <p className="text-[10px] text-slate-600 tabular-nums">{fmtFull(comp.committed)}</p>
                  </td>
                  <td className="px-3 py-3 text-right hidden sm:table-cell">
                    <span className="text-slate-300 tabular-nums">{comp.poCount}</span>
                  </td>
                  <td className="px-3 py-3 text-right hidden sm:table-cell">
                    <span className="text-slate-400 tabular-nums">{comp.quoteCount}</span>
                  </td>
                  <td className="px-3 py-3 text-right hidden md:table-cell">
                    <span className="text-slate-400 tabular-nums">{comp.qty.toLocaleString()}</span>
                  </td>
                  <td className="px-3 py-3 text-right hidden lg:table-cell">
                    <span className="text-slate-500 tabular-nums">{share(comp.committed, totalCommitted)}</span>
                  </td>
                </tr>
              ))}
              {topComponents.length === 0 && (
                <tr>
                  <td colSpan={9} className="px-4 py-16 text-center text-slate-700 text-sm italic">
                    No purchase line item data for this period.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
