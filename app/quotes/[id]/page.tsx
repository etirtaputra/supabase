'use client';
import React, { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { createSupabaseClient } from '@/lib/supabase';
import { useSupabaseData } from '@/hooks/useSupabaseData';
import { getComponentCost, type CostEntry } from '@/lib/computeTUC';
import { fetchUsedEntries } from '@/lib/usedPrices';
import { quoteFileName } from '@/lib/quoteFilename';
import { SECTION_GROUPS, type SectionGroup, type ProjectQuote, type QuoteSection, type QuoteItem } from '@/types/quotes';
import type { Component } from '@/types/database';

// ── Types ──────────────────────────────────────────────────────────────────────

interface DraftItem {
  item_id: string;
  parent_item_id: string | null;
  component_id: string | null;
  description: string;
  brand: string;
  quantity: string;
  unit: string;
  cost_price: string;
  sell_price: string;
  sort_order: number;
  _deleted?: boolean;
}
interface DraftSection {
  section_id: string;
  group_key: SectionGroup;
  title: string;
  lead_time: string;
  sort_order: number;
  items: DraftItem[];
  _deleted?: boolean;
}

// ── Helpers ────────────────────────────────────────────────────────────────────

function uid() {
  return typeof crypto !== 'undefined' && crypto.randomUUID
    ? crypto.randomUUID()
    : Math.random().toString(36).slice(2) + Date.now().toString(36);
}

function num(s: string) { const n = parseFloat(s); return isNaN(n) ? null : n; }

function fmtIdr(v: number | null | undefined) {
  if (v == null) return '—';
  return `Rp${Math.round(v).toLocaleString('en-US')}`;
}

function gmFromPrices(cost: string, sell: string): string {
  const c = num(cost), s = num(sell);
  if (!c || !s || s <= 0) return '';
  return ((1 - c / s) * 100).toFixed(1);
}

function sellFromGm(cost: string, gm: string): string {
  const c = num(cost), g = num(gm);
  if (!c || g == null || g >= 100) return '';
  return Math.round(c / (1 - g / 100)).toString();
}

const LEAD_TIMES = ['Ready', '1 minggu', '2 minggu', '3 minggu', '1 bulan', '2 bulan', '3 bulan', 'Custom'];

// Cost source presentation (TUC from POs / supplier price quote / last used in a project quote)
const SOURCE_LABEL: Record<string, string> = { tuc: 'TUC', quote: 'latest quote', used: 'last used' };
const SOURCE_TEXT:  Record<string, string> = { tuc: 'text-violet-400', quote: 'text-sky-400', used: 'text-amber-400' };
const SOURCE_BADGE: Record<string, string> = {
  tuc: 'bg-violet-500/20 text-violet-300',
  quote: 'bg-sky-500/20 text-sky-300',
  used: 'bg-amber-500/20 text-amber-300',
};
const UNITS = ['pcs', 'set', 'meter', 'Wp', 'kWh', 'ls', 'modules', 'eng days', 'man days', 'Month', 'kg', 'roll'];
const STATUS_OPTS = ['draft', 'sent', 'accepted', 'rejected'] as const;
const STATUS_COLORS: Record<string, string> = {
  draft: 'bg-slate-700/60 text-slate-300',
  sent: 'bg-blue-500/20 text-blue-300',
  accepted: 'bg-emerald-500/20 text-emerald-300',
  rejected: 'bg-red-500/20 text-red-400',
};

const TC_TEMPLATE = `-Solar Modules: (product warranty & power guarantee)
-Inverters: (warranty)
-Actual Energy Production in Year-1: Minimum 90% of the PVSyst As-built result (Produced Energy).
 -- Operational anomalies shall be excluded and not considered in the benchmark, such as:
  > Unpredictable blackout or grid power failure.
  > System shutdown for maintenance or renovation purposes.
  > Product failure not caused by improper installation.
  > Force majeure.

Pricing terms:
-Prices are valid for 14 days.
-Detailed engineering design will be given after PO is received.
-Exclude NIDI & SLO

Payment terms:
-DP I, 30%: against BG, as confirmation of PO and before ordering of materials.
-DP II, 20%: when materials are ready in warehouse and before delivery to site.
-DP III, 45%: after final testing & commissioning.
-DP IV, 5%: 1-year after commissioning (retention period).

Delivery terms:
-Products will be ready to deliver 3 months after receiving DP I.

Thank you for the opportunity. Should you require further clarification please do not hesitate to contact us.`;

const GRIP = (
  <svg className="w-3.5 h-3.5" fill="currentColor" viewBox="0 0 20 20" aria-hidden="true">
    <circle cx="7" cy="5" r="1.4" /><circle cx="13" cy="5" r="1.4" />
    <circle cx="7" cy="10" r="1.4" /><circle cx="13" cy="10" r="1.4" />
    <circle cx="7" cy="15" r="1.4" /><circle cx="13" cy="15" r="1.4" />
  </svg>
);

// ── Main Page ──────────────────────────────────────────────────────────────────

export default function QuoteEditorPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const supabase = createSupabaseClient();
  const { data: catalog, loading: catalogLoading } = useSupabaseData();

  // ── Quote header state ─────────────────────────────────────────────────────
  const [quote, setQuote] = useState<ProjectQuote | null>(null);
  const [sections, setSections] = useState<DraftSection[]>([]);
  const [loadingQuote, setLoadingQuote] = useState(true);
  const [saving, setSaving] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [saveMsg, setSaveMsg] = useState('');

  // ── Autocomplete state ─────────────────────────────────────────────────────
  // x/y anchor the dropdown with position:fixed so the table's overflow-x-auto
  // and the section card's overflow-hidden can't clip it.
  const [acState, setAcState] = useState<{ sectionId: string; itemId: string; query: string; x: number; y: number } | null>(null);
  const acRef = useRef<HTMLDivElement>(null);

  function openAc(sectionId: string, itemId: string, query: string, input: HTMLInputElement) {
    const r = input.getBoundingClientRect();
    setAcState({ sectionId, itemId, query, x: r.left, y: r.bottom });
  }

  // ── GM% inline editing ─────────────────────────────────────────────────────
  // While a GM cell is focused, show the raw typed value instead of the value
  // re-derived from cost/sell — otherwise every keystroke gets rewritten
  // (typing "3" of "30" snaps to the recomputed margin).
  const [gmEdit, setGmEdit] = useState<{ itemId: string; value: string } | null>(null);

  // ── Drag & drop reordering ─────────────────────────────────────────────────
  // Native HTML5 DnD. Dropping on a target inserts before it; dropping a
  // section on a group header appends to that group; dropping a sub-item on a
  // main item re-parents it.
  const [drag, setDrag] = useState<
    | { kind: 'section'; sectionId: string }
    | { kind: 'item'; sectionId: string; itemId: string }
    | null
  >(null);
  const [dropHint, setDropHint] = useState<string | null>(null);

  function endDrag() { setDrag(null); setDropHint(null); }

  function dropSectionOn(targetSectionId: string) {
    if (!drag || drag.kind !== 'section' || drag.sectionId === targetSectionId) return;
    setSections((prev) => {
      const next = [...prev];
      const from = next.findIndex((s) => s.section_id === drag.sectionId);
      if (from < 0) return prev;
      const [moved] = next.splice(from, 1);
      const to = next.findIndex((s) => s.section_id === targetSectionId);
      if (to < 0) return prev;
      next.splice(to, 0, { ...moved, group_key: next[to].group_key });
      return next;
    });
    markDirty();
  }

  function dropSectionOnGroup(group: SectionGroup) {
    if (!drag || drag.kind !== 'section') return;
    setSections((prev) => {
      const from = prev.findIndex((s) => s.section_id === drag.sectionId);
      if (from < 0) return prev;
      const next = [...prev];
      const [moved] = next.splice(from, 1);
      next.push({ ...moved, group_key: group });
      return next;
    });
    markDirty();
  }

  function dropItemOn(targetSectionId: string, targetItemId: string) {
    if (!drag || drag.kind !== 'item' || drag.itemId === targetItemId) return;
    setSections((prev) => {
      const next = prev.map((s) => ({ ...s, items: [...s.items] }));
      const src = next.find((s) => s.section_id === drag.sectionId);
      const dst = next.find((s) => s.section_id === targetSectionId);
      if (!src || !dst) return prev;
      const dragged = src.items.find((i) => i.item_id === drag.itemId);
      const tgt = dst.items.find((i) => i.item_id === targetItemId);
      if (!dragged || !tgt) return prev;
      if (tgt.parent_item_id === dragged.item_id) return prev; // can't drop onto own sub

      if (!dragged.parent_item_id) {
        // Main item moves together with its sub-items, inserted before the
        // target's main item.
        const targetMainId = tgt.parent_item_id ?? tgt.item_id;
        if (targetMainId === dragged.item_id) return prev;
        const subs = src.items.filter((i) => i.parent_item_id === dragged.item_id);
        src.items = src.items.filter((i) => i.item_id !== dragged.item_id && i.parent_item_id !== dragged.item_id);
        const insertAt = dst.items.findIndex((i) => i.item_id === targetMainId);
        if (insertAt < 0) dst.items.push(dragged, ...subs);
        else dst.items.splice(insertAt, 0, dragged, ...subs);
      } else {
        // Sub-item: before a fellow sub (adopting its parent), or onto a main
        // item to become its sub.
        src.items = src.items.filter((i) => i.item_id !== dragged.item_id);
        if (tgt.parent_item_id) {
          const insertAt = dst.items.findIndex((i) => i.item_id === tgt.item_id);
          dst.items.splice(insertAt, 0, { ...dragged, parent_item_id: tgt.parent_item_id });
        } else {
          const tgtIdx = dst.items.findIndex((i) => i.item_id === tgt.item_id);
          dst.items.splice(tgtIdx + 1, 0, { ...dragged, parent_item_id: tgt.item_id });
        }
      }
      return next;
    });
    markDirty();
  }

  // ── Last-used prices from other project quotes ─────────────────────────────
  const [prevUsed, setPrevUsed] = useState<Map<string, CostEntry[]>>(new Map());

  // Free-text items (no catalog link) from other quotes — deduped by
  // description, newest usage wins. Feeds the autocomplete and, via
  // freeTextHistory, the cost-cell hover for non-catalog items.
  interface PrevItem {
    description: string; brand: string; unit: string;
    cost_price: number | null; sell_price: number | null;
    label: string; date: string; count: number;
  }
  const [prevItems, setPrevItems] = useState<PrevItem[]>([]);
  const [freeTextHistory, setFreeTextHistory] = useState<Map<string, CostEntry[]>>(new Map());

  useEffect(() => {
    fetchUsedEntries(supabase, id).then(setPrevUsed);

    async function loadPrevItems() {
      const [itemsRes, quotesRes] = await Promise.all([
        supabase.from('10.2_quote_items')
          .select('description, brand, unit, cost_price, sell_price, quote_id, parent_item_id')
          .is('component_id', null)
          .neq('quote_id', id),
        supabase.from('10.0_project_quotes').select('quote_id, quote_number, quote_date'),
      ]);
      const qMap = new Map((quotesRes.data ?? []).map((q) => [q.quote_id as string, q]));
      const byDesc = new Map<string, PrevItem>();
      const hist = new Map<string, CostEntry[]>();
      for (const it of itemsRes.data ?? []) {
        const desc = String(it.description ?? '').trim();
        if (it.parent_item_id || desc.length < 3) continue;
        const q = qMap.get(it.quote_id as string);
        const date = (q?.quote_date as string) ?? '';
        const label = (q?.quote_number as string) || 'Project quote';
        const key = desc.toLowerCase();

        const cost = Number(it.cost_price);
        if (cost > 0) {
          const arr = hist.get(key) ?? [];
          arr.push({ kind: 'used', label, date, unitCost: cost });
          hist.set(key, arr);
        }

        const existing = byDesc.get(key);
        if (existing) {
          existing.count += 1;
          if (date > existing.date) {
            Object.assign(existing, {
              description: desc, brand: String(it.brand ?? ''), unit: String(it.unit ?? ''),
              cost_price: it.cost_price != null ? Number(it.cost_price) : null,
              sell_price: it.sell_price != null ? Number(it.sell_price) : null,
              label, date,
            });
          }
        } else {
          byDesc.set(key, {
            description: desc, brand: String(it.brand ?? ''), unit: String(it.unit ?? ''),
            cost_price: it.cost_price != null ? Number(it.cost_price) : null,
            sell_price: it.sell_price != null ? Number(it.sell_price) : null,
            label, date, count: 1,
          });
        }
      }
      for (const arr of hist.values()) arr.sort((a, b) => b.date.localeCompare(a.date));
      setPrevItems([...byDesc.values()]);
      setFreeTextHistory(hist);
    }
    loadPrevItems();
  }, [id]);

  // Browser tab shows which quote is open
  useEffect(() => {
    if (!quote) return;
    const parts = [quote.quote_number || 'Quote', quote.customer_name].filter(Boolean);
    document.title = `${parts.join(' · ')} | ICAPROC`;
  }, [quote?.quote_number, quote?.customer_name]);

  const costFor = useCallback((componentId: string) =>
    getComponentCost(componentId, catalog.pos, catalog.poItems, catalog.poCosts, catalog.quotes, catalog.quoteItems, prevUsed.get(componentId) ?? []),
  [catalog.pos, catalog.poItems, catalog.poCosts, catalog.quotes, catalog.quoteItems, prevUsed]);

  // ── System size (Wp) ───────────────────────────────────────────────────────
  // Wp per module: catalog norm_value for pv_module components, else parsed
  // from the description ("...720Wp..."). Lines with unit 'Wp' keep the old
  // behavior where qty is already total Wp.
  const wpPerModule = useCallback((item: DraftItem): number => {
    if (item.component_id) {
      const comp = catalog.components.find((c) => c.component_id === item.component_id);
      if (comp?.category === 'pv_module' && Number(comp.norm_value) > 0) return Number(comp.norm_value);
    }
    const m = item.description.match(/(\d{2,4}(?:[.,]\d+)?)\s*wp\b/i);
    return m ? parseFloat(m[1].replace(',', '.')) : 0;
  }, [catalog.components]);

  const itemWp = useCallback((item: DraftItem): number => {
    if (item._deleted || item.parent_item_id) return 0;
    const qty = num(item.quantity) ?? 0;
    if (item.unit.trim().toLowerCase() === 'wp') return qty;
    return qty * wpPerModule(item);
  }, [wpPerModule]);

  // ── Refresh all costs to latest, preserving each item's margin ─────────────
  function refreshCosts() {
    setSections((prev) => prev.map((s) => ({
      ...s,
      items: s.items.map((it) => {
        if (it._deleted || !it.component_id) return it;
        const cc = costFor(it.component_id);
        if (!cc) return it;
        const newCost = Math.round(cc.cost);
        const oldCost = num(it.cost_price), oldSell = num(it.sell_price);
        let sell = it.sell_price;
        if (oldCost && oldSell && oldSell > 0) {
          const gmFrac = 1 - oldCost / oldSell;
          if (gmFrac < 1) sell = String(Math.round(newCost / (1 - gmFrac)));
        }
        return { ...it, cost_price: String(newCost), sell_price: sell };
      }),
    })));
    markDirty();
    setSaveMsg('Costs refreshed');
    setTimeout(() => setSaveMsg(''), 2500);
  }

  // ── Cost history hover popup ───────────────────────────────────────────────
  const [costHover, setCostHover] = useState<{ itemId: string; history: CostEntry[]; source: string; x: number; y: number } | null>(null);

  function showCostHistory(itemId: string, componentId: string | null, description: string, el: HTMLElement) {
    let history: CostEntry[] = [];
    let source = 'used';
    if (componentId) {
      const cc = costFor(componentId);
      if (cc) { history = cc.history; source = cc.source; }
    } else {
      // Free-text items: match previous usage by description
      history = freeTextHistory.get(description.trim().toLowerCase()) ?? [];
    }
    if (!history.length) return;
    const r = el.getBoundingClientRect();
    setCostHover({ itemId, history: history.slice(0, 10), source, x: r.right, y: r.bottom });
  }

  // ── Load quote from DB ─────────────────────────────────────────────────────
  useEffect(() => {
    async function load() {
      setLoadingQuote(true);
      const [qRes, secRes, itemRes] = await Promise.all([
        supabase.from('10.0_project_quotes').select('*').eq('quote_id', id).single(),
        supabase.from('10.1_quote_sections').select('*').eq('quote_id', id).order('sort_order'),
        supabase.from('10.2_quote_items').select('*').eq('quote_id', id).order('sort_order'),
      ]);
      if (!qRes.data) { router.push('/quotes'); return; }
      setQuote(qRes.data as ProjectQuote);

      const dbSections = (secRes.data ?? []) as QuoteSection[];
      const dbItems    = (itemRes.data ?? []) as QuoteItem[];

      setSections(dbSections.map((sec) => ({
        section_id: sec.section_id,
        group_key: (sec.group_key as SectionGroup) || 'bos',
        title: sec.title,
        lead_time: sec.lead_time,
        sort_order: sec.sort_order,
        items: dbItems
          .filter((i) => i.section_id === sec.section_id)
          .map((i) => ({
            item_id: i.item_id,
            parent_item_id: i.parent_item_id,
            component_id: i.component_id,
            description: i.description,
            brand: i.brand,
            quantity: i.quantity != null ? String(i.quantity) : '',
            unit: i.unit,
            cost_price: i.cost_price != null ? String(i.cost_price) : '',
            sell_price: i.sell_price != null ? String(i.sell_price) : '',
            sort_order: i.sort_order,
          })),
      })));
      setLoadingQuote(false);
    }
    load();
  }, [id]);

  // ── Close autocomplete on outside click / scroll / resize ─────────────────
  useEffect(() => {
    function handler(e: MouseEvent) {
      if (acRef.current && !acRef.current.contains(e.target as Node)) setAcState(null);
    }
    const close = (e: Event) => {
      if (e.target instanceof Element && e.target.closest('[data-ac-dropdown]')) return;
      setAcState(null);
    };
    document.addEventListener('mousedown', handler);
    window.addEventListener('scroll', close, true);
    window.addEventListener('resize', close);
    return () => {
      document.removeEventListener('mousedown', handler);
      window.removeEventListener('scroll', close, true);
      window.removeEventListener('resize', close);
    };
  }, []);

  // ── Filtered autocomplete results: catalog components + past quote items ───
  const acResults = useMemo(() => {
    if (!acState || acState.query.length < 2) return { comps: [] as Component[], prev: [] as PrevItem[] };
    const q = acState.query.toLowerCase();
    const comps = catalog.components
      .filter((c) =>
        c.supplier_model?.toLowerCase().includes(q) ||
        c.brand?.toLowerCase().includes(q) ||
        c.category?.toLowerCase().includes(q)
      )
      .slice(0, 6);
    const compNames = new Set(comps.map((c) => (c.supplier_model ?? '').trim().toLowerCase()));
    const prev = prevItems
      .filter((p) =>
        (p.description.toLowerCase().includes(q) || p.brand.toLowerCase().includes(q)) &&
        !compNames.has(p.description.toLowerCase())
      )
      .sort((a, b) => b.date.localeCompare(a.date))
      .slice(0, 4);
    return { comps, prev };
  }, [acState, catalog.components, prevItems]);
  const acCount = acResults.comps.length + acResults.prev.length;

  // ── Computed totals ────────────────────────────────────────────────────────
  const { subtotal, ppn, grandTotal, totalWp } = useMemo(() => {
    let sub = 0, wp = 0;
    for (const sec of sections) {
      if (sec._deleted) continue;
      for (const item of sec.items) {
        if (item._deleted || item.parent_item_id) continue;
        const qty = num(item.quantity) ?? 0;
        const sell = num(item.sell_price) ?? 0;
        sub += qty * sell;
        // System size from the Solar Panels group: module qty × Wp/module
        if (sec.group_key === 'solar_panels') wp += itemWp(item);
      }
    }
    const ppnPct = num(quote?.ppn_pct?.toString() ?? '') ?? 11;
    const tax = sub * ppnPct / 100;
    return { subtotal: sub, ppn: tax, grandTotal: sub + tax, totalWp: wp };
  }, [sections, quote?.ppn_pct, itemWp]);

  // ── Mutations ──────────────────────────────────────────────────────────────

  function markDirty() { setDirty(true); setSaveMsg(''); }

  function setQuoteField<K extends keyof ProjectQuote>(key: K, val: ProjectQuote[K]) {
    setQuote((q) => q ? { ...q, [key]: val } : q);
    markDirty();
  }

  function addSection(group: SectionGroup) {
    setSections((prev) => [
      ...prev,
      { section_id: uid(), group_key: group, title: '', lead_time: 'Ready', sort_order: prev.length, items: [] },
    ]);
    markDirty();
  }

  function updateSection(sid: string, patch: Partial<DraftSection>) {
    setSections((prev) => prev.map((s) => s.section_id === sid ? { ...s, ...patch } : s));
    markDirty();
  }

  function deleteSection(sid: string) {
    setSections((prev) => prev.map((s) => s.section_id === sid ? { ...s, _deleted: true } : s));
    markDirty();
  }

  function addItem(sid: string, parentId: string | null = null) {
    setSections((prev) => prev.map((s) => {
      if (s.section_id !== sid) return s;
      const order = s.items.length;
      return { ...s, items: [...s.items, {
        item_id: uid(), parent_item_id: parentId, component_id: null,
        description: '', brand: '', quantity: '', unit: '', cost_price: '', sell_price: '',
        sort_order: order,
      }] };
    }));
    markDirty();
  }

  function updateItem(sid: string, iid: string, patch: Partial<DraftItem>) {
    setSections((prev) => prev.map((s) => {
      if (s.section_id !== sid) return s;
      return { ...s, items: s.items.map((i) => i.item_id === iid ? { ...i, ...patch } : i) };
    }));
    markDirty();
  }

  function deleteItem(sid: string, iid: string) {
    setSections((prev) => prev.map((s) => {
      if (s.section_id !== sid) return s;
      return { ...s, items: s.items.map((i) => i.item_id === iid ? { ...i, _deleted: true } : i) };
    }));
    markDirty();
  }

  // ── Autocomplete selection ─────────────────────────────────────────────────
  function selectPrevItem(sid: string, iid: string, p: PrevItem) {
    updateItem(sid, iid, {
      component_id: null,
      description: p.description,
      brand: p.brand,
      unit: p.unit,
      cost_price: p.cost_price != null ? String(Math.round(p.cost_price)) : '',
      sell_price: p.sell_price != null ? String(Math.round(p.sell_price)) : '',
    });
    setAcState(null);
  }

  function selectComponent(sid: string, iid: string, comp: Component) {
    const cc = costFor(comp.component_id);
    const costStr = cc ? Math.round(cc.cost).toString() : '';
    updateItem(sid, iid, {
      component_id: comp.component_id,
      description: comp.supplier_model ?? '',
      brand: comp.brand ?? '',
      unit: comp.category === 'pv_module' ? 'modules' : 'pcs',
      cost_price: costStr,
    });
    setAcState(null);
  }

  // ── Save ───────────────────────────────────────────────────────────────────
  async function save() {
    if (!quote) return;
    setSaving(true);
    try {
      // 1. Upsert quote header
      await supabase.from('10.0_project_quotes').upsert({
        quote_id: quote.quote_id,
        quote_number: quote.quote_number,
        quote_date: quote.quote_date,
        company_id: quote.company_id ?? null,
        customer_name: quote.customer_name,
        customer_address: quote.customer_address,
        project_description: quote.project_description,
        ppn_pct: num(String(quote.ppn_pct)) ?? 11,
        status: quote.status,
        notes: quote.notes,
        updated_at: new Date().toISOString(),
      });

      // 2. Collect deletes
      const deletedSecIds = sections.filter((s) => s._deleted).map((s) => s.section_id);
      const deletedItemIds = sections.flatMap((s) => s.items.filter((i) => i._deleted).map((i) => i.item_id));
      if (deletedItemIds.length) await supabase.from('10.2_quote_items').delete().in('item_id', deletedItemIds);
      if (deletedSecIds.length)  await supabase.from('10.1_quote_sections').delete().in('section_id', deletedSecIds);

      // 3. Upsert live sections, ordered by group (solar → bos → services)
      const groupOrder = SECTION_GROUPS.map((g) => g.key);
      const liveSections = sections
        .filter((s) => !s._deleted)
        .sort((a, b) => groupOrder.indexOf(a.group_key) - groupOrder.indexOf(b.group_key));
      if (liveSections.length) {
        await supabase.from('10.1_quote_sections').upsert(
          liveSections.map((s, i) => ({
            section_id: s.section_id, quote_id: id, group_key: s.group_key,
            title: s.title, lead_time: s.lead_time, sort_order: i,
          }))
        );
      }

      // 4. Upsert live items
      const liveItems = liveSections.flatMap((s) =>
        s.items.filter((i) => !i._deleted).map((i, idx) => ({
          item_id: i.item_id, section_id: s.section_id, quote_id: id,
          parent_item_id: i.parent_item_id,
          component_id: i.component_id ?? null,
          description: i.description, brand: i.brand,
          quantity: num(i.quantity), unit: i.unit,
          cost_price: num(i.cost_price), sell_price: num(i.sell_price),
          sort_order: idx,
        }))
      );
      if (liveItems.length) await supabase.from('10.2_quote_items').upsert(liveItems);

      setDirty(false);
      setSaveMsg('Saved');
      setTimeout(() => setSaveMsg(''), 2500);
    } catch {
      setSaveMsg('Error saving');
    }
    setSaving(false);
  }

  // ── Export to Excel (HTML table) ───────────────────────────────────────────
  // Client-facing layout: group bars → sub-section rows with subtotal in AMOUNT,
  // item rows show qty/unit only (no per-line prices).
  function exportExcel() {
    if (!quote) return;
    const liveSecs = sections.filter((s) => !s._deleted);
    const ppnPct = num(String(quote.ppn_pct)) ?? 11;
    const wpTotal = liveSecs
      .filter((s) => s.group_key === 'solar_panels')
      .flatMap((s) => s.items.filter((i) => !i._deleted && !i.parent_item_id))
      .reduce((s, i) => s + itemWp(i), 0);

    let rows = '';
    for (const group of SECTION_GROUPS) {
      const groupSecs = liveSecs.filter((s) => s.group_key === group.key);
      if (!groupSecs.length) continue;
      rows += `<tr style="background:#1e3a5f;color:#fff;font-weight:bold">
        <td colspan="6">${group.label}</td>
      </tr>`;
      for (const sec of groupSecs) {
        const secTotal = sec.items.filter((i) => !i._deleted && !i.parent_item_id)
          .reduce((s, i) => s + (num(i.quantity) ?? 0) * (num(i.sell_price) ?? 0), 0);
        rows += `<tr style="background:#e8eef7;font-weight:bold;color:#1e3a5f">
          <td colspan="2">${sec.title}</td>
          <td>${sec.lead_time}</td>
          <td></td><td></td>
          <td style="text-align:right">${secTotal > 0 ? fmtIdr(secTotal) : ''}</td>
        </tr>`;
        for (const item of sec.items.filter((i) => !i._deleted)) {
          const isChild = !!item.parent_item_id;
          rows += `<tr style="${isChild ? 'font-style:italic;color:#555' : ''}">
            <td style="padding-left:${isChild ? '24' : '8'}px">${item.description}</td>
            <td>${item.brand}</td>
            <td></td>
            <td style="text-align:right">${item.quantity ?? ''}</td>
            <td>${item.unit}</td>
            <td></td>
          </tr>`;
          if (sec.group_key === 'solar_panels' && !isChild && itemWp(item) > 0 && item.unit.trim().toLowerCase() !== 'wp') {
            rows += `<tr style="font-style:italic;color:#1a7f4f">
              <td style="padding-left:24px">Total system size</td>
              <td></td><td></td>
              <td style="text-align:right;font-weight:bold">${itemWp(item).toLocaleString('en-US')}</td>
              <td>Wp</td>
              <td></td>
            </tr>`;
          }
        }
      }
    }

    const html = `<html><head><meta charset="utf-8"/>
    <style>table{border-collapse:collapse;width:100%}th,td{border:1px solid #ccc;padding:4px 8px;font-size:11px}th{background:#1e3a5f;color:#fff}</style>
    </head><body>
    <p><b>CUSTOMER:</b> ${quote.customer_name}</p>
    <p>${quote.customer_address}</p>
    <p>${quote.project_description}</p>
    <p style="text-align:right"><b>QUOTE ID:</b> ${quote.quote_number} &nbsp; ${quote.quote_date}</p>
    <table>
      <tr><th>ITEMS</th><th>BRAND</th><th>LEAD TIME</th><th>QTY</th><th>UNIT</th><th>AMOUNT</th></tr>
      ${rows}
      <tr><td colspan="5" style="text-align:right;font-weight:bold">Total (excl. PPN${ppnPct}%)</td>
          <td style="text-align:right">${fmtIdr(subtotal)}</td></tr>
      <tr><td colspan="5" style="text-align:right">PPN${ppnPct}%</td>
          <td style="text-align:right">${fmtIdr(ppn)}</td></tr>
      <tr><td colspan="5" style="text-align:right;font-weight:bold">GRAND TOTAL</td>
          <td style="text-align:right;font-weight:bold">${fmtIdr(grandTotal)}</td></tr>
      ${wpTotal > 0 ? `
      <tr><td colspan="5" style="text-align:right;font-weight:bold">Harga per Wp (Exc. PPN${ppnPct}%)</td>
          <td style="text-align:right;font-weight:bold">${fmtIdr(subtotal / wpTotal)}</td></tr>
      <tr><td colspan="5" style="text-align:right;font-weight:bold">Harga per Wp (Inc. PPN${ppnPct}%)</td>
          <td style="text-align:right;font-weight:bold">${fmtIdr(grandTotal / wpTotal)}</td></tr>` : ''}
    </table>
    ${quote.notes ? `
    <p style="font-weight:bold;margin-top:16px;text-transform:uppercase">Terms and Conditions</p>
    ${quote.notes.split('\n').map((l) => {
      const t = l.trim();
      if (!t) return '<p style="margin:0">&nbsp;</p>';
      if (/:$/.test(t)) return `<p style="margin:0;font-size:11px;text-decoration:underline">${l}</p>`;
      return `<p style="margin:0;font-size:11px;font-style:italic">${l}</p>`;
    }).join('')}` : ''}
    </body></html>`;

    const blob = new Blob([html], { type: 'application/vnd.ms-excel' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `${quoteFileName(quote.quote_number, quote.customer_name, wpTotal)}.xls`;
    a.click();
  }

  // ── Render ─────────────────────────────────────────────────────────────────

  if (loadingQuote || !quote) {
    return <div className="min-h-screen bg-[#0B1120] flex items-center justify-center text-slate-500">Loading…</div>;
  }

  const liveSections = sections.filter((s) => !s._deleted);

  return (
    <div className="min-h-screen bg-[#0B1120] text-slate-200 font-sans text-sm">

      {/* ── Sticky header ── */}
      <div className="sticky top-0 z-40 bg-[#0B1120]/95 backdrop-blur-xl border-b border-white/[0.07]">
        <div className="max-w-[1400px] mx-auto px-6 py-3 flex items-center justify-between gap-4">
          <div className="flex items-center gap-3 min-w-0">
            <Link href="/quotes" className="text-slate-500 hover:text-slate-300 transition-colors flex-shrink-0">
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M15 19l-7-7 7-7" /></svg>
            </Link>
            <div className="min-w-0">
              <p className="text-[11px] text-slate-500 truncate">{quote.customer_name || 'No customer'}</p>
              <p className="font-semibold text-white truncate text-base leading-tight">{quote.quote_number}</p>
            </div>
          </div>
          <div className="flex items-center gap-2 flex-shrink-0">
            {/* Status selector */}
            <select
              value={quote.status}
              onChange={(e) => setQuoteField('status', e.target.value as ProjectQuote['status'])}
              className={`px-2.5 py-1 rounded-full text-[11px] font-semibold uppercase tracking-wider border-0 outline-none cursor-pointer ${STATUS_COLORS[quote.status]}`}
            >
              {STATUS_OPTS.map((s) => <option key={s} value={s}>{s}</option>)}
            </select>
            {saveMsg && <span className={`text-[11px] ${saveMsg === 'Saved' ? 'text-emerald-400' : 'text-red-400'}`}>{saveMsg}</span>}
            {dirty && !saving && <span className="text-[11px] text-amber-400">Unsaved</span>}
            <button onClick={refreshCosts} disabled={catalogLoading}
              title="Update every catalog-linked item to its latest cost (TUC → supplier quote → last used), keeping each item's margin"
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[11px] font-medium text-slate-400 hover:text-white hover:bg-white/10 border border-white/[0.06] transition-all disabled:opacity-40">
              <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" /></svg>
              Costs
            </button>
            <Link href={`/quotes/${id}/print`} target="_blank"
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[11px] font-medium text-slate-400 hover:text-white hover:bg-white/10 border border-white/[0.06] transition-all">
              <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M17 17h2a2 2 0 002-2v-4a2 2 0 00-2-2H5a2 2 0 00-2 2v4a2 2 0 002 2h2m2 4h6a2 2 0 002-2v-4a2 2 0 00-2-2H9a2 2 0 00-2 2v4a2 2 0 002 2zm8-12V5a2 2 0 00-2-2H9a2 2 0 00-2 2v4h10z" /></svg>
              PDF
            </Link>
            <button onClick={exportExcel}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[11px] font-medium text-slate-400 hover:text-white hover:bg-white/10 border border-white/[0.06] transition-all">
              <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 10v6m0 0l-3-3m3 3l3-3m2 8H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" /></svg>
              Excel
            </button>
            <button onClick={save} disabled={saving || !dirty}
              className="flex items-center gap-1.5 px-4 py-1.5 rounded-lg text-[11px] font-semibold bg-violet-600 hover:bg-violet-500 text-white transition-all disabled:opacity-40">
              {saving ? 'Saving…' : 'Save'}
            </button>
          </div>
        </div>
      </div>

      <main className="max-w-[1400px] mx-auto px-6 py-6 space-y-6">

        {/* ── Header form ── */}
        <div className="bg-slate-900/50 border border-slate-800 rounded-2xl p-5 grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <label className="block text-[10px] uppercase tracking-widest text-slate-500 mb-1">From (Company)</label>
            <select
              value={quote.company_id ?? ''}
              onChange={(e) => setQuoteField('company_id', e.target.value || null)}
              className="w-full bg-transparent border-b border-slate-700 focus:border-violet-500 outline-none text-white py-1 text-sm transition-colors"
            >
              <option value="" className="bg-slate-900">– Select –</option>
              {catalog.companies.map((c) => (
                <option key={c.company_id} value={c.company_id} className="bg-slate-900">{c.legal_name}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-[10px] uppercase tracking-widest text-slate-500 mb-1">Customer</label>
            <input value={quote.customer_name} onChange={(e) => setQuoteField('customer_name', e.target.value)}
              placeholder="Customer name" className="w-full bg-transparent border-b border-slate-700 focus:border-violet-500 outline-none text-white py-1 text-sm placeholder:text-slate-600 transition-colors" />
          </div>
          <div>
            <label className="block text-[10px] uppercase tracking-widest text-slate-500 mb-1">Address</label>
            <input value={quote.customer_address} onChange={(e) => setQuoteField('customer_address', e.target.value)}
              placeholder="Customer address" className="w-full bg-transparent border-b border-slate-700 focus:border-violet-500 outline-none text-white py-1 text-sm placeholder:text-slate-600 transition-colors" />
          </div>
          <div className="md:col-span-2">
            <label className="block text-[10px] uppercase tracking-widest text-slate-500 mb-1">Project Description</label>
            <input value={quote.project_description} onChange={(e) => setQuoteField('project_description', e.target.value)}
              placeholder="e.g. EPC for solar On Grid 2.2 kWp DC / 2 kW AC, at Kota Tangerang" className="w-full bg-transparent border-b border-slate-700 focus:border-violet-500 outline-none text-white py-1 text-sm placeholder:text-slate-600 transition-colors" />
          </div>
          <div>
            <label className="block text-[10px] uppercase tracking-widest text-slate-500 mb-1">Quote Number</label>
            <input value={quote.quote_number} onChange={(e) => setQuoteField('quote_number', e.target.value)}
              placeholder="e.g. 082-0126_RUMAHIBUDIANA" className="w-full bg-transparent border-b border-slate-700 focus:border-violet-500 outline-none text-white py-1 text-sm placeholder:text-slate-600 transition-colors" />
          </div>
          <div className="flex gap-4">
            <div className="flex-1">
              <label className="block text-[10px] uppercase tracking-widest text-slate-500 mb-1">Date</label>
              <input type="date" value={quote.quote_date} onChange={(e) => setQuoteField('quote_date', e.target.value)}
                className="w-full bg-transparent border-b border-slate-700 focus:border-violet-500 outline-none text-white py-1 text-sm transition-colors" />
            </div>
            <div className="w-24">
              <label className="block text-[10px] uppercase tracking-widest text-slate-500 mb-1">PPN %</label>
              <input type="number" value={quote.ppn_pct} onChange={(e) => setQuoteField('ppn_pct', parseFloat(e.target.value) || 11)}
                className="w-full bg-transparent border-b border-slate-700 focus:border-violet-500 outline-none text-white py-1 text-sm transition-colors" />
            </div>
          </div>
        </div>

        {/* ── Groups & sub-sections ── */}
        <div className="space-y-8" ref={acRef}>
          {SECTION_GROUPS.map((group) => {
            const groupSections = liveSections.filter((s) => s.group_key === group.key);
            const groupTotal = groupSections.reduce((gs, s) =>
              gs + s.items.filter((i) => !i._deleted && !i.parent_item_id)
                .reduce((ss, i) => ss + (num(i.quantity) ?? 0) * (num(i.sell_price) ?? 0), 0), 0);
            return (
              <div key={group.key}>
                {/* Group header — also a drop zone: sections dropped here go to the end of this group */}
                <div
                  className={`flex items-center justify-between mb-3 px-1 border-b-2 pb-2 transition-colors ${dropHint === `group:${group.key}` ? 'border-violet-500 bg-violet-500/10 rounded-t-lg' : 'border-[#1e3a5f]'}`}
                  onDragOver={(e) => { if (drag?.kind === 'section') { e.preventDefault(); setDropHint(`group:${group.key}`); } }}
                  onDragLeave={() => setDropHint((h) => h === `group:${group.key}` ? null : h)}
                  onDrop={(e) => { e.preventDefault(); dropSectionOnGroup(group.key); endDrag(); }}
                >
                  <h2 className="text-sm font-extrabold uppercase tracking-widest text-white">
                    {group.label}
                    <span className="ml-2 text-slate-600 font-normal normal-case tracking-normal text-xs">
                      {groupSections.length || 'no'} sub-section{groupSections.length !== 1 ? 's' : ''}
                    </span>
                  </h2>
                  {groupTotal > 0 && <span className="text-sm font-bold text-slate-200 tabular-nums">{fmtIdr(groupTotal)}</span>}
                </div>
                <div className="space-y-3">
                  {groupSections.map((sec) => {
            const liveItems = sec.items.filter((i) => !i._deleted);
            const mainItems = liveItems.filter((i) => !i.parent_item_id);
            const secSubtotal = mainItems.reduce((s, i) => s + (num(i.quantity) ?? 0) * (num(i.sell_price) ?? 0), 0);

            return (
              <div
                key={sec.section_id}
                className={`bg-slate-900/50 border rounded-2xl overflow-hidden transition-colors ${dropHint === sec.section_id ? 'border-violet-500 ring-1 ring-violet-500/50' : 'border-slate-800'}`}
                onDragOver={(e) => { if (drag?.kind === 'section' && drag.sectionId !== sec.section_id) { e.preventDefault(); setDropHint(sec.section_id); } }}
                onDragLeave={() => setDropHint((h) => h === sec.section_id ? null : h)}
                onDrop={(e) => { e.preventDefault(); dropSectionOn(sec.section_id); endDrag(); }}
              >
                {/* Section header */}
                <div className="flex items-center gap-3 px-4 py-3 bg-slate-800/60 border-b border-slate-700/50">
                  <span
                    draggable
                    onDragStart={(e) => { e.dataTransfer.effectAllowed = 'move'; setDrag({ kind: 'section', sectionId: sec.section_id }); }}
                    onDragEnd={endDrag}
                    className="cursor-grab active:cursor-grabbing text-slate-600 hover:text-slate-300 flex-shrink-0 -ml-1"
                    title="Drag to reorder / move to another group"
                  >
                    {GRIP}
                  </span>
                  <div className="flex-1 flex items-center gap-2 group/title min-w-0">
                    <svg className="w-3.5 h-3.5 text-slate-500 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" /></svg>
                    <input
                      value={sec.title}
                      onChange={(e) => updateSection(sec.section_id, { title: e.target.value })}
                      onFocus={(e) => e.target.select()}
                      className="flex-1 min-w-0 bg-transparent outline-none font-semibold text-white placeholder:text-slate-500 border-b border-dashed border-slate-600 group-hover/title:border-slate-400 focus:border-solid focus:border-violet-500 transition-colors py-0.5"
                      placeholder="Click to name this section…"
                      title="Click to rename section"
                    />
                  </div>
                  {LEAD_TIMES.includes(sec.lead_time) && sec.lead_time !== 'Custom' ? (
                    <select
                      value={sec.lead_time}
                      onChange={(e) => updateSection(sec.section_id, { lead_time: e.target.value === 'Custom' ? '' : e.target.value })}
                      className="bg-slate-800 border border-slate-700 rounded-lg px-2 py-1 text-xs text-slate-300 outline-none"
                    >
                      {LEAD_TIMES.map((l) => <option key={l}>{l}</option>)}
                    </select>
                  ) : (
                    <div className="flex items-center gap-1">
                      <input
                        value={sec.lead_time === 'Custom' ? '' : sec.lead_time}
                        onChange={(e) => updateSection(sec.section_id, { lead_time: e.target.value })}
                        placeholder="e.g. 4 bulan"
                        className="w-24 bg-slate-800 border border-slate-700 focus:border-violet-500 rounded-lg px-2 py-1 text-xs text-slate-300 outline-none transition-colors"
                      />
                      <button
                        onClick={() => updateSection(sec.section_id, { lead_time: 'Ready' })}
                        className="text-slate-600 hover:text-slate-300 transition-colors text-xs px-1"
                        title="Back to preset list"
                      >
                        ↺
                      </button>
                    </div>
                  )}
                  {secSubtotal > 0 && (
                    <span className="text-[11px] text-slate-400 whitespace-nowrap">
                      {fmtIdr(secSubtotal)}
                      {subtotal > 0 && (
                        <span className="ml-1.5 text-amber-400/90 font-semibold" title="Share of total before PPN">
                          {((secSubtotal / subtotal) * 100).toLocaleString('en-US', { maximumFractionDigits: 1 })}%
                        </span>
                      )}
                    </span>
                  )}
                  <button onClick={() => deleteSection(sec.section_id)} className="text-slate-600 hover:text-red-400 transition-colors p-1">
                    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M6 18L18 6M6 6l12 12" /></svg>
                  </button>
                </div>

                {/* Items table */}
                <div className="overflow-x-auto">
                  <table className="w-full text-xs">
                    <thead>
                      <tr className="border-b border-slate-800 text-[10px] uppercase tracking-wider text-slate-500">
                        <th className="w-6" />
                        <th className="text-left px-2 py-2 min-w-[260px]">Description</th>
                        <th className="text-left px-2 py-2 w-28">Brand</th>
                        <th className="text-right px-2 py-2 w-20">Qty</th>
                        <th className="text-left px-2 py-2 w-24">Unit</th>
                        <th className="text-right px-2 py-2 w-32 text-slate-600">TUC / Cost</th>
                        <th className="text-right px-2 py-2 w-32">Sell / Unit</th>
                        <th className="text-right px-2 py-2 w-16">GM %</th>
                        <th className="text-right px-2 py-2 w-28">Total</th>
                        <th className="w-8" />
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-800/40">
                      {mainItems.map((item) => {
                        const subItems = liveItems.filter((i) => i.parent_item_id === item.item_id);
                        const total = (num(item.quantity) ?? 0) * (num(item.sell_price) ?? 0);
                        const gm = gmFromPrices(item.cost_price, item.sell_price);
                        const isAcOpen = acState?.itemId === item.item_id;

                        return (
                          <React.Fragment key={item.item_id}>
                            {/* Main item row */}
                            <tr
                              className={`hover:bg-white/[0.02] transition-colors ${dropHint === item.item_id ? 'bg-violet-500/10' : ''}`}
                              onDragOver={(e) => { if (drag?.kind === 'item' && drag.itemId !== item.item_id) { e.preventDefault(); setDropHint(item.item_id); } }}
                              onDragLeave={() => setDropHint((h) => h === item.item_id ? null : h)}
                              onDrop={(e) => { e.preventDefault(); e.stopPropagation(); dropItemOn(sec.section_id, item.item_id); endDrag(); }}
                            >
                              <td className="pl-2 py-2">
                                <span
                                  draggable
                                  onDragStart={(e) => { e.dataTransfer.effectAllowed = 'move'; setDrag({ kind: 'item', sectionId: sec.section_id, itemId: item.item_id }); }}
                                  onDragEnd={endDrag}
                                  className="cursor-grab active:cursor-grabbing text-slate-700 hover:text-slate-400 inline-block"
                                  title="Drag to reorder or move to another section"
                                >
                                  {GRIP}
                                </span>
                              </td>
                              <td className="px-2 py-2 relative">
                                <input
                                  value={item.description}
                                  onChange={(e) => {
                                    updateItem(sec.section_id, item.item_id, { description: e.target.value });
                                    openAc(sec.section_id, item.item_id, e.target.value, e.target);
                                  }}
                                  onFocus={(e) => item.description && openAc(sec.section_id, item.item_id, item.description, e.target)}
                                  placeholder="Type to search catalog & past quotes…"
                                  className="w-full bg-transparent outline-none text-slate-200 placeholder:text-slate-700"
                                />
                                {/* Autocomplete dropdown — fixed so table overflow can't clip it */}
                                {isAcOpen && acState && acCount > 0 && (
                                  <div
                                    data-ac-dropdown
                                    className="fixed z-50 w-[420px] max-w-[calc(100vw-32px)] max-h-80 overflow-y-auto bg-slate-900 border border-slate-700 rounded-xl shadow-2xl"
                                    style={{ left: Math.min(acState.x, Math.max(16, window.innerWidth - 436)), top: acState.y + 4 }}
                                  >
                                    {acResults.comps.map((comp) => {
                                      const cc = catalogLoading ? null : costFor(comp.component_id);
                                      return (
                                        <button
                                          key={comp.component_id}
                                          onMouseDown={(e) => { e.preventDefault(); selectComponent(sec.section_id, item.item_id, comp); }}
                                          className="w-full text-left px-4 py-2.5 hover:bg-slate-800 transition-colors flex items-center justify-between gap-3"
                                        >
                                          <div className="min-w-0">
                                            <p className="text-slate-200 font-medium truncate">{comp.supplier_model}</p>
                                            <p className="text-[10px] text-slate-500">{[comp.brand, comp.category].filter(Boolean).join(' · ')}</p>
                                          </div>
                                          <div className="text-right flex-shrink-0">
                                            {cc ? <p className={`font-semibold text-xs ${SOURCE_TEXT[cc.source]}`}>{fmtIdr(cc.cost)}</p>
                                                : <p className="text-slate-600 text-[10px]">no price data</p>}
                                            {cc && <p className="text-[10px] text-slate-600">{SOURCE_LABEL[cc.source]}</p>}
                                          </div>
                                        </button>
                                      );
                                    })}
                                    {acResults.prev.length > 0 && (
                                      <p className="px-4 pt-2 pb-1 text-[9px] uppercase tracking-wider text-slate-600 border-t border-slate-800">
                                        From previous quotes
                                      </p>
                                    )}
                                    {acResults.prev.map((p) => (
                                      <button
                                        key={`prev-${p.description.toLowerCase()}`}
                                        onMouseDown={(e) => { e.preventDefault(); selectPrevItem(sec.section_id, item.item_id, p); }}
                                        className="w-full text-left px-4 py-2.5 hover:bg-slate-800 transition-colors flex items-center justify-between gap-3"
                                      >
                                        <div className="min-w-0">
                                          <p className="text-slate-200 font-medium truncate">
                                            <span className="mr-1.5 px-1 py-0.5 rounded text-[9px] font-bold bg-amber-500/20 text-amber-300 align-middle">PREV</span>
                                            {p.description}
                                          </p>
                                          <p className="text-[10px] text-slate-500 truncate">
                                            {[p.brand, `${p.label} · ${p.date}`, p.count > 1 ? `used ${p.count}×` : null].filter(Boolean).join(' · ')}
                                          </p>
                                        </div>
                                        <div className="text-right flex-shrink-0">
                                          {p.cost_price != null
                                            ? <p className="font-semibold text-xs text-amber-400">{fmtIdr(p.cost_price)}</p>
                                            : <p className="text-slate-600 text-[10px]">no cost</p>}
                                          <p className="text-[10px] text-slate-600">last used</p>
                                        </div>
                                      </button>
                                    ))}
                                  </div>
                                )}
                              </td>
                              <td className="px-2 py-2">
                                <input value={item.brand} onChange={(e) => updateItem(sec.section_id, item.item_id, { brand: e.target.value })}
                                  placeholder="Brand" className="w-full bg-transparent outline-none text-slate-300 placeholder:text-slate-700" />
                              </td>
                              <td className="px-2 py-2">
                                <input type="number" value={item.quantity} onChange={(e) => updateItem(sec.section_id, item.item_id, { quantity: e.target.value })}
                                  placeholder="0" className="w-full bg-transparent outline-none text-right text-slate-200 placeholder:text-slate-700" />
                              </td>
                              <td className="px-2 py-2">
                                <input list={`units-${item.item_id}`} value={item.unit}
                                  onChange={(e) => updateItem(sec.section_id, item.item_id, { unit: e.target.value })}
                                  placeholder="unit" className="w-full bg-transparent outline-none text-slate-300 placeholder:text-slate-700" />
                                <datalist id={`units-${item.item_id}`}>{UNITS.map((u) => <option key={u} value={u} />)}</datalist>
                              </td>
                              <td
                                className="px-2 py-2"
                                onMouseEnter={(e) => showCostHistory(item.item_id, item.component_id, item.description, e.currentTarget)}
                                onMouseLeave={() => setCostHover(null)}
                              >
                                <input type="number" value={item.cost_price}
                                  onChange={(e) => updateItem(sec.section_id, item.item_id, { cost_price: e.target.value })}
                                  placeholder="0"
                                  className={`w-full bg-transparent outline-none text-right text-slate-600 placeholder:text-slate-800 ${item.component_id || freeTextHistory.has(item.description.trim().toLowerCase()) ? 'cursor-help' : ''}`} />
                                {costHover?.itemId === item.item_id && (
                                  <div
                                    className="fixed z-50 w-72 bg-slate-900 border border-slate-700 rounded-xl shadow-2xl p-3 pointer-events-none"
                                    style={{ left: Math.max(16, costHover.x - 288), top: costHover.y + 4 }}
                                  >
                                    <p className="text-[10px] uppercase tracking-wider text-slate-500 mb-2">
                                      Price history · using {costHover.source === 'tuc' ? 'weighted TUC' : SOURCE_LABEL[costHover.source]}
                                    </p>
                                    <div className="space-y-1">
                                      {costHover.history.map((h, i) => (
                                        <div key={i} className="flex items-center justify-between gap-2 text-[11px]">
                                          <span className={`px-1.5 py-0.5 rounded text-[9px] font-bold flex-shrink-0 ${SOURCE_BADGE[h.kind]}`}>
                                            {h.kind === 'tuc' ? 'TUC' : h.kind === 'quote' ? 'QUOTE' : 'USED'}
                                          </span>
                                          <span className="text-slate-400 truncate flex-1">{h.label}</span>
                                          <span className="text-slate-500 flex-shrink-0">{h.date}</span>
                                          <span className="text-slate-200 font-medium tabular-nums flex-shrink-0">{fmtIdr(h.unitCost)}</span>
                                        </div>
                                      ))}
                                    </div>
                                  </div>
                                )}
                              </td>
                              <td className="px-2 py-2">
                                <input type="number" value={item.sell_price}
                                  onChange={(e) => updateItem(sec.section_id, item.item_id, { sell_price: e.target.value })}
                                  placeholder="0" className="w-full bg-transparent outline-none text-right text-slate-200 placeholder:text-slate-700" />
                              </td>
                              <td className="px-2 py-2 text-right">
                                {num(item.cost_price) ? (
                                  <input
                                    type="number"
                                    value={gmEdit?.itemId === item.item_id ? gmEdit.value : gm}
                                    placeholder="%"
                                    onFocus={(e) => { setGmEdit({ itemId: item.item_id, value: gm }); e.target.select(); }}
                                    onBlur={() => setGmEdit(null)}
                                    onChange={(e) => {
                                      setGmEdit({ itemId: item.item_id, value: e.target.value });
                                      const s = sellFromGm(item.cost_price, e.target.value);
                                      if (s) updateItem(sec.section_id, item.item_id, { sell_price: s });
                                    }}
                                    className="w-full bg-transparent outline-none text-right text-emerald-400 placeholder:text-slate-600 border-b border-dashed border-emerald-500/30 focus:border-solid focus:border-emerald-400 transition-colors"
                                  />
                                ) : <span className="text-slate-700">—</span>}
                              </td>
                              <td className="px-2 py-2 text-right text-slate-300 font-medium whitespace-nowrap">
                                {total > 0 ? fmtIdr(total) : '—'}
                              </td>
                              <td className="pr-3 py-2">
                                <button onClick={() => deleteItem(sec.section_id, item.item_id)} className="text-slate-700 hover:text-red-400 transition-colors">
                                  <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M6 18L18 6M6 6l12 12" /></svg>
                                </button>
                              </td>
                            </tr>
                            {/* Sub-items */}
                            {subItems.map((sub) => (
                              <tr
                                key={sub.item_id}
                                className={`bg-slate-900/20 transition-colors ${dropHint === sub.item_id ? 'bg-violet-500/10' : ''}`}
                                onDragOver={(e) => { if (drag?.kind === 'item' && drag.itemId !== sub.item_id) { e.preventDefault(); setDropHint(sub.item_id); } }}
                                onDragLeave={() => setDropHint((h) => h === sub.item_id ? null : h)}
                                onDrop={(e) => { e.preventDefault(); e.stopPropagation(); dropItemOn(sec.section_id, sub.item_id); endDrag(); }}
                              >
                                <td className="pl-2 py-1.5">
                                  <span
                                    draggable
                                    onDragStart={(e) => { e.dataTransfer.effectAllowed = 'move'; setDrag({ kind: 'item', sectionId: sec.section_id, itemId: sub.item_id }); }}
                                    onDragEnd={endDrag}
                                    className="cursor-grab active:cursor-grabbing text-slate-700 hover:text-slate-400 inline-block"
                                    title="Drag to reorder or move under another item"
                                  >
                                    {GRIP}
                                  </span>
                                </td>
                                <td className="pl-6 pr-4 py-1.5 flex items-center gap-2">
                                  <span className="text-slate-600 flex-shrink-0">↳</span>
                                  <input value={sub.description} onChange={(e) => updateItem(sec.section_id, sub.item_id, { description: e.target.value })}
                                    placeholder="Sub-item description" className="flex-1 bg-transparent outline-none text-slate-400 italic placeholder:text-slate-700 text-[11px]" />
                                </td>
                                <td className="px-2 py-1.5">
                                  <input value={sub.brand} onChange={(e) => updateItem(sec.section_id, sub.item_id, { brand: e.target.value })}
                                    className="w-full bg-transparent outline-none text-slate-500 text-[11px]" />
                                </td>
                                <td className="px-2 py-1.5">
                                  <input type="number" value={sub.quantity} onChange={(e) => updateItem(sec.section_id, sub.item_id, { quantity: e.target.value })}
                                    placeholder="0" className="w-full bg-transparent outline-none text-right text-slate-400 text-[11px]" />
                                </td>
                                <td className="px-2 py-1.5">
                                  <input list={`units-${sub.item_id}`} value={sub.unit} onChange={(e) => updateItem(sec.section_id, sub.item_id, { unit: e.target.value })}
                                    className="w-full bg-transparent outline-none text-slate-500 text-[11px]" />
                                  <datalist id={`units-${sub.item_id}`}>{UNITS.map((u) => <option key={u} value={u} />)}</datalist>
                                </td>
                                <td /><td /><td /><td />
                                <td className="pr-3 py-1.5">
                                  <button onClick={() => deleteItem(sec.section_id, sub.item_id)} className="text-slate-700 hover:text-red-400 transition-colors">
                                    <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M6 18L18 6M6 6l12 12" /></svg>
                                  </button>
                                </td>
                              </tr>
                            ))}
                            {/* Auto system-size line: module qty × Wp/module */}
                            {sec.group_key === 'solar_panels' && itemWp(item) > 0 && item.unit.trim().toLowerCase() !== 'wp' && (
                              <tr className="bg-emerald-500/[0.04]">
                                <td />
                                <td colSpan={2} className="px-2 py-1.5 text-[11px] italic text-emerald-400/90">Total system size (auto)</td>
                                <td className="px-2 py-1.5 text-right text-[11px] font-semibold text-emerald-400 tabular-nums">{itemWp(item).toLocaleString('en-US')}</td>
                                <td className="px-2 py-1.5 text-[11px] text-emerald-500/80">Wp</td>
                                <td colSpan={5} className="px-2 py-1.5 text-[11px] text-slate-600">
                                  {(num(item.quantity) ?? 0).toLocaleString('en-US')} × {wpPerModule(item).toLocaleString('en-US')} Wp/module
                                </td>
                              </tr>
                            )}
                          </React.Fragment>
                        );
                      })}
                    </tbody>
                  </table>
                </div>

                {/* Section footer: add item / add sub-item buttons */}
                <div className="px-4 py-2 border-t border-slate-800/50 flex items-center gap-3">
                  <button onClick={() => addItem(sec.section_id)}
                    className="flex items-center gap-1.5 text-[11px] text-slate-500 hover:text-violet-400 transition-colors">
                    <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 4v16m8-8H4" /></svg>
                    Add item
                  </button>
                  {mainItems.length > 0 && (
                    <button onClick={() => addItem(sec.section_id, mainItems[mainItems.length - 1].item_id)}
                      className="flex items-center gap-1.5 text-[11px] text-slate-600 hover:text-slate-400 transition-colors">
                      <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 4v16m8-8H4" /></svg>
                      Add sub-item to last
                    </button>
                  )}
                </div>
              </div>
            );
          })}

                  {/* Add sub-section to this group */}
                  <button onClick={() => addSection(group.key)}
                    className="w-full flex items-center justify-center gap-2 py-2.5 rounded-2xl border border-dashed border-slate-700 hover:border-violet-500 text-slate-600 hover:text-violet-400 transition-all text-xs">
                    <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 4v16m8-8H4" /></svg>
                    Add sub-section
                  </button>
                </div>
              </div>
            );
          })}
        </div>

        {/* ── Totals ── */}
        {subtotal > 0 && (
          <div className="bg-slate-900/50 border border-slate-800 rounded-2xl p-5 ml-auto max-w-sm space-y-2">
            <div className="flex justify-between text-sm">
              <span className="text-slate-400">Subtotal (excl. PPN)</span>
              <span className="font-semibold text-white tabular-nums">{fmtIdr(subtotal)}</span>
            </div>
            <div className="flex justify-between text-sm">
              <span className="text-slate-400">PPN {quote.ppn_pct}%</span>
              <span className="text-slate-300 tabular-nums">{fmtIdr(ppn)}</span>
            </div>
            <div className="flex justify-between text-base font-bold border-t border-slate-700 pt-2 mt-2">
              <span className="text-white">Grand Total</span>
              <span className="text-white tabular-nums">{fmtIdr(grandTotal)}</span>
            </div>
            {totalWp > 0 && (
              <div className="border-t border-slate-800 pt-2 mt-2 space-y-1.5">
                <div className="flex justify-between text-xs">
                  <span className="text-slate-500">Harga per Wp (Exc. PPN{quote.ppn_pct}%)</span>
                  <span className="text-amber-300 font-semibold tabular-nums">{fmtIdr(subtotal / totalWp)}</span>
                </div>
                <div className="flex justify-between text-xs">
                  <span className="text-slate-500">Harga per Wp (Inc. PPN{quote.ppn_pct}%)</span>
                  <span className="text-slate-300 tabular-nums">{fmtIdr(grandTotal / totalWp)}</span>
                </div>
              </div>
            )}
          </div>
        )}

        {/* ── Terms & Conditions ── */}
        <div className="bg-slate-900/50 border border-slate-800 rounded-2xl p-5">
          <div className="flex items-center justify-between mb-2">
            <label className="block text-[10px] uppercase tracking-widest text-slate-500">
              Terms &amp; Conditions
              <span className="ml-2 normal-case tracking-normal text-slate-600">shown at the end of the client quote</span>
            </label>
            {!quote.notes && (
              <button
                onClick={() => setQuoteField('notes', TC_TEMPLATE)}
                className="text-[11px] text-violet-400 hover:text-violet-300 transition-colors"
              >
                Insert template
              </button>
            )}
          </div>
          <textarea
            value={quote.notes ?? ''}
            onChange={(e) => setQuoteField('notes', e.target.value)}
            rows={10}
            placeholder={'Warranty, pricing, payment and delivery terms…\nLines ending with ":" become underlined headers on the PDF.'}
            className="w-full bg-transparent border border-slate-800 focus:border-violet-500 rounded-xl outline-none text-slate-300 p-3 text-xs leading-relaxed placeholder:text-slate-700 transition-colors resize-y"
          />
        </div>
      </main>
    </div>
  );
}
