'use client';
/**
 * Spec Readiness — the workbench that makes the System Designer possible.
 *
 * The calculators can only size from items whose specs satisfy their
 * category's contract (`specReadiness`). Most of the catalog is short of a few
 * numbers, and those numbers are usually already written on the item: an
 * inverter catalogued as "EPEVER ELS3K-E 3kW/48V" has said its rating and its
 * battery bus out loud.
 *
 * So this screen does not ask people to retype a catalog. It shows one row per
 * item, one column per REQUIRED key, and PROPOSES a value for each blank —
 * from the ICA calculator's own database when the model is in it, otherwise
 * read out of the item's own name. Every proposal says where it came from; a
 * human accepts, corrects or ignores it, and only then is anything written.
 *
 * Suggested-but-unaccepted values are never saved. A wrong spec is worse than
 * a missing one: the calculator would size from it with full confidence.
 */
import { useState, useEffect, useMemo, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { createSupabaseClient } from '@/lib/supabase';
import { useAuth } from '@/hooks/useAuth';
import { ROLE_PERMISSIONS } from '@/constants/roles';
import { canOpenPath } from '@/constants/navigation';
import BrandMenu from '@/components/ui/BrandMenu';
import { fmtInt } from '@/lib/formatters';
import { formatCategory as humanize } from '@/lib/formatCategory';
import {
  CATEGORY_SPEC_REQUIREMENTS, specReadiness, normalizeSpecs, specNumber, type Specs,
} from '@/lib/specSchema';
import { suggestSpecs, suggestionValue, type Suggestions } from '@/lib/systemDesign/specSuggest';

interface Row {
  component_id: string;
  supplier_model: string;
  internal_description: string | null;
  brand: string | null;
  category: string;
  specifications: Specs | null;
}

/** The categories a calculator actually reads — the contract is the list. */
const CALC_CATEGORIES = Object.keys(CATEGORY_SPEC_REQUIREMENTS) as string[];

/** Friendly column headings for the canonical keys. */
const KEY_LABEL: Record<string, string> = {
  power_stc_w: 'Power W', voc_stc_v: 'Voc V', dimensions_l_w_h_mm: 'Dimensions L×W×H mm',
  rated_output_power_w: 'Rated W', battery_nominal_voltage_vdc: 'Battery bus V',
  pv_max_open_circuit_voltage_vdc: 'PV max Voc V', rated_output_power_kw: 'Rated kW',
  pv_max_voltage_vdc: 'PV max V', nominal_ac_voltage_vac: 'AC voltage',
  nominal_voltage_v: 'Nominal V', energy_wh: 'Energy Wh', battery_type: 'Chemistry',
  controller_type: 'Type', rated_charge_current_a: 'Charge A', pv_max_voc_v: 'PV max Voc V',
  system_voltage_v: 'System V', bom_role: 'BoM role',
};

export default function SpecReadinessPage() {
  const supabase = createSupabaseClient();
  const router = useRouter();
  const { user, profile, loading: authLoading } = useAuth();
  const perms = profile ? ROLE_PERMISSIONS[profile.role] : null;
  const canEdit = !!perms?.canEdit;

  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);
  const [category, setCategory] = useState('inverter_charger');
  const [missingOnly, setMissingOnly] = useState(true);
  const [search, setSearch] = useState('');
  const [edits, setEdits] = useState<Record<string, Record<string, string>>>({});
  const [busy, setBusy] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const flash = (m: string) => { setToast(m); setTimeout(() => setToast(null), 3200); };

  useEffect(() => { document.title = 'Spec Readiness — ICAPROC'; }, []);
  useEffect(() => {
    if (authLoading) return;
    if (!user) { router.replace(`/login?next=${encodeURIComponent('/items/specs')}`); return; }
    if (profile && !canOpenPath(perms, '/items/specs')) router.replace('/unauthorized');
  }, [authLoading, user, profile, perms?.canViewAnalytics, router]);

  const load = useCallback(async () => {
    setLoading(true);
    const { data } = await supabase.from('3.0_components')
      .select('component_id, supplier_model, internal_description, brand, category, specifications')
      .in('category', CALC_CATEGORIES).limit(3000);
    setRows(((data as Row[]) ?? []).sort((a, b) => (a.supplier_model ?? '').localeCompare(b.supplier_model ?? '')));
    setLoading(false);
  }, [supabase]);
  useEffect(() => { if (user && perms?.canViewAnalytics) load(); }, [user, perms?.canViewAnalytics, load]);

  const requiredKeys = CATEGORY_SPEC_REQUIREMENTS[category as keyof typeof CATEGORY_SPEC_REQUIREMENTS] ?? [];

  /** Readiness per category — the progress the System Designer waits on. */
  const progress = useMemo(() => {
    const out: Record<string, { ready: number; total: number }> = {};
    for (const c of CALC_CATEGORIES) {
      const items = rows.filter((r) => r.category === c);
      out[c] = { ready: items.filter((r) => specReadiness(c, r.specifications).ready).length, total: items.length };
    }
    return out;
  }, [rows]);

  const visible = useMemo(() => {
    const q = search.trim().toLowerCase();
    return rows.filter((r) => {
      if (r.category !== category) return false;
      if (missingOnly && specReadiness(r.category, r.specifications).ready) return false;
      if (!q) return true;
      return `${r.supplier_model} ${r.internal_description ?? ''} ${r.brand ?? ''}`.toLowerCase().includes(q);
    });
  }, [rows, category, missingOnly, search]);

  /** What we can offer for each visible row, computed once per render pass. */
  const suggestionsFor = useMemo(() => {
    const m = new Map<string, Suggestions>();
    for (const r of visible) {
      m.set(r.component_id, suggestSpecs(r.category, `${r.supplier_model} ${r.internal_description ?? ''}`, r.specifications));
    }
    return m;
  }, [visible]);

  const valueOf = (r: Row, key: string): string => {
    const typed = edits[r.component_id]?.[key];
    if (typed !== undefined) return typed;
    const held = (r.specifications ?? {})[key];
    return held === undefined || held === null ? '' : String(held);
  };

  const setCell = (id: string, key: string, v: string) =>
    setEdits((e) => ({ ...e, [id]: { ...(e[id] ?? {}), [key]: v } }));

  /** Accept every suggestion on one row — the common case, one click. */
  const acceptRow = (r: Row) => {
    const sug = suggestionsFor.get(r.component_id) ?? {};
    const patch: Record<string, string> = {};
    for (const k of requiredKeys) {
      if (valueOf(r, k)) continue;
      if (sug[k]) patch[k] = String(suggestionValue(sug[k]));
    }
    if (!Object.keys(patch).length) return;
    setEdits((e) => ({ ...e, [r.component_id]: { ...(e[r.component_id] ?? {}), ...patch } }));
  };

  const acceptAllVisible = () => visible.forEach(acceptRow);

  /**
   * The blocking keys are usually datasheet values the model name cannot
   * carry — PV max Voc, Voc STC — and they are typically CONSTANT across a
   * family (every EPEVER ELS shares one). Typing it once and filling every
   * blank in the column is the difference between fifteen minutes and an
   * afternoon. Only blanks are touched; a real value is never overwritten.
   */
  const [bulk, setBulk] = useState<Record<string, string>>({});
  const blanksIn = (key: string) => visible.filter((r) => !valueOf(r, key).trim()).length;
  const fillColumn = (key: string) => {
    const v = (bulk[key] ?? '').trim();
    if (!v) return;
    setEdits((e) => {
      const next = { ...e };
      for (const r of visible) {
        if (valueOf(r, key).trim()) continue;
        next[r.component_id] = { ...(next[r.component_id] ?? {}), [key]: v };
      }
      return next;
    });
    setBulk((b) => ({ ...b, [key]: '' }));
  };

  const dirtyCount = Object.values(edits).filter((v) => Object.values(v).some((x) => x.trim() !== '')).length;

  async function saveAll() {
    if (!canEdit || busy) return;
    setBusy(true);
    let saved = 0;
    try {
      for (const [id, patch] of Object.entries(edits)) {
        const row = rows.find((r) => r.component_id === id);
        if (!row) continue;
        const merged: Specs = { ...(row.specifications ?? {}) };
        let touched = false;
        for (const [k, raw] of Object.entries(patch)) {
          const v = raw.trim();
          if (v === '') continue;
          const n = specNumber(v);
          merged[k] = n !== null ? n : v;
          touched = true;
        }
        if (!touched) continue;
        // Written through the same normaliser every other writer uses, so the
        // stored blob is canonical whatever was typed.
        const specs = normalizeSpecs(row.category, merged);
        const { error } = await supabase.from('3.0_components').update({ specifications: specs }).eq('component_id', id);
        if (error) throw error;
        saved += 1;
      }
      setEdits({});
      flash(`${saved} item${saved !== 1 ? 's' : ''} updated.`);
      load();
    } catch (e) {
      flash(`Could not save — ${(e as Error).message}`);
    } finally { setBusy(false); }
  }

  if (authLoading || !user) {
    return <div className="min-h-screen bg-chrome flex items-center justify-center"><div className="w-6 h-6 border-2 border-emerald-500/30 border-t-emerald-500 rounded-full animate-spin" /></div>;
  }

  const inp = 'w-full h-8 px-2 rounded-md bg-slate-950 border border-slate-600 focus:border-emerald-500 outline-none text-white text-xs transition-colors';
  const inpSuggested = 'w-full h-8 px-2 rounded-md bg-sky-500/[0.07] border border-dashed border-sky-500/50 focus:border-sky-400 outline-none text-sky-200 text-xs transition-colors placeholder:text-sky-300/50';

  return (
    <div className="min-h-screen bg-chrome text-slate-200 font-sans text-sm">
      <div className="border-b border-slate-800/60 bg-chrome/80 backdrop-blur-md sticky top-0 z-30">
        <div className="max-w-[1600px] mx-auto px-3 sm:px-4 md:px-6 py-2.5 sm:py-3 flex flex-col sm:flex-row sm:items-center justify-between gap-2.5">
          <BrandMenu wordmarkClass="text-xl md:text-2xl font-extrabold" subtitle="Spec Readiness · what the calculators can size" />
          {canEdit && dirtyCount > 0 && (
            <button onClick={saveAll} disabled={busy}
              className="px-4 h-10 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-bold transition-colors disabled:opacity-50">
              {busy ? 'Saving…' : `Save ${dirtyCount} item${dirtyCount !== 1 ? 's' : ''}`}
            </button>
          )}
        </div>
      </div>

      <main className="max-w-[1600px] mx-auto px-3 sm:px-4 md:px-6 py-4 sm:py-5 space-y-5">
        {toast && <div className="rounded-xl border border-emerald-500/30 bg-emerald-500/10 px-4 py-2.5 text-xs text-emerald-200">{toast}</div>}

        {/* Readiness per category — the gate the System Designer waits on */}
        <div className="grid grid-cols-2 lg:grid-cols-4 xl:grid-cols-7 gap-2">
          {CALC_CATEGORIES.map((c) => {
            const p = progress[c] ?? { ready: 0, total: 0 };
            const pct = p.total ? (p.ready / p.total) * 100 : 0;
            const on = c === category;
            return (
              <button key={c} onClick={() => setCategory(c)}
                className={`text-left rounded-xl border px-3 py-2.5 transition-colors ${on ? 'border-emerald-500/50 bg-emerald-500/[0.07]' : 'border-slate-800 bg-slate-900/40 hover:border-slate-700'}`}>
                <p className="text-[10px] uppercase tracking-widest text-slate-500 truncate">{humanize(c)}</p>
                <p className="text-sm font-bold tabular-nums mt-0.5">
                  <span className={pct === 100 ? 'text-emerald-300' : pct > 0 ? 'text-amber-300' : 'text-slate-500'}>{p.ready}</span>
                  <span className="text-slate-600"> / {p.total}</span>
                </p>
                <div className="h-1 rounded-full bg-slate-800 overflow-hidden mt-1.5">
                  <div className={`h-full rounded-full ${pct === 100 ? 'bg-emerald-500' : 'bg-amber-500'}`} style={{ width: `${pct}%` }} />
                </div>
              </button>
            );
          })}
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search model, description, brand…"
            className="flex-1 min-w-[200px] h-10 px-3.5 rounded-xl bg-slate-900/80 border border-slate-700/80 focus:border-emerald-500/60 outline-none text-white text-sm placeholder:text-slate-500 transition-colors" />
          <button onClick={() => setMissingOnly((v) => !v)}
            className={`h-10 px-3.5 rounded-xl text-xs font-semibold border transition-colors ${missingOnly ? 'bg-amber-500/15 border-amber-500/40 text-amber-300' : 'border-slate-700 text-slate-400'}`}>
            {missingOnly ? 'Incomplete only' : 'All items'}
          </button>
          {canEdit && visible.length > 0 && (
            <button onClick={acceptAllVisible}
              title="Fill every blank on screen with its proposal — nothing is saved until you press Save"
              className="h-10 px-3.5 rounded-xl text-xs font-semibold border border-sky-500/40 text-sky-300 hover:bg-sky-500/10 transition-colors">
              Accept all proposals
            </button>
          )}
          <span className="text-xs text-slate-600 tabular-nums">{fmtInt(visible.length)} shown</span>
        </div>

        <p className="text-[11px] text-slate-600 max-w-4xl">
          A <span className="text-sky-300">dashed blue</span> cell is a PROPOSAL, not a saved value — read from the item&apos;s own
          name, or from the ICA calculator&apos;s database when it knows the model. Hover it to see why. Nothing reaches the
          catalog until you save, and an item only becomes calculator-ready when every column on its row is filled.
        </p>

        {/* The grid: one row per item, one column per required key */}
        <div className="bg-slate-900/40 border border-slate-800/80 rounded-2xl overflow-x-auto">
          <table className="w-full min-w-[900px]">
            <thead>
              <tr className="border-b border-slate-800 text-[10px] uppercase tracking-widest text-slate-500">
                <th className="text-left font-semibold px-4 py-2.5 sticky left-0 bg-chrome z-10">Item</th>
                {requiredKeys.map((k) => <th key={k} className="text-left font-semibold px-3 py-2.5 min-w-[140px]">{KEY_LABEL[k] ?? k}</th>)}
                <th className="px-3 py-2.5" />
              </tr>
              {canEdit && !loading && visible.length > 0 && (
                <tr className="border-b border-slate-800/60 bg-slate-950/40">
                  <td className="px-4 py-1.5 sticky left-0 bg-chrome z-10">
                    <span className="text-[10px] text-slate-600">Fill a whole column ↓</span>
                  </td>
                  {requiredKeys.map((k) => {
                    const blanks = blanksIn(k);
                    return (
                      <td key={k} className="px-3 py-1.5">
                        <span className="flex items-center gap-1">
                          <input value={bulk[k] ?? ''} onChange={(e) => setBulk((b) => ({ ...b, [k]: e.target.value }))}
                            onKeyDown={(e) => { if (e.key === 'Enter') fillColumn(k); }}
                            placeholder={blanks ? `${blanks} blank` : 'none blank'}
                            disabled={!blanks}
                            title={`Type a value and apply it to every blank ${KEY_LABEL[k] ?? k} on screen`}
                            className="w-full h-7 px-2 rounded-md bg-slate-950 border border-slate-700 focus:border-emerald-500 outline-none text-slate-200 text-[11px] placeholder:text-slate-700 disabled:opacity-40 transition-colors" />
                          <button onClick={() => fillColumn(k)} disabled={!blanks || !(bulk[k] ?? '').trim()}
                            className="px-1.5 h-7 rounded-md border border-slate-700 text-[11px] text-slate-400 hover:text-emerald-300 hover:border-emerald-500/40 disabled:opacity-30 transition-colors">↓</button>
                        </span>
                      </td>
                    );
                  })}
                  <td />
                </tr>
              )}
            </thead>
            <tbody className="divide-y divide-slate-800/60">
              {loading ? (
                [...Array(6)].map((_, i) => <tr key={i}><td colSpan={requiredKeys.length + 2} className="px-4 py-2"><div className="h-8 bg-slate-800/40 rounded-lg animate-pulse" /></td></tr>)
              ) : visible.length === 0 ? (
                <tr><td colSpan={requiredKeys.length + 2} className="px-4 py-12 text-center text-slate-600 text-sm">
                  {missingOnly ? 'Every item in this category is calculator-ready.' : 'Nothing matches.'}
                </td></tr>
              ) : visible.map((r) => {
                const sug = suggestionsFor.get(r.component_id) ?? {};
                const ready = requiredKeys.every((k) => valueOf(r, k).trim() !== '');
                const offers = requiredKeys.filter((k) => !valueOf(r, k) && sug[k]).length;
                return (
                  <tr key={r.component_id} className="hover:bg-white/[0.02] transition-colors">
                    <td className="px-4 py-2 sticky left-0 bg-chrome z-10">
                      <span className="flex items-center gap-2">
                        <span className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${ready ? 'bg-emerald-400' : 'bg-slate-700'}`}
                          title={ready ? 'Calculator-ready once saved' : 'Still missing required specs'} />
                        <span className="min-w-0">
                          <span className="block text-xs text-slate-100 truncate max-w-[280px]">{r.supplier_model}</span>
                          {r.internal_description && <span className="block text-[10px] text-slate-600 truncate max-w-[280px]">{r.internal_description}</span>}
                        </span>
                      </span>
                    </td>
                    {requiredKeys.map((k) => {
                      const val = valueOf(r, k);
                      const offer = !val ? sug[k] : undefined;
                      return (
                        <td key={k} className="px-3 py-2">
                          <input
                            className={offer ? inpSuggested : inp}
                            value={val}
                            placeholder={offer ? String(offer.value) : ''}
                            title={offer ? `Proposed: ${offer.value} — ${offer.why}` : undefined}
                            disabled={!canEdit}
                            onChange={(e) => setCell(r.component_id, k, e.target.value)}
                            onFocus={() => { if (offer && !val) setCell(r.component_id, k, String(suggestionValue(offer))); }}
                          />
                        </td>
                      );
                    })}
                    <td className="px-3 py-2 whitespace-nowrap">
                      {canEdit && offers > 0 && (
                        <button onClick={() => acceptRow(r)}
                          title="Fill this row's blanks with the proposals"
                          className="px-2 py-1 rounded-md text-[10px] font-semibold border border-sky-500/40 text-sky-300 hover:bg-sky-500/10 transition-colors">
                          Accept {offers}
                        </button>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        <p className="text-[10px] text-slate-600">
          Readiness is what the <Link href="/sales" className="text-emerald-500/80 hover:text-emerald-300">sales quotation</Link>&apos;s
          system designer chooses from — an item short of one number is never offered, so it can never be sized from a guess.
        </p>
      </main>
    </div>
  );
}
