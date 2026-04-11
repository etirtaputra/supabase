/**
 * Component Editor
 * Inline bulk editor for components with search, filter, sort, and before/after diff.
 */
'use client';

import React, { useState, useMemo, useRef, useEffect, useLayoutEffect, useCallback } from 'react';
import { useWindowVirtualizer } from '@tanstack/react-virtual';
import { createPortal } from 'react-dom';
import { Spinner } from './LoadingSkeleton';
import SpecRenderer from './SpecRenderer';
import type { Component, PriceQuoteLineItem, PriceQuote, PurchaseOrder, PurchaseLineItem } from '../../types/database';
import { ENUMS } from '../../constants/enums';

interface ComponentUsage {
  quoteCount: number;
  lineItemCount: number;
  piNumbers: string[];
  poNumbers: string[];
}

interface ComponentEditorProps {
  components: Component[];
  brandSuggestions: string[];
  quoteItems?: PriceQuoteLineItem[];
  quotes?: PriceQuote[];
  pos?: PurchaseOrder[];
  poItems?: PurchaseLineItem[];
  onSave: (updates: { component_id: string; changes: Partial<Component> }[]) => Promise<void>;
  onAdd?: (fields: Omit<Component, 'component_id' | 'created_at' | 'updated_at'>) => Promise<void>;
  onAddSupplier?: () => void;
  onDelete?: (component_id: string) => Promise<void>;
  onSaveLineItem?: (item: Omit<PriceQuoteLineItem, 'quote_line_id' | 'created_at' | 'updated_at'> & { quote_line_id?: number }) => Promise<void>;
  onDeleteLineItem?: (quote_line_id: number) => Promise<void>;
}

type SortCol = 'supplier_model' | 'internal_description' | 'brand' | 'category' | 'updated_at' | 'quoteCount' | 'lineItemCount';
// Key components by their string ID to avoid Number(key)=NaN edge cases
type PendingEdits = Record<string, Partial<Component>>;

// ── Active filter chip ─────────────────────────────────────────────────────────
function ActiveChip({ label, value, onClear }: { label: string; value?: string; onClear: () => void }) {
  return (
    <span className="inline-flex items-center gap-1 pl-2 pr-1 py-0.5 text-[11px] bg-white/5 border border-white/10 text-slate-300 rounded-full">
      <span className="text-slate-500">{label}{value ? ':' : ''}</span>
      {value && <span className="font-medium truncate max-w-[120px]">{value}</span>}
      <button
        onMouseDown={onClear}
        className="ml-0.5 w-4 h-4 flex items-center justify-center rounded-full hover:bg-white/15 text-slate-500 hover:text-white transition-colors flex-shrink-0"
      >
        <svg className="w-2.5 h-2.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="3">
          <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
        </svg>
      </button>
    </span>
  );
}

// ── Copy button ─────────────────────────────────────────────────────────────────
function CopyBtn({ text }: { text: string | null | undefined }) {
  const [copied, setCopied] = React.useState(false);
  if (!text) return null;
  return (
    <button
      onClick={(e) => { e.stopPropagation(); navigator.clipboard.writeText(text).then(() => { setCopied(true); setTimeout(() => setCopied(false), 1400); }); }}
      title="Copy"
      className="inline-flex items-center justify-center w-5 h-5 rounded text-slate-600 hover:text-slate-300 hover:bg-white/10 transition-colors flex-shrink-0 ml-1 align-middle"
    >
      {copied
        ? <svg className="w-3 h-3 text-emerald-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2.5"><path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" /></svg>
        : <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2"><rect x="9" y="9" width="13" height="13" rx="2" /><path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1" /></svg>
      }
    </button>
  );
}

// --- Brand Autocomplete (fixed-position dropdown to escape table overflow) ---
interface BrandInputProps {
  value: string;
  onChange: (v: string) => void;
  suggestions: string[];
  isDirty: boolean;
}
function BrandInput({ value, onChange, suggestions, isDirty }: BrandInputProps) {
  const [open, setOpen] = useState(false);
  const [activeIdx, setActiveIdx] = useState(-1);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const [dropStyle, setDropStyle] = useState<React.CSSProperties>({});

  const filtered = useMemo(() => {
    const q = value.toLowerCase();
    const matches = q ? suggestions.filter((s) => s.toLowerCase().includes(q)) : suggestions;
    return matches.slice(0, 20);
  }, [value, suggestions]);

  const openDrop = useCallback(() => {
    if (!inputRef.current) return;
    const r = inputRef.current.getBoundingClientRect();
    setDropStyle({
      position: 'fixed',
      top: r.bottom + 2,
      left: r.left,
      width: r.width,
      zIndex: 9999,
    });
    setOpen(true);
    setActiveIdx(-1);
  }, []);

  // Close on outside click
  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (
        inputRef.current?.contains(e.target as Node) ||
        listRef.current?.contains(e.target as Node)
      )
        return;
      setOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);

  // Scroll active item into view
  useEffect(() => {
    if (activeIdx >= 0 && listRef.current) {
      const el = listRef.current.children[activeIdx] as HTMLElement;
      el?.scrollIntoView({ block: 'nearest' });
    }
  }, [activeIdx]);

  const select = (s: string) => {
    onChange(s);
    setOpen(false);
  };

  const handleKey = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (!open) {
      if (e.key === 'ArrowDown') { openDrop(); return; }
      return;
    }
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActiveIdx((i) => Math.min(i + 1, filtered.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActiveIdx((i) => Math.max(i - 1, -1));
    } else if (e.key === 'Enter' && activeIdx >= 0) {
      e.preventDefault();
      select(filtered[activeIdx]);
    } else if (e.key === 'Escape') {
      setOpen(false);
    }
  };

  const dropContent = open && filtered.length > 0 && (
    <div
      ref={listRef}
      style={dropStyle}
      className="bg-slate-900 border border-emerald-500/50 rounded-lg shadow-2xl max-h-52 overflow-y-auto custom-scrollbar"
    >
      {filtered.map((s, i) => (
        <div
          key={s}
          onMouseDown={() => select(s)}
          className={`px-3 py-2 text-sm cursor-pointer border-b border-slate-800/50 last:border-0 ${
            i === activeIdx
              ? 'bg-emerald-600/30 text-white'
              : 'text-slate-300 hover:bg-slate-800 hover:text-white'
          }`}
        >
          {s}
        </div>
      ))}
    </div>
  );

  return (
    <>
      <input
        ref={inputRef}
        type="text"
        value={value}
        onChange={(e) => { onChange(e.target.value); if (!open) openDrop(); }}
        onFocus={openDrop}
        onKeyDown={handleKey}
        autoComplete="off"
        className={`w-full px-2.5 py-1.5 rounded-lg text-sm text-white focus:outline-none focus:ring-2 transition-all ${
          isDirty
            ? 'bg-amber-500/10 border border-amber-500/50 focus:ring-amber-500/30'
            : 'bg-slate-950 border border-slate-700 focus:ring-emerald-500/20 focus:border-emerald-500'
        }`}
      />
      {typeof document !== 'undefined' &&
        createPortal(dropContent, document.body)}
    </>
  );
}

// ── Portal combobox components ────────────────────────────────────────────────
interface FilterComboboxProps {
  options: readonly string[];
  value: string;
  onChange: (v: string) => void;
  placeholder: string;
  minWidth?: number;
  className?: string;
}
function FilterCombobox({ options, value, onChange, placeholder, minWidth = 140, className = '' }: FilterComboboxProps) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);
  const [dropStyle, setDropStyle] = useState<React.CSSProperties>({});

  const inputDisplay = open ? query : value;

  const filtered = useMemo(() => {
    const q = query.toLowerCase().trim();
    if (!q) return options;
    return options.filter((o) => o.toLowerCase().includes(q));
  }, [options, query]);

  const openDrop = () => {
    if (!inputRef.current) return;
    const r = inputRef.current.getBoundingClientRect();
    setDropStyle({ position: 'fixed', top: r.bottom + 4, left: r.left, width: Math.max(r.width, minWidth), zIndex: 9999 });
    setOpen(true);
  };

  const select = (v: string) => { onChange(v); setQuery(''); setOpen(false); };
  const handleBlur = () => setTimeout(() => setOpen(false), 160);

  return (
    <div className={`relative ${className}`}>
      <input
        ref={inputRef}
        type="text"
        value={inputDisplay}
        onFocus={() => { openDrop(); setQuery(''); }}
        onChange={(e) => { setQuery(e.target.value); if (!open) openDrop(); }}
        onBlur={handleBlur}
        placeholder={placeholder}
        className="w-full py-2.5 px-3 pr-7 bg-slate-950 border border-slate-700 rounded-lg text-sm text-white focus:border-emerald-500 focus:outline-none placeholder-slate-500"
      />
      {value ? (
        <button onMouseDown={(e) => { e.preventDefault(); onChange(''); setQuery(''); }} className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-500 hover:text-slate-300">
          <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2"><path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" /></svg>
        </button>
      ) : (
        <svg className="absolute right-2 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-slate-600 pointer-events-none" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2"><path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" /></svg>
      )}
      {open && typeof document !== 'undefined' && createPortal(
        <div style={dropStyle} className="bg-[#0D1424] border border-white/10 rounded-xl shadow-2xl overflow-hidden">
          <div className="px-3 py-1.5 border-b border-white/5 flex items-center justify-between">
            <span className="text-[10px] text-slate-500">{filtered.length} option{filtered.length !== 1 ? 's' : ''}</span>
            {query && <span className="text-[10px] text-blue-400">"{query}"</span>}
          </div>
          <div className="max-h-60 overflow-y-auto">
            <button onMouseDown={() => select('')} className={`w-full text-left px-3 py-2 text-sm transition-colors border-b border-white/[0.04] ${value === '' ? 'bg-blue-500/15 text-blue-300' : 'text-slate-400 hover:bg-white/10'}`}>
              {placeholder}
            </button>
            {filtered.length === 0 ? (
              <p className="px-3 py-3 text-sm text-slate-500 italic">No matches</p>
            ) : filtered.map((opt) => (
              <button key={opt} onMouseDown={() => select(opt)}
                className={`w-full text-left px-3 py-2 text-sm transition-colors border-b border-white/[0.04] last:border-0 ${opt === value ? 'bg-blue-500/15 text-blue-300' : 'text-slate-300 hover:bg-white/10'}`}>
                {opt}
              </button>
            ))}
          </div>
        </div>,
        document.body
      )}
    </div>
  );
}

interface QuoteComboboxProps {
  quotes: PriceQuote[];
  value: string;
  onChange: (quoteId: string) => void;
}
function QuoteCombobox({ quotes, value, onChange }: QuoteComboboxProps) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);
  const [dropStyle, setDropStyle] = useState<React.CSSProperties>({});

  const selectedQuote = quotes.find((q) => String(q.quote_id) === value);
  const inputDisplay = open ? query : (selectedQuote?.pi_number ?? (value ? `#${value}` : ''));

  const filtered = useMemo(() => {
    const q = query.toLowerCase().trim();
    if (!q) return quotes;
    return quotes.filter((qt) =>
      (qt.pi_number ?? '').toLowerCase().includes(q) ||
      String(qt.quote_id).includes(q) ||
      (qt.quote_date ?? '').includes(q)
    );
  }, [quotes, query]);

  const openDrop = () => {
    if (!inputRef.current) return;
    const r = inputRef.current.getBoundingClientRect();
    setDropStyle({ position: 'fixed', top: r.bottom + 4, left: r.left, width: Math.max(r.width, 280), zIndex: 9999 });
    setOpen(true);
  };

  const select = (q: PriceQuote) => { onChange(String(q.quote_id)); setQuery(''); setOpen(false); };
  const handleBlur = () => setTimeout(() => setOpen(false), 160);

  return (
    <div className="relative">
      <input
        ref={inputRef}
        type="text"
        value={inputDisplay}
        onFocus={() => { openDrop(); setQuery(''); }}
        onChange={(e) => { setQuery(e.target.value); if (!open) openDrop(); }}
        onBlur={handleBlur}
        placeholder="Search PI number…"
        className="w-full px-2 py-1.5 bg-slate-950 border border-slate-700 rounded-lg text-xs text-white focus:outline-none focus:border-blue-500 placeholder-slate-600"
      />
      {value && !open && (
        <button onMouseDown={(e) => { e.preventDefault(); onChange(''); setQuery(''); }} className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-600 hover:text-slate-300">
          <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2"><path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" /></svg>
        </button>
      )}
      {open && typeof document !== 'undefined' && createPortal(
        <div style={dropStyle} className="bg-[#0D1424] border border-white/10 rounded-xl shadow-2xl overflow-hidden">
          <div className="px-3 py-1.5 border-b border-white/5 flex items-center justify-between">
            <span className="text-[10px] text-slate-500">{filtered.length} of {quotes.length} quotes</span>
            {query && <span className="text-[10px] text-blue-400">"{query}"</span>}
          </div>
          <div className="max-h-64 overflow-y-auto">
            {filtered.length === 0 ? (
              <p className="px-3 py-3 text-xs text-slate-500 italic">No matches</p>
            ) : filtered.map((qt) => (
              <button key={qt.quote_id} onMouseDown={() => select(qt)}
                className={`w-full text-left px-3 py-2 text-xs transition-colors flex items-center gap-2 border-b border-white/[0.04] last:border-0 ${String(qt.quote_id) === value ? 'bg-blue-500/15 text-blue-300' : 'text-slate-300 hover:bg-white/10'}`}
              >
                <span className="font-semibold flex-1 truncate">{qt.pi_number ?? `Quote #${qt.quote_id}`}</span>
                {qt.quote_date && <span className="text-slate-600 text-[10px] flex-shrink-0">{qt.quote_date}</span>}
                {qt.currency && qt.total_value != null && (
                  <span className="text-slate-600 text-[10px] tabular-nums flex-shrink-0">{qt.currency} {Number(qt.total_value).toLocaleString()}</span>
                )}
              </button>
            ))}
          </div>
        </div>,
        document.body
      )}
    </div>
  );
}

// --- Usage Tooltip (portal-based to escape table overflow) ---
interface TooltipQuoteLine { pi_number?: string; quote_date?: string; quantity: number; unit_price: number; currency: string; }
interface TooltipPOLine { po_number: string; po_date?: string; quantity: number; unit_cost: number; currency: string; }
interface UsageTooltipProps { quoteLines: TooltipQuoteLine[]; poLines: TooltipPOLine[]; style: React.CSSProperties; }
function UsageTooltip({ quoteLines, poLines, style }: UsageTooltipProps) {
  const fmtPrice = (n: number, cur: string) =>
    `${n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${cur}`;
  const fmtD = (d?: string) =>
    d ? new Date(d).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: '2-digit' }) : '—';
  const content = (
    <div style={style} className="bg-slate-950 border border-slate-700/80 rounded-xl shadow-2xl shadow-black/70 p-3.5 w-[380px] text-xs pointer-events-none z-[9999]">
      {/* Quote lines */}
      <div className="mb-3">
        <p className="text-[10px] font-bold uppercase tracking-wider text-blue-400 mb-2 flex items-center gap-1.5">
          <span className="w-1.5 h-1.5 rounded-full bg-blue-400 inline-block flex-shrink-0"></span>
          Recent Quote Lines {quoteLines.length > 0 && <span className="text-slate-600 font-normal normal-case tracking-normal">({quoteLines.length} most recent)</span>}
        </p>
        {quoteLines.length === 0 ? (
          <p className="text-slate-600 italic pl-3">No quote line items</p>
        ) : (
          <div>
            <div className="grid grid-cols-[1fr_72px_44px_90px] gap-x-2 text-[10px] text-slate-500 pb-1.5 border-b border-slate-800 mb-1">
              <span>PI #</span><span>Date</span><span className="text-right">Qty</span><span className="text-right">Unit Price</span>
            </div>
            {quoteLines.map((ql, i) => (
              <div key={i} className="grid grid-cols-[1fr_72px_44px_90px] gap-x-2 py-1 border-b border-slate-800/40 last:border-0">
                <span className="font-mono text-blue-300 truncate">{ql.pi_number || '—'}</span>
                <span className="text-slate-400">{fmtD(ql.quote_date)}</span>
                <span className="text-right text-slate-300">{ql.quantity}</span>
                <span className="text-right text-emerald-300 font-semibold tabular-nums">{fmtPrice(ql.unit_price, ql.currency)}</span>
              </div>
            ))}
          </div>
        )}
      </div>
      {/* PO lines */}
      <div className="border-t border-slate-800 pt-3">
        <p className="text-[10px] font-bold uppercase tracking-wider text-emerald-400 mb-2 flex items-center gap-1.5">
          <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 inline-block flex-shrink-0"></span>
          Recent PO Lines {poLines.length > 0 && <span className="text-slate-600 font-normal normal-case tracking-normal">({poLines.length} most recent)</span>}
        </p>
        {poLines.length === 0 ? (
          <p className="text-slate-600 italic pl-3">No PO line items</p>
        ) : (
          <div>
            <div className="grid grid-cols-[1fr_72px_44px_90px] gap-x-2 text-[10px] text-slate-500 pb-1.5 border-b border-slate-800 mb-1">
              <span>PO #</span><span>Date</span><span className="text-right">Qty</span><span className="text-right">Unit Cost</span>
            </div>
            {poLines.map((pl, i) => (
              <div key={i} className="grid grid-cols-[1fr_72px_44px_90px] gap-x-2 py-1 border-b border-slate-800/40 last:border-0">
                <span className="font-mono text-emerald-300 truncate">{pl.po_number}</span>
                <span className="text-slate-400">{fmtD(pl.po_date)}</span>
                <span className="text-right text-slate-300">{pl.quantity}</span>
                <span className="text-right text-amber-300 font-semibold tabular-nums">{fmtPrice(pl.unit_cost, pl.currency)}</span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
  if (typeof document === 'undefined') return null;
  return createPortal(content, document.body);
}

// --- Main Component Editor ---
const EMPTY_ADD = { supplier_model: '', internal_description: '', brand: '', category: '', specifications: '' };

export default function ComponentEditor({ components, brandSuggestions, quoteItems = [], quotes = [], pos = [], poItems = [], onSave, onAdd, onAddSupplier, onDelete, onSaveLineItem, onDeleteLineItem }: ComponentEditorProps) {
  const [searchInput, setSearchInput] = useState('');
  const [search, setSearch] = useState('');
  const [filterBrand, setFilterBrand] = useState('');
  const [filterCategory, setFilterCategory] = useState('');
  const [filterPI, setFilterPI] = useState('');
  const [filterPO, setFilterPO] = useState('');
  const [filterUnused, setFilterUnused] = useState(false);
  const [filterDuplicates, setFilterDuplicates] = useState(false);

  // ── Restore filters from localStorage on mount ────────────────────────────
  useEffect(() => {
    try {
      const saved = localStorage.getItem('componentEditor_filters');
      if (saved) {
        const f = JSON.parse(saved);
        if (f.searchInput) { setSearchInput(f.searchInput); setSearch(f.searchInput); }
        if (f.filterBrand) setFilterBrand(f.filterBrand);
        if (f.filterCategory) setFilterCategory(f.filterCategory);
        if (f.filterPI) setFilterPI(f.filterPI);
        if (f.filterPO) setFilterPO(f.filterPO);
        if (f.filterUnused) setFilterUnused(f.filterUnused);
        if (f.filterDuplicates) setFilterDuplicates(f.filterDuplicates);
      }
    } catch {}
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Persist filters to localStorage whenever they change ─────────────────
  useEffect(() => {
    try {
      localStorage.setItem('componentEditor_filters', JSON.stringify({
        searchInput, filterBrand, filterCategory, filterPI, filterPO, filterUnused, filterDuplicates,
      }));
    } catch {}
  }, [searchInput, filterBrand, filterCategory, filterPI, filterPO, filterUnused, filterDuplicates]);

  // Debounce search so heavy filtering doesn't block every keystroke
  useEffect(() => {
    const t = setTimeout(() => setSearch(searchInput), 150);
    return () => clearTimeout(t);
  }, [searchInput]);
  const [sortCol, setSortCol] = useState<SortCol>('supplier_model');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('asc');
  const [editingIds, setEditingIds] = useState<Set<string>>(new Set());
  const [pending, setPending] = useState<PendingEdits>({});
  const [saving, setSaving] = useState(false);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [bulkDeleting, setBulkDeleting] = useState(false);
  const [confirmBulkDelete, setConfirmBulkDelete] = useState(false);
  const selectAllRef = useRef<HTMLInputElement>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const tableBodyRef = useRef<HTMLTableSectionElement | null>(null);
  const [scrollMargin, setScrollMargin] = useState(0);

  // Keep scroll margin current so the window virtualizer aligns correctly
  useLayoutEffect(() => {
    const update = () => {
      if (tableBodyRef.current) {
        const rect = tableBodyRef.current.getBoundingClientRect();
        setScrollMargin(rect.top + window.scrollY);
      }
    };
    update();
    window.addEventListener('resize', update);
    return () => window.removeEventListener('resize', update);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  const [specsOpenIds, setSpecsOpenIds] = useState<Set<string>>(new Set());
  const [lineItemModalId, setLineItemModalId] = useState<string | null>(null);
  const [lineItemDraft, setLineItemDraft] = useState<Record<number | string, Partial<PriceQuoteLineItem>>>({});
  const [newLineItem, setNewLineItem] = useState<{ quote_id: string; quantity: string; unit_price: string; currency: string; supplier_description: string } | null>(null);
  const [lineItemSaving, setLineItemSaving] = useState(false);
  const [hoveredTooltip, setHoveredTooltip] = useState<{ id: string; style: React.CSSProperties } | null>(null);
  const [showAddForm, setShowAddForm] = useState(false);
  const [addDraft, setAddDraft] = useState(EMPTY_ADD);
  const [addSaving, setAddSaving] = useState(false);

  // ── Per-component usage stats ──────────────────────────────────────────────
  const usageMap = useMemo<Map<string, ComponentUsage>>(() => {
    // Build lookup: quote_id → pi_number
    const piByQuote = new Map<number, string>();
    quotes.forEach((q) => { if (q.pi_number) piByQuote.set(q.quote_id, q.pi_number); });

    // Build lookup: quote_id → po_numbers[]
    const posByQuote = new Map<number, string[]>();
    pos.forEach((po) => {
      if (po.quote_id == null) return;
      const arr = posByQuote.get(po.quote_id) ?? [];
      arr.push(po.po_number);
      posByQuote.set(po.quote_id, arr);
    });

    // Accumulate per-component using Sets for deduplication
    const quoteIds = new Map<string, Set<number>>();
    const piNums = new Map<string, Set<string>>();
    const poNums = new Map<string, Set<string>>();
    const lineCounts = new Map<string, number>();

    quoteItems.forEach((item) => {
      const cid = item.component_id;
      if (!cid) return;
      if (!quoteIds.has(cid)) { quoteIds.set(cid, new Set()); piNums.set(cid, new Set()); poNums.set(cid, new Set()); }
      quoteIds.get(cid)!.add(item.quote_id);
      lineCounts.set(cid, (lineCounts.get(cid) ?? 0) + 1);
      const pi = piByQuote.get(item.quote_id);
      if (pi) piNums.get(cid)!.add(pi);
      posByQuote.get(item.quote_id)?.forEach((p) => poNums.get(cid)!.add(p));
    });

    const map = new Map<string, ComponentUsage>();
    quoteIds.forEach((qids, cid) => {
      map.set(cid, {
        quoteCount: qids.size,
        lineItemCount: lineCounts.get(cid) ?? 0,
        piNumbers: [...(piNums.get(cid) ?? [])].sort(),
        poNumbers: [...(poNums.get(cid) ?? [])].sort(),
      });
    });
    return map;
  }, [quoteItems, quotes, pos]);

  // ── Tooltip quote lines + last quoted price (single pass over quoteItems) ───
  const { quoteLinesByComponent, lastQuoteByComponent } = useMemo(() => {
    const quoteMap = new Map(quotes.map((q) => [q.quote_id, q]));
    const linesMap = new Map<string, TooltipQuoteLine[]>();
    const lastMap = new Map<string, { price: number; currency: string; date: string }>();
    quoteItems.forEach((item) => {
      if (!item.component_id) return;
      const q = quoteMap.get(item.quote_id);
      if (!linesMap.has(item.component_id)) linesMap.set(item.component_id, []);
      linesMap.get(item.component_id)!.push({
        pi_number: q?.pi_number,
        quote_date: q?.quote_date,
        quantity: item.quantity,
        unit_price: item.unit_price,
        currency: item.currency,
      });
      if (q) {
        const existing = lastMap.get(item.component_id);
        if (!existing || q.quote_date > existing.date) {
          lastMap.set(item.component_id, { price: item.unit_price, currency: item.currency, date: q.quote_date });
        }
      }
    });
    linesMap.forEach((lines, cid) => {
      linesMap.set(cid, [...lines].sort((a, b) => (b.quote_date || '').localeCompare(a.quote_date || '')).slice(0, 5));
    });
    return { quoteLinesByComponent: linesMap, lastQuoteByComponent: lastMap };
  }, [quoteItems, quotes]);

  const poLinesByComponent = useMemo(() => {
    const poMap = new Map(pos.map((p) => [p.po_id, p]));
    const map = new Map<string, TooltipPOLine[]>();
    poItems.forEach((item) => {
      if (!item.component_id) return;
      const po = poMap.get(item.po_id);
      if (!po) return;
      if (!map.has(item.component_id)) map.set(item.component_id, []);
      map.get(item.component_id)!.push({
        po_number: po.po_number,
        po_date: po.po_date,
        quantity: item.quantity,
        unit_cost: item.unit_cost,
        currency: item.currency,
      });
    });
    map.forEach((lines, cid) => {
      map.set(cid, [...lines].sort((a, b) => (b.po_date || '').localeCompare(a.po_date || '')).slice(0, 5));
    });
    return map;
  }, [poItems, pos]);

  // ── PO number lookup by quote_id (used in line-item modal) ──────────────────
  const posByQuoteId = useMemo(() => {
    const map = new Map<number, string[]>();
    pos.forEach((po) => {
      if (po.quote_id == null) return;
      map.set(po.quote_id, [...(map.get(po.quote_id) ?? []), po.po_number]);
    });
    return map;
  }, [pos]);


  // ── Duplicate supplier_model detection ────────────────────────────────────
  const duplicateModels = useMemo(() => {
    const counts = new Map<string, number>();
    components.forEach((c) => {
      const m = c.supplier_model?.toLowerCase().trim();
      if (m) counts.set(m, (counts.get(m) || 0) + 1);
    });
    const dups = new Set<string>();
    counts.forEach((cnt, m) => { if (cnt > 1) dups.add(m); });
    return dups;
  }, [components]);

  const uniqueBrands = useMemo(
    () => [...new Set(components.map((c) => c.brand?.trim()).filter(Boolean))].sort() as string[],
    [components]
  );

  const uniquePINumbers = useMemo(() => {
    const all = new Set<string>();
    usageMap.forEach((u) => u.piNumbers.forEach((p) => all.add(p)));
    return [...all].sort();
  }, [usageMap]);

  const uniquePONumbers = useMemo(() => {
    const all = new Set<string>();
    usageMap.forEach((u) => u.poNumbers.forEach((p) => all.add(p)));
    return [...all].sort();
  }, [usageMap]);

  const filtered = useMemo(() => {
    let result = components;
    if (search) {
      const q = search.toLowerCase();
      result = result.filter(
        (c) =>
          c.supplier_model?.toLowerCase().includes(q) ||
          c.internal_description?.toLowerCase().includes(q) ||
          c.brand?.toLowerCase().includes(q) ||
          c.category?.toLowerCase().includes(q)
      );
    }
    if (filterBrand) result = result.filter((c) => c.brand?.trim() === filterBrand);
    if (filterCategory) result = result.filter((c) => c.category === filterCategory);
    if (filterPI) result = result.filter((c) => usageMap.get(String(c.component_id))?.piNumbers.includes(filterPI));
    if (filterPO) result = result.filter((c) => usageMap.get(String(c.component_id))?.poNumbers.includes(filterPO));
    if (filterUnused) result = result.filter((c) => !usageMap.has(String(c.component_id)));
    if (filterDuplicates) result = result.filter((c) => duplicateModels.has(c.supplier_model?.toLowerCase().trim() ?? ''));
    return [...result].sort((a, b) => {
      if (sortCol === 'updated_at') {
        const av = a[sortCol] ? new Date(a[sortCol] as string).getTime() : 0;
        const bv = b[sortCol] ? new Date(b[sortCol] as string).getTime() : 0;
        return sortDir === 'asc' ? av - bv : bv - av;
      }
      if (sortCol === 'quoteCount' || sortCol === 'lineItemCount') {
        const au = usageMap.get(String(a.component_id));
        const bu = usageMap.get(String(b.component_id));
        const av = au ? au[sortCol] : 0;
        const bv = bu ? bu[sortCol] : 0;
        return sortDir === 'asc' ? av - bv : bv - av;
      }
      const av = ((a[sortCol as keyof Component] as string) || '').toLowerCase();
      const bv = ((b[sortCol as keyof Component] as string) || '').toLowerCase();
      return sortDir === 'asc' ? av.localeCompare(bv) : bv.localeCompare(av);
    });
  }, [components, search, filterBrand, filterCategory, filterPI, filterPO, filterUnused, filterDuplicates, sortCol, sortDir, usageMap, duplicateModels]);

  // Flat list for virtual scrolling: main rows + inline spec rows
  const flatRows = useMemo(() => {
    type FlatRow =
      | { type: 'row'; component: Component }
      | { type: 'specs'; component: Component };
    const rows: FlatRow[] = [];
    for (const c of filtered) {
      rows.push({ type: 'row', component: c });
      const hasSpecs =
        c.specifications &&
        typeof c.specifications === 'object' &&
        Object.keys(c.specifications as object).length > 0;
      if (specsOpenIds.has(c.component_id) && hasSpecs) {
        rows.push({ type: 'specs', component: c });
      }
    }
    return rows;
  }, [filtered, specsOpenIds]);

  const toggleSort = (col: SortCol) => {
    if (sortCol === col) setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
    else { setSortCol(col); setSortDir('asc'); }
  };

  // Use string key consistently to avoid Number('undefined'|'null') = NaN edge cases
  const rowKey = (c: Component) => String(c.component_id);

  const getVal = (c: Component, field: keyof Component): any => {
    const k = rowKey(c);
    return k in pending && field in pending[k] ? pending[k][field] : c[field];
  };

  const isDirtyField = (c: Component, field: keyof Component) => {
    const k = rowKey(c);
    const p = pending[k];
    return p !== undefined && field in p && p[field] !== c[field];
  };

  const setField = (c: Component, field: keyof Component, value: any) => {
    const k = rowKey(c);
    setPending((prev) => {
      const cur: Partial<Component> = { ...(prev[k] || {}) };
      const original = c[field];
      if (value === original || (value === '' && original == null) || (value === null && original == null)) {
        delete (cur as any)[field];
      } else {
        (cur as any)[field] = value === '' ? null : value;
      }
      if (Object.keys(cur).length === 0) {
        const next = { ...prev };
        delete next[k];
        return next;
      }
      return { ...prev, [k]: cur };
    });
  };

  const discardRow = (id: string) => {
    setPending((prev) => { const n = { ...prev }; delete n[id]; return n; });
    setEditingIds((prev) => { const n = new Set(prev); n.delete(id); return n; });
  };

  const discardAll = () => { setPending({}); setEditingIds(new Set()); };

  const handleDelete = async (id: string) => {
    if (!onDelete) return;
    setDeleting(true);
    try {
      await onDelete(id);
      discardRow(id);
    } finally {
      setDeleting(false);
      setConfirmDeleteId(null);
    }
  };

  // ── Bulk selection ────────────────────────────────────────────────────────
  const allFilteredSelected = filtered.length > 0 && filtered.every((c) => selectedIds.has(String(c.component_id)));
  const someFilteredSelected = filtered.some((c) => selectedIds.has(String(c.component_id)));

  useEffect(() => {
    if (selectAllRef.current) {
      selectAllRef.current.indeterminate = someFilteredSelected && !allFilteredSelected;
    }
  }, [someFilteredSelected, allFilteredSelected]);

  const toggleSelect = (id: string) => {
    setSelectedIds((prev) => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n; });
  };

  const toggleSelectAll = () => {
    if (allFilteredSelected) {
      setSelectedIds((prev) => { const n = new Set(prev); filtered.forEach((c) => n.delete(String(c.component_id))); return n; });
    } else {
      setSelectedIds((prev) => { const n = new Set(prev); filtered.forEach((c) => n.add(String(c.component_id))); return n; });
    }
  };

  const handleBulkDelete = async () => {
    if (!onDelete || selectedIds.size === 0) return;
    setBulkDeleting(true);
    try {
      for (const id of selectedIds) {
        await onDelete(id);
        discardRow(id);
      }
      setSelectedIds(new Set());
      setConfirmBulkDelete(false);
    } finally {
      setBulkDeleting(false);
    }
  };

  const handleAdd = async () => {
    if (!onAdd || !addDraft.supplier_model.trim() || !addDraft.internal_description.trim()) return;
    setAddSaving(true);
    try {
      let specs: any = undefined;
      if (addDraft.specifications.trim()) {
        try { specs = JSON.parse(addDraft.specifications); } catch { specs = addDraft.specifications; }
      }
      await onAdd({
        supplier_model: addDraft.supplier_model.trim(),
        internal_description: addDraft.internal_description.trim(),
        brand: addDraft.brand.trim() || null as any,
        category: (addDraft.category || null) as any,
        specifications: specs,
      });
      setAddDraft(EMPTY_ADD);
      setShowAddForm(false);
    } finally {
      setAddSaving(false);
    }
  };

  const openLineItemModal = (componentId: string) => {
    setLineItemModalId(componentId);
    setLineItemDraft({});
    setNewLineItem(null);
  };

  const handleSaveLineItemDraft = async (original: PriceQuoteLineItem, draft: Partial<PriceQuoteLineItem>) => {
    if (!onSaveLineItem) return;
    setLineItemSaving(true);
    try {
      await onSaveLineItem({ ...original, ...draft });
      setLineItemDraft((prev) => { const n = { ...prev }; delete n[original.quote_line_id]; return n; });
    } finally { setLineItemSaving(false); }
  };

  const handleAddNewLineItem = async (componentId: string) => {
    if (!onSaveLineItem || !newLineItem) return;
    const qid = newLineItem.quote_id;
    const qty = parseFloat(newLineItem.quantity);
    const price = parseFloat(newLineItem.unit_price);
    if (!qid || isNaN(qty) || isNaN(price)) return;
    setLineItemSaving(true);
    try {
      await onSaveLineItem({
        component_id: componentId,
        quote_id: qid as any,
        quantity: qty,
        unit_price: price,
        currency: (newLineItem.currency as any) || 'USD',
        supplier_description: newLineItem.supplier_description || undefined,
      });
      setNewLineItem(null);
    } finally { setLineItemSaving(false); }
  };

  // Derive dirty state from string keys — consistent with isDirty check below
  const dirtyKeys = useMemo(() => Object.keys(pending), [pending]);
  const dirtyCount = dirtyKeys.length;

  const handleSaveAll = async () => {
    if (!dirtyCount || saving) return;
    setSaving(true);
    try {
      await onSave(
        dirtyKeys.map((k) => ({ component_id: k, changes: pending[k] }))
      );
      setPending({});
      setEditingIds(new Set());
    } catch (err: any) {
      console.error('[ComponentEditor] save error:', err);
      // errors are already shown via toast in onSave; keep pending so user can retry
    } finally {
      setSaving(false);
    }
  };

  const applyBatchField = (field: 'brand' | 'category', value: string) => {
    filtered.forEach((c) => {
      if (selectedIds.has(c.component_id)) setField(c, field, value || null);
    });
  };

  const clearAllFilters = () => {
    setSearchInput(''); setSearch('');
    setFilterBrand(''); setFilterCategory(''); setFilterPI(''); setFilterPO('');
    setFilterUnused(false); setFilterDuplicates(false);
  };

  // ── Keyboard shortcuts ────────────────────────────────────────────────────
  // Use a ref so the handler always has the latest handleSaveAll without
  // re-registering the listener on every render.
  const handleSaveAllRef = useRef(handleSaveAll);
  handleSaveAllRef.current = handleSaveAll;

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      // Ctrl/Cmd+S → save staged edits
      if ((e.ctrlKey || e.metaKey) && e.key === 's') {
        e.preventDefault();
        handleSaveAllRef.current();
        return;
      }
      const target = e.target as HTMLElement;
      const inInput = target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.tagName === 'SELECT';
      // / → focus search bar
      if (e.key === '/' && !inInput) {
        e.preventDefault();
        searchInputRef.current?.focus();
        return;
      }
      // Esc → clear search when search is focused
      if (e.key === 'Escape' && document.activeElement === searchInputRef.current) {
        setSearchInput('');
        setSearch('');
        searchInputRef.current?.blur();
      }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, []); // register once; ref keeps handleSaveAll current

  const toggleEdit = (id: string) => {
    setEditingIds((prev) => {
      const n = new Set(prev);
      n.has(id) ? n.delete(id) : n.add(id);
      return n;
    });
  };

  const toggleSpecs = (id: string) => {
    setSpecsOpenIds((prev) => {
      const n = new Set(prev);
      n.has(id) ? n.delete(id) : n.add(id);
      return n;
    });
  };

  // ── Virtual scrolling (window-based — no fixed-height container) ─────────
  const rowVirtualizer = useWindowVirtualizer({
    count: flatRows.length,
    estimateSize: (i) => (flatRows[i]?.type === 'specs' ? 200 : 56),
    overscan: 8,
    scrollMargin,
  });

  // ── CSV Export ────────────────────────────────────────────────────────────
  const downloadCSV = useCallback(() => {
    const headers = ['Model/SKU', 'Description', 'Brand', 'Category', 'Quotes', 'Line Items', 'Last Price', 'Currency'];
    const rows = filtered.map((c) => {
      const u = usageMap.get(c.component_id);
      const lq = lastQuoteByComponent.get(c.component_id);
      return [
        c.supplier_model ?? '',
        c.internal_description ?? '',
        c.brand ?? '',
        c.category ?? '',
        u?.quoteCount ?? 0,
        u?.lineItemCount ?? 0,
        lq ? lq.price.toFixed(2) : '',
        lq?.currency ?? '',
      ].map((v) => `"${String(v).replace(/"/g, '""')}"`);
    });
    const csv = [headers.map((h) => `"${h}"`), ...rows].map((r) => r.join(',')).join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `components_${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }, [filtered, usageMap, lastQuoteByComponent]);

  const fmtDate = (ts?: string) => {
    if (!ts) return '—';
    return new Date(ts).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
  };

  const SortTh = ({ col, label, className = '' }: { col: SortCol; label: string; className?: string }) => (
    <th
      className={`px-4 py-3 text-left text-xs font-bold uppercase tracking-wider text-slate-400 cursor-pointer select-none hover:text-white transition-colors ${className}`}
      onClick={() => toggleSort(col)}
    >
      <span className="flex items-center gap-1.5">
        {label}
        {sortCol === col ? (
          <span className="text-emerald-400 text-[11px]">{sortDir === 'asc' ? '↑' : '↓'}</span>
        ) : (
          <span className="text-slate-700 text-[11px]">↕</span>
        )}
      </span>
    </th>
  );

  const DirtyBadge = ({ original }: { original: string | null | undefined }) => (
    <p className="mt-0.5 text-[11px] text-amber-400/80 leading-tight">
      was: <span className="font-mono">{original || '—'}</span>
    </p>
  );

  return (
    <>
    <div className="bg-slate-900/40 backdrop-blur-sm rounded-2xl border border-slate-800/80 shadow-xl ring-1 ring-white/5">
      {/* Header */}
      <div className="flex items-center gap-3 border-b border-slate-800/80 p-5 md:p-6">
        <div className="w-8 h-8 rounded-lg bg-amber-500/10 border border-amber-500/20 flex items-center justify-center flex-shrink-0">
          <span className="w-2.5 h-2.5 rounded-full bg-amber-400 shadow-[0_0_10px_rgba(251,191,36,0.8)]"></span>
        </div>
        <div className="flex-1">
          <h3 className="text-lg font-bold text-white tracking-tight">Component Editor</h3>
          <p className="text-xs text-slate-500 mt-0.5">Click ✎ to edit · <kbd className="px-1 py-0.5 text-[10px] bg-white/5 border border-white/10 rounded">Ctrl+S</kbd> to save · <kbd className="px-1 py-0.5 text-[10px] bg-white/5 border border-white/10 rounded">/</kbd> to search</p>
        </div>
        <div className="flex items-center gap-2 flex-shrink-0">
          {onAddSupplier && (
            <button
              onClick={onAddSupplier}
              className="flex items-center gap-1.5 px-3 py-2 text-xs font-semibold rounded-lg border transition-all bg-slate-800/60 border-slate-700 text-slate-400 hover:text-sky-300 hover:border-sky-500/30"
            >
              <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" />
              </svg>
              Add Supplier
            </button>
          )}
          {onAdd && (
            <button
              onClick={() => setShowAddForm((v) => !v)}
              className={`flex items-center gap-1.5 px-3 py-2 text-xs font-semibold rounded-lg border transition-all ${
                showAddForm
                  ? 'bg-emerald-500/20 border-emerald-500/40 text-emerald-300'
                  : 'bg-slate-800/60 border-slate-700 text-slate-400 hover:text-emerald-300 hover:border-emerald-500/30'
              }`}
            >
              <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" />
              </svg>
              Add Component
            </button>
          )}
        </div>
      </div>

      {/* Inline Add Component form */}
      {showAddForm && onAdd && (
        <div className="p-4 md:p-5 border-b border-emerald-500/20 bg-emerald-500/[0.04]">
          <div className="flex items-center justify-between mb-3">
            <p className="text-[11px] font-bold uppercase tracking-wider text-emerald-400">New Component</p>
            <button
              onClick={() => { setShowAddForm(false); setAddDraft(EMPTY_ADD); }}
              className="text-slate-500 hover:text-slate-300 transition-colors"
            >
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
                <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
            <div>
              <label className="block text-[10px] text-slate-500 mb-1 uppercase tracking-wide">
                Supplier Model / SKU <span className="text-red-400">*</span>
              </label>
              <input
                type="text"
                value={addDraft.supplier_model}
                onChange={(e) => setAddDraft((p) => ({ ...p, supplier_model: e.target.value }))}
                placeholder="e.g. SP-400W"
                className={`w-full px-2.5 py-1.5 bg-slate-950 border rounded-lg text-sm text-white focus:outline-none focus:border-emerald-500 placeholder-slate-600 ${
                  addDraft.supplier_model.trim() && components.some((c) => c.supplier_model?.toLowerCase().trim() === addDraft.supplier_model.toLowerCase().trim())
                    ? 'border-amber-500/60'
                    : 'border-slate-700'
                }`}
              />
              {addDraft.supplier_model.trim() && components.some((c) => c.supplier_model?.toLowerCase().trim() === addDraft.supplier_model.toLowerCase().trim()) && (
                <p className="mt-1 text-[11px] text-amber-400 flex items-center gap-1">
                  <svg className="w-3 h-3 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2.5">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.538-1.333-3.308 0L3.732 16c-.77 1.333.192 3 1.732 3z" />
                  </svg>
                  Model already exists — possible duplicate
                </p>
              )}
            </div>
            <div>
              <label className="block text-[10px] text-slate-500 mb-1 uppercase tracking-wide">
                Internal Description <span className="text-red-400">*</span>
              </label>
              <input
                type="text"
                value={addDraft.internal_description}
                onChange={(e) => setAddDraft((p) => ({ ...p, internal_description: e.target.value }))}
                placeholder="e.g. 400W Mono Panel"
                className="w-full px-2.5 py-1.5 bg-slate-950 border border-slate-700 rounded-lg text-sm text-white focus:outline-none focus:border-emerald-500 placeholder-slate-600"
              />
            </div>
            <div>
              <label className="block text-[10px] text-slate-500 mb-1 uppercase tracking-wide">Brand</label>
              <BrandInput
                value={addDraft.brand}
                onChange={(v) => setAddDraft((p) => ({ ...p, brand: v }))}
                suggestions={brandSuggestions}
                isDirty={false}
              />
            </div>
            <div>
              <label className="block text-[10px] text-slate-500 mb-1 uppercase tracking-wide">Category</label>
              <select
                value={addDraft.category}
                onChange={(e) => setAddDraft((p) => ({ ...p, category: e.target.value }))}
                className="w-full px-2.5 py-1.5 bg-slate-950 border border-slate-700 rounded-lg text-sm text-white focus:outline-none focus:border-emerald-500"
              >
                <option value="">— none —</option>
                {ENUMS.product_category.map((cat) => (
                  <option key={cat} value={cat}>{cat}</option>
                ))}
              </select>
            </div>
          </div>
          <div className="mt-3">
            <label className="block text-[10px] text-slate-500 mb-1 uppercase tracking-wide">Specs (JSON)</label>
            <textarea
              value={addDraft.specifications}
              onChange={(e) => setAddDraft((p) => ({ ...p, specifications: e.target.value }))}
              placeholder={'{"watts": 400, "voltage": 48}'}
              rows={2}
              className="w-full px-2.5 py-1.5 bg-slate-950 border border-slate-700 rounded-lg text-xs text-white font-mono focus:outline-none focus:border-emerald-500 placeholder-slate-600 resize-none"
            />
          </div>
          <div className="flex justify-end gap-2 mt-3">
            <button
              onClick={() => { setShowAddForm(false); setAddDraft(EMPTY_ADD); }}
              disabled={addSaving}
              className="px-3 py-1.5 text-xs font-semibold text-slate-400 bg-slate-800 border border-slate-700 rounded-lg hover:bg-slate-700 transition-all disabled:opacity-50"
            >
              Cancel
            </button>
            <button
              onClick={handleAdd}
              disabled={addSaving || !addDraft.supplier_model.trim() || !addDraft.internal_description.trim()}
              className="flex items-center gap-1.5 px-4 py-1.5 text-xs font-bold text-white bg-emerald-600 hover:bg-emerald-500 rounded-lg transition-all disabled:opacity-40 disabled:cursor-not-allowed"
            >
              {addSaving ? <><Spinner className="w-3.5 h-3.5" /> Saving…</> : 'Add Component'}
            </button>
          </div>
        </div>
      )}

      {/* Toolbar */}
      <div className="p-4 md:p-5 border-b border-slate-800/60 space-y-3">
        <div className="flex flex-wrap gap-3">
          {/* Search */}
          <div className="relative flex-1 min-w-[200px]">
            <svg className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-500 pointer-events-none" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
            </svg>
            <input
              ref={searchInputRef}
              type="text"
              placeholder="Search model, description, brand… (press / to focus)"
              value={searchInput}
              onChange={(e) => setSearchInput(e.target.value)}
              className="w-full pl-9 pr-8 py-2.5 bg-slate-950 border border-slate-700 rounded-lg text-sm text-white focus:border-emerald-500 focus:ring-2 focus:ring-emerald-500/20 focus:outline-none placeholder-slate-600"
            />
            {searchInput && (
              <button
                onClick={() => { setSearchInput(''); setSearch(''); }}
                className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-500 hover:text-white"
              >
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            )}
          </div>
          {/* Brand filter */}
          <FilterCombobox options={uniqueBrands} value={filterBrand} onChange={setFilterBrand} placeholder="All Brands" minWidth={140} className="min-w-[140px]" />
          {/* Category filter */}
          <FilterCombobox options={ENUMS.product_category} value={filterCategory} onChange={setFilterCategory} placeholder="All Categories" minWidth={180} className="min-w-[160px]" />
          {/* PI filter */}
          {uniquePINumbers.length > 0 && (
            <FilterCombobox options={uniquePINumbers} value={filterPI} onChange={setFilterPI} placeholder="All PIs" minWidth={150} className="min-w-[150px]" />
          )}
          {/* PO filter */}
          {uniquePONumbers.length > 0 && (
            <FilterCombobox options={uniquePONumbers} value={filterPO} onChange={setFilterPO} placeholder="All POs" minWidth={150} className="min-w-[150px]" />
          )}
          {/* Quick-filter toggles */}
          <button
            onClick={() => { setFilterUnused((v) => !v); setFilterDuplicates(false); }}
            className={`py-2 px-3 rounded-lg text-sm font-semibold border transition-all flex-shrink-0 ${
              filterUnused
                ? 'bg-orange-500/20 border-orange-500/40 text-orange-300'
                : 'bg-slate-950 border-slate-700 text-slate-400 hover:text-orange-300 hover:border-orange-500/30'
            }`}
            title="Show components never used in any quote"
          >
            Unused{filterUnused ? ` (${filtered.length})` : ''}
          </button>
          <button
            onClick={() => { setFilterDuplicates((v) => !v); setFilterUnused(false); }}
            className={`py-2 px-3 rounded-lg text-sm font-semibold border transition-all flex-shrink-0 ${
              filterDuplicates
                ? 'bg-red-500/20 border-red-500/40 text-red-300'
                : 'bg-slate-950 border-slate-700 text-slate-400 hover:text-red-300 hover:border-red-500/30'
            }`}
            title="Show components with duplicate model numbers"
          >
            Duplicates{filterDuplicates ? ` (${filtered.length})` : ''}
          </button>
        </div>

        {/* Stats + action buttons */}
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <p className="text-xs text-slate-500">
            Showing <span className="text-slate-300 font-semibold">{filtered.length}</span> of {components.length} components
            {selectedIds.size > 0 && (
              <span className="ml-2 text-sky-400 font-semibold">· {selectedIds.size} selected</span>
            )}
            {dirtyCount > 0 && (
              <span className="ml-2 text-amber-400 font-semibold">
                · {dirtyCount} unsaved {dirtyCount === 1 ? 'edit' : 'edits'}
              </span>
            )}
          </p>
          <div className="flex gap-2 items-center flex-wrap">
            {/* CSV export */}
            <button
              onClick={downloadCSV}
              title="Export visible components to CSV"
              className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-slate-400 bg-slate-800/60 border border-slate-700 rounded-lg hover:text-emerald-300 hover:border-emerald-500/30 transition-all"
            >
              <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
                <path strokeLinecap="round" strokeLinejoin="round" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
              </svg>
              CSV
            </button>
            {/* Bulk delete controls */}
            {onDelete && selectedIds.size > 0 && (
              confirmBulkDelete ? (
                <div className="flex items-center gap-2">
                  <span className="text-xs text-red-400">Delete {selectedIds.size} component{selectedIds.size !== 1 ? 's' : ''}?</span>
                  <button
                    onClick={handleBulkDelete}
                    disabled={bulkDeleting}
                    className="px-3 py-1.5 text-xs font-bold text-white bg-red-600 hover:bg-red-500 rounded-lg transition-all disabled:opacity-50"
                  >
                    {bulkDeleting ? 'Deleting…' : 'Confirm'}
                  </button>
                  <button
                    onClick={() => setConfirmBulkDelete(false)}
                    disabled={bulkDeleting}
                    className="px-3 py-1.5 text-xs font-semibold text-slate-400 bg-slate-800 border border-slate-700 rounded-lg hover:bg-slate-700 transition-all disabled:opacity-50"
                  >
                    Cancel
                  </button>
                </div>
              ) : (
                <button
                  onClick={() => setConfirmBulkDelete(true)}
                  className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-red-400 bg-red-500/10 border border-red-500/25 rounded-lg hover:bg-red-500/20 transition-all"
                >
                  <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                  </svg>
                  Delete {selectedIds.size}
                </button>
              )
            )}
            {dirtyCount > 0 && (
              <button
                onClick={discardAll}
                disabled={saving}
                className="px-3 py-1.5 text-xs font-semibold bg-slate-800 hover:bg-slate-700 text-slate-300 border border-slate-700 rounded-lg transition-all disabled:opacity-50"
              >
                Discard All
              </button>
            )}
            <button
              onClick={handleSaveAll}
              disabled={dirtyCount === 0 || saving}
              className="flex items-center gap-1.5 px-4 py-1.5 text-xs font-bold bg-emerald-600 hover:bg-emerald-500 text-white rounded-lg shadow-lg shadow-emerald-900/20 transition-all disabled:opacity-40 disabled:cursor-not-allowed"
            >
              {saving ? (
                <><Spinner className="w-3.5 h-3.5" /> Saving...</>
              ) : (
                <>Save{dirtyCount > 0 ? ` ${dirtyCount}` : ''} Changes</>
              )}
            </button>
          </div>
        </div>

        {/* Batch field edit — appears when rows are selected */}
        {selectedIds.size > 0 && (
          <div className="flex flex-wrap items-center gap-2 pt-2.5 border-t border-white/5">
            <span className="text-[11px] text-slate-400 flex-shrink-0">
              Set for <span className="text-sky-300 font-semibold">{selectedIds.size}</span> selected:
            </span>
            <select
              defaultValue=""
              onChange={(e) => {
                if (e.target.value) { applyBatchField('brand', e.target.value); e.currentTarget.value = ''; }
              }}
              className="py-1.5 px-2 bg-slate-950 border border-slate-700 rounded-lg text-xs text-white focus:outline-none focus:border-sky-500 min-w-[120px]"
            >
              <option value="" disabled>Brand…</option>
              {uniqueBrands.map((b) => <option key={b} value={b}>{b}</option>)}
            </select>
            <select
              defaultValue=""
              onChange={(e) => {
                if (e.target.value) { applyBatchField('category', e.target.value); e.currentTarget.value = ''; }
              }}
              className="py-1.5 px-2 bg-slate-950 border border-slate-700 rounded-lg text-xs text-white focus:outline-none focus:border-sky-500 min-w-[140px]"
            >
              <option value="" disabled>Category…</option>
              {ENUMS.product_category.map((cat) => <option key={cat} value={cat}>{cat}</option>)}
            </select>
            <button
              onClick={() => setSelectedIds(new Set())}
              className="ml-auto text-[11px] text-slate-600 hover:text-slate-400 transition-colors"
            >
              Clear selection
            </button>
          </div>
        )}
      </div>

      {/* Active filter chips */}
      {(search || filterBrand || filterCategory || filterPI || filterPO || filterUnused || filterDuplicates) && (
        <div className="px-4 md:px-5 py-2.5 border-b border-slate-800/60 flex flex-wrap items-center gap-1.5 bg-slate-950/30">
          {search && <ActiveChip label="Search" value={search} onClear={() => { setSearchInput(''); setSearch(''); }} />}
          {filterBrand && <ActiveChip label="Brand" value={filterBrand} onClear={() => setFilterBrand('')} />}
          {filterCategory && <ActiveChip label="Category" value={filterCategory} onClear={() => setFilterCategory('')} />}
          {filterPI && <ActiveChip label="PI" value={filterPI} onClear={() => setFilterPI('')} />}
          {filterPO && <ActiveChip label="PO" value={filterPO} onClear={() => setFilterPO('')} />}
          {filterUnused && <ActiveChip label="Unused only" onClear={() => setFilterUnused(false)} />}
          {filterDuplicates && <ActiveChip label="Duplicates only" onClear={() => setFilterDuplicates(false)} />}
          <button
            onMouseDown={clearAllFilters}
            className="text-[11px] text-slate-600 hover:text-slate-300 ml-1 transition-colors"
          >
            Clear all
          </button>
        </div>
      )}

      {/* Table */}
      <div className="overflow-x-auto">
        {filtered.length === 0 ? (
          <div className="py-16 text-center text-slate-500">
            <svg className="w-10 h-10 mx-auto mb-3 opacity-30" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9.172 16.172a4 4 0 015.656 0M9 10h.01M15 10h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
            <p className="font-medium">No components match your filters</p>
          </div>
        ) : (
          <table className="w-full">
            <thead className="bg-slate-900/95 border-b border-slate-800 sticky top-0 z-20 backdrop-blur-sm">
              <tr>
                <th className="pl-4 pr-2 py-3 w-9">
                  <input
                    ref={selectAllRef}
                    type="checkbox"
                    checked={allFilteredSelected}
                    onChange={toggleSelectAll}
                    className="w-4 h-4 rounded border-white/20 bg-white/5 cursor-pointer accent-sky-400"
                    title={allFilteredSelected ? 'Deselect all' : 'Select all visible'}
                  />
                </th>
                <SortTh col="supplier_model" label="Model / SKU" />
                <SortTh col="internal_description" label="Description" />
                <SortTh col="brand" label="Brand" className="min-w-[160px]" />
                <SortTh col="category" label="Category" />
                <th className="px-4 py-3 text-left text-xs font-bold uppercase tracking-wider text-slate-400 min-w-[120px]">Last Price</th>
                <th className="px-4 py-3 text-left text-xs font-bold uppercase tracking-wider text-slate-400 min-w-[200px]">
                  <div className="flex items-center gap-2">
                    <span>Usage</span>
                    <div className="flex gap-1">
                      <button
                        onClick={() => toggleSort('quoteCount')}
                        className={`text-[10px] px-1.5 py-0.5 rounded border transition-colors ${sortCol === 'quoteCount' ? 'text-emerald-300 border-emerald-500/40 bg-emerald-500/10' : 'text-slate-600 border-slate-700 hover:text-slate-400'}`}
                      >
                        Quotes{sortCol === 'quoteCount' ? (sortDir === 'asc' ? ' ↑' : ' ↓') : ''}
                      </button>
                      <button
                        onClick={() => toggleSort('lineItemCount')}
                        className={`text-[10px] px-1.5 py-0.5 rounded border transition-colors ${sortCol === 'lineItemCount' ? 'text-emerald-300 border-emerald-500/40 bg-emerald-500/10' : 'text-slate-600 border-slate-700 hover:text-slate-400'}`}
                      >
                        Items{sortCol === 'lineItemCount' ? (sortDir === 'asc' ? ' ↑' : ' ↓') : ''}
                      </button>
                    </div>
                  </div>
                </th>
                <SortTh col="updated_at" label="Updated" className="min-w-[110px]" />
                <th className="px-4 py-3 w-28 text-right text-xs font-bold uppercase tracking-wider text-slate-600">Actions</th>
              </tr>
            </thead>
            {(() => {
                const virtualItems = rowVirtualizer.getVirtualItems();
                // useWindowVirtualizer: .start is absolute from doc top; subtract scrollMargin to get list-relative offset
                const paddingTop =
                  virtualItems.length > 0 ? Math.max(0, (virtualItems[0].start ?? 0) - scrollMargin) : 0;
                const paddingBottom =
                  virtualItems.length > 0
                    ? Math.max(0, rowVirtualizer.getTotalSize() - (virtualItems[virtualItems.length - 1]?.end ?? 0) + scrollMargin)
                    : 0;
                return (
            <tbody ref={tableBodyRef} className="divide-y divide-slate-800/50">
              {paddingTop > 0 && (
                <tr><td colSpan={9} style={{ height: `${paddingTop}px`, padding: 0 }} /></tr>
              )}
              {virtualItems.map((vr) => {
                const row = flatRows[vr.index];
                if (!row) return null;
                const c = row.component;

                // ── Specs expansion row ──────────────────────────────────
                if (row.type === 'specs') {
                  return (
                    <tr
                      key={`specs-${c.component_id}`}
                      data-index={vr.index}
                      ref={rowVirtualizer.measureElement}
                      className="bg-slate-900/40 border-t border-amber-500/10"
                    >
                      <td colSpan={9} className="px-6 py-5">
                        <SpecRenderer
                          specs={c.specifications as Record<string, unknown>}
                          modelName={c.supplier_model}
                        />
                      </td>
                    </tr>
                  );
                }

                // ── Main component row ───────────────────────────────────
                const k = rowKey(c);
                const isEditing = editingIds.has(c.component_id);
                const isDirty = k in pending;
                const isSpecsOpen = specsOpenIds.has(c.component_id);
                const hasSpecs = c.specifications && typeof c.specifications === 'object' && Object.keys(c.specifications as object).length > 0;

                return (
                  <tr
                    key={c.component_id}
                    data-index={vr.index}
                    ref={rowVirtualizer.measureElement}
                    onDoubleClick={() => { if (!isEditing) toggleEdit(c.component_id); }}
                    className={`transition-colors cursor-pointer ${
                      selectedIds.has(String(c.component_id))
                        ? 'bg-sky-500/5'
                        : isDirty
                        ? 'bg-amber-500/5 border-l-2 border-amber-500/40'
                        : isEditing
                        ? 'bg-slate-800/25'
                        : 'hover:bg-slate-800/15'
                    }`}
                  >
                    {/* Select checkbox */}
                    <td className="pl-4 pr-2 py-3 align-top">
                      <input
                        type="checkbox"
                        checked={selectedIds.has(String(c.component_id))}
                        onChange={(e) => { e.stopPropagation(); toggleSelect(String(c.component_id)); }}
                        onClick={(e) => e.stopPropagation()}
                        className="w-4 h-4 rounded border-white/20 bg-white/5 cursor-pointer accent-sky-400 mt-0.5"
                      />
                    </td>
                    {/* Model / SKU */}
                    <td className="px-4 py-3 align-top min-w-[260px]">
                      {isEditing ? (
                        <div>
                          <input
                            type="text"
                            value={(getVal(c, 'supplier_model') as string) ?? ''}
                            onChange={(e) => setField(c, 'supplier_model', e.target.value)}
                            className={`w-full px-2.5 py-1.5 rounded-lg text-sm text-white focus:outline-none focus:ring-2 transition-all ${
                              isDirtyField(c, 'supplier_model')
                                ? 'bg-amber-500/10 border border-amber-500/50 focus:ring-amber-500/30'
                                : 'bg-slate-950 border border-slate-700 focus:ring-emerald-500/20 focus:border-emerald-500'
                            }`}
                          />
                          {isDirtyField(c, 'supplier_model') && <DirtyBadge original={c.supplier_model} />}
                        </div>
                      ) : isDirtyField(c, 'supplier_model') ? (
                        <div>
                          <span className="text-sm text-emerald-300 font-medium">{(getVal(c, 'supplier_model') as string) || '—'}</span>
                          <DirtyBadge original={c.supplier_model} />
                        </div>
                      ) : (
                        <span className="inline-flex items-center gap-0.5 text-sm text-white font-medium">
                          {c.supplier_model}
                          <CopyBtn text={c.supplier_model} />
                        </span>
                      )}
                    </td>

                    {/* Internal Description */}
                    <td className="px-4 py-3 align-top">
                      {isEditing ? (
                        <div>
                          <input
                            type="text"
                            value={(getVal(c, 'internal_description') as string) ?? ''}
                            onChange={(e) => setField(c, 'internal_description', e.target.value)}
                            className={`w-full px-2.5 py-1.5 rounded-lg text-sm text-white focus:outline-none focus:ring-2 transition-all ${
                              isDirtyField(c, 'internal_description')
                                ? 'bg-amber-500/10 border border-amber-500/50 focus:ring-amber-500/30'
                                : 'bg-slate-950 border border-slate-700 focus:ring-emerald-500/20 focus:border-emerald-500'
                            }`}
                          />
                          {isDirtyField(c, 'internal_description') && (
                            <DirtyBadge original={c.internal_description} />
                          )}
                        </div>
                      ) : isDirtyField(c, 'internal_description') ? (
                        <div>
                          <span className="text-sm text-emerald-300">{(getVal(c, 'internal_description') as string) || '—'}</span>
                          <DirtyBadge original={c.internal_description} />
                        </div>
                      ) : (
                        <span className="inline-flex items-center gap-0.5 text-sm text-slate-300">
                          {c.internal_description}
                          <CopyBtn text={c.internal_description} />
                        </span>
                      )}
                    </td>

                    {/* Brand */}
                    <td className="px-4 py-3 align-top min-w-[160px]">
                      {isEditing ? (
                        <div>
                          <BrandInput
                            value={(getVal(c, 'brand') as string) ?? ''}
                            onChange={(v) => setField(c, 'brand', v)}
                            suggestions={brandSuggestions}
                            isDirty={isDirtyField(c, 'brand')}
                          />
                          {isDirtyField(c, 'brand') && <DirtyBadge original={c.brand} />}
                        </div>
                      ) : isDirtyField(c, 'brand') ? (
                        <div>
                          <span className="text-sm text-emerald-300">{(getVal(c, 'brand') as string) || '—'}</span>
                          <DirtyBadge original={c.brand} />
                        </div>
                      ) : (
                        <span className="text-sm text-slate-300">
                          {c.brand || <span className="text-slate-600">—</span>}
                        </span>
                      )}
                    </td>

                    {/* Category */}
                    <td className="px-4 py-3 align-top">
                      {isEditing ? (
                        <div>
                          <select
                            value={(getVal(c, 'category') as string) ?? ''}
                            onChange={(e) => setField(c, 'category', e.target.value || null)}
                            className={`w-full px-2.5 py-1.5 rounded-lg text-sm text-white focus:outline-none focus:ring-2 transition-all ${
                              isDirtyField(c, 'category')
                                ? 'bg-amber-500/10 border border-amber-500/50 focus:ring-amber-500/30'
                                : 'bg-slate-950 border border-slate-700 focus:ring-emerald-500/20 focus:border-emerald-500'
                            }`}
                          >
                            <option value="">— none —</option>
                            {ENUMS.product_category.map((cat) => (
                              <option key={cat} value={cat}>{cat}</option>
                            ))}
                          </select>
                          {isDirtyField(c, 'category') && <DirtyBadge original={c.category} />}
                        </div>
                      ) : isDirtyField(c, 'category') ? (
                        <div>
                          <span className="text-sm text-emerald-300">{(getVal(c, 'category') as string) || '—'}</span>
                          <DirtyBadge original={c.category} />
                        </div>
                      ) : (
                        <span className="text-sm text-slate-300">
                          {c.category || <span className="text-slate-600">—</span>}
                        </span>
                      )}
                    </td>

                    {/* Last Price */}
                    <td className="px-4 py-3 align-top min-w-[120px]">
                      {(() => {
                        const lq = lastQuoteByComponent.get(c.component_id);
                        const isDup = duplicateModels.has(c.supplier_model?.toLowerCase().trim() ?? '');
                        return (
                          <div>
                            {lq ? (
                              <>
                                <p className="text-sm font-semibold text-slate-200 tabular-nums">
                                  {lq.currency} {lq.price.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                                </p>
                                <p className="text-[10px] text-slate-600 mt-0.5">{new Date(lq.date).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: '2-digit' })}</p>
                              </>
                            ) : (
                              <span className="text-xs text-slate-700">—</span>
                            )}
                            {isDup && (
                              <span className="mt-1 inline-block px-1.5 py-0.5 bg-red-500/15 border border-red-500/25 text-red-400 text-[10px] font-bold rounded">dup</span>
                            )}
                          </div>
                        );
                      })()}
                    </td>

                    {/* Usage */}
                    <td
                      className="px-4 py-3 align-top min-w-[180px] cursor-default"
                      onMouseEnter={(e) => {
                        const rect = e.currentTarget.getBoundingClientRect();
                        const tooltipW = 388;
                        const tooltipH = 260;
                        const spaceBelow = window.innerHeight - rect.bottom;
                        const top = spaceBelow > tooltipH ? rect.bottom + 4 : rect.top - tooltipH - 4;
                        const left = Math.min(rect.left, window.innerWidth - tooltipW - 8);
                        setHoveredTooltip({ id: c.component_id, style: { position: 'fixed', top: Math.max(8, top), left: Math.max(8, left), zIndex: 9999 } });
                      }}
                      onMouseLeave={() => setHoveredTooltip(null)}
                    >
                      {(() => {
                        const u = usageMap.get(c.component_id);
                        if (!u) return <span className="text-xs text-slate-700">—</span>;
                        const MAX_TAGS = 3;
                        const allPis = u.piNumbers;
                        const allPos = u.poNumbers;
                        const visiblePis = allPis.slice(0, MAX_TAGS);
                        const visiblePos = allPos.slice(0, MAX_TAGS);
                        const extraPis = allPis.length - visiblePis.length;
                        const extraPos = allPos.length - visiblePos.length;
                        return (
                          <div className="space-y-1.5">
                            <div className="flex items-center gap-2 text-[11px] text-slate-500">
                              <span className="font-semibold text-slate-300">{u.quoteCount}</span>
                              {u.quoteCount === 1 ? 'quote' : 'quotes'}
                              <span className="text-slate-700">·</span>
                              <span className="font-semibold text-slate-300">{u.lineItemCount}</span>
                              {u.lineItemCount === 1 ? 'line item' : 'line items'}
                            </div>
                            {allPis.length > 0 && (
                              <div className="flex flex-wrap gap-1">
                                {visiblePis.map((pi) => (
                                  <span key={pi} className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-mono font-medium bg-blue-500/10 text-blue-300 border border-blue-500/20">
                                    {pi}
                                  </span>
                                ))}
                                {extraPis > 0 && (
                                  <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] text-slate-500">+{extraPis}</span>
                                )}
                              </div>
                            )}
                            {allPos.length > 0 && (
                              <div className="flex flex-wrap gap-1">
                                {visiblePos.map((po) => (
                                  <span key={po} className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-mono font-medium bg-emerald-500/10 text-emerald-300 border border-emerald-500/20">
                                    {po}
                                  </span>
                                ))}
                                {extraPos > 0 && (
                                  <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] text-slate-500">+{extraPos}</span>
                                )}
                              </div>
                            )}
                          </div>
                        );
                      })()}
                      {(onSaveLineItem || onDeleteLineItem) && (
                        <button
                          onClick={() => openLineItemModal(c.component_id)}
                          className="mt-1.5 text-[10px] text-slate-600 hover:text-blue-300 transition-colors flex items-center gap-1"
                          title="Manage quote/PO associations"
                        >
                          <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" /></svg>
                          Edit associations
                        </button>
                      )}
                    </td>

                    {/* Updated At */}
                    <td className="px-4 py-3 align-top">
                      <span className={`text-xs ${sortCol === 'updated_at' ? 'text-emerald-400 font-semibold' : 'text-slate-500'}`}>
                        {fmtDate(c.updated_at)}
                      </span>
                    </td>

                    {/* Row actions */}
                    <td className="px-4 py-3 align-top">
                      <div className="flex gap-1.5 justify-end items-center">
                        {hasSpecs && (
                          <button
                            onClick={() => toggleSpecs(c.component_id)}
                            className={`px-2.5 py-1 text-xs font-semibold rounded-lg border transition-all ${
                              isSpecsOpen
                                ? 'text-amber-300 bg-amber-500/10 border-amber-500/30 hover:bg-amber-500/20'
                                : 'text-slate-400 bg-slate-800/60 border-slate-700/60 hover:bg-slate-700 hover:text-amber-300'
                            }`}
                            title={isSpecsOpen ? 'Hide specifications' : 'View specifications'}
                          >
                            ⚡
                          </button>
                        )}
                        {isEditing ? (
                          <button
                            onClick={() => toggleEdit(c.component_id)}
                            className="px-2.5 py-1 text-xs font-semibold text-emerald-400 bg-emerald-500/10 border border-emerald-500/30 rounded-lg hover:bg-emerald-500/20 transition-all"
                            title="Collapse row"
                          >
                            Done
                          </button>
                        ) : (
                          <button
                            onClick={() => toggleEdit(c.component_id)}
                            className={`px-2.5 py-1 text-xs font-semibold rounded-lg border transition-all ${
                              isDirty
                                ? 'text-amber-400 bg-amber-500/10 border-amber-500/30 hover:bg-amber-500/20'
                                : 'text-slate-400 bg-slate-800/60 border-slate-700/60 hover:bg-slate-700 hover:text-white'
                            }`}
                            title="Edit row"
                          >
                            ✎
                          </button>
                        )}
                        {isDirty && (
                          <button
                            onClick={() => discardRow(c.component_id)}
                            className="px-2.5 py-1 text-xs font-semibold text-red-400 bg-red-500/10 border border-red-500/30 rounded-lg hover:bg-red-500/20 transition-all"
                            title="Discard this row's changes"
                          >
                            ✕
                          </button>
                        )}
                        {onDelete && (
                          confirmDeleteId === c.component_id ? (
                            <div className="flex gap-1 items-center">
                              <span className="text-[11px] text-red-400">Delete?</span>
                              <button
                                onClick={() => handleDelete(c.component_id)}
                                disabled={deleting}
                                className="px-2 py-1 text-xs font-bold text-white bg-red-600 hover:bg-red-500 rounded-lg transition-all disabled:opacity-50"
                                title="Confirm delete"
                              >
                                {deleting ? '…' : 'Yes'}
                              </button>
                              <button
                                onClick={() => setConfirmDeleteId(null)}
                                disabled={deleting}
                                className="px-2 py-1 text-xs font-semibold text-slate-400 bg-slate-800 border border-slate-700 rounded-lg hover:bg-slate-700 transition-all disabled:opacity-50"
                              >
                                No
                              </button>
                            </div>
                          ) : (
                            <button
                              onClick={() => setConfirmDeleteId(c.component_id)}
                              className="px-2.5 py-1 text-xs font-semibold text-red-400/70 bg-transparent border border-transparent rounded-lg hover:bg-red-500/10 hover:border-red-500/30 hover:text-red-400 transition-all"
                              title="Delete component"
                            >
                              🗑
                            </button>
                          )
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}
              {paddingBottom > 0 && (
                <tr><td colSpan={9} style={{ height: `${paddingBottom}px`, padding: 0 }} /></tr>
              )}
            </tbody>
                );
              })()}
          </table>
        )}
      </div>

      {/* Sticky save footer */}
      {dirtyCount > 0 && (
        <div className="border-t border-amber-500/20 bg-amber-500/5 px-5 py-4 flex items-center justify-between rounded-b-2xl flex-wrap gap-3">
          <p className="text-sm text-amber-300 font-semibold">
            {dirtyCount} component{dirtyCount !== 1 ? 's' : ''} ready to save
          </p>
          <div className="flex gap-2">
            <button
              onClick={discardAll}
              disabled={saving}
              className="px-4 py-2 text-xs font-semibold bg-slate-800 hover:bg-slate-700 text-slate-300 border border-slate-700 rounded-lg transition-all disabled:opacity-50"
            >
              Discard All
            </button>
            <button
              onClick={handleSaveAll}
              disabled={saving}
              className="flex items-center gap-2 px-5 py-2 text-sm font-bold bg-emerald-600 hover:bg-emerald-500 text-white rounded-xl shadow-lg shadow-emerald-900/20 transition-all disabled:opacity-50"
            >
              {saving ? (
                <><Spinner className="w-4 h-4" /> Saving...</>
              ) : (
                'Save All Changes'
              )}
            </button>
          </div>
        </div>
      )}
    </div>

      {/* ── Line-item association side panel (portal, sibling to main div) ─── */}
      {lineItemModalId && typeof document !== 'undefined' && createPortal(
        (() => {
          const comp = components.find((c) => c.component_id === lineItemModalId);
          if (!comp) return null;
          const items = quoteItems.filter((i) => i.component_id === lineItemModalId);
          const posByQuote = posByQuoteId;

          return (
            <>
              {/* Backdrop */}
              <div
                className="fixed inset-0 z-40 bg-black/50 backdrop-blur-sm"
                onClick={() => setLineItemModalId(null)}
              />
              {/* Side panel */}
              <div className="fixed inset-y-0 right-0 z-50 w-[540px] max-w-full flex flex-col bg-slate-900 border-l border-slate-700 shadow-2xl"
                style={{ animation: 'slideInRight 0.2s ease-out' }}
              >
                {/* Modal header */}
                <div className="flex items-center justify-between px-6 py-4 border-b border-slate-800">
                  <div>
                    <h3 className="text-base font-bold text-white">Quote Associations</h3>
                    <p className="text-xs text-slate-500 mt-0.5 font-mono">{comp.supplier_model}</p>
                  </div>
                  <button onClick={() => setLineItemModalId(null)} className="text-slate-500 hover:text-white transition-colors">
                    <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
                  </button>
                </div>

                {/* Modal body */}
                <div className="overflow-y-auto flex-1 px-6 py-4 space-y-3">
                  {/* Existing line items */}
                  {items.length === 0 && !newLineItem && (
                    <p className="text-sm text-slate-500 py-6 text-center">No quote associations yet.</p>
                  )}
                  {items.map((item) => {
                    const draft = (lineItemDraft[item.quote_line_id] ?? {}) as Partial<PriceQuoteLineItem>;
                    const eff = { ...item, ...draft };
                    const isDraftDirty = Object.keys(draft).length > 0;
                    const linkedPos = posByQuote.get(eff.quote_id) ?? [];
                    return (
                      <div key={item.quote_line_id} className={`rounded-xl border p-3 space-y-2 ${isDraftDirty ? 'border-amber-500/40 bg-amber-500/5' : 'border-slate-800 bg-slate-800/30'}`}>
                        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                          {/* Quote / PI */}
                          <div className="col-span-2 sm:col-span-1">
                            <label className="block text-[10px] text-slate-500 mb-1 uppercase tracking-wide">Quote (PI)</label>
                            <QuoteCombobox
                              quotes={quotes}
                              value={String(eff.quote_id)}
                              onChange={(id) => setLineItemDraft((prev) => ({ ...prev, [item.quote_line_id]: { ...prev[item.quote_line_id], quote_id: id as any } }))}
                            />
                          </div>
                          {/* Qty */}
                          <div>
                            <label className="block text-[10px] text-slate-500 mb-1 uppercase tracking-wide">Qty</label>
                            <input type="number" min={0} step="any"
                              value={eff.quantity}
                              onChange={(e) => setLineItemDraft((prev) => ({ ...prev, [item.quote_line_id]: { ...prev[item.quote_line_id], quantity: parseFloat(e.target.value) || 0 } }))}
                              className="w-full px-2 py-1.5 bg-slate-950 border border-slate-700 rounded-lg text-xs text-white focus:outline-none focus:border-blue-500"
                            />
                          </div>
                          {/* Unit price */}
                          <div>
                            <label className="block text-[10px] text-slate-500 mb-1 uppercase tracking-wide">Unit Price</label>
                            <input type="number" min={0} step="any"
                              value={eff.unit_price}
                              onChange={(e) => setLineItemDraft((prev) => ({ ...prev, [item.quote_line_id]: { ...prev[item.quote_line_id], unit_price: parseFloat(e.target.value) || 0 } }))}
                              className="w-full px-2 py-1.5 bg-slate-950 border border-slate-700 rounded-lg text-xs text-white focus:outline-none focus:border-blue-500"
                            />
                          </div>
                          {/* Currency */}
                          <div>
                            <label className="block text-[10px] text-slate-500 mb-1 uppercase tracking-wide">Currency</label>
                            <select
                              value={eff.currency}
                              onChange={(e) => setLineItemDraft((prev) => ({ ...prev, [item.quote_line_id]: { ...prev[item.quote_line_id], currency: e.target.value as any } }))}
                              className="w-full px-2 py-1.5 bg-slate-950 border border-slate-700 rounded-lg text-xs text-white focus:outline-none focus:border-blue-500"
                            >
                              {ENUMS.currency.map((c) => <option key={c} value={c}>{c}</option>)}
                            </select>
                          </div>
                        </div>
                        {/* Supplier description */}
                        <div>
                          <label className="block text-[10px] text-slate-500 mb-1 uppercase tracking-wide">Supplier Description</label>
                          <input type="text"
                            value={eff.supplier_description ?? ''}
                            onChange={(e) => setLineItemDraft((prev) => ({ ...prev, [item.quote_line_id]: { ...prev[item.quote_line_id], supplier_description: e.target.value || undefined } }))}
                            placeholder="Optional"
                            className="w-full px-2 py-1.5 bg-slate-950 border border-slate-700 rounded-lg text-xs text-white focus:outline-none focus:border-blue-500"
                          />
                        </div>
                        {/* Linked POs (read-only) + actions */}
                        <div className="flex items-center justify-between">
                          <div className="flex items-center gap-1 flex-wrap">
                            {linkedPos.length > 0 ? linkedPos.map((p) => (
                              <span key={p} className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-emerald-500/10 text-emerald-300 border border-emerald-500/20">{p}</span>
                            )) : <span className="text-[10px] text-slate-600">No PO linked</span>}
                          </div>
                          <div className="flex gap-1.5">
                            {isDraftDirty && (
                              <>
                                <button
                                  onClick={() => setLineItemDraft((prev) => { const n = { ...prev }; delete n[item.quote_line_id]; return n; })}
                                  className="px-2 py-1 text-[10px] text-slate-400 bg-slate-800 border border-slate-700 rounded hover:bg-slate-700 transition-all"
                                >Discard</button>
                                <button
                                  disabled={lineItemSaving}
                                  onClick={() => handleSaveLineItemDraft(item, draft)}
                                  className="px-2 py-1 text-[10px] font-semibold text-white bg-amber-600 hover:bg-amber-500 rounded transition-all disabled:opacity-50"
                                >Save</button>
                              </>
                            )}
                            {onDeleteLineItem && (
                              <button
                                disabled={lineItemSaving}
                                onClick={async () => { setLineItemSaving(true); try { await onDeleteLineItem(item.quote_line_id); } finally { setLineItemSaving(false); } }}
                                className="px-2 py-1 text-[10px] text-red-400/70 hover:text-red-400 hover:bg-red-500/10 rounded transition-all disabled:opacity-50"
                                title="Delete this line item"
                              >🗑</button>
                            )}
                          </div>
                        </div>
                      </div>
                    );
                  })}

                  {/* New line item row */}
                  {newLineItem ? (
                    <div className="rounded-xl border border-blue-500/30 bg-blue-500/5 p-3 space-y-2">
                      <p className="text-[11px] text-blue-400 font-semibold uppercase tracking-wide">New line item</p>
                      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                        <div className="col-span-2 sm:col-span-1">
                          <label className="block text-[10px] text-slate-500 mb-1 uppercase tracking-wide">Quote (PI)</label>
                          <QuoteCombobox
                            quotes={quotes}
                            value={newLineItem.quote_id}
                            onChange={(id) => setNewLineItem((p) => p && { ...p, quote_id: id })}
                          />
                        </div>
                        <div>
                          <label className="block text-[10px] text-slate-500 mb-1 uppercase tracking-wide">Qty</label>
                          <input type="number" min={0} step="any" placeholder="0"
                            value={newLineItem.quantity}
                            onChange={(e) => setNewLineItem((p) => p && { ...p, quantity: e.target.value })}
                            className="w-full px-2 py-1.5 bg-slate-950 border border-slate-700 rounded-lg text-xs text-white focus:outline-none focus:border-blue-500" />
                        </div>
                        <div>
                          <label className="block text-[10px] text-slate-500 mb-1 uppercase tracking-wide">Unit Price</label>
                          <input type="number" min={0} step="any" placeholder="0"
                            value={newLineItem.unit_price}
                            onChange={(e) => setNewLineItem((p) => p && { ...p, unit_price: e.target.value })}
                            className="w-full px-2 py-1.5 bg-slate-950 border border-slate-700 rounded-lg text-xs text-white focus:outline-none focus:border-blue-500" />
                        </div>
                        <div>
                          <label className="block text-[10px] text-slate-500 mb-1 uppercase tracking-wide">Currency</label>
                          <select value={newLineItem.currency}
                            onChange={(e) => setNewLineItem((p) => p && { ...p, currency: e.target.value })}
                            className="w-full px-2 py-1.5 bg-slate-950 border border-slate-700 rounded-lg text-xs text-white focus:outline-none focus:border-blue-500">
                            {ENUMS.currency.map((c) => <option key={c} value={c}>{c}</option>)}
                          </select>
                        </div>
                      </div>
                      <input type="text" placeholder="Supplier description (optional)"
                        value={newLineItem.supplier_description}
                        onChange={(e) => setNewLineItem((p) => p && { ...p, supplier_description: e.target.value })}
                        className="w-full px-2 py-1.5 bg-slate-950 border border-slate-700 rounded-lg text-xs text-white focus:outline-none focus:border-blue-500" />
                      <div className="flex gap-1.5 justify-end">
                        <button onClick={() => setNewLineItem(null)} className="px-3 py-1.5 text-xs text-slate-400 bg-slate-800 border border-slate-700 rounded-lg hover:bg-slate-700 transition-all">Cancel</button>
                        <button
                          disabled={lineItemSaving || !newLineItem.quote_id || !newLineItem.quantity || !newLineItem.unit_price}
                          onClick={() => handleAddNewLineItem(lineItemModalId)}
                          className="px-3 py-1.5 text-xs font-bold text-white bg-blue-600 hover:bg-blue-500 rounded-lg transition-all disabled:opacity-40 disabled:cursor-not-allowed"
                        >{lineItemSaving ? 'Saving…' : 'Add'}</button>
                      </div>
                    </div>
                  ) : (
                    <button
                      onClick={() => setNewLineItem({ quote_id: '', quantity: '', unit_price: '', currency: 'USD', supplier_description: '' })}
                      className="w-full py-2.5 text-xs text-slate-500 hover:text-blue-300 border border-dashed border-slate-800 hover:border-blue-500/40 rounded-xl transition-all"
                    >
                      + Add to a quote
                    </button>
                  )}
                </div>

                {/* Panel footer */}
                <div className="px-6 py-3 border-t border-slate-800 flex justify-end">
                  <button onClick={() => setLineItemModalId(null)} className="px-4 py-2 text-sm font-semibold text-slate-300 bg-slate-800 hover:bg-slate-700 border border-slate-700 rounded-lg transition-all">Close</button>
                </div>
              </div>
            </>
          );
        })(),
        document.body
      )}
      {/* Hover tooltip */}
      {hoveredTooltip && (
        <UsageTooltip
          quoteLines={quoteLinesByComponent.get(hoveredTooltip.id) ?? []}
          poLines={poLinesByComponent.get(hoveredTooltip.id) ?? []}
          style={hoveredTooltip.style}
        />
      )}
    </>
  );
}
