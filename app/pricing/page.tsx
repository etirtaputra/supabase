/**
 * ICAPROC — Sell-side: Pricing (Module 2 finish)
 * Tier management for owner + sell_admin (canManagePricing):
 *  - Tiers: CRUD the 21.0 tier set — name, code, markup step %, margin floor,
 *    reorder, active — with live counts (customers on the tier, item overrides,
 *    items priced below the floor). Renaming a tier code migrates the
 *    customers that carry it. Pricing model = markup chain (lib/tierPricing):
 *    first active tier is the NET price entered on the item; each next tier =
 *    previous ÷ (1 − step%), rounded up to Rp 1,000.
 *  - Floor audit: every item × active tier where the effective price sits
 *    below the tier's margin floor vs landed cost (moving-avg from 30.1).
 *    Surfaces the economic consequence (margin at risk on current stock) and
 *    fixes are one click: raise to the compliant minimum, or clear a bad
 *    override. Bulk "raise all" for the whole list.
 *  - Overrides: every 21.1 per-item override in one searchable table, with
 *    the default it replaces and one-click clear.
 * Per-item price ENTRY stays in the Catalog's Pricing Mode — this page manages
 * the tier system itself. Margin data is internal-only, never client-facing.
 */
'use client';
import { Fragment, Suspense, useState, useEffect, useMemo, useCallback } from 'react';
import { createSupabaseClient } from '@/lib/supabase';
import { fetchAllComponents, selectAll } from '@/lib/fetchAllRows';
import { useAuth } from '@/hooks/useAuth';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { ROLE_PERMISSIONS } from '@/constants/roles';
import { canOpenPath } from '@/constants/navigation';
import BrandMenu from '@/components/ui/BrandMenu';
import CopyButton from '@/components/ui/CopyButton';
import { useT } from '@/hooks/useT';
import { computeTierChain, roundUpToStep } from '@/lib/tierPricing';
import { issuesFor, matchesIssues, matchesScope, marginPct, belowFloor,
         compareCells, suggestRange, ISSUE_LABEL, SCOPE_LABEL,
         type PriceIssue, type PriceScope, type SortDir } from '@/lib/priceGrid';
import {
  fetchMarginProfiles, byId as marginById, bandOf, assignProfile, type MarginProfile,
} from '@/lib/marginProfiles';
import { fmtDay, fmtInt, fmtMoneyCell, fmtRupiah, moneyUnit } from '@/lib/formatters';
import { formatCategory } from '@/lib/formatCategory';
import { useSettings } from '@/hooks/useSettings';
import { useSupabaseData } from '@/hooks/useSupabaseData';
import { computeTUCMap, getComponentCost, fxFromHistory } from '@/lib/computeTUC';
import { deriveExchangeRates } from '@/lib/exchangeRates';
import { resolveCost, BASIS_NOTE, BASIS_TAG, type ResolvedCost } from '@/lib/costBasis';
import { incomingCosts, costRise, type CostRise } from '@/lib/incomingCost';
import RiseNote from '@/components/ui/RiseNote';
import { BAR_SELECT, BAR_INPUT, BAR_BTN, BAR_BTN_OFF, BAR_BTN_ON, BAR_BTN_ON_SKY } from '@/constants/controls';
import { usePageTitle } from '@/hooks/usePageTitle';
import PricesTab, { type FloorBreach } from '@/components/ui/PricesTab';
import { useSearchParams } from 'next/navigation';
import { poTimelines, productLeadTimes, type LtPo, type LtQuote, type LtCost, type LtGrn, type ProductLead } from '@/lib/supplierLeadTimes';
import { PRINCIPAL_CATS } from '@/constants/costCategories';

interface Tier {
  tier_id: string; tier_code: string; name: string;
  default_discount_pct: number; margin_floor_pct: number;
  sort_order: number; is_active: boolean; updated_by_email?: string;
}
interface Override {
  price_id: string; component_id: string; tier_id: string;
  override_price_idr: number | null; override_discount_pct: number | null;
  updated_at: string | null; updated_by_email: string | null;
}
interface Comp {
  component_id: string; supplier_model: string; internal_description: string | null;
  category: string | null; unit: string | null; selling_price_idr: number | null;
  margin_profile_id: string | null; norm_value: number | null;
}
/** A goods-in movement: landed cost per unit, stamped by the receive page. */
interface Receipt { component_id: string; unit_cost_idr: number | null; moved_at: string; source_id: string | null; quantity: number | null }
interface Bal { component_id: string; qty_on_hand: number; avg_cost_idr: number | null; }
/** One logged price change (21.3, written by triggers — see the migration). */
interface PriceLog {
  history_id: string; component_id: string; tier_id: string | null;
  old_price_idr: number | null; new_price_idr: number | null;
  cost_idr: number | null; target_min_pct: number | null; target_max_pct: number | null;
  changed_at: string; changed_by_email: string | null;
}

const descOf = (c: Comp) => (c.internal_description && c.internal_description.trim()) || c.supplier_model || '(no description)';
const num = (v: unknown): number | null => {
  if (v === '' || v === null || v === undefined) return null;
  const n = Number(String(v).replace(/[, ]/g, ''));
  return isNaN(n) ? null : n;
};
// Compliant minimum sell price for a floor: cost / (1 − floor%). Rounded UP to
// the configured price step so the suggestion is a clean quotable number.
const minPriceFor = (cost: number, floorPct: number): number | null => {
  if (floorPct >= 95) return null; // nonsense floor — don't divide by ~0
  return roundUpToStep(cost / (1 - floorPct / 100));
};

type Tab = 'prices' | 'set' | 'history';

interface Violation {
  comp: Comp; tier: Tier; price: number; cost: number; gp: number;
  minPrice: number | null; onHand: number; leakage: number;
  ov: Override | null;          // override behind this price, if any
  defaultCompliant: boolean;    // clearing the override would already fix it
  /**
   * The cost behind this breach is a SUPPLIER QUOTE, not a landed cost.
   *
   * It still belongs in the audit — a quote is the best evidence we have for
   * an item nothing has landed for, and a price under the floor on that basis
   * is very likely under it in reality too, because the real cost will only be
   * HIGHER once freight and duty are in. But it is not proven, and the leakage
   * rupiah is not real money yet, so it is counted separately.
   */
  provisional: boolean;
  /** Judged on the next order's estimated cost (it is dearer than the basis), not the stock in hand. */
  onIncoming: boolean;
}

/** The page reads ?filter= from the URL, which Next.js only allows inside a Suspense boundary. */
export default function PricingPageShell() {
  return <Suspense fallback={null}><PricingPage /></Suspense>;
}

function PricingPage() {
  const supabase = createSupabaseClient();
  const router = useRouter();
  const { t } = useT();
  // /pricing?filter=floor — the tier cards in Settings › Pricing link here.
  const searchParams = useSearchParams();
  const initialFilter = searchParams.get('filter') ?? undefined;
  const { user, profile, loading: authLoading } = useAuth();
  const canManage = !!profile && ROLE_PERMISSIONS[profile.role].canManagePricing;
  // The house rounding step (Settings › Pricing). Read through the hook rather
  // than getSettings() so the grid re-renders when an admin changes it.
  const { priceRoundingStep } = useSettings();
  const canManageUsers = !!profile && ROLE_PERMISSIONS[profile.role].canManageUsers;   // owner — Settings

  const [tiers, setTiers] = useState<Tier[]>([]);
  const [overrides, setOverrides] = useState<Override[]>([]);
  const [comps, setComps] = useState<Comp[]>([]);
  const [bals, setBals] = useState<Map<string, Bal>>(new Map());
  const [priceLog, setPriceLog] = useState<Map<string, PriceLog[]>>(new Map());
  const [allLog, setAllLog] = useState<PriceLog[]>([]);
  const logCount = allLog.length;
  const [loading, setLoading] = useState(true);
  const [schemaMissing, setSchemaMissing] = useState(false);
  // Prices answers the owner's three questions on one row and is where the
  // screen opens (2026-10-22); Set Pricing stays for editing every tier at once.
  const [tab, setTab] = useState<Tab>('prices');
  const [receipts, setReceipts] = useState<Receipt[]>([]);
  const [grns, setGrns] = useState<LtGrn[]>([]);
  const [marginProfiles, setMarginProfiles] = useState<MarginProfile[]>([]);
  /** Reads, and hands back the state update — see `fetchAll` below for why. (The per-profile
   *  tally moved to Settings › Pricing with the profiles themselves.) */
  const loadMarginProfiles = useCallback(async (): Promise<() => void> => {
    const profiles = await fetchMarginProfiles(supabase);
    return () => { setMarginProfiles(profiles); };
  }, []);   // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    let live = true;
    void loadMarginProfiles().then((apply) => { if (live) apply(); });
    return () => { live = false; };
  }, [loadMarginProfiles]);
  /** Re-read the profiles after the Profiles tab edits one. */
  const refreshMarginProfiles = useCallback(async () => {
    (await loadMarginProfiles())();
  }, [loadMarginProfiles]);
  const [toast, setToast] = useState<string | null>(null);
  const flash = (m: string) => { setToast(m); setTimeout(() => setToast(null), 2600); };

  usePageTitle();
  useEffect(() => {
    if (authLoading) return;
    if (!user) { router.replace(`/login?next=${encodeURIComponent('/pricing')}`); return; }
    if (profile && !canOpenPath(ROLE_PERMISSIONS[profile.role], '/pricing')) router.replace('/unauthorized');
  }, [authLoading, user, profile, router]);

  /**
   * Read everything, then hand back the state update rather than applying it.
   *
   * Why the two halves: this is started by an effect, and a response that
   * arrives after that effect has been torn down must be DROPPED — otherwise
   * two loads in flight let the slower one win and the screen settles on data
   * nobody asked for. Returning the apply step is what gives the caller
   * somewhere to make that decision. (It is also what
   * `react-hooks/set-state-in-effect` is asking for: no state written on the
   * effect's own call path.)
   *
   * The spinner is raised by the CALLER — `refresh()` below, or the initial
   * `useState(true)` — for the same reason.
   */
  const fetchAll = useCallback(async (): Promise<() => void> => {
    const [tierRes, ovRes, allComps, balRes, logRes, rcRes, grnRes] = await Promise.all([
      supabase.from('21.0_price_tiers').select('*').order('sort_order'),
      supabase.from('21.1_item_tier_prices').select('price_id, component_id, tier_id, override_price_idr, override_discount_pct, updated_at, updated_by_email'),
      // ARCHIVED ITEMS ARE NOT PRICED (owner, 2026-09-09). A retired item has
      // no selling price worth setting, no margin floor worth auditing and no
      // tier override worth keeping — so it does not belong on any tab of this
      // screen. Archiving is a CATALOGUE decision made in the Item Editor, the
      // same reasoning /products has carried since the feature shipped.
      fetchAllComponents<Comp>(supabase, 'component_id, supplier_model, internal_description, category, unit, selling_price_idr, margin_profile_id, norm_value',
        { activeOnly: true }),
      supabase.from('30.1_stock_balances').select('component_id, qty_on_hand, avg_cost_idr'),
      // Newest first; capped because this only feeds a per-row popover, and the
      // table grows one row per price change forever.
      supabase.from('21.3_item_price_history')
        .select('history_id, component_id, tier_id, old_price_idr, new_price_idr, cost_idr, target_min_pct, target_max_pct, changed_at, changed_by_email')
        .order('changed_at', { ascending: false }).limit(1000),
      // Goods received at landed cost — the newest cost of an item whose PO is
      // not paid yet (Prices tab). And receipt dates, for lead times.
      selectAll<Receipt>((f, t) => supabase.from('30.0_stock_movements')
        .select('component_id, unit_cost_idr, moved_at, source_id, quantity')
        .eq('source_type', 'receipt').eq('direction', 'in').order('movement_id').range(f, t)),
      selectAll<LtGrn>((f, t) => supabase.from('30.2_goods_receipts').select('po_id, received_at').order('grn_id').range(f, t)),
    ]);
    if (tierRes.error) return () => { setSchemaMissing(true); setLoading(false); };
    const bm = new Map<string, Bal>();
    for (const b of (balRes.data as Bal[]) ?? []) {
      // Single warehouse today, but 30.1 is keyed (component, location) — sum
      // on-hand and keep the cost of the largest holding if locations differ.
      const prev = bm.get(b.component_id);
      if (!prev) bm.set(b.component_id, { ...b });
      else bm.set(b.component_id, {
        component_id: b.component_id,
        qty_on_hand: (Number(prev.qty_on_hand) || 0) + (Number(b.qty_on_hand) || 0),
        avg_cost_idr: (Number(b.qty_on_hand) || 0) > (Number(prev.qty_on_hand) || 0) ? b.avg_cost_idr : prev.avg_cost_idr,
      });
    }
    // Index the log by item once, so a row's popover is a map lookup.
    const lm = new Map<string, PriceLog[]>();
    for (const l of (logRes.data as PriceLog[]) ?? []) {
      const list = lm.get(l.component_id);
      if (list) list.push(l); else lm.set(l.component_id, [l]);
    }
    return () => {
      setReceipts(rcRes.data ?? []);
      setGrns(grnRes.data ?? []);
      setAllLog((logRes.data as PriceLog[]) ?? []);
      setPriceLog(lm);
      setTiers((tierRes.data as Tier[]) ?? []);
      setOverrides((ovRes.data as Override[]) ?? []);
      setComps(allComps);
      setBals(bm);
      setLoading(false);
    };
  }, []);

  /** Re-read on demand, after an edit on this screen. */
  const refresh = useCallback(() => {
    setLoading(true);
    void fetchAll().then((apply) => { apply(); });
  }, [fetchAll]);

  useEffect(() => {
    if (!canManage) return;
    let live = true;
    void fetchAll().then((apply) => { if (live) apply(); });
    return () => { live = false; };
  }, [canManage, fetchAll]);

  // ── Derived pricing model ──────────────────────────────────────────────────
  const ovByKey = useMemo(() => {
    const m = new Map<string, Override>();
    for (const o of overrides) m.set(`${o.component_id}:${o.tier_id}`, o);
    return m;
  }, [overrides]);
  const compById = useMemo(() => new Map(comps.map((c) => [c.component_id, c])), [comps]);
  const tierById = useMemo(() => new Map(tiers.map((t) => [t.tier_id, t])), [tiers]);

  // Markup chain (lib/tierPricing): item's entered price = Tier-1 NET; each
  // next ACTIVE tier = previous ÷ (1 − step%), rounded up to Rp 1,000.
  // excludeTierId computes the chain as if that tier's override were cleared.
  const activeSorted = useMemo(() => tiers.filter((t) => t.is_active).sort((a, b) => a.sort_order - b.sort_order), [tiers]);
  const chainFor = useCallback((c: Comp, excludeTierId?: string) =>
    computeTierChain(c.selling_price_idr, activeSorted, (tid) => {
      if (excludeTierId && tid === excludeTierId) return null;
      return ovByKey.get(`${c.component_id}:${tid}`)?.override_price_idr;
    }), [activeSorted, ovByKey]);

  const stockOf = useCallback(
    (cid: string): number => Math.max(0, Number(bals.get(cid)?.qty_on_hand) || 0), [bals]);

  /**
   * THE COST BASIS — landed first, a supplier quote when nothing has landed.
   *
   * Owner, 2026-09-11: *"please also allow to reference not only Landed Cost,
   * but based on Quotes first. But once there's Landed Cost, it should use
   * Landed Cost."*
   *
   * Before this, cost on this screen meant one thing: the ledger's
   * moving-average landed cost. That is the right number — and 847 of 1,007
   * active items do not have one, because landed cost only exists after goods
   * have been received. So the margin column, the floor audit and every band
   * verdict were blank for 84% of the catalogue, on the screen whose entire
   * job is deciding what to charge.
   *
   * The fallback chain is NOT re-derived here: `getComponentCost` has resolved
   * settled-PO cost → supplier quote (with FX and staleness) since the Project
   * Quote builder shipped. `resolveCost` puts the ledger in front of it. One
   * sentence, one implementation — see lib/costBasis.ts for why a quote basis
   * is optimistic rather than merely uncertain.
   */
  const { data: catalog } = useSupabaseData();
  const fx = useMemo(
    () => fxFromHistory(catalog.pos, deriveExchangeRates(catalog.pos, catalog.poItems, catalog.poCosts, catalog.quotes), catalog.fxBenchmarks),
    [catalog.pos, catalog.poItems, catalog.poCosts, catalog.quotes, catalog.fxBenchmarks]);
  const tucMap = useMemo(() => computeTUCMap(catalog.pos, catalog.poItems, catalog.poCosts),
    [catalog.pos, catalog.poItems, catalog.poCosts]);

  const basisOf = useCallback((cid: string): ResolvedCost => {
    const ledger = Number(bals.get(cid)?.avg_cost_idr) || 0;
    // Skip the fallback entirely when the ledger already answers — it wins
    // outright, and getComponentCost walks history we would then discard.
    if (ledger > 0) return resolveCost(ledger, null);
    return resolveCost(null, getComponentCost(cid, tucMap, catalog.quotes, catalog.quoteItems, [], undefined, fx));
  }, [bals, tucMap, catalog.quotes, catalog.quoteItems, fx]);

  /** The number alone, for the arithmetic that does not care where it came from. */
  const costOf = useCallback((cid: string): number | null => basisOf(cid).cost, [basisOf]);

  /**
   * THE NEXT UNIT'S COST (owner, 2026-10-27 — EPEVER LR51100: the reorder PO
   * went up, Set Pricing still priced on the cheaper landed cost). An open PO
   * or a newer supplier quote, at its estimated landed cost; `riseOf` answers
   * only when that is dearer than the basis. See lib/incomingCost.ts.
   */
  const incomingByComp = useMemo(() => incomingCosts(
    { pos: catalog.pos, poItems: catalog.poItems, quotes: catalog.quotes, quoteItems: catalog.quoteItems, receipts }, fx),
  [catalog.pos, catalog.poItems, catalog.quotes, catalog.quoteItems, receipts, fx]);
  const riseOf = useCallback((cid: string): CostRise | null => costRise(basisOf(cid).cost, incomingByComp.get(cid)),
    [basisOf, incomingByComp]);
  const incomingOf = useCallback((cid: string) => incomingByComp.get(cid) ?? null, [incomingByComp]);
  const supplierNames = useMemo(() => new Map(catalog.suppliers.map((x) => [String(x.supplier_id), x.supplier_name])), [catalog.suppliers]);
  const supplierNameOf = useCallback((id: string | null) => (id ? supplierNames.get(id) ?? null : null), [supplierNames]);

  // ── Prices tab: cost history, lead time ───────────────────────────────────
  const poNumberById = useMemo(() => new Map(catalog.pos.map((p) => [String(p.po_id), p.po_number])), [catalog.pos]);
  const receivedByComp = useMemo(() => {
    const m = new Map<string, { label: string; date: string; unitCost: number }[]>();
    for (const r of receipts) {
      if (!(Number(r.unit_cost_idr) > 0)) continue;
      const e = { label: (r.source_id && poNumberById.get(String(r.source_id))) || 'GRN', date: r.moved_at, unitCost: Number(r.unit_cost_idr) };
      (m.get(r.component_id) ?? m.set(r.component_id, []).get(r.component_id)!).push(e);
    }
    return m;
  }, [receipts, poNumberById]);
  // A PO with no number comes back labelled "PO <uuid>" — that is noise, not a name; show the date alone.
  const paidOf = useCallback((cid: string) => (tucMap.get(cid)?.entries ?? [])
    .map((e) => ({ label: /^PO [0-9a-f-]{20,}$/i.test(e.label) ? '' : e.label, date: e.date, unitCost: e.unitCost })), [tucMap]);
  const receivedOf = useCallback((cid: string) => receivedByComp.get(cid) ?? [], [receivedByComp]);
  const basisCost = useCallback((cid: string) => { const b = basisOf(cid); return { cost: b.cost, provisional: b.provisional }; }, [basisOf]);
  const stockCostOf = useCallback((cid: string): number | null => Number(bals.get(cid)?.avg_cost_idr) || null, [bals]);
  const leadByComp = useMemo(() => {
    const today = new Date().toISOString().slice(0, 10);
    const timelines = poTimelines({
      pos: catalog.pos as unknown as LtPo[], quotes: catalog.quotes as unknown as LtQuote[],
      costs: (catalog.poCosts as unknown as LtCost[]).filter((c) => PRINCIPAL_CATS.has(c.cost_category)), grns, today,
    });
    return new Map<string, ProductLead>(productLeadTimes(timelines, catalog.poItems, today).map((l) => [l.componentId, l]));
  }, [catalog.pos, catalog.quotes, catalog.poCosts, catalog.poItems, grns]);
  const leadOf = useCallback((cid: string) => leadByComp.get(cid) ?? null, [leadByComp]);
  const chainAt = useCallback((cid: string, net: number | null) => computeTierChain(net, activeSorted,
    (tid) => ovByKey.get(`${cid}:${tid}`)?.override_price_idr), [activeSorted, ovByKey]);

  // Every (item, active tier) whose effective price sits below the tier floor.
  const violations: Violation[] = useMemo(() => {
    const out: Violation[] = [];
    for (const c of comps) {
      const basis = basisOf(c.component_id);
      // Replacement cost (owner, 2026-10-27): when the reorder or a newer
      // quote is dearer, the floor is checked against THAT — a price that
      // clears the floor on the cheap stock in hand breaches it on the next
      // container. Same rule as Set Pricing.
      const rise = riseOf(c.component_id);
      const cost = rise ? rise.incoming.estLandedIdr : basis.cost;
      if (cost == null) continue;
      const onHand = Math.max(0, Number(bals.get(c.component_id)?.qty_on_hand) || 0);
      const chain = chainFor(c);
      for (const t of activeSorted) {
        const e = chain.get(t.tier_id);
        const price = e?.price ?? null;
        if (price == null || price <= 0) continue;
        const ov = e?.overridden ? (ovByKey.get(`${c.component_id}:${t.tier_id}`) ?? null) : null;
        const gp = marginPct(price, cost);
        if (gp == null || !belowFloor(gp, t.margin_floor_pct)) continue;
        const minPrice = minPriceFor(cost, t.margin_floor_pct || 0);
        // Would the chain default alone (this tier's override cleared) clear the floor?
        const defPrice = ov ? (chainFor(c, t.tier_id).get(t.tier_id)?.price ?? null) : null;
        const defaultCompliant = !!ov && defPrice != null && defPrice > 0 && !belowFloor(marginPct(defPrice, cost), t.margin_floor_pct);
        out.push({
          comp: c, tier: t, price, cost, gp, minPrice, onHand,
          // Leakage is money at stake on stock we are HOLDING. An item priced
          // off a quote has not landed, so its on-hand is ~0 and its leakage
          // is ~0 anyway — but the flag is what stops a provisional breach
          // being read as a settled one.
          leakage: minPrice != null ? Math.max(0, minPrice - price) * onHand : 0,
          ov, defaultCompliant,
          provisional: rise ? rise.incoming.provisional : basis.provisional,
          onIncoming: !!rise,
        });
      }
    }
    // Worst economics first: biggest at-stake rupiah, then deepest GP gap.
    return out.sort((a, b) => (b.leakage - a.leakage) || (a.gp - b.gp));
  }, [comps, activeSorted, bals, basisOf, riseOf, chainFor, ovByKey]);

  const totalLeakage = useMemo(() => violations.reduce((s, v) => s + v.leakage, 0), [violations]);
  // Prices tab: the Floor Audit and the Overrides list, per item (2026-10-22 — the tabs became filters).
  const floorByComp = useMemo(() => {
    const m = new Map<string, FloorBreach[]>();
    for (const v of violations) {
      const e: FloorBreach = { componentId: v.comp.component_id, tierId: v.tier.tier_id, tierName: v.tier.name, minPrice: v.minPrice, leakage: v.leakage, provisional: v.provisional, onIncoming: v.onIncoming };
      (m.get(e.componentId) ?? m.set(e.componentId, []).get(e.componentId)!).push(e);
    }
    return m;
  }, [violations]);
  const pinnedByComp = useMemo(() => {
    const m = new Map<string, { tierId: string; priceId: string }[]>();
    for (const o of overrides) {
      if (!(Number(o.override_price_idr) > 0)) continue;
      (m.get(o.component_id) ?? m.set(o.component_id, []).get(o.component_id)!).push({ tierId: o.tier_id, priceId: o.price_id });
    }
    return m;
  }, [overrides]);
  // ── Override writes ────────────────────────────────────────────────────────
  async function raiseToFloor(v: Violation) {
    if (v.minPrice == null) return;
    const { error } = await supabase.from('21.1_item_tier_prices').upsert(
      { component_id: v.comp.component_id, tier_id: v.tier.tier_id, override_price_idr: v.minPrice, override_discount_pct: null },
      { onConflict: 'component_id,tier_id' });
    if (error) { flash(`Failed: ${error.message}`); return; }
    flash(`${descOf(v.comp)} · ${v.tier.name} → ${fmtRupiah(v.minPrice)}`);
    refresh();
  }

  async function clearOverride(price_id: string, label?: string) {
    const { error } = await supabase.from('21.1_item_tier_prices').delete().eq('price_id', price_id);
    if (error) { flash(`Failed: ${error.message}`); return; }
    flash(label ?? 'Override cleared — back to the tier default');
    refresh();
  }

  const [bulkBusy, setBulkBusy] = useState(false);
  async function bulkRaise(list: Violation[]) {
    const fixable = list.filter((v) => v.minPrice != null);
    if (!fixable.length) return;
    setBulkBusy(true);
    const rows = fixable.map((v) => ({
      component_id: v.comp.component_id, tier_id: v.tier.tier_id,
      override_price_idr: v.minPrice, override_discount_pct: null,
    }));
    let failed = 0;
    for (let i = 0; i < rows.length; i += 200) {
      const { error } = await supabase.from('21.1_item_tier_prices')
        .upsert(rows.slice(i, i + 200), { onConflict: 'component_id,tier_id' });
      if (error) failed += Math.min(200, rows.length - i);
    }
    setBulkBusy(false);
    flash(failed ? `${rows.length - failed} raised, ${failed} failed` : `${rows.length} price${rows.length !== 1 ? 's' : ''} raised to the floor`);
    refresh();
  }

  // ── Set Pricing tab ────────────────────────────────────────────────────────
  const profileById = useMemo(() => marginById(marginProfiles), [marginProfiles]);

  /**
   * Write staged cells. Two destinations, because the model has two:
   * the NET tier IS the item's own price (3.0), every tier above it is an
   * override row (21.1). Clearing a cell above the net hands that tier back to
   * the markup chain rather than pinning it to zero.
   */
  const [savingRows, setSavingRows] = useState(false);
  const saveEdits = useCallback(async (
    edits: { component_id: string; tier_id: string | null; value: number | null }[],
  ): Promise<number> => {
    if (!edits.length) return 0;
    // Belt and braces. The route guard already keeps this page to owner and
    // sell_admin, but a price is not something to leave protected by markup
    // alone — every write path checks the capability itself.
    if (!canManage) { flash('You do not have permission to set prices.'); return edits.length; }
    setSavingRows(true);
    let failed = 0;
    try {
      // The net price, one item at a time — it lives on the component row.
      for (const e of edits.filter((x) => x.tier_id === null)) {
        const { error } = await supabase.from('3.0_components')
          .update({ selling_price_idr: e.value }).eq('component_id', e.component_id);
        if (error) failed += 1;
      }
      const ups = edits.filter((x) => x.tier_id !== null && x.value != null)
        .map((e) => ({ component_id: e.component_id, tier_id: e.tier_id as string,
                       override_price_idr: e.value, override_discount_pct: null }));
      for (let i = 0; i < ups.length; i += 200) {
        const { error } = await supabase.from('21.1_item_tier_prices')
          .upsert(ups.slice(i, i + 200), { onConflict: 'component_id,tier_id' });
        if (error) failed += Math.min(200, ups.length - i);
      }
      // A cleared cell is a deleted override, not a zero price.
      for (const e of edits.filter((x) => x.tier_id !== null && x.value == null)) {
        const { error } = await supabase.from('21.1_item_tier_prices').delete()
          .eq('component_id', e.component_id).eq('tier_id', e.tier_id as string);
        if (error) failed += 1;
      }
    } finally { setSavingRows(false); }
    const ok = edits.length - failed;
    flash(failed ? `${ok} saved, ${failed} failed` : `${ok} price${ok !== 1 ? 's' : ''} saved`);
    refresh();
    return failed;
  }, [supabase, refresh, canManage]);

  /**
   * Classify one item from the pricing grid. Which band an item belongs to is
   * the question that decides whether its price is right, so it is answered
   * here rather than sending someone back to the Item Editor — the screen this
   * whole tab exists to get pricing out of.
   */
  const assignItemProfile = useCallback(async (componentId: string, profileId: string | null) => {
    if (!canManage) { flash('You do not have permission to change categories.'); return; }
    const ok = await assignProfile(supabase, [componentId], profileId);
    flash(ok ? (profileId ? 'Category set' : 'Category cleared') : 'Could not set the category');
    // Both: `refresh` re-reads the items, `refreshMarginProfiles` re-tallies
    // how many sit on each profile — otherwise the Margin Profiles tab keeps
    // quoting a count that this very click just changed.
    if (ok) { refresh(); void refreshMarginProfiles(); }
  }, [supabase, refresh, refreshMarginProfiles, canManage]);

  if (authLoading || !profile || !canManage) {
    return <div className="min-h-screen bg-chrome flex items-center justify-center"><div className="w-6 h-6 border-2 border-emerald-500/30 border-t-emerald-500 rounded-full animate-spin" /></div>;
  }


  return (
    <div className="min-h-screen bg-chrome text-slate-200 font-sans text-sm">
      <div className="border-b border-slate-800/60 bg-chrome/80 backdrop-blur-md sticky top-0 z-30">
        <div className="max-w-[1200px] 2xl:max-w-[1760px] mx-auto px-3 sm:px-4 md:px-6 py-2.5 sm:py-3 flex flex-col sm:flex-row sm:items-center justify-between sm:flex-wrap gap-2.5 sm:gap-x-4 sm:gap-y-2.5">
          <BrandMenu wordmarkClass="text-xl md:text-2xl font-extrabold" subtitle="Set, tier and audit" />
          <div className="flex items-center gap-2 flex-wrap">
            <Link href="/purchasing" className="text-xs text-slate-400 hover:text-white px-3 py-1.5 border border-slate-700 rounded-lg hover:bg-slate-800 transition-colors whitespace-nowrap"
              title="Per-item price entry lives in the Catalog — toolbar → Pricing Mode">
              Per-item entry: Catalog →
            </Link>
            {canManageUsers && (
              <Link href="/settings?tab=pricing" className="text-xs text-slate-400 hover:text-white px-3 py-1.5 border border-slate-700 rounded-lg hover:bg-slate-800 transition-colors whitespace-nowrap"
                title="Price rounding, the default markup step, margin floor and customer tier live in Settings">
                Pricing defaults: Settings →
              </Link>
            )}
          </div>
        </div>
      </div>

      <main className="max-w-[1200px] 2xl:max-w-[1760px] mx-auto px-3 sm:px-4 md:px-6 py-4 sm:py-5 space-y-5">
        {schemaMissing ? (
          <div className="bg-amber-500/10 border border-amber-500/40 rounded-xl p-4 text-xs text-amber-200">
            Pricing tables are not set up yet — run <span className="font-mono">migrations/create_pricing_tiers.sql</span> in Supabase → SQL Editor.
          </div>
        ) : (
          <>
            {/* Tab bar — text-only underline, sell-side emerald */}
            {/* Seven tabs do not fit a phone: the row scrolls on its own rather than widening the page. */}
            <div className="flex items-center gap-5 border-b border-slate-800/80 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
              {/* Three tabs (owner, 2026-10-22): Prices does the daily work — below-floor and
                  pinned prices are its filters now; Bulk edit is the all-tiers grid; tiers and
                  margin profiles moved to Settings › Pricing. */}
              {([['prices', t('Prices')], ['set', t('Bulk edit')],
                ['history', `${t('Price history')}${logCount ? ` (${logCount})` : ''}`]] as [Tab, string][]).map(([k, label]) => (
                <button key={k} onClick={() => setTab(k)}
                  className={`pb-2.5 -mb-px text-[13px] whitespace-nowrap flex-shrink-0 transition-colors border-b-2 ${tab === k ? 'border-emerald-400 text-white font-bold' : 'border-transparent text-slate-500 hover:text-slate-300 font-medium'}`}>
                  {label}
                </button>
              ))}
              {/* A refresh that already has data to show says so here rather
                  than replacing the tab (see the skeleton condition below). */}
              {loading && comps.length > 0 && (
                <span className="ml-auto pb-2.5 text-[11px] text-slate-500 animate-pulse">Updating…</span>
              )}
            </div>

            {/* The skeleton is for the FIRST load only — when there is nothing
                to show yet. Raising it on every refresh UNMOUNTED the tab, and
                a tab that unmounts loses everything the person set up in it:
                the sort column, the filter chips, how far they had scrolled,
                and any price edits typed but not yet saved. Setting an item's
                margin profile calls refresh(), so classifying one item threw
                the whole view back to the top sorted by ITEM. Keeping the tab
                mounted with its previous rows costs one frame of stale data
                and keeps the person exactly where they were. */}
            {loading && comps.length === 0 ? (
              <div className="space-y-2">{[...Array(4)].map((_, i) => <div key={i} className="h-24 bg-slate-800/40 rounded-2xl animate-pulse" />)}</div>
            ) : tab === 'prices' ? (
              <PricesTab
                comps={comps.map((c) => ({ component_id: c.component_id, name: descOf(c), category: c.category, norm_value: c.norm_value, selling_price_idr: c.selling_price_idr }))}
                tiers={activeSorted} chainAt={chainAt} paidOf={paidOf} receivedOf={receivedOf} basisCost={basisCost}
                stockCost={stockCostOf} stockOf={stockOf} leadOf={leadOf} priceLog={priceLog} incomingOf={incomingOf} supplierNameOf={supplierNameOf}
                tierName={(tid) => (tid ? tierById.get(tid)?.name : activeSorted[0]?.name) ?? 'Net'}
                canManage={canManage} saving={savingRows}
                onSaveNet={(cid, v) => saveEdits([{ component_id: cid, tier_id: null, value: v }])}
                showPoNumbers={!!profile && ROLE_PERMISSIONS[profile.role].buySide}
                canSeeCompetitors={!!profile && ROLE_PERMISSIONS[profile.role].canViewCompetitorPrices && canOpenPath(ROLE_PERMISSIONS[profile.role], '/purchasing?tab=market-intel')}
                canOpenItem={!!profile && canOpenPath(ROLE_PERMISSIONS[profile.role], '/items')}
                roundStep={priceRoundingStep}
                floor={floorByComp} pinned={pinnedByComp} initialFilter={initialFilter}
                totalLeakage={totalLeakage} bulkBusy={bulkBusy}
                onRaise={(v) => { const x = violations.find((y) => y.comp.component_id === v.componentId && y.tier.tier_id === v.tierId); if (x) void raiseToFloor(x); }}
                onRaiseAll={() => void bulkRaise(violations)}
                onUnpin={(priceId) => void clearOverride(priceId, t('Unpinned: the tier follows the net price again'))} />
            ) : tab === 'set' ? (
              <SetPricingTab comps={comps} tiers={activeSorted} chainFor={chainFor} costOf={costOf} basisOf={basisOf} riseOf={riseOf}
                stockOf={stockOf}
                profileById={profileById} ovByKey={ovByKey} saving={savingRows} onSave={saveEdits}
                onAssignProfile={assignItemProfile} canManage={canManage}
                roundStep={priceRoundingStep} priceLog={priceLog}
                supplierNameOf={supplierNameOf} showPoNumbers={!!profile && ROLE_PERMISSIONS[profile.role].buySide} />
            ) : (
              <PriceHistoryTab log={allLog} compById={compById} tiers={tiers} />
            )}
          </>
        )}
      </main>

      {toast && <div className="fixed bottom-6 right-6 z-[110] px-4 py-2.5 bg-slate-800 border border-slate-700 text-white text-sm font-semibold rounded-xl shadow-lg max-w-[90vw] truncate">{toast}</div>}
    </div>
  );
}

/**
 * One chip renderer for both filter groups. A count of zero is dimmed and
 * inert: a chip that looks live and filters to an empty table is a small lie,
 * and on a bar this wide there are usually two or three of them.
 *
 * Module scope, not inside the tab: a component declared during render is a
 * new component type every render, so React remounts it and it loses state.
 */
function Chip({ label, count, on, tone, onClick }: {
  label: string; count: number; on: boolean; tone: 'issue' | 'scope'; onClick: () => void;
}) {
  const dead = count === 0 && !on;
  return (
    <button type="button" disabled={dead} onClick={onClick}
      className={`${BAR_BTN} gap-1.5 pl-2.5 pr-2 ${
        dead ? 'bg-slate-800/40 border-slate-800 text-slate-600 cursor-default'
        : on ? (tone === 'issue' ? BAR_BTN_ON : BAR_BTN_ON_SKY)
        : BAR_BTN_OFF}`}>
      {label}
      <span className={`tabular-nums text-[11px] font-semibold px-1 rounded ${
        dead ? 'text-slate-700' : on ? 'bg-black/25' : 'text-slate-500'}`}>{fmtInt(count)}</span>
    </button>
  );
}

/**
 * A sortable header. First click sorts ascending, clicking again flips.
 * Module scope for the same reason as Chip.
 */
function SortTh({ col, label, sortCol, sortDir, onSort, align = 'left', className = '' }: {
  col: string; label: string; sortCol: string; sortDir: SortDir;
  onSort: (col: string) => void; align?: 'left' | 'right'; className?: string;
}) {
  const on = sortCol === col;
  return (
    <th className={`px-3 py-2 font-semibold ${align === 'right' ? 'text-right' : 'text-left'} ${className}`}>
      <button type="button" onClick={() => onSort(col)}
        className={`inline-flex items-center gap-1 uppercase tracking-wide transition-colors ${
          on ? 'text-slate-100' : 'text-slate-400 hover:text-slate-200'}`}>
        {label}
        <span className={`text-[9px] leading-none ${on ? 'opacity-100' : 'opacity-0'}`} aria-hidden>
          {on && sortDir === 'desc' ? '▼' : '▲'}
        </span>
      </button>
    </th>
  );
}

// ── Set Pricing ───────────────────────────────────────────────────────────────
/**
 * One row per item, one column per active tier, edit and save.
 *
 * This was a MODE on the Item Editor until 2026-08-29 (owner: "it's too
 * cluttered"). Pricing 990 items is its own job, and it belongs beside the
 * tier ladder and the margin bands that decide what a price should be — not
 * bolted onto a grid that already carries brand, specs, suppliers and stock.
 *
 * The columns follow the markup chain: the FIRST active tier is the item's own
 * net price (3.0_components.selling_price_idr); each tier above it shows the
 * computed price as a placeholder, and typing pins an override (21.1). Empty a
 * pinned cell and the tier goes back to the chain.
 */
function SetPricingTab({
  comps, tiers, chainFor, costOf, basisOf, riseOf, stockOf, profileById, ovByKey, saving, onSave, onAssignProfile, canManage, roundStep, priceLog,
  supplierNameOf, showPoNumbers,
}: {
  comps: Comp[];
  tiers: Tier[];
  chainFor: (c: Comp, excludeTierId?: string) => Map<string, { price: number | null; overridden: boolean }>;
  costOf: (cid: string) => number | null;
  basisOf: (cid: string) => ResolvedCost;
  /** The reorder / newer quote is dearer than the basis — null otherwise. */
  riseOf: (cid: string) => CostRise | null;
  stockOf: (cid: string) => number;
  profileById: Map<string, MarginProfile>;
  ovByKey: Map<string, Override>;
  saving: boolean;
  onSave: (edits: { component_id: string; tier_id: string | null; value: number | null }[]) => Promise<number>;
  onAssignProfile: (componentId: string, profileId: string | null) => void;
  /** owner / sell_admin. Anyone else reads the grid and cannot change it. */
  canManage: boolean;
  /** Settings › Pricing rounding step — the suggestion lands on a multiple. */
  roundStep: number;
  /** Logged price changes per component, newest first (21.3). */
  priceLog: Map<string, PriceLog[]>;
  supplierNameOf: (supplierId: string | null) => string | null;
  /** PO numbers are buy-side detail — same rule as the Prices tab. */
  showPoNumbers: boolean;
}) {
  const { t, tf } = useT();
  const [search, setSearch] = useState('');
  const [wanted, setWanted] = useState<Set<PriceIssue>>(new Set());
  // Scope ANDs with the issue chips — see lib/priceGrid.matchesScope.
  const [scope, setScope] = useState<Set<PriceScope>>(new Set());
  // "Cost rising" — narrows like a scope chip: only items whose next units cost more.
  const [risingOnly, setRisingOnly] = useState(false);
  // '' = every category, 'none' = the unclassified pile, else a profile id.
  const [profileFilter, setProfileFilter] = useState<string>('');
  // The PRODUCT category (3.0_components.category) — distinct from the margin
  // profile beside it. '' = all, 'none' = items with no category set.
  const [catFilter, setCatFilter] = useState<string>('');
  const [sortCol, setSortCol] = useState<string>('item');
  const [sortDir, setSortDir] = useState<SortDir>('asc');
  // Staged cells: `${component_id}:${tier_id | 'net'}` → what is in the box.
  const [draft, setDraft] = useState<Record<string, string>>({});
  const [page, setPage] = useState(200);
  /** Which row has its price log open. One at a time — this is a reference. */
  const [openLog, setOpenLog] = useState<string | null>(null);

  const netTierId = tiers[0]?.tier_id ?? null;
  const keyOf = (cid: string, tid: string) => `${cid}:${tid === netTierId ? 'net' : tid}`;

  const rows = useMemo(() => {
    const needle = search.trim().toLowerCase();
    return comps.map((c) => {
      const chain = chainFor(c);
      const priceByTier = new Map<string, number | null>();
      for (const t of tiers) priceByTier.set(t.tier_id, chain.get(t.tier_id)?.price ?? null);
      const basis = basisOf(c.component_id);
      // PRICE TO REPLACEMENT COST: when the reorder or a newer quote is dearer,
      // every margin on this tab (tier GP, GP column, floors, band suggestion)
      // is judged on the next unit's cost, not the cheaper stock on hand. The
      // cell still shows the basis, with the rise beneath it.
      const rise = riseOf(c.component_id);
      const cost = rise ? rise.incoming.estLandedIdr : basis.cost;
      const qty = stockOf(c.component_id);
      const profile = c.margin_profile_id ? profileById.get(c.margin_profile_id) ?? null : null;
      return {
        c, chain, priceByTier, cost, basis, rise, qty, profile,
        issues: issuesFor({ net: c.selling_price_idr, cost, priceByTier, tiers, profile }),
        gp: marginPct(c.selling_price_idr, cost),
      };
    }).filter((r) => {
      if (!matchesIssues(r.issues, wanted)) return false;
      if (!matchesScope({ qtyOnHand: r.qty, cost: r.basis.cost, provisional: r.basis.provisional }, scope)) return false;
      if (risingOnly && !r.rise) return false;
      if (profileFilter === 'none' ? r.profile != null
        : profileFilter !== '' && r.profile?.id !== profileFilter) return false;
      if (catFilter === 'none' ? Boolean(r.c.category)
        : catFilter !== '' && r.c.category !== catFilter) return false;
      if (!needle) return true;
      return `${r.c.supplier_model} ${r.c.internal_description ?? ''} ${r.c.category ?? ''}`
        .toLowerCase().includes(needle);
    }).sort((x, y) => {
      const cell = (r: typeof x): number | string | null => {
        if (sortCol === 'item') return descOf(r.c);
        if (sortCol === 'cost') return r.cost;
        if (sortCol === 'qty') return r.qty;
        if (sortCol === 'gp') return r.gp;
        if (sortCol === 'lastset') return priceLog.get(r.c.component_id)?.[0]?.changed_at ?? null;
        // Unclassified has no label, so it sorts as empty and sinks — which is
        // also where it belongs in a list you are working down. Keyed 'profile',
        // not 'category': in ICAPROC "category" is the PRODUCT category.
        if (sortCol === 'profile') return r.profile?.label ?? null;
        if (sortCol.startsWith('tier:')) return r.priceByTier.get(sortCol.slice(5)) ?? null;
        return null;
      };
      const c = compareCells(cell(x), cell(y), sortDir);
      // Ties fall back to the name, so the order never shuffles between renders.
      return c !== 0 ? c : compareCells(descOf(x.c), descOf(y.c), 'asc');
    });
  }, [comps, tiers, chainFor, basisOf, riseOf, stockOf, profileById, search, wanted, scope, risingOnly, profileFilter, catFilter, sortCol, sortDir, priceLog]);

  // Counts sit on the chips, so the size of each problem is visible before
  // anyone clicks — that is what makes this a worklist rather than a filter.
  const counts = useMemo(() => {
    const m = new Map<PriceIssue, number>();
    for (const c of comps) {
      const chain = chainFor(c);
      const priceByTier = new Map<string, number | null>();
      for (const t of tiers) priceByTier.set(t.tier_id, chain.get(t.tier_id)?.price ?? null);
      const profile = c.margin_profile_id ? profileById.get(c.margin_profile_id) ?? null : null;
      const cost = riseOf(c.component_id)?.incoming.estLandedIdr ?? costOf(c.component_id);
      for (const i of issuesFor({ net: c.selling_price_idr, cost, priceByTier, tiers, profile })) {
        m.set(i, (m.get(i) ?? 0) + 1);
      }
    }
    return m;
  }, [comps, tiers, chainFor, costOf, riseOf, profileById]);
  const risingCount = useMemo(() => comps.filter((c) => riseOf(c.component_id)).length, [comps, riseOf]);

  const categories = useMemo(() => {
    const m = new Map<string, number>();
    for (const c of comps) m.set(c.category ?? '', (m.get(c.category ?? '') ?? 0) + 1);
    return [...m.entries()]
      .map(([value, count]) => ({ value, count, label: value ? formatCategory(value) : 'No category' }))
      .sort((a, b) => a.label.localeCompare(b.label));
  }, [comps]);

  const scopeCounts = useMemo(() => {
    const m = new Map<PriceScope, number>();
    for (const c of comps) {
      const b = basisOf(c.component_id);
      const facts = { qtyOnHand: stockOf(c.component_id), cost: b.cost, provisional: b.provisional };
      for (const k of ['in_stock', 'landed_cost', 'quoted_cost', 'no_cost'] as PriceScope[]) {
        if (matchesScope(facts, new Set([k]))) m.set(k, (m.get(k) ?? 0) + 1);
      }
    }
    return m;
  }, [comps, stockOf, basisOf]);

  const editsFor = useCallback((cids: string[]): { component_id: string; tier_id: string | null; value: number | null }[] => {
    const out: { component_id: string; tier_id: string | null; value: number | null }[] = [];
    for (const [k, raw] of Object.entries(draft)) {
      const [cid, tpart] = [k.slice(0, k.lastIndexOf(':')), k.slice(k.lastIndexOf(':') + 1)];
      if (!cids.includes(cid)) continue;
      out.push({ component_id: cid, tier_id: tpart === 'net' ? null : tpart, value: num(raw) });
    }
    return out;
  }, [draft]);

  const dirtyCids = useMemo(
    () => [...new Set(Object.keys(draft).map((k) => k.slice(0, k.lastIndexOf(':'))))], [draft]);

  const commit = async (cids: string[]) => {
    const edits = editsFor(cids);
    if (!edits.length) return;
    await onSave(edits);
    setDraft((d) => {
      const next = { ...d };
      for (const k of Object.keys(next)) if (cids.includes(k.slice(0, k.lastIndexOf(':')))) delete next[k];
      return next;
    });
  };

  const onSort = useCallback((col: string) => {
    setSortDir((d) => (sortCol === col && d === 'asc' ? 'desc' : 'asc'));
    setSortCol(col);
  }, [sortCol]);

  const toggle = <T,>(set: Set<T>, v: T) => {
    const next = new Set(set); if (next.has(v)) next.delete(v); else next.add(v); return next;
  };

  return (
    <div className="space-y-3">
      {/* Toolbar: what you are looking at, and what you are about to save.
          The result count sits here rather than on its own line — it belongs
          to the search box, not to the filters below it. */}
      <div className="flex flex-wrap items-center gap-2">
        <input value={search} onChange={(e) => { setSearch(e.target.value); setPage(200); }}
          placeholder="Search item, model or category…"
          className={`w-full sm:w-72 ${BAR_INPUT}`} />
        <select value={catFilter} onChange={(e) => { setCatFilter(e.target.value); setPage(200); }}
          title="Product category"
          className={BAR_SELECT}>
          <option value="">All categories</option>
          {categories.map((c) => (
            <option key={c.value || 'none'} value={c.value || 'none'}>{c.label} ({c.count})</option>
          ))}
        </select>
        <select value={profileFilter} onChange={(e) => { setProfileFilter(e.target.value); setPage(200); }}
          title="Margin profile — what the item is supposed to earn"
          className={BAR_SELECT}>
          <option value="">All margin profiles</option>
          {[...profileById.values()].map((pr) => (
            <option key={pr.id} value={pr.id}>{pr.label} · {bandOf(pr)}</option>
          ))}
          <option value="none">Unclassified</option>
        </select>
        <span className="text-xs text-slate-500 tabular-nums whitespace-nowrap">
          {rows.length === comps.length ? `${fmtInt(comps.length)} items` : `${fmtInt(rows.length)} of ${fmtInt(comps.length)}`}
        </span>
        {dirtyCids.length > 0 && (
          <span className="ml-auto flex items-center gap-2">
            <button type="button" disabled={saving} onClick={() => setDraft({})}
              title="Put every box back to its saved value"
              className="px-2.5 py-1.5 rounded-lg border border-slate-700 text-slate-400 hover:text-slate-200 hover:border-slate-600 text-[12px] font-semibold disabled:opacity-50 whitespace-nowrap">
              {t('Undo all')}
            </button>
            <button type="button" disabled={saving} onClick={() => commit(dirtyCids)}
              className="px-3 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white text-[12px] font-bold disabled:opacity-50 whitespace-nowrap">
              {saving ? t('Saving…') : tf('Save all ({n})', { n: dirtyCids.length })}
            </button>
          </span>
        )}
      </div>

      {!canManage && (
        <p className="text-[12px] text-amber-300/80 bg-amber-500/10 border border-amber-500/25 rounded-lg px-3 py-2">
          Read-only — setting prices is limited to owners and sell-side admins.
        </p>
      )}

      {/* One chip row, two groups. The rule they follow is different — the
          left widens (OR), the right narrows (AND) — so a divider separates
          them instead of the stacked row and floating "ONLY" label that made
          seven equal-looking switches read as one undifferentiated bank. */}
      <div className="flex flex-wrap items-center gap-1.5">
        {(['no_price', 'below_floor', 'below_band', 'in_band', 'above_band', 'unclassified'] as PriceIssue[]).map((id) => (
          <Chip key={id} label={ISSUE_LABEL[id]} count={counts.get(id) ?? 0} on={wanted.has(id)}
            tone="issue" onClick={() => { setWanted((w) => toggle(w, id)); setPage(200); }} />
        ))}
        <span className="w-px self-stretch bg-slate-800 mx-1.5" aria-hidden />
        {/* "Has landed cost" WAS hidden here, on the grounds that it selects
            the same items as In stock — an item gets its moving-average cost
            when goods are received, which is also what puts them on the shelf.
            That is still literally true (checked 2026-09-08: 156 and 156, and
            neither set has a single member the other lacks), and it is still
            the wrong reason to leave it out. The two chips answer different
            questions — "what am I holding" and "what can I judge a margin on"
            — and they part company the day stock sells out while the ledger
            keeps the cost. Inferring one from the other's complement is a trick
            the user has to know; a chip is not. Owner asked for it, 2026-09-08. */}
        {(['in_stock', 'landed_cost', 'quoted_cost', 'no_cost'] as PriceScope[]).map((id) => (
          <Chip key={id} label={SCOPE_LABEL[id]} count={scopeCounts.get(id) ?? 0} on={scope.has(id)}
            tone="scope" onClick={() => { setScope((w) => toggle(w, id)); setPage(200); }} />
        ))}
        {/* Items whose reorder or newer quote costs more than the basis — the
            prices most likely to be stale. Narrows, like the scope chips. */}
        <Chip label={`▲ ${t('Cost rising')}`} count={risingCount} on={risingOnly}
          tone="scope" onClick={() => { setRisingOnly((v) => !v); setPage(200); }} />
        {(wanted.size > 0 || scope.size > 0 || risingOnly || profileFilter !== '' || catFilter !== '') && (
          <button type="button" onClick={() => { setWanted(new Set()); setScope(new Set()); setRisingOnly(false); setProfileFilter(''); setCatFilter(''); }}
            className="ml-1 text-[11px] text-slate-500 hover:text-slate-300 underline underline-offset-2">
            {t('Clear')}
          </button>
        )}
      </div>

      <div className="overflow-x-auto rounded-xl border border-slate-800">
        <table className="w-full text-[12.5px]">
          <thead>
            <tr className="bg-slate-800/60 text-[11px] uppercase tracking-wide text-slate-400">
              <SortTh sortCol={sortCol} sortDir={sortDir} onSort={onSort} col="item" label="Item" />
              <SortTh sortCol={sortCol} sortDir={sortDir} onSort={onSort} col="qty" label="On hand" align="right" className="whitespace-nowrap" />
              {/* "Landed cost" until 2026-09-11, when a supplier quote became the
                  fallback. A heading that names one of the two bases would be
                  wrong on every quoted row — and wrong in the flattering
                  direction, which is the kind of wrong that gets believed. */}
              <SortTh sortCol={sortCol} sortDir={sortDir} onSort={onSort} col="cost" label={`${t('Cost basis')} (${moneyUnit()})`} align="right" className="whitespace-nowrap" />
              {tiers.map((t, i) => (
                <SortTh key={t.tier_id} sortCol={sortCol} sortDir={sortDir} onSort={onSort} col={`tier:${t.tier_id}`} align="right" className="whitespace-nowrap"
                  label={i === 0 ? `${t.name} · net` : t.name} />
              ))}
              <SortTh sortCol={sortCol} sortDir={sortDir} onSort={onSort} col="profile" label="Margin profile · target" className="whitespace-nowrap" />
              <SortTh sortCol={sortCol} sortDir={sortDir} onSort={onSort} col="gp" label="GP" align="right" />
              <SortTh sortCol={sortCol} sortDir={sortDir} onSort={onSort} col="lastset" label="Last set" align="right" className="whitespace-nowrap" />
              <th className="px-3 py-2" />
            </tr>
          </thead>
          <tbody>
            {rows.slice(0, page).map((r) => {
              const cid = r.c.component_id;
              const dirty = Object.keys(draft).some((k) => k.startsWith(`${cid}:`));
              const range = suggestRange(r.cost, r.profile, roundStep);
              // Preview: everything below reads from what is TYPED, not what is
              // saved. A GP that still reports the old price while a new one sits
              // in the box is worse than no GP — it is a wrong answer to the
              // question the person is asking as they type.
              const netKey = keyOf(cid, tiers[0]?.tier_id ?? '');
              const netNow = draft[netKey] !== undefined ? num(draft[netKey]) : r.c.selling_price_idr;
              const chainNow = computeTierChain(netNow, tiers, (tid) => {
                const dk = keyOf(cid, tid);
                if (draft[dk] !== undefined) return num(draft[dk]);
                return ovByKey.get(`${cid}:${tid}`)?.override_price_idr;
              });
              const gpNow = marginPct(netNow, r.cost);
              const standingNow = r.profile == null || gpNow == null ? null
                : gpNow < Number(r.profile.margin_target_min) ? 'below'
                : gpNow > Number(r.profile.margin_target_max) ? 'above' : 'within';
              return (
                <Fragment key={cid}>
                {/* `group/row` so the copy button can stay out of the way until
                    the pointer is on the row — 200 always-lit buttons read as
                    clutter, not as 200 affordances. Named, not bare `group`,
                    because a bare one would also be claimed by anything nested. */}
                <tr className="group/row border-t border-slate-800/70 hover:bg-slate-800/30">
                  <td className="px-3 py-1.5">
                    <p className="text-slate-200 leading-tight flex items-start gap-1">
                      <span>{descOf(r.c)}</span>
                      {/* OUR description, which is the one that goes to a
                          customer — the supplier model below it deliberately
                          has no button. */}
                      <CopyButton text={descOf(r.c)} title="Copy the description" />
                    </p>
                    <p className="text-[11px] text-slate-500 font-mono">{r.c.supplier_model}</p>
                  </td>
                  <td className={`px-3 py-1.5 text-right tabular-nums whitespace-nowrap ${r.qty > 0 ? 'text-sky-300/80' : 'text-slate-600'}`}>
                    {r.qty > 0 ? fmtInt(r.qty) : '—'}
                  </td>
                  {/* The cost, and WHERE IT CAME FROM. A quote basis excludes
                      freight, duty and fees, so the margin beside it reads
                      better than the truth — that cannot be silent, or a floor
                      "cleared" here gets breached the day the goods land. The
                      expected case (landed) carries no badge: a tag on every
                      row is a tag nobody reads. */}
                  <td className="px-3 py-1.5 text-right tabular-nums whitespace-nowrap" title={BASIS_NOTE[r.basis.basis]}>
                    {r.basis.cost == null ? <span className="text-slate-600">—</span> : (
                      <span className={r.rise ? 'text-slate-500' : r.basis.provisional ? 'text-amber-300/90' : 'text-slate-400'}>
                        <span className={r.rise ? 'line-through decoration-slate-600' : ''}>{fmtMoneyCell(r.basis.cost)}</span>
                        {BASIS_TAG[r.basis.basis] && (
                          <span className={`ml-1 align-middle px-1 py-px rounded text-[9px] font-bold tracking-wide ${
                            r.basis.provisional ? 'bg-amber-500/15 text-amber-300' : 'bg-slate-800 text-slate-500'
                          }`}>{BASIS_TAG[r.basis.basis]}</span>
                        )}
                      </span>
                    )}
                    {/* THE NEXT UNIT COSTS MORE (owner, 2026-10-27). The basis
                        above is struck through because nothing on this row is
                        judged on it any more: every GP, floor and suggestion
                        uses this number. The hover says where it came from. */}
                    {r.rise && <RiseNote rise={r.rise} supplierName={supplierNameOf(r.rise.incoming.supplierId)} showRefs={showPoNumbers} />}
                  </td>
                  {tiers.map((t, i) => {
                    const k = keyOf(cid, t.tier_id);
                    const computed = chainNow.get(t.tier_id)?.price ?? null;
                    const pinned = i > 0 && Boolean(r.chain.get(t.tier_id)?.overridden);
                    const stored = i === 0 ? r.c.selling_price_idr
                      : (ovByKey.get(`${cid}:${t.tier_id}`)?.override_price_idr ?? null);
                    const shown = draft[k] !== undefined ? draft[k] : (stored != null ? String(stored) : '');
                    return (
                      <td key={t.tier_id} className="px-2 py-1.5 text-right">
                        <input value={shown} inputMode="numeric" disabled={!canManage} readOnly={!canManage}
                          onChange={(e) => setDraft((d) => ({ ...d, [k]: e.target.value }))}
                          // Every tier above the net is rounded by the chain
                          // (lib/tierPricing). A TYPED price is not, so a net of
                          // 8.000.123 would sit un-rounded under a column of
                          // clean numbers. Round on blur rather than on save, so
                          // the number is seen before it is committed.
                          onBlur={() => setDraft((d) => {
                            const raw = d[k];
                            if (raw === undefined || raw === '') return d;
                            const n = num(raw);
                            if (n == null || n <= 0) return d;
                            const rounded = roundUpToStep(n, roundStep);
                            return rounded === n ? d : { ...d, [k]: String(rounded) };
                          })}
                          placeholder={computed != null ? fmtInt(computed) : '—'}
                          title={i === 0 ? "The item's own net price — every tier above chains up from it"
                            : pinned ? 'PINNED: a stored override on this tier. It does NOT follow the net any more — clear the box to put it back on the markup chain.'
                            : stored != null ? 'A stored price for this tier.'
                            : 'FAINT = nothing stored here. The number is computed from the net by the markup chain and follows it wherever it goes. Type to pin it, which stops it following.'}
                          className={`w-24 text-right tabular-nums bg-transparent rounded px-1.5 py-1 border focus:outline-none focus:ring-1 focus:ring-emerald-500/40 ${
                            draft[k] !== undefined ? 'border-amber-500/50 text-amber-200'
                            : pinned ? 'border-violet-500/40 text-violet-200'
                            : stored != null ? 'border-slate-700 text-slate-200'
                            : 'border-transparent text-slate-500 hover:border-slate-700 placeholder-slate-600'}`} />
                        {/* THIS TIER'S GP (owner, 2026-09-28: "show the GP of
                            each tier"). Read from what is in the box right now —
                            typed, pinned or chained — against the row's cost
                            basis, so it moves as you type like the GP column.
                            Judged ONLY against this tier's own floor: quiet when
                            it clears it, red when it does not. The margin-profile
                            target is the GP column's question, not this one. */}
                        {(() => {
                          const tierGp = marginPct(i === 0 ? netNow : computed, r.cost);
                          if (tierGp == null) return null;
                          const floor = Number(t.margin_floor_pct) || 0;
                          const under = belowFloor(tierGp, floor);
                          return (
                            <p className={`mt-0.5 pr-1.5 text-[10px] tabular-nums whitespace-nowrap ${under ? 'text-red-400 font-semibold' : 'text-slate-500'}`}
                              title={under
                                ? tf('GP {gp}% — below the {floor}% minimum for {tier}', { gp: tierGp.toFixed(1), floor, tier: t.name })
                                : tf('GP {gp}% at {tier} · minimum {floor}%', { gp: tierGp.toFixed(1), floor, tier: t.name })}>
                              {under && '⚠ '}{tierGp.toFixed(1)}%
                            </p>
                          );
                        })()}
                        {/* A pinned tier does not follow the net — that is what
                            pinning means. But once the net moves, the pin is
                            usually a leftover rather than a decision, so show
                            what the chain would say and let one click take it. */}
                        {i > 0 && canManage && pinned && draft[netKey] !== undefined && computed != null
                          && Number(stored) !== computed && (
                          <p className="mt-1 flex items-center justify-end gap-1 text-[10px] whitespace-nowrap">
                            {/* Same style as the band suggestion below — two
                                clickable numbers on one row must not be two
                                different shapes, whichever shape wins. */}
                            <span className="text-amber-400/70">pinned · chain says</span>
                            <button type="button"
                              title={`Unpin this tier and take ${fmtRupiah(computed)} from the markup chain instead`}
                              onClick={() => setDraft((d) => ({ ...d, [k]: '' }))}
                              className="tabular-nums text-amber-300/80 hover:text-amber-200 underline underline-offset-2 decoration-dotted">
                              {fmtInt(computed)}
                            </button>
                          </p>
                        )}
                        {/* What to charge, at both ends of the band, one click
                            each. Shown under the NET box because the net is the
                            price the band is judged on.
                            
                            IT NOW SHOWS ON UNPRICED ROWS TOO (owner, 2026-09-11:
                            *"some have price suggestions some dont?"*). It used
                            to require the item to be OUT of band — which meant
                            it needed a price to be out of band WITH, so the one
                            row where "here is what to charge" is most useful,
                            the row with no price at all, was the row that got
                            nothing. `suggestRange` only ever needed a cost and a
                            profile; both were sitting right there. An in-band
                            price still gets no suggestion: that is not a gap,
                            it is a correct row, and a prompt on it is noise. */}
                        {i === 0 && canManage && range
                          && (standingNow === 'below' || standingNow === 'above' || !(Number(netNow) > 0)) && (
                          /* THE OLD LOOK, kept (owner, 2026-09-11: *"for the
                             suggestion, i prefer the older style"*). It was
                             briefly a pair of pills, because the dotted
                             underline reads as "hover for a tooltip" elsewhere
                             in this app rather than "press me". He has now seen
                             both and chosen; taste on his own screen is his
                             call, and the quiet version does keep a dense grid
                             calm.

                             WHAT STAYS from that attempt is the part that was
                             never about looks: the tooltips now say that
                             clicking SETS THE NET, and that Tier-2 and Tier-3
                             recalculate from it so they are never typed. That
                             was the actual question behind "how do I click
                             this", and it costs nothing to answer on hover. */
                          <p className="mt-1 flex items-center justify-end gap-1 text-[10px] whitespace-nowrap">
                            <span className="text-slate-600">→</span>
                            <button type="button"
                              title={`Set the net price to ${fmtRupiah(range.min)} — the bottom of the ${r.profile ? bandOf(r.profile) : ''} band. Tier-2 and Tier-3 recalculate from it; you never type those.`}
                              onClick={() => setDraft((d) => ({ ...d, [k]: String(range.min) }))}
                              className="tabular-nums text-amber-300/80 hover:text-amber-200 underline underline-offset-2 decoration-dotted">
                              {fmtInt(range.min)}
                            </button>
                            <span className="text-slate-600">–</span>
                            <button type="button"
                              title={`Set the net price to ${fmtRupiah(range.max)} — the top of the ${r.profile ? bandOf(r.profile) : ''} band. Tier-2 and Tier-3 recalculate from it; you never type those.`}
                              onClick={() => setDraft((d) => ({ ...d, [k]: String(range.max) }))}
                              className="tabular-nums text-amber-300/80 hover:text-amber-200 underline underline-offset-2 decoration-dotted">
                              {fmtInt(range.max)}
                            </button>
                          </p>
                        )}
                      </td>
                    );
                  })}
                  <td className="px-3 py-1.5 whitespace-nowrap">
                    <select value={r.c.margin_profile_id ?? ''} disabled={!canManage}
                      onChange={(e) => onAssignProfile(cid, e.target.value || null)}
                      title="What this item is supposed to earn. Value Capture funds the margin; Loss Leader wins the deal."
                      className={`bg-transparent border rounded px-1.5 py-0.5 text-[11.5px] focus:outline-none focus:ring-1 focus:ring-emerald-500/40 ${
                        r.profile ? 'border-slate-700 text-slate-300' : 'border-amber-500/30 text-amber-300/80'}`}>
                      <option value="" className="bg-slate-900">Unclassified</option>
                      {[...profileById.values()].map((pr) => (
                        <option key={pr.id} value={pr.id} className="bg-slate-900">{pr.label}</option>
                      ))}
                    </select>
                    {r.profile && (
                      <p className="text-[10px] text-slate-500 mt-0.5">target {bandOf(r.profile)}</p>
                    )}
                  </td>
                  <td className="px-3 py-1.5 text-right tabular-nums whitespace-nowrap">
                    {gpNow == null ? <span className="text-slate-600">—</span> : (
                      <>
                        {/* One question per colour (owner, 2026-09-28): this
                            column says whether the NET sits inside the item's
                            margin-profile target — amber under, green over.
                            It used to turn red when ANY tier broke its floor,
                            which read as "below target" (it was explained to
                            the owner that way once, wrongly). A floor breach is
                            now red on the tier that breaks it, under its box. */}
                        <span className={`${standingNow === 'below' ? 'text-amber-400'
                          : standingNow === 'above' ? 'text-emerald-400' : 'text-slate-300'} ${
                          draft[netKey] !== undefined ? 'font-semibold' : ''}`}>
                          {gpNow.toFixed(1)}%
                        </span>
                        {/* While typing, show what it WAS beside what it would
                            become, so the size of the move is visible. */}
                        {draft[netKey] !== undefined && r.gp != null && Math.abs(r.gp - gpNow) >= 0.05 && (
                          <p className="text-[10px] text-slate-500">was {r.gp.toFixed(1)}%</p>
                        )}
                      </>
                    )}
                  </td>
                  <td className="px-3 py-1.5 text-right whitespace-nowrap">
                    {(() => {
                      const log = priceLog.get(cid) ?? [];
                      if (log.length === 0) return <span className="text-slate-600 text-[11px]">never</span>;
                      const open = openLog === cid;
                      return (
                        <button type="button" onClick={() => setOpenLog(open ? null : cid)}
                          title={`${log.length} price change${log.length !== 1 ? 's' : ''} on record`}
                          className={`text-[11px] tabular-nums transition-colors ${open ? 'text-sky-300' : 'text-slate-400 hover:text-slate-200'}`}>
                          {fmtDay(log[0].changed_at)}
                          <span className="ml-1 text-[9px] opacity-70">{open ? '▲' : '▼'}</span>
                        </button>
                      );
                    })()}
                  </td>
                  <td className="px-2 py-1.5 text-right whitespace-nowrap">
                    {!dirty && canManage && tiers.some((t, ti) => ti > 0 && r.chain.get(t.tier_id)?.overridden) ? (
                      <button type="button" title="Clear the pinned tier prices so they follow the markup chain from the net"
                        onClick={() => setDraft((d) => {
                          const next = { ...d };
                          tiers.forEach((t, ti) => { if (ti > 0 && r.chain.get(t.tier_id)?.overridden) next[keyOf(cid, t.tier_id)] = ''; });
                          return next;
                        })}
                        className="text-[11px] px-2 py-1 rounded border border-slate-700 text-slate-500 hover:text-slate-300 hover:border-slate-600">
                        {t('Follow chain')}
                      </button>
                    ) : dirty ? (
                      <span className="inline-flex items-center gap-1">
                        <button type="button" disabled={saving} title="Put this row back to its saved value"
                          onClick={() => setDraft((d) => {
                            const next = { ...d };
                            for (const k of Object.keys(next)) if (k.startsWith(`${cid}:`)) delete next[k];
                            return next;
                          })}
                          className="text-[11px] px-2 py-1 rounded border border-slate-700 text-slate-400 hover:text-slate-200 disabled:opacity-50">
                          {t('Undo')}
                        </button>
                        <button type="button" disabled={saving} onClick={() => commit([cid])}
                          className="text-[11px] font-bold px-2 py-1 rounded bg-emerald-600 hover:bg-emerald-500 text-white disabled:opacity-50">
                          {t('Save')}
                        </button>
                      </span>
                    ) : null}
                  </td>
                </tr>
                {openLog === cid && (
                  <tr className="border-t border-slate-800/70 bg-slate-900/50">
                    <td colSpan={6 + tiers.length} className="px-3 py-2.5">
                      <p className="text-[10px] uppercase tracking-wide text-slate-500 mb-1.5">Price history</p>
                      <div className="space-y-1">
                        {(priceLog.get(cid) ?? []).map((l) => {
                          // GP as it stood: the cost and band SNAPSHOTTED at the
                          // change, never today's — landed cost moves and the
                          // bands are editable, so recomputing would answer a
                          // different question. See migrations/item_price_history.sql
                          const gp = l.new_price_idr && l.cost_idr
                            ? ((l.new_price_idr - l.cost_idr) / l.new_price_idr) * 100 : null;
                          const inBand = gp == null || l.target_min_pct == null ? null
                            : gp >= Number(l.target_min_pct) && gp <= Number(l.target_max_pct);
                          const tier = l.tier_id ? tiers.find((t) => t.tier_id === l.tier_id) : null;
                          return (
                            <div key={l.history_id} className="flex flex-wrap items-baseline gap-x-2.5 gap-y-0.5 text-[11.5px]">
                              <span className="text-slate-500 tabular-nums w-[92px] flex-shrink-0">{fmtDay(l.changed_at)}</span>
                              <span className="text-slate-600 w-[52px] flex-shrink-0">{tier ? tier.name : 'Net'}</span>
                              <span className="text-slate-500 tabular-nums">
                                {l.old_price_idr != null ? fmtInt(l.old_price_idr) : 'unpriced'}
                              </span>
                              <span className="text-slate-600">→</span>
                              <span className="text-slate-200 tabular-nums font-medium">
                                {l.new_price_idr != null ? fmtInt(l.new_price_idr) : 'cleared'}
                              </span>
                              {gp != null && (
                                <span className={inBand === true ? 'text-slate-300' : inBand === false ? 'text-amber-400' : 'text-slate-500'}>
                                  {gp.toFixed(1)}%
                                  {l.target_min_pct != null && (
                                    <span className="text-slate-600 ml-1">
                                      {inBand ? 'in' : 'out of'} {Number(l.target_min_pct)}–{Number(l.target_max_pct)}%
                                    </span>
                                  )}
                                </span>
                              )}
                              {l.changed_by_email && <span className="text-slate-600 ml-auto">{l.changed_by_email}</span>}
                              {canManage && (
                                <button type="button" disabled={saving}
                                  title={l.old_price_idr != null
                                    ? `Put it back to ${fmtInt(l.old_price_idr)}`
                                    : 'Put it back to having no price'}
                                  onClick={() => onSave([{ component_id: cid, tier_id: l.tier_id, value: l.old_price_idr }])}
                                  className={`text-[10.5px] px-1.5 py-0.5 rounded border border-slate-700 text-slate-400 hover:text-slate-200 hover:border-slate-600 disabled:opacity-50 ${l.changed_by_email ? '' : 'ml-auto'}`}>
                                  {t('Undo')}
                                </button>
                              )}
                            </div>
                          );
                        })}
                      </div>
                    </td>
                  </tr>
                )}
                </Fragment>
              );
            })}
          </tbody>
        </table>
        {rows.length === 0 && (
          <p className="text-[12px] text-slate-400 py-10 text-center">Nothing matches — clear a filter to see more.</p>
        )}
      </div>

      {rows.length > page && (
        <button type="button" onClick={() => setPage((p) => p + 200)}
          className="w-full py-2 text-[12px] text-slate-400 hover:text-slate-200 border border-slate-800 rounded-lg hover:bg-slate-800/40">
          {tf('Show more ({n} left)', { n: fmtInt(rows.length - page) })}
        </button>
      )}
    </div>
  );
}

// ── Price History ─────────────────────────────────────────────────────────────
/**
 * Every logged price change, newest first — the answer to "what moved lately",
 * which the per-item popover on Set Pricing cannot give.
 *
 * Read-only by construction: 21.3 is written by database triggers and carries
 * no write policy, so nothing here could edit it even if it tried. The margin
 * and the band shown are the ones SNAPSHOTTED at the change, never recomputed
 * from today's landed cost — see migrations/item_price_history.sql.
 */
function PriceHistoryTab({ log, compById, tiers }: {
  log: PriceLog[]; compById: Map<string, Comp>; tiers: Tier[];
}) {
  const { t, tf } = useT();
  const [q, setQ] = useState('');
  const [only, setOnly] = useState<'' | 'out'>('');
  const [page, setPage] = useState(100);

  const rows = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return log.map((l) => {
      const c = compById.get(l.component_id);
      const gp = l.new_price_idr && l.cost_idr
        ? ((l.new_price_idr - l.cost_idr) / l.new_price_idr) * 100 : null;
      const inBand = gp == null || l.target_min_pct == null ? null
        : gp >= Number(l.target_min_pct) && gp <= Number(l.target_max_pct);
      return { l, c, gp, inBand, tier: l.tier_id ? tiers.find((t) => t.tier_id === l.tier_id) ?? null : null };
    }).filter((r) => {
      if (only === 'out' && r.inBand !== false) return false;
      if (!needle) return true;
      return `${r.c ? descOf(r.c) : ''} ${r.c?.supplier_model ?? ''} ${r.l.changed_by_email ?? ''}`
        .toLowerCase().includes(needle);
    });
  }, [log, compById, tiers, q, only]);

  const outCount = useMemo(() => rows.filter((r) => r.inBand === false).length, [rows]);

  if (log.length === 0) {
    return (
      <div className="rounded-xl border border-dashed border-slate-700 p-10 text-center">
        <p className="text-sm text-slate-400">No price changes recorded yet.</p>
        <p className="text-xs text-slate-500 mt-1.5 max-w-lg mx-auto">
          Logging started on 29 Aug 2026. Every change from now on is recorded here —
          from this screen, from Deal Lookup, from the Floor Audit, or through the API.
          Changes made before that date cannot be recovered.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <input value={q} onChange={(e) => { setQ(e.target.value); setPage(100); }}
          placeholder="Search item, model or who changed it…"
          className={`w-full sm:w-80 ${BAR_INPUT}`} />
        <button type="button" onClick={() => { setOnly(only === 'out' ? '' : 'out'); setPage(100); }}
          className={`${BAR_BTN} px-2.5 ${
            only === 'out' ? 'bg-amber-500/15 text-amber-300 border-amber-500/40' : BAR_BTN_OFF}`}>
          {t('Landed outside target')} <span className="tabular-nums opacity-70">{fmtInt(outCount)}</span>
        </button>
        <span className="text-xs text-slate-500 tabular-nums">{fmtInt(rows.length)} changes</span>
      </div>

      <div className="overflow-x-auto rounded-xl border border-slate-800">
        <table className="w-full text-[12.5px]">
          <thead>
            <tr className="bg-slate-800/60 text-[11px] uppercase tracking-wide text-slate-400">
              <th className="text-left font-semibold px-3 py-2 whitespace-nowrap">{t('When')}</th>
              <th className="text-left font-semibold px-3 py-2">{t('Item')}</th>
              <th className="text-left font-semibold px-3 py-2">{t('Tier')}</th>
              <th className="text-right font-semibold px-3 py-2">{t('Was')} ({moneyUnit()})</th>
              <th className="text-right font-semibold px-3 py-2">{t('Became')} ({moneyUnit()})</th>
              <th className="text-right font-semibold px-3 py-2">{t('GP then')}</th>
              <th className="text-left font-semibold px-3 py-2">{t('By')}</th>
            </tr>
          </thead>
          <tbody>
            {rows.slice(0, page).map(({ l, c, gp, inBand, tier }) => (
              <tr key={l.history_id} className="border-t border-slate-800/70 hover:bg-slate-800/30">
                <td className="px-3 py-1.5 text-slate-400 tabular-nums whitespace-nowrap">{fmtDay(l.changed_at)}</td>
                <td className="px-3 py-1.5">
                  <p className="text-slate-200 leading-tight">{c ? descOf(c) : '(item deleted)'}</p>
                  {c && <p className="text-[11px] text-slate-500 font-mono">{c.supplier_model}</p>}
                </td>
                <td className="px-3 py-1.5 text-slate-500">{tier ? tier.name : 'Net'}</td>
                <td className="px-3 py-1.5 text-right tabular-nums text-slate-500">
                  {l.old_price_idr != null ? fmtMoneyCell(l.old_price_idr) : <span className="text-slate-600">unpriced</span>}
                </td>
                <td className="px-3 py-1.5 text-right tabular-nums text-slate-200">
                  {l.new_price_idr != null ? fmtMoneyCell(l.new_price_idr) : <span className="text-slate-600">cleared</span>}
                </td>
                <td className="px-3 py-1.5 text-right tabular-nums whitespace-nowrap">
                  {gp == null ? <span className="text-slate-600">—</span> : (
                    <>
                      <span className={inBand === false ? 'text-amber-400' : 'text-slate-300'}>{gp.toFixed(1)}%</span>
                      {l.target_min_pct != null && (
                        <p className="text-[10px] text-slate-600">
                          {inBand ? 'in' : 'outside'} {Number(l.target_min_pct)}–{Number(l.target_max_pct)}%
                        </p>
                      )}
                    </>
                  )}
                </td>
                <td className="px-3 py-1.5 text-slate-500 text-[11.5px]">{l.changed_by_email ?? 'API'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {rows.length > page && (
        <button type="button" onClick={() => setPage((p) => p + 100)}
          className="w-full py-2 text-[12px] text-slate-400 hover:text-slate-200 border border-slate-800 rounded-lg hover:bg-slate-800/40">
          {tf('Show more ({n} left)', { n: fmtInt(rows.length - page) })}
        </button>
      )}
    </div>
  );
}
