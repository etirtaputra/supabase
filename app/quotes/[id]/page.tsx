'use client';
import React, { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { createSupabaseClient } from '@/lib/supabase';
import { useSupabaseData } from '@/hooks/useSupabaseData';
import { useQuotesGate } from '@/hooks/useQuotesGate';
import { computeTUCMap, getComponentCost, priceAgeDays, AGED_PRICE_DAYS, type CostEntry } from '@/lib/computeTUC';
import { fetchUsedEntries } from '@/lib/usedPrices';
import { roundNice } from '@/lib/rounding';
import { DEFAULT_EXPORT_COLS, EXPORT_COL_KEYS, EXPORT_COL_LABELS, loadExportCols, saveExportCols, type ExportCols } from '@/lib/exportCols';
import { quoteFileName } from '@/lib/quoteFilename';
import { lineWp, wpPerModule } from '@/lib/quoteWp';
import MigrationBanner from '@/components/ui/MigrationBanner';
import MobileNotice from '@/components/ui/MobileNotice';
import { PROJECT_TYPES, composeDescription, specFileTag, isSolarType, type ProjectType, type SystemSpecs, type Phase } from '@/lib/projectSpec';
import { SECTION_GROUPS, STANDARD_SECTIONS, QUOTE_UNITS, type SectionGroup, type ProjectQuote, type QuoteSection, type QuoteItem } from '@/types/quotes';
import type { Component } from '@/types/database';

// ── Types ──────────────────────────────────────────────────────────────────────

interface DraftItem {
  item_id: string;
  parent_item_id: string | null;
  component_id: string | null;
  description: string;
  brand: string;
  quantity: string;
  qty_formula: string;   // internal Excel-style formula behind quantity
  eng_note: string;      // internal engineering notes, never exported
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

// Excel-style quantity formulas: "=2520*720" → 1814400. Digits and
// + - * / ( ) . only; anything else refuses to evaluate.
function evalFormula(raw: string): number | null {
  const expr = raw.replace(/^=/, '').replace(/,/g, '').trim();
  if (!expr || !/^[0-9+\-*/().\s]+$/.test(expr)) return null;
  try {
    const v = Function(`"use strict"; return (${expr});`)();
    return typeof v === 'number' && isFinite(v) ? v : null;
  } catch {
    return null;
  }
}

// A qty formula may reference another line by its row number: "=R3*2" or "=#3/4"
// (R3 = the quantity of row 3). getRow(n) returns that row's resolved quantity.
const QTY_REF_RE = /[R#]\d+/i;
function evalFormulaRefs(raw: string, getRow: (n: number) => number | null): number | null {
  let bad = false;
  const expr = raw.replace(/^=/, '').replace(/,/g, '')
    .replace(/[R#](\d+)/gi, (_m, d: string) => {
      const v = getRow(parseInt(d, 10));
      if (v == null || !isFinite(v)) { bad = true; return '0'; }
      return `(${v})`;
    }).trim();
  if (bad || !expr || !/^[0-9+\-*/().\s]+$/.test(expr)) return null;
  try {
    const v = Function(`"use strict"; return (${expr});`)();
    return typeof v === 'number' && isFinite(v) ? v : null;
  } catch {
    return null;
  }
}

// Ordered "rows" = non-deleted main line items in display order (row 1 = first).
function orderedRows(sections: DraftSection[]): DraftItem[] {
  const rows: DraftItem[] = [];
  for (const s of sections) {
    if (s._deleted) continue;
    for (const it of s.items) if (!it.parent_item_id && !it._deleted) rows.push(it);
  }
  return rows;
}
// Resolve every row's quantity, honoring =R<n> references (cycle-safe via a
// visited stack; a referenced-cell cycle falls back to the stored value).
function resolveRowValues(sections: DraftSection[]): Map<string, number> {
  const rows = orderedRows(sections);
  const memo = new Map<string, number>();
  const stack = new Set<string>();
  const resolveIdx = (idx: number): number | null => {
    const it = rows[idx];
    if (!it) return null;
    if (memo.has(it.item_id)) return memo.get(it.item_id)!;
    const f = it.qty_formula;
    if (!f || !QTY_REF_RE.test(f)) { const v = num(it.quantity) ?? 0; memo.set(it.item_id, v); return v; }
    if (stack.has(it.item_id)) return null; // reference cycle
    stack.add(it.item_id);
    const v = evalFormulaRefs(f, (n) => resolveIdx(n - 1));
    stack.delete(it.item_id);
    const val = v ?? (num(it.quantity) ?? 0);
    memo.set(it.item_id, val);
    return val;
  };
  rows.forEach((_, i) => resolveIdx(i));
  return memo;
}

function fmtIdr(v: number | null | undefined) {
  if (v == null) return '—';
  return `Rp${Math.round(v).toLocaleString('en-US')}`;
}

function fmtDateTime(s: string | undefined) {
  if (!s) return '';
  return new Date(s).toLocaleString('id-ID', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}

const ACTIVITY_BADGE: Record<string, string> = {
  created: 'bg-emerald-500/20 text-emerald-300',
  edited:  'bg-slate-600/40 text-slate-300',
  status:  'bg-sky-500/20 text-sky-300',
  deleted: 'bg-red-500/20 text-red-300',
};

function gmFromPrices(cost: string, sell: string): string {
  const c = num(cost), s = num(sell);
  if (!c || !s || s <= 0) return '';
  return ((1 - c / s) * 100).toFixed(1);
}

function sellFromGm(cost: string, gm: string): string {
  const c = num(cost), g = num(gm);
  if (!c || g == null || g >= 100) return '';
  return String(roundNice(c / (1 - g / 100)));
}

const LEAD_TIMES = ['Ready', '1 minggu', '2 minggu', '3 minggu', '1 bulan', '2 bulan', '3 bulan', 'Custom'];

// Cost source presentation (TUC from POs / supplier price quote / last used in a project quote)
const SOURCE_LABEL: Record<string, string> = { tuc: 'TUC', quote: 'latest quote', used: 'last used' };
// Buffered items surface as "Std Cost", never as raw TUC
const srcLabel = (cc: { source: string; buffered?: boolean }) => (cc.buffered ? 'Std Cost' : SOURCE_LABEL[cc.source]);
const SOURCE_TEXT:  Record<string, string> = { tuc: 'text-violet-400', quote: 'text-sky-400', used: 'text-amber-400' };
const SOURCE_BADGE: Record<string, string> = {
  tuc: 'bg-violet-500/20 text-violet-300',
  quote: 'bg-sky-500/20 text-sky-300',
  used: 'bg-amber-500/20 text-amber-300',
};
const UNITS = QUOTE_UNITS;
const STATUS_OPTS = ['draft', 'sent', 'accepted', 'rejected'] as const;
const STATUS_COLORS: Record<string, string> = {
  draft: 'bg-slate-700/60 text-slate-300',
  sent: 'bg-blue-500/20 text-blue-300',
  accepted: 'bg-emerald-500/20 text-emerald-300',
  rejected: 'bg-red-500/20 text-red-400',
};

// ── Spreadsheet-style arrow navigation between cells ───────────────────────────
// ↑/↓ jump to the same column in the previous/next row (across sub-sections and
// groups, following DOM order). ←/→ move to the adjacent cell once the caret is
// at the text boundary, skipping cells the row doesn't have (e.g. GM without cost).
const NAV_COLS = ['desc', 'brand', 'qty', 'unit', 'cost', 'sell', 'gm'] as const;

function navCell(e: React.KeyboardEvent<HTMLInputElement>, row: string, col: string) {
  const { key } = e;
  if (key === 'ArrowDown' || key === 'ArrowUp') {
    const nodes = Array.from(document.querySelectorAll<HTMLInputElement>(`input[data-nav-col="${col}"]`));
    const i = nodes.findIndex((n) => n.dataset.navRow === row);
    if (i < 0) return;
    const next = nodes[i + (key === 'ArrowDown' ? 1 : -1)];
    if (next) { e.preventDefault(); next.focus(); next.select(); }
    return;
  }
  if (key === 'ArrowLeft' || key === 'ArrowRight') {
    const el = e.currentTarget;
    let atStart = true, atEnd = true;
    try {
      atStart = el.selectionStart === 0 && el.selectionEnd === 0;
      atEnd = el.selectionStart === el.value.length && el.selectionEnd === el.value.length;
    } catch { /* selection unavailable — treat as boundary */ }
    if ((key === 'ArrowLeft' && !atStart) || (key === 'ArrowRight' && !atEnd)) return;
    const dir = key === 'ArrowRight' ? 1 : -1;
    let ci = NAV_COLS.indexOf(col as typeof NAV_COLS[number]) + dir;
    while (ci >= 0 && ci < NAV_COLS.length) {
      const target = document.querySelector<HTMLInputElement>(`input[data-nav-col="${NAV_COLS[ci]}"][data-nav-row="${row}"]`);
      if (target) { e.preventDefault(); target.focus(); target.select(); return; }
      ci += dir;
    }
  }
}

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

function SpecInput({ label, unit, value, onChange }: {
  label: string; unit: string; value: number | null | undefined;
  onChange: (v: number | null) => void;
}) {
  return (
    <div className="w-40">
      <label className="block text-[10px] uppercase tracking-widest text-slate-500 mb-1">{label}</label>
      <div className="flex items-baseline gap-1.5 border-b border-slate-700 focus-within:border-violet-500 transition-colors">
        <input
          type="number"
          value={value ?? ''}
          onChange={(e) => onChange(e.target.value === '' ? null : parseFloat(e.target.value))}
          placeholder="0"
          className="w-full bg-transparent outline-none text-white py-1 text-sm text-right placeholder:text-slate-600"
        />
        <span className="text-[10px] text-slate-500 whitespace-nowrap pb-1">{unit}</span>
      </div>
    </div>
  );
}

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
  const gate = useQuotesGate();
  const { data: catalog, loading: catalogLoading } = useSupabaseData();

  // ── Quote header state ─────────────────────────────────────────────────────
  const [quote, setQuote] = useState<ProjectQuote | null>(null);
  // SENT quotes are read-only for everyone except Owners (also enforced by RLS)
  const isOwner = gate.profile?.role === 'owner';
  const locked = quote?.status === 'sent' && !isOwner;
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

  // Highlighted row for keyboard navigation (flat index: components, then prev)
  const [acIndex, setAcIndex] = useState(0);

  function openAc(sectionId: string, itemId: string, query: string, input: HTMLInputElement) {
    const r = input.getBoundingClientRect();
    setAcState({ sectionId, itemId, query, x: r.left, y: r.bottom });
    setAcIndex(0);
  }

  // Keep the highlighted suggestion visible while arrowing through the list
  useEffect(() => {
    document.querySelector(`[data-ac-dropdown] [data-ac-idx="${acIndex}"]`)
      ?.scrollIntoView({ block: 'nearest' });
  }, [acIndex]);

  // Abandon any in-progress rename when the dropdown closes
  useEffect(() => {
    if (!acState) setPrevEdit(null);
  }, [acState]);

  // ── GM% inline editing ─────────────────────────────────────────────────────
  // While a GM cell is focused, show the raw typed value instead of the value
  // re-derived from cost/sell — otherwise every keystroke gets rewritten
  // (typing "3" of "30" snaps to the recomputed margin).
  const [gmEdit, setGmEdit] = useState<{ itemId: string; value: string } | null>(null);

  // ── Qty formula editing (Excel-like: focus shows formula, blur shows value) ─
  const [qtyEdit, setQtyEdit] = useState<{ itemId: string; value: string } | null>(null);

  function commitQty(sid: string, iid: string, raw: string) {
    const t = raw.trim();
    if (t.startsWith('=')) {
      if (QTY_REF_RE.test(t)) {
        // Reference formula (=R3*2): resolve against the current row quantities.
        const rows = orderedRows(sections);
        const v = evalFormulaRefs(t, (n) => { const it = rows[n - 1]; return it ? (num(it.quantity) ?? 0) : null; });
        if (v != null) updateItem(sid, iid, { quantity: String(v), qty_formula: t });
        else updateItem(sid, iid, { qty_formula: t }); // keep formula; the live pass retries as rows fill in
      } else {
        const v = evalFormula(t);
        if (v != null) updateItem(sid, iid, { quantity: String(v), qty_formula: t });
        // invalid formula: leave the item untouched, the field reverts on blur
      }
    } else {
      updateItem(sid, iid, { quantity: t, qty_formula: '' });
    }
    setQtyEdit(null);
  }

  // Row numbers (1-based) for the =R<n> reference gutter.
  const rowNumById = useMemo(() => {
    const m = new Map<string, number>();
    orderedRows(sections).forEach((it, i) => m.set(it.item_id, i + 1));
    return m;
  }, [sections]);

  // Live-recompute reference formulas: when a referenced row's qty changes,
  // dependent =R<n> cells update. Cycle-safe; stops once values are stable.
  useEffect(() => {
    const hasRefs = sections.some((s) => !s._deleted && s.items.some((it) => !it.parent_item_id && !it._deleted && it.qty_formula && QTY_REF_RE.test(it.qty_formula)));
    if (!hasRefs) return;
    const vals = resolveRowValues(sections);
    let changed = false;
    const next = sections.map((s) => s._deleted ? s : ({
      ...s,
      items: s.items.map((it) => {
        if (it.parent_item_id || it._deleted || !it.qty_formula || !QTY_REF_RE.test(it.qty_formula)) return it;
        const v = vals.get(it.item_id);
        if (v != null && String(v) !== it.quantity) { changed = true; return { ...it, quantity: String(v) }; }
        return it;
      }),
    }));
    if (changed) setSections(next);
  }, [sections]);

  // Excel-style "=" formulas for the price cells (cost / sell): on blur, a
  // leading "=" is evaluated and replaced with the result. A valid formula
  // resolves to its number; anything else is left as typed.
  function evalCell(raw: string): string {
    const t = raw.trim();
    if (!t.startsWith('=')) return raw;
    const v = evalFormula(t);
    return v != null ? String(v) : raw;
  }

  // ── Engineering notes (internal only, never exported) ─────────────────────
  const [openNotes, setOpenNotes] = useState<Set<string>>(new Set());
  function toggleNote(iid: string) {
    setOpenNotes((prev) => {
      const next = new Set(prev);
      if (next.has(iid)) next.delete(iid);
      else next.add(iid);
      return next;
    });
  }

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

  // Items from other quotes (catalog-linked or free-text) — deduped by
  // description, newest usage wins. Feeds the autocomplete and, via
  // freeTextHistory, the cost-cell hover for non-catalog items.
  interface PrevItem {
    description: string; brand: string; unit: string;
    component_id: string | null;
    cost_price: number | null; sell_price: number | null;
    label: string; date: string; count: number;
  }
  const [prevItems, setPrevItems] = useState<PrevItem[]>([]);
  const [freeTextHistory, setFreeTextHistory] = useState<Map<string, CostEntry[]>>(new Map());

  // Loads both suggestion sources; re-run after every Save so long-lived
  // sessions pick up items saved from other tabs/quotes.
  const loadReferenceData = useCallback(async () => {
    fetchUsedEntries(supabase, id).then(setPrevUsed);

    const [itemsRes, quotesRes, libRes] = await Promise.all([
      supabase.from('10.2_quote_items')
        .select('description, brand, unit, component_id, cost_price, sell_price, quote_id, parent_item_id')
        .neq('quote_id', id),
      supabase.from('10.0_project_quotes').select('quote_id, quote_number, quote_date'),
      // Curated entries from the owner-managed Description Library; the table
      // may not exist yet on older databases — errors are simply ignored
      supabase.from('10.4_description_library').select('description, brand, unit, default_cost'),
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
            component_id: (it.component_id as string | null) ?? null,
            cost_price: it.cost_price != null ? Number(it.cost_price) : null,
            sell_price: it.sell_price != null ? Number(it.sell_price) : null,
            label, date,
          });
        }
      } else {
        byDesc.set(key, {
          description: desc, brand: String(it.brand ?? ''), unit: String(it.unit ?? ''),
          component_id: (it.component_id as string | null) ?? null,
          cost_price: it.cost_price != null ? Number(it.cost_price) : null,
          sell_price: it.sell_price != null ? Number(it.sell_price) : null,
          label, date, count: 1,
        });
      }
    }
    // Curated library entries join the suggestions when no quote item already
    // carries the same text (real usage, with its cost, always wins)
    for (const r of libRes.data ?? []) {
      const desc = String(r.description ?? '').trim();
      const key = desc.toLowerCase();
      if (desc.length < 3 || byDesc.has(key)) continue;
      byDesc.set(key, {
        description: desc, brand: String(r.brand ?? ''), unit: String(r.unit ?? ''),
        component_id: null,
        cost_price: r.default_cost != null ? Number(r.default_cost) : null,
        sell_price: null,
        label: 'Library', date: '', count: 1,
      });
    }
    for (const arr of hist.values()) arr.sort((a, b) => b.date.localeCompare(a.date));
    setPrevItems([...byDesc.values()]);
    setFreeTextHistory(hist);
  }, [id]);

  useEffect(() => { loadReferenceData(); }, [loadReferenceData]);

  // ── Inline rename of previous entries (fix inconsistent naming) ────────────
  // Renames every past quote item carrying the old description so the
  // suggestion library converges to one spelling.
  const [prevEdit, setPrevEdit] = useState<{ key: string; description: string; brand: string; original: PrevItem } | null>(null);
  const [prevEditBusy, setPrevEditBusy] = useState(false);
  const [prevEditError, setPrevEditError] = useState('');
  const prevEditInputRef = useRef<HTMLInputElement | null>(null);

  // Focus without scrolling — a scroll here would fire the dropdown's
  // scroll-close listener and instantly abort the edit
  useEffect(() => {
    if (prevEdit) prevEditInputRef.current?.focus({ preventScroll: true });
  }, [prevEdit?.key]);

  async function renamePrevItem() {
    if (!prevEdit) return;
    const newDesc = prevEdit.description.trim();
    const newBrand = prevEdit.brand.trim();
    if (newDesc.length < 3) { setPrevEditError('Description too short'); return; }
    setPrevEditBusy(true);
    setPrevEditError('');
    // ilike with wildcards escaped = case-insensitive equality, catching
    // "U ditch" vs "U Ditch" variants in one pass
    const escaped = prevEdit.original.description.replace(/([%_\\])/g, '\\$1');
    const { error } = await supabase.from('10.2_quote_items')
      .update({ description: newDesc, brand: newBrand })
      .ilike('description', escaped);
    if (error) {
      setPrevEditError(error.message);
      setPrevEditBusy(false);
      return;
    }
    // Keep the open draft consistent too (its saved rows were just updated)
    const oldKey = prevEdit.original.description.trim().toLowerCase();
    setSections((prev) => prev.map((s) => ({
      ...s,
      items: s.items.map((it) =>
        it.description.trim().toLowerCase() === oldKey
          ? { ...it, description: newDesc, brand: newBrand }
          : it),
    })));
    setPrevEdit(null);
    setPrevEditBusy(false);
    loadReferenceData();
  }

  // Browser tab shows which quote is open
  useEffect(() => {
    if (!quote) return;
    const parts = [quote.quote_number || 'Quote', quote.customer_name].filter(Boolean);
    document.title = `${parts.join(' · ')} | ICAPROC`;
  }, [quote?.quote_number, quote?.customer_name]);

  const compById = useMemo(
    () => new Map(catalog.components.map((c) => [c.component_id, c])),
    [catalog.components],
  );

  // One canonical TUC map shared with Catalog and Insights (same lib, same numbers)
  const tucMap = useMemo(
    () => computeTUCMap(catalog.pos, catalog.poItems, catalog.poCosts),
    [catalog.pos, catalog.poItems, catalog.poCosts],
  );

  // Global Cost Basis buffer % (app_settings), per-item override on the component
  const [globalBufferPct, setGlobalBufferPct] = useState(5);
  useEffect(() => {
    supabase.from('app_settings').select('value').eq('key', 'quote_cost_buffer_pct').maybeSingle()
      .then(({ data }) => { const v = Number(data?.value); if (!isNaN(v)) setGlobalBufferPct(v); });
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const costFor = useCallback((componentId: string) => {
    const c = compById.get(componentId);
    const mode = (c?.quote_cost_mode ?? (c?.show_tuc_in_quotes === false ? 'hidden' : 'buffered'));
    return getComponentCost(componentId, tucMap, catalog.quotes, catalog.quoteItems, prevUsed.get(componentId) ?? [],
      { mode, bufferPct: c?.quote_cost_buffer_pct ?? globalBufferPct });
  }, [tucMap, catalog.quotes, catalog.quoteItems, prevUsed, compById, globalBufferPct]);

  // ── System size (Wp) ───────────────────────────────────────────────────────
  // Shared rules in lib/quoteWp.ts (also used by the quotes list): catalog
  // norm_value for pv_module components, else parsed from the description;
  // lines with unit 'Wp' keep the old behavior where qty is already total Wp.
  const itemWp = useCallback((item: DraftItem): number => {
    if (item._deleted || item.parent_item_id) return 0;
    return lineWp(catalog.components, {
      component_id: item.component_id,
      description: item.description,
      unit: item.unit,
      quantity: num(item.quantity) ?? 0,
    });
  }, [catalog.components]);

  // ── Per-group default margins ──────────────────────────────────────────────
  // A group's GM% auto-prices new lines (sell = cost / (1 - gm)) whenever a
  // cost arrives and no sell price is set yet; per-line GM stays editable.
  const groupGm = useCallback((groupKey: SectionGroup): number | null => {
    const v = quote?.group_margins?.[groupKey];
    return typeof v === 'number' && v < 100 ? v : null;
  }, [quote?.group_margins]);

  function setGroupMargin(groupKey: SectionGroup, raw: string) {
    const v = parseFloat(raw);
    setQuote((q) => {
      if (!q) return q;
      const margins = { ...(q.group_margins ?? {}) };
      if (isNaN(v)) delete margins[groupKey];
      else margins[groupKey] = v;
      return { ...q, group_margins: margins };
    });
    markDirty();
  }

  function sellFromGroupGm(groupKey: SectionGroup, cost: number | null): string | null {
    const gm = groupGm(groupKey);
    if (gm == null || !cost || cost <= 0) return null;
    return String(roundNice(cost / (1 - gm / 100)));
  }

  function applyGmToGroup(groupKey: SectionGroup) {
    const gm = groupGm(groupKey);
    if (gm == null) return;
    setSections((prev) => prev.map((s) => {
      if (s._deleted || s.group_key !== groupKey) return s;
      return {
        ...s,
        items: s.items.map((it) => {
          if (it._deleted || it.parent_item_id) return it;
          const c = num(it.cost_price);
          if (!c || c <= 0) return it;
          return { ...it, sell_price: String(roundNice(c / (1 - gm / 100))) };
        }),
      };
    }));
    markDirty();
  }

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
          if (gmFrac < 1) sell = String(roundNice(newCost / (1 - gmFrac)));
        }
        return { ...it, cost_price: String(newCost), sell_price: sell };
      }),
    })));
    markDirty();
    setSaveMsg('Costs refreshed');
    setTimeout(() => setSaveMsg(''), 2500);
  }

  // ── Activity log (written by database trigger; read-only here) ─────────────
  const [showActivity, setShowActivity] = useState(false);
  const [activity, setActivity] = useState<{ action: string; detail: string; actor_email: string; at: string }[] | null>(null);

  async function openActivity() {
    setShowActivity(true);
    setActivity(null);
    const { data } = await supabase.from('10.3_quote_activity')
      .select('action, detail, actor_email, at')
      .eq('quote_id', id)
      .order('at', { ascending: false })
      .limit(100);
    setActivity(data ?? []);
  }

  // ── Export column choices (shared with the print page via localStorage) ────
  const [exportCols, setExportCols] = useState<ExportCols>(DEFAULT_EXPORT_COLS);
  const [showExportCols, setShowExportCols] = useState(false);
  useEffect(() => { setExportCols(loadExportCols()); }, []);
  const setExportCol = (k: keyof ExportCols, v: boolean) => {
    setExportCols((prev) => { const next = { ...prev, [k]: v }; saveExportCols(next); return next; });
  };

  // ── Per-item cost drift: stored cost vs today's recommendation ─────────────
  const DRIFT_THRESHOLD = 0.10;
  const itemDrift = useCallback((item: DraftItem): { rec: number; pct: number } | null => {
    if (!item.component_id || item._deleted || item.parent_item_id) return null;
    const stored = num(item.cost_price);
    if (!stored || stored <= 0) return null;
    const cc = costFor(item.component_id);
    if (!cc || !(cc.cost > 0)) return null;
    const pct = (cc.cost - stored) / stored;
    // Only cost INCREASES are a margin risk worth flagging; a price drop
    // just means the quote is conservative.
    return pct > DRIFT_THRESHOLD ? { rec: cc.cost, pct } : null;
  }, [costFor]);

  const driftCount = useMemo(() => {
    let n = 0;
    for (const sec of sections) {
      if (sec._deleted) continue;
      for (const it of sec.items) if (itemDrift(it)) n += 1;
    }
    return n;
  }, [sections, itemDrift]);

  // ── Cost history hover popup ───────────────────────────────────────────────
  const [costHover, setCostHover] = useState<{ sectionId: string; itemId: string; history: CostEntry[]; source: string; buffered?: boolean; linkedModel: string | null; x: number; y: number } | null>(null);
  const hoverCloseTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  function cancelHoverClose() {
    if (hoverCloseTimer.current) { clearTimeout(hoverCloseTimer.current); hoverCloseTimer.current = null; }
  }
  function scheduleHoverClose() {
    cancelHoverClose();
    hoverCloseTimer.current = setTimeout(() => setCostHover(null), 150);
  }

  function showCostHistory(sectionId: string, itemId: string, componentId: string | null, description: string, el: HTMLElement) {
    cancelHoverClose();
    let history: CostEntry[] = [];
    let source = 'used';
    let buffered = false;
    if (componentId) {
      const cc = costFor(componentId);
      if (cc) { history = cc.history; source = cc.source; buffered = !!cc.buffered; }
    } else {
      // Free-text items: match previous usage by description
      history = freeTextHistory.get(description.trim().toLowerCase()) ?? [];
    }
    if (!history.length) return;
    const r = el.getBoundingClientRect();
    setCostHover({
      sectionId,
      itemId,
      history: history.slice(0, 10),
      source,
      buffered,
      linkedModel: componentId ? (compById.get(componentId)?.supplier_model ?? '(unknown component)') : null,
      x: r.right,
      y: r.bottom,
    });
  }

  function unlinkFromPopup() {
    if (!costHover) return;
    updateItem(costHover.sectionId, costHover.itemId, { component_id: null });
    setCostHover(null);
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
            qty_formula: i.qty_formula ?? '',
            eng_note: i.eng_note ?? '',
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

  // ── Filtered autocomplete results: catalog + this quote's rows + past quotes
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

    // Rows already in this quote (draft state — works before saving), except
    // the row currently being typed in
    const seen = new Set<string>();
    const local: PrevItem[] = [];
    for (const s of sections) {
      if (s._deleted) continue;
      for (const it of s.items) {
        if (it._deleted || it.parent_item_id || it.item_id === acState.itemId) continue;
        const d = it.description.trim();
        const k = d.toLowerCase();
        if (d.length < 3 || seen.has(k) || compNames.has(k)) continue;
        if (!k.includes(q) && !it.brand.toLowerCase().includes(q)) continue;
        seen.add(k);
        local.push({
          description: d, brand: it.brand, unit: it.unit,
          component_id: it.component_id,
          cost_price: num(it.cost_price), sell_price: num(it.sell_price),
          label: 'this quote', date: '', count: 1,
        });
      }
    }

    const crossQuote = prevItems
      .filter((p) =>
        (p.description.toLowerCase().includes(q) || p.brand.toLowerCase().includes(q)) &&
        !compNames.has(p.description.toLowerCase()) &&
        !seen.has(p.description.toLowerCase())
      )
      .sort((a, b) => b.date.localeCompare(a.date));

    return { comps, prev: [...local, ...crossQuote].slice(0, 5) };
  }, [acState, catalog.components, prevItems, sections]);
  const acCount = acResults.comps.length + acResults.prev.length;

  // ── Computed totals ────────────────────────────────────────────────────────
  const { subtotal, ppn, grandTotal, totalWp, blendedGm, missingSell } = useMemo(() => {
    let sub = 0, wp = 0, costSum = 0, sellSum = 0, missing = 0;
    for (const sec of sections) {
      if (sec._deleted) continue;
      for (const item of sec.items) {
        if (item._deleted || item.parent_item_id) continue;
        const qty = num(item.quantity) ?? 0;
        const sell = num(item.sell_price) ?? 0;
        const cost = num(item.cost_price) ?? 0;
        sub += qty * sell;
        // System size from the Solar Panels group: module qty × Wp/module
        if (sec.group_key === 'solar_panels') wp += itemWp(item);
        if (qty > 0 && sell <= 0) missing += 1;
        // Blended margin over lines that carry both cost and sell
        if (qty > 0 && cost > 0 && sell > 0) { costSum += qty * cost; sellSum += qty * sell; }
      }
    }
    const ppnPct = num(quote?.ppn_pct?.toString() ?? '') ?? 11;
    const tax = sub * ppnPct / 100;
    return {
      subtotal: sub, ppn: tax, grandTotal: sub + tax, totalWp: wp,
      blendedGm: sellSum > 0 ? (1 - costSum / sellSum) * 100 : null,
      missingSell: missing,
    };
  }, [sections, quote?.ppn_pct, itemWp]);

  // ── Mutations ──────────────────────────────────────────────────────────────

  function markDirty() { setDirty(true); setSaveMsg(''); }

  function setQuoteField<K extends keyof ProjectQuote>(key: K, val: ProjectQuote[K]) {
    setQuote((q) => q ? { ...q, [key]: val } : q);
    markDirty();
  }

  // Structured project fields: any change re-composes the description so the
  // title, PDF, and filename always agree. Custom keeps free-text as-is.
  function updateProject(patch: { project_type?: ProjectType; location?: string; specs?: Partial<SystemSpecs> }) {
    setQuote((q) => {
      if (!q) return q;
      const type = (patch.project_type ?? (q.project_type as ProjectType)) || 'custom';
      const specs: SystemSpecs = { ...(q.system_specs ?? {}), ...(patch.specs ?? {}) };
      const location = patch.location ?? (q.location ?? '');
      const description = type === 'custom'
        ? q.project_description
        : composeDescription(type, specs, location);
      return { ...q, project_type: type, system_specs: specs, location, project_description: description };
    });
    markDirty();
  }

  // Section-title autocomplete: which section's title input is focused.
  // Anchored with position:fixed (like the item autocomplete above) so the
  // section card's overflow-hidden can't clip the dropdown.
  const [titleAcFor, setTitleAcFor] = useState<{ id: string; x: number; y: number; w: number } | null>(null);

  // Customer autocomplete: previously quoted customers, newest first, one
  // entry per name carrying the latest address used for that customer.
  const [pastCustomers, setPastCustomers] = useState<{ name: string; address: string }[]>([]);
  const [custAc, setCustAc] = useState<{ x: number; y: number; w: number } | null>(null);

  useEffect(() => {
    supabase.from('10.0_project_quotes')
      .select('quote_id, customer_name, customer_address, updated_at')
      .neq('customer_name', '')
      .order('updated_at', { ascending: false })
      .then(({ data }) => {
        const seen = new Set<string>();
        const out: { name: string; address: string }[] = [];
        for (const r of data ?? []) {
          if (r.quote_id === id) continue;
          const name = String(r.customer_name ?? '').trim();
          const key = name.toLowerCase();
          if (!key || seen.has(key)) continue;
          seen.add(key);
          out.push({ name, address: String(r.customer_address ?? '') });
        }
        setPastCustomers(out);
      });
  }, [id]);

  function pickCustomer(c: { name: string; address: string }) {
    setQuote((q) => q ? { ...q, customer_name: c.name, customer_address: c.address } : q);
    markDirty();
    setCustAc(null);
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
        description: '', brand: '', quantity: '', qty_formula: '', eng_note: '',
        unit: '', cost_price: '', sell_price: '',
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
      component_id: p.component_id ?? null,
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
    const sec = sections.find((s) => s.section_id === sid);
    const item = sec?.items.find((i) => i.item_id === iid);
    const patch: Partial<DraftItem> = {
      component_id: comp.component_id,
      description: comp.supplier_model ?? '',
      brand: comp.brand ?? '',
      // Prefer the component's own catalog unit; fall back to the old default
      unit: (comp.unit?.trim()) || (comp.category === 'pv_module' ? 'modules' : 'pcs'),
      cost_price: costStr,
    };
    // Auto-price from the group's default margin when no sell price is set yet
    if (sec && item && !num(item.sell_price)) {
      const sell = sellFromGroupGm(sec.group_key, num(costStr));
      if (sell) patch.sell_price = sell;
    }
    updateItem(sid, iid, patch);
    setAcState(null);
  }

  // ── Save ───────────────────────────────────────────────────────────────────
  async function save() {
    if (!quote) return;
    if (locked) { setSaveMsg('Locked: SENT quotes can only be edited by an Owner'); return; }
    setSaving(true);
    try {
      // 1. Upsert quote header
      const { error: qErr } = await supabase.from('10.0_project_quotes').upsert({
        quote_id: quote.quote_id,
        quote_number: quote.quote_number,
        quote_date: quote.quote_date,
        company_id: quote.company_id ?? null,
        customer_name: quote.customer_name,
        customer_address: quote.customer_address,
        project_description: quote.project_description,
        project_type: quote.project_type ?? 'custom',
        system_specs: quote.system_specs ?? {},
        location: quote.location ?? '',
        ppn_pct: num(String(quote.ppn_pct)) ?? 11,
        status: quote.status,
        notes: quote.notes,
        group_margins: quote.group_margins ?? {},
        updated_at: new Date().toISOString(),
      });
      if (qErr) throw qErr;
      // sent_at is stamped by the DB trigger on the draft→sent transition;
      // read it back so the header shows the date without a reload
      if (quote.status === 'sent' && !quote.sent_at) {
        const { data: stamped } = await supabase
          .from('10.0_project_quotes').select('sent_at').eq('quote_id', quote.quote_id).single();
        if (stamped?.sent_at) setQuote((q) => q ? { ...q, sent_at: stamped.sent_at } : q);
      }

      // 2. Collect deletes
      const deletedSecIds = sections.filter((s) => s._deleted).map((s) => s.section_id);
      const deletedItemIds = sections.flatMap((s) => s.items.filter((i) => i._deleted).map((i) => i.item_id));
      if (deletedItemIds.length) {
        const { error } = await supabase.from('10.2_quote_items').delete().in('item_id', deletedItemIds);
        if (error) throw error;
      }
      if (deletedSecIds.length) {
        const { error } = await supabase.from('10.1_quote_sections').delete().in('section_id', deletedSecIds);
        if (error) throw error;
      }

      // 3. Upsert live sections, ordered by group (solar → bos → services)
      const groupOrder = SECTION_GROUPS.map((g) => g.key);
      const liveSections = sections
        .filter((s) => !s._deleted)
        .sort((a, b) => groupOrder.indexOf(a.group_key) - groupOrder.indexOf(b.group_key));
      if (liveSections.length) {
        const { error } = await supabase.from('10.1_quote_sections').upsert(
          liveSections.map((s, i) => ({
            section_id: s.section_id, quote_id: id, group_key: s.group_key,
            title: s.title, lead_time: s.lead_time, sort_order: i,
          }))
        );
        if (error) throw error;
      }

      // 4. Upsert live items
      const liveItems = liveSections.flatMap((s) =>
        s.items.filter((i) => !i._deleted).map((i, idx) => ({
          item_id: i.item_id, section_id: s.section_id, quote_id: id,
          parent_item_id: i.parent_item_id,
          component_id: i.component_id ?? null,
          description: i.description, brand: i.brand,
          quantity: num(i.quantity), qty_formula: i.qty_formula, eng_note: i.eng_note,
          unit: i.unit,
          cost_price: num(i.cost_price), sell_price: num(i.sell_price),
          sort_order: idx,
        }))
      );
      if (liveItems.length) {
        const { error } = await supabase.from('10.2_quote_items').upsert(liveItems);
        if (error) throw error;
      }

      setDirty(false);
      setSaveMsg('Saved');
      setTimeout(() => setSaveMsg(''), 2500);
      loadReferenceData(); // refresh autocomplete/history sources after save
    } catch (e) {
      // Supabase errors are plain objects, not Error instances
      const msg = (e as { message?: string })?.message;
      setSaveMsg(msg ? `Error: ${msg}` : 'Error saving');
    }
    setSaving(false);
  }

  // ── Ctrl/Cmd+S saves ───────────────────────────────────────────────────────
  // Ref keeps the handler stable while always seeing the latest state.
  const saveShortcut = useRef({ save, dirty, saving });
  saveShortcut.current = { save, dirty, saving };
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 's') {
        e.preventDefault(); // always block the browser's save-page dialog
        const cur = saveShortcut.current;
        if (cur.dirty && !cur.saving) cur.save();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  // ── Undo / redo ─────────────────────────────────────────────────────────────
  // Snapshots of `sections` (edits are immutable, so keeping references is safe).
  // Rapid keystrokes within 500ms coalesce into one undo step.
  const history = useRef<{ past: DraftSection[][]; future: DraftSection[][]; present: DraftSection[]; ts: number; applying: boolean }>(
    { past: [], future: [], present: [], ts: 0, applying: false });
  const [, setHistVer] = useState(0);
  useEffect(() => {
    const h = history.current;
    if (h.applying) { h.applying = false; h.present = sections; return; }
    const now = Date.now();
    if (h.present.length > 0 && now - h.ts > 500) {
      h.past.push(h.present);
      if (h.past.length > 100) h.past.shift();
      h.future = [];
      setHistVer((v) => v + 1);
    }
    h.ts = now;
    h.present = sections;
  }, [sections]);

  function undo() {
    const h = history.current;
    if (!h.past.length || locked) return;
    h.future.push(h.present);
    const prev = h.past.pop()!;
    h.applying = true;
    setSections(prev);
    markDirty();
    setHistVer((v) => v + 1);
  }
  function redo() {
    const h = history.current;
    if (!h.future.length || locked) return;
    h.past.push(h.present);
    const next = h.future.pop()!;
    h.applying = true;
    setSections(next);
    markDirty();
    setHistVer((v) => v + 1);
  }
  const undoRedoRef = useRef({ undo, redo });
  undoRedoRef.current = { undo, redo };
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const z = e.key.toLowerCase() === 'z';
      if ((e.metaKey || e.ctrlKey) && z && !e.shiftKey) { e.preventDefault(); undoRedoRef.current.undo(); }
      else if ((e.metaKey || e.ctrlKey) && ((z && e.shiftKey) || e.key.toLowerCase() === 'y')) { e.preventDefault(); undoRedoRef.current.redo(); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  // ── Unsaved-changes guard + autosave ───────────────────────────────────────
  useEffect(() => {
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      if (saveShortcut.current.dirty) { e.preventDefault(); e.returnValue = ''; }
    };
    window.addEventListener('beforeunload', onBeforeUnload);
    const auto = setInterval(() => {
      const cur = saveShortcut.current;
      if (cur.dirty && !cur.saving) cur.save();
    }, 30_000);
    return () => {
      window.removeEventListener('beforeunload', onBeforeUnload);
      clearInterval(auto);
    };
  }, []);

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

    // Column choices shared with the PDF (lead time renders inline on section rows)
    const ec = exportCols;
    const colCount = 1 + (ec.brand ? 1 : 0) + (ec.qty ? 1 : 0) + (ec.unit ? 1 : 0) + (ec.amount ? 1 : 0);
    const labelSpan = Math.max(1, colCount - 1);

    let rows = '';
    for (const group of SECTION_GROUPS) {
      // Empty sections (e.g. unused seeded defaults) never reach the client export
      const groupSecs = liveSecs.filter((s) =>
        s.group_key === group.key && s.items.some((i) => !i._deleted));
      if (!groupSecs.length) continue;
      rows += `<tr style="background:#12463b;color:#fff;font-weight:bold">
        <td colspan="${colCount}">${group.label}</td>
      </tr>`;
      for (const sec of groupSecs) {
        const secTotal = sec.items.filter((i) => !i._deleted && !i.parent_item_id)
          .reduce((s, i) => s + (num(i.quantity) ?? 0) * (num(i.sell_price) ?? 0), 0);
        rows += `<tr style="background:#e8eef7;font-weight:bold;color:#12463b">
          <td colspan="${colCount - (ec.amount ? 1 : 0)}">${sec.title}${ec.lead && sec.lead_time ? ` — lead time ${sec.lead_time}` : ''}</td>
          ${ec.amount ? `<td style="text-align:right">${secTotal > 0 ? fmtIdr(secTotal) : ''}</td>` : ''}
        </tr>`;
        for (const item of sec.items.filter((i) => !i._deleted)) {
          const isChild = !!item.parent_item_id;
          rows += `<tr style="${isChild ? 'font-style:italic;color:#555' : ''}">
            <td style="padding-left:${isChild ? '24' : '8'}px">${item.description}</td>
            ${ec.brand ? `<td>${item.brand}</td>` : ''}
            ${ec.qty ? `<td style="text-align:right">${item.quantity ?? ''}</td>` : ''}
            ${ec.unit ? `<td>${item.unit}</td>` : ''}
            ${ec.amount ? '<td></td>' : ''}
          </tr>`;
          if (sec.group_key === 'solar_panels' && !isChild && itemWp(item) > 0 && item.unit.trim().toLowerCase() !== 'wp') {
            rows += `<tr style="font-style:italic;color:#1a7f4f">
              <td style="padding-left:24px">Total system size</td>
              ${ec.brand ? '<td></td>' : ''}
              ${ec.qty ? `<td style="text-align:right;font-weight:bold">${itemWp(item).toLocaleString('en-US')}</td>` : ''}
              ${ec.unit ? '<td>Wp</td>' : ''}
              ${ec.amount ? '<td></td>' : ''}
            </tr>`;
          }
        }
      }
    }

    const html = `<html><head><meta charset="utf-8"/>
    <style>table{border-collapse:collapse;width:100%}th,td{border:1px solid #ccc;padding:4px 8px;font-size:11px}th{background:#12463b;color:#fff}</style>
    </head><body>
    <p><b>CUSTOMER:</b> ${quote.customer_name}</p>
    <p>${quote.customer_address}</p>
    <p>${quote.project_description}</p>
    <p style="text-align:right"><b>QUOTE ID:</b> ${quote.quote_number} &nbsp; ${quote.quote_date}</p>
    <table>
      <tr><th>ITEMS</th>${ec.brand ? '<th>BRAND</th>' : ''}${ec.qty ? '<th>QTY</th>' : ''}${ec.unit ? '<th>UNIT</th>' : ''}${ec.amount ? '<th>AMOUNT</th>' : ''}</tr>
      ${rows}
      <tr><td colspan="${labelSpan}" style="text-align:right;font-weight:bold">Total (excl. PPN${ppnPct}%)</td>
          <td style="text-align:right">${fmtIdr(subtotal)}</td></tr>
      <tr><td colspan="${labelSpan}" style="text-align:right">PPN${ppnPct}%</td>
          <td style="text-align:right">${fmtIdr(ppn)}</td></tr>
      <tr><td colspan="${labelSpan}" style="text-align:right;font-weight:bold">GRAND TOTAL</td>
          <td style="text-align:right;font-weight:bold">${fmtIdr(grandTotal)}</td></tr>
      ${wpTotal > 0 ? `
      <tr><td colspan="${labelSpan}" style="text-align:right;font-weight:bold">Harga per Wp (Exc. PPN${ppnPct}%)</td>
          <td style="text-align:right;font-weight:bold">${fmtIdr(subtotal / wpTotal)}</td></tr>
      <tr><td colspan="${labelSpan}" style="text-align:right;font-weight:bold">Harga per Wp (Inc. PPN${ppnPct}%)</td>
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
    a.download = `${quoteFileName(quote.quote_number, quote.customer_name, wpTotal, {
      specTag: specFileTag(quote.project_type, quote.system_specs ?? {}),
      location: quote.location ?? '',
    })}.xls`;
    a.click();
  }

  // ── Render ─────────────────────────────────────────────────────────────────

  if (!gate.ready || loadingQuote || !quote) {
    return <div className="min-h-screen bg-[#141518] flex items-center justify-center text-slate-500">Loading…</div>;
  }

  const liveSections = sections.filter((s) => !s._deleted);

  return (
    <div className="min-h-screen bg-[#141518] text-slate-200 font-sans text-sm">
      {/* Hide native number spinners — rarely used and they collide with arrow-key cell navigation */}
      <style>{`
        input[type=number]::-webkit-outer-spin-button,
        input[type=number]::-webkit-inner-spin-button { -webkit-appearance: none; margin: 0; }
        input[type=number] { -moz-appearance: textfield; appearance: textfield; }
      `}</style>

      {/* ── Sticky header ── */}
      <div className="sticky top-0 z-40 bg-[#141518]/95 backdrop-blur-xl border-b border-white/[0.07]">
        <div className="max-w-[1400px] mx-auto px-4 sm:px-6 py-3 flex items-center justify-between gap-3">
          <div className="flex items-center gap-3 min-w-0">
            <Link
              href="/quotes"
              onClick={(e) => { if (dirty && !window.confirm('You have unsaved changes — leave anyway?')) e.preventDefault(); }}
              className="text-slate-500 hover:text-slate-300 transition-colors flex-shrink-0"
            >
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M15 19l-7-7 7-7" /></svg>
            </Link>
            <div className="min-w-0">
              <p className="text-[11px] text-slate-500 truncate">{quote.customer_name || 'No customer'}</p>
              <p className="font-semibold text-white truncate text-base leading-tight">{quote.quote_number}</p>
            </div>
          </div>
          {/* Scrolls horizontally on phones so the toolbar never runs off-screen */}
          <div className="flex items-center gap-2 min-w-0 overflow-x-auto scrollbar-none [&>*]:flex-shrink-0">
            {/* Status selector */}
            <select
              value={quote.status}
              disabled={locked}
              title={locked ? 'SENT — only an Owner can change the status' : undefined}
              onChange={(e) => setQuoteField('status', e.target.value as ProjectQuote['status'])}
              className={`px-2.5 py-1 rounded-full text-[11px] font-semibold uppercase tracking-wider border-0 outline-none cursor-pointer disabled:cursor-not-allowed ${STATUS_COLORS[quote.status]}`}
            >
              {STATUS_OPTS.map((s) => <option key={s} value={s}>{s}</option>)}
            </select>
            {quote.sent_at && (
              <span className="text-[11px] text-blue-300/70 hidden md:inline" title="Stamped by the database when the status was set to SENT">
                sent {fmtDateTime(quote.sent_at)}
              </span>
            )}
            {saveMsg && (
              <span
                title={saveMsg}
                className={`text-[11px] max-w-[220px] truncate ${saveMsg === 'Saved' || saveMsg === 'Costs refreshed' ? 'text-emerald-400' : 'text-red-400'}`}
              >
                {saveMsg}
              </span>
            )}
            {dirty && !saving && <span className="text-[11px] text-amber-400">Unsaved</span>}
            {!locked && (
              <div className="flex items-center gap-0.5">
                <button onClick={undo} disabled={history.current.past.length === 0}
                  title="Undo (Ctrl/Cmd+Z)"
                  className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-white/10 border border-white/[0.06] disabled:opacity-30 disabled:hover:bg-transparent transition-all">
                  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2"><path strokeLinecap="round" strokeLinejoin="round" d="M9 14L4 9l5-5M4 9h11a5 5 0 010 10h-1" /></svg>
                </button>
                <button onClick={redo} disabled={history.current.future.length === 0}
                  title="Redo (Ctrl/Cmd+Shift+Z)"
                  className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-white/10 border border-white/[0.06] disabled:opacity-30 disabled:hover:bg-transparent transition-all">
                  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2"><path strokeLinecap="round" strokeLinejoin="round" d="M15 14l5-5-5-5m5 5H9a5 5 0 000 10h1" /></svg>
                </button>
              </div>
            )}
            <div className="relative">
              <button onClick={() => setShowExportCols((v) => !v)}
                title="Choose which columns appear on the PDF and Excel exports"
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[11px] font-medium text-slate-400 hover:text-white hover:bg-white/10 border border-white/[0.06] transition-all">
                <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M9 4v16m6-16v16M4 4h16v16H4z" /></svg>
                Columns
              </button>
              {showExportCols && (
                <>
                  <div className="fixed inset-0 z-40" onClick={() => setShowExportCols(false)} />
                  <div className="absolute right-0 top-full mt-2 z-50 w-52 bg-slate-900 border border-slate-700 rounded-xl shadow-2xl p-3 space-y-2">
                    <p className="text-[10px] uppercase tracking-wider text-slate-500">Export columns</p>
                    {EXPORT_COL_KEYS.map((k) => (
                      <label key={k} className="flex items-center gap-2 text-xs text-slate-300 cursor-pointer">
                        <input type="checkbox" checked={exportCols[k]} onChange={(e) => setExportCol(k, e.target.checked)} className="accent-violet-600" />
                        {EXPORT_COL_LABELS[k]}
                      </label>
                    ))}
                    <p className="text-[10px] text-slate-600 leading-snug">Applies to PDF and Excel. Amounts off = scope-only BOM.</p>
                  </div>
                </>
              )}
            </div>
            <button onClick={refreshCosts} disabled={catalogLoading || locked}
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
            <button onClick={save} disabled={saving || !dirty || locked}
              title={locked ? 'SENT quotes can only be edited by an Owner' : 'Ctrl+S / Cmd+S'}
              className="flex items-center gap-1.5 px-4 py-1.5 rounded-lg text-[11px] font-semibold bg-violet-600 hover:bg-violet-500 text-white transition-all disabled:opacity-40">
              {saving ? 'Saving…' : 'Save'}
              <span className="hidden sm:inline text-white/50 text-[9px] font-normal">⌘S</span>
            </button>
          </div>
        </div>
      </div>

      <main className="max-w-[1400px] mx-auto px-4 sm:px-6 py-6 pb-24 space-y-6">

        <MobileNotice variant="edit" />
        <MigrationBanner />

        {locked && (
          <div className="bg-amber-500/10 border border-amber-500/40 rounded-2xl px-4 py-3 text-sm text-amber-300">
            🔒 This quote is <span className="font-bold">SENT</span> and read-only for your role.
            Ask an Owner to make changes, or duplicate it from the quotes list to start a new revision.
          </div>
        )}

        {/* ── Audit line ── */}
        {(quote.created_by_email || quote.updated_by_email) && (
          <p className="text-[11px] text-slate-600 px-1">
            {quote.created_by_email && <>Created by <span className="text-slate-400">{quote.created_by_email}</span></>}
            {quote.updated_by_email && (
              <> · Last edited by <span className="text-slate-400">{quote.updated_by_email}</span>
                {quote.updated_at && <> on {fmtDateTime(quote.updated_at)}</>}</>
            )}
            <button onClick={openActivity} className="ml-2 underline text-slate-500 hover:text-slate-300 transition-colors">
              View history
            </button>
          </p>
        )}

        {/* ── Header form ── */}
        <div className={`bg-slate-900/50 border border-slate-800 rounded-2xl p-5 grid grid-cols-1 md:grid-cols-2 gap-4 ${locked ? 'pointer-events-none opacity-70' : ''}`}>
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
            <input value={quote.customer_name}
              onChange={(e) => setQuoteField('customer_name', e.target.value)}
              onFocus={(e) => {
                const r = e.target.getBoundingClientRect();
                setCustAc({ x: r.left, y: r.bottom, w: Math.max(r.width, 320) });
              }}
              onBlur={() => setCustAc(null)}
              onKeyDown={(e) => { if (e.key === 'Escape' || e.key === 'Enter') setCustAc(null); }}
              placeholder="Customer name" className="w-full bg-transparent border-b border-slate-700 focus:border-violet-500 outline-none text-white py-1 text-sm placeholder:text-slate-600 transition-colors" />
            {custAc && (() => {
              const q = quote.customer_name.trim().toLowerCase();
              const matches = (q ? pastCustomers.filter((c) => c.name.toLowerCase().includes(q)) : pastCustomers).slice(0, 8);
              if (!matches.length) return null;
              return (
                <div
                  style={{ position: 'fixed', left: custAc.x, top: custAc.y + 6, width: custAc.w }}
                  className="z-50 bg-slate-900 border border-slate-700 rounded-xl shadow-2xl py-1 max-h-64 overflow-y-auto"
                >
                  <p className="px-3 pt-1.5 pb-1 text-[9px] uppercase tracking-widest text-slate-600">Previous customers</p>
                  {matches.map((c) => (
                    <button
                      key={c.name}
                      onMouseDown={(e) => { e.preventDefault(); pickCustomer(c); }}
                      className="block w-full text-left px-3 py-1.5 hover:bg-violet-500/20 transition-colors"
                    >
                      <span className="block text-xs text-slate-200">{c.name}</span>
                      {c.address && <span className="block text-[10px] text-slate-500 truncate">{c.address}</span>}
                    </button>
                  ))}
                </div>
              );
            })()}
          </div>
          <div>
            <label className="block text-[10px] uppercase tracking-widest text-slate-500 mb-1">Address</label>
            <input value={quote.customer_address} onChange={(e) => setQuoteField('customer_address', e.target.value)}
              placeholder="Customer address" className="w-full bg-transparent border-b border-slate-700 focus:border-violet-500 outline-none text-white py-1 text-sm placeholder:text-slate-600 transition-colors" />
          </div>
          <div>
            <label className="block text-[10px] uppercase tracking-widest text-slate-500 mb-1">Project Type</label>
            <select
              value={(quote.project_type as ProjectType) ?? 'custom'}
              onChange={(e) => updateProject({ project_type: e.target.value as ProjectType })}
              className="w-full bg-transparent border-b border-slate-700 focus:border-violet-500 outline-none text-white py-1 text-sm transition-colors"
            >
              {PROJECT_TYPES.map((t) => (
                <option key={t.key} value={t.key} className="bg-slate-900">{t.label}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-[10px] uppercase tracking-widest text-slate-500 mb-1">Location / Site</label>
            <input value={quote.location ?? ''} onChange={(e) => updateProject({ location: e.target.value })}
              placeholder="e.g. RIVERSIDE PV FARM, Kota Tangerang" className="w-full bg-transparent border-b border-slate-700 focus:border-violet-500 outline-none text-white py-1 text-sm placeholder:text-slate-600 transition-colors" />
          </div>
          {isSolarType(quote.project_type) && (
            <div className="md:col-span-2 flex flex-wrap gap-6">
              <SpecInput label="PV Modules" unit="kWp DC" value={quote.system_specs?.kwp_dc}
                onChange={(v) => updateProject({ specs: { kwp_dc: v } })} />
              <SpecInput label="Inverters" unit="kW AC" value={quote.system_specs?.kw_ac}
                onChange={(v) => updateProject({ specs: { kw_ac: v } })} />
              {(quote.project_type as ProjectType) === 'hybrid_bess' && (
                <SpecInput label="PCS" unit="kW" value={quote.system_specs?.kw_pcs}
                  onChange={(v) => updateProject({ specs: { kw_pcs: v } })} />
              )}
              {(quote.project_type as ProjectType) !== 'on_grid' && (
                <SpecInput label="BESS" unit="kWh" value={quote.system_specs?.kwh_bess}
                  onChange={(v) => updateProject({ specs: { kwh_bess: v } })} />
              )}
            </div>
          )}
          {(quote.project_type as ProjectType) === 'evcs' && (
            <div className="md:col-span-2 flex flex-wrap gap-6">
              <SpecInput label="EV Charger" unit="kW" value={quote.system_specs?.kw_evcs}
                onChange={(v) => updateProject({ specs: { kw_evcs: v } })} />
              <div className="w-40">
                <label className="block text-[10px] uppercase tracking-widest text-slate-500 mb-1">Phase</label>
                <select
                  value={quote.system_specs?.phase ?? ''}
                  onChange={(e) => updateProject({ specs: { phase: (e.target.value || null) as Phase | null } })}
                  className="w-full bg-transparent border-b border-slate-700 focus:border-violet-500 outline-none text-white py-1 text-sm transition-colors"
                >
                  <option value="" className="bg-slate-900">— select —</option>
                  <option value="single" className="bg-slate-900">Single-Phase</option>
                  <option value="triple" className="bg-slate-900">Three-Phase</option>
                </select>
              </div>
            </div>
          )}
          <div className="md:col-span-2">
            <label className="block text-[10px] uppercase tracking-widest text-slate-500 mb-1">
              Project Description
              {((quote.project_type as ProjectType) ?? 'custom') !== 'custom' && (
                <span className="ml-2 normal-case tracking-normal text-emerald-500/80">auto-generated from the fields above</span>
              )}
            </label>
            {((quote.project_type as ProjectType) ?? 'custom') === 'custom' ? (
              <input value={quote.project_description} onChange={(e) => setQuoteField('project_description', e.target.value)}
                placeholder="e.g. EPC for solar On Grid 2.2 kWp DC / 2 kW AC, at Kota Tangerang" className="w-full bg-transparent border-b border-slate-700 focus:border-violet-500 outline-none text-white py-1 text-sm placeholder:text-slate-600 transition-colors" />
            ) : (
              <p className="text-slate-200 text-sm py-1 border-b border-slate-800 min-h-[1.9rem]">
                {quote.project_description || <span className="text-slate-600">Fill in the capacities above…</span>}
              </p>
            )}
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
        <div className={`space-y-8 ${locked ? 'pointer-events-none opacity-70' : ''}`} ref={acRef}>
          {SECTION_GROUPS.map((group) => {
            const groupSections = liveSections.filter((s) => s.group_key === group.key);
            const groupTotal = groupSections.reduce((gs, s) =>
              gs + s.items.filter((i) => !i._deleted && !i.parent_item_id)
                .reduce((ss, i) => ss + (num(i.quantity) ?? 0) * (num(i.sell_price) ?? 0), 0), 0);
            return (
              <div key={group.key}>
                {/* Group header — also a drop zone: sections dropped here go to the end of this group */}
                <div
                  className={`flex flex-wrap items-center justify-between gap-x-3 gap-y-2 mb-3 px-3 sm:px-4 py-2.5 rounded-xl transition-colors ${dropHint === `group:${group.key}` ? 'bg-violet-600/30 ring-1 ring-violet-500' : 'bg-[#12463b] hover:bg-[#1a5c4c]'}`}
                  onDragOver={(e) => { if (drag?.kind === 'section') { e.preventDefault(); setDropHint(`group:${group.key}`); } }}
                  onDragLeave={() => setDropHint((h) => h === `group:${group.key}` ? null : h)}
                  onDrop={(e) => { e.preventDefault(); dropSectionOnGroup(group.key); endDrag(); }}
                >
                  <h2 className="text-sm font-extrabold uppercase tracking-widest text-white">
                    {group.label}
                    <span className="ml-2 text-sky-200/50 font-normal normal-case tracking-normal text-xs">
                      {groupSections.length || 'no'} sub-section{groupSections.length !== 1 ? 's' : ''}
                    </span>
                  </h2>
                  <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                    <div className="flex items-center gap-1.5" title="Default margin for new line items in this group; each line's GM% can still be overridden">
                      <span className="text-[10px] uppercase tracking-wider text-sky-200/60">GM%</span>
                      <input
                        type="number"
                        value={quote.group_margins?.[group.key] ?? ''}
                        onChange={(e) => setGroupMargin(group.key, e.target.value)}
                        placeholder="—"
                        className="w-14 bg-black/25 border border-white/15 focus:border-emerald-400 rounded-lg px-2 py-0.5 text-xs text-right text-emerald-300 outline-none transition-colors placeholder:text-sky-200/40"
                      />
                      {groupGm(group.key) != null && (
                        <button
                          onClick={() => applyGmToGroup(group.key)}
                          className="text-[10px] text-sky-200/60 hover:text-emerald-300 transition-colors whitespace-nowrap"
                          title="Re-price every line in this group with this margin (overwrites per-line margins)"
                        >
                          apply to all
                        </button>
                      )}
                    </div>
                    {groupTotal > 0 && <span className="text-sm font-bold text-white tabular-nums">{fmtIdr(groupTotal)}</span>}
                  </div>
                </div>
                <div className="space-y-3">
                  {groupSections.map((sec) => {
            const liveItems = sec.items.filter((i) => !i._deleted);
            const mainItems = liveItems.filter((i) => !i.parent_item_id);
            const secSubtotal = mainItems.reduce((s, i) => s + (num(i.quantity) ?? 0) * (num(i.sell_price) ?? 0), 0);

            return (
              <div
                key={sec.section_id}
                className={`bg-slate-900/50 hover:bg-slate-900/80 border rounded-2xl overflow-hidden transition-colors ${dropHint === sec.section_id ? 'border-violet-500 ring-1 ring-violet-500/50' : 'border-slate-800 hover:border-slate-600'}`}
                onDragOver={(e) => { if (drag?.kind === 'section' && drag.sectionId !== sec.section_id) { e.preventDefault(); setDropHint(sec.section_id); } }}
                onDragLeave={() => setDropHint((h) => h === sec.section_id ? null : h)}
                onDrop={(e) => { e.preventDefault(); dropSectionOn(sec.section_id); endDrag(); }}
              >
                {/* Section header */}
                <div className="flex items-center gap-3 px-4 py-3 bg-[#12463b]/25 hover:bg-[#12463b]/45 border-b border-[#12463b]/50 transition-colors">
                  <span
                    draggable
                    onDragStart={(e) => { e.dataTransfer.effectAllowed = 'move'; setDrag({ kind: 'section', sectionId: sec.section_id }); }}
                    onDragEnd={endDrag}
                    className="cursor-grab active:cursor-grabbing text-slate-600 hover:text-slate-300 flex-shrink-0 -ml-1"
                    title="Drag to reorder / move to another group"
                  >
                    {GRIP}
                  </span>
                  <div className="flex-1 flex items-center gap-2 group/title min-w-0 relative">
                    <svg className="w-3.5 h-3.5 text-slate-500 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" /></svg>
                    <input
                      value={sec.title}
                      onChange={(e) => updateSection(sec.section_id, { title: e.target.value })}
                      onFocus={(e) => {
                        e.target.select();
                        const r = e.target.getBoundingClientRect();
                        setTitleAcFor({ id: sec.section_id, x: r.left, y: r.bottom, w: Math.max(r.width, 320) });
                      }}
                      onBlur={() => setTitleAcFor((v) => (v?.id === sec.section_id ? null : v))}
                      onKeyDown={(e) => { if (e.key === 'Escape' || e.key === 'Enter') setTitleAcFor(null); }}
                      className="flex-1 min-w-0 bg-transparent outline-none font-semibold text-white placeholder:text-slate-500 border-b border-dashed border-slate-600 group-hover/title:border-slate-400 focus:border-solid focus:border-violet-500 transition-colors py-0.5"
                      placeholder="Click to name this section…"
                      title="Click to rename section"
                    />
                    {titleAcFor?.id === sec.section_id && (() => {
                      // Suggest the house-style titles for this group, hiding ones
                      // already used by another section; typing narrows the list
                      const used = new Set(sections
                        .filter((s) => !s._deleted && s.group_key === sec.group_key && s.section_id !== sec.section_id)
                        .map((s) => s.title.trim().toLowerCase()));
                      const all = STANDARD_SECTIONS[sec.group_key].filter((t) => !used.has(t.toLowerCase()));
                      const q = sec.title.trim().toLowerCase();
                      const filtered = q ? all.filter((t) => t.toLowerCase().includes(q)) : all;
                      const shown = filtered.length ? filtered : all;
                      if (!shown.length) return null;
                      return (
                        <div
                          style={{ position: 'fixed', left: titleAcFor.x, top: titleAcFor.y + 6, width: titleAcFor.w }}
                          className="z-50 bg-slate-900 border border-slate-700 rounded-xl shadow-2xl py-1 max-h-64 overflow-y-auto"
                        >
                          {shown.map((t) => (
                            <button
                              key={t}
                              onMouseDown={(e) => { e.preventDefault(); updateSection(sec.section_id, { title: t }); setTitleAcFor(null); }}
                              className="block w-full text-left px-3 py-1.5 text-xs text-slate-300 hover:bg-violet-500/20 hover:text-white transition-colors"
                            >
                              {t}
                            </button>
                          ))}
                        </div>
                      );
                    })()}
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
                  <table className="w-full text-[13px]">
                    <thead>
                      <tr className="border-b border-slate-800 text-[10px] uppercase tracking-wider text-slate-400">
                        <th className="w-6" />
                        <th className="text-left px-2 py-2 min-w-[260px]">Description</th>
                        <th className="text-left px-2 py-2 w-28">Brand</th>
                        <th className="text-right px-2 py-2 w-20">Qty</th>
                        <th className="text-left px-2 py-2 w-24">Unit</th>
                        <th className="text-right px-2 py-2 w-32 bg-violet-500/[0.07] text-violet-300/80" title="Internal — never shown on client exports">TUC / Cost 🔒</th>
                        <th className="text-right px-2 py-2 w-32">Sell / Unit</th>
                        <th className="text-right px-2 py-2 w-16 bg-violet-500/[0.07] text-violet-300/80" title="Internal — never shown on client exports">GM %</th>
                        <th className="text-right px-2 py-2 w-28">Total</th>
                        <th className="w-8" />
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-800/40">
                      {mainItems.map((item, itemIdx) => {
                        const subItems = liveItems.filter((i) => i.parent_item_id === item.item_id);
                        const total = (num(item.quantity) ?? 0) * (num(item.sell_price) ?? 0);
                        const gm = gmFromPrices(item.cost_price, item.sell_price);
                        const isAcOpen = acState?.itemId === item.item_id;
                        const drift = itemDrift(item);

                        return (
                          <React.Fragment key={item.item_id}>
                            {/* Main item row */}
                            <tr
                              className={`transition-colors hover:bg-white/[0.06] ${dropHint === item.item_id ? 'bg-violet-500/10' : itemIdx % 2 === 1 ? 'bg-white/[0.015]' : ''}`}
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
                                    // Manual typing makes this a free-text item: break any catalog
                                    // link so costs/history can't come from the wrong component.
                                    // Picking from the dropdown re-links.
                                    updateItem(sec.section_id, item.item_id, { description: e.target.value, component_id: null });
                                    openAc(sec.section_id, item.item_id, e.target.value, e.target);
                                  }}
                                  onFocus={(e) => item.description && openAc(sec.section_id, item.item_id, item.description, e.target)}
                                  onKeyDown={(e) => {
                                    if (isAcOpen && acCount > 0) {
                                      if (e.key === 'ArrowDown') { e.preventDefault(); setAcIndex((i) => (i + 1) % acCount); }
                                      else if (e.key === 'ArrowUp') { e.preventDefault(); setAcIndex((i) => (i - 1 + acCount) % acCount); }
                                      else if (e.key === 'Escape') { setAcState(null); }
                                      else if (e.key === 'Enter' || e.key === 'Tab') {
                                        // Enter picks and stays; Tab picks and moves on to Brand
                                        if (e.key === 'Enter') e.preventDefault();
                                        if (acIndex < acResults.comps.length) {
                                          selectComponent(sec.section_id, item.item_id, acResults.comps[acIndex]);
                                        } else {
                                          const p = acResults.prev[acIndex - acResults.comps.length];
                                          if (p) selectPrevItem(sec.section_id, item.item_id, p);
                                        }
                                      }
                                      return;
                                    }
                                    navCell(e, item.item_id, 'desc');
                                  }}
                                  data-nav-row={item.item_id}
                                  data-nav-col="desc"
                                  placeholder="Type to search catalog & past quotes…"
                                  className={`w-full bg-transparent outline-none text-slate-100 placeholder:text-slate-600 border-b border-slate-800 hover:border-slate-600 focus:border-violet-500 transition-colors ${item.component_id ? 'pr-5' : ''}`}
                                />
                                {item.component_id && (
                                  <span
                                    className="absolute right-1 top-1/2 -translate-y-1/2 text-emerald-400/70"
                                    title={`Linked to catalog: ${compById.get(item.component_id)?.supplier_model ?? 'unknown component'} — costs and history come from this link; typing in the description unlinks`}
                                  >
                                    <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2"><path strokeLinecap="round" strokeLinejoin="round" d="M13.828 10.172a4 4 0 010 5.656l-3 3a4 4 0 01-5.656-5.656l1.5-1.5m7.156-7.156a4 4 0 015.656 5.656l-1.5 1.5" /></svg>
                                  </span>
                                )}
                                {/* Autocomplete dropdown — fixed so table overflow can't clip it */}
                                {isAcOpen && acState && acCount > 0 && (
                                  <div
                                    data-ac-dropdown
                                    className="fixed z-50 w-[420px] max-w-[calc(100vw-32px)] max-h-80 overflow-y-auto bg-slate-900 border border-slate-700 rounded-xl shadow-2xl"
                                    style={{ left: Math.min(acState.x, Math.max(16, window.innerWidth - 436)), top: acState.y + 4 }}
                                  >
                                    {acResults.comps.map((comp, ci) => {
                                      const cc = catalogLoading ? null : costFor(comp.component_id);
                                      return (
                                        <button
                                          key={comp.component_id}
                                          data-ac-idx={ci}
                                          onMouseDown={(e) => { e.preventDefault(); selectComponent(sec.section_id, item.item_id, comp); }}
                                          onMouseEnter={() => setAcIndex(ci)}
                                          className={`w-full text-left px-4 py-2.5 transition-colors flex items-center justify-between gap-3 ${acIndex === ci ? 'bg-slate-800' : ''}`}
                                        >
                                          <div className="min-w-0">
                                            <p className="text-slate-200 font-medium truncate">{comp.supplier_model}</p>
                                            <p className="text-[10px] text-slate-500">{[comp.brand, comp.category].filter(Boolean).join(' · ')}</p>
                                          </div>
                                          <div className="text-right flex-shrink-0">
                                            {cc ? <p className={`font-semibold text-xs ${SOURCE_TEXT[cc.source]}`}>{fmtIdr(cc.cost)}</p>
                                                : <p className="text-slate-600 text-[10px]">no price data</p>}
                                            {cc && (
                                              priceAgeDays(cc.asOf) > AGED_PRICE_DAYS ? (
                                                <p className="text-[10px] text-amber-400 font-semibold" title={`Price is from ${cc.asOf || 'an unknown date'} — consider re-checking with the supplier`}>
                                                  ⚠ aged · {srcLabel(cc)}
                                                </p>
                                              ) : (
                                                <p className="text-[10px] text-slate-600">{srcLabel(cc)}</p>
                                              )
                                            )}
                                          </div>
                                        </button>
                                      );
                                    })}
                                    {acResults.prev.length > 0 && (
                                      <p className="px-4 pt-2 pb-1 text-[9px] uppercase tracking-wider text-slate-600 border-t border-slate-800">
                                        Previously entered items
                                      </p>
                                    )}
                                    {acResults.prev.map((p, pi) => {
                                      const rowKey = `prev-${p.description.toLowerCase()}`;
                                      if (prevEdit?.key === rowKey) {
                                        return (
                                          <div key={rowKey} className="px-4 py-2.5 bg-slate-800/70 space-y-1.5 border-y border-slate-700">
                                            <p className="text-[10px] text-slate-400">
                                              Rename everywhere — updates {p.count} previous entr{p.count > 1 ? 'ies' : 'y'} and this quote
                                            </p>
                                            <input
                                              value={prevEdit.description}
                                              onChange={(e) => setPrevEdit({ ...prevEdit, description: e.target.value })}
                                              onKeyDown={(e) => { if (e.key === 'Enter') renamePrevItem(); if (e.key === 'Escape') setPrevEdit(null); }}
                                              ref={prevEditInputRef}
                                              className="w-full bg-slate-900 border border-slate-600 focus:border-violet-500 rounded-lg px-2 py-1 text-xs text-white outline-none transition-colors"
                                            />
                                            <div className="flex items-center gap-1.5">
                                              <input
                                                value={prevEdit.brand}
                                                onChange={(e) => setPrevEdit({ ...prevEdit, brand: e.target.value })}
                                                onKeyDown={(e) => { if (e.key === 'Enter') renamePrevItem(); if (e.key === 'Escape') setPrevEdit(null); }}
                                                placeholder="Brand"
                                                className="flex-1 min-w-0 bg-slate-900 border border-slate-600 focus:border-violet-500 rounded-lg px-2 py-1 text-xs text-slate-200 outline-none transition-colors"
                                              />
                                              <button onClick={renamePrevItem} disabled={prevEditBusy}
                                                className="px-2.5 py-1 rounded-lg bg-violet-600 hover:bg-violet-500 text-white text-[10px] font-semibold transition-colors disabled:opacity-50">
                                                {prevEditBusy ? 'Renaming…' : 'Rename'}
                                              </button>
                                              <button onClick={() => setPrevEdit(null)} disabled={prevEditBusy}
                                                className="px-2 py-1 text-slate-400 hover:text-white text-[10px] transition-colors">
                                                Cancel
                                              </button>
                                            </div>
                                            {prevEditError && <p className="text-[10px] text-red-400">{prevEditError}</p>}
                                          </div>
                                        );
                                      }
                                      return (
                                        <div key={rowKey} className="relative group/prev">
                                          <button
                                            data-ac-idx={acResults.comps.length + pi}
                                            onMouseDown={(e) => { e.preventDefault(); selectPrevItem(sec.section_id, item.item_id, p); }}
                                            onMouseEnter={() => setAcIndex(acResults.comps.length + pi)}
                                            className={`w-full text-left px-4 py-2.5 pr-11 transition-colors flex items-center justify-between gap-3 ${acIndex === acResults.comps.length + pi ? 'bg-slate-800' : ''}`}
                                          >
                                            <div className="min-w-0">
                                              <p className="text-slate-200 font-medium truncate">
                                                <span className="mr-1.5 px-1 py-0.5 rounded text-[9px] font-bold bg-amber-500/20 text-amber-300 align-middle">PREV</span>
                                                {p.description}
                                              </p>
                                              <p className="text-[10px] text-slate-500 truncate">
                                                {[p.brand, p.date ? `${p.label} · ${p.date}` : p.label, p.count > 1 ? `used ${p.count}×` : null].filter(Boolean).join(' · ')}
                                              </p>
                                              {(() => {
                                                // Surface hidden catalog links that don't match the description —
                                                // picking this entry copies the link, so a wrong one must be visible
                                                if (!p.component_id) return null;
                                                const linked = compById.get(p.component_id)?.supplier_model ?? 'unknown component';
                                                if (p.description.toLowerCase().includes(linked.toLowerCase())) return null;
                                                return (
                                                  <p className="text-[10px] text-amber-400/90 truncate" title="This past entry carries a catalog link to a DIFFERENT item — picking it copies that link. Unlink after picking (link icon → Unlink) if it's wrong.">
                                                    ⚠ linked to: {linked}
                                                  </p>
                                                );
                                              })()}
                                            </div>
                                            <div className="text-right flex-shrink-0">
                                              {p.cost_price != null
                                                ? <p className="font-semibold text-xs text-amber-400">{fmtIdr(p.cost_price)}</p>
                                                : <p className="text-slate-600 text-[10px]">no cost</p>}
                                              {p.date && priceAgeDays(p.date) > AGED_PRICE_DAYS
                                                ? <p className="text-[10px] text-amber-400 font-semibold" title={`Last used ${p.date} — consider re-checking`}>⚠ aged</p>
                                                : <p className="text-[10px] text-slate-600">{p.date ? 'last used' : 'library'}</p>}
                                            </div>
                                          </button>
                                          {/* Sibling overlay so the select button's mousedown can't swallow it */}
                                          <button
                                            type="button"
                                            onMouseDown={(e) => e.preventDefault()}
                                            onClick={(e) => {
                                              e.stopPropagation();
                                              setPrevEditError('');
                                              setPrevEdit({ key: rowKey, description: p.description, brand: p.brand, original: p });
                                            }}
                                            className="absolute right-2 top-1/2 -translate-y-1/2 p-1.5 rounded-lg opacity-0 group-hover/prev:opacity-100 hover:bg-white/10 text-slate-500 hover:text-white transition-all"
                                            title="Rename this entry everywhere — fix inconsistent naming"
                                          >
                                            <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" /></svg>
                                          </button>
                                        </div>
                                      );
                                    })}
                                  </div>
                                )}
                              </td>
                              <td className="px-2 py-2">
                                <input value={item.brand} onChange={(e) => updateItem(sec.section_id, item.item_id, { brand: e.target.value })}
                                  onKeyDown={(e) => navCell(e, item.item_id, 'brand')}
                                  data-nav-row={item.item_id} data-nav-col="brand"
                                  placeholder="Brand" className="w-full bg-transparent outline-none text-slate-200 placeholder:text-slate-600 border-b border-slate-800 hover:border-slate-600 focus:border-violet-500 transition-colors" />
                              </td>
                              <td className="px-2 py-2 relative" title={item.qty_formula ? `Formula: ${item.qty_formula}` : `Row ${rowNumById.get(item.item_id) ?? ''} — type =2520*720, or =R3*2 to reference another row's qty`}>
                                {rowNumById.has(item.item_id) && (
                                  <span className="absolute -top-0.5 left-0.5 text-[8px] font-semibold text-slate-600 tabular-nums pointer-events-none select-none" title={`This is row R${rowNumById.get(item.item_id)} — reference it elsewhere as =R${rowNumById.get(item.item_id)}`}>R{rowNumById.get(item.item_id)}</span>
                                )}
                                {item.qty_formula && qtyEdit?.itemId !== item.item_id && (
                                  <span className="absolute left-1 top-1/2 -translate-y-1/2 text-[9px] font-bold text-sky-500/80 italic pointer-events-none">ƒ</span>
                                )}
                                <input
                                  type="text"
                                  inputMode="decimal"
                                  value={qtyEdit?.itemId === item.item_id ? qtyEdit.value : item.quantity}
                                  onFocus={(e) => { setQtyEdit({ itemId: item.item_id, value: item.qty_formula || item.quantity }); e.target.select(); }}
                                  onChange={(e) => setQtyEdit({ itemId: item.item_id, value: e.target.value })}
                                  onBlur={(e) => commitQty(sec.section_id, item.item_id, e.target.value)}
                                  onKeyDown={(e) => {
                                    if (e.key === 'Enter') { (e.target as HTMLInputElement).blur(); return; }
                                    navCell(e, item.item_id, 'qty');
                                  }}
                                  data-nav-row={item.item_id} data-nav-col="qty"
                                  placeholder="0"
                                  className="w-full bg-transparent outline-none text-right text-slate-100 placeholder:text-slate-600 border-b border-slate-800 hover:border-slate-600 focus:border-violet-500 transition-colors"
                                />
                              </td>
                              <td className="px-2 py-2">
                                <input list={`units-${item.item_id}`} value={item.unit}
                                  onChange={(e) => updateItem(sec.section_id, item.item_id, { unit: e.target.value })}
                                  onKeyDown={(e) => navCell(e, item.item_id, 'unit')}
                                  data-nav-row={item.item_id} data-nav-col="unit"
                                  placeholder="unit" className="w-full bg-transparent outline-none text-slate-200 placeholder:text-slate-600 border-b border-slate-800 hover:border-slate-600 focus:border-violet-500 transition-colors" />
                                <datalist id={`units-${item.item_id}`}>{UNITS.map((u) => <option key={u} value={u} />)}</datalist>
                              </td>
                              <td
                                className="px-2 py-2 bg-violet-500/[0.04]"
                                onMouseEnter={(e) => showCostHistory(sec.section_id, item.item_id, item.component_id, item.description, e.currentTarget)}
                                onMouseLeave={scheduleHoverClose}
                              >
                                <input type="text" inputMode="text" value={item.cost_price}
                                  onChange={(e) => updateItem(sec.section_id, item.item_id, { cost_price: e.target.value })}
                                  onKeyDown={(e) => { if (e.key === 'Enter') { (e.target as HTMLInputElement).blur(); return; } navCell(e, item.item_id, 'cost'); }}
                                  data-nav-row={item.item_id} data-nav-col="cost"
                                  onBlur={() => {
                                    const val = evalCell(item.cost_price);
                                    const patch: Partial<DraftItem> = {};
                                    if (val !== item.cost_price) patch.cost_price = val;
                                    // Auto-price the sell from the group GM using the evaluated cost
                                    if (!num(item.sell_price)) {
                                      const sell = sellFromGroupGm(sec.group_key, num(val));
                                      if (sell) patch.sell_price = sell;
                                    }
                                    if (Object.keys(patch).length) updateItem(sec.section_id, item.item_id, patch);
                                  }}
                                  placeholder="0 or =800000+180000"
                                  title={drift ? `Outdated: today's cost is ${fmtIdr(drift.rec)} (${drift.pct > 0 ? '+' : ''}${(drift.pct * 100).toFixed(1)}%). The Costs button refreshes all items, keeping margins.` : 'Type a number, or =800000+180000 to calculate'}
                                  className={`w-full bg-transparent outline-none text-right placeholder:text-slate-700 border-b transition-colors focus:border-violet-500 ${drift ? 'text-amber-300 border-amber-500/70 hover:border-amber-400' : 'text-slate-400 border-slate-800 hover:border-slate-600'} ${item.component_id || freeTextHistory.has(item.description.trim().toLowerCase()) ? 'cursor-help' : ''}`} />
                                {drift && (
                                  <p className="text-right text-[10px] text-amber-400/90 leading-tight" title="Today's recommended cost">
                                    now {fmtIdr(drift.rec)}
                                  </p>
                                )}
                                {costHover?.itemId === item.item_id && (
                                  <div
                                    className="fixed z-50 w-80 bg-slate-900 border border-slate-700 rounded-xl shadow-2xl p-3"
                                    style={{ left: Math.max(16, costHover.x - 320), top: costHover.y + 4 }}
                                    onMouseEnter={cancelHoverClose}
                                    onMouseLeave={scheduleHoverClose}
                                  >
                                    {costHover.linkedModel && (
                                      <div className="flex items-center justify-between gap-2 mb-2 pb-2 border-b border-slate-800">
                                        <p className="text-[10px] text-slate-500 truncate">
                                          Linked to <span className="text-emerald-300 font-medium">{costHover.linkedModel}</span>
                                        </p>
                                        <button
                                          onClick={unlinkFromPopup}
                                          title="Wrong item? Unlink — the row keeps its current cost but stops following this catalog component"
                                          className="text-[10px] text-red-400/80 hover:text-red-300 underline flex-shrink-0 transition-colors"
                                        >
                                          Unlink
                                        </button>
                                      </div>
                                    )}
                                    <p className="text-[10px] uppercase tracking-wider text-slate-500 mb-2"
                                      title={costHover.buffered ? 'Standard cost — recent landed cost plus a safety buffer set by management' : undefined}>
                                      Price history · using {costHover.buffered ? 'Std Cost' : costHover.source === 'tuc' ? 'weighted TUC' : SOURCE_LABEL[costHover.source]}
                                    </p>
                                    <div className="space-y-1">
                                      {costHover.history.map((h, i) => (
                                        <div key={i} className="flex items-center justify-between gap-2 text-[11px]">
                                          <span className={`px-1.5 py-0.5 rounded text-[9px] font-bold flex-shrink-0 ${SOURCE_BADGE[h.kind]}`}>
                                            {h.kind === 'tuc' ? (costHover.buffered ? 'STD' : 'TUC') : h.kind === 'quote' ? 'QUOTE' : 'USED'}
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
                                <input type="text" inputMode="text" value={item.sell_price}
                                  onChange={(e) => updateItem(sec.section_id, item.item_id, { sell_price: e.target.value })}
                                  onKeyDown={(e) => { if (e.key === 'Enter') { (e.target as HTMLInputElement).blur(); return; } navCell(e, item.item_id, 'sell'); }}
                                  data-nav-row={item.item_id} data-nav-col="sell"
                                  onBlur={() => {
                                    const val = evalCell(item.sell_price);
                                    if (val !== item.sell_price) updateItem(sec.section_id, item.item_id, { sell_price: val });
                                  }}
                                  placeholder="0 or =3800000*2"
                                  title={(num(item.quantity) ?? 0) > 0 && !num(item.sell_price) ? 'This line has a quantity but no sell price' : 'Type a number, or =3800000*2 to calculate'}
                                  className={`w-full bg-transparent outline-none text-right text-slate-100 placeholder:text-slate-600 border-b transition-colors focus:border-violet-500 ${(num(item.quantity) ?? 0) > 0 && !num(item.sell_price) ? 'border-amber-500/60 hover:border-amber-400' : 'border-slate-800 hover:border-slate-600'}`} />
                              </td>
                              <td className="px-2 py-2 text-right bg-violet-500/[0.04]">
                                {num(item.cost_price) ? (
                                  <input
                                    type="text"
                                    inputMode="decimal"
                                    value={gmEdit?.itemId === item.item_id ? gmEdit.value : gm}
                                    placeholder="%"
                                    onKeyDown={(e) => navCell(e, item.item_id, 'gm')}
                                    data-nav-row={item.item_id} data-nav-col="gm"
                                    onFocus={(e) => { setGmEdit({ itemId: item.item_id, value: gm }); e.target.select(); }}
                                    onBlur={() => setGmEdit(null)}
                                    onChange={(e) => {
                                      setGmEdit({ itemId: item.item_id, value: e.target.value });
                                      const s = sellFromGm(item.cost_price, e.target.value);
                                      if (s) updateItem(sec.section_id, item.item_id, { sell_price: s });
                                    }}
                                    className={`w-full bg-transparent outline-none text-right placeholder:text-slate-600 border-b border-dashed focus:border-solid transition-colors ${(num(gm) ?? 0) < 0 ? 'text-red-400 border-red-500/40 focus:border-red-400' : 'text-emerald-400 border-emerald-500/30 focus:border-emerald-400'}`}
                                  />
                                ) : <span className="text-slate-700">—</span>}
                              </td>
                              <td className="px-2 py-2 text-right text-slate-100 font-semibold whitespace-nowrap tabular-nums">
                                {total > 0 ? fmtIdr(total) : <span className="text-slate-600 font-normal">—</span>}
                              </td>
                              <td className="pr-3 py-2">
                                <div className="flex items-center gap-1.5">
                                  <button
                                    onClick={() => toggleNote(item.item_id)}
                                    className={`transition-colors ${item.eng_note ? 'text-sky-400 hover:text-sky-300' : 'text-slate-700 hover:text-slate-400'}`}
                                    title={item.eng_note ? 'Engineering note (internal only)' : 'Add engineering note (internal only)'}
                                  >
                                    <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" /></svg>
                                  </button>
                                  <button onClick={() => deleteItem(sec.section_id, item.item_id)} className="text-slate-700 hover:text-red-400 transition-colors">
                                    <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M6 18L18 6M6 6l12 12" /></svg>
                                  </button>
                                </div>
                              </td>
                            </tr>
                            {/* Engineering note row — internal only, never exported */}
                            {openNotes.has(item.item_id) && (
                              <tr className="bg-sky-500/[0.03]">
                                <td />
                                <td colSpan={9} className="px-2 py-2.5">
                                  <div className="flex items-center gap-1.5 mb-1.5">
                                    <svg className="w-3 h-3 text-sky-400/70" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2"><path strokeLinecap="round" strokeLinejoin="round" d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" /></svg>
                                    <span className="text-[10px] uppercase tracking-widest text-sky-300/60">Engineering note</span>
                                    <span className="text-[10px] text-slate-600 normal-case tracking-normal">internal only — never on the PDF / Excel</span>
                                  </div>
                                  <textarea
                                    value={item.eng_note}
                                    onChange={(e) => updateItem(sec.section_id, item.item_id, { eng_note: e.target.value })}
                                    rows={5}
                                    placeholder={"Internal reference only.\nOne calc or note per line — e.g. Pondasi K250 0.64cbm x Rp1,250,000 = Rp800,000"}
                                    className="w-full min-h-[7rem] bg-slate-950/40 border border-slate-800 focus:border-sky-600 rounded-lg px-3 py-2.5 text-xs leading-relaxed text-sky-200/90 outline-none transition-colors resize-y placeholder:text-slate-700 font-mono"
                                  />
                                </td>
                              </tr>
                            )}
                            {/* Sub-items */}
                            {subItems.map((sub) => (
                              <tr
                                key={sub.item_id}
                                className={`transition-colors hover:bg-white/[0.05] ${dropHint === sub.item_id ? 'bg-violet-500/10' : 'bg-slate-900/20'}`}
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
                                    onKeyDown={(e) => navCell(e, sub.item_id, 'desc')}
                                    data-nav-row={sub.item_id} data-nav-col="desc"
                                    placeholder="Sub-item description" className="flex-1 bg-transparent outline-none text-slate-300 italic placeholder:text-slate-600 text-xs border-b border-slate-800/70 hover:border-slate-600 focus:border-violet-500 transition-colors" />
                                </td>
                                <td className="px-2 py-1.5">
                                  <input value={sub.brand} onChange={(e) => updateItem(sec.section_id, sub.item_id, { brand: e.target.value })}
                                    onKeyDown={(e) => navCell(e, sub.item_id, 'brand')}
                                    data-nav-row={sub.item_id} data-nav-col="brand"
                                    className="w-full bg-transparent outline-none text-slate-400 text-xs border-b border-slate-800/70 hover:border-slate-600 focus:border-violet-500 transition-colors" />
                                </td>
                                <td className="px-2 py-1.5">
                                  <input type="text" inputMode="decimal" value={sub.quantity} onChange={(e) => updateItem(sec.section_id, sub.item_id, { quantity: e.target.value })}
                                    onKeyDown={(e) => navCell(e, sub.item_id, 'qty')}
                                    data-nav-row={sub.item_id} data-nav-col="qty"
                                    placeholder="0" className="w-full bg-transparent outline-none text-right text-slate-300 text-xs border-b border-slate-800/70 hover:border-slate-600 focus:border-violet-500 transition-colors" />
                                </td>
                                <td className="px-2 py-1.5">
                                  <input list={`units-${sub.item_id}`} value={sub.unit} onChange={(e) => updateItem(sec.section_id, sub.item_id, { unit: e.target.value })}
                                    onKeyDown={(e) => navCell(e, sub.item_id, 'unit')}
                                    data-nav-row={sub.item_id} data-nav-col="unit"
                                    className="w-full bg-transparent outline-none text-slate-400 text-xs border-b border-slate-800/70 hover:border-slate-600 focus:border-violet-500 transition-colors" />
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
                                  {(num(item.quantity) ?? 0).toLocaleString('en-US')} × {wpPerModule(catalog.components, item.component_id, item.description).toLocaleString('en-US')} Wp/module
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

        {/* ── Price source legend ── */}
        <div className="flex flex-wrap items-center gap-x-5 gap-y-1.5 px-1 text-[10px] text-slate-500">
          <span className="uppercase tracking-wider">Price sources</span>
          <span className="flex items-center gap-1.5">
            <span className="px-1.5 py-0.5 rounded text-[9px] font-bold bg-violet-500/20 text-violet-300">TUC</span>
            weighted true unit cost from settled POs
          </span>
          <span className="flex items-center gap-1.5">
            <span className="px-1.5 py-0.5 rounded text-[9px] font-bold bg-violet-500/20 text-violet-300">STD</span>
            standard cost — recent landed cost incl. safety buffer
          </span>
          <span className="flex items-center gap-1.5">
            <span className="px-1.5 py-0.5 rounded text-[9px] font-bold bg-sky-500/20 text-sky-300">QUOTE</span>
            supplier price quote
          </span>
          <span className="flex items-center gap-1.5">
            <span className="px-1.5 py-0.5 rounded text-[9px] font-bold bg-amber-500/20 text-amber-300">USED</span>
            last used in a project quote
          </span>
          <span className="ml-auto text-slate-600">🔒 violet-tinted columns are internal — never on client exports</span>
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
                  <span className="text-slate-200 font-semibold tabular-nums">{fmtIdr(grandTotal / totalWp)}</span>
                </div>
                <p className="text-right text-[10px] text-slate-600">
                  system size {totalWp.toLocaleString('en-US')} Wp
                </p>
              </div>
            )}
          </div>
        )}

        {/* ── Terms & Conditions ── */}
        <div className={`bg-slate-900/50 border border-slate-800 rounded-2xl p-5 ${locked ? 'pointer-events-none opacity-70' : ''}`}>
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

      {/* ── Activity history modal ── */}
      {showActivity && (
        <div className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-4" onClick={() => setShowActivity(false)}>
          <div className="bg-slate-900 border border-slate-700 rounded-2xl p-6 max-w-lg w-full max-h-[70vh] flex flex-col" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-4">
              <h3 className="font-semibold text-white">History — {quote.quote_number}</h3>
              <button onClick={() => setShowActivity(false)} className="text-slate-500 hover:text-white transition-colors">
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M6 18L18 6M6 6l12 12" /></svg>
              </button>
            </div>
            <div className="overflow-y-auto space-y-1.5 pr-1">
              {activity === null && <p className="text-slate-500 text-sm">Loading…</p>}
              {activity?.length === 0 && (
                <p className="text-slate-500 text-sm">
                  No history yet. Entries appear once the audit migration has been run and the quote is saved.
                </p>
              )}
              {activity?.map((a, i) => (
                <div key={i} className="flex items-center gap-3 px-3 py-2 bg-slate-800/40 rounded-xl text-xs">
                  <span className={`px-1.5 py-0.5 rounded text-[9px] font-bold uppercase flex-shrink-0 ${ACTIVITY_BADGE[a.action] ?? ACTIVITY_BADGE.edited}`}>
                    {a.action}
                  </span>
                  {a.detail && <span className="text-sky-300 flex-shrink-0">{a.detail}</span>}
                  <span className="text-slate-400 truncate">{a.actor_email}</span>
                  <span className="text-slate-600 ml-auto flex-shrink-0 tabular-nums">{fmtDateTime(a.at)}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* ── Sticky totals bar ── */}
      {subtotal > 0 && (
        <div className="fixed bottom-0 inset-x-0 z-40 bg-[#141518]/95 backdrop-blur-xl border-t border-white/[0.07]">
          <div className="max-w-[1400px] mx-auto px-4 sm:px-6 py-2.5 flex items-center gap-4 sm:gap-5 text-xs overflow-x-auto whitespace-nowrap scrollbar-none">
            <span className="text-slate-500">Subtotal <span className="ml-1 text-slate-200 font-semibold tabular-nums">{fmtIdr(subtotal)}</span></span>
            <span className="text-slate-500">Grand Total <span className="ml-1 text-white font-bold tabular-nums">{fmtIdr(grandTotal)}</span></span>
            {totalWp > 0 && (
              <span className="text-slate-500">per Wp <span className="ml-1 text-amber-300 font-semibold tabular-nums">{fmtIdr(subtotal / totalWp)}</span></span>
            )}
            {blendedGm != null && (
              <span className="text-slate-500">Blended GM
                <span className={`ml-1 font-semibold tabular-nums ${blendedGm < 0 ? 'text-red-400' : 'text-emerald-400'}`}>
                  {blendedGm.toFixed(1)}%
                </span>
              </span>
            )}
            {missingSell > 0 && (
              <span className="text-amber-400 font-medium">⚠ {missingSell} line{missingSell > 1 ? 's' : ''} missing sell price</span>
            )}
            {driftCount > 0 && (
              <span className="text-amber-400 font-medium" title="Stored costs differ >10% from today's — press Costs to refresh, margins are kept">
                ⚠ {driftCount} outdated cost{driftCount > 1 ? 's' : ''}
              </span>
            )}
            <span className="ml-auto flex-shrink-0">
              {dirty
                ? <span className="text-amber-400">Unsaved changes</span>
                : <span className="text-slate-600">All changes saved</span>}
            </span>
          </div>
        </div>
      )}
    </div>
  );
}
