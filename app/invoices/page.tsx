/**
 * ICAPROC — Sell-side: Invoices (AR)
 * Every invoiced sales document with its payment state: grand total, received,
 * outstanding, PAID/PARTIAL. Rows open the underlying sales document, where
 * payments are recorded. Visible to owner / sales / finance.
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
  customer_id: string | null; status: string; grand_total: number; invoiced_at: string | null; delivered_at: string | null;
}
interface Customer { customer_id: string; display_name: string; legal_name: string; }

const fmtInt = (n: number) => Math.round(n).toLocaleString('en-US');
const fmtIdr = (n: number) =>
  n >= 1_000_000_000 ? `IDR ${(n / 1_000_000_000).toFixed(2)}B`
  : n >= 1_000_000   ? `IDR ${(n / 1_000_000).toFixed(1)}M`
  : `IDR ${fmtInt(n)}`;
const fmtDate = (d?: string | null) => d ? new Date(d).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: '2-digit' }) : '';

export default function InvoicesPage() {
  const supabase = createSupabaseClient();
  const router = useRouter();
  const { user, profile, loading: authLoading } = useAuth();
  const canView = !!profile && (ROLE_PERMISSIONS[profile.role].canEditSalesDocs || ROLE_PERMISSIONS[profile.role].canRecordReceipts);

  const [quotes, setQuotes] = useState<Quote[]>([]);
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [receivedByQuote, setReceivedByQuote] = useState<Record<string, number>>({});
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [unpaidOnly, setUnpaidOnly] = useState(false);

  useEffect(() => { document.title = 'Invoices — ICAPROC'; }, []);
  useEffect(() => {
    if (authLoading) return;
    if (!user) { router.replace(`/login?next=${encodeURIComponent('/invoices')}`); return; }
    if (profile && !(ROLE_PERMISSIONS[profile.role].canEditSalesDocs || ROLE_PERMISSIONS[profile.role].canRecordReceipts)) router.replace('/unauthorized');
  }, [authLoading, user, profile, router]);

  const fetchAll = useCallback(async () => {
    setLoading(true);
    const [qRes, custRes, rRes] = await Promise.all([
      supabase.from('22.0_sales_quotes')
        .select('quote_id, quote_number, order_number, invoice_number, do_number, customer_id, status, grand_total, invoiced_at, delivered_at')
        .in('status', ['invoiced', 'preparing', 'delivered'])
        .order('invoiced_at', { ascending: false }),
      supabase.from('20.0_customers').select('customer_id, display_name, legal_name'),
      supabase.from('26.0_customer_receipts').select('quote_id, amount'),
    ]);
    setQuotes((qRes.data as Quote[]) ?? []);
    setCustomers((custRes.data as Customer[]) ?? []);
    const rcv: Record<string, number> = {};
    for (const r of ((rRes.data as { quote_id: string; amount: number }[]) ?? [])) rcv[r.quote_id] = (rcv[r.quote_id] ?? 0) + (Number(r.amount) || 0);
    setReceivedByQuote(rcv);
    setLoading(false);
  }, []);
  useEffect(() => { if (canView) fetchAll(); }, [canView, fetchAll]);

  const custById = useMemo(() => new Map(customers.map((c) => [c.customer_id, c])), [customers]);

  const rows = useMemo(() => {
    const s = search.trim().toLowerCase();
    return quotes
      .map((q) => {
        const total = Number(q.grand_total) || 0;
        const rcv = receivedByQuote[q.quote_id] ?? 0;
        return { q, total, rcv, out: Math.max(0, total - rcv), paid: total > 0 && rcv >= total - 0.5 };
      })
      .filter(({ q, paid }) => {
        if (unpaidOnly && paid) return false;
        if (!s) return true;
        const c = q.customer_id ? custById.get(q.customer_id) : undefined;
        return [q.invoice_number, q.quote_number, q.order_number, q.do_number, c?.display_name, c?.legal_name]
          .filter(Boolean).join(' ').toLowerCase().includes(s);
      });
  }, [quotes, receivedByQuote, search, unpaidOnly, custById]);

  const kpi = useMemo(() => {
    const invoiced = quotes.reduce((s, q) => s + (Number(q.grand_total) || 0), 0);
    const received = quotes.reduce((s, q) => s + (receivedByQuote[q.quote_id] ?? 0), 0);
    return { invoiced, received, outstanding: Math.max(0, invoiced - received) };
  }, [quotes, receivedByQuote]);

  if (authLoading || !profile) return <CenterSpinner />;
  if (!canView) return <CenterSpinner />;

  return (
    <div className="min-h-screen bg-[#0f1012] text-slate-200 font-sans text-sm">
      <div className="border-b border-slate-800/60 bg-[#0f1012]/80 backdrop-blur-md sticky top-0 z-30">
        <div className="max-w-[1200px] 2xl:max-w-[1560px] mx-auto px-3 sm:px-4 md:px-8 py-4 flex items-center justify-between gap-4">
          <BrandMenu wordmarkClass="text-xl md:text-2xl font-extrabold" subtitle="Invoices · Accounts receivable" />
        </div>
      </div>

      <main className="max-w-[1200px] 2xl:max-w-[1560px] mx-auto px-3 sm:px-4 md:px-8 py-6 space-y-5">
        {/* AR KPIs */}
        <div className="grid grid-cols-3 gap-3">
          {[
            { label: 'Invoiced', value: kpi.invoiced, cls: 'text-slate-200' },
            { label: 'Received', value: kpi.received, cls: 'text-emerald-300' },
            { label: 'Outstanding', value: kpi.outstanding, cls: kpi.outstanding > 0 ? 'text-amber-300' : 'text-emerald-300' },
          ].map(({ label, value, cls }) => (
            <div key={label} className="bg-slate-900/60 border border-slate-800/80 rounded-2xl p-3.5">
              <p className="text-[10px] font-semibold uppercase tracking-widest text-slate-500 mb-1">{label}</p>
              <p className={`text-lg md:text-xl font-extrabold tabular-nums ${cls}`}>{loading ? '—' : fmtIdr(value)}</p>
            </div>
          ))}
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <div className="relative flex-1 min-w-[220px]">
            <svg className="w-4 h-4 text-slate-500 absolute left-3.5 top-1/2 -translate-y-1/2" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M21 21l-4.35-4.35M17 11a6 6 0 11-12 0 6 6 0 0112 0z" /></svg>
            <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search invoice number, customer…"
              className="w-full pl-10 pr-4 h-11 rounded-xl bg-slate-900/80 border border-slate-700/80 focus:border-emerald-500/60 outline-none text-white text-base sm:text-sm placeholder:text-slate-500 transition-colors" />
          </div>
          <label className="flex items-center gap-2 text-xs text-slate-400 cursor-pointer select-none">
            <input type="checkbox" checked={unpaidOnly} onChange={(e) => setUnpaidOnly(e.target.checked)} className="accent-emerald-500 w-4 h-4" />
            Unpaid only
          </label>
          <span className="text-xs text-slate-600 tabular-nums">{rows.length} invoice{rows.length !== 1 ? 's' : ''}</span>
        </div>

        <div className="bg-slate-900/40 border border-slate-800/80 rounded-2xl overflow-hidden">
          <div className="hidden md:grid grid-cols-[160px_1fr_100px_130px_150px_90px] gap-3 px-4 py-2.5 border-b border-slate-800 text-[10px] font-semibold uppercase tracking-widest text-slate-500">
            <span>Invoice</span><span>Customer</span><span className="text-right">Date</span><span className="text-right">Total</span><span className="text-right">Received</span><span className="text-right">Status</span>
          </div>
          {loading ? (
            <div className="p-4 space-y-1.5">{[...Array(6)].map((_, i) => <div key={i} className="h-12 bg-slate-800/40 rounded-xl animate-pulse" />)}</div>
          ) : rows.length === 0 ? (
            <div className="px-4 py-12 text-center text-slate-600 text-sm">{quotes.length === 0 ? 'No invoices yet — invoice a confirmed order in Sales.' : 'No matches.'}</div>
          ) : (
            <div className="divide-y divide-slate-800/60">
              {rows.map(({ q, total, rcv, out, paid }) => {
                const c = q.customer_id ? custById.get(q.customer_id) : undefined;
                const pct = total > 0 ? Math.min(100, (rcv / total) * 100) : 0;
                return (
                  <button key={q.quote_id} onClick={() => router.push(`/sales/${q.quote_id}`)}
                    className="w-full text-left grid grid-cols-2 md:grid-cols-[160px_1fr_100px_130px_150px_90px] gap-1 md:gap-3 px-4 py-3 hover:bg-slate-800/40 transition-colors items-center">
                    <span>
                      <span className="block font-mono text-[11px] text-amber-200">{q.invoice_number || '—'}</span>
                      <span className="block text-[10px] text-slate-600 font-mono">{q.quote_number}</span>
                    </span>
                    <span className="text-sm text-slate-100 truncate">{c?.display_name || c?.legal_name || <span className="text-slate-600">No customer</span>}</span>
                    <span className="md:text-right text-[11px] text-slate-500 tabular-nums">{fmtDate(q.invoiced_at)}</span>
                    <span className="md:text-right tabular-nums text-slate-200">{fmtInt(total)}</span>
                    <span className="md:text-right">
                      <span className="block tabular-nums text-[13px] text-slate-300">{fmtInt(rcv)}</span>
                      <span className="mt-0.5 flex items-center gap-1.5 md:justify-end">
                        <span className="w-12 h-1 bg-slate-700 rounded-full overflow-hidden inline-block">
                          <span className={`block h-full rounded-full ${pct >= 100 ? 'bg-emerald-500' : pct > 0 ? 'bg-amber-400' : 'bg-slate-600'}`} style={{ width: `${pct}%` }} />
                        </span>
                        {out > 0 && <span className="text-[10px] text-amber-300/80 tabular-nums">−{fmtInt(out)}</span>}
                      </span>
                    </span>
                    <span className="md:text-right">
                      <span className={`inline-block px-2 py-0.5 rounded text-[10px] font-bold ${paid ? 'bg-emerald-500/20 text-emerald-300' : rcv > 0 ? 'bg-amber-500/15 text-amber-300' : 'bg-slate-800 text-slate-400'}`}>
                        {paid ? 'PAID' : rcv > 0 ? 'PARTIAL' : 'UNPAID'}
                      </span>
                      {q.status === 'delivered' && <span className="block mt-0.5 text-[9px] text-emerald-500/70 uppercase font-semibold md:text-right">Delivered</span>}
                    </span>
                  </button>
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
