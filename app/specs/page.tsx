'use client';
/**
 * Tech Specs — where a datasheet becomes data.
 *
 * Spec entry used to live inside the Item Editor as a raw JSON textarea on an
 * expanded row. That asked everyone to be a JSON author to record a number a
 * datasheet states in plain sight, and it buried the job inside a screen about
 * prices and suppliers. It lives here now, on its own, in two modes:
 *
 *   FORM  — one labelled input per declared field, grouped the way a datasheet
 *           reads. The default, because most people entering specs are copying
 *           a PDF, not composing a document.
 *   JSON  — the same object, raw, for whoever would rather paste. Both write
 *           through `conformSpecs`, so neither can produce a shape the other
 *           could not.
 *
 * And COMPARE, which is why the field sets are declared at all: pick two to
 * four items in one category and read them side by side, with the rows that
 * actually differ marked. A comparison is only honest when every column
 * answers the same questions — that is what a per-category field set buys.
 */
import { Fragment, useState, useEffect, useMemo, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { createSupabaseClient } from '@/lib/supabase';
import { fetchAllComponents } from '@/lib/fetchAllRows';
import { useAuth } from '@/hooks/useAuth';
import { ROLE_PERMISSIONS } from '@/constants/roles';
import { canOpenPath } from '@/constants/navigation';
import BrandMenu from '@/components/ui/BrandMenu';
import { formatCategory as humanize } from '@/lib/formatCategory';
import { fmtInt } from '@/lib/formatters';
import {
  CATEGORY_SPEC_FIELDS, conformSpecs, specGaps, type Specs,
} from '@/lib/specSchema';
import {
  fieldMeta, fieldsInGroup, groupsFor, isAnswered, displaySpecValue,
} from '@/lib/specFields';

interface Comp {
  component_id: string;
  supplier_model: string;
  internal_description: string | null;
  brand: string | null;
  category: string | null;
  specifications: Specs | null;
}

const descOf = (c: Comp) => c.internal_description?.trim() || c.supplier_model;

/** Categories that have a declared field set — the only ones this page serves. */
const DECLARED = Object.keys(CATEGORY_SPEC_FIELDS);

type Tab = 'entry' | 'compare';

export default function TechSpecsPage() {
  const supabase = useMemo(() => createSupabaseClient(), []);
  const { user, profile, loading: authLoading } = useAuth();
  const router = useRouter();
  const perms = profile ? ROLE_PERMISSIONS[profile.role] : null;
  const canEdit = !!perms?.canEdit;

  const [comps, setComps] = useState<Comp[]>([]);
  const [loading, setLoading] = useState(true);
  const [toast, setToast] = useState<string | null>(null);
  const flash = (m: string) => { setToast(m); setTimeout(() => setToast(null), 2600); };

  const [tab, setTab] = useState<Tab>('entry');
  const [category, setCategory] = useState<string>(DECLARED[0] ?? '');
  const [search, setSearch] = useState('');

  useEffect(() => { document.title = 'Tech Specs — ICAPROC'; }, []);
  useEffect(() => {
    if (authLoading) return;
    if (!user) { router.replace(`/login?next=${encodeURIComponent('/specs')}`); return; }
    if (profile && !canOpenPath(ROLE_PERMISSIONS[profile.role], '/specs')) router.replace('/unauthorized');
  }, [authLoading, user, profile, router]);

  /** Read once; the page edits one item at a time and patches in place. */
  const load = useCallback(async () => {
    const rows = await fetchAllComponents<Comp>(
      supabase, 'component_id, supplier_model, internal_description, brand, category, specifications');
    return () => { setComps(rows ?? []); setLoading(false); };
  }, [supabase]);
  useEffect(() => {
    let live = true;
    void load().then((apply) => { if (live) apply(); });
    return () => { live = false; };
  }, [load]);

  const fields = useMemo(
    () => (CATEGORY_SPEC_FIELDS[category as keyof typeof CATEGORY_SPEC_FIELDS] ?? []) as readonly string[],
    [category]);

  const inCategory = useMemo(() => {
    const q = search.trim().toLowerCase();
    return comps
      .filter((c) => (c.category ?? '') === category)
      .filter((c) => !q || descOf(c).toLowerCase().includes(q) || (c.brand ?? '').toLowerCase().includes(q))
      .sort((a, b) => descOf(a).localeCompare(descOf(b)));
  }, [comps, category, search]);

  /** How many declared fields each item answers — the list's whole ranking. */
  const answeredCount = useCallback(
    (c: Comp) => fields.length - specGaps(c.category, c.specifications ?? {}).length,
    [fields]);

  // ── Entry ─────────────────────────────────────────────────────────────────
  const [editingId, setEditingId] = useState<string | null>(null);
  const [mode, setMode] = useState<'form' | 'json'>('form');
  const [draft, setDraft] = useState<Record<string, string>>({});
  const [json, setJson] = useState('');
  const [jsonError, setJsonError] = useState('');
  const [saving, setSaving] = useState(false);

  const editing = useMemo(() => comps.find((c) => c.component_id === editingId) ?? null, [comps, editingId]);

  const openItem = useCallback((c: Comp) => {
    const specs = conformSpecs(c.category, c.specifications ?? {});
    const d: Record<string, string> = {};
    for (const [k, v] of Object.entries(specs)) {
      d[k] = Array.isArray(v) ? v.join(', ') : v === null || v === undefined ? '' : String(v);
    }
    setDraft(d);
    setJson(JSON.stringify(specs, null, 2));
    setJsonError('');
    setEditingId(c.component_id);
  }, []);

  /** One draft string back to the value its declared kind calls for. */
  const parseField = (key: string, raw: string): unknown => {
    const s = raw.trim();
    if (s === '') return null;
    const kind = fieldMeta(key).kind;
    if (kind === 'number') { const n = Number(s.replace(/,/g, '')); return Number.isFinite(n) ? n : s; }
    if (kind === 'boolean') return /^(yes|true|y|1)$/i.test(s);
    if (kind === 'list') return s.split(',').map((x) => x.trim()).filter(Boolean);
    return s;
  };

  const saveEntry = async () => {
    if (!editing || !canEdit) return;
    let next: Specs;
    if (mode === 'json') {
      try {
        const parsed = JSON.parse(json);
        if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('not an object');
        next = parsed as Specs;
      } catch {
        setJsonError('Specs must be a JSON object: {"key": value, …}');
        return;
      }
    } else {
      next = Object.fromEntries(Object.entries(draft).map(([k, v]) => [k, parseField(k, v)]));
    }
    // Both modes land here: whatever was typed, what is STORED is the
    // category's declared shape.
    const conformed = conformSpecs(editing.category, next);
    setSaving(true);
    const { error } = await supabase.from('3.0_components')
      .update({ specifications: conformed }).eq('component_id', editing.component_id);
    setSaving(false);
    if (error) { flash(`Could not save: ${error.message}`); return; }
    setComps((prev) => prev.map((c) => (c.component_id === editing.component_id
      ? { ...c, specifications: conformed } : c)));
    setJson(JSON.stringify(conformed, null, 2));
    setJsonError('');
    flash(`Saved — ${Object.values(conformed).filter(isAnswered).length} of ${fields.length} fields answered`);
  };

  // ── Compare ───────────────────────────────────────────────────────────────
  const [picked, setPicked] = useState<string[]>([]);
  const togglePick = (id: string) => setPicked((p) =>
    p.includes(id) ? p.filter((x) => x !== id) : p.length >= 4 ? p : [...p, id]);
  useEffect(() => { setPicked([]); }, [category]);

  const pickedComps = useMemo(
    () => picked.map((id) => comps.find((c) => c.component_id === id)).filter((c): c is Comp => !!c),
    [picked, comps]);

  const [onlyDifferences, setOnlyDifferences] = useState(false);

  /** A row differs when its answered values are not all the same. */
  const rowDiffers = useCallback((key: string) => {
    const vals = pickedComps.map((c) => displaySpecValue((c.specifications ?? {})[key]));
    return new Set(vals).size > 1;
  }, [pickedComps]);

  if (authLoading || !profile) {
    return <div className="min-h-screen bg-chrome flex items-center justify-center"><div className="w-6 h-6 border-2 border-emerald-500/30 border-t-emerald-500 rounded-full animate-spin" /></div>;
  }

  return (
    <div className="min-h-screen bg-chrome text-slate-200 font-sans text-sm">
      <div className="border-b border-slate-800/60 bg-chrome/80 backdrop-blur-md sticky top-0 z-30">
        <div className="max-w-[1200px] 2xl:max-w-[1760px] mx-auto px-3 sm:px-4 md:px-6 py-2.5 sm:py-3 flex flex-col sm:flex-row sm:items-center justify-between gap-2.5">
          <BrandMenu wordmarkClass="text-xl md:text-2xl font-extrabold" subtitle="Tech Specs · Enter and compare" />
          <Link href="/items/specs"
            title="The backfill workbench: proposes a value for every blank a calculator needs, from the item's own name"
            className="text-xs text-slate-400 hover:text-white px-3 py-1.5 border border-slate-700 rounded-lg hover:bg-slate-800 transition-colors whitespace-nowrap">
            Spec readiness →
          </Link>
        </div>
      </div>

      <main className="max-w-[1200px] 2xl:max-w-[1760px] mx-auto px-3 sm:px-4 md:px-6 py-4 sm:py-5 space-y-4">
        <div className="flex items-center gap-5 border-b border-slate-800/80">
          {([['entry', 'Enter Specs'], ['compare', `Compare${picked.length ? ` (${picked.length})` : ''}`]] as [Tab, string][]).map(([k, label]) => (
            <button key={k} onClick={() => setTab(k)}
              className={`pb-2.5 -mb-px text-[13px] transition-colors border-b-2 ${tab === k ? 'border-emerald-400 text-white font-bold' : 'border-transparent text-slate-500 hover:text-slate-300 font-medium'}`}>
              {label}
            </button>
          ))}
        </div>

        {/* Category is the frame for BOTH tabs: a field set belongs to a
            category, so entering and comparing are always within one. */}
        <div className="flex flex-wrap items-center gap-2">
          <select value={category} onChange={(e) => { setCategory(e.target.value); setEditingId(null); }}
            className="h-9 px-2.5 bg-slate-800 border border-slate-700 rounded-lg outline-none focus:ring-1 focus:ring-emerald-500/40 text-slate-200 text-[12.5px]">
            {DECLARED.map((c) => <option key={c} value={c}>{humanize(c)}</option>)}
          </select>
          <input value={search} onChange={(e) => setSearch(e.target.value)}
            placeholder="Search model or brand…"
            className="w-full sm:w-72 h-9 px-3 bg-slate-800 border border-slate-700 rounded-lg outline-none focus:ring-1 focus:ring-emerald-500/40 text-white text-[13px] placeholder:text-slate-500" />
          <span className="text-xs text-slate-500 tabular-nums whitespace-nowrap">
            {fmtInt(inCategory.length)} items · {fields.length} fields
          </span>
          {!canEdit && (
            <span className="text-[12px] text-amber-300/80 bg-amber-500/10 border border-amber-500/25 rounded-lg px-2.5 py-1">
              Read-only
            </span>
          )}
        </div>

        {loading ? (
          <div className="space-y-2">{[...Array(4)].map((_, i) => <div key={i} className="h-16 bg-slate-800/40 rounded-xl animate-pulse" />)}</div>
        ) : tab === 'entry' ? (
          <div className="grid grid-cols-1 lg:grid-cols-[22rem_1fr] gap-4 items-start">
            {/* The list, ranked by how much is still missing — the work queue */}
            <div className="rounded-xl border border-slate-800 bg-slate-900/40 divide-y divide-slate-800/60 max-h-[70vh] overflow-y-auto">
              {inCategory.map((c) => {
                const n = answeredCount(c);
                return (
                  <button key={c.component_id} onClick={() => openItem(c)}
                    className={`w-full text-left px-3 py-2 transition-colors ${editingId === c.component_id ? 'bg-emerald-500/10' : 'hover:bg-white/[0.03]'}`}>
                    <p className="text-[12.5px] text-slate-200 truncate">{descOf(c)}</p>
                    <p className="text-[10px] text-slate-500 tabular-nums">
                      {n} / {fields.length} answered
                      {n === 0 && <span className="text-amber-400/80"> · nothing entered</span>}
                    </p>
                  </button>
                );
              })}
              {inCategory.length === 0 && <p className="px-3 py-4 text-xs text-slate-600">No items in this category.</p>}
            </div>

            {!editing ? (
              <div className="rounded-xl border border-slate-800 bg-slate-900/40 p-6 text-sm text-slate-500">
                Pick an item to enter its specifications.
              </div>
            ) : (
              <div className="rounded-xl border border-slate-800 bg-slate-900/40 p-4 space-y-4">
                <div className="flex flex-wrap items-center gap-2">
                  <div className="min-w-0 flex-1">
                    <p className="font-semibold text-white truncate">{descOf(editing)}</p>
                    <p className="text-[11px] text-slate-500">{humanize(editing.category ?? '')}</p>
                  </div>
                  {/* Two doors to one room. The form is the default because
                      most entry is copying a PDF; JSON is for a paste. */}
                  <div className="flex rounded-lg border border-slate-700 overflow-hidden">
                    {(['form', 'json'] as const).map((m) => (
                      <button key={m} onClick={() => setMode(m)}
                        className={`px-2.5 py-1.5 text-[12px] font-medium transition-colors ${mode === m ? 'bg-emerald-600 text-white' : 'bg-slate-800 text-slate-400 hover:text-white'}`}>
                        {m === 'form' ? 'Form' : 'JSON'}
                      </button>
                    ))}
                  </div>
                  <button onClick={saveEntry} disabled={saving || !canEdit}
                    className="px-3 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white text-[12px] font-bold disabled:opacity-40">
                    {saving ? 'Saving…' : 'Save'}
                  </button>
                </div>

                {mode === 'json' ? (
                  <div>
                    <textarea value={json} onChange={(e) => { setJson(e.target.value); setJsonError(''); }}
                      spellCheck={false} rows={26}
                      className="w-full font-mono text-[11.5px] leading-relaxed rounded-lg bg-slate-950 border border-slate-800 focus:border-emerald-500/50 outline-none p-3 text-slate-200" />
                    {jsonError && <p className="mt-1 text-[11px] text-red-400">{jsonError}</p>}
                    <p className="mt-1 text-[11px] text-slate-600">
                      Saved through the same conform as the form: keys the category does not
                      declare are kept, declared keys you leave out come back as null.
                    </p>
                  </div>
                ) : (
                  <div className="space-y-4">
                    {groupsFor(fields).map((group) => (
                      <div key={group}>
                        <p className="text-[10px] font-semibold uppercase tracking-widest text-slate-500 mb-1.5">{group}</p>
                        <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-x-3 gap-y-2">
                          {fieldsInGroup(fields, group).map((key) => {
                            const meta = fieldMeta(key);
                            return (
                              <label key={key} className="block">
                                <span className="block text-[11px] text-slate-400 mb-0.5">
                                  {meta.label}
                                  {meta.unit && <span className="text-slate-600"> ({meta.unit})</span>}
                                </span>
                                <input
                                  value={draft[key] ?? ''}
                                  onChange={(e) => setDraft((d) => ({ ...d, [key]: e.target.value }))}
                                  disabled={!canEdit}
                                  inputMode={meta.kind === 'number' ? 'decimal' : undefined}
                                  placeholder={meta.hint ?? (meta.kind === 'boolean' ? 'Yes / No' : meta.kind === 'list' ? 'comma, separated' : '')}
                                  title={key}
                                  className="w-full px-2 py-1.5 rounded-lg bg-slate-950 border border-slate-800 focus:border-emerald-500/50 outline-none text-[12.5px] text-white placeholder:text-slate-700 disabled:opacity-60" />
                              </label>
                            );
                          })}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>
        ) : (
          <div className="space-y-3">
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-[11px] text-slate-500">Pick up to four:</span>
              {inCategory.slice(0, 60).map((c) => (
                <button key={c.component_id} onClick={() => togglePick(c.component_id)}
                  disabled={!picked.includes(c.component_id) && picked.length >= 4}
                  className={`px-2 py-1 rounded-lg text-[11.5px] border transition-colors disabled:opacity-30 ${
                    picked.includes(c.component_id)
                      ? 'bg-emerald-500/15 border-emerald-500/40 text-emerald-300'
                      : 'bg-slate-800 border-slate-700 text-slate-300 hover:border-slate-600'}`}>
                  {descOf(c)}
                </button>
              ))}
            </div>

            {pickedComps.length < 2 ? (
              <p className="rounded-xl border border-slate-800 bg-slate-900/40 p-6 text-sm text-slate-500">
                Choose at least two items to compare.
              </p>
            ) : (
              <>
                <label className="inline-flex items-center gap-2 text-[12px] text-slate-400">
                  <input type="checkbox" checked={onlyDifferences} onChange={(e) => setOnlyDifferences(e.target.checked)}
                    className="accent-emerald-500" />
                  Show only rows that differ
                </label>
                <div className="overflow-x-auto rounded-xl border border-slate-800">
                  <table className="w-full text-xs border-collapse">
                    <thead className="sticky top-0">
                      <tr className="bg-slate-900">
                        <th className="text-left px-3 py-2 font-semibold text-slate-400 uppercase tracking-widest text-[10px] w-56">Field</th>
                        {pickedComps.map((c) => (
                          <th key={c.component_id} className="text-left px-3 py-2 font-semibold text-white align-bottom min-w-[12rem]">
                            {descOf(c)}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {groupsFor(fields).map((group) => {
                        const rows = fieldsInGroup(fields, group)
                          .filter((k) => !onlyDifferences || rowDiffers(k));
                        if (rows.length === 0) return null;
                        return (
                          <Fragment key={group}>
                            <tr className="bg-slate-900/60">
                              <td colSpan={pickedComps.length + 1}
                                className="px-3 py-1.5 text-[10px] font-semibold uppercase tracking-widest text-slate-500">
                                {group}
                              </td>
                            </tr>
                            {rows.map((key) => {
                              const meta = fieldMeta(key);
                              const differs = rowDiffers(key);
                              return (
                                <tr key={key} className={`border-t border-slate-800/60 ${differs ? 'bg-amber-500/[0.04]' : ''}`}>
                                  <td className="px-3 py-1.5 text-slate-400 align-top">
                                    {meta.label}
                                    {meta.unit && <span className="text-slate-600"> ({meta.unit})</span>}
                                  </td>
                                  {pickedComps.map((c) => {
                                    const v = (c.specifications ?? {})[key];
                                    return (
                                      <td key={c.component_id}
                                        className={`px-3 py-1.5 align-top tabular-nums ${
                                          !isAnswered(v) ? 'text-slate-700'
                                            : differs ? 'text-amber-200 font-semibold' : 'text-slate-300'}`}>
                                        {displaySpecValue(v)}
                                      </td>
                                    );
                                  })}
                                </tr>
                              );
                            })}
                          </Fragment>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </>
            )}
          </div>
        )}
      </main>

      {toast && (
        <div className="fixed bottom-4 left-1/2 -translate-x-1/2 z-50 px-4 py-2 rounded-xl bg-slate-800 border border-slate-700 text-sm text-white shadow-2xl">
          {toast}
        </div>
      )}
    </div>
  );
}
