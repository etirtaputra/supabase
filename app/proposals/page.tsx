'use client';
import React, { useState, useEffect, useCallback, useMemo } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { createSupabaseClient } from '@/lib/supabase';
import { useSupabaseData } from '@/hooks/useSupabaseData';
import { useQuotesGate } from '@/hooks/useQuotesGate';
import { computeTUCMap, getComponentCost, type TUCResult, type CostEntry } from '@/lib/computeTUC';
import { fetchUsedEntries } from '@/lib/usedPrices';
import { roundNice } from '@/lib/rounding';
import { lineWp } from '@/lib/quoteWp';
import { fmtRp } from '@/lib/formatters';
import MigrationBanner from '@/components/ui/MigrationBanner';
import BrandMenu from '@/components/ui/BrandMenu';
import MobileNotice from '@/components/ui/MobileNotice';
import { PROJECT_TYPES } from '@/lib/projectSpec';
import { SECTION_GROUPS, STANDARD_SECTIONS, type ProjectQuote } from '@/types/quotes';
import { useEpcLobby, type LobbyPeer } from '@/hooks/useEpcLobby';
import { initials, firstName } from '@/lib/presence';

const STATUS_STYLES: Record<string, string> = {
  draft:    'bg-slate-700/60 text-slate-300',
  sent:     'bg-blue-500/20 text-blue-300',
  accepted: 'bg-emerald-500/20 text-emerald-300',
  rejected: 'bg-red-500/20 text-red-400',
};

// The list is split into these sections, in this order; empty ones are hidden.
const STATUS_SECTIONS: { key: string; label: string; accent: string; rule: string }[] = [
  { key: 'draft',    label: 'Drafts',   accent: 'text-slate-300',   rule: 'bg-slate-500/20' },
  { key: 'sent',     label: 'Sent',     accent: 'text-blue-300',    rule: 'bg-blue-500/20' },
  { key: 'accepted', label: 'Accepted', accent: 'text-emerald-300', rule: 'bg-emerald-500/20' },
  { key: 'rejected', label: 'Rejected', accent: 'text-red-400',     rule: 'bg-red-500/20' },
];

function fmtDate(d: string) {
  if (!d) return '—';
  return new Date(d).toLocaleDateString('id-ID', { day: '2-digit', month: 'short', year: 'numeric' });
}

// Date + time (local tz, WIB for the team) for "last edited" — the list needs
// the time of day, not just the day, to tell same-day edits apart.
function fmtDateTime(d?: string | null) {
  if (!d) return '—';
  const dt = new Date(d);
  if (isNaN(dt.getTime())) return '—';
  return dt.toLocaleString('id-ID', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}

export default function QuotesListPage() {
  const supabase = createSupabaseClient();
  const router = useRouter();
  const gate = useQuotesGate();
  const { data: catalog, loading: catalogLoading } = useSupabaseData();
  const [quotes, setQuotes] = useState<ProjectQuote[]>([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [filterType, setFilterType] = useState('');   // '' = all project types

  // Live presence: who else is in the EPC area and on which proposal. This page
  // reports itself as "browsing" (no proposalId); editors report their proposal.
  const { peersByProposal, online, onlineCount } = useEpcLobby({
    email: gate.profile?.email,
    name: gate.profile?.display_name || gate.profile?.email,
  });

  // Set-password modal (for accounts created via magic link)
  const [pwOpen, setPwOpen] = useState(false);
  const [pw1, setPw1] = useState('');
  const [pw2, setPw2] = useState('');
  const [pwBusy, setPwBusy] = useState(false);
  const [pwMsg, setPwMsg] = useState('');

  async function savePassword() {
    if (pw1.length < 8) { setPwMsg('Use at least 8 characters'); return; }
    if (pw1 !== pw2) { setPwMsg('Passwords do not match'); return; }
    setPwBusy(true);
    const { error } = await supabase.auth.updateUser({ password: pw1 });
    setPwBusy(false);
    if (error) { setPwMsg(error.message); return; }
    setPwMsg('');
    setPwOpen(false);
  }

  // Duplicate modal state
  const [dup, setDup] = useState<{ id: string; number: string } | null>(null);
  const [dupToday, setDupToday] = useState(true);
  const [dupRefresh, setDupRefresh] = useState(false);
  const [dupInternal, setDupInternal] = useState(true);
  const [dupBusy, setDupBusy] = useState(false);
  const [dupError, setDupError] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    const { data } = await supabase
      .from('10.0_project_quotes')
      .select('*')
      .order('created_at', { ascending: false });
    setQuotes((data as ProjectQuote[]) ?? []);
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  // ── Line items + sections for all quotes ────────────────────────────────────
  // One fetch feeds both the per-quote totals (grand total / price per Wp)
  // and the cost-drift detection below.
  interface ListItem {
    quote_id: string; section_id: string; parent_item_id: string | null;
    component_id: string | null; description: string | null; unit: string | null;
    quantity: number | null; cost_price: number | null; sell_price: number | null;
  }
  const [allItems, setAllItems] = useState<ListItem[] | null>(null);
  const [sectionGroups, setSectionGroups] = useState<Map<string, string> | null>(null);
  const [usedEntries, setUsedEntries] = useState<Map<string, CostEntry[]> | null>(null);

  useEffect(() => {
    fetchUsedEntries(supabase).then(setUsedEntries).catch(() => setUsedEntries(new Map()));
  }, []);

  useEffect(() => {
    if (!quotes.length) { setAllItems([]); setSectionGroups(new Map()); return; }
    supabase.from('10.2_quote_items')
      .select('quote_id, section_id, parent_item_id, component_id, description, unit, quantity, cost_price, sell_price')
      .then(({ data }) => setAllItems((data as ListItem[]) ?? []));
    supabase.from('10.1_quote_sections')
      .select('section_id, group_key')
      .then(({ data }) => setSectionGroups(new Map((data ?? []).map((s) => [s.section_id as string, (s.group_key as string) ?? 'bos']))));
  }, [quotes]);

  // Totals per quote: subtotal excl. PPN + system Wp (Solar Panels group only,
  // same lib/quoteWp.ts rules as the editor)
  const totalsByQuote = useMemo(() => {
    const map = new Map<string, { subtotal: number; wp: number }>();
    if (!allItems || !sectionGroups) return map;
    for (const it of allItems) {
      if (it.parent_item_id) continue;
      const qty = Number(it.quantity) || 0;
      const t = map.get(it.quote_id) ?? { subtotal: 0, wp: 0 };
      t.subtotal += qty * (Number(it.sell_price) || 0);
      if (sectionGroups.get(it.section_id) === 'solar_panels') {
        t.wp += lineWp(catalog.components, {
          component_id: it.component_id, description: it.description ?? '',
          unit: it.unit ?? '', quantity: qty,
        });
      }
      map.set(it.quote_id, t);
    }
    return map;
  }, [allItems, sectionGroups, catalog.components]);

  // ── Cost-drift detection on open (draft/sent) quotes ────────────────────────
  // Compares each catalog-linked item's stored cost against today's
  // recommendation from the shared cost engine; >10% difference flags the quote.
  const DRIFT_THRESHOLD = 0.10;
  const openItems = useMemo(() => {
    if (!allItems) return null;
    const openIds = new Set(quotes.filter((q) => q.status === 'draft' || q.status === 'sent').map((q) => q.quote_id));
    return allItems.filter((it) => openIds.has(it.quote_id) && it.component_id);
  }, [allItems, quotes]);

  const listTucMap = useMemo(
    () => computeTUCMap(catalog.pos, catalog.poItems, catalog.poCosts),
    [catalog.pos, catalog.poItems, catalog.poCosts],
  );

  // Per-item Cost Basis settings for Project Quotes (mode + buffer; global default 5%)
  const [globalBufferPct, setGlobalBufferPct] = useState(5);
  useEffect(() => {
    supabase.from('app_settings').select('value').eq('key', 'quote_cost_buffer_pct').maybeSingle()
      .then(({ data }) => { const v = Number(data?.value); if (!isNaN(v)) setGlobalBufferPct(v); });
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const costOptsFor = useMemo(() => {
    const byId = new Map(catalog.components.map((c) => [c.component_id, c]));
    return (componentId: string) => {
      const c = byId.get(componentId);
      const mode = (c?.quote_cost_mode ?? (c?.show_tuc_in_quotes === false ? 'hidden' : 'buffered'));
      return { mode, bufferPct: c?.quote_cost_buffer_pct ?? globalBufferPct };
    };
  }, [catalog.components, globalBufferPct]);

  const driftByQuote = useMemo(() => {
    const map = new Map<string, number>();
    if (!openItems || !usedEntries || catalogLoading) return map;
    for (const it of openItems) {
      if (!it.component_id || it.parent_item_id) continue;
      const stored = Number(it.cost_price);
      if (!(stored > 0)) continue;
      const cc = getComponentCost(it.component_id, listTucMap, catalog.quotes, catalog.quoteItems, usedEntries.get(it.component_id) ?? [], costOptsFor(it.component_id));
      if (!cc || !(cc.cost > 0)) continue;
      // Flag only cost increases — margin risk; price drops are fine
      if ((cc.cost - stored) / stored > DRIFT_THRESHOLD) {
        map.set(it.quote_id, (map.get(it.quote_id) ?? 0) + 1);
      }
    }
    return map;
  }, [openItems, usedEntries, catalogLoading, listTucMap, catalog.quotes, catalog.quoteItems, costOptsFor]);

  const searchLc = search.trim().toLowerCase();

  // Item-description search: which line items in each quote match the query,
  // so you can find "every proposal that uses a JINKO panel" or any keyword.
  const itemMatchByQuote = useMemo(() => {
    const m = new Map<string, string[]>();
    if (!searchLc || !allItems) return m;
    for (const it of allItems) {
      const d = (it.description ?? '').trim();
      if (!d || !d.toLowerCase().includes(searchLc)) continue;
      const arr = m.get(it.quote_id) ?? [];
      if (!arr.some((x) => x.toLowerCase() === d.toLowerCase())) arr.push(d);
      m.set(it.quote_id, arr);
    }
    return m;
  }, [allItems, searchLc]);

  // Search (number / customer / description / location / ITEMS) + type filter.
  // Applied before the status grouping so each section shows only matches.
  const visibleQuotes = useMemo(() => {
    return quotes.filter((q) => {
      if (filterType && (q.project_type || 'custom') !== filterType) return false;
      if (!searchLc) return true;
      const headerHit = [q.quote_number, q.customer_name, q.project_description, q.location,
        PROJECT_TYPES.find((t) => t.key === q.project_type)?.label]
        .filter(Boolean).join(' ').toLowerCase().includes(searchLc);
      return headerHit || itemMatchByQuote.has(q.quote_id);
    });
  }, [quotes, searchLc, filterType, itemMatchByQuote]);

  // Project types actually present, so the dropdown never offers empty options
  const availableTypes = useMemo(() => {
    const present = new Set(quotes.map((q) => q.project_type || 'custom'));
    return PROJECT_TYPES.filter((t) => present.has(t.key));
  }, [quotes]);

  const [createError, setCreateError] = useState('');

  async function createNew() {
    setCreating(true);
    setCreateError('');
    const today = new Date().toISOString().slice(0, 10);
    const num = `Q-${today.replace(/-/g, '')}-${Math.random().toString(36).slice(2, 6).toUpperCase()}`;
    const { data, error } = await supabase
      .from('10.0_project_quotes')
      .insert({ quote_number: num, quote_date: today })
      .select('quote_id')
      .single();
    if (!error && data) {
      // Seed the house-style sub-sections (delete the unneeded ones in the
      // editor; empty sections never appear on client exports anyway). A
      // failure here is non-fatal — the quote just starts without sections.
      const seed = SECTION_GROUPS
        .flatMap((g) => STANDARD_SECTIONS[g.key].map((title) => ({ group_key: g.key, title })))
        .map((s, i) => ({ quote_id: data.quote_id, ...s, lead_time: 'Ready', sort_order: i }));
      await supabase.from('10.1_quote_sections').insert(seed);
      router.push(`/proposals/${data.quote_id}`);
    } else {
      // Surface the real reason (e.g. an RLS policy rejecting the insert)
      setCreateError(error?.message || 'Could not create the quote');
      setCreating(false);
    }
  }

  async function confirmDelete(id: string) {
    await supabase.from('10.0_project_quotes').delete().eq('quote_id', id);
    setDeleteId(null);
    load();
  }

  async function duplicateQuote() {
    if (!dup) return;
    setDupBusy(true);
    setDupError('');
    try {
      const [qRes, secRes, itemRes] = await Promise.all([
        supabase.from('10.0_project_quotes').select('*').eq('quote_id', dup.id).single(),
        supabase.from('10.1_quote_sections').select('*').eq('quote_id', dup.id).order('sort_order'),
        supabase.from('10.2_quote_items').select('*').eq('quote_id', dup.id).order('sort_order'),
      ]);
      const src = qRes.data;
      if (!src) throw new Error('Source quote not found');

      const usedMap = dupRefresh ? await fetchUsedEntries(supabase) : null;
      const dupTucMap: Map<string, TUCResult> = dupRefresh
        ? computeTUCMap(catalog.pos, catalog.poItems, catalog.poCosts)
        : new Map();
      const today = new Date().toISOString().slice(0, 10);
      const newQuoteId = crypto.randomUUID();

      // 1. Quote header — always restarts as a draft. Optional columns are
      //    only written when the source row actually has them, so duplication
      //    keeps working on databases that haven't run the latest migration.
      const newQuote: Record<string, unknown> = {
        quote_id: newQuoteId,
        quote_number: `${src.quote_number || 'Q'}-REV`,
        quote_date: dupToday ? today : src.quote_date,
        customer_name: src.customer_name,
        customer_address: src.customer_address,
        project_description: src.project_description,
        ppn_pct: src.ppn_pct,
        status: 'draft',
        notes: src.notes,
      };
      if ('company_id' in src) newQuote.company_id = src.company_id ?? null;
      if ('group_margins' in src) newQuote.group_margins = src.group_margins ?? {};
      if ('project_type' in src) newQuote.project_type = src.project_type ?? 'custom';
      if ('system_specs' in src) newQuote.system_specs = src.system_specs ?? {};
      if ('location' in src) newQuote.location = src.location ?? '';
      const { error: qErr } = await supabase.from('10.0_project_quotes').insert(newQuote);
      if (qErr) throw qErr;

      // 2. Sections with fresh ids
      const secIdMap = new Map<string, string>();
      const newSecs = (secRes.data ?? []).map((s) => {
        const nid = crypto.randomUUID();
        secIdMap.set(s.section_id, nid);
        const row: Record<string, unknown> = {
          section_id: nid, quote_id: newQuoteId,
          title: s.title, lead_time: s.lead_time, sort_order: s.sort_order,
        };
        if ('group_key' in s) row.group_key = s.group_key ?? 'bos';
        return row;
      });
      if (newSecs.length) {
        const { error } = await supabase.from('10.1_quote_sections').insert(newSecs);
        if (error) throw error;
      }

      // 3. Items — parents before subs so the self-referencing FK is satisfied
      //    within the batch insert; optionally re-cost keeping each item's GM%.
      const srcItems = [...(itemRes.data ?? [])].sort((a, b) =>
        Number(!!a.parent_item_id) - Number(!!b.parent_item_id));
      const itemIdMap = new Map<string, string>();
      for (const it of srcItems) itemIdMap.set(it.item_id, crypto.randomUUID());
      const newItems = srcItems.map((it) => {
        let cost = it.cost_price, sell = it.sell_price;
        if (dupRefresh && it.component_id) {
          const cc = getComponentCost(it.component_id, dupTucMap, catalog.quotes, catalog.quoteItems, usedMap?.get(it.component_id) ?? [], costOptsFor(it.component_id));
          if (cc) {
            const newCost = Math.round(cc.cost);
            const oldCost = Number(it.cost_price), oldSell = Number(it.sell_price);
            if (oldCost > 0 && oldSell > 0) {
              const gmFrac = 1 - oldCost / oldSell;
              if (gmFrac < 1) sell = roundNice(newCost / (1 - gmFrac));
            }
            cost = newCost;
          }
        }
        const row: Record<string, unknown> = {
          item_id: itemIdMap.get(it.item_id)!,
          section_id: secIdMap.get(it.section_id)!,
          quote_id: newQuoteId,
          parent_item_id: it.parent_item_id ? (itemIdMap.get(it.parent_item_id) ?? null) : null,
          component_id: it.component_id,
          description: it.description, brand: it.brand,
          quantity: it.quantity, unit: it.unit,
          cost_price: cost, sell_price: sell,
          sort_order: it.sort_order,
        };
        if ('qty_formula' in it) row.qty_formula = dupInternal ? (it.qty_formula ?? '') : '';
        if ('eng_note' in it) row.eng_note = dupInternal ? (it.eng_note ?? '') : '';
        return row;
      });
      if (newItems.length) {
        const { error } = await supabase.from('10.2_quote_items').insert(newItems);
        if (error) throw error;
      }

      router.push(`/proposals/${newQuoteId}`);
    } catch (e) {
      // Supabase errors are plain objects, not Error instances — read .message either way
      const msg = (e as { message?: string })?.message;
      setDupError(msg || 'Duplication failed');
      setDupBusy(false);
    }
  }

  if (!gate.ready) {
    return (
      <div className="min-h-screen bg-[#141518] flex items-center justify-center">
        <div className="w-6 h-6 border-2 border-violet-500/30 border-t-violet-500 rounded-full animate-spin" />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#141518] text-slate-200 font-sans text-sm">
      {/* Header */}
      <div className="sticky top-0 z-40 bg-[#141518]/90 backdrop-blur-xl border-b border-white/[0.07]">
        <div className="max-w-6xl 2xl:max-w-[1760px] mx-auto px-3 sm:px-6 py-4 flex items-center justify-between gap-3">
          <BrandMenu wordmarkClass="text-xl font-bold" subtitle="EPC Proposals" />
          <div className="flex items-center gap-2 sm:gap-4 flex-shrink-0">
            {onlineCount > 1 && <OnlineIndicator online={online} count={onlineCount} />}
            {gate.profile?.role === 'owner' && (
              <Link
                href="/proposals/library"
                className="hidden sm:inline-block px-3 py-1.5 rounded-xl border border-white/[0.08] text-slate-400 hover:text-white hover:bg-white/10 text-xs font-semibold transition-all"
                title="Description Library — review, dedupe and rename quote item texts (Owners only)"
              >
                Library
              </Link>
            )}
            {gate.profile && (
              <div className="text-right hidden sm:block">
                <p className="text-[11px] text-slate-400 leading-tight">{gate.profile.email}</p>
                <div className="flex items-center gap-2 justify-end">
                  <button onClick={() => { setPwOpen(true); setPw1(''); setPw2(''); setPwMsg(''); }} className="text-[10px] text-slate-600 hover:text-slate-300 underline transition-colors">
                    Set password
                  </button>
                  <button onClick={() => gate.signOut()} className="text-[10px] text-slate-600 hover:text-slate-300 underline transition-colors">
                    Sign out
                  </button>
                </div>
              </div>
            )}
          <button
            onClick={createNew}
            disabled={creating}
            title="New Proposal"
            className="flex items-center gap-2 px-3 sm:px-4 py-2 rounded-xl bg-violet-600 hover:bg-violet-500 text-white text-sm font-semibold transition-colors disabled:opacity-50 flex-shrink-0"
          >
            {creating ? (
              <svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" /></svg>
            ) : (
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 4v16m8-8H4" /></svg>
            )}
            <span className="hidden sm:inline">New Proposal</span>
          </button>
          </div>
        </div>
      </div>

      <main className="max-w-6xl 2xl:max-w-[1760px] mx-auto px-3 sm:px-6 py-6 sm:py-8 space-y-6">
        <MobileNotice variant="edit" />
        <MigrationBanner />
        {createError && (
          <div className="bg-red-500/10 border border-red-500/40 rounded-2xl px-4 py-3 text-sm text-red-300">
            Creating the quote failed: <span className="font-medium">{createError}</span>
            {/insufficient|policy|denied|row-level/i.test(createError) && (
              <span className="text-red-200/70"> — this looks like a database permission rule; ask an Owner to apply the latest can_edit_quote fix.</span>
            )}
          </div>
        )}
        {/* Search + project-type filter */}
        {!loading && quotes.length > 0 && (
          <div className="flex flex-col sm:flex-row gap-2">
            <div className="relative flex-1">
              <svg className="w-4 h-4 text-slate-500 absolute left-3.5 top-1/2 -translate-y-1/2" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M21 21l-4.35-4.35M17 11a6 6 0 11-12 0 6 6 0 0112 0z" /></svg>
              <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search number, customer, item / keyword, location…"
                className="w-full pl-10 pr-4 h-11 rounded-xl bg-slate-900/80 border border-slate-700/80 focus:border-violet-500/60 outline-none text-white text-base sm:text-sm placeholder:text-[13px] sm:placeholder:text-sm placeholder:text-slate-500 transition-colors" />
            </div>
            <select value={filterType} onChange={(e) => setFilterType(e.target.value)}
              className="h-11 px-3 rounded-xl bg-slate-900/80 border border-slate-700/80 focus:border-violet-500/60 outline-none text-slate-300 text-xs">
              <option value="">All project types</option>
              {availableTypes.map((t) => <option key={t.key} value={t.key}>{t.label}</option>)}
            </select>
          </div>
        )}
        {loading ? (
          <div className="flex items-center justify-center h-64 text-slate-500">Loading…</div>
        ) : quotes.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-64 text-slate-500 gap-4">
            <svg className="w-12 h-12 text-slate-700" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.5" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" /></svg>
            <p className="text-slate-400 font-medium">No quotes yet</p>
            <button onClick={createNew} className="px-4 py-2 rounded-xl bg-violet-600 hover:bg-violet-500 text-white text-sm font-semibold transition-colors">
              Create your first quote
            </button>
          </div>
        ) : visibleQuotes.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-40 text-slate-500 gap-2">
            <p className="text-slate-400 font-medium">No proposals match your search</p>
            <button onClick={() => { setSearch(''); setFilterType(''); }} className="text-xs text-violet-400 hover:text-violet-300 transition-colors">Clear filters</button>
          </div>
        ) : (
          <div className="space-y-7">
            {STATUS_SECTIONS.map(({ key, label, accent, rule }) => {
              const groupQuotes = visibleQuotes.filter((q) => q.status === key);
              if (!groupQuotes.length) return null;
              return (
              <div key={key}>
                <div className="flex items-center gap-3 mb-2.5 px-1">
                  <h2 className={`text-xs font-bold uppercase tracking-widest ${accent}`}>{label}</h2>
                  <span className="text-[11px] text-slate-600 tabular-nums">{groupQuotes.length}</span>
                  <div className={`flex-1 h-px ${rule}`} />
                </div>
                <div className="space-y-2">
                  {groupQuotes.map((q) => {
                    const t = totalsByQuote.get(q.quote_id);
                    const livePeers = peersByProposal.get(q.quote_id) ?? [];
                    const someoneEditing = livePeers.some((p) => p.editing);
                    return (
                    <div key={q.quote_id} className={`group flex items-center gap-3 sm:gap-4 bg-slate-900/50 hover:bg-slate-900/80 border rounded-2xl px-4 sm:px-5 py-4 transition-all ${someoneEditing ? 'border-amber-500/40' : livePeers.length ? 'border-emerald-500/30' : 'border-slate-800 hover:border-slate-700'}`}>
                <Link href={`/proposals/${q.quote_id}`} className="flex-1 min-w-0">
                  {/* Primary focus: the customer + status/type */}
                  <div className="flex flex-wrap items-center gap-2 mb-0.5">
                    <span className="font-semibold text-white text-base truncate max-w-full">{q.customer_name || 'No customer'}</span>
                    <span className={`px-2 py-0.5 rounded-full text-[10px] font-semibold uppercase tracking-wider whitespace-nowrap flex-shrink-0 ${STATUS_STYLES[q.status] ?? STATUS_STYLES.draft}`}>
                      {q.status}
                    </span>
                    {q.project_type && q.project_type !== 'custom' && (
                      <span className="px-2 py-0.5 rounded-full text-[10px] font-semibold whitespace-nowrap flex-shrink-0 bg-sky-500/15 text-sky-300">
                        {PROJECT_TYPES.find((t) => t.key === q.project_type)?.label ?? q.project_type}
                      </span>
                    )}
                    {driftByQuote.has(q.quote_id) && (
                      <span
                        className="px-2 py-0.5 rounded-full text-[10px] font-semibold whitespace-nowrap flex-shrink-0 bg-amber-500/15 text-amber-300"
                        title={`${driftByQuote.get(q.quote_id)} item${driftByQuote.get(q.quote_id)! > 1 ? 's' : ''} priced >10% away from today's cost — open and press Costs to refresh`}
                      >
                        ⚠ {driftByQuote.get(q.quote_id)} outdated cost{driftByQuote.get(q.quote_id)! > 1 ? 's' : ''}
                      </span>
                    )}
                  </div>
                  {/* Project name / scope */}
                  {q.project_description && (
                    <p className="text-xs text-slate-400 truncate max-w-full mb-1.5">{q.project_description}</p>
                  )}
                  {/* Price */}
                  {t && t.subtotal > 0 && (
                    <div className="flex flex-wrap items-baseline gap-x-3 gap-y-0.5 mb-1.5 tabular-nums">
                      <span className="text-[15px] font-bold text-slate-100">
                        {fmtRp(t.subtotal)}
                        <span className="ml-1.5 text-[10px] font-normal text-slate-500">excl. PPN</span>
                      </span>
                      {t.wp > 0 && (
                        <span className="text-[11px] text-amber-300/90" title={`System size ${t.wp.toLocaleString('en-US')} Wp — price per Wp excl. PPN`}>
                          {fmtRp(t.subtotal / t.wp)}/Wp
                        </span>
                      )}
                    </div>
                  )}
                  {/* Reference line: quote number, dates, editor */}
                  <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-slate-500">
                    <span className="font-mono text-slate-500 flex-shrink-0" title="Proposal number">{q.quote_number || '—'}</span>
                    <span className="flex-shrink-0">{fmtDate(q.quote_date)}</span>
                    {q.sent_at && (
                      <span className="flex-shrink-0 text-blue-300/80" title="Stamped when the status was set to SENT">
                        ➤ sent {fmtDate(q.sent_at)}
                      </span>
                    )}
                    {(q.updated_by_email || q.created_by_email) && (
                      <span className="flex-shrink-0 text-slate-500 hidden sm:block"
                        title={`Created by ${q.created_by_email || '—'}${q.created_at ? ` on ${fmtDateTime(q.created_at)}` : ''}\nLast edited by ${q.updated_by_email || q.created_by_email || '—'}${q.updated_at ? ` on ${fmtDateTime(q.updated_at)}` : ''}`}>
                        ✎ Edited by <span className="text-slate-400">{(q.updated_by_email || q.created_by_email)!.split('@')[0]}</span>
                        {q.updated_at ? ` · ${fmtDateTime(q.updated_at)}` : ''}
                      </span>
                    )}
                  </div>
                  {/* Which items matched the search — shows why this proposal is here */}
                  {searchLc && itemMatchByQuote.get(q.quote_id)?.length ? (
                    <div className="flex flex-wrap items-center gap-1.5 mt-1.5">
                      <span className="text-[10px] text-slate-600 flex-shrink-0">contains</span>
                      {itemMatchByQuote.get(q.quote_id)!.slice(0, 3).map((d, i) => (
                        <span key={i} className="text-[10px] px-1.5 py-0.5 rounded bg-sky-500/10 text-sky-300/90 truncate max-w-[220px]">{d}</span>
                      ))}
                      {itemMatchByQuote.get(q.quote_id)!.length > 3 && (
                        <span className="text-[10px] text-slate-600">+{itemMatchByQuote.get(q.quote_id)!.length - 3} more</span>
                      )}
                    </div>
                  ) : null}
                </Link>
                {livePeers.length > 0 && <LivePresence peers={livePeers} />}
                <div className="hidden sm:flex items-center gap-2 opacity-0 group-hover:opacity-100 transition-opacity">
                  <button
                    onClick={() => { setDup({ id: q.quote_id, number: q.quote_number }); setDupToday(true); setDupRefresh(false); setDupInternal(true); setDupError(''); }}
                    className="p-2 rounded-lg hover:bg-white/10 text-slate-500 hover:text-white transition-colors"
                    title="Duplicate"
                  >
                    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" /></svg>
                  </button>
                  <Link
                    href={`/proposals/${q.quote_id}/print`}
                    target="_blank"
                    className="p-2 rounded-lg hover:bg-white/10 text-slate-500 hover:text-white transition-colors"
                    title="Print / PDF"
                  >
                    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M17 17h2a2 2 0 002-2v-4a2 2 0 00-2-2H5a2 2 0 00-2 2v4a2 2 0 002 2h2m2 4h6a2 2 0 002-2v-4a2 2 0 00-2-2H9a2 2 0 00-2 2v4a2 2 0 002 2zm8-12V5a2 2 0 00-2-2H9a2 2 0 00-2 2v4h10z" /></svg>
                  </Link>
                  {(q.status !== 'sent' || gate.profile?.role === 'owner') && (
                  <button
                    onClick={() => setDeleteId(q.quote_id)}
                    className="p-2 rounded-lg hover:bg-red-500/10 text-slate-600 hover:text-red-400 transition-colors"
                    title="Delete"
                  >
                    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" /></svg>
                  </button>
                  )}
                    </div>
                    </div>
                    );
                  })}
                </div>
              </div>
              );
            })}
          </div>
        )}
      </main>

      {/* Set-password modal */}
      {pwOpen && (
        <div className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-4">
          <div className="bg-slate-900 border border-slate-700 rounded-2xl p-6 max-w-sm w-full">
            <h3 className="font-semibold text-white mb-1">Set a password</h3>
            <p className="text-slate-500 text-xs mb-5">Lets you sign in without waiting for a login-link email.</p>
            <div className="space-y-3">
              <input type="password" value={pw1} onChange={(e) => setPw1(e.target.value)}
                placeholder="New password (min. 8 characters)"
                className="w-full px-3 py-2.5 bg-slate-800/80 border border-slate-700 rounded-lg text-white text-sm placeholder-slate-600 focus:outline-none focus:border-violet-500" />
              <input type="password" value={pw2} onChange={(e) => setPw2(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') savePassword(); }}
                placeholder="Repeat password"
                className="w-full px-3 py-2.5 bg-slate-800/80 border border-slate-700 rounded-lg text-white text-sm placeholder-slate-600 focus:outline-none focus:border-violet-500" />
              {pwMsg && <p className="text-[11px] text-red-400">{pwMsg}</p>}
            </div>
            <div className="flex gap-3 justify-end mt-5">
              <button onClick={() => setPwOpen(false)} disabled={pwBusy}
                className="px-4 py-2 rounded-lg text-slate-400 hover:text-white hover:bg-white/10 text-sm transition-colors disabled:opacity-50">Cancel</button>
              <button onClick={savePassword} disabled={pwBusy}
                className="px-4 py-2 rounded-lg bg-violet-600 hover:bg-violet-500 text-white text-sm font-semibold transition-colors disabled:opacity-50">
                {pwBusy ? 'Saving…' : 'Save password'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Duplicate modal */}
      {dup && (
        <div className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-4">
          <div className="bg-slate-900 border border-slate-700 rounded-2xl p-6 max-w-md w-full">
            <h3 className="font-semibold text-white mb-1">Duplicate quote</h3>
            <p className="text-slate-500 text-xs mb-5 truncate">{dup.number || 'Untitled quote'}</p>

            <label className="flex items-start gap-3 mb-4 cursor-pointer">
              <input type="checkbox" checked={dupToday} onChange={(e) => setDupToday(e.target.checked)}
                className="mt-0.5 accent-violet-600" />
              <span>
                <span className="block text-sm text-slate-200 font-medium">Set quote date to today</span>
                <span className="block text-[11px] text-slate-500">Unchecked keeps the original date</span>
              </span>
            </label>

            <label className="flex items-start gap-3 mb-5 cursor-pointer">
              <input type="checkbox" checked={dupRefresh} onChange={(e) => setDupRefresh(e.target.checked)}
                className="mt-0.5 accent-violet-600" />
              <span>
                <span className="block text-sm text-slate-200 font-medium">Update costs to latest, keep margins</span>
                <span className="block text-[11px] text-slate-500">
                  Each catalog item gets its newest cost (TUC → supplier quote → last used) and the sell price
                  is recomputed with the item&apos;s original GM%
                </span>
              </span>
            </label>

            <label className="flex items-start gap-3 mb-5 cursor-pointer">
              <input type="checkbox" checked={dupInternal} onChange={(e) => setDupInternal(e.target.checked)}
                className="mt-0.5 accent-violet-600" />
              <span>
                <span className="block text-sm text-slate-200 font-medium">Copy internal notes &amp; quantity formulas</span>
                <span className="block text-[11px] text-slate-500">
                  Engineering notes and =formulas behind quantities (internal only, never on the PDF).
                  Unchecked starts the copy clean
                </span>
              </span>
            </label>

            {dupRefresh && catalogLoading && (
              <p className="text-[11px] text-amber-400 mb-4">Loading price data… duplicate will be enabled once it&apos;s ready.</p>
            )}
            {dupError && <p className="text-[11px] text-red-400 mb-4">{dupError}</p>}

            <div className="flex gap-3 justify-end">
              <button onClick={() => setDup(null)} disabled={dupBusy}
                className="px-4 py-2 rounded-lg text-slate-400 hover:text-white hover:bg-white/10 text-sm transition-colors disabled:opacity-50">
                Cancel
              </button>
              <button onClick={duplicateQuote} disabled={dupBusy || (dupRefresh && catalogLoading)}
                className="px-4 py-2 rounded-lg bg-violet-600 hover:bg-violet-500 text-white text-sm font-semibold transition-colors disabled:opacity-50">
                {dupBusy ? 'Duplicating…' : 'Duplicate'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Delete confirm modal */}
      {deleteId && (
        <div className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-4">
          <div className="bg-slate-900 border border-slate-700 rounded-2xl p-6 max-w-sm w-full">
            <h3 className="font-semibold text-white mb-2">Delete quote?</h3>
            <p className="text-slate-400 text-sm mb-5">This will permanently delete the quote and all its sections and items.</p>
            <div className="flex gap-3 justify-end">
              <button onClick={() => setDeleteId(null)} className="px-4 py-2 rounded-lg text-slate-400 hover:text-white hover:bg-white/10 text-sm transition-colors">Cancel</button>
              <button onClick={() => confirmDelete(deleteId)} className="px-4 py-2 rounded-lg bg-red-600 hover:bg-red-500 text-white text-sm font-semibold transition-colors">Delete</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// Live presence on a proposal card: avatars of who is in that proposal right
// now, amber ring + "editing" label when someone holds unsaved changes.
function LivePresence({ peers }: { peers: LobbyPeer[] }) {
  const editors = peers.filter((p) => p.editing);
  return (
    <div className="flex items-center gap-2 flex-shrink-0" title={peers.map((p) => `${p.name}${p.editing ? ' — editing (unsaved)' : ' — viewing'}`).join('\n')}>
      <div className="flex -space-x-2">
        {peers.slice(0, 4).map((p) => (
          <span key={p.email}
            className="w-6 h-6 rounded-full flex items-center justify-center text-[9px] font-bold text-black/80 ring-2 ring-slate-900 relative"
            style={{ backgroundColor: p.color }}>
            {initials(p.name, p.email)}
            {p.editing && <span className="absolute -bottom-0.5 -right-0.5 w-2.5 h-2.5 rounded-full bg-amber-400 ring-2 ring-slate-900" />}
          </span>
        ))}
        {peers.length > 4 && (
          <span className="w-6 h-6 rounded-full bg-slate-700 text-slate-300 text-[9px] font-bold flex items-center justify-center ring-2 ring-slate-900">+{peers.length - 4}</span>
        )}
      </div>
      <span className={`hidden md:inline text-[10px] font-semibold whitespace-nowrap ${editors.length ? 'text-amber-300' : 'text-emerald-300/90'}`}>
        {editors.length ? `${firstName(editors[0].name, editors[0].email)} editing${editors.length > 1 ? ` +${editors.length - 1}` : ''}` : `${firstName(peers[0].name, peers[0].email)} viewing`}
      </span>
    </div>
  );
}

// Header pill: how many people are in the EPC area right now, and where.
function OnlineIndicator({ online, count }: { online: LobbyPeer[]; count: number }) {
  const tip = online.map((p) => {
    const where = p.editing && p.quoteNumber ? `editing ${p.quoteNumber}`
      : p.quoteNumber ? `viewing ${p.quoteNumber}` : 'browsing the list';
    return `${p.name} — ${where}`;
  }).join('\n');
  return (
    <div className="hidden sm:flex items-center gap-2" title={tip}>
      <div className="flex -space-x-2">
        {online.slice(0, 4).map((p) => (
          <span key={p.email}
            className="w-6 h-6 rounded-full flex items-center justify-center text-[9px] font-bold text-black/80 ring-2 ring-[#141518]"
            style={{ backgroundColor: p.color }}>
            {initials(p.name, p.email)}
          </span>
        ))}
        {count > 4 && <span className="w-6 h-6 rounded-full bg-slate-700 text-slate-300 text-[9px] font-bold flex items-center justify-center ring-2 ring-[#141518]">+{count - 4}</span>}
      </div>
      <span className="flex items-center gap-1 text-[11px] text-slate-400 whitespace-nowrap">
        <span className="w-1.5 h-1.5 rounded-full bg-emerald-400" /> {count} online
      </span>
    </div>
  );
}
