'use client';
/**
 * ICAPROC — Module 29: The Item hub (/items/[componentId])
 *
 * ONE page per stock item — the pivot of the whole system finally gets a home.
 * Every number here is ASSEMBLED, not recomputed: each tab renders the same
 * engine as the screen that owns the number (computeTUC, tierPricing,
 * warehouses, tradePosition, specSchema). If a figure here disagrees with its
 * source screen, the hub is wrong.
 *
 * OWNER ONLY since 2026-07-30: the hub sits in the Analytics group and the
 * page gates on canViewAnalytics. The per-tab capability gating below is
 * KEPT even though today only the owner passes the door — it means widening
 * access later (e.g. letting sales see the hub minus cost/GP/brand) is a
 * one-line flag flip in constants/roles.ts, not a rebuild:
 *   Buy       buySide            (mirrors /purchasing — TUC, PI/PO history, FX)
 *   Sell      canViewSellingPrice (mirrors /products — tier chain, customers)
 *   Stock     buySide            (mirrors /stock — ledger + per-warehouse cost)
 *   Specs     everyone           (spec blobs carry no brand/model/prices)
 *   Economics canViewEconomics   (mirrors /profitability — GP, Position)
 * Brand / supplier model render only for canViewBrand, exactly like Products.
 */
import { useState, useEffect, useMemo, useCallback } from 'react';
import { createSupabaseClient } from '@/lib/supabase';
import { useAuth } from '@/hooks/useAuth';
import { useRouter, useParams } from 'next/navigation';
import Link from 'next/link';
import { ROLE_PERMISSIONS } from '@/constants/roles';
import BrandMenu from '@/components/ui/BrandMenu';
import SpecRenderer from '@/components/ui/SpecRenderer';
import { PositionDetail } from '@/components/profitability/PositionPanel';
import { formatCategory as humanize } from '@/lib/formatCategory';
import { fmtDay, fmtDate, fmtInt, fmtIdr, fmtCcy, fmtRupiah } from '@/lib/formatters';
import { INCOMING_PO_STATUSES, itemArrivals, type ItemArrival, type OpenPo, type ReceivedPo } from '@/lib/inTransit';
import FitText from '@/components/ui/FitText';
import { useSettings } from '@/hooks/useSettings';
import { COMMITTED_STATUSES as COMMITTED } from '@/lib/salesStatus';
import { fetchDeliveredByQuoteComp } from '@/lib/reservedStock';
import { fetchWarehouses, rollUpOne, warehouseLabel, type Warehouse } from '@/lib/warehouses';
import { computeTierChain } from '@/lib/tierPricing';
import {
  computeTUCMap, fxFromHistory, fxRateOf, fxAgeDays, FX_STALE_DAYS,
  type FxRate, type TUCResult,
} from '@/lib/computeTUC';
import { deriveExchangeRates } from '@/lib/exchangeRates';
import { fetchTradePositions, type PositionRow } from '@/lib/tradePosition';
import { specReadiness, normalizeSpecs } from '@/lib/specSchema';
import ItemCostForensics, { type CompLite } from '@/components/ui/ItemCostForensics';
import PricingIntelligence from '@/components/ui/PricingIntelligence';
import POCashCycle from '@/components/ui/POCashCycle';
import type { PurchaseOrder, PurchaseLineItem, POCost, PriceQuote, PriceQuoteLineItem, ComponentLink, CompetitorPrice } from '@/types/database';
import { successorIdOf } from '@/lib/successors';
import { fmtWarranty, warrantyLabel } from '@/lib/warranty';


interface Comp {
  component_id: string; supplier_model: string; internal_description: string | null;
  brand?: string | null; category: string | null; unit: string | null;
  norm_value: number | null; selling_price_idr: number | null;
  datasheet_url: string | null; warranty: string | null; updated_at: string | null;
  warranty_value: number | null; warranty_unit: string | null;
  perf_warranty_value: number | null; perf_warranty_unit: string | null;
  specifications: Record<string, unknown> | null;
}
interface Balance { location: string; qty_on_hand: number; avg_cost_idr: number | null; updated_at: string | null }
interface Movement {
  movement_id: string; direction: string; quantity: number; unit_cost_idr: number | null;
  source_type: string | null; source_id: string | null; location: string | null;
  moved_at: string | null; notes: string | null; created_by_email: string | null;
}
interface Tier { tier_id: string; tier_code: string; name: string; default_discount_pct: number; margin_floor_pct: number; sort_order: number; is_active: boolean }
interface Override { tier_id: string; override_price_idr: number | null }
interface SalesDoc {
  quote_id: string; status: string; quote_number: string; order_number: string | null; do_number: string | null;
  quote_date: string | null; ordered_at: string | null; delivered_at: string | null; updated_at: string | null;
  customer_id: string | null;
}
interface SaleItem { item_id: string; quote_id: string; quantity: number; unit_price: number; is_section: boolean }
interface Supplier { supplier_id: string; supplier_name: string }

const descOf = (c: Comp) => (c.internal_description && c.internal_description.trim()) || c.supplier_model || '(no description)';
const daysSince = (iso: string | null | undefined): number | null => {
  if (!iso) return null;
  const t = new Date(iso).getTime();
  return isNaN(t) ? null : Math.max(0, Math.floor((Date.now() - t) / 86_400_000));
};

type TabKey = 'overview' | 'buy' | 'sell' | 'pricing' | 'fx' | 'cashcycle' | 'stock' | 'specs' | 'economics';

export default function ItemHubPage() {
  const supabase = createSupabaseClient();
  const router = useRouter();
  const { componentId } = useParams<{ componentId: string }>();
  const { user, profile, loading: authLoading } = useAuth();
  const { slowMoverDays: SLOW_DAYS } = useSettings();

  const perms = profile ? ROLE_PERMISSIONS[profile.role] : null;
  const canOpen = !!perms && perms.canViewAnalytics;
  const canBuy = !!perms && perms.buySide;
  const canSell = !!perms && perms.canViewSellingPrice;
  const canBrand = !!perms && perms.canViewBrand;
  const canFloor = !!perms && perms.canManagePricing;
  const canEcon = !!perms && perms.canViewEconomics;
  const canEditSpecs = !!perms && perms.canEdit;

  useEffect(() => { document.title = 'Item — ICAPROC'; }, []);
  useEffect(() => {
    if (authLoading) return;
    if (!user) { router.replace(`/login?next=${encodeURIComponent(`/items/${componentId}`)}`); return; }
    if (profile && !canOpen) router.replace('/unauthorized');
  }, [authLoading, user, profile, canOpen, router, componentId]);

  const [tab, setTab] = useState<TabKey>('overview');
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);

  // ── Core data (all roles) ──────────────────────────────────────────────────
  const [comp, setComp] = useState<Comp | null>(null);
  const [balances, setBalances] = useState<Balance[]>([]);
  const [movements, setMovements] = useState<Movement[]>([]);
  const [warehouses, setWarehouses] = useState<Warehouse[]>([]);
  const [tiers, setTiers] = useState<Tier[]>([]);
  const [overrides, setOverrides] = useState<Override[]>([]);
  const [salesDocs, setSalesDocs] = useState<Map<string, SalesDoc>>(new Map());
  const [saleItems, setSaleItems] = useState<SaleItem[]>([]);
  const [custNames, setCustNames] = useState<Map<string, string>>(new Map());
  const [deliveredByQuote, setDeliveredByQuote] = useState<Map<string, number>>(new Map());

  // ── Buy-side data (buySide roles only — costs never reach other browsers) ──
  const [pos, setPos] = useState<PurchaseOrder[]>([]);
  const [poItems, setPoItems] = useState<PurchaseLineItem[]>([]);
  const [poCosts, setPoCosts] = useState<POCost[]>([]);
  const [quotes, setQuotes] = useState<PriceQuote[]>([]);
  const [quoteLines, setQuoteLines] = useState<PriceQuoteLineItem[]>([]);
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [componentLinks, setComponentLinks] = useState<ComponentLink[]>([]);
  const [linkedComps, setLinkedComps] = useState<CompLite[]>([]);
  const [competitorPrices, setCompetitorPrices] = useState<CompetitorPrice[]>([]);

  const load = useCallback(async () => {
    setLoading(true);
    // Brand is buy-side sensitive: not selected at all for sell-side roles, so
    // it never reaches the browser (same rule as /products). Cost columns are
    // likewise not SELECTED for roles that may not see them — a hidden column
    // still reaching the network tab is the /products leak all over again.
    // canFloor (sell_admin) gets the balance average: /pricing already shows
    // margin vs landed cost to that role; per-movement cost stays buy-side.
    const canCost = canBuy || canFloor;
    const compCols = `component_id, supplier_model, internal_description, category, unit, norm_value,
      selling_price_idr, datasheet_url, warranty, warranty_value, warranty_unit, perf_warranty_value, perf_warranty_unit, updated_at, specifications${canBrand ? ', brand' : ''}`;
    const [compRes, balRes, movRes, whs, tierRes, ovRes, sqRes, sqiRes, custRes, delivered] = await Promise.all([
      supabase.from('3.0_components').select(compCols).eq('component_id', componentId).maybeSingle(),
      supabase.from('30.1_stock_balances').select(`location, qty_on_hand, updated_at${canCost ? ', avg_cost_idr' : ''}`).eq('component_id', componentId),
      supabase.from('30.0_stock_movements').select(`movement_id, direction, quantity, source_type, source_id, location, moved_at, notes, created_by_email${canBuy ? ', unit_cost_idr' : ''}`)
        .eq('component_id', componentId).order('moved_at', { ascending: false }).limit(2000),
      fetchWarehouses(supabase),
      supabase.from('21.0_price_tiers').select('tier_id, tier_code, name, default_discount_pct, margin_floor_pct, sort_order, is_active').order('sort_order'),
      supabase.from('21.1_item_tier_prices').select('tier_id, override_price_idr').eq('component_id', componentId),
      supabase.from('22.0_sales_quotes').select('quote_id, status, quote_number, order_number, do_number, quote_date, ordered_at, delivered_at, updated_at, customer_id'),
      supabase.from('22.1_sales_quote_items').select('item_id, quote_id, quantity, unit_price, is_section').eq('component_id', componentId),
      supabase.from('20.0_customers').select('customer_id, display_name, legal_name'),
      fetchDeliveredByQuoteComp(supabase),
    ]);
    if (!compRes.data) { setNotFound(true); setLoading(false); return; }
    setComp(compRes.data as unknown as Comp);
    setBalances((balRes.data ?? []) as unknown as Balance[]);
    setMovements((movRes.data ?? []) as unknown as Movement[]);
    setWarehouses(whs);
    setTiers(((tierRes.data ?? []) as Tier[]));
    setOverrides(((ovRes.data ?? []) as Override[]));
    setSalesDocs(new Map((((sqRes.data ?? []) as SalesDoc[])).map((d) => [d.quote_id, d])));
    setSaleItems(((sqiRes.data ?? []) as SaleItem[]).filter((i) => !i.is_section));
    setCustNames(new Map(((custRes.data ?? []) as { customer_id: string; display_name: string; legal_name: string }[])
      .map((c) => [c.customer_id, c.display_name || c.legal_name || ''])));
    setDeliveredByQuote(delivered);

    if (canBuy) {
      // The FULL buy-side dataset, not just this item's rows: TUC needs every
      // line of each PO to compute the line share, and the FX map ranks the
      // newest evidence across the whole business — exactly what /purchasing and
      // /proposals feed the same engines.
      const [poRes, poiRes, costRes, pqRes, pqiRes, supRes, linkRes, compPriceRes] = await Promise.all([
        supabase.from('5.0_purchases').select('po_id, po_number, po_date, status, currency, exchange_rate, total_value, quote_id, supplier_id, pi_number, actual_received_date, estimated_delivery_date'),
        supabase.from('5.1_purchase_line_items').select('po_line_item_id, po_id, component_id, quantity, unit_cost, currency').limit(8000),
        supabase.from('6.0_po_costs').select('cost_id, po_id, cost_category, amount, currency, exchange_rate, payment_date, notes'),
        supabase.from('4.0_price_quotes').select('quote_id, supplier_id, quote_date, pi_number, currency, status'),
        // ALL quote lines, not just this item's: the forensics' linked-item
        // price tags need the comparables' latest quotes too.
        supabase.from('4.1_price_quote_line_items').select('quote_line_id, quote_id, component_id, quantity, unit_price, currency').limit(8000),
        supabase.from('2.0_suppliers').select('supplier_id, supplier_name'),
        supabase.from('8.0_component_links').select('*').or(`component_id_a.eq.${componentId},component_id_b.eq.${componentId}`),
        // The Pricing tab's market band (same data Market Intel maintains)
        supabase.from('7.0_competitor_prices').select('*'),
      ]);
      setPos((poRes.data ?? []) as unknown as PurchaseOrder[]);
      setPoItems((poiRes.data ?? []) as unknown as PurchaseLineItem[]);
      setPoCosts((costRes.data ?? []) as unknown as POCost[]);
      setQuotes((pqRes.data ?? []) as unknown as PriceQuote[]);
      setQuoteLines((pqiRes.data ?? []) as unknown as PriceQuoteLineItem[]);
      setSuppliers((supRes.data ?? []) as Supplier[]);
      setCompetitorPrices((compPriceRes.data ?? []) as unknown as CompetitorPrice[]);
      const links = (linkRes.data ?? []) as unknown as ComponentLink[];
      setComponentLinks(links);
      // Names for the linked/comparable chips — only the ids the links touch
      const otherIds = [...new Set(links.flatMap((l) => [l.component_id_a, l.component_id_b]))].filter((x) => x !== componentId);
      if (otherIds.length) {
        const { data: lc } = await supabase.from('3.0_components')
          .select('component_id, supplier_model, internal_description, category').in('component_id', otherIds);
        setLinkedComps((lc ?? []) as CompLite[]);
      } else {
        setLinkedComps([]);
      }
    }
    setLoading(false);
  }, [componentId, canBuy, canBrand, canFloor]);       // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => { if (canOpen && componentId) load(); }, [canOpen, componentId, load]);

  // ── Stock roll-ups (same math as /stock and /products) ─────────────────────
  const rolled = useMemo(() => rollUpOne(balances), [balances]);
  const physical = rolled.qty;
  const avgCost = rolled.avg;

  const committedDocs = useMemo(
    () => new Set([...salesDocs.values()].filter((d) => COMMITTED.has(d.status)).map((d) => d.quote_id)),
    [salesDocs]);

  // Reserved = committed order qty − already-delivered DO qty (split fulfillment)
  const reserved = useMemo(() => {
    let rsv = 0;
    for (const it of saleItems) {
      if (committedDocs.has(it.quote_id)) rsv += Number(it.quantity) || 0;
    }
    for (const [k, dq] of deliveredByQuote) {
      const [qid, cid] = k.split('·');
      if (cid === componentId && committedDocs.has(qid)) rsv = Math.max(0, rsv - dq);
    }
    return rsv;
  }, [saleItems, committedDocs, deliveredByQuote, componentId]);
  const live = physical - reserved;

  // ── Buy-side engines: THE canonical TUC + FX maps (compose, don't fork) ────
  const tucMap = useMemo(
    () => (canBuy ? computeTUCMap(pos, poItems, poCosts) : new Map<string, TUCResult>()),
    [canBuy, pos, poItems, poCosts]);
  const tucRes: TUCResult | null = tucMap.get(componentId) ?? null;
  const fx: Record<string, FxRate> = useMemo(
    () => (canBuy ? fxFromHistory(pos, deriveExchangeRates(pos, poItems, poCosts, quotes)) : {}),
    [canBuy, pos, poItems, poCosts, quotes]);

  const myPoLines = useMemo(() => {
    const poById = new Map(pos.map((p) => [String(p.po_id), p]));
    return poItems
      .filter((i) => i.component_id === componentId)
      .map((i) => ({ item: i, po: poById.get(String(i.po_id)) }))
      .filter((x): x is { item: PurchaseLineItem; po: PurchaseOrder } => !!x.po)
      .sort((a, b) => (b.po.po_date ?? '').localeCompare(a.po.po_date ?? ''));
  }, [poItems, pos, componentId]);

  const incoming = useMemo(
    () => myPoLines.reduce((s, { item, po }) => s + (INCOMING_PO_STATUSES.has(po.status ?? '') ? Number(item.quantity) || 0 : 0), 0),
    [myPoLines]);

  // When those incoming units should land — ETA if the PO carries one, else PO
  // date + this supplier's measured lead time (all POs feed the lead average).
  const arrival = useMemo<ItemArrival | null>(() => {
    const lines = myPoLines.map(({ item }) => ({ po_id: item.po_id, component_id: componentId }));
    return itemArrivals(lines, pos as unknown as OpenPo[], pos as unknown as ReceivedPo[], new Date().toISOString()).get(componentId) ?? null;
  }, [myPoLines, pos, componentId]);

  // ── This item's PO slice — feeds the Exchange Rate and Cash Cycle tabs.
  // Same rows the whole page already fetched, just narrowed to POs that carry
  // this component, so both tabs show exactly this item's money history.
  const myPoIds = useMemo(() => new Set(myPoLines.map(({ po }) => String(po.po_id))), [myPoLines]);
  const myPos = useMemo(() => pos.filter((p) => myPoIds.has(String(p.po_id))), [pos, myPoIds]);
  const myCosts = useMemo(() => poCosts.filter((c) => myPoIds.has(String(c.po_id))), [poCosts, myPoIds]);
  const myLines = useMemo(() => poItems.filter((i) => i.component_id === componentId), [poItems, componentId]);
  // Payment-implied FX per PO — the SAME engine Spend & Cash's Exchange Rates
  // uses (deriveExchangeRates): IDR principal settled ÷ the PO's foreign value.
  const myFxRows = useMemo(
    () => deriveExchangeRates(myPos, myLines, myCosts, quotes)
      .sort((a, b) => (b.payment_date ?? '').localeCompare(a.payment_date ?? '')),
    [myPos, myLines, myCosts, quotes]);

  // Measured lead time: PO date → actual goods receipt, per received PO
  const leadTimes = useMemo(() => {
    const days: number[] = [];
    const seen = new Set<string>();
    for (const { po } of myPoLines) {
      const k = String(po.po_id);
      if (seen.has(k) || !po.actual_received_date || !po.po_date) continue;
      seen.add(k);
      const d = Math.round((new Date(po.actual_received_date).getTime() - new Date(po.po_date).getTime()) / 86_400_000);
      if (d >= 0) days.push(d);
    }
    if (!days.length) return null;
    const avg = days.reduce((s, d) => s + d, 0) / days.length;
    return { avg, min: Math.min(...days), max: Math.max(...days), n: days.length };
  }, [myPoLines]);

  // ── Sell-side engine: THE canonical tier chain ─────────────────────────────
  const activeTiers = useMemo(() => tiers.filter((t) => t.is_active).sort((a, b) => a.sort_order - b.sort_order), [tiers]);
  const ovByTier = useMemo(() => new Map(overrides.map((o) => [o.tier_id, o.override_price_idr])), [overrides]);
  const chain = useMemo(
    () => computeTierChain(comp?.selling_price_idr ?? null, activeTiers, (tid) => ovByTier.get(tid)),
    [comp?.selling_price_idr, activeTiers, ovByTier]);

  // Committed sale lines with dates — cover months + customers who buy it
  const soldLines = useMemo(() => {
    const out: { qty: number; value: number; date: string; doc: SalesDoc }[] = [];
    for (const it of saleItems) {
      const doc = salesDocs.get(it.quote_id);
      if (!doc || !COMMITTED.has(doc.status) && doc.status !== 'delivered') continue;
      out.push({
        qty: Number(it.quantity) || 0,
        value: (Number(it.quantity) || 0) * (Number(it.unit_price) || 0),
        date: (doc.ordered_at ?? doc.delivered_at ?? doc.updated_at ?? '').slice(0, 10),
        doc,
      });
    }
    return out;
  }, [saleItems, salesDocs]);

  const monthlySoldRate = useMemo(() => {
    const cutoff = new Date(); cutoff.setDate(cutoff.getDate() - 90);
    const iso = cutoff.toISOString().slice(0, 10);
    return soldLines.filter((l) => l.date >= iso).reduce((s, l) => s + l.qty, 0) / 3;
  }, [soldLines]);

  const lastMove = movements[0] ?? null;
  const lastOut = useMemo(() => movements.find((m) => m.direction === 'out') ?? null, [movements]);

  if (authLoading || !profile || !canOpen) {
    return <div className="min-h-screen bg-chrome flex items-center justify-center"><div className="w-6 h-6 border-2 border-slate-500/30 border-t-slate-300 rounded-full animate-spin" /></div>;
  }

  if (notFound) {
    return (
      <div className="min-h-screen bg-chrome text-slate-200 font-sans text-sm">
        <Header subtitle="Item" />
        <main className="max-w-[1200px] mx-auto px-4 py-16 text-center space-y-3">
          <p className="text-slate-400">This item does not exist (or was removed).</p>
          <Link href="/items" className="text-emerald-400 hover:text-emerald-300 text-xs">← Back to Items</Link>
        </main>
      </div>
    );
  }

  // Renamed 2026-08-11 (owner's wording): Buy → Purchases, Sell → Sales; and
  // three lenses absorbed from Spend & Cash, pinned to THIS item: Pricing
  // (the pricing-intelligence engine), Exchange Rate (payment-implied FX on
  // this item's POs), Cash Cycle (paid → received → sold, this item only).
  const tabs: { key: TabKey; label: string; show: boolean; accent: string }[] = [
    { key: 'overview', label: 'Overview', show: true, accent: 'border-slate-300 text-slate-100' },
    { key: 'buy', label: 'Purchases', show: canBuy, accent: 'border-sky-400 text-sky-300' },
    { key: 'sell', label: 'Sales', show: canSell, accent: 'border-emerald-400 text-emerald-300' },
    { key: 'pricing', label: 'Pricing', show: canBuy, accent: 'border-violet-400 text-violet-300' },
    { key: 'fx', label: 'Exchange Rate', show: canBuy, accent: 'border-sky-400 text-sky-300' },
    { key: 'cashcycle', label: 'Cash Cycle', show: canBuy, accent: 'border-amber-400 text-amber-300' },
    { key: 'stock', label: 'Stock', show: canBuy, accent: 'border-sky-400 text-sky-300' },
    { key: 'specs', label: 'Specs', show: true, accent: 'border-slate-300 text-slate-100' },
    { key: 'economics', label: 'Economics', show: canEcon, accent: 'border-amber-400 text-amber-300' },
  ];

  return (
    <div className="min-h-screen bg-chrome text-slate-200 font-sans text-sm">
      <Header subtitle={comp ? descOf(comp) : 'Item'} />

      <main className="max-w-[1400px] 2xl:max-w-[1760px] mx-auto px-3 sm:px-4 md:px-6 py-6 space-y-5">
        <Link href="/items" className="inline-flex items-center gap-1 text-[11px] text-slate-500 hover:text-slate-300 transition-colors">← All items</Link>

        {loading || !comp ? (
          <div className="space-y-3">
            <div className="h-24 bg-slate-800/40 rounded-2xl animate-pulse" />
            <div className="h-64 bg-slate-800/40 rounded-2xl animate-pulse" />
          </div>
        ) : (
          <>
            {/* ── Item header: the one line that answers "what is this" ── */}
            <div className="bg-slate-900/40 border border-slate-800/80 rounded-2xl px-4 sm:px-5 py-4">
              <div className="flex flex-col lg:flex-row lg:items-start gap-4">
                <div className="min-w-0 flex-1">
                  <h1 className="text-lg sm:text-xl font-bold text-white leading-snug">{descOf(comp)}</h1>
                  {/* Superseded? Say so at the top, with the door to the newer
                      item — a buyer quoting the old model should know first. */}
                  {(() => {
                    const succId = successorIdOf(componentId, componentLinks);
                    const succ = succId ? linkedComps.find((c) => String(c.component_id) === succId) : null;
                    if (!succId) return null;
                    return (
                      <a href={`/items/${succId}`} target="_blank" rel="noopener noreferrer"
                        title="A successor link marks this item as replaced — open the newer item"
                        className="inline-flex items-center gap-1.5 mt-1.5 px-2 py-0.5 rounded-md border border-amber-500/40 bg-amber-500/10 text-amber-300 text-[11px] font-semibold hover:bg-amber-500/20 transition-colors">
                        ↑ Newer version{succ ? `: ${succ.internal_description || succ.supplier_model}` : ' available'} ↗
                      </a>
                    );
                  })()}
                  <div className="flex flex-wrap items-center gap-x-2 gap-y-1 mt-1.5 text-[11px] text-slate-500">
                    {canBrand && comp.supplier_model && <span className="font-mono text-sky-400/80">{comp.supplier_model}</span>}
                    {canBrand && comp.brand && <span>{comp.brand}</span>}
                    {comp.category && <span className="px-1.5 py-0.5 rounded bg-slate-800 text-slate-400">{humanize(comp.category)}</span>}
                    {comp.norm_value != null && Number(comp.norm_value) !== 0 && <span className="tabular-nums">{fmtInt(Number(comp.norm_value))}</span>}
                    {comp.unit && <span>per {comp.unit}</span>}
                    {warrantyLabel(comp) && <span title="Product warranty — the claimable clock After Sales runs on">warranty {warrantyLabel(comp)}</span>}
                    {fmtWarranty(comp.perf_warranty_value, comp.perf_warranty_unit) && (
                      <span title="Performance warranty — PV output guarantee (informational)">perf {fmtWarranty(comp.perf_warranty_value, comp.perf_warranty_unit)}</span>
                    )}
                    {comp.datasheet_url && (
                      <a href={comp.datasheet_url} target="_blank" rel="noopener noreferrer" className="text-sky-400 hover:text-sky-300">datasheet ↗</a>
                    )}
                  </div>
                </div>
                {/* The two prices that matter + live stock. On phones a tidy
                    2-col grid (full width); natural widths from sm up. */}
                <div className="grid grid-cols-2 sm:flex sm:flex-wrap gap-2.5 flex-shrink-0">
                  <HeadStat label="Live / Physical" value={<><span className={live < 0 ? 'text-red-400' : live === 0 ? 'text-slate-500' : 'text-emerald-300'}>{fmtInt(live)}</span><span className="text-slate-600">/{fmtInt(physical)}</span>{comp.unit ? <span className="text-[10px] text-slate-600 font-normal"> {comp.unit}</span> : null}</>}
                    sub={reserved > 0 ? `${fmtInt(reserved)} reserved on orders` : 'nothing reserved'} />
                  {canSell && (
                    <HeadStat label="Sell price · net (T1)" tone="text-emerald-300"
                      value={comp.selling_price_idr ? fmtRupiah(comp.selling_price_idr) : '—'}
                      sub={activeTiers.length ? `${activeTiers.length} tier chain` : 'no tiers configured'} />
                  )}
                  {canBuy && (
                    <HeadStat label="Avg landed cost" tone="text-sky-300"
                      value={avgCost > 0 ? fmtIdr(avgCost) : '—'}
                      sub={physical !== 0 ? `stock value ${fmtRupiah(physical * avgCost)}` : 'no stock on hand'} />
                  )}
                </div>
              </div>
            </div>

            {/* ── Tabs — no scroll-snap (it eats the left gutter on phones) ── */}
            {/* scrollbar-none: without it the overflow container paints a
                permanent scrollbar gutter beside the tabs on desktop.
                overflow-y-hidden is REQUIRED: overflow-x-auto alone leaves
                overflow-y computed to `auto`, so the strip rubber-bands
                vertically on touch — the tabs must scroll horizontally only.
                overscroll-x-contain stops the horizontal fling from triggering
                the browser's back-swipe. */}
            <div className="flex items-center gap-1 border-b border-slate-800/80 overflow-x-auto overflow-y-hidden overscroll-x-contain scrollbar-none -mx-3 px-3 sm:mx-0 sm:px-0">
              {tabs.filter((t) => t.show).map((t) => (
                <button key={t.key} onClick={() => setTab(t.key)}
                  className={`text-xs font-semibold px-3.5 py-2.5 border-b-2 -mb-px whitespace-nowrap transition-colors ${
                    tab === t.key ? t.accent : 'border-transparent text-slate-500 hover:text-slate-300'}`}>
                  {t.label}
                </button>
              ))}
            </div>

            {/* ── The lens bar: THIS item, in every other screen that knows it.
                   The hub is the center; these are the doors back out — each
                   item-anchored and gated exactly like its target screen.
                   (Moved up from the page bottom, where nobody found it.) ── */}
            <div className="flex flex-wrap items-center gap-2 text-[11px] -mt-2">
              <span className="text-[9px] uppercase tracking-widest text-slate-600">This item elsewhere</span>
              {canBuy && <Link href={`/purchasing?tab=catalog&q=${encodeURIComponent(comp.supplier_model || descOf(comp))}`} className="px-2.5 py-1 rounded-lg border border-slate-800 text-slate-500 hover:text-sky-300 hover:border-sky-500/40 transition-colors">✎ Edit in Item Editor</Link>}
              {canSell && <Link href={`/products?q=${encodeURIComponent(descOf(comp))}`} className="px-2.5 py-1 rounded-lg border border-slate-800 text-slate-500 hover:text-emerald-300 hover:border-emerald-500/40 transition-colors">Products →</Link>}
              {canBuy && <Link href="/stock" className="px-2.5 py-1 rounded-lg border border-slate-800 text-slate-500 hover:text-sky-300 hover:border-sky-500/40 transition-colors">Stock →</Link>}
              {canBuy && <Link href={`/purchasing?tab=lookup&q=${encodeURIComponent(comp.supplier_model || descOf(comp))}`} className="px-2.5 py-1 rounded-lg border border-slate-800 text-slate-500 hover:text-sky-300 hover:border-sky-500/40 transition-colors">Deal Lookup →</Link>}
              {canEcon && <Link href={`/profitability?q=${encodeURIComponent(descOf(comp))}`} className="px-2.5 py-1 rounded-lg border border-slate-800 text-slate-500 hover:text-amber-300 hover:border-amber-500/40 transition-colors">Profitability →</Link>}
            </div>

            {tab === 'overview' && (
              <OverviewTab comp={comp} physical={physical} reserved={reserved} live={live} incoming={incoming} arrival={arrival}
                avgCost={avgCost} canBuy={canBuy} canSell={canSell} canFloor={canFloor}
                monthlySoldRate={monthlySoldRate} lastMove={lastMove} lastOut={lastOut} slowDays={SLOW_DAYS}
                chain={chain} activeTiers={activeTiers} tucRes={tucRes} />
            )}
            {tab === 'buy' && canBuy && (
              <BuyTab compUnit={comp.unit} tucRes={tucRes} fx={fx} myPoLines={myPoLines}
                incoming={incoming} leadTimes={leadTimes}
                forensics={{
                  componentId,
                  components: [comp as CompLite, ...linkedComps],
                  quotes, quoteItems: quoteLines, pos, poItems, poCosts,
                  suppliers, componentLinks, tucMap,
                }} />
            )}
            {tab === 'sell' && canSell && (
              <SellTab comp={comp} activeTiers={activeTiers} chain={chain} avgCost={avgCost} canFloor={canFloor}
                soldLines={soldLines} custNames={custNames} reserved={reserved} />
            )}
            {/* ── Pricing — the Spend & Cash pricing-intelligence engine, pinned
                   to THIS item (its search is hidden; the page is the item). ── */}
            {tab === 'pricing' && canBuy && (
              <PricingIntelligence
                components={[comp as any]}
                poItems={poItems} pos={pos} quoteItems={quoteLines} quotes={quotes} poCosts={poCosts}
                competitorPrices={competitorPrices} isLoading={loading}
                initialComponentId={componentId} lockComponent />
            )}
            {/* ── Exchange Rate — what THIS item's foreign POs actually cost in
                   rupiah: IDR principal paid ÷ the PO's foreign nominal
                   (deriveExchangeRates — the same engine as Spend & Cash). ── */}
            {tab === 'fx' && canBuy && (
              <FxTab rows={myFxRows} pos={myPos} suppliers={suppliers} />
            )}
            {/* ── Cash Cycle — money out → goods in → sold, for THIS item only
                   (the same POCashCycle engine, narrowed to its POs). ── */}
            {tab === 'cashcycle' && canBuy && (
              <POCashCycle pos={myPos} poItems={myLines} poCosts={myCosts}
                components={[comp as any]} quotes={quotes} suppliers={suppliers as any} isLoading={loading} />
            )}
            {tab === 'stock' && canBuy && (
              <StockTab balances={balances} warehouses={warehouses} movements={movements}
                physical={physical} reserved={reserved} live={live} unit={comp.unit} />
            )}
            {tab === 'specs' && (
              <SpecsTab comp={comp} canEdit={canEditSpecs} onSaved={(specs) => setComp((c) => (c ? { ...c, specifications: specs } : c))} />
            )}
            {tab === 'economics' && canEcon && (
              <EconomicsTab componentId={componentId} comp={comp} movements={movements}
                saleItems={saleItems} salesDocs={salesDocs} custNames={custNames}
                physical={physical} avgCost={avgCost} />
            )}

          </>
        )}
      </main>
    </div>
  );
}

// ── Header ───────────────────────────────────────────────────────────────────
function Header({ subtitle }: { subtitle: string }) {
  return (
    <div className="border-b border-slate-800/60 bg-chrome/80 backdrop-blur-md sticky top-0 z-30">
      <div className="max-w-[1400px] 2xl:max-w-[1760px] mx-auto px-3 sm:px-4 md:px-6 py-3 sm:py-4">
        <BrandMenu wordmarkClass="text-xl md:text-2xl font-extrabold" subtitle={`Item · ${subtitle}`} />
      </div>
    </div>
  );
}

function HeadStat({ label, value, sub, tone }: { label: string; value: React.ReactNode; sub?: string; tone?: string }) {
  return (
    <div className="rounded-xl border border-slate-800 bg-slate-950/40 px-3.5 py-2.5 min-w-[130px]">
      <p className="text-[9px] font-semibold uppercase tracking-widest text-slate-600">{label}</p>
      <p className={`text-base font-bold tabular-nums mt-0.5 ${tone ?? 'text-slate-100'}`}>{value}</p>
      {sub && <p className="text-[10px] text-slate-600 mt-0.5">{sub}</p>}
    </div>
  );
}

// ── Overview ─────────────────────────────────────────────────────────────────
function OverviewTab({ comp, physical, reserved, live, incoming, arrival, avgCost, canBuy, canSell, canFloor,
  monthlySoldRate, lastMove, lastOut, slowDays, chain, activeTiers, tucRes }: {
  comp: Comp; physical: number; reserved: number; live: number; incoming: number; arrival: ItemArrival | null; avgCost: number;
  canBuy: boolean; canSell: boolean; canFloor: boolean;
  monthlySoldRate: number; lastMove: Movement | null; lastOut: Movement | null; slowDays: number;
  chain: Map<string, { price: number | null }>; activeTiers: Tier[]; tucRes: TUCResult | null;
}) {
  const idleDays = daysSince(lastMove?.moved_at);
  const outIdleDays = daysSince(lastOut?.moved_at);
  const net = comp.selling_price_idr ?? 0;
  const gpPct = canBuy && canSell && net > 0 && avgCost > 0 ? ((net - avgCost) / net) * 100 : null;
  const coverMonths = live > 0 && monthlySoldRate > 0 ? live / monthlySoldRate : null;

  // Open signals — each one derived from the owning module's own rule, so a
  // fix made there clears the row on the next load.
  const signals: { tone: 'red' | 'amber' | 'sky'; text: string }[] = [];
  if (physical < 0) signals.push({ tone: 'red', text: `Negative on-hand (${fmtInt(physical)}) — the ledger needs a correction.` });
  if (reserved > physical) signals.push({ tone: 'red', text: `Committed orders need ${fmtInt(reserved)} but only ${fmtInt(Math.max(0, physical))} is on hand — short ${fmtInt(reserved - physical)}.` });
  if (canFloor && avgCost > 0) {
    const below = activeTiers.filter((t) => {
      const p = chain.get(t.tier_id)?.price;
      if (p == null || p <= 0) return false;
      return ((p - avgCost) / p) * 100 < (t.margin_floor_pct || 0) - 0.05;
    });
    if (below.length) signals.push({ tone: 'amber', text: `Below margin floor on ${below.map((t) => t.name).join(', ')} vs avg landed cost.` });
  }
  if (physical > 0 && (outIdleDays == null || outIdleDays > slowDays)) {
    signals.push({ tone: 'amber', text: `Slow mover — ${outIdleDays == null ? 'never shipped' : `no stock-out in ${fmtInt(outIdleDays)} days`} with stock on hand (threshold ${slowDays}d).` });
  }
  if (canSell && !comp.selling_price_idr) signals.push({ tone: 'amber', text: 'No sell price set — the item cannot be quoted or marked.' });
  if (incoming > 0) {
    const eta = arrival?.nearest ? ` Nearest expected ${fmtDate(arrival.nearest)}${arrival.source === 'lead' ? ' (est. from lead time)' : ''}.` : '';
    signals.push({ tone: arrival?.overdue ? 'amber' : 'sky', text: `${fmtInt(incoming)}${comp.unit ? ` ${comp.unit}` : ''} incoming on open purchase orders.${arrival?.overdue ? ' A shipment is past its expected arrival — chase the supplier.' : eta}` });
  }

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 md:grid-cols-4 gap-2.5">
        <Kpi label="Cover" value={coverMonths == null ? (live > 0 ? '∞' : '0') : `${coverMonths.toFixed(1)} mo`}
          sub={monthlySoldRate > 0 ? `selling ~${fmtInt(Math.round(monthlySoldRate))}/mo (90d)` : 'no committed sales in 90d'} />
        <Kpi label="Days since movement" value={idleDays == null ? 'never' : `${fmtInt(idleDays)}d`}
          sub={lastMove ? `last: ${lastMove.direction} · ${fmtDay(lastMove.moved_at)}` : 'no ledger entries'}
          tone={idleDays != null && idleDays > slowDays ? 'text-amber-300' : undefined} />
        {gpPct != null ? (
          <Kpi label="GP% at current price" value={`${gpPct.toFixed(1)}%`} tone={gpPct < 0 ? 'text-red-400' : 'text-emerald-300'}
            sub={`net ${fmtRupiah(net)} vs cost ${fmtRupiah(avgCost)}`} />
        ) : canSell ? (
          <Kpi label="Sell price (net)" value={net > 0 ? fmtRupiah(net) : '—'} tone="text-emerald-300" sub="Tier-1, excl. PPN" />
        ) : (
          <Kpi label="Landed cost (TUC)" value={tucRes ? fmtRupiah(tucRes.tuc) : avgCost > 0 ? fmtRupiah(avgCost) : '—'} tone="text-sky-300"
            sub={tucRes ? `from ${tucRes.poCount} settled PO${tucRes.poCount !== 1 ? 's' : ''}` : 'moving average'} />
        )}
        <Kpi label="Incoming" value={incoming > 0 ? fmtInt(incoming) : '0'} tone={incoming > 0 ? (arrival?.overdue ? 'text-amber-300' : 'text-sky-300') : undefined}
          sub={incoming > 0 && arrival?.nearest
            ? (arrival.overdue ? 'past expected arrival' : `ETA ${fmtDate(arrival.nearest)}${arrival.source === 'lead' ? ' · est.' : ''}`)
            : 'on POs not yet fully received'} />
      </div>

      <div className="bg-slate-900/40 border border-slate-800/80 rounded-2xl px-4 py-3.5">
        <h3 className="text-[11px] font-bold uppercase tracking-widest text-slate-500 mb-2">Open signals</h3>
        {signals.length === 0 ? (
          <p className="text-xs text-emerald-300/90">✓ Nothing needs attention on this item.</p>
        ) : (
          <ul className="space-y-1.5">
            {signals.map((s, i) => (
              <li key={i} className={`text-xs flex items-start gap-2 ${s.tone === 'red' ? 'text-red-300' : s.tone === 'amber' ? 'text-amber-300' : 'text-sky-300'}`}>
                <span className="mt-[3px] w-1.5 h-1.5 rounded-full flex-shrink-0 bg-current" />
                <span>{s.text}</span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

function Kpi({ label, value, sub, tone }: { label: string; value: string; sub?: string; tone?: string }) {
  return (
    <div className="bg-slate-900/40 border border-slate-800/80 rounded-2xl px-4 py-3">
      <p className="text-[10px] uppercase tracking-wider text-slate-600 truncate" title={label}>{label}</p>
      <p className={`text-xl font-bold tabular-nums mt-0.5 ${tone ?? 'text-slate-100'}`}><FitText text={value} /></p>
      {sub && <p className="text-[10px] text-slate-500 mt-0.5 truncate" title={sub}>{sub}</p>}
    </div>
  );
}

// ── Buy tab ──────────────────────────────────────────────────────────────────
interface ForensicsData {
  componentId: string; components: CompLite[];
  quotes: PriceQuote[]; quoteItems: PriceQuoteLineItem[];
  pos: PurchaseOrder[]; poItems: PurchaseLineItem[]; poCosts: POCost[];
  suppliers: Supplier[]; componentLinks: ComponentLink[];
  tucMap: Map<string, TUCResult>;
}

function BuyTab({ compUnit, tucRes, fx, myPoLines, incoming, leadTimes, forensics }: {
  compUnit: string | null; tucRes: TUCResult | null; fx: Record<string, FxRate>;
  myPoLines: { item: PurchaseLineItem; po: PurchaseOrder }[];
  incoming: number; leadTimes: { avg: number; min: number; max: number; n: number } | null;
  forensics: ForensicsData;
}) {
  const boughtQty = myPoLines.reduce((s, { item }) => s + (Number(item.quantity) || 0), 0);
  const poCount = new Set(myPoLines.map(({ po }) => String(po.po_id))).size;

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 md:grid-cols-4 gap-2.5">
        <Kpi label="Landed cost (TUC)" value={tucRes ? fmtIdr(tucRes.tuc) : '—'} tone="text-sky-300"
          sub={tucRes ? `headline = max(latest, weighted avg)` : 'no settled PO yet'} />
        <Kpi label="Latest · weighted avg" value={tucRes ? `${fmtRupiah(tucRes.latestTuc)} · ${fmtRupiah(tucRes.avgTuc)}` : '—'}
          sub={tucRes ? `latest settled PO ${fmtDay(tucRes.latestPoDate)}` : `from ${poCount} PO${poCount !== 1 ? 's' : ''}`} />
        <Kpi label="Bought all-time" value={boughtQty > 0 ? `${fmtInt(boughtQty)}${compUnit ? ` ${compUnit}` : ''}` : '—'}
          sub={incoming > 0 ? `${poCount} PO${poCount !== 1 ? 's' : ''} · ${fmtInt(incoming)} incoming` : `${poCount} purchase order${poCount !== 1 ? 's' : ''}`} />
        <Kpi label="Lead time (measured)" value={leadTimes ? `${Math.round(leadTimes.avg)}d` : '—'}
          sub={leadTimes ? `${leadTimes.min}–${leadTimes.max}d over ${leadTimes.n} received PO${leadTimes.n !== 1 ? 's' : ''}` : 'no received POs to measure'} />
      </div>

      {/* The forensic layer — the same component Cost Lookup's audit trail was
          extracted into: quote lines with FX provenance, per-PO TUC
          allocations, payment & cost records, linked/comparable items. */}
      <div className="bg-slate-900/40 border border-slate-800/80 rounded-2xl px-4 py-4">
        <ItemCostForensics {...forensics} fx={fx} showSummary={false} defaultOpen showLead />
      </div>
      <p className="text-[10px] text-slate-600">
        TUC = the canonical True Unit Cost engine (settled POs only; taxes excluded) — identical to Purchasing&apos;s Last Price and Cost Lookup.
        Foreign quotes convert at the newest FX evidence ({Object.entries(fx).map(([c, r]) => `${c} ${fmtInt(r.rate)}`).join(' · ') || 'none yet'}); amber = older than {FX_STALE_DAYS} days.
      </p>
    </div>
  );
}

// ── Exchange Rate tab ────────────────────────────────────────────────────────
// What this item's foreign-currency POs actually cost in rupiah. Each row is a
// PO's payment-implied rate from deriveExchangeRates (Spend & Cash's engine):
// realized = IDR principal settled ÷ the PO's foreign nominal, once the PO is
// essentially settled; until then the PO's typed estimate stands in, labeled.
function FxTab({ rows, pos, suppliers }: {
  rows: { po_id: string; supplier_id: string; currency: string; quoted_amount_foreign: number; paid_amount_idr: number; implied_rate: number; payment_date: string }[];
  pos: PurchaseOrder[];
  suppliers: Supplier[];
}) {
  const poById = useMemo(() => new Map(pos.map((p) => [String(p.po_id), p])), [pos]);
  const supName = useMemo(() => new Map(suppliers.map((s) => [s.supplier_id, s.supplier_name])), [suppliers]);
  // "PO estimate" rows are constructed as quoted × typed rate — detectable
  // without re-deriving: the paid figure equals the estimate to the rupiah.
  const isEstimate = (r: typeof rows[number]) => {
    const est = Number(poById.get(String(r.po_id))?.exchange_rate) || 0;
    return est > 0 && Math.abs(r.paid_amount_idr - r.quoted_amount_foreign * est) < 1 && Math.abs(r.implied_rate - est) < 0.01;
  };
  // Latest rate per currency leads — that is "the rate this item last cost us"
  const latest = useMemo(() => {
    const seen = new Map<string, typeof rows[number]>();
    for (const r of rows) if (!seen.has(r.currency)) seen.set(r.currency, r);
    return [...seen.values()];
  }, [rows]);

  if (!rows.length) {
    return (
      <div className="bg-slate-900/40 border border-slate-800/60 rounded-2xl p-10 text-center">
        <p className="text-slate-400 text-sm font-medium">No foreign-currency purchases for this item</p>
        <p className="text-slate-600 text-xs mt-1">IDR deals carry no exchange rate — this tab fills in once the item is bought in USD, CNY or another currency.</p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
        {latest.map((r) => (
          <div key={r.currency} className="bg-slate-900/60 border border-slate-800 ring-1 ring-sky-500/15 rounded-2xl p-4">
            <p className="text-[10px] font-bold uppercase tracking-widest text-slate-500 mb-1">Last {r.currency} rate on this item</p>
            <p className="text-2xl font-extrabold tabular-nums text-sky-300 leading-none">{fmtInt(r.implied_rate)}</p>
            <p className="text-[11px] text-slate-500 mt-1.5">
              {isEstimate(r) ? 'PO estimate — not yet settled' : 'realized from payments'} · {fmtDay(r.payment_date)}
            </p>
          </div>
        ))}
      </div>

      <div className="bg-slate-900/40 border border-slate-800/80 rounded-2xl overflow-x-auto">
        <table className="w-full min-w-[640px] text-xs">
          <thead>
            <tr className="border-b border-slate-800 text-[10px] uppercase tracking-widest text-slate-500">
              <th className="text-left font-semibold px-4 py-2.5">Paid</th>
              <th className="text-left font-semibold px-3 py-2.5">PO</th>
              <th className="text-left font-semibold px-3 py-2.5">Supplier</th>
              <th className="text-right font-semibold px-3 py-2.5">Foreign nominal</th>
              <th className="text-right font-semibold px-3 py-2.5">Paid (IDR)</th>
              <th className="text-right font-semibold px-3 py-2.5" title="IDR paid ÷ foreign nominal — the rate this deal actually implied">Implied rate</th>
              <th className="text-left font-semibold px-3 py-2.5">Basis</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-800/60">
            {rows.map((r) => {
              const po = poById.get(String(r.po_id));
              const est = isEstimate(r);
              return (
                <tr key={r.po_id} className="hover:bg-white/[0.03] transition-colors">
                  <td className="px-4 py-2.5 tabular-nums text-slate-400 whitespace-nowrap">{fmtDay(r.payment_date)}</td>
                  <td className="px-3 py-2.5">
                    <Link href={`/purchasing?tab=lookup&q=${encodeURIComponent(po?.po_number || String(r.po_id))}`}
                      className="font-mono text-sky-300 hover:text-sky-200 transition-colors">{po?.po_number || `PO ${r.po_id}`}</Link>
                  </td>
                  <td className="px-3 py-2.5 text-slate-400 truncate max-w-[180px]">{supName.get(r.supplier_id) || '—'}</td>
                  <td className="px-3 py-2.5 text-right tabular-nums text-slate-200 whitespace-nowrap">{r.currency} {fmtInt(r.quoted_amount_foreign)}</td>
                  <td className="px-3 py-2.5 text-right tabular-nums text-slate-200 whitespace-nowrap">{fmtIdr(r.paid_amount_idr)}</td>
                  <td className="px-3 py-2.5 text-right tabular-nums font-bold text-sky-300">{fmtInt(r.implied_rate)}</td>
                  <td className="px-3 py-2.5">
                    <span className={`px-1.5 py-0.5 rounded text-[10px] font-semibold ${est ? 'bg-slate-800 text-slate-400' : 'bg-emerald-500/10 text-emerald-300'}`}
                      title={est ? 'The PO is not yet settled — this is the rate typed on the PO' : 'IDR principal actually paid ÷ the PO’s foreign value'}>
                      {est ? 'estimate' : 'realized'}
                    </span>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <p className="text-[10px] text-slate-600 px-1">
        Principal payments only — bank fees, VAT, income tax and local delivery never enter the FX math (they are rupiah costs of their own).
      </p>
    </div>
  );
}

// ── Sell tab ─────────────────────────────────────────────────────────────────
function SellTab({ comp, activeTiers, chain, avgCost, canFloor, soldLines, custNames, reserved }: {
  comp: Comp; activeTiers: Tier[]; chain: Map<string, { price: number | null; overridden: boolean; stepPct: number; actualMarginPct: number | null }>;
  avgCost: number; canFloor: boolean;
  soldLines: { qty: number; value: number; date: string; doc: SalesDoc }[];
  custNames: Map<string, string>; reserved: number;
}) {
  // Customers who buy it — committed orders only, at the prices they pay
  const customers = useMemo(() => {
    const m = new Map<string, { name: string; qty: number; value: number; orders: Set<string>; last: string }>();
    for (const l of soldLines) {
      const id = l.doc.customer_id ?? '·none';
      const e = m.get(id) ?? { name: custNames.get(id) ?? 'No customer', qty: 0, value: 0, orders: new Set<string>(), last: '' };
      e.qty += l.qty; e.value += l.value; e.orders.add(l.doc.quote_id);
      if (l.date > e.last) e.last = l.date;
      m.set(id, e);
    }
    return [...m.values()].sort((a, b) => b.value - a.value);
  }, [soldLines, custNames]);

  const orders = useMemo(() =>
    [...new Map(soldLines.filter((l) => l.doc.order_number).map((l) => [l.doc.quote_id, l])).values()]
      .sort((a, b) => b.date.localeCompare(a.date)).slice(0, 10),
    [soldLines]);
  const deliveries = useMemo(() =>
    [...new Map(soldLines.filter((l) => l.doc.do_number).map((l) => [l.doc.quote_id, l])).values()]
      .sort((a, b) => b.date.localeCompare(a.date)).slice(0, 10),
    [soldLines]);

  return (
    <div className="space-y-4">
      {/* Tier chain — THE canonical engine (lib/tierPricing) */}
      <div className="bg-slate-900/40 border border-slate-800/80 rounded-2xl overflow-x-auto">
        <div className="px-4 pt-3 pb-1 flex items-baseline gap-2 flex-wrap">
          <h3 className="text-[11px] font-bold uppercase tracking-widest text-emerald-400/80">Tier price chain</h3>
          <span className="text-[10px] text-slate-600">net price = Tier-1; each next tier marks up from the previous</span>
        </div>
        {activeTiers.length === 0 || !comp.selling_price_idr ? (
          <p className="px-4 py-6 text-xs text-slate-600 italic">
            {comp.selling_price_idr ? 'No active price tiers configured.' : 'No net price set on this item.'}
          </p>
        ) : (
          <table className="w-full min-w-[560px]">
            <thead>
              <tr className="border-b border-slate-800 text-[10px] uppercase tracking-widest text-slate-500">
                <th className="text-left font-semibold px-4 py-2">Tier</th>
                <th className="text-right font-semibold px-3 py-2">Price</th>
                <th className="text-right font-semibold px-3 py-2">Step</th>
                <th className="text-right font-semibold px-3 py-2" title="Actual margin over the previous tier after rounding">Actual</th>
                {canFloor && <th className="text-right font-semibold px-3 py-2" title="Margin vs avg landed cost — the /pricing Floor Audit rule">GP vs cost</th>}
                <th className="text-left font-semibold px-3 py-2" />
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800/60">
              {activeTiers.map((t, i) => {
                const cp = chain.get(t.tier_id);
                const p = cp?.price ?? null;
                const gp = canFloor && p != null && p > 0 && avgCost > 0 ? ((p - avgCost) / p) * 100 : null;
                const below = gp != null && gp < (t.margin_floor_pct || 0) - 0.05;
                return (
                  <tr key={t.tier_id} className="hover:bg-slate-800/20 transition-colors">
                    <td className="px-4 py-2 text-xs text-slate-200 font-medium">{t.name}{i === 0 && <span className="ml-1.5 text-[9px] text-slate-500">net</span>}</td>
                    <td className="px-3 py-2 text-right tabular-nums text-sm text-slate-100 font-semibold whitespace-nowrap">{p != null ? fmtRupiah(p) : '—'}</td>
                    <td className="px-3 py-2 text-right tabular-nums text-xs text-slate-500">{i === 0 ? '—' : `+${t.default_discount_pct}%`}</td>
                    <td className="px-3 py-2 text-right tabular-nums text-xs text-slate-400">{cp?.actualMarginPct != null ? `${cp.actualMarginPct.toFixed(1)}%` : '—'}</td>
                    {canFloor && (
                      <td className={`px-3 py-2 text-right tabular-nums text-xs ${gp == null ? 'text-slate-700' : below ? 'text-red-400 font-bold' : 'text-slate-300'}`}>
                        {gp != null ? `${gp.toFixed(1)}%` : '—'}{gp != null && <span className="text-slate-600"> / {t.margin_floor_pct || 0}%</span>}
                      </td>
                    )}
                    <td className="px-3 py-2 text-[9px]">
                      <span className="inline-flex gap-1">
                        {cp?.overridden && <span className="px-1.5 py-0.5 rounded bg-violet-500/10 text-violet-300 font-semibold">override</span>}
                        {canFloor && below && <span className="px-1.5 py-0.5 rounded bg-red-500/10 text-red-300 font-semibold">below floor</span>}
                      </span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
        {/* Customers who buy it */}
        <div className="bg-slate-900/40 border border-slate-800/80 rounded-2xl px-4 py-3.5">
          <h3 className="text-[11px] font-bold uppercase tracking-widest text-slate-500 mb-2">Customers who buy it</h3>
          {customers.length === 0 ? (
            <p className="text-[11px] text-slate-600 italic py-3">No committed orders yet.</p>
          ) : (
            <div className="divide-y divide-slate-800/60">
              {customers.slice(0, 10).map((c, i) => (
                <div key={i} className="flex items-center gap-3 py-2">
                  <div className="min-w-0 flex-1">
                    <p className="text-xs text-slate-200 font-medium truncate">{c.name}</p>
                    <p className="text-[10px] text-slate-600">{c.orders.size} order{c.orders.size !== 1 ? 's' : ''} · last {fmtDay(c.last)}</p>
                  </div>
                  <div className="text-right flex-shrink-0">
                    <p className="text-xs font-bold tabular-nums text-emerald-300">{fmtRupiah(c.value)}</p>
                    <p className="text-[10px] text-slate-600 tabular-nums">{fmtInt(c.qty)}{comp.unit ? ` ${comp.unit}` : ''}</p>
                  </div>
                </div>
              ))}
            </div>
          )}
          {reserved > 0 && <p className="text-[10px] text-amber-300/80 tabular-nums mt-2">Reserved on open orders: {fmtInt(reserved)}</p>}
        </div>

        {/* Orders + deliveries */}
        <div className="space-y-3">
          <HubDocList title="Last customer orders" refs={orders} numberOf={(l) => l.doc.order_number!} accent="text-violet-300" custNames={custNames} unit={comp.unit} empty="No customer orders yet." />
          <HubDocList title="Last deliveries" refs={deliveries} numberOf={(l) => l.doc.do_number!} accent="text-emerald-300" custNames={custNames} unit={comp.unit} empty="No deliveries yet." />
        </div>
      </div>
    </div>
  );
}

function HubDocList({ title, refs, numberOf, accent, custNames, unit, empty }: {
  title: string; refs: { qty: number; date: string; doc: SalesDoc }[];
  numberOf: (l: { doc: SalesDoc }) => string; accent: string;
  custNames: Map<string, string>; unit: string | null; empty: string;
}) {
  return (
    <div className="bg-slate-900/40 border border-slate-800/80 rounded-2xl px-4 py-3.5">
      <p className="text-[10px] font-semibold uppercase tracking-widest text-slate-600 mb-1.5">{title}</p>
      {refs.length === 0 ? (
        <p className="text-[11px] text-slate-600 italic">{empty}</p>
      ) : (
        <div className="rounded-lg border border-slate-800 bg-slate-950/50 divide-y divide-slate-800/60">
          {refs.map((r, i) => (
            <Link key={i} href={`/sales/${r.doc.quote_id}`}
              className="flex items-center gap-2.5 px-2.5 py-1.5 text-[11px] hover:bg-slate-800/40 transition-colors">
              <span className={`font-mono flex-shrink-0 ${accent}`}>{numberOf(r)}</span>
              <span className="text-slate-400 truncate flex-1">{custNames.get(r.doc.customer_id ?? '') || '—'}</span>
              <span className="text-slate-300 tabular-nums flex-shrink-0">{fmtInt(r.qty)}{unit ? ` ${unit}` : ''}</span>
              <span className="text-slate-600 tabular-nums flex-shrink-0">{fmtDay(r.date)}</span>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}

// ── Stock tab ────────────────────────────────────────────────────────────────
function StockTab({ balances, warehouses, movements, physical, reserved, live, unit }: {
  balances: Balance[]; warehouses: Warehouse[]; movements: Movement[];
  physical: number; reserved: number; live: number; unit: string | null;
}) {
  const dirCls: Record<string, string> = { in: 'text-emerald-400', out: 'text-red-400', adjust: 'text-amber-400', revalue: 'text-amber-300' };
  const held = balances.filter((b) => (Number(b.qty_on_hand) || 0) !== 0).sort((a, b) => Number(b.qty_on_hand) - Number(a.qty_on_hand));
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-3 gap-2.5">
        {[
          { label: 'Physical', v: physical, cls: 'text-slate-200' },
          { label: 'Reserved', v: reserved, cls: reserved > 0 ? 'text-amber-300' : 'text-slate-500' },
          { label: 'Live', v: live, cls: live < 0 ? 'text-red-400' : live === 0 ? 'text-slate-500' : 'text-emerald-300' },
        ].map(({ label, v, cls }) => (
          <div key={label} className="bg-slate-900/40 border border-slate-800/80 rounded-2xl px-4 py-3 text-center">
            <p className="text-[10px] font-semibold uppercase tracking-widest text-slate-600 mb-0.5">{label}</p>
            <p className={`text-lg font-bold tabular-nums ${cls}`}>{fmtInt(v)}{unit ? <span className="text-[10px] text-slate-600 font-normal"> {unit}</span> : null}</p>
          </div>
        ))}
      </div>

      {/* Per-warehouse balances — each location carries its own moving average */}
      <div className="bg-slate-900/40 border border-slate-800/80 rounded-2xl px-4 py-3.5">
        <h3 className="text-[11px] font-bold uppercase tracking-widest text-sky-400/80 mb-2">Per warehouse</h3>
        {held.length === 0 ? (
          <p className="text-[11px] text-slate-600 italic py-2">No stock in any warehouse.</p>
        ) : (
          <div className="rounded-lg border border-slate-800 divide-y divide-slate-800/60">
            {held.map((b) => {
              const qty = Number(b.qty_on_hand) || 0;
              const avg = Number(b.avg_cost_idr) || 0;
              return (
                <div key={b.location} className="flex items-center gap-3 px-3 py-2 text-xs">
                  <span className="text-slate-300 flex-1 truncate">{warehouseLabel(warehouses, b.location)}</span>
                  <span className={`tabular-nums font-semibold ${qty < 0 ? 'text-red-400' : 'text-slate-100'}`}>{fmtInt(qty)}{unit ? ` ${unit}` : ''}</span>
                  <span className="tabular-nums text-slate-500 w-28 text-right">@ {avg > 0 ? fmtInt(avg) : '—'}</span>
                  <span className="tabular-nums text-slate-300 w-28 text-right" title={fmtRupiah(qty * avg)}>{qty * avg !== 0 ? fmtRupiah(qty * avg) : '—'}</span>
                </div>
              );
            })}
          </div>
        )}
        <p className="text-[10px] text-slate-600 mt-2">Valuation = moving-average landed cost per warehouse; roll-ups are quantity-weighted. Transfers move at the source average.</p>
      </div>

      {/* The 30.0 ledger for this item */}
      <div className="bg-slate-900/40 border border-slate-800/80 rounded-2xl overflow-x-auto">
        <div className="px-4 pt-3 pb-1">
          <h3 className="text-[11px] font-bold uppercase tracking-widest text-slate-500">Movement ledger</h3>
        </div>
        {movements.length === 0 ? (
          <p className="px-4 py-6 text-xs text-slate-600 italic">No movements recorded.</p>
        ) : (
          <table className="w-full min-w-[720px]">
            <thead>
              <tr className="border-b border-slate-800 text-[10px] uppercase tracking-widest text-slate-500">
                <th className="text-left font-semibold px-4 py-2">Date</th>
                <th className="text-left font-semibold px-3 py-2">Dir</th>
                <th className="text-right font-semibold px-3 py-2">Qty</th>
                <th className="text-right font-semibold px-3 py-2">Unit cost</th>
                <th className="text-left font-semibold px-3 py-2">Warehouse</th>
                <th className="text-left font-semibold px-3 py-2">Source</th>
                <th className="text-left font-semibold px-3 py-2">By</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800/60">
              {movements.slice(0, 100).map((m) => (
                <tr key={m.movement_id} className="hover:bg-slate-800/20 transition-colors">
                  <td className="px-4 py-1.5 text-xs text-slate-400 tabular-nums whitespace-nowrap">{fmtDay(m.moved_at)}</td>
                  <td className={`px-3 py-1.5 text-xs font-semibold uppercase ${dirCls[m.direction] ?? 'text-slate-400'}`}>{m.direction}</td>
                  {/* A revaluation moves value, never stock — showing its
                      quantity in the Qty column would read as goods arriving. */}
                  <td className="px-3 py-1.5 text-right tabular-nums text-xs text-slate-200">
                    {m.direction === 'revalue'
                      ? <span className="text-slate-600" title={`Landed-cost correction on ${fmtInt(Number(m.quantity))} received`}>—</span>
                      : <>{m.direction === 'out' ? '−' : ''}{fmtInt(Number(m.quantity))}</>}
                  </td>
                  <td className="px-3 py-1.5 text-right tabular-nums text-xs text-slate-400">
                    {m.direction === 'revalue'
                      ? <span className={Number(m.unit_cost_idr) >= 0 ? 'text-amber-300' : 'text-emerald-300'}>
                          {Number(m.unit_cost_idr) >= 0 ? '+' : '−'}{fmtInt(Math.abs(Number(m.unit_cost_idr)))}/unit
                        </span>
                      : Number(m.unit_cost_idr) > 0 ? fmtInt(Number(m.unit_cost_idr)) : '—'}
                  </td>
                  <td className="px-3 py-1.5 text-[11px] text-slate-500 whitespace-nowrap">{m.location ? warehouseLabel(warehouses, m.location) : '—'}</td>
                  <td className="px-3 py-1.5 text-[11px] text-slate-500 truncate max-w-[220px]">{m.source_type}{m.notes ? ` · ${m.notes}` : ''}</td>
                  <td className="px-3 py-1.5 text-[11px] text-slate-600 truncate max-w-[140px]">{m.created_by_email?.split('@')[0] ?? '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        {movements.length > 100 && <p className="px-4 py-2 text-[10px] text-slate-600">Showing the latest 100 of {fmtInt(movements.length)} movements.</p>}
      </div>
    </div>
  );
}

// ── Specs tab ────────────────────────────────────────────────────────────────
function SpecsTab({ comp, canEdit, onSaved }: {
  comp: Comp; canEdit: boolean; onSaved: (specs: Record<string, unknown>) => void;
}) {
  const supabase = createSupabaseClient();
  const specs = (comp.specifications ?? {}) as Record<string, unknown>;
  const readiness = specReadiness(comp.category, specs);
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState('');
  const [err, setErr] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const startEdit = () => { setText(JSON.stringify(specs, null, 2)); setErr(null); setEditing(true); };

  async function save() {
    let parsed: unknown;
    try {
      parsed = text.trim() === '' ? {} : JSON.parse(text);
    } catch (e) {
      setErr(`Not valid JSON — ${(e as Error).message}`);
      return;
    }
    if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
      setErr('Specs must be a JSON object: {"key": value, …}');
      return;
    }
    // Same normaliser as the Catalog spec editor and the seed: aliases →
    // canonical keys, numeric coercion, brand/model/prices stripped.
    const normalized = normalizeSpecs(comp.category, parsed as Record<string, unknown>);
    setSaving(true); setErr(null);
    const { error } = await supabase.from('3.0_components').update({ specifications: normalized }).eq('component_id', comp.component_id);
    setSaving(false);
    if (error) { setErr(error.message); return; }
    onSaved(normalized);
    setEditing(false);
  }

  return (
    <div className="space-y-4">
      {readiness.relevant && (
        <div className={`rounded-2xl border px-4 py-3 text-xs ${readiness.ready
          ? 'border-emerald-500/30 bg-emerald-500/[0.06] text-emerald-300'
          : 'border-amber-500/30 bg-amber-500/[0.06] text-amber-300'}`}>
          {readiness.ready
            ? '✓ Calculator-ready — this item carries every key its category’s sizing engine needs.'
            : <>Not calculator-ready — missing: <span className="font-mono">{readiness.missing.join(', ')}</span></>}
        </div>
      )}

      {canEdit && (
        <div className="flex justify-end">
          {!editing ? (
            <button onClick={startEdit}
              className="text-xs text-slate-400 hover:text-white px-3 py-1.5 border border-slate-700 rounded-lg hover:bg-slate-800 transition-colors">
              Edit/Add specs (JSON)
            </button>
          ) : null}
        </div>
      )}

      {editing ? (
        <div className="bg-slate-900/40 border border-slate-800/80 rounded-2xl p-4 space-y-2">
          <p className="text-[11px] text-slate-500">
            Pasted datasheet JSON is normalised on save — aliases become canonical keys, numbers are coerced, and <span className="font-mono">brand</span>/<span className="font-mono">model</span>/prices are stripped (they are columns, not specs).
          </p>
          <textarea value={text} onChange={(e) => setText(e.target.value)} rows={16} spellCheck={false}
            className="w-full px-3 py-2 rounded-xl bg-slate-950 border border-slate-800 focus:border-emerald-500/50 outline-none text-emerald-100/90 font-mono text-xs leading-relaxed" />
          {err && <p className="text-[11px] text-red-400">{err}</p>}
          <div className="flex justify-end gap-2">
            <button onClick={() => setEditing(false)} disabled={saving}
              className="px-3 py-1.5 rounded-lg text-xs text-slate-400 hover:text-white hover:bg-white/10 transition-colors">Cancel</button>
            <button onClick={save} disabled={saving}
              className="px-4 py-1.5 rounded-lg text-xs font-bold bg-emerald-600 hover:bg-emerald-500 text-white transition-colors disabled:opacity-50">
              {saving ? 'Saving…' : 'Save specs'}
            </button>
          </div>
        </div>
      ) : (
        <SpecRenderer specs={specs} modelName={descOf(comp)} />
      )}
    </div>
  );
}

// ── Economics tab (owner-only) ───────────────────────────────────────────────
function EconomicsTab({ componentId, comp, movements, saleItems, salesDocs, custNames, physical, avgCost }: {
  componentId: string; comp: Comp; movements: Movement[];
  saleItems: SaleItem[]; salesDocs: Map<string, SalesDoc>; custNames: Map<string, string>;
  physical: number; avgCost: number;
}) {
  const supabase = createSupabaseClient();
  const [loading, setLoading] = useState(true);
  const [position, setPosition] = useState<PositionRow | null>(null);
  const [dos, setDos] = useState<{ do_id: string; quote_id: string; status: string; delivered_at: string | null }[]>([]);
  const [doItems, setDoItems] = useState<{ do_id: string; so_item_id: string | null; qty: number }[]>([]);

  useEffect(() => {
    let liveFlag = true;
    (async () => {
      const [posRes, doRes, doiRes] = await Promise.all([
        // The SAME position engine as /profitability › Position — filtered, not reimplemented
        fetchTradePositions(supabase),
        supabase.from('24.0_delivery_orders').select('do_id, quote_id, status, delivered_at'),
        supabase.from('24.1_delivery_order_items').select('do_id, so_item_id, qty').eq('component_id', componentId),
      ]);
      if (!liveFlag) return;
      setPosition(posRes.rows.find((r) => r.component_id === componentId) ?? null);
      setDos((doRes.data ?? []) as { do_id: string; quote_id: string; status: string; delivered_at: string | null }[]);
      setDoItems((doiRes.data ?? []) as { do_id: string; so_item_id: string | null; qty: number }[]);
      setLoading(false);
    })();
    return () => { liveFlag = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [componentId]);

  // Sales facts for THIS item — the same basis as /profitability: revenue =
  // delivered DO lines × SO unit price (excl. PPN); COGS = the ledger's `out`
  // cost stamped at delivery (net of reversal ins), estimated at current avg
  // for legacy deliveries with no ledger rows.
  const facts = useMemo(() => {
    const priceOfSoItem = new Map(saleItems.map((i) => [i.item_id, Number(i.unit_price) || 0]));
    const ledger = new Map<string, { qty: number; cost: number }>();
    for (const m of movements) {
      if (m.source_type !== 'delivery' || !m.source_id) continue;
      const e = ledger.get(String(m.source_id)) ?? { qty: 0, cost: 0 };
      const sign = m.direction === 'out' ? 1 : -1;
      e.qty += sign * (Number(m.quantity) || 0);
      e.cost += sign * (Number(m.quantity) || 0) * (Number(m.unit_cost_idr) || 0);
      ledger.set(String(m.source_id), e);
    }
    const out: { date: string; qty: number; revenue: number; cogs: number; est: boolean; customer_id: string | null }[] = [];
    for (const d of dos) {
      if (d.status !== 'delivered') continue;
      const doc = salesDocs.get(d.quote_id);
      let qty = 0, revenue = 0;
      for (const li of doItems) {
        if (li.do_id !== d.do_id) continue;
        const q = Number(li.qty) || 0;
        qty += q;
        revenue += q * (li.so_item_id ? priceOfSoItem.get(li.so_item_id) ?? 0 : 0);
      }
      if (qty <= 0) continue;
      const led = ledger.get(d.do_id);
      let cogs: number; let est = false;
      if (led && led.qty > 0 && led.cost > 0) cogs = led.cost * (qty / led.qty);
      else { cogs = qty * avgCost; est = true; }
      out.push({ date: d.delivered_at ?? '', qty, revenue, cogs, est, customer_id: doc?.customer_id ?? null });
    }
    return out;
  }, [dos, doItems, saleItems, salesDocs, movements, avgCost]);

  const totals = useMemo(() => {
    const revenue = facts.reduce((s, f) => s + f.revenue, 0);
    const cogs = facts.reduce((s, f) => s + f.cogs, 0);
    const qty = facts.reduce((s, f) => s + f.qty, 0);
    const est = facts.some((f) => f.est);
    const lastSold = facts.map((f) => f.date).filter(Boolean).sort().at(-1) ?? null;
    const cutoff = new Date(); cutoff.setDate(cutoff.getDate() - 365);
    const iso = cutoff.toISOString();
    const cogs365 = facts.filter((f) => f.date && f.date >= iso).reduce((s, f) => s + f.cogs, 0);
    const stockValue = Math.max(0, physical) * avgCost;
    return {
      revenue, cogs, gp: revenue - cogs, qty, est, lastSold,
      margin: revenue > 0 ? ((revenue - cogs) / revenue) * 100 : null,
      turns: stockValue > 0 && cogs365 > 0 ? cogs365 / stockValue : null,
      stockValue,
    };
  }, [facts, physical, avgCost]);

  const byCustomer = useMemo(() => {
    const m = new Map<string, { name: string; revenue: number; gp: number; qty: number }>();
    for (const f of facts) {
      const id = f.customer_id ?? '·none';
      const e = m.get(id) ?? { name: custNames.get(id) ?? 'Unassigned', revenue: 0, gp: 0, qty: 0 };
      e.revenue += f.revenue; e.gp += f.revenue - f.cogs; e.qty += f.qty;
      m.set(id, e);
    }
    return [...m.values()].sort((a, b) => b.gp - a.gp);
  }, [facts, custNames]);

  const ageDays = daysSince(totals.lastSold);
  const ageBucket = ageDays == null ? 'never sold' : ageDays <= 90 ? '≤ 90d' : ageDays <= 180 ? '90–180d' : ageDays <= 365 ? '180–365d' : '> 365d';

  if (loading) {
    return <div className="space-y-2">{[...Array(3)].map((_, i) => <div key={i} className="h-28 bg-slate-800/40 rounded-2xl animate-pulse" />)}</div>;
  }

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 md:grid-cols-4 gap-2.5">
        <Kpi label="Realized GP · all time" value={facts.length ? fmtRupiah(totals.gp) : '—'}
          tone={totals.gp < 0 ? 'text-red-400' : 'text-emerald-300'}
          sub={totals.margin != null ? `${totals.margin.toFixed(1)}% margin${totals.est ? ' · ~ est. COGS' : ''}` : 'no deliveries yet'} />
        <Kpi label="Delivered revenue" value={facts.length ? fmtRupiah(totals.revenue) : '—'}
          sub={facts.length ? `${fmtInt(totals.qty)}${comp.unit ? ` ${comp.unit}` : ''} shipped` : 'GP realizes on delivery'} />
        <Kpi label="Turns (365d)" value={totals.turns != null ? `${totals.turns.toFixed(1)}×` : '—'}
          sub={totals.stockValue > 0 ? `stock value ${fmtRupiah(totals.stockValue)}` : 'nothing held'} />
        <Kpi label="Ageing" value={ageBucket} tone={ageDays != null && ageDays > 365 ? 'text-amber-300' : undefined}
          sub={totals.lastSold ? `last delivered ${fmtDay(totals.lastSold)}` : 'no delivery on record'} />
      </div>

      {/* GP per customer for this item */}
      <div className="bg-slate-900/40 border border-slate-800/80 rounded-2xl px-4 py-3.5">
        <h3 className="text-[11px] font-bold uppercase tracking-widest text-slate-500 mb-2">GP by customer · this item</h3>
        {byCustomer.length === 0 ? (
          <p className="text-[11px] text-slate-600 italic py-3">Deliver orders to see per-customer GP.</p>
        ) : (
          <div className="divide-y divide-slate-800/60">
            {byCustomer.slice(0, 10).map((c, i) => (
              <div key={i} className="flex items-center gap-3 py-2">
                <div className="min-w-0 flex-1">
                  <p className="text-xs text-slate-200 font-medium truncate">{c.name}</p>
                  <p className="text-[10px] text-slate-600 tabular-nums">{fmtInt(c.qty)}{comp.unit ? ` ${comp.unit}` : ''} delivered</p>
                </div>
                <div className="text-right flex-shrink-0">
                  <p className={`text-xs font-bold tabular-nums ${c.gp < 0 ? 'text-red-400' : 'text-emerald-300'}`}>{fmtRupiah(c.gp)}</p>
                  <p className="text-[10px] text-slate-600 tabular-nums">{fmtRupiah(c.revenue)}{c.revenue > 0 ? ` · ${((c.gp / c.revenue) * 100).toFixed(0)}%` : ''}</p>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Trade Position — the same blocks as /profitability › Position */}
      <div className="bg-slate-900/40 border border-slate-800/80 rounded-2xl px-4 py-3.5">
        <div className="flex items-baseline gap-2 flex-wrap mb-2.5">
          <h3 className="text-[11px] font-bold uppercase tracking-widest text-amber-400/80">Trade position · all time</h3>
          <span className="text-[10px] text-slate-600">a recovery threshold, never inventory valuation — 30.1 avg cost stays the cost of record</span>
        </div>
        {position ? <PositionDetail r={position} /> : (
          <p className="text-[11px] text-slate-600 italic py-3">No trade history — nothing bought or invoiced yet.</p>
        )}
      </div>

      <p className="text-[10px] text-slate-600">
        Basis mirrors Profitability: revenue = delivered DO lines at their Sales Order price (excl. PPN); COGS = the ledger&apos;s moving-average landed
        cost stamped at delivery (~ = legacy delivery estimated at current avg). GP realizes on delivery, not on invoice.
      </p>
    </div>
  );
}
