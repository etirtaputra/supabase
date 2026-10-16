'use client';
/**
 * Supplier Lead Times — how long each supplier really takes, quote to goods
 * fully in (owner, 2026-10-16). One row per supplier: the median of each stage
 * as a bar, the end-to-end PO → received figure, the record against the lead
 * time its quotes promised, and its open POs that are now late. Click a row
 * for every PO behind the numbers, each one a click from its Deal Lookup.
 *
 * Computed from rows ICAPROC already holds (lib/supplierLeadTimes.ts); nothing
 * is stored. Same door as Suppliers (buy side).
 */
import React, { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/hooks/useAuth';
import { useSupabaseData } from '@/hooks/useSupabaseData';
import { usePageTitle } from '@/hooks/usePageTitle';
import { useT } from '@/hooks/useT';
import { createSupabaseClient } from '@/lib/supabase';
import { fetchAllRows } from '@/lib/fetchAllRows';
import { ROLE_PERMISSIONS } from '@/constants/roles';
import { canOpenPath } from '@/constants/navigation';
import { BAR_INPUT, BAR_SELECT } from '@/constants/controls';
import { LIGHT_THEMES } from '@/lib/theme';
import { fmtDay } from '@/lib/formatters';
import BrandMenu from '@/components/ui/BrandMenu';
import { supplierLeadTimes, type LtGrn, type LtPo, type PoTimeline, type Stage, type StageStats, type SupplierLead } from '@/lib/supplierLeadTimes';

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
type Origin = 'all' | 'import' | 'local';

export default function SupplierLeadTimesPage() {
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
  const [origin, setOrigin] = useState<Origin>('all');
  const [open, setOpen] = useState<string | null>(null);

  const today = new Date().toISOString().slice(0, 10);
  const supplierById = useMemo(() => new Map(data.suppliers.map((s) => [s.supplier_id, s])), [data.suppliers]);

  const leads = useMemo(() => {
    const since = period === 'all' ? null : (() => { const d = new Date(); d.setMonth(d.getMonth() - Number(period)); return d.toISOString().slice(0, 10); })();
    const pos: LtPo[] = data.pos
      .filter((p) => !since || (p.po_date ?? '') >= since)
      .filter((p) => origin === 'all' || (origin === 'local' ? p.currency === 'IDR' : p.currency !== 'IDR'))
      .map((p) => ({
        po_id: p.po_id, po_number: p.po_number, status: p.status ?? null, po_date: p.po_date ?? null, quote_id: p.quote_id ?? null,
        supplier_id: p.supplier_id ?? null, actual_received_date: p.actual_received_date ?? null, currency: p.currency ?? null,
      }));
    return supplierLeadTimes({
      pos,
      quotes: data.quotes.map((q) => ({ quote_id: q.quote_id, quote_date: q.quote_date ?? null, supplier_id: q.supplier_id ?? null, estimated_lead_time_days: q.estimated_lead_time_days ?? null })),
      costs: data.poCosts.map((c) => ({ po_id: c.po_id, cost_category: String(c.cost_category), payment_date: c.payment_date ?? null })),
      grns, today,
    });
  }, [data.pos, data.quotes, data.poCosts, grns, period, origin, today]);

  const shown = useMemo(() => {
    const q = search.trim().toLowerCase();
    return leads.filter((l) => {
      const s = supplierById.get(l.supplierId);
      return !q || `${s?.supplier_name ?? ''} ${s?.supplier_code ?? ''}`.toLowerCase().includes(q);
    });
  }, [leads, search, supplierById]);

  // Headline tiles, over what is shown.
  const all = shown.flatMap((l) => l.pos);
  const received = all.filter((p) => p.received);
  const poToRecv = received.map((p) => p.stages.poToReceived).filter((v): v is number => v != null).sort((a, b) => a - b);
  const medianAll = poToRecv.length ? (poToRecv.length % 2 ? poToRecv[poToRecv.length >> 1] : (poToRecv[poToRecv.length / 2 - 1] + poToRecv[poToRecv.length / 2]) / 2) : null;
  const promised = received.filter((p) => p.lateDays != null);
  const onTime = promised.filter((p) => p.lateDays! <= 0).length;
  const overdue = shown.reduce((a, l) => a + l.overdue, 0);
  const odd = shown.reduce((a, l) => a + l.odd, 0);
  const noDate = shown.reduce((a, l) => a + l.noDate, 0);
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
          <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder={t('Search supplier…')} className={`${BAR_INPUT} w-full sm:w-64`} />
          <select value={period} onChange={(e) => setPeriod(e.target.value as Period)} className={BAR_SELECT} title={t('POs placed in this period')}>
            <option value="all">{t('All time')}</option>
            <option value="12">{t('Last 12 months')}</option>
            <option value="6">{t('Last 6 months')}</option>
          </select>
          <select value={origin} onChange={(e) => setOrigin(e.target.value as Origin)} className={BAR_SELECT}>
            <option value="all">{t('Import and local')}</option>
            <option value="import">{t('Import (foreign currency)')}</option>
            <option value="local">{t('Local (IDR)')}</option>
          </select>
        </div>

        {/* ── Headline ── */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-2">
          {[
            [t('POs fully received'), String(received.length), tf('{n} still open', { n: all.filter((p) => p.open).length })],
            [t('PO → fully received'), medianAll == null ? '—' : dayLabel(t, tf, medianAll), t('median, all suppliers shown')],
            [t('On time against the quote'), promised.length ? `${onTime} / ${promised.length}` : '—', t('POs whose quote stated a lead time')],
            [t('Open POs now late'), String(overdue), t('past the quoted date, or past the supplier usual time')],
          ].map(([k, v, sub], i) => (
            <div key={k} className={`rounded-xl border px-3 py-2 ${i === 3 && overdue ? 'border-red-500/40 bg-red-500/5' : 'border-slate-800 bg-slate-900/40'}`}>
              <div className="text-[10px] uppercase tracking-wider text-slate-500">{k}</div>
              <div className={`text-lg font-semibold tabular-nums ${i === 3 && overdue ? 'text-red-300' : 'text-white'}`}>{v}</div>
              <div className="text-[10px] text-slate-500">{sub}</div>
            </div>
          ))}
        </div>

        {/* ── Legend ── */}
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px] text-slate-400">
          <span className="text-slate-500">{t('Bars: typical quote → fully received, split by where the days go')}</span>
          {BAR_STAGES.map((b) => (
            <span key={b.stage} className="inline-flex items-center gap-1.5"><span className={`inline-block w-3 h-3 rounded-sm ${b.cls}`} />{t(b.label)}</span>
          ))}
        </div>

        {loading && !data.pos.length ? (
          <div className="space-y-2">{[...Array(4)].map((_, i) => <div key={i} className="h-14 bg-slate-800/40 rounded-xl animate-pulse" />)}</div>
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
                      <tr onClick={() => setOpen(isOpen ? null : l.supplierId)} className={`cursor-pointer align-middle ${isOpen ? 'bg-sky-500/5' : 'hover:bg-white/[0.02]'}`}>
                        <td className="px-3 py-2">
                          <div className="text-slate-100 font-semibold">{s?.supplier_name ?? t('Unknown supplier')}</div>
                          <div className="text-[10px] text-slate-500">{[s?.supplier_code, l.lastPoDate && tf('last PO {d}', { d: fmtDay(l.lastPoDate) })].filter(Boolean).join(' · ')}</div>
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

/** Every PO behind a supplier's numbers, newest first. */
function PoList({ pos, today }: { pos: PoTimeline[]; today: string }) {
  const { t, tf } = useT();
  const d = (v: string | null) => (v ? fmtDay(v) : '—');
  const days = (v: number | null) => (v == null ? '' : tf('{d} d', { d: v }));
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-[11px] min-w-[960px] mt-2">
        <thead><tr className="text-[10px] uppercase tracking-wider text-slate-500">
          <th className="text-left py-1 pr-2">PO</th><th className="text-left px-2">{t('Quote')}</th><th className="text-left px-2">{t('PO date')}</th>
          <th className="text-left px-2">{t('First payment')}</th><th className="text-left px-2">{t('Last payment')}</th><th className="text-left px-2">{t('Fully received')}</th>
          <th className="text-right px-2">{t('PO → received')}</th><th className="text-left px-2">{t('Quoted lead time')}</th>
        </tr></thead>
        <tbody className="divide-y divide-slate-800/40">
          {pos.map((p) => (
            <tr key={p.poId} className="align-top">
              <td className="py-1.5 pr-2 whitespace-nowrap">
                <Link href={lookupHref(p.poNumber)} className="text-sky-300 hover:text-sky-200 font-mono">{p.poNumber || '—'}</Link>
                <div className="text-[10px] text-slate-500">{p.status}{p.currency ? ` · ${p.currency}` : ''}</div>
              </td>
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
