/**
 * ICAPROC — Sell-side: Products
 * The sell-side view of the catalog: every item with its description, brand,
 * category, unit, capacity, sell price (linked to Pricing), and stock truth —
 * Physical, Live (= Physical − Reserved on confirmed orders), and Incoming
 * (qty on POs ordered but not yet Fully Received).
 * Row expand shows the per-tier price list for the item.
 * Gated to roles that can see selling prices (owner + sales).
 */
'use client';
import { useState, useEffect, useMemo, useCallback, Fragment } from 'react';
import { createSupabaseClient } from '@/lib/supabase';
import { useAuth } from '@/hooks/useAuth';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { ROLE_PERMISSIONS } from '@/constants/roles';
import BrandMenu from '@/components/ui/BrandMenu';
import { COMMITTED_STATUSES as COMMITTED } from '@/lib/salesStatus';

interface Comp {
  component_id: string; supplier_model: string; internal_description: string | null;
  brand: string | null; category: string | null; unit: string | null;
  norm_value: number | null; selling_price_idr: number | null;
}
interface Tier { tier_id: string; tier_code: string; name: string; default_discount_pct: number; sort_order: number; is_active: boolean; }
interface Override { component_id: string; tier_id: string; override_price_idr: number | null; override_discount_pct: number | null; }

// PO statuses that mean "ordered, on the way, not yet arrived".
const INCOMING_PO_STATUSES = new Set(['Sent', 'Confirmed', 'Partially Received']);

const fmtInt = (n: number) => Math.round(n).toLocaleString('en-US');
const humanize = (s: string) => s.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());

export default function ProductsPage() {
  const supabase = createSupabaseClient();
  const router = useRouter();
  const { user, profile, loading: authLoading } = useAuth();
  const canView = !!profile && ROLE_PERMISSIONS[profile.role].canViewSellingPrice;

  const [comps, setComps] = useState<Comp[]>([]);
  const [tiers, setTiers] = useState<Tier[]>([]);
  const [overrides, setOverrides] = useState<Override[]>([]);
  const [physical, setPhysical] = useState<Record<string, number>>({});
  const [reserved, setReserved] = useState<Record<string, number>>({});
  const [incoming, setIncoming] = useState<Record<string, number>>({});
  const [loading, setLoading] = useState(true);

  const [search, setSearch] = useState('');
  const [filterCategory, setFilterCategory] = useState('');
  const [filterBrand, setFilterBrand] = useState('');
  const [stockOnly, setStockOnly] = useState(false);
  const [expanded, setExpanded] = useState<string | null>(null);

  useEffect(() => { document.title = 'Products — ICAPROC'; }, []);
  useEffect(() => {
    if (authLoading) return;
    if (!user) { router.replace(`/login?next=${encodeURIComponent('/products')}`); return; }
    if (profile && !ROLE_PERMISSIONS[profile.role].canViewSellingPrice) router.replace('/unauthorized');
  }, [authLoading, user, profile, router]);

  const fetchAll = useCallback(async () => {
    setLoading(true);
    const fetchAllComponents = async () => {
      const PAGE = 1000;
      let all: Comp[] = [];
      let from = 0;
      for (;;) {
        const { data: page } = await supabase.from('3.0_components')
          .select('component_id, supplier_model, internal_description, brand, category, unit, norm_value, selling_price_idr')
          .order('supplier_model').range(from, from + PAGE - 1);
        if (!page || page.length === 0) break;
        all = all.concat(page as Comp[]);
        if (page.length < PAGE) break;
        from += PAGE;
      }
      return all;
    };
    const [allComps, tierRes, ovRes, balRes, sqRes, sqiRes, poRes, poiRes] = await Promise.all([
      fetchAllComponents(),
      supabase.from('21.0_price_tiers').select('tier_id, tier_code, name, default_discount_pct, sort_order, is_active').order('sort_order'),
      supabase.from('21.1_item_tier_prices').select('component_id, tier_id, override_price_idr, override_discount_pct'),
      supabase.from('30.1_stock_balances').select('component_id, qty_on_hand'),
      supabase.from('22.0_sales_quotes').select('quote_id, status'),
      supabase.from('22.1_sales_quote_items').select('quote_id, component_id, quantity, is_section'),
      supabase.from('5.0_purchases').select('po_id, status'),
      supabase.from('5.1_purchase_line_items').select('po_id, component_id, quantity'),
    ]);
    setComps(allComps);
    setTiers((tierRes.data as Tier[]) ?? []);
    setOverrides((ovRes.data as Override[]) ?? []);

    const phys: Record<string, number> = {};
    for (const b of (balRes.data as { component_id: string; qty_on_hand: number }[]) ?? []) phys[b.component_id] = Number(b.qty_on_hand) || 0;
    setPhysical(phys);

    const committed = new Set(((sqRes.data as { quote_id: string; status: string }[]) ?? []).filter((q) => COMMITTED.has(q.status)).map((q) => q.quote_id));
    const rsv: Record<string, number> = {};
    for (const it of (sqiRes.data as { quote_id: string; component_id: string | null; quantity: number; is_section: boolean }[]) ?? []) {
      if (it.component_id && !it.is_section && committed.has(it.quote_id)) rsv[it.component_id] = (rsv[it.component_id] ?? 0) + (Number(it.quantity) || 0);
    }
    setReserved(rsv);

    const incomingPos = new Set(((poRes.data as { po_id: number; status: string }[]) ?? []).filter((p) => INCOMING_PO_STATUSES.has(p.status ?? '')).map((p) => String(p.po_id)));
    const inc: Record<string, number> = {};
    for (const li of (poiRes.data as { po_id: number; component_id: string | null; quantity: number }[]) ?? []) {
      if (li.component_id && incomingPos.has(String(li.po_id))) inc[li.component_id] = (inc[li.component_id] ?? 0) + (Number(li.quantity) || 0);
    }
    setIncoming(inc);
    setLoading(false);
  }, []);

  useEffect(() => { if (canView) fetchAll(); }, [canView, fetchAll]);

  const activeTiers = useMemo(() => tiers.filter((t) => t.is_active), [tiers]);
  const ovByKey = useMemo(() => { const m = new Map<string, Override>(); for (const o of overrides) m.set(`${o.component_id}:${o.tier_id}`, o); return m; }, [overrides]);

  const tierPrice = (c: Comp, t: Tier): number | null => {
    const ov = ovByKey.get(`${c.component_id}:${t.tier_id}`);
    if (ov?.override_price_idr != null) return ov.override_price_idr;
    const list = c.selling_price_idr;
    if (list == null || list <= 0) return null;
    const disc = ov?.override_discount_pct ?? t.default_discount_pct ?? 0;
    return list * (1 - disc / 100);
  };

  const categories = useMemo(() => [...new Set(comps.map((c) => c.category).filter(Boolean))].sort() as string[], [comps]);
  const brands = useMemo(() => [...new Set(comps.map((c) => c.brand).filter(Boolean))].sort() as string[], [comps]);

  const rows = useMemo(() => {
    const q = search.trim().toLowerCase();
    return comps
      .map((c) => {
        const phys = physical[c.component_id] ?? 0;
        const rsv = reserved[c.component_id] ?? 0;
        return { c, phys, rsv, live: phys - rsv, inc: incoming[c.component_id] ?? 0 };
      })
      .filter(({ c, phys, inc }) => {
        if (filterCategory && c.category !== filterCategory) return false;
        if (filterBrand && c.brand !== filterBrand) return false;
        if (stockOnly && phys <= 0 && inc <= 0) return false;
        if (!q) return true;
        return [c.supplier_model, c.internal_description, c.brand, c.category].filter(Boolean).join(' ').toLowerCase().includes(q);
      });
  }, [comps, physical, reserved, incoming, search, filterCategory, filterBrand, stockOnly]);

  const hasFilters = !!(search.trim() || filterCategory || filterBrand || stockOnly);

  if (authLoading || !profile) return <CenterSpinner />;
  if (!canView) return <CenterSpinner />;

  return (
    <div className="min-h-screen bg-[#0f1012] text-slate-200 font-sans text-sm">
      <div className="border-b border-slate-800/60 bg-[#0f1012]/80 backdrop-blur-md sticky top-0 z-30">
        <div className="max-w-[1500px] mx-auto px-4 md:px-8 py-4 flex items-center justify-between gap-4">
          <BrandMenu wordmarkClass="text-xl md:text-2xl font-extrabold" subtitle="Products · Sell-side catalog" />
          <Link href="/pricing" className="text-xs text-slate-400 hover:text-white px-3 py-1.5 border border-slate-700 rounded-lg hover:bg-slate-800 transition-colors whitespace-nowrap">
            Manage Pricing →
          </Link>
        </div>
      </div>

      <main className="max-w-[1500px] mx-auto px-4 md:px-8 py-6 space-y-4">
        {/* Search + filters (ComponentEditor-style) */}
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative flex-1 min-w-[220px]">
            <svg className="w-4 h-4 text-slate-500 absolute left-3.5 top-1/2 -translate-y-1/2" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M21 21l-4.35-4.35M17 11a6 6 0 11-12 0 6 6 0 0112 0z" /></svg>
            <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search model, description, brand, category…"
              className="w-full pl-10 pr-4 h-11 rounded-xl bg-slate-900/80 border border-slate-700/80 focus:border-emerald-500/60 outline-none text-white text-base sm:text-sm placeholder:text-slate-500 transition-colors" />
          </div>
          <select value={filterCategory} onChange={(e) => setFilterCategory(e.target.value)} className={selCls}>
            <option value="">All categories</option>
            {categories.map((c) => <option key={c} value={c}>{humanize(c)}</option>)}
          </select>
          <select value={filterBrand} onChange={(e) => setFilterBrand(e.target.value)} className={selCls}>
            <option value="">All brands</option>
            {brands.map((b) => <option key={b} value={b}>{b}</option>)}
          </select>
          <label className="flex items-center gap-2 text-xs text-slate-400 cursor-pointer select-none whitespace-nowrap">
            <input type="checkbox" checked={stockOnly} onChange={(e) => setStockOnly(e.target.checked)} className="accent-emerald-500 w-4 h-4" />
            In stock / incoming
          </label>
          {hasFilters && (
            <button onClick={() => { setSearch(''); setFilterCategory(''); setFilterBrand(''); setStockOnly(false); }}
              className="text-[11px] text-slate-500 hover:text-white px-2 py-1 transition-colors">Clear ×</button>
          )}
          <span className="text-xs text-slate-600 tabular-nums ml-auto">{rows.length} of {comps.length}</span>
        </div>

        <p className="text-[11px] text-slate-600">
          <span className="text-slate-400">Physical</span> = in warehouse · <span className="text-slate-400">Live</span> = Physical − reserved on confirmed orders ·{' '}
          <span className="text-slate-400">Incoming</span> = on POs not yet fully received. Click a row for its tier price list.
        </p>

        <div className="bg-slate-900/40 border border-slate-800/80 rounded-2xl overflow-x-auto">
          <table className="w-full min-w-[900px]">
            <thead>
              <tr className="border-b border-slate-800 text-[10px] uppercase tracking-widest text-slate-500">
                <th className="text-left font-semibold px-4 py-2.5">Description</th>
                <th className="text-left font-semibold px-3 py-2.5">Brand</th>
                <th className="text-left font-semibold px-3 py-2.5">Category</th>
                <th className="text-left font-semibold px-3 py-2.5">Unit</th>
                <th className="text-right font-semibold px-3 py-2.5">Capacity</th>
                <th className="text-right font-semibold px-3 py-2.5">Sell Price</th>
                <th className="text-right font-semibold px-3 py-2.5">Physical</th>
                <th className="text-right font-semibold px-3 py-2.5">Live</th>
                <th className="text-right font-semibold px-3 py-2.5">Incoming</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800/60">
              {loading ? (
                [...Array(8)].map((_, i) => <tr key={i}><td colSpan={9} className="px-4 py-2"><div className="h-9 bg-slate-800/40 rounded-lg animate-pulse" /></td></tr>)
              ) : rows.length === 0 ? (
                <tr><td colSpan={9} className="px-4 py-12 text-center text-slate-600 text-sm">No products match.</td></tr>
              ) : rows.map(({ c, phys, rsv, live, inc }) => (
                <Fragment key={c.component_id}>
                  <tr onClick={() => setExpanded((e) => (e === c.component_id ? null : c.component_id))}
                    className={`cursor-pointer transition-colors ${expanded === c.component_id ? 'bg-slate-800/40' : 'hover:bg-slate-800/20'}`}>
                    <td className="px-4 py-2">
                      <span className="block text-sm text-slate-100 font-medium truncate max-w-[280px]">{c.supplier_model || '(no model)'}</span>
                      {c.internal_description && <span className="block text-[11px] text-slate-500 truncate max-w-[280px]">{c.internal_description}</span>}
                    </td>
                    <td className="px-3 py-2 text-xs text-slate-400 whitespace-nowrap">{c.brand || '—'}</td>
                    <td className="px-3 py-2 text-xs text-slate-500 whitespace-nowrap">{c.category ? humanize(c.category) : '—'}</td>
                    <td className="px-3 py-2 text-xs text-slate-500">{c.unit || '—'}</td>
                    <td className="px-3 py-2 text-right tabular-nums text-xs text-slate-400">{c.norm_value != null && c.norm_value !== 0 ? Number(c.norm_value).toLocaleString('en-US') : '—'}</td>
                    <td className="px-3 py-2 text-right tabular-nums text-sm text-slate-200">{c.selling_price_idr ? fmtInt(c.selling_price_idr) : <span className="text-slate-700">—</span>}</td>
                    <td className="px-3 py-2 text-right tabular-nums text-slate-300">{phys ? fmtInt(phys) : <span className="text-slate-700">0</span>}</td>
                    <td className={`px-3 py-2 text-right tabular-nums font-semibold ${live < 0 ? 'text-red-400' : live === 0 ? 'text-slate-600' : 'text-emerald-300'}`}>{fmtInt(live)}</td>
                    <td className="px-3 py-2 text-right tabular-nums text-sky-300/80">{inc ? fmtInt(inc) : <span className="text-slate-700">0</span>}</td>
                  </tr>
                  {expanded === c.component_id && (
                    <tr>
                      <td colSpan={9} className="px-4 pb-3 pt-1 bg-slate-950/40">
                        <div className="flex flex-wrap gap-2 items-center">
                          <span className="text-[10px] font-semibold uppercase tracking-widest text-slate-600 mr-1">Price list</span>
                          {c.selling_price_idr ? (
                            <span className="px-2.5 py-1 rounded-lg bg-slate-800/80 border border-slate-700 text-[11px]">
                              <span className="text-slate-500">List</span> <span className="tabular-nums text-slate-200 font-semibold">{fmtInt(c.selling_price_idr)}</span>
                            </span>
                          ) : (
                            <span className="text-[11px] text-slate-600 italic">No list price set — <Link href="/pricing" className="text-emerald-400 hover:text-emerald-300" onClick={(e) => e.stopPropagation()}>set it in Pricing</Link></span>
                          )}
                          {activeTiers.map((t) => {
                            const p = tierPrice(c, t);
                            const ov = ovByKey.get(`${c.component_id}:${t.tier_id}`);
                            return (
                              <span key={t.tier_id} className={`px-2.5 py-1 rounded-lg border text-[11px] ${ov?.override_price_idr != null ? 'bg-emerald-500/10 border-emerald-500/30' : 'bg-slate-800/60 border-slate-700'}`}>
                                <span className="text-slate-500">{t.name}</span>{' '}
                                <span className="tabular-nums text-slate-200 font-semibold">{p != null ? fmtInt(p) : '—'}</span>
                              </span>
                            );
                          })}
                          {rsv > 0 && <span className="text-[11px] text-amber-300/80 ml-auto tabular-nums">Reserved on orders: {fmtInt(rsv)}</span>}
                        </div>
                      </td>
                    </tr>
                  )}
                </Fragment>
              ))}
            </tbody>
          </table>
        </div>
      </main>
    </div>
  );
}

const selCls = 'h-11 px-3 rounded-xl bg-slate-900/80 border border-slate-700/80 focus:border-emerald-500/60 outline-none text-slate-300 text-xs transition-colors cursor-pointer';

function CenterSpinner() {
  return <div className="min-h-screen bg-[#0f1012] flex items-center justify-center"><div className="w-6 h-6 border-2 border-emerald-500/30 border-t-emerald-500 rounded-full animate-spin" /></div>;
}
