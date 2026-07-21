/**
 * ICAPROC — Sell-side: Delivery
 * The delivery-order pipeline: confirmed/invoiced orders waiting to ship
 * ("Ready to deliver") and the delivered history (DO numbers). Rows open the
 * sales document, where Mark Delivered issues the DO and writes stock-out.
 * Visible to owner / sales / warehouse (canManageStock).
 */
'use client';
import { useState, useEffect, useMemo, useCallback } from 'react';
import { createSupabaseClient } from '@/lib/supabase';
import { useAuth } from '@/hooks/useAuth';
import { useRouter } from 'next/navigation';
import { ROLE_PERMISSIONS } from '@/constants/roles';
import BrandMenu from '@/components/ui/BrandMenu';

interface Quote {
  quote_id: string; quote_number: string; order_number: string | null; invoice_number: string | null; do_number: string | null;
  customer_id: string | null; status: string; ordered_at: string | null; delivered_at: string | null;
  delivery_date: string | null; delivery_time: string | null; delivery_method: string | null; delivery_via: string | null; delivery_contact: string | null;
}
interface Customer { customer_id: string; display_name: string; legal_name: string; }
interface ItemAgg { count: number; qty: number; }

const fmtInt = (n: number) => Math.round(n).toLocaleString('en-US');
const fmtDate = (d?: string | null) => d ? new Date(d).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: '2-digit' }) : '';

export default function DeliveryPage() {
  const supabase = createSupabaseClient();
  const router = useRouter();
  const { user, profile, loading: authLoading } = useAuth();
  const canView = !!profile && (ROLE_PERMISSIONS[profile.role].canEditSalesDocs || ROLE_PERMISSIONS[profile.role].canManageStock);

  const [quotes, setQuotes] = useState<Quote[]>([]);
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [itemsByQuote, setItemsByQuote] = useState<Record<string, ItemAgg>>({});
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');

  useEffect(() => { document.title = 'Delivery — ICAPROC'; }, []);
  useEffect(() => {
    if (authLoading) return;
    if (!user) { router.replace(`/login?next=${encodeURIComponent('/delivery')}`); return; }
    if (profile && !(ROLE_PERMISSIONS[profile.role].canEditSalesDocs || ROLE_PERMISSIONS[profile.role].canManageStock)) router.replace('/unauthorized');
  }, [authLoading, user, profile, router]);

  const fetchAll = useCallback(async () => {
    setLoading(true);
    const [qRes, custRes, iRes] = await Promise.all([
      supabase.from('22.0_sales_quotes')
        .select('quote_id, quote_number, order_number, invoice_number, do_number, customer_id, status, ordered_at, delivered_at, delivery_date, delivery_time, delivery_method, delivery_via, delivery_contact')
        .in('status', ['ordered', 'invoiced', 'preparing', 'delivered'])
        .order('updated_at', { ascending: false }),
      supabase.from('20.0_customers').select('customer_id, display_name, legal_name'),
      supabase.from('22.1_sales_quote_items').select('quote_id, quantity, is_section'),
    ]);
    setQuotes((qRes.data as Quote[]) ?? []);
    setCustomers((custRes.data as Customer[]) ?? []);
    const agg: Record<string, ItemAgg> = {};
    for (const it of ((iRes.data as { quote_id: string; quantity: number; is_section: boolean }[]) ?? [])) {
      if (it.is_section) continue;
      const a = (agg[it.quote_id] ??= { count: 0, qty: 0 });
      a.count += 1;
      a.qty += Number(it.quantity) || 0;
    }
    setItemsByQuote(agg);
    setLoading(false);
  }, []);
  useEffect(() => { if (canView) fetchAll(); }, [canView, fetchAll]);

  const custById = useMemo(() => new Map(customers.map((c) => [c.customer_id, c])), [customers]);
  const custName = (id: string | null) => {
    const c = id ? custById.get(id) : undefined;
    return c?.display_name || c?.legal_name || '';
  };

  const matches = useCallback((q: Quote) => {
    const s = search.trim().toLowerCase();
    if (!s) return true;
    return [q.do_number, q.order_number, q.invoice_number, q.quote_number, custName(q.customer_id)]
      .filter(Boolean).join(' ').toLowerCase().includes(s);
  }, [search, custById]); // eslint-disable-line react-hooks/exhaustive-deps

  const pending = useMemo(() => quotes.filter((q) => q.status !== 'delivered' && matches(q)), [quotes, matches]);
  const delivered = useMemo(() => quotes.filter((q) => q.status === 'delivered' && matches(q))
    .sort((a, b) => (b.delivered_at || '').localeCompare(a.delivered_at || '')), [quotes, matches]);

  if (authLoading || !profile) return <CenterSpinner />;
  if (!canView) return <CenterSpinner />;

  return (
    <div className="min-h-screen bg-[#0f1012] text-slate-200 font-sans text-sm">
      <div className="border-b border-slate-800/60 bg-[#0f1012]/80 backdrop-blur-md sticky top-0 z-30">
        <div className="max-w-[1200px] mx-auto px-4 md:px-8 py-4 flex items-center justify-between gap-4">
          <BrandMenu wordmarkClass="text-xl md:text-2xl font-extrabold" subtitle="Delivery · Orders out the door" />
          <span className="text-[11px] text-slate-500 whitespace-nowrap">
            <span className="text-amber-300 font-bold tabular-nums">{loading ? '—' : pending.length}</span> to deliver
          </span>
        </div>
      </div>

      <main className="max-w-[1200px] mx-auto px-4 md:px-8 py-6 space-y-6">
        <div className="relative">
          <svg className="w-4 h-4 text-slate-500 absolute left-3.5 top-1/2 -translate-y-1/2" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M21 21l-4.35-4.35M17 11a6 6 0 11-12 0 6 6 0 0112 0z" /></svg>
          <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search DO / SO / invoice number, customer…"
            className="w-full pl-10 pr-4 h-11 rounded-xl bg-slate-900/80 border border-slate-700/80 focus:border-emerald-500/60 outline-none text-white text-base sm:text-sm placeholder:text-slate-500 transition-colors" />
        </div>

        {/* Ready to deliver */}
        <section>
          <h2 className="text-xs font-semibold uppercase tracking-widest text-amber-300/80 mb-2">Ready to deliver</h2>
          <div className="bg-slate-900/40 border border-slate-800/80 rounded-2xl overflow-hidden">
            {loading ? (
              <div className="p-4 space-y-1.5">{[...Array(3)].map((_, i) => <div key={i} className="h-12 bg-slate-800/40 rounded-xl animate-pulse" />)}</div>
            ) : pending.length === 0 ? (
              <div className="px-4 py-8 text-center text-slate-600 text-sm">Nothing waiting — confirmed orders appear here until they're delivered.</div>
            ) : (
              <div className="divide-y divide-slate-800/60">
                {pending.map((q) => {
                  const agg = itemsByQuote[q.quote_id];
                  return (
                    <button key={q.quote_id} onClick={() => router.push(`/sales/${q.quote_id}`)}
                      className="w-full text-left grid grid-cols-2 md:grid-cols-[170px_1fr_140px_120px_110px] gap-1 md:gap-3 px-4 py-3 hover:bg-slate-800/40 transition-colors items-center">
                      <span>
                        <span className={`block font-mono text-[11px] ${q.status === 'preparing' ? 'text-orange-300' : 'text-violet-300'}`}>{(q.status === 'preparing' && q.do_number) || q.order_number || q.quote_number}</span>
                        {q.invoice_number && <span className="block text-[10px] text-amber-200/70 font-mono">{q.invoice_number}</span>}
                      </span>
                      <span className="min-w-0">
                        <span className="block text-sm text-slate-100 truncate">{custName(q.customer_id) || <span className="text-slate-600">No customer</span>}</span>
                        {q.status === 'preparing' && (
                          <span className="block text-[10px] text-orange-300/80 truncate">
                            {[q.delivery_method === 'pickup' ? 'Pick-up' : `Delivery${q.delivery_via ? ` · ${q.delivery_via}` : ''}`, q.delivery_contact].filter(Boolean).join(' · ')}
                          </span>
                        )}
                      </span>
                      <span className="text-[11px] text-slate-500 tabular-nums">
                        {agg ? `${agg.count} line${agg.count !== 1 ? 's' : ''} · ${fmtInt(agg.qty)} pcs` : '—'}
                      </span>
                      <span>
                        <span className={`inline-block px-2 py-0.5 rounded text-[11px] font-semibold ${q.status === 'preparing' ? 'bg-orange-500/15 text-orange-300' : q.status === 'invoiced' ? 'bg-amber-500/15 text-amber-300' : 'bg-violet-500/15 text-violet-300'}`}>
                          {q.status === 'preparing' ? 'Preparing Items' : q.status === 'invoiced' ? 'Invoiced' : 'Confirmed Order'}
                        </span>
                      </span>
                      <span className="md:text-right text-[11px] text-slate-500 tabular-nums">
                        {q.status === 'preparing' && q.delivery_date
                          ? <>target {fmtDate(q.delivery_date)}{q.delivery_time ? <span className="block text-[10px] text-slate-600">{q.delivery_time}</span> : null}</>
                          : <>ordered {fmtDate(q.ordered_at)}</>}
                      </span>
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        </section>

        {/* Delivered history */}
        <section>
          <h2 className="text-xs font-semibold uppercase tracking-widest text-emerald-400/80 mb-2">Delivered</h2>
          <div className="bg-slate-900/40 border border-slate-800/80 rounded-2xl overflow-hidden">
            {loading ? (
              <div className="p-4 space-y-1.5">{[...Array(3)].map((_, i) => <div key={i} className="h-12 bg-slate-800/40 rounded-xl animate-pulse" />)}</div>
            ) : delivered.length === 0 ? (
              <div className="px-4 py-8 text-center text-slate-600 text-sm">No deliveries yet.</div>
            ) : (
              <div className="divide-y divide-slate-800/60">
                {delivered.map((q) => {
                  const agg = itemsByQuote[q.quote_id];
                  return (
                    <button key={q.quote_id} onClick={() => router.push(`/sales/${q.quote_id}`)}
                      className="w-full text-left grid grid-cols-2 md:grid-cols-[170px_1fr_140px_120px_110px] gap-1 md:gap-3 px-4 py-3 hover:bg-slate-800/40 transition-colors items-center">
                      <span>
                        <span className="block font-mono text-[11px] text-emerald-300">{q.do_number || '—'}</span>
                        <span className="block text-[10px] text-slate-600 font-mono">{q.order_number || q.quote_number}</span>
                      </span>
                      <span className="text-sm text-slate-100 truncate">{custName(q.customer_id) || <span className="text-slate-600">No customer</span>}</span>
                      <span className="text-[11px] text-slate-500 tabular-nums">
                        {agg ? `${agg.count} line${agg.count !== 1 ? 's' : ''} · ${fmtInt(agg.qty)} pcs` : '—'}
                      </span>
                      <span><span className="inline-block px-2 py-0.5 rounded text-[11px] font-semibold bg-emerald-500/15 text-emerald-300">Delivered</span></span>
                      <span className="md:text-right text-[11px] text-slate-500 tabular-nums">{fmtDate(q.delivered_at)}</span>
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        </section>
      </main>
    </div>
  );
}

function CenterSpinner() {
  return <div className="min-h-screen bg-[#0f1012] flex items-center justify-center"><div className="w-6 h-6 border-2 border-emerald-500/30 border-t-emerald-500 rounded-full animate-spin" /></div>;
}
