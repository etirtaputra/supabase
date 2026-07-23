'use client';
/**
 * Description Library — Owner-only editor for the project-quote item texts.
 *
 * Every distinct item description across all project quotes plus curated
 * entries from "10.4_description_library" (prepopulated texts that no quote
 * has used yet). Grouped the way quotes read: Solar Panels → BoS → Services,
 * sub-sections in quote order, items in row order — so descriptions keep
 * their context. Duplicate / near-duplicate detection, Rename-everywhere,
 * multi-select Merge and Delete, New-entry creation, and a Catalog-style
 * Find & Replace.
 */
import React, { useState, useEffect, useMemo, useCallback } from 'react';
import Link from 'next/link';
import { createSupabaseClient } from '@/lib/supabase';
import { useQuotesGate } from '@/hooks/useQuotesGate';
import { fmtRp } from '@/lib/formatters';
import { SECTION_GROUPS, STANDARD_SECTIONS, QUOTE_UNITS, type SectionGroup } from '@/types/quotes';

const STATUS_STYLES: Record<string, string> = {
  draft:    'bg-slate-700/60 text-slate-300',
  sent:     'bg-blue-500/20 text-blue-300',
  accepted: 'bg-emerald-500/20 text-emerald-300',
  rejected: 'bg-red-500/20 text-red-400',
};

interface Usage {
  item_id: string;
  raw: string;            // description exactly as stored on this row
  brand: string;
  unit: string;
  cost: number | null;
  sell: number | null;
  isSub: boolean;
  component_id: string | null;
  quote_number: string;
  quote_date: string;
  status: string;
  section_title: string;
  group_key: string;
  secSort: number;
  itemSort: number;
}

interface LibRow {
  entry_id: string;
  description: string;
  brand: string;
  unit: string;
  group_key: string;
  section_title: string;
  default_cost: number | null;
}

interface Entry {
  key: string;            // trimmed lowercase description
  display: string;        // most recent raw spelling
  variants: string[];     // distinct raw spellings (casing/spacing drift)
  usages: Usage[];
  latestCost: number | null;
  minCost: number | null;
  maxCost: number | null;
  linked: string[];       // distinct linked catalog models
  linkMismatch: boolean;  // a linked model not contained in the description
  dupSimilar: string[];   // display names of near-duplicate entries
  // Placement anchor = the most recent usage (or the curated row): keeps the
  // list in the same order the quotes read
  anchorGroup: string;
  anchorSection: string;
  secSort: number;
  itemSort: number;
  curated: LibRow | null;
}

const escLike = (s: string) => s.replace(/([%_\\])/g, '\\$1');
const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
const tokenSet = (s: string) => new Set(norm(s).split(' ').filter(Boolean));

function similarity(a: Set<string>, b: Set<string>): number {
  let inter = 0;
  for (const t of a) if (b.has(t)) inter += 1;
  const uni = a.size + b.size - inter;
  return uni ? inter / uni : 0;
}

const LIB_TABLE = '10.4_description_library';

export default function DescriptionLibraryPage() {
  const supabase = createSupabaseClient();
  const gate = useQuotesGate();
  const isOwner = gate.profile?.role === 'owner';

  const [loading, setLoading] = useState(true);
  const [usagesAll, setUsagesAll] = useState<Usage[]>([]);
  const [libRows, setLibRows] = useState<LibRow[]>([]);
  const [libMissing, setLibMissing] = useState(false);
  const [compNames, setCompNames] = useState<Map<string, string>>(new Map());
  const [busy, setBusy] = useState(false);
  const [flash, setFlash] = useState('');
  const [error, setError] = useState('');

  useEffect(() => { document.title = 'Description Library | ICAPROC'; }, []);

  const load = useCallback(async () => {
    setLoading(true);
    const [itemsRes, secRes, quotesRes, compRes, libRes] = await Promise.all([
      supabase.from('10.2_quote_items')
        .select('item_id, quote_id, section_id, parent_item_id, component_id, description, brand, unit, cost_price, sell_price, sort_order'),
      supabase.from('10.1_quote_sections').select('section_id, title, group_key, sort_order'),
      supabase.from('10.0_project_quotes').select('quote_id, quote_number, quote_date, status'),
      supabase.from('3.0_components').select('component_id, supplier_model'),
      supabase.from(LIB_TABLE).select('*'),
    ]);
    const secMap = new Map((secRes.data ?? []).map((s) => [s.section_id as string, s]));
    const qMap = new Map((quotesRes.data ?? []).map((q) => [q.quote_id as string, q]));
    setCompNames(new Map((compRes.data ?? []).map((c) => [c.component_id as string, String(c.supplier_model ?? '')])));
    setLibMissing(!!libRes.error);
    setLibRows(((libRes.data ?? []) as LibRow[]).map((r) => ({
      ...r,
      brand: String(r.brand ?? ''), unit: String(r.unit ?? ''),
      group_key: String(r.group_key ?? 'bos'), section_title: String(r.section_title ?? ''),
      default_cost: r.default_cost != null ? Number(r.default_cost) : null,
    })));

    const out: Usage[] = [];
    for (const it of itemsRes.data ?? []) {
      const raw = String(it.description ?? '').trim();
      if (raw.length < 2) continue;
      const sec = secMap.get(it.section_id as string);
      const q = qMap.get(it.quote_id as string);
      out.push({
        item_id: it.item_id as string,
        raw,
        brand: String(it.brand ?? ''),
        unit: String(it.unit ?? ''),
        cost: it.cost_price != null ? Number(it.cost_price) : null,
        sell: it.sell_price != null ? Number(it.sell_price) : null,
        isSub: !!it.parent_item_id,
        component_id: (it.component_id as string | null) ?? null,
        quote_number: String(q?.quote_number ?? '—'),
        quote_date: String(q?.quote_date ?? ''),
        status: String(q?.status ?? 'draft'),
        section_title: String(sec?.title ?? '—'),
        group_key: String(sec?.group_key ?? ''),
        secSort: sec?.sort_order != null ? Number(sec.sort_order) : 9999,
        itemSort: it.sort_order != null ? Number(it.sort_order) : 9999,
      });
    }
    setUsagesAll(out);
    setLoading(false);
  }, []);

  useEffect(() => { if (gate.ready && isOwner) load(); }, [gate.ready, isOwner, load]);

  // ── Build entries (quote usage + curated library rows) ──────────────────────
  const entries = useMemo(() => {
    const byKey = new Map<string, Entry>();
    const usagesByKey = new Map<string, Usage[]>();
    for (const u of usagesAll) {
      const key = u.raw.toLowerCase();
      usagesByKey.set(key, [...(usagesByKey.get(key) ?? []), u]);
    }
    for (const [key, usages] of usagesByKey) {
      usages.sort((a, b) => b.quote_date.localeCompare(a.quote_date));
      const anchor = usages[0];
      const costs = usages.map((u) => u.cost).filter((c): c is number => c != null && c > 0);
      const linked = [...new Set(usages.map((u) => u.component_id && compNames.get(u.component_id)).filter(Boolean))] as string[];
      byKey.set(key, {
        key,
        display: anchor.raw,
        variants: [...new Set(usages.map((u) => u.raw))],
        usages,
        latestCost: usages.find((u) => u.cost != null && u.cost > 0)?.cost ?? null,
        minCost: costs.length ? Math.min(...costs) : null,
        maxCost: costs.length ? Math.max(...costs) : null,
        linked,
        linkMismatch: linked.some((m) => !key.includes(m.toLowerCase())),
        dupSimilar: [],
        anchorGroup: anchor.group_key || 'bos',
        anchorSection: anchor.section_title !== '—' ? anchor.section_title : '',
        secSort: anchor.secSort,
        itemSort: anchor.itemSort,
        curated: null,
      });
    }
    for (const r of libRows) {
      const display = r.description.trim();
      const key = display.toLowerCase();
      if (key.length < 2) continue;
      const existing = byKey.get(key);
      if (existing) { existing.curated = r; continue; }
      byKey.set(key, {
        key, display, variants: [display], usages: [],
        latestCost: r.default_cost, minCost: null, maxCost: null,
        linked: [], linkMismatch: false, dupSimilar: [],
        anchorGroup: r.group_key || 'bos',
        anchorSection: r.section_title,
        secSort: 9999, itemSort: 9999,
        curated: r,
      });
    }
    const list = [...byKey.values()];
    // Near-duplicate pass: same normalized text, or high token overlap
    const toks = list.map((e) => tokenSet(e.key));
    const norms = list.map((e) => norm(e.key));
    for (let i = 0; i < list.length; i++) {
      for (let j = i + 1; j < list.length; j++) {
        if (norms[i] === norms[j] || similarity(toks[i], toks[j]) >= 0.75) {
          list[i].dupSimilar.push(list[j].display);
          list[j].dupSimilar.push(list[i].display);
        }
      }
    }
    return list;
  }, [usagesAll, libRows, compNames]);

  // ── Filters / search / selection / expansion ────────────────────────────────
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState<'all' | 'free' | 'dups' | 'linked'>('free');
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [selected, setSelected] = useState<Set<string>>(new Set());

  const visible = useMemo(() => {
    const q = search.trim().toLowerCase();
    return entries.filter((e) => {
      if (q && !e.key.includes(q)) return false;
      if (filter === 'dups') return e.dupSimilar.length > 0 || e.variants.length > 1;
      if (filter === 'linked') return e.linked.length > 0;
      if (filter === 'free') return e.linked.length === 0;
      return true;
    });
  }, [entries, search, filter]);

  const dupCount = useMemo(
    () => entries.filter((e) => e.dupSimilar.length > 0 || e.variants.length > 1).length,
    [entries]);

  // Nesting in quote-reading order: group → sub-section (by quote sort_order)
  // → entries (by row sort_order)
  const grouped = useMemo(() => {
    const groups = new Map<string, Map<string, { secSort: number; entries: Entry[] }>>();
    for (const e of visible) {
      const g = SECTION_GROUPS.some((x) => x.key === e.anchorGroup) ? e.anchorGroup : 'bos';
      const title = e.anchorSection || 'Unsectioned';
      const secs = groups.get(g) ?? new Map();
      const bucket = secs.get(title) ?? { secSort: e.secSort, entries: [] };
      bucket.secSort = Math.min(bucket.secSort, e.secSort);
      bucket.entries.push(e);
      secs.set(title, bucket);
      groups.set(g, secs);
    }
    for (const secs of groups.values()) {
      for (const bucket of secs.values()) {
        bucket.entries.sort((a, b) => a.itemSort - b.itemSort || a.display.localeCompare(b.display));
      }
    }
    return groups;
  }, [visible]);

  function toggle(set: Set<string>, key: string): Set<string> {
    const next = new Set(set);
    if (next.has(key)) next.delete(key); else next.add(key);
    return next;
  }

  // Best-effort curated-row rename: if the target spelling already exists in
  // the library (unique index), drop the source row instead
  async function renameLibRows(oldDesc: string, newDesc: string) {
    const { error: e } = await supabase.from(LIB_TABLE)
      .update({ description: newDesc }).ilike('description', escLike(oldDesc));
    if (e) await supabase.from(LIB_TABLE).delete().ilike('description', escLike(oldDesc));
  }

  // ── Rename everywhere ────────────────────────────────────────────────────────
  const [rename, setRename] = useState<{ entry: Entry; text: string; brand: string; unit: string } | null>(null);

  async function applyRename() {
    if (!rename) return;
    const newDesc = rename.text.trim();
    if (newDesc.length < 3) { setError('Description too short'); return; }
    setBusy(true); setError('');
    const patch: Record<string, string> = { description: newDesc };
    if (rename.brand.trim()) patch.brand = rename.brand.trim();
    if (rename.unit.trim()) patch.unit = rename.unit.trim();
    for (const v of rename.entry.variants) {
      const { error: e } = await supabase.from('10.2_quote_items').update(patch).ilike('description', escLike(v));
      if (e) { setBusy(false); setError(e.message); return; }
      await renameLibRows(v, newDesc);
    }
    // Curated row (if any) adopts the same brand/unit normalization
    if (rename.entry.curated && (patch.brand || patch.unit)) {
      const libPatch: Record<string, string> = {};
      if (patch.brand) libPatch.brand = patch.brand;
      if (patch.unit) libPatch.unit = patch.unit;
      await supabase.from(LIB_TABLE).update(libPatch).eq('entry_id', rename.entry.curated.entry_id);
    }
    setBusy(false);
    setFlash(`Renamed ${rename.entry.usages.length || 'the library'} item${rename.entry.usages.length > 1 ? 's' : ''} to “${newDesc}”`);
    setRename(null);
    setSelected(new Set());
    load();
  }

  // ── Merge selected entries into one spelling ────────────────────────────────
  const [merge, setMerge] = useState<{ keys: string[]; canonical: string } | null>(null);

  async function applyMerge() {
    if (!merge) return;
    const target = entries.find((e) => e.key === merge.canonical);
    if (!target) return;
    setBusy(true); setError('');
    let count = 0;
    for (const k of merge.keys) {
      if (k === merge.canonical) continue;
      const src = entries.find((e) => e.key === k);
      if (!src) continue;
      for (const v of src.variants) {
        const { error: e } = await supabase.from('10.2_quote_items')
          .update({ description: target.display }).ilike('description', escLike(v));
        if (e) { setBusy(false); setError(e.message); return; }
        await renameLibRows(v, target.display);
      }
      count += src.usages.length;
    }
    setBusy(false);
    setFlash(`Merged into “${target.display}” — ${count} quote item${count === 1 ? '' : 's'} updated, histories now share one entry`);
    setMerge(null);
    setSelected(new Set());
    load();
  }

  // ── Delete selected entries ─────────────────────────────────────────────────
  const [del, setDel] = useState<{ keys: string[]; deleteQuoteItems: boolean } | null>(null);

  async function applyDelete() {
    if (!del) return;
    setBusy(true); setError('');
    let libCount = 0, itemCount = 0;
    for (const k of del.keys) {
      const e = entries.find((x) => x.key === k);
      if (!e) continue;
      if (e.curated) {
        const { error: err } = await supabase.from(LIB_TABLE).delete().eq('entry_id', e.curated.entry_id);
        if (err) { setBusy(false); setError(err.message); return; }
        libCount += 1;
      }
      if (del.deleteQuoteItems && e.usages.length) {
        const ids = e.usages.map((u) => u.item_id);
        const { error: err } = await supabase.from('10.2_quote_items').delete().in('item_id', ids);
        if (err) { setBusy(false); setError(err.message); return; }
        itemCount += ids.length;
      }
    }
    setBusy(false);
    setFlash(`Deleted ${libCount ? `${libCount} library entr${libCount > 1 ? 'ies' : 'y'}` : ''}${libCount && itemCount ? ' and ' : ''}${itemCount ? `${itemCount} quote item${itemCount > 1 ? 's' : ''}` : ''}` || 'Nothing deleted');
    setDel(null);
    setSelected(new Set());
    load();
  }

  // ── Create a new library entry ──────────────────────────────────────────────
  const emptyDraft = { description: '', brand: '', unit: 'pcs', group_key: 'bos' as SectionGroup, section_title: '', cost: '' };
  const [draft, setDraft] = useState<typeof emptyDraft | null>(null);

  async function applyCreate() {
    if (!draft) return;
    const desc = draft.description.trim();
    if (desc.length < 3) { setError('Description too short'); return; }
    setBusy(true); setError('');
    const { error: e } = await supabase.from(LIB_TABLE).insert({
      description: desc,
      brand: draft.brand.trim(),
      unit: draft.unit.trim(),
      group_key: draft.group_key,
      section_title: draft.section_title.trim(),
      default_cost: draft.cost.trim() ? Number(draft.cost) : null,
    });
    setBusy(false);
    if (e) {
      setError(/does not exist|schema cache/i.test(e.message)
        ? 'The library table is missing — run the migration SQL first (see the banner).'
        : e.message);
      return;
    }
    setFlash(`Added “${desc}” — it now appears in the editor autocomplete`);
    setDraft(null);
    load();
  }

  // ── Find & Replace (Catalog-style) ──────────────────────────────────────────
  const [showFr, setShowFr] = useState(false);
  const [frFind, setFrFind] = useState('');
  const [frReplace, setFrReplace] = useState('');
  const [frMatchCase, setFrMatchCase] = useState(false);
  const [frUseRegex, setFrUseRegex] = useState(false);

  const applyReplaceToValue = useCallback((val: string) => {
    if (!val || !frFind) return val;
    try {
      if (frUseRegex) return val.replace(new RegExp(frFind, frMatchCase ? 'g' : 'gi'), frReplace);
      const src = frMatchCase ? val : val.toLowerCase();
      const find = frMatchCase ? frFind : frFind.toLowerCase();
      let result = val, offset = 0, idx: number;
      while ((idx = src.indexOf(find, offset)) >= 0) {
        result = result.slice(0, idx) + frReplace + result.slice(idx + frFind.length);
        offset = idx + frReplace.length;
        if (!frReplace.length && offset === idx) break;
      }
      return result;
    } catch { return val; }
  }, [frFind, frReplace, frMatchCase, frUseRegex]);

  const frMatches = useMemo(() => {
    if (!frFind) return [];
    return usagesAll
      .map((u) => ({ u, after: applyReplaceToValue(u.raw) }))
      .filter((x) => x.after !== x.u.raw);
  }, [usagesAll, frFind, applyReplaceToValue]);

  async function applyReplaceAll() {
    if (!frMatches.length) return;
    setBusy(true); setError('');
    for (let i = 0; i < frMatches.length; i += 25) {
      const chunk = frMatches.slice(i, i + 25);
      const results = await Promise.all(chunk.map((x) =>
        supabase.from('10.2_quote_items').update({ description: x.after.trim() }).eq('item_id', x.u.item_id)));
      const bad = results.find((r) => r.error);
      if (bad?.error) { setBusy(false); setError(bad.error.message); return; }
    }
    // Curated rows join the rename so the library stays consistent
    for (const r of libRows) {
      const after = applyReplaceToValue(r.description);
      if (after !== r.description) await renameLibRows(r.description, after.trim());
    }
    setBusy(false);
    setFlash(`Replaced text in ${frMatches.length} item${frMatches.length > 1 ? 's' : ''}`);
    setShowFr(false); setFrFind(''); setFrReplace('');
    load();
  }

  // ── Gate ────────────────────────────────────────────────────────────────────
  if (!gate.ready) {
    return (
      <div className="min-h-screen bg-[#141518] flex items-center justify-center">
        <div className="w-6 h-6 border-2 border-violet-500/30 border-t-violet-500 rounded-full animate-spin" />
      </div>
    );
  }
  if (!isOwner) {
    return (
      <div className="min-h-screen bg-[#141518] flex flex-col items-center justify-center gap-4 text-slate-400 text-sm">
        <p>The Description Library is only available to Owners.</p>
        <Link href="/proposals" className="text-violet-400 hover:text-violet-300 underline">Back to quotes</Link>
      </div>
    );
  }

  const delEntries = del ? entries.filter((e) => del.keys.includes(e.key)) : [];
  const delItemCount = delEntries.reduce((s, e) => s + e.usages.length, 0);
  const delSentCount = delEntries.reduce((s, e) => s + e.usages.filter((u) => u.status === 'sent').length, 0);
  const delLibCount = delEntries.filter((e) => e.curated).length;

  const renderEntry = (e: Entry) => (
    <div key={e.key} className="bg-slate-900/50 border border-slate-800 hover:border-slate-700 rounded-2xl transition-colors">
      <div className="flex items-center gap-3 px-4 py-3">
        <input type="checkbox" checked={selected.has(e.key)}
          onChange={() => setSelected((s) => toggle(s, e.key))}
          className="accent-violet-600 flex-shrink-0" />
        <button onClick={() => setExpanded((s) => toggle(s, e.key))} className="flex-1 min-w-0 text-left">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="font-medium text-slate-100 truncate">{e.display}</span>
            <span className="text-[10px] text-slate-600">×{e.usages.length}</span>
            {e.curated && (
              <span className="px-1.5 py-0.5 rounded-full text-[9px] font-bold bg-violet-500/15 text-violet-300"
                title="Curated library entry — offered in the editor autocomplete even before first use">LIB</span>
            )}
            {e.variants.length > 1 && (
              <span className="px-1.5 py-0.5 rounded-full text-[9px] font-bold bg-red-500/15 text-red-300"
                title={`Spelling variants: ${e.variants.join(' | ')}`}>
                {e.variants.length} spellings
              </span>
            )}
            {e.dupSimilar.length > 0 && (
              <span className="px-1.5 py-0.5 rounded-full text-[9px] font-bold bg-amber-500/15 text-amber-300"
                title={`Similar to: ${e.dupSimilar.join(' | ')}`}>
                ~{e.dupSimilar.length} similar
              </span>
            )}
            {e.linked.length > 0 && (
              <span className={`px-1.5 py-0.5 rounded-full text-[9px] font-bold ${e.linkMismatch ? 'bg-red-500/15 text-red-300' : 'bg-emerald-500/15 text-emerald-300'}`}
                title={`Linked to: ${e.linked.join(' | ')}${e.linkMismatch ? ' — link does not match the description!' : ''}`}>
                🔗 {e.linkMismatch ? 'wrong link?' : 'linked'}
              </span>
            )}
          </div>
          <div className="flex items-center gap-3 mt-0.5 text-[11px] text-slate-500">
            {e.usages.length > 0 ? (
              <span className="flex-shrink-0">
                {[...new Set(e.usages.map((u) => u.quote_number))].join(' · ')}
              </span>
            ) : (
              <span className="text-violet-400/70">not used in any quote yet</span>
            )}
            {e.usages[0]?.brand && <span className="truncate text-slate-600">{e.usages[0].brand}</span>}
            {e.curated && !e.usages.length && e.curated.brand && <span className="truncate text-slate-600">{e.curated.brand}</span>}
            {(e.usages[0]?.unit || e.curated?.unit) && (
              <span className="flex-shrink-0 px-1.5 py-0.5 rounded bg-white/[0.04] text-slate-500 text-[10px]"
                title={[...new Set(e.usages.map((u) => u.unit).filter(Boolean))].length > 1
                  ? `Mixed units: ${[...new Set(e.usages.map((u) => u.unit).filter(Boolean))].join(', ')} — use Rename to normalize`
                  : 'Unit'}>
                {e.usages[0]?.unit || e.curated?.unit}
                {[...new Set(e.usages.map((u) => u.unit).filter(Boolean))].length > 1 && <span className="text-amber-400 ml-1">⚠ mixed</span>}
              </span>
            )}
          </div>
        </button>
        <div className="text-right flex-shrink-0 tabular-nums">
          {e.latestCost != null && e.latestCost > 0 ? (
            <>
              <p className="text-xs font-semibold text-slate-300">{fmtRp(e.latestCost)}</p>
              {e.minCost != null && e.maxCost != null && e.minCost !== e.maxCost && (
                <p className="text-[10px] text-amber-400/80" title="Costs differ between quotes">
                  {fmtRp(e.minCost)} – {fmtRp(e.maxCost)}
                </p>
              )}
            </>
          ) : <p className="text-[10px] text-slate-600">no cost</p>}
        </div>
        <button
          onClick={() => { setError(''); setRename({ entry: e, text: e.display, brand: '', unit: '' }); }}
          className="p-2 rounded-lg hover:bg-white/10 text-slate-500 hover:text-white transition-colors flex-shrink-0"
          title="Rename everywhere — updates every quote item carrying this description"
        >
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" /></svg>
        </button>
      </div>
      {expanded.has(e.key) && (
        <div className="border-t border-slate-800 px-4 py-3 overflow-x-auto">
          {e.usages.length === 0 ? (
            <p className="text-xs text-slate-500 italic">
              Library-only entry — appears in the editor autocomplete, no quote has used it yet.
              {e.curated?.default_cost ? ` Default cost ${fmtRp(e.curated.default_cost)}.` : ''}
            </p>
          ) : (
            <table className="w-full text-xs">
              <thead>
                <tr className="text-left text-[10px] uppercase tracking-wider text-slate-600">
                  <th className="py-1 pr-4">Quote</th>
                  <th className="py-1 pr-4">Date</th>
                  <th className="py-1 pr-4">Status</th>
                  <th className="py-1 pr-4">Section</th>
                  <th className="py-1 pr-4">Unit</th>
                  <th className="py-1 pr-4">As entered</th>
                  <th className="py-1 pr-4 text-right">Cost</th>
                  <th className="py-1 text-right">Sell</th>
                </tr>
              </thead>
              <tbody>
                {e.usages.map((u) => (
                  <tr key={u.item_id} className="border-t border-slate-800/60">
                    <td className="py-1.5 pr-4 font-medium text-slate-300 whitespace-nowrap">{u.quote_number}{u.isSub && <span className="ml-1.5 text-[9px] text-slate-600">sub-item</span>}</td>
                    <td className="py-1.5 pr-4 text-slate-500 whitespace-nowrap">{u.quote_date || '—'}</td>
                    <td className="py-1.5 pr-4"><span className={`px-1.5 py-0.5 rounded-full text-[9px] font-semibold uppercase ${STATUS_STYLES[u.status] ?? STATUS_STYLES.draft}`}>{u.status}</span></td>
                    <td className="py-1.5 pr-4 text-slate-400">{u.section_title}</td>
                    <td className="py-1.5 pr-4 text-slate-500">{u.unit || '—'}</td>
                    <td className={`py-1.5 pr-4 ${u.raw !== e.display ? 'text-red-300' : 'text-slate-500'}`}>{u.raw !== e.display ? u.raw : '〃'}</td>
                    <td className="py-1.5 pr-4 text-right tabular-nums text-slate-300">{u.cost != null && u.cost > 0 ? fmtRp(u.cost) : '—'}</td>
                    <td className="py-1.5 text-right tabular-nums text-slate-400">{u.sell != null && u.sell > 0 ? fmtRp(u.sell) : '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}
    </div>
  );

  return (
    <div className="min-h-screen bg-[#141518] text-slate-200 font-sans text-sm">
      {/* Header */}
      <div className="sticky top-0 z-40 bg-[#141518]/90 backdrop-blur-xl border-b border-white/[0.07]">
        <div className="max-w-6xl 2xl:max-w-[1400px] mx-auto px-4 sm:px-6 py-4 flex items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <Link href="/proposals" className="text-slate-500 hover:text-slate-300 transition-colors">
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M15 19l-7-7 7-7" /></svg>
            </Link>
            <div>
              <h1 className="text-xl font-bold text-white tracking-tight">Description Library</h1>
              <p className="text-slate-500 text-[11px] mt-0.5">Every item text used in project quotes — keep one spelling per item</p>
            </div>
          </div>
          <div className="flex items-center gap-2 flex-wrap justify-end">
            {selected.size >= 1 && (
              <button
                onClick={() => { setError(''); setDel({ keys: [...selected], deleteQuoteItems: false }); }}
                className="px-3 py-2 rounded-xl bg-red-600/80 hover:bg-red-500 text-white text-xs font-semibold transition-colors"
              >
                Delete {selected.size}
              </button>
            )}
            {selected.size >= 2 && (
              <button
                onClick={() => { setError(''); setMerge({ keys: [...selected], canonical: [...selected][0] }); }}
                className="px-3 py-2 rounded-xl bg-amber-600 hover:bg-amber-500 text-white text-xs font-semibold transition-colors"
              >
                Merge {selected.size}
              </button>
            )}
            <button
              onClick={() => { setError(''); setDraft({ ...emptyDraft }); }}
              className="px-3 py-2 rounded-xl bg-violet-600 hover:bg-violet-500 text-white text-xs font-semibold transition-colors"
            >
              + New
            </button>
            <button
              onClick={() => { setError(''); setShowFr(true); }}
              className="flex items-center gap-1.5 px-3 py-2 rounded-xl border border-white/[0.08] text-slate-300 hover:text-white hover:bg-white/10 text-xs font-semibold transition-all"
            >
              <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2"><path strokeLinecap="round" strokeLinejoin="round" d="M7 16V4m0 0L3 8m4-4l4 4m6 0v12m0 0l4-4m-4 4l-4-4" /></svg>
              Replace
            </button>
          </div>
        </div>
      </div>

      <main className="max-w-6xl 2xl:max-w-[1400px] mx-auto px-4 sm:px-6 py-6 space-y-4">
        {libMissing && (
          <div className="bg-amber-500/10 border border-amber-500/40 rounded-2xl px-4 py-3 text-sm text-amber-300">
            The <span className="font-mono">10.4_description_library</span> table doesn&apos;t exist yet — creating new entries needs it.
            Run the migration SQL in Supabase → SQL Editor (everything else here works without it).
          </div>
        )}
        {flash && (
          <div className="bg-emerald-500/10 border border-emerald-500/30 rounded-2xl px-4 py-3 text-sm text-emerald-300 flex items-center justify-between">
            {flash}
            <button onClick={() => setFlash('')} className="text-emerald-400/60 hover:text-emerald-200 ml-3">✕</button>
          </div>
        )}
        {error && !rename && !merge && !del && !draft && !showFr && (
          <div className="bg-red-500/10 border border-red-500/40 rounded-2xl px-4 py-3 text-sm text-red-300">{error}</div>
        )}

        {/* Search + filters */}
        <div className="flex flex-wrap items-center gap-2">
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search descriptions…"
            className="flex-1 min-w-[220px] px-3 py-2 bg-slate-900/70 border border-slate-700 rounded-xl text-sm text-white placeholder-slate-600 focus:outline-none focus:border-violet-500"
          />
          {([
            { k: 'free',   label: 'Free text' },
            { k: 'dups',   label: `Duplicates (${dupCount})` },
            { k: 'linked', label: 'Catalog-linked' },
            { k: 'all',    label: `All (${entries.length})` },
          ] as const).map((f) => (
            <button key={f.k} onClick={() => setFilter(f.k)}
              className={`px-3 py-2 rounded-xl text-xs font-semibold border transition-all ${filter === f.k
                ? 'bg-violet-500/20 border-violet-500/40 text-violet-300'
                : 'border-white/[0.08] text-slate-400 hover:text-white hover:bg-white/5'}`}>
              {f.label}
            </button>
          ))}
        </div>

        {loading ? (
          <div className="flex items-center justify-center h-48 text-slate-500">Loading…</div>
        ) : visible.length === 0 ? (
          <div className="flex items-center justify-center h-48 text-slate-500">No descriptions match</div>
        ) : (
          <div className="space-y-6">
            {SECTION_GROUPS.map((g) => {
              const secs = grouped.get(g.key);
              if (!secs || !secs.size) return null;
              const orderedSecs = [...secs.entries()].sort((a, b) => a[1].secSort - b[1].secSort || a[0].localeCompare(b[0]));
              return (
                <div key={g.key}>
                  <div className="flex items-center gap-3 mb-2 px-1">
                    <h2 className="text-xs font-bold uppercase tracking-widest text-emerald-300">{g.label}</h2>
                    <div className="flex-1 h-px bg-emerald-500/15" />
                  </div>
                  <div className="space-y-4">
                    {orderedSecs.map(([title, bucket]) => (
                      <div key={title}>
                        <p className="text-[11px] font-semibold text-slate-400 mb-1.5 px-1">{title}
                          <span className="ml-2 text-slate-600 font-normal">{bucket.entries.length}</span>
                        </p>
                        <div className="space-y-1.5">
                          {bucket.entries.map(renderEntry)}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </main>

      {/* Rename modal */}
      {rename && (
        <div className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-4">
          <div className="bg-slate-900 border border-slate-700 rounded-2xl p-6 max-w-lg w-full">
            <h3 className="font-semibold text-white mb-1">Rename everywhere</h3>
            <p className="text-slate-500 text-xs mb-4">
              Updates all {rename.entry.usages.length} item{rename.entry.usages.length === 1 ? '' : 's'} carrying this text
              {rename.entry.variants.length > 1 ? ` (including ${rename.entry.variants.length} spelling variants)` : ''}, across every quote — including SENT ones.
              Cost history follows the new spelling.
            </p>
            <label className="block text-[10px] uppercase tracking-widest text-slate-500 mb-1">Description</label>
            <input value={rename.text} onChange={(e) => setRename({ ...rename, text: e.target.value })}
              onKeyDown={(e) => { if (e.key === 'Enter') applyRename(); }}
              className="w-full px-3 py-2.5 bg-slate-800/80 border border-slate-700 rounded-lg text-white text-sm focus:outline-none focus:border-violet-500 mb-3" autoFocus />
            <label className="block text-[10px] uppercase tracking-widest text-slate-500 mb-1">Brand (optional — blank keeps each row&apos;s brand)</label>
            <input value={rename.brand} onChange={(e) => setRename({ ...rename, brand: e.target.value })}
              placeholder="Leave blank to keep existing brands"
              className="w-full px-3 py-2.5 bg-slate-800/80 border border-slate-700 rounded-lg text-white text-sm placeholder-slate-600 focus:outline-none focus:border-violet-500 mb-3" />
            <label className="block text-[10px] uppercase tracking-widest text-slate-500 mb-1">Unit (optional — blank keeps each row&apos;s unit)</label>
            <input value={rename.unit} onChange={(e) => setRename({ ...rename, unit: e.target.value })}
              placeholder={`Currently: ${[...new Set(rename.entry.usages.map((u) => u.unit).filter(Boolean))].join(', ') || rename.entry.curated?.unit || '—'}`}
              className="w-full px-3 py-2.5 bg-slate-800/80 border border-slate-700 rounded-lg text-white text-sm placeholder-slate-600 focus:outline-none focus:border-violet-500 mb-1.5" />
            <div className="flex flex-wrap gap-1.5">
              {QUOTE_UNITS.map((u) => (
                <button key={u} onClick={() => setRename({ ...rename, unit: u })}
                  className={`px-2 py-1 rounded-lg text-[10px] border transition-all ${rename.unit === u
                    ? 'bg-violet-500/20 border-violet-500/40 text-violet-300'
                    : 'border-slate-700/60 text-slate-500 hover:text-slate-300'}`}>
                  {u}
                </button>
              ))}
            </div>
            {error && <p className="text-[11px] text-red-400 mt-3">{error}</p>}
            <div className="flex gap-3 justify-end mt-5">
              <button onClick={() => setRename(null)} disabled={busy}
                className="px-4 py-2 rounded-lg text-slate-400 hover:text-white hover:bg-white/10 text-sm transition-colors disabled:opacity-50">Cancel</button>
              <button onClick={applyRename} disabled={busy}
                className="px-4 py-2 rounded-lg bg-violet-600 hover:bg-violet-500 text-white text-sm font-semibold transition-colors disabled:opacity-50">
                {busy ? 'Renaming…' : 'Rename'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Merge modal */}
      {merge && (
        <div className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-4">
          <div className="bg-slate-900 border border-slate-700 rounded-2xl p-6 max-w-lg w-full">
            <h3 className="font-semibold text-white mb-1">Merge into one spelling</h3>
            <p className="text-slate-500 text-xs mb-4">
              All selected entries become the spelling you pick. Every quote item is updated in place — quotes,
              sections, quantities and prices stay untouched, and the cost histories combine under one entry.
            </p>
            <div className="space-y-2 max-h-60 overflow-y-auto mb-4">
              {merge.keys.map((k) => {
                const e = entries.find((x) => x.key === k);
                if (!e) return null;
                return (
                  <label key={k} className={`flex items-start gap-3 p-3 rounded-xl border cursor-pointer transition-colors ${merge.canonical === k ? 'border-violet-500/50 bg-violet-500/10' : 'border-slate-800 hover:border-slate-700'}`}>
                    <input type="radio" name="canonical" checked={merge.canonical === k}
                      onChange={() => setMerge({ ...merge, canonical: k })} className="mt-0.5 accent-violet-600" />
                    <span className="min-w-0">
                      <span className="block text-sm text-slate-200">{e.display}</span>
                      <span className="block text-[10px] text-slate-500">×{e.usages.length} · {e.anchorSection || 'no section'}{e.latestCost != null && e.latestCost > 0 ? ` · latest ${fmtRp(e.latestCost)}` : ''}</span>
                    </span>
                  </label>
                );
              })}
            </div>
            {error && <p className="text-[11px] text-red-400 mb-3">{error}</p>}
            <div className="flex gap-3 justify-end">
              <button onClick={() => setMerge(null)} disabled={busy}
                className="px-4 py-2 rounded-lg text-slate-400 hover:text-white hover:bg-white/10 text-sm transition-colors disabled:opacity-50">Cancel</button>
              <button onClick={applyMerge} disabled={busy}
                className="px-4 py-2 rounded-lg bg-amber-600 hover:bg-amber-500 text-white text-sm font-semibold transition-colors disabled:opacity-50">
                {busy ? 'Merging…' : 'Merge'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Delete modal */}
      {del && (
        <div className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-4">
          <div className="bg-slate-900 border border-slate-700 rounded-2xl p-6 max-w-lg w-full">
            <h3 className="font-semibold text-white mb-1">Delete {del.keys.length} entr{del.keys.length > 1 ? 'ies' : 'y'}?</h3>
            <p className="text-slate-500 text-xs mb-4">
              {delLibCount > 0 && <>Removes {delLibCount} curated library entr{delLibCount > 1 ? 'ies' : 'y'} from the autocomplete.<br /></>}
              {delItemCount > 0 && <>The selected descriptions are used by <span className="text-slate-300 font-semibold">{delItemCount} quote item{delItemCount > 1 ? 's' : ''}</span>{delSentCount > 0 && <span className="text-red-300"> ({delSentCount} inside SENT quotes)</span>}.</>}
              {delItemCount === 0 && delLibCount === 0 && <>Nothing to delete — these entries only exist as quote items and the checkbox below is off.</>}
            </p>
            {delItemCount > 0 && (
              <label className="flex items-start gap-3 mb-4 cursor-pointer bg-red-500/5 border border-red-500/20 rounded-xl p-3">
                <input type="checkbox" checked={del.deleteQuoteItems}
                  onChange={(e) => setDel({ ...del, deleteQuoteItems: e.target.checked })}
                  className="mt-0.5 accent-red-600" />
                <span>
                  <span className="block text-sm text-red-300 font-medium">Also delete the {delItemCount} quote item{delItemCount > 1 ? 's' : ''} from their quotes</span>
                  <span className="block text-[11px] text-slate-500">Permanently removes the rows (and their sub-items) from the quotes listed — cannot be undone. Leave off to only clean the library.</span>
                </span>
              </label>
            )}
            {error && <p className="text-[11px] text-red-400 mb-3">{error}</p>}
            <div className="flex gap-3 justify-end">
              <button onClick={() => setDel(null)} disabled={busy}
                className="px-4 py-2 rounded-lg text-slate-400 hover:text-white hover:bg-white/10 text-sm transition-colors disabled:opacity-50">Cancel</button>
              <button onClick={applyDelete} disabled={busy || (delLibCount === 0 && !(del.deleteQuoteItems && delItemCount > 0))}
                className="px-4 py-2 rounded-lg bg-red-600 hover:bg-red-500 text-white text-sm font-semibold transition-colors disabled:opacity-50">
                {busy ? 'Deleting…' : 'Delete'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* New-entry modal */}
      {draft && (
        <div className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-4">
          <div className="bg-slate-900 border border-slate-700 rounded-2xl p-6 max-w-lg w-full">
            <h3 className="font-semibold text-white mb-1">New library entry</h3>
            <p className="text-slate-500 text-xs mb-4">
              Prepopulates the editor autocomplete with a house-style description before any quote uses it.
            </p>
            <label className="block text-[10px] uppercase tracking-widest text-slate-500 mb-1">Description</label>
            <input value={draft.description} onChange={(e) => setDraft({ ...draft, description: e.target.value })}
              placeholder="e.g. KMI Kabel NYY 1 x 95 mm²"
              className="w-full px-3 py-2.5 bg-slate-800/80 border border-slate-700 rounded-lg text-white text-sm placeholder-slate-600 focus:outline-none focus:border-violet-500 mb-3" autoFocus />
            <div className="grid grid-cols-2 gap-3 mb-3">
              <div>
                <label className="block text-[10px] uppercase tracking-widest text-slate-500 mb-1">Brand</label>
                <input value={draft.brand} onChange={(e) => setDraft({ ...draft, brand: e.target.value })}
                  className="w-full px-3 py-2.5 bg-slate-800/80 border border-slate-700 rounded-lg text-white text-sm focus:outline-none focus:border-violet-500" />
              </div>
              <div>
                <label className="block text-[10px] uppercase tracking-widest text-slate-500 mb-1">Unit</label>
                <input value={draft.unit} onChange={(e) => setDraft({ ...draft, unit: e.target.value })}
                  className="w-full px-3 py-2.5 bg-slate-800/80 border border-slate-700 rounded-lg text-white text-sm focus:outline-none focus:border-violet-500" />
              </div>
            </div>
            <div className="flex flex-wrap gap-1.5 mb-3 -mt-1">
              {QUOTE_UNITS.map((u) => (
                <button key={u} onClick={() => setDraft({ ...draft, unit: u })}
                  className={`px-2 py-1 rounded-lg text-[10px] border transition-all ${draft.unit === u
                    ? 'bg-violet-500/20 border-violet-500/40 text-violet-300'
                    : 'border-slate-700/60 text-slate-500 hover:text-slate-300'}`}>
                  {u}
                </button>
              ))}
            </div>
            <label className="block text-[10px] uppercase tracking-widest text-slate-500 mb-1">Group</label>
            <div className="flex gap-2 mb-3">
              {SECTION_GROUPS.map((g) => (
                <button key={g.key} onClick={() => setDraft({ ...draft, group_key: g.key, section_title: '' })}
                  className={`px-3 py-1.5 rounded-lg text-xs font-semibold border transition-all ${draft.group_key === g.key
                    ? 'bg-emerald-500/20 border-emerald-500/40 text-emerald-300'
                    : 'border-slate-700 text-slate-400 hover:text-white'}`}>
                  {g.label}
                </button>
              ))}
            </div>
            <label className="block text-[10px] uppercase tracking-widest text-slate-500 mb-1">Sub-section</label>
            <input value={draft.section_title} onChange={(e) => setDraft({ ...draft, section_title: e.target.value })}
              placeholder="Pick below or type your own"
              className="w-full px-3 py-2.5 bg-slate-800/80 border border-slate-700 rounded-lg text-white text-sm placeholder-slate-600 focus:outline-none focus:border-violet-500 mb-1.5" />
            <div className="flex flex-wrap gap-1.5 mb-3">
              {STANDARD_SECTIONS[draft.group_key].map((t) => (
                <button key={t} onClick={() => setDraft({ ...draft, section_title: t })}
                  className={`px-2 py-1 rounded-lg text-[10px] border transition-all ${draft.section_title === t
                    ? 'bg-violet-500/20 border-violet-500/40 text-violet-300'
                    : 'border-slate-700/60 text-slate-500 hover:text-slate-300'}`}>
                  {t}
                </button>
              ))}
            </div>
            <label className="block text-[10px] uppercase tracking-widest text-slate-500 mb-1">Default cost (IDR, optional)</label>
            <input value={draft.cost} onChange={(e) => setDraft({ ...draft, cost: e.target.value })} type="number"
              placeholder="Suggested cost when picked in the editor"
              className="w-full px-3 py-2.5 bg-slate-800/80 border border-slate-700 rounded-lg text-white text-sm placeholder-slate-600 focus:outline-none focus:border-violet-500" />
            {error && <p className="text-[11px] text-red-400 mt-3">{error}</p>}
            <div className="flex gap-3 justify-end mt-5">
              <button onClick={() => setDraft(null)} disabled={busy}
                className="px-4 py-2 rounded-lg text-slate-400 hover:text-white hover:bg-white/10 text-sm transition-colors disabled:opacity-50">Cancel</button>
              <button onClick={applyCreate} disabled={busy}
                className="px-4 py-2 rounded-lg bg-violet-600 hover:bg-violet-500 text-white text-sm font-semibold transition-colors disabled:opacity-50">
                {busy ? 'Adding…' : 'Add entry'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Find & Replace modal (Catalog-style) */}
      {showFr && (
        <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-slate-900 border border-slate-700 rounded-2xl shadow-2xl w-full max-w-md max-h-[90vh] overflow-auto">
            <div className="p-5 border-b border-slate-800 flex justify-between items-center sticky top-0 bg-slate-900/95 backdrop-blur-sm">
              <h2 className="text-lg font-bold text-white">Find &amp; Replace</h2>
              <button onClick={() => setShowFr(false)} className="text-slate-500 hover:text-white transition-colors p-1">
                <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" /></svg>
              </button>
            </div>
            <div className="p-5 space-y-4">
              <div>
                <label className="block text-xs font-semibold text-slate-400 mb-2">Find in descriptions</label>
                <input value={frFind} onChange={(e) => setFrFind(e.target.value)} autoFocus
                  placeholder="Enter text or regex pattern…"
                  className="w-full px-3 py-2 bg-slate-950 border border-slate-700 rounded-lg text-sm text-white focus:border-violet-500 focus:outline-none placeholder-slate-600" />
              </div>
              <div>
                <label className="block text-xs font-semibold text-slate-400 mb-2">Replace with</label>
                <input value={frReplace} onChange={(e) => setFrReplace(e.target.value)}
                  placeholder="Replacement text…"
                  className="w-full px-3 py-2 bg-slate-950 border border-slate-700 rounded-lg text-sm text-white focus:border-violet-500 focus:outline-none placeholder-slate-600" />
              </div>
              <div className="flex gap-4">
                <label className="flex items-center gap-2 text-xs cursor-pointer">
                  <input type="checkbox" checked={frMatchCase} onChange={(e) => setFrMatchCase(e.target.checked)} className="accent-violet-600" />
                  <span className="text-slate-300">Match case</span>
                </label>
                <label className="flex items-center gap-2 text-xs cursor-pointer">
                  <input type="checkbox" checked={frUseRegex} onChange={(e) => setFrUseRegex(e.target.checked)} className="accent-violet-600" />
                  <span className="text-slate-300">Use regex</span>
                </label>
              </div>
              {frFind && (
                <div className="pt-3 border-t border-slate-800">
                  <p className="text-xs font-semibold text-slate-400 mb-2">
                    {frMatches.length} item{frMatches.length !== 1 ? 's' : ''} affected{frMatches.length > 8 ? ' (showing first 8)' : ''}
                  </p>
                  <div className="space-y-1.5 max-h-48 overflow-y-auto">
                    {frMatches.slice(0, 8).map((x) => (
                      <div key={x.u.item_id} className="text-[11px] bg-slate-950/60 rounded-lg px-2.5 py-1.5">
                        <p className="text-red-300/80 line-through truncate">{x.u.raw}</p>
                        <p className="text-emerald-300 truncate">{x.after}</p>
                        <p className="text-slate-600 text-[9px] mt-0.5">{x.u.quote_number} · {x.u.section_title}</p>
                      </div>
                    ))}
                  </div>
                </div>
              )}
              {error && <p className="text-[11px] text-red-400">{error}</p>}
              <div className="flex gap-3 justify-end pt-2">
                <button onClick={() => setShowFr(false)} disabled={busy}
                  className="px-4 py-2 rounded-lg text-slate-400 hover:text-white hover:bg-white/10 text-sm transition-colors disabled:opacity-50">Cancel</button>
                <button onClick={applyReplaceAll} disabled={busy || !frMatches.length}
                  className="px-4 py-2 rounded-lg bg-violet-600 hover:bg-violet-500 text-white text-sm font-semibold transition-colors disabled:opacity-50">
                  {busy ? 'Replacing…' : `Replace all (${frMatches.length})`}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
