/**
 * ICAPROC — Sell-side: Delivery
 * The delivery-order pipeline: confirmed/invoiced orders waiting to ship
 * ("Ready to deliver") and the delivered history (DO numbers). Rows open the
 * sales document, where Mark Delivered issues the DO and writes stock-out.
 * Visible to owner / sales / warehouse (canManageStock).
 */
'use client';
import { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { createSupabaseClient } from '@/lib/supabase';
import { useAuth } from '@/hooks/useAuth';
import { useT } from '@/hooks/useT';
import { useRouter } from 'next/navigation';
import { ROLE_PERMISSIONS } from '@/constants/roles';
import { canOpenPath } from '@/constants/navigation';
import BrandMenu from '@/components/ui/BrandMenu';
import { displayDocNumber } from '@/lib/salesStatus';
import { fmtDay, fmtInt } from '@/lib/formatters';
import DateRangeFilter from '@/components/ui/DateRangeFilter';
import LayoutToggle from '@/components/ui/LayoutToggle';
import { useListLayout } from '@/hooks/useListLayout';
import { useListDefaults } from '@/hooks/useListDefaults';
import { inRange, type DateRange } from '@/lib/dateRange';

// One row per Delivery Order (24.0) once DOs exist, plus "awaiting DO" rows
// for confirmed/invoiced orders with nothing shipped yet.
interface Quote {
  row_key: string;
  quote_id: string; quote_number: string; order_number: string | null; invoice_number: string | null; do_number: string | null;
  customer_id: string | null; status: string; ordered_at: string | null; delivered_at: string | null;
  delivery_date: string | null; delivery_time: string | null; delivery_method: string | null; delivery_via: string | null; delivery_contact: string | null;
}
interface Customer { customer_id: string; display_name: string; legal_name: string; }
interface ItemAgg { count: number; qty: number; }


export default function DeliveryPage() {
  const supabase = createSupabaseClient();
  const router = useRouter();
  const { user, profile, loading: authLoading } = useAuth();
  const { t } = useT();
  const canView = !!profile && (ROLE_PERMISSIONS[profile.role].canEditSalesDocs || ROLE_PERMISSIONS[profile.role].canManageStock);

  const [quotes, setQuotes] = useState<Quote[]>([]);
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [itemsByQuote, setItemsByQuote] = useState<Record<string, ItemAgg>>({});
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  // Delivered rows filter on the delivery date; anything still pending filters
  // on its target date, so "this week" answers both halves of the page.
  const listDefaults = useListDefaults('delivery');
  const [range, setRange] = useState<DateRange>(listDefaults.range);
  const rangeTouched = useRef(false);
  useEffect(() => { if (!rangeTouched.current) setRange(listDefaults.range); },
    [listDefaults.range.from, listDefaults.range.to]);   // eslint-disable-line react-hooks/exhaustive-deps
  const [layout, setLayout] = useListLayout('delivery');
  const compact = layout === 'compact';

  useEffect(() => { document.title = 'Delivery — ICAPROC'; }, []);
  useEffect(() => {
    if (authLoading) return;
    if (!user) { router.replace(`/login?next=${encodeURIComponent('/delivery')}`); return; }
    if (profile && !canOpenPath(ROLE_PERMISSIONS[profile.role], '/delivery')) router.replace('/unauthorized');
  }, [authLoading, user, profile, router]);

  const fetchAll = useCallback(async () => {
    setLoading(true);
    const [qRes, custRes, iRes, dRes, diRes] = await Promise.all([
      supabase.from('22.0_sales_quotes')
        .select('quote_id, quote_number, order_number, invoice_number, do_number, customer_id, status, ordered_at, delivered_at, delivery_date, delivery_time, delivery_method, delivery_via, delivery_contact')
        .in('status', ['ordered', 'invoiced', 'preparing', 'delivered'])
        .order('updated_at', { ascending: false }),
      supabase.from('20.0_customers').select('customer_id, display_name, legal_name'),
      supabase.from('22.1_sales_quote_items').select('quote_id, quantity, is_section'),
      supabase.from('24.0_delivery_orders').select('*').order('created_at', { ascending: false }),
      supabase.from('24.1_delivery_order_items').select('do_id, qty'),
    ]);
    const orders = ((qRes.data as (Omit<Quote, 'row_key'>)[]) ?? []);
    const orderById = new Map(orders.map((o) => [o.quote_id, o]));
    type DoRow = { do_id: string; quote_id: string; do_number: string; status: string; delivered_at: string | null; delivery_date: string | null; delivery_time: string | null; delivery_method: string | null; delivery_via: string | null; delivery_contact: string | null };
    const doList = dRes.error ? [] : ((dRes.data as DoRow[]) ?? []);
    const rows: Quote[] = [];
    // Confirmed / invoiced orders with no DO yet — awaiting the warehouse
    for (const o of orders) if (['ordered', 'invoiced'].includes(o.status)) rows.push({ ...o, row_key: o.quote_id });
    // One row per Delivery Order — its own status, dates, and instructions
    for (const d of doList) {
      const o = orderById.get(d.quote_id);
      if (!o || d.status === 'cancelled') continue;
      rows.push({
        row_key: d.do_id, quote_id: o.quote_id, quote_number: o.quote_number,
        order_number: o.order_number, invoice_number: o.invoice_number, do_number: d.do_number,
        customer_id: o.customer_id, status: d.status === 'delivered' ? 'delivered' : 'preparing',
        ordered_at: o.ordered_at, delivered_at: d.delivered_at,
        delivery_date: d.delivery_date, delivery_time: d.delivery_time, delivery_method: d.delivery_method,
        delivery_via: d.delivery_via, delivery_contact: d.delivery_contact,
      });
    }
    setQuotes(rows);
    setCustomers((custRes.data as Customer[]) ?? []);
    const agg: Record<string, ItemAgg> = {};
    for (const it of ((iRes.data as { quote_id: string; quantity: number; is_section: boolean }[]) ?? [])) {
      if (it.is_section) continue;
      const a = (agg[it.quote_id] ??= { count: 0, qty: 0 });
      a.count += 1;
      a.qty += Number(it.quantity) || 0;
    }
    // Per-DO aggregates override the order-level ones for DO rows
    if (!diRes.error) {
      for (const it of ((diRes.data as { do_id: string; qty: number }[]) ?? [])) {
        const a = (agg[it.do_id] ??= { count: 0, qty: 0 });
        a.count += 1;
        a.qty += Number(it.qty) || 0;
      }
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
    const dateOf = q.status === 'delivered' ? (q.delivered_at ?? q.delivery_date) : (q.delivery_date ?? q.ordered_at);
    if (!inRange(dateOf ?? null, range)) return false;
    const s = search.trim().toLowerCase();
    if (!s) return true;
    return [q.do_number, displayDocNumber(q), q.order_number, q.invoice_number, q.quote_number, custName(q.customer_id)]
      .filter(Boolean).join(' ').toLowerCase().includes(s);
  }, [search, custById, range]); // eslint-disable-line react-hooks/exhaustive-deps

  const pending = useMemo(() => quotes.filter((q) => q.status !== 'delivered' && matches(q)), [quotes, matches]);
  const delivered = useMemo(() => quotes.filter((q) => q.status === 'delivered' && matches(q))
    .sort((a, b) => (b.delivered_at || '').localeCompare(a.delivered_at || '')), [quotes, matches]);

  if (authLoading || !profile) return <CenterSpinner />;
  if (!canView) return <CenterSpinner />;

  return (
    <div className="min-h-screen bg-chrome text-slate-200 font-sans text-sm">
      <div className="border-b border-slate-800/60 bg-chrome/80 backdrop-blur-md sticky top-0 z-30">
        <div className="max-w-[1200px] 2xl:max-w-[1760px] mx-auto px-3 sm:px-4 md:px-6 py-3 sm:py-4 flex flex-col sm:flex-row sm:items-center justify-between sm:flex-wrap gap-2.5 sm:gap-4">
          <BrandMenu wordmarkClass="text-xl md:text-2xl font-extrabold" subtitle={t("Delivery · Orders out the door")} />
          <span className="text-[11px] text-slate-500 whitespace-nowrap">
            <span className="text-amber-300 font-bold tabular-nums">{loading ? '—' : pending.length}</span> to deliver
          </span>
        </div>
      </div>

      <main className="max-w-[1200px] 2xl:max-w-[1760px] mx-auto px-3 sm:px-4 md:px-6 py-6 space-y-6">
        <div className="relative">
          <svg className="w-4 h-4 text-slate-500 absolute left-3.5 top-1/2 -translate-y-1/2" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M21 21l-4.35-4.35M17 11a6 6 0 11-12 0 6 6 0 0112 0z" /></svg>
          <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder={t('Search DO / SO / invoice number, customer…')}
            className="w-full pl-10 pr-4 h-11 rounded-xl bg-slate-900/80 border border-slate-700/80 focus:border-emerald-500/60 outline-none text-white text-base sm:text-sm placeholder:text-[13px] sm:placeholder:text-sm placeholder:text-slate-500 transition-colors" />
        </div>

        <div className="flex flex-wrap items-center gap-3 justify-between">
          <div className="flex items-center gap-2">
            <DateRangeFilter value={range} onChange={(r) => { rangeTouched.current = true; setRange(r); }} label="Delivery date" align="left" />
            <LayoutToggle value={layout} onChange={setLayout} />
          </div>
          <span className="text-[11px] text-slate-500 tabular-nums">
            {pending.length} pending · {delivered.length} delivered
          </span>
        </div>

        {/* Ready to deliver */}
        <section>
          <h2 className="text-xs font-semibold uppercase tracking-widest text-amber-300/80 mb-2">{t('Ready to deliver')}</h2>
          <div className="bg-slate-900/40 border border-slate-800/80 rounded-2xl overflow-hidden">
            {loading ? (
              <div className="p-4 space-y-1.5">{[...Array(3)].map((_, i) => <div key={i} className="h-12 bg-slate-800/40 rounded-xl animate-pulse" />)}</div>
            ) : pending.length === 0 ? (
              <div className="px-4 py-8 text-center text-slate-600 text-sm">Nothing waiting — confirmed orders appear here until they're delivered.</div>
            ) : (
              <div className="divide-y divide-slate-800/60">
                {pending.map((q) => {
                  const agg = itemsByQuote[q.row_key];
                  return (
                    <button key={q.row_key} onClick={() => router.push(`/sales/${q.quote_id}`)}
                      className={`w-full text-left grid grid-cols-2 md:grid-cols-[170px_1fr_140px_120px_110px] gap-1 md:gap-3 hover:bg-slate-800/40 transition-colors items-center ${compact ? 'px-3 py-1.5' : 'px-4 py-3'}`}>
                      <span>
                        <span className={`block font-mono text-[11px] ${q.status === 'preparing' ? 'text-orange-300' : 'text-violet-300'}`}>{(q.status === 'preparing' && q.do_number) || displayDocNumber(q)}</span>
                        {q.invoice_number && !compact && <span className="block text-[10px] text-amber-200/70 font-mono">{q.invoice_number}</span>}
                      </span>
                      <span className="min-w-0">
                        <span className="block text-sm text-slate-100 truncate">{custName(q.customer_id) || <span className="text-slate-600">{t('No customer')}</span>}</span>
                        {q.status === 'preparing' && !compact && (
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
                          ? <>target {fmtDay(q.delivery_date)}{q.delivery_time && !compact ? <span className="block text-[10px] text-slate-600">{q.delivery_time}</span> : null}</>
                          : <>ordered {fmtDay(q.ordered_at)}</>}
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
          <h2 className="text-xs font-semibold uppercase tracking-widest text-emerald-400/80 mb-2">{t('Delivered')}</h2>
          <div className="bg-slate-900/40 border border-slate-800/80 rounded-2xl overflow-hidden">
            {loading ? (
              <div className="p-4 space-y-1.5">{[...Array(3)].map((_, i) => <div key={i} className="h-12 bg-slate-800/40 rounded-xl animate-pulse" />)}</div>
            ) : delivered.length === 0 ? (
              <div className="px-4 py-8 text-center text-slate-600 text-sm">{t('No deliveries yet.')}</div>
            ) : (
              <div className="divide-y divide-slate-800/60">
                {delivered.map((q) => {
                  const agg = itemsByQuote[q.row_key];
                  return (
                    <button key={q.row_key} onClick={() => router.push(`/sales/${q.quote_id}`)}
                      className={`w-full text-left grid grid-cols-2 md:grid-cols-[170px_1fr_140px_120px_110px] gap-1 md:gap-3 hover:bg-slate-800/40 transition-colors items-center ${compact ? 'px-3 py-1.5' : 'px-4 py-3'}`}>
                      <span>
                        <span className="block font-mono text-[11px] text-emerald-300">{q.do_number || '—'}</span>
                        {!compact && <span className="block text-[10px] text-slate-600 font-mono">{displayDocNumber(q)}</span>}
                      </span>
                      <span className="text-sm text-slate-100 truncate">{custName(q.customer_id) || <span className="text-slate-600">{t('No customer')}</span>}</span>
                      <span className="text-[11px] text-slate-500 tabular-nums">
                        {agg ? `${agg.count} line${agg.count !== 1 ? 's' : ''} · ${fmtInt(agg.qty)} pcs` : '—'}
                      </span>
                      <span><span className="inline-block px-2 py-0.5 rounded text-[11px] font-semibold bg-emerald-500/15 text-emerald-300">{t('Delivered')}</span></span>
                      <span className="md:text-right text-[11px] text-slate-500 tabular-nums flex md:justify-end items-center gap-2">
                        {fmtDay(q.delivered_at)}
                        {/* Recording the units is a warehouse job done AT the
                            delivery — the register is one click from here. */}
                        {q.do_number && (
                          <span role="link" tabIndex={0}
                            onClick={(e) => { e.stopPropagation(); router.push(`/serials?q=${encodeURIComponent(q.do_number ?? '')}`); }}
                            onKeyDown={(e) => { if (e.key === 'Enter') { e.stopPropagation(); router.push(`/serials?q=${encodeURIComponent(q.do_number ?? '')}`); } }}
                            title={t("Serial numbers recorded against this delivery")}
                            className="text-[10px] px-1.5 py-0.5 rounded border border-slate-700 text-slate-500 hover:text-teal-300 hover:border-teal-500/40 transition-colors cursor-pointer">
                            SN
                          </span>
                        )}
                      </span>
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
  return <div className="min-h-screen bg-chrome flex items-center justify-center"><div className="w-6 h-6 border-2 border-emerald-500/30 border-t-emerald-500 rounded-full animate-spin" /></div>;
}
