/**
 * DealLookupTab
 *
 * Unified lookup combining price quotes and purchase orders into "deal groups"
 * keyed by PI number. Each row represents one deal and shows the full chain:
 * Quote status → PO status → payment progress.
 *
 * Three view modes: All / By Vendor / By Company
 */
'use client';
import { Fragment, useState, useMemo, useRef, useEffect } from 'react';
import { createPortal } from 'react-dom';
import type {
  PriceQuote, PriceQuoteLineItem,
  PurchaseOrder, PurchaseLineItem, POCost,
  Supplier, Company, Component,
} from '@/types/database';
import { checkPoTotal, totalDisagrees } from '@/lib/poTotals';
import { buildDealGroups, type DealGroup } from '@/lib/dealGroups';
import { PRINCIPAL_CATS, BANK_FEE_CATS, TAX_CATS } from '@/constants/costCategories';
import { fmtIdr, fmtCcy, fmtDate } from '@/lib/formatters';
import DateRangeFilter from './DateRangeFilter';
import { useT } from '@/hooks/useT';
import LayoutToggle from './LayoutToggle';
import { useListLayout } from '@/hooks/useListLayout';
import { useListDefaults } from '@/hooks/useListDefaults';
import { inRange, isOpenRange, type DateRange } from '@/lib/dateRange';

// ── Constants ─────────────────────────────────────────────────────────────────

const QUOTE_STATUSES = ['Open', 'Accepted', 'Replaced', 'Rejected', 'Expired'] as const;
const PO_STATUSES    = ['Draft', 'Sent', 'Confirmed', 'Replaced', 'Partially Received', 'Fully Received', 'Cancelled'] as const;

// ── Status color helpers (text only — for inline display) ─────────────────────

function quoteColor(status?: string | null): string {
  const map: Record<string, string> = {
    Open:     'text-sky-400',
    Accepted: 'text-emerald-400',
    Replaced: 'text-slate-500',
    Rejected: 'text-red-400',
    Expired:  'text-amber-400',
  };
  return map[status ?? ''] ?? 'text-slate-500';
}

function poColor(status?: string | null): string {
  const map: Record<string, string> = {
    Draft:                'text-slate-500',
    Sent:                 'text-blue-400',
    Confirmed:            'text-blue-300',
    Replaced:             'text-slate-500',
    'Partially Received': 'text-amber-400',
    'Fully Received':     'text-emerald-400',
    Cancelled:            'text-red-400',
  };
  return map[status ?? ''] ?? 'text-slate-500';
}

// ── Badge helpers (full pill — for <select> elements only) ────────────────────

function quoteBadge(status?: string | null) {
  const map: Record<string, string> = {
    Open:     'bg-sky-500/20 text-sky-300 border border-sky-500/30',
    Accepted: 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/30',
    Replaced: 'bg-slate-600/40 text-slate-400 border border-slate-600/40',
    Rejected: 'bg-red-500/20 text-red-300 border border-red-500/30',
    Expired:  'bg-amber-500/20 text-amber-300 border border-amber-500/30',
  };
  return map[status ?? ''] ?? 'bg-slate-700/60 text-slate-400';
}

function poBadge(status?: string | null) {
  const map: Record<string, string> = {
    Draft:                'bg-slate-700 text-slate-300',
    Sent:                 'bg-blue-500/20 text-blue-300 border border-blue-500/30',
    Confirmed:            'bg-blue-500/20 text-blue-300 border border-blue-500/30',
    Replaced:             'bg-slate-600/40 text-slate-400 border border-slate-600/40',
    'Partially Received': 'bg-amber-500/20 text-amber-300 border border-amber-500/30',
    'Fully Received':     'bg-emerald-500/20 text-emerald-300 border border-emerald-500/30',
    Cancelled:            'bg-red-500/20 text-red-300 border border-red-500/30',
  };
  return map[status ?? ''] ?? 'bg-slate-700/60 text-slate-400';
}

// ── Copy button ───────────────────────────────────────────────────────────────

function CopyBtn({ text, className = '' }: { text: string; className?: string }) {
  const [copied, setCopied] = useState(false);
  const copy = (e: React.MouseEvent) => {
    e.stopPropagation();
    navigator.clipboard.writeText(text).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    });
  };
  return (
    <button
      onClick={copy}
      title="Copy"
      className={`inline-flex items-center justify-center w-5 h-5 rounded text-slate-600 hover:text-slate-300 hover:bg-white/10 transition-colors flex-shrink-0 ${className}`}
    >
      {copied
        ? <svg className="w-3 h-3 text-emerald-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2.5"><path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" /></svg>
        : <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2"><rect x="9" y="9" width="13" height="13" rx="2" /><path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1" /></svg>
      }
    </button>
  );
}

/**
 * Text that copies itself when clicked. Item names are the thing people paste
 * into a chat or a supplier email, so the name IS the button — no icon to aim
 * at. Stops propagation so copying never opens or closes the deal row.
 */
function CopyText({ text, className = '', children }: { text: string; className?: string; children?: React.ReactNode }) {
  const [copied, setCopied] = useState(false);
  if (!text) return <>{children}</>;
  return (
    <span
      role="button"
      tabIndex={0}
      title={copied ? 'Copied' : `Click to copy — ${text}`}
      onClick={(e) => {
        e.stopPropagation();
        navigator.clipboard.writeText(text).then(() => {
          setCopied(true);
          setTimeout(() => setCopied(false), 1200);
        });
      }}
      onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); (e.target as HTMLElement).click(); } }}
      className={`cursor-copy transition-colors ${copied ? 'text-emerald-400' : 'hover:text-emerald-300'} ${className}`}
    >
      {children ?? text}
      {copied && <span className="ml-1.5 text-[9px] font-normal text-emerald-400 align-middle">copied</span>}
    </span>
  );
}

// ── Inline component re-assignment combobox ───────────────────────────────────

function ComponentCombobox({ components, onSelect, onCancel }: {
  components: Component[];
  onSelect: (componentId: string) => void;
  onCancel: () => void;
}) {
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(false);
  const [dropStyle, setDropStyle] = useState<React.CSSProperties>({});
  const inputRef = useRef<HTMLInputElement>(null);

  const filtered = useMemo(() => {
    const q = query.toLowerCase().trim();
    const pool = q
      ? components.filter((c) =>
          c.supplier_model?.toLowerCase().includes(q) ||
          c.internal_description?.toLowerCase().includes(q) ||
          c.brand?.toLowerCase().includes(q)
        )
      : components;
    return pool.slice(0, 40);
  }, [components, query]);

  const openDrop = () => {
    if (!inputRef.current) return;
    const r = inputRef.current.getBoundingClientRect();
    setDropStyle({ position: 'fixed', top: r.bottom + 2, left: r.left, width: Math.max(300, r.width), zIndex: 9999 });
    setOpen(true);
  };

  useEffect(() => {
    setTimeout(() => { inputRef.current?.focus(); openDrop(); }, 0);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <>
      <input
        ref={inputRef}
        type="text"
        value={query}
        onChange={(e) => { setQuery(e.target.value); if (!open) openDrop(); }}
        onFocus={openDrop}
        onBlur={() => setTimeout(() => { setOpen(false); onCancel(); }, 160)}
        placeholder="Search component…"
        autoComplete="off"
        className="w-full px-2 py-1 bg-slate-900 border border-emerald-500/50 rounded text-xs text-white focus:outline-none focus:border-emerald-400 placeholder-slate-600"
      />
      {open && typeof document !== 'undefined' && createPortal(
        <div style={dropStyle} className="bg-slate-900 border border-slate-700 rounded-xl shadow-2xl overflow-hidden">
          {query && <div className="px-3 py-1.5 border-b border-white/5 text-[10px] text-slate-500">{filtered.length} match{filtered.length !== 1 ? 'es' : ''}</div>}
          <div className="max-h-64 overflow-y-auto">
            {filtered.length === 0
              ? <p className="px-3 py-3 text-xs text-slate-500 italic">No matches</p>
              : filtered.map((c) => (
                <button
                  key={c.component_id}
                  onMouseDown={(e) => { e.preventDefault(); onSelect(c.component_id); }}
                  className="w-full text-left px-3 py-2 border-b border-white/[0.04] last:border-0 hover:bg-white/10 transition-colors"
                >
                  <p className="text-xs font-semibold text-white leading-tight">{c.supplier_model}</p>
                  {c.internal_description && <p className="text-[10px] text-slate-500 truncate mt-0.5">{c.internal_description}</p>}
                </button>
              ))
            }
          </div>
        </div>,
        document.body
      )}
    </>
  );
}

// ── Mismatch detection ────────────────────────────────────────────────────────

type MismatchType = 'duplicate_in_quote' | 'qty_diff' | 'only_in_quote' | 'only_in_po';
interface MismatchItem {
  type: MismatchType;
  componentId: string;
  componentName: string;
  detail: string;
}

function detectMismatches(
  quoteId: number | string,
  poId: number | string,
  quoteItems: PriceQuoteLineItem[],
  poItems: PurchaseLineItem[],
  components: Component[],
): MismatchItem[] {
  const qItems = quoteItems.filter((i) => String(i.quote_id) === String(quoteId));
  const pItems = poItems.filter((i) => String(i.po_id) === String(poId));
  if (qItems.length === 0 && pItems.length === 0) return [];

  const compName = (cid: string) => {
    const c = components.find((x) => x.component_id === cid);
    return c?.supplier_model ?? c?.internal_description ?? '(unknown)';
  };

  const qQty = new Map<string, number>();
  const qCount = new Map<string, number>();
  qItems.forEach((i) => {
    if (!i.component_id) return;
    qQty.set(i.component_id, (qQty.get(i.component_id) ?? 0) + Number(i.quantity));
    qCount.set(i.component_id, (qCount.get(i.component_id) ?? 0) + 1);
  });

  const pQty = new Map<string, number>();
  pItems.forEach((i) => {
    if (!i.component_id) return;
    pQty.set(i.component_id, (pQty.get(i.component_id) ?? 0) + Number(i.quantity));
  });

  const out: MismatchItem[] = [];

  // Duplicate component in quote (same component_id appears 2+ times → likely wrong association)
  qCount.forEach((cnt, cid) => {
    if (cnt > 1) out.push({ type: 'duplicate_in_quote', componentId: cid, componentName: compName(cid), detail: `Appears ${cnt}× in quote — possible wrong component association` });
  });

  // In quote but absent or different qty in PO
  qQty.forEach((qty, cid) => {
    const p = pQty.get(cid);
    if (p === undefined) {
      out.push({ type: 'only_in_quote', componentId: cid, componentName: compName(cid), detail: `Quoted qty ${qty} — not found in PO` });
    } else if (p !== qty) {
      out.push({ type: 'qty_diff', componentId: cid, componentName: compName(cid), detail: `Qty mismatch: quote ${qty} → PO ${p}` });
    }
  });

  // In PO but not in quote
  pQty.forEach((qty, cid) => {
    if (!qQty.has(cid)) out.push({ type: 'only_in_po', componentId: cid, componentName: compName(cid), detail: `PO qty ${qty} — not found in linked quote` });
  });

  return out;
}

// ── Group-level mismatch: the quote vs the UNION of its POs ───────────────────
// A quote is often split into several POs (order part now, part later, or by
// container). Checking each PO against the WHOLE quote falsely flags every
// split, because each PO is "missing" the other PO's lines. Aggregate instead:
// sum PO quantities across all active POs, then a mismatch is only a genuine
// discrepancy — a component on a PO that was never quoted, MORE ordered than
// quoted, or the same component quoted twice. Ordering LESS than quoted
// (a partial / not-yet-complete order) is normal and never flagged.
function detectGroupMismatches(
  g: DealGroup,
  quoteItems: PriceQuoteLineItem[],
  poItems: PurchaseLineItem[],
  components: Component[],
): MismatchItem[] {
  const activePos = g.pos.filter((p) => p.status !== 'Cancelled' && p.status !== 'Replaced');
  const liveQuotes = g.quotes.filter((q) => !['Replaced', 'Rejected', 'Expired'].includes(q.status ?? ''));
  if (liveQuotes.length === 0 || activePos.length === 0) return [];   // need both sides to compare

  const compName = (cid: string) => {
    const c = components.find((x) => x.component_id === cid);
    return c?.supplier_model ?? c?.internal_description ?? '(unknown)';
  };
  const quoteIds = new Set(liveQuotes.map((q) => String(q.quote_id)));
  const poIds = new Set(activePos.map((p) => String(p.po_id)));
  const qItems = quoteItems.filter((i) => quoteIds.has(String(i.quote_id)) && i.component_id);
  const pItems = poItems.filter((i) => poIds.has(String(i.po_id)) && i.component_id);

  const qQty = new Map<string, number>();
  for (const i of qItems) qQty.set(i.component_id!, (qQty.get(i.component_id!) ?? 0) + Number(i.quantity));
  const pQty = new Map<string, number>();
  for (const i of pItems) pQty.set(i.component_id!, (pQty.get(i.component_id!) ?? 0) + Number(i.quantity));

  // Duplicate = a component on 2+ lines within a SINGLE quote.
  const dup = new Set<string>();
  for (const q of liveQuotes) {
    const per = new Map<string, number>();
    for (const i of qItems) if (String(i.quote_id) === String(q.quote_id)) per.set(i.component_id!, (per.get(i.component_id!) ?? 0) + 1);
    for (const [cid, n] of per) if (n > 1) dup.add(cid);
  }

  const out: MismatchItem[] = [];
  for (const cid of dup) out.push({ type: 'duplicate_in_quote', componentId: cid, componentName: compName(cid), detail: 'On more than one line in a quote — possible wrong component association' });
  qQty.forEach((qty, cid) => {
    const p = pQty.get(cid);
    if (p !== undefined && p > qty + 1e-6) out.push({ type: 'qty_diff', componentId: cid, componentName: compName(cid), detail: `POs total ${p} — more than the quoted ${qty}` });
  });
  pQty.forEach((qty, cid) => {
    if (!qQty.has(cid)) out.push({ type: 'only_in_po', componentId: cid, componentName: compName(cid), detail: `PO qty ${qty} — not on the linked quote` });
  });
  return out;
}

// ── Deal stage (module-level so useMemos can reference it) ────────────────────

function dealStage(g: DealGroup): 'quote' | 'active' | 'received' | 'completed' | 'superseded' {
  if (g.pos.length === 0) return 'quote';
  if (g.poStatus === 'Cancelled' || g.poStatus === 'Replaced') return 'superseded';
  if (g.poStatus === 'Fully Received') {
    return (g.totalIdr > 0 && g.outstandingIdr === 0) ? 'completed' : 'received';
  }
  return 'active';
}

/** The SECTION a deal belongs to in the default list (owner, 2026-08-14):
 *  an OPEN quote is a decision waiting to be made and must not drown between
 *  running POs. An ACCEPTED quote is already in motion even before its PO
 *  exists; a rejected/expired one is dead weight and sinks to the bottom. */
type DealSection = 'open' | 'process' | 'received' | 'completed' | 'void';
function dealSection(g: DealGroup): DealSection {
  const stage = dealStage(g);
  if (stage === 'active') return 'process';
  if (stage === 'received') return 'received';
  if (stage === 'completed') return 'completed';
  if (stage === 'superseded') return 'void';
  // No PO yet — the quote's own status decides which pile it sits on
  if (g.quotes.some((q) => q.status === 'Accepted')) return 'process';
  if (g.quotes.length > 0 && g.quotes.every((q) => ['Rejected', 'Expired', 'Replaced'].includes(q.status ?? ''))) return 'void';
  return 'open';
}

const DEAL_SECTIONS: { key: DealSection; label: string; accent: string; hint: string }[] = [
  // In process leads (owner, 2026-08-14): the running money comes first,
  // the decision pile right under it.
  { key: 'process',   label: 'In process',                  accent: 'text-indigo-300',  hint: 'Accepted quotes and active POs — ordered or about to be, goods not fully in.' },
  { key: 'open',      label: 'Quotes — awaiting an answer', accent: 'text-emerald-300', hint: 'No PO yet and not accepted — decide, negotiate, or let them lapse.' },
  { key: 'received',  label: 'Received — balance open',     accent: 'text-emerald-400', hint: 'Goods fully received, supplier not fully paid.' },
  { key: 'completed', label: 'Completed',                   accent: 'text-slate-400',   hint: 'Received and settled.' },
  { key: 'void',      label: 'Void / replaced',             accent: 'text-slate-600',   hint: 'Cancelled, replaced, rejected or expired.' },
];

// ── Types ─────────────────────────────────────────────────────────────────────

interface Props {
  quotes: PriceQuote[];
  quoteItems: PriceQuoteLineItem[];
  pos: PurchaseOrder[];
  poItems: PurchaseLineItem[];
  poCosts: POCost[];
  suppliers: Supplier[];
  companies: Company[];
  components: Component[];
  onQuoteStatusChange?: (quoteId: string, status: string) => Promise<void>;
  onPoStatusChange?: (poId: string, status: string) => Promise<void>;
  onUpdatePo?: (poId: string, changes: Partial<PurchaseOrder>) => Promise<void>;
  /** Update a quote header. `pi_number` cascades to its POs; `replaces_quote_id`
   *  also marks the target quote Replaced. The page owns that logic. */
  onUpdateQuote?: (quoteId: string, changes: Record<string, any>) => Promise<void>;
  onMarkFullyPaid?: (poId: string, amount: number, currency: string) => Promise<void>;
  onCreatePO?: (quoteId: string) => void;
  /** Load this PO into the New Deal form to amend, split, or supersede it. */
  onRevisePo?: (poId: string) => void;
  /** Hard-delete a single PO (+ its line items). Only offered when the PO has
   *  no payments and no goods received — the page re-verifies before deleting. */
  onDeletePo?: (poId: string) => Promise<void>;
  /** Hard-delete a whole deal — every quote and PO in the group. Same guard. */
  onDeleteDeal?: (quoteIds: string[], poIds: string[]) => Promise<void>;
  onUpdateQuoteItem?: (quoteLineId: number, componentId: string) => Promise<void>;
  onUpdatePoItem?: (poItemId: number, componentId: string) => Promise<void>;
  onUpdateQuoteLineItem?: (id: number, updates: { component_id?: string; quantity?: number; unit_price?: number }) => Promise<void>;
  onUpdatePoLineItem?: (id: number, updates: { component_id?: string; quantity?: number; unit_cost?: number }) => Promise<void>;
  onAddPoLineItem?: (poId: number, data: { component_id?: string; quantity: number; unit_cost: number; currency: string }) => Promise<void>;
  onAddQuoteLineItem?: (quoteId: number, data: { component_id?: string; quantity: number; unit_price: number; currency: string }) => Promise<void>;
  onDeletePoLineItem?: (poLineItemId: number) => Promise<void>;
  onDeleteQuoteLineItem?: (quoteLineId: number) => Promise<void>;
  initialSearch?: string;  // e.g. a PI/PO number from the global search palette
}

// ── Main ──────────────────────────────────────────────────────────────────────

export default function DealLookupTab({
  quotes, quoteItems, pos, poItems, poCosts,
  suppliers, companies, components,
  onQuoteStatusChange, onPoStatusChange, onUpdatePo, onUpdateQuote, onMarkFullyPaid, onCreatePO, onRevisePo, onDeletePo, onDeleteDeal,
  onUpdateQuoteItem, onUpdatePoItem,
  onUpdateQuoteLineItem, onUpdatePoLineItem,
  onAddPoLineItem, onAddQuoteLineItem,
  onDeletePoLineItem, onDeleteQuoteLineItem,
  initialSearch,
}: Props) {
  const { t } = useT();

  const [viewMode, setViewMode]               = useState<'all' | 'by-vendor' | 'by-company'>('all');
  const [search, setSearch]                   = useState(initialSearch ?? '');
  const [stageFilter, setStageFilter]         = useState<'all' | 'quote' | 'active' | 'received' | 'completed' | 'superseded'>('all');
  const [filterMismatch, setFilterMismatch]   = useState(false);
  // Deals filter on latestDate = max(quote date, PO date) — the date the deal
  // last moved, which is what "POs this month" means on the buy side.
  const listDefaults                          = useListDefaults('deals');
  const [range, setRange]                     = useState<DateRange>(listDefaults.range);
  const rangeTouched                          = useRef(false);
  // Table = the compact view; the house default comes from Settings › Layout
  // and flipping it here is remembered for this screen only.
  const [layout, setLayout]                   = useListLayout('deals');
  const tableView = layout === 'compact';
  const [expandedKey, setExpandedKey]         = useState<string | null>(null);
  // Column-header sort for the table view: click a title to sort by it, click
  // again to flip. Text columns start A→Z; date and money start biggest-first.
  const [colSort, setColSort] = useState<{ key: 'pi' | 'supplier' | 'date' | 'stage' | 'total' | 'paid' | 'outstanding'; dir: 'asc' | 'desc' } | null>(null);
  const clickCol = (key: NonNullable<typeof colSort>['key']) =>
    setColSort((s) => s?.key === key
      ? { key, dir: s.dir === 'asc' ? 'desc' : 'asc' }
      : { key, dir: ['date', 'total', 'paid', 'outstanding'].includes(key) ? 'desc' : 'asc' });
  const [selectedSuppId, setSelectedSuppId]   = useState<string | null>(null);
  const [selectedCompId, setSelectedCompId]   = useState<string | null>(null);
  const [updatingQuote, setUpdatingQuote]     = useState<string | null>(null);
  const [updatingPo, setUpdatingPo]           = useState<string | null>(null);
  // Two-step delete confirm: first click arms it (key = `po:<id>` or `deal:<key>`),
  // second click destroys. `busyDelete` guards against a double-fire mid-request.
  const [confirmDelete, setConfirmDelete]     = useState<string | null>(null);
  const [busyDelete, setBusyDelete]           = useState(false);
  const [markingPaid, setMarkingPaid]         = useState<string | null>(null);
  // Intercept "Fully Received" to capture received date before saving
  const [pendingReceived, setPendingReceived] = useState<{ poId: string; date: string } | null>(null);
  // After a PO is marked (Partially/Fully) Received, prompt the next obvious
  // step: book the goods into stock — one click, PO pre-selected. Marking the
  // status records the FACT; receiving writes the on-hand and landed cost.
  const [receivePrompt, setReceivePrompt] = useState<string | null>(null);
  const [editingReceivedId, setEditingReceivedId] = useState<string | null>(null);
  const [editingReceivedDate, setEditingReceivedDate] = useState('');
  const [editingPoSupplier, setEditingPoSupplier] = useState<string | null>(null);
  const [editingPoCompany, setEditingPoCompany]   = useState<string | null>(null);
  // Inline rename (PO number / PI number) and "this quote replaces that one".
  const [editingPoNumber, setEditingPoNumber]     = useState<string | null>(null);
  const [editingPi, setEditingPi]                 = useState<string | null>(null);
  const [editingQuoteReplaces, setEditingQuoteReplaces] = useState<string | null>(null);
  // The inverse link, set from the SUPERSEDED quote's card: "this quote is
  // replaced by …" — writes replaces_quote_id on the chosen successor.
  const [editingQuoteReplacedBy, setEditingQuoteReplacedBy] = useState<string | null>(null);
  const [renameDraft, setRenameDraft]             = useState('');
  const [renameBusy, setRenameBusy]               = useState(false);
  const [acknowledgedMismatches, setAcknowledgedMismatches] = useState<Set<string>>(new Set());
  const acknowledgeMismatch = (key: string) => setAcknowledgedMismatches((prev) => new Set([...prev, key]));
  const [acknowledgedDealMismatches, setAcknowledgedDealMismatches] = useState<Set<string>>(() => {
    try {
      const stored = localStorage.getItem('acknowledgedDealMismatches');
      return stored ? new Set(JSON.parse(stored)) : new Set<string>();
    } catch { return new Set<string>(); }
  });
  useEffect(() => {
    try { localStorage.setItem('acknowledgedDealMismatches', JSON.stringify([...acknowledgedDealMismatches])); } catch {}
  }, [acknowledgedDealMismatches]);
  const [editingItem, setEditingItem] = useState<{ type: 'quote' | 'po'; id: number } | null>(null);
  const [editingSaving, setEditingSaving] = useState(false);
  const [editingLine, setEditingLine] = useState<{
    mode: 'edit' | 'add';
    type: 'quote' | 'po';
    id: number;        // line item id (edit mode); unused in add mode
    rowIdx: number;    // row index in comparison table
    targetId: number;  // po_id or quote_id (add mode)
    currency: string;  // currency for new line (add mode)
    componentId: string | null;
    showCompSearch: boolean;
    qty: string;
    price: string;
    saving: boolean;
  } | null>(null);

  const handleSaveLine = async () => {
    if (!editingLine) return;
    const { mode, type, id, targetId, componentId, qty, price, currency } = editingLine;
    setEditingLine((prev) => prev && { ...prev, saving: true });
    try {
      const qtyNum   = parseFloat(qty.replace(/,/g, ''));
      const priceNum = parseFloat(price.replace(/,/g, ''));
      const cmpField = componentId ? { component_id: componentId } : {};
      if (mode === 'add') {
        if (type === 'po') {
          await onAddPoLineItem?.(targetId, { ...cmpField, quantity: isNaN(qtyNum) ? 1 : qtyNum, unit_cost: isNaN(priceNum) ? 0 : priceNum, currency });
        } else {
          await onAddQuoteLineItem?.(targetId, { ...cmpField, quantity: isNaN(qtyNum) ? 1 : qtyNum, unit_price: isNaN(priceNum) ? 0 : priceNum, currency });
        }
      } else {
        const updates = {
          ...cmpField,
          ...(!isNaN(qtyNum) ? { quantity: qtyNum } : {}),
        };
        if (type === 'quote') {
          await onUpdateQuoteLineItem?.(id, { ...updates, ...(!isNaN(priceNum) ? { unit_price: priceNum } : {}) });
        } else {
          await onUpdatePoLineItem?.(id, { ...updates, ...(!isNaN(priceNum) ? { unit_cost: priceNum } : {}) });
        }
      }
      setEditingLine(null);
    } catch {
      setEditingLine((prev) => prev && { ...prev, saving: false });
    }
  };

  const handleReassign = async (type: 'quote' | 'po', id: number, componentId: string) => {
    setEditingSaving(true);
    try {
      if (type === 'quote') await onUpdateQuoteItem?.(id, componentId);
      else await onUpdatePoItem?.(id, componentId);
    } finally {
      setEditingSaving(false);
      setEditingItem(null);
    }
  };

  // ── Deal groups ──────────────────────────────────────────────────────────
  const allGroups = useMemo(
    () => buildDealGroups(quotes, pos, suppliers, companies, poCosts),
    [quotes, pos, suppliers, companies, poCosts]
  );

  // ── Portfolio summary counts ──────────────────────────────────────────────
  const summary = useMemo(() => {
    let openQuotes = 0, activePOs = 0, received = 0, completed = 0, superseded = 0, outstandingTotal = 0;
    for (const g of allGroups) {
      const s = dealStage(g);
      if (s === 'quote')          openQuotes++;
      else if (s === 'active')    activePOs++;
      else if (s === 'received')  received++;
      else if (s === 'completed') completed++;
      else if (s === 'superseded') superseded++;
      outstandingTotal += g.outstandingIdr;
    }
    return { openQuotes, activePOs, received, completed, superseded, outstandingTotal, total: allGroups.length };
  }, [allGroups]);

  // ── Groups with quote↔PO mismatches ──────────────────────────────────────
  // Group-level: the quote vs the UNION of all its active POs, so a quote
  // legitimately split across several POs is not flagged (see
  // detectGroupMismatches). Dismissed deals are skipped.
  const mismatchGroupIds = useMemo(() => {
    const ids = new Set<string>();
    allGroups.forEach((g) => {
      if (acknowledgedDealMismatches.has(g.key)) return; // dismissed by user
      if (detectGroupMismatches(g, quoteItems, poItems, components).length > 0) ids.add(g.key);
    });
    return ids;
  }, [allGroups, quoteItems, poItems, components, acknowledgedDealMismatches]);

  // ── All-mode filtered list (respects stageFilter + filterMismatch) ────────
  const filtered = useMemo(() => {
    const q = search.toLowerCase().trim();
    let base = stageFilter === 'all' ? allGroups : allGroups.filter((g) => dealStage(g) === stageFilter);
    if (!isOpenRange(range)) base = base.filter((g) => inRange(g.latestDate, range));
    if (filterMismatch) base = base.filter((g) => mismatchGroupIds.has(g.key) && !acknowledgedDealMismatches.has(g.key));
    if (!q) return base.slice(0, 80);
    return base.filter((g) => {
      const code = g.supplier?.supplier_code?.toLowerCase() ?? '';
      const name = g.supplier?.supplier_name?.toLowerCase() ?? '';
      const pi   = (g.piNumber ?? '').toLowerCase();
      const company = g.company?.legal_name?.toLowerCase() ?? '';
      return pi.includes(q) || code.includes(q) || name.includes(q) || company.includes(q)
        || g.pos.some((p) => (p.po_number ?? '').toLowerCase().includes(q));
    });
  }, [allGroups, search, stageFilter, filterMismatch, mismatchGroupIds, range]);

  // Deep-linked search (e.g. a PO number from the global palette): when it
  // resolves to exactly one deal, open its card automatically
  const autoExpandedRef = useRef(false);
  useEffect(() => {
    if (autoExpandedRef.current || !initialSearch || !search) return;
    if (filtered.length === 1) {
      setExpandedKey(filtered[0].key);
      autoExpandedRef.current = true;
    }
  }, [filtered, initialSearch, search]);

  // ── By-vendor stats ───────────────────────────────────────────────────────
  const vendorStats = useMemo(() => {
    const map: Record<string, {
      supplier: Supplier;
      dealCount: number;
      openQuotes: number;
      outstandingIdr: number;
      totalIdr: number;
      lastDate: string;
    }> = {};
    for (const g of allGroups) {
      if (!g.supplier) continue;
      const id = String(g.supplier.supplier_id);
      if (!map[id]) map[id] = { supplier: g.supplier, dealCount: 0, openQuotes: 0, outstandingIdr: 0, totalIdr: 0, lastDate: '' };
      map[id].dealCount++;
      if (g.quoteStatus === 'Open' || (!g.quoteStatus && g.quotes.length > 0)) map[id].openQuotes++;
      map[id].outstandingIdr += g.outstandingIdr;
      map[id].totalIdr += g.totalIdr;
      if (!map[id].lastDate || g.latestDate > map[id].lastDate) map[id].lastDate = g.latestDate;
    }
    return Object.values(map).sort((a, b) => b.outstandingIdr - a.outstandingIdr || b.dealCount - a.dealCount);
  }, [allGroups]);

  const vendorGroups = useMemo(
    () => selectedSuppId ? allGroups.filter((g) => g.supplierId === selectedSuppId) : [],
    [allGroups, selectedSuppId]
  );

  // ── By-company stats ──────────────────────────────────────────────────────
  const companyStats = useMemo(() => {
    const map: Record<string, { company: Company; dealCount: number; openQuotes: number }> = {};
    for (const g of allGroups) {
      if (!g.company) continue;
      const id = String(g.company.company_id);
      if (!map[id]) map[id] = { company: g.company, dealCount: 0, openQuotes: 0 };
      map[id].dealCount++;
      if (g.quoteStatus === 'Open' || (!g.quoteStatus && g.quotes.length > 0)) map[id].openQuotes++;
    }
    return Object.values(map).sort((a, b) => b.dealCount - a.dealCount);
  }, [allGroups]);

  const companyGroups = useMemo(
    () => selectedCompId
      ? allGroups.filter((g) => g.company && String(g.company.company_id) === selectedCompId)
      : [],
    [allGroups, selectedCompId]
  );

  // ── Detail renderer ───────────────────────────────────────────────────────

  const renderDetail = (g: DealGroup) => {
    const gQuoteItems = quoteItems.filter((i) => g.quotes.some((q) => String(q.quote_id) === String(i.quote_id)));
    const gPoItems    = poItems.filter((i) => g.pos.some((p) => String(p.po_id) === String(i.po_id)));
    const gPoCosts    = poCosts.filter((c) => g.pos.some((p) => String(p.po_id) === String(c.po_id)));

    const targetQuote = g.quotes.find((q) => q.status === 'Accepted')
                     ?? g.quotes.find((q) => q.status === 'Open' || !q.status)
                     ?? g.quotes[0];
    const hasLinkedPO = g.pos.length > 0;
    const showCreatePO = onCreatePO && targetQuote && !hasLinkedPO;

    const hasBoth = g.quotes.length > 0 && g.pos.length > 0;

    // A record is safe to hard-delete only with no payments and no goods
    // received; received POs carry that state in their status. The whole deal
    // is deletable when every PO is (a quote-only deal has none to block it).
    const poDeletable = (p: PurchaseOrder) =>
      !['Fully Received', 'Partially Received'].includes(p.status ?? '') &&
      !gPoCosts.some((c) => String(c.po_id) === String(p.po_id));
    const dealDeletable = g.pos.every(poDeletable);
    const dealKey = `deal:${g.key}`;
    const dealArmed = confirmDelete === dealKey;

    return (
      <div className="mt-3 pt-3 border-t border-slate-700/40">
        {onDeleteDeal && (g.quotes.length > 0 || g.pos.length > 0) && (
          <div className="flex justify-end mb-2" onClick={(e) => e.stopPropagation()}>
            {!dealDeletable ? (
              <span className="text-[10px] text-slate-600" title="A PO here has payments or received goods — cancel it instead of deleting the deal">
                🔒 Paid / received — cancel instead of deleting
              </span>
            ) : dealArmed ? (
              <span className="inline-flex items-center gap-1.5 text-[11px]">
                <span className="text-red-300">Delete this whole deal — {g.quotes.length} quote{g.quotes.length !== 1 ? 's' : ''} + {g.pos.length} PO{g.pos.length !== 1 ? 's' : ''}? Cannot be undone.</span>
                <button type="button" disabled={busyDelete}
                  onClick={async () => { setBusyDelete(true); try { await onDeleteDeal(g.quotes.map((q) => String(q.quote_id)), g.pos.map((p) => String(p.po_id))); } finally { setBusyDelete(false); setConfirmDelete(null); } }}
                  className="font-bold text-white bg-red-600 hover:bg-red-500 px-2 py-1 rounded-lg disabled:opacity-50">{busyDelete ? 'Deleting…' : 'Yes, delete'}</button>
                <button type="button" onClick={() => setConfirmDelete(null)} className="text-slate-400 hover:text-slate-200 px-1.5 py-1">Cancel</button>
              </span>
            ) : (
              <button type="button" onClick={() => setConfirmDelete(dealKey)}
                className="text-[11px] font-semibold text-red-300/80 hover:text-red-300 px-2 py-1 rounded-lg border border-red-500/25 hover:border-red-500/40 hover:bg-red-500/10 transition-colors"
                title="Permanently delete this deal — every quote and PO in it">
                Delete deal
              </button>
            )}
          </div>
        )}
        {/* Quote + PO sit side-by-side only on wide screens; on phones/tablets
            they stack so the dense fields aren't crushed into half-width columns */}
        <div className={hasBoth ? 'grid grid-cols-1 lg:grid-cols-2 gap-4 lg:gap-3 items-start' : 'space-y-5'}>

        {/* ── Quote section ── */}
        {g.quotes.length > 0 && (
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-widest text-slate-400 mb-2">
              Quote{g.quotes.length > 1 ? `s (${g.quotes.length})` : ''}
            </p>
            <div className="space-y-3">
              {g.quotes.map((qt) => {
                const qKey  = String(qt.quote_id);
                const items = quoteItems.filter((i) => String(i.quote_id) === qKey);
                const sup   = suppliers.find((s) => s.supplier_id === qt.supplier_id);
                const co    = companies.find((c) => c.company_id === qt.company_id);
                // Quote replacement lineage (mirrors the PO cards).
                const qReplacesId  = (qt as any).replaces_quote_id;
                const qRevisionOf  = qReplacesId ? quotes.find((x) => String(x.quote_id) === String(qReplacesId)) : null;
                const qSupersededBy = quotes.filter((x) => String((x as any).replaces_quote_id ?? '') === qKey);
                const qLabel = (q: any) => q.pi_number || `Q#${q.quote_id}`;
                return (
                  <div key={qKey} className="bg-white/5 border border-white/10 rounded-xl p-3 space-y-2">
                    {/* Quote meta */}
                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-x-3 gap-y-1.5 text-xs">
                      {/* The PI number IS the quote's reference — copyable here
                          so it can be pasted into an email without retyping. */}
                      {(qt.pi_number || onUpdateQuote) && (
                        <div>
                          <p className="text-[10px] font-semibold uppercase tracking-widest text-slate-500">PI #</p>
                          {editingPi === qKey ? (
                            <div className="flex items-center gap-1 mt-0.5" onClick={(e) => e.stopPropagation()}>
                              <input autoFocus value={renameDraft} onChange={(e) => setRenameDraft(e.target.value)}
                                onKeyDown={(e) => { if (e.key === 'Escape') setEditingPi(null); if (e.key === 'Enter') (e.currentTarget.nextElementSibling as HTMLButtonElement)?.click(); }}
                                placeholder="PI / quote reference" className="w-40 text-xs rounded px-1.5 py-0.5 bg-slate-900 border border-sky-500/40 text-white focus:outline-none" />
                              <button disabled={renameBusy} title="Save — also renames the PI on this deal's POs"
                                onClick={async (e) => { e.stopPropagation(); const v = renameDraft.trim(); if (v !== (qt.pi_number ?? '') && onUpdateQuote) { setRenameBusy(true); try { await onUpdateQuote(qKey, { pi_number: v || null }); } finally { setRenameBusy(false); } } setEditingPi(null); }}
                                className="text-emerald-400 hover:text-emerald-300 disabled:opacity-40 p-0.5"><svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2.5"><path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7"/></svg></button>
                              <button onClick={(e) => { e.stopPropagation(); setEditingPi(null); }} className="text-slate-500 hover:text-slate-300 p-0.5"><svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2.5"><path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12"/></svg></button>
                            </div>
                          ) : (
                            <p className="text-slate-300 mt-0.5 inline-flex items-center gap-1">
                              {onUpdateQuote ? (
                                <button onClick={(e) => { e.stopPropagation(); setRenameDraft(qt.pi_number ?? ''); setEditingPi(qKey); }}
                                  className="font-mono hover:text-sky-300 transition-colors text-left" title="Click to rename this PI / quote reference (updates its POs too)">
                                  {qt.pi_number || <span className="text-slate-600 italic font-sans">Set PI #…</span>}
                                </button>
                              ) : <span className="font-mono">{qt.pi_number}</span>}
                              {qt.pi_number && <CopyBtn text={qt.pi_number} />}
                            </p>
                          )}
                        </div>
                      )}
                      {[
                        { label: 'Date',      value: qt.quote_date },
                        { label: 'Supplier',  value: sup?.supplier_name },
                        { label: 'Currency',  value: qt.currency },
                        { label: 'Lead Time', value: qt.estimated_lead_time_days },
                        { label: 'To',        value: co?.legal_name },
                        // Document total first (it may include freight); items sum only
                        // when no total was stored — same basis as the PO card.
                        { label: 'Total',     value: qt.total_value != null && Number(qt.total_value) > 0 ? fmtCcy(Number(qt.total_value), qt.currency) : items.length > 0 ? fmtCcy(items.reduce((s, i) => s + Number(i.quantity) * Number(i.unit_price), 0), qt.currency) : null },
                      ].map(({ label, value }) => value ? (
                        <div key={label}>
                          <p className="text-[10px] font-semibold uppercase tracking-widest text-slate-500">{label}</p>
                          <p className="text-slate-300 mt-0.5">{value}</p>
                        </div>
                      ) : null)}
                    </div>

                    {/* Replacement lineage + one-click "this quote replaces that one" */}
                    {(qRevisionOf || qSupersededBy.length > 0 || onUpdateQuote) && (
                      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px]" onClick={(e) => e.stopPropagation()}>
                        {editingQuoteReplaces === qKey && onUpdateQuote ? (
                          <span className="inline-flex items-center gap-1">
                            <span className="text-slate-500">Replaces</span>
                            <select autoFocus defaultValue={qReplacesId ?? ''} disabled={renameBusy}
                              onChange={async (e) => { const val = e.target.value || null; setRenameBusy(true); try { await onUpdateQuote(qKey, { replaces_quote_id: val }); } finally { setRenameBusy(false); setEditingQuoteReplaces(null); } }}
                              className="text-[11px] rounded px-1.5 py-0.5 bg-slate-900 border border-sky-500/40 text-white focus:outline-none max-w-[220px]">
                              <option value="">— replaces nothing —</option>
                              {quotes.filter((x) => String(x.quote_id) !== qKey).map((x) => (
                                <option key={x.quote_id} value={x.quote_id}>{qLabel(x)}{x.quote_date ? ` · ${x.quote_date}` : ''}</option>
                              ))}
                            </select>
                            <button onClick={(e) => { e.stopPropagation(); setEditingQuoteReplaces(null); }} className="text-slate-500 hover:text-slate-300">✕</button>
                          </span>
                        ) : editingQuoteReplacedBy === qKey && onUpdateQuote ? (
                          <span className="inline-flex items-center gap-1">
                            <span className="text-slate-500">Replaced by</span>
                            <select autoFocus defaultValue="" disabled={renameBusy}
                              onChange={async (e) => {
                                const successor = e.target.value;
                                if (!successor) { setEditingQuoteReplacedBy(null); return; }
                                setRenameBusy(true);
                                // Written on the SUCCESSOR; the handler also marks THIS quote Replaced.
                                try { await onUpdateQuote(successor, { replaces_quote_id: qKey }); } finally { setRenameBusy(false); setEditingQuoteReplacedBy(null); }
                              }}
                              className="text-[11px] rounded px-1.5 py-0.5 bg-slate-900 border border-sky-500/40 text-white focus:outline-none max-w-[220px]">
                              <option value="">— pick the newer quote —</option>
                              {quotes.filter((x) => String(x.quote_id) !== qKey).map((x) => (
                                <option key={x.quote_id} value={x.quote_id}>{qLabel(x)}{x.quote_date ? ` · ${x.quote_date}` : ''}</option>
                              ))}
                            </select>
                            <button onClick={(e) => { e.stopPropagation(); setEditingQuoteReplacedBy(null); }} className="text-slate-500 hover:text-slate-300">✕</button>
                          </span>
                        ) : (
                          <>
                            {qRevisionOf && <span className="text-slate-500">↩ Revision of <span className="text-slate-300 font-medium">{qLabel(qRevisionOf)}</span></span>}
                            {qSupersededBy.length > 0 && <span className="text-amber-400/90">⤷ Replaced by <span className="font-medium">{qSupersededBy.map(qLabel).join(', ')}</span></span>}
                            {onUpdateQuote && (
                              <button onClick={(e) => { e.stopPropagation(); setEditingQuoteReplaces(qKey); }}
                                className="text-slate-500 hover:text-sky-300 underline underline-offset-2"
                                title="Mark this quote as replacing an earlier one — the old quote is set to Replaced and linked">
                                {qRevisionOf ? 'change' : '+ replaces a quote'}
                              </button>
                            )}
                            {onUpdateQuote && qSupersededBy.length === 0 && (
                              <button onClick={(e) => { e.stopPropagation(); setEditingQuoteReplacedBy(qKey); }}
                                className="text-slate-500 hover:text-amber-300 underline underline-offset-2"
                                title="Mark this quote as superseded — pick the newer quote that replaces it; this one is set to Replaced and linked">
                                + replaced by…
                              </button>
                            )}
                          </>
                        )}
                      </div>
                    )}

                    {/* Quote document link */}
                    {qt.document_url && (
                      <div>
                        <a
                          href={qt.document_url}
                          target="_blank"
                          rel="noopener noreferrer"
                          onClick={(e) => e.stopPropagation()}
                          className="inline-flex items-center gap-1.5 text-[11px] text-sky-400 hover:text-sky-300 transition-colors"
                        >
                          <svg className="w-3.5 h-3.5 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
                            <path strokeLinecap="round" strokeLinejoin="round" d="M13.828 10.172a4 4 0 00-5.656 0l-4 4a4 4 0 105.656 5.656l1.102-1.101m-.758-4.899a4 4 0 005.656 0l4-4a4 4 0 00-5.656-5.656l-1.1 1.1" />
                          </svg>
                          Quote Document
                        </a>
                      </div>
                    )}

                    {/* Quote status selector */}
                    {onQuoteStatusChange && (
                      <div className="flex items-center gap-1.5">
                        <select
                          value={qt.status ?? ''}
                          disabled={updatingQuote === qKey}
                          onClick={(e) => e.stopPropagation()}
                          onChange={async (e) => {
                            e.stopPropagation();
                            setUpdatingQuote(qKey);
                            try { await onQuoteStatusChange(qKey, e.target.value); } finally { setUpdatingQuote(null); }
                          }}
                          className={`flex-1 text-[11px] font-semibold rounded-lg px-2 py-1 border bg-slate-900 focus:outline-none focus:ring-1 focus:ring-sky-500/40 cursor-pointer disabled:opacity-60 ${quoteBadge(qt.status)}`}
                        >
                          {QUOTE_STATUSES.map((s) => (
                            <option key={s} value={s} className="bg-canvas text-slate-200">{s}</option>
                          ))}
                        </select>
                        {updatingQuote === qKey && <span className="text-[10px] text-slate-500 animate-pulse">saving…</span>}
                      </div>
                    )}

                    {/* Quote line items — hidden when side-by-side comparison is shown */}
                    {!hasBoth && (
                      <div className="overflow-x-auto">
                        <table className="w-full text-xs border-collapse">
                          <thead>
                            <tr className="border-b border-slate-700/60">
                              <th className="text-left py-1.5 pr-4 text-[11px] font-semibold uppercase tracking-widest text-slate-400">Component</th>
                              <th className="text-right py-1.5 pr-4 text-[11px] font-semibold uppercase tracking-widest text-slate-400">Qty</th>
                              <th className="text-right py-1.5 text-[11px] font-semibold uppercase tracking-widest text-slate-400">Unit / Total</th>
                              <th className="w-16" />
                            </tr>
                          </thead>
                          <tbody>
                            {items.map((item) => {
                              const comp = components.find((c) => c.component_id === item.component_id);
                              const lineTotal = (Number(item.quantity) || 0) * (Number(item.unit_price) || 0);
                              const isEditingComp = editingItem?.type === 'quote' && editingItem.id === item.quote_line_id;
                              const isEditingLine = editingLine?.mode === 'edit' && editingLine.type === 'quote' && editingLine.id === item.quote_line_id && editingLine.rowIdx === -1;
                              return (
                                <tr key={item.quote_line_id} className={`border-b border-slate-800/40 last:border-0 group ${isEditingLine ? 'bg-sky-500/5' : ''}`}>
                                  {/* Component */}
                                  <td className="py-2 pr-4">
                                    {isEditingComp ? (
                                      <div className="flex items-center gap-1.5">
                                        <div className="flex-1 min-w-0"><ComponentCombobox components={components} onSelect={(cid) => handleReassign('quote', item.quote_line_id, cid)} onCancel={() => setEditingItem(null)} /></div>
                                        {editingSaving && <span className="text-[10px] text-slate-500 flex-shrink-0">saving…</span>}
                                      </div>
                                    ) : isEditingLine && editingLine?.showCompSearch ? (
                                      <ComponentCombobox components={components} onSelect={(cid) => setEditingLine((prev) => prev && { ...prev, componentId: cid, showCompSearch: false })} onCancel={() => setEditingLine((prev) => prev && { ...prev, showCompSearch: false })} />
                                    ) : (
                                      <div className="min-w-0">
                                        <p className="font-semibold text-white leading-tight">
                                          <CopyText text={comp?.supplier_model ?? ''}>{comp?.supplier_model ?? <span className="text-slate-600 italic">unlinked</span>}</CopyText>
                                        </p>
                                        {comp?.internal_description && (
                                          <p className="text-[11px] text-slate-500 mt-0.5 truncate max-w-xs">
                                            <CopyText text={comp.internal_description}>{comp.internal_description}</CopyText>
                                          </p>
                                        )}
                                        {isEditingLine && <button onMouseDown={(e) => { e.preventDefault(); setEditingLine((prev) => prev && { ...prev, showCompSearch: true }); }} className="text-[10px] text-sky-400 hover:text-sky-300 transition-colors">change product</button>}
                                      </div>
                                    )}
                                  </td>
                                  {/* Qty */}
                                  <td className="py-2 pr-4 text-right tabular-nums">
                                    {isEditingLine ? (
                                      <input type="number" value={editingLine!.qty} onChange={(e) => setEditingLine((prev) => prev && { ...prev, qty: e.target.value })} onKeyDown={(e) => { if (e.key === 'Escape') setEditingLine(null); if (e.key === 'Enter') handleSaveLine(); }} className="w-16 text-right px-1.5 py-0.5 bg-slate-900 border border-sky-500/50 rounded text-xs text-white focus:outline-none focus:border-sky-400" />
                                    ) : <span className="text-slate-300">{Number(item.quantity).toLocaleString()}</span>}
                                  </td>
                                  {/* Unit / Total */}
                                  <td className="py-2 text-right">
                                    {isEditingLine ? (
                                      <div className="flex items-center justify-end gap-1">
                                        <input type="number" value={editingLine!.price} onChange={(e) => setEditingLine((prev) => prev && { ...prev, price: e.target.value })} onKeyDown={(e) => { if (e.key === 'Escape') setEditingLine(null); if (e.key === 'Enter') handleSaveLine(); }} className="w-20 text-right px-1.5 py-0.5 bg-slate-900 border border-sky-500/50 rounded text-xs text-white focus:outline-none focus:border-sky-400" />
                                        <button onMouseDown={(e) => { e.preventDefault(); handleSaveLine(); }} disabled={editingLine!.saving} title="Save" className="text-emerald-400 hover:text-emerald-300 disabled:opacity-40 p-0.5"><svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2.5"><path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7"/></svg></button>
                                        <button onMouseDown={(e) => { e.preventDefault(); setEditingLine(null); }} title="Cancel" className="text-slate-500 hover:text-slate-300 p-0.5"><svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2.5"><path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12"/></svg></button>
                                      </div>
                                    ) : (
                                      <div>
                                        <p className="text-slate-300 tabular-nums">{fmtCcy(Number(item.unit_price), item.currency)}</p>
                                        <p className="font-semibold text-white tabular-nums">{fmtCcy(lineTotal, item.currency)}</p>
                                      </div>
                                    )}
                                  </td>
                                  {/* Actions column — all icons together, reveal on hover */}
                                  <td className="py-2 pl-2 text-right">
                                    {!isEditingLine && !isEditingComp && (
                                      <div className="opacity-0 group-hover:opacity-100 flex items-center justify-end gap-0.5 transition-opacity">
                                        {onUpdateQuoteItem && (
                                          <button onClick={() => setEditingItem({ type: 'quote', id: item.quote_line_id })} title="Re-assign product" className="p-1 text-slate-500 hover:text-blue-400 hover:bg-blue-500/10 rounded transition-all"><svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2"><path strokeLinecap="round" strokeLinejoin="round" d="M8 7h12m0 0l-4-4m4 4l-4 4m0 6H4m0 0l4 4m-4-4l4-4"/></svg></button>
                                        )}
                                        {onUpdateQuoteLineItem && (
                                          <button onMouseDown={(e) => { e.preventDefault(); setEditingLine({ mode: 'edit', type: 'quote', id: item.quote_line_id, rowIdx: -1, targetId: 0, currency: item.currency, componentId: item.component_id ?? null, showCompSearch: false, qty: String(item.quantity), price: String(item.unit_price), saving: false }); }} title="Edit qty & price" className="p-1 text-slate-500 hover:text-sky-400 hover:bg-sky-500/10 rounded transition-all"><svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2"><path strokeLinecap="round" strokeLinejoin="round" d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z"/></svg></button>
                                        )}
                                        {onDeleteQuoteLineItem && (
                                          <button onClick={async (e) => { e.stopPropagation(); if (!window.confirm('Delete this quote line item?')) return; await onDeleteQuoteLineItem(item.quote_line_id); }} title="Delete" className="p-1 text-slate-500 hover:text-red-400 hover:bg-red-500/10 rounded transition-all"><svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2"><path strokeLinecap="round" strokeLinejoin="round" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"/></svg></button>
                                        )}
                                      </div>
                                    )}
                                  </td>
                                </tr>
                              );
                            })}
                            {/* New quote item row */}
                            {editingLine?.mode === 'add' && editingLine.type === 'quote' && editingLine.rowIdx === -2 && (() => {
                              const displayComp = editingLine.componentId ? components.find((c) => c.component_id === editingLine.componentId) : null;
                              return (
                                <tr className="border-b border-slate-800/40 bg-sky-500/5">
                                  <td className="py-2 pr-4">
                                    {editingLine.showCompSearch ? (
                                      <ComponentCombobox components={components} onSelect={(cid) => setEditingLine((prev) => prev && { ...prev, componentId: cid, showCompSearch: false })} onCancel={() => setEditingLine((prev) => prev && { ...prev, showCompSearch: false })} />
                                    ) : (
                                      <button className="text-left w-full" onMouseDown={(e) => { e.preventDefault(); setEditingLine((prev) => prev && { ...prev, showCompSearch: true }); }}>
                                        {displayComp ? (
                                          <div><p className="font-semibold text-white leading-tight">{displayComp.supplier_model}</p>{displayComp.internal_description && <p className="text-[11px] text-slate-500 truncate">{displayComp.internal_description}</p>}</div>
                                        ) : <span className="text-slate-500 italic text-xs">Select product…</span>}
                                      </button>
                                    )}
                                  </td>
                                  <td className="py-2 pr-4 text-right"><input type="number" value={editingLine.qty} onChange={(e) => setEditingLine((prev) => prev && { ...prev, qty: e.target.value })} onKeyDown={(e) => { if (e.key === 'Escape') setEditingLine(null); if (e.key === 'Enter') handleSaveLine(); }} placeholder="Qty" className="w-16 text-right px-1.5 py-0.5 bg-slate-900 border border-sky-500/50 rounded text-xs text-white focus:outline-none focus:border-sky-400" /></td>
                                  <td className="py-2 text-right">
                                    <div className="flex items-center justify-end gap-1">
                                      <input type="number" value={editingLine.price} onChange={(e) => setEditingLine((prev) => prev && { ...prev, price: e.target.value })} onKeyDown={(e) => { if (e.key === 'Escape') setEditingLine(null); if (e.key === 'Enter') handleSaveLine(); }} placeholder="Unit price" className="w-20 text-right px-1.5 py-0.5 bg-slate-900 border border-sky-500/50 rounded text-xs text-white focus:outline-none focus:border-sky-400" />
                                      <button onMouseDown={(e) => { e.preventDefault(); handleSaveLine(); }} disabled={editingLine.saving} title="Save" className="text-emerald-400 hover:text-emerald-300 disabled:opacity-40 p-0.5"><svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2.5"><path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7"/></svg></button>
                                      <button onMouseDown={(e) => { e.preventDefault(); setEditingLine(null); }} title="Cancel" className="text-slate-500 hover:text-slate-300 p-0.5"><svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2.5"><path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12"/></svg></button>
                                    </div>
                                  </td>
                                  <td />
                                </tr>
                              );
                            })()}
                          </tbody>
                        </table>
                        {!editingLine && onAddQuoteLineItem && (
                          <div className="mt-2">
                            <button onMouseDown={(e) => { e.preventDefault(); setEditingLine({ mode: 'add', type: 'quote', id: 0, rowIdx: -2, targetId: qt.quote_id, currency: qt.currency, componentId: null, showCompSearch: true, qty: '', price: '', saving: false }); }} className="flex items-center gap-1.5 text-[11px] font-semibold text-sky-400 hover:text-sky-300 px-2 py-1 bg-sky-500/10 hover:bg-sky-500/20 border border-sky-500/20 rounded-lg transition-colors">
                              <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2.5"><path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4"/></svg>
                              Add item
                            </button>
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>

            {/* Create PO CTA */}
            {showCreatePO && (
              <button
                onClick={(e) => { e.stopPropagation(); onCreatePO(String(targetQuote.quote_id)); }}
                className="mt-2 w-full text-left px-3 py-2 bg-violet-500/10 hover:bg-violet-500/20 border border-violet-500/30 text-violet-300 text-xs font-semibold rounded-lg transition-colors flex items-center gap-2"
              >
                <span>📦</span>
                <span>Create PO from this quote →</span>
              </button>
            )}
          </div>
        )}

        {/* ── PO section ── */}
        {g.pos.length > 0 && (
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-widest text-slate-400 mb-2">
              Purchase Order{g.pos.length > 1 ? `s (${g.pos.length})` : ''}
            </p>
            <div className="space-y-3">
              {g.pos.map((po) => {
                const pKey    = String(po.po_id);
                const items   = poItems.filter((i) => String(i.po_id) === pKey);
                const costs   = poCosts.filter((c) => String(c.po_id) === pKey);
                const princ   = costs.filter((c) => PRINCIPAL_CATS.has(c.cost_category));
                const fees    = costs.filter((c) => BANK_FEE_CATS.has(c.cost_category));
                const taxes   = costs.filter((c) => TAX_CATS.has(c.cost_category));
                const landed  = costs.filter((c) => !PRINCIPAL_CATS.has(c.cost_category) && !BANK_FEE_CATS.has(c.cost_category) && !TAX_CATS.has(c.cost_category));
                const tIdr     = Number(po.total_value || 0) * (po.currency === 'IDR' ? 1 : (Number(po.exchange_rate) || 1));
                const princPay = princ.filter((c) => c.cost_category !== 'overpayment_credit');
                // Actual IDR paid — uses cost-level rate when available, else PO rate
                const paidIdr  = princPay.reduce((s, c) => {
                  if (c.currency === 'IDR') return s + Number(c.amount);
                  const rate = Number(c.exchange_rate) || Number(po.exchange_rate) || 1;
                  return s + Number(c.amount) * rate;
                }, 0);

                // Foreign obligation tracking (rate-agnostic: obligation = units, not IDR)
                const foreignPaid    = po.currency !== 'IDR'
                  ? princPay.filter((c) => c.currency === po.currency).reduce((s, c) => s + Number(c.amount), 0)
                  : 0;
                const hasForeignTracking = po.currency !== 'IDR' && foreignPaid > 0;
                const foreignTotal       = hasForeignTracking ? (Number(po.total_value) || 0) : 0;
                const foreignOut         = hasForeignTracking ? Math.max(0, foreignTotal - foreignPaid) : 0;
                const isObligationMet    = hasForeignTracking && foreignOut < 0.005;

                // Progress % — track in original currency when possible
                const pct = hasForeignTracking && foreignTotal > 0
                  ? Math.min(100, (foreignPaid / foreignTotal) * 100)
                  : tIdr > 0 ? Math.min(100, (paidIdr / tIdr) * 100) : 0;

                // What to show as "outstanding obligation"
                const outIdr       = isObligationMet ? 0 : Math.max(0, tIdr - paidIdr);
                // FX variance: only meaningful when obligation met (rate diff, not missing payment)
                const fxVariance   = isObligationMet ? paidIdr - tIdr : 0;
                const hasFxVariance = isObligationMet && Math.abs(fxVariance) >= 1;

                // Total cash out = every cost converted to IDR at actual rate
                const toIdrLocal = (c: typeof costs[number]) => {
                  if (c.currency === 'IDR') return Number(c.amount);
                  return Number(c.amount) * (Number(c.exchange_rate) || Number(po.exchange_rate) || 1);
                };
                const totalCashOutIdr        = costs.reduce((s, c) => s + toIdrLocal(c), 0);
                const totalCashOutExclTaxIdr = costs.filter((c) => !TAX_CATS.has(c.cost_category)).reduce((s, c) => s + toIdrLocal(c), 0);

                // ── Lead time (computed once per PO, shared across all line items) ──
                const ltRecDate = po.status === 'Fully Received' && po.actual_received_date
                  ? new Date(po.actual_received_date) : null;
                const ltDiff = (d: string) => ltRecDate
                  ? Math.round((ltRecDate.getTime() - new Date(d).getTime()) / 86_400_000) : null;
                const ltPo = ltRecDate && po.po_date ? ltDiff(po.po_date) : null;
                const ltQuote = (() => {
                  const q = quotes.find((q) => String(q.quote_id) === String(po.quote_id));
                  return ltRecDate && q?.quote_date ? ltDiff(q.quote_date) : null;
                })();
                const ltFirstPay = costs.filter((c) => c.payment_date != null)
                  .sort((a, b) => (a.payment_date! < b.payment_date! ? -1 : 1))[0];
                const ltPayment = ltRecDate && ltFirstPay?.payment_date ? ltDiff(ltFirstPay.payment_date) : null;

                // Replacement lineage: this PO may revise an earlier one, or have
                // been superseded by later one(s). Resolve across ALL POs (not just
                // this group) so a supersede that changed the PI still links.
                const replacesId = (po as any).replaces_po_id;
                const revisionOf = replacesId ? pos.find((p) => String(p.po_id) === String(replacesId)) : null;
                const supersededBy = pos.filter((p) => String((p as any).replaces_po_id ?? '') === String(po.po_id));

                return (
                  <div key={pKey} className="bg-white/5 border border-white/10 rounded-xl p-3 space-y-2">
                    {/* PO meta */}
                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-x-3 gap-y-1.5 text-xs">
                      {(po.po_number || onUpdatePo) && (
                        <div key="PO #">
                          <p className="text-[10px] font-medium text-slate-500 uppercase tracking-wider">PO #</p>
                          {editingPoNumber === pKey ? (
                            <div className="flex items-center gap-1 mt-0.5" onClick={(e) => e.stopPropagation()}>
                              <input autoFocus value={renameDraft} onChange={(e) => setRenameDraft(e.target.value)}
                                onKeyDown={(e) => { if (e.key === 'Escape') setEditingPoNumber(null); if (e.key === 'Enter') (e.currentTarget.nextElementSibling as HTMLButtonElement)?.click(); }}
                                placeholder="PO number" className="w-28 text-xs rounded px-1.5 py-0.5 bg-slate-900 border border-sky-500/40 text-white focus:outline-none" />
                              <button disabled={renameBusy} title="Save"
                                onClick={async (e) => { e.stopPropagation(); const v = renameDraft.trim(); if (v && v !== po.po_number && onUpdatePo) { setRenameBusy(true); try { await onUpdatePo(pKey, { po_number: v }); } finally { setRenameBusy(false); } } setEditingPoNumber(null); }}
                                className="text-emerald-400 hover:text-emerald-300 disabled:opacity-40 p-0.5"><svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2.5"><path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7"/></svg></button>
                              <button onClick={(e) => { e.stopPropagation(); setEditingPoNumber(null); }} className="text-slate-500 hover:text-slate-300 p-0.5"><svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2.5"><path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12"/></svg></button>
                            </div>
                          ) : (
                            <div className="flex items-center gap-1 mt-0.5">
                              {onUpdatePo ? (
                                <button onClick={(e) => { e.stopPropagation(); setRenameDraft(po.po_number ?? ''); setEditingPoNumber(pKey); }}
                                  className="text-slate-300 hover:text-sky-300 transition-colors text-left" title="Click to rename the PO number">
                                  {po.po_number || <span className="text-slate-600 italic">Set PO #…</span>}
                                </button>
                              ) : <p className="text-slate-300">{po.po_number}</p>}
                              {po.po_number && <CopyBtn text={po.po_number} />}
                            </div>
                          )}
                        </div>
                      )}
                      {(revisionOf || supersededBy.length > 0) && (
                        <div key="lineage" className="col-span-2 sm:col-span-4 -mt-0.5">
                          {revisionOf && (
                            <p className="text-[11px] text-slate-500">
                              ↩ Revision of <span className="text-slate-300 font-medium">{revisionOf.po_number}</span>
                            </p>
                          )}
                          {supersededBy.length > 0 && (
                            <p className="text-[11px] text-amber-400/90">
                              ⤷ Replaced by <span className="font-medium">{supersededBy.map((p) => p.po_number).filter(Boolean).join(', ')}</span>
                            </p>
                          )}
                        </div>
                      )}
                      {[
                        { label: 'PO Date',      value: po.po_date },
                        { label: 'PI Date',      value: po.pi_date },
                        { label: 'Incoterms',    value: po.incoterms },
                        { label: 'Est. Delivery',value: po.estimated_delivery_date },
                        { label: 'Currency',     value: po.currency },
                        { label: 'Ship Via',     value: po.method_of_shipment },
                      ].map(({ label, value }) => value ? (
                        <div key={label}>
                          <p className="text-[10px] font-medium text-slate-500 uppercase tracking-wider">{label}</p>
                          <p className="text-slate-300 mt-0.5">{value}</p>
                        </div>
                      ) : null)}

                      {/* Editable supplier */}
                      {onUpdatePo && (() => {
                        const linkedSupplier = po.quote_id
                          ? suppliers.find((s) => s.supplier_id === quotes.find((q) => String(q.quote_id) === String(po.quote_id))?.supplier_id)
                          : null;
                        const currentSupplier = linkedSupplier ?? suppliers.find((s) => s.supplier_id === po.supplier_id) ?? null;
                        return (
                          <div>
                            <p className="text-[10px] font-medium text-slate-500 uppercase tracking-wider">Supplier</p>
                            {editingPoSupplier === pKey ? (
                              <div className="flex items-center gap-1 mt-0.5" onClick={(e) => e.stopPropagation()}>
                                <select
                                  autoFocus
                                  defaultValue={po.supplier_id ?? ''}
                                  onChange={async (e) => {
                                    const val = e.target.value || null;
                                    if (onUpdatePo) { setUpdatingPo(pKey); try { await onUpdatePo(pKey, { supplier_id: val ?? undefined }); } finally { setUpdatingPo(null); } }
                                    setEditingPoSupplier(null);
                                  }}
                                  className="flex-1 text-[11px] rounded px-1.5 py-0.5 bg-slate-900 border border-sky-500/40 text-white focus:outline-none"
                                >
                                  <option value="">— none —</option>
                                  {suppliers.map((s) => (
                                    <option key={s.supplier_id} value={s.supplier_id}>{s.supplier_name}</option>
                                  ))}
                                </select>
                                <button onClick={(e) => { e.stopPropagation(); setEditingPoSupplier(null); }} className="text-slate-500 hover:text-slate-300 text-[10px]">✕</button>
                              </div>
                            ) : (
                              <button
                                onClick={(e) => { e.stopPropagation(); setEditingPoSupplier(pKey); }}
                                className="text-slate-300 mt-0.5 text-xs hover:text-sky-300 transition-colors text-left"
                                title="Click to set supplier"
                              >
                                {currentSupplier?.supplier_name ?? <span className="text-slate-600 italic">Set supplier…</span>}
                                {linkedSupplier && <span className="text-slate-600 text-[10px] ml-1">(via quote)</span>}
                              </button>
                            )}
                          </div>
                        );
                      })()}

                      {/* Editable addressed to (company) */}
                      {onUpdatePo && (() => {
                        const linkedCompany = po.quote_id
                          ? companies.find((c) => c.company_id === quotes.find((q) => String(q.quote_id) === String(po.quote_id))?.company_id)
                          : null;
                        const currentCompany = linkedCompany ?? companies.find((c) => c.company_id === po.company_id) ?? null;
                        return (
                          <div>
                            <p className="text-[10px] font-medium text-slate-500 uppercase tracking-wider">Addressed To</p>
                            {editingPoCompany === pKey ? (
                              <div className="flex items-center gap-1 mt-0.5" onClick={(e) => e.stopPropagation()}>
                                <select
                                  autoFocus
                                  defaultValue={po.company_id ?? ''}
                                  onChange={async (e) => {
                                    const val = e.target.value || null;
                                    if (onUpdatePo) { setUpdatingPo(pKey); try { await onUpdatePo(pKey, { company_id: val ?? undefined }); } finally { setUpdatingPo(null); } }
                                    setEditingPoCompany(null);
                                  }}
                                  className="flex-1 text-[11px] rounded px-1.5 py-0.5 bg-slate-900 border border-sky-500/40 text-white focus:outline-none"
                                >
                                  <option value="">— none —</option>
                                  {companies.map((c) => (
                                    <option key={c.company_id} value={c.company_id}>{c.legal_name}</option>
                                  ))}
                                </select>
                                <button onClick={(e) => { e.stopPropagation(); setEditingPoCompany(null); }} className="text-slate-500 hover:text-slate-300 text-[10px]">✕</button>
                              </div>
                            ) : (
                              <button
                                onClick={(e) => { e.stopPropagation(); setEditingPoCompany(pKey); }}
                                className="text-slate-300 mt-0.5 text-xs hover:text-sky-300 transition-colors text-left"
                                title="Click to set company"
                              >
                                {currentCompany?.legal_name ?? <span className="text-slate-600 italic">Set company…</span>}
                                {linkedCompany && <span className="text-slate-600 text-[10px] ml-1">(via quote)</span>}
                              </button>
                            )}
                          </div>
                        );
                      })()}

                      {/* Editable received date */}
                      {po.status === 'Fully Received' && (
                        <div>
                          <p className="text-[10px] font-medium text-emerald-500/80 uppercase tracking-wider">Received</p>
                          {editingReceivedId === pKey ? (
                            <div className="flex items-center gap-1 mt-0.5" onClick={(e) => e.stopPropagation()}>
                              <input
                                type="date"
                                value={editingReceivedDate}
                                onChange={(e) => setEditingReceivedDate(e.target.value)}
                                className="px-1.5 py-0.5 bg-slate-950 border border-emerald-500/40 rounded text-xs text-white focus:outline-none w-32"
                              />
                              <button
                                onClick={async (e) => {
                                  e.stopPropagation();
                                  if (onUpdatePo) { setUpdatingPo(pKey); try { await onUpdatePo(pKey, { actual_received_date: editingReceivedDate }); } finally { setUpdatingPo(null); } }
                                  setEditingReceivedId(null);
                                }}
                                className="text-emerald-400 hover:text-emerald-300 text-[10px] font-bold"
                              >Save</button>
                              <button onClick={(e) => { e.stopPropagation(); setEditingReceivedId(null); }} className="text-slate-500 hover:text-slate-300 text-[10px]">✕</button>
                            </div>
                          ) : (
                            <button
                              onClick={(e) => { e.stopPropagation(); setEditingReceivedId(pKey); setEditingReceivedDate(po.actual_received_date ?? new Date().toISOString().slice(0, 10)); }}
                              className="text-emerald-300 mt-0.5 text-xs hover:text-emerald-200 transition-colors text-left"
                              title="Click to edit received date"
                            >
                              {po.actual_received_date ?? <span className="text-slate-600 italic">Set date…</span>}
                            </button>
                          )}
                        </div>
                      )}
                    </div>

                    {/* PO document link */}
                    {po.document_url && (
                      <div>
                        <a
                          href={po.document_url}
                          target="_blank"
                          rel="noopener noreferrer"
                          onClick={(e) => e.stopPropagation()}
                          className="inline-flex items-center gap-1.5 text-[11px] text-sky-400 hover:text-sky-300 transition-colors"
                        >
                          <svg className="w-3.5 h-3.5 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
                            <path strokeLinecap="round" strokeLinejoin="round" d="M13.828 10.172a4 4 0 00-5.656 0l-4 4a4 4 0 105.656 5.656l1.102-1.101m-.758-4.899a4 4 0 005.656 0l4-4a4 4 0 00-5.656-5.656l-1.1 1.1" />
                          </svg>
                          PO / PI Document
                        </a>
                      </div>
                    )}

                    {/* Lead-time breakdown — shown once received date is set */}
                    {ltRecDate && (() => {
                      const fmt = (d: number | null) => d == null ? '—' : d < 0 ? '—' : d === 0 ? 'same day' : d === 1 ? '1 day' : `${d} days`;
                      return (
                        <div className="rounded-lg bg-emerald-500/5 border border-emerald-500/15 px-3 py-2">
                          <p className="text-[10px] font-bold uppercase tracking-wider text-emerald-500/70 mb-2">Lead Time</p>
                          <div className="grid grid-cols-3 gap-2 text-center">
                            {[
                              { label: 'Quote → Received',      days: ltQuote },
                              { label: 'PO → Received',         days: ltPo },
                              { label: '1st Payment → Received', days: ltPayment },
                            ].map(({ label, days }) => (
                              <div key={label}>
                                <p className={`text-sm font-bold tabular-nums whitespace-nowrap ${days != null && days >= 0 ? 'text-emerald-300' : 'text-slate-600'}`}>
                                  {fmt(days)}
                                </p>
                                <p className="text-[10px] text-slate-500 mt-0.5 leading-tight">{label}</p>
                              </div>
                            ))}
                          </div>
                        </div>
                      );
                    })()}

                    {/* PO value. The DOCUMENT total leads (total_value is the committed
                        obligation — freight included when the supplier bills it); the
                        items sum is detail, shown when it differs so the same line never
                        mixes two bases (the 57,980-vs-60,765 mismatch, 2026-08-14).

                        A gap freight explains and a gap nothing explains used to be
                        drawn identically, in the same grey — so PO-149-MBS-08-2026
                        could sit there committed at TWICE its own lines, with
                        "items …" beside it reading as a footnote rather than a
                        contradiction (owner, 2026-08-24). The arithmetic lives in
                        lib/poTotals.ts now, and a disagreement is amber. */}
                    {(items.length > 0 || po.total_value) && (() => {
                      const itemsSum = items.reduce((s, i) => s + Number(i.quantity) * Number(i.unit_cost), 0);
                      const docTotal = Number(po.total_value) || itemsSum;
                      const freight = Number((po as any).freight_charges_intl) || 0;
                      const verdict = checkPoTotal({ docTotal, itemsSum, freight });
                      const off = items.length > 0 && totalDisagrees(verdict);
                      return (
                      <div className="flex items-center gap-3 text-xs flex-wrap">
                        <span className={`font-semibold tabular-nums ${off ? 'text-amber-300' : 'text-white'}`}>{fmtCcy(docTotal, po.currency)}</span>
                        {items.length > 0 && verdict.state === 'freight' && (
                          <span className="text-slate-600 tabular-nums" title="The document total = line items + freight">
                            items {fmtCcy(itemsSum, po.currency)} + freight {fmtCcy(freight, po.currency)}
                          </span>
                        )}
                        {off && (
                          <span className="flex items-center gap-1.5 text-amber-300 tabular-nums font-medium"
                            title={verdict.state === 'over'
                              ? 'The PO total is higher than its own line items, and no freight on this PO accounts for the difference. Outstanding, the paid percentage and "We owe" are all computed from this total, so they are wrong until it is corrected.'
                              : 'The PO total is lower than its line items plus freight, so this PO under-states what we owe the supplier.'}>
                            <span aria-hidden>⚠</span>
                            {verdict.state === 'over' ? 'over by' : 'short by'} {fmtCcy(verdict.gap, po.currency)}
                            <span className="text-amber-300/70 font-normal">
                              · lines {fmtCcy(itemsSum, po.currency)}{freight > 0 ? ` + freight ${fmtCcy(freight, po.currency)}` : ''}
                            </span>
                          </span>
                        )}
                        {po.currency !== 'IDR' && po.exchange_rate && (
                          <span className="text-slate-500 tabular-nums">
                            @ {Number(po.exchange_rate).toLocaleString()} = {fmtIdr(tIdr)}
                          </span>
                        )}
                      </div>
                      );
                    })()}

                    {/* Payment progress */}
                    {tIdr > 0 && (
                      <div>
                        <div className="flex items-center gap-2 mb-1.5">
                          <div className="flex-1 h-2 bg-slate-700 rounded-full overflow-hidden">
                            <div
                              className={`h-full rounded-full transition-all ${pct >= 100 ? 'bg-emerald-500' : 'bg-amber-400'}`}
                              style={{ width: `${pct}%` }}
                            />
                          </div>
                          <span className={`text-xs font-bold flex-shrink-0 tabular-nums ${pct >= 100 ? 'text-emerald-400' : 'text-amber-300'}`}>
                            {pct >= 100 ? '100' : pct.toFixed(1)}%
                            {hasForeignTracking && <span className="text-[10px] font-normal text-slate-500 ml-1">({po.currency})</span>}
                          </span>
                        </div>
                        {/* Committed · Paid · Outstanding — one dense line
                            (three bordered boxes were three lines tall). */}
                        <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1 text-xs bg-white/[0.03] border border-white/10 rounded-lg px-2.5 py-1.5">
                          <span className="whitespace-nowrap">
                            <span className="text-[10px] text-slate-500 mr-1">Committed</span>
                            <span className="font-bold text-white tabular-nums">{fmtIdr(tIdr)}</span>
                            {isObligationMet && hasForeignTracking && paidIdr !== tIdr && (
                              <span className={`text-[10px] tabular-nums ml-1 ${paidIdr < tIdr ? 'text-emerald-400' : 'text-red-400'}`}>{paidIdr < tIdr ? 'FX gain' : 'FX loss'}</span>
                            )}
                          </span>
                          <span className="whitespace-nowrap">
                            <span className="text-[10px] text-slate-500 mr-1">Paid</span>
                            <span className="font-bold text-emerald-400 tabular-nums">{fmtIdr(paidIdr)}</span>
                            {totalCashOutExclTaxIdr > paidIdr && (
                              <span className="text-[10px] text-slate-600 tabular-nums ml-1">+{fmtIdr(totalCashOutExclTaxIdr - paidIdr)} fees/landed</span>
                            )}
                          </span>
                          <span className="whitespace-nowrap ml-auto">
                            <span className="text-[10px] text-slate-500 mr-1">Outstanding</span>
                            <span className={`font-bold tabular-nums ${outIdr > 0 ? 'text-amber-400' : 'text-emerald-400'}`}>{outIdr > 0 ? fmtIdr(outIdr) : '✓ Settled'}</span>
                          </span>
                        </div>
                        {/* Total spend row with cost breakdown */}
                        {totalCashOutIdr > 0 && (() => {
                          const princIdr  = princ.reduce((s, c) => s + toIdrLocal(c), 0);
                          const feesIdr   = fees.reduce((s, c) => s + toIdrLocal(c), 0);
                          const landedIdr = landed.reduce((s, c) => s + toIdrLocal(c), 0);
                          const brkTotal  = princIdr + feesIdr + landedIdr;
                          const pctFees    = brkTotal > 0 ? (feesIdr   / brkTotal) * 100 : 0;
                          const pctLanded  = brkTotal > 0 ? (landedIdr / brkTotal) * 100 : 0;
                          const pctBase    = 100 - pctFees - pctLanded;
                          return (
                            <div className="mt-2 pt-2 border-t border-slate-700/40 space-y-1.5">
                              <div className="flex items-center gap-3 flex-wrap text-[11px]">
                                <span className="text-slate-500 font-semibold uppercase tracking-widest">Total Spend</span>
                                <span className="font-bold text-slate-200 tabular-nums">{fmtIdr(totalCashOutExclTaxIdr)}</span>
                                <span className="text-slate-600">excl. tax</span>
                                {totalCashOutIdr !== totalCashOutExclTaxIdr && (
                                  <span className="text-slate-600 tabular-nums">({fmtIdr(totalCashOutIdr)} incl. tax)</span>
                                )}
                              </div>
                              {brkTotal > 0 && (
                                <>
                                  <div className="h-1.5 rounded-full overflow-hidden flex">
                                    <div className="h-full bg-sky-500/60" style={{ width: `${pctBase}%` }} />
                                    {pctFees   > 0 && <div className="h-full bg-purple-500/60" style={{ width: `${pctFees}%` }} />}
                                    {pctLanded > 0 && <div className="h-full bg-orange-500/60" style={{ width: `${pctLanded}%` }} />}
                                  </div>
                                  <div className="flex flex-wrap gap-x-3 gap-y-0.5 text-[10px]">
                                    <span><span className="text-sky-400">●</span> <span className="text-slate-500">Principal</span> <span className="tabular-nums text-slate-300 font-semibold">{fmtIdr(princIdr)}</span> <span className="text-sky-400 font-semibold">({pctBase.toFixed(1)}%)</span></span>
                                    {feesIdr   > 0 && <span><span className="text-purple-400">●</span> <span className="text-slate-500">Bank fees</span> <span className="tabular-nums text-slate-300 font-semibold">{fmtIdr(feesIdr)}</span> <span className="text-purple-400 font-semibold">(+{pctFees.toFixed(1)}%)</span></span>}
                                    {landedIdr > 0 && <span><span className="text-orange-400">●</span> <span className="text-slate-500">Landed</span> <span className="tabular-nums text-slate-300 font-semibold">{fmtIdr(landedIdr)}</span> <span className="text-orange-400 font-semibold">(+{pctLanded.toFixed(1)}%)</span></span>}
                                  </div>
                                </>
                              )}
                            </div>
                          );
                        })()}
                      </div>
                    )}

                    {/* FX variance */}
                    {hasFxVariance && (
                      <div className={`rounded-lg px-3 py-2 text-xs flex items-center gap-3 flex-wrap ${
                        fxVariance > 0
                          ? 'bg-red-500/10 border border-red-500/20'
                          : 'bg-emerald-500/10 border border-emerald-500/20'
                      }`}>
                        <div>
                          <p className="text-[10px] font-semibold uppercase tracking-widest text-slate-500 mb-0.5">
                            FX {fxVariance > 0 ? 'Loss' : 'Gain'}
                          </p>
                          <p className={`font-bold tabular-nums ${fxVariance > 0 ? 'text-red-300' : 'text-emerald-300'}`}>
                            {fxVariance > 0 ? '+' : ''}{fmtIdr(fxVariance)}
                          </p>
                        </div>
                        <div className="text-slate-500 text-[11px]">
                          <p>PO rate: <span className="tabular-nums text-slate-400">{Number(po.exchange_rate).toLocaleString()}</span></p>
                          <p>Effective paid rate: <span className="tabular-nums text-slate-400">
                            {(() => {
                              const fxPaid = princPay.filter((c) => c.currency !== 'IDR' && c.exchange_rate != null);
                              if (fxPaid.length === 0) return '—';
                              const totalForeign = fxPaid.reduce((s, c) => s + Number(c.amount), 0);
                              const totalIdrPaid = fxPaid.reduce((s, c) => s + Number(c.amount) * (Number(c.exchange_rate) || 0), 0);
                              return totalForeign > 0 ? (totalIdrPaid / totalForeign).toLocaleString(undefined, { maximumFractionDigits: 0 }) : '—';
                            })()}
                          </span></p>
                        </div>
                      </div>
                    )}

                    {/* PO status selector */}
                    {onPoStatusChange && (
                      <div className="space-y-2">
                        <div className="flex items-center gap-1.5">
                          <select
                            value={po.status ?? ''}
                            disabled={updatingPo === pKey}
                            onClick={(e) => e.stopPropagation()}
                            onChange={async (e) => {
                              e.stopPropagation();
                              const newStatus = e.target.value;
                              if (newStatus === 'Fully Received') {
                                // Intercept — ask for received date first
                                setPendingReceived({ poId: pKey, date: new Date().toISOString().slice(0, 10) });
                                return;
                              }
                              setUpdatingPo(pKey);
                              try {
                                await onPoStatusChange(pKey, newStatus);
                                if (newStatus === 'Partially Received') setReceivePrompt(pKey);
                              } finally { setUpdatingPo(null); }
                            }}
                            className={`flex-1 text-[11px] font-semibold rounded-lg px-2 py-1 border bg-slate-900 focus:outline-none focus:ring-1 focus:ring-emerald-500/40 cursor-pointer disabled:opacity-60 ${poBadge(po.status)}`}
                          >
                            {PO_STATUSES.map((s) => (
                              <option key={s} value={s} className="bg-canvas text-slate-200">{s}</option>
                            ))}
                          </select>
                          {updatingPo === pKey && <span className="text-[10px] text-slate-500 animate-pulse">saving…</span>}
                          {onRevisePo && po.po_number && po.status !== 'Cancelled' && po.status !== 'Replaced' && (
                            <button type="button" onClick={(e) => { e.stopPropagation(); onRevisePo(String(po.po_id)); }}
                              className="text-[11px] font-semibold text-violet-300 hover:text-violet-200 px-2 py-1 rounded-lg border border-violet-500/30 hover:border-violet-500/50 hover:bg-violet-500/10 transition-colors whitespace-nowrap"
                              title="Load this PO into New Deal — amend it, split lines into a new PO, or supersede it">
                              Revise →
                            </button>
                          )}
                          {onDeletePo && poDeletable(po) && (
                            confirmDelete === `po:${pKey}` ? (
                              <span className="inline-flex items-center gap-1.5 text-[11px]" onClick={(e) => e.stopPropagation()}>
                                <span className="text-red-300">Delete {po.po_number || 'this PO'}?</span>
                                <button type="button" disabled={busyDelete}
                                  onClick={async () => { setBusyDelete(true); try { await onDeletePo(String(po.po_id)); } finally { setBusyDelete(false); setConfirmDelete(null); } }}
                                  className="font-bold text-white bg-red-600 hover:bg-red-500 px-2 py-1 rounded-lg disabled:opacity-50">{busyDelete ? 'Deleting…' : 'Yes, delete'}</button>
                                <button type="button" onClick={(e) => { e.stopPropagation(); setConfirmDelete(null); }} className="text-slate-400 hover:text-slate-200 px-1.5 py-1">Cancel</button>
                              </span>
                            ) : (
                              <button type="button" onClick={(e) => { e.stopPropagation(); setConfirmDelete(`po:${pKey}`); }}
                                className="text-[11px] font-semibold text-red-300/80 hover:text-red-300 px-2 py-1 rounded-lg border border-red-500/25 hover:border-red-500/40 hover:bg-red-500/10 transition-colors whitespace-nowrap"
                                title="Permanently delete this PO and its line items">
                                Delete
                              </button>
                            )
                          )}
                        </div>

                        {/* Received date picker — shown when intercepting "Fully Received" for this PO */}
                        {pendingReceived?.poId === pKey && (
                          <div className="rounded-xl border border-emerald-500/30 bg-emerald-500/5 px-3 py-2.5 space-y-2" onClick={(e) => e.stopPropagation()}>
                            <p className="text-[11px] font-semibold text-emerald-300">When was this received?</p>
                            <input
                              type="date"
                              value={pendingReceived.date}
                              onChange={(e) => setPendingReceived((p) => p && { ...p, date: e.target.value })}
                              className="w-full px-2 py-1.5 bg-slate-950 border border-slate-700 rounded-lg text-xs text-white focus:outline-none focus:border-sky-500"
                            />
                            <div className="flex gap-2">
                              <button
                                onClick={() => setPendingReceived(null)}
                                className="flex-1 py-1.5 text-[11px] text-slate-400 bg-slate-800 border border-slate-700 rounded-lg hover:bg-slate-700 transition-all"
                              >Cancel</button>
                              <button
                                disabled={!pendingReceived.date || updatingPo === pKey}
                                onClick={async () => {
                                  if (!pendingReceived.date) return;
                                  setUpdatingPo(pKey);
                                  try {
                                    await onPoStatusChange(pKey, 'Fully Received');
                                    if (onUpdatePo) await onUpdatePo(pKey, { actual_received_date: pendingReceived.date });
                                    setPendingReceived(null);
                                    setReceivePrompt(pKey);
                                  } finally { setUpdatingPo(null); }
                                }}
                                className="flex-1 py-1.5 text-[11px] font-bold text-white bg-emerald-600 hover:bg-emerald-500 rounded-lg transition-all disabled:opacity-40"
                              >{updatingPo === pKey ? 'Saving…' : 'Confirm'}</button>
                            </div>
                          </div>
                        )}

                        {/* The next obvious step, one click away: the status
                            records the FACT of arrival; RECEIVING writes the
                            stock and its landed cost. PO pre-selected. */}
                        {receivePrompt === pKey && (
                          <div className="rounded-xl border border-sky-500/30 bg-sky-500/5 px-3 py-2.5 flex items-center gap-2.5" onClick={(e) => e.stopPropagation()}>
                            <div className="min-w-0 flex-1">
                              <p className="text-[11px] font-semibold text-sky-300">Goods marked received — now book them into stock</p>
                              <p className="text-[10px] text-slate-500 mt-0.5">Receiving writes on-hand and landed cost; until then this PO isn’t in the warehouse.</p>
                            </div>
                            <a href={`/stock/receive?po=${encodeURIComponent(pKey)}`}
                              className="flex-shrink-0 px-2.5 py-1.5 rounded-lg bg-sky-500/15 text-sky-300 ring-1 ring-sky-500/30 hover:bg-sky-500/25 text-[11px] font-bold transition-colors whitespace-nowrap">
                              Receive goods →
                            </a>
                            <button onClick={() => setReceivePrompt(null)} title="Dismiss"
                              className="flex-shrink-0 text-slate-600 hover:text-slate-300 transition-colors text-sm leading-none">×</button>
                          </div>
                        )}
                      </div>
                    )}

                    {/* Mark as Fully Paid — only show when ≥80% paid (final gap close, not mid-payment) */}
                    {onMarkFullyPaid && po.status !== 'Cancelled' && po.status !== 'Replaced' && !isObligationMet && pct >= 80 && (hasForeignTracking ? foreignOut > 0.005 : outIdr > 0) && (
                      <div className="flex items-center gap-2 pt-1">
                        <button
                          disabled={markingPaid === pKey}
                          onClick={async (e) => {
                            e.stopPropagation();
                            setMarkingPaid(pKey);
                            // System derives amount and currency — no user input needed
                            const amount   = hasForeignTracking ? foreignOut : outIdr;
                            const currency = hasForeignTracking ? po.currency : 'IDR';
                            try { await onMarkFullyPaid(pKey, amount, currency); }
                            finally { setMarkingPaid(null); }
                          }}
                          className="flex items-center gap-1.5 px-3 py-1.5 bg-emerald-500/15 hover:bg-emerald-500/25 border border-emerald-500/30 text-emerald-300 text-[11px] font-bold rounded-lg transition-colors disabled:opacity-50"
                        >
                          <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2.5">
                            <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                          </svg>
                          {markingPaid === pKey ? 'Saving…' : 'Mark as Fully Paid'}
                        </button>
                        <span className="text-[10px] text-slate-600 tabular-nums">
                          closes {hasForeignTracking ? `${po.currency} ${foreignOut.toFixed(2)}` : fmtIdr(outIdr)} gap
                        </span>
                      </div>
                    )}

                    {/* PO line items — hidden when side-by-side comparison is shown */}
                    {!hasBoth && (
                      <div className="overflow-x-auto">
                        <table className="w-full text-xs border-collapse">
                          <thead>
                            <tr className="border-b border-slate-700/60">
                              <th className="text-left py-1.5 pr-4 text-[11px] font-semibold uppercase tracking-widest text-slate-400">Component</th>
                              <th className="text-right py-1.5 pr-4 text-[11px] font-semibold uppercase tracking-widest text-slate-400">Qty</th>
                              <th className="text-right py-1.5 text-[11px] font-semibold uppercase tracking-widest text-slate-400">Unit / Total</th>
                              <th className="w-16" />
                            </tr>
                          </thead>
                          <tbody>
                            {items.map((item) => {
                              const comp = components.find((c) => c.component_id === item.component_id);
                              const lineTotal = (Number(item.quantity) || 0) * (Number(item.unit_cost) || 0);
                              const isEditingComp = editingItem?.type === 'po' && editingItem.id === item.po_line_item_id;
                              const isEditingLine = editingLine?.mode === 'edit' && editingLine.type === 'po' && editingLine.id === item.po_line_item_id && editingLine.rowIdx === -1;
                              return (
                                <tr key={item.po_line_item_id} className={`border-b border-slate-800/40 last:border-0 group ${isEditingLine ? 'bg-emerald-500/5' : ''}`}>
                                  {/* Component */}
                                  <td className="py-2 pr-4">
                                    {isEditingComp ? (
                                      <div className="flex items-center gap-1.5">
                                        <div className="flex-1 min-w-0"><ComponentCombobox components={components} onSelect={(cid) => handleReassign('po', item.po_line_item_id, cid)} onCancel={() => setEditingItem(null)} /></div>
                                        {editingSaving && <span className="text-[10px] text-slate-500 flex-shrink-0">saving…</span>}
                                      </div>
                                    ) : isEditingLine && editingLine?.showCompSearch ? (
                                      <ComponentCombobox components={components} onSelect={(cid) => setEditingLine((prev) => prev && { ...prev, componentId: cid, showCompSearch: false })} onCancel={() => setEditingLine((prev) => prev && { ...prev, showCompSearch: false })} />
                                    ) : (
                                      <div className="min-w-0">
                                        <p className="font-semibold text-white leading-tight">
                                          <CopyText text={comp?.supplier_model ?? ''}>{comp?.supplier_model ?? <span className="text-slate-600 italic">unlinked</span>}</CopyText>
                                        </p>
                                        {comp?.internal_description && (
                                          <p className="text-[11px] text-slate-500 mt-0.5 truncate max-w-xs">
                                            <CopyText text={comp.internal_description}>{comp.internal_description}</CopyText>
                                          </p>
                                        )}
                                        {!isEditingLine && (ltPo != null || ltPayment != null) && (
                                          <div className="flex flex-wrap gap-x-3 gap-y-0.5 mt-1">
                                            {ltPo != null && <span className="text-[10px] text-slate-600"><span className="font-semibold text-emerald-500/70 tabular-nums">{ltPo}d</span> PO→rcvd</span>}
                                            {ltQuote != null && <span className="text-[10px] text-slate-600"><span className="font-semibold text-emerald-500/70 tabular-nums">{ltQuote}d</span> quote→rcvd</span>}
                                            {ltPayment != null && <span className="text-[10px] text-slate-600"><span className="font-semibold text-sky-500/70 tabular-nums">{ltPayment}d</span> 1st pay→rcvd</span>}
                                          </div>
                                        )}
                                        {isEditingLine && <button onMouseDown={(e) => { e.preventDefault(); setEditingLine((prev) => prev && { ...prev, showCompSearch: true }); }} className="text-[10px] text-emerald-400 hover:text-emerald-300 transition-colors">change product</button>}
                                      </div>
                                    )}
                                  </td>
                                  {/* Qty */}
                                  <td className="py-2 pr-4 text-right tabular-nums">
                                    {isEditingLine ? (
                                      <input type="number" value={editingLine!.qty} onChange={(e) => setEditingLine((prev) => prev && { ...prev, qty: e.target.value })} onKeyDown={(e) => { if (e.key === 'Escape') setEditingLine(null); if (e.key === 'Enter') handleSaveLine(); }} className="w-16 text-right px-1.5 py-0.5 bg-slate-900 border border-emerald-500/50 rounded text-xs text-white focus:outline-none focus:border-emerald-400" />
                                    ) : <span className="text-slate-300">{Number(item.quantity).toLocaleString()}</span>}
                                  </td>
                                  {/* Unit / Total */}
                                  <td className="py-2 text-right">
                                    {isEditingLine ? (
                                      <div className="flex items-center justify-end gap-1">
                                        <input type="number" value={editingLine!.price} onChange={(e) => setEditingLine((prev) => prev && { ...prev, price: e.target.value })} onKeyDown={(e) => { if (e.key === 'Escape') setEditingLine(null); if (e.key === 'Enter') handleSaveLine(); }} className="w-20 text-right px-1.5 py-0.5 bg-slate-900 border border-emerald-500/50 rounded text-xs text-white focus:outline-none focus:border-emerald-400" />
                                        <button onMouseDown={(e) => { e.preventDefault(); handleSaveLine(); }} disabled={editingLine!.saving} title="Save" className="text-emerald-400 hover:text-emerald-300 disabled:opacity-40 p-0.5"><svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2.5"><path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7"/></svg></button>
                                        <button onMouseDown={(e) => { e.preventDefault(); setEditingLine(null); }} title="Cancel" className="text-slate-500 hover:text-slate-300 p-0.5"><svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2.5"><path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12"/></svg></button>
                                      </div>
                                    ) : (
                                      <div>
                                        <p className="text-slate-300 tabular-nums">{fmtCcy(Number(item.unit_cost), item.currency)}</p>
                                        <p className="font-semibold text-white tabular-nums">{fmtCcy(lineTotal, item.currency)}</p>
                                      </div>
                                    )}
                                  </td>
                                  {/* Actions column */}
                                  <td className="py-2 pl-2 text-right">
                                    {!isEditingLine && !isEditingComp && (
                                      <div className="opacity-0 group-hover:opacity-100 flex items-center justify-end gap-0.5 transition-opacity">
                                        {onUpdatePoItem && (
                                          <button onClick={() => setEditingItem({ type: 'po', id: item.po_line_item_id })} title="Re-assign product" className="p-1 text-slate-500 hover:text-blue-400 hover:bg-blue-500/10 rounded transition-all"><svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2"><path strokeLinecap="round" strokeLinejoin="round" d="M8 7h12m0 0l-4-4m4 4l-4 4m0 6H4m0 0l4 4m-4-4l4-4"/></svg></button>
                                        )}
                                        {onUpdatePoLineItem && (
                                          <button onMouseDown={(e) => { e.preventDefault(); setEditingLine({ mode: 'edit', type: 'po', id: item.po_line_item_id, rowIdx: -1, targetId: 0, currency: item.currency, componentId: item.component_id ?? null, showCompSearch: false, qty: String(item.quantity), price: String(item.unit_cost), saving: false }); }} title="Edit qty & price" className="p-1 text-slate-500 hover:text-emerald-400 hover:bg-emerald-500/10 rounded transition-all"><svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2"><path strokeLinecap="round" strokeLinejoin="round" d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z"/></svg></button>
                                        )}
                                        {onDeletePoLineItem && (
                                          <button onClick={async (e) => { e.stopPropagation(); if (!window.confirm('Delete this PO line item?')) return; await onDeletePoLineItem(item.po_line_item_id); }} title="Delete" className="p-1 text-slate-500 hover:text-red-400 hover:bg-red-500/10 rounded transition-all"><svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2"><path strokeLinecap="round" strokeLinejoin="round" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"/></svg></button>
                                        )}
                                      </div>
                                    )}
                                  </td>
                                </tr>
                              );
                            })}
                            {/* New PO item row */}
                            {editingLine?.mode === 'add' && editingLine.type === 'po' && editingLine.rowIdx === -2 && (() => {
                              const displayComp = editingLine.componentId ? components.find((c) => c.component_id === editingLine.componentId) : null;
                              return (
                                <tr className="border-b border-slate-800/40 bg-emerald-500/5">
                                  <td className="py-2 pr-4">
                                    {editingLine.showCompSearch ? (
                                      <ComponentCombobox components={components} onSelect={(cid) => setEditingLine((prev) => prev && { ...prev, componentId: cid, showCompSearch: false })} onCancel={() => setEditingLine((prev) => prev && { ...prev, showCompSearch: false })} />
                                    ) : (
                                      <button className="text-left w-full" onMouseDown={(e) => { e.preventDefault(); setEditingLine((prev) => prev && { ...prev, showCompSearch: true }); }}>
                                        {displayComp ? (
                                          <div><p className="font-semibold text-white leading-tight">{displayComp.supplier_model}</p>{displayComp.internal_description && <p className="text-[11px] text-slate-500 truncate">{displayComp.internal_description}</p>}</div>
                                        ) : <span className="text-slate-500 italic text-xs">Select product…</span>}
                                      </button>
                                    )}
                                  </td>
                                  <td className="py-2 pr-4 text-right"><input type="number" value={editingLine.qty} onChange={(e) => setEditingLine((prev) => prev && { ...prev, qty: e.target.value })} onKeyDown={(e) => { if (e.key === 'Escape') setEditingLine(null); if (e.key === 'Enter') handleSaveLine(); }} placeholder="Qty" className="w-16 text-right px-1.5 py-0.5 bg-slate-900 border border-emerald-500/50 rounded text-xs text-white focus:outline-none focus:border-emerald-400" /></td>
                                  <td className="py-2 text-right">
                                    <div className="flex items-center justify-end gap-1">
                                      <input type="number" value={editingLine.price} onChange={(e) => setEditingLine((prev) => prev && { ...prev, price: e.target.value })} onKeyDown={(e) => { if (e.key === 'Escape') setEditingLine(null); if (e.key === 'Enter') handleSaveLine(); }} placeholder="Unit cost" className="w-20 text-right px-1.5 py-0.5 bg-slate-900 border border-emerald-500/50 rounded text-xs text-white focus:outline-none focus:border-emerald-400" />
                                      <button onMouseDown={(e) => { e.preventDefault(); handleSaveLine(); }} disabled={editingLine.saving} title="Save" className="text-emerald-400 hover:text-emerald-300 disabled:opacity-40 p-0.5"><svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2.5"><path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7"/></svg></button>
                                      <button onMouseDown={(e) => { e.preventDefault(); setEditingLine(null); }} title="Cancel" className="text-slate-500 hover:text-slate-300 p-0.5"><svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2.5"><path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12"/></svg></button>
                                    </div>
                                  </td>
                                  <td />
                                </tr>
                              );
                            })()}
                          </tbody>
                        </table>
                        {!editingLine && onAddPoLineItem && (
                          <div className="mt-2">
                            <button onMouseDown={(e) => { e.preventDefault(); setEditingLine({ mode: 'add', type: 'po', id: 0, rowIdx: -2, targetId: po.po_id, currency: po.currency, componentId: null, showCompSearch: true, qty: '', price: '', saving: false }); }} className="flex items-center gap-1.5 text-[11px] font-semibold text-emerald-400 hover:text-emerald-300 px-2 py-1 bg-emerald-500/10 hover:bg-emerald-500/20 border border-emerald-500/20 rounded-lg transition-colors">
                              <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2.5"><path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4"/></svg>
                              Add item
                            </button>
                          </div>
                        )}
                      </div>
                    )}

                    {/* ── Mismatch detection — hidden when comparison table is shown ── */}
                    {!hasBoth && (() => {
                      if (!po.quote_id) return null;
                      const ackKey = String(po.po_id);
                      if (acknowledgedMismatches.has(ackKey)) return null;
                      const mismatches = detectMismatches(po.quote_id, po.po_id, quoteItems, poItems, components);
                      if (mismatches.length === 0) return null;
                      const iconFor = (t: MismatchType) => ({
                        duplicate_in_quote: '⚠',
                        qty_diff:           '↕',
                        only_in_quote:      '←',
                        only_in_po:         '→',
                      }[t]);
                      return (
                        <div className="mt-3 p-3 bg-amber-500/8 border border-amber-500/30 rounded-xl">
                          <div className="flex items-start justify-between gap-3 mb-2">
                            <p className="text-[11px] font-bold text-amber-400 uppercase tracking-wider flex items-center gap-1.5">
                              <svg className="w-3.5 h-3.5 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2.5"><path strokeLinecap="round" strokeLinejoin="round" d="M12 9v2m0 4h.01M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z"/></svg>
                              {mismatches.length} mismatch{mismatches.length !== 1 ? 'es' : ''} vs linked quote
                            </p>
                            <button
                              onClick={() => acknowledgeMismatch(ackKey)}
                              className="text-[10px] text-slate-500 hover:text-slate-300 border border-slate-700 hover:border-slate-500 px-2 py-0.5 rounded transition-colors flex-shrink-0"
                            >
                              Dismiss
                            </button>
                          </div>
                          <div className="space-y-1.5">
                            {mismatches.map((m, i) => (
                              <div key={i} className="flex items-start gap-2">
                                <span className="text-[11px] text-amber-500/80 flex-shrink-0 w-4 text-center font-bold">{iconFor(m.type)}</span>
                                <div className="min-w-0">
                                  <span className="text-[11px] font-semibold text-white">{m.componentName}</span>
                                  <span className="text-[11px] text-slate-400 ml-1.5">{m.detail}</span>
                                </div>
                              </div>
                            ))}
                          </div>
                          <p className="text-[10px] text-slate-600 mt-2.5">Check component associations in the quote or PO line items if this is unintentional.</p>
                        </div>
                      );
                    })()}

                    {/* PO costs */}
                    {[
                      { label: 'Principal Payments', rows: princ,   dim: false },
                      { label: 'Bank Fees',          rows: fees,    dim: false },
                      { label: 'Landed Costs',       rows: landed,  dim: false },
                      { label: 'Taxes (excl. TUC)',  rows: taxes,   dim: true  },
                    ].map(({ label, rows, dim }) => rows.length === 0 ? null : (
                      <div key={label}>
                        <p className={`text-[10px] font-semibold uppercase tracking-widest mb-1 ${dim ? 'text-slate-600' : 'text-slate-500'}`}>{label}</p>
                        {rows.map((c) => {
                          const rowIdr = toIdrLocal(c);
                          return (
                            <div key={c.cost_id} className={`flex justify-between gap-3 text-xs py-1 border-b border-slate-800/30 last:border-0 ${dim ? 'opacity-50' : ''}`}>
                              <span className="text-slate-400 capitalize min-w-0 break-words">{c.cost_category.replace(/_/g, ' ')}{c.notes ? ` · ${c.notes}` : ''}</span>
                              <span className="text-right flex-shrink-0">
                                <span className="text-white font-semibold tabular-nums">{fmtCcy(Number(c.amount), c.currency)}</span>
                                {c.currency !== 'IDR' && (
                                  <span className="block text-[10px] text-slate-500 tabular-nums">= {fmtIdr(rowIdr)}</span>
                                )}
                              </span>
                            </div>
                          );
                        })}
                        {/* Section subtotal (IDR) */}
                        {rows.length > 1 && (
                          <div className="flex justify-between text-[10px] pt-1 text-slate-500">
                            <span className="uppercase tracking-widest">Subtotal</span>
                            <span className="tabular-nums font-semibold">{fmtIdr(rows.reduce((s, c) => s + toIdrLocal(c), 0))}</span>
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                );
              })}
            </div>
          </div>
        )}
        </div>

        {/* ── Side-by-side line item comparison ── */}
        {hasBoth && g.quotes.map((qt) => {
          const linkedPOs = g.pos.filter((p) => String(p.quote_id) === String(qt.quote_id));
          if (linkedPOs.length === 0) return null;
          return linkedPOs.map((po) => {
            const qItems = quoteItems.filter((i) => String(i.quote_id) === String(qt.quote_id));
            const pItems = poItems.filter((i) => String(i.po_id) === String(po.po_id));

            // Build matched rows — one row per quote line item so duplicates are visible.
            // PO items are greedily matched to the first unmatched quote row with the same
            // component_id; remaining PO items become standalone "PO only" rows.
            type CmpRow = { cid: string | null; q?: typeof qItems[0]; p?: typeof pItems[0] };
            const rows: CmpRow[] = qItems.map((q) => ({ cid: q.component_id ?? null, q }));
            const matchedIdx = new Set<number>();
            pItems.forEach((pi) => {
              if (pi.component_id) {
                const idx = rows.findIndex((r, i) => r.cid === pi.component_id && !matchedIdx.has(i) && !r.p);
                if (idx >= 0) { rows[idx] = { ...rows[idx], p: pi }; matchedIdx.add(idx); return; }
              }
              rows.push({ cid: pi.component_id ?? null, p: pi });
            });

            // Which OTHER active PO of this deal carries a given component —
            // so a line that is on a sibling PO reads "on EB.42278" instead of
            // the misleading "quote only" (it IS ordered, just on another PO).
            const siblingPos = g.pos.filter((p) => String(p.po_id) !== String(po.po_id) && p.status !== 'Cancelled' && p.status !== 'Replaced');
            const compOnSibling = (cid: string | null): string | null => {
              if (!cid) return null;
              for (const sp of siblingPos) {
                if (poItems.some((i) => String(i.po_id) === String(sp.po_id) && i.component_id === cid)) return sp.po_number || `PO ${sp.po_id}`;
              }
              return null;
            };

            return (
              <div key={`cmp-${qt.quote_id}-${po.po_id}`} className="mt-4 pt-3 border-t border-slate-700/40">
                {/* Each PO's line items sit in their OWN clearly-labelled
                    section, so a quote split across POs shows which items went
                    on which PO. */}
                <div className="flex flex-wrap items-center gap-2 mb-2">
                  <span className="text-[11px] font-semibold uppercase tracking-widest text-slate-400">Line Items</span>
                  <span className="inline-flex items-center px-1.5 py-0.5 rounded-md bg-white/10 text-white text-[11px] font-mono font-semibold leading-none">{po.po_number || `PO ${po.po_id}`}</span>
                  {po.po_date && <span className="text-[10px] text-slate-500 tabular-nums">{fmtDate(po.po_date)}</span>}
                  {po.status && <span className={`text-[10px] font-medium ${poColor(po.status)}`}>{t(po.status)}</span>}
                  {g.pos.length > 1 && <span className="text-[10px] text-slate-600">· 1 of {g.pos.length} POs on this quote</span>}
                </div>
                <div className="overflow-x-auto">
                  {/* w-full on Component makes it absorb all slack, so on a wide
                      monitor the four number columns cluster tight on the right
                      instead of drifting apart; each number column is a fixed
                      width so Q and PO line up cleanly. */}
                  <table className="w-full min-w-[620px] max-w-[1000px] text-xs border-collapse table-fixed">
                    <thead>
                      <tr className="border-b border-slate-700/40">
                        <th className="w-full text-left py-1.5 pr-3 text-[10px] font-semibold uppercase tracking-widest text-slate-500">Component</th>
                        <th className="w-24 text-right py-1.5 px-3 text-[10px] font-semibold uppercase tracking-widest text-sky-400/70">Q Qty</th>
                        <th className="w-28 text-right py-1.5 px-3 text-[10px] font-semibold uppercase tracking-widest text-sky-400/70 border-r border-slate-700/50">Q Price</th>
                        <th className="w-24 text-right py-1.5 px-3 text-[10px] font-semibold uppercase tracking-widest text-emerald-400/70">PO Qty</th>
                        <th className="w-28 text-right py-1.5 px-3 text-[10px] font-semibold uppercase tracking-widest text-emerald-400/70">PO Price</th>
                        {/* Actions live in their OWN fixed column so the number
                            columns stay flush-right and perfectly aligned. */}
                        <th className="w-16" aria-label="Actions" />
                      </tr>
                    </thead>
                    <tbody>
                      {rows.map((row, idx) => {
                        const comp = row.cid ? components.find((c) => c.component_id === row.cid) : null;
                        const qtyDiff   = !!(row.q && row.p && Number(row.q.quantity)   !== Number(row.p.quantity));
                        const priceDiff = !!(row.q && row.p && Number(row.q.unit_price) !== Number(row.p.unit_cost));
                        const onlyQ = !!(row.q && !row.p);
                        const onlyP = !!(!row.q && row.p);
                        // A "quote only" line that is actually on ANOTHER PO of
                        // this deal isn't missing — it belongs to that PO.
                        const onSibling = onlyQ ? compOnSibling(row.cid) : null;
                        const pricePct = priceDiff && row.q && row.p && Number(row.q.unit_price) > 0
                          ? ((Number(row.p.unit_cost) - Number(row.q.unit_price)) / Number(row.q.unit_price)) * 100 : null;

                        const lineEditQ = !!(editingLine?.mode === 'edit' && editingLine.type === 'quote' && row.q && editingLine.id === row.q.quote_line_id);
                        const lineEditP = !!(editingLine?.mode === 'edit' && editingLine.type === 'po'    && row.p && editingLine.id === row.p.po_line_item_id);
                        const addingP   = !!(editingLine?.mode === 'add'  && editingLine.type === 'po'    && editingLine.rowIdx === idx);
                        const addingQ   = !!(editingLine?.mode === 'add'  && editingLine.type === 'quote' && editingLine.rowIdx === idx);
                        const activeEdit = lineEditQ || lineEditP || addingP || addingQ;

                        // Resolved display name (may be overridden by in-progress edit)
                        const displayComp = (lineEditQ || lineEditP || addingP || addingQ) && editingLine?.componentId
                          ? components.find((c) => c.component_id === editingLine.componentId) ?? comp
                          : comp;

                        return (
                          <tr
                            key={idx}
                            className={`border-b border-slate-800/40 last:border-0 group ${
                              activeEdit ? 'bg-blue-500/5' :
                              onSibling ? 'opacity-45' :                     // ordered on another PO — dim, not flagged
                              onlyQ ? 'bg-sky-500/5' : onlyP ? 'bg-emerald-500/5' :
                              (qtyDiff || priceDiff) ? 'bg-amber-500/5' : ''
                            }`}
                          >
                            {/* ── Component cell (column flexes; content truncates) ── */}
                            <td className="py-2 pr-3">
                              {(lineEditQ || lineEditP || addingP || addingQ) && editingLine?.showCompSearch ? (
                                <div className="flex items-center gap-1">
                                  <span className={`text-[9px] font-bold flex-shrink-0 ${(lineEditQ || addingQ) ? 'text-sky-400' : 'text-emerald-400'}`}>
                                    {(lineEditQ || addingQ) ? 'Q' : 'PO'}
                                  </span>
                                  <div className="flex-1 min-w-0">
                                    <ComponentCombobox
                                      components={components}
                                      onSelect={(cid) => setEditingLine((prev) => prev && { ...prev, componentId: cid, showCompSearch: false })}
                                      onCancel={() => setEditingLine((prev) => prev && { ...prev, showCompSearch: false })}
                                    />
                                  </div>
                                </div>
                              ) : (
                                <div className="min-w-0">
                                  <p className="font-semibold text-white leading-tight truncate">
                                    <CopyText text={displayComp?.supplier_model ?? row.q?.supplier_description ?? row.p?.supplier_description ?? ''}>
                                      {displayComp?.supplier_model ?? (row.q?.supplier_description ?? row.p?.supplier_description ?? <span className="italic text-slate-600">unlinked</span>)}
                                    </CopyText>
                                  </p>
                                  {displayComp?.internal_description && (
                                    <p className="text-[11px] text-slate-500 mt-0.5 truncate">
                                      <CopyText text={displayComp.internal_description}>{displayComp.internal_description}</CopyText>
                                    </p>
                                  )}
                                  {(onlyQ || onlyP) && !activeEdit && (
                                    onSibling ? (
                                      <span className="text-[10px] font-semibold text-slate-500">on {onSibling}</span>
                                    ) : (
                                      <span className={`text-[10px] font-semibold ${onlyQ ? 'text-sky-400' : 'text-emerald-400'}`}>
                                        {onlyQ ? '← quote only' : '→ PO only'}
                                      </span>
                                    )
                                  )}
                                  {activeEdit && (
                                    <button
                                      onMouseDown={(e) => { e.preventDefault(); setEditingLine((prev) => prev && { ...prev, showCompSearch: true }); }}
                                      className="text-[10px] text-blue-400 hover:text-blue-300 transition-colors"
                                    >
                                      change item
                                    </button>
                                  )}
                                </div>
                              )}
                            </td>

                            {/* ── Q Qty ── */}
                            <td className="py-2 px-3 text-right tabular-nums whitespace-nowrap">
                              {(lineEditQ || addingQ) ? (
                                <input
                                  type="number"
                                  value={editingLine!.qty}
                                  onChange={(e) => setEditingLine((prev) => prev && { ...prev, qty: e.target.value })}
                                  onKeyDown={(e) => { if (e.key === 'Escape') setEditingLine(null); if (e.key === 'Enter') handleSaveLine(); }}
                                  className="w-16 text-right px-1.5 py-0.5 bg-slate-900 border border-sky-500/50 rounded text-xs text-white focus:outline-none focus:border-sky-400"
                                />
                              ) : (
                                <span className={!row.q ? 'text-slate-700' : qtyDiff ? 'text-amber-400 font-semibold' : (lineEditP || addingP) ? 'text-slate-600' : 'text-slate-400'}>
                                  {row.q ? Number(row.q.quantity).toLocaleString() : '—'}
                                </span>
                              )}
                            </td>

                            {/* ── Q Price + Q pencil ── */}
                            <td className="py-2 px-3 text-right tabular-nums whitespace-nowrap border-r border-slate-700/50">
                              {(lineEditQ || addingQ) ? (
                                <div className="flex items-center justify-end gap-1">
                                  <input
                                    type="number"
                                    value={editingLine!.price}
                                    onChange={(e) => setEditingLine((prev) => prev && { ...prev, price: e.target.value })} onKeyDown={(e) => { if (e.key === 'Escape') setEditingLine(null); if (e.key === 'Enter') handleSaveLine(); }}
                                    className="w-20 text-right px-1.5 py-0.5 bg-slate-900 border border-sky-500/50 rounded text-xs text-white focus:outline-none focus:border-sky-400"
                                  />
                                  <button
                                    onMouseDown={(e) => { e.preventDefault(); handleSaveLine(); }}
                                    disabled={editingLine!.saving}
                                    title="Save"
                                    className="text-emerald-400 hover:text-emerald-300 disabled:opacity-40 p-0.5"
                                  >
                                    <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2.5"><path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7"/></svg>
                                  </button>
                                  <button
                                    onMouseDown={(e) => { e.preventDefault(); setEditingLine(null); }}
                                    title="Cancel"
                                    className="text-slate-500 hover:text-slate-300 p-0.5"
                                  >
                                    <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2.5"><path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12"/></svg>
                                  </button>
                                </div>
                              ) : (
                                <span className={!row.q ? 'text-slate-700' : priceDiff ? 'text-amber-400 font-semibold' : (lineEditP || addingP) ? 'text-slate-600' : 'text-slate-400'}>
                                  {row.q ? fmtCcy(Number(row.q.unit_price), row.q.currency) : '—'}
                                </span>
                              )}
                            </td>

                            {/* ── PO Qty ── */}
                            <td className="py-2 px-3 text-right tabular-nums whitespace-nowrap">
                              {(lineEditP || addingP) ? (
                                <input
                                  type="number"
                                  value={editingLine!.qty}
                                  onChange={(e) => setEditingLine((prev) => prev && { ...prev, qty: e.target.value })}
                                  onKeyDown={(e) => { if (e.key === 'Escape') setEditingLine(null); if (e.key === 'Enter') handleSaveLine(); }}
                                  className="w-16 text-right px-1.5 py-0.5 bg-slate-900 border border-emerald-500/50 rounded text-xs text-white focus:outline-none focus:border-emerald-400"
                                />
                              ) : (
                                <span className={!row.p ? 'text-slate-700' : qtyDiff ? 'text-amber-400 font-semibold' : (lineEditQ || addingQ) ? 'text-slate-600' : 'text-slate-400'}>
                                  {row.p
                                    ? <>{Number(row.p.quantity).toLocaleString()}{qtyDiff && row.q && <span className="text-[10px] text-amber-500/70 ml-1">({Number(row.p.quantity) - Number(row.q.quantity) > 0 ? '+' : ''}{(Number(row.p.quantity) - Number(row.q.quantity)).toLocaleString()})</span>}</>
                                    : '—'
                                  }
                                </span>
                              )}
                            </td>

                            {/* ── PO Price ── */}
                            <td className="py-2 px-3 text-right tabular-nums whitespace-nowrap">
                              {(lineEditP || addingP) ? (
                                <div className="flex items-center justify-end gap-1">
                                  <input
                                    type="number"
                                    value={editingLine!.price}
                                    onChange={(e) => setEditingLine((prev) => prev && { ...prev, price: e.target.value })} onKeyDown={(e) => { if (e.key === 'Escape') setEditingLine(null); if (e.key === 'Enter') handleSaveLine(); }}
                                    className="w-20 text-right px-1.5 py-0.5 bg-slate-900 border border-emerald-500/50 rounded text-xs text-white focus:outline-none focus:border-emerald-400"
                                  />
                                  <button
                                    onMouseDown={(e) => { e.preventDefault(); handleSaveLine(); }}
                                    disabled={editingLine!.saving}
                                    title="Save"
                                    className="text-emerald-400 hover:text-emerald-300 disabled:opacity-40 p-0.5"
                                  >
                                    <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2.5"><path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7"/></svg>
                                  </button>
                                  <button
                                    onMouseDown={(e) => { e.preventDefault(); setEditingLine(null); }}
                                    title="Cancel"
                                    className="text-slate-500 hover:text-slate-300 p-0.5"
                                  >
                                    <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2.5"><path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12"/></svg>
                                  </button>
                                </div>
                              ) : (
                                <span className={!row.p ? 'text-slate-700' : priceDiff ? 'text-amber-400 font-semibold' : (lineEditQ || addingQ) ? 'text-slate-600' : 'text-slate-400'}>
                                  {row.p
                                    ? <>{fmtCcy(Number(row.p.unit_cost), row.p.currency)}{pricePct !== null && <span className={`text-[10px] ml-1 ${pricePct > 0 ? 'text-red-400' : 'text-emerald-400'}`}>({pricePct > 0 ? '+' : ''}{pricePct.toFixed(1)}%)</span>}</>
                                    : '—'
                                  }
                                </span>
                              )}
                            </td>

                            {/* ── Row actions — their OWN column, so nothing shifts
                                   the Q/PO number columns out of alignment. Icons
                                   reveal on row hover. ── */}
                            <td className="py-2 pl-2 align-middle">
                              {!activeEdit && (
                                <div className="flex items-center justify-end gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
                                  {row.q && onUpdateQuoteLineItem && (
                                    <button type="button" title="Edit quote line"
                                      className="flex-shrink-0 p-0.5 text-sky-500 hover:text-sky-300 hover:bg-sky-500/10 rounded transition-colors"
                                      onMouseDown={(e) => { e.preventDefault(); setEditingLine({ mode: 'edit', type: 'quote', id: row.q!.quote_line_id, rowIdx: idx, targetId: 0, currency: '', componentId: null, showCompSearch: false, qty: String(row.q!.quantity), price: String(row.q!.unit_price), saving: false }); }}>
                                      <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2"><path strokeLinecap="round" strokeLinejoin="round" d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z"/></svg>
                                    </button>
                                  )}
                                  {row.p && onUpdatePoLineItem && (
                                    <button type="button" title="Edit PO line"
                                      className="flex-shrink-0 p-0.5 text-emerald-500 hover:text-emerald-300 hover:bg-emerald-500/10 rounded transition-colors"
                                      onMouseDown={(e) => { e.preventDefault(); setEditingLine({ mode: 'edit', type: 'po', id: row.p!.po_line_item_id, rowIdx: idx, targetId: 0, currency: '', componentId: null, showCompSearch: false, qty: String(row.p!.quantity), price: String(row.p!.unit_cost), saving: false }); }}>
                                      <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2"><path strokeLinecap="round" strokeLinejoin="round" d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z"/></svg>
                                    </button>
                                  )}
                                  {row.q && onDeleteQuoteLineItem && onlyQ && (
                                    <button type="button" title="Delete quote line"
                                      className="flex-shrink-0 p-0.5 text-red-700 hover:text-red-400 hover:bg-red-500/10 rounded transition-colors"
                                      onClick={async (e) => { e.stopPropagation(); if (!window.confirm('Delete this quote line item?')) return; await onDeleteQuoteLineItem(row.q!.quote_line_id); }}>
                                      <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2"><path strokeLinecap="round" strokeLinejoin="round" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"/></svg>
                                    </button>
                                  )}
                                  {row.p && onDeletePoLineItem && onlyP && (
                                    <button type="button" title="Delete PO line"
                                      className="flex-shrink-0 p-0.5 text-red-700 hover:text-red-400 hover:bg-red-500/10 rounded transition-colors"
                                      onClick={async (e) => { e.stopPropagation(); if (!window.confirm('Delete this PO line item?')) return; await onDeletePoLineItem(row.p!.po_line_item_id); }}>
                                      <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2"><path strokeLinecap="round" strokeLinejoin="round" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"/></svg>
                                    </button>
                                  )}
                                  {onlyQ && !onSibling && onAddPoLineItem && (
                                    <button type="button" title="Add this item to PO"
                                      className="flex-shrink-0 p-0.5 text-emerald-400 hover:text-emerald-300 hover:bg-emerald-500/15 rounded transition-colors"
                                      onMouseDown={(e) => { e.preventDefault(); setEditingLine({ mode: 'add', type: 'po', id: 0, rowIdx: idx, targetId: po.po_id, currency: po.currency, componentId: row.q!.component_id ?? null, showCompSearch: false, qty: String(row.q!.quantity ?? ''), price: String(row.q!.unit_price ?? ''), saving: false }); }}>
                                      <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2.2"><path strokeLinecap="round" strokeLinejoin="round" d="M12 5v14M5 12h14"/></svg>
                                    </button>
                                  )}
                                  {onlyP && onAddQuoteLineItem && (
                                    <button type="button" title="Add this item to Quote"
                                      className="flex-shrink-0 p-0.5 text-sky-400 hover:text-sky-300 hover:bg-sky-500/15 rounded transition-colors"
                                      onMouseDown={(e) => { e.preventDefault(); setEditingLine({ mode: 'add', type: 'quote', id: 0, rowIdx: idx, targetId: qt.quote_id, currency: qt.currency, componentId: row.p!.component_id ?? null, showCompSearch: false, qty: String(row.p!.quantity ?? ''), price: String(row.p!.unit_cost ?? ''), saving: false }); }}>
                                      <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2.2"><path strokeLinecap="round" strokeLinejoin="round" d="M12 5v14M5 12h14"/></svg>
                                    </button>
                                  )}
                                </div>
                              )}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </div>
            );
          });
        })}
      </div>
    );
  };

  // ── Deal stage → background colors ──────────────────────────────────────

  const STAGE_CLS = {
    quote:      { row: 'border-white/10 hover:bg-white/5',                               open: 'bg-white/5 border-white/15' },
    active:     { row: 'bg-blue-500/5 border-blue-500/10 hover:bg-blue-500/10',          open: 'bg-blue-500/10 border-blue-500/20' },
    received:   { row: 'bg-emerald-500/5 border-emerald-500/10 hover:bg-emerald-500/10', open: 'bg-emerald-500/10 border-emerald-500/15' },
    completed:  { row: 'bg-emerald-500/10 border-emerald-500/15 hover:bg-emerald-500/15', open: 'bg-emerald-500/15 border-emerald-500/25' },
    superseded: { row: 'border-white/5 hover:bg-white/5 opacity-40',                    open: 'bg-white/5 border-white/10 opacity-50' },
  };

  // ── Deal row renderer ─────────────────────────────────────────────────────

  const renderDealRow = (g: DealGroup, showSupplier = true) => {
    const expanded = expandedKey === g.key;
    const paidPct  = g.totalIdr > 0 ? Math.min(100, (g.paidIdr / g.totalIdr) * 100) : 0;

    return (
      <div
        key={g.key}
        className={`rounded-xl border transition-colors ${expanded ? STAGE_CLS[dealStage(g)].open : STAGE_CLS[dealStage(g)].row}`}
      >
        <button
          className="w-full text-left px-3 py-2.5"
          onClick={() => setExpandedKey(expanded ? null : g.key)}
        >
          <div className="flex items-center gap-2 flex-wrap">
            {/* SVG chevron */}
            <svg
              className={`w-3 h-3 text-slate-600 flex-shrink-0 transition-transform duration-150 ${expanded ? 'rotate-90' : ''}`}
              fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2.5"
            >
              <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
            </svg>

            {/* Supplier code badge */}
            {showSupplier && g.supplier?.supplier_code && (
              <span className="inline-block px-1.5 py-0.5 bg-white/10 text-slate-300 text-[10px] font-semibold rounded leading-none flex-shrink-0">
                {g.supplier.supplier_code}
              </span>
            )}

            {/* Title: once a deal reaches PO, the PO NUMBER leads (that is what
                the warehouse and finance quote back); the quote name follows,
                dimmer. Quote-only deals lead with the quote name (there is no
                PO yet — the "Create PO" button sits at the end of the row). */}
            {(() => {
              const activePos = g.pos.filter((p) => p.status !== 'Replaced' && p.status !== 'Cancelled');
              const shownPos = (activePos.length ? activePos : g.pos).map((p) => p.po_number).filter(Boolean) as string[];
              const quoteName = g.piNumber ?? (g.quotes[0] ? `Q#${g.quotes[0].quote_id}` : null);
              if (shownPos.length > 0) {
                // Each PO is its OWN chip, so two POs off one quote read as two
                // separate orders — not a single fused "A · B" label. When the
                // deal carries several, a count leads and the first few show.
                const visible = shownPos.slice(0, 3);
                return (
                  <>
                    {shownPos.length > 1 && (
                      <span className="text-[11px] font-semibold text-slate-400 flex-shrink-0">{shownPos.length} POs</span>
                    )}
                    {visible.map((n) => (
                      <span key={n} className="inline-flex items-center px-1.5 py-0.5 rounded-md bg-white/10 text-white text-[11px] font-mono font-semibold leading-none flex-shrink-0">{n}</span>
                    ))}
                    {shownPos.length > visible.length && (
                      <span className="text-[11px] text-slate-500 flex-shrink-0">+{shownPos.length - visible.length}</span>
                    )}
                    <CopyBtn text={shownPos.join(', ')} />
                    {quoteName && <span className="text-[11px] text-slate-500 truncate max-w-[140px] sm:max-w-[260px]" title={`Quote source: ${quoteName}`}>{quoteName}</span>}
                  </>
                );
              }
              return (
                <>
                  <span className="text-xs font-semibold text-white truncate max-w-[240px] sm:max-w-[360px]" title={quoteName ?? undefined}>{quoteName ?? `PO#${g.key}`}</span>
                  <CopyBtn text={quoteName ?? g.key} />
                </>
              );
            })()}

            {/* Quote status — inline text, no pill */}
            {g.quoteStatus && (
              <span className={`text-[11px] font-medium flex-shrink-0 ${quoteColor(g.quoteStatus)}`}>
                Q · {g.quoteStatus}
              </span>
            )}

            {/* PO status — inline text, no pill */}
            {g.poStatus && (
              <span className={`text-[11px] font-medium flex-shrink-0 ${poColor(g.poStatus)}`}>
                PO · {g.poStatus}
              </span>
            )}

            {/* Mismatch indicator — dismissible */}
            {mismatchGroupIds.has(g.key) && !acknowledgedDealMismatches.has(g.key) && (
              <span className="inline-flex items-center gap-1 px-1.5 py-0.5 bg-amber-500/15 border border-amber-500/30 text-amber-400 text-[10px] font-semibold rounded leading-none flex-shrink-0">
                ⚠ Mismatch
                <button
                  title="Dismiss mismatch warning for this deal"
                  onClick={(e) => { e.stopPropagation(); setAcknowledgedDealMismatches((prev) => new Set([...prev, g.key])); }}
                  className="ml-0.5 opacity-60 hover:opacity-100 hover:text-amber-200 transition-opacity leading-none"
                >
                  ×
                </button>
              </span>
            )}

            {/* No PO: show Create PO button for any quote-only deal */}
            {g.quotes.length > 0 && g.pos.length === 0 && (() => {
              const tq = g.quotes.find((q) => q.status === 'Accepted')
                      ?? g.quotes.find((q) => q.status === 'Open' || !q.status)
                      ?? g.quotes[0];
              return onCreatePO && tq ? (
                <button
                  onMouseDown={(e) => { e.stopPropagation(); onCreatePO(String(tq.quote_id)); }}
                  className="inline-flex items-center gap-1 px-1.5 py-0.5 bg-white/10 text-slate-300 text-[10px] font-semibold rounded leading-none flex-shrink-0 hover:bg-white/15 transition-colors"
                >
                  <span>+</span><span>Create PO</span>
                </button>
              ) : (
                <span className="text-[11px] text-slate-600 flex-shrink-0">No PO</span>
              );
            })()}
          </div>

          {/* Sub-line */}
          <div className="text-[11px] mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-0.5 pl-5 text-slate-500">
            {showSupplier && g.supplier && <span className="text-slate-400">{g.supplier.supplier_name}</span>}
            <span>{fmtDate(g.latestDate)}</span>
            {g.totalIdr > 0 && (
              g.totalForeignCurrency && g.totalForeignAmount > 0 ? (
                <span className="font-medium text-slate-400 tabular-nums">
                  {fmtCcy(g.totalForeignAmount, g.totalForeignCurrency)} = {fmtIdr(g.totalIdr)}
                </span>
              ) : (
                <span className="font-medium text-slate-400 tabular-nums">{fmtIdr(g.totalIdr)}</span>
              )
            )}
          </div>

          {/* Payment bar */}
          {g.totalIdr > 0 && (
            <div className="mt-1.5 flex items-center gap-2 pl-5">
              <div className="flex-1 h-1.5 bg-slate-700/80 rounded-full overflow-hidden">
                <div
                  className={`h-full rounded-full transition-all ${paidPct >= 100 ? 'bg-emerald-500' : paidPct > 0 ? 'bg-amber-400' : 'bg-slate-600'}`}
                  style={{ width: `${paidPct}%` }}
                />
              </div>
              <span className="text-[10px] text-slate-500 flex-shrink-0 tabular-nums">
                {g.outstandingIdr > 0 ? paidPct.toFixed(1) : '100'}% paid
              </span>
              {g.outstandingIdr > 0 && (
                <span className="text-[11px] font-semibold text-amber-400 tabular-nums flex-shrink-0">
                  {fmtIdr(g.outstandingIdr)} out
                </span>
              )}
            </div>
          )}
        </button>

        {/* Expanded detail */}
        {expanded && (
          <div className="px-3 pb-3">
            {renderDetail(g)}
          </div>
        )}
      </div>
    );
  };

  // ── Compact table view ───────────────────────────────────────────────────

  const renderDealTable = (groups: DealGroup[]) => {
    // Header sort overrides the incoming order until cleared by another click
    const STAGE_ORDER = ['quote', 'active', 'received', 'completed', 'superseded'];
    const refOf = (g: DealGroup) => g.piNumber ?? (g.quotes[0] ? `Q#${g.quotes[0].quote_id}` : `PO#${g.pos[0]?.po_number ?? g.key}`);
    const sortedGroups = !colSort ? groups : [...groups].sort((a, b) => {
      let cmp = 0;
      switch (colSort.key) {
        case 'pi':          cmp = refOf(a).localeCompare(refOf(b), undefined, { numeric: true }); break;
        case 'supplier':    cmp = (a.supplier?.supplier_name ?? '').localeCompare(b.supplier?.supplier_name ?? ''); break;
        case 'date':        cmp = (a.latestDate ?? '').localeCompare(b.latestDate ?? ''); break;
        case 'stage':       cmp = STAGE_ORDER.indexOf(dealStage(a)) - STAGE_ORDER.indexOf(dealStage(b)); break;
        case 'total':       cmp = a.totalIdr - b.totalIdr; break;
        case 'paid':        cmp = (a.totalIdr > 0 ? a.paidIdr / a.totalIdr : 0) - (b.totalIdr > 0 ? b.paidIdr / b.totalIdr : 0); break;
        case 'outstanding': cmp = a.outstandingIdr - b.outstandingIdr; break;
      }
      return colSort.dir === 'asc' ? cmp : -cmp;
    });
    return (
    <div className="overflow-x-auto rounded-xl border border-slate-800/80">
      <table className="w-full text-xs border-collapse">
        <thead>
          <tr className="border-b border-slate-700/60 bg-slate-900/80">
            {([
              ['pi', 'PI #', 'text-left'], ['supplier', 'Supplier', 'text-left'], ['date', 'Date', 'text-left'], ['stage', 'Stage', 'text-left'],
              ['total', 'Total', 'text-right'], ['paid', 'Paid', 'text-right'], ['outstanding', 'Outstanding', 'text-right'],
            ] as const).map(([k, label, align]) => (
              <th key={k} className={`py-2 px-3 whitespace-nowrap ${align}`}>
                <button onClick={() => clickCol(k)} title={`Sort by ${label.toLowerCase()} — click again to flip`}
                  className={`inline-flex items-center gap-1 text-[11px] font-semibold uppercase tracking-widest transition-colors ${
                    colSort?.key === k ? 'text-slate-200' : 'text-slate-400 hover:text-slate-300'}`}>
                  {label}
                  <span className={`text-[8px] ${colSort?.key === k ? 'text-emerald-400' : 'text-transparent'}`}>
                    {colSort?.key === k && colSort.dir === 'desc' ? '▼' : '▲'}
                  </span>
                </button>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {sortedGroups.map((g) => {
            const stage   = dealStage(g);
            const expanded = expandedKey === g.key;
            const dealRef = g.piNumber ?? (g.quotes[0] ? `Q#${g.quotes[0].quote_id}` : `PO#${g.pos[0]?.po_number ?? g.key}`);
            const paidPct = g.totalIdr > 0 ? Math.min(100, (g.paidIdr / g.totalIdr) * 100) : 0;
            const stageLabel: Record<string, string> = {
              quote: 'Quote', active: 'Active PO', received: 'Received', completed: 'Completed', superseded: 'Void',
            };
            const stageTxtCls: Record<string, string> = {
              quote: 'text-slate-400', active: 'text-indigo-300', received: 'text-emerald-300', completed: 'text-emerald-400', superseded: 'text-slate-600',
            };
            return (
              <Fragment key={g.key}>
              <tr
                onClick={() => setExpandedKey(expanded ? null : g.key)}
                aria-expanded={expanded}
                className={`border-b border-slate-800/40 last:border-0 cursor-pointer transition-colors hover:bg-slate-800/30 ${
                  expanded ? 'bg-slate-800/40' :
                  stage === 'active'     ? 'bg-indigo-500/5' :
                  stage === 'received'   ? 'bg-emerald-500/5' :
                  stage === 'completed'  ? 'bg-emerald-500/8' :
                  stage === 'superseded' ? 'opacity-40' : ''
                }`}
              >
                <td className="py-2 px-3 font-semibold text-white whitespace-nowrap">
                  <span className="inline-flex items-center gap-1.5">
                    {/* The chevron is what says "this row opens" */}
                    <svg className={`w-3 h-3 text-slate-600 flex-shrink-0 transition-transform duration-150 ${expanded ? 'rotate-90 text-slate-300' : ''}`}
                      fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2.5">
                      <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
                    </svg>
                    {dealRef}
                    {/* Copy the reference without opening the row */}
                    <CopyBtn text={dealRef} />
                    {/* One PO on the deal: copy its number from the list too */}
                    {g.pos.length === 1 && g.pos[0].po_number && g.pos[0].po_number !== dealRef && (
                      <span className="inline-flex items-center gap-0.5 text-[10px] font-normal text-slate-600">
                        <span className="font-mono">{g.pos[0].po_number}</span>
                        <CopyBtn text={g.pos[0].po_number} />
                      </span>
                    )}
                  </span>
                </td>
                <td className="py-2 px-3 whitespace-nowrap">
                  {g.supplier?.supplier_code && (
                    <span className="inline-block px-1.5 py-0.5 bg-sky-500/15 border border-sky-500/30 text-sky-300 text-[10px] font-bold rounded leading-none mr-1.5">
                      {g.supplier.supplier_code}
                    </span>
                  )}
                  <span className="text-slate-400">{g.supplier?.supplier_name ?? '—'}</span>
                </td>
                <td className="py-2 px-3 text-slate-400 whitespace-nowrap tabular-nums">{fmtDate(g.latestDate)}</td>
                <td className="py-2 px-3 whitespace-nowrap">
                  <span className={`text-[10px] font-bold uppercase tracking-wide ${stageTxtCls[stage]}`}>
                    {stageLabel[stage]}
                  </span>
                </td>
                <td className="py-2 px-3 text-right text-slate-300 tabular-nums whitespace-nowrap">
                  {g.totalIdr > 0 ? fmtIdr(g.totalIdr) : '—'}
                </td>
                <td className="py-2 px-3 text-right tabular-nums whitespace-nowrap">
                  <div className="flex items-center justify-end gap-2">
                    {g.totalIdr > 0 && (
                      <div className="w-10 h-1 bg-slate-700 rounded-full overflow-hidden flex-shrink-0">
                        <div
                          className={`h-full rounded-full ${paidPct >= 100 ? 'bg-emerald-500' : 'bg-amber-400'}`}
                          style={{ width: `${paidPct}%` }}
                        />
                      </div>
                    )}
                    <span className="text-emerald-300">{g.paidIdr > 0 ? fmtIdr(g.paidIdr) : '—'}</span>
                  </div>
                </td>
                <td className="py-2 px-3 text-right tabular-nums whitespace-nowrap">
                  {g.outstandingIdr > 0
                    ? <span className="text-amber-300 font-bold">{fmtIdr(g.outstandingIdr)}</span>
                    : <span className="text-slate-600">—</span>}
                </td>
              </tr>
              {expanded && (
                <tr className="border-b border-slate-800/40 bg-slate-950/50">
                  <td colSpan={7} className="px-3 py-3">{renderDetail(g)}</td>
                </tr>
              )}
              </Fragment>
            );
          })}
        </tbody>
      </table>
    </div>
    );
  };

  // ── Left-panel item (vendor or company) ───────────────────────────────────

  const renderLeftItem = (
    id: string, name: string, code: string | undefined,
    dealCount: number, openQuotes: number, outstandingIdr: number,
    totalIdr: number, lastDate: string | undefined, selected: boolean, onClick: () => void,
  ) => {
    const paidIdr   = Math.max(0, totalIdr - outstandingIdr);
    const paidPct   = totalIdr > 0 ? Math.min(100, (paidIdr / totalIdr) * 100) : 0;
    return (
      <button
        key={id}
        onClick={onClick}
        className={`w-full text-left px-3 py-3 rounded-xl transition-colors border ${
          selected
            ? 'bg-white/10 border-white/20 text-white'
            : 'bg-white/5 border-transparent hover:bg-white/10 text-slate-300'
        }`}
      >
        <div className="flex items-center justify-between gap-2 mb-0.5">
          <div className="flex items-center gap-2 min-w-0">
            {code && (
              <span className="inline-block px-1.5 py-0.5 bg-sky-500/15 border border-sky-500/30 text-sky-300 text-[10px] font-bold rounded leading-none flex-shrink-0">
                {code}
              </span>
            )}
            <span className="text-xs font-semibold truncate">{name}</span>
          </div>
          <span className="text-[10px] text-slate-500 flex-shrink-0">{dealCount} deal{dealCount !== 1 ? 's' : ''}</span>
        </div>
        {outstandingIdr > 0 && (
          <p className="text-[11px] font-bold text-amber-300 tabular-nums">{fmtIdr(outstandingIdr)} outstanding</p>
        )}
        {openQuotes > 0 && outstandingIdr === 0 && (
          <p className="text-[11px] text-sky-400 font-semibold">{openQuotes} open quote{openQuotes !== 1 ? 's' : ''}</p>
        )}
        {totalIdr > 0 && (
          <div className="mt-1.5 flex items-center gap-2">
            <div className="flex-1 h-1 bg-slate-700/80 rounded-full overflow-hidden">
              <div
                className={`h-full rounded-full transition-all ${paidPct >= 100 ? 'bg-emerald-500' : paidPct > 0 ? 'bg-amber-400' : 'bg-slate-600'}`}
                style={{ width: `${paidPct}%` }}
              />
            </div>
            <span className="text-[10px] text-slate-600 flex-shrink-0 tabular-nums">{paidPct.toFixed(0)}%</span>
          </div>
        )}
        {lastDate && <p className="text-[10px] text-slate-600 mt-0.5">Last: {fmtDate(lastDate)}</p>}
      </button>
    );
  };

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <div>
      {/* Mode toggle */}
      <div className="flex items-center gap-3 mb-5 flex-wrap">
        <div className="flex rounded-xl overflow-hidden border border-slate-700 text-xs font-semibold">
          {(['all', 'by-vendor', 'by-company'] as const).map((mode) => (
            <button
              key={mode}
              onClick={() => {
                setViewMode(mode);
                setExpandedKey(null);
                setSelectedSuppId(null);
                setSelectedCompId(null);
              }}
              className={`px-4 py-2 transition-colors ${
                viewMode === mode
                  ? 'bg-white/10 text-white'
                  : 'text-slate-500 hover:text-slate-300'
              }`}
            >
              {mode === 'all' ? 'All Deals' : mode === 'by-vendor' ? 'By Vendor' : 'By Company'}
            </button>
          ))}
        </div>
        <p className="text-xs text-slate-500">
          {viewMode === 'all'
            ? `${filtered.length} deal${filtered.length !== 1 ? 's' : ''} shown`
            : viewMode === 'by-vendor'
            ? `${vendorStats.length} vendor${vendorStats.length !== 1 ? 's' : ''}`
            : `${companyStats.length} compan${companyStats.length !== 1 ? 'ies' : 'y'}`}
        </p>
      </div>

      {/* ══ ALL MODE ══ */}
      {viewMode === 'all' && (
        <div>

          {/* ── Portfolio summary bar ── */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 mb-4">
            {[
              { label: 'Open Quotes', value: summary.openQuotes, color: 'text-slate-300' },
              { label: 'Active POs',  value: summary.activePOs,  color: 'text-blue-300'  },
              { label: 'Received',    value: summary.received,   color: 'text-emerald-300' },
              { label: 'Completed',   value: summary.completed,  color: 'text-emerald-400' },
            ].map(({ label, value, color }) => (
              <div key={label} className="rounded-xl p-3 bg-white/5 border border-white/10">
                <p className="text-[10px] font-medium text-slate-500 mb-0.5">{label}</p>
                <p className={`text-xl font-bold tabular-nums ${color}`}>{value}</p>
              </div>
            ))}
          </div>

          {/* ── Outstanding total banner ── */}
          {summary.outstandingTotal > 0 && (
            <div className="mb-4 px-3 py-2 bg-white/5 border border-white/10 rounded-xl flex items-center gap-2">
              <span className="text-[11px] font-medium text-slate-500">Total Outstanding</span>
              <span className="text-sm font-bold text-amber-400 tabular-nums ml-auto">{fmtIdr(summary.outstandingTotal)}</span>
            </div>
          )}

          {/* ── Color legend ── */}
          <div className="flex flex-wrap items-center gap-3 mb-4 text-[11px] text-slate-600">
            {[
              { label: 'Quote',     cls: 'bg-white/15' },
              { label: 'Active PO', cls: 'bg-blue-500/50' },
              { label: 'Received',  cls: 'bg-emerald-500/40' },
              { label: 'Completed', cls: 'bg-emerald-500/70' },
              { label: 'Void',      cls: 'bg-white/10' },
            ].map(({ label, cls }) => (
              <span key={label} className="flex items-center gap-1.5">
                <span className={`inline-block w-2 h-2 rounded-sm ${cls}`} />
                {label}
              </span>
            ))}
          </div>

          {/* ── Controls: filter chips + view toggle ── */}
          <div className="flex flex-wrap items-center gap-2 mb-4">
            <div className="flex flex-wrap gap-1">
              {[
                { key: 'all' as const,        label: `All (${summary.total})` },
                { key: 'quote' as const,      label: `Quotes (${summary.openQuotes})` },
                { key: 'active' as const,     label: `Active (${summary.activePOs})` },
                { key: 'received' as const,   label: `Received (${summary.received})` },
                { key: 'completed' as const,  label: `Done (${summary.completed})` },
                { key: 'superseded' as const, label: `Void (${summary.superseded})` },
              ].map(({ key, label }) => (
                <button
                  key={key}
                  onClick={() => setStageFilter(key)}
                  className={`px-2.5 py-1 rounded-lg text-[11px] font-medium transition-colors border ${
                    stageFilter === key
                      ? 'bg-white/10 text-white border-white/20'
                      : 'text-slate-500 border-transparent hover:text-slate-300 hover:bg-white/5'
                  }`}
                >
                  {label}
                </button>
              ))}
              <DateRangeFilter value={range} onChange={(r) => { rangeTouched.current = true; setRange(r); }} label="Deal date" accent="sky" align="left" />
            </div>
            {mismatchGroupIds.size > 0 && (
              <button
                onClick={() => setFilterMismatch((v) => !v)}
                className={`px-2.5 py-1 rounded-lg text-[11px] font-medium transition-colors border ${
                  filterMismatch
                    ? 'bg-amber-500/20 text-amber-300 border-amber-500/40'
                    : 'text-slate-500 border-transparent hover:text-amber-400 hover:bg-amber-500/10'
                }`}
              >
                ⚠ Mismatch ({mismatchGroupIds.size})
              </button>
            )}
            <span className="flex-1" />
            <LayoutToggle value={layout} onChange={setLayout} accent="sky" />
          </div>

          {/* ── Search ── */}
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search by PI number, supplier code or name…"
            className="w-full max-w-lg px-3 py-2 bg-white/5 border border-white/10 rounded-lg text-sm text-white placeholder-slate-600 focus:outline-none focus:border-white/25 focus:bg-white/8 transition-colors mb-4"
          />

          {/* ── Deal list or table ── */}
          {/* "All" renders in WORK-ORDER SECTIONS: open quotes (decisions) never
              drown between running POs. A stage chip narrows to one bucket, so
              that view stays flat. Column sort applies within each section. */}
          {filtered.length === 0 ? (
            <p className="text-xs text-slate-600 italic py-6 text-center">No deals found</p>
          ) : stageFilter !== 'all' ? (
            tableView ? renderDealTable(filtered) : (
              <div className="space-y-1.5">{filtered.map((g) => renderDealRow(g))}</div>
            )
          ) : (
            <div className="space-y-5">
              {DEAL_SECTIONS.map(({ key, label, accent, hint }) => {
                const rows = filtered.filter((g) => dealSection(g) === key);
                if (!rows.length) return null;
                const out = key === 'process' || key === 'received'
                  ? rows.reduce((s, g) => s + (g.outstandingIdr || 0), 0) : 0;
                return (
                  <div key={key}>
                    <div className="flex items-baseline gap-2 mb-1.5" title={hint}>
                      <span className={`text-[11px] font-bold uppercase tracking-widest ${accent}`}>{label}</span>
                      <span className="text-[10px] text-slate-600 tabular-nums">{rows.length}</span>
                      {out > 0 && (
                        <span className="ml-auto text-[10px] text-slate-500 tabular-nums">outstanding {fmtIdr(out)}</span>
                      )}
                    </div>
                    {tableView ? renderDealTable(rows) : (
                      <div className="space-y-1.5">{rows.map((g) => renderDealRow(g))}</div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* ══ BY VENDOR MODE ══ */}
      {viewMode === 'by-vendor' && (
        <div className="grid grid-cols-1 xl:grid-cols-[340px_1fr] 2xl:grid-cols-[420px_1fr] gap-5 xl:gap-7 items-start">

          {/* Left: vendor list */}
          <div className="bg-white/[0.03] border border-white/10 rounded-2xl p-4">
            <h3 className="text-sm font-bold text-white mb-3">Vendors</h3>
            <div className="space-y-1.5 max-h-[calc(100vh-240px)] xl:max-h-[calc(100vh-200px)] overflow-y-auto pr-0.5">
              {vendorStats.length === 0 && (
                <p className="text-xs text-slate-600 italic px-1 py-4 text-center">No vendors found</p>
              )}
              {vendorStats.map(({ supplier, dealCount, openQuotes, outstandingIdr, totalIdr, lastDate }) => {
                const id = String(supplier.supplier_id);
                return renderLeftItem(
                  id, supplier.supplier_name, supplier.supplier_code,
                  dealCount, openQuotes, outstandingIdr, totalIdr, lastDate,
                  selectedSuppId === id,
                  () => { setSelectedSuppId(selectedSuppId === id ? null : id); setExpandedKey(null); },
                );
              })}
            </div>
          </div>

          {/* Right: deals for selected vendor */}
          <div>
            {!selectedSuppId ? (
              <div className="bg-white/[0.03] border border-white/10 rounded-2xl p-10 flex flex-col items-center justify-center text-center min-h-[260px]">
                <span className="text-4xl mb-3 opacity-40">🏭</span>
                <p className="text-slate-500 text-sm">Select a vendor to view their deals</p>
              </div>
            ) : (() => {
              const stat = vendorStats.find((v) => String(v.supplier.supplier_id) === selectedSuppId);
              if (!stat) return null;
              const totalOut = vendorGroups.reduce((s, g) => s + g.outstandingIdr, 0);
              const totalVal = vendorGroups.reduce((s, g) => s + g.totalIdr, 0);
              return (
                <div className="space-y-4">
                  {/* Vendor header */}
                  <div className="bg-white/[0.03] border border-white/10 rounded-2xl p-5">
                    <div className="flex items-start justify-between gap-3 flex-wrap mb-4">
                      <div>
                        {stat.supplier.supplier_code && (
                          <span className="inline-block px-2 py-1 bg-sky-500/15 border border-sky-500/30 text-sky-300 text-xs font-bold rounded mb-2">
                            {stat.supplier.supplier_code}
                          </span>
                        )}
                        <h2 className="text-xl font-bold text-white">{stat.supplier.supplier_name}</h2>
                        {stat.supplier.location && (
                          <p className="text-sm text-slate-400 mt-0.5">{stat.supplier.location}</p>
                        )}
                      </div>
                      <span className="text-xs text-slate-500">{stat.dealCount} deal{stat.dealCount !== 1 ? 's' : ''}</span>
                    </div>
                    {totalVal > 0 && (
                      <div className="grid grid-cols-3 gap-3">
                        <div className="bg-slate-800/40 rounded-xl p-3">
                          <p className="text-[10px] font-semibold uppercase tracking-widest text-slate-400 mb-1">Total Ordered</p>
                          <p className="font-bold text-white tabular-nums">{fmtIdr(totalVal)}</p>
                        </div>
                        <div className="bg-emerald-500/10 border border-emerald-500/20 rounded-xl p-3">
                          <p className="text-[10px] font-semibold uppercase tracking-widest text-slate-400 mb-1">Paid</p>
                          <p className="font-bold text-emerald-300 tabular-nums">{fmtIdr(totalVal - totalOut)}</p>
                        </div>
                        <div className={`rounded-xl p-3 ${totalOut > 0 ? 'bg-amber-500/10 border border-amber-500/20' : 'bg-slate-800/40'}`}>
                          <p className="text-[10px] font-semibold uppercase tracking-widest text-slate-400 mb-1">Outstanding</p>
                          <p className={`font-bold tabular-nums ${totalOut > 0 ? 'text-amber-300' : 'text-slate-400'}`}>{fmtIdr(totalOut)}</p>
                        </div>
                      </div>
                    )}
                  </div>
                  {/* Deal list */}
                  <div className="bg-white/[0.03] border border-white/10 rounded-2xl p-4">
                    <h4 className="text-[11px] font-semibold uppercase tracking-widest text-slate-400 mb-3">Deals</h4>
                    {vendorGroups.length === 0 ? (
                      <p className="text-xs text-slate-600 italic py-4 text-center">No deals for this vendor</p>
                    ) : (
                      <div className="space-y-1.5">
                        {vendorGroups.map((g) => renderDealRow(g, false))}
                      </div>
                    )}
                  </div>
                </div>
              );
            })()}
          </div>
        </div>
      )}

      {/* ══ BY COMPANY MODE ══ */}
      {viewMode === 'by-company' && (
        <div className="grid grid-cols-1 xl:grid-cols-[340px_1fr] 2xl:grid-cols-[420px_1fr] gap-5 xl:gap-7 items-start">

          {/* Left: company list */}
          <div className="bg-white/[0.03] border border-white/10 rounded-2xl p-4">
            <h3 className="text-sm font-bold text-white mb-3">Companies</h3>
            <div className="space-y-1.5 max-h-[calc(100vh-240px)] xl:max-h-[calc(100vh-200px)] overflow-y-auto pr-0.5">
              {companyStats.length === 0 && (
                <p className="text-xs text-slate-600 italic px-1 py-4 text-center">No companies found</p>
              )}
              {companyStats.map(({ company, dealCount, openQuotes }) => {
                const id = String(company.company_id);
                return renderLeftItem(
                  id, company.legal_name, undefined,
                  dealCount, openQuotes, 0, 0, undefined,
                  selectedCompId === id,
                  () => { setSelectedCompId(selectedCompId === id ? null : id); setExpandedKey(null); },
                );
              })}
            </div>
          </div>

          {/* Right: deals for selected company */}
          <div>
            {!selectedCompId ? (
              <div className="bg-white/[0.03] border border-white/10 rounded-2xl p-10 flex flex-col items-center justify-center text-center min-h-[260px]">
                <span className="text-4xl mb-3 opacity-40">🏢</span>
                <p className="text-slate-500 text-sm">Select a company to view addressed deals</p>
              </div>
            ) : (() => {
              const stat = companyStats.find((c) => String(c.company.company_id) === selectedCompId);
              if (!stat) return null;
              return (
                <div className="space-y-4">
                  {/* Company header */}
                  <div className="bg-white/[0.03] border border-white/10 rounded-2xl p-5">
                    <div className="flex items-start justify-between gap-3 flex-wrap">
                      <h2 className="text-xl font-bold text-white">{stat.company.legal_name}</h2>
                      <div className="text-right text-xs text-slate-400">
                        <p>{stat.dealCount} deal{stat.dealCount !== 1 ? 's' : ''}</p>
                        {stat.openQuotes > 0 && (
                          <p className="text-sky-400 font-semibold">{stat.openQuotes} open quote{stat.openQuotes !== 1 ? 's' : ''}</p>
                        )}
                      </div>
                    </div>
                  </div>
                  {/* Deal list */}
                  <div className="bg-white/[0.03] border border-white/10 rounded-2xl p-4">
                    <h4 className="text-[11px] font-semibold uppercase tracking-widest text-slate-400 mb-3">Deals</h4>
                    {companyGroups.length === 0 ? (
                      <p className="text-xs text-slate-600 italic py-4 text-center">No deals for this company</p>
                    ) : (
                      <div className="space-y-1.5">
                        {companyGroups.map((g) => renderDealRow(g))}
                      </div>
                    )}
                  </div>
                </div>
              );
            })()}
          </div>
        </div>
      )}
    </div>
  );
}
