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
import { useState, useEffect, useMemo, useCallback } from 'react';
import { createSupabaseClient } from '@/lib/supabase';
import { fetchAllComponents } from '@/lib/fetchAllRows';
import { useAuth } from '@/hooks/useAuth';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { ROLE_PERMISSIONS } from '@/constants/roles';
import { canOpenPath } from '@/constants/navigation';
import BrandMenu from '@/components/ui/BrandMenu';
import { computeTierChain, roundUpToStep } from '@/lib/tierPricing';
import { issuesFor, matchesIssues, marginPct, priceForMargin, ISSUE_LABEL, type PriceIssue } from '@/lib/priceGrid';
import {
  fetchMarginProfiles, saveMarginProfile, createMarginProfile, deleteMarginProfile,
  rangeError, byId as marginById, bandOf, type MarginProfile,
} from '@/lib/marginProfiles';
import { fmtDay, fmtInt, fmtRupiah } from '@/lib/formatters';
import { useSettings } from '@/hooks/useSettings';

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
  margin_profile_id: string | null;
}
interface Bal { component_id: string; qty_on_hand: number; avg_cost_idr: number | null; }

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

type Tab = 'set' | 'tiers' | 'audit' | 'overrides' | 'profiles';

interface Violation {
  comp: Comp; tier: Tier; price: number; cost: number; gp: number;
  minPrice: number | null; onHand: number; leakage: number;
  ov: Override | null;          // override behind this price, if any
  defaultCompliant: boolean;    // clearing the override would already fix it
}

export default function PricingPage() {
  const supabase = createSupabaseClient();
  const router = useRouter();
  const { user, profile, loading: authLoading } = useAuth();
  const canManage = !!profile && ROLE_PERMISSIONS[profile.role].canManagePricing;
  const canManageUsers = !!profile && ROLE_PERMISSIONS[profile.role].canManageUsers;   // owner — Settings

  const [tiers, setTiers] = useState<Tier[]>([]);
  const [overrides, setOverrides] = useState<Override[]>([]);
  const [comps, setComps] = useState<Comp[]>([]);
  const [bals, setBals] = useState<Map<string, Bal>>(new Map());
  const [custTierCounts, setCustTierCounts] = useState<Map<string, number>>(new Map());
  const [loading, setLoading] = useState(true);
  const [schemaMissing, setSchemaMissing] = useState(false);
  const [tab, setTab] = useState<Tab>('set');
  const [marginProfiles, setMarginProfiles] = useState<MarginProfile[]>([]);
  // How many items sit on each profile, and how many on none — the number that
  // tells the owner whether the classification is actually finished.
  const [profileCounts, setProfileCounts] = useState<Map<string, number>>(new Map());
  /** Reads, and hands back the state update — see `fetchAll` below for why. */
  const loadMarginProfiles = useCallback(async (): Promise<() => void> => {
    const [profiles, tally] = await Promise.all([
      fetchMarginProfiles(supabase),
      supabase.from('3.0_components').select('margin_profile_id').limit(20000),
    ]);
    const counts = new Map<string, number>();
    for (const r of ((tally.data ?? []) as { margin_profile_id: string | null }[])) {
      const k = r.margin_profile_id ?? 'none';
      counts.set(k, (counts.get(k) ?? 0) + 1);
    }
    return () => { setMarginProfiles(profiles); setProfileCounts(counts); };
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

  useEffect(() => { document.title = 'Pricing Tiers — ICAPROC'; }, []);
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
    const [tierRes, ovRes, allComps, balRes, custRes] = await Promise.all([
      supabase.from('21.0_price_tiers').select('*').order('sort_order'),
      supabase.from('21.1_item_tier_prices').select('price_id, component_id, tier_id, override_price_idr, override_discount_pct, updated_at, updated_by_email'),
      fetchAllComponents<Comp>(supabase, 'component_id, supplier_model, internal_description, category, unit, selling_price_idr, margin_profile_id'),
      supabase.from('30.1_stock_balances').select('component_id, qty_on_hand, avg_cost_idr'),
      supabase.from('20.0_customers').select('customer_id, tier'),
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
    const cc = new Map<string, number>();
    for (const c of (custRes.data as { tier: string | null }[]) ?? []) {
      const t = (c.tier ?? '').trim();
      if (t) cc.set(t, (cc.get(t) ?? 0) + 1);
    }
    return () => {
      setTiers((tierRes.data as Tier[]) ?? []);
      setOverrides((ovRes.data as Override[]) ?? []);
      setComps(allComps);
      setBals(bm);
      setCustTierCounts(cc);
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

  const costOf = useCallback((cid: string): number | null => {
    const b = bals.get(cid);
    const c = Number(b?.avg_cost_idr) || 0;
    return c > 0 ? c : null;
  }, [bals]);

  // Every (item, active tier) whose effective price sits below the tier floor.
  const violations: Violation[] = useMemo(() => {
    const out: Violation[] = [];
    for (const c of comps) {
      const cost = costOf(c.component_id);
      if (cost == null) continue;
      const onHand = Math.max(0, Number(bals.get(c.component_id)?.qty_on_hand) || 0);
      const chain = chainFor(c);
      for (const t of activeSorted) {
        const e = chain.get(t.tier_id);
        const price = e?.price ?? null;
        if (price == null || price <= 0) continue;
        const ov = e?.overridden ? (ovByKey.get(`${c.component_id}:${t.tier_id}`) ?? null) : null;
        const gp = ((price - cost) / price) * 100;
        if (gp >= (t.margin_floor_pct || 0) - 0.05) continue;
        const minPrice = minPriceFor(cost, t.margin_floor_pct || 0);
        // Would the chain default alone (this tier's override cleared) clear the floor?
        const defPrice = ov ? (chainFor(c, t.tier_id).get(t.tier_id)?.price ?? null) : null;
        const defaultCompliant = !!ov && defPrice != null && defPrice > 0 && ((defPrice - cost) / defPrice) * 100 >= (t.margin_floor_pct || 0);
        out.push({
          comp: c, tier: t, price, cost, gp, minPrice, onHand,
          leakage: minPrice != null ? Math.max(0, minPrice - price) * onHand : 0,
          ov, defaultCompliant,
        });
      }
    }
    // Worst economics first: biggest at-stake rupiah, then deepest GP gap.
    return out.sort((a, b) => (b.leakage - a.leakage) || (a.gp - b.gp));
  }, [comps, activeSorted, bals, costOf, chainFor, ovByKey]);

  const itemsNoCost = useMemo(
    () => comps.filter((c) => costOf(c.component_id) == null && (Number(c.selling_price_idr) || 0) > 0).length,
    [comps, costOf]);
  const totalLeakage = useMemo(() => violations.reduce((s, v) => s + v.leakage, 0), [violations]);
  const violationsByTier = useMemo(() => {
    const m = new Map<string, number>();
    for (const v of violations) m.set(v.tier.tier_id, (m.get(v.tier.tier_id) ?? 0) + 1);
    return m;
  }, [violations]);
  const overridesByTier = useMemo(() => {
    const m = new Map<string, number>();
    for (const o of overrides) m.set(o.tier_id, (m.get(o.tier_id) ?? 0) + 1);
    return m;
  }, [overrides]);

  // ── Tier writes ────────────────────────────────────────────────────────────
  const [savingTier, setSavingTier] = useState<string | null>(null);

  async function saveTier(t: Tier, patch: Partial<Tier>) {
    setSavingTier(t.tier_id);
    const payload = {
      tier_code: String(patch.tier_code ?? t.tier_code).trim().toLowerCase().replace(/\s+/g, '_'),
      name: String(patch.name ?? t.name).trim(),
      default_discount_pct: Number(patch.default_discount_pct ?? t.default_discount_pct) || 0,
      margin_floor_pct: Number(patch.margin_floor_pct ?? t.margin_floor_pct) || 0,
      sort_order: Number(patch.sort_order ?? t.sort_order) || 0,
      is_active: patch.is_active ?? t.is_active,
    };
    const oldCode = t.tier_code;
    const { error } = await supabase.from('21.0_price_tiers').update(payload).eq('tier_id', t.tier_id);
    setSavingTier(null);
    if (error) { flash(`Failed: ${error.message}`); return; }
    // A tier's code is its foreign key on customers — carry them along on rename.
    if (payload.tier_code !== oldCode && oldCode) {
      const { data: moved, error: custErr } = await supabase
        .from('20.0_customers').update({ tier: payload.tier_code }).eq('tier', oldCode).select('customer_id');
      if (custErr) flash(`Tier saved, but customers still carry "${oldCode}": ${custErr.message}`);
      else if (moved && moved.length) flash(`Tier saved · ${moved.length} customer${moved.length !== 1 ? 's' : ''} moved to the new code`);
      else flash('Tier saved');
    } else {
      flash('Tier saved');
    }
    refresh();
  }

  async function addTier(draft: { name: string; default_discount_pct: number; margin_floor_pct: number }) {
    const code = draft.name.trim().toLowerCase().replace(/\s+/g, '_');
    if (!code) { flash('Give the tier a name first'); return; }
    const { error } = await supabase.from('21.0_price_tiers').insert({
      tier_code: code, name: draft.name.trim(),
      default_discount_pct: draft.default_discount_pct || 0,
      margin_floor_pct: draft.margin_floor_pct || 0,
      sort_order: (tiers.reduce((m, t) => Math.max(m, t.sort_order), 0) + 1),
      is_active: true,
    });
    if (error) { flash(`Failed: ${error.message}`); return; }
    flash('Tier added');
    refresh();
  }

  async function moveTier(t: Tier, dir: -1 | 1) {
    const ordered = [...tiers].sort((a, b) => a.sort_order - b.sort_order);
    const i = ordered.findIndex((x) => x.tier_id === t.tier_id);
    const j = i + dir;
    if (j < 0 || j >= ordered.length) return;
    const a = ordered[i], b = ordered[j];
    // Swap slots (normalize to index+1 so legacy duplicate sort_orders untangle)
    const [ra, rb] = await Promise.all([
      supabase.from('21.0_price_tiers').update({ sort_order: j + 1 }).eq('tier_id', a.tier_id),
      supabase.from('21.0_price_tiers').update({ sort_order: i + 1 }).eq('tier_id', b.tier_id),
    ]);
    if (ra.error || rb.error) { flash(`Failed: ${(ra.error ?? rb.error)!.message}`); return; }
    refresh();
  }

  async function deleteTier(t: Tier) {
    const { error } = await supabase.from('21.0_price_tiers').delete().eq('tier_id', t.tier_id);
    if (error) { flash(`Failed: ${error.message}`); return; }
    flash(`Tier "${t.name}" deleted`);
    refresh();
  }

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
  }, [supabase, refresh]);

  // ── Audit tab filters ──────────────────────────────────────────────────────
  const [auditSearch, setAuditSearch] = useState('');
  const [auditTier, setAuditTier] = useState('');
  const filteredViolations = useMemo(() => {
    const q = auditSearch.trim().toLowerCase();
    return violations.filter((v) => {
      if (auditTier && v.tier.tier_id !== auditTier) return false;
      if (!q) return true;
      return [descOf(v.comp), v.comp.category].filter(Boolean).join(' ').toLowerCase().includes(q);
    });
  }, [violations, auditSearch, auditTier]);

  // ── Overrides tab ──────────────────────────────────────────────────────────
  const [ovSearch, setOvSearch] = useState('');
  const overrideRows = useMemo(() => {
    const q = ovSearch.trim().toLowerCase();
    return overrides
      .map((o) => {
        const comp = compById.get(o.component_id);
        const tier = tierById.get(o.tier_id);
        if (!comp || !tier) return null;
        // Chain default = what this tier would cost if the override were cleared
        const defPrice = chainFor(comp, o.tier_id).get(o.tier_id)?.price ?? null;
        const effPrice = o.override_price_idr ?? null;
        return { o, comp, tier, defPrice, effPrice };
      })
      .filter((r): r is NonNullable<typeof r> => !!r)
      .filter((r) => !q || descOf(r.comp).toLowerCase().includes(q) || r.tier.name.toLowerCase().includes(q))
      .sort((a, b) => (b.o.updated_at || '').localeCompare(a.o.updated_at || ''));
  }, [overrides, compById, tierById, ovSearch, chainFor]);

  if (authLoading || !profile || !canManage) {
    return <div className="min-h-screen bg-chrome flex items-center justify-center"><div className="w-6 h-6 border-2 border-emerald-500/30 border-t-emerald-500 rounded-full animate-spin" /></div>;
  }

  const orderedTiers = [...tiers].sort((a, b) => a.sort_order - b.sort_order);

  return (
    <div className="min-h-screen bg-chrome text-slate-200 font-sans text-sm">
      <div className="border-b border-slate-800/60 bg-chrome/80 backdrop-blur-md sticky top-0 z-30">
        <div className="max-w-[1200px] 2xl:max-w-[1760px] mx-auto px-3 sm:px-4 md:px-6 py-2.5 sm:py-3 flex flex-col sm:flex-row sm:items-center justify-between sm:flex-wrap gap-2.5 sm:gap-x-4 sm:gap-y-2.5">
          <BrandMenu wordmarkClass="text-xl md:text-2xl font-extrabold" subtitle="Pricing Tiers · Ladder & margin floor" />
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
            <div className="flex items-center gap-5 border-b border-slate-800/80">
              {([['set', 'Set Pricing'], ['tiers', 'Tiers'], ['audit', `Floor Audit${violations.length ? ` (${violations.length})` : ''}`], ['overrides', `Overrides${overrides.length ? ` (${overrides.length})` : ''}`], ['profiles', `Margin Profiles${marginProfiles.length ? ` (${marginProfiles.length})` : ''}`]] as [Tab, string][]).map(([k, label]) => (
                <button key={k} onClick={() => setTab(k)}
                  className={`pb-2.5 -mb-px text-[13px] transition-colors border-b-2 ${tab === k ? 'border-emerald-400 text-white font-bold' : 'border-transparent text-slate-500 hover:text-slate-300 font-medium'}`}>
                  {label}
                </button>
              ))}
            </div>

            {loading ? (
              <div className="space-y-2">{[...Array(4)].map((_, i) => <div key={i} className="h-24 bg-slate-800/40 rounded-2xl animate-pulse" />)}</div>
            ) : tab === 'set' ? (
              <SetPricingTab comps={comps} tiers={activeSorted} chainFor={chainFor} costOf={costOf}
                profileById={profileById} ovByKey={ovByKey} saving={savingRows} onSave={saveEdits} />
            ) : tab === 'tiers' ? (
              <TiersTab tiers={orderedTiers} custTierCounts={custTierCounts} overridesByTier={overridesByTier}
                violationsByTier={violationsByTier} saving={savingTier}
                onSave={saveTier} onAdd={addTier} onMove={moveTier} onDelete={deleteTier} onGoAudit={(tid) => { setAuditTier(tid); setTab('audit'); }} />
            ) : tab === 'audit' ? (
              <AuditTab violations={filteredViolations} allCount={violations.length} totalLeakage={totalLeakage}
                itemsNoCost={itemsNoCost} tiers={orderedTiers.filter((t) => t.is_active)}
                search={auditSearch} setSearch={setAuditSearch} tierFilter={auditTier} setTierFilter={setAuditTier}
                bulkBusy={bulkBusy} onRaise={raiseToFloor} onClear={clearOverride} onBulkRaise={bulkRaise} />
            ) : tab === 'profiles' ? (
              <MarginProfilesTab profiles={marginProfiles} counts={profileCounts} onChanged={refreshMarginProfiles} notify={setToast} />
            ) : (
              <OverridesTab rows={overrideRows} search={ovSearch} setSearch={setOvSearch} onClear={clearOverride} costOf={costOf} />
            )}
          </>
        )}
      </main>

      {toast && <div className="fixed bottom-6 right-6 z-[110] px-4 py-2.5 bg-slate-800 border border-slate-700 text-white text-sm font-semibold rounded-xl shadow-lg max-w-[90vw] truncate">{toast}</div>}
    </div>
  );
}

// ── Tiers tab ────────────────────────────────────────────────────────────────
function TiersTab({ tiers, custTierCounts, overridesByTier, violationsByTier, saving, onSave, onAdd, onMove, onDelete, onGoAudit }: {
  tiers: Tier[];
  custTierCounts: Map<string, number>;
  overridesByTier: Map<string, number>;
  violationsByTier: Map<string, number>;
  saving: string | null;
  onSave: (t: Tier, patch: Partial<Tier>) => void;
  onAdd: (draft: { name: string; default_discount_pct: number; margin_floor_pct: number }) => void;
  onMove: (t: Tier, dir: -1 | 1) => void;
  onDelete: (t: Tier) => void;
  onGoAudit: (tierId: string) => void;
}) {
  const { defaultMarginFloorPct: defaultFloor, defaultTierStepPct } = useSettings();
  const [adding, setAdding] = useState(false);
  const [draft, setDraft] = useState({ name: '', disc: '', floor: '' });
  // A new tier starts at the house markup step + margin floor (Settings › Pricing)
  const openAdd = () => {
    setDraft({ name: '', disc: defaultTierStepPct > 0 ? String(defaultTierStepPct) : '', floor: String(defaultFloor) });
    setAdding(true);
  };
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);

  // A worked example makes the chain self-explanatory: what a Rp 100,000 net
  // price becomes at every tier, with the actual margin after Rp-1,000 rounding.
  const activeOrdered = useMemo(() => tiers.filter((t) => t.is_active), [tiers]);
  const example = useMemo(() => computeTierChain(100_000, activeOrdered), [activeOrdered]);

  return (
    <div className="space-y-4">
      <p className="text-[11px] text-slate-600 max-w-3xl">
        Markup chain: the price entered on an item IS the first tier — the <span className="text-slate-400">net price</span>. Each tier above it
        adds its <span className="text-slate-400">markup %</span> on the tier before it (price = previous ÷ (1 − markup%)), rounded up to the
        nearest Rp 1,000 — so the actual margin lands slightly above the setting. Per-item overrides pin a tier and the tiers above chain from the
        pinned price. The <span className="text-slate-400">margin floor</span> is the minimum GP vs landed cost — prices under it show up in the
        Floor Audit. Customers pick a tier on their profile; the sales editor auto-fills that tier’s prices.
      </p>

      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
        {tiers.map((t, i) => {
          const customers = custTierCounts.get(t.tier_code) ?? 0;
          const ovs = overridesByTier.get(t.tier_id) ?? 0;
          const viols = violationsByTier.get(t.tier_id) ?? 0;
          const activeIdx = activeOrdered.findIndex((x) => x.tier_id === t.tier_id);
          const isNetTier = activeIdx === 0;
          const prevTier = activeIdx > 0 ? activeOrdered[activeIdx - 1] : null;
          const ex = activeIdx >= 0 ? example.get(t.tier_id) : undefined;
          return (
            <div key={t.tier_id} className={`bg-slate-900/40 border rounded-2xl p-4 space-y-3 transition-colors ${t.is_active ? 'border-slate-800/80' : 'border-slate-800/40 opacity-60'}`}>
              <div className="flex items-start justify-between gap-2">
                <div className="flex items-center gap-1.5">
                  <div className="flex flex-col -my-1">
                    <button onClick={() => onMove(t, -1)} disabled={i === 0} className="text-slate-600 hover:text-white disabled:opacity-20 leading-none text-[10px] px-1 py-0.5 transition-colors" title="Move up">▲</button>
                    <button onClick={() => onMove(t, 1)} disabled={i === tiers.length - 1} className="text-slate-600 hover:text-white disabled:opacity-20 leading-none text-[10px] px-1 py-0.5 transition-colors" title="Move down">▼</button>
                  </div>
                  {/* No NET badge here: the Price basis field below already
                      says "Net — as entered per item", and a badge floating
                      after a fixed-width name input reads as detached from the
                      title it is meant to qualify. */}
                  <input defaultValue={t.name} key={`name-${t.tier_id}-${t.name}`}
                    onBlur={(e) => { const v = e.target.value.trim(); if (v && v !== t.name) onSave(t, { name: v }); }}
                    className="bg-transparent text-white font-bold text-base outline-none border-b border-transparent focus:border-emerald-500/50 min-w-0 w-36 transition-colors" />
                </div>
                <label className="flex items-center gap-1.5 text-[10px] text-slate-500 cursor-pointer select-none flex-shrink-0">
                  <input type="checkbox" checked={t.is_active} onChange={(e) => onSave(t, { is_active: e.target.checked })} className="accent-emerald-500 w-3.5 h-3.5" />
                  Active
                </label>
              </div>

              <div className="grid grid-cols-3 gap-2">
                <Field label="Code" title="Stored on customer profiles — renaming migrates them">
                  <input defaultValue={t.tier_code} key={`code-${t.tier_id}-${t.tier_code}`}
                    onBlur={(e) => { const v = e.target.value.trim().toLowerCase().replace(/\s+/g, '_'); if (v && v !== t.tier_code) onSave(t, { tier_code: v }); }}
                    className={tInp} />
                </Field>
                {isNetTier ? (
                  <Field label="Price basis" title="This is the NET tier — its price is exactly the net price entered on each item; no markup applies">
                    <p className="px-2 py-1.5 text-xs text-emerald-300/90 font-semibold">Net — as entered per item</p>
                  </Field>
                ) : (
                  <Field label={`Markup % on ${prevTier?.name ?? 'prev tier'}`}
                    title={`This tier's price = ${prevTier?.name ?? 'previous tier'} ÷ (1 − markup%), rounded up to Rp 1,000`}>
                    <input defaultValue={String(t.default_discount_pct)} key={`disc-${t.tier_id}-${t.default_discount_pct}`} inputMode="decimal"
                      onBlur={(e) => { const v = num(e.target.value); if (v != null && v !== t.default_discount_pct) onSave(t, { default_discount_pct: v }); }}
                      className={`${tInp} text-right tabular-nums`} />
                  </Field>
                )}
                <Field label="Floor GP %" title="Minimum margin vs landed cost — below it = Floor Audit">
                  <input defaultValue={String(t.margin_floor_pct)} key={`floor-${t.tier_id}-${t.margin_floor_pct}`} inputMode="decimal"
                    onBlur={(e) => { const v = num(e.target.value); if (v != null && v !== t.margin_floor_pct) onSave(t, { margin_floor_pct: v }); }}
                    className={`${tInp} text-right tabular-nums`} />
                </Field>
              </div>

              {/* Worked example so the % is never abstract */}
              {ex?.price != null && (
                <p className="text-[10px] text-slate-600">
                  {isNetTier
                    ? 'e.g. item entered at Rp 100,000 → this tier sells at Rp 100,000.'
                    : <>e.g. net Rp 100,000 → <span className="text-slate-400 tabular-nums">{fmtRupiah(ex.price)}</span> here{ex.actualMarginPct != null ? <> · actual +{ex.actualMarginPct.toFixed(1)}% on {prevTier?.name} after rounding</> : null}</>}
                </p>
              )}

              <div className="flex items-center gap-1.5 flex-wrap text-[10px]">
                <span className="px-1.5 py-0.5 rounded bg-slate-800 text-slate-400 tabular-nums">{customers} customer{customers !== 1 ? 's' : ''}</span>
                <span className="px-1.5 py-0.5 rounded bg-slate-800 text-slate-400 tabular-nums">{ovs} override{ovs !== 1 ? 's' : ''}</span>
                {viols > 0 ? (
                  <button onClick={() => onGoAudit(t.tier_id)} className="px-1.5 py-0.5 rounded bg-red-500/10 text-red-300 tabular-nums hover:bg-red-500/20 transition-colors" title="Open in Floor Audit">
                    ⚠ {viols} below floor
                  </button>
                ) : (
                  <span className="px-1.5 py-0.5 rounded bg-emerald-500/10 text-emerald-400/80">floor clear</span>
                )}
                <span className="flex-1" />
                {confirmDelete === t.tier_id ? (
                  <span className="flex items-center gap-1.5">
                    <span className="text-red-300">{ovs > 0 ? `Deletes ${ovs} override${ovs !== 1 ? 's' : ''}.` : ''}{customers > 0 ? ` ${customers} customer${customers !== 1 ? 's' : ''} keep the code (reassign them).` : ''} Sure?</span>
                    <button onClick={() => { setConfirmDelete(null); onDelete(t); }} className="px-1.5 py-0.5 rounded bg-red-600 hover:bg-red-500 text-white font-bold transition-colors">Delete</button>
                    <button onClick={() => setConfirmDelete(null)} className="px-1.5 py-0.5 rounded bg-slate-800 text-slate-400 hover:text-white transition-colors">Cancel</button>
                  </span>
                ) : (
                  <button onClick={() => setConfirmDelete(t.tier_id)} className="text-slate-600 hover:text-red-400 transition-colors" title="Delete tier">Delete</button>
                )}
              </div>
              {saving === t.tier_id && <p className="text-[10px] text-slate-600">Saving…</p>}
            </div>
          );
        })}

        {/* Add tier */}
        <div className="border border-dashed border-slate-800 rounded-2xl p-4 flex flex-col justify-center min-h-[150px]">
          {adding ? (
            <div className="space-y-2">
              <input autoFocus value={draft.name} onChange={(e) => setDraft((d) => ({ ...d, name: e.target.value }))} placeholder="Tier name (e.g. Project)" className={tInp} />
              <div className="grid grid-cols-2 gap-2">
                <input value={draft.disc} onChange={(e) => setDraft((d) => ({ ...d, disc: e.target.value }))} inputMode="decimal" placeholder="% off list" className={`${tInp} text-right`} />
                <input value={draft.floor} onChange={(e) => setDraft((d) => ({ ...d, floor: e.target.value }))} inputMode="decimal" placeholder="Floor GP %" className={`${tInp} text-right`} />
              </div>
              <div className="flex gap-2">
                <button onClick={() => { onAdd({ name: draft.name, default_discount_pct: num(draft.disc) ?? 0, margin_floor_pct: num(draft.floor) ?? defaultFloor }); setDraft({ name: '', disc: '', floor: '' }); setAdding(false); }}
                  className="flex-1 px-3 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-bold transition-colors">Add tier</button>
                <button onClick={() => setAdding(false)} className="px-3 py-1.5 rounded-lg text-xs text-slate-400 hover:text-white border border-slate-700 transition-colors">Cancel</button>
              </div>
            </div>
          ) : (
            <button onClick={() => setAdding(true)} className="text-sm text-emerald-400 hover:text-emerald-300 font-semibold transition-colors">+ Add tier</button>
          )}
        </div>
      </div>
    </div>
  );
}

function Field({ label, title, children }: { label: string; title?: string; children: React.ReactNode }) {
  return (
    <div title={title}>
      <label className="block text-[9px] font-medium uppercase tracking-wider text-slate-600 mb-0.5">{label}</label>
      {children}
    </div>
  );
}
const tInp = 'w-full px-2 py-1.5 rounded-lg bg-slate-950 border border-slate-800 focus:border-emerald-500/50 outline-none text-white text-xs placeholder:text-slate-600 transition-colors';

// ── Floor Audit tab ──────────────────────────────────────────────────────────
function AuditTab({ violations, allCount, totalLeakage, itemsNoCost, tiers, search, setSearch, tierFilter, setTierFilter, bulkBusy, onRaise, onClear, onBulkRaise }: {
  violations: Violation[];
  allCount: number;
  totalLeakage: number;
  itemsNoCost: number;
  tiers: Tier[];
  search: string; setSearch: (v: string) => void;
  tierFilter: string; setTierFilter: (v: string) => void;
  bulkBusy: boolean;
  onRaise: (v: Violation) => void;
  onClear: (priceId: string, label?: string) => void;
  onBulkRaise: (list: Violation[]) => void;
}) {
  const [confirmBulk, setConfirmBulk] = useState(false);
  const fixable = violations.filter((v) => v.minPrice != null);

  return (
    <div className="space-y-4">
      {/* Economics up top: what's at stake if this stock sells at current prices */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-2.5">
        <Stat label="Prices below floor" value={String(allCount)} tone={allCount ? 'red' : 'green'} />
        <Stat label="Margin at risk (on-hand)" value={totalLeakage ? fmtRupiah(totalLeakage) : 'Rp 0'} tone={totalLeakage ? 'red' : 'green'}
          hint="If current on-hand stock sells at these prices instead of the floor minimum" />
        <Stat label="Tiers audited" value={String(tiers.length)} tone="neutral" />
        <Stat label="Priced items without landed cost" value={String(itemsNoCost)} tone={itemsNoCost ? 'amber' : 'green'}
          hint="Have a sell price but no stock cost yet — audited once goods are received" />
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <div className="relative flex-1 min-w-[200px]">
          <svg className="w-4 h-4 text-slate-500 absolute left-3.5 top-1/2 -translate-y-1/2" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M21 21l-4.35-4.35M17 11a6 6 0 11-12 0 6 6 0 0112 0z" /></svg>
          <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search item or category…"
            className="w-full pl-10 pr-4 h-10 rounded-xl bg-slate-900/80 border border-slate-700/80 focus:border-emerald-500/60 outline-none text-white text-base sm:text-sm placeholder:text-[13px] sm:placeholder:text-sm placeholder:text-slate-500 transition-colors" />
        </div>
        <select value={tierFilter} onChange={(e) => setTierFilter(e.target.value)}
          className="h-10 px-3 rounded-xl bg-slate-900/80 border border-slate-700/80 focus:border-emerald-500/60 outline-none text-slate-300 text-xs transition-colors cursor-pointer">
          <option value="">All tiers</option>
          {tiers.map((t) => <option key={t.tier_id} value={t.tier_id}>{t.name}</option>)}
        </select>
        {fixable.length > 0 && (
          confirmBulk ? (
            <span className="flex items-center gap-2 text-xs">
              <span className="text-slate-400">Write {fixable.length} override{fixable.length !== 1 ? 's' : ''} at the floor minimum?</span>
              <button onClick={() => { setConfirmBulk(false); onBulkRaise(fixable); }} disabled={bulkBusy}
                className="px-3 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white font-bold transition-colors disabled:opacity-50">{bulkBusy ? 'Raising…' : 'Confirm'}</button>
              <button onClick={() => setConfirmBulk(false)} className="px-2 py-1.5 text-slate-500 hover:text-white transition-colors">Cancel</button>
            </span>
          ) : (
            <button onClick={() => setConfirmBulk(true)} disabled={bulkBusy}
              className="px-3 py-2 rounded-xl bg-emerald-600/15 border border-emerald-500/40 text-emerald-300 hover:bg-emerald-600/25 text-xs font-bold transition-colors disabled:opacity-50">
              ↑ Raise {tierFilter || search ? `these ${fixable.length}` : `all ${fixable.length}`} to floor
            </button>
          )
        )}
      </div>

      {violations.length === 0 ? (
        <div className="bg-slate-900/40 border border-slate-800/80 rounded-2xl px-4 py-14 text-center">
          <p className="text-emerald-400/90 font-semibold">✓ Every audited price clears its tier’s margin floor.</p>
          <p className="text-[11px] text-slate-600 mt-1.5">Audited = items with a landed cost (received stock) × active tiers. New receipts can shift landed cost — check back after receiving.</p>
        </div>
      ) : (
        <div className="bg-slate-900/40 border border-slate-800/80 rounded-2xl overflow-x-auto">
          <table className="w-full min-w-[880px]">
            <thead>
              <tr className="border-b border-slate-800 text-[10px] uppercase tracking-widest text-slate-500">
                <th className="text-left font-semibold px-4 py-2.5">Item</th>
                <th className="text-left font-semibold px-3 py-2.5">Tier</th>
                <th className="text-right font-semibold px-3 py-2.5">Price</th>
                <th className="text-right font-semibold px-3 py-2.5">Landed cost</th>
                <th className="text-right font-semibold px-3 py-2.5">GP now</th>
                <th className="text-right font-semibold px-3 py-2.5">Floor</th>
                <th className="text-right font-semibold px-3 py-2.5">Floor min</th>
                <th className="text-right font-semibold px-3 py-2.5" title="(floor min − price) × on-hand qty">At risk</th>
                <th className="text-right font-semibold px-3 py-2.5">Fix</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800/60">
              {violations.map((v) => (
                <tr key={`${v.comp.component_id}:${v.tier.tier_id}`} className="hover:bg-slate-800/20 transition-colors">
                  <td className="px-4 py-2">
                    <p className="text-sm text-slate-100 truncate max-w-[280px]">{descOf(v.comp)}</p>
                    <p className="text-[10px] text-slate-600">{v.onHand > 0 ? `${fmtInt(v.onHand)}${v.comp.unit ? ` ${v.comp.unit}` : ''} on hand` : 'no stock on hand'}</p>
                  </td>
                  <td className="px-3 py-2 text-xs text-slate-400 whitespace-nowrap">
                    {v.tier.name}
                    {v.ov && <span className="block text-[9px] text-emerald-500/70">override</span>}
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums text-sm text-slate-200 whitespace-nowrap">{fmtRupiah(v.price)}</td>
                  <td className="px-3 py-2 text-right tabular-nums text-xs text-slate-400 whitespace-nowrap">{fmtRupiah(v.cost)}</td>
                  <td className="px-3 py-2 text-right tabular-nums text-sm font-semibold text-red-400 whitespace-nowrap">{v.gp.toFixed(1)}%</td>
                  <td className="px-3 py-2 text-right tabular-nums text-xs text-slate-500">{v.tier.margin_floor_pct}%</td>
                  <td className="px-3 py-2 text-right tabular-nums text-xs text-emerald-300/90 whitespace-nowrap">{v.minPrice != null ? fmtRupiah(v.minPrice) : '—'}</td>
                  <td className="px-3 py-2 text-right tabular-nums text-xs whitespace-nowrap">
                    {v.leakage > 0 ? <span className="text-red-300">{fmtRupiah(v.leakage)}</span> : <span className="text-slate-700">—</span>}
                  </td>
                  <td className="px-3 py-2 text-right whitespace-nowrap">
                    <span className="inline-flex gap-1.5">
                      {v.defaultCompliant && v.ov && (
                        <button onClick={() => onClear(v.ov!.price_id, `${descOf(v.comp)} · ${v.tier.name} — override cleared, tier default is compliant`)}
                          title="The override is what breaks the floor — clearing it returns to the compliant tier default"
                          className="px-2 py-1 rounded-lg border border-slate-700 text-slate-400 hover:text-white hover:bg-slate-800 text-[11px] transition-colors">Clear override</button>
                      )}
                      {v.minPrice != null && (
                        <button onClick={() => onRaise(v)}
                          title={`Write a ${v.tier.name} override at ${fmtRupiah(v.minPrice)}`}
                          className="px-2 py-1 rounded-lg bg-emerald-600/15 border border-emerald-500/40 text-emerald-300 hover:bg-emerald-600/25 text-[11px] font-semibold transition-colors">↑ {fmtRupiah(v.minPrice)}</button>
                      )}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <p className="text-[10px] text-slate-600">
        GP = (price − landed cost) ÷ price, landed cost = moving average from received stock. “Raise to floor” writes a per-item override at the compliant
        minimum (rounded up to Rp 1,000); tiers above the raised one re-chain from the new price automatically. Internal only — never shown to customers.
      </p>
    </div>
  );
}

function Stat({ label, value, hint, tone }: { label: string; value: string; hint?: string; tone: 'red' | 'green' | 'amber' | 'neutral' }) {
  const toneCls = tone === 'red' ? 'text-red-300' : tone === 'green' ? 'text-emerald-300' : tone === 'amber' ? 'text-amber-300' : 'text-slate-200';
  return (
    <div className="bg-slate-900/40 border border-slate-800/80 rounded-2xl px-4 py-3" title={hint}>
      <p className="text-[10px] uppercase tracking-wider text-slate-600">{label}</p>
      <p className={`text-lg font-bold tabular-nums mt-0.5 ${toneCls}`}>{value}</p>
    </div>
  );
}

// ── Overrides tab ────────────────────────────────────────────────────────────
function OverridesTab({ rows, search, setSearch, onClear, costOf }: {
  rows: { o: Override; comp: Comp; tier: Tier; defPrice: number | null; effPrice: number | null }[];
  search: string; setSearch: (v: string) => void;
  onClear: (priceId: string) => void;
  costOf: (cid: string) => number | null;
}) {
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative flex-1 min-w-[200px]">
          <svg className="w-4 h-4 text-slate-500 absolute left-3.5 top-1/2 -translate-y-1/2" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M21 21l-4.35-4.35M17 11a6 6 0 11-12 0 6 6 0 0112 0z" /></svg>
          <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search item or tier…"
            className="w-full pl-10 pr-4 h-10 rounded-xl bg-slate-900/80 border border-slate-700/80 focus:border-emerald-500/60 outline-none text-white text-base sm:text-sm placeholder:text-[13px] sm:placeholder:text-sm placeholder:text-slate-500 transition-colors" />
        </div>
        <span className="text-xs text-slate-600 tabular-nums">{rows.length} override{rows.length !== 1 ? 's' : ''}</span>
      </div>

      {rows.length === 0 ? (
        <div className="bg-slate-900/40 border border-slate-800/80 rounded-2xl px-4 py-14 text-center">
          <p className="text-slate-400">No per-item overrides{search ? ' match' : ' yet'}.</p>
          <p className="text-[11px] text-slate-600 mt-1.5">
            Overrides pin an item’s price for one tier, replacing “list − tier %”. Create them in the Catalog’s <span className="text-slate-400">Pricing Mode</span>, from an item’s Tiers popover, or via “Raise to floor” in the Floor Audit.
          </p>
        </div>
      ) : (
        <div className="bg-slate-900/40 border border-slate-800/80 rounded-2xl overflow-x-auto">
          <table className="w-full min-w-[780px]">
            <thead>
              <tr className="border-b border-slate-800 text-[10px] uppercase tracking-widest text-slate-500">
                <th className="text-left font-semibold px-4 py-2.5">Item</th>
                <th className="text-left font-semibold px-3 py-2.5">Tier</th>
                <th className="text-right font-semibold px-3 py-2.5">Override</th>
                <th className="text-right font-semibold px-3 py-2.5">Tier default</th>
                <th className="text-right font-semibold px-3 py-2.5">vs default</th>
                <th className="text-right font-semibold px-3 py-2.5">GP</th>
                <th className="text-left font-semibold px-3 py-2.5">Updated</th>
                <th className="text-right font-semibold px-3 py-2.5"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800/60">
              {rows.map(({ o, comp, tier, defPrice, effPrice }) => {
                const delta = effPrice != null && defPrice != null && defPrice > 0 ? ((effPrice - defPrice) / defPrice) * 100 : null;
                const cost = costOf(comp.component_id);
                const gp = effPrice != null && effPrice > 0 && cost != null ? ((effPrice - cost) / effPrice) * 100 : null;
                const belowFloor = gp != null && gp < (tier.margin_floor_pct || 0);
                return (
                  <tr key={o.price_id} className="hover:bg-slate-800/20 transition-colors">
                    <td className="px-4 py-2"><p className="text-sm text-slate-100 truncate max-w-[300px]">{descOf(comp)}</p></td>
                    <td className="px-3 py-2 text-xs text-slate-400 whitespace-nowrap">{tier.name}</td>
                    <td className="px-3 py-2 text-right tabular-nums text-sm text-emerald-300 font-semibold whitespace-nowrap">
                      {o.override_price_idr != null ? fmtRupiah(o.override_price_idr) : o.override_discount_pct != null ? `−${o.override_discount_pct}%` : '—'}
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums text-xs text-slate-500 whitespace-nowrap">{defPrice != null ? fmtRupiah(defPrice) : '—'}</td>
                    <td className={`px-3 py-2 text-right tabular-nums text-xs whitespace-nowrap ${delta == null ? 'text-slate-700' : delta < 0 ? 'text-amber-300/90' : 'text-emerald-400/80'}`}>
                      {delta == null ? '—' : `${delta > 0 ? '+' : ''}${delta.toFixed(1)}%`}
                    </td>
                    <td className={`px-3 py-2 text-right tabular-nums text-xs whitespace-nowrap ${gp == null ? 'text-slate-700' : belowFloor ? 'text-red-400 font-semibold' : 'text-slate-400'}`}>
                      {gp == null ? '—' : `${gp.toFixed(1)}%${belowFloor ? ' ⚠' : ''}`}
                    </td>
                    <td className="px-3 py-2 text-[11px] text-slate-500 whitespace-nowrap">
                      {fmtDay(o.updated_at)}{o.updated_by_email ? <span className="text-slate-700"> · {o.updated_by_email.split('@')[0]}</span> : ''}
                    </td>
                    <td className="px-3 py-2 text-right whitespace-nowrap">
                      <button onClick={() => onClear(o.price_id)} title="Remove the override — back to list − tier %"
                        className="px-2 py-1 rounded-lg border border-slate-700 text-slate-400 hover:text-white hover:bg-slate-800 text-[11px] transition-colors">Clear</button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

/**
 * Margin Profiles — what each tier is SUPPOSED to earn.
 *
 * The targets live here and nowhere else: no screen in the app hardcodes
 * 10–15 or 20–25, so moving a band moves every judgement that depends on it
 * without a deploy. That was an explicit requirement.
 *
 * Built as a LIST over whatever rows exist, plus an Add — not two hardcoded
 * cards — because the owner expects to add a middle "Standard" tier later.
 */
function MarginProfilesTab({ profiles, counts, onChanged, notify }: {
  profiles: MarginProfile[];
  counts: Map<string, number>;
  onChanged: () => Promise<void> | void;
  notify: (m: string) => void;
}) {
  const supabase = createSupabaseClient();
  const [draft, setDraft] = useState<Record<string, Partial<MarginProfile>>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);

  const val = <K extends keyof MarginProfile>(p: MarginProfile, k: K): MarginProfile[K] =>
    (draft[p.id]?.[k] ?? p[k]) as MarginProfile[K];
  const dirty = (p: MarginProfile) => Object.keys(draft[p.id] ?? {}).length > 0;
  const set = (id: string, k: keyof MarginProfile, v: unknown) =>
    setDraft((d) => ({ ...d, [id]: { ...(d[id] ?? {}), [k]: v } }));

  const save = async (p: MarginProfile) => {
    const min = Number(val(p, 'margin_target_min'));
    const max = Number(val(p, 'margin_target_max'));
    const bad = rangeError(min, max);
    if (bad) { notify(bad); return; }
    setBusy(p.id);
    const ok = await saveMarginProfile(supabase, p.id, {
      label: String(val(p, 'label')).trim() || p.label,
      margin_target_min: min, margin_target_max: max,
      description: (val(p, 'description') as string | null) ?? null,
    });
    setBusy(null);
    if (!ok) { notify('Could not save that profile.'); return; }
    setDraft((d) => { const n = { ...d }; delete n[p.id]; return n; });
    await onChanged();
    notify(`${String(val(p, 'label'))} saved`);
  };

  const add = async () => {
    setAdding(true);
    const created = await createMarginProfile(supabase, {
      code: `profile_${Date.now().toString(36)}`,
      label: 'New profile', margin_target_min: 15, margin_target_max: 20,
      description: null,
    });
    setAdding(false);
    if (!created) { notify('Could not add a profile — owner or sell-side admin only.'); return; }
    await onChanged();
  };

  const remove = async (p: MarginProfile) => {
    setBusy(p.id);
    const ok = await deleteMarginProfile(supabase, p.id);
    setBusy(null);
    setConfirmDelete(null);
    if (!ok) { notify('Could not delete — items may still be on this profile.'); return; }
    await onChanged();
    notify(`${p.label} removed`);
  };

  const unclassified = counts.get('none') ?? 0;

  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <p className="text-[12px] text-slate-400 max-w-2xl leading-relaxed">
          What each tier of item is expected to earn. These bands are the only place the targets
          live — change one here and every screen that judges a margin follows, with no code change.
        </p>
        <button onClick={() => void add()} disabled={adding}
          className="flex-shrink-0 px-3 py-1.5 rounded-lg text-[12px] font-semibold bg-emerald-500/15 text-emerald-300 ring-1 ring-emerald-500/30 hover:bg-emerald-500/25 disabled:opacity-40 transition-colors">
          {adding ? 'Adding…' : '+ Add profile'}
        </button>
      </div>

      {unclassified > 0 && (
        <p className="text-[12px] text-amber-300/90 bg-amber-500/[0.07] border border-amber-500/20 rounded-xl px-3.5 py-2.5">
          <span className="font-semibold tabular-nums">{fmtInt(unclassified)}</span> items have no margin profile yet.
          They are shown as <span className="font-semibold">Unclassified</span> in the Item Editor — filter to them there
          and set the tier in bulk.
        </p>
      )}

      <div className="space-y-3">
        {profiles.map((p) => (
          <div key={p.id} className="bg-slate-900/50 border border-slate-800 rounded-2xl p-4">
            <div className="flex items-start gap-3 flex-wrap">
              <div className="min-w-[200px] flex-1">
                <label className="block text-[10px] uppercase tracking-widest text-slate-500 mb-1">Label</label>
                <input value={String(val(p, 'label') ?? '')} onChange={(e) => set(p.id, 'label', e.target.value)}
                  className="w-full px-2.5 py-1.5 rounded-lg bg-slate-950 border border-slate-700 focus:border-emerald-500/60 outline-none text-white text-sm" />
                <p className="text-[10px] text-slate-500 mt-1 font-mono">{p.code}</p>
              </div>
              <div className="w-[110px]">
                <label className="block text-[10px] uppercase tracking-widest text-slate-500 mb-1">Target min %</label>
                <input type="number" step="0.5" min="0" max="100"
                  value={String(val(p, 'margin_target_min') ?? '')}
                  onChange={(e) => set(p.id, 'margin_target_min', e.target.value)}
                  className="w-full px-2.5 py-1.5 rounded-lg bg-slate-950 border border-slate-700 focus:border-emerald-500/60 outline-none text-white text-sm tabular-nums" />
              </div>
              <div className="w-[110px]">
                <label className="block text-[10px] uppercase tracking-widest text-slate-500 mb-1">Target max %</label>
                <input type="number" step="0.5" min="0" max="100"
                  value={String(val(p, 'margin_target_max') ?? '')}
                  onChange={(e) => set(p.id, 'margin_target_max', e.target.value)}
                  className="w-full px-2.5 py-1.5 rounded-lg bg-slate-950 border border-slate-700 focus:border-emerald-500/60 outline-none text-white text-sm tabular-nums" />
              </div>
              <div className="w-[120px]">
                <label className="block text-[10px] uppercase tracking-widest text-slate-500 mb-1">Items</label>
                <p className="px-2.5 py-1.5 text-sm text-slate-300 tabular-nums">{fmtInt(counts.get(p.id) ?? 0)}</p>
              </div>
            </div>
            <div className="mt-3">
              <label className="block text-[10px] uppercase tracking-widest text-slate-500 mb-1">Description</label>
              <textarea rows={2} value={String(val(p, 'description') ?? '')}
                onChange={(e) => set(p.id, 'description', e.target.value)}
                placeholder="What kind of item belongs in this tier, and why"
                className="w-full px-2.5 py-1.5 rounded-lg bg-slate-950 border border-slate-700 focus:border-emerald-500/60 outline-none text-slate-300 text-xs leading-relaxed placeholder:text-slate-500 resize-y" />
            </div>
            <div className="flex items-center gap-2 mt-3">
              <button onClick={() => void save(p)} disabled={!dirty(p) || busy === p.id}
                className="px-3 py-1.5 rounded-lg text-[12px] font-semibold bg-emerald-500/15 text-emerald-300 ring-1 ring-emerald-500/30 hover:bg-emerald-500/25 disabled:opacity-30 transition-colors">
                {busy === p.id ? 'Saving…' : 'Save'}
              </button>
              {dirty(p) && (
                <button onClick={() => setDraft((d) => { const n = { ...d }; delete n[p.id]; return n; })}
                  className="text-[12px] font-semibold text-slate-400 hover:text-white transition-colors">Cancel</button>
              )}
              <span className="ml-auto">
                {confirmDelete === p.id ? (
                  <span className="flex items-center gap-2">
                    <span className="text-[11px] text-red-400">Remove {p.label}?</span>
                    <button onClick={() => void remove(p)} className="text-[11px] font-semibold text-red-400 hover:text-red-300">Remove</button>
                    <button onClick={() => setConfirmDelete(null)} className="text-[11px] text-slate-400 hover:text-white">Keep</button>
                  </span>
                ) : (
                  <button onClick={() => setConfirmDelete(p.id)}
                    className="text-[11px] text-slate-500 hover:text-red-400 transition-colors">Remove</button>
                )}
              </span>
            </div>
          </div>
        ))}
        {profiles.length === 0 && (
          <p className="text-[12px] text-slate-400 py-6 text-center">No margin profiles yet. Add one to start classifying items.</p>
        )}
      </div>
    </div>
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
  comps, tiers, chainFor, costOf, profileById, ovByKey, saving, onSave,
}: {
  comps: Comp[];
  tiers: Tier[];
  chainFor: (c: Comp, excludeTierId?: string) => Map<string, { price: number | null; overridden: boolean }>;
  costOf: (cid: string) => number | null;
  profileById: Map<string, MarginProfile>;
  ovByKey: Map<string, Override>;
  saving: boolean;
  onSave: (edits: { component_id: string; tier_id: string | null; value: number | null }[]) => Promise<number>;
}) {
  const [search, setSearch] = useState('');
  const [wanted, setWanted] = useState<Set<PriceIssue>>(new Set());
  // Staged cells: `${component_id}:${tier_id | 'net'}` → what is in the box.
  const [draft, setDraft] = useState<Record<string, string>>({});
  const [page, setPage] = useState(200);

  const netTierId = tiers[0]?.tier_id ?? null;
  const keyOf = (cid: string, tid: string) => `${cid}:${tid === netTierId ? 'net' : tid}`;

  const rows = useMemo(() => {
    const needle = search.trim().toLowerCase();
    return comps.map((c) => {
      const chain = chainFor(c);
      const priceByTier = new Map<string, number | null>();
      for (const t of tiers) priceByTier.set(t.tier_id, chain.get(t.tier_id)?.price ?? null);
      const cost = costOf(c.component_id);
      const profile = c.margin_profile_id ? profileById.get(c.margin_profile_id) ?? null : null;
      return {
        c, chain, priceByTier, cost, profile,
        issues: issuesFor({ net: c.selling_price_idr, cost, priceByTier, tiers, profile }),
        gp: marginPct(c.selling_price_idr, cost),
      };
    }).filter((r) => {
      if (!matchesIssues(r.issues, wanted)) return false;
      if (!needle) return true;
      return `${r.c.supplier_model} ${r.c.internal_description ?? ''} ${r.c.category ?? ''}`
        .toLowerCase().includes(needle);
    });
  }, [comps, tiers, chainFor, costOf, profileById, search, wanted]);

  // Counts sit on the chips, so the size of each problem is visible before
  // anyone clicks — that is what makes this a worklist rather than a filter.
  const counts = useMemo(() => {
    const m = new Map<PriceIssue, number>();
    for (const c of comps) {
      const chain = chainFor(c);
      const priceByTier = new Map<string, number | null>();
      for (const t of tiers) priceByTier.set(t.tier_id, chain.get(t.tier_id)?.price ?? null);
      const profile = c.margin_profile_id ? profileById.get(c.margin_profile_id) ?? null : null;
      for (const i of issuesFor({ net: c.selling_price_idr, cost: costOf(c.component_id), priceByTier, tiers, profile })) {
        m.set(i, (m.get(i) ?? 0) + 1);
      }
    }
    return m;
  }, [comps, tiers, chainFor, costOf, profileById]);

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

  const chip = (id: PriceIssue) => {
    const on = wanted.has(id);
    const n = counts.get(id) ?? 0;
    return (
      <button key={id} type="button" onClick={() => setWanted((w) => {
        const next = new Set(w); if (on) next.delete(id); else next.add(id); return next;
      })}
        className={`px-2.5 py-1 rounded-lg text-[11.5px] font-semibold border transition-colors ${
          on ? 'bg-emerald-500/15 text-emerald-300 border-emerald-500/40'
             : 'text-slate-400 border-slate-700 hover:border-slate-600 hover:text-slate-200'}`}>
        {ISSUE_LABEL[id]} <span className="tabular-nums opacity-70">{n}</span>
      </button>
    );
  };

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <input value={search} onChange={(e) => { setSearch(e.target.value); setPage(200); }}
          placeholder="Search item, model or category…"
          className="flex-1 min-w-[220px] max-w-sm bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-sm text-slate-200 placeholder-slate-500 focus:outline-none focus:ring-1 focus:ring-emerald-500/40" />
        {(['no_price', 'below_floor', 'below_band', 'above_band', 'unclassified'] as PriceIssue[]).map(chip)}
      </div>

      <div className="flex flex-wrap items-center gap-3 text-xs text-slate-500">
        <span className="tabular-nums">{fmtInt(rows.length)} of {fmtInt(comps.length)} items</span>
        {dirtyCids.length > 0 && (
          <button type="button" disabled={saving} onClick={() => commit(dirtyCids)}
            className="ml-auto px-3 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white text-[12px] font-bold disabled:opacity-50">
            {saving ? 'Saving…' : `Save all (${dirtyCids.length})`}
          </button>
        )}
      </div>

      <div className="overflow-x-auto rounded-xl border border-slate-800">
        <table className="w-full text-[12.5px]">
          <thead>
            <tr className="bg-slate-800/60 text-[11px] uppercase tracking-wide text-slate-400">
              <th className="text-left font-semibold px-3 py-2">Item</th>
              <th className="text-right font-semibold px-3 py-2 whitespace-nowrap">Landed cost</th>
              {tiers.map((t, i) => (
                <th key={t.tier_id} className="text-right font-semibold px-3 py-2 whitespace-nowrap">
                  {t.name}{i === 0 && <span className="ml-1 text-emerald-400/70 normal-case">net</span>}
                </th>
              ))}
              <th className="text-right font-semibold px-3 py-2">GP</th>
              <th className="px-3 py-2" />
            </tr>
          </thead>
          <tbody>
            {rows.slice(0, page).map((r) => {
              const cid = r.c.component_id;
              const dirty = Object.keys(draft).some((k) => k.startsWith(`${cid}:`));
              return (
                <tr key={cid} className="border-t border-slate-800/70 hover:bg-slate-800/30">
                  <td className="px-3 py-1.5">
                    <p className="text-slate-200 leading-tight">{descOf(r.c)}</p>
                    <p className="text-[11px] text-slate-500 font-mono">{r.c.supplier_model}</p>
                  </td>
                  <td className="px-3 py-1.5 text-right tabular-nums text-slate-400 whitespace-nowrap">
                    {r.cost == null ? <span className="text-slate-600">—</span> : fmtRupiah(r.cost)}
                  </td>
                  {tiers.map((t, i) => {
                    const k = keyOf(cid, t.tier_id);
                    const computed = r.priceByTier.get(t.tier_id) ?? null;
                    const pinned = i > 0 && Boolean(r.chain.get(t.tier_id)?.overridden);
                    const stored = i === 0 ? r.c.selling_price_idr
                      : (ovByKey.get(`${cid}:${t.tier_id}`)?.override_price_idr ?? null);
                    const shown = draft[k] !== undefined ? draft[k] : (stored != null ? String(stored) : '');
                    return (
                      <td key={t.tier_id} className="px-2 py-1.5 text-right">
                        <input value={shown} inputMode="numeric"
                          onChange={(e) => setDraft((d) => ({ ...d, [k]: e.target.value }))}
                          placeholder={computed != null ? fmtInt(computed) : '—'}
                          title={i === 0 ? "The item's own net price" : pinned ? 'Pinned — clear to go back to the markup chain' : 'From the markup chain — type to pin it'}
                          className={`w-24 text-right tabular-nums bg-transparent rounded px-1.5 py-1 border focus:outline-none focus:ring-1 focus:ring-emerald-500/40 ${
                            draft[k] !== undefined ? 'border-amber-500/50 text-amber-200'
                            : pinned ? 'border-violet-500/40 text-violet-200'
                            : stored != null ? 'border-slate-700 text-slate-200'
                            : 'border-transparent text-slate-500 hover:border-slate-700 placeholder-slate-600'}`} />
                      </td>
                    );
                  })}
                  <td className="px-3 py-1.5 text-right tabular-nums whitespace-nowrap">
                    {r.gp == null ? <span className="text-slate-600">—</span> : (
                      <span className={r.issues.has('below_floor') ? 'text-red-400'
                        : r.issues.has('below_band') ? 'text-amber-400'
                        : r.issues.has('above_band') ? 'text-emerald-400' : 'text-slate-300'}>
                        {r.gp.toFixed(1)}%
                      </span>
                    )}
                    {r.profile && <p className="text-[10px] text-slate-600">{bandOf(r.profile)}</p>}
                  </td>
                  <td className="px-2 py-1.5 text-right whitespace-nowrap">
                    {dirty ? (
                      <button type="button" disabled={saving} onClick={() => commit([cid])}
                        className="text-[11px] font-bold px-2 py-1 rounded bg-emerald-600 hover:bg-emerald-500 text-white disabled:opacity-50">
                        Save
                      </button>
                    ) : r.issues.has('below_band') && r.profile && r.cost != null ? (
                      // The economic consequence, one click away: what this
                      // item would have to sell at to reach its own band.
                      <button type="button"
                        onClick={() => {
                          const target = priceForMargin(r.cost, Number(r.profile!.margin_target_min));
                          if (target != null) setDraft((d) => ({ ...d, [keyOf(cid, tiers[0].tier_id)]: String(roundUpToStep(target)) }));
                        }}
                        className="text-[11px] text-amber-300/80 hover:text-amber-200 px-2 py-1 rounded border border-amber-500/25 hover:border-amber-500/50">
                        To target
                      </button>
                    ) : null}
                  </td>
                </tr>
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
          Show more ({fmtInt(rows.length - page)} left)
        </button>
      )}
    </div>
  );
}
