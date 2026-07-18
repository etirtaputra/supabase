/**
 * ICAPROC — Module 2: Price List + Tiering
 * Owner-only. Two views:
 *  • Price List — item × tier matrix. Each tier price = default % off list,
 *    overridable per item (absolute IDR). Each cell shows margin vs landed cost
 *    (TUC, internal-only) with a soft floor warning.
 *  • Tiers — manage the canonical tier set (default discount + margin floor).
 */
'use client';
import { useState, useEffect, useMemo, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { createSupabaseClient } from '@/lib/supabase';
import { useAuth } from '@/hooks/useAuth';
import { useSupabaseData } from '@/hooks/useSupabaseData';
import { ROLE_PERMISSIONS } from '@/constants/roles';
import { computeTUCMap } from '@/lib/computeTUC';
import BrandMenu from '@/components/ui/BrandMenu';
import PricingMigrationBanner from '@/components/ui/PricingMigrationBanner';

// ── Types ───────────────────────────────────────────────────────────────────
interface Tier {
  tier_id: string;
  tier_code: string;
  name: string;
  default_discount_pct: number;
  margin_floor_pct: number;
  sort_order: number;
  is_active: boolean;
}
interface Override {
  price_id?: string;
  component_id: string;
  tier_id: string;
  override_price_idr: number | null;
  override_discount_pct: number | null;
}
interface Comp {
  component_id: string;
  supplier_model?: string | null;
  brand?: string | null;
  category?: string | null;
  unit?: string | null;
  selling_price_idr?: number | null;
}

const fmtInt = (n: number) => Math.round(n).toLocaleString('en-US');
const num = (v: unknown): number | null => {
  if (v === '' || v === null || v === undefined) return null;
  const n = Number(String(v).replace(/[, ]/g, ''));
  return isNaN(n) ? null : n;
};

// Effective tier price given the list price, tier default, and any override.
function effectivePrice(list: number | null, tier: Tier, ov?: Override): number | null {
  if (list === null || list <= 0) {
    return ov?.override_price_idr ?? null;
  }
  if (ov?.override_price_idr != null) return ov.override_price_idr;
  const disc = ov?.override_discount_pct ?? tier.default_discount_pct ?? 0;
  return list * (1 - disc / 100);
}

export default function PricingPage() {
  const supabase = createSupabaseClient();
  const router = useRouter();
  const { user, profile, loading: authLoading } = useAuth();
  const { data, loading: dataLoading } = useSupabaseData();

  const canManage = !!profile && ROLE_PERMISSIONS[profile.role].canManagePricing;

  const [view, setView] = useState<'prices' | 'tiers'>('prices');
  const [tiers, setTiers] = useState<Tier[]>([]);
  const [overrides, setOverrides] = useState<Override[]>([]);
  const [search, setSearch] = useState('');
  const [toast, setToast] = useState<string | null>(null);
  const [loadingPricing, setLoadingPricing] = useState(true);

  const flash = (m: string) => { setToast(m); setTimeout(() => setToast(null), 2200); };

  useEffect(() => { document.title = 'Pricing — ICAPROC'; }, []);

  // Auth gate
  useEffect(() => {
    if (authLoading) return;
    if (!user) { router.replace(`/login?next=${encodeURIComponent('/pricing')}`); return; }
    if (profile && !ROLE_PERMISSIONS[profile.role].canManagePricing) router.replace('/unauthorized');
  }, [authLoading, user, profile, router]);

  const fetchPricing = useCallback(async () => {
    setLoadingPricing(true);
    const [tierRes, ovRes] = await Promise.all([
      supabase.from('21.0_price_tiers').select('*').order('sort_order'),
      supabase.from('21.1_item_tier_prices').select('*'),
    ]);
    setTiers((tierRes.data as Tier[]) ?? []);
    setOverrides((ovRes.data as Override[]) ?? []);
    setLoadingPricing(false);
  }, []);

  useEffect(() => { if (canManage) fetchPricing(); }, [canManage, fetchPricing]);

  // Landed cost (TUC) per component — internal cost basis for margin.
  const tucMap = useMemo(
    () => computeTUCMap(data.pos as any, data.poItems as any, data.poCosts as any),
    [data.pos, data.poItems, data.poCosts]);

  const activeTiers = useMemo(
    () => [...tiers].filter((t) => t.is_active).sort((a, b) => a.sort_order - b.sort_order),
    [tiers]);

  const ovByKey = useMemo(() => {
    const m = new Map<string, Override>();
    for (const o of overrides) m.set(`${o.component_id}:${o.tier_id}`, o);
    return m;
  }, [overrides]);

  const components = useMemo(() => (data.components as Comp[]) ?? [], [data.components]);
  const filteredComps = useMemo(() => {
    const q = search.trim().toLowerCase();
    const list = q
      ? components.filter((c) => `${c.supplier_model ?? ''} ${c.brand ?? ''} ${c.category ?? ''}`.toLowerCase().includes(q))
      : components;
    return list.slice(0, 300);
  }, [components, search]);

  if (authLoading || dataLoading || !profile) return <CenterSpinner />;
  if (!canManage) return <CenterSpinner />;

  return (
    <div className="min-h-screen bg-[#0f1012] text-slate-200 font-sans text-sm">
      {/* Header */}
      <div className="border-b border-slate-800/60 bg-[#0f1012]/80 backdrop-blur-md sticky top-0 z-30">
        <div className="max-w-[1600px] mx-auto px-4 md:px-8 py-4 flex items-center justify-between gap-4">
          <BrandMenu wordmarkClass="text-xl md:text-2xl font-extrabold" subtitle="Pricing · Tiers & price list" />
          <div className="flex items-center gap-0.5 p-0.5 bg-slate-800/60 border border-slate-700/60 rounded-xl">
            {(['prices', 'tiers'] as const).map((v) => (
              <button key={v} onClick={() => setView(v)}
                className={`px-3.5 py-1.5 rounded-lg text-xs font-semibold transition-colors ${view === v ? 'bg-slate-700 text-white' : 'text-slate-400 hover:text-white'}`}>
                {v === 'prices' ? 'Price List' : 'Tiers'}
              </button>
            ))}
          </div>
        </div>
      </div>

      <main className="max-w-[1600px] mx-auto px-4 md:px-8 py-6 space-y-5">
        <PricingMigrationBanner />

        {loadingPricing ? (
          <div className="space-y-1.5">{[...Array(8)].map((_, i) => <div key={i} className="h-12 bg-slate-800/40 rounded-xl animate-pulse" />)}</div>
        ) : view === 'tiers' ? (
          <TiersView tiers={tiers} onChanged={fetchPricing} flash={flash} />
        ) : (
          <PriceListView
            comps={filteredComps}
            totalComps={components.length}
            tiers={activeTiers}
            ovByKey={ovByKey}
            tucMap={tucMap}
            search={search}
            setSearch={setSearch}
            onOverrideChanged={fetchPricing}
            flash={flash}
          />
        )}
      </main>

      {toast && (
        <div className="fixed bottom-6 right-6 z-[110] px-4 py-2.5 bg-slate-800 border border-slate-700 text-white text-sm font-semibold rounded-xl shadow-lg">
          {toast}
        </div>
      )}
    </div>
  );
}

function CenterSpinner() {
  return (
    <div className="min-h-screen bg-[#0f1012] flex items-center justify-center">
      <div className="w-6 h-6 border-2 border-emerald-500/30 border-t-emerald-500 rounded-full animate-spin" />
    </div>
  );
}

// ── Price List view ─────────────────────────────────────────────────────────
function PriceListView({
  comps, totalComps, tiers, ovByKey, tucMap, search, setSearch, onOverrideChanged, flash,
}: {
  comps: Comp[];
  totalComps: number;
  tiers: Tier[];
  ovByKey: Map<string, Override>;
  tucMap: Map<string, { tuc: number }>;
  search: string;
  setSearch: (s: string) => void;
  onOverrideChanged: () => void;
  flash: (m: string) => void;
}) {
  const supabase = createSupabaseClient();
  // Local echo of list prices so edits show instantly before the next refetch.
  const [listEdits, setListEdits] = useState<Record<string, number | null>>({});
  const listOf = (c: Comp) => (c.component_id in listEdits ? listEdits[c.component_id] : (c.selling_price_idr ?? null));

  async function saveListPrice(c: Comp, raw: string) {
    const val = num(raw);
    const current = c.selling_price_idr ?? null;
    if (val === current) return;
    setListEdits((e) => ({ ...e, [c.component_id]: val }));
    const { error } = await supabase.from('3.0_components').update({ selling_price_idr: val }).eq('component_id', c.component_id);
    if (error) { flash(`List price failed: ${error.message}`); return; }
    flash('List price saved');
  }

  async function saveCell(c: Comp, tier: Tier, raw: string) {
    const list = listOf(c);
    const key = `${c.component_id}:${tier.tier_id}`;
    const existing = ovByKey.get(key);
    const val = num(raw);
    // Default (no override) price for this cell:
    const defaultPrice = list != null && list > 0 ? list * (1 - (tier.default_discount_pct || 0) / 100) : null;

    // Blank, or equal to the default → clear any override.
    const isDefault = val === null || (defaultPrice != null && Math.round(val) === Math.round(defaultPrice));
    if (isDefault) {
      if (existing?.price_id) {
        const { error } = await supabase.from('21.1_item_tier_prices').delete().eq('price_id', existing.price_id);
        if (error) { flash(`Failed: ${error.message}`); return; }
        flash('Override cleared');
        onOverrideChanged();
      }
      return;
    }
    // Upsert an absolute-price override.
    const row = { component_id: c.component_id, tier_id: tier.tier_id, override_price_idr: val, override_discount_pct: null };
    const { error } = await supabase.from('21.1_item_tier_prices').upsert(row, { onConflict: 'component_id,tier_id' });
    if (error) { flash(`Failed: ${error.message}`); return; }
    flash('Price saved');
    onOverrideChanged();
  }

  if (tiers.length === 0) {
    return (
      <div className="bg-slate-900/40 border border-slate-800/80 rounded-2xl px-4 py-12 text-center text-slate-500 text-sm">
        No active tiers yet. Add tiers in the <span className="text-slate-300 font-semibold">Tiers</span> view first.
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Search */}
      <div className="flex flex-wrap items-center gap-3">
        <div className="relative flex-1 min-w-[240px]">
          <svg className="w-4 h-4 text-slate-500 absolute left-3.5 top-1/2 -translate-y-1/2" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M21 21l-4.35-4.35M17 11a6 6 0 11-12 0 6 6 0 0112 0z" /></svg>
          <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search items by model, brand, category…"
            className="w-full pl-10 pr-4 h-11 rounded-xl bg-slate-900/80 border border-slate-700/80 focus:border-emerald-500/60 outline-none text-white text-base sm:text-sm placeholder:text-slate-500 transition-colors" />
        </div>
        <span className="text-xs text-slate-600 tabular-nums">{comps.length}{comps.length >= 300 ? '+' : ''} of {totalComps}</span>
      </div>

      <p className="text-[11px] text-slate-600">
        List price is your published price. Each tier column shows the effective price (list − tier discount); type a number to
        set a per-item override, or clear it to fall back to the tier default. <span className="text-slate-500">Margin %</span> is vs landed cost (internal) — red is below the tier’s floor.
      </p>

      {/* Matrix */}
      <div className="bg-slate-900/40 border border-slate-800/80 rounded-2xl overflow-x-auto">
        <table className="w-full min-w-[720px] border-collapse">
          <thead>
            <tr className="border-b border-slate-800 text-[10px] uppercase tracking-widest text-slate-500">
              <th className="text-left font-semibold px-4 py-2.5 sticky left-0 bg-slate-900/40">Item</th>
              <th className="text-right font-semibold px-3 py-2.5 whitespace-nowrap">List (IDR)</th>
              <th className="text-right font-semibold px-3 py-2.5 whitespace-nowrap">Landed</th>
              {tiers.map((t) => (
                <th key={t.tier_id} className="text-right font-semibold px-3 py-2.5 whitespace-nowrap">
                  {t.name}<span className="block text-[9px] text-slate-600 normal-case">−{t.default_discount_pct}% · floor {t.margin_floor_pct}%</span>
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-800/60">
            {comps.map((c) => {
              const list = listOf(c);
              const tuc = tucMap.get(c.component_id)?.tuc ?? null;
              return (
                <tr key={c.component_id} className="hover:bg-slate-800/20">
                  <td className="px-4 py-2 sticky left-0 bg-[#0f1012]/0">
                    <span className="block text-sm text-slate-100 font-medium truncate max-w-[220px]">{c.supplier_model || '(no model)'}</span>
                    <span className="block text-[11px] text-slate-500 truncate max-w-[220px]">{[c.brand, c.category].filter(Boolean).join(' · ') || '—'}</span>
                  </td>
                  <td className="px-3 py-2 text-right">
                    <input
                      defaultValue={list != null ? fmtInt(list) : ''}
                      onBlur={(e) => saveListPrice(c, e.target.value)}
                      placeholder="—"
                      className="w-24 text-right tabular-nums bg-slate-950 border border-slate-800 rounded-lg px-2 py-1 text-xs text-white focus:border-emerald-500/50 outline-none"
                    />
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums text-[11px] text-slate-500 whitespace-nowrap">
                    {tuc != null ? fmtInt(tuc) : <span className="text-slate-700">—</span>}
                  </td>
                  {tiers.map((t) => {
                    const ov = ovByKey.get(`${c.component_id}:${t.tier_id}`);
                    const price = effectivePrice(list, t, ov);
                    const overridden = ov?.override_price_idr != null;
                    const margin = price != null && price > 0 && tuc != null ? ((price - tuc) / price) * 100 : null;
                    const belowFloor = margin != null && margin < t.margin_floor_pct;
                    const nearFloor = margin != null && !belowFloor && margin < t.margin_floor_pct + 3;
                    return (
                      <td key={t.tier_id} className="px-3 py-2 text-right align-top">
                        <input
                          key={`${price}-${overridden}`}
                          defaultValue={price != null ? fmtInt(price) : ''}
                          onBlur={(e) => saveCell(c, t, e.target.value)}
                          placeholder="—"
                          title={overridden ? 'Overridden — clear to use the tier default' : 'Tier default — type to override'}
                          className={`w-24 text-right tabular-nums rounded-lg px-2 py-1 text-xs outline-none border ${overridden ? 'bg-emerald-500/10 border-emerald-500/40 text-emerald-200' : 'bg-slate-950 border-slate-800 text-white'} focus:border-emerald-500/60`}
                        />
                        <span className={`block mt-0.5 text-[10px] tabular-nums ${margin == null ? 'text-slate-700' : belowFloor ? 'text-red-400' : nearFloor ? 'text-amber-400' : 'text-emerald-500/80'}`}>
                          {margin == null ? '—' : `${margin.toFixed(0)}% GP${belowFloor ? ' ⚠' : ''}`}
                        </span>
                      </td>
                    );
                  })}
                </tr>
              );
            })}
            {comps.length === 0 && (
              <tr><td colSpan={3 + tiers.length} className="px-4 py-12 text-center text-slate-600 text-sm">No items match your search.</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ── Tiers view ──────────────────────────────────────────────────────────────
function TiersView({ tiers, onChanged, flash }: { tiers: Tier[]; onChanged: () => void; flash: (m: string) => void }) {
  const supabase = createSupabaseClient();
  const [rows, setRows] = useState<Tier[]>(tiers);
  const [saving, setSaving] = useState(false);

  useEffect(() => { setRows(tiers); }, [tiers]);

  const setField = (id: string, k: keyof Tier, v: Tier[keyof Tier]) =>
    setRows((r) => r.map((t) => (t.tier_id === id ? { ...t, [k]: v } : t)));

  async function saveRow(t: Tier) {
    setSaving(true);
    const payload = {
      tier_code: (t.tier_code || t.name).trim().toLowerCase().replace(/\s+/g, '_'),
      name: t.name.trim(),
      default_discount_pct: Number(t.default_discount_pct) || 0,
      margin_floor_pct: Number(t.margin_floor_pct) || 0,
      sort_order: Number(t.sort_order) || 0,
      is_active: t.is_active,
    };
    const isNew = t.tier_id.startsWith('tmp-');
    const res = isNew
      ? await supabase.from('21.0_price_tiers').insert(payload)
      : await supabase.from('21.0_price_tiers').update(payload).eq('tier_id', t.tier_id);
    setSaving(false);
    if (res.error) { flash(`Failed: ${res.error.message}`); return; }
    flash('Tier saved');
    onChanged();
  }

  async function removeRow(t: Tier) {
    if (t.tier_id.startsWith('tmp-')) { setRows((r) => r.filter((x) => x.tier_id !== t.tier_id)); return; }
    const { error } = await supabase.from('21.0_price_tiers').delete().eq('tier_id', t.tier_id);
    if (error) { flash(`Failed: ${error.message}`); return; }
    flash('Tier deleted');
    onChanged();
  }

  const addRow = () =>
    setRows((r) => [...r, {
      tier_id: `tmp-${Date.now()}`, tier_code: '', name: '', default_discount_pct: 0,
      margin_floor_pct: 0, sort_order: (r.length + 1) * 1, is_active: true,
    }]);

  return (
    <div className="space-y-4">
      <p className="text-[11px] text-slate-600 max-w-2xl">
        Tiers set the default discount off list price and the margin floor (minimum GP over landed cost). Assign a tier to a
        customer in the Customers app; the tier code is what links them. Deleting a tier removes its per-item overrides.
      </p>
      <div className="bg-slate-900/40 border border-slate-800/80 rounded-2xl overflow-x-auto">
        <table className="w-full min-w-[680px]">
          <thead>
            <tr className="border-b border-slate-800 text-[10px] uppercase tracking-widest text-slate-500">
              <th className="text-left font-semibold px-4 py-2.5">Name</th>
              <th className="text-left font-semibold px-3 py-2.5">Code</th>
              <th className="text-right font-semibold px-3 py-2.5">Default −%</th>
              <th className="text-right font-semibold px-3 py-2.5">Floor %</th>
              <th className="text-right font-semibold px-3 py-2.5">Order</th>
              <th className="text-center font-semibold px-3 py-2.5">Active</th>
              <th className="px-3 py-2.5"></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-800/60">
            {rows.map((t) => (
              <tr key={t.tier_id} className="hover:bg-slate-800/20">
                <td className="px-4 py-2">
                  <input value={t.name} onChange={(e) => setField(t.tier_id, 'name', e.target.value)} onBlur={() => saveRow(t)} placeholder="Tier name" className={tinput} />
                </td>
                <td className="px-3 py-2">
                  <input value={t.tier_code} onChange={(e) => setField(t.tier_id, 'tier_code', e.target.value)} onBlur={() => saveRow(t)} placeholder="auto" className={`${tinput} font-mono text-[11px] w-28`} />
                </td>
                <td className="px-3 py-2 text-right">
                  <input value={String(t.default_discount_pct)} onChange={(e) => setField(t.tier_id, 'default_discount_pct', e.target.value as any)} onBlur={() => saveRow(t)} className={`${tinput} w-16 text-right tabular-nums`} />
                </td>
                <td className="px-3 py-2 text-right">
                  <input value={String(t.margin_floor_pct)} onChange={(e) => setField(t.tier_id, 'margin_floor_pct', e.target.value as any)} onBlur={() => saveRow(t)} className={`${tinput} w-16 text-right tabular-nums`} />
                </td>
                <td className="px-3 py-2 text-right">
                  <input value={String(t.sort_order)} onChange={(e) => setField(t.tier_id, 'sort_order', e.target.value as any)} onBlur={() => saveRow(t)} className={`${tinput} w-12 text-right tabular-nums`} />
                </td>
                <td className="px-3 py-2 text-center">
                  <input type="checkbox" checked={t.is_active}
                    onChange={(e) => { const next = { ...t, is_active: e.target.checked }; setField(t.tier_id, 'is_active', e.target.checked); saveRow(next); }}
                    className="accent-emerald-500 w-4 h-4" />
                </td>
                <td className="px-3 py-2 text-right">
                  <button onClick={() => removeRow(t)} className="text-[11px] text-red-400/70 hover:text-red-400 transition-colors">Delete</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="flex items-center gap-3">
        <button onClick={addRow} className="px-4 py-2 rounded-xl bg-emerald-500/15 text-emerald-300 ring-1 ring-emerald-500/30 hover:bg-emerald-500/25 text-sm font-semibold transition-colors">+ Add tier</button>
        {saving && <span className="text-xs text-slate-500">Saving…</span>}
      </div>
    </div>
  );
}

const tinput = 'bg-slate-950 border border-slate-800 rounded-lg px-2.5 py-1.5 text-xs text-white focus:border-emerald-500/50 outline-none w-full';
