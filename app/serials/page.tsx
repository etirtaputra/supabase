'use client';
/**
 * ICAPROC — Serial Numbers (30.4)
 *
 * The register of individual units. The warehouse writes it while it packs;
 * the after-sales desk reads it when a customer calls out a serial from a
 * label. Everything the desk needs — which order, which invoice, which
 * delivery, which customer — hangs off that one string, and hangs off it only
 * because somebody recorded it here first.
 *
 * Entry is built for the job it actually is: copying a column off a packing
 * list. Pick the document once, pick the product once, then PASTE the whole
 * column. Repeats inside the paste and serials the register already holds are
 * shown before anything is written, never after.
 *
 * A unit that is not ours belongs here too — a customer's own machine, product
 * named in free text, marked as not sold by us, so a service ticket can point
 * at something real.
 */
import { useState, useEffect, useMemo, useCallback } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { Suspense } from 'react';
import { createSupabaseClient } from '@/lib/supabase';
import { useAuth } from '@/hooks/useAuth';
import { ROLE_PERMISSIONS } from '@/constants/roles';
import { canOpenPath } from '@/constants/navigation';
import BrandMenu from '@/components/ui/BrandMenu';
import { fmtDay } from '@/lib/formatters';
import { displayDocNumber } from '@/lib/salesStatus';
import {
  fetchSerials, parseSerialBatch, findExisting, traceSerial, normSerial, SERIAL_STATUS,
  type SerialRow, type SerialSalesDoc, type SerialDo, type SerialInvoice,
} from '@/lib/serials';

interface Comp { component_id: string; internal_description: string | null; supplier_model: string | null; unit: string | null }
interface Cust { customer_id: string; display_name: string; legal_name: string }

type SortKey = 'serial' | 'product' | 'customer' | 'order' | 'delivery' | 'status' | 'created';

const inp = 'w-full px-3 py-2 bg-slate-800/70 border border-slate-700 rounded-lg text-white text-sm placeholder-slate-600 focus:outline-none focus:ring-2 focus:ring-emerald-500/40 focus:border-emerald-500/50';

function SerialsPage() {
  const supabase = createSupabaseClient();
  const router = useRouter();
  const params = useSearchParams();
  const { user, profile, loading: authLoading } = useAuth();
  const perms = profile ? ROLE_PERMISSIONS[profile.role] : null;
  const canView = !!perms && canOpenPath(perms, '/serials');
  // Recording units is a warehouse job; the sales desk corrects what it knows
  const canEdit = !!perms && (perms.canManageStock || perms.canEditSalesDocs);

  const [serials, setSerials] = useState<SerialRow[]>([]);
  const [comps, setComps] = useState<Comp[]>([]);
  const [customers, setCustomers] = useState<Cust[]>([]);
  const [orders, setOrders] = useState<SerialSalesDoc[]>([]);
  const [dos, setDos] = useState<SerialDo[]>([]);
  const [invoices, setInvoices] = useState<SerialInvoice[]>([]);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState('');
  const [toast, setToast] = useState<string | null>(null);
  const flash = (m: string) => { setToast(m); setTimeout(() => setToast(null), 6000); };

  // ── Entry form ──────────────────────────────────────────────────────────
  const [showForm, setShowForm] = useState(false);
  const [fQuote, setFQuote] = useState('');
  const [fDo, setFDo] = useState('');
  const [fInvoice, setFInvoice] = useState('');
  const [fComp, setFComp] = useState('');
  const [fProductText, setFProductText] = useState('');
  const [fExternal, setFExternal] = useState(false);
  const [fCustomer, setFCustomer] = useState('');
  const [fPaste, setFPaste] = useState('');
  const [fNotes, setFNotes] = useState('');
  const [busy, setBusy] = useState(false);

  // ── List ────────────────────────────────────────────────────────────────
  const [search, setSearch] = useState(params.get('q') ?? '');
  const [statusFilter, setStatusFilter] = useState('');
  const [sort, setSort] = useState<{ key: SortKey; dir: 1 | -1 }>({ key: 'created', dir: -1 });
  const [openRow, setOpenRow] = useState<string | null>(null);

  useEffect(() => { document.title = 'Serial Numbers — ICAPROC'; }, []);
  useEffect(() => {
    if (authLoading) return;
    if (!user) { router.replace(`/login?next=${encodeURIComponent('/serials')}`); return; }
    if (profile && !canOpenPath(ROLE_PERMISSIONS[profile.role], '/serials')) router.replace('/unauthorized');
  }, [authLoading, user, profile, router]);

  const load = useCallback(async () => {
    setLoading(true);
    setFailed('');
    try {
      const [regs, compRes, custRes, orderRes, doRes, invRes] = await Promise.all([
        fetchSerials(supabase),
        supabase.from('3.0_components').select('component_id, internal_description, supplier_model, unit').limit(5000),
        supabase.from('20.0_customers').select('customer_id, display_name, legal_name').order('display_name'),
        supabase.from('22.0_sales_quotes').select('quote_id, quote_number, order_number, invoice_number, do_number, customer_id, status, ordered_at, delivered_at').order('quote_date', { ascending: false }),
        supabase.from('24.0_delivery_orders').select('do_id, do_number, quote_id, delivery_date, delivered_at, status').order('delivery_date', { ascending: false }),
        supabase.from('25.0_sales_invoices').select('invoice_id, invoice_number, quote_id, issued_at').order('issued_at', { ascending: false }),
      ]);
      setSerials(regs);
      setComps((compRes.data ?? []) as Comp[]);
      setCustomers((custRes.data ?? []) as Cust[]);
      setOrders((orderRes.data ?? []) as SerialSalesDoc[]);
      setDos((doRes.data ?? []) as SerialDo[]);
      setInvoices((invRes.data ?? []) as SerialInvoice[]);
    } catch (e) {
      // A silent empty register reads as "nothing recorded" — say what happened
      setFailed(e instanceof Error ? e.message : String(e));
    } finally { setLoading(false); }
  }, [supabase]);

  useEffect(() => { if (canView) load(); }, [canView, load]);

  // ── Lookups ─────────────────────────────────────────────────────────────
  const compById = useMemo(() => new Map(comps.map((c) => [c.component_id, c])), [comps]);
  const custById = useMemo(() => new Map(customers.map((c) => [c.customer_id, c.display_name || c.legal_name])), [customers]);
  const orderById = useMemo(() => new Map(orders.map((o) => [String(o.quote_id), o])), [orders]);
  const doById = useMemo(() => new Map(dos.map((d) => [String(d.do_id), d])), [dos]);
  const invById = useMemo(() => new Map(invoices.map((i) => [String(i.invoice_id), i])), [invoices]);

  const productOf = useCallback((r: SerialRow): string => {
    if (r.component_id) {
      const c = compById.get(r.component_id);
      // Sell-side wording: the internal description, never the supplier model
      if (c) return c.internal_description || c.supplier_model || '—';
    }
    return r.product_text || '—';
  }, [compById]);

  const traceOf = useCallback((r: SerialRow) => traceSerial(r, orders, dos, invoices), [orders, dos, invoices]);

  // ── Entry form: what the paste would do ─────────────────────────────────
  const batch = useMemo(() => parseSerialBatch(fPaste), [fPaste]);
  const clashes = useMemo(
    () => findExisting(batch.serials, fComp || null, serials),
    [batch.serials, fComp, serials]);
  const willWrite = batch.serials.filter((s) => !clashes.has(s));

  // Documents narrow to the chosen order — a DO from another order is a mistake
  const formDos = useMemo(() => (fQuote ? dos.filter((d) => String(d.quote_id) === fQuote) : []), [dos, fQuote]);
  const formInvoices = useMemo(() => (fQuote ? invoices.filter((i) => String(i.quote_id) === fQuote) : []), [invoices, fQuote]);

  // Picking the order fills the customer in — it is the order's customer
  useEffect(() => {
    if (!fQuote) return;
    const o = orderById.get(fQuote);
    if (o?.customer_id) setFCustomer(String(o.customer_id));
    setFDo((d) => (d && !formDos.some((x) => String(x.do_id) === d) ? '' : d));
    setFInvoice((i) => (i && !formInvoices.some((x) => String(x.invoice_id) === i) ? '' : i));
  }, [fQuote, orderById, formDos, formInvoices]);

  const resetForm = () => {
    setFQuote(''); setFDo(''); setFInvoice(''); setFComp(''); setFProductText('');
    setFExternal(false); setFCustomer(''); setFPaste(''); setFNotes('');
  };

  async function saveBatch() {
    if (!canEdit || busy) return;
    if (willWrite.length === 0) { flash('Nothing new to record — every serial in the paste is already registered.'); return; }
    if (!fComp && !fProductText.trim()) { flash('Say which product these units are — pick a catalog item, or name it in the free-text field.'); return; }
    setBusy(true);
    try {
      const chosenDo = fDo ? doById.get(fDo) : null;
      const rows = willWrite.map((s) => ({
        serial: s,
        component_id: fComp || null,
        product_text: fComp ? '' : fProductText.trim(),
        customer_id: fCustomer || null,
        quote_id: fQuote || null,
        do_id: fDo || null,
        invoice_id: fInvoice || null,
        is_external: fExternal,
        // Warranty runs from the day it left us; the delivery knows when
        delivered_at: chosenDo?.delivered_at?.slice(0, 10) ?? chosenDo?.delivery_date?.slice(0, 10) ?? null,
        status: fDo ? 'delivered' : 'in_stock',
        notes: fNotes.trim(),
      }));
      const { error } = await supabase.from('30.4_serial_numbers').insert(rows);
      if (error) throw new Error(error.message);
      const skipped = clashes.size;
      flash(`${rows.length} serial${rows.length !== 1 ? 's' : ''} recorded${skipped ? ` · ${skipped} already registered, left alone` : ''}.`);
      setFPaste('');
      await load();
    } catch (e) {
      flash(`Could not record — ${e instanceof Error ? e.message : String(e)}`);
    } finally { setBusy(false); }
  }

  async function removeSerial(r: SerialRow) {
    if (!canEdit) return;
    if (!window.confirm(`Remove ${r.serial} from the register?\n\nThe unit's history goes with it. Service tickets that point at it keep the number as text.`)) return;
    const { error } = await supabase.from('30.4_serial_numbers').delete().eq('serial_id', r.serial_id);
    if (error) { flash(`Could not remove — ${error.message}`); return; }
    setOpenRow(null);
    flash(`${r.serial} removed.`);
    load();
  }

  // ── List: filter + sort ─────────────────────────────────────────────────
  const rows = useMemo(() => {
    const q = search.trim().toLowerCase();
    const qn = normSerial(search);
    const out = serials.filter((r) => {
      if (statusFilter && r.status !== statusFilter) return false;
      if (!q) return true;
      // A serial matches however it was typed; everything else matches as text
      if (qn && (r.serial_norm || normSerial(r.serial)).includes(qn)) return true;
      const t = traceOf(r);
      return [
        r.serial, productOf(r), custById.get(r.customer_id ?? '') ?? '',
        t.order ? displayDocNumber(t.order) : '', t.delivery?.do_number ?? '',
        t.invoice?.invoice_number ?? '', r.notes,
      ].join(' ').toLowerCase().includes(q);
    });
    const val = (r: SerialRow): string => {
      const t = traceOf(r);
      switch (sort.key) {
        case 'serial':   return r.serial_norm || normSerial(r.serial);
        case 'product':  return productOf(r).toLowerCase();
        case 'customer': return (custById.get(r.customer_id ?? '') ?? '').toLowerCase();
        case 'order':    return (t.order ? displayDocNumber(t.order) : '').toLowerCase();
        case 'delivery': return t.deliveredAt ?? '';
        case 'status':   return r.status;
        default:         return r.created_at ?? '';
      }
    };
    return out.sort((a, b) => val(a).localeCompare(val(b)) * sort.dir);
  }, [serials, search, statusFilter, sort, traceOf, productOf, custById]);

  const th = (key: SortKey, label: string, cls = '') => (
    <button onClick={() => setSort((s) => ({ key, dir: s.key === key ? (s.dir === 1 ? -1 : 1) : (key === 'created' || key === 'delivery' ? -1 : 1) }))}
      className={`text-left font-semibold uppercase tracking-widest text-[10px] hover:text-white transition-colors ${sort.key === key ? 'text-emerald-300' : 'text-slate-500'} ${cls}`}>
      {label}{sort.key === key ? (sort.dir === 1 ? ' ↑' : ' ↓') : ''}
    </button>
  );

  if (authLoading || !profile || !canView) {
    return (
      <div className="min-h-screen bg-chrome flex items-center justify-center">
        <div className="w-6 h-6 border-2 border-emerald-500/30 border-t-emerald-500 rounded-full animate-spin" />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-chrome text-slate-200 font-sans text-sm">
      <div className="border-b border-slate-800/60 bg-chrome/80 backdrop-blur-md sticky top-0 z-30">
        <div className="max-w-[1200px] 2xl:max-w-[1760px] mx-auto px-3 sm:px-4 md:px-6 py-4 flex items-center justify-between gap-4">
          <div className="flex items-center gap-3 min-w-0">
            <BrandMenu />
            <div className="min-w-0">
              <h1 className="text-lg md:text-xl font-extrabold text-white truncate">Serial Numbers</h1>
              <p className="text-[11px] text-slate-500">One row per unit — the order, invoice and delivery it went out on</p>
            </div>
          </div>
          <div className="flex items-center gap-2 flex-shrink-0">
            <Link href="/aftersales"
              className="px-3 py-1.5 rounded-xl border border-slate-700 text-slate-400 hover:text-emerald-300 hover:border-emerald-500/40 text-xs font-semibold whitespace-nowrap transition-colors">
              After Sales →
            </Link>
            {canEdit && (
              <button onClick={() => setShowForm((v) => !v)}
                className="px-3.5 py-1.5 rounded-xl bg-emerald-500/15 text-emerald-300 ring-1 ring-emerald-500/30 hover:bg-emerald-500/25 text-xs font-bold whitespace-nowrap transition-colors">
                {showForm ? 'Close' : '+ Record serials'}
              </button>
            )}
          </div>
        </div>
      </div>

      <main className="max-w-[1200px] 2xl:max-w-[1760px] mx-auto px-3 sm:px-4 md:px-6 py-6 space-y-5">
        {failed && (
          <div className="bg-red-500/10 border border-red-500/40 rounded-2xl p-4 text-sm">
            <span className="text-red-300 font-semibold">Could not read the register.</span>
            <span className="text-red-200/80 text-xs ml-2 font-mono">{failed}</span>
          </div>
        )}

        {/* ── Bulk entry ────────────────────────────────────────────────── */}
        {showForm && canEdit && (
          <div className="bg-slate-900/50 border border-emerald-500/20 rounded-2xl p-4 space-y-4">
            <div className="grid md:grid-cols-3 gap-3">
              <label className="block">
                <span className="text-[10px] font-semibold uppercase tracking-widest text-slate-500 block mb-1">Sales order</span>
                <select value={fQuote} onChange={(e) => setFQuote(e.target.value)} className={inp} disabled={fExternal}>
                  <option value="">— none (stock) —</option>
                  {orders.map((o) => (
                    <option key={o.quote_id} value={String(o.quote_id)}>
                      {displayDocNumber(o) || o.quote_id} · {custById.get(o.customer_id ?? '') ?? '—'}
                    </option>
                  ))}
                </select>
              </label>
              <label className="block">
                <span className="text-[10px] font-semibold uppercase tracking-widest text-slate-500 block mb-1">Delivery order</span>
                <select value={fDo} onChange={(e) => setFDo(e.target.value)} className={inp} disabled={!fQuote || fExternal}>
                  <option value="">{fQuote ? '— none —' : 'pick an order first'}</option>
                  {formDos.map((d) => (
                    <option key={d.do_id} value={String(d.do_id)}>{d.do_number || d.do_id} · {fmtDay(d.delivery_date)}</option>
                  ))}
                </select>
              </label>
              <label className="block">
                <span className="text-[10px] font-semibold uppercase tracking-widest text-slate-500 block mb-1">Invoice</span>
                <select value={fInvoice} onChange={(e) => setFInvoice(e.target.value)} className={inp} disabled={!fQuote || fExternal}>
                  <option value="">{fQuote ? '— none —' : 'pick an order first'}</option>
                  {formInvoices.map((i) => (
                    <option key={i.invoice_id} value={String(i.invoice_id)}>{i.invoice_number || i.invoice_id} · {fmtDay(i.issued_at)}</option>
                  ))}
                </select>
              </label>
            </div>

            <div className="grid md:grid-cols-3 gap-3">
              <label className="block">
                <span className="text-[10px] font-semibold uppercase tracking-widest text-slate-500 block mb-1">Product (catalog)</span>
                <select value={fComp} onChange={(e) => setFComp(e.target.value)} className={inp}>
                  <option value="">— not in the catalog —</option>
                  {comps
                    .filter((c) => (c.internal_description ?? '').trim())
                    .sort((a, b) => (a.internal_description ?? '').localeCompare(b.internal_description ?? ''))
                    .map((c) => <option key={c.component_id} value={c.component_id}>{c.internal_description}</option>)}
                </select>
              </label>
              <label className="block">
                <span className="text-[10px] font-semibold uppercase tracking-widest text-slate-500 block mb-1">
                  {fComp ? 'Product name (from catalog)' : 'Product name (free text)'}
                </span>
                <input value={fComp ? (compById.get(fComp)?.internal_description ?? '') : fProductText}
                  onChange={(e) => setFProductText(e.target.value)} disabled={!!fComp}
                  placeholder="e.g. Other-brand 5kW inverter" className={inp} />
              </label>
              <label className="block">
                <span className="text-[10px] font-semibold uppercase tracking-widest text-slate-500 block mb-1">Customer</span>
                <select value={fCustomer} onChange={(e) => setFCustomer(e.target.value)} className={inp}>
                  <option value="">— none —</option>
                  {customers.map((c) => <option key={c.customer_id} value={c.customer_id}>{c.display_name || c.legal_name}</option>)}
                </select>
              </label>
            </div>

            <label className="flex items-center gap-2 text-xs text-slate-400 cursor-pointer w-fit">
              <input type="checkbox" checked={fExternal}
                onChange={(e) => { setFExternal(e.target.checked); if (e.target.checked) { setFQuote(''); setFDo(''); setFInvoice(''); } }}
                className="w-4 h-4 accent-amber-500" />
              The customer did not buy this from us
              <span className="text-slate-600">— no order of ours, and no warranty of ours</span>
            </label>

            <label className="block">
              <span className="text-[10px] font-semibold uppercase tracking-widest text-slate-500 block mb-1">
                Serial numbers — paste the whole column
              </span>
              <textarea value={fPaste} onChange={(e) => setFPaste(e.target.value)} rows={6}
                placeholder={'SN-0001\nSN-0002\nSN-0003'}
                className={`${inp} font-mono resize-y`} />
            </label>

            {/* What the paste WOULD do, before anything is written */}
            {(batch.serials.length > 0 || batch.rejected.length > 0) && (
              <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 text-[11px]">
                <span className="text-emerald-300 font-semibold">{willWrite.length} to record</span>
                {clashes.size > 0 && (
                  <span className="text-amber-300" title={[...clashes.keys()].join(', ')}>
                    {clashes.size} already registered — will be left alone
                  </span>
                )}
                {batch.repeated.length > 0 && (
                  <span className="text-slate-400" title={batch.repeated.map((r) => `${r.serial} ×${r.times}`).join(', ')}>
                    {batch.repeated.length} repeated in the paste — counted once
                  </span>
                )}
                {batch.rejected.length > 0 && (
                  <span className="text-slate-500" title={batch.rejected.join(', ')}>
                    {batch.rejected.length} skipped (no letters or digits)
                  </span>
                )}
              </div>
            )}

            <div className="flex flex-wrap items-center gap-2">
              <input value={fNotes} onChange={(e) => setFNotes(e.target.value)} placeholder="Note on this batch (optional)"
                className={`${inp} flex-1 min-w-[200px]`} />
              <button onClick={resetForm} className="px-3 py-2 rounded-xl bg-slate-800 text-slate-300 hover:bg-slate-700 text-xs font-semibold transition-colors">
                Clear
              </button>
              <button onClick={saveBatch} disabled={busy || willWrite.length === 0}
                className="px-4 py-2 rounded-xl bg-emerald-500/90 hover:bg-emerald-400 text-slate-950 text-xs font-bold disabled:opacity-40 transition-colors">
                {busy ? 'Recording…' : `Record ${willWrite.length || ''} serial${willWrite.length !== 1 ? 's' : ''}`}
              </button>
            </div>
          </div>
        )}

        {/* ── Filters ───────────────────────────────────────────────────── */}
        <div className="flex flex-wrap items-center gap-2">
          <input value={search} onChange={(e) => setSearch(e.target.value)}
            placeholder="Serial, product, customer, order, DO or invoice…"
            className={`${inp} flex-1 min-w-[220px] max-w-lg`} />
          <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} className={`${inp} w-auto`}>
            <option value="">All statuses</option>
            {Object.entries(SERIAL_STATUS).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
          </select>
          <span className="text-[11px] text-slate-500 ml-auto tabular-nums">
            {rows.length} of {serials.length} unit{serials.length !== 1 ? 's' : ''}
          </span>
        </div>

        {/* ── Register ──────────────────────────────────────────────────── */}
        <div className="bg-slate-900/40 border border-slate-800/80 rounded-2xl overflow-hidden">
          <div className="hidden lg:grid grid-cols-[190px_1fr_150px_130px_120px_110px] gap-3 px-4 py-2.5 border-b border-slate-800 bg-chrome">
            {th('serial', 'Serial')}{th('product', 'Product')}{th('customer', 'Customer')}
            {th('order', 'Order')}{th('delivery', 'Delivered')}{th('status', 'Status')}
          </div>
          {loading ? (
            <div className="p-4 space-y-1.5">{[...Array(6)].map((_, i) => <div key={i} className="h-11 bg-slate-800/40 rounded-xl animate-pulse" />)}</div>
          ) : rows.length === 0 ? (
            <div className="px-4 py-12 text-center">
              <p className="text-slate-400 font-semibold">{serials.length === 0 ? 'No serial numbers recorded yet.' : 'Nothing matches that search.'}</p>
              <p className="text-[11px] text-slate-600 mt-1">
                {serials.length === 0
                  ? 'Record the units on a delivery and after-sales can find the order from a label.'
                  : 'A serial matches however it is typed — dashes and spaces are ignored.'}
              </p>
            </div>
          ) : (
            <div className="divide-y divide-slate-800/60">
              {rows.map((r) => {
                const t = traceOf(r);
                const st = SERIAL_STATUS[r.status] ?? SERIAL_STATUS.in_stock;
                const isOpen = openRow === r.serial_id;
                return (
                  <div key={r.serial_id}>
                    <button onClick={() => setOpenRow(isOpen ? null : r.serial_id)}
                      className="w-full text-left px-4 py-2.5 hover:bg-white/[0.03] transition-colors lg:grid lg:grid-cols-[190px_1fr_150px_130px_120px_110px] lg:gap-3 lg:items-center">
                      <span className="font-mono text-xs text-emerald-300 truncate">{r.serial}</span>
                      <span className="text-xs text-slate-300 truncate block lg:inline">
                        {productOf(r)}
                        {r.is_external && <span className="ml-2 text-[9px] font-bold uppercase tracking-widest px-1.5 py-0.5 rounded bg-amber-500/15 text-amber-300">not ours</span>}
                      </span>
                      <span className="hidden lg:block text-[11px] text-slate-400 truncate">{custById.get(r.customer_id ?? '') ?? '—'}</span>
                      <span className="hidden lg:block text-[11px] text-sky-300 truncate">{t.order ? displayDocNumber(t.order) : '—'}</span>
                      <span className="hidden lg:block text-[11px] text-slate-500 tabular-nums">{t.deliveredAt ? fmtDay(t.deliveredAt) : '—'}</span>
                      <span className="hidden lg:block">
                        <span className={`text-[9px] font-bold uppercase tracking-widest px-1.5 py-0.5 rounded ${st.cls}`}>{st.label}</span>
                      </span>
                      {/* Phone: the same facts, stacked */}
                      <span className="lg:hidden block text-[11px] text-slate-500 mt-0.5 truncate">
                        {[custById.get(r.customer_id ?? ''), t.order ? displayDocNumber(t.order) : '', st.label].filter(Boolean).join(' · ')}
                      </span>
                    </button>

                    {isOpen && (
                      <div className="px-4 py-3 bg-slate-900/60 border-t border-slate-800/60 space-y-3">
                        <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-3 text-[11px]">
                          <Fact label="Sales order" value={t.order ? displayDocNumber(t.order) : '—'}
                            href={t.order ? `/sales/${t.order.quote_id}` : undefined} />
                          <Fact label="Invoice" value={t.invoice?.invoice_number ?? '—'} href={t.invoice ? '/invoices' : undefined} />
                          <Fact label="Delivery order" value={t.delivery?.do_number ?? '—'} href={t.delivery ? '/delivery' : undefined} />
                          <Fact label="Customer" value={custById.get(t.customerId ?? '') ?? '—'} href={t.customerId ? '/customers' : undefined} />
                        </div>
                        {t.external && (
                          <p className="text-[11px] text-amber-300/90">
                            No sale of ours carries this unit — service on it is out of warranty unless someone says otherwise.
                          </p>
                        )}
                        {r.notes && <p className="text-[11px] text-slate-400">{r.notes}</p>}
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="text-[10px] text-slate-600">
                            recorded {fmtDay(r.created_at)}{r.created_by_email ? ` by ${r.created_by_email.split('@')[0]}` : ''}
                          </span>
                          {/* The next step from a unit is almost always a ticket about it */}
                          <Link href={`/aftersales?serial=${encodeURIComponent(r.serial)}`}
                            className="ml-auto text-[11px] px-2.5 py-1.5 rounded-lg bg-emerald-500/15 text-emerald-300 ring-1 ring-emerald-500/30 hover:bg-emerald-500/25 font-semibold transition-colors">
                            Open a service ticket →
                          </Link>
                          {canEdit && (
                            <button onClick={() => removeSerial(r)}
                              className="text-[11px] px-2.5 py-1.5 rounded-lg border border-slate-700 text-slate-500 hover:text-red-300 hover:border-red-500/40 font-semibold transition-colors">
                              Remove
                            </button>
                          )}
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </main>

      {toast && (
        <div className="fixed bottom-5 left-1/2 -translate-x-1/2 z-[130] px-4 py-2.5 bg-slate-800 border border-slate-700 text-white text-xs font-semibold rounded-xl shadow-2xl max-w-[92vw] text-center">
          {toast}
        </div>
      )}
    </div>
  );
}

function Fact({ label, value, href }: { label: string; value: string; href?: string }) {
  return (
    <div>
      <p className="text-[10px] font-semibold uppercase tracking-widest text-slate-600">{label}</p>
      {href && value !== '—'
        ? <Link href={href} className="text-sky-300 hover:text-sky-200 transition-colors">{value}</Link>
        : <p className="text-slate-300">{value}</p>}
    </div>
  );
}

export default function Page() {
  return (
    <Suspense fallback={<div className="min-h-screen bg-chrome" />}>
      <SerialsPage />
    </Suspense>
  );
}
