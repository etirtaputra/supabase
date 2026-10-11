'use client';
/**
 * BOM Calculator (beta) — the list. One row per saved calculation, with the
 * plant size and the price it works out to, recomputed from its inputs on the
 * spot (lib/bomCalc): a stored total could go stale, a recomputed one cannot.
 *
 * Beside the EPC proposals, never inside them: nothing here reads or writes
 * 10.0–10.5. Same door as the proposals' costs (canEditQuotes).
 */
import React, { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { createSupabaseClient } from '@/lib/supabase';
import { selectAll } from '@/lib/fetchAllRows';
import { useQuotesGate } from '@/hooks/useQuotesGate';
import { usePageTitle } from '@/hooks/usePageTitle';
import { useT } from '@/hooks/useT';
import { fmtRp } from '@/lib/formatters';
import { BAR_BTN, BAR_BTN_ON, BAR_INPUT } from '@/constants/controls';
import { computeBomCalc, newBomCalcDoc, type BomCalcDoc } from '@/lib/bomCalc';

interface CalcRow { calc_id: string; title: string; doc: BomCalcDoc; updated_at: string; updated_by_email: string | null }

export default function BomCalcListPage() {
  const { ready, user } = useQuotesGate(false, '/proposals/bom');
  const { t, tf } = useT();
  usePageTitle();
  const router = useRouter();
  const supabase = createSupabaseClient();
  const [rows, setRows] = useState<CalcRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [q, setQ] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!ready) return;
    let alive = true;
    selectAll<CalcRow>((f, to) => supabase.from('10.6_bom_calcs')
      .select('calc_id, title, doc, updated_at, updated_by_email')
      .order('updated_at', { ascending: false }).order('calc_id').range(f, to))
      .then(({ data, error: e }) => { if (!alive) return; if (e) setError(e.message); setRows(data ?? []); });
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready]);

  const shown = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return (rows ?? [])
      .filter((r) => !needle || `${r.title} ${r.doc?.project?.customer ?? ''} ${r.doc?.project?.location ?? ''}`.toLowerCase().includes(needle))
      .map((r) => {
        let kwp = 0, total = 0, perWp: number | null = null, errors = 0;
        try {
          const res = computeBomCalc(r.doc);
          kwp = res.plantWp / 1000; total = res.totals.total; perWp = res.totals.perWp;
          errors = res.checks.filter((c) => c.level === 'error').length;   // real faults only — unpriced rows are warnings
        } catch { /* an unreadable document still lists, so it can be opened and fixed */ }
        return { ...r, kwp, total, perWp, errors };
      });
  }, [rows, q]);

  const create = async () => {
    setBusy(true);
    const { data, error: e } = await supabase.from('10.6_bom_calcs')
      .insert({ title: t('New calculation'), doc: newBomCalcDoc(), created_by_email: user?.email ?? null, updated_by_email: user?.email ?? null })
      .select('calc_id').single();
    setBusy(false);
    if (e || !data) { setError(e?.message ?? t('Could not create the calculation.')); return; }
    router.push(`/proposals/bom/${data.calc_id}`);
  };

  if (!ready) return null;
  return (
    <div className="max-w-6xl mx-auto px-4 py-6 space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <div className="flex-1 min-w-[220px]">
          <h1 className="text-lg font-bold text-white">{t('BOM Calculator')} <span className="text-[11px] font-semibold text-amber-300 align-middle">beta</span></h1>
          <p className="text-xs text-slate-500">{t('Strings, cables and the priced Bill of Material calculated from one set of inputs — no hand-made links between sheets. Separate from the proposals; nothing here changes them.')}</p>
        </div>
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder={t('Search customer or title…')} className={`${BAR_INPUT} w-full sm:w-64`} />
        <button onClick={create} disabled={busy} className={`${BAR_BTN} ${BAR_BTN_ON} px-3 disabled:opacity-50`}>{t('New calculation')}</button>
      </div>
      {error && <div className="px-3 py-2 bg-red-500/10 border border-red-500/25 rounded-lg text-xs text-red-300">{error}</div>}
      {rows === null ? (
        <p className="text-xs text-slate-500">{t('Loading…')}</p>
      ) : shown.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-slate-700 p-8 text-center text-sm text-slate-400">
          {rows.length ? t('Nothing matches the search.') : t('No calculations yet. Start one — it opens with the standard layout and every row ready to price.')}
        </div>
      ) : (
        <div className="rounded-2xl border border-slate-800 overflow-hidden">
          <table className="w-full text-xs">
            <thead>
              <tr className="bg-slate-800/50 text-[10px] uppercase tracking-wider text-slate-500">
                <th className="px-3 py-2 text-left">{t('Calculation')}</th>
                <th className="px-3 py-2 text-right">kWp</th>
                <th className="px-3 py-2 text-right">{t('Total (excl. PPN)')}</th>
                <th className="px-3 py-2 text-right">Rp/Wp</th>
                <th className="px-3 py-2 text-left">{t('Updated')}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800/60">
              {shown.map((r) => (
                <tr key={r.calc_id} className="hover:bg-white/[0.02]">
                  <td className="px-3 py-2">
                    <Link href={`/proposals/bom/${r.calc_id}`} className="text-emerald-300 hover:text-emerald-200 font-semibold">{r.title || t('Untitled')}</Link>
                    <div className="text-[11px] text-slate-500">{[r.doc?.project?.customer, r.doc?.project?.location].filter(Boolean).join(' — ')}</div>
                    {r.errors > 0 && <div className="text-[10px] text-red-300">{tf('{n} problems to fix', { n: r.errors })}</div>}
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums text-slate-300">{r.kwp ? r.kwp.toLocaleString('en-US', { maximumFractionDigits: 2 }) : '—'}</td>
                  <td className="px-3 py-2 text-right tabular-nums text-white">{r.total ? fmtRp(r.total) : '—'}</td>
                  <td className="px-3 py-2 text-right tabular-nums text-slate-300">{r.perWp ? Math.round(r.perWp).toLocaleString('en-US') : '—'}</td>
                  <td className="px-3 py-2 text-slate-500 whitespace-nowrap">{new Date(r.updated_at).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: '2-digit' })}<div className="text-[10px]">{r.updated_by_email?.split('@')[0]}</div></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
