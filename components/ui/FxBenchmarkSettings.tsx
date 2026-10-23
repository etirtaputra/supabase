'use client';
import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { createSupabaseClient } from '@/lib/supabase';
import { useT } from '@/hooks/useT';
import { useSupabaseData } from '@/hooks/useSupabaseData';
import { useFxBenchmarks } from '@/hooks/useFxBenchmarks';
import { fmtDay, fmtDayTime, fmtInt, fmtRupiah } from '@/lib/formatters';
import { fetchLiveFx } from '@/lib/liveFx';
import { fetchBankAccounts } from '@/lib/banks';
import { personName } from '@/lib/quoteFlags';
import {
  BENCHMARK_CURRENCIES, STALE_AFTER_DAYS, currentBenchmarks, benchmarkLog, ageDays,
  compareToBenchmark, summarise, type FxComparison, type FxBenchmark, type FxReference,
} from '@/lib/fxBenchmark';
import { BCA_CODES, FOLLOW_PCT, roundUpToHundred } from '@/lib/bcaRate';
import { BAR_SELECT, BAR_INPUT, BAR_BTN, BAR_BTN_OFF, BAR_BTN_ON } from '@/constants/controls';

/**
 * Settings › Exchange rates (owner, 2026-10-23): "set a universal exchange
 * rate for USD and CNY, in settings, and it will have logs … when a new rate
 * is used, it will only affect new POs. Only then, we can compare what's the
 * rates use during payment, vs. the benchmark."
 *
 * Quotes and new POs take this rate (lib/poRate.ts, lib/computeTUC.ts
 * fxFromHistory); payments carry the rate on the bank slip. Each paid PO is
 * then set against the rate that was in force on its PO date
 * (lib/fxBenchmark.ts). The log is the table — a new rate is a new row.
 */
type GroupBy = 'month' | 'supplier' | 'bank';
/** A rate this far from today's market asks for a second click. */
const FAR_FROM_MARKET = 0.2;

export default function FxBenchmarkSettings({ flash }: { flash: (m: string) => void }) {
  const { t, tf, lang } = useT();
  const supabase = useMemo(() => createSupabaseClient(), []);
  const { rows, loaded, reload } = useFxBenchmarks();
  const { data, loading } = useSupabaseData();
  const [market, setMarket] = useState<Record<string, number> | null>(null);
  const [banks, setBanks] = useState<Map<string, string>>(new Map());
  // This morning's KlikBCA e-Rate, newest reading per currency.
  const [reference, setReference] = useState<Map<string, FxReference>>(new Map());
  useEffect(() => {
    let live = true;
    supabase.from('9.2_fx_reference_rates').select('rate_date, currency, buy, sell, quoted_at')
      .order('rate_date', { ascending: false }).limit(20)
      .then(({ data: refs }) => {
        if (!live) return;
        const m = new Map<string, FxReference>();
        for (const r of (refs ?? []) as FxReference[]) if (!m.has(r.currency)) m.set(r.currency, r);
        setReference(m);
      }, () => {});
    fetchLiveFx().then((s) => { if (live) setMarket(s?.rates ?? null); }, () => {});
    fetchBankAccounts(supabase, true).then((list) => {
      if (live) setBanks(new Map(list.map((b) => [b.bank_account_id, `${b.bank_name} ${b.account_number.slice(-4)}`])));
    }, () => {});
    return () => { live = false; };
  }, [supabase]);

  const today = new Date().toISOString().slice(0, 10);
  const current = useMemo(() => currentBenchmarks(rows), [rows]);
  const currencies = useMemo(() => [...new Set([...BENCHMARK_CURRENCIES, ...rows.map((r) => r.currency)])], [rows]);
  const log = useMemo(() => benchmarkLog(rows), [rows]);

  // ── Set a new rate ─────────────────────────────────────────────────────────
  const [ccy, setCcy] = useState<string>('CNY');
  const [rateText, setRateText] = useState('');
  const [note, setNote] = useState('');
  const [armed, setArmed] = useState(false);
  const [saving, setSaving] = useState(false);
  const newRate = Number(rateText.replace(/[^\d.]/g, ''));
  /** Who set a rate, in words: a person, or the morning check. */
  const setterOf = (r: FxBenchmark) => (r.source === 'bca-erate' ? t('KlikBCA e-Rate (automatic)') : personName(r.set_by_email ?? ''));

  // ── Correct a rate or its note (owner, 2026-10-24: "allow us to edit") ────
  const [editing, setEditing] = useState<number | null>(null);
  const [editRate, setEditRate] = useState('');
  const [editNote, setEditNote] = useState('');
  const startEdit = (r: FxBenchmark) => { setEditing(r.benchmark_id); setEditRate(String(Number(r.rate))); setEditNote(r.note ?? ''); };
  const saveEdit = async () => {
    const rate = Number(editRate.replace(/[^\d.]/g, ''));
    if (editing == null || !(rate > 0)) return;
    const { error } = await supabase.from('9.1_fx_benchmark_rates').update({ rate, note: editNote.trim() }).eq('benchmark_id', editing);
    if (error) { flash(error.message); return; }
    setEditing(null);
    flash(t('Rate corrected'));
    reload();
  };
  const mkt = market?.[ccy] ?? null;
  const farOff = !!mkt && newRate > 0 && Math.abs(newRate / mkt - 1) > FAR_FROM_MARKET;
  const save = async () => {
    if (!(newRate > 0) || saving) return;
    if (farOff && !armed) { setArmed(true); return; }
    setSaving(true);
    const { error } = await supabase.from('9.1_fx_benchmark_rates').insert({ currency: ccy, rate: newRate, note: note.trim() });
    setSaving(false);
    setArmed(false);
    if (error) { flash(error.message); return; }
    setRateText(''); setNote('');
    flash(tf('{ccy} company rate set to {rate}', { ccy, rate: fmtInt(newRate) }));
    reload();
  };

  // ── Payments against it ────────────────────────────────────────────────────
  const [groupBy, setGroupBy] = useState<GroupBy>('month');
  const supplierName = useMemo(() => new Map(data.suppliers.map((s) => [String(s.supplier_id), s.supplier_name])), [data.suppliers]);
  const comparisons = useMemo(() => {
    const out: FxComparison[] = [];
    for (const po of data.pos) {
      const c = compareToBenchmark(po, data.poCosts, rows);
      if (c) out.push(c);
    }
    return out.sort((a, b) => (b.paid.paidOn ?? '').localeCompare(a.paid.paidOn ?? ''));
  }, [data.pos, data.poCosts, rows]);
  const summary = useMemo(() => summarise(comparisons, (c) =>
    groupBy === 'month' ? (c.paid.paidOn ?? '').slice(0, 7) || null
      : groupBy === 'supplier' ? c.supplierId
        : c.paid.bankAccountId), [comparisons, groupBy]);
  const keyLabel = (k: string) => groupBy === 'month'
    ? new Date(`${k}-01T00:00:00`).toLocaleDateString(undefined, { month: 'long', year: 'numeric' })
    : groupBy === 'supplier' ? supplierName.get(k) ?? '—' : banks.get(k) ?? t('Bank not recorded');

  const diffCls = (d: number) => (d > 0.5 ? 'text-red-300' : d < -0.5 ? 'text-emerald-300' : 'text-slate-400');
  const diffText = (d: number) => (Math.abs(d) < 0.5 ? t('same as the company rate')
    : d > 0 ? tf('{amount} more', { amount: fmtRupiah(d) }) : tf('{amount} less', { amount: fmtRupiah(-d) }));
  const card = 'bg-slate-900/60 border border-slate-800/80 rounded-2xl';

  return (
    <div className="space-y-5">
      {/* ── The rates ── */}
      <section className={`${card} p-4 sm:p-5 space-y-4`}>
        <div>
          <h2 className="text-sm font-bold text-white">{t('Company exchange rates')}</h2>
          <p className="text-[12px] text-slate-500 mt-1 max-w-3xl leading-relaxed">
            {t('Supplier quotes and new POs use these rates. A PO keeps the rate it was saved with, so a new rate only affects new POs. Payments use the rate on the bank slip, and each paid PO is compared with the rate in force on its PO date.')}
          </p>
          <p className="text-[12px] text-slate-500 mt-1.5 max-w-3xl leading-relaxed">
            {tf('Every morning the system reads the KlikBCA e-Rate (sell), rounds it up to the next hundred, and updates the company rate by itself when the two are more than {pct}% apart.', { pct: FOLLOW_PCT.toLocaleString(lang === 'id' ? 'id-ID' : 'en-GB') })}
          </p>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          {currencies.map((c) => {
            const cur = current.get(c);
            const age = cur ? ageDays(cur, today) : null;
            const m = market?.[c];
            const vsMarket = cur && m ? (Number(cur.rate) / m - 1) * 100 : null;
            return (
              <div key={c} className="rounded-xl border border-slate-800 bg-slate-950/30 px-4 py-3">
                <div className="flex items-baseline justify-between gap-3">
                  <span className="text-[11px] font-bold uppercase tracking-widest text-slate-500">{c}</span>
                  {m != null && (
                    <span className="text-[11px] text-slate-500 tabular-nums" title={t('The market rate today, for reference')}>
                      {tf('market {rate}', { rate: fmtInt(Math.round(m)) })}
                      {vsMarket != null && Math.abs(vsMarket) >= 0.05 && (
                        <span className="ml-1">({vsMarket > 0 ? '+' : ''}{vsMarket.toFixed(1)}%)</span>
                      )}
                    </span>
                  )}
                </div>
                {cur ? (
                  <>
                    <p className="text-2xl font-bold text-white tabular-nums mt-1">{fmtRupiah(Number(cur.rate))}</p>
                    <p className="text-[12px] text-slate-500 mt-0.5">
                      {tf('Set {date} by {name}', { date: fmtDay(cur.set_at), name: setterOf(cur) })}
                    </p>
                    {age != null && age > STALE_AFTER_DAYS && !reference.get(c) && (
                      <p className="text-[12px] text-amber-300 mt-1">{tf('Set {n} days ago: worth a check against the bank.', { n: age })}</p>
                    )}
                  </>
                ) : (
                  <>
                    <p className="text-lg font-semibold text-slate-400 mt-1">{t('Not set yet')}</p>
                  </>
                )}
                {(() => {
                  const ref = reference.get(c);
                  if (!ref) return null;
                  const sell = Number(ref.sell);
                  const rounded = roundUpToHundred(sell);
                  const apart = cur ? (rounded / Number(cur.rate) - 1) * 100 : null;
                  return (
                    <p className="text-[12px] text-slate-400 mt-2 pt-2 border-t border-slate-800/70 tabular-nums">
                      {tf('KlikBCA e-Rate {code} sell {sell}, rounded up {rounded}', { code: BCA_CODES[c] ?? c, sell: fmtInt(sell), rounded: fmtInt(rounded) })}
                      <span className="text-slate-500"> · {ref.quoted_at || fmtDay(ref.rate_date)}</span>
                      {apart != null && Math.abs(apart) > FOLLOW_PCT && (
                        <span className="text-amber-300"> · {tf('{pct}% apart: updates tomorrow morning', { pct: apart.toFixed(1) })}</span>
                      )}
                    </p>
                  );
                })()}
                {!cur && (
                  <>
                    <p className="text-[12px] text-slate-500 mt-0.5">{t('Until it is set, new POs take the last rate paid, else the market rate.')}</p>
                  </>
                )}
              </div>
            );
          })}
        </div>

        {/* Set a new rate */}
        <div className="flex flex-wrap items-center gap-2 pt-1">
          <select value={ccy} onChange={(e) => { setCcy(e.target.value); setArmed(false); }} className={BAR_SELECT} aria-label={t('Currency')}>
            {currencies.map((c) => <option key={c} value={c}>{c}</option>)}
          </select>
          <input value={rateText} onChange={(e) => { setRateText(e.target.value); setArmed(false); }} inputMode="decimal"
            placeholder={mkt ? tf('New rate, market {rate}', { rate: fmtInt(Math.round(mkt)) }) : t('New rate')}
            onKeyDown={(e) => { if (e.key === 'Enter') save(); }}
            className={`${BAR_INPUT} w-44 tabular-nums`} aria-label={t('New rate')} />
          <input value={note} onChange={(e) => setNote(e.target.value)} placeholder={t('Note (optional)')}
            onKeyDown={(e) => { if (e.key === 'Enter') save(); }}
            className={`${BAR_INPUT} flex-1 min-w-[12rem]`} aria-label={t('Note (optional)')} />
          <button type="button" onClick={save} disabled={!(newRate > 0) || saving}
            className={`${BAR_BTN} px-4 font-semibold disabled:opacity-40 ${armed ? 'bg-amber-500/20 border-amber-500/50 text-amber-200' : 'bg-emerald-600 border-emerald-600 text-white hover:bg-emerald-500'}`}>
            {saving ? t('Saving…') : armed ? t('Set it anyway') : t('Set rate')}
          </button>
        </div>
        {farOff && (
          <p className="text-[12px] text-amber-300">
            {tf('{rate} is more than 20% away from the market rate of {market}. Check the figure, then press again to set it.', { rate: fmtInt(newRate), market: fmtInt(Math.round(mkt!)) })}
          </p>
        )}
      </section>

      {/* ── The log ── */}
      <section className={`${card} overflow-hidden`}>
        <div className="px-4 sm:px-5 py-3.5 border-b border-slate-800/70">
          <h2 className="text-sm font-bold text-white">{t('Change log')}</h2>
        </div>
        {!loaded ? (
          <div className="p-4"><div className="h-10 bg-slate-800/40 rounded-lg animate-pulse" /></div>
        ) : log.length === 0 ? (
          <p className="px-4 sm:px-5 py-6 text-[12.5px] text-slate-500">{t('No rate has been set yet.')}</p>
        ) : (
          <div className="divide-y divide-slate-800/70">
            {log.map((r) => {
              const rate = Number(r.rate);
              const chg = r.previous ? (rate / r.previous - 1) * 100 : null;
              return (
                <div key={r.benchmark_id} className="flex flex-wrap items-baseline gap-x-4 gap-y-0.5 px-4 sm:px-5 py-2.5 text-[12.5px]">
                  <span className="text-slate-500 tabular-nums w-36 shrink-0">{fmtDayTime(r.set_at)}</span>
                  <span className="font-semibold text-slate-300 w-10">{r.currency}</span>
                  <span className="font-semibold text-white tabular-nums">{fmtInt(rate)}</span>
                  <span className="text-slate-500 tabular-nums">
                    {r.previous == null ? t('first rate')
                      : <>{tf('was {rate}', { rate: fmtInt(r.previous) })} <span className={chg! > 0 ? 'text-red-300' : 'text-emerald-300'}>({chg! > 0 ? '+' : ''}{chg!.toFixed(1)}%)</span></>}
                  </span>
                  <span className={r.source === 'bca-erate' ? 'text-sky-300' : 'text-slate-400'}>{setterOf(r)}</span>
                  {editing === r.benchmark_id ? (
                    <span className="basis-full flex flex-wrap items-center gap-2 pt-1.5">
                      <input value={editRate} onChange={(e) => setEditRate(e.target.value)} inputMode="decimal" aria-label={t('Rate')}
                        onKeyDown={(e) => { if (e.key === 'Enter') saveEdit(); if (e.key === 'Escape') setEditing(null); }}
                        className={`${BAR_INPUT} w-32 tabular-nums`} />
                      <input value={editNote} onChange={(e) => setEditNote(e.target.value)} aria-label={t('Note (optional)')} placeholder={t('Note (optional)')}
                        onKeyDown={(e) => { if (e.key === 'Enter') saveEdit(); if (e.key === 'Escape') setEditing(null); }}
                        className={`${BAR_INPUT} flex-1 min-w-[12rem]`} />
                      <button type="button" onClick={saveEdit} className={`${BAR_BTN} px-3 font-semibold bg-emerald-600 border-emerald-600 text-white hover:bg-emerald-500`}>{t('Save')}</button>
                      <button type="button" onClick={() => setEditing(null)} className={`${BAR_BTN} px-3 ${BAR_BTN_OFF}`}>{t('Cancel')}</button>
                    </span>
                  ) : (
                    <>
                      {r.note && <span className="text-slate-500 italic basis-full sm:basis-auto">“{r.note}”</span>}
                      {r.edited_at && (
                        <span className="text-[11px] text-slate-500">{tf('edited by {name} {date}', { name: personName(r.edited_by_email ?? ''), date: fmtDayTime(r.edited_at) })}</span>
                      )}
                      <button type="button" onClick={() => startEdit(r)} className="ml-auto text-[12px] font-semibold text-sky-300 hover:text-sky-200">{t('Edit')}</button>
                    </>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </section>

      {/* ── Payments against the company rate ── */}
      <section className={`${card} overflow-hidden`}>
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2 px-4 sm:px-5 py-3.5 border-b border-slate-800/70">
          <h2 className="text-sm font-bold text-white">{t('Paid against the company rate')}</h2>
          <div className="ml-auto flex items-center gap-1.5">
            {(['month', 'supplier', 'bank'] as GroupBy[]).map((g) => (
              <button key={g} type="button" onClick={() => setGroupBy(g)} aria-pressed={groupBy === g}
                className={`${BAR_BTN} px-3 ${groupBy === g ? BAR_BTN_ON : BAR_BTN_OFF}`}>
                {g === 'month' ? t('By month') : g === 'supplier' ? t('By supplier') : t('By bank')}
              </button>
            ))}
          </div>
        </div>
        {loading ? (
          <div className="p-4"><div className="h-10 bg-slate-800/40 rounded-lg animate-pulse" /></div>
        ) : comparisons.length === 0 ? (
          <p className="px-4 sm:px-5 py-6 text-[12.5px] text-slate-500 leading-relaxed max-w-3xl">
            {t('Nothing to compare yet. A PO is compared once it is paid and was raised after a company rate was set for its currency. Enter the rate written on the bank slip with each payment.')}
          </p>
        ) : (
          <>
            <div className="divide-y divide-slate-800/70">
              {summary.map((r) => (
                <div key={`${r.key}·${r.currency}`} className="flex flex-wrap items-baseline gap-x-4 gap-y-0.5 px-4 sm:px-5 py-2.5 text-[12.5px]">
                  <span className="font-semibold text-slate-200 min-w-[10rem]">{keyLabel(r.key)}</span>
                  <span className="text-slate-500">{r.currency} · {r.pos === 1 ? t('one PO') : tf('{n} POs', { n: r.pos })}</span>
                  <span className="text-slate-400 tabular-nums">
                    {tf('paid at {paid} against {company}', { paid: fmtInt(Math.round(r.idr / r.foreign)), company: fmtInt(Math.round(r.benchmarkIdr / r.foreign)) })}
                  </span>
                  <span className={`ml-auto font-semibold tabular-nums ${diffCls(r.diffIdr)}`}>{diffText(r.diffIdr)}</span>
                </div>
              ))}
            </div>
            <div className="border-t border-slate-800 px-4 sm:px-5 pt-3 pb-1 text-[11px] font-bold uppercase tracking-widest text-slate-500">{t('Each PO')}</div>
            <div className="divide-y divide-slate-800/50 pb-1">
              {comparisons.slice(0, 30).map((c) => (
                <div key={c.poId} className="flex flex-wrap items-baseline gap-x-4 gap-y-0.5 px-4 sm:px-5 py-2 text-[12.5px]">
                  <Link href={`/purchasing?tab=lookup&q=${encodeURIComponent(c.poNumber)}`} className="font-semibold text-sky-300 hover:text-sky-200">{c.poNumber || '—'}</Link>
                  <span className="text-slate-500">{supplierName.get(c.supplierId ?? '') ?? ''}</span>
                  <span className="text-slate-400 tabular-nums">
                    {c.currency} · {tf('paid at {paid} against {company}', { paid: fmtInt(Math.round(c.paid.rate)), company: fmtInt(c.benchmarkRate) })}
                    {c.paid.paidOn && <span className="text-slate-500"> · {fmtDay(c.paid.paidOn)}</span>}
                  </span>
                  <span className={`ml-auto font-semibold tabular-nums ${diffCls(c.diffIdr)}`}>{diffText(c.diffIdr)}</span>
                </div>
              ))}
            </div>
          </>
        )}
      </section>
    </div>
  );
}
