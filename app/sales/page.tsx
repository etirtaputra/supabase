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
import { SALES_STATUS as STATUS, milestoneIndex, displayDocNumber, docNumberCls } from '@/lib/salesStatus';
import { fmtDay, fmtInt, fmtRupiah } from '@/lib/formatters';
import DateRangeFilter from '@/components/ui/DateRangeFilter';
import LayoutToggle from '@/components/ui/LayoutToggle';
import { useListLayout } from '@/hooks/useListLayout';
import { useListDefaults } from '@/hooks/useListDefaults';
import { listSpec } from '@/constants/listDefaults';
import { inRange, todayISO, type DateRange } from '@/lib/dateRange';

interface Quote {
  quote_id: string; quote_number: string; order_number?: string; invoice_number?: string; do_number?: string; case_id?: string | null;
  customer_id: string | null; status: string; grand_total: number; updated_at?: string; revision?: number;
  quote_date?: string | null; valid_until?: string | null;
}
interface Customer { customer_id: string; display_name: string; legal_name: string; }
interface PreviewLine { quote_id: string; description: string; quantity: number; unit_price: number; is_section: boolean; sort_order: number; }
interface InvLite { invoice_id: string; quote_id: string; invoice_number: string; grand_total: number; }
interface DoLite { do_id: string; quote_id: string; do_number: string; status: string; }


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
  // Money and goods each get their own filter — "delivered but not paid" is
  // two clicks, not a search phrase.
  const [payFilter, setPayFilter] = useState('all');
  const [delFilter, setDelFilter] = useState('all');
  // Lifecycle stage filter — the DQ / PQ / SO axis
  const [stageFilter, setStageFilter] = useState('all');
  // Bulk housekeeping: DRAFTS ONLY are selectable for deletion. An SO is
  // wired to invoices / DOs / payments — unwind those first (revert or
  // cancel), deletion of live documents is deliberately impossible here.
  const [selectedDrafts, setSelectedDrafts] = useState<Set<string>>(new Set());
  const [deleteArmed, setDeleteArmed] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [toastMsg, setToastMsg] = useState<string | null>(null);
  const flash = (m: string) => { setToastMsg(m); setTimeout(() => setToastMsg(null), 3000); };
  // Column-header sort: click sorts, click again flips; using the order
  // dropdown clears it. Text reads A→Z first, money/date biggest-first.
  type ColKey = 'number' | 'customer' | 'status' | 'payment' | 'total' | 'updated';
  const [colSort, setColSort] = useState<{ key: ColKey; dir: 'asc' | 'desc' } | null>(null);
  const clickCol = (key: ColKey) =>
    setColSort((s) => (s?.key === key
      ? { key, dir: s.dir === 'asc' ? 'desc' : 'asc' }
      : { key, dir: ['payment', 'total', 'updated'].includes(key) ? 'desc' : 'asc' }));

  useEffect(() => { document.title = 'Sales Orders — ICAPROC'; }, []);
  useEffect(() => {
    if (authLoading) return;
    if (!user) { router.replace(`/login?next=${encodeURIComponent('/sales')}`); return; }
    if (profile && !ROLE_PERMISSIONS[profile.role].canEditSalesDocs) router.replace('/unauthorized');
  }, [authLoading, user, profile, router]);

  const [receivedByQuote, setReceivedByQuote] = useState<Record<string, number>>({});
  const [linesByQuote, setLinesByQuote] = useState<Record<string, PreviewLine[]>>({});
  const [invoicesByQuote, setInvoicesByQuote] = useState<Record<string, InvLite[]>>({});
  const [dosByQuote, setDosByQuote] = useState<Record<string, DoLite[]>>({});
  const [paidByInvoice, setPaidByInvoice] = useState<Record<string, number>>({});
  const [expanded, setExpanded] = useState<string | null>(null);

  const fetchAll = useCallback(async () => {
    setLoading(true);
    const [qRes, custRes, rRes, iRes, invRes, doRes] = await Promise.all([
      supabase.from('22.0_sales_quotes').select('quote_id, quote_number, order_number, invoice_number, do_number, customer_id, status, grand_total, updated_at, revision, quote_date, valid_until, case_id').order('updated_at', { ascending: false }),
      supabase.from('20.0_customers').select('customer_id, display_name, legal_name'),
      supabase.from('26.0_customer_receipts').select('quote_id, invoice_id, amount'),
      supabase.from('22.1_sales_quote_items').select('quote_id, description, quantity, unit_price, is_section, sort_order').order('sort_order'),
      supabase.from('25.0_sales_invoices').select('invoice_id, quote_id, invoice_number, grand_total').order('created_at'),
      supabase.from('24.0_delivery_orders').select('do_id, quote_id, do_number, status').order('created_at'),
    ]);
    setQuotes((qRes.data as Quote[]) ?? []);
    setCustomers((custRes.data as Customer[]) ?? []);
    const rcv: Record<string, number> = {};
    const paidInv: Record<string, number> = {};
    for (const r of ((rRes.data as { quote_id: string; invoice_id?: string | null; amount: number }[]) ?? [])) {
      rcv[r.quote_id] = (rcv[r.quote_id] ?? 0) + (Number(r.amount) || 0);
      if (r.invoice_id) paidInv[r.invoice_id] = (paidInv[r.invoice_id] ?? 0) + (Number(r.amount) || 0);
    }
    setReceivedByQuote(rcv);
    setPaidByInvoice(paidInv);
    const grouped: Record<string, PreviewLine[]> = {};
    for (const l of ((iRes.data as PreviewLine[]) ?? [])) (grouped[l.quote_id] ??= []).push(l);
    setLinesByQuote(grouped);
    const invG: Record<string, InvLite[]> = {};
    for (const i of ((invRes.error ? [] : invRes.data as InvLite[]) ?? [])) (invG[i.quote_id] ??= []).push(i);
    setInvoicesByQuote(invG);
    const doG: Record<string, DoLite[]> = {};
    for (const d of ((doRes.error ? [] : doRes.data as DoLite[]) ?? [])) (doG[d.quote_id] ??= []).push(d);
    setDosByQuote(doG);
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
  const BILLED = ['ordered', 'invoiced', 'preparing', 'delivered'];
  // One vocabulary for the Payment column, the expanded digest AND the filter —
  // computed once so they can never disagree.
  const payStateOf = (q: Quote): 'none' | 'unpaid' | 'partial' | 'outstanding' | 'paid' => {
    const t = Number(q.grand_total) || 0;
    if (!BILLED.includes(q.status) || t <= 0) return 'none';
    const r = receivedByQuote[q.quote_id] ?? 0;
    if (r >= t - 0.5) return 'paid';
    if (q.status === 'delivered') return 'outstanding';
    return r > 0 ? 'partial' : 'unpaid';
  };
  const delStateOf = (q: Quote): 'none' | 'preparing' | 'partial' | 'delivered' => {
    if (q.status === 'delivered') return 'delivered';
    const ds = dosByQuote[q.quote_id] ?? [];
    if (ds.some((d) => d.status === 'delivered')) return 'partial';
    return ds.length > 0 ? 'preparing' : 'none';
  };
  const hasArOpen = (q: Quote) => payStateOf(q) === 'outstanding';
  const matchesSearch = (q: Quote): boolean => {
    const s = search.trim().toLowerCase();
    if (!s) return true;
    const c = q.customer_id ? custById.get(q.customer_id) : undefined;
    if ([displayDocNumber(q), q.quote_number, q.order_number, q.invoice_number, q.do_number, c?.display_name, c?.legal_name, STATUS[q.status]?.label, isExpired(q) ? 'expired' : '', hasArOpen(q) ? 'outstanding belum lunas' : '']
      .filter(Boolean).join(' ').toLowerCase().includes(s)) return true;
    // Products on the document count too — find every order that carries an item
    return (linesByQuote[q.quote_id] ?? []).some((l) => !l.is_section && (l.description || '').toLowerCase().includes(s));
  };
  // Drafts live in their OWN section below the list — unfinished paperwork
  // kept out of the live pipeline (and out of the Stage filter).
  const draftDocs = quotes
    .filter((q) => q.status === 'draft' && inRange(q.quote_date ?? q.updated_at ?? null, range) && matchesSearch(q))
    .sort((a, b) => (b.updated_at || '').localeCompare(a.updated_at || ''));
  const filtered = quotes.filter((q) => {
    if (q.status === 'draft') return false;
    if (!inRange(q.quote_date ?? q.updated_at ?? null, range)) return false;
    if (stageFilter === 'quote' && !['validated', 'sent', 'accepted'].includes(q.status)) return false;
    if (stageFilter === 'order' && !BILLED.includes(q.status)) return false;
    if (payFilter !== 'all' && payStateOf(q) !== payFilter) return false;
    if (delFilter !== 'all' && delStateOf(q) !== delFilter) return false;
    return matchesSearch(q);
  }).sort((a, b) => {
    if (colSort) {
      const pctOf = (q: Quote) => {
        const t = Number(q.grand_total) || 0;
        return t > 0 ? (receivedByQuote[q.quote_id] ?? 0) / t : -1;
      };
      let cmp = 0;
      switch (colSort.key) {
        case 'number':   cmp = displayDocNumber(a).localeCompare(displayDocNumber(b), undefined, { numeric: true }); break;
        case 'customer': cmp = nameOf(a).localeCompare(nameOf(b)); break;
        case 'status':   cmp = milestoneIndex(a.status) - milestoneIndex(b.status); break;
        case 'payment':  cmp = pctOf(a) - pctOf(b); break;
        case 'total':    cmp = (Number(a.grand_total) || 0) - (Number(b.grand_total) || 0); break;
        case 'updated':  cmp = (a.updated_at || '').localeCompare(b.updated_at || ''); break;
      }
      return colSort.dir === 'asc' ? cmp : -cmp;
    }
    if (sort === 'value')    return (Number(b.grand_total) || 0) - (Number(a.grand_total) || 0);
    if (sort === 'customer') return nameOf(a).localeCompare(nameOf(b));
    if (sort === 'updated')  return (b.updated_at || '').localeCompare(a.updated_at || '');
    // 'created' — the document's own date, then its update stamp to break ties
    return (b.quote_date || '').localeCompare(a.quote_date || '')
        || (b.updated_at || '').localeCompare(a.updated_at || '');
  });

  // What the filtered set is worth — the reason to filter by week/month/year.
  // Three lifecycle buckets, coloured like their codes: Quoted = live PQs on
  // the table, Ordered = everything confirmed (SO onward), Delivered = the
  // subset that has fully shipped.
  const sumOf = (list: Quote[]) => list.reduce((sum, q) => sum + (Number(q.grand_total) || 0), 0);
  const quotedDocs    = filtered.filter((q) => ['validated', 'sent', 'accepted'].includes(q.status));
  const committed     = filtered.filter((q) => ['ordered', 'invoiced', 'preparing', 'delivered'].includes(q.status));
  const deliveredDocs = filtered.filter((q) => q.status === 'delivered');
  const draftsSelected = [...selectedDrafts].filter((id) => quotes.find((q) => q.quote_id === id)?.status === 'draft');

  async function deleteSelectedDrafts() {
    if (!draftsSelected.length || deleting) return;
    setDeleting(true);
    // Items first, then the header — with a server-side status guard so
    // nothing beyond draft can ever be deleted from here.
    const { error: e1 } = await supabase.from('22.1_sales_quote_items').delete().in('quote_id', draftsSelected);
    const { error: e2 } = e1 ? { error: e1 } : await supabase.from('22.0_sales_quotes').delete().in('quote_id', draftsSelected).eq('status', 'draft');
    setDeleting(false);
    setDeleteArmed(false);
    if (e1 || e2) { flash(`Error: ${(e1 || e2)!.message}`); return; }
    flash(`${draftsSelected.length} draft${draftsSelected.length !== 1 ? 's' : ''} deleted`);
    setSelectedDrafts(new Set());
    fetchAll();
  }

  return (
    <div className="min-h-screen bg-chrome text-slate-200 font-sans text-sm">
      <div className="border-b border-slate-800/60 bg-chrome/80 backdrop-blur-md sticky top-0 z-30">
        {/* Phones: wordmark row then actions row — side-by-side squeezes the
            buttons into the wordmark. sm+ keeps the single row. */}
        <div className="max-w-[1200px] 2xl:max-w-[1760px] mx-auto px-3 sm:px-4 md:px-6 py-3 sm:py-4 flex flex-col sm:flex-row sm:items-center justify-between sm:flex-wrap gap-2.5 sm:gap-4">
          <BrandMenu wordmarkClass="text-xl md:text-2xl font-extrabold" subtitle="Sales Orders · DQ → PQ → SO" />
          {profile?.role === 'owner' && (
            <button onClick={() => router.push('/sales/library')}
              title="Owner-only: curated custom line texts that feed the item picker"
              className="text-xs text-slate-400 hover:text-white px-3 py-1.5 border border-slate-700 rounded-lg hover:bg-slate-800 transition-colors whitespace-nowrap">
              Library
            </button>
          )}
        </div>
      </div>
      <main className="max-w-[1200px] 2xl:max-w-[1760px] mx-auto px-3 sm:px-4 md:px-6 py-6 space-y-5">
        <SalesMigrationBanner />
        <div className="relative">
          <svg className="w-4 h-4 text-slate-500 absolute left-3.5 top-1/2 -translate-y-1/2" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M21 21l-4.35-4.35M17 11a6 6 0 11-12 0 6 6 0 0112 0z" /></svg>
          <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search by number, customer, status, product…"
            className="w-full pl-10 pr-4 h-11 rounded-xl bg-slate-900/80 border border-slate-700/80 focus:border-emerald-500/60 outline-none text-white text-base sm:text-sm placeholder:text-[13px] sm:placeholder:text-sm placeholder:text-slate-500 transition-colors" />
        </div>

        {/* Period filter + what the period is worth */}
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2 justify-between">
          <div className="flex items-center gap-2 flex-wrap">
            {/* Leftmost primary action — same placement + ghost style as After Sales */}
            <button onClick={() => router.push('/sales/new')}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-emerald-500/40 text-emerald-300 hover:bg-emerald-500/10 text-xs font-semibold whitespace-nowrap transition-colors">
              <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2"><path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" /></svg>
              New Quote
            </button>
            <DateRangeFilter value={range} onChange={(r) => { touched.current = true; setRange(r); }} label="Quote date" align="left" />
            <select value={sort} onChange={(e) => { touched.current = true; setSort(e.target.value); setColSort(null); }}
              title="Order — the default lives in Settings › Lists"
              className="text-xs bg-slate-900/80 border border-slate-700 text-slate-300 rounded-lg px-2 py-1.5 focus:outline-none focus:border-emerald-500/60">
              {listSpec('sales').sorts.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select>
            <select value={stageFilter} onChange={(e) => setStageFilter(e.target.value)}
              title="Filter by lifecycle stage — draft, price quote or confirmed order"
              className={`text-xs bg-slate-900/80 border rounded-lg px-2 py-1.5 focus:outline-none focus:border-emerald-500/60 ${stageFilter !== 'all' ? 'border-emerald-500/50 text-emerald-300' : 'border-slate-700 text-slate-300'}`}>
              <option value="all">Stage: all</option>
              <option value="quote">Quote (PQ)</option>
              <option value="order">Order (SO)</option>
            </select>
            <select value={payFilter} onChange={(e) => setPayFilter(e.target.value)}
              title="Filter by payment state"
              className={`text-xs bg-slate-900/80 border rounded-lg px-2 py-1.5 focus:outline-none focus:border-emerald-500/60 ${payFilter !== 'all' ? 'border-emerald-500/50 text-emerald-300' : 'border-slate-700 text-slate-300'}`}>
              <option value="all">Payment: all</option>
              <option value="unpaid">Unpaid</option>
              <option value="partial">Partial</option>
              <option value="outstanding">Outstanding</option>
              <option value="paid">Paid</option>
            </select>
            <select value={delFilter} onChange={(e) => setDelFilter(e.target.value)}
              title="Filter by delivery state"
              className={`text-xs bg-slate-900/80 border rounded-lg px-2 py-1.5 focus:outline-none focus:border-emerald-500/60 ${delFilter !== 'all' ? 'border-emerald-500/50 text-emerald-300' : 'border-slate-700 text-slate-300'}`}>
              <option value="all">Delivery: all</option>
              <option value="none">Not shipped</option>
              <option value="preparing">Preparing</option>
              <option value="partial">Partly delivered</option>
              <option value="delivered">Delivered</option>
            </select>
            <LayoutToggle value={layout} onChange={setLayout} />
          </div>
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px] text-slate-500">
            <span><span className="text-slate-300 font-semibold tabular-nums">{filtered.length}</span> doc{filtered.length !== 1 ? 's' : ''}</span>
            <span title={`${quotedDocs.length} live price quote${quotedDocs.length !== 1 ? 's' : ''} (validated / sent / accepted) in the period`}>
              Quoted <span className="text-sky-300 font-semibold tabular-nums">{fmtRupiah(sumOf(quotedDocs))}</span></span>
            <span title={`${committed.length} confirmed order${committed.length !== 1 ? 's' : ''} (SO onward) in the period`}>
              Ordered <span className="text-violet-300 font-semibold tabular-nums">{fmtRupiah(sumOf(committed))}</span></span>
            <span title={`${deliveredDocs.length} fully delivered in the period`}>
              Delivered <span className="text-emerald-300 font-semibold tabular-nums">{fmtRupiah(sumOf(deliveredDocs))}</span></span>
          </div>
        </div>

        <div className="bg-slate-900/40 border border-slate-800/80 rounded-2xl overflow-hidden">
          <div className={`hidden md:grid grid-cols-[175px_1fr_120px_120px_130px_100px] gap-3 border-b border-slate-800 text-[10px] font-semibold uppercase tracking-widest text-slate-500 ${compact ? 'px-3 py-1.5' : 'px-4 py-2.5'}`}>
            {([['number', 'Number', ''], ['customer', 'Customer', ''], ['status', 'Status', ''], ['payment', 'Payment', ''], ['total', 'Grand Total', 'justify-end'], ['updated', 'Updated', 'justify-end']] as [ColKey, string, string][]).map(([k, label, align]) => (
              <button key={k} onClick={() => clickCol(k)} title={`Sort by ${label.toLowerCase()} — click again to flip`}
                className={`flex items-center gap-1 uppercase tracking-widest transition-colors ${align} ${colSort?.key === k ? 'text-slate-200' : 'hover:text-slate-300'}`}>
                {label}
                <span className={`text-[8px] ${colSort?.key === k ? 'text-emerald-400' : 'text-transparent'}`}>
                  {colSort?.key === k && colSort.dir === 'desc' ? '▼' : '▲'}
                </span>
              </button>
            ))}
          </div>
          {loading ? (
            <div className="p-4 space-y-1.5">{[...Array(6)].map((_, i) => <div key={i} className="h-12 bg-slate-800/40 rounded-xl animate-pulse" />)}</div>
          ) : filtered.length === 0 ? (
            <div className="px-4 py-12 text-center text-slate-600 text-sm">{quotes.length === 0 ? 'No sales quotes yet — create your first one.' : draftDocs.length > 0 ? 'No live documents in this view — drafts are in their own section below.' : 'No matches.'}</div>
          ) : (
            <div className="divide-y divide-slate-800/60">
              {filtered.map((q) => renderRow(q, false))}
            </div>
          )}
        </div>

        {/* ── Drafts — unfinished quotes, kept out of the live pipeline ── */}
        {draftDocs.length > 0 && (
          <div className="bg-slate-900/40 border border-slate-800/80 rounded-2xl overflow-hidden">
            <div className={`flex items-center gap-3 border-b border-slate-800 ${compact ? 'px-3 py-2' : 'px-4 py-2.5'}`}>
              <input type="checkbox"
                checked={draftDocs.length > 0 && draftDocs.every((d) => selectedDrafts.has(d.quote_id))}
                onChange={(e) => setSelectedDrafts(e.target.checked ? new Set(draftDocs.map((d) => d.quote_id)) : new Set())}
                title="Select all drafts"
                className="w-3.5 h-3.5 accent-red-500 cursor-pointer flex-shrink-0" />
              <span className="text-[10px] font-semibold uppercase tracking-widest text-slate-500">Drafts <span className="tabular-nums">({draftDocs.length})</span></span>
              <span className="text-[10px] text-slate-600 hidden sm:inline">unfinished quotes — not in the totals until validated</span>
              {draftsSelected.length > 0 && (
                <button onClick={deleteArmed ? deleteSelectedDrafts : () => { setDeleteArmed(true); setTimeout(() => setDeleteArmed(false), 4000); }}
                  disabled={deleting}
                  title="Deletes the selected drafts only. Live documents (PQ/SO) cannot be deleted — an SO's invoices and delivery orders must be reverted or cancelled first."
                  className={`ml-auto flex items-center gap-1.5 px-2.5 py-1 rounded-md border text-[11px] font-semibold whitespace-nowrap transition-colors disabled:opacity-50 ${
                    deleteArmed ? 'bg-red-600 border-red-500 text-white' : 'border-red-500/40 text-red-300 hover:bg-red-500/10'}`}>
                  {deleting ? 'Deleting…' : deleteArmed ? `Confirm — delete ${draftsSelected.length}` : `Delete ${draftsSelected.length}`}
                </button>
              )}
            </div>
            <div className="divide-y divide-slate-800/60">
              {draftDocs.map((q) => renderRow(q, true))}
            </div>
          </div>
        )}
      </main>
      {toastMsg && (
        <div className="fixed bottom-6 right-6 z-[110] px-4 py-2.5 bg-slate-800 border border-slate-700 text-white text-sm font-semibold rounded-xl shadow-lg">
          {toastMsg}
        </div>
      )}
    </div>
  );

  function renderRow(q: Quote, isDraft: boolean) {
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
                    {/* The NUMBER is the link — click it to open the document;
                        click anywhere else on the row to expand the preview. */}
                    <div onClick={() => setExpanded(open ? null : q.quote_id)} aria-expanded={open}
                      role="button" tabIndex={0}
                      onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setExpanded(open ? null : q.quote_id); } }}
                      className={`w-full min-w-0 text-left grid grid-cols-1 md:grid-cols-[175px_1fr_120px_120px_130px_100px] gap-1 md:gap-3 items-center cursor-pointer transition-colors ${compact ? 'px-3 py-1.5' : 'px-4 py-3'} ${open ? 'bg-slate-800/30' : 'hover:bg-slate-800/40'}`}>
                      <span className="font-mono text-[11px] flex items-center">
                        {isDraft && (
                          <input type="checkbox" checked={selectedDrafts.has(q.quote_id)}
                            onClick={(e) => e.stopPropagation()}
                            onChange={(e) => {
                              const on = e.target.checked;
                              setSelectedDrafts((prev) => { const n = new Set(prev); if (on) n.add(q.quote_id); else n.delete(q.quote_id); return n; });
                            }}
                            title="Select this draft for deletion"
                            className="mr-2 w-3.5 h-3.5 accent-red-500 cursor-pointer flex-shrink-0" />
                        )}
                        <a href={`/sales/${q.quote_id}`} onClick={(e) => e.stopPropagation()} title="Open document"
                          className={`${docNumberCls(q.status)} hover:text-emerald-300 hover:underline underline-offset-2 decoration-emerald-500/50 transition-colors whitespace-nowrap`}>
                          {displayDocNumber(q)}
                        </a>
                        {(q.revision ?? 0) > 0 && <span className="ml-1 text-[9px] font-bold text-sky-400">R{q.revision}</span>}
                        {q.case_id && <span className="ml-1 px-1 py-0.5 rounded text-[9px] font-bold bg-orange-500/15 text-orange-300 align-middle" title="After-sales quote — repair / replacement for a service case">SVC</span>}
                      </span>
                      <span className="text-sm text-slate-100 truncate">{c?.display_name || c?.legal_name || <span className="text-slate-600">No customer</span>}</span>
                      {/* Column 1 of the pair: WHERE IS THE ORDER. A half-
                          shipped order says so — "Partly Delivered" is derived
                          from its DOs (the stored status only becomes
                          Delivered when every item has left). */}
                      <span className="flex flex-col gap-1">
                        <span className="flex items-center gap-1.5 flex-wrap">
                          {delStateOf(q) === 'partial' ? (
                            <span className="inline-block px-2 py-0.5 rounded text-[11px] font-semibold bg-teal-500/15 text-teal-300"
                              title="Some delivery orders are delivered, the rest still preparing — the order completes when every item has shipped">
                              Partly Delivered
                            </span>
                          ) : (
                            <span className={`inline-block px-2 py-0.5 rounded text-[11px] font-semibold ${STATUS[q.status]?.cls ?? ''}`}>{STATUS[q.status]?.label ?? q.status}</span>
                          )}
                          {isExpired(q) && <span className="inline-block px-2 py-0.5 rounded text-[11px] font-semibold bg-amber-500/15 text-amber-300" title={`Offer expired ${fmtDay(q.valid_until!)}`}>Expired</span>}
                        </span>
                        {!compact && <MilestoneDots status={q.status} paid={paidFull} delivered={q.status === 'delivered'} />}
                      </span>
                      {/* Column 2: WHERE IS THE MONEY — a bar and the number.
                          Colour carries the state: green paid, amber partial,
                          red = delivered with nothing received. */}
                      {!billed ? (
                        <span className="text-slate-700 text-[11px]">—</span>
                      ) : (
                        <span className="flex items-center gap-1.5"
                          title={`Rp ${fmtInt(rcv)} received of Rp ${fmtInt(total)}${arOpen ? ' — delivered with money still open' : ''}`}>
                          <span className="w-14 h-1.5 bg-slate-800 rounded-full overflow-hidden inline-block flex-shrink-0">
                            <span className={`block h-full rounded-full ${paidFull ? 'bg-emerald-500' : arOpen && rcv <= 0 ? 'bg-red-500/70' : pct > 0 ? 'bg-amber-400' : 'bg-slate-700'}`} style={{ width: `${Math.max(pct, paidFull ? 100 : pct)}%` }} />
                          </span>
                          <span className={`text-[10px] tabular-nums font-semibold ${paidFull ? 'text-emerald-400' : arOpen && rcv <= 0 ? 'text-red-300' : pct > 0 ? 'text-amber-300' : 'text-slate-600'}`}>{pct.toFixed(0)}%</span>
                        </span>
                      )}
                      <span className="text-right tabular-nums text-slate-200">{fmtInt(total)}</span>
                      <span className="text-right text-[11px] text-slate-500 tabular-nums flex items-center justify-end gap-2">
                        {fmtDay(q.updated_at)}
                        <svg className={`w-3.5 h-3.5 text-slate-600 transition-transform duration-150 ${open ? 'rotate-180 text-slate-400' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2"><path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" /></svg>
                      </span>
                    </div>
                    {open && (
                      <div className="px-4 pb-3 pt-1 bg-slate-950/40">
                        {/* Fulfillment digest — one aligned row per aspect
                            (SO · Payment · Invoices · Delivery), fixed label
                            column so everything lines up. Documents are quiet
                            links with a state dot (same language as the
                            customer profile); words live in the tooltip. */}
                        {(q.order_number || billed) && (() => {
                          const invs = invoicesByQuote[q.quote_id] ?? [];
                          const qdos = dosByQuote[q.quote_id] ?? [];
                          const invoicedTotal = invs.reduce((s, i) => s + (Number(i.grand_total) || 0), 0);
                          const lbl = 'w-24 flex-shrink-0 text-[9px] font-semibold uppercase tracking-widest text-slate-600';
                          const docLink = 'inline-flex items-center gap-1 font-mono text-[10px] text-slate-400 hover:text-emerald-300 transition-colors';
                          const dot = (cls: string) => <span className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${cls}`} />;
                          return (
                            <div className="pt-1.5 pb-2 mb-1.5 border-b border-slate-800/60 text-[11px] space-y-1.5">
                              {q.order_number && (
                                <p className="flex items-center gap-2 flex-wrap">
                                  <span className={lbl}>SO</span>
                                  <a href={`/sales/${q.quote_id}`} target="_blank" rel="noopener noreferrer" className={docLink}>{q.order_number}</a>
                                </p>
                              )}
                              {billed && (
                                <p className="flex items-center gap-2 flex-wrap">
                                  <span className={lbl}>Payment</span>
                                  <span className="w-14 h-1.5 bg-slate-800 rounded-full overflow-hidden inline-block flex-shrink-0">
                                    <span className={`block h-full rounded-full ${paidFull ? 'bg-emerald-500' : arOpen && rcv <= 0 ? 'bg-red-500/70' : pct > 0 ? 'bg-amber-400' : 'bg-slate-700'}`} style={{ width: `${pct}%` }} />
                                  </span>
                                  <span className={`text-[10px] tabular-nums font-semibold ${paidFull ? 'text-emerald-400' : arOpen && rcv <= 0 ? 'text-red-300' : pct > 0 ? 'text-amber-300' : 'text-slate-600'}`}>{pct.toFixed(0)}%</span>
                                  <span className="text-slate-500 tabular-nums">Rp {fmtInt(rcv)} of {fmtInt(total)}</span>
                                </p>
                              )}
                              {billed && (
                                <p className="flex items-center gap-x-3 gap-y-1 flex-wrap">
                                  <span className={lbl}>Invoices{invs.length > 1 ? ` ×${invs.length}` : ''}</span>
                                  {invs.length === 0 ? <span className="text-slate-600 italic">none yet</span> : (
                                    <>
                                      {invs.map((i) => {
                                        const it = Number(i.grand_total) || 0;
                                        const ip = paidByInvoice[i.invoice_id] ?? 0;
                                        const st2 = it > 0 && ip >= it - 0.5 ? 'Paid' : ip > 0 ? 'Partial' : 'Unpaid';
                                        return (
                                          <a key={i.invoice_id} href={`/sales/${q.quote_id}/print?inv=${i.invoice_id}`} target="_blank" rel="noopener noreferrer"
                                            title={`${st2} — Rp ${fmtInt(ip)} received of Rp ${fmtInt(it)}`} className={docLink}>
                                            {i.invoice_number}{dot(st2 === 'Paid' ? 'bg-emerald-400' : st2 === 'Partial' ? 'bg-amber-400' : 'bg-slate-600')}</a>
                                        );
                                      })}
                                      <span className="text-slate-600 tabular-nums">
                                        {total > 0 && invoicedTotal >= total - 0.5 ? 'fully invoiced' : `${total > 0 ? ((invoicedTotal / total) * 100).toFixed(0) : 0}% billed`}
                                      </span>
                                    </>
                                  )}
                                </p>
                              )}
                              {billed && (
                                <p className="flex items-center gap-x-3 gap-y-1 flex-wrap">
                                  <span className={lbl}>Delivery{qdos.length > 1 ? ` ×${qdos.length}` : ''}</span>
                                  {qdos.length === 0 ? <span className="text-slate-600 italic">no DO yet</span> : (
                                    <>
                                      {qdos.map((d) => (
                                        <a key={d.do_id} href={`/sales/${q.quote_id}/do?do=${d.do_id}`} target="_blank" rel="noopener noreferrer"
                                          title={d.status === 'delivered' ? 'Delivered' : 'Preparing'} className={docLink}>
                                          {d.do_number}{dot(d.status === 'delivered' ? 'bg-emerald-400' : 'bg-orange-400')}</a>
                                      ))}
                                      <span className="text-slate-600">
                                        {q.status === 'delivered' ? 'fully delivered' : delStateOf(q) === 'partial' ? 'partly delivered' : 'in preparation'}
                                      </span>
                                    </>
                                  )}
                                </p>
                              )}
                            </div>
                          );
                        })()}
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
  }
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
