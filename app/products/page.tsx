/**
 * ICAPROC — Sell-side: Products
 * The sell-side catalog, built for selling: price + stock first.
 *  - Columns: Description · Sell Price (tiered) · Stock (Live/Physical + unit) ·
 *    Incoming · Brand · Category · Capacity · Warranty · Datasheet · Updated.
 *  - Default sort = trading activity (POs + supplier quotes + sales quotes);
 *    headers sort by price/stock/brand/category/capacity/updated asc/desc.
 *  - Row expand: full tier price list, warranty & datasheet (editable), last 10
 *    customer orders and last 10 deliveries for the item.
 *  - Mobile: card list highlighting available stock and tier prices.
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
import { downloadCsv, parseCsv, readFileText, csvNum } from '@/lib/csv';

interface Comp {
  component_id: string; supplier_model: string; internal_description: string | null;
  brand: string | null; category: string | null; unit: string | null;
  norm_value: number | null; selling_price_idr: number | null;
  datasheet_url: string | null; warranty: string | null; updated_at: string | null;
}
interface Tier { tier_id: string; tier_code: string; name: string; default_discount_pct: number; sort_order: number; is_active: boolean; }
interface Override { component_id: string; tier_id: string; override_price_idr: number | null; override_discount_pct: number | null; }
interface DocRef { number: string; customer: string; qty: number; date: string; quote_id: string; }

// PO statuses that mean "ordered, on the way, not yet arrived".
const INCOMING_PO_STATUSES = new Set(['Sent', 'Confirmed', 'Partially Received']);

const fmtInt = (n: number) => Math.round(n).toLocaleString('en-US');
const fmtRp = (n: number) => `Rp ${fmtInt(n)}`;
const fmtDate = (d?: string | null) => d ? new Date(d.length <= 10 ? `${d}T00:00:00` : d).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: '2-digit' }) : '';
import { formatCategory as humanize } from '@/lib/formatCategory';
// The product's customer-facing name: our internal description, never the supplier's model/SKU.
const descOf = (c: { internal_description: string | null; supplier_model: string }) =>
  (c.internal_description && c.internal_description.trim()) || c.supplier_model || '(no description)';

type SortKey = 'activity' | 'updated' | 'price' | 'stock' | 'brand' | 'category' | 'capacity';
const SORT_LABELS: Record<SortKey, string> = {
  activity: 'Most traded', updated: 'Last updated', price: 'Sell price',
  stock: 'Live stock', brand: 'Brand', category: 'Category', capacity: 'Capacity',
};
// Text columns default ascending; numeric/recency default descending.
const DEFAULT_DIR: Record<SortKey, 1 | -1> = {
  activity: -1, updated: -1, price: -1, stock: -1, brand: 1, category: 1, capacity: -1,
};

interface Row { c: Comp; phys: number; rsv: number; live: number; inc: number; activity: number; }

export default function ProductsPage() {
  const supabase = createSupabaseClient();
  const router = useRouter();
  const { user, profile, loading: authLoading } = useAuth();
  const canView = !!profile && ROLE_PERMISSIONS[profile.role].canViewSellingPrice;
  const canEditMeta = !!profile && ROLE_PERMISSIONS[profile.role].canEdit; // warranty / datasheet edits
  // Brand reveals the supplier relationship — buy-side sensitive. Not fetched at
  // all for sell-side roles, so it never reaches the client.
  const canViewBrand = !!profile && ROLE_PERMISSIONS[profile.role].canViewBrand;

  const [comps, setComps] = useState<Comp[]>([]);
  const [tiers, setTiers] = useState<Tier[]>([]);
  const [overrides, setOverrides] = useState<Override[]>([]);
  const [physical, setPhysical] = useState<Record<string, number>>({});
  const [reserved, setReserved] = useState<Record<string, number>>({});
  const [incoming, setIncoming] = useState<Record<string, number>>({});
  const [activityByComp, setActivityByComp] = useState<Record<string, number>>({});
  const [ordersByComp, setOrdersByComp] = useState<Record<string, DocRef[]>>({});
  const [deliveriesByComp, setDeliveriesByComp] = useState<Record<string, DocRef[]>>({});
  const [loading, setLoading] = useState(true);

  const [search, setSearch] = useState('');
  const [filterCategory, setFilterCategory] = useState('');
  const [filterBrand, setFilterBrand] = useState('');
  const [stockOnly, setStockOnly] = useState(false);
  const [sort, setSort] = useState<{ key: SortKey; dir: 1 | -1 }>({ key: 'activity', dir: -1 });
  const [expanded, setExpanded] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const flash = (m: string) => { setToast(m); setTimeout(() => setToast(null), 2200); };

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
        const cols = `component_id, supplier_model, internal_description, category, unit, norm_value, selling_price_idr, datasheet_url, warranty, updated_at${canViewBrand ? ', brand' : ''}`;
        const { data: page } = await supabase.from('3.0_components')
          .select(cols)
          .order('supplier_model').range(from, from + PAGE - 1);
        if (!page || page.length === 0) break;
        all = all.concat(page as unknown as Comp[]);
        if (page.length < PAGE) break;
        from += PAGE;
      }
      return all;
    };
    const [allComps, tierRes, ovRes, balRes, sqRes, sqiRes, poRes, poiRes, piiRes, custRes] = await Promise.all([
      fetchAllComponents(),
      supabase.from('21.0_price_tiers').select('tier_id, tier_code, name, default_discount_pct, sort_order, is_active').order('sort_order'),
      supabase.from('21.1_item_tier_prices').select('component_id, tier_id, override_price_idr, override_discount_pct'),
      supabase.from('30.1_stock_balances').select('component_id, qty_on_hand'),
      supabase.from('22.0_sales_quotes').select('quote_id, status, order_number, do_number, ordered_at, delivered_at, updated_at, customer_id'),
      supabase.from('22.1_sales_quote_items').select('quote_id, component_id, quantity, is_section'),
      supabase.from('5.0_purchases').select('po_id, status'),
      supabase.from('5.1_purchase_line_items').select('po_id, component_id, quantity'),
      supabase.from('4.1_price_quote_line_items').select('quote_id, component_id').limit(8000),
      supabase.from('20.0_customers').select('customer_id, display_name, legal_name'),
    ]);
    setComps(allComps);
    setTiers((tierRes.data as Tier[]) ?? []);
    setOverrides((ovRes.data as Override[]) ?? []);

    const phys: Record<string, number> = {};
    for (const b of (balRes.data as { component_id: string; qty_on_hand: number }[]) ?? []) phys[b.component_id] = Number(b.qty_on_hand) || 0;
    setPhysical(phys);

    const custName = new Map(((custRes.data as { customer_id: string; display_name: string; legal_name: string }[]) ?? [])
      .map((c) => [c.customer_id, c.display_name || c.legal_name || '']));
    const docs = (sqRes.data as { quote_id: string; status: string; order_number: string | null; do_number: string | null; ordered_at: string | null; delivered_at: string | null; updated_at: string | null; customer_id: string | null }[]) ?? [];
    const docById = new Map(docs.map((d) => [d.quote_id, d]));
    const committed = new Set(docs.filter((q) => COMMITTED.has(q.status)).map((q) => q.quote_id));

    const rsv: Record<string, number> = {};
    const orders: Record<string, DocRef[]> = {};
    const deliveries: Record<string, DocRef[]> = {};
    const sqSets: Record<string, Set<string>> = {};
    for (const it of (sqiRes.data as { quote_id: string; component_id: string | null; quantity: number; is_section: boolean }[]) ?? []) {
      if (!it.component_id || it.is_section) continue;
      const cid = it.component_id;
      const qty = Number(it.quantity) || 0;
      if (committed.has(it.quote_id)) rsv[cid] = (rsv[cid] ?? 0) + qty;
      (sqSets[cid] ??= new Set()).add(it.quote_id);
      const doc = docById.get(it.quote_id);
      if (!doc) continue;
      if (doc.order_number) {
        (orders[cid] ??= []).push({ number: doc.order_number, customer: custName.get(doc.customer_id ?? '') ?? '', qty, date: doc.ordered_at ?? doc.updated_at ?? '', quote_id: doc.quote_id });
      }
      if (doc.do_number) {
        (deliveries[cid] ??= []).push({ number: doc.do_number, customer: custName.get(doc.customer_id ?? '') ?? '', qty, date: doc.delivered_at ?? doc.updated_at ?? '', quote_id: doc.quote_id });
      }
    }
    const top10 = (m: Record<string, DocRef[]>) => {
      for (const k of Object.keys(m)) m[k] = m[k].sort((a, b) => (b.date || '').localeCompare(a.date || '')).slice(0, 10);
      return m;
    };
    setReserved(rsv);
    setOrdersByComp(top10(orders));
    setDeliveriesByComp(top10(deliveries));

    const poStatus = new Map(((poRes.data as { po_id: number; status: string }[]) ?? []).map((p) => [String(p.po_id), p.status ?? '']));
    const inc: Record<string, number> = {};
    const poSets: Record<string, Set<string>> = {};
    for (const li of (poiRes.data as { po_id: number; component_id: string | null; quantity: number }[]) ?? []) {
      if (!li.component_id) continue;
      const pid = String(li.po_id);
      (poSets[li.component_id] ??= new Set()).add(pid);
      if (INCOMING_PO_STATUSES.has(poStatus.get(pid) ?? '')) inc[li.component_id] = (inc[li.component_id] ?? 0) + (Number(li.quantity) || 0);
    }
    setIncoming(inc);

    const piSets: Record<string, Set<string>> = {};
    for (const li of (piiRes.data as { quote_id: number; component_id: string | null }[]) ?? []) {
      if (li.component_id) (piSets[li.component_id] ??= new Set()).add(String(li.quote_id));
    }
    // Activity = how actively the item trades: distinct POs + supplier quotes + sales quotes.
    const act: Record<string, number> = {};
    for (const c of allComps) {
      act[c.component_id] = (poSets[c.component_id]?.size ?? 0) + (piSets[c.component_id]?.size ?? 0) + (sqSets[c.component_id]?.size ?? 0);
    }
    setActivityByComp(act);
    setLoading(false);
  }, [canViewBrand]);

  useEffect(() => { if (canView) fetchAll(); }, [canView, fetchAll]);

  const activeTiers = useMemo(() => tiers.filter((t) => t.is_active), [tiers]);
  const ovByKey = useMemo(() => { const m = new Map<string, Override>(); for (const o of overrides) m.set(`${o.component_id}:${o.tier_id}`, o); return m; }, [overrides]);

  const tierPrice = useCallback((c: Comp, t: Tier): number | null => {
    const ov = ovByKey.get(`${c.component_id}:${t.tier_id}`);
    if (ov?.override_price_idr != null) return ov.override_price_idr;
    const list = c.selling_price_idr;
    if (list == null || list <= 0) return null;
    const disc = ov?.override_discount_pct ?? t.default_discount_pct ?? 0;
    return list * (1 - disc / 100);
  }, [ovByKey]);

  const categories = useMemo(() => [...new Set(comps.map((c) => c.category).filter(Boolean))].sort() as string[], [comps]);
  const brands = useMemo(() => canViewBrand ? [...new Set(comps.map((c) => c.brand).filter(Boolean))].sort() as string[] : [], [comps, canViewBrand]);
  // Sort keys available to this role — brand sort only when brands are visible.
  const sortKeys = useMemo(() => (Object.keys(SORT_LABELS) as SortKey[]).filter((k) => canViewBrand || k !== 'brand'), [canViewBrand]);

  // Click a price → copy a WhatsApp-ready quote in Bahasa Indonesia.
  // Indonesian number format uses "." as the thousands separator (Rp 1.395.000).
  const copyPrice = useCallback(async (c: Comp, price: number) => {
    const rp = Math.round(price).toLocaleString('id-ID');
    const tgl = new Date().toLocaleDateString('id-ID', { day: '2-digit', month: 'long', year: 'numeric' });
    const text = `${descOf(c)}\nHarga: Rp ${rp} (belum termasuk PPN)\nTanggal penawaran: ${tgl}`;
    try {
      await navigator.clipboard.writeText(text);
      flash('Harga disalin — siap ditempel');
    } catch {
      flash('Gagal menyalin — tekan lama untuk memilih');
    }
  }, []);

  const rows: Row[] = useMemo(() => {
    const q = search.trim().toLowerCase();
    const list = comps
      .map((c) => {
        const phys = physical[c.component_id] ?? 0;
        const rsv = reserved[c.component_id] ?? 0;
        return { c, phys, rsv, live: phys - rsv, inc: incoming[c.component_id] ?? 0, activity: activityByComp[c.component_id] ?? 0 };
      })
      .filter(({ c, phys, inc }) => {
        if (filterCategory && c.category !== filterCategory) return false;
        if (filterBrand && c.brand !== filterBrand) return false;
        if (stockOnly && phys <= 0 && inc <= 0) return false;
        if (!q) return true;
        return [c.supplier_model, c.internal_description, c.brand, c.category, c.warranty].filter(Boolean).join(' ').toLowerCase().includes(q);
      });

    const { key, dir } = sort;
    const cmpText = (a: string | null, b: string | null) => (a || '').localeCompare(b || '') || 0;
    list.sort((a, b) => {
      let d = 0;
      if (key === 'activity') d = a.activity - b.activity;
      else if (key === 'updated') d = (a.c.updated_at || '').localeCompare(b.c.updated_at || '');
      else if (key === 'price') d = (a.c.selling_price_idr ?? -1) - (b.c.selling_price_idr ?? -1);
      else if (key === 'stock') d = a.live - b.live;
      else if (key === 'capacity') d = (Number(a.c.norm_value) || 0) - (Number(b.c.norm_value) || 0);
      else if (key === 'brand') d = cmpText(a.c.brand, b.c.brand);
      else if (key === 'category') d = cmpText(a.c.category, b.c.category);
      d *= dir;
      // Stable tie-breaks: activity desc, then recency desc, then name.
      if (d !== 0) return d;
      return (b.activity - a.activity)
        || (b.c.updated_at || '').localeCompare(a.c.updated_at || '')
        || (a.c.supplier_model || '').localeCompare(b.c.supplier_model || '');
    });
    return list;
  }, [comps, physical, reserved, incoming, activityByComp, search, filterCategory, filterBrand, stockOnly, sort]);

  const toggleSort = (key: SortKey) =>
    setSort((s) => (s.key === key ? { key, dir: (s.dir * -1) as 1 | -1 } : { key, dir: DEFAULT_DIR[key] }));

  const hasFilters = !!(search.trim() || filterCategory || filterBrand || stockOnly);

  async function saveMeta(componentId: string, patch: { warranty?: string; datasheet_url?: string }) {
    const { error } = await supabase.from('3.0_components').update(patch).eq('component_id', componentId);
    if (error) { flash(`Failed: ${error.message}`); return; }
    setComps((cs) => cs.map((c) => (c.component_id === componentId ? { ...c, ...patch } : c)));
    flash('Saved');
  }

  // ── Import / Export ────────────────────────────────────────────────────────
  const canExport = !!profile && ROLE_PERMISSIONS[profile.role].canExportCsv;
  const canImport = !!profile && (profile.role === 'owner' || ROLE_PERMISSIONS[profile.role].canManagePricing);
  const [importBusy, setImportBusy] = useState(false);
  const [importPreview, setImportPreview] = useState<{
    updates: { id: string; label: string; patch: Record<string, unknown>; changes: string[] }[];
    creates: Record<string, unknown>[];
    skipped: string[];
  } | null>(null);

  function exportCsv() {
    // Exports the FILTERED list, sorted as shown; brand/model only for buy-side viewers
    const headers = ['component_id', 'description', ...(canViewBrand ? ['model', 'brand'] : []), 'category', 'unit', 'capacity', 'selling_price_idr', 'warranty', 'live_stock', 'physical_stock', 'incoming'];
    const data = rows.map((r) => [
      r.c.component_id, descOf(r.c),
      ...(canViewBrand ? [r.c.supplier_model ?? '', r.c.brand ?? ''] : []),
      r.c.category ?? '', r.c.unit ?? '', r.c.norm_value ?? '',
      r.c.selling_price_idr ?? '', r.c.warranty ?? '',
      r.live, r.phys, r.inc,
    ]);
    downloadCsv(`products-${new Date().toISOString().slice(0, 10)}`, headers, data);
  }

  async function handleImportFile(file: File) {
    try {
      const { rows: recs } = parseCsv(await readFileText(file));
      if (!recs.length) { flash('No data rows found in the file'); return; }
      const byId = new Map(comps.map((c) => [c.component_id, c]));
      const byModel = new Map(comps.map((c) => [(c.supplier_model ?? '').trim().toLowerCase(), c]));
      const byDesc = new Map(comps.map((c) => [descOf(c).trim().toLowerCase(), c]));
      const validCats = new Set(comps.map((c) => c.category).filter(Boolean) as string[]);

      const updates: { id: string; label: string; patch: Record<string, unknown>; changes: string[] }[] = [];
      const creates: Record<string, unknown>[] = [];
      const skipped: string[] = [];
      for (const r of recs) {
        const id = r.componentid || '';
        const desc = r.description || r.internaldescription || '';
        const model = r.model || r.suppliermodel || '';
        const match = (id && byId.get(id))
          || (model && byModel.get(model.trim().toLowerCase()))
          || (desc && byDesc.get(desc.trim().toLowerCase()))
          || null;
        const price = csvNum(r.sellingpriceidr ?? r.sellingprice ?? r.price);
        const rawCat = (r.category || '').trim().toLowerCase().replace(/ /g, '_');
        const category = rawCat && validCats.has(rawCat) ? rawCat : null;

        if (match) {
          const patch: Record<string, unknown> = {};
          const changes: string[] = [];
          if (desc && desc !== (match.internal_description ?? '')) { patch.internal_description = desc; changes.push('description'); }
          if (price != null && Math.round(price) !== Math.round(Number(match.selling_price_idr) || 0)) { patch.selling_price_idr = price; changes.push(`price ${fmtInt(Number(match.selling_price_idr) || 0)} → ${fmtInt(price)}`); }
          if (r.warranty !== undefined && r.warranty !== (match.warranty ?? '')) { patch.warranty = r.warranty; changes.push('warranty'); }
          if (r.unit && r.unit !== (match.unit ?? '')) { patch.unit = r.unit; changes.push('unit'); }
          if (Object.keys(patch).length) updates.push({ id: match.component_id, label: descOf(match), patch, changes });
        } else if (desc || model) {
          creates.push({
            supplier_model: model || desc,
            internal_description: desc || null,
            ...(canViewBrand && r.brand ? { brand: r.brand } : {}),
            ...(category ? { category } : {}),
            unit: r.unit || null,
            selling_price_idr: price,
            warranty: r.warranty || null,
          });
        } else {
          skipped.push(JSON.stringify(r).slice(0, 80));
        }
      }
      if (!updates.length && !creates.length) { flash('Nothing to import — no changes detected'); return; }
      setImportPreview({ updates, creates, skipped });
    } catch (e) {
      flash(`Import failed: ${e instanceof Error ? e.message : 'could not read file'}`);
    }
  }

  async function applyImport() {
    if (!importPreview) return;
    setImportBusy(true);
    let ok = 0, failed = 0;
    for (const u of importPreview.updates) {
      const { error } = await supabase.from('3.0_components').update(u.patch).eq('component_id', u.id);
      if (error) failed++; else ok++;
    }
    if (importPreview.creates.length) {
      const { error } = await supabase.from('3.0_components').insert(importPreview.creates);
      if (error) failed += importPreview.creates.length; else ok += importPreview.creates.length;
    }
    setImportBusy(false);
    setImportPreview(null);
    flash(failed ? `${ok} applied, ${failed} failed` : `${ok} row${ok !== 1 ? 's' : ''} imported`);
    fetchAll();
  }

  if (authLoading || !profile) return <CenterSpinner />;
  if (!canView) return <CenterSpinner />;

  return (
    <div className="min-h-screen bg-[#0f1012] text-slate-200 font-sans text-sm">
      <div className="border-b border-slate-800/60 bg-[#0f1012]/80 backdrop-blur-md sticky top-0 z-30">
        {/* Phones: wordmark row then actions row — side-by-side squeezes the
            buttons into the wordmark. sm+ keeps the single row. */}
        <div className="max-w-[1600px] 2xl:max-w-[1920px] mx-auto px-3 sm:px-4 md:px-8 py-3 sm:py-4 flex flex-col sm:flex-row sm:items-center justify-between gap-2.5 sm:gap-4">
          <BrandMenu wordmarkClass="text-xl md:text-2xl font-extrabold" subtitle="Products · Sell-side catalog" />
          <div className="flex items-center gap-2 flex-wrap">
            {canExport && (
              <button onClick={exportCsv}
                title="Download the filtered list as CSV (opens in Excel)"
                className="text-xs text-slate-400 hover:text-white px-3 py-1.5 border border-slate-700 rounded-lg hover:bg-slate-800 transition-colors whitespace-nowrap">
                ↓ Export CSV
              </button>
            )}
            {canImport && (
              <label className="text-xs text-slate-400 hover:text-white px-3 py-1.5 border border-slate-700 rounded-lg hover:bg-slate-800 transition-colors whitespace-nowrap cursor-pointer"
                title="Import a CSV: matches by component_id / model / description, updates description · price · warranty · unit, creates unmatched rows as new products. Export first for the right column layout.">
                ↑ Import CSV
                <input type="file" accept=".csv,text/csv" className="hidden"
                  onChange={(e) => { const f = e.target.files?.[0]; if (f) handleImportFile(f); e.target.value = ''; }} />
              </label>
            )}
            <Link href="/catalog" className="hidden sm:block text-xs text-slate-400 hover:text-white px-3 py-1.5 border border-slate-700 rounded-lg hover:bg-slate-800 transition-colors whitespace-nowrap"
              title="Prices are set in the Catalog's Component Editor — Sell Price column → Tiers">
              Set pricing in Catalog →
            </Link>
          </div>
        </div>
      </div>

      <main className="max-w-[1600px] 2xl:max-w-[1920px] mx-auto px-3 sm:px-4 md:px-8 py-6 space-y-4">
        {/* Search + filters */}
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative flex-1 min-w-[200px]">
            <svg className="w-4 h-4 text-slate-500 absolute left-3.5 top-1/2 -translate-y-1/2" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M21 21l-4.35-4.35M17 11a6 6 0 11-12 0 6 6 0 0112 0z" /></svg>
            <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder={canViewBrand ? 'Search model, description, brand, category…' : 'Search description, category…'}
              className="w-full pl-10 pr-4 h-11 rounded-xl bg-slate-900/80 border border-slate-700/80 focus:border-emerald-500/60 outline-none text-white text-base sm:text-sm placeholder:text-slate-500 transition-colors" />
          </div>
          <select value={filterCategory} onChange={(e) => setFilterCategory(e.target.value)} className={selCls}>
            <option value="">All categories</option>
            {categories.map((c) => <option key={c} value={c}>{humanize(c)}</option>)}
          </select>
          {canViewBrand && (
            <select value={filterBrand} onChange={(e) => setFilterBrand(e.target.value)} className={selCls}>
              <option value="">All brands</option>
              {brands.map((b) => <option key={b} value={b}>{b}</option>)}
            </select>
          )}
          {/* Sort — the dropdown drives mobile; desktop headers also sort */}
          <select value={`${sort.key}:${sort.dir}`} onChange={(e) => { const [k, d] = e.target.value.split(':'); setSort({ key: k as SortKey, dir: Number(d) as 1 | -1 }); }} className={selCls}>
            {sortKeys.map((k) => (
              <Fragment key={k}>
                <option value={`${k}:${DEFAULT_DIR[k]}`}>{SORT_LABELS[k]} {DEFAULT_DIR[k] === -1 ? '↓' : '↑'}</option>
                <option value={`${k}:${-DEFAULT_DIR[k]}`}>{SORT_LABELS[k]} {DEFAULT_DIR[k] === -1 ? '↑' : '↓'}</option>
              </Fragment>
            ))}
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

        <p className="hidden md:block text-[11px] text-slate-600">
          Stock reads <span className="text-slate-400">Live/Physical</span> — e.g. 100/150 means 150 in the warehouse, 100 still free to sell (50 reserved on confirmed orders).{' '}
          <span className="text-slate-400">Incoming</span> = on POs not yet fully received. Click a row for tier prices + last orders &amp; deliveries.
        </p>

        {/* ── Desktop table ── */}
        <div className="hidden md:block bg-slate-900/40 border border-slate-800/80 rounded-2xl overflow-x-auto">
          <table className="w-full min-w-[1000px]">
            <thead>
              <tr className="border-b border-slate-800 text-[10px] uppercase tracking-widest text-slate-500">
                <th className="text-left font-semibold px-4 py-2.5">Description</th>
                <Th label="Sell Price" right active={sort.key === 'price'} dir={sort.dir} onClick={() => toggleSort('price')} />
                <Th label="Stock" right active={sort.key === 'stock'} dir={sort.dir} onClick={() => toggleSort('stock')} hint="Live/Physical" />
                <th className="text-right font-semibold px-3 py-2.5">Incoming</th>
                {canViewBrand && <Th label="Brand" active={sort.key === 'brand'} dir={sort.dir} onClick={() => toggleSort('brand')} />}
                <Th label="Category" active={sort.key === 'category'} dir={sort.dir} onClick={() => toggleSort('category')} />
                <Th label="Capacity" right active={sort.key === 'capacity'} dir={sort.dir} onClick={() => toggleSort('capacity')} />
                <th className="text-left font-semibold px-3 py-2.5">Warranty</th>
                <th className="text-center font-semibold px-3 py-2.5">Sheet</th>
                <Th label="Updated" right active={sort.key === 'updated'} dir={sort.dir} onClick={() => toggleSort('updated')} />
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800/60">
              {loading ? (
                [...Array(8)].map((_, i) => <tr key={i}><td colSpan={10} className="px-4 py-2"><div className="h-9 bg-slate-800/40 rounded-lg animate-pulse" /></td></tr>)
              ) : rows.length === 0 ? (
                <tr><td colSpan={10} className="px-4 py-12 text-center text-slate-600 text-sm">No products match.</td></tr>
              ) : rows.map((r) => (
                <Fragment key={r.c.component_id}>
                  <tr onClick={() => setExpanded((e) => (e === r.c.component_id ? null : r.c.component_id))}
                    className={`cursor-pointer transition-colors ${expanded === r.c.component_id ? 'bg-slate-800/40' : 'hover:bg-slate-800/20'}`}>
                    <td className="px-4 py-2">
                      <span className="flex items-center gap-1.5">
                        <span className="text-sm text-slate-100 font-medium truncate max-w-[320px]">{descOf(r.c)}</span>
                        {r.activity > 0 && <span className="px-1 py-0.5 rounded bg-slate-800 text-[9px] text-slate-500 tabular-nums flex-shrink-0" title={`${r.activity} POs / quotes / orders`}>{r.activity}</span>}
                      </span>
                    </td>
                    <td className="px-3 py-2 text-right whitespace-nowrap">
                      {r.c.selling_price_idr ? (
                        <button onClick={(e) => { e.stopPropagation(); copyPrice(r.c, r.c.selling_price_idr!); }}
                          title="Click to copy this price (excl. PPN) for WhatsApp"
                          className="block ml-auto tabular-nums text-sm text-slate-200 hover:text-emerald-300 transition-colors">
                          {fmtRp(r.c.selling_price_idr)}
                        </button>
                      ) : <span className="block tabular-nums text-sm text-slate-700">—</span>}
                      {activeTiers.length > 0 && r.c.selling_price_idr ? (
                        <span className="block text-[10px] text-slate-500 tabular-nums">{activeTiers.length} tier{activeTiers.length > 1 ? 's' : ''} ▾</span>
                      ) : null}
                    </td>
                    <td className="px-3 py-2 text-right whitespace-nowrap">
                      <StockCell live={r.live} phys={r.phys} unit={r.c.unit} />
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums text-sky-300/80">{r.inc ? fmtInt(r.inc) : <span className="text-slate-700">0</span>}</td>
                    {canViewBrand && <td className="px-3 py-2 text-xs text-slate-400 whitespace-nowrap">{r.c.brand || '—'}</td>}
                    <td className="px-3 py-2 text-xs text-slate-500 whitespace-nowrap">{r.c.category ? humanize(r.c.category) : '—'}</td>
                    <td className="px-3 py-2 text-right tabular-nums text-xs text-slate-400">{r.c.norm_value != null && Number(r.c.norm_value) !== 0 ? Number(r.c.norm_value).toLocaleString('en-US') : '—'}</td>
                    <td className="px-3 py-2 text-xs text-slate-400 whitespace-nowrap">{r.c.warranty || <span className="text-slate-700">—</span>}</td>
                    <td className="px-3 py-2 text-center">
                      {r.c.datasheet_url ? (
                        <a href={r.c.datasheet_url} target="_blank" rel="noopener noreferrer" onClick={(e) => e.stopPropagation()}
                          title="Open datasheet" className="inline-flex text-sky-400 hover:text-sky-300 transition-colors">
                          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2"><path strokeLinecap="round" strokeLinejoin="round" d="M13.828 10.172a4 4 0 010 5.656l-4 4a4 4 0 01-5.656-5.656l1.1-1.1m9.556-3.9l1.1-1.1a4 4 0 10-5.656-5.656l-4 4a4 4 0 000 5.656" /></svg>
                        </a>
                      ) : <span className="text-slate-700">—</span>}
                    </td>
                    <td className="px-3 py-2 text-right text-[11px] text-slate-500 tabular-nums whitespace-nowrap">{fmtDate(r.c.updated_at)}</td>
                  </tr>
                  {expanded === r.c.component_id && (
                    <tr>
                      <td colSpan={10} className="px-4 pb-4 pt-1 bg-slate-950/40">
                        <ProductDetail row={r} activeTiers={activeTiers} tierPrice={tierPrice}
                          orders={ordersByComp[r.c.component_id] ?? []} deliveries={deliveriesByComp[r.c.component_id] ?? []}
                          canEditMeta={canEditMeta} onSaveMeta={(patch) => saveMeta(r.c.component_id, patch)} onCopyPrice={copyPrice} />
                      </td>
                    </tr>
                  )}
                </Fragment>
              ))}
            </tbody>
          </table>
        </div>

        {/* ── Mobile cards: stock + tier prices front and center ── */}
        <div className="md:hidden space-y-2">
          {loading ? (
            [...Array(6)].map((_, i) => <div key={i} className="h-24 bg-slate-800/40 rounded-xl animate-pulse" />)
          ) : rows.length === 0 ? (
            <p className="px-4 py-12 text-center text-slate-600 text-sm">No products match.</p>
          ) : rows.map((r) => {
            const open = expanded === r.c.component_id;
            return (
              <div key={r.c.component_id} className={`bg-slate-900/40 border rounded-xl transition-colors ${open ? 'border-emerald-500/30' : 'border-slate-800/80'}`}>
                <button onClick={() => setExpanded(open ? null : r.c.component_id)} className="w-full text-left px-3.5 py-3">
                  <div className="flex items-start gap-2">
                    <div className="min-w-0 flex-1">
                      <p className="text-sm text-slate-100 font-medium truncate">{descOf(r.c)}</p>
                      <p className="text-[11px] text-slate-500 truncate">
                        {[r.c.brand, r.c.category ? humanize(r.c.category) : '', r.c.norm_value ? Number(r.c.norm_value).toLocaleString('en-US') : ''].filter(Boolean).join(' · ') || '—'}
                      </p>
                    </div>
                    {r.c.datasheet_url && (
                      <a href={r.c.datasheet_url} target="_blank" rel="noopener noreferrer" onClick={(e) => e.stopPropagation()}
                        className="p-1.5 -m-0.5 text-sky-400 flex-shrink-0" title="Datasheet">
                        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2"><path strokeLinecap="round" strokeLinejoin="round" d="M13.828 10.172a4 4 0 010 5.656l-4 4a4 4 0 01-5.656-5.656l1.1-1.1m9.556-3.9l1.1-1.1a4 4 0 10-5.656-5.656l-4 4a4 4 0 000 5.656" /></svg>
                      </a>
                    )}
                  </div>
                  {/* Highlights: stock (Live colored / Physical muted) + tap-to-copy prices */}
                  <div className="flex flex-wrap items-center gap-1.5 mt-2">
                    <span className="px-2 py-1 rounded-lg bg-slate-800/80 text-[11px] font-bold tabular-nums">
                      <span className={r.live > 0 ? 'text-emerald-300' : r.live < 0 ? 'text-red-300' : 'text-slate-500'}>{fmtInt(r.live)}</span>
                      <span className="text-slate-500">/{fmtInt(r.phys)}</span>
                      {r.c.unit && <span className="text-slate-600 font-normal"> {r.c.unit}</span>}
                    </span>
                    {r.inc > 0 && <span className="px-2 py-1 rounded-lg bg-sky-500/10 text-sky-300 text-[11px] tabular-nums">+{fmtInt(r.inc)} incoming</span>}
                    {r.c.selling_price_idr ? (
                      <span role="button" tabIndex={0} onClick={(e) => { e.stopPropagation(); copyPrice(r.c, r.c.selling_price_idr!); }}
                        title="Tap to copy this price for WhatsApp"
                        className="px-2 py-1 rounded-lg bg-slate-800 text-slate-200 text-[11px] font-semibold tabular-nums active:text-emerald-300">
                        {fmtRp(r.c.selling_price_idr)}
                      </span>
                    ) : null}
                    {activeTiers.map((t) => {
                      const p = tierPrice(r.c, t);
                      return p != null ? (
                        <span key={t.tier_id} role="button" tabIndex={0} onClick={(e) => { e.stopPropagation(); copyPrice(r.c, p); }}
                          title={`Tap to copy ${t.name} price for WhatsApp`}
                          className="px-2 py-1 rounded-lg bg-slate-800/60 text-[11px] tabular-nums text-slate-400 active:text-emerald-300">
                          {t.name} <span className="text-slate-200 font-semibold">{fmtRp(p)}</span>
                        </span>
                      ) : null;
                    })}
                    {r.c.warranty && <span className="px-2 py-1 rounded-lg bg-slate-800/60 text-[11px] text-slate-400">Warranty {r.c.warranty}</span>}
                  </div>
                </button>
                {open && (
                  <div className="px-3.5 pb-3.5">
                    <ProductDetail row={r} activeTiers={activeTiers} tierPrice={tierPrice}
                      orders={ordersByComp[r.c.component_id] ?? []} deliveries={deliveriesByComp[r.c.component_id] ?? []}
                      canEditMeta={canEditMeta} onSaveMeta={(patch) => saveMeta(r.c.component_id, patch)} onCopyPrice={copyPrice} />
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </main>

      {/* Import preview — nothing writes until confirmed */}
      {importPreview && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={() => setImportPreview(null)} />
          <div className="relative w-full max-w-2xl max-h-[85vh] flex flex-col bg-slate-900 border border-slate-700 rounded-2xl shadow-2xl">
            <div className="px-5 pt-4 pb-3 border-b border-slate-800">
              <h3 className="text-sm font-bold text-white">Import products — preview</h3>
              <p className="text-[11px] text-slate-500 mt-0.5">
                {importPreview.updates.length} update{importPreview.updates.length !== 1 ? 's' : ''} · {importPreview.creates.length} new product{importPreview.creates.length !== 1 ? 's' : ''}
                {importPreview.skipped.length ? ` · ${importPreview.skipped.length} skipped (no id/model/description)` : ''}
              </p>
            </div>
            <div className="flex-1 overflow-y-auto px-5 py-3 space-y-3 text-xs">
              {importPreview.updates.length > 0 && (
                <div>
                  <p className="text-[10px] uppercase tracking-wider text-slate-500 mb-1">Updates</p>
                  <div className="rounded-lg border border-slate-800 divide-y divide-slate-800/60">
                    {importPreview.updates.map((u) => (
                      <div key={u.id} className="px-3 py-1.5 flex items-center gap-3">
                        <span className="text-slate-300 truncate flex-1">{u.label}</span>
                        <span className="text-slate-500 truncate">{u.changes.join(' · ')}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
              {importPreview.creates.length > 0 && (
                <div>
                  <p className="text-[10px] uppercase tracking-wider text-slate-500 mb-1">New products</p>
                  <div className="rounded-lg border border-slate-800 divide-y divide-slate-800/60">
                    {importPreview.creates.map((c, i) => (
                      <div key={i} className="px-3 py-1.5 flex items-center gap-3">
                        <span className="text-emerald-300/90 truncate flex-1">{String(c.internal_description || c.supplier_model)}</span>
                        <span className="text-slate-500 tabular-nums">{c.selling_price_idr != null ? `Rp${fmtInt(Number(c.selling_price_idr))}` : 'no price'}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
            <div className="px-5 py-3 border-t border-slate-800 flex items-center justify-end gap-2">
              <button onClick={() => setImportPreview(null)} disabled={importBusy}
                className="px-3 py-1.5 rounded-lg text-xs text-slate-400 hover:text-white hover:bg-white/10 border border-white/[0.06] transition-all">Cancel</button>
              <button onClick={applyImport} disabled={importBusy}
                className="px-4 py-1.5 rounded-lg text-xs font-bold bg-emerald-600 hover:bg-emerald-500 text-white transition-colors disabled:opacity-50">
                {importBusy ? 'Importing…' : `Apply ${importPreview.updates.length + importPreview.creates.length} rows`}
              </button>
            </div>
          </div>
        </div>
      )}
      {toast && <div className="fixed bottom-6 right-6 z-[110] px-4 py-2.5 bg-slate-800 border border-slate-700 text-white text-sm font-semibold rounded-xl shadow-lg">{toast}</div>}
    </div>
  );
}

// ── Pieces ──────────────────────────────────────────────────────────────────
const selCls = 'h-11 px-3 rounded-xl bg-slate-900/80 border border-slate-700/80 focus:border-emerald-500/60 outline-none text-slate-300 text-xs transition-colors cursor-pointer';

function CenterSpinner() {
  return <div className="min-h-screen bg-[#0f1012] flex items-center justify-center"><div className="w-6 h-6 border-2 border-emerald-500/30 border-t-emerald-500 rounded-full animate-spin" /></div>;
}

function Th({ label, hint, right, active, dir, onClick }: { label: string; hint?: string; right?: boolean; active: boolean; dir: 1 | -1; onClick: () => void }) {
  return (
    <th className={`font-semibold px-3 py-2.5 ${right ? 'text-right' : 'text-left'}`}>
      <button onClick={onClick} className={`inline-flex items-center gap-1 uppercase tracking-widest transition-colors ${active ? 'text-emerald-400' : 'hover:text-slate-300'}`} title={hint}>
        {label}
        <span className="text-[8px]">{active ? (dir === 1 ? '▲' : '▼') : '↕'}</span>
      </button>
      {hint && <span className="block normal-case tracking-normal text-[9px] text-slate-600 font-normal">{hint}</span>}
    </th>
  );
}

function StockCell({ live, phys, unit }: { live: number; phys: number; unit: string | null }) {
  const cls = live < 0 ? 'text-red-400' : live === 0 ? 'text-slate-600' : 'text-emerald-300';
  return (
    <span className="tabular-nums text-sm">
      <span className={`font-semibold ${cls}`}>{fmtInt(live)}</span>
      <span className="text-slate-600">/{fmtInt(phys)}</span>
      {unit && <span className="text-slate-600 text-[10px]"> {unit}</span>}
    </span>
  );
}

function ProductDetail({ row, activeTiers, tierPrice, orders, deliveries, canEditMeta, onSaveMeta, onCopyPrice }: {
  row: Row;
  activeTiers: Tier[];
  tierPrice: (c: Comp, t: Tier) => number | null;
  orders: DocRef[];
  deliveries: DocRef[];
  canEditMeta: boolean;
  onSaveMeta: (patch: { warranty?: string; datasheet_url?: string }) => void;
  onCopyPrice: (c: Comp, price: number) => void;
}) {
  const { c, rsv } = row;
  const [warranty, setWarranty] = useState(c.warranty ?? '');
  const [sheet, setSheet] = useState(c.datasheet_url ?? '');

  return (
    <div className="space-y-3 pt-1">
      {/* Tier price list — click any price to copy it (excl. PPN) for WhatsApp */}
      <div className="flex flex-wrap gap-1.5 items-center">
        <span className="text-[10px] font-semibold uppercase tracking-widest text-slate-600 mr-1 w-full sm:w-auto">Price list · tap to copy</span>
        {c.selling_price_idr ? (
          <button onClick={() => onCopyPrice(c, c.selling_price_idr!)} title="Copy this price (excl. PPN) for WhatsApp"
            className="px-2.5 py-1 rounded-lg bg-slate-800/80 border border-slate-700 hover:border-emerald-500/40 text-[11px] transition-colors">
            <span className="text-slate-500">List</span> <span className="tabular-nums text-slate-200 font-semibold">{fmtRp(c.selling_price_idr)}</span>
          </button>
        ) : (
          <span className="text-[11px] text-slate-600 italic">No list price — <Link href="/catalog" className="text-emerald-400 hover:text-emerald-300">set it in Catalog</Link></span>
        )}
        {activeTiers.map((t) => {
          const p = tierPrice(c, t);
          if (p == null) return (
            <span key={t.tier_id} className="px-2.5 py-1 rounded-lg bg-slate-800/60 border border-slate-700 text-[11px]">
              <span className="text-slate-500">{t.name}</span> <span className="text-slate-600">—</span>
            </span>
          );
          return (
            <button key={t.tier_id} onClick={() => onCopyPrice(c, p)} title={`Copy ${t.name} price (excl. PPN) for WhatsApp`}
              className="px-2.5 py-1 rounded-lg bg-slate-800/60 border border-slate-700 hover:border-emerald-500/40 text-[11px] transition-colors">
              <span className="text-slate-500">{t.name}</span>{' '}
              <span className="tabular-nums text-slate-200 font-semibold">{fmtRp(p)}</span>
            </button>
          );
        })}
        {rsv > 0 && <span className="text-[11px] text-amber-300/80 tabular-nums sm:ml-auto">Reserved on orders: {fmtInt(rsv)}</span>}
      </div>

      {/* Warranty + datasheet */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
        <div>
          <label className="block text-[10px] font-medium text-slate-500 mb-0.5">Warranty</label>
          {canEditMeta ? (
            <input value={warranty} onChange={(e) => setWarranty(e.target.value)}
              onBlur={() => { if (warranty.trim() !== (c.warranty ?? '')) onSaveMeta({ warranty: warranty.trim() }); }}
              placeholder="e.g. 12 years product / 30 years performance"
              className={dInp} />
          ) : (
            <p className="text-xs text-slate-300 py-1.5">{c.warranty || <span className="text-slate-600">—</span>}</p>
          )}
        </div>
        <div>
          <label className="block text-[10px] font-medium text-slate-500 mb-0.5">Datasheet URL (Drive or web)</label>
          {canEditMeta ? (
            <div className="flex gap-1.5">
              <input value={sheet} onChange={(e) => setSheet(e.target.value)}
                onBlur={() => { if (sheet.trim() !== (c.datasheet_url ?? '')) onSaveMeta({ datasheet_url: sheet.trim() }); }}
                placeholder="https://…" className={dInp} />
              {c.datasheet_url && (
                <a href={c.datasheet_url} target="_blank" rel="noopener noreferrer"
                  className="px-3 py-1.5 rounded-lg bg-sky-500/10 text-sky-300 text-xs font-semibold hover:bg-sky-500/20 transition-colors whitespace-nowrap self-start">Open</a>
              )}
            </div>
          ) : c.datasheet_url ? (
            <a href={c.datasheet_url} target="_blank" rel="noopener noreferrer" className="text-xs text-sky-400 hover:text-sky-300 break-all">{c.datasheet_url}</a>
          ) : (
            <p className="text-xs text-slate-600 py-1.5">—</p>
          )}
        </div>
      </div>

      {/* Last orders + deliveries */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
        <DocList title="Last Customer Orders" empty="No customer orders yet." refs={orders} accent="text-violet-300" unit={c.unit} />
        <DocList title="Last Deliveries" empty="No deliveries yet." refs={deliveries} accent="text-emerald-300" unit={c.unit} />
      </div>
    </div>
  );
}

const dInp = 'w-full px-2.5 py-1.5 rounded-lg bg-slate-950 border border-slate-800 focus:border-emerald-500/50 outline-none text-white text-xs placeholder:text-slate-600 transition-colors';

function DocList({ title, empty, refs, accent, unit }: { title: string; empty: string; refs: DocRef[]; accent: string; unit: string | null }) {
  return (
    <div>
      <p className="text-[10px] font-semibold uppercase tracking-widest text-slate-600 mb-1.5">{title}</p>
      {refs.length === 0 ? (
        <p className="text-[11px] text-slate-600 italic">{empty}</p>
      ) : (
        <div className="rounded-lg border border-slate-800 bg-slate-950/50 divide-y divide-slate-800/60">
          {refs.map((r, i) => (
            <a key={i} href={`/sales/${r.quote_id}`}
              className="flex items-center gap-2.5 px-2.5 py-1.5 text-[11px] hover:bg-slate-800/40 transition-colors">
              <span className={`font-mono flex-shrink-0 hover:underline ${accent}`}>{r.number}</span>
              <span className="text-slate-400 truncate flex-1">{r.customer || '—'}</span>
              <span className="text-slate-300 tabular-nums flex-shrink-0">{fmtInt(r.qty)}{unit ? ` ${unit}` : ''}</span>
              <span className="text-slate-600 tabular-nums flex-shrink-0">{fmtDate(r.date)}</span>
            </a>
          ))}
        </div>
      )}
    </div>
  );
}
