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
import { useState, useMemo, useRef, useEffect } from 'react';
import { createPortal } from 'react-dom';
import type {
  PriceQuote, PriceQuoteLineItem,
  PurchaseOrder, PurchaseLineItem, POCost,
  Supplier, Company, Component,
} from '@/types/database';
import { buildDealGroups, type DealGroup } from '@/lib/dealGroups';
import { PRINCIPAL_CATS, BANK_FEE_CATS, TAX_CATS } from '@/constants/costCategories';
import { fmtIdr, fmtCcy, fmtDate } from '@/lib/formatters';

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
        className="w-full px-2 py-1 bg-slate-900 border border-blue-500/50 rounded text-xs text-white focus:outline-none focus:border-blue-400 placeholder-slate-600"
      />
      {open && typeof document !== 'undefined' && createPortal(
        <div style={dropStyle} className="bg-[#0D1424] border border-white/10 rounded-xl shadow-2xl overflow-hidden">
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

// ── Deal stage (module-level so useMemos can reference it) ────────────────────

function dealStage(g: DealGroup): 'quote' | 'active' | 'received' | 'completed' | 'superseded' {
  if (g.pos.length === 0) return 'quote';
  if (g.poStatus === 'Cancelled' || g.poStatus === 'Replaced') return 'superseded';
  if (g.poStatus === 'Fully Received') {
    return (g.totalIdr > 0 && g.outstandingIdr === 0) ? 'completed' : 'received';
  }
  return 'active';
}

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
  onMarkFullyPaid?: (poId: string, amount: number, currency: string) => Promise<void>;
  onCreatePO?: (quoteId: string) => void;
  onUpdateQuoteItem?: (quoteLineId: number, componentId: string) => Promise<void>;
  onUpdatePoItem?: (poItemId: number, componentId: string) => Promise<void>;
}

// ── Main ──────────────────────────────────────────────────────────────────────

export default function DealLookupTab({
  quotes, quoteItems, pos, poItems, poCosts,
  suppliers, companies, components,
  onQuoteStatusChange, onPoStatusChange, onUpdatePo, onMarkFullyPaid, onCreatePO,
  onUpdateQuoteItem, onUpdatePoItem,
}: Props) {

  const [viewMode, setViewMode]               = useState<'all' | 'by-vendor' | 'by-company'>('all');
  const [search, setSearch]                   = useState('');
  const [stageFilter, setStageFilter]         = useState<'all' | 'quote' | 'active' | 'received' | 'completed' | 'superseded'>('all');
  const [tableView, setTableView]             = useState(false);
  const [expandedKey, setExpandedKey]         = useState<string | null>(null);
  const [selectedSuppId, setSelectedSuppId]   = useState<string | null>(null);
  const [selectedCompId, setSelectedCompId]   = useState<string | null>(null);
  const [updatingQuote, setUpdatingQuote]     = useState<string | null>(null);
  const [updatingPo, setUpdatingPo]           = useState<string | null>(null);
  const [markingPaid, setMarkingPaid]         = useState<string | null>(null);
  // Intercept "Fully Received" to capture received date before saving
  const [pendingReceived, setPendingReceived] = useState<{ poId: string; date: string } | null>(null);
  const [editingReceivedId, setEditingReceivedId] = useState<string | null>(null);
  const [editingReceivedDate, setEditingReceivedDate] = useState('');
  const [acknowledgedMismatches, setAcknowledgedMismatches] = useState<Set<string>>(new Set());
  const acknowledgeMismatch = (key: string) => setAcknowledgedMismatches((prev) => new Set([...prev, key]));
  const [editingItem, setEditingItem] = useState<{ type: 'quote' | 'po'; id: number } | null>(null);
  const [editingSaving, setEditingSaving] = useState(false);

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

  // ── All-mode filtered list (respects stageFilter) ─────────────────────────
  const filtered = useMemo(() => {
    const q = search.toLowerCase().trim();
    const base = stageFilter === 'all' ? allGroups : allGroups.filter((g) => dealStage(g) === stageFilter);
    if (!q) return base.slice(0, 80);
    return base.filter((g) => {
      const code = g.supplier?.supplier_code?.toLowerCase() ?? '';
      const name = g.supplier?.supplier_name?.toLowerCase() ?? '';
      const pi   = (g.piNumber ?? '').toLowerCase();
      return pi.includes(q) || code.includes(q) || name.includes(q);
    });
  }, [allGroups, search, stageFilter]);

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

    return (
      <div className="mt-3 pt-3 border-t border-slate-700/40 space-y-5">

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
                return (
                  <div key={qKey} className="bg-white/5 border border-white/10 rounded-xl p-3 space-y-2.5">
                    {/* Quote meta */}
                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-xs">
                      {[
                        { label: 'Date',      value: qt.quote_date },
                        { label: 'Supplier',  value: sup?.supplier_name },
                        { label: 'Currency',  value: qt.currency },
                        { label: 'Lead Time', value: qt.estimated_lead_time_days },
                        { label: 'To',        value: co?.legal_name },
                        { label: 'Total',     value: qt.total_value != null ? fmtCcy(Number(qt.total_value), qt.currency) : null },
                      ].map(({ label, value }) => value ? (
                        <div key={label}>
                          <p className="text-[10px] font-semibold uppercase tracking-widest text-slate-500">{label}</p>
                          <p className="text-slate-300 mt-0.5">{value}</p>
                        </div>
                      ) : null)}
                    </div>

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
                            <option key={s} value={s} className="bg-[#0B1120] text-slate-200">{s}</option>
                          ))}
                        </select>
                        {updatingQuote === qKey && <span className="text-[10px] text-slate-500 animate-pulse">saving…</span>}
                      </div>
                    )}

                    {/* Quote line items */}
                    {items.length > 0 && (
                      <div className="overflow-x-auto">
                        <table className="w-full text-xs border-collapse">
                          <thead>
                            <tr className="border-b border-slate-700/60">
                              <th className="text-left py-1.5 pr-4 text-[11px] font-semibold uppercase tracking-widest text-slate-400">Component</th>
                              <th className="text-right py-1.5 pr-4 text-[11px] font-semibold uppercase tracking-widest text-slate-400">Qty</th>
                              <th className="text-right py-1.5 text-[11px] font-semibold uppercase tracking-widest text-slate-400">Unit / Total</th>
                            </tr>
                          </thead>
                          <tbody>
                            {items.map((item) => {
                              const comp = components.find((c) => c.component_id === item.component_id);
                              const lineTotal = (Number(item.quantity) || 0) * (Number(item.unit_price) || 0);
                              const isEditing = editingItem?.type === 'quote' && editingItem.id === item.quote_line_id;
                              return (
                                <tr key={item.quote_line_id} className="border-b border-slate-800/40 last:border-0 group">
                                  <td className="py-2 pr-4">
                                    {isEditing ? (
                                      <div className="flex items-center gap-1.5">
                                        <div className="flex-1 min-w-0">
                                          <ComponentCombobox
                                            components={components}
                                            onSelect={(cid) => handleReassign('quote', item.quote_line_id, cid)}
                                            onCancel={() => setEditingItem(null)}
                                          />
                                        </div>
                                        {editingSaving && <span className="text-[10px] text-slate-500 flex-shrink-0">saving…</span>}
                                      </div>
                                    ) : (
                                      <div className="flex items-start gap-1.5">
                                        <div className="min-w-0">
                                          <p className="font-semibold text-white leading-tight">{comp?.supplier_model ?? <span className="text-slate-600 italic">unlinked</span>}</p>
                                          {comp?.internal_description && (
                                            <p className="text-[11px] text-slate-500 mt-0.5 truncate max-w-xs">{comp.internal_description}</p>
                                          )}
                                        </div>
                                        {onUpdateQuoteItem && (
                                          <button
                                            onClick={() => setEditingItem({ type: 'quote', id: item.quote_line_id })}
                                            title="Re-assign component"
                                            className="opacity-0 group-hover:opacity-100 flex-shrink-0 mt-0.5 p-0.5 text-slate-600 hover:text-blue-400 transition-all"
                                          >
                                            <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2"><path strokeLinecap="round" strokeLinejoin="round" d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z"/></svg>
                                          </button>
                                        )}
                                      </div>
                                    )}
                                  </td>
                                  <td className="py-2 pr-4 text-right text-slate-300 tabular-nums">{Number(item.quantity).toLocaleString()}</td>
                                  <td className="py-2 text-right">
                                    <p className="text-slate-300 tabular-nums">{fmtCcy(Number(item.unit_price), item.currency)}</p>
                                    <p className="font-semibold text-white tabular-nums">{fmtCcy(lineTotal, item.currency)}</p>
                                  </td>
                                </tr>
                              );
                            })}
                          </tbody>
                        </table>
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

                return (
                  <div key={pKey} className="bg-white/5 border border-white/10 rounded-xl p-3 space-y-2.5">
                    {/* PO meta */}
                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-xs">
                      {po.po_number && (
                        <div key="PO #">
                          <p className="text-[10px] font-medium text-slate-500 uppercase tracking-wider">PO #</p>
                          <div className="flex items-center gap-1 mt-0.5">
                            <p className="text-slate-300">{po.po_number}</p>
                            <CopyBtn text={po.po_number} />
                          </div>
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
                              className="text-emerald-300 mt-0.5 text-xs hover:text-emerald-200 hover:underline text-left"
                              title="Click to edit received date"
                            >
                              {po.actual_received_date ?? <span className="text-slate-600 italic">Set date…</span>}
                            </button>
                          )}
                        </div>
                      )}
                    </div>

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
                                <p className={`text-sm font-bold tabular-nums ${days != null && days >= 0 ? 'text-emerald-300' : 'text-slate-600'}`}>
                                  {fmt(days)}
                                </p>
                                <p className="text-[10px] text-slate-500 mt-0.5 leading-tight">{label}</p>
                              </div>
                            ))}
                          </div>
                        </div>
                      );
                    })()}

                    {/* PO value */}
                    {po.total_value && (
                      <div className="flex items-center gap-3 text-xs flex-wrap">
                        <span className="font-semibold text-white tabular-nums">{fmtCcy(Number(po.total_value), po.currency)}</span>
                        {po.currency !== 'IDR' && po.exchange_rate && (
                          <span className="text-slate-500 tabular-nums">
                            @ {Number(po.exchange_rate).toLocaleString()} = {fmtIdr(tIdr)}
                          </span>
                        )}
                      </div>
                    )}

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
                        <div className="grid grid-cols-3 gap-2">
                          <div className="bg-white/5 border border-white/10 rounded-lg p-2">
                            <p className="text-[10px] font-medium text-slate-500 mb-0.5">PO Committed</p>
                            <p className="text-xs font-bold text-white tabular-nums">{fmtIdr(tIdr)}</p>
                            {isObligationMet && hasForeignTracking && paidIdr !== tIdr && (
                              <p className={`text-[10px] tabular-nums mt-0.5 ${paidIdr < tIdr ? 'text-emerald-400' : 'text-red-400'}`}>
                                {paidIdr < tIdr ? 'FX gain' : 'FX loss'}
                              </p>
                            )}
                          </div>
                          <div className="bg-white/5 border border-white/10 rounded-lg p-2">
                            <p className="text-[10px] font-medium text-slate-500 mb-0.5">Principal Paid</p>
                            <p className="text-xs font-bold text-emerald-400 tabular-nums">{fmtIdr(paidIdr)}</p>
                            {totalCashOutExclTaxIdr > paidIdr && (
                              <p className="text-[10px] text-slate-600 tabular-nums mt-0.5">+{fmtIdr(totalCashOutExclTaxIdr - paidIdr)} fees/landed</p>
                            )}
                          </div>
                          <div className="bg-white/5 border border-white/10 rounded-lg p-2">
                            <p className="text-[10px] font-medium text-slate-500 mb-0.5">Outstanding</p>
                            <p className={`text-xs font-bold tabular-nums ${outIdr > 0 ? 'text-amber-400' : 'text-emerald-400'}`}>
                              {outIdr > 0 ? fmtIdr(outIdr) : '✓ Settled'}
                            </p>
                          </div>
                        </div>
                        {/* Total spend row */}
                        {totalCashOutIdr > 0 && (
                          <div className="mt-2 pt-2 border-t border-slate-700/40 flex items-center gap-3 flex-wrap text-[11px]">
                            <span className="text-slate-500 font-semibold uppercase tracking-widest">Total Spend</span>
                            <span className="font-bold text-slate-200 tabular-nums">{fmtIdr(totalCashOutExclTaxIdr)}</span>
                            <span className="text-slate-600">excl. tax</span>
                            {totalCashOutIdr !== totalCashOutExclTaxIdr && (
                              <span className="text-slate-600 tabular-nums">({fmtIdr(totalCashOutIdr)} incl. tax)</span>
                            )}
                            <span className="text-slate-700">= principal + fees + landed</span>
                          </div>
                        )}
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
                              try { await onPoStatusChange(pKey, newStatus); } finally { setUpdatingPo(null); }
                            }}
                            className={`flex-1 text-[11px] font-semibold rounded-lg px-2 py-1 border bg-slate-900 focus:outline-none focus:ring-1 focus:ring-emerald-500/40 cursor-pointer disabled:opacity-60 ${poBadge(po.status)}`}
                          >
                            {PO_STATUSES.map((s) => (
                              <option key={s} value={s} className="bg-[#0B1120] text-slate-200">{s}</option>
                            ))}
                          </select>
                          {updatingPo === pKey && <span className="text-[10px] text-slate-500 animate-pulse">saving…</span>}
                        </div>

                        {/* Received date picker — shown when intercepting "Fully Received" for this PO */}
                        {pendingReceived?.poId === pKey && (
                          <div className="rounded-xl border border-emerald-500/30 bg-emerald-500/5 px-3 py-2.5 space-y-2" onClick={(e) => e.stopPropagation()}>
                            <p className="text-[11px] font-semibold text-emerald-300">When was this received?</p>
                            <input
                              type="date"
                              value={pendingReceived.date}
                              onChange={(e) => setPendingReceived((p) => p && { ...p, date: e.target.value })}
                              className="w-full px-2 py-1.5 bg-slate-950 border border-slate-700 rounded-lg text-xs text-white focus:outline-none focus:border-emerald-500"
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
                                  } finally { setUpdatingPo(null); }
                                }}
                                className="flex-1 py-1.5 text-[11px] font-bold text-white bg-emerald-600 hover:bg-emerald-500 rounded-lg transition-all disabled:opacity-40"
                              >{updatingPo === pKey ? 'Saving…' : 'Confirm'}</button>
                            </div>
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

                    {/* PO line items */}
                    {items.length > 0 && (
                      <div className="overflow-x-auto">
                        <table className="w-full text-xs border-collapse">
                          <thead>
                            <tr className="border-b border-slate-700/60">
                              <th className="text-left py-1.5 pr-4 text-[11px] font-semibold uppercase tracking-widest text-slate-400">Component</th>
                              <th className="text-right py-1.5 pr-4 text-[11px] font-semibold uppercase tracking-widest text-slate-400">Qty</th>
                              <th className="text-right py-1.5 text-[11px] font-semibold uppercase tracking-widest text-slate-400">Unit / Total</th>
                            </tr>
                          </thead>
                          <tbody>
                            {items.map((item) => {
                              const comp = components.find((c) => c.component_id === item.component_id);
                              const lineTotal = (Number(item.quantity) || 0) * (Number(item.unit_cost) || 0);
                              const isEditingPo = editingItem?.type === 'po' && editingItem.id === item.po_item_id;
                              return (
                                <tr key={item.po_item_id} className="border-b border-slate-800/40 last:border-0 group">
                                  <td className="py-2 pr-4">
                                    {isEditingPo ? (
                                      <div className="flex items-center gap-1.5">
                                        <div className="flex-1 min-w-0">
                                          <ComponentCombobox
                                            components={components}
                                            onSelect={(cid) => handleReassign('po', item.po_item_id, cid)}
                                            onCancel={() => setEditingItem(null)}
                                          />
                                        </div>
                                        {editingSaving && <span className="text-[10px] text-slate-500 flex-shrink-0">saving…</span>}
                                      </div>
                                    ) : (
                                      <div className="flex items-start gap-1.5">
                                        <div className="min-w-0">
                                          <p className="font-semibold text-white leading-tight">{comp?.supplier_model ?? <span className="text-slate-600 italic">unlinked</span>}</p>
                                          {comp?.internal_description && (
                                            <p className="text-[11px] text-slate-500 mt-0.5 truncate max-w-xs">{comp.internal_description}</p>
                                          )}
                                          {/* Lead time reference */}
                                          {(ltPo != null || ltPayment != null) && (
                                            <div className="flex flex-wrap gap-x-3 gap-y-0.5 mt-1">
                                              {ltPo != null && <span className="text-[10px] text-slate-600"><span className="font-semibold text-emerald-500/70 tabular-nums">{ltPo}d</span> PO→rcvd</span>}
                                              {ltQuote != null && <span className="text-[10px] text-slate-600"><span className="font-semibold text-emerald-500/70 tabular-nums">{ltQuote}d</span> quote→rcvd</span>}
                                              {ltPayment != null && <span className="text-[10px] text-slate-600"><span className="font-semibold text-sky-500/70 tabular-nums">{ltPayment}d</span> 1st pay→rcvd</span>}
                                            </div>
                                          )}
                                        </div>
                                        {onUpdatePoItem && (
                                          <button
                                            onClick={() => setEditingItem({ type: 'po', id: item.po_item_id })}
                                            title="Re-assign component"
                                            className="opacity-0 group-hover:opacity-100 flex-shrink-0 mt-0.5 p-0.5 text-slate-600 hover:text-blue-400 transition-all"
                                          >
                                            <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2"><path strokeLinecap="round" strokeLinejoin="round" d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z"/></svg>
                                          </button>
                                        )}
                                      </div>
                                    )}
                                  </td>
                                  <td className="py-2 pr-4 text-right text-slate-300 tabular-nums">{Number(item.quantity).toLocaleString()}</td>
                                  <td className="py-2 text-right">
                                    <p className="text-slate-300 tabular-nums">{fmtCcy(Number(item.unit_cost), item.currency)}</p>
                                    <p className="font-semibold text-white tabular-nums">{fmtCcy(lineTotal, item.currency)}</p>
                                  </td>
                                </tr>
                              );
                            })}
                          </tbody>
                        </table>
                      </div>
                    )}

                    {/* ── Mismatch detection ── */}
                    {(() => {
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
                            <div key={c.cost_id} className={`flex justify-between text-xs py-1 border-b border-slate-800/30 last:border-0 ${dim ? 'opacity-50' : ''}`}>
                              <span className="text-slate-400 capitalize">{c.cost_category.replace(/_/g, ' ')}{c.notes ? ` · ${c.notes}` : ''}</span>
                              <span className="text-right flex-shrink-0 ml-3">
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

            {/* PI number or fallback + copy */}
            <span className="text-xs font-semibold text-white">
              {g.piNumber ?? (g.quotes[0] ? `Q#${g.quotes[0].quote_id}` : `PO#${g.pos[0]?.po_number ?? g.key}`)}
            </span>
            <CopyBtn text={g.piNumber ?? g.pos[0]?.po_number ?? g.key} />

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

  const renderDealTable = (groups: DealGroup[]) => (
    <div className="overflow-x-auto rounded-xl border border-slate-800/80">
      <table className="w-full text-xs border-collapse">
        <thead>
          <tr className="border-b border-slate-700/60 bg-slate-900/80">
            <th className="text-left py-2 px-3 text-[11px] font-semibold uppercase tracking-widest text-slate-400 whitespace-nowrap">PI #</th>
            <th className="text-left py-2 px-3 text-[11px] font-semibold uppercase tracking-widest text-slate-400 whitespace-nowrap">Supplier</th>
            <th className="text-left py-2 px-3 text-[11px] font-semibold uppercase tracking-widest text-slate-400 whitespace-nowrap">Date</th>
            <th className="text-left py-2 px-3 text-[11px] font-semibold uppercase tracking-widest text-slate-400 whitespace-nowrap">Stage</th>
            <th className="text-right py-2 px-3 text-[11px] font-semibold uppercase tracking-widest text-slate-400 whitespace-nowrap">Total</th>
            <th className="text-right py-2 px-3 text-[11px] font-semibold uppercase tracking-widest text-slate-400 whitespace-nowrap">Paid</th>
            <th className="text-right py-2 px-3 text-[11px] font-semibold uppercase tracking-widest text-slate-400 whitespace-nowrap">Outstanding</th>
          </tr>
        </thead>
        <tbody>
          {groups.map((g) => {
            const stage   = dealStage(g);
            const paidPct = g.totalIdr > 0 ? Math.min(100, (g.paidIdr / g.totalIdr) * 100) : 0;
            const stageLabel: Record<string, string> = {
              quote: 'Quote', active: 'Active PO', received: 'Received', completed: 'Completed', superseded: 'Void',
            };
            const stageTxtCls: Record<string, string> = {
              quote: 'text-slate-400', active: 'text-indigo-300', received: 'text-emerald-300', completed: 'text-emerald-400', superseded: 'text-slate-600',
            };
            return (
              <tr
                key={g.key}
                onClick={() => setExpandedKey(expandedKey === g.key ? null : g.key)}
                className={`border-b border-slate-800/40 last:border-0 cursor-pointer transition-colors hover:bg-slate-800/30 ${
                  stage === 'active'     ? 'bg-indigo-500/5' :
                  stage === 'received'   ? 'bg-emerald-500/5' :
                  stage === 'completed'  ? 'bg-emerald-500/8' :
                  stage === 'superseded' ? 'opacity-40' : ''
                }`}
              >
                <td className="py-2 px-3 font-semibold text-white whitespace-nowrap">
                  {g.piNumber ?? (g.quotes[0] ? `Q#${g.quotes[0].quote_id}` : `PO#${g.pos[0]?.po_number ?? g.key}`)}
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
            );
          })}
        </tbody>
      </table>
    </div>
  );

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
            </div>
            <span className="flex-1" />
            {/* Table / card toggle */}
            <button
              onClick={() => setTableView(!tableView)}
              title={tableView ? 'Card view' : 'Table view'}
              className={`p-1.5 rounded-lg border transition-colors ${
                tableView
                  ? 'bg-white/10 border-white/20 text-white'
                  : 'border-white/10 text-slate-500 hover:text-slate-300 hover:bg-white/5'
              }`}
            >
              {tableView ? (
                <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
                  <rect x="3" y="3" width="7" height="7" rx="1" /><rect x="14" y="3" width="7" height="7" rx="1" />
                  <rect x="3" y="14" width="7" height="7" rx="1" /><rect x="14" y="14" width="7" height="7" rx="1" />
                </svg>
              ) : (
                <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M3 10h18M3 14h18M10 3v18" />
                </svg>
              )}
            </button>
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
          {filtered.length === 0 ? (
            <p className="text-xs text-slate-600 italic py-6 text-center">No deals found</p>
          ) : tableView ? (
            renderDealTable(filtered)
          ) : (
            <div className="space-y-1.5">
              {filtered.map((g) => renderDealRow(g))}
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
