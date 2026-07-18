/**
 * ICAPROC — Sell-side: Sales Quotes list. Each quote has its own page at
 * /sales/[id]. Owner + sales.
 */
'use client';
import { useState, useEffect, useMemo, useCallback } from 'react';
import { createSupabaseClient } from '@/lib/supabase';
import { useAuth } from '@/hooks/useAuth';
import { useRouter } from 'next/navigation';
import { ROLE_PERMISSIONS } from '@/constants/roles';
import BrandMenu from '@/components/ui/BrandMenu';
import SalesMigrationBanner from '@/components/ui/SalesMigrationBanner';
import { SALES_STATUS as STATUS } from '@/lib/salesStatus';

interface Quote {
  quote_id: string; quote_number: string; order_number?: string; invoice_number?: string; do_number?: string;
  customer_id: string | null; status: string; grand_total: number; updated_at?: string;
}
interface Customer { customer_id: string; display_name: string; legal_name: string; }

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

  const fetchAll = useCallback(async () => {
    setLoading(true);
    const [qRes, custRes] = await Promise.all([
      supabase.from('22.0_sales_quotes').select('quote_id, quote_number, order_number, invoice_number, do_number, customer_id, status, grand_total, updated_at').order('updated_at', { ascending: false }),
      supabase.from('20.0_customers').select('customer_id, display_name, legal_name'),
    ]);
    setQuotes((qRes.data as Quote[]) ?? []);
    setCustomers((custRes.data as Customer[]) ?? []);
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
                return (
                  <button key={q.quote_id} onClick={() => router.push(`/sales/${q.quote_id}`)} className="w-full text-left grid grid-cols-1 md:grid-cols-[150px_1fr_130px_140px_110px] gap-1 md:gap-3 px-4 py-3 hover:bg-slate-800/40 transition-colors items-center">
                    <span className="font-mono text-[11px] text-slate-300">{q.quote_number}</span>
                    <span className="text-sm text-slate-100 truncate">{c?.display_name || c?.legal_name || <span className="text-slate-600">No customer</span>}</span>
                    <span><span className={`inline-block px-2 py-0.5 rounded text-[11px] font-semibold ${STATUS[q.status]?.cls ?? ''}`}>{STATUS[q.status]?.label ?? q.status}</span></span>
                    <span className="text-right tabular-nums text-slate-200">{fmtInt(Number(q.grand_total) || 0)}</span>
                    <span className="text-right text-[11px] text-slate-500 tabular-nums">{fmtDate(q.updated_at)}</span>
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
