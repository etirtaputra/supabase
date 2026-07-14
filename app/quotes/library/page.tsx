'use client';
/**
 * Description Library — Owner-only editor for the project-quote item texts.
 *
 * Every distinct description ever entered in a project quote, with where it
 * was used (quote, date, sub-section), the costs it carried, duplicate /
 * near-duplicate detection, per-entry Rename-everywhere, multi-select Merge,
 * and a global Find & Replace (same UX as the Catalog's Component Editor).
 *
 * The goal: keep the autocomplete library consistent — one spelling per
 * item — without losing context, since history stays keyed by description.
 */
import React, { useState, useEffect, useMemo, useCallback } from 'react';
import Link from 'next/link';
import { createSupabaseClient } from '@/lib/supabase';
import { useQuotesGate } from '@/hooks/useQuotesGate';
import { fmtRp } from '@/lib/formatters';

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
  quantity: number | null;
  cost: number | null;
  sell: number | null;
  isSub: boolean;
  component_id: string | null;
  quote_number: string;
  quote_date: string;
  status: string;
  section_title: string;
  group_key: string;
}

interface Entry {
  key: string;            // trimmed lowercase description
  display: string;        // most recent raw spelling
  variants: string[];     // distinct raw spellings (casing/spacing drift)
  usages: Usage[];
  sections: string[];
  latestCost: number | null;
  minCost: number | null;
  maxCost: number | null;
  linked: string[];       // distinct linked catalog models
  linkMismatch: boolean;  // a linked model not contained in the description
  dupSimilar: string[];   // display names of near-duplicate entries
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

export default function DescriptionLibraryPage() {
  const supabase = createSupabaseClient();
  const gate = useQuotesGate();
  const isOwner = gate.profile?.role === 'owner';

  const [loading, setLoading] = useState(true);
  const [usagesAll, setUsagesAll] = useState<Usage[]>([]);
  const [busy, setBusy] = useState(false);
  const [flash, setFlash] = useState('');
  const [error, setError] = useState('');

  useEffect(() => { document.title = 'Description Library | ICAPROC'; }, []);

  const load = useCallback(async () => {
    setLoading(true);
    const [itemsRes, secRes, quotesRes, compRes] = await Promise.all([
      supabase.from('10.2_quote_items')
        .select('item_id, quote_id, section_id, parent_item_id, component_id, description, brand, unit, quantity, cost_price, sell_price'),
      supabase.from('10.1_quote_sections').select('section_id, title, group_key'),
      supabase.from('10.0_project_quotes').select('quote_id, quote_number, quote_date, status'),
      supabase.from('3.0_components').select('component_id, supplier_model'),
    ]);
    const secMap = new Map((secRes.data ?? []).map((s) => [s.section_id as string, s]));
    const qMap = new Map((quotesRes.data ?? []).map((q) => [q.quote_id as string, q]));
    const compMap = new Map((compRes.data ?? []).map((c) => [c.component_id as string, String(c.supplier_model ?? '')]));

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
        quantity: it.quantity != null ? Number(it.quantity) : null,
        cost: it.cost_price != null ? Number(it.cost_price) : null,
        sell: it.sell_price != null ? Number(it.sell_price) : null,
        isSub: !!it.parent_item_id,
        component_id: (it.component_id as string | null) ?? null,
        quote_number: String(q?.quote_number ?? '—'),
        quote_date: String(q?.quote_date ?? ''),
        status: String(q?.status ?? 'draft'),
        section_title: String(sec?.title ?? '—'),
        group_key: String(sec?.group_key ?? ''),
      });
    }
    // stash the component names on the usages via a side map for entry building
    setCompNames(compMap);
    setUsagesAll(out);
    setLoading(false);
  }, []);

  const [compNames, setCompNames] = useState<Map<string, string>>(new Map());

  useEffect(() => { if (gate.ready && isOwner) load(); }, [gate.ready, isOwner, load]);

  // ── Build entries ────────────────────────────────────────────────────────────
  const entries = useMemo(() => {
    const byKey = new Map<string, Usage[]>();
    for (const u of usagesAll) {
      const key = u.raw.toLowerCase();
      byKey.set(key, [...(byKey.get(key) ?? []), u]);
    }
    const list: Entry[] = [];
    for (const [key, usages] of byKey) {
      usages.sort((a, b) => b.quote_date.localeCompare(a.quote_date));
      const variants = [...new Set(usages.map((u) => u.raw))];
      const costs = usages.map((u) => u.cost).filter((c): c is number => c != null && c > 0);
      const linked = [...new Set(usages.map((u) => u.component_id && compNames.get(u.component_id)).filter(Boolean))] as string[];
      list.push({
        key,
        display: usages[0].raw,
        variants,
        usages,
        sections: [...new Set(usages.map((u) => u.section_title).filter((t) => t !== '—'))],
        latestCost: usages.find((u) => u.cost != null && u.cost > 0)?.cost ?? null,
        minCost: costs.length ? Math.min(...costs) : null,
        maxCost: costs.length ? Math.max(...costs) : null,
        linked,
        linkMismatch: linked.some((m) => !key.includes(m.toLowerCase())),
        dupSimilar: [],
      });
    }
    // Near-duplicate pass: same normalized text, or high token overlap
    const toks = list.map((e) => tokenSet(e.key));
    const norms = list.map((e) => norm(e.key));
    for (let i = 0; i < list.length; i++) {
      for (let j = i + 1; j < list.length; j++) {
        const isDup = norms[i] === norms[j] || similarity(toks[i], toks[j]) >= 0.75;
        if (isDup) {
          list[i].dupSimilar.push(list[j].display);
          list[j].dupSimilar.push(list[i].display);
        }
      }
    }
    return list.sort((a, b) => {
      const fa = a.dupSimilar.length > 0 || a.variants.length > 1 ? 0 : 1;
      const fb = b.dupSimilar.length > 0 || b.variants.length > 1 ? 0 : 1;
      return fa - fb || a.display.localeCompare(b.display);
    });
  }, [usagesAll, compNames]);

  // ── Filters / search / selection / expansion ────────────────────────────────
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState<'all' | 'dups' | 'linked' | 'free'>('all');
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

  function toggle(set: Set<string>, key: string): Set<string> {
    const next = new Set(set);
    if (next.has(key)) next.delete(key); else next.add(key);
    return next;
  }

  // ── Rename everywhere ────────────────────────────────────────────────────────
  const [rename, setRename] = useState<{ entry: Entry; text: string; brand: string } | null>(null);

  async function applyRename() {
    if (!rename) return;
    const newDesc = rename.text.trim();
    if (newDesc.length < 3) { setError('Description too short'); return; }
    setBusy(true); setError('');
    const patch: Record<string, string> = { description: newDesc };
    if (rename.brand.trim()) patch.brand = rename.brand.trim();
    const { error: e } = await supabase.from('10.2_quote_items')
      .update(patch).ilike('description', escLike(rename.entry.display));
    // catch spelling variants that differ from the display spelling
    for (const v of rename.entry.variants) {
      if (v === rename.entry.display) continue;
      await supabase.from('10.2_quote_items').update(patch).ilike('description', escLike(v));
    }
    setBusy(false);
    if (e) { setError(e.message); return; }
    setFlash(`Renamed ${rename.entry.usages.length} item${rename.entry.usages.length > 1 ? 's' : ''} to “${newDesc}”`);
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
      }
      count += src.usages.length;
    }
    setBusy(false);
    setFlash(`Merged ${count} item${count > 1 ? 's' : ''} into “${target.display}” — their cost history now shares one entry`);
    setMerge(null);
    setSelected(new Set());
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
        <Link href="/quotes" className="text-violet-400 hover:text-violet-300 underline">Back to quotes</Link>
      </div>
    );
  }

  const selectedEntries = entries.filter((e) => selected.has(e.key));

  return (
    <div className="min-h-screen bg-[#141518] text-slate-200 font-sans text-sm">
      {/* Header */}
      <div className="sticky top-0 z-40 bg-[#141518]/90 backdrop-blur-xl border-b border-white/[0.07]">
        <div className="max-w-6xl mx-auto px-6 py-4 flex items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <Link href="/quotes" className="text-slate-500 hover:text-slate-300 transition-colors">
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M15 19l-7-7 7-7" /></svg>
            </Link>
            <div>
              <h1 className="text-xl font-bold text-white tracking-tight">Description Library</h1>
              <p className="text-slate-500 text-[11px] mt-0.5">Every item text used in project quotes — keep one spelling per item</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            {selected.size >= 2 && (
              <button
                onClick={() => setMerge({ keys: [...selected], canonical: [...selected][0] })}
                className="px-3 py-2 rounded-xl bg-amber-600 hover:bg-amber-500 text-white text-xs font-semibold transition-colors"
              >
                Merge {selected.size} selected
              </button>
            )}
            <button
              onClick={() => setShowFr(true)}
              className="flex items-center gap-1.5 px-3 py-2 rounded-xl border border-white/[0.08] text-slate-300 hover:text-white hover:bg-white/10 text-xs font-semibold transition-all"
            >
              <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2"><path strokeLinecap="round" strokeLinejoin="round" d="M7 16V4m0 0L3 8m4-4l4 4m6 0v12m0 0l4-4m-4 4l-4-4" /></svg>
              Replace
            </button>
          </div>
        </div>
      </div>

      <main className="max-w-6xl mx-auto px-6 py-6 space-y-4">
        {flash && (
          <div className="bg-emerald-500/10 border border-emerald-500/30 rounded-2xl px-4 py-3 text-sm text-emerald-300 flex items-center justify-between">
            {flash}
            <button onClick={() => setFlash('')} className="text-emerald-400/60 hover:text-emerald-200 ml-3">✕</button>
          </div>
        )}
        {error && (
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
            { k: 'all',    label: `All (${entries.length})` },
            { k: 'dups',   label: `Duplicates (${dupCount})` },
            { k: 'linked', label: 'Catalog-linked' },
            { k: 'free',   label: 'Free text' },
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
          <div className="space-y-1.5">
            {visible.map((e) => (
              <div key={e.key} className="bg-slate-900/50 border border-slate-800 hover:border-slate-700 rounded-2xl transition-colors">
                <div className="flex items-center gap-3 px-4 py-3">
                  <input type="checkbox" checked={selected.has(e.key)}
                    onChange={() => setSelected((s) => toggle(s, e.key))}
                    className="accent-violet-600 flex-shrink-0" />
                  <button onClick={() => setExpanded((s) => toggle(s, e.key))} className="flex-1 min-w-0 text-left">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-medium text-slate-100 truncate">{e.display}</span>
                      <span className="text-[10px] text-slate-600">×{e.usages.length}</span>
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
                      <span className="truncate">{e.sections.join(' · ') || 'no section'}</span>
                      <span className="flex-shrink-0">{[...new Set(e.usages.map((u) => u.quote_number))].length} quote{[...new Set(e.usages.map((u) => u.quote_number))].length > 1 ? 's' : ''}</span>
                    </div>
                  </button>
                  <div className="text-right flex-shrink-0 tabular-nums">
                    {e.latestCost != null ? (
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
                    onClick={() => { setError(''); setRename({ entry: e, text: e.display, brand: '' }); }}
                    className="p-2 rounded-lg hover:bg-white/10 text-slate-500 hover:text-white transition-colors flex-shrink-0"
                    title="Rename everywhere — updates every quote item carrying this description"
                  >
                    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" /></svg>
                  </button>
                </div>
                {expanded.has(e.key) && (
                  <div className="border-t border-slate-800 px-4 py-3 overflow-x-auto">
                    <table className="w-full text-xs">
                      <thead>
                        <tr className="text-left text-[10px] uppercase tracking-wider text-slate-600">
                          <th className="py-1 pr-4">Quote</th>
                          <th className="py-1 pr-4">Date</th>
                          <th className="py-1 pr-4">Status</th>
                          <th className="py-1 pr-4">Section</th>
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
                            <td className={`py-1.5 pr-4 ${u.raw !== e.display ? 'text-red-300' : 'text-slate-500'}`}>{u.raw !== e.display ? u.raw : '〃'}</td>
                            <td className="py-1.5 pr-4 text-right tabular-nums text-slate-300">{u.cost != null && u.cost > 0 ? fmtRp(u.cost) : '—'}</td>
                            <td className="py-1.5 text-right tabular-nums text-slate-400">{u.sell != null && u.sell > 0 ? fmtRp(u.sell) : '—'}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </main>

      {/* Rename modal */}
      {rename && (
        <div className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-4">
          <div className="bg-slate-900 border border-slate-700 rounded-2xl p-6 max-w-lg w-full">
            <h3 className="font-semibold text-white mb-1">Rename everywhere</h3>
            <p className="text-slate-500 text-xs mb-4">
              Updates all {rename.entry.usages.length} item{rename.entry.usages.length > 1 ? 's' : ''} carrying this text
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
              className="w-full px-3 py-2.5 bg-slate-800/80 border border-slate-700 rounded-lg text-white text-sm placeholder-slate-600 focus:outline-none focus:border-violet-500" />
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
                      <span className="block text-[10px] text-slate-500">×{e.usages.length} · {e.sections.join(', ') || 'no section'}{e.latestCost != null ? ` · latest ${fmtRp(e.latestCost)}` : ''}</span>
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
