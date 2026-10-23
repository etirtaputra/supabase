'use client';
import { useState, useEffect, useMemo, useCallback } from 'react';
import Link from 'next/link';
import { createSupabaseClient } from '@/lib/supabase';
import { selectAll } from '@/lib/fetchAllRows';
import { useT } from '@/hooks/useT';
import { useSettings } from '@/hooks/useSettings';
import { computeTierChain } from '@/lib/tierPricing';
import { fmtInt, fmtRupiah } from '@/lib/formatters';
import {
  fetchMarginProfiles, saveMarginProfile, createMarginProfile, deleteMarginProfile, rangeError, type MarginProfile,
} from '@/lib/marginProfiles';

/**
 * Settings › Pricing — the tier ladder and the margin profiles.
 *
 * These lived as two tabs on Selling Prices until 2026-10-22, when the owner
 * cut that page down to the work done on it every day ("Tiers and Margin
 * Profiles, which you set once, move to Settings › Pricing"). Moved, not
 * rewritten: the same cards, the same writes. What a tier's floor catches is
 * answered on Selling Prices › Prices with the "Below floor" filter, which
 * each tier card links to.
 */

interface Tier {
  tier_id: string; tier_code: string; name: string;
  default_discount_pct: number; margin_floor_pct: number;
  sort_order: number; is_active: boolean; updated_by_email?: string;
}
const num = (v: unknown): number | null => {
  if (v === '' || v === null || v === undefined) return null;
  const n = Number(String(v).replace(/[, ]/g, ''));
  return isNaN(n) ? null : n;
};

export default function PricingSetup() {
  const supabase = useMemo(() => createSupabaseClient(), []);
  const { t } = useT();
  const [tiers, setTiers] = useState<Tier[]>([]);
  const [custTierCounts, setCustTierCounts] = useState<Map<string, number>>(new Map());
  const [overridesByTier, setOverridesByTier] = useState<Map<string, number>>(new Map());
  const [profiles, setProfiles] = useState<MarginProfile[]>([]);
  const [profileCounts, setProfileCounts] = useState<Map<string, number>>(new Map());
  const [savingTier, setSavingTier] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const flash = (m: string) => { setToast(m); setTimeout(() => setToast(null), 2600); };

  /** Read everything; hand back the state update so a stale load can be dropped. */
  const load = useCallback(async (): Promise<() => void> => {
    const [tierRes, ovRes, custRes, profs, tally] = await Promise.all([
      supabase.from('21.0_price_tiers').select('*').order('sort_order'),
      supabase.from('21.1_item_tier_prices').select('tier_id'),
      supabase.from('20.0_customers').select('tier'),
      fetchMarginProfiles(supabase),
      selectAll((f, to) => supabase.from('3.0_components').select('margin_profile_id').is('archived_at', null).order('component_id').range(f, to)),
    ]);
    const cc = new Map<string, number>();
    for (const c of (custRes.data as { tier: string | null }[]) ?? []) {
      const k = (c.tier ?? '').trim();
      if (k) cc.set(k, (cc.get(k) ?? 0) + 1);
    }
    const oc = new Map<string, number>();
    for (const o of (ovRes.data as { tier_id: string }[]) ?? []) oc.set(o.tier_id, (oc.get(o.tier_id) ?? 0) + 1);
    const pc = new Map<string, number>();
    for (const r of ((tally.data ?? []) as { margin_profile_id: string | null }[])) {
      const k = r.margin_profile_id ?? 'none';
      pc.set(k, (pc.get(k) ?? 0) + 1);
    }
    return () => {
      setTiers((tierRes.data as Tier[]) ?? []); setCustTierCounts(cc); setOverridesByTier(oc);
      setProfiles(profs); setProfileCounts(pc);
    };
  }, [supabase]);
  useEffect(() => {
    let live = true;
    void load().then((apply) => { if (live) apply(); });
    return () => { live = false; };
  }, [load]);
  const refresh = useCallback(async () => { (await load())(); }, [load]);

  async function saveTier(tier: Tier, patch: Partial<Tier>) {
    setSavingTier(tier.tier_id);
    const payload = {
      tier_code: String(patch.tier_code ?? tier.tier_code).trim().toLowerCase().replace(/\s+/g, '_'),
      name: String(patch.name ?? tier.name).trim(),
      default_discount_pct: Number(patch.default_discount_pct ?? tier.default_discount_pct) || 0,
      margin_floor_pct: Number(patch.margin_floor_pct ?? tier.margin_floor_pct) || 0,
      sort_order: Number(patch.sort_order ?? tier.sort_order) || 0,
      is_active: patch.is_active ?? tier.is_active,
    };
    const oldCode = tier.tier_code;
    const { error } = await supabase.from('21.0_price_tiers').update(payload).eq('tier_id', tier.tier_id);
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
    void refresh();
  }

  async function addTier(draft: { name: string; default_discount_pct: number; margin_floor_pct: number }) {
    const code = draft.name.trim().toLowerCase().replace(/\s+/g, '_');
    if (!code) { flash('Give the tier a name first'); return; }
    const { error } = await supabase.from('21.0_price_tiers').insert({
      tier_code: code, name: draft.name.trim(),
      default_discount_pct: draft.default_discount_pct || 0,
      margin_floor_pct: draft.margin_floor_pct || 0,
      sort_order: (tiers.reduce((m, x) => Math.max(m, x.sort_order), 0) + 1),
      is_active: true,
    });
    if (error) { flash(`Failed: ${error.message}`); return; }
    flash('Tier added');
    void refresh();
  }

  async function moveTier(tier: Tier, dir: -1 | 1) {
    const ordered = [...tiers].sort((a, b) => a.sort_order - b.sort_order);
    const i = ordered.findIndex((x) => x.tier_id === tier.tier_id);
    const j = i + dir;
    if (j < 0 || j >= ordered.length) return;
    const a = ordered[i], b = ordered[j];
    // Swap slots (normalize to index+1 so legacy duplicate sort_orders untangle)
    const [ra, rb] = await Promise.all([
      supabase.from('21.0_price_tiers').update({ sort_order: j + 1 }).eq('tier_id', a.tier_id),
      supabase.from('21.0_price_tiers').update({ sort_order: i + 1 }).eq('tier_id', b.tier_id),
    ]);
    if (ra.error || rb.error) { flash(`Failed: ${(ra.error ?? rb.error)!.message}`); return; }
    void refresh();
  }

  async function deleteTier(tier: Tier) {
    const { error } = await supabase.from('21.0_price_tiers').delete().eq('tier_id', tier.tier_id);
    if (error) { flash(`Failed: ${error.message}`); return; }
    flash(`Tier "${tier.name}" deleted`);
    void refresh();
  }

  const orderedTiers = [...tiers].sort((a, b) => a.sort_order - b.sort_order);
  return (
    <div className="space-y-8">
      <section className="space-y-3">
        <p className="text-xs font-bold uppercase tracking-widest text-emerald-300">{t('Price tiers')}</p>
        <TiersTab tiers={orderedTiers} custTierCounts={custTierCounts} overridesByTier={overridesByTier} saving={savingTier}
          onSave={saveTier} onAdd={addTier} onMove={moveTier} onDelete={deleteTier} />
      </section>
      <section className="space-y-3">
        <p className="text-xs font-bold uppercase tracking-widest text-emerald-300">{t('Margin Profiles')}</p>
        <MarginProfilesTab profiles={profiles} counts={profileCounts} onChanged={refresh} notify={flash} />
      </section>
      {toast && <div className="fixed bottom-6 right-6 z-[110] px-4 py-2.5 bg-slate-800 border border-slate-700 text-white text-sm font-semibold rounded-xl shadow-lg max-w-[90vw] truncate">{toast}</div>}
    </div>
  );
}

function TiersTab({ tiers, custTierCounts, overridesByTier, saving, onSave, onAdd, onMove, onDelete }: {
  tiers: Tier[];
  custTierCounts: Map<string, number>;
  overridesByTier: Map<string, number>;
  saving: string | null;
  onSave: (t: Tier, patch: Partial<Tier>) => void;
  onAdd: (draft: { name: string; default_discount_pct: number; margin_floor_pct: number }) => void;
  onMove: (t: Tier, dir: -1 | 1) => void;
  onDelete: (t: Tier) => void;
}) {
  const { t } = useT();
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
        Below floor filter on Selling Prices › Prices. Customers pick a tier on their profile; the sales editor auto-fills that tier’s prices.
      </p>

      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
        {tiers.map((tier, i) => {
          const customers = custTierCounts.get(tier.tier_code) ?? 0;
          const ovs = overridesByTier.get(tier.tier_id) ?? 0;
          const activeIdx = activeOrdered.findIndex((x) => x.tier_id === tier.tier_id);
          const isNetTier = activeIdx === 0;
          const prevTier = activeIdx > 0 ? activeOrdered[activeIdx - 1] : null;
          const ex = activeIdx >= 0 ? example.get(tier.tier_id) : undefined;
          return (
            <div key={tier.tier_id} className={`bg-slate-900/40 border rounded-2xl p-4 space-y-3 transition-colors ${tier.is_active ? 'border-slate-800/80' : 'border-slate-800/40 opacity-60'}`}>
              <div className="flex items-start justify-between gap-2">
                <div className="flex items-center gap-1.5">
                  <div className="flex flex-col -my-1">
                    <button onClick={() => onMove(tier, -1)} disabled={i === 0} className="text-slate-600 hover:text-white disabled:opacity-20 leading-none text-[10px] px-1 py-0.5 transition-colors" title="Move up">▲</button>
                    <button onClick={() => onMove(tier, 1)} disabled={i === tiers.length - 1} className="text-slate-600 hover:text-white disabled:opacity-20 leading-none text-[10px] px-1 py-0.5 transition-colors" title="Move down">▼</button>
                  </div>
                  {/* No NET badge here: the Price basis field below already
                      says "Net — as entered per item", and a badge floating
                      after a fixed-width name input reads as detached from the
                      title it is meant to qualify. */}
                  <input defaultValue={tier.name} key={`name-${tier.tier_id}-${tier.name}`}
                    onBlur={(e) => { const v = e.target.value.trim(); if (v && v !== tier.name) onSave(tier, { name: v }); }}
                    className="bg-transparent text-white font-bold text-base outline-none border-b border-transparent focus:border-emerald-500/50 min-w-0 w-36 transition-colors" />
                </div>
                <label className="flex items-center gap-1.5 text-[10px] text-slate-500 cursor-pointer select-none flex-shrink-0">
                  <input type="checkbox" checked={tier.is_active} onChange={(e) => onSave(tier, { is_active: e.target.checked })} className="accent-emerald-500 w-3.5 h-3.5" />
                  Active
                </label>
              </div>

              <div className="grid grid-cols-3 gap-2">
                <Field label="Code" title="Stored on customer profiles — renaming migrates them">
                  <input defaultValue={tier.tier_code} key={`code-${tier.tier_id}-${tier.tier_code}`}
                    onBlur={(e) => { const v = e.target.value.trim().toLowerCase().replace(/\s+/g, '_'); if (v && v !== tier.tier_code) onSave(tier, { tier_code: v }); }}
                    className={tInp} />
                </Field>
                {isNetTier ? (
                  <Field label="Price basis" title="This is the NET tier — its price is exactly the net price entered on each item; no markup applies">
                    <p className="px-2 py-1.5 text-xs text-emerald-300/90 font-semibold">Net — as entered per item</p>
                  </Field>
                ) : (
                  <Field label={`Markup % on ${prevTier?.name ?? 'prev tier'}`}
                    title={`This tier's price = ${prevTier?.name ?? 'previous tier'} ÷ (1 − markup%), rounded up to Rp 1,000`}>
                    <input defaultValue={String(tier.default_discount_pct)} key={`disc-${tier.tier_id}-${tier.default_discount_pct}`} inputMode="decimal"
                      onBlur={(e) => { const v = num(e.target.value); if (v != null && v !== tier.default_discount_pct) onSave(tier, { default_discount_pct: v }); }}
                      className={`${tInp} text-right tabular-nums`} />
                  </Field>
                )}
                <Field label="Floor GP %" title="Minimum margin vs landed cost — below it shows under Selling Prices › Prices › Below floor">
                  <input defaultValue={String(tier.margin_floor_pct)} key={`floor-${tier.tier_id}-${tier.margin_floor_pct}`} inputMode="decimal"
                    onBlur={(e) => { const v = num(e.target.value); if (v != null && v !== tier.margin_floor_pct) onSave(tier, { margin_floor_pct: v }); }}
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
                {/* Which prices sit under this floor is answered on Selling Prices › Prices (filter: below floor). */}
                <Link href="/pricing?filter=floor" className="px-1.5 py-0.5 rounded bg-slate-800 text-slate-400 hover:text-white transition-colors">{t('Prices below the floor')} →</Link>
                <span className="flex-1" />
                {confirmDelete === tier.tier_id ? (
                  <span className="flex items-center gap-1.5">
                    <span className="text-red-300">{ovs > 0 ? `Deletes ${ovs} override${ovs !== 1 ? 's' : ''}.` : ''}{customers > 0 ? ` ${customers} customer${customers !== 1 ? 's' : ''} keep the code (reassign them).` : ''} Sure?</span>
                    <button onClick={() => { setConfirmDelete(null); onDelete(tier); }} className="px-1.5 py-0.5 rounded bg-red-600 hover:bg-red-500 text-white font-bold transition-colors">{t('Delete')}</button>
                    <button onClick={() => setConfirmDelete(null)} className="px-1.5 py-0.5 rounded bg-slate-800 text-slate-400 hover:text-white transition-colors">{t('Cancel')}</button>
                  </span>
                ) : (
                  <button onClick={() => setConfirmDelete(tier.tier_id)} className="text-slate-600 hover:text-red-400 transition-colors" title="Delete tier">{t('Delete')}</button>
                )}
              </div>
              {saving === tier.tier_id && <p className="text-[10px] text-slate-600">Saving…</p>}
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
                  className="flex-1 px-3 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-bold transition-colors">{t('Add tier')}</button>
                <button onClick={() => setAdding(false)} className="px-3 py-1.5 rounded-lg text-xs text-slate-400 hover:text-white border border-slate-700 transition-colors">{t('Cancel')}</button>
              </div>
            </div>
          ) : (
            <button onClick={() => setAdding(true)} className="text-sm text-emerald-400 hover:text-emerald-300 font-semibold transition-colors">+ {t('Add tier')}</button>
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

function MarginProfilesTab({ profiles, counts, onChanged, notify }: {
  profiles: MarginProfile[];
  counts: Map<string, number>;
  onChanged: () => Promise<void> | void;
  notify: (m: string) => void;
}) {
  const { t } = useT();
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
          {adding ? t('Adding…') : <>+ {t('Add profile')}</>}
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
                {busy === p.id ? t('Saving…') : t('Save')}
              </button>
              {dirty(p) && (
                <button onClick={() => setDraft((d) => { const n = { ...d }; delete n[p.id]; return n; })}
                  className="text-[12px] font-semibold text-slate-400 hover:text-white transition-colors">{t('Cancel')}</button>
              )}
              <span className="ml-auto">
                {confirmDelete === p.id ? (
                  <span className="flex items-center gap-2">
                    <span className="text-[11px] text-red-400">Remove {p.label}?</span>
                    <button onClick={() => void remove(p)} className="text-[11px] font-semibold text-red-400 hover:text-red-300">{t('Remove')}</button>
                    <button onClick={() => setConfirmDelete(null)} className="text-[11px] text-slate-400 hover:text-white">{t('Keep')}</button>
                  </span>
                ) : (
                  <button onClick={() => setConfirmDelete(p.id)}
                    className="text-[11px] text-slate-500 hover:text-red-400 transition-colors">{t('Remove')}</button>
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
