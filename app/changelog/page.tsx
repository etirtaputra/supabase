'use client';
/**
 * ICAPROC — What's New (/changelog)
 * The update log: what changed, when, at what time — newest first, stamped in
 * the viewer's own timezone via the settings-driven formatters. Entries come
 * from constants/changelog.ts, which every shipped update appends to (house
 * rule, 2026-07-30). Open to every signed-in role: updates affect everyone,
 * and an entry only NAMES features — it carries no data a role can't see.
 */
import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/hooks/useAuth';
import BrandMenu from '@/components/ui/BrandMenu';
import { CHANGELOG } from '@/constants/changelog';
import { fmtDayTime } from '@/lib/formatters';

export default function ChangelogPage() {
  const router = useRouter();
  const { user, loading: authLoading } = useAuth();

  useEffect(() => { document.title = "What's New — ICAPROC"; }, []);
  useEffect(() => {
    if (!authLoading && !user) router.replace(`/login?next=${encodeURIComponent('/changelog')}`);
  }, [authLoading, user, router]);

  if (authLoading || !user) {
    return <div className="min-h-screen bg-chrome flex items-center justify-center"><div className="w-6 h-6 border-2 border-slate-500/30 border-t-slate-300 rounded-full animate-spin" /></div>;
  }

  return (
    <div className="min-h-screen bg-chrome text-slate-200 font-sans text-sm">
      <div className="border-b border-slate-800/60 bg-chrome/80 backdrop-blur-md sticky top-0 z-30">
        <div className="max-w-[860px] mx-auto px-3 sm:px-4 md:px-6 py-2.5 sm:py-3">
          <BrandMenu wordmarkClass="text-xl md:text-2xl font-extrabold" subtitle="What's New · The update log" />
        </div>
      </div>

      <main className="max-w-[860px] mx-auto px-3 sm:px-4 md:px-6 py-4 sm:py-5">
        <p className="text-[11px] text-slate-600 mb-5">
          Every update to ICAPROC, newest first. Times are shown in your own timezone.
        </p>
        <ol className="relative border-l border-slate-800 ml-1.5 space-y-6">
          {CHANGELOG.map((e, i) => (
            <li key={i} className="pl-5 relative">
              <span className="absolute -left-[5px] top-1.5 w-2.5 h-2.5 rounded-full bg-emerald-500/70 ring-4 ring-chrome" />
              <p className="text-[11px] text-slate-500 tabular-nums">{fmtDayTime(e.at)}</p>
              <h2 className="text-sm font-bold text-slate-100 mt-0.5 leading-snug">{e.title}</h2>
              {e.details && e.details.length > 0 && (
                <ul className="mt-1.5 space-y-1">
                  {e.details.map((d, j) => (
                    <li key={j} className="text-xs text-slate-400 leading-relaxed flex gap-2">
                      <span className="text-slate-600 flex-shrink-0 mt-[1px]">·</span>
                      <span>{d}</span>
                    </li>
                  ))}
                </ul>
              )}
            </li>
          ))}
        </ol>
      </main>
    </div>
  );
}
