/**
 * ICAPROC — Screen Usage. Which screens earn their place in the menu.
 *
 * OWNER, 2026-09-21: *"a new dashboard module that counts the number of visits
 * to which page which module used, the clicks to get to that page… i feel
 * right now there's too many menus and pages but not sure what to get rid of."*
 *
 * The menu has 57 destinations in 7 groups. This screen is the evidence for
 * cutting it down, and it is deliberately NOT a list of view counts: a count
 * says "Market Intel: 3" and leaves the decision exactly where it was. What
 * decides a menu entry is the shape of its use — was it chosen from the menu
 * or hunted for in search, does one person use it or the company, how many
 * clicks deep does it sit. `lib/usage.ts` computes those and states the
 * verdict in a sentence; this page only arranges them.
 *
 * OWNER ONLY (canViewAnalytics), and the log itself is owner-read: it names
 * who opened what.
 */
'use client';
import { useState, useEffect, useMemo, useCallback } from 'react';
import { createSupabaseClient } from '@/lib/supabase';
import { useAuth } from '@/hooks/useAuth';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { ROLE_PERMISSIONS } from '@/constants/roles';
import { canOpenPath, DESTINATIONS } from '@/constants/navigation';
import BrandMenu from '@/components/ui/BrandMenu';
import { BAR_BTN, BAR_BTN_OFF, BAR_BTN_ON } from '@/constants/controls';
import {
  buildUsageReport, byGroup, NAV_SOURCES, MIN_DAYS, MIN_VIEWS,
  type PageViewRow, type NavSource, type Verdict,
} from '@/lib/usage';

const WINDOWS = [7, 30, 90] as const;
type Win = (typeof WINDOWS)[number];

const VERDICT_STYLE: Record<Verdict, { label: string; cls: string }> = {
  core:     { label: 'Core',       cls: 'bg-emerald-500/15 border-emerald-500/40 text-emerald-300' },
  steady:   { label: 'Steady',     cls: 'bg-sky-500/10 border-sky-500/30 text-sky-300' },
  rare:     { label: 'Rare',       cls: 'bg-amber-500/10 border-amber-500/30 text-amber-300' },
  personal: { label: 'One person', cls: 'bg-violet-500/10 border-violet-500/30 text-violet-300' },
  dead:     { label: 'Unopened',   cls: 'bg-slate-700/40 border-slate-600 text-slate-400' },
};

const SOURCE_LABEL: Record<NavSource, string> = {
  menu: 'Menu', spotlight: 'Search', link: 'From a page', direct: 'Typed / refreshed', back: 'Back',
};

const fmtDwell = (ms: number | null): string => {
  if (ms == null) return '—';
  const s = Math.round(ms / 1000);
  return s < 60 ? `${s}s` : `${Math.floor(s / 60)}m ${s % 60}s`;
};
const fmtAgo = (iso: string | null): string => {
  if (!iso) return 'never';
  const days = Math.floor((Date.now() - Date.parse(iso)) / 86_400_000);
  return days <= 0 ? 'today' : days === 1 ? 'yesterday' : `${days}d ago`;
};

export default function UsagePage() {
  const { profile, loading: authLoading } = useAuth();
  const router = useRouter();
  const [win, setWin] = useState<Win>(30);
  const [views, setViews] = useState<PageViewRow[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [showAll, setShowAll] = useState(false);

  const canView = !profile || canOpenPath(ROLE_PERMISSIONS[profile.role], '/usage');
  useEffect(() => {
    if (authLoading) return;
    if (profile && !canOpenPath(ROLE_PERMISSIONS[profile.role], '/usage')) router.replace('/unauthorized');
  }, [authLoading, profile, router]);

  const load = useCallback(async () => {
    setViews(null); setErr(null);
    const since = new Date(Date.now() - win * 86_400_000).toISOString();
    const supabase = createSupabaseClient();
    const { data, error } = await supabase
      .from('42.0_page_views')
      .select('viewed_at,user_email,user_role,session_id,path,dest_href,from_path,nav_source,depth,viewport')
      .gte('viewed_at', since)
      .order('viewed_at', { ascending: true })
      .limit(50000);
    if (error) {
      // The likeliest cause by far is that the migration has not been run. Say
      // that, rather than showing an empty table that reads as "nobody uses
      // anything" — the one wrong answer this page must never give.
      setErr(/42\.0_page_views|does not exist|schema cache/i.test(error.message)
        ? 'The usage log table does not exist yet — run migrations/usage_analytics.sql in Supabase, then reload.'
        : error.message);
      setViews([]);
      return;
    }
    setViews((data ?? []) as PageViewRow[]);
  }, [win]);
  useEffect(() => { if (!authLoading && canView) void load(); }, [authLoading, canView, load]);

  const report = useMemo(() => buildUsageReport(views ?? [], DESTINATIONS), [views]);
  const groups = useMemo(() => byGroup(report.rows), [report.rows]);
  const actionable = useMemo(
    () => report.rows.filter((r) => r.advice).sort((a, b) => a.views - b.views),
    [report.rows],
  );

  if (authLoading || !profile || !canView) {
    return <div className="min-h-screen bg-chrome flex items-center justify-center"><div className="w-6 h-6 border-2 border-emerald-500/30 border-t-emerald-500 rounded-full animate-spin" /></div>;
  }

  const shown = showAll ? report.rows : report.rows.filter((r) => r.inNav);
  const inNavRows = report.rows.filter((r) => r.inNav);

  return (
    <div className="min-h-screen bg-chrome text-slate-200 font-sans text-sm">
      <div className="border-b border-slate-800/60 bg-chrome/80 backdrop-blur-md sticky top-0 z-30">
        <div className="max-w-[1600px] mx-auto px-3 sm:px-4 md:px-6 py-2.5 sm:py-3 flex flex-col sm:flex-row sm:items-center justify-between sm:flex-wrap gap-2.5 sm:gap-x-4 sm:gap-y-2.5">
          <BrandMenu wordmarkClass="text-xl md:text-2xl font-extrabold" subtitle="Screen Usage · what the team actually opens" />
          <div className="flex items-center gap-1.5 flex-wrap justify-end">
            {WINDOWS.map((w) => (
              <button key={w} onClick={() => setWin(w)}
                className={`${BAR_BTN} px-3 ${win === w ? BAR_BTN_ON : BAR_BTN_OFF}`}>
                {w}d
              </button>
            ))}
          </div>
        </div>
      </div>

      <div className="max-w-[1600px] mx-auto px-3 sm:px-4 md:px-6 py-4 sm:py-6 space-y-5">
        {err && (
          <div className="rounded-xl border border-amber-500/40 bg-amber-500/10 px-4 py-3 text-amber-200 text-xs">{err}</div>
        )}

        {/* How much evidence there is. Stated FIRST, because every verdict
            below is worth exactly what this line says it is. */}
        {views === null ? (
          <p className="text-slate-500 text-xs">Reading the log…</p>
        ) : !report.confident ? (
          <div className="rounded-xl border border-sky-500/30 bg-sky-500/10 px-4 py-3">
            <p className="text-sky-200 text-sm font-semibold">Still collecting.</p>
            <p className="text-sky-200/80 text-xs mt-1 leading-relaxed">
              {report.totals.views.toLocaleString()} view{report.totals.views === 1 ? '' : 's'} over {report.coverageDays} day{report.coverageDays === 1 ? '' : 's'}.
              Nothing is recommended for removal until there are at least {MIN_DAYS} days and {MIN_VIEWS} views —
              before that, a quiet fortnight and a dead page look identical, and the difference is a working module deleted by mistake.
            </p>
          </div>
        ) : null}

        <div className="grid grid-cols-2 lg:grid-cols-4 gap-2.5">
          {[
            { k: 'Screens opened', v: report.totals.views.toLocaleString(), sub: `over ${report.coverageDays} day${report.coverageDays === 1 ? '' : 's'}` },
            { k: 'People', v: String(report.totals.people), sub: `${report.totals.sessions} session${report.totals.sessions === 1 ? '' : 's'}` },
            { k: 'Menu entries never opened', v: String(inNavRows.filter((r) => r.views === 0).length), sub: `of ${inNavRows.length} in the menu` },
            { k: 'Reached from the menu', v: report.totals.views ? `${Math.round((report.bySource.menu / report.totals.views) * 100)}%` : '—', sub: `${report.bySource.spotlight} by search · ${report.bySource.link} from a page` },
          ].map((c) => (
            <div key={c.k} className="rounded-xl border border-slate-800 bg-slate-900/40 px-3.5 py-3">
              <p className="text-[10px] font-bold uppercase tracking-wider text-slate-500">{c.k}</p>
              <p className="text-2xl font-extrabold text-white tabular-nums mt-0.5">{c.v}</p>
              <p className="text-[11px] text-slate-500 mt-0.5">{c.sub}</p>
            </div>
          ))}
        </div>

        {/* What to change. The whole reason the page exists. */}
        <section>
          <h2 className="text-[10px] font-bold uppercase tracking-widest text-slate-500 mb-2">What to change</h2>
          {actionable.length === 0 ? (
            <p className="text-slate-500 text-xs rounded-xl border border-slate-800 bg-slate-900/40 px-4 py-3">
              {report.confident
                ? 'Nothing to suggest — every menu entry is opened by more than one person, from the menu, at a sensible depth.'
                : 'Nothing to suggest yet. Come back once the log has a week in it.'}
            </p>
          ) : (
            <ul className="space-y-1.5">
              {actionable.map((r) => (
                <li key={r.href} className="rounded-xl border border-slate-800 bg-slate-900/40 px-3.5 py-2.5 flex items-start gap-3">
                  <span className={`mt-0.5 px-1.5 py-0.5 rounded border text-[9px] font-bold uppercase tracking-wider flex-shrink-0 ${VERDICT_STYLE[r.verdict].cls}`}>
                    {VERDICT_STYLE[r.verdict].label}
                  </span>
                  <div className="min-w-0">
                    <p className="text-white font-semibold text-[13px]">
                      {r.label}
                      <span className="ml-1.5 text-[11px] font-normal text-slate-500">{r.group}{r.inNav ? '' : ' · search only'}</span>
                    </p>
                    <p className="text-slate-400 text-xs mt-0.5 leading-relaxed">{r.advice}</p>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section>
          <h2 className="text-[10px] font-bold uppercase tracking-widest text-slate-500 mb-2">By menu group</h2>
          <div className="grid grid-cols-2 md:grid-cols-4 xl:grid-cols-7 gap-2">
            {groups.map((g) => (
              <div key={g.group} className="rounded-xl border border-slate-800 bg-slate-900/40 px-3 py-2.5">
                <p className="text-[11px] font-semibold text-slate-300 truncate">{g.group}</p>
                <p className="text-lg font-bold text-white tabular-nums">{g.views.toLocaleString()}</p>
                <p className="text-[10px] text-slate-500">{g.entries} entr{g.entries === 1 ? 'y' : 'ies'}{g.dead ? ` · ${g.dead} unopened` : ''}</p>
              </div>
            ))}
          </div>
        </section>

        <section>
          <div className="flex items-center justify-between mb-2 gap-3">
            <h2 className="text-[10px] font-bold uppercase tracking-widest text-slate-500">
              {showAll ? 'Every destination' : 'Menu entries'}
            </h2>
            <button onClick={() => setShowAll((v) => !v)} className={`${BAR_BTN} px-3 ${BAR_BTN_OFF}`}>
              {showAll ? 'Menu only' : 'Include search-only pages'}
            </button>
          </div>
          <div className="overflow-x-auto rounded-xl border border-slate-800">
            <table className="w-full text-xs">
              <thead className="bg-slate-900/95 border-b border-slate-800">
                <tr className="text-left text-[10px] font-bold uppercase tracking-wider text-slate-400">
                  <th className="px-3 py-2">Screen</th>
                  <th className="px-3 py-2">Group</th>
                  <th className="px-3 py-2 text-right">Views</th>
                  <th className="px-3 py-2 text-right">People</th>
                  <th className="px-3 py-2 text-right" title="Typical clicks from landing in the app to standing on this page">Clicks in</th>
                  <th className="px-3 py-2 text-right" title="Typical time before moving on">Time on it</th>
                  <th className="px-3 py-2">How they arrive</th>
                  <th className="px-3 py-2 text-right">Last</th>
                  <th className="px-3 py-2">Verdict</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800/60">
                {shown.map((r) => (
                  <tr key={r.href} className={r.views === 0 ? 'text-slate-500' : ''}>
                    <td className="px-3 py-1.5">
                      <Link href={r.href} className="text-white hover:text-emerald-300 font-medium transition-colors">{r.label}</Link>
                      {!r.inNav && <span className="ml-1.5 text-[9px] uppercase tracking-wider text-slate-600">search only</span>}
                    </td>
                    <td className="px-3 py-1.5 text-slate-400">{r.group}</td>
                    <td className="px-3 py-1.5 text-right tabular-nums font-semibold text-white">{r.views.toLocaleString()}</td>
                    <td className="px-3 py-1.5 text-right tabular-nums" title={r.people.join(', ')}>{r.people.length || '—'}</td>
                    <td className="px-3 py-1.5 text-right tabular-nums">{r.medianDepth ?? '—'}</td>
                    <td className="px-3 py-1.5 text-right tabular-nums">{fmtDwell(r.medianDwellMs)}</td>
                    <td className="px-3 py-1.5">
                      {r.views === 0 ? <span className="text-slate-600">—</span> : (
                        <span className="flex items-center gap-1 flex-wrap">
                          {NAV_SOURCES.filter((s) => r.sources[s] > 0).map((s) => (
                            <span key={s} title={`${SOURCE_LABEL[s]}: ${r.sources[s]}`}
                              className="px-1.5 py-0.5 rounded border border-slate-700 bg-slate-800/60 text-[10px] text-slate-400 whitespace-nowrap">
                              {SOURCE_LABEL[s]} {r.sources[s]}
                            </span>
                          ))}
                        </span>
                      )}
                    </td>
                    <td className="px-3 py-1.5 text-right text-slate-400 whitespace-nowrap">{fmtAgo(r.lastAt)}</td>
                    <td className="px-3 py-1.5">
                      <span className={`px-1.5 py-0.5 rounded border text-[9px] font-bold uppercase tracking-wider whitespace-nowrap ${VERDICT_STYLE[r.verdict].cls}`}>
                        {VERDICT_STYLE[r.verdict].label}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>

        {report.orphans.length > 0 && (
          <section>
            <h2 className="text-[10px] font-bold uppercase tracking-widest text-slate-500 mb-2">Opened, but in neither the menu nor search</h2>
            <p className="text-[11px] text-slate-500 mb-2">
              People reach these, so they exist and are used — they are simply not registered in <code className="text-slate-400">constants/navigation.ts</code>, which means no role gate and no way to find them.
            </p>
            <div className="rounded-xl border border-slate-800 divide-y divide-slate-800/60">
              {report.orphans.slice(0, 20).map((o) => (
                <div key={o.path} className="px-3.5 py-2 flex items-center justify-between gap-3">
                  <code className="text-[11px] text-slate-300 truncate">{o.path}</code>
                  <span className="text-[11px] text-slate-500 tabular-nums flex-shrink-0">{o.views} view{o.views === 1 ? '' : 's'} · {o.people.length} {o.people.length === 1 ? 'person' : 'people'}</span>
                </div>
              ))}
            </div>
          </section>
        )}

        <p className="text-[11px] text-slate-600 leading-relaxed pt-2">
          The log records a normalised path only — <code>/proposals/:id</code>, never which proposal. No search
          terms, no form contents. Staff screens only: the shop, the sign-in page and the printable documents are
          not counted. Identity is stamped by the database rather than sent by the browser, so a row cannot be
          forged, and reads are owner-only.
        </p>
      </div>
    </div>
  );
}
