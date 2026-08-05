'use client';
/**
 * NEW DEAL — the single document-shaped buy-side entry form.
 *
 * Replaces the old two-card layout (SimpleForm "Step 1: header" +
 * BatchLineItemsForm "Step 2: items"): header fields and line rows live in ONE
 * card with ONE save, mirroring the sales editor's structure. The page passes
 * the header field list (violet accent = belongs to the PO), the catalog for
 * the line pickers, and a single onSubmit that receives header + items
 * together — Quote-only writes 4.0/4.1, Quote + PO also writes 5.0/5.1
 * (price → cost), exactly as before.
 *
 * Carried over from the old forms:
 *  - Draft persistence per browser (localStorage) — a half-typed deal survives
 *    a reload; the old Step-1/Step-2 drafts are migrated once, then removed.
 *  - Field defaults that arrive late (PDF extraction, stored quote) fill only
 *    fields that are still empty — typed values are never overwritten.
 *  - Line rows auto-fill supplier_description on component pick, default their
 *    currency from the header, and a fresh blank row always waits at the end.
 *  - `seedLines` replaces the rows wholesale (the one-PDF-fills-everything
 *    path) — the page builds them from the extraction with component matching.
 */
import React, { useState, useEffect, useMemo, useRef, useId } from 'react';
import FieldRenderer from './FieldRenderer';
import RichDropdown from '../ui/RichDropdown';
import { Spinner } from '../ui/LoadingSkeleton';
import { fmtInt } from '@/lib/formatters';
import type { FieldConfig } from '../../types/forms';

export interface DealLine {
  key: string;
  component_id: string | null;
  supplier_description: string;
  quantity: string;
  unit_price: string;
  currency: string;
}

let lineSeq = 0;
export const blankDealLine = (currency = ''): DealLine => ({
  key: `dl-${Date.now()}-${lineSeq++}`,
  component_id: null, supplier_description: '', quantity: '', unit_price: '', currency,
});

const DRAFT_KEY = 'form-draft:new-deal';
const LEGACY_HEADER_KEY = 'form-draft:Step 1: Quote Header';
const LEGACY_ITEMS_KEY = 'form-draft:Step 2: Quote Items';

const hasContent = (l: DealLine) =>
  !!(l.component_id || l.supplier_description.trim() || l.quantity.trim() || l.unit_price.trim());

interface Props {
  title: string;
  withPo: boolean;
  headerFields: FieldConfig[];
  /** Same contract as SimpleForm: return a partial record of fields to auto-update. */
  onFieldChange?: (name: string, value: any, current: Record<string, any>) => Partial<Record<string, any>>;
  components: any[];
  currencies: readonly string[];
  /** Stored-quote path: the carried-items panel drives the PO lines, so manual entry hides. */
  itemsLocked?: boolean;
  /** Rows built from a PDF extraction — replace the current rows when set. */
  seedLines?: DealLine[] | null;
  /** Rendered at the right end of the title row (the PDF-upload button). */
  headerAction?: React.ReactNode;
  /** Return false to keep the draft (a failed insert must not eat the typing). */
  onSubmit: (header: Record<string, any>, items: DealLine[]) => Promise<boolean | void> | boolean | void;
  loading: boolean;
}

export default function NewDealForm({
  title, withPo, headerFields, onFieldChange, components, currencies,
  itemsLocked = false, seedLines = null, headerAction, onSubmit, loading,
}: Props) {
  const formId = useId();

  const buildDefaults = (flds: FieldConfig[]) => {
    const d: Record<string, any> = {};
    flds.forEach((f) => { if (f.default !== undefined) d[f.name] = f.default; });
    return d;
  };

  const [header, setHeader] = useState<Record<string, any>>(() => {
    const defaults = buildDefaults(headerFields);
    if (typeof window === 'undefined') return defaults;
    try {
      const saved = localStorage.getItem(DRAFT_KEY);
      if (saved) return { ...defaults, ...(JSON.parse(saved).header ?? {}) };
      // One-time migration: a header typed into the old Step-1 card is not lost
      const legacy = localStorage.getItem(LEGACY_HEADER_KEY);
      if (legacy) return { ...defaults, ...JSON.parse(legacy) };
    } catch {}
    return defaults;
  });

  const [lines, setLines] = useState<DealLine[]>(() => {
    if (typeof window !== 'undefined') {
      try {
        const saved = localStorage.getItem(DRAFT_KEY);
        if (saved) {
          const ls = JSON.parse(saved).lines;
          if (Array.isArray(ls) && ls.length) return [...ls, blankDealLine()];
        } else {
          const legacy = localStorage.getItem(LEGACY_ITEMS_KEY);
          if (legacy) {
            const its = JSON.parse(legacy).items;
            if (Array.isArray(its) && its.length) {
              return [...its.map((it: any) => ({
                ...blankDealLine(), component_id: it.component_id ?? null,
                supplier_description: String(it.supplier_description ?? ''),
                quantity: String(it.quantity ?? ''), unit_price: String(it.unit_price ?? ''),
                currency: String(it.currency ?? ''),
              })), blankDealLine()];
            }
          }
        }
      } catch {}
    }
    return [blankDealLine()];
  });

  const persist = (h: Record<string, any>, ls: DealLine[]) => {
    try {
      localStorage.setItem(DRAFT_KEY, JSON.stringify({ header: h, lines: ls.filter(hasContent) }));
      localStorage.removeItem(LEGACY_HEADER_KEY);
      localStorage.removeItem(LEGACY_ITEMS_KEY);
    } catch {}
  };

  const draftLive = useMemo(
    () => Object.values(header).some((v) => v !== '' && v !== null && v !== undefined) || lines.some(hasContent),
    [header, lines]);

  // Late-arriving defaults (PDF extraction, stored quote) fill EMPTY fields only.
  const mountedRef = useRef(false);
  useEffect(() => {
    if (!mountedRef.current) { mountedRef.current = true; return; }
    setHeader((prev) => {
      const updated = { ...prev };
      headerFields.forEach((f) => {
        if (f.default !== undefined && f.default !== null && f.default !== '' &&
            (prev[f.name] === undefined || prev[f.name] === null || prev[f.name] === '')) {
          updated[f.name] = f.default;
        }
      });
      return updated;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [headerFields]);

  // A PDF extraction rebuilds the rows wholesale — it IS the document.
  useEffect(() => {
    if (!seedLines || seedLines.length === 0) return;
    setLines([...seedLines, blankDealLine(seedLines[0]?.currency || '')]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [seedLines]);

  const setHeaderField = (name: string, value: any) => {
    setHeader((prev) => {
      const updated = { ...prev, [name]: value };
      if (onFieldChange) Object.assign(updated, onFieldChange(name, value, updated));
      persist(updated, lines);
      return updated;
    });
  };

  const compById = useMemo(() => {
    const m = new Map<string, any>();
    for (const c of components) m.set(String(c.component_id), c);
    return m;
  }, [components]);

  const setLine = (key: string, patch: Partial<DealLine>) => {
    setLines((prev) => {
      const next = prev.map((l) => (l.key === key ? { ...l, ...patch } : l));
      // The last row gaining content grows a fresh blank below it — the
      // "+ add" click nobody should need for the common case.
      const last = next[next.length - 1];
      if (last && hasContent(last)) next.push(blankDealLine(header.currency || last.currency || ''));
      persist(header, next);
      return next;
    });
  };

  const removeLine = (key: string) => {
    setLines((prev) => {
      const next = prev.filter((l) => l.key !== key);
      const out = next.length ? next : [blankDealLine(header.currency || '')];
      persist(header, out);
      return out;
    });
  };

  const pickComponent = (key: string, componentId: string | null) => {
    const comp = componentId ? compById.get(String(componentId)) : null;
    setLine(key, {
      component_id: componentId,
      // Same autofill the old items form did — editable afterwards.
      ...(comp ? { supplier_description: comp.internal_description || comp.supplier_model || '' } : {}),
    });
  };

  const clearDraft = () => {
    try {
      localStorage.removeItem(DRAFT_KEY);
      localStorage.removeItem(LEGACY_HEADER_KEY);
      localStorage.removeItem(LEGACY_ITEMS_KEY);
    } catch {}
    setHeader(buildDefaults(headerFields));
    setLines([blankDealLine()]);
  };

  // What the rows are worth, per currency — mixed currencies each get a line.
  const itemTotals = useMemo(() => {
    const by = new Map<string, number>();
    for (const l of lines) {
      const q = Number(l.quantity) || 0, p = Number(l.unit_price) || 0;
      if (q > 0 && p > 0) {
        const c = l.currency || header.currency || '—';
        by.set(c, (by.get(c) ?? 0) + q * p);
      }
    }
    return by;
  }, [lines, header.currency]);

  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    const rows = lines.filter(hasContent);
    const bad = rows.find((l) => !(Number(l.quantity) > 0) || l.unit_price.trim() === '' || !(l.component_id || l.supplier_description.trim()));
    if (bad && !itemsLocked) {
      setError('Every line needs a component (or description), a quantity above zero and a price. Remove the line or complete it.');
      return;
    }
    const out = { ...header };
    // Header total left blank + single-currency items = the items ARE the total.
    if ((out.total_value === undefined || out.total_value === null || out.total_value === '')
        && itemTotals.size === 1 && !itemsLocked) {
      const [ccy, sum] = [...itemTotals.entries()][0];
      if (!out.currency || ccy === out.currency) out.total_value = sum;
    }
    const ok = await onSubmit(out, itemsLocked ? [] : rows);
    if (ok === false) return;   // failed insert — keep the draft, keep the typing
    clearDraft();
  };

  const lineInp = 'w-full px-2 py-1.5 rounded-lg bg-slate-950 border border-slate-700 focus:border-emerald-500/60 focus:outline-none text-xs text-white placeholder:text-slate-600 transition-colors';

  return (
    <form onSubmit={handleSubmit}
      className="bg-slate-900/40 backdrop-blur-sm rounded-2xl border border-slate-800/80 p-4 md:p-5 shadow-xl ring-1 ring-white/5 space-y-4">
      {/* Title row — one PDF upload for the whole document */}
      <div className="flex items-center gap-3 border-b border-slate-800/80 pb-3">
        <h3 className="text-sm font-bold text-white tracking-tight flex-1">{title}</h3>
        {headerAction}
        {draftLive && (
          <button type="button" onClick={clearDraft}
            className="text-[11px] text-slate-500 hover:text-slate-300 px-2 py-1 rounded-lg border border-slate-700/60 hover:border-slate-600 transition-colors"
            title="Clear the saved draft — header and lines">
            Clear draft
          </button>
        )}
      </div>

      {/* ── Header ── */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3.5">
        {headerFields.map((f) => (
          <div key={f.name} className="group">
            <FieldRenderer field={f} value={header[f.name]} onChange={setHeaderField} formId={formId} disabled={loading} />
          </div>
        ))}
      </div>

      {/* ── Line items — same card, one save ── */}
      {!itemsLocked && (
        <div className="space-y-1.5 pt-1">
          <div className="hidden md:grid grid-cols-[minmax(0,2.2fr)_minmax(0,1.6fr)_70px_110px_84px_100px_24px] gap-2 px-1 text-[10px] font-bold uppercase tracking-wider text-slate-500">
            <span>Component</span><span>Supplier description</span>
            <span className="text-right">Qty</span><span className="text-right">Unit price</span>
            <span>Curr</span><span className="text-right">Line total</span><span />
          </div>
          {lines.map((l) => {
            const total = (Number(l.quantity) || 0) * (Number(l.unit_price) || 0);
            return (
              <div key={l.key}
                className="grid grid-cols-2 md:grid-cols-[minmax(0,2.2fr)_minmax(0,1.6fr)_70px_110px_84px_100px_24px] gap-2 items-center bg-slate-950/40 border border-slate-800/60 rounded-xl px-1.5 py-1.5 md:border-0 md:bg-transparent md:px-1 md:py-0">
                <div className="col-span-2 md:col-span-1">
                  <RichDropdown options={components} value={l.component_id}
                    config={{ labelKey: 'supplier_model', valueKey: 'component_id', subLabelKey: 'internal_description' }}
                    placeholder="Search catalog…"
                    onChange={(v: any) => pickComponent(l.key, v ? String(v) : null)} />
                </div>
                <input value={l.supplier_description} onChange={(e) => setLine(l.key, { supplier_description: e.target.value })}
                  placeholder="Supplier description" className={`${lineInp} col-span-2 md:col-span-1`} />
                <input value={l.quantity} onChange={(e) => setLine(l.key, { quantity: e.target.value })}
                  placeholder="Qty" inputMode="decimal" className={`${lineInp} text-right tabular-nums`} />
                <input value={l.unit_price} onChange={(e) => setLine(l.key, { unit_price: e.target.value })}
                  placeholder="Price" inputMode="decimal" className={`${lineInp} text-right tabular-nums`} />
                <select value={l.currency || header.currency || ''} onChange={(e) => setLine(l.key, { currency: e.target.value })}
                  className={`${lineInp} appearance-none`}>
                  <option value="">—</option>
                  {currencies.map((c) => <option key={c} value={c}>{c}</option>)}
                </select>
                <span className="text-right text-xs tabular-nums text-slate-300 font-semibold whitespace-nowrap">
                  {total > 0 ? fmtInt(total) : <span className="text-slate-700">—</span>}
                </span>
                <button type="button" onClick={() => removeLine(l.key)} tabIndex={-1}
                  className="text-slate-600 hover:text-red-400 transition-colors text-base leading-none justify-self-end"
                  title="Remove line">×</button>
              </div>
            );
          })}
          <p className="text-[10px] text-slate-600 px-1">
            Pick a catalog item to autofill the description, or just type one. A new row appears as you fill the last —
            in Quote + PO mode every line lands on BOTH documents (price on the quote = cost on the PO).
          </p>
        </div>
      )}

      {error && (
        <div className="px-3 py-2 bg-red-500/10 border border-red-500/25 rounded-lg text-xs text-red-300">{error}</div>
      )}

      {/* ── Footer: totals + the one save ── */}
      <div className="pt-3 border-t border-slate-800/80 flex flex-wrap items-center gap-3">
        {!itemsLocked && itemTotals.size > 0 && (
          <span className="text-[11px] text-slate-500">
            Items total:{' '}
            {[...itemTotals.entries()].map(([c, v], i) => (
              <span key={c} className="text-slate-300 font-semibold tabular-nums">{i > 0 ? ' · ' : ''}{c} {fmtInt(v)}</span>
            ))}
            {header.total_value === '' || header.total_value == null
              ? <span className="text-slate-600"> — fills Total Value on save</span> : null}
          </span>
        )}
        <button type="submit" disabled={loading}
          className={`ml-auto font-bold py-2.5 px-6 rounded-xl text-sm shadow-lg transition-all hover:-translate-y-0.5 active:translate-y-0 disabled:opacity-50 disabled:transform-none disabled:cursor-not-allowed flex items-center justify-center gap-2 text-white ${
            withPo ? 'bg-violet-600 hover:bg-violet-500 border border-violet-500/50 shadow-violet-900/20'
                   : 'bg-emerald-600 hover:bg-emerald-500 border border-emerald-500/50 shadow-emerald-900/20'}`}>
          {loading ? (<><Spinner className="w-4 h-4" /><span>Saving…</span></>)
            : (<span>{withPo ? 'Save Quote + PO' : 'Save Quote'}</span>)}
        </button>
      </div>
    </form>
  );
}
