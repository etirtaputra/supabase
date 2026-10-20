'use client';
/**
 * Supplier Lead Times — how long each supplier really takes, quote to goods
 * fully in (owner, 2026-10-16). One row per supplier: the median of each stage
 * as a bar, the end-to-end PO → received figure, the record against the lead
 * time its quotes promised, and its open POs that are now late. Click a row
 * for every PO behind the numbers, each one a click from its Deal Lookup.
 *
 * Computed from rows ICAPROC already holds (lib/supplierLeadTimes.ts); nothing
 * is stored. Same door as Suppliers (buy side). `?supplier=<id>` opens that
 * supplier's row — the dashboard card links each of its suppliers here.
 *
 * By product (owner, 2026-10-20): the same POs, grouped by the items on their
 * lines — how long THIS item takes, from whom, by sea or by air.
 * `?view=product` opens that view, `?item=<componentId>` opens one item's row
 * (the item hub links here).
 */
import React, { Suspense, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { useAuth } from '@/hooks/useAuth';
import { useSupabaseData } from '@/hooks/useSupabaseData';
import { usePageTitle } from '@/hooks/usePageTitle';
import { useT } from '@/hooks/useT';
import { createSupabaseClient } from '@/lib/supabase';
import { fetchAllRows } from '@/lib/fetchAllRows';
import { ROLE_PERMISSIONS } from '@/constants/roles';
import { canOpenPath } from '@/constants/navigation';
import { BAR_INPUT, BAR_SELECT, BAR_BTN, BAR_BTN_OFF, BAR_BTN_ON_SKY } from '@/constants/controls';
import { LIGHT_THEMES } from '@/lib/theme';
import { fmtDay } from '@/lib/formatters';
import BrandMenu from '@/components/ui/BrandMenu';
import { supplierLeadTimes, productLeadTimes, poTimelines, leadDigest, shipVia, SHIP_VIAS, type LtGrn, type LtPo, type PoTimeline, type ProductLead, type ShipVia, type Stage, type StageStats, type SupplierLead } from '@/lib/supplierLeadTimes';

/** "1 day", "12 days". */
const dayLabel = (t: (s: string) => string, tf: (s: string, v: Record<string, string | number>) => string, d: number) =>
  d === 1 ? t('1 day') : tf('{d} days', { d });

const lookupHref = (n: string) => `/purchasing?tab=lookup&q=${encodeURIComponent(n)}`;

/** The three stages the bar draws, in order — each a categorical slot, validated light and dark. */
const BAR_STAGES: { stage: Stage; label: string; cls: string }[] = [
  { stage: 'quoteToPo', label: 'Quote → PO', cls: 'lt-s1' },
  { stage: 'poToPay', label: 'PO → first payment', cls: 'lt-s2' },
  { stage: 'payToReceived', label: 'First payment → fully received', cls: 'lt-s3' },
];
const lightSel = (cls: string) => LIGHT_THEMES.map((th) => `html[data-theme="${th}"] .${cls}`).join(',');
const BAR_CSS = `.lt-s1{background:#3987e5}.lt-s2{background:#d95926}.lt-s3{background:#199e70}
${lightSel('lt-s1')}{background:#2a78d6}${lightSel('lt-s2')}{background:#eb6834}${lightSel('lt-s3')}{background:#1baf7a}`;

type Period = 'all' | '12' | '6';
type View = 'supplier' | 'product';
type ViaFilter = 'all' | ShipVia | 'none';
/** Shipping, as people say it — English, translated where shown. */
const VIA_LABEL: Record<ShipVia, string> = { Sea: 'Sea', Air: 'Air', Local: 'Local' };
const viaName = (v: ShipVia | null) => (v ? VIA_LABEL[v] : 'Not set');

export default function SupplierLeadTimesPage() {
  return <Suspense fallback={null}><LeadTimes /></Suspense>;
}

function LeadTimes() {
  const { t, tf } = useT();
  const router = useRouter();
  const { user, profile, loading: authLoading } = useAuth();
  const canView = !!profile && ROLE_PERMISSIONS[profile.role].buySide;
  const { data, loading } = useSupabaseData();
  usePageTitle();

  useEffect(() => {
    if (authLoading) return;
    if (!user) { router.replace(`/login?next=${encodeURIComponent('/suppliers/lead-times')}`); return; }
    if (profile && !canOpenPath(ROLE_PERMISSIONS[profile.role], '/suppliers/lead-times')) router.replace('/unauthorized');
  }, [authLoading, user, profile, router]);

  // Goods receipts are not in the shared data hook; they are only a fallback date here.
  const [grns, setGrns] = useState<LtGrn[]>([]);
  useEffect(() => {
    if (!canView) return;
    const supabase = createSupabaseClient();
    fetchAllRows<LtGrn>((f, to) => supabase.from('30.2_goods_receipts').select('po_id, received_at').order('grn_id').range(f, to))
      .then((r) => setGrns(r.rows ?? []));
  }, [canView]);

  const [search, setSearch] = useState('');
  const [period, setPeriod] = useState<Period>('all');
  const [via, setVia] = useState<ViaFilter>('all');
  const params = useSearchParams();
  const linked = params.get('supplier');
  const linkedItem = params.get('item');
  const [view, setView] = useState<View>(linkedItem || params.get('view') === 'product' ? 'product' : 'supplier');
  const [open, setOpen] = useState<string | null>(linked);
  const [openItem, setOpenItem] = useState<string | null>(linkedItem);

  const today = new Date().toISOString().slice(0, 10);
  const supplierById = useMemo(() => new Map(data.suppliers.map((s) => [s.supplier_id, s])), [data.suppliers]);

  const ltInput = useMemo(() => {
    const since = period === 'all' ? null : (() => { const d = new Date(); d.setMonth(d.getMonth() - Number(period)); return d.toISOString().slice(0, 10); })();
    const pos: LtPo[] = data.pos
      .filter((p) => !since || (p.po_date ?? '') >= since)
      .filter((p) => via === 'all' || (via === 'none' ? !shipVia(p.method_of_shipment) : shipVia(p.method_of_shipment) === via))
      .map((p) => ({
        po_id: p.po_id, po_number: p.po_number, status: p.status ?? null, po_date: p.po_date ?? null, quote_id: p.quote_id ?? null,
        supplier_id: p.supplier_id ?? null, actual_received_date: p.actual_received_date ?? null, currency: p.currency ?? null,
        method_of_shipment: p.method_of_shipment ?? null,
      }));
    return {
      pos,
      quotes: data.quotes.map((q) => ({ quote_id: q.quote_id, quote_date: q.quote_date ?? null, supplier_id: q.supplier_id ?? null, estimated_lead_time_days: q.estimated_lead_time_days ?? null })),
      costs: data.poCosts.map((c) => ({ po_id: c.po_id, cost_category: String(c.cost_category), payment_date: c.payment_date ?? null })),
      grns, today,
    };
  }, [data.pos, data.quotes, data.poCosts, grns, period, via, today]);
  const leads = useMemo(() => supplierLeadTimes(ltInput), [ltInput]);
  // The same POs and filters, grouped by the items on their lines.
  const products = useMemo(() => productLeadTimes(poTimelines(ltInput), data.poItems, today), [ltInput, data.poItems, today]);
  const compById = useMemo(() => new Map(data.components.map((c) => [c.component_id, c])), [data.components]);

  const shown = useMemo(() => {
    const q = search.trim().toLowerCase();
    return leads.filter((l) => {
      const s = supplierById.get(l.supplierId);
      return !q || `${s?.supplier_name ?? ''} ${s?.supplier_code ?? ''}`.toLowerCase().includes(q);
    });
  }, [leads, search, supplierById]);

  const shownProducts = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return products;
    return products.filter((p) => {
      const c = compById.get(p.componentId);
      const sups = p.suppliers.map((s) => supplierById.get(s.supplierId)?.supplier_name ?? '').join(' ');
      return `${c?.internal_description ?? ''} ${c?.supplier_model ?? ''} ${c?.brand ?? ''} ${sups}`.toLowerCase().includes(q);
    });
  }, [products, search, compById, supplierById]);

  // Arrived from a link to one item: bring its row into view once, when it exists.
  const scrolledItem = useRef(false);
  useEffect(() => {
    if (!linkedItem || scrolledItem.current || !shownProducts.some((p) => p.componentId === linkedItem)) return;
    scrolledItem.current = true;
    document.getElementById(`lti-${linkedItem}`)?.scrollIntoView({ block: 'start' });
  }, [linkedItem, shownProducts]);

  // Arrived from a link to one supplier: bring its row into view once, when it exists.
  const scrolled = useRef(false);
  useEffect(() => {
    if (!linked || scrolled.current || !shown.some((l) => l.supplierId === linked)) return;
    scrolled.current = true;
    document.getElementById(`lt-${linked}`)?.scrollIntoView({ block: 'start' });
  }, [linked, shown]);

  // Headline tiles, over what is shown.
  // Headline tiles: over the suppliers shown, or — by product — every supplier in the period and shipping chosen.
  const digest = leadDigest(view === 'supplier' ? shown : leads);
  const { received: receivedCount, open: openCount, promised: promisedCount, onTime, lateOpen: overdue, odd, noDate, byVia } = digest;
  const medianAll = digest.poToReceived?.median ?? null;
  // One scale for every bar, so suppliers compare by length.
  const barMax = Math.max(1, ...shown.map((l) => l.split?.total ?? 0));

  if (authLoading || !profile || !canView) {
    return <div className="min-h-screen bg-chrome flex items-center justify-center"><div className="w-6 h-6 border-2 border-sky-500/30 border-t-sky-500 rounded-full animate-spin" /></div>;
  }

  return (
    <div className="min-h-screen bg-chrome text-slate-200 font-sans text-sm">
      <style>{BAR_CSS}</style>
      <div className="border-b border-slate-800/60 bg-chrome/80 backdrop-blur-md sticky top-0 z-30">
        <div className="max-w-[1200px] 2xl:max-w-[1760px] mx-auto px-3 sm:px-4 md:px-6 py-2.5 sm:py-3 flex flex-col sm:flex-row sm:items-center justify-between gap-2.5">
          <BrandMenu wordmarkClass="text-xl md:text-2xl font-extrabold" subtitle={t('Quote → PO → payment → fully received')} />
          <Link href="/suppliers" className="text-xs text-slate-400 hover:text-white px-3 py-1.5 border border-slate-700 rounded-lg hover:bg-slate-800 transition-colors whitespace-nowrap">{t('Suppliers')} →</Link>
        </div>
      </div>

      <main className="max-w-[1200px] 2xl:max-w-[1760px] mx-auto px-3 sm:px-4 md:px-6 py-4 sm:py-5 space-y-4">
        <div className="flex flex-wrap items-center gap-2">
          <div className="flex gap-1" role="group" aria-label={t('Grouping')}>
            {([['supplier', 'By supplier'], ['product', 'By product']] as [View, string][]).map(([v, label]) => (
              <button key={v} type="button" onClick={() => setView(v)} aria-pressed={view === v}
                className={`${BAR_BTN} px-3 ${view === v ? BAR_BTN_ON_SKY : BAR_BTN_OFF}`}>{t(label)}</button>
            ))}
          </div>
          <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder={view === 'supplier' ? t('Search supplier…') : t('Search item or supplier…')} className={`${BAR_INPUT} w-full sm:w-64`} />
          <select value={period} onChange={(e) => setPeriod(e.target.value as Period)} className={BAR_SELECT} title={t('POs placed in this period')}>
            <option value="all">{t('All time')}</option>
            <option value="12">{t('Last 12 months')}</option>
            <option value="6">{t('Last 6 months')}</option>
          </select>
          <select value={via} onChange={(e) => setVia(e.target.value as ViaFilter)} className={BAR_SELECT} title={t('How the goods were shipped, as set on the PO')}>
            <option value="all">{t('Sea, air and local')}</option>
            {SHIP_VIAS.map((v) => <option key={v} value={v}>{t(VIA_LABEL[v])}</option>)}
            <option value="none">{t('Shipping not set')}</option>
          </select>
        </div>

        {/* ── Headline ── */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-2">
          {[
            [t('POs fully received'), String(receivedCount), tf('{n} still open', { n: openCount })],
            [t('PO → fully received'), medianAll == null ? '—' : dayLabel(t, tf, medianAll), t('median, all suppliers shown')],
            [t('On time against the quote'), promisedCount ? `${onTime} / ${promisedCount}` : '—', t('POs whose quote stated a lead time')],
            [t('Open POs now late'), String(overdue), t('past the quoted date, or past the supplier usual time')],
          ].map(([k, v, sub], i) => (
            <div key={k} className={`rounded-xl border px-3 py-2 ${i === 3 && overdue ? 'border-red-500/40 bg-red-500/5' : 'border-slate-800 bg-slate-900/40'}`}>
              <div className="text-[10px] uppercase tracking-wider text-slate-500">{k}</div>
              <div className={`text-lg font-semibold tabular-nums ${i === 3 && overdue ? 'text-red-300' : 'text-white'}`}>{v}</div>
              <div className="text-[10px] text-slate-500">{sub}</div>
            </div>
          ))}
        </div>

        {/* ── By shipping — sea and air are never averaged together ── */}
        {byVia.length > 0 && (
          <div className="flex flex-wrap items-center gap-2 text-[11px]">
            <span className="text-slate-500">{t('PO → fully received by shipping')}</span>
            {byVia.map((b) => (
              <button key={b.via ?? 'none'} onClick={() => setVia(b.via ?? 'none')} title={t('Show only these POs')}
                className={`px-2 py-0.5 rounded-md border transition-colors ${(via === (b.via ?? 'none')) ? 'border-sky-500/50 bg-sky-500/10 text-sky-200' : 'border-slate-700 text-slate-300 hover:border-slate-500'}`}>
                <b>{t(viaName(b.via))}</b> {b.stats ? dayLabel(t, tf, b.stats.median) : '—'} <span className="text-slate-500">· {tf('{n} POs', { n: b.count })}</span>
              </button>
            ))}
          </div>
        )}

        {/* ── Legend ── */}
        {view === 'supplier' && <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px] text-slate-400">
          <span className="text-slate-500">{t('Bars: typical quote → fully received, split by where the days go')}</span>
          {BAR_STAGES.map((b) => (
            <span key={b.stage} className="inline-flex items-center gap-1.5"><span className={`inline-block w-3 h-3 rounded-sm ${b.cls}`} />{t(b.label)}</span>
          ))}
        </div>}

        {loading && !data.pos.length ? (
          <div className="space-y-2">{[...Array(4)].map((_, i) => <div key={i} className="h-14 bg-slate-800/40 rounded-xl animate-pulse" />)}</div>
        ) : view === 'product' ? (
          shownProducts.length === 0
            ? <div className="rounded-2xl border border-dashed border-slate-700 p-8 text-center text-sm text-slate-400">{t('No purchase orders in this view.')}</div>
            : <ProductTable products={shownProducts} openItem={openItem} setOpenItem={setOpenItem} compById={compById} supplierById={supplierById}
                canOpenItem={canOpenPath(ROLE_PERMISSIONS[profile.role], '/items/x')} today={today} />
        ) : shown.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-slate-700 p-8 text-center text-sm text-slate-400">{t('No purchase orders in this view.')}</div>
        ) : (
          <div className="rounded-2xl border border-slate-800 overflow-x-auto">
            <table className="w-full text-xs min-w-[980px]">
              <thead>
                <tr className="bg-slate-800/50 text-[10px] uppercase tracking-wider text-slate-500">
                  <th className="px-3 py-2 text-left">{t('Supplier')}</th>
                  <th className="px-3 py-2 text-right">{t('POs')}</th>
                  <th className="px-3 py-2 text-left w-[32%]">{t('Quote → fully received')}</th>
                  <th className="px-3 py-2 text-right">{t('PO → fully received')}</th>
                  <th className="px-3 py-2 text-right">{t('Deposit → balance')}</th>
                  <th className="px-3 py-2 text-right">{t('Against the quote')}</th>
                  <th className="px-3 py-2 text-right">{t('Open, late')}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800/60">
                {shown.map((l) => {
                  const s = supplierById.get(l.supplierId);
                  const isOpen = open === l.supplierId;
                  return (
                    <React.Fragment key={l.supplierId}>
                      <tr id={`lt-${l.supplierId}`} onClick={() => setOpen(isOpen ? null : l.supplierId)} className={`cursor-pointer align-middle ${isOpen ? 'bg-sky-500/5' : 'hover:bg-white/[0.02]'}`}>
                        <td className="px-3 py-2">
                          <div className="text-slate-100 font-semibold">{s?.supplier_name ?? t('Unknown supplier')}</div>
                          <div className="text-[10px] text-slate-500">{[s?.supplier_code, l.lastPoDate && tf('last PO {d}', { d: fmtDay(l.lastPoDate) })].filter(Boolean).join(' · ')}</div>
                          <div className="flex flex-wrap gap-1 mt-1">
                            {l.byVia.map((b) => (
                              <span key={b.via ?? 'none'} className={`px-1.5 py-px rounded border text-[10px] tabular-nums ${b.via ? 'border-slate-700 text-slate-300' : 'border-amber-500/30 text-amber-300'}`}
                                title={tf('{via}: {done} received, {open} open', { via: t(viaName(b.via)), done: b.completed, open: b.open })}>
                                {t(viaName(b.via))}{b.poToReceived ? ` ${dayLabel(t, tf, b.poToReceived.median)}` : ` · ${b.completed + b.open}`}
                              </span>
                            ))}
                          </div>
                        </td>
                        <td className="px-3 py-2 text-right tabular-nums text-slate-300 whitespace-nowrap">{tf('{done} in · {open} open', { done: l.completed, open: l.open })}</td>
                        <td className="px-3 py-2"><StageBar lead={l} max={barMax} /></td>
                        <td className="px-3 py-2 text-right whitespace-nowrap"><StatCell s={l.stages.poToReceived} /></td>
                        <td className="px-3 py-2 text-right whitespace-nowrap"><StatCell s={l.stages.payToPaid} /></td>
                        <td className="px-3 py-2 text-right whitespace-nowrap tabular-nums">
                          {l.promise ? (
                            <>
                              <div className="text-slate-200">{tf('{a} of {b} on time', { a: l.promise.onTime, b: l.promise.measured })}</div>
                              <div className={`text-[10px] ${l.promise.medianLateDays > 0 ? 'text-amber-300' : 'text-slate-500'}`}>
                                {l.promise.medianLateDays > 0 ? tf('typically {d} days late', { d: l.promise.medianLateDays }) : t('typically on time')}
                              </div>
                            </>
                          ) : <span className="text-slate-600">—</span>}
                        </td>
                        <td className="px-3 py-2 text-right tabular-nums">
                          {l.overdue ? <span className="px-2 py-0.5 rounded-md bg-red-500/10 border border-red-500/30 text-red-300 font-semibold">{l.overdue}</span> : <span className="text-slate-600">—</span>}
                        </td>
                      </tr>
                      {isOpen && (
                        <tr><td colSpan={7} className="px-3 pb-3 bg-sky-500/5"><PoList pos={l.pos} today={today} /></td></tr>
                      )}
                    </React.Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}

        <p className="text-[11px] text-slate-500 leading-relaxed">
          {t('How it is measured: calendar days between the quote date, the PO date, the first and last payment to the supplier, and the date the PO was fully received (the date typed on the PO, else its last goods receipt). Medians, so one stuck container does not move a supplier by a month. A quoted lead time is counted from the first payment.')}
          {odd > 0 && <> {tf('{n} POs have dates that run backwards (e.g. a quote dated after its PO); those stages are left out and marked on the PO.', { n: odd })}</>}
          {noDate > 0 && <> {tf('{n} POs are marked Fully Received with no received date, so they are not measured. Add the date on the PO.', { n: noDate })}</>}
        </p>
      </main>
    </div>
  );
}

/**
 * One row per item: how long the POs that carried it took, PO → fully
 * received, by shipping and by supplier. Click a row for those POs.
 */
function ProductTable({ products, openItem, setOpenItem, compById, supplierById, canOpenItem, today }: {
  products: ProductLead[];
  openItem: string | null;
  setOpenItem: (id: string | null) => void;
  compById: Map<string, { internal_description?: string | null; supplier_model?: string | null; brand?: string | null; unit?: string | null }>;
  supplierById: Map<string, { supplier_name?: string | null }>;
  canOpenItem: boolean;
  today: string;
}) {
  const { t, tf } = useT();
  return (
    <div className="rounded-2xl border border-slate-800 overflow-x-auto">
      <table className="w-full text-xs min-w-[900px]">
        <thead>
          <tr className="bg-slate-800/50 text-[10px] uppercase tracking-wider text-slate-500">
            <th className="px-3 py-2 text-left">{t('Item')}</th>
            <th className="px-3 py-2 text-right">{t('POs')}</th>
            <th className="px-3 py-2 text-right">{t('PO → fully received')}</th>
            <th className="px-3 py-2 text-right">{t('Quote → fully received')}</th>
            <th className="px-3 py-2 text-left">{t('Suppliers')}</th>
            <th className="px-3 py-2 text-right">{t('Against the quote')}</th>
            <th className="px-3 py-2 text-right">{t('Open, late')}</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-800/60">
          {products.map((p) => {
            const c = compById.get(p.componentId);
            const isOpen = openItem === p.componentId;
            return (
              <React.Fragment key={p.componentId}>
                <tr id={`lti-${p.componentId}`} onClick={() => setOpenItem(isOpen ? null : p.componentId)} className={`cursor-pointer align-middle ${isOpen ? 'bg-sky-500/5' : 'hover:bg-white/[0.02]'}`}>
                  <td className="px-3 py-2">
                    {/* A table cell ignores max-width, so the cap sits on what is inside it. */}
                    <div className="max-w-[360px]">
                    <div className="text-slate-100 font-semibold truncate" title={c?.internal_description ?? ''}>{c?.internal_description || c?.supplier_model || t('Unknown item')}</div>
                    <div className="text-[10px] text-slate-500 truncate">
                      {[c?.supplier_model !== c?.internal_description && c?.supplier_model,
                        tf('{n} ordered', { n: `${p.qty.toLocaleString('id-ID')}${c?.unit ? ` ${c.unit}` : ''}` }),
                        p.lastPoDate && tf('last PO {d}', { d: fmtDay(p.lastPoDate) })].filter(Boolean).join(' · ')}
                      {canOpenItem && <> · <Link href={`/items/${p.componentId}`} onClick={(e) => e.stopPropagation()} className="text-sky-400 hover:text-sky-300">{t('Item page')} →</Link></>}
                    </div>
                    <div className="flex flex-wrap gap-1 mt-1">
                      {p.byVia.map((b) => (
                        <span key={b.via ?? 'none'} className={`px-1.5 py-px rounded border text-[10px] tabular-nums ${b.via ? 'border-slate-700 text-slate-300' : 'border-amber-500/30 text-amber-300'}`}
                          title={tf('{via}: {done} received, {open} open', { via: t(viaName(b.via)), done: b.completed, open: b.open })}>
                          {t(viaName(b.via))}{b.poToReceived ? ` ${dayLabel(t, tf, b.poToReceived.median)}` : ` · ${b.completed + b.open}`}
                        </span>
                      ))}
                    </div>
                    </div>
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums text-slate-300 whitespace-nowrap">{tf('{done} in · {open} open', { done: p.completed, open: p.open })}</td>
                  <td className="px-3 py-2 text-right whitespace-nowrap"><StatCell s={p.poToReceived} /></td>
                  <td className="px-3 py-2 text-right whitespace-nowrap"><StatCell s={p.quoteToReceived} /></td>
                  <td className="px-3 py-2 text-[11px]">
                    {p.suppliers.slice(0, 3).map((s) => (
                      <div key={s.supplierId} className="flex max-w-[280px] whitespace-nowrap" title={supplierById.get(s.supplierId)?.supplier_name ?? ''}>
                        <span className="text-slate-200 truncate">{supplierById.get(s.supplierId)?.supplier_name ?? t('Unknown supplier')}</span>
                        <span className="text-slate-500 tabular-nums">&nbsp;· {s.poToReceived ? dayLabel(t, tf, s.poToReceived.median) : tf('{n} POs', { n: s.pos })}</span>
                      </div>
                    ))}
                    {p.suppliers.length > 3 && <div className="text-[10px] text-slate-500">{tf('+{n} more', { n: p.suppliers.length - 3 })}</div>}
                  </td>
                  <td className="px-3 py-2 text-right whitespace-nowrap tabular-nums">
                    {p.promise ? (
                      <>
                        <div className="text-slate-200">{tf('{a} of {b} on time', { a: p.promise.onTime, b: p.promise.measured })}</div>
                        <div className={`text-[10px] ${p.promise.medianLateDays > 0 ? 'text-amber-300' : 'text-slate-500'}`}>
                          {p.promise.medianLateDays > 0 ? tf('typically {d} days late', { d: p.promise.medianLateDays }) : t('typically on time')}
                        </div>
                      </>
                    ) : <span className="text-slate-600">—</span>}
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums">
                    {p.overdue ? <span className="px-2 py-0.5 rounded-md bg-red-500/10 border border-red-500/30 text-red-300 font-semibold">{p.overdue}</span> : <span className="text-slate-600">—</span>}
                  </td>
                </tr>
                {isOpen && (
                  <tr><td colSpan={7} className="px-3 pb-3 bg-sky-500/5"><PoList pos={p.pos} today={today} supplierOf={(id) => supplierById.get(id)?.supplier_name ?? ''} /></td></tr>
                )}
              </React.Fragment>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

/**
 * The typical quote → fully received time on one shared scale, split by where
 * the days go (lib/supplierLeadTimes `split`). Hover a segment for that stage's
 * own median, range and count.
 */
function StageBar({ lead, max }: { lead: SupplierLead; max: number }) {
  const { t, tf } = useT();
  const sp = lead.split;
  if (!sp) return <span className="text-[11px] text-slate-600">{t('nothing received yet')}</span>;
  const shares = sp.shares;
  if (!shares) {
    return (
      <div className="flex items-center gap-2">
        <div className="h-3 rounded bg-slate-600" style={{ width: `${Math.max(4, (sp.total / max) * 100)}%` }} title={t('No payment recorded on these POs, so the split between stages is unknown')} />
        <span className="text-[11px] tabular-nums text-slate-300 whitespace-nowrap">{dayLabel(t, tf, sp.total)}</span>
      </div>
    );
  }
  const segs = BAR_STAGES.map((b) => ({ ...b, share: shares[b.stage as keyof typeof shares], s: lead.stages[b.stage] })).filter((x) => x.share > 0);
  return (
    <div className="flex items-center gap-2">
      <div className="flex gap-[2px] h-3" style={{ width: `${Math.max(4, (sp.total / max) * 100)}%` }}>
        {segs.map((x, i) => (
          <div key={x.stage} className={`${x.cls} h-full ${i === 0 ? 'rounded-l' : ''} ${i === segs.length - 1 ? 'rounded-r' : ''}`}
            style={{ flex: `${x.share} 0 0` }}
            title={`${t(x.label)}: ${tf('{p} % of the time', { p: Math.round(x.share * 100) })}${x.s ? ` · ${tf('median {m} days (from {min} to {max}, {n} POs)', { m: x.s.median, min: x.s.min, max: x.s.max, n: x.s.n })}` : ''}`} />
        ))}
      </div>
      <span className="text-[11px] tabular-nums text-slate-300 whitespace-nowrap">{dayLabel(t, tf, sp.total)}</span>
    </div>
  );
}

function StatCell({ s }: { s: StageStats | null }) {
  const { t, tf } = useT();
  if (!s) return <span className="text-slate-600">—</span>;
  return (
    <div className="tabular-nums">
      <div className="text-slate-100 font-semibold">{dayLabel(t, tf, s.median)}</div>
      <div className="text-[10px] text-slate-500">{s.n > 1 ? tf('{min}–{max} · {n} POs', { min: s.min, max: s.max, n: s.n }) : tf('{n} PO only', { n: s.n })}</div>
    </div>
  );
}

/** Every PO behind a supplier's (or an item's) numbers, newest first. By item, each PO names its supplier. */
function PoList({ pos, today, supplierOf }: { pos: PoTimeline[]; today: string; supplierOf?: (supplierId: string) => string }) {
  const { t, tf } = useT();
  const d = (v: string | null) => (v ? fmtDay(v) : '—');
  const days = (v: number | null) => (v == null ? '' : tf('{d} d', { d: v }));
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-[11px] min-w-[960px] mt-2">
        <thead><tr className="text-[10px] uppercase tracking-wider text-slate-500">
          <th className="text-left py-1 pr-2">PO</th><th className="text-left px-2">{t('Shipped via')}</th><th className="text-left px-2">{t('Quote')}</th><th className="text-left px-2">{t('PO date')}</th>
          <th className="text-left px-2">{t('First payment')}</th><th className="text-left px-2">{t('Last payment')}</th><th className="text-left px-2">{t('Fully received')}</th>
          <th className="text-right px-2">{t('PO → received')}</th><th className="text-left px-2">{t('Quoted lead time')}</th>
        </tr></thead>
        <tbody className="divide-y divide-slate-800/40">
          {pos.map((p) => (
            <tr key={p.poId} className="align-top">
              <td className="py-1.5 pr-2 whitespace-nowrap">
                <Link href={lookupHref(p.poNumber)} className="text-sky-300 hover:text-sky-200 font-mono">{p.poNumber || '—'}</Link>
                <div className="text-[10px] text-slate-500">{p.status}{p.currency ? ` · ${p.currency}` : ''}</div>
                {supplierOf && p.supplierId && <div className="text-[10px] text-slate-400 max-w-[180px] truncate">{supplierOf(p.supplierId)}</div>}
              </td>
              <td className={`px-2 whitespace-nowrap ${p.via ? 'text-slate-300' : 'text-amber-300'}`}>{t(viaName(p.via))}</td>
              <td className="px-2 whitespace-nowrap text-slate-300">{d(p.quoteDate)}<div className={`text-[10px] ${p.odd.includes('quoteToPo') ? 'text-amber-300' : 'text-slate-500'}`}>{p.odd.includes('quoteToPo') ? t('after the PO') : days(p.stages.quoteToPo)}</div></td>
              <td className="px-2 whitespace-nowrap text-slate-300">{d(p.poDate)}</td>
              <td className="px-2 whitespace-nowrap text-slate-300">{d(p.firstPay)}<div className={`text-[10px] ${p.odd.includes('poToPay') ? 'text-amber-300' : 'text-slate-500'}`}>{p.odd.includes('poToPay') ? t('before the PO') : days(p.stages.poToPay)}</div></td>
              <td className="px-2 whitespace-nowrap text-slate-300">{p.lastPay && p.lastPay !== p.firstPay ? d(p.lastPay) : '—'}</td>
              <td className="px-2 whitespace-nowrap">
                {p.received ? <span className="text-slate-100">{d(p.received)}{p.receivedFrom === 'grn' && <span className="text-[10px] text-slate-500"> · {t('from goods receipt')}</span>}</span>
                  : p.open ? <span className="text-amber-300">{tf('waiting {d} days', { d: p.waitingDays ?? 0 })}</span>
                  : p.status === 'Fully Received' ? <span className="text-amber-300">{t('no received date')}</span> : <span className="text-slate-600">—</span>}
              </td>
              <td className="px-2 text-right tabular-nums text-white font-semibold">{p.stages.poToReceived == null ? '—' : tf('{d} d', { d: p.stages.poToReceived })}</td>
              <td className="px-2 text-slate-400">
                {p.statedText ?? '—'}
                {p.promised && (
                  <div className={`text-[10px] ${p.lateDays != null && p.lateDays > 0 ? 'text-amber-300' : p.open && today > p.promised ? 'text-red-300' : 'text-slate-500'}`}>
                    {p.lateDays != null
                      ? (p.lateDays > 0 ? tf('due {d} · {n} days late', { d: d(p.promised), n: p.lateDays }) : tf('due {d} · on time', { d: d(p.promised) }))
                      : p.open && today > p.promised ? tf('due {d} · overdue', { d: d(p.promised) }) : tf('due {d}', { d: d(p.promised) })}
                  </div>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
