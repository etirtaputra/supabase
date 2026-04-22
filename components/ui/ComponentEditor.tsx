/**
 * Component Editor
 * Inline bulk editor for components with search, filter, sort, and before/after diff.
 */
'use client';

import React, { useState, useMemo, useRef, useEffect, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { Spinner } from './LoadingSkeleton';
import SpecRenderer from './SpecRenderer';
import type { Component, PriceQuoteLineItem, PriceQuote, PurchaseOrder, PurchaseLineItem, CompetitorPrice, POCost, ComponentLink } from '../../types/database';
import { PRINCIPAL_CATS, BALANCE_CATS, BANK_FEE_CATS, TAX_CATS } from '../../constants/costCategories';
import { ENUMS } from '../../constants/enums';

interface ComponentUsage {
  quoteCount: number;
  poCount: number;
  lineItemCount: number;
  piNumbers: string[];
  poNumbers: string[];
}

interface ComponentHistoryEntry {
  id: string;
  component_id: string;
  field_name: string;
  old_value: string | null;
  new_value: string | null;
  changed_at: string;
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
  poCosts?: POCost[];
  componentHistory?: ComponentHistoryEntry[];
  competitorPrices?: CompetitorPrice[];
  onDeleteCompetitorPrice?: (id: string) => Promise<void>;
  onUpdateCompetitorPrice?: (id: string, changes: Partial<CompetitorPrice>) => Promise<void>;
  componentLinks?: ComponentLink[];
  onAddComponentLink?: (link: Omit<ComponentLink, 'link_id' | 'created_at' | 'updated_at'>) => Promise<void>;
  onDeleteComponentLink?: (linkId: string) => Promise<void>;
}

type SortCol = 'supplier_model' | 'internal_description' | 'brand' | 'category' | 'updated_at' | 'quoteCount' | 'poCount' | 'lineItemCount' | 'priceDelta' | 'margin';
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
      className="inline-flex items-center justify-center w-5 h-5 rounded text-slate-600 hover:text-slate-300 hover:bg-white/10 transition-colors flex-shrink-0 mr-1 align-middle"
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
  onNavKeyDown?: (e: React.KeyboardEvent<HTMLInputElement>) => void;
  'data-rid'?: string;
  'data-fld'?: string;
}
function BrandInput({ value, onChange, suggestions, isDirty, onNavKeyDown, ...rest }: BrandInputProps) {
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
        onKeyDown={(e) => { handleKey(e); if (!open && e.key !== 'ArrowDown') onNavKeyDown?.(e); else if (e.key === 'Tab') onNavKeyDown?.(e); }}
        autoComplete="off"
        data-rid={(rest as any)['data-rid']}
        data-fld={(rest as any)['data-fld']}
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
    if (!q) return options.filter(Boolean);
    return options.filter((o) => o?.toLowerCase().includes(q));
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

// ── Search highlight (disabled — filtering already shows matches) ────────
function Highlight({ text }: { text: string | null | undefined; query: string }) {
  return <>{text ?? '—'}</>;
}

// ── Price change indicator ────────────────────────────────────────────────
// Expects lines already sorted oldest→newest (sparklineLinesByComponent)
function PriceDelta({ lines }: { lines: TooltipQuoteLine[] }) {
  if (lines.length < 2) return null;
  const prev = lines[lines.length - 2].unit_price;
  const last = lines[lines.length - 1].unit_price;
  if (prev <= 0 || last <= 0) return null;
  const pct = ((last - prev) / prev) * 100;
  if (Math.abs(pct) < 0.01) return null; // no meaningful change
  const up = pct > 0;
  return (
    <span className={`text-[10px] font-semibold tabular-nums flex-shrink-0 ${up ? 'text-red-400' : 'text-emerald-400'}`}>
      {up ? '▲' : '▼'} {Math.abs(pct).toFixed(1)}%
    </span>
  );
}

// ── Column visibility ─────────────────────────────────────────────────────
type ColKey = 'brand' | 'category' | 'lastPrice' | 'usage' | 'updated' | 'sellPrice';
const COL_LABELS: Record<ColKey, string> = { brand: 'Brand', category: 'Category', lastPrice: 'Last Price', usage: 'Usage', updated: 'Updated', sellPrice: 'Sell Price' };
const DEFAULT_COLS: Record<ColKey, boolean> = { brand: true, category: true, lastPrice: true, usage: true, updated: true, sellPrice: false };

// ── CSV import ─────────────────────────────────────────────────────────────
type ImportStep = 'upload' | 'map' | 'preview';
interface ImportPreviewRow {
  action: 'add' | 'update' | 'skip';
  fields: Partial<Component>;
  existing?: Component;
  changes?: Partial<Component>;
}
const IMPORT_FIELDS: Record<string, string> = {
  '': '— ignore —',
  supplier_model: 'Model / SKU',
  internal_description: 'Description',
  brand: 'Brand',
  category: 'Category',
};
const IMPORT_HEADER_MAP: Record<string, string> = {
  model: 'supplier_model', sku: 'supplier_model', 'supplier model': 'supplier_model',
  supplier_model: 'supplier_model', 'part number': 'supplier_model', 'part no': 'supplier_model', 'part#': 'supplier_model',
  description: 'internal_description', 'internal description': 'internal_description',
  internal_description: 'internal_description', desc: 'internal_description',
  brand: 'brand', manufacturer: 'brand', make: 'brand',
  category: 'category', type: 'category', 'product type': 'category', product_type: 'category',
};

// ── TUC helper (used by inspectData for both current and linked components) ──────
function computeComponentTUC(
  componentPoItems: PurchaseLineItem[],
  allPoItems: PurchaseLineItem[],
  pos: PurchaseOrder[],
  poCosts: POCost[],
): {
  lastPoTucIdr:  number | null;  // TUC of the most recent paid PO
  avgTucIdr:     number | null;  // Weighted average across all paid POs
  actualTucIdr:  number | null;  // max(last, avg) — conservative floor
  tucXr:         number | null;  // Exchange rate from latest paid PO
  paidPoCount:   number;         // Number of distinct paid POs
} {
  const poMap = new Map(pos.map((p) => [p.po_id, p]));
  const allocs = componentPoItems.map((item) => {
    const po = poMap.get(item.po_id);
    if (!po) return null;
    const sisterItems = allPoItems.filter((i) => i.po_id === item.po_id && i.quantity > 0);
    const totalForeign = sisterItems.reduce((s, i) => s + i.unit_cost * i.quantity, 0);
    const share = totalForeign > 0 ? (item.unit_cost * item.quantity) / totalForeign : 0;
    const costs = poCosts.filter((c) => c.po_id === item.po_id);
    const hasBalance = costs.some((c) => BALANCE_CATS.has(c.cost_category));
    const principal = costs.filter((c) => PRINCIPAL_CATS.has(c.cost_category)).reduce((s, c) => s + c.amount, 0);
    const bankFees  = costs.filter((c) => BANK_FEE_CATS.has(c.cost_category)).reduce((s, c) => s + c.amount, 0);
    const landed    = costs.filter((c) => !PRINCIPAL_CATS.has(c.cost_category) && !BANK_FEE_CATS.has(c.cost_category) && !TAX_CATS.has(c.cost_category)).reduce((s, c) => s + c.amount, 0);
    const tuc = item.quantity > 0 ? (share * (principal + bankFees + landed)) / item.quantity : 0;
    return { tuc, qty: item.quantity, hasBalance, po };
  }).filter((a): a is { tuc: number; qty: number; hasBalance: boolean; po: PurchaseOrder } => a !== null);

  const paidAllocs = allocs.filter((a) => a.hasBalance && a.tuc > 0);
  const paidPoCount = new Set(paidAllocs.map((a) => a.po.po_id)).size;
  if (paidAllocs.length === 0)
    return { lastPoTucIdr: null, avgTucIdr: null, actualTucIdr: null, tucXr: null, paidPoCount: 0 };

  // Weighted average across all paid POs
  const weighted = paidAllocs.reduce((s, a) => s + a.tuc * a.qty, 0);
  const qty      = paidAllocs.reduce((s, a) => s + a.qty, 0);
  const avgTucIdr = qty > 0 ? weighted / qty : null;

  // Most recent paid PO
  const sortedByDate = [...paidAllocs].sort((a, b) => b.po.po_date.localeCompare(a.po.po_date));
  const latest = sortedByDate[0];
  const lastPoTucIdr = latest?.tuc ?? null;
  const tucXr        = latest?.po.exchange_rate ?? null;

  // Actual TUC = max(last, avg) — conservative: never let a cheaper latest PO
  // make you underestimate your cost floor
  const actualTucIdr =
    lastPoTucIdr != null && avgTucIdr != null ? Math.max(lastPoTucIdr, avgTucIdr) :
    lastPoTucIdr ?? avgTucIdr;

  return { lastPoTucIdr, avgTucIdr, actualTucIdr, tucXr, paidPoCount };
}

// Link type display metadata
const LINK_TYPE_META: Record<string, { label: string; color: string }> = {
  exact_model:         { label: 'Exact Model',     color: 'text-emerald-300 bg-emerald-500/10 border-emerald-500/30' },
  brand_equivalent:    { label: 'Brand Equiv.',    color: 'text-blue-300 bg-blue-500/10 border-blue-500/30' },
  normalized:          { label: 'Normalized',      color: 'text-violet-300 bg-violet-500/10 border-violet-500/30' },
  category_comparable: { label: 'Category Ref',    color: 'text-slate-300 bg-slate-700/40 border-slate-600/40' },
  successor:           { label: 'Successor',       color: 'text-amber-300 bg-amber-500/10 border-amber-500/30' },
};

const NORM_UNITS = ['Wp', 'kWh', 'kW', 'Ah', 'kg', 'unit'] as const;

// --- Main Component Editor ---
const EMPTY_ADD = { supplier_model: '', internal_description: '', brand: '', category: '', specifications: '' };

export default function ComponentEditor({ components, brandSuggestions, quoteItems = [], quotes = [], pos = [], poItems = [], poCosts = [], componentHistory, competitorPrices, onSave, onAdd, onAddSupplier, onDelete, onSaveLineItem, onDeleteLineItem, onDeleteCompetitorPrice, onUpdateCompetitorPrice, componentLinks, onAddComponentLink, onDeleteComponentLink }: ComponentEditorProps) {
  const [searchInput, setSearchInput] = useState('');
  const [search, setSearch] = useState('');
  const [filterBrand, setFilterBrand] = useState('');
  const [filterCategory, setFilterCategory] = useState('');
  const [filterPI, setFilterPI] = useState('');
  const [filterPO, setFilterPO] = useState('');
  const [filterUnused, setFilterUnused] = useState(false);
  const [filterDuplicates, setFilterDuplicates] = useState(false);
  const [filterHasIntel, setFilterHasIntel] = useState(false);
  const [filterLinked, setFilterLinked] = useState(false);
  const [filterHasSpecs, setFilterHasSpecs] = useState(false);
  const [filterLowMargin, setFilterLowMargin] = useState(false);
  const [marginThreshold, setMarginThreshold] = useState(20);
  const [filterBelowMarket, setFilterBelowMarket] = useState(false);
  const [visibleCols, setVisibleCols] = useState<Record<ColKey, boolean>>(() => {
    try {
      const saved = localStorage.getItem('componentEditor_cols');
      return saved ? { ...DEFAULT_COLS, ...JSON.parse(saved) } : DEFAULT_COLS;
    } catch { return DEFAULT_COLS; }
  });
  const [showColPicker, setShowColPicker] = useState(false);
  const [showFindReplace, setShowFindReplace] = useState(false);
  const [frField, setFrField] = useState<'supplier_model' | 'internal_description' | 'both'>('supplier_model');
  const [frFind, setFrFind] = useState('');
  const [frReplace, setFrReplace] = useState('');
  const [frMatchCase, setFrMatchCase] = useState(false);
  const [frUseRegex, setFrUseRegex] = useState(false);
  const [frPreviewing, setFrPreviewing] = useState(false);

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
        if (f.filterHasIntel) setFilterHasIntel(f.filterHasIntel);
        if (f.filterLinked) setFilterLinked(f.filterLinked);
        if (f.filterHasSpecs) setFilterHasSpecs(f.filterHasSpecs);
        if (f.filterLowMargin) setFilterLowMargin(f.filterLowMargin);
        if (f.marginThreshold != null) setMarginThreshold(f.marginThreshold);
        if (f.filterBelowMarket) setFilterBelowMarket(f.filterBelowMarket);
      }
    } catch {}
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Persist filters to localStorage whenever they change ─────────────────
  useEffect(() => {
    try {
      localStorage.setItem('componentEditor_filters', JSON.stringify({
        searchInput, filterBrand, filterCategory, filterPI, filterPO, filterUnused, filterDuplicates, filterHasIntel, filterLinked, filterHasSpecs, filterLowMargin, marginThreshold, filterBelowMarket,
      }));
    } catch {}
  }, [searchInput, filterBrand, filterCategory, filterPI, filterPO, filterUnused, filterDuplicates, filterHasIntel, filterLinked, filterHasSpecs, filterLowMargin, marginThreshold, filterBelowMarket]);

  // ── Persist column visibility ─────────────────────────────────────────────
  useEffect(() => {
    try { localStorage.setItem('componentEditor_cols', JSON.stringify(visibleCols)); } catch {}
  }, [visibleCols]);

  // Debounce search so heavy filtering doesn't block every keystroke
  useEffect(() => {
    const t = setTimeout(() => setSearch(searchInput), 150);
    return () => clearTimeout(t);
  }, [searchInput]);
  const [sortCol, setSortCol] = useState<SortCol>('updated_at');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc');
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
  const [specsOpenIds, setSpecsOpenIds] = useState<Set<string>>(new Set());
  const [lineItemModalId, setLineItemModalId] = useState<string | null>(null);
  const [lineItemDraft, setLineItemDraft] = useState<Record<number | string, Partial<PriceQuoteLineItem>>>({});
  const [newLineItem, setNewLineItem] = useState<{ quote_id: string; quantity: string; unit_price: string; currency: string; supplier_description: string } | null>(null);
  const [lineItemSaving, setLineItemSaving] = useState(false);
  const [hoveredTooltip, setHoveredTooltip] = useState<{ id: string; style: React.CSSProperties } | null>(null);
  const [showAddForm, setShowAddForm] = useState(false);
  const [addDraft, setAddDraft] = useState(EMPTY_ADD);
  const [addSaving, setAddSaving] = useState(false);
  // ── CSV import ────────────────────────────────────────────────────────────
  const [importStep, setImportStep] = useState<ImportStep | null>(null);
  const [importRows, setImportRows] = useState<string[][]>([]);
  const [importMapping, setImportMapping] = useState<Record<number, string>>({});
  const [importProcessing, setImportProcessing] = useState(false);
  const [importDragOver, setImportDragOver] = useState(false);
  // ── Inspect panel ─────────────────────────────────────────────────────────
  const [inspectId, setInspectId] = useState<string | null>(null);
  const [inspectTab, setInspectTab] = useState<'costs' | 'intel' | 'log' | 'linked'>('costs');
  const [editingIntelId, setEditingIntelId] = useState<string | null>(null);
  const [intelEditDraft, setIntelEditDraft] = useState<Partial<CompetitorPrice>>({});
  const [confirmDeleteIntelId, setConfirmDeleteIntelId] = useState<string | null>(null);
  const [intelSaving, setIntelSaving] = useState(false);
  // ── Add-link form state ───────────────────────────────────────────────────
  const [showAddLink, setShowAddLink] = useState(false);
  const [addLinkSearch, setAddLinkSearch] = useState('');
  const [addLinkTarget, setAddLinkTarget] = useState<Component | null>(null);
  const [addLinkType, setAddLinkType] = useState('category_comparable');
  const [addLinkNormUnit, setAddLinkNormUnit] = useState('Wp');
  const [addLinkNormA, setAddLinkNormA] = useState('');
  const [addLinkNormB, setAddLinkNormB] = useState('');
  const [addLinkNotes, setAddLinkNotes] = useState('');
  const [addLinkSaving, setAddLinkSaving] = useState(false);
  const [confirmDeleteLinkId, setConfirmDeleteLinkId] = useState<string | null>(null);
  // ── Hover preview popup ──────────────────────────────────────────────────
  const [hoverPreviewId, setHoverPreviewId] = useState<string | null>(null);
  const [hoverRect, setHoverRect] = useState<DOMRect | null>(null);
  const hoverTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // ── Copy-row flash ────────────────────────────────────────────────────────
  const [copiedRowId, setCopiedRowId] = useState<string | null>(null);

  // ── Per-component usage stats ──────────────────────────────────────────────
  const usageMap = useMemo<Map<string, ComponentUsage>>(() => {
    // Build lookup: quote_id → pi_number
    const piByQuote = new Map<number, string>();
    quotes.forEach((q) => { if (q.pi_number) piByQuote.set(q.quote_id, q.pi_number); });

    // Build lookup: quote_id → po_numbers[]
    const posByQuote = new Map<number, string[]>();
    pos.forEach((po) => {
      if (po.quote_id == null || !po.po_number) return;
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
        poCount: poNums.get(cid)?.size ?? 0,
        lineItemCount: lineCounts.get(cid) ?? 0,
        piNumbers: [...(piNums.get(cid) ?? [])].sort(),
        poNumbers: [...(poNums.get(cid) ?? [])].sort(),
      });
    });
    return map;
  }, [quoteItems, quotes, pos]);

  // ── Tooltip quote lines + last quoted price (single pass over quoteItems) ───
  const { quoteLinesByComponent, lastQuoteByComponent, sparklineLinesByComponent } = useMemo(() => {
    const SKIP_STATUSES = new Set(['Replaced', 'Rejected', 'Cancelled']);
    const quoteMap = new Map(quotes.map((q) => [q.quote_id, q]));
    const linesMap = new Map<string, TooltipQuoteLine[]>();
    const lastMap = new Map<string, { price: number; currency: string; date: string }>();
    quoteItems.forEach((item) => {
      if (!item.component_id) return;
      const q = quoteMap.get(item.quote_id);
      if (!q || SKIP_STATUSES.has(q.status ?? '')) return;
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
    // Sparkline: one entry per (component, quote) pair — first non-zero price seen,
    // sorted oldest→newest. This prevents multi-line-item quotes from creating false deltas.
    const sparkMap = new Map<string, TooltipQuoteLine[]>();
    const seenQuote = new Map<string, Set<number>>();
    quoteItems.forEach((item) => {
      if (!item.component_id || item.unit_price <= 0) return;
      const q = quoteMap.get(item.quote_id);
      if (!q || SKIP_STATUSES.has(q.status ?? '')) return;
      const cid = item.component_id;
      if (!seenQuote.has(cid)) seenQuote.set(cid, new Set());
      if (seenQuote.get(cid)!.has(item.quote_id)) return; // already have a price for this quote
      seenQuote.get(cid)!.add(item.quote_id);
      if (!sparkMap.has(cid)) sparkMap.set(cid, []);
      sparkMap.get(cid)!.push({ pi_number: q.pi_number, quote_date: q.quote_date, quantity: item.quantity, unit_price: item.unit_price, currency: item.currency });
    });
    sparkMap.forEach((lines, cid) => {
      sparkMap.set(cid, [...lines].sort((a, b) => (a.quote_date || '').localeCompare(b.quote_date || '')));
    });
    // Tooltip caps at 5 most recent
    linesMap.forEach((lines, cid) => {
      linesMap.set(cid, [...lines].sort((a, b) => (b.quote_date || '').localeCompare(a.quote_date || '')).slice(0, 5));
    });
    return { quoteLinesByComponent: linesMap, lastQuoteByComponent: lastMap, sparklineLinesByComponent: sparkMap };
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

  // ── Bulk TUC per component (single-pass, no per-component O(n) scan) ────────
  const tucByComponent = useMemo(() => {
    const poMap = new Map(pos.map((p) => [String(p.po_id), p]));
    // Pre-group poItems and poCosts by po_id
    const itemsByPO = new Map<string, PurchaseLineItem[]>();
    poItems.forEach((i) => {
      const k = String(i.po_id);
      if (!itemsByPO.has(k)) itemsByPO.set(k, []);
      itemsByPO.get(k)!.push(i);
    });
    const costsByPO = new Map<string, POCost[]>();
    (poCosts ?? []).forEach((c) => {
      const k = String(c.po_id);
      if (!costsByPO.has(k)) costsByPO.set(k, []);
      costsByPO.get(k)!.push(c);
    });
    // Per-PO derived values
    interface POSummary { totalForeign: number; hasBalance: boolean; principal: number; bankFees: number; landed: number; date: string; xr: number | null; }
    const poSummary = new Map<string, POSummary>();
    itemsByPO.forEach((items, poId) => {
      const po = poMap.get(poId); if (!po) return;
      const totalForeign = items.reduce((s, i) => s + i.unit_cost * i.quantity, 0);
      const costs = costsByPO.get(poId) ?? [];
      const hasBalance = costs.some((c) => BALANCE_CATS.has(c.cost_category));
      const principal = costs.filter((c) => PRINCIPAL_CATS.has(c.cost_category)).reduce((s, c) => s + c.amount, 0);
      const bankFees  = costs.filter((c) => BANK_FEE_CATS.has(c.cost_category)).reduce((s, c) => s + c.amount, 0);
      const landed    = costs.filter((c) => !PRINCIPAL_CATS.has(c.cost_category) && !BANK_FEE_CATS.has(c.cost_category) && !TAX_CATS.has(c.cost_category)).reduce((s, c) => s + c.amount, 0);
      poSummary.set(poId, { totalForeign, hasBalance, principal, bankFees, landed, date: po.po_date, xr: po.exchange_rate ?? null });
    });
    // Accumulate per-component
    interface CompAcc { wSum: number; wQty: number; latestTuc: number; latestDate: string; latestXr: number | null; }
    const acc = new Map<string, CompAcc>();
    poItems.forEach((item) => {
      if (!item.component_id || item.quantity <= 0) return;
      const ps = poSummary.get(String(item.po_id));
      if (!ps || !ps.hasBalance || ps.totalForeign <= 0) return;
      const share = (item.unit_cost * item.quantity) / ps.totalForeign;
      const tuc = (share * (ps.principal + ps.bankFees + ps.landed)) / item.quantity;
      if (tuc <= 0) return;
      if (!acc.has(item.component_id)) acc.set(item.component_id, { wSum: 0, wQty: 0, latestTuc: 0, latestDate: '', latestXr: null });
      const a = acc.get(item.component_id)!;
      a.wSum += tuc * item.quantity; a.wQty += item.quantity;
      if (ps.date > a.latestDate) { a.latestDate = ps.date; a.latestTuc = tuc; a.latestXr = ps.xr; }
    });
    const result = new Map<string, { actualTucIdr: number; tucXr: number | null; latestPoDate: string }>();
    acc.forEach((a, cid) => {
      if (a.wQty <= 0) return;
      const avgTuc = a.wSum / a.wQty;
      result.set(cid, { actualTucIdr: Math.max(a.latestTuc, avgTuc), tucXr: a.latestXr, latestPoDate: a.latestDate });
    });
    return result;
  }, [poItems, pos, poCosts]);

  // ── PO number lookup by quote_id (used in line-item modal) ──────────────────
  const posByQuoteId = useMemo(() => {
    const map = new Map<number, string[]>();
    pos.forEach((po) => {
      if (po.quote_id == null) return;
      map.set(po.quote_id, [...(map.get(po.quote_id) ?? []), po.po_number]);
    });
    return map;
  }, [pos]);


  // ── Component IDs that have at least one market intel entry ──────────────
  const intelComponentIds = useMemo(() => {
    const s = new Set<string>();
    (competitorPrices ?? []).forEach((cp) => { if (cp.component_id) s.add(cp.component_id); });
    return s;
  }, [competitorPrices]);

  // ── Confidence-weighted market avg (USD) per component ───────────────────
  const CONF_WEIGHT: Record<string, number> = { high: 1.0, medium: 0.6, low: 0.3 };
  const marketAvgUsdByComponent = useMemo(() => {
    const map = new Map<string, number>();
    if (!competitorPrices?.length) return map;
    // Group by component_id
    const byComp = new Map<string, typeof competitorPrices>();
    competitorPrices.forEach((cp) => {
      if (!cp.component_id || cp.unit_price <= 0 || cp.currency === 'RMB') return;
      if (!byComp.has(cp.component_id)) byComp.set(cp.component_id, []);
      byComp.get(cp.component_id)!.push(cp);
    });
    byComp.forEach((prices, cid) => {
      const tucInfo = tucByComponent.get(cid);
      const xr = tucInfo?.tucXr ?? 16500;
      let wSum = 0, wTotal = 0;
      prices.forEach((cp) => {
        const usd = cp.currency === 'IDR' ? cp.unit_price / xr : cp.unit_price;
        const w = CONF_WEIGHT[cp.confidence ?? 'low'] ?? 0.3;
        wSum += usd * w; wTotal += w;
      });
      if (wTotal > 0) map.set(cid, wSum / wTotal);
    });
    return map;
  }, [competitorPrices, tucByComponent]);

  // ── Gross margin % per component (needs both sell price and TUC) ──────────
  const marginByComponent = useMemo(() => {
    const map = new Map<string, number>();
    components.forEach((c) => {
      if (!c.selling_price_usd) return;
      const tucInfo = tucByComponent.get(c.component_id);
      if (!tucInfo?.tucXr) return;
      const sellIdr = c.selling_price_usd * tucInfo.tucXr;
      if (sellIdr <= 0) return;
      map.set(c.component_id, ((sellIdr - tucInfo.actualTucIdr) / sellIdr) * 100);
    });
    return map;
  }, [components, tucByComponent]);

  // ── Component IDs that have at least one equivalency link ────────────────
  const linkedComponentIds = useMemo(() => {
    const s = new Set<string>();
    (componentLinks ?? []).forEach((l) => { s.add(l.component_id_a); s.add(l.component_id_b); });
    return s;
  }, [componentLinks]);

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

  const uniqueModels = useMemo(
    () => [...new Set(components.map((c) => c.supplier_model?.trim()).filter(Boolean))].sort() as string[],
    [components]
  );

  const uniqueDescriptions = useMemo(
    () => [...new Set(components.map((c) => c.internal_description?.trim()).filter(Boolean))].sort() as string[],
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
    if (filterHasIntel) result = result.filter((c) => intelComponentIds.has(c.component_id));
    if (filterLinked) result = result.filter((c) => linkedComponentIds.has(c.component_id));
    if (filterHasSpecs) result = result.filter((c) => {
      const s = c.specifications;
      if (!s) return false;
      if (typeof s === 'object') return Object.keys(s as object).length > 0;
      if (typeof s === 'string') { try { const p = JSON.parse(s); return p && typeof p === 'object' && Object.keys(p).length > 0; } catch { return false; } }
      return false;
    });
    if (filterLowMargin) result = result.filter((c) => {
      if (!c.selling_price_usd) return false;
      const gm = marginByComponent.get(c.component_id);
      return gm != null && gm < marginThreshold;
    });
    if (filterBelowMarket) result = result.filter((c) => {
      if (!c.selling_price_usd) return false;
      const mktUsd = marketAvgUsdByComponent.get(c.component_id);
      return mktUsd != null && c.selling_price_usd < mktUsd;
    });
    return [...result].sort((a, b) => {
      if (sortCol === 'updated_at') {
        const av = a[sortCol] ? new Date(a[sortCol] as string).getTime() : 0;
        const bv = b[sortCol] ? new Date(b[sortCol] as string).getTime() : 0;
        return sortDir === 'asc' ? av - bv : bv - av;
      }
      if (sortCol === 'quoteCount' || sortCol === 'poCount' || sortCol === 'lineItemCount') {
        const au = usageMap.get(String(a.component_id));
        const bu = usageMap.get(String(b.component_id));
        const av = au ? au[sortCol] : 0;
        const bv = bu ? bu[sortCol] : 0;
        return sortDir === 'asc' ? av - bv : bv - av;
      }
      if (sortCol === 'priceDelta') {
        const getDelta = (c: Component) => {
          const lines = sparklineLinesByComponent.get(c.component_id) ?? [];
          if (lines.length < 2 || lines[lines.length - 2].unit_price === 0) return null;
          return ((lines[lines.length - 1].unit_price - lines[lines.length - 2].unit_price) / lines[lines.length - 2].unit_price) * 100;
        };
        const sentinel = sortDir === 'asc' ? Infinity : -Infinity;
        const av = getDelta(a) ?? sentinel;
        const bv = getDelta(b) ?? sentinel;
        return sortDir === 'asc' ? av - bv : bv - av;
      }
      if (sortCol === 'margin') {
        const sentinel = sortDir === 'asc' ? Infinity : -Infinity;
        const av = marginByComponent.get(a.component_id) ?? sentinel;
        const bv = marginByComponent.get(b.component_id) ?? sentinel;
        return sortDir === 'asc' ? av - bv : bv - av;
      }
      const av = ((a[sortCol as keyof Component] as string) || '').toLowerCase();
      const bv = ((b[sortCol as keyof Component] as string) || '').toLowerCase();
      return sortDir === 'asc' ? av.localeCompare(bv) : bv.localeCompare(av);
    });
  }, [components, search, filterBrand, filterCategory, filterPI, filterPO, filterUnused, filterDuplicates, filterHasIntel, filterLinked, filterHasSpecs, filterLowMargin, marginThreshold, filterBelowMarket, sortCol, sortDir, usageMap, duplicateModels, intelComponentIds, linkedComponentIds, sparklineLinesByComponent, marginByComponent, marketAvgUsdByComponent]);

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
    setFilterUnused(false); setFilterDuplicates(false); setFilterHasIntel(false); setFilterLinked(false); setFilterHasSpecs(false);
    setFilterLowMargin(false); setFilterBelowMarket(false);
  };

  // ── Find & Replace logic ──────────────────────────────────────────────────
  const fieldsToSearch = frField === 'both'
    ? ['supplier_model', 'internal_description'] as const
    : [frField] as const;

  const applyReplaceToValue = useCallback((val: string) => {
    if (!val) return val;
    try {
      if (frUseRegex) {
        const regex = new RegExp(frFind, frMatchCase ? 'g' : 'gi');
        return val.replace(regex, frReplace);
      } else {
        const src = frMatchCase ? val : val.toLowerCase();
        const find = frMatchCase ? frFind : frFind.toLowerCase();
        let result = val;
        let offset = 0;
        let idx: number;
        while ((idx = src.indexOf(find, offset)) >= 0) {
          result = result.slice(0, idx) + frReplace + result.slice(idx + frFind.length);
          offset = idx + frReplace.length;
          if (!frReplace.length && offset === idx) break;
        }
        return result;
      }
    } catch { return val; }
  }, [frFind, frReplace, frMatchCase, frUseRegex]);

  const getFindMatches = useCallback(() => {
    if (!frFind) return [];
    try {
      return filtered.filter(c =>
        fieldsToSearch.some(f => {
          const val = frMatchCase ? (c[f] || '') : (c[f] || '').toLowerCase();
          const find = frMatchCase ? frFind : frFind.toLowerCase();
          if (frUseRegex) return new RegExp(frFind, frMatchCase ? '' : 'i').test(c[f] || '');
          return val.includes(find);
        })
      );
    } catch { return []; }
  }, [filtered, fieldsToSearch, frFind, frMatchCase, frUseRegex]);

  const getReplacePreview = useCallback((comp: Component) => {
    return fieldsToSearch.map(f => ({
      field: f,
      before: comp[f] || '',
      after: applyReplaceToValue(comp[f] || ''),
    })).filter(x => x.before !== x.after);
  }, [fieldsToSearch, applyReplaceToValue]);

  const handleReplaceAll = () => {
    const matches = getFindMatches();
    if (!matches.length) return;
    matches.forEach(comp => {
      fieldsToSearch.forEach(f => {
        const newVal = applyReplaceToValue(comp[f] || '');
        if (newVal !== (comp[f] || '')) setField(comp, f, newVal);
      });
    });
    setShowFindReplace(false);
    setFrFind(''); setFrReplace('');
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
      // Ctrl/Cmd+H → open find & replace
      if ((e.ctrlKey || e.metaKey) && e.key === 'h') {
        e.preventDefault();
        setShowFindReplace(true);
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

  // ── Row keyboard navigation (Tab / Enter / Escape while editing) ─────────
  const NAV_FIELDS = ['supplier_model', 'internal_description', 'brand', 'category'] as const;
  const handleCellKeyDown = (
    e: React.KeyboardEvent<HTMLInputElement | HTMLSelectElement>,
    componentId: string,
    field: typeof NAV_FIELDS[number],
  ) => {
    if (e.key === 'Escape') {
      discardRow(componentId);
      return;
    }
    if (e.key === 'Enter') {
      e.preventDefault();
      setEditingIds((prev) => { const n = new Set(prev); n.delete(componentId); return n; });
      const idx = filtered.findIndex((c) => c.component_id === componentId);
      if (idx >= 0 && idx < filtered.length - 1) {
        const nextId = filtered[idx + 1].component_id;
        setEditingIds((prev) => { const n = new Set(prev); n.add(nextId); return n; });
        setTimeout(() => {
          (document.querySelector(`[data-rid="${nextId}"][data-fld="supplier_model"]`) as HTMLElement)?.focus();
        }, 0);
      }
      return;
    }
    if (e.key === 'Tab') {
      const fi = NAV_FIELDS.indexOf(field);
      if (!e.shiftKey && fi < NAV_FIELDS.length - 1) {
        e.preventDefault();
        (document.querySelector(`[data-rid="${componentId}"][data-fld="${NAV_FIELDS[fi + 1]}"]`) as HTMLElement)?.focus();
      } else if (e.shiftKey && fi > 0) {
        e.preventDefault();
        (document.querySelector(`[data-rid="${componentId}"][data-fld="${NAV_FIELDS[fi - 1]}"]`) as HTMLElement)?.focus();
      }
    }
  };

  // ── CSV parser (handles quoted fields + CRLF) ─────────────────────────────
  const parseCSV = (text: string): string[][] => {
    const rows: string[][] = [];
    let cur = ''; let inQ = false; let row: string[] = [];
    for (let i = 0; i < text.length; i++) {
      const ch = text[i];
      if (inQ) {
        if (ch === '"') { if (text[i + 1] === '"') { cur += '"'; i++; } else inQ = false; }
        else cur += ch;
      } else if (ch === '"') { inQ = true; }
      else if (ch === ',') { row.push(cur); cur = ''; }
      else if (ch === '\n' || ch === '\r') {
        if (ch === '\r' && text[i + 1] === '\n') i++;
        row.push(cur); cur = '';
        if (row.some((c) => c.trim())) rows.push(row);
        row = [];
      } else { cur += ch; }
    }
    row.push(cur);
    if (row.some((c) => c.trim())) rows.push(row);
    return rows;
  };

  const handleImportFile = (file: File) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      const text = (e.target?.result as string) || '';
      const rows = parseCSV(text);
      if (rows.length < 2) return;
      const headers = rows[0];
      const autoMap: Record<number, string> = {};
      headers.forEach((h, i) => { autoMap[i] = IMPORT_HEADER_MAP[h.toLowerCase().trim()] || ''; });
      setImportRows(rows);
      setImportMapping(autoMap);
      setImportStep('map');
    };
    reader.readAsText(file);
  };

  const importPreview = useMemo((): ImportPreviewRow[] => {
    if (importStep !== 'preview' || !importRows.length) return [];
    const dataRows = importRows.slice(1);
    return dataRows.map((row) => {
      const fields: Partial<Component> = {};
      Object.entries(importMapping).forEach(([idxStr, field]) => {
        if (!field) return;
        const val = row[Number(idxStr)]?.trim();
        if (val) (fields as any)[field] = val;
      });
      if (!fields.supplier_model) return null;
      const existing = components.find((c) => c.supplier_model?.toLowerCase().trim() === fields.supplier_model!.toLowerCase().trim());
      if (existing) {
        const changes: Partial<Component> = {};
        (['internal_description', 'brand', 'category'] as const).forEach((f) => {
          if (f in fields && (fields as any)[f] !== existing[f]) (changes as any)[f] = (fields as any)[f];
        });
        return Object.keys(changes).length === 0
          ? { action: 'skip' as const, fields, existing }
          : { action: 'update' as const, fields, existing, changes };
      }
      return { action: 'add' as const, fields };
    }).filter(Boolean) as ImportPreviewRow[];
  }, [importStep, importRows, importMapping, components]);

  const handleImportCommit = async () => {
    if (importProcessing) return;
    setImportProcessing(true);
    try {
      const adds = importPreview.filter((r) => r.action === 'add');
      const updates = importPreview.filter((r) => r.action === 'update');
      if (onAdd) {
        for (const r of adds) {
          await onAdd({
            supplier_model: r.fields.supplier_model!,
            internal_description: r.fields.internal_description || r.fields.supplier_model!,
            brand: (r.fields.brand as any) || null,
            category: (r.fields.category as any) || null,
            specifications: undefined as any,
          });
        }
      }
      if (updates.length > 0) {
        await onSave(updates.map((r) => ({ component_id: r.existing!.component_id, changes: r.changes! })));
      }
      setImportStep(null);
      setImportRows([]);
      setImportMapping({});
    } finally { setImportProcessing(false); }
  };

  const copyRow = (c: Component) => {
    const lq = lastQuoteByComponent.get(c.component_id);
    const text = [
      c.supplier_model ?? '',
      c.internal_description ?? '',
      c.brand ?? '',
      c.category ?? '',
      lq ? `${lq.currency} ${lq.price.toFixed(2)}` : '',
    ].join('\t');
    navigator.clipboard.writeText(text).then(() => {
      setCopiedRowId(c.component_id);
      setTimeout(() => setCopiedRowId(null), 1400);
    });
  };

  // ── Hover preview data ───────────────────────────────────────────────────
  const hoverData = useMemo(() => {
    if (!hoverPreviewId) return null;
    const comp = components.find((c) => c.component_id === hoverPreviewId);
    if (!comp) return null;
    const myPoItems = poItems.filter((i) => i.component_id === hoverPreviewId);
    const { lastPoTucIdr, avgTucIdr, actualTucIdr, tucXr, paidPoCount } = computeComponentTUC(myPoItems, poItems, pos, poCosts);
    const lq = lastQuoteByComponent.get(hoverPreviewId) ?? null;
    const usage = usageMap.get(hoverPreviewId) ?? null;
    const latestIntel = (competitorPrices ?? [])
      .filter((cp) => cp.component_id === hoverPreviewId)
      .sort((a, b) => b.observed_at.localeCompare(a.observed_at))
      .slice(0, 2);
    return { comp, lastPoTucIdr, avgTucIdr, actualTucIdr, tucXr, paidPoCount, lq, usage, latestIntel };
  }, [hoverPreviewId, components, poItems, pos, poCosts, lastQuoteByComponent, usageMap, competitorPrices]);

  // ── Inspect panel data ───────────────────────────────────────────────────
  const inspectData = useMemo(() => {
    if (!inspectId) return null;
    const comp = components.find((c) => c.component_id === inspectId);
    if (!comp) return null;

    // ── Quote lines ──────────────────────────────────────────────────────
    const quoteMap = new Map(quotes.map((q) => [q.quote_id, q]));
    const allQuoteLines: TooltipQuoteLine[] = [];
    quoteItems.forEach((item) => {
      if (item.component_id !== inspectId) return;
      const q = quoteMap.get(item.quote_id);
      allQuoteLines.push({ pi_number: q?.pi_number, quote_date: q?.quote_date, quantity: item.quantity, unit_price: item.unit_price, currency: item.currency });
    });
    allQuoteLines.sort((a, b) => (b.quote_date || '').localeCompare(a.quote_date || ''));

    // ── PO lines ─────────────────────────────────────────────────────────
    const poMap = new Map(pos.map((p) => [p.po_id, p]));
    const allPOLines: TooltipPOLine[] = [];
    const myPoItems = poItems.filter((item) => item.component_id === inspectId);
    myPoItems.forEach((item) => {
      const po = poMap.get(item.po_id);
      if (!po) return;
      allPOLines.push({ po_number: po.po_number, po_date: po.po_date, quantity: item.quantity, unit_cost: item.unit_cost, currency: item.currency });
    });
    allPOLines.sort((a, b) => (b.po_date || '').localeCompare(a.po_date || ''));

    // ── TUC ──────────────────────────────────────────────────────────────
    const { lastPoTucIdr, avgTucIdr, actualTucIdr, tucXr, paidPoCount } = computeComponentTUC(myPoItems, poItems, pos, poCosts);
    const tucIdr = actualTucIdr; // alias for downstream code (last-received, linked deltas)

    // ── Last received + lead time ─────────────────────────────────────────
    const myPoIds = new Set(myPoItems.map((i) => i.po_id));
    const receivedPos = pos.filter((p) => myPoIds.has(p.po_id) && p.actual_received_date && p.status === 'Fully Received')
      .sort((a, b) => b.actual_received_date!.localeCompare(a.actual_received_date!));
    const lastReceivedPo = receivedPos[0] ?? null;
    let leadTime: { fromQuote: number | null; fromPO: number | null; fromPayment: number | null } | null = null;
    if (lastReceivedPo?.actual_received_date) {
      const recDate = new Date(lastReceivedPo.actual_received_date);
      const diffDays = (d: string) => Math.round((recDate.getTime() - new Date(d).getTime()) / 86_400_000);
      const linkedQuote = lastReceivedPo.quote_id ? quotes.find((q) => q.quote_id === lastReceivedPo.quote_id) : null;
      const payments = poCosts.filter((c) => c.po_id === lastReceivedPo.po_id && c.payment_date).sort((a, b) => a.payment_date! < b.payment_date! ? -1 : 1);
      leadTime = {
        fromQuote: linkedQuote?.quote_date ? diffDays(linkedQuote.quote_date) : null,
        fromPO: lastReceivedPo.po_date ? diffDays(lastReceivedPo.po_date) : null,
        fromPayment: payments[0]?.payment_date ? diffDays(payments[0].payment_date) : null,
      };
    }

    // ── Competitor prices ─────────────────────────────────────────────────
    const compPrices = (competitorPrices ?? [])
      .filter((cp) => cp.component_id === inspectId)
      .sort((a, b) => b.observed_at.localeCompare(a.observed_at));

    // ── Change log ────────────────────────────────────────────────────────
    const histEntries = (componentHistory ?? []).filter((h) => h.component_id === inspectId);
    const histGroups = new Map<string, ComponentHistoryEntry[]>();
    histEntries.forEach((e) => {
      const key = e.changed_at.slice(0, 19);
      if (!histGroups.has(key)) histGroups.set(key, []);
      histGroups.get(key)!.push(e);
    });
    const histTimeline = [...histGroups.entries()].sort((a, b) => b[0].localeCompare(a[0]));

    // ── Linked components ──────────────────────────────────────────────────
    type LinkedCompData = {
      link: ComponentLink;
      comp: Component;
      tucIdr: number | null;
      tucXr: number | null;
      intel: CompetitorPrice[];
      normValueSelf: number | null;   // capacity value of the *current* component
      normValueOther: number | null;  // capacity value of the *linked* component
      lastQuoteOther: { price: number; currency: string } | null;
      isInverted?: boolean;           // true if components are in wrong order in DB
    };
    const myLinks = (componentLinks ?? []).filter(
      (l) => l.component_id_a === inspectId || l.component_id_b === inspectId,
    );
    const linkedComps: LinkedCompData[] = myLinks.map((link): LinkedCompData | null => {
      const isA = link.component_id_a === inspectId;
      const otherId = isA ? link.component_id_b : link.component_id_a;
      const otherComp = components.find((c) => c.component_id === otherId);
      if (!otherComp) return null;
      const otherPoItems = poItems.filter((i) => i.component_id === otherId);
      const { actualTucIdr: otherTuc, tucXr: otherXr } = computeComponentTUC(otherPoItems, poItems, pos, poCosts);
      const otherIntel = (competitorPrices ?? [])
        .filter((cp) => cp.component_id === otherId)
        .sort((a, b) => b.observed_at.localeCompare(a.observed_at));
      // Last quoted price for the linked component (fallback when no TUC)
      const otherLatestItem = quoteItems
        .filter((item) => item.component_id === otherId)
        .sort((a, b) => {
          const qa = quoteMap.get(a.quote_id);
          const qb = quoteMap.get(b.quote_id);
          return (qb?.quote_date ?? '').localeCompare(qa?.quote_date ?? '');
        })[0];
      const lastQuoteOther = otherLatestItem
        ? { price: otherLatestItem.unit_price, currency: otherLatestItem.currency }
        : null;

      // Detect if link is inverted (component_a should always be the smaller/primary one)
      // For now, we detect but don't fix—user can manually correct via remove+re-add
      const isInverted = !!(
        link.link_type === 'normalized' &&
        link.norm_value_a && link.norm_value_b &&
        link.norm_value_a > link.norm_value_b &&
        !isA  // inverted if inspected component is B and has larger normValue
      );

      return {
        link,
        comp: otherComp,
        tucIdr: otherTuc,
        tucXr: otherXr,
        intel: otherIntel,
        normValueSelf:  isA ? (link.norm_value_a ?? null) : (link.norm_value_b ?? null),
        normValueOther: isA ? (link.norm_value_b ?? null) : (link.norm_value_a ?? null),
        lastQuoteOther,
        isInverted,
      };
    }).filter((x): x is LinkedCompData => x !== null);

    // Already-linked component IDs (for exclusion in add-link form)
    const linkedIds = new Set(linkedComps.map((lc) => lc.comp.component_id));

    return { comp, allQuoteLines, allPOLines, lastPoTucIdr, avgTucIdr, actualTucIdr, tucXr, paidPoCount, lastReceivedPo, leadTime, compPrices, histTimeline, linkedComps, linkedIds };
  }, [inspectId, components, quoteItems, quotes, poItems, pos, poCosts, competitorPrices, componentHistory, componentLinks]);

  // ── CSV Export ────────────────────────────────────────────────────────────
  const downloadCSV = useCallback(() => {
    const headers = ['Model/SKU', 'Description', 'Brand', 'Category', 'Quotes', 'Line Items', 'Last Price', 'Currency', 'Sell Price USD', 'Gross Margin %', 'Market Avg USD'];
    const rows = filtered.map((c) => {
      const u = usageMap.get(c.component_id);
      const lq = lastQuoteByComponent.get(c.component_id);
      const gm = marginByComponent.get(c.component_id);
      const mkt = marketAvgUsdByComponent.get(c.component_id);
      return [
        c.supplier_model ?? '',
        c.internal_description ?? '',
        c.brand ?? '',
        c.category ?? '',
        u?.quoteCount ?? 0,
        u?.lineItemCount ?? 0,
        lq ? lq.price.toFixed(2) : '',
        lq?.currency ?? '',
        c.selling_price_usd != null ? c.selling_price_usd.toFixed(2) : '',
        gm != null ? gm.toFixed(1) : '',
        mkt != null ? mkt.toFixed(2) : '',
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

  // Total visible column count for colSpan on expanded spec rows
  const visibleColCount = 3 + (Object.keys(visibleCols) as ColKey[]).filter((k) => visibleCols[k]).length + 1;

  const fmtDate = (ts?: string) => {
    if (!ts) return '—';
    return new Date(ts).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
  };

  const SortTh = ({ col, label, className = '' }: { col: SortCol; label: string; className?: string }) => (
    <th
      className={`px-3 py-2 text-left text-[10px] font-bold uppercase tracking-wider text-slate-400 cursor-pointer select-none hover:text-white transition-colors ${className}`}
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
          {/* Import CSV */}
          <button
            onClick={() => setImportStep('upload')}
            className="flex items-center gap-1.5 px-3 py-2 text-xs font-semibold rounded-lg border transition-all bg-slate-800/60 border-slate-700 text-slate-400 hover:text-violet-300 hover:border-violet-500/30"
            title="Import components from CSV"
          >
            <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
              <path strokeLinecap="round" strokeLinejoin="round" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12" />
            </svg>
            Import
          </button>
          {/* Column visibility picker */}
          <div className="relative">
            <button
              onClick={() => setShowColPicker((v) => !v)}
              title="Show / hide columns"
              className={`flex items-center gap-1.5 px-3 py-2 text-xs font-semibold rounded-lg border transition-all ${
                showColPicker
                  ? 'bg-slate-700 border-slate-600 text-white'
                  : 'bg-slate-800/60 border-slate-700 text-slate-400 hover:text-white hover:border-slate-600'
              }`}
            >
              <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
                <path strokeLinecap="round" strokeLinejoin="round" d="M9 17V7m0 10a2 2 0 01-2 2H5a2 2 0 01-2-2V7a2 2 0 012-2h2a2 2 0 012 2m0 10a2 2 0 002 2h2a2 2 0 002-2M9 7a2 2 0 012-2h2a2 2 0 012 2m0 10V7" />
              </svg>
              Columns
            </button>
            {showColPicker && (
              <div className="absolute right-0 top-full mt-1.5 z-50 bg-slate-900 border border-slate-700 rounded-xl shadow-2xl shadow-black/50 p-2 min-w-[160px]"
                onMouseLeave={() => setShowColPicker(false)}
              >
                <p className="text-[10px] font-bold uppercase tracking-wider text-slate-600 px-2 py-1">Visible columns</p>
                {(Object.keys(COL_LABELS) as ColKey[]).map((key) => (
                  <label key={key} className="flex items-center gap-2.5 px-2 py-1.5 rounded-lg cursor-pointer hover:bg-white/5 text-sm text-slate-300 select-none">
                    <input
                      type="checkbox"
                      checked={visibleCols[key]}
                      onChange={(e) => setVisibleCols((prev) => ({ ...prev, [key]: e.target.checked }))}
                      className="w-3.5 h-3.5 rounded accent-emerald-500"
                    />
                    {COL_LABELS[key]}
                  </label>
                ))}
              </div>
            )}
          </div>
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
              <BrandInput
                value={addDraft.supplier_model}
                onChange={(v) => setAddDraft((p) => ({ ...p, supplier_model: v }))}
                suggestions={uniqueModels}
                isDirty={false}
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
              <BrandInput
                value={addDraft.internal_description}
                onChange={(v) => setAddDraft((p) => ({ ...p, internal_description: v }))}
                suggestions={uniqueDescriptions}
                isDirty={false}
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
      <div className="p-4 md:p-5 border-b border-slate-800/60 space-y-2">
        <div className="flex flex-col gap-2">
          {/* Search — full-width on all screen sizes */}
          <div className="flex gap-2">
            <div className="relative flex-1">
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
            <button
              onClick={() => setShowFindReplace(true)}
              title="Find & Replace (Ctrl+H)"
              className="px-3 py-2.5 bg-slate-950 border border-slate-700 rounded-lg text-slate-400 hover:text-slate-200 hover:border-slate-600 transition-colors flex items-center gap-1.5 flex-shrink-0 text-sm font-medium"
            >
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M7 16V4m0 0L3 8m4-4l4 4m6-4v12m0 0l4-4m-4 4l-4-4" />
              </svg>
              Replace
            </button>
          </div>
          {/* Filter controls — horizontally scrollable on mobile */}
          <div className="flex gap-2 overflow-x-auto pb-0.5" style={{ scrollbarWidth: 'none', msOverflowStyle: 'none' }}>
            {/* Brand filter */}
            <FilterCombobox options={uniqueBrands} value={filterBrand} onChange={setFilterBrand} placeholder="All Brands" minWidth={140} className="min-w-[140px] flex-shrink-0" />
            {/* Category filter */}
            <FilterCombobox options={ENUMS.product_category} value={filterCategory} onChange={setFilterCategory} placeholder="All Categories" minWidth={180} className="min-w-[160px] flex-shrink-0" />
            {/* PI filter */}
            {uniquePINumbers.length > 0 && (
              <FilterCombobox options={uniquePINumbers} value={filterPI} onChange={setFilterPI} placeholder="All PIs" minWidth={150} className="min-w-[150px] flex-shrink-0" />
            )}
            {/* PO filter */}
            {uniquePONumbers.length > 0 && (
              <FilterCombobox options={uniquePONumbers} value={filterPO} onChange={setFilterPO} placeholder="All POs" minWidth={150} className="min-w-[150px] flex-shrink-0" />
            )}
            {/* Quick-filter toggles */}
            <button
              onClick={() => { setFilterUnused((v) => !v); setFilterDuplicates(false); setFilterLinked(false); }}
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
              onClick={() => { setFilterDuplicates((v) => !v); setFilterUnused(false); setFilterLinked(false); }}
              className={`py-2 px-3 rounded-lg text-sm font-semibold border transition-all flex-shrink-0 ${
                filterDuplicates
                  ? 'bg-red-500/20 border-red-500/40 text-red-300'
                  : 'bg-slate-950 border-slate-700 text-slate-400 hover:text-red-300 hover:border-red-500/30'
              }`}
              title="Show components with duplicate model numbers"
            >
              Duplicates{filterDuplicates ? ` (${filtered.length})` : ''}
            </button>
            <button
              onClick={() => setFilterHasIntel((v) => !v)}
              className={`py-2 px-3 rounded-lg text-sm font-semibold border transition-all flex-shrink-0 ${
                filterHasIntel
                  ? 'bg-violet-500/20 border-violet-500/40 text-violet-300'
                  : 'bg-slate-950 border-slate-700 text-slate-400 hover:text-violet-300 hover:border-violet-500/30'
              }`}
              title="Show only components with market intel entries"
            >
              Has Intel{filterHasIntel ? ` (${filtered.length})` : ''}
            </button>
            <button
              onClick={() => { setFilterLinked((v) => !v); setFilterUnused(false); setFilterDuplicates(false); }}
              className={`py-2 px-3 rounded-lg text-sm font-semibold border transition-all flex-shrink-0 ${
                filterLinked
                  ? 'bg-sky-500/20 border-sky-500/40 text-sky-300'
                  : 'bg-slate-950 border-slate-700 text-slate-400 hover:text-sky-300 hover:border-sky-500/30'
              }`}
              title="Show only components linked to comparable items"
            >
              Linked{filterLinked ? ` (${filtered.length})` : ''}
            </button>
            <button
              onClick={() => setFilterHasSpecs((v) => !v)}
              className={`py-2 px-3 rounded-lg text-sm font-semibold border transition-all flex-shrink-0 ${
                filterHasSpecs
                  ? 'bg-teal-500/20 border-teal-500/40 text-teal-300'
                  : 'bg-slate-950 border-slate-700 text-slate-400 hover:text-teal-300 hover:border-teal-500/30'
              }`}
              title="Show only components with specifications filled in"
            >
              Has Specs{filterHasSpecs ? ` (${filtered.length})` : ''}
            </button>
            <button
              onClick={() => setFilterBelowMarket((v) => !v)}
              className={`py-2 px-3 rounded-lg text-sm font-semibold border transition-all flex-shrink-0 ${
                filterBelowMarket
                  ? 'bg-rose-500/20 border-rose-500/40 text-rose-300'
                  : 'bg-slate-950 border-slate-700 text-slate-400 hover:text-rose-300 hover:border-rose-500/30'
              }`}
              title="Selling price below confidence-weighted market average"
            >
              Below Mkt{filterBelowMarket ? ` (${filtered.length})` : ''}
            </button>
            <div className="flex items-center gap-1 flex-shrink-0">
              <button
                onClick={() => setFilterLowMargin((v) => !v)}
                className={`py-2 px-3 rounded-lg text-sm font-semibold border transition-all ${
                  filterLowMargin
                    ? 'bg-amber-500/20 border-amber-500/40 text-amber-300'
                    : 'bg-slate-950 border-slate-700 text-slate-400 hover:text-amber-300 hover:border-amber-500/30'
                }`}
                title="Show items with gross margin below threshold"
              >
                Low Margin{filterLowMargin ? ` (${filtered.length})` : ''}
              </button>
              {filterLowMargin && (
                <div className="flex items-center gap-1 bg-slate-950 border border-amber-500/40 rounded-lg px-2 py-1">
                  <span className="text-[11px] text-slate-500">&lt;</span>
                  <input
                    type="number"
                    value={marginThreshold}
                    onChange={(e) => setMarginThreshold(Number(e.target.value))}
                    min={0}
                    max={100}
                    className="w-10 bg-transparent text-xs text-amber-300 text-right focus:outline-none tabular-nums"
                  />
                  <span className="text-[11px] text-slate-500">%</span>
                </div>
              )}
            </div>
          </div>
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
      {(search || filterBrand || filterCategory || filterPI || filterPO || filterUnused || filterDuplicates || filterHasIntel || filterLinked || filterHasSpecs || filterLowMargin || filterBelowMarket) && (
        <div className="px-4 md:px-5 py-2.5 border-b border-slate-800/60 flex flex-wrap items-center gap-1.5 bg-slate-950/30">
          {search && <ActiveChip label="Search" value={search} onClear={() => { setSearchInput(''); setSearch(''); }} />}
          {filterBrand && <ActiveChip label="Brand" value={filterBrand} onClear={() => setFilterBrand('')} />}
          {filterCategory && <ActiveChip label="Category" value={filterCategory} onClear={() => setFilterCategory('')} />}
          {filterPI && <ActiveChip label="PI" value={filterPI} onClear={() => setFilterPI('')} />}
          {filterPO && <ActiveChip label="PO" value={filterPO} onClear={() => setFilterPO('')} />}
          {filterUnused && <ActiveChip label="Unused only" onClear={() => setFilterUnused(false)} />}
          {filterDuplicates && <ActiveChip label="Duplicates only" onClear={() => setFilterDuplicates(false)} />}
          {filterHasIntel && <ActiveChip label="Has market intel" onClear={() => setFilterHasIntel(false)} />}
          {filterLinked && <ActiveChip label="Linked items only" onClear={() => setFilterLinked(false)} />}
          {filterHasSpecs && <ActiveChip label="Has specs" onClear={() => setFilterHasSpecs(false)} />}
          {filterLowMargin && <ActiveChip label="Low margin" value={`< ${marginThreshold}%`} onClear={() => setFilterLowMargin(false)} />}
          {filterBelowMarket && <ActiveChip label="Below market" onClear={() => setFilterBelowMarket(false)} />}
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
                {visibleCols.brand && <SortTh col="brand" label="Brand" className="hidden md:table-cell min-w-[160px]" />}
                {visibleCols.category && <SortTh col="category" label="Category" className="hidden md:table-cell" />}
                {visibleCols.lastPrice && <SortTh col="priceDelta" label="Last Price" className="min-w-[120px]" />}
                {visibleCols.sellPrice && <SortTh col="margin" label="Sell Price" className="min-w-[130px]" />}
                {visibleCols.usage && (
                  <th className="hidden md:table-cell px-3 py-2 text-left text-[10px] font-bold uppercase tracking-wider text-slate-400 min-w-[140px]">
                    <div className="flex items-center gap-2">
                      <span>Deals</span>
                      <div className="flex gap-1">
                        <button
                          onClick={() => toggleSort('quoteCount')}
                          className={`text-[10px] px-1.5 py-0.5 rounded border transition-colors ${sortCol === 'quoteCount' ? 'text-emerald-300 border-emerald-500/40 bg-emerald-500/10' : 'text-slate-600 border-slate-700 hover:text-slate-400'}`}
                        >
                          Q{sortCol === 'quoteCount' ? (sortDir === 'asc' ? ' ↑' : ' ↓') : ''}
                        </button>
                        <button
                          onClick={() => toggleSort('poCount')}
                          className={`text-[10px] px-1.5 py-0.5 rounded border transition-colors ${sortCol === 'poCount' ? 'text-emerald-300 border-emerald-500/40 bg-emerald-500/10' : 'text-slate-600 border-slate-700 hover:text-slate-400'}`}
                        >
                          P{sortCol === 'poCount' ? (sortDir === 'asc' ? ' ↑' : ' ↓') : ''}
                        </button>
                      </div>
                    </div>
                  </th>
                )}
                {visibleCols.updated && <SortTh col="updated_at" label="Updated" className="hidden md:table-cell min-w-[110px]" />}
                <th className="px-3 py-2 w-24 text-right text-[10px] font-bold uppercase tracking-wider text-slate-600">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800/50">
              {filtered.map((c) => {
                const k = rowKey(c);
                const isEditing = editingIds.has(c.component_id);
                const isDirty = k in pending;
                const isSpecsOpen = specsOpenIds.has(c.component_id);
                const hasSpecs = c.specifications && typeof c.specifications === 'object' && Object.keys(c.specifications as object).length > 0;

                return (
                  <React.Fragment key={c.component_id}>
                  <tr
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
                    <td className="pl-4 pr-2 py-1.5 align-middle">
                      <input
                        type="checkbox"
                        checked={selectedIds.has(String(c.component_id))}
                        onChange={(e) => { e.stopPropagation(); toggleSelect(String(c.component_id)); }}
                        onClick={(e) => e.stopPropagation()}
                        className="w-3.5 h-3.5 rounded border-white/20 bg-white/5 cursor-pointer accent-sky-400"
                      />
                    </td>
                    {/* Model / SKU */}
                    <td className="px-3 py-1.5 align-middle">
                      {isEditing ? (
                        <div>
                          <input
                            type="text"
                            autoFocus
                            data-rid={c.component_id}
                            data-fld="supplier_model"
                            value={(getVal(c, 'supplier_model') as string) ?? ''}
                            onChange={(e) => setField(c, 'supplier_model', e.target.value)}
                            onKeyDown={(e) => handleCellKeyDown(e, c.component_id, 'supplier_model')}
                            className={`w-full px-2 py-1 rounded-lg text-xs text-white focus:outline-none focus:ring-2 transition-all ${
                              isDirtyField(c, 'supplier_model')
                                ? 'bg-amber-500/10 border border-amber-500/50 focus:ring-amber-500/30'
                                : 'bg-slate-950 border border-slate-700 focus:ring-emerald-500/20 focus:border-emerald-500'
                            }`}
                          />
                          {isDirtyField(c, 'supplier_model') && <DirtyBadge original={c.supplier_model} />}
                        </div>
                      ) : isDirtyField(c, 'supplier_model') ? (
                        <div>
                          <span className="text-xs text-emerald-300 font-medium">{(getVal(c, 'supplier_model') as string) || '—'}</span>
                          <DirtyBadge original={c.supplier_model} />
                        </div>
                      ) : (
                        <span className="flex items-center text-xs text-white font-medium">
                          <CopyBtn text={c.supplier_model} />
                          <Highlight text={c.supplier_model} query={search} />
                        </span>
                      )}
                    </td>

                    {/* Internal Description */}
                    <td className="px-3 py-1.5 align-middle">
                      {isEditing ? (
                        <div>
                          <input
                            type="text"
                            data-rid={c.component_id}
                            data-fld="internal_description"
                            value={(getVal(c, 'internal_description') as string) ?? ''}
                            onChange={(e) => setField(c, 'internal_description', e.target.value)}
                            onKeyDown={(e) => handleCellKeyDown(e, c.component_id, 'internal_description')}
                            className={`w-full px-2 py-1 rounded-lg text-xs text-white focus:outline-none focus:ring-2 transition-all ${
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
                          <span className="text-xs text-emerald-300">{(getVal(c, 'internal_description') as string) || '—'}</span>
                          <DirtyBadge original={c.internal_description} />
                        </div>
                      ) : (
                        <span className="flex items-center text-xs text-slate-300">
                          <CopyBtn text={c.internal_description} />
                          <Highlight text={c.internal_description} query={search} />
                        </span>
                      )}
                    </td>

                    {/* Brand */}
                    {visibleCols.brand && (
                      <td className="hidden md:table-cell px-3 py-1.5 align-middle min-w-[120px]">
                        {isEditing ? (
                          <div>
                            <BrandInput
                              value={(getVal(c, 'brand') as string) ?? ''}
                              onChange={(v) => setField(c, 'brand', v)}
                              suggestions={brandSuggestions}
                              isDirty={isDirtyField(c, 'brand')}
                              onNavKeyDown={(e) => handleCellKeyDown(e, c.component_id, 'brand')}
                              data-rid={c.component_id}
                              data-fld="brand"
                            />
                            {isDirtyField(c, 'brand') && <DirtyBadge original={c.brand} />}
                          </div>
                        ) : isDirtyField(c, 'brand') ? (
                          <div>
                            <span className="text-xs text-emerald-300">{(getVal(c, 'brand') as string) || '—'}</span>
                            <DirtyBadge original={c.brand} />
                          </div>
                        ) : (
                          <span className="text-xs text-slate-300">
                            {c.brand ? <Highlight text={c.brand} query={search} /> : <span className="text-slate-600">—</span>}
                          </span>
                        )}
                      </td>
                    )}

                    {/* Category */}
                    {visibleCols.category && (
                      <td className="hidden md:table-cell px-3 py-1.5 align-middle">
                        {isEditing ? (
                          <div>
                            <select
                              data-rid={c.component_id}
                              data-fld="category"
                              value={(getVal(c, 'category') as string) ?? ''}
                              onChange={(e) => setField(c, 'category', e.target.value || null)}
                              onKeyDown={(e) => handleCellKeyDown(e, c.component_id, 'category')}
                              className={`w-full px-2 py-1 rounded-lg text-xs text-white focus:outline-none focus:ring-2 transition-all ${
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
                            <span className="text-xs text-emerald-300">{(getVal(c, 'category') as string) || '—'}</span>
                            <DirtyBadge original={c.category} />
                          </div>
                        ) : (
                          <span className="text-xs text-slate-300">
                            {c.category || <span className="text-slate-600">—</span>}
                          </span>
                        )}
                      </td>
                    )}

                    {/* Last Price — TUC first, fallback to last quoted price */}
                    {visibleCols.lastPrice && (
                      <td className="px-3 py-1.5 align-middle min-w-[100px]">
                        {(() => {
                          const tuc = tucByComponent.get(c.component_id);
                          const lq  = lastQuoteByComponent.get(c.component_id);
                          const isDup = duplicateModels.has(c.supplier_model?.toLowerCase().trim() ?? '');
                          return (
                            <div>
                              {tuc ? (
                                <div className="min-w-0">
                                  <p className="text-xs font-medium text-slate-200 tabular-nums leading-tight">
                                    IDR {Math.round(tuc.actualTucIdr).toLocaleString('en-US')}
                                  </p>
                                  <div className="flex items-center gap-1.5 mt-0.5">
                                    <span className="text-[10px] text-slate-600">{new Date(tuc.latestPoDate).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: '2-digit' })}</span>
                                    <span className="text-[10px] text-amber-600/70 font-medium">TUC</span>
                                  </div>
                                </div>
                              ) : lq ? (
                                <div className="min-w-0">
                                  <p className="text-xs font-medium text-slate-200 tabular-nums leading-tight">
                                    {lq.currency} {lq.price.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                                  </p>
                                  <div className="flex items-center gap-1.5 mt-0.5">
                                    <span className="text-[10px] text-slate-600">{new Date(lq.date).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: '2-digit' })}</span>
                                    <PriceDelta lines={sparklineLinesByComponent.get(c.component_id) ?? []} />
                                  </div>
                                </div>
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
                    )}

                    {/* Sell Price */}
                    {visibleCols.sellPrice && (
                      <td className="px-3 py-1.5 align-middle min-w-[130px]">
                        {isEditing ? (
                          <div>
                            <div className="flex items-center gap-1">
                              <input
                                type="number"
                                step="0.01"
                                min="0"
                                data-rid={c.component_id}
                                data-fld="selling_price_usd"
                                value={(getVal(c, 'selling_price_usd') as number | null) ?? ''}
                                onChange={(e) => setField(c, 'selling_price_usd', e.target.value === '' ? null : parseFloat(e.target.value))}
                                onKeyDown={(e) => handleCellKeyDown(e, c.component_id, 'selling_price_usd' as any)}
                                placeholder="0.00"
                                className={`w-full px-2 py-1 rounded-lg text-xs text-white focus:outline-none focus:ring-2 transition-all tabular-nums ${
                                  isDirtyField(c, 'selling_price_usd' as any)
                                    ? 'bg-amber-500/10 border border-amber-500/50 focus:ring-amber-500/30'
                                    : 'bg-slate-950 border border-slate-700 focus:ring-emerald-500/20 focus:border-emerald-500'
                                }`}
                              />
                              <span className="text-[11px] text-slate-500 flex-shrink-0">USD</span>
                            </div>
                            {isDirtyField(c, 'selling_price_usd' as any) && (
                              <p className="mt-0.5 text-[11px] text-amber-400/80 leading-tight">
                                was: <span className="font-mono">{c.selling_price_usd != null ? c.selling_price_usd.toFixed(2) : '—'}</span>
                              </p>
                            )}
                          </div>
                        ) : (() => {
                          const sp = c.selling_price_usd;
                          const gm = marginByComponent.get(c.component_id);
                          const mktUsd = marketAvgUsdByComponent.get(c.component_id);
                          if (!sp) return <span className="text-xs text-slate-700">—</span>;
                          const gmColor = gm == null ? 'text-slate-500' : gm < 0 ? 'text-red-400' : gm < 10 ? 'text-orange-400' : gm < 20 ? 'text-amber-300' : gm < 30 ? 'text-emerald-300' : 'text-emerald-400';
                          return (
                            <div>
                              <p className="text-xs font-medium text-slate-200 tabular-nums leading-tight">
                                USD {sp.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                              </p>
                              <div className="flex items-center gap-1.5 mt-0.5 flex-wrap">
                                {gm != null && (
                                  <span className={`text-[10px] font-semibold tabular-nums ${gmColor}`}>
                                    GM {gm >= 0 ? '+' : ''}{gm.toFixed(1)}%
                                  </span>
                                )}
                                {mktUsd != null && (
                                  <span className={`text-[10px] tabular-nums ${sp < mktUsd ? 'text-rose-400' : 'text-slate-500'}`}>
                                    {sp < mktUsd ? '▼' : '▲'} mkt
                                  </span>
                                )}
                              </div>
                            </div>
                          );
                        })()}
                      </td>
                    )}

                    {/* Usage */}
                    {visibleCols.usage && <td
                      className="hidden md:table-cell px-3 py-1.5 align-middle min-w-[120px] cursor-default"
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
                        return (
                          <div className="flex items-center gap-2 text-[11px] text-slate-500">
                            <span className="font-semibold text-slate-300">{u.quoteCount}</span>
                            {u.quoteCount === 1 ? 'quote' : 'quotes'}
                            <span className="text-slate-700">·</span>
                            <span className="font-semibold text-slate-300">{u.poCount}</span>
                            {u.poCount === 1 ? 'PO' : 'POs'}
                          </div>
                        );
                      })()}
                    </td>}

                    {/* Updated At */}
                    {visibleCols.updated && (
                      <td className="hidden md:table-cell px-4 py-3 align-top">
                        <span className={`text-xs ${sortCol === 'updated_at' ? 'text-emerald-400 font-semibold' : 'text-slate-500'}`}>
                          {fmtDate(c.updated_at)}
                        </span>
                      </td>
                    )}

                    {/* Row actions */}
                    <td className="px-4 py-3 align-top">
                      <div className="flex gap-1.5 justify-end items-center">
                        {/* Inspect panel */}
                        <button
                          onClick={() => { setInspectId(c.component_id); setInspectTab('costs'); }}
                          onMouseEnter={(e) => {
                            const rect = e.currentTarget.getBoundingClientRect();
                            if (hoverTimerRef.current) clearTimeout(hoverTimerRef.current);
                            hoverTimerRef.current = setTimeout(() => {
                              setHoverPreviewId(c.component_id);
                              setHoverRect(rect);
                            }, 450);
                          }}
                          onMouseLeave={() => {
                            if (hoverTimerRef.current) clearTimeout(hoverTimerRef.current);
                            setHoverPreviewId(null);
                          }}
                          title="Inspect component — quotes, POs, market intel, change log"
                          className="px-2 py-1 text-xs text-slate-600 bg-transparent border border-transparent rounded-lg hover:bg-blue-500/10 hover:border-blue-500/30 hover:text-blue-300 transition-all"
                        >
                          <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
                            <circle cx="11" cy="11" r="8" /><path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-4.35-4.35" />
                          </svg>
                        </button>
                        {/* Copy row to clipboard */}
                        <button
                          onClick={() => copyRow(c)}
                          title="Copy row to clipboard (tab-separated, paste into Excel)"
                          className={`px-2 py-1 text-xs rounded-lg border transition-all ${
                            copiedRowId === c.component_id
                              ? 'text-emerald-400 bg-emerald-500/10 border-emerald-500/30'
                              : 'text-slate-600 bg-transparent border-transparent hover:bg-slate-800/60 hover:border-slate-700/60 hover:text-slate-300'
                          }`}
                        >
                          {copiedRowId === c.component_id
                            ? <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2.5"><path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" /></svg>
                            : <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2"><rect x="9" y="9" width="13" height="13" rx="2" /><path strokeLinecap="round" d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1" /></svg>
                          }
                        </button>
                        {/* Change log button removed — accessible via inspect panel (magnifying glass) */}
                        {hasSpecs && (
                          <button
                            onClick={() => toggleSpecs(c.component_id)}
                            className={`px-2 py-1 text-xs font-semibold rounded-lg border transition-all ${
                              isSpecsOpen
                                ? 'text-sky-300 bg-sky-500/10 border-sky-500/30 hover:bg-sky-500/20'
                                : 'text-slate-600 bg-transparent border-transparent hover:bg-slate-800/60 hover:border-slate-700/60 hover:text-sky-300'
                            }`}
                            title={isSpecsOpen ? 'Hide specifications' : 'View specifications'}
                          >
                            <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
                              <path strokeLinecap="round" strokeLinejoin="round" d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" />
                            </svg>
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
                  {/* Inline spec sheet */}
                  {isSpecsOpen && hasSpecs && (
                    <tr className="bg-slate-900/40 border-t border-amber-500/10">
                      <td colSpan={visibleColCount} className="px-6 py-5">
                        <SpecRenderer
                          specs={c.specifications as Record<string, unknown>}
                          modelName={c.supplier_model}
                        />
                      </td>
                    </tr>
                  )}
                  </React.Fragment>
                );
              })}
            </tbody>
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

      {/* ── CSV Import overlay ────────────────────────────────────────────── */}
      {importStep && typeof document !== 'undefined' && createPortal(
        <>
          <div className="fixed inset-0 z-40 bg-black/60 backdrop-blur-sm" onClick={() => { setImportStep(null); setImportRows([]); setImportMapping({}); }} />
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4 pointer-events-none">
            <div
              className="pointer-events-auto w-full max-w-3xl max-h-[90vh] flex flex-col bg-slate-900 border border-slate-700 rounded-2xl shadow-2xl shadow-black/60"
              onClick={(e) => e.stopPropagation()}
            >
              {/* Header */}
              <div className="flex items-center justify-between px-6 py-4 border-b border-slate-800 flex-shrink-0">
                <div>
                  <h3 className="text-base font-bold text-white">Import Components from CSV</h3>
                  <p className="text-xs text-slate-500 mt-0.5">
                    {importStep === 'upload' && 'Drop a CSV file or click to browse'}
                    {importStep === 'map' && `${importRows.length - 1} rows detected — map columns to fields`}
                    {importStep === 'preview' && (() => {
                      const adds = importPreview.filter(r => r.action === 'add').length;
                      const upds = importPreview.filter(r => r.action === 'update').length;
                      const skips = importPreview.filter(r => r.action === 'skip').length;
                      return `${adds} new · ${upds} update · ${skips} unchanged`;
                    })()}
                  </p>
                </div>
                <button onClick={() => { setImportStep(null); setImportRows([]); setImportMapping({}); }} className="text-slate-500 hover:text-white transition-colors">
                  <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
                </button>
              </div>

              {/* Body */}
              <div className="flex-1 overflow-y-auto px-6 py-5">
                {/* Step 1: Upload */}
                {importStep === 'upload' && (
                  <div
                    className={`relative flex flex-col items-center justify-center gap-4 rounded-xl border-2 border-dashed py-16 transition-colors cursor-pointer ${importDragOver ? 'border-violet-500 bg-violet-500/5' : 'border-slate-700 hover:border-slate-600'}`}
                    onDragOver={(e) => { e.preventDefault(); setImportDragOver(true); }}
                    onDragLeave={() => setImportDragOver(false)}
                    onDrop={(e) => { e.preventDefault(); setImportDragOver(false); const f = e.dataTransfer.files[0]; if (f) handleImportFile(f); }}
                    onClick={() => { const inp = document.createElement('input'); inp.type = 'file'; inp.accept = '.csv,text/csv'; inp.onchange = (e) => { const f = (e.target as HTMLInputElement).files?.[0]; if (f) handleImportFile(f); }; inp.click(); }}
                  >
                    <svg className="w-12 h-12 text-slate-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="1.5">
                      <path strokeLinecap="round" strokeLinejoin="round" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12" />
                    </svg>
                    <div className="text-center">
                      <p className="text-sm font-semibold text-slate-300">Drop CSV file here</p>
                      <p className="text-xs text-slate-500 mt-1">or click to browse · UTF-8 or ASCII</p>
                    </div>
                    <div className="flex flex-wrap gap-2 justify-center text-[11px] text-slate-600">
                      <span className="px-2 py-0.5 bg-white/5 rounded">Model/SKU</span>
                      <span className="px-2 py-0.5 bg-white/5 rounded">Description</span>
                      <span className="px-2 py-0.5 bg-white/5 rounded">Brand</span>
                      <span className="px-2 py-0.5 bg-white/5 rounded">Category</span>
                    </div>
                  </div>
                )}

                {/* Step 2: Column mapping */}
                {importStep === 'map' && (
                  <div className="space-y-3">
                    <p className="text-xs text-slate-500">Auto-detected mappings based on column headers. Adjust if needed.</p>
                    <div className="rounded-xl border border-slate-800 overflow-hidden">
                      <table className="w-full text-xs">
                        <thead>
                          <tr className="border-b border-slate-800 bg-slate-800/50">
                            <th className="px-4 py-2.5 text-left font-bold uppercase tracking-wider text-slate-500">CSV Column</th>
                            <th className="px-4 py-2.5 text-left font-bold uppercase tracking-wider text-slate-500">Sample</th>
                            <th className="px-4 py-2.5 text-left font-bold uppercase tracking-wider text-slate-500">Maps to</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-800">
                          {importRows[0]?.map((header, i) => (
                            <tr key={i} className="bg-slate-900/30">
                              <td className="px-4 py-2.5 font-mono text-slate-300">{header || `(col ${i + 1})`}</td>
                              <td className="px-4 py-2.5 text-slate-500 truncate max-w-[160px]">{importRows[1]?.[i] || '—'}</td>
                              <td className="px-4 py-2.5">
                                <select
                                  value={importMapping[i] ?? ''}
                                  onChange={(e) => setImportMapping((prev) => ({ ...prev, [i]: e.target.value }))}
                                  className="px-2 py-1 bg-slate-800 border border-slate-700 rounded-lg text-slate-300 focus:outline-none focus:border-violet-500 text-xs"
                                >
                                  {Object.entries(IMPORT_FIELDS).map(([val, label]) => (
                                    <option key={val} value={val}>{label}</option>
                                  ))}
                                </select>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                )}

                {/* Step 3: Preview diff */}
                {importStep === 'preview' && (
                  <div className="space-y-2">
                    {importPreview.length === 0 && (
                      <p className="text-sm text-slate-500 text-center py-8">No importable rows found. Check column mapping.</p>
                    )}
                    {importPreview.length > 0 && (
                      <div className="rounded-xl border border-slate-800 overflow-hidden">
                        <table className="w-full text-xs">
                          <thead>
                            <tr className="border-b border-slate-800 bg-slate-800/50">
                              <th className="px-3 py-2.5 text-left font-bold uppercase tracking-wider text-slate-500 w-16">Action</th>
                              <th className="px-3 py-2.5 text-left font-bold uppercase tracking-wider text-slate-500">Model / SKU</th>
                              <th className="px-3 py-2.5 text-left font-bold uppercase tracking-wider text-slate-500">Changes</th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-slate-800/60">
                            {importPreview.map((row, i) => (
                              <tr key={i} className={row.action === 'skip' ? 'opacity-40' : ''}>
                                <td className="px-3 py-2">
                                  {row.action === 'add' && <span className="px-1.5 py-0.5 bg-emerald-500/15 text-emerald-300 border border-emerald-500/25 rounded text-[10px] font-bold">ADD</span>}
                                  {row.action === 'update' && <span className="px-1.5 py-0.5 bg-amber-500/15 text-amber-300 border border-amber-500/25 rounded text-[10px] font-bold">UPD</span>}
                                  {row.action === 'skip' && <span className="px-1.5 py-0.5 bg-slate-700 text-slate-500 rounded text-[10px]">skip</span>}
                                </td>
                                <td className="px-3 py-2 font-mono text-slate-300">{row.fields.supplier_model}</td>
                                <td className="px-3 py-2 text-slate-400">
                                  {row.action === 'add' && (
                                    <span className="text-slate-500">{[row.fields.internal_description, row.fields.brand, row.fields.category].filter(Boolean).join(' · ')}</span>
                                  )}
                                  {row.action === 'update' && row.changes && Object.entries(row.changes).map(([f, v]) => (
                                    <span key={f} className="inline-flex items-center gap-1 mr-2">
                                      <span className="text-slate-600">{f}:</span>
                                      <span className="line-through text-red-400/60">{(row.existing as any)?.[f] || '—'}</span>
                                      <span className="text-slate-500">→</span>
                                      <span className="text-emerald-300">{String(v)}</span>
                                    </span>
                                  ))}
                                  {row.action === 'skip' && <span className="text-slate-700">no changes</span>}
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    )}
                  </div>
                )}
              </div>

              {/* Footer */}
              <div className="px-6 py-4 border-t border-slate-800 flex items-center justify-between flex-shrink-0">
                <button
                  onClick={() => {
                    if (importStep === 'map') setImportStep('upload');
                    else if (importStep === 'preview') setImportStep('map');
                  }}
                  className={`px-4 py-2 text-xs font-semibold text-slate-400 bg-slate-800 border border-slate-700 rounded-lg hover:bg-slate-700 transition-all ${importStep === 'upload' ? 'invisible' : ''}`}
                >
                  ← Back
                </button>
                <div className="flex gap-2">
                  <button onClick={() => { setImportStep(null); setImportRows([]); setImportMapping({}); }} className="px-4 py-2 text-xs font-semibold text-slate-400 bg-slate-800 border border-slate-700 rounded-lg hover:bg-slate-700 transition-all">Cancel</button>
                  {importStep === 'map' && (
                    <button
                      onClick={() => setImportStep('preview')}
                      disabled={!Object.values(importMapping).some(v => v === 'supplier_model')}
                      className="px-4 py-2 text-xs font-bold text-white bg-violet-600 hover:bg-violet-500 rounded-lg transition-all disabled:opacity-40 disabled:cursor-not-allowed"
                    >
                      Preview →
                    </button>
                  )}
                  {importStep === 'preview' && (
                    <button
                      onClick={handleImportCommit}
                      disabled={importProcessing || importPreview.filter(r => r.action !== 'skip').length === 0}
                      className="flex items-center gap-2 px-4 py-2 text-xs font-bold text-white bg-emerald-600 hover:bg-emerald-500 rounded-lg transition-all disabled:opacity-40 disabled:cursor-not-allowed"
                    >
                      {importProcessing ? <><Spinner className="w-3.5 h-3.5" /> Importing…</> : `Import ${importPreview.filter(r => r.action !== 'skip').length} row(s)`}
                    </button>
                  )}
                </div>
              </div>
            </div>
          </div>
        </>,
        document.body
      )}

      {/* ── Hover preview popup ───────────────────────────────────────────── */}
      {hoverPreviewId && hoverData && hoverRect && typeof document !== 'undefined' && createPortal(
        <div
          className="fixed z-[60] pointer-events-none"
          style={{
            top: Math.max(8, Math.min(hoverRect.top - 20, window.innerHeight - 360)),
            left: Math.max(8, hoverRect.left - 300),
          }}
        >
          <div className="bg-slate-900 border border-slate-700/80 rounded-xl shadow-2xl shadow-black/60 p-4 w-[284px]">
            {/* Component name */}
            <div className="mb-3 pb-2.5 border-b border-slate-800">
              <p className="text-sm font-bold text-white leading-tight truncate">{hoverData.comp.supplier_model}</p>
              {hoverData.comp.internal_description && hoverData.comp.internal_description !== hoverData.comp.supplier_model && (
                <p className="text-xs text-slate-400 mt-0.5 leading-snug" style={{ display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>{hoverData.comp.internal_description}</p>
              )}
              {hoverData.comp.brand && (
                <p className="text-[11px] text-slate-600 mt-1">{hoverData.comp.brand}{hoverData.comp.category ? ` · ${hoverData.comp.category}` : ''}</p>
              )}
            </div>
            {/* Actual TUC */}
            {hoverData.actualTucIdr != null ? (
              <div className="mb-3">
                <p className="text-[10px] font-bold uppercase tracking-wider text-sky-400/70 mb-1">Actual TUC</p>
                <p className="text-base font-bold text-sky-300 tabular-nums">IDR {Math.round(hoverData.actualTucIdr).toLocaleString('en-US')}</p>
                {hoverData.tucXr && (
                  <p className="text-[11px] text-slate-500 tabular-nums">≈ USD {(hoverData.actualTucIdr / hoverData.tucXr).toFixed(2)}</p>
                )}
                <div className="mt-1.5 grid grid-cols-2 gap-x-2 text-[11px]">
                  <div>
                    <p className="text-slate-600">Last PO</p>
                    <p className={`font-semibold tabular-nums ${hoverData.lastPoTucIdr === hoverData.actualTucIdr ? 'text-sky-300' : 'text-slate-400'}`}>
                      {hoverData.lastPoTucIdr != null ? `IDR ${Math.round(hoverData.lastPoTucIdr).toLocaleString('en-US')}` : '—'}
                      {hoverData.lastPoTucIdr === hoverData.actualTucIdr && <span className="ml-0.5 text-sky-600">↑</span>}
                    </p>
                  </div>
                  <div>
                    <p className="text-slate-600">Avg ({hoverData.paidPoCount} PO{hoverData.paidPoCount !== 1 ? 's' : ''})</p>
                    <p className={`font-semibold tabular-nums ${hoverData.avgTucIdr != null && hoverData.avgTucIdr === hoverData.actualTucIdr && hoverData.lastPoTucIdr !== hoverData.actualTucIdr ? 'text-sky-300' : 'text-slate-400'}`}>
                      {hoverData.avgTucIdr != null ? `IDR ${Math.round(hoverData.avgTucIdr).toLocaleString('en-US')}` : '—'}
                      {hoverData.avgTucIdr != null && hoverData.avgTucIdr === hoverData.actualTucIdr && hoverData.lastPoTucIdr !== hoverData.actualTucIdr && <span className="ml-0.5 text-sky-600">↑</span>}
                    </p>
                  </div>
                </div>
              </div>
            ) : (
              <div className="mb-3">
                <p className="text-[11px] text-slate-600 italic">No TUC data yet</p>
              </div>
            )}
            {/* Last quote price */}
            {hoverData.lq && (
              <div className="mb-2.5">
                <p className="text-[10px] font-bold uppercase tracking-wider text-emerald-400/70 mb-1">Last Quote</p>
                <p className="text-sm font-semibold text-emerald-300 tabular-nums">
                  {hoverData.lq.currency} {hoverData.lq.price.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                </p>
              </div>
            )}
            {/* Usage */}
            {hoverData.usage && (
              <p className="text-[11px] text-slate-500 mb-2.5">
                {hoverData.usage.quoteCount} PI{hoverData.usage.quoteCount !== 1 ? 's' : ''}{' · '}{hoverData.usage.lineItemCount} line item{hoverData.usage.lineItemCount !== 1 ? 's' : ''}
              </p>
            )}
            {/* Market intel preview */}
            {hoverData.latestIntel.length > 0 && (
              <div className="mb-2.5">
                <p className="text-[10px] font-bold uppercase tracking-wider text-violet-400/70 mb-1">Market Intel</p>
                {hoverData.latestIntel.map((cp, i) => (
                  <p key={i} className="text-[11px] text-slate-400">
                    <span className="font-semibold text-slate-300 tabular-nums">{cp.currency} {cp.unit_price.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
                    {cp.source_name && <span className="text-slate-600 ml-1.5">{cp.source_name}</span>}
                  </p>
                ))}
              </div>
            )}
            <p className="text-[10px] text-slate-700 pt-2 border-t border-slate-800">Click 🔍 for full detail</p>
          </div>
        </div>,
        document.body
      )}

      {/* ── Inspect panel ─────────────────────────────────────────────────── */}
      {inspectId && inspectData && typeof document !== 'undefined' && createPortal(
        (() => {
          const { comp, allQuoteLines, allPOLines, lastPoTucIdr, avgTucIdr, actualTucIdr, tucXr, paidPoCount, lastReceivedPo, leadTime, compPrices, histTimeline } = inspectData;
          const tucIdr = actualTucIdr; // convenience alias for downstream uses
          const fmtD = (d?: string | null) =>
            d ? new Date(d).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: '2-digit' }) : '—';
          const fmtP = (n: number, cur: string) =>
            `${cur} ${n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
          const fmtDays = (d: number | null) =>
            d == null ? '—' : d === 0 ? 'same day' : d === 1 ? '1 day' : `${d} days`;

          const { linkedComps, linkedIds } = inspectData;

          const tabs: { id: typeof inspectTab; label: string; count: number }[] = [
            { id: 'costs',  label: 'Costs',        count: allQuoteLines.length + allPOLines.length },
            { id: 'intel',  label: 'Market Intel',  count: compPrices.length },
            { id: 'linked', label: 'Linked',        count: linkedComps.length },
            { id: 'log',    label: 'Change Log',    count: histTimeline.length },
          ];

          return (
            <>
              {/* Backdrop */}
              <div className="fixed inset-0 z-40 bg-black/50 backdrop-blur-sm" onClick={() => setInspectId(null)} />
              {/* Panel */}
              <div
                className="fixed inset-0 md:inset-y-0 md:right-0 md:left-auto md:w-[580px] z-50 flex flex-col bg-slate-900 md:border-l border-slate-700 shadow-2xl"
                style={{ animation: 'slideInRight 0.2s ease-out' }}
              >
                {/* Header */}
                <div className="flex items-start justify-between px-6 py-4 border-b border-slate-800 flex-shrink-0 gap-4">
                  <div className="min-w-0">
                    <h3 className="text-base font-bold text-white leading-tight truncate">{comp.internal_description || comp.supplier_model}</h3>
                    <p className="text-xs text-slate-500 font-mono mt-0.5 truncate">{comp.supplier_model}</p>
                    {comp.brand && <p className="text-[11px] text-slate-600 mt-0.5">{comp.brand}{comp.category ? ` · ${comp.category}` : ''}</p>}
                  </div>
                  <button onClick={() => setInspectId(null)} className="text-slate-500 hover:text-white transition-colors flex-shrink-0 mt-0.5">
                    <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
                  </button>
                </div>

                {/* Tabs */}
                <div className="flex border-b border-slate-800 flex-shrink-0 px-2">
                  {tabs.map((t) => (
                    <button
                      key={t.id}
                      onClick={() => setInspectTab(t.id)}
                      className={`px-4 py-3 text-xs font-semibold border-b-2 transition-colors flex items-center gap-1.5 ${
                        inspectTab === t.id
                          ? 'border-blue-400 text-blue-300'
                          : 'border-transparent text-slate-500 hover:text-slate-300'
                      }`}
                    >
                      {t.label}
                      {t.count > 0 && (
                        <span className={`px-1.5 py-0.5 rounded-full text-[10px] font-bold ${
                          inspectTab === t.id ? 'bg-blue-500/20 text-blue-300' : 'bg-slate-800 text-slate-500'
                        }`}>{t.count}</span>
                      )}
                    </button>
                  ))}
                </div>

                {/* Tab content */}
                <div className="flex-1 overflow-y-auto px-6 py-4">

                  {/* ── Costs tab ──────────────────────────────────────────── */}
                  {inspectTab === 'costs' && (
                    <div className="space-y-4">

                      {/* TUC + Last Received summary cards */}
                      <div className="grid grid-cols-2 gap-3">
                        <div className="rounded-xl border border-sky-500/20 bg-sky-500/5 px-4 py-3">
                          <p className="text-[10px] font-bold uppercase tracking-wider text-sky-400/70 mb-1">Actual TUC</p>
                          {actualTucIdr != null ? (
                            <>
                              <p className="text-lg font-bold text-sky-300 tabular-nums">
                                IDR {Math.round(actualTucIdr).toLocaleString('en-US')}
                              </p>
                              {tucXr && (
                                <p className="text-[11px] text-slate-500 mt-0.5 tabular-nums">
                                  ≈ USD {(actualTucIdr / tucXr).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                                </p>
                              )}
                              {/* Last PO vs Avg breakdown */}
                              <div className="mt-2 pt-2 border-t border-sky-500/10 grid grid-cols-2 gap-x-3 gap-y-0.5">
                                <div>
                                  <p className="text-[10px] text-slate-500">Last PO</p>
                                  <p className={`text-xs font-semibold tabular-nums ${lastPoTucIdr === actualTucIdr ? 'text-sky-300' : 'text-slate-400'}`}>
                                    IDR {lastPoTucIdr != null ? Math.round(lastPoTucIdr).toLocaleString('en-US') : '—'}
                                    {lastPoTucIdr === actualTucIdr && <span className="ml-1 text-[9px] text-sky-500/80">↑ used</span>}
                                  </p>
                                </div>
                                <div>
                                  <p className="text-[10px] text-slate-500">Avg ({paidPoCount} PO{paidPoCount !== 1 ? 's' : ''})</p>
                                  <p className={`text-xs font-semibold tabular-nums ${avgTucIdr === actualTucIdr && avgTucIdr !== lastPoTucIdr ? 'text-sky-300' : 'text-slate-400'}`}>
                                    IDR {avgTucIdr != null ? Math.round(avgTucIdr).toLocaleString('en-US') : '—'}
                                    {avgTucIdr === actualTucIdr && avgTucIdr !== lastPoTucIdr && <span className="ml-1 text-[9px] text-sky-500/80">↑ used</span>}
                                  </p>
                                </div>
                              </div>
                            </>
                          ) : (
                            <p className="text-sm text-slate-600 italic mt-1">No paid PO data</p>
                          )}
                        </div>
                        <div className="rounded-xl border border-emerald-500/20 bg-emerald-500/5 px-4 py-3">
                          <p className="text-[10px] font-bold uppercase tracking-wider text-emerald-400/70 mb-1">Last Received</p>
                          {lastReceivedPo ? (
                            <>
                              <p className="text-lg font-bold text-emerald-300">{fmtD(lastReceivedPo.actual_received_date)}</p>
                              <p className="text-[11px] text-slate-500 mt-0.5 font-mono">{lastReceivedPo.po_number}</p>
                            </>
                          ) : (
                            <p className="text-sm text-slate-600 italic mt-1">Never received</p>
                          )}
                        </div>
                      </div>

                      {/* Lead time */}
                      {leadTime && (
                        <div className="rounded-xl border border-slate-700/60 bg-slate-800/20 px-4 py-3">
                          <p className="text-[10px] font-bold uppercase tracking-wider text-slate-500 mb-2">Lead Time (last received PO)</p>
                          <div className="grid grid-cols-3 gap-2 text-center">
                            {[
                              { label: 'Accepted Quote → Received', days: leadTime.fromQuote },
                              { label: 'PO Created → Received',     days: leadTime.fromPO },
                              { label: '1st Payment → Received',    days: leadTime.fromPayment },
                            ].map(({ label, days }) => (
                              <div key={label}>
                                <p className={`text-sm font-bold tabular-nums ${days != null && days >= 0 ? 'text-slate-200' : 'text-slate-600'}`}>
                                  {fmtDays(days)}
                                </p>
                                <p className="text-[10px] text-slate-500 mt-0.5 leading-tight">{label}</p>
                              </div>
                            ))}
                          </div>
                        </div>
                      )}

                      {/* Quote lines */}
                      <div>
                        <p className="text-[10px] font-bold uppercase tracking-wider text-blue-400/70 mb-2 flex items-center gap-1.5">
                          <span className="w-1.5 h-1.5 rounded-full bg-blue-400 inline-block"></span>
                          Supplier Quotes ({allQuoteLines.length})
                        </p>
                        {allQuoteLines.length === 0 ? (
                          <p className="text-xs text-slate-600 italic pl-3">No quote lines</p>
                        ) : (
                          <div className="rounded-xl border border-slate-800 overflow-hidden">
                            <table className="w-full text-xs">
                              <thead>
                                <tr className="border-b border-slate-800 bg-slate-800/50">
                                  <th className="px-3 py-2 text-left font-bold uppercase tracking-wider text-slate-500">PI #</th>
                                  <th className="px-3 py-2 text-left font-bold uppercase tracking-wider text-slate-500">Date</th>
                                  <th className="px-3 py-2 text-right font-bold uppercase tracking-wider text-slate-500">Qty</th>
                                  <th className="px-3 py-2 text-right font-bold uppercase tracking-wider text-slate-500">Unit Price</th>
                                </tr>
                              </thead>
                              <tbody className="divide-y divide-slate-800/60">
                                {allQuoteLines.map((ql, i) => (
                                  <tr key={i} className="hover:bg-white/[0.02]">
                                    <td className="px-3 py-1.5 font-mono text-blue-300">{ql.pi_number || '—'}</td>
                                    <td className="px-3 py-1.5 text-slate-400">{fmtD(ql.quote_date)}</td>
                                    <td className="px-3 py-1.5 text-right text-slate-300 tabular-nums">{ql.quantity}</td>
                                    <td className="px-3 py-1.5 text-right text-blue-300 font-semibold tabular-nums">{fmtP(ql.unit_price, ql.currency)}</td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          </div>
                        )}
                      </div>

                      {/* PO lines */}
                      <div>
                        <p className="text-[10px] font-bold uppercase tracking-wider text-emerald-400/70 mb-2 flex items-center gap-1.5">
                          <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 inline-block"></span>
                          Purchase Orders ({allPOLines.length})
                        </p>
                        {allPOLines.length === 0 ? (
                          <p className="text-xs text-slate-600 italic pl-3">No PO lines</p>
                        ) : (
                          <div className="rounded-xl border border-slate-800 overflow-hidden">
                            <table className="w-full text-xs">
                              <thead>
                                <tr className="border-b border-slate-800 bg-slate-800/50">
                                  <th className="px-3 py-2 text-left font-bold uppercase tracking-wider text-slate-500">PO #</th>
                                  <th className="px-3 py-2 text-left font-bold uppercase tracking-wider text-slate-500">Date</th>
                                  <th className="px-3 py-2 text-right font-bold uppercase tracking-wider text-slate-500">Qty</th>
                                  <th className="px-3 py-2 text-right font-bold uppercase tracking-wider text-slate-500">Unit Cost</th>
                                </tr>
                              </thead>
                              <tbody className="divide-y divide-slate-800/60">
                                {allPOLines.map((pl, i) => (
                                  <tr key={i} className="hover:bg-white/[0.02]">
                                    <td className="px-3 py-1.5 font-mono text-emerald-300">{pl.po_number}</td>
                                    <td className="px-3 py-1.5 text-slate-400">{fmtD(pl.po_date)}</td>
                                    <td className="px-3 py-1.5 text-right text-slate-300 tabular-nums">{pl.quantity}</td>
                                    <td className="px-3 py-1.5 text-right text-amber-300 font-semibold tabular-nums">{fmtP(pl.unit_cost, pl.currency)}</td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          </div>
                        )}
                      </div>
                    </div>
                  )}

                  {/* ── Linked tab ─────────────────────────────────────────── */}
                  {inspectTab === 'linked' && (() => {
                    // Component search results (excluding self + already linked)
                    const linkSearchLower = addLinkSearch.toLowerCase();
                    const linkSearchResults = addLinkSearch.length > 1
                      ? components.filter((c) =>
                          c.component_id !== inspectId &&
                          !linkedIds.has(c.component_id) &&
                          (c.supplier_model.toLowerCase().includes(linkSearchLower) ||
                           (c.internal_description || '').toLowerCase().includes(linkSearchLower) ||
                           (c.brand || '').toLowerCase().includes(linkSearchLower))
                        ).slice(0, 8)
                      : [];

                    const handleSaveLink = async () => {
                      if (!addLinkTarget || !onAddComponentLink) return;
                      setAddLinkSaving(true);
                      try {
                        await onAddComponentLink({
                          component_id_a: inspectId!,
                          component_id_b: addLinkTarget.component_id,
                          link_type: addLinkType as any,
                          normalization_unit: addLinkType === 'normalized' ? addLinkNormUnit : null,
                          norm_value_a:       addLinkType === 'normalized' && addLinkNormA ? Number(addLinkNormA) : null,
                          norm_value_b:       addLinkType === 'normalized' && addLinkNormB ? Number(addLinkNormB) : null,
                          notes: addLinkNotes || null,
                        });
                        setShowAddLink(false);
                        setAddLinkSearch('');
                        setAddLinkTarget(null);
                        setAddLinkType('category_comparable');
                        setAddLinkNormUnit('Wp');
                        setAddLinkNormA('');
                        setAddLinkNormB('');
                        setAddLinkNotes('');
                      } finally {
                        setAddLinkSaving(false);
                      }
                    };

                    return (
                      <div className="space-y-3">

                        {/* Add link button / form */}
                        {onAddComponentLink && !showAddLink && (
                          <button
                            onClick={() => setShowAddLink(true)}
                            className="w-full flex items-center justify-center gap-1.5 px-3 py-2 rounded-xl border border-dashed border-slate-700 text-slate-500 hover:border-violet-500/50 hover:text-violet-300 transition-colors text-xs font-semibold"
                          >
                            <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2.5"><path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" /></svg>
                            Add Equivalent / Comparable Link
                          </button>
                        )}

                        {showAddLink && (
                          <div className="rounded-xl border border-violet-500/30 bg-violet-500/5 p-4 space-y-3">
                            <p className="text-[10px] font-bold uppercase tracking-wider text-violet-400/70">New Link</p>

                            {/* Component search */}
                            <div>
                              <label className="text-[11px] text-slate-400 mb-1 block">Search component to link</label>
                              {addLinkTarget ? (
                                <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-slate-800 border border-violet-500/30">
                                  <div className="flex-1 min-w-0">
                                    <p className="text-xs font-semibold text-white truncate">{addLinkTarget.internal_description || addLinkTarget.supplier_model}</p>
                                    <p className="text-[10px] text-slate-500 font-mono truncate">{addLinkTarget.supplier_model}{addLinkTarget.brand ? ` · ${addLinkTarget.brand}` : ''}</p>
                                  </div>
                                  <button onClick={() => { setAddLinkTarget(null); setAddLinkSearch(''); }} className="text-slate-500 hover:text-white flex-shrink-0">
                                    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
                                  </button>
                                </div>
                              ) : (
                                <div className="relative">
                                  <input
                                    type="text"
                                    value={addLinkSearch}
                                    onChange={(e) => setAddLinkSearch(e.target.value)}
                                    placeholder="Model, description, brand…"
                                    className="w-full px-3 py-1.5 rounded-lg bg-slate-950 border border-slate-700 text-sm text-white placeholder-slate-600 focus:outline-none focus:border-violet-500 focus:ring-1 focus:ring-violet-500/30"
                                  />
                                  {linkSearchResults.length > 0 && (
                                    <div className="absolute top-full left-0 right-0 mt-1 rounded-lg bg-slate-900 border border-slate-700 shadow-xl z-10 max-h-52 overflow-y-auto custom-scrollbar">
                                      {linkSearchResults.map((c) => (
                                        <button
                                          key={c.component_id}
                                          onMouseDown={() => { setAddLinkTarget(c); setAddLinkSearch(''); }}
                                          className="w-full text-left px-3 py-2 hover:bg-slate-800 border-b border-slate-800/60 last:border-0"
                                        >
                                          <p className="text-xs font-medium text-white truncate">{c.internal_description || c.supplier_model}</p>
                                          <p className="text-[10px] text-slate-500 font-mono truncate">{c.supplier_model}{c.brand ? ` · ${c.brand}` : ''}</p>
                                        </button>
                                      ))}
                                    </div>
                                  )}
                                </div>
                              )}
                            </div>

                            {/* Link type */}
                            <div>
                              <label className="text-[11px] text-slate-400 mb-1 block">Comparison type</label>
                              <select
                                value={addLinkType}
                                onChange={(e) => setAddLinkType(e.target.value)}
                                className="w-full px-3 py-1.5 rounded-lg bg-slate-950 border border-slate-700 text-sm text-white focus:outline-none focus:border-violet-500"
                              >
                                <option value="exact_model">Exact Model — same specs, drop-in replacement</option>
                                <option value="brand_equivalent">Brand Equivalent — same function, different brand</option>
                                <option value="normalized">Normalized — compare via unit metric (cost/Wp, etc.)</option>
                                <option value="category_comparable">Category Reference — same category, general comparison</option>
                                <option value="successor">Successor — one replaces the other</option>
                              </select>
                            </div>

                            {/* Normalization fields (only for normalized type) */}
                            {addLinkType === 'normalized' && (
                              <div className="rounded-lg bg-slate-800/40 border border-slate-700/50 p-3 space-y-2">
                                <p className="text-[10px] text-slate-500 font-semibold uppercase tracking-wider">Normalization</p>
                                <div className="grid grid-cols-3 gap-2">
                                  <div>
                                    <label className="text-[11px] text-slate-400 mb-1 block">Unit</label>
                                    <select
                                      value={addLinkNormUnit}
                                      onChange={(e) => setAddLinkNormUnit(e.target.value)}
                                      className="w-full px-2 py-1.5 rounded-lg bg-slate-950 border border-slate-700 text-xs text-white focus:outline-none focus:border-violet-500"
                                    >
                                      {NORM_UNITS.map((u) => <option key={u} value={u}>{u}</option>)}
                                    </select>
                                  </div>
                                  <div>
                                    <label className="text-[11px] text-slate-400 mb-1 block">This ({addLinkNormUnit})</label>
                                    <input
                                      type="number"
                                      value={addLinkNormA}
                                      onChange={(e) => setAddLinkNormA(e.target.value)}
                                      placeholder="e.g. 550"
                                      className="w-full px-2 py-1.5 rounded-lg bg-slate-950 border border-slate-700 text-xs text-white focus:outline-none focus:border-violet-500"
                                    />
                                  </div>
                                  <div>
                                    <label className="text-[11px] text-slate-400 mb-1 block">Linked ({addLinkNormUnit})</label>
                                    <input
                                      type="number"
                                      value={addLinkNormB}
                                      onChange={(e) => setAddLinkNormB(e.target.value)}
                                      placeholder="e.g. 715"
                                      className="w-full px-2 py-1.5 rounded-lg bg-slate-950 border border-slate-700 text-xs text-white focus:outline-none focus:border-violet-500"
                                    />
                                  </div>
                                </div>
                              </div>
                            )}

                            {/* Notes */}
                            <div>
                              <label className="text-[11px] text-slate-400 mb-1 block">Notes (optional)</label>
                              <input
                                type="text"
                                value={addLinkNotes}
                                onChange={(e) => setAddLinkNotes(e.target.value)}
                                placeholder="Why are these linked?"
                                className="w-full px-3 py-1.5 rounded-lg bg-slate-950 border border-slate-700 text-sm text-white placeholder-slate-600 focus:outline-none focus:border-violet-500"
                              />
                            </div>

                            <div className="flex gap-2">
                              <button
                                onClick={handleSaveLink}
                                disabled={!addLinkTarget || addLinkSaving}
                                className="px-4 py-1.5 text-xs font-semibold rounded-lg bg-violet-600 hover:bg-violet-500 disabled:opacity-40 disabled:cursor-not-allowed text-white transition-colors"
                              >
                                {addLinkSaving ? 'Saving…' : 'Save Link'}
                              </button>
                              <button
                                onClick={() => { setShowAddLink(false); setAddLinkSearch(''); setAddLinkTarget(null); }}
                                className="px-4 py-1.5 text-xs font-semibold rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 transition-colors"
                              >
                                Cancel
                              </button>
                            </div>
                          </div>
                        )}

                        {/* Linked component cards */}
                        {linkedComps.length === 0 && !showAddLink && (
                          <p className="text-sm text-slate-600 italic py-6 text-center">No linked components yet</p>
                        )}

                        {linkedComps.map(({ link, comp: lComp, tucIdr: lTuc, tucXr: lXr, intel: lIntel, normValueSelf, normValueOther, lastQuoteOther, isInverted }) => {
                          const meta = LINK_TYPE_META[link.link_type] ?? { label: link.link_type, color: 'text-slate-300 bg-slate-700/40 border-slate-600/40' };

                          // ── Price resolution: TUC preferred, last quote as fallback ──
                          // Convert foreign quote price to IDR estimate using available XR
                          const toIdrEst = (price: number, currency: string, xr: number | null) =>
                            currency === 'IDR' ? price : xr ? price * xr : null;

                          // Self
                          const selfLastQ  = allQuoteLines[0] ?? null;
                          const selfQIdr   = selfLastQ ? toIdrEst(selfLastQ.unit_price, selfLastQ.currency, tucXr) : null;
                          const selfPrIdr  = tucIdr ?? selfQIdr;
                          const selfIsEst  = tucIdr == null && selfQIdr != null;

                          // Linked
                          const otherQIdr  = lastQuoteOther ? toIdrEst(lastQuoteOther.price, lastQuoteOther.currency, lXr ?? tucXr) : null;
                          const otherPrIdr = lTuc ?? otherQIdr;
                          const otherIsEst = lTuc == null && otherQIdr != null;

                          // Deltas
                          const directDelta = selfPrIdr != null && otherPrIdr != null
                            ? ((otherPrIdr - selfPrIdr) / selfPrIdr) * 100 : null;

                          const selfNorm  = selfPrIdr  != null && normValueSelf  ? selfPrIdr  / normValueSelf  : null;
                          const otherNorm = otherPrIdr != null && normValueOther ? otherPrIdr / normValueOther : null;
                          const normDelta = selfNorm != null && otherNorm != null
                            ? ((otherNorm - selfNorm) / selfNorm) * 100 : null;

                          const latestIntel = lIntel[0];

                          // Label helper
                          const priceLabel = (isTuc: boolean, isEst: boolean) =>
                            isTuc ? 'TUC' : isEst ? 'Last quote (est.)' : null;

                          return (
                            <div key={link.link_id} className="rounded-xl border border-slate-700/60 bg-slate-800/20 p-4">

                              {/* Card header */}
                              <div className="flex items-start justify-between mb-3 gap-2">
                                <div className="min-w-0">
                                  <p className="text-sm font-semibold text-white leading-tight truncate">{lComp.internal_description || lComp.supplier_model}</p>
                                  <p className="text-[11px] text-slate-500 font-mono mt-0.5 truncate">{lComp.supplier_model}</p>
                                  {lComp.brand && <p className="text-[10px] text-slate-600 mt-0.5">{lComp.brand}{lComp.category ? ` · ${lComp.category}` : ''}</p>}
                                </div>
                                <div className="flex items-center gap-2 flex-shrink-0">
                                  <span className={`px-2 py-0.5 text-[10px] font-bold rounded-full border ${meta.color}`}>{meta.label}</span>
                                  {isInverted && (
                                    <span className="px-2 py-0.5 text-[10px] font-bold rounded-full border text-amber-300 border-amber-500/40 bg-amber-500/10" title="Link components are inverted in database - remove & re-add to fix">⚠️ Inverted</span>
                                  )}
                                  {confirmDeleteLinkId === link.link_id ? (
                                    <span className="flex items-center gap-1 text-[11px]">
                                      <span className="text-slate-400">Remove?</span>
                                      <button
                                        onClick={async () => { await onDeleteComponentLink?.(link.link_id); setConfirmDeleteLinkId(null); }}
                                        className="text-red-400 hover:text-red-300 font-semibold"
                                      >Yes</button>
                                      <button onClick={() => setConfirmDeleteLinkId(null)} className="text-slate-500 hover:text-slate-300">No</button>
                                    </span>
                                  ) : (
                                    <button onClick={() => setConfirmDeleteLinkId(link.link_id)} className="text-slate-600 hover:text-red-400 transition-colors text-[11px]">
                                      × Remove
                                    </button>
                                  )}
                                </div>
                              </div>

                              {/* Price comparison — always 2-col grid */}
                              <div className="grid grid-cols-2 gap-2 mb-3">
                                {/* Self */}
                                <div className="rounded-lg bg-slate-900/60 px-3 py-2">
                                  <p className="text-[10px] text-slate-500 mb-0.5">
                                    {link.link_type === 'normalized' && normValueSelf && link.normalization_unit
                                      ? `This (${normValueSelf} ${link.normalization_unit})`
                                      : 'This'}
                                  </p>
                                  {link.link_type === 'normalized' && normValueSelf && link.normalization_unit ? (
                                    selfNorm != null ? (
                                      <>
                                        <p className="text-sm font-bold text-sky-300 tabular-nums">
                                          {Math.round(selfNorm).toLocaleString('en-US')} IDR/{link.normalization_unit}
                                        </p>
                                        <p className="text-[10px] text-slate-600 mt-0.5 tabular-nums">
                                          {selfIsEst ? 'est. ' : ''}IDR {Math.round(selfPrIdr!).toLocaleString('en-US')}
                                        </p>
                                      </>
                                    ) : (
                                      <p className="text-xs text-slate-600 italic mt-0.5">No data</p>
                                    )
                                  ) : (
                                    selfPrIdr != null ? (
                                      <>
                                        <p className="text-sm font-bold text-sky-300 tabular-nums">
                                          IDR {Math.round(selfPrIdr).toLocaleString('en-US')}
                                        </p>
                                        {priceLabel(tucIdr != null, selfIsEst) && (
                                          <p className="text-[10px] text-slate-600 mt-0.5">{priceLabel(tucIdr != null, selfIsEst)}</p>
                                        )}
                                      </>
                                    ) : (
                                      <p className="text-xs text-slate-600 italic mt-0.5">No data</p>
                                    )
                                  )}
                                </div>
                                {/* Linked */}
                                <div className="rounded-lg bg-slate-900/60 px-3 py-2">
                                  <p className="text-[10px] text-slate-500 mb-0.5">
                                    {link.link_type === 'normalized' && normValueOther && link.normalization_unit
                                      ? `Linked (${normValueOther} ${link.normalization_unit})`
                                      : 'Linked'}
                                  </p>
                                  {link.link_type === 'normalized' && normValueOther && link.normalization_unit ? (
                                    otherNorm != null ? (
                                      <>
                                        <p className="text-sm font-bold text-slate-200 tabular-nums">
                                          {Math.round(otherNorm).toLocaleString('en-US')} IDR/{link.normalization_unit}
                                        </p>
                                        <p className="text-[10px] text-slate-600 mt-0.5 tabular-nums">
                                          {otherIsEst ? 'est. ' : ''}IDR {Math.round(otherPrIdr!).toLocaleString('en-US')}
                                        </p>
                                      </>
                                    ) : (
                                      <p className="text-xs text-slate-600 italic mt-0.5">No data</p>
                                    )
                                  ) : (
                                    otherPrIdr != null ? (
                                      <>
                                        <p className="text-sm font-bold text-slate-200 tabular-nums">
                                          IDR {Math.round(otherPrIdr).toLocaleString('en-US')}
                                        </p>
                                        {priceLabel(lTuc != null, otherIsEst) && (
                                          <p className="text-[10px] text-slate-600 mt-0.5">{priceLabel(lTuc != null, otherIsEst)}</p>
                                        )}
                                      </>
                                    ) : (
                                      <p className="text-xs text-slate-600 italic mt-0.5">No data</p>
                                    )
                                  )}
                                  {/* Delta — always in the linked column */}
                                  {directDelta != null && link.link_type !== 'normalized' && (
                                    <p className={`text-[10px] font-semibold mt-1 ${directDelta > 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                                      linked {directDelta > 0 ? '+' : ''}{directDelta.toFixed(1)}%
                                      {(selfIsEst || otherIsEst) && <span className="text-slate-600 font-normal ml-0.5">(est.)</span>}
                                    </p>
                                  )}
                                  {normDelta != null && link.link_type === 'normalized' && (
                                    <p className={`text-[10px] font-semibold mt-1 ${normDelta > 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                                      linked {normDelta > 0 ? '+' : ''}{normDelta.toFixed(1)}% /{link.normalization_unit}
                                      {(selfIsEst || otherIsEst) && <span className="text-slate-600 font-normal ml-0.5">(est.)</span>}
                                    </p>
                                  )}
                                </div>
                              </div>

                              {/* Latest market intel for linked comp */}
                              {lIntel.length > 0 && (
                                <div className="border-t border-slate-700/40 pt-2">
                                  <p className="text-[10px] text-slate-500 mb-1.5">
                                    Market Intel ({lIntel.length})
                                    {latestIntel && <span className="ml-1 text-slate-600">· latest {fmtD(latestIntel.observed_at)}</span>}
                                  </p>
                                  <div className="space-y-0.5">
                                    {lIntel.slice(0, 3).map((cp) => (
                                      <div key={cp.competitor_price_id} className="flex items-center gap-2 text-[11px]">
                                        <span className="text-slate-500 truncate flex-1">{cp.competitor_brand || cp.competitor_model || cp.source_name || '—'}</span>
                                        <span className="text-amber-300 font-semibold tabular-nums flex-shrink-0">
                                          {cp.currency} {cp.unit_price.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                                        </span>
                                        <span className="text-slate-600 flex-shrink-0">{fmtD(cp.observed_at)}</span>
                                      </div>
                                    ))}
                                    {lIntel.length > 3 && <p className="text-[10px] text-slate-600">+{lIntel.length - 3} more</p>}
                                  </div>
                                </div>
                              )}

                              {/* Notes */}
                              {link.notes && (
                                <p className="text-[11px] text-slate-500 italic mt-2 border-t border-slate-700/40 pt-2">{link.notes}</p>
                              )}
                            </div>
                          );
                        })}
                      </div>
                    );
                  })()}

                  {/* ── Market Intel tab ───────────────────────────────────── */}
                  {inspectTab === 'intel' && (() => {
                    const linkedIntelGroups = linkedComps.filter((lc) => lc.intel.length > 0);
                    const hasAnyIntel = compPrices.length > 0 || linkedIntelGroups.length > 0;
                    return !hasAnyIntel ? (
                      <p className="text-sm text-slate-600 italic py-8 text-center">No competitor prices linked to this component</p>
                    ) : (
                      <div className="space-y-3">
                        {compPrices.map((cp) => {
                          const isEditing = editingIntelId === cp.competitor_price_id;
                          const isConfirmDelete = confirmDeleteIntelId === cp.competitor_price_id;

                          if (isEditing) {
                            const d = intelEditDraft;
                            const fld = (k: keyof CompetitorPrice) => (k in d ? (d as any)[k] : (cp as any)[k]) ?? '';
                            const setFld = (k: keyof CompetitorPrice, v: any) => setIntelEditDraft((prev) => ({ ...prev, [k]: v }));
                            return (
                              <div key={cp.competitor_price_id} className="rounded-xl border border-amber-500/40 bg-amber-500/5 px-4 py-3 space-y-3">
                                <p className="text-[10px] font-bold uppercase tracking-wider text-amber-400">Editing entry</p>
                                <div className="grid grid-cols-2 gap-2">
                                  <div>
                                    <label className="block text-[10px] text-slate-500 mb-1">Brand</label>
                                    <input value={fld('competitor_brand')} onChange={(e) => setFld('competitor_brand', e.target.value)} className="w-full px-2 py-1.5 bg-slate-950 border border-slate-700 rounded-lg text-xs text-white focus:outline-none focus:border-amber-500" />
                                  </div>
                                  <div>
                                    <label className="block text-[10px] text-slate-500 mb-1">Model</label>
                                    <input value={fld('competitor_model')} onChange={(e) => setFld('competitor_model', e.target.value)} className="w-full px-2 py-1.5 bg-slate-950 border border-slate-700 rounded-lg text-xs text-white focus:outline-none focus:border-amber-500" />
                                  </div>
                                  <div>
                                    <label className="block text-[10px] text-slate-500 mb-1">Unit Price</label>
                                    <input type="number" min="0" step="any" value={fld('unit_price')} onChange={(e) => setFld('unit_price', parseFloat(e.target.value) || 0)} className="w-full px-2 py-1.5 bg-slate-950 border border-slate-700 rounded-lg text-xs text-white focus:outline-none focus:border-amber-500" />
                                  </div>
                                  <div>
                                    <label className="block text-[10px] text-slate-500 mb-1">Currency</label>
                                    <select value={fld('currency')} onChange={(e) => setFld('currency', e.target.value)} className="w-full px-2 py-1.5 bg-slate-950 border border-slate-700 rounded-lg text-xs text-white focus:outline-none focus:border-amber-500">
                                      {ENUMS.currency.map((c) => <option key={c} value={c}>{c}</option>)}
                                    </select>
                                  </div>
                                  <div>
                                    <label className="block text-[10px] text-slate-500 mb-1">Observed At</label>
                                    <input type="date" value={fld('observed_at')?.slice(0, 10)} onChange={(e) => setFld('observed_at', e.target.value)} className="w-full px-2 py-1.5 bg-slate-950 border border-slate-700 rounded-lg text-xs text-white focus:outline-none focus:border-amber-500" />
                                  </div>
                                  <div>
                                    <label className="block text-[10px] text-slate-500 mb-1">Region</label>
                                    <input value={fld('region')} onChange={(e) => setFld('region', e.target.value)} className="w-full px-2 py-1.5 bg-slate-950 border border-slate-700 rounded-lg text-xs text-white focus:outline-none focus:border-amber-500" />
                                  </div>
                                  <div className="col-span-2">
                                    <label className="block text-[10px] text-slate-500 mb-1">Source name</label>
                                    <input value={fld('source_name')} onChange={(e) => setFld('source_name', e.target.value)} className="w-full px-2 py-1.5 bg-slate-950 border border-slate-700 rounded-lg text-xs text-white focus:outline-none focus:border-amber-500" />
                                  </div>
                                  <div className="col-span-2">
                                    <label className="block text-[10px] text-slate-500 mb-1">Source URL / reference</label>
                                    <input value={fld('source_url')} onChange={(e) => setFld('source_url', e.target.value)} className="w-full px-2 py-1.5 bg-slate-950 border border-slate-700 rounded-lg text-xs text-white focus:outline-none focus:border-amber-500" />
                                  </div>
                                  <div className="col-span-2">
                                    <label className="block text-[10px] text-slate-500 mb-1">Notes</label>
                                    <textarea value={fld('notes')} onChange={(e) => setFld('notes', e.target.value)} rows={2} className="w-full px-2 py-1.5 bg-slate-950 border border-slate-700 rounded-lg text-xs text-white focus:outline-none focus:border-amber-500 resize-none" />
                                  </div>
                                </div>
                                <div className="flex gap-2 justify-end">
                                  <button onClick={() => { setEditingIntelId(null); setIntelEditDraft({}); }} className="px-3 py-1.5 text-xs text-slate-400 bg-slate-800 border border-slate-700 rounded-lg hover:bg-slate-700 transition-all">Cancel</button>
                                  <button
                                    disabled={intelSaving || !onUpdateCompetitorPrice}
                                    onClick={async () => {
                                      if (!onUpdateCompetitorPrice) return;
                                      setIntelSaving(true);
                                      try {
                                        await onUpdateCompetitorPrice(cp.competitor_price_id, intelEditDraft);
                                        setEditingIntelId(null);
                                        setIntelEditDraft({});
                                      } finally { setIntelSaving(false); }
                                    }}
                                    className="px-3 py-1.5 text-xs font-bold text-white bg-amber-600 hover:bg-amber-500 rounded-lg transition-all disabled:opacity-40"
                                  >{intelSaving ? 'Saving…' : 'Save'}</button>
                                </div>
                              </div>
                            );
                          }

                          return (
                            <div key={cp.competitor_price_id} className="rounded-xl border border-slate-800 bg-slate-800/20 px-4 py-3 space-y-2">
                              <div className="flex items-start justify-between gap-3">
                                <div className="min-w-0">
                                  <p className="text-sm font-semibold text-slate-200 leading-tight">
                                    {cp.competitor_brand && <span className="text-slate-400 font-normal">{cp.competitor_brand} · </span>}
                                    {cp.competitor_model || cp.competitor_description || 'Unknown model'}
                                  </p>
                                  {cp.competitor_description && cp.competitor_model && (
                                    <p className="text-[11px] text-slate-500 mt-0.5 truncate">{cp.competitor_description}</p>
                                  )}
                                </div>
                                <div className="flex items-center gap-2 flex-shrink-0">
                                  <div className="text-right">
                                    <p className="text-sm font-bold text-emerald-300 tabular-nums">{fmtP(cp.unit_price, cp.currency)}</p>
                                    {cp.min_quantity && <p className="text-[10px] text-slate-600">min {cp.min_quantity}</p>}
                                  </div>
                                  {/* Edit / Delete */}
                                  {(onUpdateCompetitorPrice || onDeleteCompetitorPrice) && (
                                    <div className="flex gap-1 border-l border-slate-700 pl-2 ml-1">
                                      {onUpdateCompetitorPrice && (
                                        <button
                                          onClick={() => { setEditingIntelId(cp.competitor_price_id); setIntelEditDraft({}); setConfirmDeleteIntelId(null); }}
                                          title="Edit this entry"
                                          className="px-1.5 py-1 text-slate-600 hover:text-amber-300 hover:bg-amber-500/10 rounded transition-all"
                                        >
                                          <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2"><path strokeLinecap="round" strokeLinejoin="round" d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" /></svg>
                                        </button>
                                      )}
                                      {onDeleteCompetitorPrice && (
                                        isConfirmDelete ? (
                                          <div className="flex items-center gap-1">
                                            <span className="text-[10px] text-red-400">Delete?</span>
                                            <button
                                              disabled={intelSaving}
                                              onClick={async () => {
                                                setIntelSaving(true);
                                                try { await onDeleteCompetitorPrice(cp.competitor_price_id); setConfirmDeleteIntelId(null); }
                                                finally { setIntelSaving(false); }
                                              }}
                                              className="px-1.5 py-1 text-[10px] font-bold text-white bg-red-600 hover:bg-red-500 rounded transition-all disabled:opacity-50"
                                            >{intelSaving ? '…' : 'Yes'}</button>
                                            <button onClick={() => setConfirmDeleteIntelId(null)} className="px-1.5 py-1 text-[10px] text-slate-400 bg-slate-800 rounded hover:bg-slate-700 transition-all">No</button>
                                          </div>
                                        ) : (
                                          <button
                                            onClick={() => { setConfirmDeleteIntelId(cp.competitor_price_id); setEditingIntelId(null); }}
                                            title="Delete this entry"
                                            className="px-1.5 py-1 text-slate-600 hover:text-red-400 hover:bg-red-500/10 rounded transition-all"
                                          >
                                            <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2"><path strokeLinecap="round" strokeLinejoin="round" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" /></svg>
                                          </button>
                                        )
                                      )}
                                    </div>
                                  )}
                                </div>
                              </div>
                              <div className="flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-slate-500">
                                <span>Observed: <span className="text-slate-400">{fmtD(cp.observed_at)}</span></span>
                                {cp.incoterms && <span>Incoterms: <span className="text-slate-400">{cp.incoterms}</span></span>}
                                {cp.region && <span>Region: <span className="text-slate-400">{cp.region}</span></span>}
                                {cp.source_name && <span>Source: <span className="text-slate-400">{
                                  cp.source_url
                                    ? <a href={cp.source_url} target="_blank" rel="noopener noreferrer" className="text-blue-400 hover:underline">{cp.source_name}</a>
                                    : cp.source_name
                                }</span></span>}
                              </div>
                              {cp.notes && <p className="text-[11px] text-slate-500 italic">{cp.notes}</p>}
                            </div>
                          );
                        })}

                        {/* Intel from linked components */}
                        {linkedIntelGroups.map(({ link, comp: lComp, intel: lIntel }) => {
                          const meta = LINK_TYPE_META[link.link_type] ?? { label: link.link_type, color: 'text-slate-300 bg-slate-700/40 border-slate-600/40' };
                          return (
                            <div key={link.link_id}>
                              <p className="text-[10px] font-bold uppercase tracking-wider text-slate-500 mb-2 flex items-center gap-1.5">
                                <span className="w-1.5 h-1.5 rounded-full bg-slate-600 inline-block"></span>
                                From linked: {lComp.internal_description || lComp.supplier_model}
                                <span className={`ml-1 px-1.5 py-0.5 text-[9px] font-bold rounded-full border ${meta.color}`}>{meta.label}</span>
                              </p>
                              <div className="rounded-xl border border-slate-800 overflow-hidden">
                                <table className="w-full text-xs">
                                  <thead>
                                    <tr className="border-b border-slate-800 bg-slate-800/50">
                                      <th className="px-3 py-1.5 text-left font-bold uppercase tracking-wider text-slate-500">Brand / Model</th>
                                      <th className="px-3 py-1.5 text-left font-bold uppercase tracking-wider text-slate-500">Date</th>
                                      <th className="px-3 py-1.5 text-right font-bold uppercase tracking-wider text-slate-500">Price</th>
                                    </tr>
                                  </thead>
                                  <tbody className="divide-y divide-slate-800/60">
                                    {lIntel.map((cp) => (
                                      <tr key={cp.competitor_price_id} className="hover:bg-white/[0.02]">
                                        <td className="px-3 py-1.5 text-slate-300 truncate max-w-[160px]">
                                          {cp.competitor_brand || cp.competitor_model || cp.source_name || '—'}
                                          {cp.competitor_model && cp.competitor_brand && (
                                            <span className="text-slate-600 ml-1">{cp.competitor_model}</span>
                                          )}
                                        </td>
                                        <td className="px-3 py-1.5 text-slate-500">{fmtD(cp.observed_at)}</td>
                                        <td className="px-3 py-1.5 text-right text-amber-300 font-semibold tabular-nums">
                                          {fmtP(cp.unit_price, cp.currency)}
                                        </td>
                                      </tr>
                                    ))}
                                  </tbody>
                                </table>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    );
                  })()}

                  {/* ── Change Log tab ─────────────────────────────────────── */}
                  {inspectTab === 'log' && (
                    histTimeline.length === 0 ? (
                      <div className="flex flex-col items-center justify-center py-16 text-center gap-3">
                        <svg className="w-10 h-10 text-slate-700" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="1.5"><circle cx="12" cy="12" r="10"/><path strokeLinecap="round" strokeLinejoin="round" d="M12 6v6l4 2"/></svg>
                        <p className="text-sm text-slate-600">No history yet</p>
                        <p className="text-xs text-slate-700">Changes will appear here after the next save.</p>
                      </div>
                    ) : (
                      <div className="relative">
                        <div className="absolute left-[7px] top-2 bottom-2 w-px bg-slate-800" />
                        <div className="space-y-6 pl-6">
                          {histTimeline.map(([ts, entries]) => (
                            <div key={ts} className="relative">
                              <div className="absolute -left-6 top-1 w-3.5 h-3.5 rounded-full bg-slate-700 border-2 border-slate-900 flex items-center justify-center">
                                <div className="w-1.5 h-1.5 rounded-full bg-slate-500" />
                              </div>
                              <p className="text-[11px] text-slate-500 mb-2">
                                {new Date(ts).toLocaleString('en-GB', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })}
                              </p>
                              <div className="space-y-1.5">
                                {entries.map((e) => (
                                  <div key={e.id} className="rounded-lg bg-slate-800/60 border border-slate-800 px-3 py-2">
                                    <span className="text-[10px] font-bold uppercase tracking-wider text-slate-500">{e.field_name.replace(/_/g, ' ')}</span>
                                    <div className="flex items-center gap-2 mt-1 text-xs flex-wrap">
                                      <span className="font-mono text-red-400/80 line-through">{e.old_value || '—'}</span>
                                      <span className="text-slate-600">→</span>
                                      <span className="font-mono text-emerald-300">{e.new_value || '—'}</span>
                                    </div>
                                  </div>
                                ))}
                              </div>
                            </div>
                          ))}
                        </div>
                      </div>
                    )
                  )}

                </div>

                {/* Footer */}
                <div className="px-6 py-3 border-t border-slate-800 flex-shrink-0">
                  <button onClick={() => setInspectId(null)} className="w-full py-2 text-xs font-semibold text-slate-400 bg-slate-800 hover:bg-slate-700 border border-slate-700 rounded-lg transition-all">Close</button>
                </div>
              </div>
            </>
          );
        })(),
        document.body
      )}

      {/* ── Find & Replace Modal ──────────────────────────────────────────── */}
      {showFindReplace && typeof document !== 'undefined' && createPortal(
        <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-[9999] flex items-center justify-center p-4">
          <div className="bg-slate-900 border border-slate-800 rounded-2xl shadow-2xl w-full max-w-md max-h-[90vh] overflow-auto">
            {/* Header */}
            <div className="p-6 border-b border-slate-800 flex justify-between items-center sticky top-0 bg-slate-900/95 backdrop-blur-sm">
              <h2 className="text-lg font-bold text-white">Find & Replace</h2>
              <button
                onClick={() => setShowFindReplace(false)}
                className="text-slate-500 hover:text-white transition-colors p-1"
              >
                <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>

            {/* Content */}
            <div className="p-6 space-y-4">
              {/* Field selector */}
              <div>
                <label className="block text-xs font-semibold text-slate-400 mb-2">Apply to</label>
                <div className="grid grid-cols-3 gap-2">
                  {([
                    { value: 'supplier_model', label: 'Model' },
                    { value: 'internal_description', label: 'Description' },
                    { value: 'both', label: '✓ Both' },
                  ] as const).map(opt => (
                    <button
                      key={opt.value}
                      onClick={() => setFrField(opt.value)}
                      className={`py-2 px-3 rounded-lg text-xs font-semibold border transition-all ${
                        frField === opt.value
                          ? 'bg-emerald-500/20 border-emerald-500/40 text-emerald-300'
                          : 'bg-slate-950 border-slate-700 text-slate-400 hover:border-slate-600 hover:text-slate-200'
                      }`}
                    >
                      {opt.label}
                    </button>
                  ))}
                </div>
              </div>

              {/* Find input */}
              <div>
                <label className="block text-xs font-semibold text-slate-400 mb-2">Find</label>
                <input
                  type="text"
                  value={frFind}
                  onChange={(e) => { setFrFind(e.target.value); setFrPreviewing(true); }}
                  placeholder="Enter text or regex pattern…"
                  className="w-full px-3 py-2 bg-slate-950 border border-slate-700 rounded-lg text-sm text-white focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500/20 placeholder-slate-600"
                  autoFocus
                />
              </div>

              {/* Replace input */}
              <div>
                <label className="block text-xs font-semibold text-slate-400 mb-2">Replace with</label>
                <input
                  type="text"
                  value={frReplace}
                  onChange={(e) => setFrReplace(e.target.value)}
                  placeholder="Replacement text…"
                  className="w-full px-3 py-2 bg-slate-950 border border-slate-700 rounded-lg text-sm text-white focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500/20 placeholder-slate-600"
                />
              </div>

              {/* Options */}
              <div className="flex gap-3 pt-2">
                <label className="flex items-center gap-2 text-xs cursor-pointer">
                  <input
                    type="checkbox"
                    checked={frMatchCase}
                    onChange={(e) => setFrMatchCase(e.target.checked)}
                    className="w-4 h-4"
                  />
                  <span className="text-slate-300">Match case</span>
                </label>
                <label className="flex items-center gap-2 text-xs cursor-pointer">
                  <input
                    type="checkbox"
                    checked={frUseRegex}
                    onChange={(e) => setFrUseRegex(e.target.checked)}
                    className="w-4 h-4"
                  />
                  <span className="text-slate-300">Use regex</span>
                </label>
              </div>

              {/* Preview */}
              {frFind && (() => {
                const matches = getFindMatches();
                return (
                  <div className="pt-4 border-t border-slate-800">
                    <div className="flex items-center gap-2 mb-3">
                      <p className="text-xs font-semibold text-slate-400">
                        {matches.length} component{matches.length !== 1 ? 's' : ''} matched
                      </p>
                      {matches.length > 8 && <p className="text-[10px] text-slate-500">(showing first 8)</p>}
                    </div>
                    <div className="space-y-2 max-h-64 overflow-y-auto">
                      {matches.slice(0, 8).map((comp) => {
                        const previews = getReplacePreview(comp);
                        if (!previews.length) return null;
                        return (
                          <div key={comp.component_id} className="text-[11px] bg-slate-950/50 border border-slate-800 rounded-lg p-2.5 space-y-1.5">
                            {previews.map(({ field, before, after }) => (
                              <div key={field}>
                                <span className="text-[10px] font-bold uppercase tracking-wider text-slate-600 mr-1">
                                  {field === 'supplier_model' ? 'Model' : 'Desc'}
                                </span>
                                <div className="font-mono text-red-400/70 truncate">{before}</div>
                                <div className="font-mono text-emerald-400/80 truncate">→ {after}</div>
                              </div>
                            ))}
                          </div>
                        );
                      })}
                    </div>
                  </div>
                );
              })()}
            </div>

            {/* Footer */}
            <div className="p-6 border-t border-slate-800 flex gap-3">
              <button
                onClick={() => setShowFindReplace(false)}
                className="flex-1 px-4 py-2 text-sm font-semibold text-slate-300 bg-slate-800 border border-slate-700 rounded-lg hover:bg-slate-700 transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={handleReplaceAll}
                disabled={!frFind || !getFindMatches().length}
                className="flex-1 px-4 py-2 text-sm font-semibold text-white bg-emerald-600 border border-emerald-500/50 rounded-lg hover:bg-emerald-500 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              >
                Replace All ({getFindMatches().length})
              </button>
            </div>
          </div>
        </div>,
        document.body
      )}
    </>
  );
}
