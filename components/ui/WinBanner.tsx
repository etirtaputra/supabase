'use client';
import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { createSupabaseClient } from '@/lib/supabase';
import { useT } from '@/hooks/useT';
import { fmtDay, fmtRp } from '@/lib/formatters';
import { firstName } from '@/lib/presence';
import { fetchRecentWins, unseenWins, winSeenKey, SEEN_WINS_KEY, type RecentWin } from '@/lib/proposalWins';
import Celebrate from '@/components/ui/Celebrate';

/**
 * "🎉 Won: …" — the team's moment when an EPC proposal is marked won
 * (owner, 2026-10-05). Each person sees each win ONCE, with a confetti burst,
 * until they tap "Nice!"; remembered per browser (a convenience, so storage
 * failing only means seeing it again). Wins from the last 14 days.
 *
 * The CALLER gates it on the /proposals permission — the same people who can
 * open the proposal it names; RLS (can_view_epc) backs that up.
 */
function readSeen(): string[] {
  try { return JSON.parse(localStorage.getItem(SEEN_WINS_KEY) ?? '[]') as string[]; } catch { return []; }
}
function writeSeen(keys: string[]) {
  try { localStorage.setItem(SEEN_WINS_KEY, JSON.stringify(keys.slice(-200))); } catch { /* per-browser nicety */ }
}

export default function WinBanner() {
  const supabase = useMemo(() => createSupabaseClient(), []);
  const { t, tf } = useT();
  const [wins, setWins] = useState<RecentWin[]>([]);
  useEffect(() => {
    let live = true;
    fetchRecentWins(supabase).then((ws) => { if (live) setWins(unseenWins(ws, readSeen())); }).catch(() => {});
    return () => { live = false; };
  }, [supabase]);
  if (!wins.length) return null;

  const dismiss = () => { writeSeen([...readSeen(), ...wins.map(winSeenKey)]); setWins([]); };
  const who = (name: string | undefined, email: string) => firstName(name ?? '', email);

  return (
    <>
      <Celebrate />
      <div role="status" className="flex items-start gap-3 rounded-2xl border border-emerald-500/30 bg-emerald-500/[0.08] px-4 py-3">
        <span aria-hidden className="text-xl leading-6">🎉</span>
        <div className="flex-1 min-w-0 space-y-1">
          {wins.slice(0, 3).map((w) => (
            <Link key={winSeenKey(w)} href={`/proposals/${w.quoteId}`} className="block text-[13px] text-slate-200 hover:text-white">
              <span className="font-bold text-emerald-300">{t('Won!')}</span>{' '}
              {/* Data only — names and a number, no words to translate. */}
              {w.customer}{w.site ? ` — ${w.site}` : ''} · {fmtRp(w.value)}
              <span className="text-slate-500 text-[11px]">
                {' · '}{tf('made by {maker}, marked won by {marker} on {date}', { maker: who(w.madeByName, w.madeBy), marker: who(w.markedByName, w.markedBy), date: fmtDay(w.wonAt) })}
              </span>
            </Link>
          ))}
          {wins.length > 3 && <p className="text-[11px] text-slate-500">{tf('and {n} more wins', { n: wins.length - 3 })}</p>}
        </div>
        <button onClick={dismiss} className="flex-shrink-0 text-[12px] font-semibold text-emerald-300 hover:text-emerald-200">{t('Nice!')}</button>
      </div>
    </>
  );
}
