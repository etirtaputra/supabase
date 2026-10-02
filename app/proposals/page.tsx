'use client';
import React, { useState, useEffect, useCallback, useMemo } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { createSupabaseClient } from '@/lib/supabase';
import { fetchAllRows } from '@/lib/fetchAllRows';
import { useSupabaseData } from '@/hooks/useSupabaseData';
import { useQuotesGate } from '@/hooks/useQuotesGate';
import { useT } from '@/hooks/useT';
import { fetchOpenNotes, newestOpenByQuote, openCountByQuote, type QuoteNote } from '@/lib/quoteNotes';
import { computeTUCMap, getComponentCost, fxFromHistory, type TUCResult, type CostEntry } from '@/lib/computeTUC';
import { deriveExchangeRates } from '@/lib/exchangeRates';
import { fetchUsedEntries } from '@/lib/usedPrices';
import { lineWp } from '@/lib/quoteWp';
import { fmtDay, fmtDayTime, fmtRp } from '@/lib/formatters';
import { useSettings } from '@/hooks/useSettings';
import LayoutToggle from '@/components/ui/LayoutToggle';
import { useListLayout } from '@/hooks/useListLayout';
import MigrationBanner from '@/components/ui/MigrationBanner';
import BrandMenu from '@/components/ui/BrandMenu';
import MobileNotice from '@/components/ui/MobileNotice';
import { PROJECT_TYPES } from '@/lib/projectSpec';
import { SECTION_GROUPS, STANDARD_SECTIONS, type ProjectQuote } from '@/types/quotes';
import { useEpcLobby, type LobbyPeer } from '@/hooks/useEpcLobby';
import { initials, firstName } from '@/lib/presence';
import { usePageTitle } from '@/hooks/usePageTitle';
import { groupProposals, customerKey, ACTIVE_DAYS } from '@/lib/proposalGroups';
import { BAR_SELECT, BAR_INPUT, BAR_BTN, BAR_BTN_OFF, BAR_BTN_ON } from '@/constants/controls';

const STATUS_STYLES: Record<string, string> = {
  draft:    'bg-slate-700/60 text-slate-300',
  sent:     'bg-blue-500/20 text-blue-300 tone-step',
  accepted: 'bg-emerald-500/20 text-emerald-300',
  rejected: 'bg-red-500/20 text-red-400',
};

// The list is grouped by CUSTOMER (lib/proposalGroups.ts). A customer shows
// this many proposals before "Show N more" — Imigrasi alone has 31.
const CUSTOMER_PREVIEW = 3;

function fmtDate(d: string) {
  return fmtDay(d) || '—';
}

// Date + time (local tz, WIB for the team) for "last edited" — the list needs
// the time of day, not just the day, to tell same-day edits apart.
function fmtDateTime(d?: string | null) {
  return fmtDayTime(d) || '—';
}

/** House format: Q-YYYYMMDD-XXXX. One generator, so "New" and "Duplicate as new" agree. */
const newQuoteNumber = (isoDate: string) =>
  `Q-${isoDate.replace(/-/g, '')}-${Math.random().toString(36).slice(2, 6).toUpperCase()}`;

/**
 * The next revision of a quote number: `-REV`, then `-REV2`, `-REV3`…
 *
 * Duplicating a duplicate used to give `Q-…-REV-REV`, which reads as a mistake
 * and sorts badly. A revision belongs to the SAME commercial conversation as
 * its parent, which is exactly when the number should stay recognisable.
 */
function nextRevisionNumber(base: string): string {
  const src = (base || 'Q').trim();
  const m = src.match(/^(.*)-REV(\d*)$/i);
  if (!m) return `${src}-REV`;
  return `${m[1]}-REV${(m[2] ? parseInt(m[2], 10) : 1) + 1}`;
}

export default function QuotesListPage() {
  // `tr` too: inside the list's row map a local `t` (the row's totals) shadows `t`.
  const { t, t: tr, tf } = useT();
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
  const [noteFilter, setNoteFilter] = useState('');    // '' = all · open · none
  const [creator, setCreator] = useState('');          // '' = everyone
  const [scope, setScope] = useState<'active' | 'archive'>('active');
  // Customers showing ALL their proposals, and proposals showing their older versions.
  const [openCustomers, setOpenCustomers] = useState<Set<string>>(new Set());
  const [openFamilies, setOpenFamilies] = useState<Set<string>>(new Set());
  const toggleIn = (set: React.Dispatch<React.SetStateAction<Set<string>>>, key: string) =>
    set((prev) => { const n = new Set(prev); if (n.has(key)) n.delete(key); else n.add(key); return n; });
  // Every OPEN follow-up note, in one query for the whole list.
  const [openNotes, setOpenNotes] = useState<QuoteNote[]>([]);
  // `supabase` is rebuilt every render (line 71), so it is deliberately not a
  // dependency here — the same call the other fetches in this file make.
  const reloadNotes = useCallback(() => { fetchOpenNotes(supabase).then(setOpenNotes).catch(() => setOpenNotes([])); }, []);   // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { reloadNotes(); }, [reloadNotes]);
  const noteByQuote = useMemo(() => newestOpenByQuote(openNotes), [openNotes]);
  const noteCountByQuote = useMemo(() => openCountByQuote(openNotes), [openNotes]);
  /** Hover text for the note on a row: how many are open, and since when. */
  const noteThreadTitle = useCallback((quoteId: string): string => {
    const n = noteByQuote.get(quoteId);
    if (!n) return '';
    const count = noteCountByQuote.get(quoteId) ?? 1;
    const when = fmtDate(n.created_at);
    return count > 1
      ? tf('{body} — {n} notes open, newest {date}', { body: n.body, n: count, date: when })
      : tf('{body} — raised {date}', { body: n.body, date: when });
  }, [noteByQuote, noteCountByQuote, tf]);

  usePageTitle();

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
  const [dup, setDup] = useState<{ id: string; number: string; date: string } | null>(null);
  const [dupToday, setDupToday] = useState(true);
  // A copy is not always a revision: re-quoting the same scope for a different
  // customer, or reviving a quote a year later, is a NEW commercial document
  // and deserves its own number rather than inheriting someone else's lineage.
  const [dupNumbering, setDupNumbering] = useState<'revision' | 'new'>('revision');
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
    // Paged: this list TOTALS these rows, and 10.2_quote_items passed the
    // 1,000-row API cap on 2026-08-28 (1,040), so an unbounded read was
    // quietly dropping lines and under-stating the money on screen.
    void fetchAllRows<ListItem>((from, to) => supabase.from('10.2_quote_items')
      .select('quote_id, section_id, parent_item_id, component_id, description, unit, quantity, cost_price, sell_price')
      .range(from, to)).then(({ rows }) => setAllItems(rows));
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

  // Per-item Cost Basis settings for Project Quotes (mode + buffer). The global
  // buffer and the drift threshold both live in Settings › Defaults.
  const { epcCostBufferPct: globalBufferPct, costDriftPct } = useSettings();
  const [layout, setLayout] = useListLayout('proposals');
  const compact = layout === 'compact';

  // ── Cost-drift detection on open (draft/sent) quotes ────────────────────────
  // Compares each catalog-linked item's stored cost against today's
  // recommendation from the shared cost engine; a difference beyond the
  // configured threshold (Settings › Defaults, 10% out of the box) flags it.
  const DRIFT_THRESHOLD = costDriftPct / 100;
  const openItems = useMemo(() => {
    if (!allItems) return null;
    const openIds = new Set(quotes.filter((q) => q.status === 'draft' || q.status === 'sent').map((q) => q.quote_id));
    return allItems.filter((it) => openIds.has(it.quote_id) && it.component_id);
  }, [allItems, quotes]);

  const listTucMap = useMemo(
    () => computeTUCMap(catalog.pos, catalog.poItems, catalog.poCosts),
    [catalog.pos, catalog.poItems, catalog.poCosts],
  );

  // Realized FX per currency — the drift check must compare against the same
  // cost the editor would compute, or it flags (or misses) the wrong quotes.
  const fx = useMemo(
    () => fxFromHistory(catalog.pos, deriveExchangeRates(catalog.pos, catalog.poItems, catalog.poCosts, catalog.quotes)),
    [catalog.pos, catalog.poItems, catalog.poCosts, catalog.quotes],
  );


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
      const cc = getComponentCost(it.component_id, listTucMap, catalog.quotes, catalog.quoteItems, usedEntries.get(it.component_id) ?? [], costOptsFor(it.component_id), fx);
      if (!cc || !(cc.cost > 0)) continue;
      // Flag only cost increases — margin risk; price drops are fine
      if ((cc.cost - stored) / stored > DRIFT_THRESHOLD) {
        map.set(it.quote_id, (map.get(it.quote_id) ?? 0) + 1);
      }
    }
    return map;
  }, [openItems, usedEntries, catalogLoading, listTucMap, catalog.quotes, catalog.quoteItems, costOptsFor, DRIFT_THRESHOLD]);

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

  // Search (number / customer / description / location / ITEMS) + type, note
  // and maker filters. A proposal is listed when ANY of its versions matches.
  const matches = useCallback((q: ProjectQuote): boolean => {
    if (filterType && (q.project_type || 'custom') !== filterType) return false;
    if (noteFilter === 'open' && !noteByQuote.has(q.quote_id)) return false;
    if (noteFilter === 'none' && noteByQuote.has(q.quote_id)) return false;
    if (creator && (q.created_by_email ?? '') !== creator) return false;
    if (!searchLc) return true;
    const headerHit = [q.quote_number, q.customer_name, q.project_description, q.location,
      PROJECT_TYPES.find((t) => t.key === q.project_type)?.label]
      .filter(Boolean).join(' ').toLowerCase().includes(searchLc);
    return headerHit || itemMatchByQuote.has(q.quote_id);
  }, [searchLc, filterType, itemMatchByQuote, noteFilter, noteByQuote, creator]);
  const visibleQuotes = useMemo(() => quotes.filter(matches), [quotes, matches]);

  // Customer → proposal → versions. Built from ALL quotes, so a customer's
  // counts and a proposal's versions never depend on the filters.
  const allGroups = useMemo(() => groupProposals(quotes, {
    hasOpenNote: (id) => noteByQuote.has(id),
    show: (f) => [f.latest, ...f.older].some(matches),
  }), [quotes, noteByQuote, matches]);
  const scopeCounts = useMemo(() => {
    const c = { active: 0, archive: 0 };
    for (const g of allGroups) for (const f of g.families) c[f.active ? 'active' : 'archive'] += 1;
    return c;
  }, [allGroups]);
  // A search looks everywhere — finding an old proposal is the usual reason to search.
  const groups = useMemo(() => (searchLc ? allGroups : allGroups
    .map((g) => ({ ...g, families: g.families.filter((f) => f.active === (scope === 'active')) }))
    .filter((g) => g.families.length > 0)), [allGroups, scope, searchLc]);

  // Who made proposals, busiest first — for the "Made by" filter.
  const creators = useMemo(() => {
    const n = new Map<string, number>();
    for (const q of quotes) if (q.created_by_email) n.set(q.created_by_email, (n.get(q.created_by_email) ?? 0) + 1);
    return [...n.entries()].sort((a, b) => b[1] - a[1]).map(([e]) => e);
  }, [quotes]);

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
    const num = newQuoteNumber(today);
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
        quote_number: dupNumbering === 'new'
          ? newQuoteNumber((dupToday ? today : String(src.quote_date ?? today)).slice(0, 10))
          : nextRevisionNumber(String(src.quote_number ?? '')),
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
          const cc = getComponentCost(it.component_id, dupTucMap, catalog.quotes, catalog.quoteItems, usedMap?.get(it.component_id) ?? [], costOptsFor(it.component_id), fx);
          if (cc) {
            const newCost = Math.round(cc.cost);
            const oldCost = Number(it.cost_price), oldSell = Number(it.sell_price);
            if (oldCost > 0 && oldSell > 0) {
              const gmFrac = 1 - oldCost / oldSell;
              if (gmFrac < 1) sell = Math.round(newCost / (1 - gmFrac));
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
      <div className="min-h-screen bg-canvas flex items-center justify-center">
        <div className="w-6 h-6 border-2 border-violet-500/30 border-t-violet-500 rounded-full animate-spin" />
      </div>
    );
  }

  // One proposal row (card or compact). Used for a proposal and for each of its older versions.
  const renderRow = (q: ProjectQuote) => {
    const t = totalsByQuote.get(q.quote_id);
    // The customer is the group's header, so a row leads with what tells its
    // proposals apart: the SITE (Imigrasi's 31 share one description and differ
    // only by location), else the description. A location that merely repeats
    // the customer ("Sinar Samudra" at "Sinar Samudra") says nothing new.
    const site = (q.location ?? '').trim();
    const title = site && customerKey(site) !== customerKey(q.customer_name) ? site : (q.project_description || q.quote_number || '—');
    const desc = title === q.project_description ? '' : q.project_description;
    const livePeers = peersByProposal.get(q.quote_id) ?? [];
    const someoneEditing = livePeers.some((p) => p.editing);
    return (
    <div key={q.quote_id} className={`group flex items-center gap-3 sm:gap-4 bg-slate-900/50 hover:bg-slate-900/80 border transition-all ${compact ? 'rounded-lg px-3 py-1.5' : 'rounded-2xl px-4 sm:px-5 py-4'} ${someoneEditing ? 'border-amber-500/40' : livePeers.length ? 'border-emerald-500/30' : 'border-slate-800 hover:border-slate-700'}`}>
                <Link href={`/proposals/${q.quote_id}`} className="flex-1 min-w-0">
  {compact ? (
    /* One line: who, what state, what it's worth, which number */
    <div className="flex items-center gap-2 min-w-0">
      <span className="font-semibold text-slate-100 text-[13px] truncate flex-shrink min-w-0 max-w-[45%]" title={title}>{title}</span>
      <span className={`px-1.5 py-0.5 rounded text-[9px] font-semibold uppercase tracking-wider whitespace-nowrap flex-shrink-0 ${STATUS_STYLES[q.status] ?? STATUS_STYLES.draft}`}>{tr(q.status)}</span>
      {driftByQuote.has(q.quote_id) && (
        <span className="px-1.5 py-0.5 rounded text-[9px] font-semibold whitespace-nowrap flex-shrink-0 bg-amber-500/15 text-amber-300"
          title={`${driftByQuote.get(q.quote_id)} item${driftByQuote.get(q.quote_id)! > 1 ? 's' : ''} priced >${costDriftPct}% away from today's cost`}>
          ⚠ {driftByQuote.get(q.quote_id)}
        </span>
      )}
      {/* An OPEN note takes the description's place (owner's
          call, 2026-08-27). A live "waiting on the customer"
          is worth more than a description you wrote yourself
          and already know, and the row does not grow to say
          it. The description is still there in Card view. */}
      {noteByQuote.has(q.quote_id) ? (
        <span className="text-[11px] text-amber-300/90 truncate hidden md:inline"
          title={noteThreadTitle(q.quote_id)}>
          <span aria-hidden className="mr-1">●</span>{noteByQuote.get(q.quote_id)!.body}
        </span>
      ) : desc ? (
        <span className="text-[11px] text-slate-500 truncate hidden md:inline">{desc}</span>
      ) : null}
      {/* Money and date are FIXED-WIDTH and last (from sm up), so
          every row's amount shares a right edge and the column can
          be read as a column. On a PHONE the fixed widths would
          overflow the viewport and drag the whole page sideways —
          there the amount sizes itself and the date steps aside
          (it's one tap away in the proposal). */}
      <span className="ml-auto flex items-center gap-2 sm:gap-3 flex-shrink-0 tabular-nums">
        <span className="font-mono text-[10px] text-slate-600 hidden sm:block max-w-[14rem] truncate" title={q.quote_number || undefined}>
          {q.quote_number || '—'}
        </span>
        <span className="sm:w-[9rem] text-right whitespace-nowrap text-[13px] font-bold text-slate-100">
          {t && t.subtotal > 0 ? fmtRp(t.subtotal) : ''}
        </span>
        <span className="hidden sm:block w-[4.5rem] text-right text-[10px] text-slate-500">{fmtDate(q.quote_date)}</span>
      </span>
    </div>
  ) : (<>
  {/* Primary focus: the customer + status/type */}
  <div className="flex flex-wrap items-center gap-2 mb-0.5">
    <span className="font-semibold text-white text-base truncate max-w-full" title={title}>{title}</span>
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
        title={`${driftByQuote.get(q.quote_id)} item${driftByQuote.get(q.quote_id)! > 1 ? 's' : ''} priced >${costDriftPct}% away from today's cost — open and press Costs to refresh`}
      >
        ⚠ {driftByQuote.get(q.quote_id)} outdated cost{driftByQuote.get(q.quote_id)! > 1 ? 's' : ''}
      </span>
    )}
  </div>
  {/* An OPEN follow-up note. Compact view swaps it in for the
      description because the row cannot grow; a card has the
      room for both, so the note sits ABOVE — a live "waiting on
      the customer" outranks a description you wrote yourself.
      Clamped to two lines so one long note can't stretch the
      card; the full thread is in the hover title. */}
  {noteByQuote.has(q.quote_id) && (
    <p className="flex items-start gap-1.5 text-[11px] text-amber-300/90 mb-1.5"
      title={noteThreadTitle(q.quote_id)}>
      <span aria-hidden className="flex-shrink-0">●</span>
      <span className="min-w-0 line-clamp-2">{noteByQuote.get(q.quote_id)!.body}</span>
      {(noteCountByQuote.get(q.quote_id) ?? 1) > 1 && (
        <span className="flex-shrink-0 text-amber-400/70 tabular-nums">
          +{(noteCountByQuote.get(q.quote_id) ?? 1) - 1}
        </span>
      )}
    </p>
  )}
  {/* Project name / scope */}
  {desc && (
    <p className="text-xs text-slate-400 truncate max-w-full mb-1.5">{desc}</p>
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
  </>)}
                </Link>
                {livePeers.length > 0 && <LivePresence peers={livePeers} />}
                <div className="hidden sm:flex items-center gap-2 opacity-0 group-hover:opacity-100 transition-opacity">
  <button
    onClick={() => { setDup({ id: q.quote_id, number: q.quote_number, date: q.quote_date ?? '' }); setDupToday(true); setDupRefresh(false); setDupInternal(true); setDupNumbering('revision'); setDupError(''); }}
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
  {/* The slot is kept when Delete is not offered, so draft and sent rows
      in one customer group put their amounts on the same edge. */}
  {(q.status !== 'sent' || gate.profile?.role === 'owner') ? (
  <button
    onClick={() => setDeleteId(q.quote_id)}
    className="p-2 rounded-lg hover:bg-red-500/10 text-slate-600 hover:text-red-400 transition-colors"
    title="Delete"
  >
    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" /></svg>
  </button>
  ) : <span aria-hidden className="w-8 flex-shrink-0" />}
    </div>
    </div>
    );
  };

  return (
    <div className="min-h-screen bg-canvas text-slate-200 font-sans text-sm">
      {/* Header */}
      <div className="sticky top-0 z-40 bg-canvas/90 backdrop-blur-xl border-b border-white/[0.07]">
        <div className="max-w-6xl 2xl:max-w-[1760px] mx-auto px-3 sm:px-6 py-4 flex items-center justify-between flex-wrap gap-3">
          <BrandMenu wordmarkClass="text-xl font-bold" subtitle="EPC" />
          {/* min-w-0 so this cluster yields instead of colliding with the nav */}
          <div className="flex items-center gap-2 sm:gap-3 min-w-0">
            {onlineCount > 1 && <OnlineIndicator online={online} count={onlineCount} />}
            {gate.profile?.role === 'owner' && (
              <>
                <Link
                  href="/proposals/directory"
                  className="hidden xl:inline-block px-3 py-1.5 rounded-xl border border-white/[0.08] text-slate-400 hover:text-white hover:bg-white/10 text-xs font-semibold transition-all"
                  title="Proposal Directory — dedupe & merge customer names, sites and addresses (Owners only)"
                >
                  Directory
                </Link>
                <Link
                  href="/proposals/library"
                  className="hidden xl:inline-block px-3 py-1.5 rounded-xl border border-white/[0.08] text-slate-400 hover:text-white hover:bg-white/10 text-xs font-semibold transition-all"
                  title="Description Library — review, dedupe and rename quote item texts (Owners only)"
                >
                  Library
                </Link>
              </>
            )}
            {/* Only the part the wordmark menu does NOT already carry.
                This used to be a two-line block — email above, Set password
                and Sign out below — wedged between single-line buttons, which
                is what made the row read as ragged. The menu shows who is
                signed in and signs them out on every page; setting a password
                is the one thing it cannot do, so that is all that stays, at
                the same height as its neighbours. */}
            {gate.profile && (
              <button
                onClick={() => { setPwOpen(true); setPw1(''); setPw2(''); setPwMsg(''); }}
                title={`Set a password for ${gate.profile.email}`}
                className="hidden xl:inline-block px-3 py-1.5 rounded-xl border border-white/[0.08] text-slate-400 hover:text-white hover:bg-white/10 text-xs font-semibold transition-all whitespace-nowrap"
              >
                {t('Set password')}
              </button>
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
            <span className="hidden sm:inline">{t('New proposal')}</span>
          </button>
          </div>
        </div>
      </div>

      <main className="max-w-6xl 2xl:max-w-[1760px] mx-auto px-3 sm:px-6 py-4 sm:py-6 space-y-6">
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
        {/* View, search and filters — one control size (constants/controls.ts). */}
        {!loading && quotes.length > 0 && (
          <div className="flex flex-wrap items-center gap-2">
            {/* Active = still in play (a draft, sent in the last ACTIVE_DAYS, or a
                follow-up note open). Everything else is one click away. */}
            <div className="flex gap-1.5">
              {(['active', 'archive'] as const).map((s) => (
                <button key={s} onClick={() => setScope(s)}
                  title={s === 'active'
                    ? tf('Drafts, proposals sent in the last {n} days, and any with an open note', { n: ACTIVE_DAYS })
                    : tf('Sent more than {n} days ago, won or rejected', { n: ACTIVE_DAYS })}
                  className={`${BAR_BTN} px-3 ${scope === s && !searchLc ? BAR_BTN_ON : BAR_BTN_OFF}`}>
                  {s === 'active' ? tf('Active ({n})', { n: scopeCounts.active }) : tf('Archived ({n})', { n: scopeCounts.archive })}
                </button>
              ))}
            </div>
            <div className="relative w-full sm:w-auto sm:flex-1 sm:min-w-[220px]">
              <svg className="w-4 h-4 text-slate-500 absolute left-3.5 top-1/2 -translate-y-1/2" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M21 21l-4.35-4.35M17 11a6 6 0 11-12 0 6 6 0 0112 0z" /></svg>
              <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder={tr('Search number, customer, item / keyword, location…')}
                className={`w-full pl-10 ${BAR_INPUT}`} />
            </div>
            <select value={filterType} onChange={(e) => setFilterType(e.target.value)} className={BAR_SELECT}>
              <option value="">{tr('All project types')}</option>
              {availableTypes.map((t) => <option key={t.key} value={t.key}>{t.label}</option>)}
            </select>
            {creators.length > 1 && (
              <select value={creator} onChange={(e) => setCreator(e.target.value)} title={tr('Show only the proposals one person made')} className={BAR_SELECT}>
                <option value="">{tr('Made by: everyone')}</option>
                {creators.map((e) => <option key={e} value={e}>{e.split('@')[0]}</option>)}
              </select>
            )}
            {/* Only offered once a note exists — an empty filter on a feature
                nobody has used yet is a control that can only disappoint. */}
            {noteByQuote.size > 0 && (
              <select value={noteFilter} onChange={(e) => setNoteFilter(e.target.value)}
                title={tr('Proposals with a follow-up note still open')}
                className={BAR_SELECT}>
                <option value="">{tr('All notes')}</option>
                <option value="open">{tf('Open note ({n})', { n: noteByQuote.size })}</option>
                <option value="none">{tr('Nothing open')}</option>
              </select>
            )}
            <LayoutToggle value={layout} onChange={setLayout} accent="violet" />
          </div>
        )}
        {loading ? (
          <div className="flex items-center justify-center h-64 text-slate-500">Loading…</div>
        ) : quotes.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-64 text-slate-500 gap-4">
            <svg className="w-12 h-12 text-slate-700" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.5" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" /></svg>
            <p className="text-slate-400 font-medium">No quotes yet</p>
            <button onClick={createNew} className="px-4 py-2 rounded-xl bg-violet-600 hover:bg-violet-500 text-white text-sm font-semibold transition-colors">
              {t('Create your first quote')}
            </button>
          </div>
        ) : visibleQuotes.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-40 text-slate-500 gap-2">
            <p className="text-slate-400 font-medium">No proposals match your search</p>
            <button onClick={() => { setSearch(''); setFilterType(''); setCreator(''); setNoteFilter(''); }} className="text-xs text-violet-400 hover:text-violet-300 transition-colors">{t('Clear filters')}</button>
          </div>
        ) : (
          <div className="space-y-6">
            {searchLc && (
              <p className="px-1 text-[11px] text-slate-500">{tr('Searching all proposals, archive included')}</p>
            )}
            {groups.length === 0 && (
              <div className="flex flex-col items-center justify-center h-32 text-slate-500 gap-2">
                <p className="text-slate-400 font-medium">{scope === 'active' ? tr('No active proposals') : tr('Nothing in the archive')}</p>
              </div>
            )}
            {groups.map((g) => {
              const showAll = !!searchLc || openCustomers.has(g.key) || g.families.length <= CUSTOMER_PREVIEW;
              const fams = showAll ? g.families : g.families.slice(0, CUSTOMER_PREVIEW);
              const c = g.counts;
              return (
                <section key={g.key || '(none)'}>
                  {/* The customer, and how its proposals stand — counted over ALL
                      of them, whatever the view (owner, 2026-10-02). */}
                  <div className="flex flex-wrap items-center gap-x-3 gap-y-1 mb-2 px-1">
                    <h2 className="text-sm font-semibold text-white truncate max-w-full">{g.name || tr('No customer')}</h2>
                    <span className="flex flex-wrap items-center gap-x-2.5 text-[11px] tabular-nums">
                      <span className="text-slate-300">{tf('{n} proposals', { n: c.total })}</span>
                      {([['Draft', c.draft, 'text-slate-300'], ['Sent', c.sent, 'text-blue-300 tone-step'],
                        ['Won', c.won, 'text-emerald-300'], ['Rejected', c.rejected, 'text-red-400']] as const).map(([label, n, tone]) => (
                        <span key={label} className={n ? tone : 'text-slate-600'}>{tr(label)} {n}</span>
                      ))}
                    </span>
                    <span className="text-[11px] text-slate-500">{tf('Last activity {date}', { date: fmtDate(g.lastActivity) })}</span>
                    <div className="flex-1 h-px bg-white/[0.06] min-w-[2rem]" />
                  </div>
                  <div className="space-y-2">
                    {fams.map((f) => {
                      const fkey = `${g.key}|${f.key}`;
                      // A search that only hit an OLDER version opens the versions, so the hit is visible.
                      const versionsOpen = openFamilies.has(fkey) || (!!searchLc && !matches(f.latest) && f.older.some(matches));
                      return (
                        <div key={fkey}>
                          {renderRow(f.latest)}
                          {f.older.length > 0 && (
                            <button onClick={() => toggleIn(setOpenFamilies, fkey)}
                              className="ml-4 mt-1 text-[11px] text-slate-500 hover:text-slate-300 transition-colors">
                              {versionsOpen ? tr('Hide versions') : tf('{n} other versions', { n: f.older.length })}
                            </button>
                          )}
                          {versionsOpen && (
                            <div className="ml-3 sm:ml-6 mt-1.5 pl-3 border-l border-white/[0.08] space-y-2">
                              {f.older.map((o) => renderRow(o))}
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                  {g.families.length > CUSTOMER_PREVIEW && !searchLc && (
                    <button onClick={() => toggleIn(setOpenCustomers, g.key)}
                      className="mt-2 px-1 text-[11px] text-violet-300 hover:text-violet-200 transition-colors">
                      {openCustomers.has(g.key) ? tr('Show fewer') : tf('Show {n} more', { n: g.families.length - CUSTOMER_PREVIEW })}
                    </button>
                  )}
                </section>
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
                className="px-4 py-2 rounded-lg text-slate-400 hover:text-white hover:bg-white/10 text-sm transition-colors disabled:opacity-50">{t('Cancel')}</button>
              <button onClick={savePassword} disabled={pwBusy}
                className="px-4 py-2 rounded-lg bg-violet-600 hover:bg-violet-500 text-white text-sm font-semibold transition-colors disabled:opacity-50">
                {pwBusy ? t('Saving…') : t('Save password')}
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
            <p className="text-slate-500 text-xs mb-4 truncate">{dup.number || 'Untitled quote'}</p>

            {/* Revision or new document? A revision keeps the customer's
                conversation together; a re-quote for a different customer, or a
                job revived a year later, is its own document and should not
                inherit someone else's lineage. */}
            <div className="mb-5">
              <p className="text-[10px] uppercase tracking-widest text-slate-500 mb-2">Quote number</p>
              <div className="grid grid-cols-2 gap-2">
                {([
                  ['revision', 'Revision', 'Same job, next version'],
                  ['new', 'New number', 'A separate quote'],
                ] as ['revision' | 'new', string, string][]).map(([k, label, hint]) => (
                  <button key={k} onClick={() => setDupNumbering(k)}
                    className={`text-left px-3 py-2 rounded-xl border transition-colors ${
                      dupNumbering === k
                        ? 'border-violet-500/60 bg-violet-500/10 text-white'
                        : 'border-slate-700 text-slate-400 hover:border-slate-600 hover:text-slate-200'
                    }`}>
                    <span className="block text-sm font-medium">{label}</span>
                    <span className="block text-[10px] text-slate-500">{hint}</span>
                  </button>
                ))}
              </div>
              <p className="mt-2 text-[11px] text-slate-500">
                Becomes{' '}
                <span className="font-mono text-slate-300">
                  {dupNumbering === 'new'
                    ? `Q-${(dupToday ? new Date().toISOString().slice(0, 10) : dup.date || new Date().toISOString().slice(0, 10)).slice(0, 10).replace(/-/g, '')}-••••`
                    : nextRevisionNumber(dup.number || '')}
                </span>
                {' '}— editable in the quote afterwards.
              </p>
            </div>

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
                {t('Cancel')}
              </button>
              <button onClick={duplicateQuote} disabled={dupBusy || (dupRefresh && catalogLoading)}
                className="px-4 py-2 rounded-lg bg-violet-600 hover:bg-violet-500 text-white text-sm font-semibold transition-colors disabled:opacity-50">
                {dupBusy ? t('Duplicating…') : t('Duplicate')}
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
              <button onClick={() => setDeleteId(null)} className="px-4 py-2 rounded-lg text-slate-400 hover:text-white hover:bg-white/10 text-sm transition-colors">{t('Cancel')}</button>
              <button onClick={() => confirmDelete(deleteId)} className="px-4 py-2 rounded-lg bg-red-600 hover:bg-red-500 text-white text-sm font-semibold transition-colors">{t('Delete')}</button>
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
            className="w-6 h-6 rounded-full flex items-center justify-center text-[9px] font-bold text-black/80 ring-2 ring-canvas"
            style={{ backgroundColor: p.color }}>
            {initials(p.name, p.email)}
          </span>
        ))}
        {count > 4 && <span className="w-6 h-6 rounded-full bg-slate-700 text-slate-300 text-[9px] font-bold flex items-center justify-center ring-2 ring-canvas">+{count - 4}</span>}
      </div>
      <span className="flex items-center gap-1 text-[11px] text-slate-400 whitespace-nowrap">
        <span className="w-1.5 h-1.5 rounded-full bg-emerald-400" /> {count} online
      </span>
    </div>
  );
}
