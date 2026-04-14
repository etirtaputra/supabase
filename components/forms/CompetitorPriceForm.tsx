/**
 * CompetitorPriceForm
 *
 * Records competitor / market price observations for revenue management.
 * The right-hand panel shows a live comparison against our own most recent
 * PO cost and latest quote for the linked component — giving a price index
 * and margin signal similar to airline/hotel yield management.
 */
'use client';
import React, { useState, useMemo, useRef, useEffect } from 'react';
import type {
  Component,
  PurchaseLineItem,
  PurchaseOrder,
  PriceQuoteLineItem,
  PriceQuote,
  CompetitorPrice,
  Supplier,
} from '../../types/database';
import { ENUMS } from '../../constants/enums';

// ─── Helpers ────────────────────────────────────────────────────────────────

function nowLocal() {
  const d = new Date();
  // datetime-local format: YYYY-MM-DDTHH:mm
  return d.toISOString().slice(0, 16);
}

function fmtCcy(val: number, currency: string) {
  return `${currency} ${val.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 4 })}`;
}

function fmtDate(ts?: string) {
  if (!ts) return '—';
  return new Date(ts).toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' });
}

// ─── Mini component search input ───────────────────────────────────────────

interface CompSearchProps {
  components: Component[];
  value: string | null;
  onChange: (id: string | null, comp: Component | null) => void;
}

function ComponentSearch({ components, value, onChange }: CompSearchProps) {
  const [q, setQ] = useState('');
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  const selected = useMemo(
    () => (value ? components.find((c) => c.component_id === value) ?? null : null),
    [value, components]
  );

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  const hits = useMemo(() => {
    const lq = q.toLowerCase().trim();
    if (!lq) return components.slice(0, 40);
    return components
      .filter(
        (c) =>
          c.supplier_model?.toLowerCase().includes(lq) ||
          c.internal_description?.toLowerCase().includes(lq) ||
          c.brand?.toLowerCase().includes(lq)
      )
      .slice(0, 40);
  }, [q, components]);

  return (
    <div ref={ref} className="relative">
      {selected ? (
        <div className="flex items-center gap-2 bg-emerald-500/10 border border-emerald-500/30 rounded-lg px-3 py-2">
          <span className="text-xs text-white font-semibold flex-1 min-w-0 truncate">
            {selected.supplier_model}
            {selected.internal_description && (
              <span className="text-slate-400 font-normal ml-1.5">{selected.internal_description}</span>
            )}
          </span>
          <button
            type="button"
            onClick={() => { onChange(null, null); setQ(''); }}
            className="text-slate-400 hover:text-red-400 text-xs transition-colors flex-shrink-0"
          >
            ✕
          </button>
        </div>
      ) : (
        <input
          type="text"
          value={q}
          onChange={(e) => { setQ(e.target.value); setOpen(true); }}
          onFocus={() => setOpen(true)}
          placeholder="Search our components…"
          className="w-full px-3 py-2 rounded-lg bg-slate-950 border border-slate-700 text-sm text-white placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-500"
        />
      )}
      {open && !selected && (
        <div className="absolute top-full left-0 right-0 mt-1 z-50 bg-slate-900 border border-slate-700 rounded-xl shadow-xl overflow-hidden max-h-52 overflow-y-auto">
          {hits.length === 0 ? (
            <div className="px-3 py-3 text-xs text-slate-500">No components found</div>
          ) : (
            hits.map((c) => (
              <button
                key={c.component_id}
                type="button"
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => { onChange(c.component_id, c); setOpen(false); setQ(''); }}
                className="w-full text-left px-3 py-2.5 hover:bg-slate-800 transition-colors border-b border-slate-800/50 last:border-0"
              >
                <div className="text-xs font-semibold text-white">{c.supplier_model}</div>
                {c.internal_description && (
                  <div className="text-[11px] text-slate-400 mt-0.5 truncate">{c.internal_description}</div>
                )}
              </button>
            ))
          )}
        </div>
      )}
    </div>
  );
}

// ─── Quote / PI reference picker ────────────────────────────────────────────

interface QuoteRefPickerProps {
  quotes: PriceQuote[];
  suppliers: Supplier[];
  value: string;
  onChange: (ref: string, sourceType?: string) => void;
}

function QuoteRefPicker({ quotes, suppliers, value, onChange }: QuoteRefPickerProps) {
  const [q, setQ] = useState('');
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  const hits = useMemo(() => {
    const lq = q.toLowerCase().trim();
    const sorted = [...quotes].sort((a, b) => b.quote_date.localeCompare(a.quote_date));
    if (!lq) return sorted.slice(0, 30);
    return sorted.filter((qt) =>
      qt.pi_number?.toLowerCase().includes(lq) ||
      suppliers.find(s => s.supplier_id === qt.supplier_id)?.supplier_name?.toLowerCase().includes(lq) ||
      qt.quote_date?.includes(lq)
    ).slice(0, 30);
  }, [q, quotes, suppliers]);

  const selected = value ? quotes.find(qt => qt.pi_number === value || String(qt.quote_id) === value) : null;
  const selectedSupplier = selected ? suppliers.find(s => s.supplier_id === selected.supplier_id) : null;

  const clear = () => { onChange(''); setQ(''); };

  const pick = (qt: PriceQuote) => {
    const ref = qt.pi_number || `Quote #${qt.quote_id}`;
    const supplier = suppliers.find(s => s.supplier_id === qt.supplier_id);
    onChange(ref, supplier?.supplier_name ?? undefined);
    setQ('');
    setOpen(false);
  };

  return (
    <div ref={ref} className="relative">
      {selected ? (
        <div className="flex items-center gap-2 bg-violet-500/10 border border-violet-500/30 rounded-lg px-3 py-2">
          <svg className="w-3.5 h-3.5 text-violet-400 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
            <path strokeLinecap="round" strokeLinejoin="round" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
          </svg>
          <span className="text-xs text-white font-semibold flex-1 min-w-0 truncate">
            {selected.pi_number || `Quote #${selected.quote_id}`}
            {selectedSupplier && <span className="text-slate-400 font-normal ml-1.5">{selectedSupplier.supplier_name}</span>}
          </span>
          <button type="button" onClick={clear} className="text-slate-400 hover:text-red-400 text-xs transition-colors flex-shrink-0">✕</button>
        </div>
      ) : (
        <input
          type="text"
          value={q}
          onChange={(e) => { setQ(e.target.value); setOpen(true); }}
          onFocus={() => setOpen(true)}
          placeholder="Search PI number or supplier…"
          className="w-full px-3 py-2 rounded-lg bg-slate-950 border border-slate-700 text-sm text-white placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-violet-500/20 focus:border-violet-500"
        />
      )}
      {open && !selected && (
        <div className="absolute top-full left-0 right-0 mt-1 z-50 bg-slate-900 border border-slate-700 rounded-xl shadow-xl overflow-hidden max-h-52 overflow-y-auto">
          {hits.length === 0 ? (
            <div className="px-3 py-3 text-xs text-slate-500">No quotes found</div>
          ) : (
            hits.map((qt) => {
              const sup = suppliers.find(s => s.supplier_id === qt.supplier_id);
              return (
                <button
                  key={qt.quote_id}
                  type="button"
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => pick(qt)}
                  className="w-full text-left px-3 py-2.5 hover:bg-slate-800 transition-colors border-b border-slate-800/50 last:border-0"
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-xs font-semibold text-white">{qt.pi_number || `Quote #${qt.quote_id}`}</span>
                    <span className="text-[10px] text-slate-500 flex-shrink-0">{qt.quote_date}</span>
                  </div>
                  {sup && <div className="text-[11px] text-slate-400 mt-0.5 truncate">{sup.supplier_name}</div>}
                  <div className="text-[11px] text-slate-600 mt-0.5">{qt.currency} {qt.total_value?.toLocaleString()}</div>
                </button>
              );
            })
          )}
        </div>
      )}
    </div>
  );
}

// ─── Section wrapper ────────────────────────────────────────────────────────

function Section({ title, icon, children }: { title: string; icon: string; children: React.ReactNode }) {
  return (
    <div>
      <h3 className="flex items-center gap-2 text-[11px] font-bold uppercase tracking-widest text-slate-500 mb-3">
        <span>{icon}</span>{title}
      </h3>
      {children}
    </div>
  );
}

function Field({ label, req, children }: { label: string; req?: boolean; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="block text-[11px] font-semibold text-slate-400 mb-1">
        {label}{req && <span className="text-red-400 ml-0.5">*</span>}
      </span>
      {children}
    </label>
  );
}

const inputCls = 'w-full px-3 py-2 rounded-lg bg-slate-950 border border-slate-700 text-sm text-white placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-500 transition-all';
const selectCls = inputCls + ' appearance-none cursor-pointer';

// ─── Comparison panel ───────────────────────────────────────────────────────

interface ComparisonPanelProps {
  unitPrice: number | null;
  currency: string;
  capacityW: number | null;
  incoterms: string;
  component: Component | null;
  poItems: PurchaseLineItem[];
  pos: PurchaseOrder[];
  quoteItems: PriceQuoteLineItem[];
  quotes: PriceQuote[];
  competitorPrices: CompetitorPrice[];
}

function ComparisonPanel({
  unitPrice, currency, capacityW, incoterms, component,
  poItems, pos, quoteItems, quotes, competitorPrices,
}: ComparisonPanelProps) {
  // ── History for selected component ───────────────────────────────────
  const history = useMemo(() => {
    if (!component) return { poRows: [], quoteRows: [], peerRows: [] };

    // PO purchases — sorted by PO date desc
    const poRows = poItems
      .filter((i) => i.component_id === component.component_id)
      .map((i) => {
        const po = pos.find((p) => p.po_id === i.po_id);
        return { unit_cost: i.unit_cost, currency: i.currency, date: po?.po_date, po_number: po?.po_number };
      })
      .sort((a, b) => (b.date || '').localeCompare(a.date || ''))
      .slice(0, 3);

    // Supplier quotes — sorted by quote date desc
    const quoteRows = quoteItems
      .filter((i) => i.component_id === component.component_id)
      .map((i) => {
        const q = quotes.find((q) => q.quote_id === i.quote_id);
        return { unit_price: i.unit_price, currency: i.currency, date: q?.quote_date };
      })
      .sort((a, b) => (b.date || '').localeCompare(a.date || ''))
      .slice(0, 3);

    // Peer competitor prices for this same component — most recent 3
    const peerRows = competitorPrices
      .filter((p) => p.component_id === component.component_id)
      .slice(0, 3);

    return { poRows, quoteRows, peerRows };
  }, [component, poItems, pos, quoteItems, quotes, competitorPrices]);

  // ── Price index vs most recent PO cost ───────────────────────────────
  const priceIndex = useMemo(() => {
    if (!unitPrice || history.poRows.length === 0) return null;
    const latest = history.poRows[0];
    if (latest.currency !== currency) return null; // different currencies — can't compare directly
    return ((unitPrice - latest.unit_cost) / latest.unit_cost) * 100;
  }, [unitPrice, currency, history.poRows]);

  const pricePerUnit = capacityW && unitPrice ? unitPrice / capacityW : null;

  // ── Colour coding ─────────────────────────────────────────────────────
  const indexColor =
    priceIndex === null ? 'text-slate-400' :
    priceIndex < 0       ? 'text-red-400'    : // below our cost — dangerous
    priceIndex < 15      ? 'text-amber-400'  : // tight
                           'text-emerald-400'; // healthy room

  const indexBg =
    priceIndex === null ? 'bg-slate-800/60 border-slate-700/60' :
    priceIndex < 0       ? 'bg-red-500/10 border-red-500/20'    :
    priceIndex < 15      ? 'bg-amber-500/10 border-amber-500/20':
                           'bg-emerald-500/10 border-emerald-500/20';

  const indexLabel =
    priceIndex === null ? null :
    priceIndex < 0      ? 'Below our cost — risky market' :
    priceIndex < 10     ? 'Near parity — very tight margin room' :
    priceIndex < 25     ? 'Moderate headroom above our cost' :
                          'Strong headroom — premium opportunity';

  return (
    <div className="space-y-4">
      {/* Their price summary */}
      <div className="bg-slate-900/60 border border-slate-800 rounded-xl p-4">
        <p className="text-[10px] font-bold uppercase tracking-widest text-slate-500 mb-3">Their Price</p>
        {unitPrice ? (
          <div className="space-y-1">
            <div className="flex items-baseline gap-2">
              <span className="text-2xl font-extrabold text-white">{fmtCcy(unitPrice, currency)}</span>
              {incoterms && (
                <span className="text-xs font-semibold text-sky-400 bg-sky-500/10 border border-sky-500/20 px-2 py-0.5 rounded-full">{incoterms}</span>
              )}
            </div>
            {pricePerUnit && (
              <p className="text-sm text-emerald-300 font-semibold">
                {currency} {pricePerUnit.toFixed(4)}/Wp
                <span className="text-slate-500 font-normal ml-1.5">({capacityW}Wp)</span>
              </p>
            )}
          </div>
        ) : (
          <p className="text-sm text-slate-600 italic">Enter a price to see analysis</p>
        )}
      </div>

      {/* Price index badge */}
      {priceIndex !== null && (
        <div className={`rounded-xl border p-4 ${indexBg}`}>
          <p className="text-[10px] font-bold uppercase tracking-widest text-slate-500 mb-1">Price Index vs Our Latest PO</p>
          <p className={`text-3xl font-extrabold ${indexColor}`}>
            {priceIndex >= 0 ? '+' : ''}{priceIndex.toFixed(1)}%
          </p>
          <p className={`text-xs mt-1 font-medium ${indexColor}`}>{indexLabel}</p>
        </div>
      )}

      {/* Our component cost history */}
      {component && (
        <div className="bg-slate-900/60 border border-slate-800 rounded-xl p-4 space-y-4">
          <p className="text-[10px] font-bold uppercase tracking-widest text-slate-500">
            Our Reference: {component.supplier_model}
          </p>

          {history.poRows.length > 0 && (
            <div>
              <p className="text-[10px] text-slate-600 font-semibold mb-2 uppercase tracking-wider">PO Purchases</p>
              <div className="space-y-1.5">
                {history.poRows.map((r, i) => (
                  <div key={i} className="flex items-center justify-between gap-2">
                    <span className="text-[11px] text-slate-500">{fmtDate(r.date)}</span>
                    <span className="text-xs font-semibold text-white">
                      {fmtCcy(r.unit_cost, r.currency)}
                      {capacityW && (
                        <span className="text-slate-500 font-normal ml-1.5">
                          ({r.currency} {(r.unit_cost / capacityW).toFixed(4)}/Wp)
                        </span>
                      )}
                    </span>
                    {i === 0 && <span className="text-[10px] bg-slate-700 text-slate-300 px-1.5 py-0.5 rounded-full font-bold">Latest</span>}
                  </div>
                ))}
              </div>
            </div>
          )}

          {history.quoteRows.length > 0 && (
            <div>
              <p className="text-[10px] text-slate-600 font-semibold mb-2 uppercase tracking-wider">Supplier Quotes</p>
              <div className="space-y-1.5">
                {history.quoteRows.map((r, i) => (
                  <div key={i} className="flex items-center justify-between gap-2">
                    <span className="text-[11px] text-slate-500">{fmtDate(r.date)}</span>
                    <span className="text-xs font-semibold text-amber-300">
                      {fmtCcy(r.unit_price, r.currency)}
                      {capacityW && (
                        <span className="text-slate-500 font-normal ml-1.5">
                          ({r.currency} {(r.unit_price / capacityW).toFixed(4)}/Wp)
                        </span>
                      )}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {history.poRows.length === 0 && history.quoteRows.length === 0 && (
            <p className="text-xs text-slate-600 italic">No purchase or quote history for this component</p>
          )}
        </div>
      )}

      {/* Peer competitor data for same component */}
      {component && history.peerRows.length > 0 && (
        <div className="bg-slate-900/60 border border-slate-800 rounded-xl p-4">
          <p className="text-[10px] font-bold uppercase tracking-widest text-slate-500 mb-3">
            Other Competitor Entries (same component)
          </p>
          <div className="space-y-2">
            {history.peerRows.map((p) => (
              <div key={p.competitor_price_id} className="flex items-start justify-between gap-2 text-xs">
                <div className="min-w-0">
                  <span className="text-white font-semibold">{p.competitor_brand || '—'}</span>
                  {p.competitor_model && <span className="text-slate-400 ml-1">{p.competitor_model}</span>}
                  <span className="block text-slate-500 text-[11px] mt-0.5">{fmtDate(p.observed_at)}</span>
                </div>
                <span className="text-sky-300 font-semibold flex-shrink-0">{fmtCcy(p.unit_price, p.currency)}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Empty state */}
      {!component && (
        <div className="bg-slate-900/40 border border-slate-800/60 rounded-xl p-6 text-center">
          <p className="text-slate-600 text-sm">Link a component to see cost comparison</p>
        </div>
      )}
    </div>
  );
}

// ─── Main form ───────────────────────────────────────────────────────────────

interface CompetitorPriceFormProps {
  components: Component[];
  suppliers?: Supplier[];
  poItems: PurchaseLineItem[];
  pos: PurchaseOrder[];
  quoteItems: PriceQuoteLineItem[];
  quotes: PriceQuote[];
  competitorPrices: CompetitorPrice[];
  onSubmit: (data: Record<string, any>) => void;
  loading: boolean;
}

const BLANK = {
  competitor_brand: '',
  competitor_model: '',
  competitor_description: '',
  category: '',
  capacity_w: '',
  unit_price: '',
  currency: 'USD',
  min_quantity: '',
  incoterms: '',
  price_type: 'listed',
  component_id: '',
  source_type: 'website',
  source_name: '',
  source_url: '',
  region: '',
  observed_at: nowLocal(),
  valid_until: '',
  confidence: 'medium',
  notes: '',
};

export default function CompetitorPriceForm({
  components, suppliers = [], poItems, pos, quoteItems, quotes, competitorPrices,
  onSubmit, loading,
}: CompetitorPriceFormProps) {
  const [form, setForm] = useState({ ...BLANK });
  const [linkedComponent, setLinkedComponent] = useState<Component | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [sourceMode, setSourceMode] = useState<'url' | 'quote'>('url');

  const set = (name: string, val: string) => {
    setForm((p) => ({ ...p, [name]: val }));
    if (errors[name]) setErrors((p) => { const n = { ...p }; delete n[name]; return n; });
  };

  const handleComponentLink = (id: string | null, comp: Component | null) => {
    setLinkedComponent(comp);
    setForm((p) => ({ ...p, component_id: id ?? '' }));
  };

  const validate = () => {
    const e: Record<string, string> = {};
    if (!form.unit_price || isNaN(Number(form.unit_price))) e.unit_price = 'Required';
    if (!form.currency) e.currency = 'Required';
    if (!form.observed_at) e.observed_at = 'Required';
    return e;
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const errs = validate();
    if (Object.keys(errs).length > 0) { setErrors(errs); return; }

    const payload: Record<string, any> = {};
    for (const [k, v] of Object.entries(form)) {
      if (v === '' || v === null) { payload[k] = null; continue; }
      if (['unit_price', 'capacity_w', 'min_quantity'].includes(k)) {
        payload[k] = Number(v);
      } else {
        payload[k] = v;
      }
    }
    // Convert datetime-local to ISO
    if (payload.observed_at) {
      payload.observed_at = new Date(payload.observed_at).toISOString();
    }

    onSubmit(payload);
    setForm({ ...BLANK, observed_at: nowLocal() });
    setLinkedComponent(null);
    setErrors({});
    setSourceMode('url');
  };

  const panelUnitPrice = form.unit_price ? Number(form.unit_price) : null;
  const panelCapacityW = form.capacity_w ? Number(form.capacity_w) : null;

  return (
    <div className="grid grid-cols-1 xl:grid-cols-[1fr_340px] gap-6 items-start">
      {/* ── Form ── */}
      <form
        onSubmit={handleSubmit}
        className="bg-slate-900/40 backdrop-blur-sm border border-slate-800/80 rounded-2xl shadow-xl ring-1 ring-white/5 p-5 md:p-6 space-y-6"
      >
        <div>
          <h2 className="text-base font-bold text-white">Log Competitor / Market Price</h2>
          <p className="text-xs text-slate-500 mt-0.5">
            Record observed market prices to compare against your True Unit Cost and guide sell pricing.
          </p>
        </div>

        {/* ─ Competitor product ─ */}
        <Section title="Competitor Product" icon="🏷">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <Field label="Brand">
              <input className={inputCls} value={form.competitor_brand} onChange={(e) => set('competitor_brand', e.target.value)} placeholder="e.g. Longi, Huawei, BYD" />
            </Field>
            <Field label="Model / SKU">
              <input className={inputCls} value={form.competitor_model} onChange={(e) => set('competitor_model', e.target.value)} placeholder="e.g. Hi-MO7 570W" />
            </Field>
            <Field label="Description">
              <input className={inputCls} value={form.competitor_description} onChange={(e) => set('competitor_description', e.target.value)} placeholder="Short description" />
            </Field>
            <Field label="Category">
              <select className={selectCls} value={form.category} onChange={(e) => set('category', e.target.value)}>
                <option value="">— Select —</option>
                {ENUMS.product_category.map((c) => <option key={c} value={c}>{c}</option>)}
              </select>
            </Field>
            <Field label="Power / Capacity (Wp or kWh)">
              <input className={inputCls} type="number" min="0" step="any" value={form.capacity_w} onChange={(e) => set('capacity_w', e.target.value)} placeholder="e.g. 570 for 570Wp" />
            </Field>
          </div>
        </Section>

        {/* ─ Price details ─ */}
        <Section title="Price Details" icon="💲">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <Field label="Unit Price" req>
              <input
                className={`${inputCls} ${errors.unit_price ? 'border-red-500/60 focus:ring-red-500/20' : ''}`}
                type="number" min="0" step="any"
                value={form.unit_price}
                onChange={(e) => set('unit_price', e.target.value)}
                placeholder="0.00"
              />
              {errors.unit_price && <span className="text-[11px] text-red-400 mt-0.5 block">{errors.unit_price}</span>}
            </Field>
            <Field label="Currency" req>
              <select className={selectCls} value={form.currency} onChange={(e) => set('currency', e.target.value)}>
                {ENUMS.currency.map((c) => <option key={c} value={c}>{c}</option>)}
              </select>
            </Field>
            <Field label="Incoterms">
              <input
                className={inputCls}
                list="incoterms-list"
                value={form.incoterms}
                onChange={(e) => set('incoterms', e.target.value)}
                placeholder="e.g. FOB, EXW, CIF"
              />
              <datalist id="incoterms-list">
                {['EXW', 'FOB', 'CIF', 'DDP', 'DAP', 'FCA'].map((t) => <option key={t} value={t} />)}
              </datalist>
            </Field>
            <Field label="Min. Order Qty">
              <input className={inputCls} type="number" min="1" value={form.min_quantity} onChange={(e) => set('min_quantity', e.target.value)} placeholder="e.g. 100" />
            </Field>
            <Field label="Price Type">
              <select className={selectCls} value={form.price_type} onChange={(e) => set('price_type', e.target.value)}>
                {ENUMS.competitor_price_type.map((t) => (
                  <option key={t} value={t}>{t.replace(/_/g, ' ')}</option>
                ))}
              </select>
            </Field>
          </div>
        </Section>

        {/* ─ Our reference ─ */}
        <Section title="Reference to Our Component" icon="🔗">
          <p className="text-[11px] text-slate-500 mb-2">
            Link to your own product to enable cost comparison and price index.
          </p>
          <ComponentSearch
            components={components}
            value={form.component_id || null}
            onChange={handleComponentLink}
          />
        </Section>

        {/* ─ Source ─ */}
        <Section title="Source" icon="📡">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <Field label="Source Type">
              <select className={selectCls} value={form.source_type} onChange={(e) => set('source_type', e.target.value)}>
                {ENUMS.competitor_source_type.map((t) => (
                  <option key={t} value={t}>{t.replace(/_/g, ' ')}</option>
                ))}
              </select>
            </Field>
            <Field label="Source Name">
              <input className={inputCls} value={form.source_name} onChange={(e) => set('source_name', e.target.value)} placeholder="e.g. Lazada, PVInfoLink, Customer ABC" />
            </Field>
            <Field label="Source Reference">
              {/* Toggle: external URL vs internal Quote/PI */}
              <div className="flex gap-1 mb-1.5">
                <button
                  type="button"
                  onClick={() => { setSourceMode('url'); set('source_url', ''); }}
                  className={`flex items-center gap-1 px-2 py-0.5 rounded text-[11px] font-semibold border transition-all ${sourceMode === 'url' ? 'bg-slate-700 border-slate-600 text-white' : 'bg-transparent border-transparent text-slate-500 hover:text-slate-300'}`}
                >
                  <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2"><path strokeLinecap="round" strokeLinejoin="round" d="M13.828 10.172a4 4 0 00-5.656 0l-4 4a4 4 0 105.656 5.656l1.102-1.101m-.758-4.899a4 4 0 005.656 0l4-4a4 4 0 00-5.656-5.656l-1.1 1.1" /></svg>
                  Website URL
                </button>
                <button
                  type="button"
                  onClick={() => { setSourceMode('quote'); set('source_url', ''); }}
                  className={`flex items-center gap-1 px-2 py-0.5 rounded text-[11px] font-semibold border transition-all ${sourceMode === 'quote' ? 'bg-violet-500/20 border-violet-500/40 text-violet-300' : 'bg-transparent border-transparent text-slate-500 hover:text-slate-300'}`}
                >
                  <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2"><path strokeLinecap="round" strokeLinejoin="round" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" /></svg>
                  Quote / PI
                </button>
              </div>
              {sourceMode === 'url' ? (
                <input
                  className={inputCls}
                  type="text"
                  value={form.source_url}
                  onChange={(e) => set('source_url', e.target.value)}
                  placeholder="https://… or any reference"
                />
              ) : (
                <QuoteRefPicker
                  quotes={quotes}
                  suppliers={suppliers}
                  value={form.source_url}
                  onChange={(ref, supplierName) => {
                    set('source_url', ref);
                    if (supplierName && !form.source_name) set('source_name', supplierName);
                  }}
                />
              )}
            </Field>
            <Field label="Market / Region">
              <input
                className={inputCls}
                list="region-list"
                value={form.region}
                onChange={(e) => set('region', e.target.value)}
                placeholder="e.g. Indonesia, Philippines"
              />
              <datalist id="region-list">
                {ENUMS.market_region.map((r) => <option key={r} value={r} />)}
              </datalist>
            </Field>
          </div>
        </Section>

        {/* ─ Meta ─ */}
        <Section title="Date & Meta" icon="📅">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <Field label="Observed At" req>
              <div className="flex gap-2">
                <input
                  className={`${inputCls} flex-1 ${errors.observed_at ? 'border-red-500/60' : ''}`}
                  type="datetime-local"
                  value={form.observed_at}
                  onChange={(e) => set('observed_at', e.target.value)}
                />
                <button
                  type="button"
                  onClick={() => set('observed_at', nowLocal())}
                  className="px-2.5 py-1.5 text-[11px] font-bold bg-slate-800 hover:bg-slate-700 border border-slate-700 text-slate-300 rounded-lg transition-all whitespace-nowrap"
                  title="Reset to now"
                >
                  Now
                </button>
              </div>
              {errors.observed_at && <span className="text-[11px] text-red-400 mt-0.5 block">{errors.observed_at}</span>}
            </Field>
            <Field label="Valid Until">
              <input className={inputCls} type="date" value={form.valid_until} onChange={(e) => set('valid_until', e.target.value)} />
            </Field>
            <Field label="Confidence">
              <select className={selectCls} value={form.confidence} onChange={(e) => set('confidence', e.target.value)}>
                {ENUMS.competitor_confidence.map((c) => <option key={c} value={c}>{c}</option>)}
              </select>
            </Field>
            <Field label="Notes">
              <textarea
                className={`${inputCls} resize-y min-h-[70px]`}
                value={form.notes}
                onChange={(e) => set('notes', e.target.value)}
                placeholder="Context, conditions, discount terms, etc."
              />
            </Field>
          </div>
        </Section>

        <button
          type="submit"
          disabled={loading}
          className="w-full flex items-center justify-center gap-2 px-6 py-3 text-sm font-bold bg-emerald-600 hover:bg-emerald-500 text-white rounded-xl shadow-lg shadow-emerald-900/20 border border-emerald-500/50 transition-all hover:-translate-y-0.5 active:translate-y-0 disabled:opacity-50 disabled:transform-none disabled:cursor-not-allowed"
        >
          {loading ? (
            <><span className="animate-spin">⏳</span> Saving…</>
          ) : (
            <><span>📊</span> Log Competitor Price</>
          )}
        </button>
      </form>

      {/* ── Comparison panel ── */}
      <div className="space-y-4">
        <div>
          <h3 className="text-sm font-bold text-white">Market Comparison</h3>
          <p className="text-[11px] text-slate-500 mt-0.5">Live analysis against your cost data</p>
        </div>
        <ComparisonPanel
          unitPrice={panelUnitPrice}
          currency={form.currency}
          capacityW={panelCapacityW}
          incoterms={form.incoterms}
          component={linkedComponent}
          poItems={poItems}
          pos={pos}
          quoteItems={quoteItems}
          quotes={quotes}
          competitorPrices={competitorPrices}
        />
      </div>
    </div>
  );
}
