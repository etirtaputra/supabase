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
import { useState, useEffect, useMemo, useCallback, useRef, Fragment, Suspense } from 'react';
import { createSupabaseClient } from '@/lib/supabase';
import { useAuth } from '@/hooks/useAuth';
import { useRouter, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { ROLE_PERMISSIONS } from '@/constants/roles';
import { canOpenPath } from '@/constants/navigation';
import BrandMenu from '@/components/ui/BrandMenu';
import { COMMITTED_STATUSES as COMMITTED } from '@/lib/salesStatus';
import { downloadCsv, parseCsv, readFileText, csvNum } from '@/lib/csv';
import { fetchDeliveredByQuoteComp } from '@/lib/reservedStock';
import { rollUpByComponent, type BalanceRow } from '@/lib/warehouses';
import { computeTierChain } from '@/lib/tierPricing';

interface Comp {
  component_id: string; supplier_model: string; internal_description: string | null;
  brand: string | null; category: string | null; unit: string | null;
  norm_value: number | null; selling_price_idr: number | null;
  datasheet_url: string | null; warranty: string | null; updated_at: string | null;
  warranty_value: number | null; warranty_unit: string | null;
  perf_warranty_value: number | null; perf_warranty_unit: string | null;
}
interface Tier { tier_id: string; tier_code: string; name: string; default_discount_pct: number; sort_order: number; is_active: boolean; }
interface Override { component_id: string; tier_id: string; override_price_idr: number | null; override_discount_pct: number | null; }
interface DocRef { number: string; customer: string; qty: number; date: string; quote_id: string; }

import { formatCategory as humanize } from '@/lib/formatCategory';
import { fmtDay, fmtDate, fmtInt, fmtRupiah } from '@/lib/formatters';
import { INCOMING_PO_STATUSES, itemArrivals, itemArrivalDetails, type ItemArrival, type ArrivalDetail, type OpenPo, type ReceivedPo } from '@/lib/inTransit';
import { useSettings } from '@/hooks/useSettings';
import { PRODUCT_COLS } from '@/constants/productColumns';
import LayoutToggle from '@/components/ui/LayoutToggle';
import QuoteBasket, { useQuoteBasket } from '@/components/ui/QuoteBasket';
import { buildQuoteMessage, shareOrCopy } from '@/lib/whatsappQuote';
import { useListLayout } from '@/hooks/useListLayout';
import { useListDefaults } from '@/hooks/useListDefaults';
import DateRangeFilter from '@/components/ui/DateRangeFilter';
import { inRange, type DateRange } from '@/lib/dateRange';
import { successorMap } from '@/lib/successors';
import { WARRANTY_UNITS, fmtWarranty, warrantyLabel } from '@/lib/warranty';
import { useT } from '@/hooks/useT';
// "Just arrived" window: a goods receipt in the last N days makes stock NEW.
// The item's FIRST-ever receipt inside the window = a brand-new product.
// The length is Settings › Defaults, shared with the dashboard's New arrivals
// panel — one definition of "new", not one per screen.
const arrivalCutoffIso = (days: number) => {
  const d = new Date(); d.setDate(d.getDate() - days);
  return d.toISOString().slice(0, 10);
};
/** 'new' = first stock ever, just landed · 'restock' = fresh stock of a known item. */
function arrivalTagOf(a: { first: string; last: string } | undefined, days: number): 'new' | 'restock' | null {
  const cutoff = arrivalCutoffIso(days);
  if (!a || a.last < cutoff) return null;
  return a.first >= cutoff ? 'new' : 'restock';
}
function ArrivalTag({ a, days }: { a: { first: string; last: string } | undefined; days: number }) {
  const tag = arrivalTagOf(a, days);
  if (!tag) return null;
  return (
    <span
      title={tag === 'new' ? `New product — first stock arrived ${a!.first}` : `New stock — arrived ${a!.last}`}
      className={`flex-shrink-0 px-1.5 py-0.5 rounded-md text-[9px] font-bold uppercase tracking-wide ring-1 ${
        tag === 'new'
          ? 'bg-emerald-500/15 text-emerald-300 ring-emerald-500/30'
          : 'bg-sky-500/15 text-sky-300 ring-sky-500/30'}`}>
      {tag === 'new' ? 'New' : 'New stock'}
    </span>
  );
}

// The product's customer-facing name: our internal description, never the supplier's model/SKU.
/** Amber "newer version" tag — shown wherever a superseded item appears. */
function SupersededTag({ succId, comps, canHub }: { succId?: string; comps: { component_id: string; internal_description: string | null; supplier_model: string }[]; canHub: boolean }) {
  const { t } = useT();
  if (!succId) return null;
  const succ = comps.find((c) => c.component_id === succId);
  const label = succ ? descOf(succ) : 'newer item';
  const cls = 'inline-flex items-center gap-1 px-1.5 py-0.5 rounded-md border border-amber-500/40 bg-amber-500/10 text-amber-300 text-[10px] font-semibold flex-shrink-0';
  return canHub ? (
    <a href={`/items/${succId}`} target="_blank" rel="noopener noreferrer" onClick={(e) => e.stopPropagation()}
      title={`This item is replaced by ${label} — open the newer item`} className={`${cls} hover:bg-amber-500/20 transition-colors`}>
      ↑ Newer version ↗
    </a>
  ) : (
    <span title={`This item is replaced by ${label}`} className={cls}>{t('↑ Newer version')}</span>
  );
}

const descOf = (c: { internal_description: string | null; supplier_model: string }) =>
  (c.internal_description && c.internal_description.trim()) || c.supplier_model || '(no description)';

type SortKey = 'traded' | 'activity' | 'updated' | 'price' | 'stock' | 'incoming' | 'name' | 'brand' | 'category' | 'capacity' | 'warranty' | 'sheet';
const SORT_LABELS: Record<SortKey, string> = {
  traded: 'Most sold (period)', activity: 'Most traded', updated: 'Last updated', price: 'Sell price',
  stock: 'Live stock', incoming: 'Incoming', name: 'Name', brand: 'Brand', category: 'Category',
  capacity: 'Capacity', warranty: 'Warranty', sheet: 'Has datasheet',
};
// Text columns default ascending; numeric/recency default descending.
const DEFAULT_DIR: Record<SortKey, 1 | -1> = {
  traded: -1, activity: -1, updated: -1, price: -1, stock: -1, incoming: -1, name: 1, brand: 1, category: 1, capacity: -1, warranty: -1, sheet: -1,
};

// Warranty length in days, for sorting: structured value first-class, a
// legacy free-text note sorts between "some" and "none", nothing → last.
const UNIT_DAYS: Record<string, number> = { years: 365.25, months: 30.44, days: 1 };
const wtyDays = (c: Comp): number =>
  c.warranty_value ? Number(c.warranty_value) * (UNIT_DAYS[c.warranty_unit ?? 'years'] ?? 365.25)
  : (c.warranty ?? '').trim() ? 0.5 : -1;

interface Row { c: Comp; phys: number; rsv: number; live: number; inc: number; eta: ItemArrival | null; activity: number; sold: number; }

// Suspense wrapper: useSearchParams (?q= deep links from Spotlight) requires it
export default function ProductsPage() {
  return (
    <Suspense fallback={<div className="min-h-screen bg-chrome" />}>
      <ProductsInner />
    </Suspense>
  );
}

function ProductsInner() {
  const { t } = useT();
  const supabase = createSupabaseClient();
  const router = useRouter();
  const searchParams = useSearchParams();
  const { user, profile, loading: authLoading } = useAuth();
  const canView = !!profile && ROLE_PERMISSIONS[profile.role].canViewSellingPrice;
  const canEditMeta = !!profile && ROLE_PERMISSIONS[profile.role].canEdit; // warranty / datasheet edits
  // Brand reveals the supplier relationship — buy-side sensitive. Not fetched at
  // all for sell-side roles, so it never reaches the client.
  const canViewBrand = !!profile && ROLE_PERMISSIONS[profile.role].canViewBrand;
  // The Item hub sits in Analytics, which is owner-only — the links to it only
  // render for roles that can actually open it (no doors to /unauthorized).
  const canHub = !!profile && ROLE_PERMISSIONS[profile.role].canViewAnalytics;

  const [comps, setComps] = useState<Comp[]>([]);
  const [tiers, setTiers] = useState<Tier[]>([]);
  const [overrides, setOverrides] = useState<Override[]>([]);
  const [physical, setPhysical] = useState<Record<string, number>>({});
  const [reserved, setReserved] = useState<Record<string, number>>({});
  const [incoming, setIncoming] = useState<Record<string, number>>({});
  const [etaByComp, setEtaByComp] = useState<Record<string, ItemArrival>>({});
  const [etaDetails, setEtaDetails] = useState<Record<string, ArrivalDetail[]>>({});
  const [activityByComp, setActivityByComp] = useState<Record<string, number>>({});
  // One row per committed sale line — quantity and the date it was ordered, so
  // "most sold" can be asked of any period rather than only all time.
  const [soldLines, setSoldLines] = useState<{ cid: string; qty: number; date: string }[]>([]);
  const [ordersByComp, setOrdersByComp] = useState<Record<string, DocRef[]>>({});
  const [deliveriesByComp, setDeliveriesByComp] = useState<Record<string, DocRef[]>>({});
  const [loading, setLoading] = useState(true);

  const [search, setSearch] = useState(searchParams.get('q') ?? '');
  const [filterCategory, setFilterCategory] = useState('');
  const [filterBrand, setFilterBrand] = useState('');
  // Priced only is the DEFAULT view (owner, 2026-08-14): the sales list is for
  // quoting, and an item with no sell price cannot be quoted. Untick to see the
  // rest; "Clear ×" returns to the default (priced) view, not to everything.
  // ?new=1 (the dashboard's New arrivals panel) opens this list on what just
  // landed — and turns OFF "priced only", because the whole reason to follow
  // that link is usually the items nobody has priced yet.
  const arrivedDeepLink = searchParams.get('new') === '1';
  const [pricedOnly, setPricedOnly] = useState(!arrivedDeepLink);
  const [stockOnly, setStockOnly] = useState(false);
  const [justArrived, setJustArrived] = useState(arrivedDeepLink);
  // First/last goods-receipt date per item (30.0 ledger, GRN in-movements) —
  // powers the "New" / "New stock" tags and the Just-arrived filter.
  const [arrivals, setArrivals] = useState<Record<string, { first: string; last: string }>>({});
  const listDefaults = useListDefaults('products');
  const [sort, setSort] = useState<{ key: SortKey; dir: 1 | -1 }>({ key: 'traded', dir: -1 });
  const [range, setRange] = useState<DateRange>(listDefaults.range);
  const listTouched = useRef(false);
  // Settings › Lists decides how the catalogue opens, until someone re-sorts it
  useEffect(() => {
    if (listTouched.current) return;
    const key = listDefaults.sort as SortKey;
    if (SORT_LABELS[key]) setSort({ key, dir: DEFAULT_DIR[key] });
    setRange(listDefaults.range);
  }, [listDefaults.sort, listDefaults.range.from, listDefaults.range.to]);   // eslint-disable-line react-hooks/exhaustive-deps
  const [expanded, setExpanded] = useState<string | null>(null);
  const [layout, setLayout] = useListLayout('products');
  const compact = layout === 'compact';
  const settings = useSettings();
  const newArrivalDays = settings.newArrivalDays;

  // ── Table columns: owner enforcement + personal choice ────────────────────
  // The owner's hidden set (Settings › Lists) leaves the table AND the Columns
  // menu; a personal hide narrows further but can never reveal what the owner
  // hid. Description is the identity column and is never optional.
  const [userHiddenCols, setUserHiddenCols] = useState<Set<string>>(new Set());
  useEffect(() => {
    try {
      const raw = localStorage.getItem('products:hiddenCols');
      if (raw) setUserHiddenCols(new Set((JSON.parse(raw) as string[]).filter((k) => PRODUCT_COLS.some((c) => c.key === k))));
    } catch {}
  }, []);
  const toggleCol = (key: string) => {
    setUserHiddenCols((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key); else next.add(key);
      try { localStorage.setItem('products:hiddenCols', JSON.stringify([...next])); } catch {}
      return next;
    });
  };
  const [colsOpen, setColsOpen] = useState(false);
  const enforcedHidden = useMemo(() => new Set(settings.productHiddenColumns), [settings.productHiddenColumns]);
  const colOffered = useCallback((k: string) =>
    !enforcedHidden.has(k) && (k !== 'brand' || (!!profile && ROLE_PERMISSIONS[profile.role].canViewBrand)),
    [enforcedHidden, profile]);
  const colShown = useCallback((k: string) => colOffered(k) && !userHiddenCols.has(k), [colOffered, userHiddenCols]);
  const visibleColCount = 1 + PRODUCT_COLS.filter((c) => colShown(c.key)).length;
  // PO numbers are buy-side documents — a sales login gets the dates without them
  const canSeePo = !!profile && ROLE_PERMISSIONS[profile.role].buySide;

  // ── Description column width: drag the header's edge; double-click resets ──
  // null = the responsive default (clamp on viewport width). Stored per browser.
  const [descW, setDescW] = useState<number | null>(null);
  useEffect(() => {
    try {
      const raw = localStorage.getItem('products:descWidth');
      const n = raw ? Number(raw) : NaN;
      if (Number.isFinite(n) && n >= 160) setDescW(Math.min(1400, n));
    } catch {}
  }, []);
  const startDescResize = useCallback((e: React.MouseEvent) => {
    e.preventDefault(); e.stopPropagation();
    const startX = e.clientX;
    // Starting point: the current effective max-width (stored, or the clamp)
    const startW = descW ?? Math.min(Math.max(320, window.innerWidth * 0.42), 1024);
    const move = (ev: MouseEvent) => {
      const w = Math.min(1400, Math.max(160, Math.round(startW + (ev.clientX - startX))));
      setDescW(w);
    };
    const up = (ev: MouseEvent) => {
      window.removeEventListener('mousemove', move);
      window.removeEventListener('mouseup', up);
      const w = Math.min(1400, Math.max(160, Math.round(startW + (ev.clientX - startX))));
      try { localStorage.setItem('products:descWidth', String(w)); } catch {}
    };
    window.addEventListener('mousemove', move);
    window.addEventListener('mouseup', up);
  }, [descW]);
  const resetDescWidth = useCallback(() => {
    setDescW(null);
    try { localStorage.removeItem('products:descWidth'); } catch {}
  }, []);

  const [toast, setToast] = useState<string | null>(null);
  // component_id -> id of the item that replaces it (8.0 successor links)
  const [successors, setSuccessors] = useState<Map<string, string>>(new Map());
  const flash = (m: string) => { setToast(m); setTimeout(() => setToast(null), 2200); };

  useEffect(() => { document.title = 'Products — ICAPROC'; }, []);
  useEffect(() => {
    if (authLoading) return;
    if (!user) { router.replace(`/login?next=${encodeURIComponent('/products')}`); return; }
    if (profile && !canOpenPath(ROLE_PERMISSIONS[profile.role], '/products')) router.replace('/unauthorized');
  }, [authLoading, user, profile, router]);

  const fetchAll = useCallback(async () => {
    setLoading(true);
    const fetchAllComponents = async () => {
      const PAGE = 1000;
      let all: Comp[] = [];
      let from = 0;
      for (;;) {
        const cols = `component_id, supplier_model, internal_description, category, unit, norm_value, selling_price_idr, datasheet_url, warranty, warranty_value, warranty_unit, perf_warranty_value, perf_warranty_unit, updated_at${canViewBrand ? ', brand' : ''}`;
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
    const [allComps, tierRes, ovRes, balRes, sqRes, sqiRes, poRes, poiRes, piiRes, custRes, linkRes, arrRes, pqRes] = await Promise.all([
      fetchAllComponents(),
      supabase.from('21.0_price_tiers').select('tier_id, tier_code, name, default_discount_pct, sort_order, is_active').order('sort_order'),
      supabase.from('21.1_item_tier_prices').select('component_id, tier_id, override_price_idr, override_discount_pct'),
      supabase.from('30.1_stock_balances').select('component_id, location, qty_on_hand'),
      supabase.from('22.0_sales_quotes').select('quote_id, status, order_number, do_number, ordered_at, delivered_at, updated_at, customer_id'),
      supabase.from('22.1_sales_quote_items').select('quote_id, component_id, quantity, is_section'),
      // po_number only for buy-side eyes — same network-tab rule as brand/cost:
      // a column a role may not see is never fetched, not merely not rendered.
      // (Widened to `string` so supabase-js skips literal-parsing the dynamic select.)
      supabase.from('5.0_purchases').select(('po_id, quote_id, status, po_date, estimated_delivery_date, supplier_id, actual_received_date' + (canSeePo ? ', po_number' : '')) as string),
      supabase.from('5.1_purchase_line_items').select('po_id, component_id, quantity'),
      supabase.from('4.1_price_quote_line_items').select('quote_id, component_id').limit(8000),
      supabase.from('20.0_customers').select('customer_id, display_name, legal_name'),
      supabase.from('8.0_component_links').select('component_id_a, component_id_b, link_type').eq('link_type', 'successor'),
      // Goods-receipt dates only (no costs — the /products network-tab rule) —
      // first receipt = the product is NEW; recent receipt = stock just arrived.
      supabase.from('30.0_stock_movements').select('component_id, moved_at').eq('direction', 'in').eq('source_type', 'receipt'),
      // Lead time as STATED on the supplier quote — feeds the Incoming hover
      supabase.from('4.0_price_quotes').select('quote_id, estimated_lead_time_days'),
    ]);
    const arr: Record<string, { first: string; last: string }> = {};
    for (const m of (arrRes.data ?? []) as { component_id: string; moved_at: string | null }[]) {
      const d = (m.moved_at ?? '').slice(0, 10);
      if (!d || !m.component_id) continue;
      const e = arr[m.component_id];
      if (!e) arr[m.component_id] = { first: d, last: d };
      else { if (d < e.first) e.first = d; if (d > e.last) e.last = d; }
    }
    setArrivals(arr);
    setComps(allComps);
    setTiers((tierRes.data as Tier[]) ?? []);
    setOverrides((ovRes.data as Override[]) ?? []);

    // SUM across warehouses — an item can sit in several, and assigning
    // instead of adding would silently show only one warehouse's stock.
    const phys: Record<string, number> = {};
    for (const [cid, e] of rollUpByComponent((balRes.data as BalanceRow[]) ?? [])) phys[cid] = e.qty;
    setPhysical(phys);
    setSuccessors(successorMap(linkRes.error ? [] : ((linkRes.data as any[]) ?? [])));

    const custName = new Map(((custRes.data as { customer_id: string; display_name: string; legal_name: string }[]) ?? [])
      .map((c) => [c.customer_id, c.display_name || c.legal_name || '']));
    const docs = (sqRes.data as { quote_id: string; status: string; order_number: string | null; do_number: string | null; ordered_at: string | null; delivered_at: string | null; updated_at: string | null; customer_id: string | null }[]) ?? [];
    const docById = new Map(docs.map((d) => [d.quote_id, d]));
    const committed = new Set(docs.filter((q) => COMMITTED.has(q.status)).map((q) => q.quote_id));

    const rsv: Record<string, number> = {};
    const sold: { cid: string; qty: number; date: string }[] = [];
    const orders: Record<string, DocRef[]> = {};
    const deliveries: Record<string, DocRef[]> = {};
    const sqSets: Record<string, Set<string>> = {};
    for (const it of (sqiRes.data as { quote_id: string; component_id: string | null; quantity: number; is_section: boolean }[]) ?? []) {
      if (!it.component_id || it.is_section) continue;
      const cid = it.component_id;
      const qty = Number(it.quantity) || 0;
      if (committed.has(it.quote_id)) {
        rsv[cid] = (rsv[cid] ?? 0) + qty;
        const d = docById.get(it.quote_id);
        sold.push({ cid, qty, date: (d?.ordered_at ?? d?.delivered_at ?? d?.updated_at ?? '').slice(0, 10) });
      }
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
    // Split fulfillment: delivered DO quantities release their reserve share
    const deliveredSplit = await fetchDeliveredByQuoteComp(supabase);
    for (const [k, dq] of deliveredSplit) {
      const [qid, cid] = k.split('·');
      if (committed.has(qid)) rsv[cid] = Math.max(0, (rsv[cid] ?? 0) - dq);
    }
    setReserved(rsv);
    setSoldLines(sold);
    setOrdersByComp(top10(orders));
    setDeliveriesByComp(top10(deliveries));

    const poStatus = new Map(((poRes.data as unknown as { po_id: number; status: string }[]) ?? []).map((p) => [String(p.po_id), p.status ?? '']));
    const inc: Record<string, number> = {};
    const poSets: Record<string, Set<string>> = {};
    for (const li of (poiRes.data as { po_id: number; component_id: string | null; quantity: number }[]) ?? []) {
      if (!li.component_id) continue;
      const pid = String(li.po_id);
      (poSets[li.component_id] ??= new Set()).add(pid);
      if (INCOMING_PO_STATUSES.has(poStatus.get(pid) ?? '')) inc[li.component_id] = (inc[li.component_id] ?? 0) + (Number(li.quantity) || 0);
    }
    setIncoming(inc);

    // Expected arrival per item on open POs: stamped ETA, else PO date + the
    // lead time STATED on the PO's supplier quote, else measured history.
    const purchases = (poRes.data ?? []) as unknown as OpenPo[];
    const leadByQuote = new Map(((pqRes.data ?? []) as { quote_id: string | number; estimated_lead_time_days: string | null }[])
      .map((q) => [String(q.quote_id), q.estimated_lead_time_days]));
    const statedByPo = new Map<string, string | null>(
      ((poRes.data ?? []) as unknown as { po_id: string | number; quote_id: string | number | null }[])
        .map((p) => [String(p.po_id), p.quote_id != null ? leadByQuote.get(String(p.quote_id)) ?? null : null]));
    const openLines = ((poiRes.data as { po_id: number; component_id: string | null; quantity: number }[]) ?? [])
      .map((li) => ({ po_id: li.po_id, component_id: li.component_id, quantity: Number(li.quantity) || 0 }));
    const nowIso = new Date().toISOString();
    const etaMap = itemArrivals(openLines, purchases, purchases as unknown as ReceivedPo[], nowIso, statedByPo);
    const etaObj: Record<string, ItemArrival> = {};
    for (const [k, v] of etaMap) etaObj[k] = v;
    setEtaByComp(etaObj);
    const detailMap = itemArrivalDetails(openLines, purchases, purchases as unknown as ReceivedPo[], nowIso, statedByPo);
    const detailObj: Record<string, ArrivalDetail[]> = {};
    for (const [k, v] of detailMap) detailObj[k] = v;
    setEtaDetails(detailObj);

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
  }, [canViewBrand, canSeePo]);

  useEffect(() => { if (canView) fetchAll(); }, [canView, fetchAll]);

  const activeTiers = useMemo(() => [...tiers].filter((tr) => tr.is_active).sort((a, b) => a.sort_order - b.sort_order), [tiers]);
  const ovByKey = useMemo(() => { const m = new Map<string, Override>(); for (const o of overrides) m.set(`${o.component_id}:${o.tier_id}`, o); return m; }, [overrides]);

  // Markup chain: entered price = Tier-1 net; each next tier = prev ÷ (1−step%),
  // rounded up to Rp 1,000 (lib/tierPricing). Overrides re-anchor the chain.
  const tierPrice = useCallback((c: Comp, t: Tier): number | null => {
    return computeTierChain(c.selling_price_idr, activeTiers,
      (tid) => ovByKey.get(`${c.component_id}:${tid}`)?.override_price_idr).get(t.tier_id)?.price ?? null;
  }, [ovByKey, activeTiers]);

  const categories = useMemo(() => [...new Set(comps.map((c) => c.category).filter(Boolean))].sort() as string[], [comps]);
  const brands = useMemo(() => canViewBrand ? [...new Set(comps.map((c) => c.brand).filter(Boolean))].sort() as string[] : [], [comps, canViewBrand]);
  // Sort keys available to this role — brand sort only when brands are visible.
  const sortKeys = useMemo(() => (Object.keys(SORT_LABELS) as SortKey[]).filter((k) => canViewBrand || k !== 'brand'), [canViewBrand]);

  // Click a price → copy a WhatsApp-ready quote in Bahasa Indonesia. This is
  // customer-facing, so it follows the DOCUMENT number/date profile from
  // Settings (Indonesian punctuation is one click away there).
  const copyPrice = useCallback(async (c: Comp, price: number, tier?: string) => {
    const text = buildQuoteMessage([{ name: descOf(c), price, qty: 1, unit: c.unit ?? undefined, tier }]);
    const how = await shareOrCopy(text);
    flash(how === 'failed' ? 'Gagal menyalin — tekan lama untuk memilih'
      : how === 'shared' ? 'Dibagikan' : 'Harga disalin — siap ditempel');
  }, []);

  // ── WhatsApp quote ────────────────────────────────────────────────────────
  // Off (the normal state): tapping a price copies that one price, as it always
  // did. On: tapping a price collects the item AT THE PRICE TAPPED, so one
  // quote can mix tiers — this item at Tier 1, that one at Tier 2 — without
  // any global "quote at" setting to keep in step.
  const basket = useQuoteBasket();
  const [multi, setMulti] = useState(false);

  const onPrice = useCallback((c: Comp, price: number, tierName?: string, tierKey = '') => {
    if (!multi) { copyPrice(c, price, tierName); return; }
    const what = basket.tap({
      id: c.component_id, name: descOf(c), price, qty: 1,
      unit: c.unit ?? undefined, tier: tierName, tierKey,
    });
    const at = tierName ?? 'Sell price';
    flash(what === 'removed' ? 'Dihapus dari penawaran'
      : what === 'repriced' ? `Diubah ke ${at}`
      : `Ditambahkan · ${at}`);
  }, [multi, basket, copyPrice]);

  // Is this product in the list at exactly this price?
  const pickedAt = useCallback((c: Comp, tierKey = '') =>
    basket.has(c.component_id) && (basket.tierOf(c.component_id) ?? '') === tierKey, [basket]);

  // Quantity sold per product inside the period in force
  const soldInRange = useMemo(() => {
    const m: Record<string, number> = {};
    for (const l of soldLines) if (inRange(l.date, range)) m[l.cid] = (m[l.cid] ?? 0) + l.qty;
    return m;
  }, [soldLines, range]);

  const rows: Row[] = useMemo(() => {
    const q = search.trim().toLowerCase();
    const cutoff = arrivalCutoffIso(newArrivalDays);
    const list = comps
      .map((c) => {
        const phys = physical[c.component_id] ?? 0;
        const rsv = reserved[c.component_id] ?? 0;
        return { c, phys, rsv, live: phys - rsv, inc: incoming[c.component_id] ?? 0, eta: etaByComp[c.component_id] ?? null, activity: activityByComp[c.component_id] ?? 0, sold: soldInRange[c.component_id] ?? 0 };
      })
      .filter(({ c, phys, inc }) => {
        if (filterCategory && c.category !== filterCategory) return false;
        if (filterBrand && c.brand !== filterBrand) return false;
        if (pricedOnly && !(Number(c.selling_price_idr) > 0)) return false;
        if (stockOnly && phys <= 0 && inc <= 0) return false;
        if (justArrived && (arrivals[c.component_id]?.last ?? '') < cutoff) return false;
        if (!q) return true;
        return [c.supplier_model, c.internal_description, c.brand, c.category, c.warranty].filter(Boolean).join(' ').toLowerCase().includes(q);
      });

    const { key, dir } = sort;
    const cmpText = (a: string | null, b: string | null) => (a || '').localeCompare(b || '') || 0;
    list.sort((a, b) => {
      let d = 0;
      if (key === 'traded') d = a.sold - b.sold;
      else if (key === 'activity') d = a.activity - b.activity;
      else if (key === 'updated') d = (a.c.updated_at || '').localeCompare(b.c.updated_at || '');
      else if (key === 'price') d = (a.c.selling_price_idr ?? -1) - (b.c.selling_price_idr ?? -1);
      else if (key === 'stock') d = a.live - b.live;
      else if (key === 'incoming') d = a.inc - b.inc;
      else if (key === 'capacity') d = (Number(a.c.norm_value) || 0) - (Number(b.c.norm_value) || 0);
      else if (key === 'name') d = cmpText(descOf(a.c), descOf(b.c));
      else if (key === 'brand') d = cmpText(a.c.brand, b.c.brand);
      else if (key === 'category') d = cmpText(a.c.category, b.c.category);
      else if (key === 'warranty') d = wtyDays(a.c) - wtyDays(b.c);
      else if (key === 'sheet') d = (a.c.datasheet_url ? 1 : 0) - (b.c.datasheet_url ? 1 : 0);
      d *= dir;
      // Stable tie-breaks: activity desc, then recency desc, then name.
      if (d !== 0) return d;
      return (b.activity - a.activity)
        || (b.c.updated_at || '').localeCompare(a.c.updated_at || '')
        || (a.c.supplier_model || '').localeCompare(b.c.supplier_model || '');
    });
    return list;
  }, [comps, physical, reserved, incoming, etaByComp, activityByComp, soldInRange, search, filterCategory, filterBrand, pricedOnly, stockOnly, justArrived, arrivals, sort]);

  const toggleSort = (key: SortKey) => {
    listTouched.current = true;
    setSort((s) => (s.key === key ? { key, dir: (s.dir * -1) as 1 | -1 } : { key, dir: DEFAULT_DIR[key] }));
  };

  const hasFilters = !!(search.trim() || filterCategory || filterBrand || stockOnly || justArrived);

  async function saveMeta(componentId: string, patch: Partial<Pick<Comp, 'warranty' | 'datasheet_url' | 'warranty_value' | 'warranty_unit' | 'perf_warranty_value' | 'perf_warranty_unit'>>) {
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
      r.c.selling_price_idr ?? '', warrantyLabel(r.c) ?? '',
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
    <div className="min-h-screen bg-chrome text-slate-200 font-sans text-sm">
      <div className="border-b border-slate-800/60 bg-chrome/80 backdrop-blur-md sticky top-0 z-30">
        {/* Phones: wordmark row then actions row — side-by-side squeezes the
            buttons into the wordmark. sm+ keeps the single row. */}
        <div className="max-w-[1600px] 2xl:max-w-[2120px] mx-auto px-3 sm:px-4 md:px-6 py-3 sm:py-4 flex flex-col sm:flex-row sm:items-center justify-between sm:flex-wrap gap-2.5 sm:gap-4">
          <BrandMenu wordmarkClass="text-xl md:text-2xl font-extrabold" subtitle="Products · Sell-side catalog" />
          <div className="flex items-center gap-2 flex-wrap">
            {canExport && (
              <button onClick={exportCsv}
                title={t('Download the filtered list as CSV (opens in Excel)')}
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
            {canImport && (
              <Link href="/pricing" className="hidden sm:block text-xs text-slate-400 hover:text-white px-3 py-1.5 border border-slate-700 rounded-lg hover:bg-slate-800 transition-colors whitespace-nowrap"
                title={t('Manage price tiers, margin floors and per-item overrides')}>
                Tiers &amp; floors →
              </Link>
            )}
            <Link href="/purchasing" className="hidden sm:block text-xs text-slate-400 hover:text-white px-3 py-1.5 border border-slate-700 rounded-lg hover:bg-slate-800 transition-colors whitespace-nowrap"
              title={t('Prices are set in Purchasing › Items (the Item Editor) — Sell Price column → Tiers')}>
              Set pricing in Items →
            </Link>
          </div>
        </div>
      </div>

      <main className="max-w-[1600px] 2xl:max-w-[2120px] mx-auto px-3 sm:px-4 md:px-6 py-6 space-y-4">
        {/* Search + filters */}
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative flex-1 min-w-[200px]">
            <svg className="w-4 h-4 text-slate-500 absolute left-3.5 top-1/2 -translate-y-1/2" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M21 21l-4.35-4.35M17 11a6 6 0 11-12 0 6 6 0 0112 0z" /></svg>
            <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder={canViewBrand ? 'Search model, description, brand, category…' : 'Search description, category…'}
              className="w-full pl-10 pr-4 h-11 rounded-xl bg-slate-900/80 border border-slate-700/80 focus:border-emerald-500/60 outline-none text-white text-base sm:text-sm placeholder:text-[13px] sm:placeholder:text-sm placeholder:text-slate-500 transition-colors" />
          </div>
          <select value={filterCategory} onChange={(e) => setFilterCategory(e.target.value)} className={selCls}>
            <option value="">{t('All categories')}</option>
            {categories.map((c) => <option key={c} value={c}>{humanize(c)}</option>)}
          </select>
          {canViewBrand && (
            <select value={filterBrand} onChange={(e) => setFilterBrand(e.target.value)} className={selCls}>
              <option value="">{t('All brands')}</option>
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
          <label className="flex items-center gap-2 text-xs text-slate-400 cursor-pointer select-none whitespace-nowrap"
            title={t('Only items with a sell price set — the default view; untick to include unpriced items')}>
            <input type="checkbox" checked={pricedOnly} onChange={(e) => setPricedOnly(e.target.checked)} className="accent-emerald-500 w-4 h-4" />
            Priced
          </label>
          <label className="flex items-center gap-2 text-xs text-slate-400 cursor-pointer select-none whitespace-nowrap">
            <input type="checkbox" checked={stockOnly} onChange={(e) => setStockOnly(e.target.checked)} className="accent-emerald-500 w-4 h-4" />
            In stock / incoming
          </label>
          <label className="flex items-center gap-2 text-xs text-slate-400 cursor-pointer select-none whitespace-nowrap"
            title={`Items whose goods receipt landed in the last ${newArrivalDays} days — new products and fresh stock`}>
            <input type="checkbox" checked={justArrived} onChange={(e) => setJustArrived(e.target.checked)} className="accent-sky-500 w-4 h-4" />
            Just arrived
          </label>
          {hasFilters && (
            <button onClick={() => { setSearch(''); setFilterCategory(''); setFilterBrand(''); setStockOnly(false); setJustArrived(false); setPricedOnly(true); }}
              className="text-[11px] text-slate-500 hover:text-white px-2 py-1 transition-colors">{t('Clear ×')}</button>
          )}
          <span className="text-xs text-slate-600 tabular-nums ml-auto">{rows.length} of {comps.length}</span>
          {/* "Text quote", not "Quote" — this builds a WhatsApp MESSAGE, it
              never creates a Sales Quotation document (owner, 2026-08-06). */}
          <button onClick={() => setMulti((m) => !m)}
            title={multi
              ? 'Tapping a price adds the item to the WhatsApp text quote at that price. Tap again to remove, tap another tier to move it. This never creates a Sales Quotation document.'
              : 'Collect several products into one WhatsApp text message — no Sales Quotation document is created'}
            className={`text-[11px] font-semibold px-2.5 py-1 rounded-lg border transition-colors whitespace-nowrap ${
              multi ? 'bg-emerald-500/15 border-emerald-500/40 text-emerald-300' : 'border-slate-700 text-slate-400 hover:text-white hover:bg-slate-800'
            }`}>
            {multi ? `Text quote mode · ${basket.items.length}` : 'Text quote mode'}
          </button>
          <DateRangeFilter value={range} onChange={(r) => { listTouched.current = true; setRange(r); }} label="Order date" />
          <LayoutToggle value={layout} onChange={setLayout} />
          {/* Column picker (desktop table only). Owner-hidden columns are not
              offered at all — a personal toggle can never reveal them. */}
          <div className="relative hidden md:block">
            <button onClick={() => setColsOpen((v) => !v)}
              className="px-2.5 py-1.5 rounded-lg border border-slate-800 bg-slate-900/60 text-[11px] font-medium text-slate-400 hover:text-slate-200 transition-colors"
              title={t('Choose which columns the table shows')}>
              ▦ Columns
            </button>
            {colsOpen && (
              <>
                <div className="fixed inset-0 z-30" onClick={() => setColsOpen(false)} />
                <div className="absolute right-0 top-full mt-1 z-40 w-48 rounded-xl border border-slate-700 bg-deep shadow-2xl p-2">
                  {PRODUCT_COLS.filter((c) => colOffered(c.key)).map((c) => (
                    <label key={c.key} className="flex items-center gap-2 px-2 py-1.5 rounded-lg hover:bg-white/5 cursor-pointer text-xs text-slate-300">
                      <input type="checkbox" checked={!userHiddenCols.has(c.key)} onChange={() => toggleCol(c.key)}
                        className="accent-emerald-500" />
                      {c.label}
                    </label>
                  ))}
                  {settings.productHiddenColumns.length > 0 && (
                    <p className="px-2 pt-1.5 mt-1 border-t border-slate-800 text-[10px] text-slate-600">
                      {settings.productHiddenColumns.length} column{settings.productHiddenColumns.length !== 1 ? 's' : ''} hidden for everyone in Settings › Lists.
                    </p>
                  )}
                </div>
              </>
            )}
          </div>
        </div>

        <p className="hidden md:block text-[11px] text-slate-600">
          Stock reads <span className="text-slate-400">{t('Live/Physical')}</span> — e.g. 100/150 means 150 in the warehouse, 100 still free to sell (50 reserved on confirmed orders).{' '}
          <span className="text-slate-400">{t('Incoming')}</span> = on POs not yet fully received. Click a row for tier prices + last orders &amp; deliveries.
        </p>

        {/* ── Desktop table ── */}
        <div className="hidden md:block bg-slate-900/40 border border-slate-800/80 rounded-2xl overflow-x-auto">
          <table className={`w-full min-w-[1000px] ${compact ? 'dense-rows' : ''}`}>
            <thead>
              {/* bg-chrome on the ROW, not only the sticky cell — the sticky
                  Description header needs an opaque background to cover
                  horizontally-scrolled content, and an opaque patch on a
                  translucent row read as a different colour (2026-08-14 fix). */}
              <tr className="border-b border-slate-800 text-[10px] uppercase tracking-widest text-slate-500 bg-chrome">
                {/* Sticky: the item name stays anchored while the numeric
                    columns scroll horizontally, so a row never loses its label.
                    Every column sorts — click toggles ▲/▼. */}
                <Th label="Description" active={sort.key === 'name'} dir={sort.dir} onClick={() => toggleSort('name')} className="px-4 sticky left-0 z-20 bg-chrome"
                  resizer={
                    <span onMouseDown={startDescResize} onDoubleClick={resetDescWidth}
                      title={t('Drag to set the Description width — double-click to reset')}
                      className="absolute right-0 top-0 bottom-0 w-2.5 cursor-col-resize group/rsz flex items-center justify-center select-none">
                      <span className={`w-px h-4 transition-colors ${descW != null ? 'bg-emerald-500/50' : 'bg-slate-700'} group-hover/rsz:bg-emerald-400`} />
                    </span>
                  } />
                {colShown('price') && <Th label="Sell Price" right active={sort.key === 'price'} dir={sort.dir} onClick={() => toggleSort('price')} />}
                {colShown('stock') && <Th label="Stock" right active={sort.key === 'stock'} dir={sort.dir} onClick={() => toggleSort('stock')} hint="Live/Physical" />}
                {colShown('incoming') && <Th label="Incoming" right active={sort.key === 'incoming'} dir={sort.dir} onClick={() => toggleSort('incoming')} />}
                {colShown('brand') && <Th label="Brand" active={sort.key === 'brand'} dir={sort.dir} onClick={() => toggleSort('brand')} />}
                {colShown('category') && <Th label="Category" active={sort.key === 'category'} dir={sort.dir} onClick={() => toggleSort('category')} />}
                {colShown('capacity') && <Th label="Capacity" right active={sort.key === 'capacity'} dir={sort.dir} onClick={() => toggleSort('capacity')} />}
                {colShown('warranty') && <Th label="Warranty" active={sort.key === 'warranty'} dir={sort.dir} onClick={() => toggleSort('warranty')} tip="Sort by period length — 10 years ranks above 18 months above 90 days" />}
                {colShown('sheet') && <Th label="Sheet" center active={sort.key === 'sheet'} dir={sort.dir} onClick={() => toggleSort('sheet')} tip="Sort by whether the item has a datasheet" />}
                {colShown('updated') && <Th label="Updated" right active={sort.key === 'updated'} dir={sort.dir} onClick={() => toggleSort('updated')} />}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800/60">
              {loading ? (
                [...Array(8)].map((_, i) => <tr key={i}><td colSpan={visibleColCount} className="px-4 py-2"><div className="h-9 bg-slate-800/40 rounded-lg animate-pulse" /></td></tr>)
              ) : rows.length === 0 ? (
                <tr><td colSpan={visibleColCount} className="px-4 py-12 text-center text-slate-600 text-sm">{t('No products match.')}</td></tr>
              ) : rows.map((r) => (
                <Fragment key={r.c.component_id}>
                  <tr onClick={() => setExpanded((e) => (e === r.c.component_id ? null : r.c.component_id))}
                    className={`cursor-pointer transition-colors ${expanded === r.c.component_id ? 'bg-raised' : 'bg-chrome hover:bg-rail'}`}>
                    <td className="px-4 py-2 sticky left-0 z-10 bg-inherit">
                      <span className="flex items-center gap-1.5">
                        {/* Grow the name with the viewport — a wide monitor
                            shows the whole description; it only truncates when
                            the row would otherwise overflow. Floor keeps mid
                            screens sane, ceiling stops an absurd column on 4K. */}
                        <span className={`text-sm text-slate-100 font-medium truncate ${descW == null ? 'max-w-[clamp(20rem,42vw,64rem)]' : ''}`}
                          style={descW != null ? { maxWidth: descW } : undefined}>{descOf(r.c)}</span>
                        <ArrivalTag days={newArrivalDays} a={arrivals[r.c.component_id]} />
                        <SupersededTag succId={successors.get(r.c.component_id)} comps={comps} canHub={canHub} />
                        {r.activity > 0 && <span className="px-1 py-0.5 rounded bg-slate-800 text-[9px] text-slate-500 tabular-nums flex-shrink-0" title={`${r.activity} POs / quotes / orders`}>{r.activity}</span>}
                        {canHub && (
                          <Link href={`/items/${r.c.component_id}`} onClick={(e) => e.stopPropagation()}
                            title={t('Open the item hub — buy, sell, stock, specs on one page')}
                            className="p-1 -m-0.5 text-slate-600 hover:text-emerald-300 transition-colors flex-shrink-0">
                            <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2"><path strokeLinecap="round" strokeLinejoin="round" d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" /></svg>
                          </Link>
                        )}
                      </span>
                    </td>
                    {colShown('price') && <td className="px-3 py-2 text-right whitespace-nowrap">
                      {r.c.selling_price_idr ? (
                        <button onClick={(e) => { e.stopPropagation(); onPrice(r.c, r.c.selling_price_idr!); }}
                          title={multi ? 'Click to add at this price' : 'Click to copy this price (excl. PPN) for WhatsApp'}
                          className={`block ml-auto tabular-nums text-sm transition-colors ${
                            pickedAt(r.c) ? 'text-emerald-300 font-semibold' : 'text-slate-200 hover:text-emerald-300'
                          }`}>
                          {pickedAt(r.c) && '✓ '}{fmtRupiah(r.c.selling_price_idr)}
                        </button>
                      ) : <span className="block tabular-nums text-sm text-slate-700">—</span>}
                      {activeTiers.length > 0 && r.c.selling_price_idr ? (
                        <span className="block text-[10px] text-slate-500 tabular-nums">{activeTiers.length} tier{activeTiers.length > 1 ? 's' : ''} ▾</span>
                      ) : null}
                    </td>}
                    {colShown('stock') && <td className="px-3 py-2 text-right whitespace-nowrap">
                      <StockCell live={r.live} phys={r.phys} unit={r.c.unit} />
                    </td>}
                    {colShown('incoming') && <td className="px-3 py-2 text-right tabular-nums text-sky-300/80">
                      {r.inc ? <IncomingCell qty={r.inc} unit={r.c.unit} details={etaDetails[r.c.component_id] ?? []} showPo={canSeePo} /> : <span className="text-slate-700">0</span>}
                    </td>}
                    {colShown('brand') && <td className="px-3 py-2 text-xs text-slate-400 whitespace-nowrap">{r.c.brand || '—'}</td>}
                    {colShown('category') && <td className="px-3 py-2 text-xs text-slate-500 whitespace-nowrap">{r.c.category ? humanize(r.c.category) : '—'}</td>}
                    {colShown('capacity') && <td className="px-3 py-2 text-right tabular-nums text-xs text-slate-400">{r.c.norm_value != null && Number(r.c.norm_value) !== 0 ? Number(r.c.norm_value).toLocaleString('en-US') : '—'}</td>}
                    {colShown('warranty') && <td className="px-3 py-2 text-xs text-slate-400 whitespace-nowrap">
                      {warrantyLabel(r.c) || <span className="text-slate-700">—</span>}
                      {fmtWarranty(r.c.perf_warranty_value, r.c.perf_warranty_unit) && (
                        <span className="text-slate-600" title={t('Performance warranty — PV output guarantee')}> · perf {fmtWarranty(r.c.perf_warranty_value, r.c.perf_warranty_unit)}</span>
                      )}
                    </td>}
                    {colShown('sheet') && <td className="px-3 py-2 text-center">
                      {r.c.datasheet_url ? (
                        <a href={r.c.datasheet_url} target="_blank" rel="noopener noreferrer" onClick={(e) => e.stopPropagation()}
                          title={t('Open datasheet')} className="inline-flex text-sky-400 hover:text-sky-300 transition-colors">
                          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2"><path strokeLinecap="round" strokeLinejoin="round" d="M13.828 10.172a4 4 0 010 5.656l-4 4a4 4 0 01-5.656-5.656l1.1-1.1m9.556-3.9l1.1-1.1a4 4 0 10-5.656-5.656l-4 4a4 4 0 000 5.656" /></svg>
                        </a>
                      ) : <span className="text-slate-700">—</span>}
                    </td>}
                    {colShown('updated') && <td className="px-3 py-2 text-right text-[11px] text-slate-500 tabular-nums whitespace-nowrap">{fmtDay(r.c.updated_at)}</td>}
                  </tr>
                  {expanded === r.c.component_id && (
                    <tr>
                      <td colSpan={visibleColCount} className="px-4 pb-4 pt-1 bg-slate-950/40">
                        <ProductDetail row={r} activeTiers={activeTiers} tierPrice={tierPrice} canHub={canHub}
                          orders={ordersByComp[r.c.component_id] ?? []} deliveries={deliveriesByComp[r.c.component_id] ?? []}
                          canEditMeta={canEditMeta} onSaveMeta={(patch) => saveMeta(r.c.component_id, patch)}
                          onPrice={onPrice} multi={multi} pickedAt={pickedAt} />
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
            <p className="px-4 py-12 text-center text-slate-600 text-sm">{t('No products match.')}</p>
          ) : rows.map((r) => {
            const open = expanded === r.c.component_id;
            return (
              <div key={r.c.component_id} className={`bg-slate-900/40 border rounded-xl transition-colors ${open ? 'border-emerald-500/30' : 'border-slate-800/80'}`}>
                {/* Compact = the essentials on two tight lines (name, then
                    stock + list price); card mode keeps brand/category and the
                    full tier-price chips. */}
                <button onClick={() => setExpanded(open ? null : r.c.component_id)} className={`w-full text-left ${compact ? 'px-3 py-2' : 'px-3.5 py-3'}`}>
                  <div className="flex items-start gap-2">
                    <div className="min-w-0 flex-1">
                      <p className="text-sm text-slate-100 font-medium truncate flex items-center gap-1.5">
                        <span className="truncate">{descOf(r.c)}</span>
                        <ArrivalTag days={newArrivalDays} a={arrivals[r.c.component_id]} />
                      </p>
                      {!compact && (
                        <p className="text-[11px] text-slate-500 truncate">
                          {[r.c.brand, r.c.category ? humanize(r.c.category) : '', r.c.norm_value ? Number(r.c.norm_value).toLocaleString('en-US') : ''].filter(Boolean).join(' · ') || '—'}
                        </p>
                      )}
                    </div>
                    {canHub && (
                      <Link href={`/items/${r.c.component_id}`} onClick={(e) => e.stopPropagation()}
                        className="p-1.5 -m-0.5 text-slate-600 active:text-emerald-300 flex-shrink-0" title={t('Open the item hub')}>
                        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2"><path strokeLinecap="round" strokeLinejoin="round" d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" /></svg>
                      </Link>
                    )}
                    {r.c.datasheet_url && (
                      <a href={r.c.datasheet_url} target="_blank" rel="noopener noreferrer" onClick={(e) => e.stopPropagation()}
                        className="p-1.5 -m-0.5 text-sky-400 flex-shrink-0" title={t('Datasheet')}>
                        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2"><path strokeLinecap="round" strokeLinejoin="round" d="M13.828 10.172a4 4 0 010 5.656l-4 4a4 4 0 01-5.656-5.656l1.1-1.1m9.556-3.9l1.1-1.1a4 4 0 10-5.656-5.656l-4 4a4 4 0 000 5.656" /></svg>
                      </a>
                    )}
                  </div>
                  {/* Highlights: stock (Live colored / Physical muted) + tap-to-copy prices */}
                  <div className={`flex flex-wrap items-center gap-1.5 ${compact ? 'mt-1.5' : 'mt-2'}`}>
                    <span className="px-2 py-1 rounded-lg bg-slate-800/80 text-[11px] font-bold tabular-nums">
                      <span className={r.live > 0 ? 'text-emerald-300' : r.live < 0 ? 'text-red-300' : 'text-slate-500'}>{fmtInt(r.live)}</span>
                      <span className="text-slate-500">/{fmtInt(r.phys)}</span>
                      {r.c.unit && <span className="text-slate-600 font-normal"> {r.c.unit}</span>}
                    </span>
                    {r.inc > 0 && <span className="px-2 py-1 rounded-lg bg-sky-500/10 text-sky-300 text-[11px] tabular-nums">+{fmtInt(r.inc)} incoming</span>}
                    {r.eta?.nearest && (r.eta.overdue ? (
                      <span className="px-2 py-1 rounded-lg bg-amber-500/15 text-amber-300 text-[11px] tabular-nums"
                        title={`Expected ${fmtDate(r.eta.nearest)} · ${r.eta.source === 'lead' ? 'estimated from measured lead time' : 'supplier ETA'} · past due, not yet received`}>
                        ⚠ {Math.max(1, Math.round((Date.now() - Date.parse(`${r.eta.nearest}T00:00:00Z`)) / 86_400_000))}d late
                      </span>
                    ) : (
                      <span className="px-2 py-1 rounded-lg bg-slate-800/60 text-slate-400 text-[11px]"
                        title={r.eta.source === 'lead' ? 'Estimated from this supplier’s measured lead time' : 'Supplier ETA'}>
                        ETA {fmtDate(r.eta.nearest)}
                      </span>
                    ))}
                    {r.c.selling_price_idr ? (
                      <span role="button" tabIndex={0} onClick={(e) => { e.stopPropagation(); onPrice(r.c, r.c.selling_price_idr!); }}
                        title={multi ? 'Tap to add at this price' : 'Tap to copy this price for WhatsApp'}
                        className={`px-2 py-1 rounded-lg text-[11px] font-semibold tabular-nums transition-colors ${
                          pickedAt(r.c) ? 'bg-emerald-500/20 text-emerald-300 ring-1 ring-emerald-500/40' : 'bg-slate-800 text-slate-200 active:text-emerald-300'
                        }`}>
                        {pickedAt(r.c) && '✓ '}{fmtRupiah(r.c.selling_price_idr)}
                      </span>
                    ) : null}
                    {compact ? null : activeTiers.map((tier) => {
                      const p = tierPrice(r.c, tier);
                      return p != null ? (
                        <span key={tier.tier_id} role="button" tabIndex={0}
                          onClick={(e) => { e.stopPropagation(); onPrice(r.c, p, tier.name, tier.tier_id); }}
                          title={multi ? `Tap to add at ${tier.name}` : `Tap to copy ${tier.name} price for WhatsApp`}
                          className={`px-2 py-1 rounded-lg text-[11px] tabular-nums transition-colors ${
                            pickedAt(r.c, tier.tier_id)
                              ? 'bg-emerald-500/20 text-emerald-300 ring-1 ring-emerald-500/40'
                              : 'bg-slate-800/60 text-slate-400 active:text-emerald-300'
                          }`}>
                          {pickedAt(r.c, tier.tier_id) && '✓ '}{tier.name} <span className="text-slate-200 font-semibold">{fmtRupiah(p)}</span>
                        </span>
                      ) : null;
                    })}
                    {!compact && warrantyLabel(r.c) && <span className="px-2 py-1 rounded-lg bg-slate-800/60 text-[11px] text-slate-400">Warranty {warrantyLabel(r.c)}{fmtWarranty(r.c.perf_warranty_value, r.c.perf_warranty_unit) ? ` · perf ${fmtWarranty(r.c.perf_warranty_value, r.c.perf_warranty_unit)}` : ''}</span>}
                    <SupersededTag succId={successors.get(r.c.component_id)} comps={comps} canHub={canHub} />
                  </div>
                </button>
                {open && (
                  <div className="px-3.5 pb-3.5">
                    <ProductDetail row={r} activeTiers={activeTiers} tierPrice={tierPrice} canHub={canHub}
                      orders={ordersByComp[r.c.component_id] ?? []} deliveries={deliveriesByComp[r.c.component_id] ?? []}
                      canEditMeta={canEditMeta} onSaveMeta={(patch) => saveMeta(r.c.component_id, patch)}
                          onPrice={onPrice} multi={multi} pickedAt={pickedAt} />
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
              <h3 className="text-sm font-bold text-white">{t('Import products — preview')}</h3>
              <p className="text-[11px] text-slate-500 mt-0.5">
                {importPreview.updates.length} update{importPreview.updates.length !== 1 ? 's' : ''} · {importPreview.creates.length} new product{importPreview.creates.length !== 1 ? 's' : ''}
                {importPreview.skipped.length ? ` · ${importPreview.skipped.length} skipped (no id/model/description)` : ''}
              </p>
            </div>
            <div className="flex-1 overflow-y-auto px-5 py-3 space-y-3 text-xs">
              {importPreview.updates.length > 0 && (
                <div>
                  <p className="text-[10px] uppercase tracking-wider text-slate-500 mb-1">{t('Updates')}</p>
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
                  <p className="text-[10px] uppercase tracking-wider text-slate-500 mb-1">{t('New products')}</p>
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
                className="px-3 py-1.5 rounded-lg text-xs text-slate-400 hover:text-white hover:bg-white/10 border border-white/[0.06] transition-all">{t('Cancel')}</button>
              <button onClick={applyImport} disabled={importBusy}
                className="px-4 py-1.5 rounded-lg text-xs font-bold bg-emerald-600 hover:bg-emerald-500 text-white transition-colors disabled:opacity-50">
                {importBusy ? 'Importing…' : `Apply ${importPreview.updates.length + importPreview.creates.length} rows`}
              </button>
            </div>
          </div>
        </div>
      )}
      <QuoteBasket items={basket.items} onSetQty={basket.setQty} onRemove={basket.remove} onClear={basket.clear} flash={flash} />
      {toast && <div className="fixed bottom-6 right-6 z-[110] px-4 py-2.5 bg-slate-800 border border-slate-700 text-white text-sm font-semibold rounded-xl shadow-lg">{toast}</div>}
    </div>
  );
}

// ── Pieces ──────────────────────────────────────────────────────────────────
const selCls = 'h-11 px-3 rounded-xl bg-slate-900/80 border border-slate-700/80 focus:border-emerald-500/60 outline-none text-slate-300 text-xs transition-colors cursor-pointer';

function CenterSpinner() {
  return <div className="min-h-screen bg-chrome flex items-center justify-center"><div className="w-6 h-6 border-2 border-emerald-500/30 border-t-emerald-500 rounded-full animate-spin" /></div>;
}

/** A sortable column header. `hint` prints a small second line under the
 *  label (only where the values genuinely need explaining); `tip` is a
 *  tooltip-only note. align-top keeps every label on ONE baseline — without
 *  it, a cell carrying a hint centres its two lines and floats its label
 *  above the single-line headers beside it. */
function Th({ label, hint, tip, right, center, active, dir, onClick, className, resizer }: { label: string; hint?: string; tip?: string; right?: boolean; center?: boolean; active: boolean; dir: 1 | -1; onClick: () => void; className?: string; resizer?: React.ReactNode }) {
  return (
    <th className={`font-semibold py-2.5 align-top ${resizer ? 'relative' : ''} ${right ? 'text-right' : center ? 'text-center' : 'text-left'} ${className ?? 'px-3'}`}>
      <button onClick={onClick} className={`inline-flex items-center gap-1 uppercase tracking-widest leading-none transition-colors ${active ? 'text-emerald-400' : 'hover:text-slate-300'}`} title={tip ?? hint}>
        {label}
        <span className="text-[8px]">{active ? (dir === 1 ? '▲' : '▼') : '↕'}</span>
      </button>
      {hint && <span className="block normal-case tracking-normal text-[9px] text-slate-600 font-normal mt-1 leading-none">{hint}</span>}
      {resizer}
    </th>
  );
}

/** The Incoming figure with a hover breakdown: each open PO, its quantity, and
 *  when it should land — the stamped ETA, else PO date + the lead time stated
 *  on the supplier quote, else the supplier's measured history.
 *  `showPo` gates the PO numbers: buy-side eyes only — a sales login sees
 *  "Shipment 1/2/…" (buy-document numbers are not sell-side data). */
function IncomingCell({ qty, unit, details, showPo }: { qty: number; unit: string | null; details: ArrivalDetail[]; showPo: boolean }) {
  const { t } = useT();
  const srcLabel = (d: ArrivalDetail) =>
    d.source === 'eta' ? 'supplier ETA'
    : d.source === 'stated' ? `ordered ${fmtDate(d.poDate)} + ${d.leadDays} working day${d.leadDays !== 1 ? 's' : ''} quoted lead`
    : d.source === 'lead' ? `ordered ${fmtDate(d.poDate)} + ~${d.leadDays}d measured lead`
    : 'order carries no date';
  return (
    <span className="relative group/inc inline-block cursor-help">
      <span className={details.some((d) => d.overdue) ? 'text-amber-300' : undefined}>{fmtInt(qty)}</span>
      {details.length > 0 && (
        <span className="pointer-events-none absolute right-0 top-full mt-1 z-30 hidden group-hover/inc:block w-[260px] rounded-xl border border-slate-700 bg-deep shadow-2xl p-3 text-left">
          <span className="block text-[10px] font-bold uppercase tracking-widest text-slate-500 mb-2">{t('Expected arrival')}</span>
          <span className="block space-y-2">
            {details.map((d, i) => (
              <span key={`${d.po_id}-${i}`} className="block">
                <span className="flex items-baseline justify-between gap-2">
                  <span className={`text-[11px] ${showPo ? 'font-mono' : ''} text-slate-300 truncate`}>
                    {showPo ? (d.po_number || 'PO') : `Shipment ${i + 1}`}
                    <span className="text-slate-500 font-sans"> · {fmtInt(d.qty)}{unit ? ` ${unit}` : ''}</span>
                  </span>
                  {d.expected ? (
                    <span className={`text-[11px] font-semibold tabular-nums whitespace-nowrap ${d.overdue ? 'text-amber-300' : 'text-sky-300'}`}>
                      {fmtDate(d.expected)}{d.overdue ? ' · late' : ''}
                    </span>
                  ) : <span className="text-[11px] text-slate-500">{t('no date')}</span>}
                </span>
                <span className="block text-[10px] text-slate-600 leading-snug">{srcLabel(d)}</span>
              </span>
            ))}
          </span>
        </span>
      )}
    </span>
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

function ProductDetail({ row, activeTiers, tierPrice, orders, deliveries, canEditMeta, onSaveMeta, onPrice, multi, pickedAt, canHub }: {
  row: Row;
  activeTiers: Tier[];
  tierPrice: (c: Comp, t: Tier) => number | null;
  orders: DocRef[];
  deliveries: DocRef[];
  canEditMeta: boolean;
  onSaveMeta: (patch: Partial<Pick<Comp, 'warranty' | 'datasheet_url' | 'warranty_value' | 'warranty_unit' | 'perf_warranty_value' | 'perf_warranty_unit'>>) => void;
  onPrice: (c: Comp, price: number, tierName?: string, tierKey?: string) => void;
  multi: boolean;
  pickedAt: (c: Comp, tierKey?: string) => boolean;
  canHub: boolean;
}) {
  const { t } = useT();
  const { c, rsv } = row;
  // Structured warranty (After Sales runs its clocks on these): value + unit,
  // product and performance each. Saved on blur / unit change.
  const [wv, setWv] = useState(c.warranty_value != null ? String(c.warranty_value) : '');
  const [wu, setWu] = useState(c.warranty_unit ?? 'years');
  const [pv, setPv] = useState(c.perf_warranty_value != null ? String(c.perf_warranty_value) : '');
  const [pu, setPu] = useState(c.perf_warranty_unit ?? 'years');
  const [sheet, setSheet] = useState(c.datasheet_url ?? '');
  const saveWarranty = (patch?: { wu?: string; pu?: string }) => {
    const num = (s: string) => { const n = parseFloat(s); return isFinite(n) && n > 0 ? n : null; };
    const next = {
      warranty_value: num(wv), warranty_unit: patch?.wu ?? wu,
      perf_warranty_value: num(pv), perf_warranty_unit: patch?.pu ?? pu,
    };
    if (next.warranty_value !== (c.warranty_value ?? null) || next.warranty_unit !== (c.warranty_unit ?? 'years')
      || next.perf_warranty_value !== (c.perf_warranty_value ?? null) || next.perf_warranty_unit !== (c.perf_warranty_unit ?? 'years')) {
      onSaveMeta(next);
    }
  };

  return (
    <div className="space-y-3 pt-1">
      {/* Tier price list — click any price to copy it (excl. PPN) for WhatsApp */}
      <div className="flex flex-wrap gap-1.5 items-center">
        <span className="text-[10px] font-semibold uppercase tracking-widest text-slate-600 mr-1 w-full sm:w-auto">
          Price list · tap to {multi ? 'add at that price' : 'copy'}
        </span>
        {c.selling_price_idr ? (
          <button onClick={() => onPrice(c, c.selling_price_idr!)}
            title={multi ? 'Add at the net price' : 'Net price = Tier-1 · copy (excl. PPN) for WhatsApp'}
            className={`px-2.5 py-1 rounded-lg border text-[11px] transition-colors ${
              pickedAt(c) ? 'bg-emerald-500/15 border-emerald-500/40' : 'bg-slate-800/80 border-slate-700 hover:border-emerald-500/40'
            }`}>
            <span className="text-slate-500">{pickedAt(c) ? '✓ Net' : 'Net'}</span> <span className="tabular-nums text-slate-200 font-semibold">{fmtRupiah(c.selling_price_idr)}</span>
          </button>
        ) : (
          <span className="text-[11px] text-slate-600 italic">{t('No net price —')} <Link href="/purchasing" className="text-emerald-400 hover:text-emerald-300">{t('set it in Catalog')}</Link></span>
        )}
        {activeTiers.map((tier) => {
          const p = tierPrice(c, tier);
          if (p == null) return (
            <span key={tier.tier_id} className="px-2.5 py-1 rounded-lg bg-slate-800/60 border border-slate-700 text-[11px]">
              <span className="text-slate-500">{tier.name}</span> <span className="text-slate-600">—</span>
            </span>
          );
          return (
            <button key={tier.tier_id} onClick={() => onPrice(c, p, tier.name, tier.tier_id)}
              title={multi ? `Add at ${tier.name}` : `Copy ${tier.name} price (excl. PPN) for WhatsApp`}
              className={`px-2.5 py-1 rounded-lg border text-[11px] transition-colors ${
                pickedAt(c, tier.tier_id) ? 'bg-emerald-500/15 border-emerald-500/40' : 'bg-slate-800/60 border-slate-700 hover:border-emerald-500/40'
              }`}>
              <span className="text-slate-500">{pickedAt(c, tier.tier_id) ? `✓ ${tier.name}` : tier.name}</span>{' '}
              <span className="tabular-nums text-slate-200 font-semibold">{fmtRupiah(p)}</span>
            </button>
          );
        })}
        {rsv > 0 && <span className="text-[11px] text-amber-300/80 tabular-nums sm:ml-auto">Reserved on orders: {fmtInt(rsv)}</span>}
        {canHub && (
          <Link href={`/items/${c.component_id}`}
            className={`text-[11px] text-slate-500 hover:text-emerald-300 transition-colors whitespace-nowrap ${rsv > 0 ? '' : 'sm:ml-auto'}`}
            title={t('Everything about this item — buy, sell, stock, specs — on one page')}>
            Item hub →
          </Link>
        )}
      </div>

      {/* Warranty + datasheet */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
        <div>
          <label className="block text-[10px] font-medium text-slate-500 mb-0.5">
            Warranty <span className="text-slate-600 normal-case">{t('— product (claimable) · performance (PV output guarantee)')}</span>
          </label>
          {canEditMeta ? (
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
              {([
                { tag: 'Product', v: wv, setV: setWv, u: wu, setU: setWu, key: 'wu' as const, tip: 'Product warranty — the claimable period After Sales judges by' },
                { tag: 'Performance', v: pv, setV: setPv, u: pu, setU: setPu, key: 'pu' as const, tip: 'Performance warranty — PV output guarantee, informational' },
              ]).map(({ tag, v, setV, u, setU, key, tip }) => (
                <span key={tag} className="flex items-center gap-1.5" title={tip}>
                  <span className="text-[10px] text-slate-500 w-[4.6rem]">{tag}</span>
                  <input value={v} inputMode="decimal" onChange={(e) => setV(e.target.value)}
                    onBlur={() => saveWarranty()} placeholder="—"
                    className={`${dInp} !w-16 text-right tabular-nums`} />
                  <select value={u} onChange={(e) => { setU(e.target.value); saveWarranty({ [key]: e.target.value }); }}
                    className={`${dInp} !w-auto cursor-pointer`}>
                    {WARRANTY_UNITS.map((x) => <option key={x.value} value={x.value} className="bg-slate-900">{x.label}</option>)}
                  </select>
                </span>
              ))}
              {!wv && !pv && c.warranty && (
                <span className="text-[10px] text-slate-600 w-full" title={t('Free-text warranty from before the structured fields — retype it into the boxes above')}>
                  legacy note: {c.warranty}
                </span>
              )}
            </div>
          ) : (
            <p className="text-xs text-slate-300 py-1.5">
              {warrantyLabel(c) || <span className="text-slate-600">—</span>}
              {fmtWarranty(c.perf_warranty_value, c.perf_warranty_unit) && (
                <span className="text-slate-500"> · performance {fmtWarranty(c.perf_warranty_value, c.perf_warranty_unit)}</span>
              )}
            </p>
          )}
        </div>
        <div>
          <label className="block text-[10px] font-medium text-slate-500 mb-0.5">{t('Datasheet URL (Drive or web)')}</label>
          {canEditMeta ? (
            <div className="flex gap-1.5">
              <input value={sheet} onChange={(e) => setSheet(e.target.value)}
                onBlur={() => { if (sheet.trim() !== (c.datasheet_url ?? '')) onSaveMeta({ datasheet_url: sheet.trim() }); }}
                placeholder="https://…" className={dInp} />
              {c.datasheet_url && (
                <a href={c.datasheet_url} target="_blank" rel="noopener noreferrer"
                  className="px-3 py-1.5 rounded-lg bg-sky-500/10 text-sky-300 text-xs font-semibold hover:bg-sky-500/20 transition-colors whitespace-nowrap self-start">{t('Open')}</a>
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
        <DocList title={t('Last Customer Orders')} empty="No customer orders yet." refs={orders} accent="text-violet-300" unit={c.unit} />
        <DocList title={t('Last Deliveries')} empty="No deliveries yet." refs={deliveries} accent="text-emerald-300" unit={c.unit} />
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
              <span className={`font-mono flex-shrink-0 ${accent}`}>{r.number}</span>
              <span className="text-slate-400 truncate flex-1">{r.customer || '—'}</span>
              <span className="text-slate-300 tabular-nums flex-shrink-0">{fmtInt(r.qty)}{unit ? ` ${unit}` : ''}</span>
              <span className="text-slate-600 tabular-nums flex-shrink-0">{fmtDay(r.date)}</span>
            </a>
          ))}
        </div>
      )}
    </div>
  );
}
