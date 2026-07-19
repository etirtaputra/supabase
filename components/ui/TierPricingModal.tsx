'use client';
import { useState, useEffect, useMemo, useCallback, type CSSProperties } from 'react';
import { createPortal } from 'react-dom';
import { createSupabaseClient } from '@/lib/supabase';
import { useAuth } from '@/hooks/useAuth';
import { ROLE_PERMISSIONS } from '@/constants/roles';

/**
 * Per-item tier pricing, opened from the Catalog's Component Editor (Sell Price
 * column). One stop for a product's pricing: list price, effective price per
 * tier (default % off list, per-item absolute override), margin vs landed cost
 * (TUC, internal-only) with the tier's floor warning, and — for owners — the
 * tier set itself (name, % off, floor, active).
 * Self-contained: fetches tiers/overrides itself; writes go straight to 21.x /
 * 3.0_components.selling_price_idr.
 */

interface Tier {
  tier_id: string; tier_code: string; name: string;
  default_discount_pct: number; margin_floor_pct: number; sort_order: number; is_active: boolean;
}
interface Override { price_id?: string; tier_id: string; override_price_idr: number | null; override_discount_pct: number | null; }

const fmtInt = (n: number) => Math.round(n).toLocaleString('en-US');
const num = (v: unknown): number | null => {
  if (v === '' || v === null || v === undefined) return null;
  const n = Number(String(v).replace(/[, ]/g, ''));
  return isNaN(n) ? null : n;
};

export default function TierPricingModal({ componentId, componentName, listPrice, cost, anchor, onClose, onListPriceChange }: {
  componentId: string;
  componentName: string;
  listPrice: number | null;
  cost: number | null; // landed cost (TUC) in IDR — internal margin basis
  /** Trigger-button rect: on desktop the panel pops up anchored to it; null / phones → bottom sheet */
  anchor?: { top: number; bottom: number; left: number; right: number } | null;
  onClose: () => void;
  onListPriceChange: (v: number | null) => void;
}) {
  const supabase = createSupabaseClient();
  const { profile } = useAuth();
  const canManage = !!profile && ROLE_PERMISSIONS[profile.role].canManagePricing;

  const [tiers, setTiers] = useState<Tier[]>([]);
  const [ovByTier, setOvByTier] = useState<Map<string, Override>>(new Map());
  const [listStr, setListStr] = useState(listPrice != null ? fmtInt(listPrice) : '');
  const [loading, setLoading] = useState(true);
  const [schemaMissing, setSchemaMissing] = useState(false);
  const [manageOpen, setManageOpen] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const flash = (m: string) => { setToast(m); setTimeout(() => setToast(null), 2000); };

  const load = useCallback(async () => {
    setLoading(true);
    const [tierRes, ovRes] = await Promise.all([
      supabase.from('21.0_price_tiers').select('*').order('sort_order'),
      supabase.from('21.1_item_tier_prices').select('*').eq('component_id', componentId),
    ]);
    if (tierRes.error || ovRes.error) { setSchemaMissing(true); setLoading(false); return; }
    setTiers((tierRes.data as Tier[]) ?? []);
    setOvByTier(new Map(((ovRes.data as Override[]) ?? []).map((o) => [o.tier_id, o])));
    setLoading(false);
  }, [componentId]);

  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  // Phones always get the bottom sheet; desktop pops up in place at the button.
  const [isPhone, setIsPhone] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia('(max-width: 639px)');
    const f = () => setIsPhone(mq.matches);
    f();
    mq.addEventListener('change', f);
    return () => mq.removeEventListener('change', f);
  }, []);
  const asPopover = !isPhone && !!anchor;
  const popStyle = useMemo<CSSProperties | undefined>(() => {
    if (!asPopover || !anchor) return undefined;
    const W = 380;
    const maxH = Math.min(540, window.innerHeight - 24);
    const left = Math.max(8, Math.min(anchor.left - 40, window.innerWidth - W - 12));
    const spaceBelow = window.innerHeight - anchor.bottom;
    // Open downward when there's room; otherwise grow upward from the button.
    if (spaceBelow >= 340 || spaceBelow >= anchor.top) {
      return { position: 'fixed', top: anchor.bottom + 6, left, width: W, maxHeight: Math.min(maxH, spaceBelow - 12) };
    }
    return { position: 'fixed', bottom: window.innerHeight - anchor.top + 6, left, width: W, maxHeight: Math.min(maxH, anchor.top - 12) };
  }, [asPopover, anchor]);

  const listVal = num(listStr);

  const effective = (t: Tier): { price: number | null; overridden: boolean } => {
    const ov = ovByTier.get(t.tier_id);
    if (ov?.override_price_idr != null) return { price: ov.override_price_idr, overridden: true };
    if (listVal == null || listVal <= 0) return { price: null, overridden: false };
    const disc = ov?.override_discount_pct ?? t.default_discount_pct ?? 0;
    return { price: listVal * (1 - disc / 100), overridden: false };
  };

  async function saveListPrice() {
    const v = listVal;
    if (v === listPrice) return;
    const { error } = await supabase.from('3.0_components').update({ selling_price_idr: v }).eq('component_id', componentId);
    if (error) { flash(`Failed: ${error.message}`); return; }
    onListPriceChange(v);
    flash('List price saved');
  }

  async function saveOverride(t: Tier, raw: string) {
    const v = num(raw);
    const defaultPrice = listVal != null && listVal > 0 ? listVal * (1 - (t.default_discount_pct || 0) / 100) : null;
    const isDefault = v === null || (defaultPrice != null && Math.round(v) === Math.round(defaultPrice));
    const existing = ovByTier.get(t.tier_id);
    if (isDefault) {
      if (existing?.price_id) {
        const { error } = await supabase.from('21.1_item_tier_prices').delete().eq('price_id', existing.price_id);
        if (error) { flash(`Failed: ${error.message}`); return; }
        flash('Override cleared');
        load();
      }
      return;
    }
    const { error } = await supabase.from('21.1_item_tier_prices')
      .upsert({ component_id: componentId, tier_id: t.tier_id, override_price_idr: v, override_discount_pct: null }, { onConflict: 'component_id,tier_id' });
    if (error) { flash(`Failed: ${error.message}`); return; }
    flash('Override saved');
    load();
  }

  async function saveTier(t: Tier) {
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
    if (res.error) { flash(`Failed: ${res.error.message}`); return; }
    flash('Tier saved');
    load();
  }

  async function deleteTier(t: Tier) {
    if (t.tier_id.startsWith('tmp-')) { setTiers((ts) => ts.filter((x) => x.tier_id !== t.tier_id)); return; }
    const { error } = await supabase.from('21.0_price_tiers').delete().eq('tier_id', t.tier_id);
    if (error) { flash(`Failed: ${error.message}`); return; }
    flash('Tier deleted');
    load();
  }

  const setTierField = (id: string, k: keyof Tier, v: Tier[keyof Tier]) =>
    setTiers((ts) => ts.map((t) => (t.tier_id === id ? { ...t, [k]: v } : t)));

  const visibleTiers = useMemo(() => (manageOpen ? tiers : tiers.filter((t) => t.is_active)), [tiers, manageOpen]);

  // Portal to <body>: ancestors with transform/backdrop-filter would otherwise
  // hijack position:fixed and strand the popover away from its button.
  return createPortal(
    <div className={`fixed inset-0 z-[120] ${asPopover ? '' : 'flex items-end sm:items-center justify-center sm:px-4'}`} onClick={onClose}>
      <div className={`absolute inset-0 ${asPopover ? 'bg-black/20' : 'bg-black/60'}`} />
      <div
        style={popStyle}
        className={asPopover
          ? 'overflow-y-auto bg-[#141518] border border-slate-700 rounded-2xl shadow-2xl'
          : 'relative w-full sm:max-w-lg max-h-[88vh] overflow-y-auto bg-[#141518] border border-slate-800 sm:rounded-2xl rounded-t-2xl shadow-2xl'}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="sticky top-0 bg-[#141518]/95 backdrop-blur border-b border-slate-800 px-5 py-3.5 flex items-center justify-between gap-3 z-10">
          <div className="min-w-0">
            <h3 className="text-sm font-bold text-white truncate">Tier Pricing</h3>
            <p className="text-[11px] text-slate-500 truncate">{componentName}</p>
          </div>
          <button onClick={onClose} className="p-2 -m-2 text-slate-500 hover:text-white transition-colors flex-shrink-0">
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2"><path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" /></svg>
          </button>
        </div>

        <div className="px-5 py-4 space-y-4">
          {schemaMissing ? (
            <div className="bg-amber-500/10 border border-amber-500/40 rounded-xl p-3 text-xs text-amber-200">
              Pricing tables are not set up yet — run <span className="font-mono">migrations/create_pricing_tiers.sql</span> in Supabase → SQL Editor.
            </div>
          ) : loading ? (
            <div className="space-y-1.5">{[...Array(4)].map((_, i) => <div key={i} className="h-10 bg-slate-800/40 rounded-lg animate-pulse" />)}</div>
          ) : (
            <>
              {/* List price */}
              <div className="flex items-end gap-3">
                <div className="flex-1">
                  <label className="block text-[10px] font-medium text-slate-500 mb-1">List price (IDR)</label>
                  {canManage ? (
                    <input value={listStr} inputMode="decimal" onChange={(e) => setListStr(e.target.value)} onBlur={saveListPrice}
                      placeholder="—" className="w-full px-3 py-2 rounded-lg bg-slate-950 border border-slate-700 focus:border-emerald-500/60 outline-none text-white text-sm text-right tabular-nums transition-colors" />
                  ) : (
                    <p className="text-sm text-slate-200 tabular-nums py-2">{listVal != null ? fmtInt(listVal) : '—'}</p>
                  )}
                </div>
                <div className="text-right pb-1">
                  <p className="text-[10px] font-medium text-slate-500 mb-0.5">Landed cost (internal)</p>
                  <p className="text-sm tabular-nums text-slate-400">{cost != null ? fmtInt(cost) : '—'}</p>
                </div>
              </div>

              {/* Tier rows */}
              <div className="rounded-xl border border-slate-800 divide-y divide-slate-800/60">
                {visibleTiers.length === 0 && (
                  <p className="px-3 py-4 text-xs text-slate-600 text-center">No tiers defined yet{canManage ? ' — add them below.' : '.'}</p>
                )}
                {visibleTiers.map((t) => {
                  const { price, overridden } = effective(t);
                  const margin = price != null && price > 0 && cost != null ? ((price - cost) / price) * 100 : null;
                  const belowFloor = margin != null && margin < t.margin_floor_pct;
                  return (
                    <div key={t.tier_id} className="flex items-center gap-2.5 px-3 py-2">
                      <div className="min-w-0 flex-1">
                        <p className="text-xs font-semibold text-slate-200 truncate">{t.name}{!t.is_active && <span className="text-slate-600 font-normal"> · inactive</span>}</p>
                        <p className="text-[10px] text-slate-600">−{t.default_discount_pct}% · floor {t.margin_floor_pct}%</p>
                      </div>
                      {canManage ? (
                        <input
                          key={`${t.tier_id}-${price}-${overridden}`}
                          defaultValue={price != null ? fmtInt(price) : ''}
                          inputMode="decimal"
                          onBlur={(e) => saveOverride(t, e.target.value)}
                          placeholder="—"
                          title={overridden ? 'Overridden — clear to use the tier default' : 'Tier default — type to override'}
                          className={`w-28 px-2.5 py-1.5 rounded-lg text-xs text-right tabular-nums outline-none border transition-colors ${overridden ? 'bg-emerald-500/10 border-emerald-500/40 text-emerald-200' : 'bg-slate-950 border-slate-800 text-white'} focus:border-emerald-500/60`}
                        />
                      ) : (
                        <span className={`w-28 text-right text-xs tabular-nums ${overridden ? 'text-emerald-300' : 'text-slate-200'}`}>{price != null ? fmtInt(price) : '—'}</span>
                      )}
                      <span className={`w-16 text-right text-[10px] tabular-nums ${margin == null ? 'text-slate-700' : belowFloor ? 'text-red-400' : 'text-emerald-500/80'}`}>
                        {margin == null ? '—' : `${margin.toFixed(0)}% GP${belowFloor ? ' ⚠' : ''}`}
                      </span>
                    </div>
                  );
                })}
              </div>
              <p className="text-[10px] text-slate-600">
                Tier price = list − tier %, unless overridden per item (green). GP is vs landed cost — internal only, never shown to clients.
              </p>

              {/* Tier set management (owner) */}
              {canManage && (
                <div className="border-t border-slate-800 pt-3">
                  <button onClick={() => setManageOpen((v) => !v)} className="text-[11px] text-slate-500 hover:text-slate-300 font-semibold transition-colors">
                    {manageOpen ? '▾ Hide tier settings' : '▸ Manage tiers (name · % off · floor)'}
                  </button>
                  {manageOpen && (
                    <div className="mt-2 space-y-2">
                      {tiers.map((t) => (
                        <div key={t.tier_id} className="grid grid-cols-[1fr_64px_64px_28px_28px] gap-1.5 items-center">
                          <input value={t.name} onChange={(e) => setTierField(t.tier_id, 'name', e.target.value)} onBlur={() => saveTier(t)} placeholder="Tier name" className={mInp} />
                          <input value={String(t.default_discount_pct)} onChange={(e) => setTierField(t.tier_id, 'default_discount_pct', e.target.value as never)} onBlur={() => saveTier(t)} title="% off list" className={`${mInp} text-right tabular-nums`} />
                          <input value={String(t.margin_floor_pct)} onChange={(e) => setTierField(t.tier_id, 'margin_floor_pct', e.target.value as never)} onBlur={() => saveTier(t)} title="Margin floor %" className={`${mInp} text-right tabular-nums`} />
                          <input type="checkbox" checked={t.is_active} onChange={(e) => { const next = { ...t, is_active: e.target.checked }; setTierField(t.tier_id, 'is_active', e.target.checked); saveTier(next); }} title="Active" className="accent-emerald-500 w-4 h-4 justify-self-center" />
                          <button onClick={() => deleteTier(t)} className="text-slate-600 hover:text-red-400 transition-colors justify-self-center" title="Delete tier">×</button>
                        </div>
                      ))}
                      <div className="flex items-center justify-between">
                        <button
                          onClick={() => setTiers((ts) => [...ts, { tier_id: `tmp-${Date.now()}`, tier_code: '', name: '', default_discount_pct: 0, margin_floor_pct: 0, sort_order: (ts.length + 1), is_active: true }])}
                          className="text-[11px] text-emerald-400 hover:text-emerald-300 font-semibold transition-colors">+ Add tier</button>
                        <span className="text-[9px] text-slate-600">columns: % off list · margin floor % · active</span>
                      </div>
                    </div>
                  )}
                </div>
              )}
            </>
          )}
        </div>

        {toast && (
          <div className="sticky bottom-3 mx-5 mb-3 px-3 py-2 bg-slate-800 border border-slate-700 text-white text-xs font-semibold rounded-lg shadow-lg text-center">
            {toast}
          </div>
        )}
      </div>
    </div>,
    document.body
  );
}

const mInp = 'px-2 py-1.5 rounded-lg bg-slate-950 border border-slate-800 focus:border-emerald-500/50 outline-none text-white text-xs placeholder:text-slate-600 transition-colors w-full';
