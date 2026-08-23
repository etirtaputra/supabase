'use client';
/**
 * ICAPROC — Serial Numbers (30.4): the master list of individual units.
 *
 * The register answers two questions about any unit we have ever held: what is
 * it, and is it still ours — and if not, which sales order took it.
 *
 * The warehouse's actual motion, in the admin's own words: pick the product,
 * then scan. A barcode gun is a keyboard that types a serial and presses
 * Enter, so the scan box takes one unit per Enter, clears itself, keeps focus
 * and never asks for a mouse. The list builds up in front of the person
 * scanning, each line saying whether it is new, already registered, or the
 * same label read twice.
 *
 * Attaching to paperwork is DELIBERATELY a separate job. Units are scanned
 * into stock when they arrive; the sales order comes later, when they go out.
 * Tick the units, pick the order, attach — and the register changes from "in
 * stock" to allocated or out, which is exactly the tag the list is for.
 */
import { useState, useEffect, useMemo, useCallback, useRef, Suspense } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { createSupabaseClient } from '@/lib/supabase';
import { useAuth } from '@/hooks/useAuth';
import { useT } from '@/hooks/useT';
import { ROLE_PERMISSIONS } from '@/constants/roles';
import { canOpenPath } from '@/constants/navigation';
import BrandMenu from '@/components/ui/BrandMenu';
import { fmtDay, fmtInt } from '@/lib/formatters';
import { displayDocNumber } from '@/lib/salesStatus';
import {
  fetchSerials, parseSerialBatch, findExisting, traceSerial, normSerial, SERIAL_STATUS,
  type SerialRow, type SerialSalesDoc, type SerialDo, type SerialInvoice,
} from '@/lib/serials';

interface Comp { component_id: string; internal_description: string | null; supplier_model: string | null; unit: string | null }
interface Cust { customer_id: string; display_name: string; legal_name: string }

type SortKey = 'serial' | 'product' | 'status' | 'order' | 'customer' | 'delivery' | 'created';

const inp = 'w-full px-3 py-2 bg-slate-800/70 border border-slate-700 rounded-lg text-white text-sm placeholder-slate-600 focus:outline-none focus:ring-2 focus:ring-emerald-500/40 focus:border-emerald-500/50';

function SerialsPage() {
  const supabase = createSupabaseClient();
  const router = useRouter();
  const params = useSearchParams();
  const { user, profile, loading: authLoading } = useAuth();
  const { t } = useT();
  const perms = profile ? ROLE_PERMISSIONS[profile.role] : null;
  const canView = !!perms && canOpenPath(perms, '/serials');
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

  // ── Entry ───────────────────────────────────────────────────────────────
  const [showForm, setShowForm] = useState(false);
  const [entry, setEntry] = useState<'scan' | 'paste'>('scan');
  const [fComp, setFComp] = useState('');
  const [fProductText, setFProductText] = useState('');
  const [fExternal, setFExternal] = useState(false);
  const [fNotes, setFNotes] = useState('');
  /** Units scanned in this sitting, newest first — what the person is watching. */
  const [scanned, setScanned] = useState<string[]>([]);
  const [scanBox, setScanBox] = useState('');
  const [fPaste, setFPaste] = useState('');
  const [showAttachOnEntry, setShowAttachOnEntry] = useState(false);
  const [fQuote, setFQuote] = useState('');
  const [fDo, setFDo] = useState('');
  const [fInvoice, setFInvoice] = useState('');
  const [fCustomer, setFCustomer] = useState('');
  const [busy, setBusy] = useState(false);
  const scanRef = useRef<HTMLInputElement>(null);

  // ── List ────────────────────────────────────────────────────────────────
  const [search, setSearch] = useState(params.get('q') ?? '');
  const [statusFilter, setStatusFilter] = useState('');
  const [sort, setSort] = useState<{ key: SortKey; dir: 1 | -1 }>({ key: 'created', dir: -1 });
  const [openRow, setOpenRow] = useState<string | null>(null);
  const [ticked, setTicked] = useState<Set<string>>(new Set());
  // The bulk attach bar's own pickers
  const [bQuote, setBQuote] = useState('');
  const [bDo, setBDo] = useState('');
  const [bInvoice, setBInvoice] = useState('');

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
      setFailed(e instanceof Error ? e.message : String(e));
    } finally { setLoading(false); }
  }, [supabase]);

  useEffect(() => { if (canView) load(); }, [canView, load]);

  const compById = useMemo(() => new Map(comps.map((c) => [c.component_id, c])), [comps]);
  const custById = useMemo(() => new Map(customers.map((c) => [c.customer_id, c.display_name || c.legal_name])), [customers]);
  const orderById = useMemo(() => new Map(orders.map((o) => [String(o.quote_id), o])), [orders]);
  const doById = useMemo(() => new Map(dos.map((d) => [String(d.do_id), d])), [dos]);

  const productOf = useCallback((r: SerialRow): string => {
    if (r.component_id) {
      const c = compById.get(r.component_id);
      // Sell-side wording: the internal description, never the supplier model
      if (c) return c.internal_description || c.supplier_model || '—';
    }
    return r.product_text || '—';
  }, [compById]);

  const traceOf = useCallback((r: SerialRow) => traceSerial(r, orders, dos, invoices), [orders, dos, invoices]);

  const catalogOptions = useMemo(
    () => comps.filter((c) => (c.internal_description ?? '').trim())
      .sort((a, b) => (a.internal_description ?? '').localeCompare(b.internal_description ?? '')),
    [comps]);

  // ── What the batch would do ─────────────────────────────────────────────
  const batch = useMemo(
    () => (entry === 'scan' ? { serials: scanned, repeated: [], rejected: [] } : parseSerialBatch(fPaste)),
    [entry, scanned, fPaste]);
  const clashes = useMemo(() => findExisting(batch.serials, fComp || null, serials), [batch.serials, fComp, serials]);
  const willWrite = batch.serials.filter((s) => !clashes.has(s));

  const entryDos = useMemo(() => (fQuote ? dos.filter((d) => String(d.quote_id) === fQuote) : []), [dos, fQuote]);
  const entryInvoices = useMemo(() => (fQuote ? invoices.filter((i) => String(i.quote_id) === fQuote) : []), [invoices, fQuote]);
  const bulkDos = useMemo(() => (bQuote ? dos.filter((d) => String(d.quote_id) === bQuote) : []), [dos, bQuote]);
  const bulkInvoices = useMemo(() => (bQuote ? invoices.filter((i) => String(i.quote_id) === bQuote) : []), [invoices, bQuote]);

  useEffect(() => {
    if (!fQuote) return;
    const o = orderById.get(fQuote);
    if (o?.customer_id) setFCustomer(String(o.customer_id));
  }, [fQuote, orderById]);

  /** One scan = one unit. The gun types the serial and presses Enter. */
  const acceptScan = (raw: string) => {
    const s = raw.trim();
    setScanBox('');
    if (!s || !normSerial(s)) return;
    setScanned((list) => {
      // The same label read twice in one sitting is a slip, not a second unit
      if (list.some((x) => normSerial(x) === normSerial(s))) {
        flash(`${s} was already scanned in this batch.`);
        return list;
      }
      return [s, ...list];
    });
  };

  const resetForm = () => {
    setFComp(''); setFProductText(''); setFExternal(false); setFNotes('');
    setScanned([]); setScanBox(''); setFPaste('');
    setShowAttachOnEntry(false); setFQuote(''); setFDo(''); setFInvoice(''); setFCustomer('');
  };

  async function saveBatch() {
    if (!canEdit || busy) return;
    if (!fComp && !fProductText.trim()) { flash('Pick the product first — that is what the scans belong to.'); return; }
    if (willWrite.length === 0) {
      flash(batch.serials.length === 0 ? 'Nothing scanned yet.' : 'Every serial here is already in the register.');
      return;
    }
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
        delivered_at: chosenDo?.delivered_at?.slice(0, 10) ?? chosenDo?.delivery_date?.slice(0, 10) ?? null,
        notes: fNotes.trim(),
      }));
      const { error } = await supabase.from('30.4_serial_numbers').insert(rows);
      if (error) throw new Error(error.message);
      const skipped = clashes.size;
      flash(`${rows.length} unit${rows.length !== 1 ? 's' : ''} recorded${skipped ? ` · ${skipped} already registered, left alone` : ''}.`);
      setScanned([]); setFPaste('');
      scanRef.current?.focus();
      await load();
    } catch (e) {
      flash(`Could not record — ${e instanceof Error ? e.message : String(e)}`);
    } finally { setBusy(false); }
  }

  /** Attach ticked units to an order — the step that happens when they go out. */
  async function attachTicked() {
    if (!canEdit || busy || ticked.size === 0 || !bQuote) return;
    const chosenDo = bDo ? doById.get(bDo) : null;
    const order = orderById.get(bQuote);
    const going = chosenDo ? 'out' : 'allocated to';
    if (!window.confirm(`Attach ${ticked.size} unit${ticked.size !== 1 ? 's' : ''} to ${order ? displayDocNumber(order) : 'this order'}?\n\nThey will be marked ${going} that order in the register.`)) return;
    setBusy(true);
    try {
      const { error } = await supabase.from('30.4_serial_numbers').update({
        quote_id: bQuote,
        do_id: bDo || null,
        invoice_id: bInvoice || null,
        customer_id: order?.customer_id ?? null,
        delivered_at: chosenDo?.delivered_at?.slice(0, 10) ?? chosenDo?.delivery_date?.slice(0, 10) ?? null,
      }).in('serial_id', [...ticked]);
      if (error) throw new Error(error.message);
      flash(`${ticked.size} unit${ticked.size !== 1 ? 's' : ''} attached to ${order ? displayDocNumber(order) : 'the order'}.`);
      setTicked(new Set()); setBQuote(''); setBDo(''); setBInvoice('');
      await load();
    } catch (e) {
      flash(`Could not attach — ${e instanceof Error ? e.message : String(e)}`);
    } finally { setBusy(false); }
  }

  /** Put units back on the shelf — an attachment made by mistake. */
  async function releaseTicked() {
    if (!canEdit || busy || ticked.size === 0) return;
    if (!window.confirm(`Release ${ticked.size} unit${ticked.size !== 1 ? 's' : ''} back to stock?\n\nTheir order, invoice and delivery links are cleared.`)) return;
    setBusy(true);
    try {
      const { error } = await supabase.from('30.4_serial_numbers').update({
        quote_id: null, do_id: null, invoice_id: null, customer_id: null, delivered_at: null, status: 'in_stock',
      }).in('serial_id', [...ticked]);
      if (error) throw new Error(error.message);
      flash(`${ticked.size} unit${ticked.size !== 1 ? 's' : ''} back in stock.`);
      setTicked(new Set());
      await load();
    } catch (e) {
      flash(`Could not release — ${e instanceof Error ? e.message : String(e)}`);
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
      if (qn && (r.serial_norm || normSerial(r.serial)).includes(qn)) return true;
      const trace = traceOf(r);
      return [
        r.serial, productOf(r), custById.get(r.customer_id ?? '') ?? '',
        trace.order ? displayDocNumber(trace.order) : '', trace.delivery?.do_number ?? '',
        trace.invoice?.invoice_number ?? '', r.notes,
      ].join(' ').toLowerCase().includes(q);
    });
    const val = (r: SerialRow): string => {
      const trace = traceOf(r);
      switch (sort.key) {
        case 'serial':   return r.serial_norm || normSerial(r.serial);
        case 'product':  return productOf(r).toLowerCase();
        case 'status':   return r.status;
        case 'order':    return (trace.order ? displayDocNumber(trace.order) : '').toLowerCase();
        case 'customer': return (custById.get(r.customer_id ?? '') ?? '').toLowerCase();
        case 'delivery': return trace.deliveredAt ?? '';
        default:         return r.created_at ?? '';
      }
    };
    return out.sort((a, b) => val(a).localeCompare(val(b)) * sort.dir);
  }, [serials, search, statusFilter, sort, traceOf, productOf, custById]);

  const counts = useMemo(() => {
    const m = new Map<string, number>();
    for (const r of serials) m.set(r.status, (m.get(r.status) ?? 0) + 1);
    return m;
  }, [serials]);

  const th = (key: SortKey, label: string) => (
    <button onClick={() => setSort((s) => ({ key, dir: s.key === key ? (s.dir === 1 ? -1 : 1) : (key === 'created' || key === 'delivery' ? -1 : 1) }))}
      className={`text-left font-semibold uppercase tracking-widest text-[10px] hover:text-white transition-colors ${sort.key === key ? 'text-emerald-300' : 'text-slate-500'}`}>
      {label}{sort.key === key ? (sort.dir === 1 ? ' ↑' : ' ↓') : ''}
    </button>
  );

  const toggleTick = (id: string) => setTicked((s) => {
    const n = new Set(s);
    if (n.has(id)) n.delete(id); else n.add(id);
    return n;
  });

  if (authLoading || !profile || !canView) {
    return (
      <div className="min-h-screen bg-chrome flex items-center justify-center">
        <div className="w-6 h-6 border-2 border-emerald-500/30 border-t-emerald-500 rounded-full animate-spin" />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-chrome text-slate-200 font-sans text-sm">
      {/* BrandMenu IS the header — wordmark, nav and search in one bar. The page
          names itself through `subtitle`; a second heading beside it would land
          on top of the nav. Actions sit as its sibling, as on Stock and
          Customers. */}
      <div className="border-b border-slate-800/60 bg-chrome/80 backdrop-blur-md sticky top-0 z-30">
        <div className="max-w-[1200px] 2xl:max-w-[1760px] mx-auto px-3 sm:px-4 md:px-6 py-2.5 sm:py-3 flex flex-col sm:flex-row sm:items-center justify-between sm:flex-wrap gap-2.5 sm:gap-x-4 sm:gap-y-2.5">
          <BrandMenu wordmarkClass="text-xl md:text-2xl font-extrabold" subtitle={t("Serial Numbers · Unit register")} />
          <div className="flex items-center gap-2 flex-wrap">
            <Link href="/aftersales"
              className="hidden sm:block px-3 py-1.5 rounded-xl border border-slate-700 text-slate-400 hover:text-emerald-300 hover:border-emerald-500/40 text-xs font-semibold whitespace-nowrap transition-colors">
              After Sales →
            </Link>
            {canEdit && (
              <button onClick={() => { setShowForm((v) => !v); setTimeout(() => scanRef.current?.focus(), 50); }}
                className="px-3.5 py-1.5 rounded-xl bg-emerald-500/15 text-emerald-300 ring-1 ring-emerald-500/30 hover:bg-emerald-500/25 text-xs font-bold whitespace-nowrap transition-colors">
                {showForm ? 'Close' : '+ Record units'}
              </button>
            )}
          </div>
        </div>
      </div>

      <main className="max-w-[1200px] 2xl:max-w-[1760px] mx-auto px-3 sm:px-4 md:px-6 py-4 sm:py-5 space-y-5">
        {failed && (
          <div className="bg-red-500/10 border border-red-500/40 rounded-2xl p-4 text-sm">
            <span className="text-red-300 font-semibold">{t('Could not read the register.')}</span>
            <span className="text-red-200/80 text-xs ml-2 font-mono">{failed}</span>
          </div>
        )}

        {/* ── Record: product first, then scan ──────────────────────────── */}
        {showForm && canEdit && (
          <div className="bg-slate-900/50 border border-emerald-500/20 rounded-2xl p-4 space-y-4">
            {/* 1 — what are we scanning? */}
            <div className="grid md:grid-cols-[2fr_1fr] gap-3">
              <label className="block">
                <span className="text-[10px] font-semibold uppercase tracking-widest text-emerald-400/80 block mb-1">{t('1 · Product')}</span>
                <select value={fComp} onChange={(e) => { setFComp(e.target.value); setTimeout(() => scanRef.current?.focus(), 30); }} className={inp}>
                  <option value="">{t('— pick the product being scanned —')}</option>
                  {catalogOptions.map((c) => <option key={c.component_id} value={c.component_id}>{c.internal_description}</option>)}
                </select>
              </label>
              <label className="block">
                <span className="text-[10px] font-semibold uppercase tracking-widest text-slate-500 block mb-1">
                  {fComp ? 'From the catalog' : 'Or name it (not in the catalog)'}
                </span>
                <input value={fComp ? (compById.get(fComp)?.internal_description ?? '') : fProductText}
                  onChange={(e) => setFProductText(e.target.value)} disabled={!!fComp}
                  placeholder="e.g. Other-brand 5kW inverter" className={inp} />
              </label>
            </div>

            {/* 2 — the scan gun */}
            <div>
              <div className="flex items-center justify-between gap-3 mb-1">
                <span className="text-[10px] font-semibold uppercase tracking-widest text-emerald-400/80">{t('2 · Scan')}</span>
                <div className="flex items-center rounded-lg border border-slate-700/80 overflow-hidden">
                  {(['scan', 'paste'] as const).map((m) => (
                    <button key={m} onClick={() => { setEntry(m); if (m === 'scan') setTimeout(() => scanRef.current?.focus(), 30); }}
                      className={`text-[11px] px-2.5 py-1 font-semibold transition-colors ${entry === m ? 'bg-emerald-500/15 text-emerald-300' : 'text-slate-500 hover:text-slate-300'}`}>
                      {m === 'scan' ? 'Barcode gun' : 'Paste a list'}
                    </button>
                  ))}
                </div>
              </div>

              {entry === 'scan' ? (
                <>
                  <input ref={scanRef} value={scanBox} disabled={!fComp && !fProductText.trim()}
                    onChange={(e) => setScanBox(e.target.value)}
                    onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); acceptScan(scanBox); } }}
                    onBlur={() => { if (scanBox.trim()) acceptScan(scanBox); }}
                    placeholder={fComp || fProductText.trim() ? 'Scan a unit — the gun presses Enter for you' : 'Pick the product first'}
                    className={`${inp} font-mono text-base py-3`} autoComplete="off" />
                  <p className="text-[10px] text-slate-600 mt-1">
                    The box stays focused after every scan. Keep going until the pallet is done, then record them all at once.
                  </p>

                  {scanned.length > 0 && (
                    <div className="mt-2.5 max-h-64 overflow-y-auto rounded-xl border border-slate-800 divide-y divide-slate-800/60">
                      {scanned.map((s, i) => {
                        const known = clashes.get(s);
                        return (
                          <div key={s} className="flex items-center gap-2 px-3 py-1.5 text-xs">
                            <span className="w-8 text-right text-slate-600 tabular-nums">{scanned.length - i}</span>
                            <span className="font-mono text-slate-200 truncate">{s}</span>
                            {known && (
                              <span className="text-[10px] text-amber-300" title={t("This unit is already in the register — it will be left alone")}>
                                already registered
                              </span>
                            )}
                            <button onClick={() => setScanned((l) => l.filter((x) => x !== s))}
                              className="ml-auto text-slate-600 hover:text-red-300 transition-colors" title={t("Remove this scan")}>✕</button>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </>
              ) : (
                <textarea value={fPaste} onChange={(e) => setFPaste(e.target.value)} rows={6}
                  placeholder={'SN-0001\nSN-0002\nSN-0003'} className={`${inp} font-mono resize-y`} />
              )}
            </div>

            {/* What the batch would do */}
            {(batch.serials.length > 0 || batch.rejected.length > 0) && (
              <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 text-[11px]">
                <span className="text-emerald-300 font-semibold">{willWrite.length} to record</span>
                {clashes.size > 0 && <span className="text-amber-300" title={[...clashes.keys()].join(', ')}>{clashes.size} already registered — left alone</span>}
                {batch.repeated.length > 0 && <span className="text-slate-400">{batch.repeated.length} repeated in the paste — counted once</span>}
                {batch.rejected.length > 0 && <span className="text-slate-500">{batch.rejected.length} skipped (no letters or digits)</span>}
              </div>
            )}

            {/* 3 — paperwork, optional and later */}
            <div>
              <button onClick={() => setShowAttachOnEntry((v) => !v)}
                className="text-[11px] text-slate-500 hover:text-slate-300 transition-colors">
                {showAttachOnEntry ? '▾' : '▸'} 3 · Attach to an order now (optional — normally done later, when they ship)
              </button>
              {showAttachOnEntry && (
                <div className="grid md:grid-cols-4 gap-3 mt-2">
                  <label className="block">
                    <span className="text-[10px] font-semibold uppercase tracking-widest text-slate-500 block mb-1">{t('Sales order')}</span>
                    <select value={fQuote} onChange={(e) => { setFQuote(e.target.value); setFDo(''); setFInvoice(''); }} className={inp} disabled={fExternal}>
                      <option value="">{t('— none (into stock) —')}</option>
                      {orders.map((o) => (
                        <option key={o.quote_id} value={String(o.quote_id)}>{displayDocNumber(o) || o.quote_id} · {custById.get(o.customer_id ?? '') ?? '—'}</option>
                      ))}
                    </select>
                  </label>
                  <label className="block">
                    <span className="text-[10px] font-semibold uppercase tracking-widest text-slate-500 block mb-1">{t('Delivery order')}</span>
                    <select value={fDo} onChange={(e) => setFDo(e.target.value)} className={inp} disabled={!fQuote}>
                      <option value="">{fQuote ? '— none —' : 'pick an order first'}</option>
                      {entryDos.map((d) => <option key={d.do_id} value={String(d.do_id)}>{d.do_number || d.do_id} · {fmtDay(d.delivery_date)}</option>)}
                    </select>
                  </label>
                  <label className="block">
                    <span className="text-[10px] font-semibold uppercase tracking-widest text-slate-500 block mb-1">{t('Invoice')}</span>
                    <select value={fInvoice} onChange={(e) => setFInvoice(e.target.value)} className={inp} disabled={!fQuote}>
                      <option value="">{fQuote ? '— none —' : 'pick an order first'}</option>
                      {entryInvoices.map((i) => <option key={i.invoice_id} value={String(i.invoice_id)}>{i.invoice_number || i.invoice_id}</option>)}
                    </select>
                  </label>
                  <label className="block">
                    <span className="text-[10px] font-semibold uppercase tracking-widest text-slate-500 block mb-1">{t('Customer')}</span>
                    <select value={fCustomer} onChange={(e) => setFCustomer(e.target.value)} className={inp}>
                      <option value="">{t('— none —')}</option>
                      {customers.map((c) => <option key={c.customer_id} value={c.customer_id}>{c.display_name || c.legal_name}</option>)}
                    </select>
                  </label>
                </div>
              )}
            </div>

            <label className="flex items-center gap-2 text-xs text-slate-400 cursor-pointer w-fit">
              <input type="checkbox" checked={fExternal}
                onChange={(e) => { setFExternal(e.target.checked); if (e.target.checked) { setFQuote(''); setFDo(''); setFInvoice(''); } }}
                className="w-4 h-4 accent-amber-500" />
              These are not ours — a customer&apos;s own units
            </label>

            <div className="flex flex-wrap items-center gap-2">
              <input value={fNotes} onChange={(e) => setFNotes(e.target.value)} placeholder={t('Note on this batch (optional)')}
                className={`${inp} flex-1 min-w-[200px]`} />
              <button onClick={resetForm} className="px-3 py-2 rounded-xl bg-slate-800 text-slate-300 hover:bg-slate-700 text-xs font-semibold transition-colors">{t('Clear')}</button>
              <button onClick={saveBatch} disabled={busy || willWrite.length === 0}
                className="px-4 py-2 rounded-xl bg-emerald-500/90 hover:bg-emerald-400 text-slate-950 text-xs font-bold disabled:opacity-40 transition-colors">
                {busy ? 'Recording…' : `Record ${willWrite.length || ''} unit${willWrite.length !== 1 ? 's' : ''}`}
              </button>
            </div>
          </div>
        )}

        {/* ── Filters ───────────────────────────────────────────────────── */}
        <div className="flex flex-wrap items-center gap-2">
          <input value={search} onChange={(e) => setSearch(e.target.value)}
            placeholder={t('Scan or type a serial, or search product, customer, order…')}
            className={`${inp} flex-1 min-w-[220px] max-w-lg font-mono`} />
          <div className="flex flex-wrap items-center gap-1.5">
            <button onClick={() => setStatusFilter('')}
              className={`text-[11px] px-2.5 py-1.5 rounded-lg border transition-colors ${!statusFilter ? 'bg-emerald-500/15 border-emerald-500/40 text-emerald-300 font-bold' : 'border-slate-700/80 text-slate-500 hover:text-slate-300'}`}>
              All {serials.length}
            </button>
            {Object.entries(SERIAL_STATUS).map(([k, v]) => (counts.get(k) ? (
              <button key={k} onClick={() => setStatusFilter(statusFilter === k ? '' : k)}
                className={`text-[11px] px-2.5 py-1.5 rounded-lg border transition-colors ${statusFilter === k ? 'bg-emerald-500/15 border-emerald-500/40 text-emerald-300 font-bold' : 'border-slate-700/80 text-slate-500 hover:text-slate-300'}`}>
                {v.label} {counts.get(k)}
              </button>
            ) : null))}
          </div>
          <span className="text-[11px] text-slate-500 ml-auto tabular-nums">{rows.length} shown</span>
        </div>

        {/* ── Bulk: attach the ticked units to an order ─────────────────── */}
        {canEdit && ticked.size > 0 && (
          <div className="bg-violet-500/[0.06] border border-violet-500/25 rounded-2xl px-4 py-3 flex flex-wrap items-center gap-2">
            <span className="text-[11px] font-bold text-violet-300 whitespace-nowrap">{ticked.size} ticked</span>
            <select value={bQuote} onChange={(e) => { setBQuote(e.target.value); setBDo(''); setBInvoice(''); }} className={`${inp} w-auto flex-1 min-w-[200px]`}>
              <option value="">{t('Attach to sales order…')}</option>
              {orders.map((o) => (
                <option key={o.quote_id} value={String(o.quote_id)}>{displayDocNumber(o) || o.quote_id} · {custById.get(o.customer_id ?? '') ?? '—'}</option>
              ))}
            </select>
            <select value={bDo} onChange={(e) => setBDo(e.target.value)} className={`${inp} w-auto`} disabled={!bQuote}>
              <option value="">{bQuote ? 'DO (marks them out)' : 'pick an order'}</option>
              {bulkDos.map((d) => <option key={d.do_id} value={String(d.do_id)}>{d.do_number || d.do_id}</option>)}
            </select>
            <select value={bInvoice} onChange={(e) => setBInvoice(e.target.value)} className={`${inp} w-auto`} disabled={!bQuote}>
              <option value="">{bQuote ? 'Invoice (optional)' : '—'}</option>
              {bulkInvoices.map((i) => <option key={i.invoice_id} value={String(i.invoice_id)}>{i.invoice_number || i.invoice_id}</option>)}
            </select>
            <button onClick={attachTicked} disabled={busy || !bQuote}
              className="px-3.5 py-2 rounded-xl bg-violet-500/90 hover:bg-violet-400 text-slate-950 text-xs font-bold disabled:opacity-40 transition-colors">
              Attach
            </button>
            <button onClick={releaseTicked} disabled={busy}
              className="px-3 py-2 rounded-xl border border-slate-700 text-slate-400 hover:text-amber-300 hover:border-amber-500/40 text-xs font-semibold transition-colors">
              Back to stock
            </button>
            <button onClick={() => setTicked(new Set())} className="text-[11px] text-slate-500 hover:text-white transition-colors">{t('clear')}</button>
          </div>
        )}

        {/* ── The master list ───────────────────────────────────────────── */}
        <div className="bg-slate-900/40 border border-slate-800/80 rounded-2xl overflow-hidden">
          <div className="hidden lg:grid grid-cols-[28px_180px_1fr_100px_130px_150px_110px] gap-3 px-4 py-2.5 border-b border-slate-800 bg-chrome items-center">
            {canEdit ? (
              <input type="checkbox" className="w-3.5 h-3.5 accent-emerald-500"
                checked={rows.length > 0 && rows.every((r) => ticked.has(r.serial_id))}
                onChange={(e) => setTicked(e.target.checked ? new Set(rows.map((r) => r.serial_id)) : new Set())}
                title={t("Tick everything shown")} />
            ) : <span />}
            {th('serial', 'Serial')}{th('product', 'Product')}{th('status', 'Status')}
            {th('order', 'Sales order')}{th('customer', 'Customer')}{th('delivery', 'Out on')}
          </div>
          {loading ? (
            <div className="p-4 space-y-1.5">{[...Array(6)].map((_, i) => <div key={i} className="h-11 bg-slate-800/40 rounded-xl animate-pulse" />)}</div>
          ) : rows.length === 0 ? (
            <div className="px-4 py-12 text-center">
              <p className="text-slate-400 font-semibold">{serials.length === 0 ? 'No units recorded yet.' : 'Nothing matches that search.'}</p>
              <p className="text-[11px] text-slate-600 mt-1">
                {serials.length === 0
                  ? 'Pick a product, scan the pallet, and every unit becomes findable by its label.'
                  : 'A serial matches however it is typed — dashes and spaces are ignored.'}
              </p>
            </div>
          ) : (
            <div className="divide-y divide-slate-800/60">
              {rows.map((r) => {
                const trace = traceOf(r);
                const st = SERIAL_STATUS[r.status] ?? SERIAL_STATUS.in_stock;
                const isOpen = openRow === r.serial_id;
                return (
                  <div key={r.serial_id}>
                    <div className="px-4 py-2.5 hover:bg-white/[0.03] transition-colors lg:grid lg:grid-cols-[28px_180px_1fr_100px_130px_150px_110px] lg:gap-3 lg:items-center">
                      {canEdit ? (
                        <input type="checkbox" className="w-3.5 h-3.5 accent-emerald-500 flex-shrink-0"
                          checked={ticked.has(r.serial_id)} onChange={() => toggleTick(r.serial_id)}
                          onClick={(e) => e.stopPropagation()} />
                      ) : <span />}
                      <button onClick={() => setOpenRow(isOpen ? null : r.serial_id)} className="text-left font-mono text-xs text-emerald-300 truncate">
                        {r.serial}
                      </button>
                      <button onClick={() => setOpenRow(isOpen ? null : r.serial_id)} className="text-left text-xs text-slate-300 truncate block w-full">
                        {productOf(r)}
                        {r.is_external && <span className="ml-2 text-[9px] font-bold uppercase tracking-widest px-1.5 py-0.5 rounded bg-amber-500/15 text-amber-300">{t('not ours')}</span>}
                      </button>
                      <span className="hidden lg:block">
                        <span className={`text-[9px] font-bold uppercase tracking-widest px-1.5 py-0.5 rounded ${st.cls}`}>{st.label}</span>
                      </span>
                      <span className="hidden lg:block text-[11px] text-sky-300 font-mono truncate">{trace.order ? displayDocNumber(trace.order) : '—'}</span>
                      <span className="hidden lg:block text-[11px] text-slate-400 truncate">{custById.get(r.customer_id ?? '') ?? '—'}</span>
                      <span className="hidden lg:block text-[11px] text-slate-500 tabular-nums">{trace.deliveredAt ? fmtDay(trace.deliveredAt) : '—'}</span>
                      <span className="lg:hidden block text-[11px] text-slate-500 mt-0.5 truncate">
                        {[st.label, trace.order ? displayDocNumber(trace.order) : '', custById.get(r.customer_id ?? '')].filter(Boolean).join(' · ')}
                      </span>
                    </div>

                    {isOpen && (
                      <div className="px-4 py-3 bg-slate-900/60 border-trace border-slate-800/60 space-y-3">
                        <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-3 text-[11px]">
                          <Fact label="Sales order" value={trace.order ? displayDocNumber(trace.order) : '—'} href={trace.order ? `/sales/${trace.order.quote_id}` : undefined} />
                          <Fact label="Invoice" value={trace.invoice?.invoice_number ?? '—'} href={trace.invoice ? '/invoices' : undefined} />
                          <Fact label="Delivery order" value={trace.delivery?.do_number ?? '—'} href={trace.delivery ? '/delivery' : undefined} />
                          <Fact label="Customer" value={custById.get(trace.customerId ?? '') ?? '—'} href={trace.customerId ? '/customers' : undefined} />
                        </div>
                        {trace.external && (
                          <p className="text-[11px] text-amber-300/90">{t('No sale of ours carries this unit — service on it is out of warranty unless someone says otherwise.')}</p>
                        )}
                        {r.notes && <p className="text-[11px] text-slate-400">{r.notes}</p>}
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="text-[10px] text-slate-600">
                            recorded {fmtDay(r.created_at)}{r.created_by_email ? ` by ${r.created_by_email.split('@')[0]}` : ''}
                          </span>
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
