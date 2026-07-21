/**
 * ICAPROC — Sell-side: Sales Quotes list. Each quote has its own page at
 * /sales/[id]. Owner + sales.
 */
'use client';
import { useState, useEffect, useMemo, useCallback, Fragment } from 'react';
import { createSupabaseClient } from '@/lib/supabase';
import { useAuth } from '@/hooks/useAuth';
import { useRouter } from 'next/navigation';
import { ROLE_PERMISSIONS } from '@/constants/roles';
import BrandMenu from '@/components/ui/BrandMenu';
import SalesMigrationBanner from '@/components/ui/SalesMigrationBanner';
import { SALES_STATUS as STATUS, milestoneIndex } from '@/lib/salesStatus';

interface Quote {
  quote_id: string; quote_number: string; order_number?: string; invoice_number?: string; do_number?: string;
  customer_id: string | null; status: string; grand_total: number; updated_at?: string; revision?: number;
}
interface Customer { customer_id: string; display_name: string; legal_name: string; }
interface PreviewLine { quote_id: string; description: string; quantity: number; unit_price: number; is_section: boolean; sort_order: number; }

const fmtInt = (n: number) => Math.round(n).toLocaleString('en-US');
const fmtDate = (d?: string | null) => d ? new Date(d.length <= 10 ? `${d}T00:00:00` : d).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: '2-digit' }) : '';

export default function SalesListPage() {
  const supabase = createSupabaseClient();
  const router = useRouter();
  const { user, profile, loading: authLoading } = useAuth();
  const canEdit = !!profile && ROLE_PERMISSIONS[profile.role].canEditSalesDocs;

  const [quotes, setQuotes] = useState<Quote[]>([]);
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');

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
      supabase.from('22.0_sales_quotes').select('quote_id, quote_number, order_number, invoice_number, do_number, customer_id, status, grand_total, updated_at, revision').order('updated_at', { ascending: false }),
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

  const filtered = quotes.filter((q) => {
    const s = search.trim().toLowerCase();
    if (!s) return true;
    const c = q.customer_id ? custById.get(q.customer_id) : undefined;
    return [q.quote_number, q.order_number, q.invoice_number, q.do_number, c?.display_name, c?.legal_name, STATUS[q.status]?.label]
      .filter(Boolean).join(' ').toLowerCase().includes(s);
  });

  return (
    <div className="min-h-screen bg-[#0f1012] text-slate-200 font-sans text-sm">
      <div className="border-b border-slate-800/60 bg-[#0f1012]/80 backdrop-blur-md sticky top-0 z-30">
        <div className="max-w-[1200px] mx-auto px-4 md:px-8 py-4 flex items-center justify-between gap-4">
          <BrandMenu wordmarkClass="text-xl md:text-2xl font-extrabold" subtitle="Sales · Quotes & orders" />
          <button onClick={() => router.push('/sales/new')} className="px-4 py-2 rounded-xl bg-emerald-500/15 text-emerald-300 ring-1 ring-emerald-500/30 hover:bg-emerald-500/25 text-sm font-semibold transition-colors">+ New Quote</button>
        </div>
      </div>
      <main className="max-w-[1200px] mx-auto px-4 md:px-8 py-6 space-y-5">
        <SalesMigrationBanner />
        <div className="relative">
          <svg className="w-4 h-4 text-slate-500 absolute left-3.5 top-1/2 -translate-y-1/2" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M21 21l-4.35-4.35M17 11a6 6 0 11-12 0 6 6 0 0112 0z" /></svg>
          <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search by number, customer, status…"
            className="w-full pl-10 pr-4 h-11 rounded-xl bg-slate-900/80 border border-slate-700/80 focus:border-emerald-500/60 outline-none text-white text-base sm:text-sm placeholder:text-slate-500 transition-colors" />
        </div>

        <div className="bg-slate-900/40 border border-slate-800/80 rounded-2xl overflow-hidden">
          <div className="hidden md:grid grid-cols-[150px_1fr_130px_140px_110px] gap-3 px-4 py-2.5 border-b border-slate-800 text-[10px] font-semibold uppercase tracking-widest text-slate-500">
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
                const billed = ['ordered', 'invoiced', 'delivered'].includes(q.status);
                const pct = total > 0 ? Math.min(100, (rcv / total) * 100) : 0;
                const lines = linesByQuote[q.quote_id] ?? [];
                const items = lines.filter((l) => !l.is_section);
                const subtotal = items.reduce((s, l) => s + (Number(l.quantity) || 0) * (Number(l.unit_price) || 0), 0);
                const open = expanded === q.quote_id;
                return (
                  <Fragment key={q.quote_id}>
                    <div className={`flex items-stretch transition-colors ${open ? 'bg-slate-800/30' : 'hover:bg-slate-800/40'}`}>
                      <button onClick={() => router.push(`/sales/${q.quote_id}`)} className="flex-1 min-w-0 text-left grid grid-cols-1 md:grid-cols-[150px_1fr_130px_140px_110px] gap-1 md:gap-3 px-4 py-3 items-center">
                        <span className="font-mono text-[11px] text-slate-300">
                          {q.quote_number}
                          {(q.revision ?? 0) > 0 && <span className="ml-1 text-[9px] font-bold text-sky-400">R{q.revision}</span>}
                        </span>
                        <span className="text-sm text-slate-100 truncate">{c?.display_name || c?.legal_name || <span className="text-slate-600">No customer</span>}</span>
                        <span className="flex flex-col gap-1">
                          <span className="flex items-center gap-1.5 flex-wrap">
                            <span className={`inline-block px-2 py-0.5 rounded text-[11px] font-semibold ${STATUS[q.status]?.cls ?? ''}`}>{STATUS[q.status]?.label ?? q.status}</span>
                            {billed && pct >= 100 && <span className="inline-block px-1.5 py-0.5 rounded text-[10px] font-bold bg-emerald-500/20 text-emerald-300">PAID</span>}
                          </span>
                          <MilestoneDots status={q.status} paid={billed && pct >= 100} delivered={q.status === 'delivered'} />
                        </span>
                        <span className="text-right">
                          <span className="block tabular-nums text-slate-200">{fmtInt(total)}</span>
                          {billed && total > 0 && (
                            <span className="mt-1 ml-auto flex items-center gap-1.5 justify-end">
                              <span className="w-12 h-1 bg-slate-700 rounded-full overflow-hidden inline-block">
                                <span className={`block h-full rounded-full ${pct >= 100 ? 'bg-emerald-500' : pct > 0 ? 'bg-amber-400' : 'bg-slate-600'}`} style={{ width: `${pct}%` }} />
                              </span>
                              <span className={`text-[10px] tabular-nums ${pct >= 100 ? 'text-emerald-400' : pct > 0 ? 'text-amber-300' : 'text-slate-600'}`}>{pct.toFixed(0)}%</span>
                            </span>
                          )}
                        </span>
                        <span className="text-right text-[11px] text-slate-500 tabular-nums">{fmtDate(q.updated_at)}</span>
                      </button>
                      <button onClick={() => setExpanded(open ? null : q.quote_id)} title="Preview items"
                        className="px-3 flex items-center text-slate-600 hover:text-white transition-colors flex-shrink-0">
                        <svg className={`w-4 h-4 transition-transform ${open ? 'rotate-90' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M9 5l7 7-7 7" /></svg>
                      </button>
                    </div>
                    {open && (
                      <div className="px-4 pb-3 pt-1 bg-slate-950/40">
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
  return <div className="min-h-screen bg-[#0f1012] flex items-center justify-center"><div className="w-6 h-6 border-2 border-emerald-500/30 border-t-emerald-500 rounded-full animate-spin" /></div>;
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
