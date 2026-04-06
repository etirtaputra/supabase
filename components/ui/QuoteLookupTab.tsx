/**
 * QuoteLookupTab
 *
 * Three view modes:
 *   "all"        — search all quotes by PI/quote number or supplier code
 *   "by-vendor"  — pick a supplier → see their quote list with accordion expand
 *   "by-company" — pick an "addressed to" company → see their quotes
 *
 * Each quote row expands inline to show line items, linked POs, and metadata.
 */
'use client';
import { useState, useMemo } from 'react';
import type {
  PriceQuote, PriceQuoteLineItem, Supplier, Company, Component, PurchaseOrder,
} from '@/types/database';
import { fmtCcy } from '@/lib/formatters';

// ── Constants ──────────────────────────────────────────────────────────────────

const QUOTE_STATUSES = ['Open', 'Accepted', 'Replaced', 'Rejected', 'Expired'] as const;

// ── Helpers ────────────────────────────────────────────────────────────────────

function statusBadge(status?: string) {
  const map: Record<string, string> = {
    Open:     'bg-sky-500/20 text-sky-300 border border-sky-500/30',
    Accepted: 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/30',
    Replaced: 'bg-slate-600/40 text-slate-400 border border-slate-600/40',
    Rejected: 'bg-red-500/20 text-red-300 border border-red-500/30',
    Expired:  'bg-amber-500/20 text-amber-300 border border-amber-500/30',
  };
  return map[status ?? ''] ?? 'bg-slate-700/60 text-slate-400';
}

// ── Types ──────────────────────────────────────────────────────────────────────

interface Props {
  quotes: PriceQuote[];
  quoteItems: PriceQuoteLineItem[];
  suppliers: Supplier[];
  companies: Company[];
  components: Component[];
  pos: PurchaseOrder[];
  onStatusChange?: (quoteId: string, status: string) => Promise<void>;
  onCreatePO?: (quoteId: string) => void;
}

// ── Main ───────────────────────────────────────────────────────────────────────

export default function QuoteLookupTab({
  quotes, quoteItems, suppliers, companies, components, pos, onStatusChange, onCreatePO,
}: Props) {

  const [viewMode, setViewMode]       = useState<'all' | 'by-vendor' | 'by-company'>('all');
  const [search, setSearch]           = useState('');
  const [expandedId, setExpandedId]   = useState<string | null>(null);
  const [selectedSuppId, setSelectedSuppId] = useState<string | null>(null);
  const [selectedCompId, setSelectedCompId] = useState<string | null>(null);
  const [updatingStatus, setUpdatingStatus] = useState<string | null>(null);

  // ── Derived lookups ──────────────────────────────────────────────────────────

  const supplierMap = useMemo(() => {
    const r: Record<number, Supplier> = {};
    for (const s of suppliers) r[s.supplier_id] = s;
    return r;
  }, [suppliers]);

  const companyMap = useMemo(() => {
    const r: Record<number, Company> = {};
    for (const c of companies) r[c.company_id] = c;
    return r;
  }, [companies]);

  // quote_id → POs that reference it
  const quoteToPOs = useMemo(() => {
    const r: Record<string, PurchaseOrder[]> = {};
    for (const po of pos) {
      if (!po.quote_id) continue;
      const key = String(po.quote_id);
      if (!r[key]) r[key] = [];
      r[key].push(po);
    }
    return r;
  }, [pos]);

  // Sorted quotes newest first
  const sorted = useMemo(
    () => [...quotes].sort((a, b) => b.quote_date.localeCompare(a.quote_date)),
    [quotes]
  );

  // All-mode: filtered list
  const filtered = useMemo(() => {
    const q = search.toLowerCase().trim();
    if (!q) return sorted.slice(0, 60);
    return sorted.filter((qt) => {
      const sup = supplierMap[qt.supplier_id];
      return (
        qt.pi_number?.toLowerCase().includes(q) ||
        String(qt.quote_id).includes(q) ||
        sup?.supplier_code?.toLowerCase().includes(q) ||
        sup?.supplier_name?.toLowerCase().includes(q)
      );
    });
  }, [sorted, search, supplierMap]);

  // By-vendor: stats per supplier
  const vendorStats = useMemo(() => {
    const map: Record<string, { supplier: Supplier; quoteCount: number; openCount: number; lastDate: string }> = {};
    for (const qt of quotes) {
      const sup = supplierMap[qt.supplier_id];
      if (!sup) continue;
      const key = String(sup.supplier_id);
      if (!map[key]) map[key] = { supplier: sup, quoteCount: 0, openCount: 0, lastDate: '' };
      map[key].quoteCount++;
      if (qt.status === 'Open' || !qt.status) map[key].openCount++;
      if (!map[key].lastDate || qt.quote_date > map[key].lastDate) map[key].lastDate = qt.quote_date;
    }
    return Object.values(map).sort((a, b) => b.openCount - a.openCount || b.quoteCount - a.quoteCount);
  }, [quotes, supplierMap]);

  const vendorQuotes = useMemo(
    () => selectedSuppId
      ? sorted.filter((qt) => String(qt.supplier_id) === selectedSuppId)
      : [],
    [sorted, selectedSuppId]
  );

  // By-company: stats per company
  const companyStats = useMemo(() => {
    const map: Record<string, { company: Company; quoteCount: number; openCount: number }> = {};
    for (const qt of quotes) {
      const co = companyMap[qt.company_id];
      if (!co) continue;
      const key = String(co.company_id);
      if (!map[key]) map[key] = { company: co, quoteCount: 0, openCount: 0 };
      map[key].quoteCount++;
      if (qt.status === 'Open' || !qt.status) map[key].openCount++;
    }
    return Object.values(map).sort((a, b) => b.quoteCount - a.quoteCount);
  }, [quotes, companyMap]);

  const companyQuotes = useMemo(
    () => selectedCompId
      ? sorted.filter((qt) => String(qt.company_id) === selectedCompId)
      : [],
    [sorted, selectedCompId]
  );

  // ── Shared: inline detail for an expanded quote ──────────────────────────────

  const renderDetail = (qt: PriceQuote) => {
    const items  = quoteItems.filter((i) => String(i.quote_id) === String(qt.quote_id));
    const linked = quoteToPOs[String(qt.quote_id)] ?? [];
    const sup    = supplierMap[qt.supplier_id];
    const co     = companyMap[qt.company_id];
    return (
      <div className="mt-2.5 pt-3 border-t border-slate-700/40 space-y-3 text-xs">

        {/* Meta grid */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
          {[
            { label: 'Supplier',   value: sup?.supplier_name },
            { label: 'Addressed To', value: co?.legal_name },
            { label: 'Currency',   value: qt.currency },
            { label: 'Lead Time',  value: qt.estimated_lead_time_days },
          ].map(({ label, value }) => value ? (
            <div key={label}>
              <p className="text-[10px] font-bold uppercase tracking-wider text-slate-600">{label}</p>
              <p className="text-slate-300 mt-0.5">{value}</p>
            </div>
          ) : null)}
        </div>

        {/* Linked POs */}
        {linked.length > 0 && (
          <div>
            <p className="text-[10px] font-bold uppercase tracking-wider text-slate-500 mb-1.5">
              Converted to PO{linked.length > 1 ? 's' : ''}
            </p>
            <div className="flex flex-wrap gap-1.5">
              {linked.map((p) => (
                <span
                  key={p.po_id}
                  className="inline-flex items-center gap-1 px-2 py-0.5 bg-violet-500/15 border border-violet-500/30 text-violet-300 text-[11px] font-semibold rounded"
                >
                  <span>📦</span>
                  <span>{p.po_number}{p.pi_number ? ` · ${p.pi_number}` : ''}</span>
                </span>
              ))}
            </div>
          </div>
        )}

        {/* Line items */}
        {items.length > 0 ? (
          <div>
            <p className="text-[10px] font-bold uppercase tracking-wider text-slate-500 mb-1.5">
              Line Items ({items.length})
            </p>
            <div className="overflow-x-auto">
              <table className="w-full text-xs border-collapse">
                <thead>
                  <tr className="border-b border-slate-700/60">
                    <th className="text-left py-1.5 pr-4 text-[11px] font-bold uppercase text-slate-500">Component</th>
                    <th className="text-right py-1.5 pr-4 text-[11px] font-bold uppercase text-slate-500">Qty</th>
                    <th className="text-right py-1.5 pr-4 text-[11px] font-bold uppercase text-slate-500">Unit Price</th>
                    <th className="text-right py-1.5 text-[11px] font-bold uppercase text-slate-500">Line Total</th>
                  </tr>
                </thead>
                <tbody>
                  {items.map((item) => {
                    const comp      = components.find((c) => c.component_id === item.component_id);
                    const lineTotal = (Number(item.quantity) || 0) * (Number(item.unit_price) || 0);
                    return (
                      <tr key={item.quote_line_id} className="border-b border-slate-800/40 last:border-0">
                        <td className="py-2 pr-4">
                          <p className="font-semibold text-white">{comp?.supplier_model ?? '—'}</p>
                          {comp?.internal_description && (
                            <p className="text-[11px] text-slate-500 mt-0.5 truncate max-w-xs">{comp.internal_description}</p>
                          )}
                          {item.supplier_description && !comp && (
                            <p className="text-[11px] text-slate-500 mt-0.5">{item.supplier_description}</p>
                          )}
                        </td>
                        <td className="py-2 pr-4 text-right text-slate-300">{Number(item.quantity).toLocaleString()}</td>
                        <td className="py-2 pr-4 text-right text-slate-300">{fmtCcy(Number(item.unit_price), item.currency)}</td>
                        <td className="py-2 text-right font-semibold text-white">{fmtCcy(lineTotal, item.currency)}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        ) : (
          <p className="text-[11px] text-slate-600 italic">No line items on this quote.</p>
        )}
      </div>
    );
  };

  // ── Shared: single quote accordion row ───────────────────────────────────────

  const renderQuoteRow = (qt: PriceQuote, showSupplier = true) => {
    const key     = String(qt.quote_id);
    const expanded = expandedId === key;
    const sup     = supplierMap[qt.supplier_id];
    const co      = companyMap[qt.company_id];
    const linked  = quoteToPOs[key] ?? [];
    const hasPO   = linked.length > 0;

    return (
      <div
        key={key}
        className={`rounded-xl border transition-colors ${expanded ? 'bg-slate-800/40 border-slate-600/50' : 'bg-slate-800/20 border-transparent hover:bg-slate-800/40'}`}
      >
        <button
          className="w-full text-left px-3 py-2.5"
          onClick={() => setExpandedId(expanded ? null : key)}
        >
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-slate-500 text-[10px] w-3 flex-shrink-0">{expanded ? '▼' : '▶'}</span>
            {showSupplier && sup?.supplier_code && (
              <span className="inline-block px-1.5 py-0.5 bg-sky-500/15 border border-sky-500/30 text-sky-300 text-[10px] font-bold rounded leading-none flex-shrink-0">
                {sup.supplier_code}
              </span>
            )}
            <span className="text-xs font-semibold text-slate-200">
              {qt.pi_number ?? `Q#${qt.quote_id}`}
            </span>
            {qt.status && (
              <span className={`inline-block px-1.5 py-0.5 text-[10px] font-bold rounded leading-none flex-shrink-0 ${statusBadge(qt.status)}`}>
                {qt.status}
              </span>
            )}
            {hasPO && (
              <span className="inline-block px-1.5 py-0.5 bg-violet-500/15 border border-violet-500/30 text-violet-300 text-[10px] font-bold rounded leading-none flex-shrink-0">
                PO ✓
              </span>
            )}
          </div>
          <div className="text-[11px] mt-0.5 flex flex-wrap gap-x-3 pl-5 text-slate-500">
            {showSupplier && sup && <span className="text-slate-400">{sup.supplier_name}</span>}
            <span>{qt.quote_date}</span>
            {qt.total_value != null && (
              <span className="font-medium text-slate-400">{fmtCcy(Number(qt.total_value), qt.currency)}</span>
            )}
            {co && <span className="text-slate-600">→ {co.legal_name}</span>}
          </div>
        </button>

        {/* Status selector */}
        {onStatusChange && (
          <div className="px-3 pb-2 flex items-center gap-1.5">
            <select
              value={qt.status ?? ''}
              disabled={updatingStatus === key}
              onClick={(e) => e.stopPropagation()}
              onChange={async (e) => {
                e.stopPropagation();
                setUpdatingStatus(key);
                try { await onStatusChange(key, e.target.value); } finally { setUpdatingStatus(null); }
              }}
              className={`flex-1 text-[11px] font-semibold rounded-lg px-2 py-1 border bg-slate-900 focus:outline-none focus:ring-1 focus:ring-sky-500/40 cursor-pointer disabled:opacity-60 ${statusBadge(qt.status)}`}
            >
              {QUOTE_STATUSES.map((s) => (
                <option key={s} value={s} className="bg-[#0B1120] text-slate-200">{s}</option>
              ))}
            </select>
            {updatingStatus === key && (
              <span className="text-[10px] text-slate-500 animate-pulse flex-shrink-0">saving…</span>
            )}
          </div>
        )}

        {/* Create PO shortcut — only for open quotes with no PO yet */}
        {onCreatePO && !hasPO && (qt.status === 'Open' || !qt.status) && (
          <div className="px-3 pb-2">
            <button
              onClick={(e) => { e.stopPropagation(); onCreatePO(key); }}
              className="w-full text-left px-3 py-2 bg-violet-500/10 hover:bg-violet-500/20 border border-violet-500/30 text-violet-300 text-xs font-semibold rounded-lg transition-colors flex items-center gap-2"
            >
              <span>📦</span>
              <span>Create PO from this quote →</span>
            </button>
          </div>
        )}

        {/* Accordion detail */}
        {expanded && (
          <div className="px-3 pb-3">
            {renderDetail(qt)}
          </div>
        )}
      </div>
    );
  };

  // ── Left-panel list helper (vendor or company) ────────────────────────────────

  const renderLeftItem = (
    id: string,
    name: string,
    code: string | undefined,
    quoteCount: number,
    openCount: number,
    selected: boolean,
    onClick: () => void,
  ) => (
    <button
      key={id}
      onClick={onClick}
      className={`w-full text-left px-3 py-3 rounded-xl transition-colors border ${
        selected
          ? 'bg-sky-500/10 border-sky-500/30 text-white'
          : 'bg-slate-800/30 border-transparent hover:bg-slate-800/60 text-slate-300'
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
        <span className="text-[10px] text-slate-500 flex-shrink-0">{quoteCount} quote{quoteCount !== 1 ? 's' : ''}</span>
      </div>
      {openCount > 0 && (
        <p className="text-[11px] text-sky-400 font-semibold pl-0.5">{openCount} open</p>
      )}
    </button>
  );

  // ── Render ────────────────────────────────────────────────────────────────────

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
                setExpandedId(null);
                setSelectedSuppId(null);
                setSelectedCompId(null);
              }}
              className={`px-4 py-2 transition-colors capitalize ${
                viewMode === mode
                  ? 'bg-sky-500/20 text-sky-300'
                  : 'bg-slate-800/60 text-slate-400 hover:text-slate-300'
              }`}
            >
              {mode === 'all' ? 'All Quotes' : mode === 'by-vendor' ? 'By Vendor' : 'By Company'}
            </button>
          ))}
        </div>
        <p className="text-xs text-slate-500">
          {viewMode === 'all'
            ? `${filtered.length} quote${filtered.length !== 1 ? 's' : ''} shown`
            : viewMode === 'by-vendor'
            ? `${vendorStats.length} vendors`
            : `${companyStats.length} companies`}
        </p>
      </div>

      {/* ══ ALL MODE ══ */}
      {viewMode === 'all' && (
        <div>
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search by PI number, supplier code or name…"
            className="w-full max-w-lg px-3 py-2 bg-slate-950 border border-slate-700 rounded-lg text-sm text-white placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-sky-500/20 focus:border-sky-500 mb-4"
          />
          {filtered.length === 0 ? (
            <p className="text-xs text-slate-600 italic py-6 text-center">No quotes found</p>
          ) : (
            <div className="space-y-1.5">
              {filtered.map((qt) => renderQuoteRow(qt))}
            </div>
          )}
        </div>
      )}

      {/* ══ BY VENDOR MODE ══ */}
      {viewMode === 'by-vendor' && (
        <div className="grid grid-cols-1 xl:grid-cols-[340px_1fr] 2xl:grid-cols-[420px_1fr] gap-5 xl:gap-7 items-start">

          {/* Left: vendor list */}
          <div className="bg-slate-900/40 backdrop-blur-sm border border-slate-800/80 rounded-2xl ring-1 ring-white/5 p-4">
            <h3 className="text-sm font-bold text-white mb-3">Vendors</h3>
            <div className="space-y-1.5 max-h-[calc(100vh-240px)] xl:max-h-[calc(100vh-200px)] overflow-y-auto pr-0.5">
              {vendorStats.length === 0 && (
                <p className="text-xs text-slate-600 italic px-1 py-4 text-center">No vendors found</p>
              )}
              {vendorStats.map(({ supplier, quoteCount, openCount }) => {
                const id = String(supplier.supplier_id);
                return renderLeftItem(
                  id, supplier.supplier_name, supplier.supplier_code,
                  quoteCount, openCount,
                  selectedSuppId === id,
                  () => { setSelectedSuppId(selectedSuppId === id ? null : id); setExpandedId(null); },
                );
              })}
            </div>
          </div>

          {/* Right: quotes for selected vendor */}
          <div>
            {!selectedSuppId ? (
              <div className="bg-slate-900/40 border border-slate-800/80 rounded-2xl ring-1 ring-white/5 p-10 flex flex-col items-center justify-center text-center min-h-[260px]">
                <span className="text-4xl mb-3 opacity-40">🏭</span>
                <p className="text-slate-500 text-sm">Select a vendor to view their quotes</p>
              </div>
            ) : (
              <div className="space-y-4">
                {/* Vendor header */}
                {(() => {
                  const stat = vendorStats.find((v) => String(v.supplier.supplier_id) === selectedSuppId);
                  if (!stat) return null;
                  return (
                    <div className="bg-slate-900/40 backdrop-blur-sm border border-slate-800/80 rounded-2xl ring-1 ring-white/5 p-5">
                      <div className="flex items-start justify-between gap-3 flex-wrap">
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
                        <div className="text-right text-xs text-slate-400">
                          <p>{stat.quoteCount} quote{stat.quoteCount !== 1 ? 's' : ''}</p>
                          {stat.openCount > 0 && (
                            <p className="text-sky-400 font-semibold">{stat.openCount} open</p>
                          )}
                          {stat.lastDate && <p className="text-slate-600 mt-0.5">Last: {stat.lastDate}</p>}
                        </div>
                      </div>
                    </div>
                  );
                })()}
                {/* Quote list */}
                <div className="bg-slate-900/40 border border-slate-800/80 rounded-2xl ring-1 ring-white/5 p-4">
                  <h4 className="text-xs font-bold uppercase tracking-wider text-slate-500 mb-3">Quotes</h4>
                  {vendorQuotes.length === 0 ? (
                    <p className="text-xs text-slate-600 italic py-4 text-center">No quotes for this vendor</p>
                  ) : (
                    <div className="space-y-1.5">
                      {vendorQuotes.map((qt) => renderQuoteRow(qt, false))}
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* ══ BY COMPANY MODE ══ */}
      {viewMode === 'by-company' && (
        <div className="grid grid-cols-1 xl:grid-cols-[340px_1fr] 2xl:grid-cols-[420px_1fr] gap-5 xl:gap-7 items-start">

          {/* Left: company list */}
          <div className="bg-slate-900/40 backdrop-blur-sm border border-slate-800/80 rounded-2xl ring-1 ring-white/5 p-4">
            <h3 className="text-sm font-bold text-white mb-3">Companies</h3>
            <div className="space-y-1.5 max-h-[calc(100vh-240px)] xl:max-h-[calc(100vh-200px)] overflow-y-auto pr-0.5">
              {companyStats.length === 0 && (
                <p className="text-xs text-slate-600 italic px-1 py-4 text-center">No companies found</p>
              )}
              {companyStats.map(({ company, quoteCount, openCount }) => {
                const id = String(company.company_id);
                return renderLeftItem(
                  id, company.legal_name, undefined,
                  quoteCount, openCount,
                  selectedCompId === id,
                  () => { setSelectedCompId(selectedCompId === id ? null : id); setExpandedId(null); },
                );
              })}
            </div>
          </div>

          {/* Right: quotes for selected company */}
          <div>
            {!selectedCompId ? (
              <div className="bg-slate-900/40 border border-slate-800/80 rounded-2xl ring-1 ring-white/5 p-10 flex flex-col items-center justify-center text-center min-h-[260px]">
                <span className="text-4xl mb-3 opacity-40">🏢</span>
                <p className="text-slate-500 text-sm">Select a company to view addressed quotes</p>
              </div>
            ) : (
              <div className="space-y-4">
                {/* Company header */}
                {(() => {
                  const stat = companyStats.find((c) => String(c.company.company_id) === selectedCompId);
                  if (!stat) return null;
                  return (
                    <div className="bg-slate-900/40 backdrop-blur-sm border border-slate-800/80 rounded-2xl ring-1 ring-white/5 p-5">
                      <div className="flex items-start justify-between gap-3 flex-wrap">
                        <div>
                          <h2 className="text-xl font-bold text-white">{stat.company.legal_name}</h2>
                        </div>
                        <div className="text-right text-xs text-slate-400">
                          <p>{stat.quoteCount} quote{stat.quoteCount !== 1 ? 's' : ''}</p>
                          {stat.openCount > 0 && (
                            <p className="text-sky-400 font-semibold">{stat.openCount} open</p>
                          )}
                        </div>
                      </div>
                    </div>
                  );
                })()}
                {/* Quote list */}
                <div className="bg-slate-900/40 border border-slate-800/80 rounded-2xl ring-1 ring-white/5 p-4">
                  <h4 className="text-xs font-bold uppercase tracking-wider text-slate-500 mb-3">Quotes</h4>
                  {companyQuotes.length === 0 ? (
                    <p className="text-xs text-slate-600 italic py-4 text-center">No quotes for this company</p>
                  ) : (
                    <div className="space-y-1.5">
                      {companyQuotes.map((qt) => renderQuoteRow(qt))}
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
