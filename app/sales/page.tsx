/**
 * ICAPROC — Sell-side: Sales Quotes list. Each quote has its own page at
 * /sales/[id]. Owner + sales.
 */
'use client';
import { useState, useEffect, useMemo, useCallback, useRef, Fragment } from 'react';
import { createSupabaseClient } from '@/lib/supabase';
import { useAuth } from '@/hooks/useAuth';
import { useRouter } from 'next/navigation';
import { ROLE_PERMISSIONS } from '@/constants/roles';
import BrandMenu from '@/components/ui/BrandMenu';
import SalesMigrationBanner from '@/components/ui/SalesMigrationBanner';
import { SALES_STATUS as STATUS, milestoneIndex } from '@/lib/salesStatus';
import { fmtDay, fmtInt, fmtRupiah } from '@/lib/formatters';
import DateRangeFilter from '@/components/ui/DateRangeFilter';
import LayoutToggle from '@/components/ui/LayoutToggle';
import { useListLayout } from '@/hooks/useListLayout';
import { useListDefaults } from '@/hooks/useListDefaults';
import { listSpec } from '@/constants/listDefaults';
import { inRange, todayISO, type DateRange } from '@/lib/dateRange';

interface Quote {
  quote_id: string; quote_number: string; order_number?: string; invoice_number?: string; do_number?: string;
  customer_id: string | null; status: string; grand_total: number; updated_at?: string; revision?: number;
  quote_date?: string | null; valid_until?: string | null;
}
interface Customer { customer_id: string; display_name: string; legal_name: string; }
interface PreviewLine { quote_id: string; description: string; quantity: number; unit_price: number; is_section: boolean; sort_order: number; }


export default function SalesListPage() {
  const supabase = createSupabaseClient();
  const router = useRouter();
  const { user, profile, loading: authLoading } = useAuth();
  const canEdit = !!profile && ROLE_PERMISSIONS[profile.role].canEditSalesDocs;

  const [quotes, setQuotes] = useState<Quote[]>([]);
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  // How the list opens comes from Settings › Lists; both stay changeable here.
  const defaults = useListDefaults('sales');
  const [range, setRange] = useState<DateRange>(defaults.range);
  const [sort, setSort] = useState(defaults.sort);
  // The saved default lands once the settings have loaded, unless the person
  // has already touched the controls.
  const touched = useRef(false);
  useEffect(() => {
    if (touched.current) return;
    setRange(defaults.range);
    setSort(defaults.sort);
  }, [defaults.range.from, defaults.range.to, defaults.sort]);   // eslint-disable-line react-hooks/exhaustive-deps
  const [layout, setLayout] = useListLayout('sales');
  const compact = layout === 'compact';

  useEffect(() => { document.title = 'Sales — ICAPROC'; }, []);
  useEffect(() => {
    if (authLoading) return;
    if (!user) { router.replace(`/login?next=${encodeURIComponent('/sales')}`); return; }
    if (profile && !ROLE_PERMISSIONS[profile.role].canEditSalesDocs) router.replace('/unauthorized');
  }, [authLoading, user, profile, router]);

  const [receivedByQuote, setReceivedByQuote] = useState<Record<string, number>>({});
  const [linesByQuote, setLinesByQuote] = useState<Record<string, PreviewLine[]>>({});
  const [expanded, setExpanded] = useState<string | null>(null);

  const fetchAll = useCallback(async () => {
    setLoading(true);
    const [qRes, custRes, rRes, iRes] = await Promise.all([
      supabase.from('22.0_sales_quotes').select('quote_id, quote_number, order_number, invoice_number, do_number, customer_id, status, grand_total, updated_at, revision, quote_date, valid_until').order('updated_at', { ascending: false }),
      supabase.from('20.0_customers').select('customer_id, display_name, legal_name'),
      supabase.from('26.0_customer_receipts').select('quote_id, amount'),
      supabase.from('22.1_sales_quote_items').select('quote_id, description, quantity, unit_price, is_section, sort_order').order('sort_order'),
    ]);
    setQuotes((qRes.data as Quote[]) ?? []);
    setCustomers((custRes.data as Customer[]) ?? []);
    const rcv: Record<string, number> = {};
    for (const r of ((rRes.data as { quote_id: string; amount: number }[]) ?? [])) rcv[r.quote_id] = (rcv[r.quote_id] ?? 0) + (Number(r.amount) || 0);
    setReceivedByQuote(rcv);
    const grouped: Record<string, PreviewLine[]> = {};
    for (const l of ((iRes.data as PreviewLine[]) ?? [])) (grouped[l.quote_id] ??= []).push(l);
    setLinesByQuote(grouped);
    setLoading(false);
  }, []);
  useEffect(() => { if (canEdit) fetchAll(); }, [canEdit, fetchAll]);

  const custById = useMemo(() => new Map(customers.map((c) => [c.customer_id, c])), [customers]);

  if (authLoading || !profile) return <CenterSpinner />;
  if (!canEdit) return <CenterSpinner />;

  const nameOf = (q: Quote) => {
    const c = q.customer_id ? custById.get(q.customer_id) : undefined;
    return (c?.display_name || c?.legal_name || '').toLowerCase();
  };
  // An offer past its own valid_until while still on the table (validated/sent).
  const today = todayISO();
  const isExpired = (q: Quote) => !!q.valid_until && ['validated', 'sent'].includes(q.status) && q.valid_until < today;
  const hasArOpen = (q: Quote) => {
    const t = Number(q.grand_total) || 0;
    return q.status === 'delivered' && t > 0 && (receivedByQuote[q.quote_id] ?? 0) < t - 0.5;
  };
  const filtered = quotes.filter((q) => {
    if (!inRange(q.quote_date ?? q.updated_at ?? null, range)) return false;
    const s = search.trim().toLowerCase();
    if (!s) return true;
    const c = q.customer_id ? custById.get(q.customer_id) : undefined;
    return [q.quote_number, q.order_number, q.invoice_number, q.do_number, c?.display_name, c?.legal_name, STATUS[q.status]?.label, isExpired(q) ? 'expired' : '', hasArOpen(q) ? 'outstanding belum lunas' : '']
      .filter(Boolean).join(' ').toLowerCase().includes(s);
  }).sort((a, b) => {
    if (sort === 'value')    return (Number(b.grand_total) || 0) - (Number(a.grand_total) || 0);
    if (sort === 'customer') return nameOf(a).localeCompare(nameOf(b));
    if (sort === 'updated')  return (b.updated_at || '').localeCompare(a.updated_at || '');
    // 'created' — the document's own date, then its update stamp to break ties
    return (b.quote_date || '').localeCompare(a.quote_date || '')
        || (b.updated_at || '').localeCompare(a.updated_at || '');
  });

  // What the filtered set is worth — the reason to filter by week/month/year
  const committed = filtered.filter((q) => ['ordered', 'invoiced', 'preparing', 'delivered'].includes(q.status));
  const periodValue = committed.reduce((sum, q) => sum + (Number(q.grand_total) || 0), 0);
  const periodReceived = filtered.reduce((sum, q) => sum + (receivedByQuote[q.quote_id] ?? 0), 0);

  return (
    <div className="min-h-screen bg-chrome text-slate-200 font-sans text-sm">
      <div className="border-b border-slate-800/60 bg-chrome/80 backdrop-blur-md sticky top-0 z-30">
        {/* Phones: wordmark row then actions row — side-by-side squeezes the
            buttons into the wordmark. sm+ keeps the single row. */}
        <div className="max-w-[1200px] 2xl:max-w-[1760px] mx-auto px-3 sm:px-4 md:px-6 py-3 sm:py-4 flex flex-col sm:flex-row sm:items-center justify-between sm:flex-wrap gap-2.5 sm:gap-4">
          <BrandMenu wordmarkClass="text-xl md:text-2xl font-extrabold" subtitle="Sales · Quotes & orders" />
          <div className="flex items-center gap-2 flex-wrap">
            {profile?.role === 'owner' && (
              <button onClick={() => router.push('/sales/library')}
                title="Owner-only: curated custom line texts that feed the item picker"
                className="text-xs text-slate-400 hover:text-white px-3 py-1.5 border border-slate-700 rounded-lg hover:bg-slate-800 transition-colors whitespace-nowrap">
                Library
              </button>
            )}
            <button onClick={() => router.push('/sales/new')} className="text-xs font-semibold px-3 py-1.5 rounded-lg bg-emerald-500/15 text-emerald-300 ring-1 ring-emerald-500/30 hover:bg-emerald-500/25 transition-colors whitespace-nowrap">+ New Quote</button>
          </div>
        </div>
      </div>
      <main className="max-w-[1200px] 2xl:max-w-[1760px] mx-auto px-3 sm:px-4 md:px-6 py-6 space-y-5">
        <SalesMigrationBanner />
        <div className="relative">
          <svg className="w-4 h-4 text-slate-500 absolute left-3.5 top-1/2 -translate-y-1/2" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M21 21l-4.35-4.35M17 11a6 6 0 11-12 0 6 6 0 0112 0z" /></svg>
          <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search by number, customer, status…"
            className="w-full pl-10 pr-4 h-11 rounded-xl bg-slate-900/80 border border-slate-700/80 focus:border-emerald-500/60 outline-none text-white text-base sm:text-sm placeholder:text-[13px] sm:placeholder:text-sm placeholder:text-slate-500 transition-colors" />
        </div>

        {/* Period filter + what the period is worth */}
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2 justify-between">
          <div className="flex items-center gap-2 flex-wrap">
            <DateRangeFilter value={range} onChange={(r) => { touched.current = true; setRange(r); }} label="Quote date" align="left" />
            <select value={sort} onChange={(e) => { touched.current = true; setSort(e.target.value); }}
              title="Order — the default lives in Settings › Lists"
              className="text-xs bg-slate-900/80 border border-slate-700 text-slate-300 rounded-lg px-2 py-1.5 focus:outline-none focus:border-emerald-500/60">
              {listSpec('sales').sorts.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select>
            <LayoutToggle value={layout} onChange={setLayout} />
          </div>
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px] text-slate-500">
            <span><span className="text-slate-300 font-semibold tabular-nums">{filtered.length}</span> quote{filtered.length !== 1 ? 's' : ''}</span>
            <span>Ordered+ <span className="text-emerald-300 font-semibold tabular-nums">{fmtRupiah(periodValue)}</span></span>
            <span>Received <span className="text-slate-300 font-semibold tabular-nums">{fmtRupiah(periodReceived)}</span></span>
          </div>
        </div>

        <div className="bg-slate-900/40 border border-slate-800/80 rounded-2xl overflow-hidden">
          <div className={`hidden md:grid grid-cols-[150px_1fr_130px_140px_110px] gap-3 border-b border-slate-800 text-[10px] font-semibold uppercase tracking-widest text-slate-500 ${compact ? 'px-3 py-1.5' : 'px-4 py-2.5'}`}>
            <span>Number</span><span>Customer</span><span>Status</span><span className="text-right">Grand Total</span><span className="text-right">Updated</span>
          </div>
          {loading ? (
            <div className="p-4 space-y-1.5">{[...Array(6)].map((_, i) => <div key={i} className="h-12 bg-slate-800/40 rounded-xl animate-pulse" />)}</div>
          ) : filtered.length === 0 ? (
            <div className="px-4 py-12 text-center text-slate-600 text-sm">{quotes.length === 0 ? 'No sales quotes yet — create your first one.' : 'No matches.'}</div>
          ) : (
            <div className="divide-y divide-slate-800/60">
              {filtered.map((q) => {
                const c = q.customer_id ? custById.get(q.customer_id) : undefined;
                const total = Number(q.grand_total) || 0;
                const rcv = receivedByQuote[q.quote_id] ?? 0;
                const billed = ['ordered', 'invoiced', 'preparing', 'delivered'].includes(q.status);
                const pct = total > 0 ? Math.min(100, (rcv / total) * 100) : 0;
                // Tolerance, not equality — a rounding hair under 100% must
                // still read as paid (the 0.5-rupiah rule used everywhere).
                const paidFull = billed && total > 0 && rcv >= total - 0.5;
                // Goods gone, money not collected — the state worth shouting.
                const arOpen = q.status === 'delivered' && billed && !paidFull;
                const lines = linesByQuote[q.quote_id] ?? [];
                const items = lines.filter((l) => !l.is_section);
                const subtotal = items.reduce((s, l) => s + (Number(l.quantity) || 0) * (Number(l.unit_price) || 0), 0);
                const open = expanded === q.quote_id;
                return (
                  <Fragment key={q.quote_id}>
                    {/* Bar click = inline preview; the document opens from the
                        preview's "Open document" (or the doc number link). */}
                    <button onClick={() => setExpanded(open ? null : q.quote_id)} aria-expanded={open}
                      className={`w-full min-w-0 text-left grid grid-cols-1 md:grid-cols-[150px_1fr_130px_140px_110px] gap-1 md:gap-3 items-center transition-colors ${compact ? 'px-3 py-1.5' : 'px-4 py-3'} ${open ? 'bg-slate-800/30' : 'hover:bg-slate-800/40'}`}>
                      <span className="font-mono text-[11px] text-slate-300">
                        {q.quote_number}
                        {(q.revision ?? 0) > 0 && <span className="ml-1 text-[9px] font-bold text-sky-400">R{q.revision}</span>}
                      </span>
                      <span className="text-sm text-slate-100 truncate">{c?.display_name || c?.legal_name || <span className="text-slate-600">No customer</span>}</span>
                      <span className="flex flex-col gap-1">
                        <span className="flex items-center gap-1.5 flex-wrap">
                          <span className={`inline-block px-2 py-0.5 rounded text-[11px] font-semibold ${STATUS[q.status]?.cls ?? ''}`}>{STATUS[q.status]?.label ?? q.status}</span>
                          {isExpired(q) && <span className="inline-block px-1.5 py-0.5 rounded text-[10px] font-bold bg-amber-500/15 text-amber-300" title={`Offer expired ${fmtDay(q.valid_until!)}`}>EXPIRED</span>}
                          {paidFull && <span className="inline-block px-1.5 py-0.5 rounded text-[10px] font-bold bg-emerald-500/20 text-emerald-300">PAID</span>}
                          {arOpen && (
                            <span className={`inline-block px-1.5 py-0.5 rounded text-[10px] font-bold ${rcv > 0 ? 'bg-amber-500/15 text-amber-300' : 'bg-red-500/10 text-red-300'}`}
                              title={`Delivered, but Rp ${fmtInt(total - rcv)} has not been received`}>
                              OUTSTANDING
                            </span>
                          )}
                        </span>
                        {!compact && <MilestoneDots status={q.status} paid={paidFull} delivered={q.status === 'delivered'} />}
                      </span>
                      <span className={compact ? 'text-right whitespace-nowrap' : 'text-right'}>
                        <span className={compact ? 'tabular-nums text-slate-200' : 'block tabular-nums text-slate-200'}>{fmtInt(total)}</span>
                        {billed && total > 0 && (compact ? (
                          <span className={`ml-1.5 text-[10px] tabular-nums ${paidFull ? 'text-emerald-400' : pct > 0 ? 'text-amber-300' : 'text-slate-600'}`}>{pct.toFixed(0)}%</span>
                        ) : (
                          <span className="mt-1 ml-auto flex items-center gap-1.5 justify-end">
                            <span className="w-12 h-1 bg-slate-700 rounded-full overflow-hidden inline-block">
                              <span className={`block h-full rounded-full ${paidFull ? 'bg-emerald-500' : pct > 0 ? 'bg-amber-400' : 'bg-slate-600'}`} style={{ width: `${pct}%` }} />
                            </span>
                            <span className={`text-[10px] tabular-nums ${paidFull ? 'text-emerald-400' : pct > 0 ? 'text-amber-300' : 'text-slate-600'}`}>{pct.toFixed(0)}%</span>
                          </span>
                        ))}
                      </span>
                      <span className="text-right text-[11px] text-slate-500 tabular-nums flex items-center justify-end gap-2">
                        {fmtDay(q.updated_at)}
                        <svg className={`w-3.5 h-3.5 text-slate-600 transition-transform duration-150 ${open ? 'rotate-180 text-slate-400' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2"><path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" /></svg>
                      </span>
                    </button>
                    {open && (
                      <div className="px-4 pb-3 pt-1 bg-slate-950/40">
                        <div className="flex items-center gap-3 py-1.5">
                          <button onClick={() => router.push(`/sales/${q.quote_id}`)}
                            className="text-[10px] font-semibold px-2 py-0.5 rounded-md bg-emerald-500/15 text-emerald-300 ring-1 ring-emerald-500/30 hover:bg-emerald-500/25 transition-colors whitespace-nowrap flex-shrink-0">
                            Open document →
                          </button>
                          <p className="text-[10px] text-slate-600 font-mono truncate">
                            {[q.order_number && `SO ${q.order_number}`, q.invoice_number && `INV ${q.invoice_number}`, q.do_number && `DO ${q.do_number}`].filter(Boolean).join(' · ')}
                          </p>
                        </div>
                        {items.length === 0 ? (
                          <p className="text-[11px] text-slate-600 italic py-1.5">No items on this quote.</p>
                        ) : (
                          <div className="rounded-lg border border-slate-800 bg-slate-950/50 divide-y divide-slate-800/60">
                            {lines.map((l, li) => l.is_section ? (
                              <div key={li} className="px-3 py-1 text-[10px] font-bold uppercase tracking-widest text-emerald-500/70 bg-slate-900/60">{l.description}</div>
                            ) : (
                              <div key={li} className="flex items-center gap-3 px-3 py-1.5 text-[11px]">
                                <span className="text-slate-500 tabular-nums flex-shrink-0 w-10 text-right">{Number(l.quantity).toLocaleString('en-US')}×</span>
                                <span className="text-slate-300 truncate flex-1">{l.description || '(no description)'}</span>
                                <span className="text-slate-500 tabular-nums flex-shrink-0">@ {fmtInt(Number(l.unit_price))}</span>
                                <span className="text-slate-300 tabular-nums flex-shrink-0 w-24 text-right">{fmtInt((Number(l.quantity) || 0) * (Number(l.unit_price) || 0))}</span>
                              </div>
                            ))}
                            <div className="flex items-center justify-between px-3 py-1.5 text-[11px] bg-slate-900/60">
                              <span className="text-slate-500 font-semibold">Grand Total (excl. PPN)</span>
                              <span className="text-emerald-300 font-bold tabular-nums">{fmtInt(subtotal)}</span>
                            </div>
                          </div>
                        )}
                      </div>
                    )}
                  </Fragment>
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
  return <div className="min-h-screen bg-chrome flex items-center justify-center"><div className="w-6 h-6 border-2 border-emerald-500/30 border-t-emerald-500 rounded-full animate-spin" /></div>;
}

/** Tiny funnel-progress dots: Quote → Validated → Sent → SO → INV → Paid → DO. */
function MilestoneDots({ status, paid, delivered }: { status: string; paid: boolean; delivered: boolean }) {
  if (['cancelled', 'rejected'].includes(status)) return null;
  const idx = milestoneIndex(status);
  const steps = [
    { l: 'Quote', on: true },
    { l: 'Validated', on: idx >= 1 },
    { l: 'Sent', on: idx >= 2 },
    { l: 'Sales Order', on: idx >= 4 },
    { l: 'Invoice', on: idx >= 5 },
    { l: 'Paid', on: paid },
    { l: 'Delivered', on: delivered },
  ];
  return (
    <span className="flex items-center gap-[3px]" title={steps.map((s) => `${s.on ? '✓' : '○'} ${s.l}`).join('\n')}>
      {steps.map((s) => (
        <span key={s.l} className={`w-1.5 h-1.5 rounded-full ${s.on ? 'bg-emerald-400' : 'bg-slate-700'}`} />
      ))}
    </span>
  );
}
