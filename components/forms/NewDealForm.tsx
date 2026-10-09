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
import { useDragReorder, DRAGGING_ROW, REORDER_ROW } from '@/components/ui/dragReorder';
import RichDropdown from '../ui/RichDropdown';
import { Spinner } from '../ui/LoadingSkeleton';
import { fmtInt } from '@/lib/formatters';
import { evalCell } from '@/lib/formula';
import { useT } from '@/hooks/useT';
import { reasonsFor, reasonDef, defaultLineReason } from '@/lib/dealContext';
import type { FieldConfig } from '../../types/forms';

export interface DealLine {
  key: string;
  component_id: string | null;
  supplier_description: string;
  quantity: string;
  unit_price: string;
  currency: string;
  /** Why it is asked for / ordered (lib/dealContext.ts LINE_REASONS) and what for. */
  reason?: string;
  reason_note?: string;
  reason_project_quote_id?: string;
  reason_sales_quote_id?: string;
  reason_replaces_component_id?: string;
  /** Replacement lines: also record the new item as the old one's successor. */
  make_successor?: boolean;
  /** Someone picked the reason by hand (even "— reason —") — the default stops applying. */
  reason_set?: boolean;
}

let lineSeq = 0;
export const blankDealLine = (currency = ''): DealLine => ({
  key: `dl-${Date.now()}-${lineSeq++}`,
  component_id: null, supplier_description: '', quantity: '', unit_price: '', currency,
  reason: '', reason_note: '', reason_project_quote_id: '', reason_sales_quote_id: '', reason_replaces_component_id: '', make_successor: true,
});

/** What a line's reason can point at — offered by the picker next to "Why". */
export interface ReasonTarget { id: string; label: string; sub?: string }

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
  /**
   * Set when the form was ENTERED through an explicit source — Deal Lookup's
   * "Create PO" (`q:<id>`) or "Revise →" (`po:<id>`). A change wipes any
   * lingering draft and rebuilds header + lines from the source: the draft
   * protects organic typing, it must never win over an explicit "work on THIS
   * document" action (the 2026-08-14 frankendraft bug).
   */
  sourceKey?: string | null;
  /** Rendered at the right end of the title row (the PDF-upload button). */
  headerAction?: React.ReactNode;
  /** Return false to keep the draft (a failed insert must not eat the typing). */
  onSubmit: (header: Record<string, any>, items: DealLine[]) => Promise<boolean | void> | boolean | void;
  loading: boolean;
  /** EPC proposals and sales orders a line can be "for" (empty = role cannot read them). */
  projects?: ReasonTarget[];
  salesOrders?: ReasonTarget[];
  /** supplier_id → supplier_code, for the project-only default reason (lib/dealContext.ts). */
  supplierCodes?: Record<string, string>;
}

export default function NewDealForm({
  title, withPo, headerFields, onFieldChange, components, currencies,
  itemsLocked = false, seedLines = null, sourceKey = null, headerAction, onSubmit, loading,
  projects = [], salesOrders = [], supplierCodes = {},
}: Props) {
  const { t } = useT();
  // Quote + PO: the lines are ORDERED, so "price check only" is not offered.
  const reasonOpts = reasonsFor(withPo ? 'po' : 'quote');
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

  // ── Seeds & sources, CONTENT-driven ────────────────────────────────────────
  // The seeds' array identity changes on every unrelated refetch (the page
  // memo rebuilds it), and it does NOT change when a same-value re-pick should
  // re-seed. Keying on a content signature fixes both: rows are replaced when
  // what they SAY changes, never because a background refresh remade the array.
  const seedSig = useMemo(() => (seedLines?.length
    ? JSON.stringify(seedLines.map((l) => [l.component_id, l.supplier_description, l.quantity, l.unit_price, l.currency]))
    : ''), [seedLines]);
  const appliedSource = useRef('');
  const appliedSeedSig = useRef('');
  useEffect(() => {
    const src = sourceKey ?? '';
    const sourceChanged = appliedSource.current !== src;
    const seedsChanged = appliedSeedSig.current !== seedSig;
    if (!sourceChanged && !seedsChanged) return;
    appliedSource.current = src;
    appliedSeedSig.current = seedSig;
    if (src && sourceChanged) {
      // Entered via an explicit source: the old draft does not apply. Rebuild
      // the header from the field defaults (which carry the source's values).
      try { localStorage.removeItem(DRAFT_KEY); } catch {}
      setHeader(buildDefaults(headerFields));
      setLines(seedLines?.length ? [...seedLines, blankDealLine(seedLines[0]?.currency || '')] : [blankDealLine()]);
      return;
    }
    // Seeds changed on their own (PDF extraction, quote picked in the form,
    // or a source's lines arriving late) — replace the rows, keep the header.
    if (seedLines?.length) setLines([...seedLines, blankDealLine(seedLines[0]?.currency || '')]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sourceKey, seedSig]);

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

  // ── Reorder line items: drag the grip on desktop, ▲▼ on touch. Only rows
  // with content move; the always-empty trailing row stays put at the end. ──
  const reorder = (fromKey: string, toKey: string, after: boolean) => {
    if (!fromKey || fromKey === toKey) return;
    setLines((prev) => {
      const from = prev.findIndex((l) => l.key === fromKey);
      const to = prev.findIndex((l) => l.key === toKey);
      if (from < 0 || to < 0 || !hasContent(prev[from]) || !hasContent(prev[to])) return prev;
      const arr = [...prev];
      const [moved] = arr.splice(from, 1);
      // Land on the seam the line was drawn in: above the target, or below it.
      let at = arr.findIndex((l) => l.key === toKey);
      if (after) at += 1;
      arr.splice(at, 0, moved);
      persist(header, arr);
      return arr;
    });
  };

  const drag = useDragReorder<string>(reorder, {
    // The always-empty trailing row is not a place to land.
    canDrop: (_from, to) => {
      const row = lines.find((l) => l.key === to);
      return !!row && hasContent(row);
    },
  });

  const nudge = (key: string, dir: -1 | 1) => {
    setLines((prev) => {
      const i = prev.findIndex((l) => l.key === key);
      const j = i + dir;
      if (i < 0 || j < 0 || j >= prev.length) return prev;
      if (!hasContent(prev[i]) || !hasContent(prev[j])) return prev;   // never move the trailing blank
      const arr = [...prev];
      [arr[i], arr[j]] = [arr[j], arr[i]];
      persist(header, arr);
      return arr;
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

  // A line from a project-only supplier or brand reads "For a project", one
  // from a stock-only supplier "Stock / restock", until someone picks otherwise. Derived, not stored: picking
  // the supplier after the lines, or changing it, re-decides every untouched line.
  const autoReason = (l: DealLine) => (!l.reason && !l.reason_set && hasContent(l)
    ? defaultLineReason(supplierCodes[String(header.supplier_id ?? '')], compById.get(String(l.component_id))?.brand)
    : null);
  const reasonOf = (l: DealLine) => l.reason || autoReason(l) || '';

  const clearDraft = () => {
    try {
      localStorage.removeItem(DRAFT_KEY);
      localStorage.removeItem(LEGACY_HEADER_KEY);
      localStorage.removeItem(LEGACY_ITEMS_KEY);
    } catch {}
    setHeader(buildDefaults(headerFields));
    // With a source active, "clear" returns to THE SOURCE, not to nothing —
    // clearing used to strand a selected quote with empty rows.
    setLines(seedLines?.length ? [...seedLines, blankDealLine(seedLines[0]?.currency || '')] : [blankDealLine()]);
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
    // Header total left blank + single-currency items = the document total is
    // items PLUS freight — total_value is the full obligation to the supplier,
    // and auto-filling it without freight is how a PO ends up under-stated in
    // the payment screens (the PIO-2026012 mismatch). A typed total is taken
    // as-is: the person copies the document's own grand total.
    if ((out.total_value === undefined || out.total_value === null || out.total_value === '')
        && itemTotals.size === 1 && !itemsLocked) {
      const [ccy, sum] = [...itemTotals.entries()][0];
      if (!out.currency || ccy === out.currency) out.total_value = sum + (Number(out.freight_charges_intl) || 0);
    }
    const ok = await onSubmit(out, itemsLocked ? [] : rows.map((l) => ({ ...l, reason: reasonOf(l) })));
    if (ok === false) return;   // failed insert — keep the draft, keep the typing
    clearDraft();
  };

  // The line-input skin, split from its text colour: the currency SELECT needs
  // a different one while it is empty. A <select> has no placeholder — its
  // empty "Curr" option is a real option and renders in the element's own text
  // colour, so it came out WHITE beside three grey placeholders (owner,
  // 2026-08-24). Empty now reads slate-600, the same grey as the rest; a chosen
  // currency reads white, the same as a filled field.
  const lineInpBase = 'w-full px-2 py-1.5 rounded-lg bg-slate-950 border border-slate-700 focus:border-emerald-500/60 focus:outline-none text-xs placeholder:text-slate-600 transition-colors';
  const lineInp = `${lineInpBase} text-white`;

  return (
    <form onSubmit={handleSubmit}
      className="bg-slate-900/40 backdrop-blur-sm rounded-2xl border border-slate-800/80 p-4 md:p-5 shadow-xl ring-1 ring-white/5 space-y-4">
      {/* Title row — one PDF upload for the whole document. On phones the
          title takes the full first line and the actions sit beneath it,
          instead of squeezing the title into a three-line sliver. */}
      <div className="flex flex-wrap items-center gap-2.5 sm:gap-3 border-b border-slate-800/80 pb-3">
        <h3 className="text-sm font-bold text-white tracking-tight w-full sm:w-auto sm:flex-1">{title}</h3>
        {headerAction}
        {draftLive && (
          <button type="button" onClick={clearDraft}
            className="text-[11px] text-slate-500 hover:text-slate-300 px-2 py-1 rounded-lg border border-slate-700/60 hover:border-slate-600 transition-colors"
            title="Clear the saved draft — header and lines">
            {t('Clear draft')}
          </button>
        )}
      </div>

      {/* ── Header ── */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3.5">
        {headerFields.map((f) => (
          <div key={f.name} className="group">
            <FieldRenderer field={f} value={header[f.name]} onChange={setHeaderField} formId={formId} disabled={loading}
              scopeValue={f.browseScope ? header[f.browseScope.fieldName] : undefined} />
          </div>
        ))}
      </div>

      {/* ── Line items — same card, one save ── */}
      {!itemsLocked && (
        <div className="space-y-1.5 pt-1">
          {/* The Items section announces itself on every screen size — the
              same "Items" title desktop and mobile; phones additionally give
              each card an "Item N" header since they have no column row. */}
          <div className="flex flex-wrap items-center gap-2 px-1 pt-2 border-t border-slate-800/80">
            <p className="text-[10px] font-bold uppercase tracking-wider text-slate-400">Items</p>
            {/* One reason for the whole deal is the common case — set it once. */}
            <label className="ml-auto flex items-center gap-1.5 text-[11px] text-slate-500">
              {t('Why — all lines')}
              <select value="" onChange={(e) => { const v = e.target.value; if (v) setLines((ls) => { const next = ls.map((l) => ({ ...l, reason: v, reason_set: true })); persist(header, next); return next; }); }}
                className="px-2 py-1 rounded-lg bg-slate-950 border border-slate-700 text-[11px] text-slate-300 focus:outline-none focus:border-emerald-500/60">
                <option value="">{t('Set…')}</option>
                {reasonOpts.map((r) => <option key={r.value} value={r.value}>{t(r.label)}</option>)}
              </select>
            </label>
          </div>
          <div className="hidden md:grid grid-cols-[18px_minmax(0,2.2fr)_minmax(0,1.6fr)_70px_110px_84px_100px_24px] gap-2 px-1 text-[10px] font-bold uppercase tracking-wider text-slate-500">
            <span /><span>Component</span><span>Supplier description</span>
            <span className="text-right">Qty</span><span className="text-right">Unit price</span>
            <span>Curr</span><span className="text-right">Line total</span><span />
          </div>
          {lines.map((l, idx) => {
            const total = (Number(l.quantity) || 0) * (Number(l.unit_price) || 0);
            const movable = hasContent(l);
            return (
              <div key={l.key} data-drag-row
                {...drag.rowProps(l.key)}
                className={`grid grid-cols-6 md:grid-cols-[18px_minmax(0,2.2fr)_minmax(0,1.6fr)_70px_110px_84px_100px_24px] gap-2 items-center bg-slate-950/40 border rounded-xl px-2.5 py-2.5 md:bg-transparent md:px-1 md:py-0.5 md:rounded-md ${REORDER_ROW} border-slate-800/60 md:border-0 ${
                  drag.lineAt(l.key)} ${drag.dragKey === l.key ? DRAGGING_ROW : ''}`}>
                {/* Drag handle (desktop) — grip; reorders on drop. Blank row: no grip. */}
                <button type="button" tabIndex={-1}
                  {...drag.handleProps(l.key, { enabled: movable, rowImage: true })}
                  title={movable ? 'Drag to reorder' : undefined}
                  className={`hidden md:flex items-center justify-center col-span-1 ${movable ? 'text-slate-600 hover:text-slate-300 cursor-grab active:cursor-grabbing' : 'opacity-0 pointer-events-none'}`}>
                  <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="currentColor"><circle cx="9" cy="5" r="1.6"/><circle cx="15" cy="5" r="1.6"/><circle cx="9" cy="12" r="1.6"/><circle cx="15" cy="12" r="1.6"/><circle cx="9" cy="19" r="1.6"/><circle cx="15" cy="19" r="1.6"/></svg>
                </button>
                {/* Phones: each card is its own numbered section; ▲▼ reorder + ✕ */}
                <div className="col-span-6 md:hidden flex items-center justify-between -mb-0.5">
                  <span className="text-[10px] font-bold uppercase tracking-wider text-slate-600">Item {idx + 1}</span>
                  <div className="flex items-center gap-0.5">
                    {movable && <>
                      <button type="button" onClick={() => nudge(l.key, -1)} tabIndex={-1} title="Move up"
                        className="text-slate-600 hover:text-slate-200 transition-colors text-xs leading-none px-1.5 py-0.5">▲</button>
                      <button type="button" onClick={() => nudge(l.key, 1)} tabIndex={-1} title="Move down"
                        className="text-slate-600 hover:text-slate-200 transition-colors text-xs leading-none px-1.5 py-0.5">▼</button>
                    </>}
                    <button type="button" onClick={() => removeLine(l.key)} tabIndex={-1}
                      className="text-slate-600 hover:text-red-400 transition-colors text-base leading-none px-1 -mr-1"
                      title="Remove line">×</button>
                  </div>
                </div>
                <div className="col-span-6 md:col-span-1">
                  <RichDropdown options={components} value={l.component_id}
                    config={{ labelKey: 'supplier_model', valueKey: 'component_id', subLabelKey: 'internal_description' }}
                    placeholder="Search catalog…"
                    onChange={(v: any) => pickComponent(l.key, v ? String(v) : null)} />
                </div>
                <input value={l.supplier_description} onChange={(e) => setLine(l.key, { supplier_description: e.target.value })}
                  placeholder="Supplier description" className={`${lineInp} col-span-6 md:col-span-1`} />
                {/* Phones: Qty · Price · Curr share one row. Both accept
                    Excel-style "=" formulas ("=12*100"), evaluated on blur by
                    the shared evalCell — same behaviour as the sales editor. */}
                <input value={l.quantity} onChange={(e) => setLine(l.key, { quantity: e.target.value })}
                  onBlur={(e) => { const v = evalCell(e.target.value); if (v !== e.target.value) setLine(l.key, { quantity: v }); }}
                  title="Type = for a formula, e.g. =500+40" placeholder="Qty" inputMode="decimal"
                  className={`${lineInp} col-span-2 md:col-span-1 text-right tabular-nums`} />
                <input value={l.unit_price} onChange={(e) => setLine(l.key, { unit_price: e.target.value })}
                  onBlur={(e) => { const v = evalCell(e.target.value); if (v !== e.target.value) setLine(l.key, { unit_price: v }); }}
                  title="Type = for a formula, e.g. =20.45*0.98" placeholder="Price" inputMode="decimal"
                  className={`${lineInp} col-span-2 md:col-span-1 text-right tabular-nums`} />
                <select value={l.currency || header.currency || ''} onChange={(e) => setLine(l.key, { currency: e.target.value })}
                  title="Line currency"
                  className={`${lineInpBase} ${l.currency || header.currency ? 'text-white' : 'text-slate-600'} col-span-2 md:col-span-1 appearance-none`}>
                  <option value="">Curr</option>
                  {currencies.map((c) => <option key={c} value={c}>{c}</option>)}
                </select>
                {/* Line total: labeled footer on phones (hidden while empty),
                    the usual right column on desktop */}
                <span className={`col-span-6 md:col-span-1 text-right text-xs tabular-nums text-slate-300 font-semibold whitespace-nowrap ${total > 0 ? '' : 'hidden md:block'}`}>
                  {total > 0
                    ? <><span className="md:hidden text-slate-500 font-normal">Line total </span>{fmtInt(total)}</>
                    : <span className="text-slate-700">—</span>}
                </span>
                <button type="button" onClick={() => removeLine(l.key)} tabIndex={-1}
                  className="hidden md:block col-span-1 text-slate-600 hover:text-red-400 transition-colors text-base leading-none justify-self-end"
                  title="Remove line">×</button>
                {/* Why this line — the context a later negotiation needs. Shown
                    once the line has content, so the blank last row stays quiet. */}
                {movable && (() => {
                  const reason = reasonOf(l);
                  const auto = !l.reason && !!reason;
                  const def = reasonDef(reason);
                  const target = def?.needs === 'project' ? { list: projects, key: 'reason_project_quote_id' as const, ph: t('Which project?') }
                    : def?.needs === 'sales_order' ? { list: salesOrders, key: 'reason_sales_quote_id' as const, ph: t('Which sales order?') }
                    : null;
                  return (
                    <div className="col-span-6 md:col-[2/-1] flex flex-wrap items-center gap-1.5 md:pb-1.5">
                      <span className="text-[10px] uppercase tracking-wider text-slate-600">{t('Why')}</span>
                      <select value={reason} onChange={(e) => setLine(l.key, { reason: e.target.value, reason_set: true })}
                        title={auto ? t(reason === 'stock' ? 'Filled in: everything from this supplier is for stock' : 'Filled in: everything from this supplier or brand is for a project') : undefined}
                        className={`${lineInpBase} !w-auto ${reason ? 'text-slate-200' : 'text-slate-600'}`}>
                        <option value="">{t('— reason —')}</option>
                        {reasonOpts.map((r) => <option key={r.value} value={r.value}>{t(r.label)}</option>)}
                      </select>
                      {auto && <span className="text-[10px] text-slate-500">{t('Auto')}</span>}
                      {target && (
                        <select value={(l[target.key] as string) ?? ''} onChange={(e) => setLine(l.key, { [target.key]: e.target.value })}
                          className={`${lineInpBase} !w-auto max-w-[280px] ${l[target.key] ? 'text-slate-200' : 'text-slate-600'}`}>
                          <option value="">{target.list.length ? target.ph : t('None you can open')}</option>
                          {target.list.map((o) => <option key={o.id} value={o.id}>{o.label}{o.sub ? ` · ${o.sub}` : ''}</option>)}
                        </select>
                      )}
                      {def?.needs === 'component' && (
                        <div className="w-[260px] max-w-full">
                          <RichDropdown options={components.filter((c: { component_id?: string }) => c.component_id !== l.component_id)} value={l.reason_replaces_component_id || null}
                            config={{ labelKey: 'supplier_model', valueKey: 'component_id', subLabelKey: 'internal_description' }}
                            placeholder={t('Old model it replaces…')}
                            onChange={(v: unknown) => setLine(l.key, { reason_replaces_component_id: v ? String(v) : '' })} />
                        </div>
                      )}
                      {def?.needs === 'component' && l.reason_replaces_component_id && l.component_id && (
                        <label className="flex items-center gap-1 text-[11px] text-slate-400" title={t('Records the new item as the successor of the old one, so Products and the Item Editor show it as replaced')}>
                          <input type="checkbox" checked={l.make_successor !== false} onChange={(e) => setLine(l.key, { make_successor: e.target.checked })} className="accent-emerald-600" />
                          {t('Mark as successor')}
                        </label>
                      )}
                      <input value={l.reason_note ?? ''} onChange={(e) => setLine(l.key, { reason_note: e.target.value })}
                        placeholder={t('Note (optional) — e.g. customer needs it before Lebaran')}
                        className={`${lineInp} flex-1 min-w-[180px]`} />
                    </div>
                  );
                })()}
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
        {!itemsLocked && itemTotals.size > 0 && (() => {
          // The deal's total is never typed — it saves as items + supplier-billed
          // freight. Say exactly what will be stored, live.
          const freight = Number(header.freight_charges_intl) || 0;
          const single = itemTotals.size === 1 ? [...itemTotals.entries()][0] : null;
          return (
            <span className="text-[11px] text-slate-500">
              Items{' '}
              {[...itemTotals.entries()].map(([c, v], i) => (
                <span key={c} className="text-slate-300 font-semibold tabular-nums">{i > 0 ? ' · ' : ''}{c} {fmtInt(v)}</span>
              ))}
              {single && freight > 0 && (
                <> + freight <span className="text-slate-300 font-semibold tabular-nums">{fmtInt(freight)}</span></>
              )}
              {single
                ? <span className="text-slate-600"> — saves as Total <span className="text-slate-400 font-semibold tabular-nums">{single[0]} {fmtInt(single[1] + freight)}</span></span>
                : <span className="text-slate-600"> — mixed currencies; totals stay per line</span>}
            </span>
          );
        })()}
        <button type="submit" disabled={loading}
          className={`w-full sm:w-auto sm:ml-auto font-bold py-2.5 px-6 rounded-xl text-sm shadow-lg transition-all hover:-translate-y-0.5 active:translate-y-0 disabled:opacity-50 disabled:transform-none disabled:cursor-not-allowed flex items-center justify-center gap-2 text-white ${
            withPo ? 'bg-violet-600 hover:bg-violet-500 border border-violet-500/50 shadow-violet-900/20'
                   : 'bg-emerald-600 hover:bg-emerald-500 border border-emerald-500/50 shadow-emerald-900/20'}`}>
          {loading ? (<><Spinner className="w-4 h-4" /><span>{t('Saving…')}</span></>)
            : (<span>{withPo ? t('Save quote + PO') : t('Save quote')}</span>)}
        </button>
      </div>
    </form>
  );
}
