'use client';
import { useState } from 'react';
import Link from 'next/link';
import { useT } from '@/hooks/useT';
import { useFxBenchmarks } from '@/hooks/useFxBenchmarks';
import { benchmarkLog } from '@/lib/fxBenchmark';
import { fmtDay, fmtInt } from '@/lib/formatters';
import { FOLLOW_PCT } from '@/lib/bcaRate';

/** How long an automatic change stays on the Dashboard. */
const SHOW_DAYS = 3;

/**
 * "The company rate moved by itself" — the warning half of the morning KlikBCA
 * check (owner, 2026-10-24: "warn above 1.5% … update itself"). When the
 * check moved a rate in the last few days, say so where the day starts: new
 * POs and quotes are now planned at it. Nothing when nothing moved.
 */
export default function FxAutoNotice() {
  const { t, tf, lang } = useT();
  const { rows } = useFxBenchmarks();
  // Fixed once per visit: the window does not slide while the page is open.
  const [since] = useState(() => new Date(Date.now() - SHOW_DAYS * 86_400_000).toISOString());
  const moved = benchmarkLog(rows).filter((r) => r.source === 'bca-erate' && r.set_at >= since && r.previous != null);
  if (!moved.length) return null;
  return (
    <div className="rounded-2xl border border-amber-500/40 bg-amber-500/10 px-4 py-3 sm:px-5 text-[12.5px] flex flex-wrap items-center gap-x-4 gap-y-1.5">
      <span className="text-[11px] font-bold uppercase tracking-widest text-amber-300">{t('Company rate updated')}</span>
      {moved.map((r) => {
        const pct = (Number(r.rate) / r.previous! - 1) * 100;
        return (
          <span key={r.benchmark_id} className="text-slate-200 tabular-nums">
            {tf('{ccy} {from} → {to} ({pct}%) on {date}', {
              ccy: r.currency, from: fmtInt(r.previous!), to: fmtInt(Number(r.rate)),
              pct: `${pct > 0 ? '+' : ''}${pct.toFixed(1)}`, date: fmtDay(r.set_at),
            })}
          </span>
        );
      })}
      <span className="text-slate-400">{tf('KlikBCA e-Rate moved more than {pct}%. New POs and quotes now use it.', { pct: FOLLOW_PCT.toLocaleString(lang === 'id' ? 'id-ID' : 'en-GB') })}</span>
      <Link href="/settings?tab=fx" className="ml-auto text-amber-200 hover:text-amber-100 font-semibold whitespace-nowrap">{t('Exchange rates')} →</Link>
    </div>
  );
}
