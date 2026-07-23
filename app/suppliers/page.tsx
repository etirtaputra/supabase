'use client';
/**
 * ICAPROC — Buy-side: Suppliers (Vendors)
 * The buy-side mirror of the Customers page: searchable vendor master where
 * clicking a supplier opens a PROFILE — total purchased, paid, outstanding
 * payables, every supplier quote and PO (each linking to its Deal Lookup),
 * and the most purchased items. Gated to buy-side roles + owner.
 */
import { useState, useEffect, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/hooks/useAuth';
import { useSupabaseData } from '@/hooks/useSupabaseData';
import { ROLE_PERMISSIONS } from '@/constants/roles';
import { PRINCIPAL_CATS } from '@/constants/costCategories';
import BrandMenu from '@/components/ui/BrandMenu';
import type { Supplier, PriceQuote, PurchaseOrder, POCost, PurchaseLineItem, Component } from '@/types/database';

const fmtIdr = (n: number) => 'Rp' + Math.round(n).toLocaleString('en-US');
const fmtDate = (d?: string | null) => d ? new Date(d.length <= 10 ? `${d}T00:00:00` : d).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: '2-digit' }) : '';
const lookupHref = (n: string) => `/catalog?tab=lookup&q=${encodeURIComponent(n)}`;

interface SupplierStats {
  quotes: PriceQuote[];
  pos: PurchaseOrder[];
  purchasedIdr: number;   // Σ PO totals (IDR-converted)
  paidIdr: number;        // Σ principal payments
  outstandingIdr: number; // Σ max(0, po total − paid) per PO
}

export default function SuppliersPage() {
  const router = useRouter();
  const { user, profile, loading: authLoading } = useAuth();
  const canView = !!profile && ROLE_PERMISSIONS[profile.role].buySide;
  const { data, loading } = useSupabaseData();

  const [search, setSearch] = useState('');
  const [profileFor, setProfileFor] = useState<Supplier | null>(null);

  useEffect(() => { document.title = 'Suppliers — ICAPROC'; }, []);
  useEffect(() => {
    if (authLoading) return;
    if (!user) { router.replace(`/login?next=${encodeURIComponent('/suppliers')}`); return; }
    if (profile && !ROLE_PERMISSIONS[profile.role].buySide) router.replace('/unauthorized');
  }, [authLoading, user, profile, router]);

  const quoteById = useMemo(() => new Map(data.quotes.map((q) => [String(q.quote_id), q])), [data.quotes]);

  // Supplier for a PO: direct supplier_id, else via its linked quote
  const poSupplierId = useMemo(() => {
    return (po: PurchaseOrder & { quote_id?: number | string | null }): string | null =>
      po.supplier_id ?? (po.quote_id != null ? (quoteById.get(String(po.quote_id))?.supplier_id ?? null) : null);
  }, [quoteById]);

  const poIdr = (po: PurchaseOrder) => {
    const total = Number(po.total_value) || 0;
    return po.currency === 'IDR' ? total : total * (Number(po.exchange_rate) || 1);
  };

  const costsByPo = useMemo(() => {
    const m = new Map<string, POCost[]>();
    for (const c of data.poCosts) {
      const k = String(c.po_id);
      (m.get(k) ?? m.set(k, []).get(k)!).push(c);
    }
    return m;
  }, [data.poCosts]);

  const poPaidIdr = (po: PurchaseOrder) =>
    (costsByPo.get(String(po.po_id)) ?? [])
      .filter((c) => PRINCIPAL_CATS.has(c.cost_category))
      .reduce((s, c) => s + (c.currency === 'IDR' ? Number(c.amount) : Number(c.amount) * (Number(c.exchange_rate) || Number(po.exchange_rate) || 1)), 0);

  const statsBySupplier = useMemo(() => {
    const m = new Map<string, SupplierStats>();
    const get = (id: string) => m.get(id) ?? m.set(id, { quotes: [], pos: [], purchasedIdr: 0, paidIdr: 0, outstandingIdr: 0 }).get(id)!;
    for (const q of data.quotes) if (q.supplier_id) get(q.supplier_id).quotes.push(q);
    for (const po of data.pos) {
      const sid = poSupplierId(po);
      if (!sid) continue;
      const st = get(sid);
      st.pos.push(po);
      const total = poIdr(po);
      const paid = poPaidIdr(po);
      st.purchasedIdr += total;
      st.paidIdr += paid;
      st.outstandingIdr += Math.max(0, total - paid);
    }
    return m;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data.quotes, data.pos, data.poCosts, poSupplierId]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    const list = [...data.suppliers].sort((a, b) => (statsBySupplier.get(b.supplier_id)?.purchasedIdr ?? 0) - (statsBySupplier.get(a.supplier_id)?.purchasedIdr ?? 0));
    if (!q) return list;
    return list.filter((s) => [s.supplier_name, s.supplier_code, s.location].filter(Boolean).join(' ').toLowerCase().includes(q));
  }, [data.suppliers, search, statsBySupplier]);

  if (authLoading || !profile) return <CenterSpinner />;
  if (!canView) return <CenterSpinner />;

  return (
    <div className="min-h-screen bg-[#0f1012] text-slate-200 font-sans text-sm">
      <div className="border-b border-slate-800/60 bg-[#0f1012]/80 backdrop-blur-md sticky top-0 z-30">
        <div className="max-w-[1200px] 2xl:max-w-[1760px] mx-auto px-3 sm:px-4 md:px-6 py-4 flex items-center justify-between gap-4">
          <BrandMenu wordmarkClass="text-xl md:text-2xl font-extrabold" subtitle="Suppliers · Vendors" />
          <span className="text-[11px] text-slate-500 whitespace-nowrap">Vendors are created in Catalog → Supplier Quotes</span>
        </div>
      </div>

      <main className="max-w-[1200px] 2xl:max-w-[1760px] mx-auto px-3 sm:px-4 md:px-6 py-6 space-y-5">
        <div className="relative">
          <svg className="w-4 h-4 text-slate-500 absolute left-3.5 top-1/2 -translate-y-1/2" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M21 21l-4.35-4.35M17 11a6 6 0 11-12 0 6 6 0 0112 0z" /></svg>
          <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search supplier name, code, location…"
            className="w-full pl-10 pr-4 h-11 rounded-xl bg-slate-900/80 border border-slate-700/80 focus:border-sky-500/60 outline-none text-white text-base sm:text-sm placeholder:text-[13px] sm:placeholder:text-sm placeholder:text-slate-500 transition-colors" />
        </div>

        <div className="bg-slate-900/40 border border-slate-800/80 rounded-2xl overflow-hidden">
          <div className="hidden md:grid grid-cols-[90px_1fr_120px_100px_150px_150px] gap-3 px-4 py-2.5 border-b border-slate-800 text-[10px] font-semibold uppercase tracking-widest text-slate-500">
            <span>Code</span><span>Supplier</span><span className="text-right">Quotes / POs</span><span /><span className="text-right">Purchased</span><span className="text-right">Outstanding</span>
          </div>
          {loading ? (
            <div className="p-4 space-y-1.5">{[...Array(6)].map((_, i) => <div key={i} className="h-12 bg-slate-800/40 rounded-xl animate-pulse" />)}</div>
          ) : filtered.length === 0 ? (
            <div className="px-4 py-12 text-center text-slate-600 text-sm">{data.suppliers.length === 0 ? 'No suppliers yet — add one in Catalog.' : 'No matches.'}</div>
          ) : (
            <div className="divide-y divide-slate-800/60">
              {filtered.map((s) => {
                const st = statsBySupplier.get(s.supplier_id);
                const open = profileFor?.supplier_id === s.supplier_id;
                return (
                  <div key={s.supplier_id}>
                    <button onClick={() => setProfileFor(open ? null : s)} aria-expanded={open}
                      className={`w-full text-left grid grid-cols-2 md:grid-cols-[90px_1fr_120px_100px_150px_150px] gap-1 md:gap-3 px-4 py-3 transition-colors items-center ${open ? 'bg-slate-800/40' : 'hover:bg-slate-800/40'}`}>
                      <span className="font-mono text-[11px] text-sky-300">{s.supplier_code || '—'}</span>
                      <span className="min-w-0">
                        <span className="block text-sm text-slate-100 font-medium truncate">{s.supplier_name}</span>
                        {s.location && <span className="block text-[11px] text-slate-500 truncate">{s.location}</span>}
                      </span>
                      <span className="text-right text-[11px] text-slate-400 tabular-nums">{st?.quotes.length ?? 0} / {st?.pos.length ?? 0}</span>
                      <span />
                      <span className="text-right tabular-nums text-slate-200">{st && st.purchasedIdr > 0 ? fmtIdr(st.purchasedIdr) : <span className="text-slate-600">—</span>}</span>
                      <span className="flex items-center justify-end gap-2">
                        <span className={`text-right tabular-nums ${st && st.outstandingIdr > 0.5 ? 'text-amber-300 font-semibold' : 'text-emerald-400/70'}`}>
                          {st && st.outstandingIdr > 0.5 ? fmtIdr(st.outstandingIdr) : '✓ settled'}
                        </span>
                        <svg className={`w-3.5 h-3.5 text-slate-600 transition-transform duration-150 ${open ? 'rotate-180 text-slate-400' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2"><path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" /></svg>
                      </span>
                    </button>
                    {/* Inline preview — expands under the row */}
                    {open && (
                      <SupplierProfile
                        supplier={s}
                        stats={st ?? { quotes: [], pos: [], purchasedIdr: 0, paidIdr: 0, outstandingIdr: 0 }}
                        poItems={data.poItems}
                        components={data.components}
                        poPaidIdr={poPaidIdr}
                        poIdr={poIdr}
                        onClose={() => setProfileFor(null)}
                      />
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </main>

    </div>
  );
}

function CenterSpinner() {
  return <div className="min-h-screen bg-[#0f1012] flex items-center justify-center"><div className="w-6 h-6 border-2 border-sky-500/30 border-t-sky-500 rounded-full animate-spin" /></div>;
}

// ── Supplier profile drawer ─────────────────────────────────────────────────
function SupplierProfile({ supplier, stats, poItems, components, poPaidIdr, poIdr, onClose }: {
  supplier: Supplier;
  stats: SupplierStats;
  poItems: PurchaseLineItem[];
  components: Component[];
  poPaidIdr: (po: PurchaseOrder) => number;
  poIdr: (po: PurchaseOrder) => number;
  onClose: () => void;
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const compById = useMemo(() => new Map(components.map((c) => [c.component_id, c])), [components]);
  const poById = useMemo(() => new Map(stats.pos.map((p) => [String(p.po_id), p])), [stats.pos]);

  // Most purchased items across this supplier's POs, by IDR value
  const topItems = useMemo(() => {
    const agg = new Map<string, { desc: string; qty: number; value: number; times: number }>();
    for (const li of poItems) {
      const po = poById.get(String(li.po_id));
      if (!po || !li.component_id) continue;
      const c = compById.get(li.component_id);
      const desc = (c?.internal_description?.trim() || c?.supplier_model || li.supplier_description || '').trim();
      if (!desc) continue;
      const rate = li.currency === 'IDR' ? 1 : (Number(po.exchange_rate) || 1);
      const a = agg.get(desc.toLowerCase()) ?? { desc, qty: 0, value: 0, times: 0 };
      a.qty += Number(li.quantity) || 0;
      a.value += (Number(li.unit_cost) || 0) * (Number(li.quantity) || 0) * rate;
      a.times += 1;
      agg.set(desc.toLowerCase(), a);
    }
    return [...agg.values()].sort((a, b) => b.value - a.value).slice(0, 6);
  }, [poItems, poById, compById]);

  // Unified document timeline: quotes + POs, newest first, all linked
  const docs = useMemo(() => {
    const rows: { kind: 'quote' | 'po'; number: string; date: string; sub: string; amountIdr: number | null; paidPct: number | null; status: string }[] = [];
    for (const q of stats.quotes) {
      rows.push({
        kind: 'quote', number: q.pi_number || `Quote #${q.quote_id}`, date: q.quote_date ?? '',
        sub: q.currency !== 'IDR' ? `${q.currency} ${Number(q.total_value).toLocaleString('en-US')}` : '',
        amountIdr: q.currency === 'IDR' ? Number(q.total_value) : null, paidPct: null, status: q.status ?? '',
      });
    }
    for (const po of stats.pos) {
      const total = poIdr(po);
      const paid = poPaidIdr(po);
      rows.push({
        kind: 'po', number: po.po_number || `PO #${po.po_id}`, date: po.po_date ?? '',
        sub: '', amountIdr: total, paidPct: total > 0 ? Math.min(100, (paid / total) * 100) : null, status: po.status ?? '',
      });
    }
    return rows.sort((a, b) => (b.date || '').localeCompare(a.date || ''));
  }, [stats, poIdr, poPaidIdr]);

  return (
    <div className="border-t border-slate-800/60 bg-[#101214]">
      {/* Context strip: code · location · terms · contact. The row above
          already shows the name, so no repeated heading. */}
      <div className="px-4 py-2.5 flex items-center gap-3 border-b border-slate-800/60">
        <p className="text-[11px] text-slate-500 truncate flex-1">
          <span className="font-mono text-sky-300">{supplier.supplier_code || 'no code'}</span>
          {supplier.location ? ` · ${supplier.location}` : ''}
          {supplier.payment_terms_default ? ` · ${supplier.payment_terms_default}` : ''}
          {supplier.primary_contact_email ? ` · ${supplier.primary_contact_email}` : ''}
        </p>
        <button onClick={onClose} title="Collapse" className="p-1.5 -m-1 text-slate-500 hover:text-white transition-colors flex-shrink-0">
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2"><path strokeLinecap="round" strokeLinejoin="round" d="M5 15l7-7 7 7" /></svg>
        </button>
      </div>

      <div className="px-4 py-4 space-y-5">
          {/* KPIs */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5">
            <Kpi label="Total purchased" value={fmtIdr(stats.purchasedIdr)} sub={`${stats.pos.length} PO${stats.pos.length !== 1 ? 's' : ''}`} cls="text-sky-300" />
            <Kpi label="Paid" value={fmtIdr(stats.paidIdr)} sub="principal payments" cls="text-slate-200" />
            <Kpi label="Outstanding payables" value={fmtIdr(stats.outstandingIdr)} sub="unpaid on POs" cls={stats.outstandingIdr > 0.5 ? 'text-amber-300' : 'text-emerald-400'} />
            <Kpi label="Quotes → POs" value={stats.quotes.length > 0 ? `${Math.round((stats.pos.length / stats.quotes.length) * 100)}%` : '—'} sub={`${stats.pos.length} of ${stats.quotes.length} quotes`} cls="text-slate-200" />
          </div>

          {/* Documents — every quote & PO, linked to Deal Lookup */}
          <section>
            <h3 className="text-xs font-semibold uppercase tracking-widest text-slate-400 mb-2">Documents & activity</h3>
            {docs.length === 0 ? (
              <p className="text-xs text-slate-600 italic">No supplier quotes or POs yet.</p>
            ) : (
              <div className="rounded-xl border border-slate-800 divide-y divide-slate-800/60">
                {docs.map((d, i) => (
                  <a key={`${d.kind}-${d.number}-${i}`} href={lookupHref(d.number)}
                    className="flex items-center gap-2 px-3 py-2.5 hover:bg-slate-800/40 transition-colors text-xs">
                    <span className={`px-1.5 py-0.5 rounded text-[10px] font-bold flex-shrink-0 ${d.kind === 'quote' ? 'bg-sky-500/15 text-sky-300' : 'bg-indigo-500/15 text-indigo-300'}`}>
                      {d.kind === 'quote' ? 'QUOTE' : 'PO'}
                    </span>
                    <span className="font-mono text-[11px] text-slate-200 truncate">{d.number}</span>
                    {d.status && <span className="px-1.5 py-0.5 rounded bg-slate-800 text-slate-400 text-[10px] flex-shrink-0">{d.status}</span>}
                    {d.paidPct != null && (
                      <span className={`text-[10px] font-semibold flex-shrink-0 ${d.paidPct >= 100 ? 'text-emerald-400' : d.paidPct > 0 ? 'text-amber-300' : 'text-slate-600'}`}>
                        {d.paidPct >= 100 ? '✓ paid' : `${d.paidPct.toFixed(0)}% paid`}
                      </span>
                    )}
                    <span className="ml-auto tabular-nums text-slate-200 font-semibold flex-shrink-0">
                      {d.amountIdr != null ? fmtIdr(d.amountIdr) : d.sub}
                    </span>
                    <span className="text-[10px] text-slate-600 tabular-nums flex-shrink-0">{fmtDate(d.date)}</span>
                  </a>
                ))}
              </div>
            )}
            <p className="mt-1.5 text-[10px] text-slate-600">Click any document to open it in Deal Lookup.</p>
          </section>

          {/* Most purchased items */}
          <section>
            <h3 className="text-xs font-semibold uppercase tracking-widest text-slate-400 mb-2">Most purchased items</h3>
            {topItems.length === 0 ? (
              <p className="text-xs text-slate-600 italic">No PO lines yet.</p>
            ) : (
              <div className="rounded-xl border border-slate-800 divide-y divide-slate-800/60">
                {topItems.map((it) => (
                  <div key={it.desc} className="flex items-center gap-3 px-3 py-2 text-xs">
                    <span className="text-slate-300 truncate flex-1">{it.desc}</span>
                    <span className="text-slate-500 tabular-nums flex-shrink-0">{it.qty.toLocaleString('en-US')}</span>
                    <span className="text-slate-200 tabular-nums font-semibold flex-shrink-0 w-28 text-right">{fmtIdr(it.value)}</span>
                  </div>
                ))}
              </div>
            )}
          </section>

          {/* Bank details (buy-side sensitive, useful when paying) */}
          {supplier.supplier_bank_details && (
            <section>
              <h3 className="text-xs font-semibold uppercase tracking-widest text-slate-400 mb-2">Bank details</h3>
              <p className="text-xs text-slate-300 whitespace-pre-line bg-slate-900/60 border border-slate-800 rounded-xl px-3 py-2.5">{supplier.supplier_bank_details}</p>
            </section>
          )}
        </div>
    </div>
  );
}

function Kpi({ label, value, sub, cls }: { label: string; value: string; sub: string; cls: string }) {
  return (
    <div className="bg-slate-900/60 border border-slate-800 rounded-xl px-3 py-2.5">
      <p className="text-[9px] font-semibold uppercase tracking-widest text-slate-600">{label}</p>
      <p className={`text-sm font-bold tabular-nums mt-0.5 ${cls}`}>{value}</p>
      <p className="text-[9px] text-slate-600">{sub}</p>
    </div>
  );
}
