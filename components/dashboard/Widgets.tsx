'use client';
import { useState, useEffect, useCallback } from 'react';
import Link from 'next/link';
import { createSupabaseClient } from '@/lib/supabase';
import { fmtIdr, fmtInt, parseDate } from '@/lib/formatters';
import { getSettings } from '@/lib/settings';
import FitText from '@/components/ui/FitText';
import { useT } from '@/hooks/useT';
import type { ActionItem, ActivityRow } from '@/lib/dashboard';
import type { PositionData, MotionRow } from '@/lib/position';
import type { ShortageAlert, ReorderAlert } from '@/lib/reorder';
import type { NewArrival, ArrivingSummary } from '@/lib/catalogSignals';
import type { RankBy, Leaderboard } from '@/lib/salesFacts';
import type { Feed } from '@/lib/recentFeeds';
import type { RolePermissions } from '@/constants/roles';

/**
 * The Dashboard's widgets, lifted out of the page that renders them.
 *
 * They lived inside app/page.tsx, which made them unreachable to anything
 * else — including the component preview. Three of the last four faults the
 * owner reported were VISUAL (a colour that resolved to nothing, spacing that
 * inherited as the wrong unit, a column that did not line up); none of them
 * could be caught by a test, and none of these widgets could be rendered
 * anywhere a human might look at them before they shipped. Now they can.
 *
 * Every one takes its data as PROPS and fetches nothing — the page owns the
 * queries. That is what lets app/preview drive them with fabricated rows, no
 * database and no sign-in. NextStepCard is the single exception: it asks the
 * advisor API for its sentence, and says so on its own face when that fails.
 */

function fmtDate(d?: string | null) {
  const dt = parseDate(d);
  if (!dt) return '';
  return dt.toLocaleDateString(getSettings().dateLocaleInternal, { day: '2-digit', month: 'short' });
}

export function KpiTile({ label, value, sub, color, ring }: {
  label: string; value: string; sub: string; color: string; ring: string;
}) {
  return (
    <div className={`bg-slate-900/60 border border-slate-800/80 ring-1 ${ring} rounded-2xl p-4 xl:p-5`}>
      <p className="text-[10px] xl:text-[11px] font-semibold uppercase tracking-widest text-slate-500 mb-1.5">{label}</p>
      <p className={`text-2xl xl:text-3xl font-extrabold tabular-nums ${color} leading-none`}><FitText text={value} /></p>
      <p className="text-[11px] text-slate-600 mt-1.5">{sub}</p>
    </div>
  );
}

/** Where this role starts its day — text only, no emoji (owner's rule). */
export function QuickActions({ items }: { items: { href: string; label: string; accent: string }[] }) {
  const { t } = useT();
  return (
    <div className="bg-slate-900/40 border border-slate-800/80 ring-1 ring-white/5 rounded-2xl p-5">
      <p className="text-[10px] font-semibold uppercase tracking-widest text-slate-500 mb-3">{t('Quick Actions')}</p>
      <div className="space-y-2">
        {items.map(({ href, label, accent }) => (
          <Link key={href} href={href}
            className="flex items-center gap-3 px-3 py-2.5 rounded-xl bg-slate-800/30 hover:bg-slate-800/60 border border-transparent hover:border-slate-700 transition-colors group">
            <span className={`w-1.5 h-1.5 rounded-full ${DOT[accent]}`} />
            <span className="text-sm text-slate-300 group-hover:text-white transition-colors">{t(label)}</span>
            <span className="ml-auto text-slate-700 group-hover:text-slate-400 transition-colors">→</span>
          </Link>
        ))}
      </div>
    </div>
  );
}

// ── Accent maps ───────────────────────────────────────────────────────────────
const DOT: Record<string, string> = {
  emerald: 'bg-emerald-400', violet: 'bg-violet-400', blue: 'bg-blue-400',
  amber: 'bg-amber-400', rose: 'bg-rose-400',
};

// Domain colours follow the app: buy = sky, sell = emerald, EPC = violet.
// Cash is amber — it is neither side, it is the thing both sides move.
const DOMAIN_DOT: Record<string, string> = {
  sell: 'bg-emerald-400', buy: 'bg-sky-400', cash: 'bg-amber-400', epc: 'bg-violet-400',
};
const DOMAIN_TEXT: Record<string, string> = {
  sell: 'text-emerald-300', buy: 'text-sky-300', cash: 'text-amber-300', epc: 'text-violet-300',
};


/**
 * The head of a list card: a title, an optional count, an optional link.
 *
 * FOUR panels had hand-copied this row, and all four broke the same way on a
 * phone (owner's screenshots, 2026-08-23): one flex line with no wrapping rule,
 * so the browser broke INSIDE the phrases — "Needs you / today", "4 / ITEMS",
 * "IDR / 2.816.173.107", "New / arrivals". A head that must wrap should wrap
 * BETWEEN its parts and never inside one, which is one rule, so it lives in
 * one place.
 */
function CardHead({ title, meta, right }: {
  title: string;
  meta?: React.ReactNode;
  right?: React.ReactNode;
}) {
  return (
    <div className="flex items-center gap-x-3 gap-y-1 flex-wrap px-4 sm:px-5 py-3.5 border-b border-slate-800/70">
      <h2 className="text-sm font-bold text-white whitespace-nowrap">{title}</h2>
      {meta != null && meta !== '' && (
        <span className="text-[10px] font-bold uppercase tracking-widest text-slate-500 whitespace-nowrap">{meta}</span>
      )}
      {/* gap-x-3 — the SAME gap the rows below put between their last figure
          and their arrow, so a spacer placed here lands the head's total on
          exactly the column the rows use. */}
      {right && <div className="ml-auto flex items-baseline gap-x-3 whitespace-nowrap">{right}</div>}
    </div>
  );
}

/**
 * The queue is the point of the dashboard: what is stuck, what it is worth,
 * and one tap to the screen that unsticks it. Ranked by money, not recency.
 */
export function ActionQueue({ items, atStake }: { items: ActionItem[] | null; atStake: number }) {
  return (
    <div className="bg-slate-900/60 border border-slate-800/80 ring-1 ring-white/5 rounded-2xl overflow-hidden">
      <CardHead
        title="Needs you today"
        meta={items && items.length > 0 ? `${items.length} item${items.length !== 1 ? 's' : ''}` : ''}
        right={atStake > 0 && (
          <>
            <span className="flex items-baseline gap-2">
              <span className="text-[10px] uppercase tracking-widest text-slate-500">At stake</span>
              <span className="text-sm font-extrabold tabular-nums text-amber-300">{fmtIdr(atStake)}</span>
            </span>
            {/* From `sm` up every row ends with a "→", so a total flush to the
                card's padding would sit further right than the figures it
                totals. This reserves the arrow's exact width — the arrow
                itself, hidden, rather than a guessed padding — so the money
                column shares one right edge whatever the font does to the
                glyph. Same fix as the customer list header, 2026-08-19.
                NOT on a phone: there the amount drops to its own line with no
                arrow beside it, so reserving the width pushed the total 24px
                inside the column it totals (owner's screenshot, 2026-08-24). */}
            <span aria-hidden className="hidden sm:inline flex-shrink-0 invisible">→</span>
          </>
        )}
      />

      {items === null ? (
        <div className="p-4 sm:p-5 space-y-2">
          {[...Array(3)].map((_, i) => <div key={i} className="h-14 bg-slate-800/40 rounded-xl animate-pulse" />)}
        </div>
      ) : items.length === 0 ? (
        <p className="px-5 py-8 text-center text-xs text-slate-500">
          Nothing is blocked — every confirmed order can ship, and no invoice or quotation is waiting on a chase.
        </p>
      ) : (
        <div className="divide-y divide-slate-800/50">
          {items.map((it) => (
            /* On a phone the money takes its own line under the title rather
               than squeezing it: "23 POs costing mo…" told you nothing, and a
               rupiah figure is the one thing here that must never be clipped.
               The `order` classes put it back beside the arrow from `sm` up,
               where the whole row fits — and BEFORE the arrow, which is what
               keeps this column under the header's At-stake total. */
            <Link key={it.key} href={it.href}
              className="flex items-center gap-x-3 gap-y-1 flex-wrap px-4 sm:px-5 py-3 hover:bg-slate-800/40 transition-colors group">
              <span className={`order-1 rounded-full flex-shrink-0 ${DOMAIN_DOT[it.domain]} ${it.tone === 'urgent' ? 'w-2 h-2' : 'w-1.5 h-1.5 opacity-60'}`} />
              <div className="order-2 min-w-0 flex-1">
                <p className={`text-[13px] font-semibold truncate ${it.tone === 'urgent' ? 'text-white' : 'text-slate-200'}`}>{it.title}</p>
                <p className="text-[11px] text-slate-500 truncate mt-0.5">{it.detail}</p>
              </div>
              {it.amount > 0 && (
                <span className={`order-4 sm:order-3 w-full sm:w-auto text-right sm:text-left pl-5 sm:pl-0 flex-shrink-0 text-sm font-extrabold tabular-nums whitespace-nowrap ${it.tone === 'urgent' ? 'text-amber-300' : DOMAIN_TEXT[it.domain]}`}>
                  {fmtIdr(it.amount)}
                </span>
              )}
              <span className="order-3 sm:order-4 flex-shrink-0 text-slate-700 group-hover:text-slate-400 transition-colors">→</span>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}

/**
 * What just landed — and what still cannot be sold.
 *
 * A newsfeed of arrivals would be pleasant and useless. The useful half is the
 * gap it exposes: goods sitting on the shelf that nobody has priced, so no
 * salesperson can quote them. That badge is the reason this panel exists.
 *
 * Deliberately free of money and suppliers, so a sell-side login sees exactly
 * what a buyer sees: what came in, how much of it, and when.
 */
export function NewArrivals({ rows, days }: { rows: NewArrival[] | null; days: number }) {
  const { tf } = useT();
  const fresh = rows?.filter((r) => r.brandNew).length ?? 0;
  const unpriced = rows?.filter((r) => r.needsPrice).length ?? 0;
  const SHOWN = 6;
  return (
    <div className="bg-slate-900/60 border border-slate-800/80 ring-1 ring-white/5 rounded-2xl overflow-hidden">
      <CardHead
        title="New arrivals"
        meta={rows && rows.length > 0
          ? [fresh > 0 ? `${fresh} new` : '', rows.length > fresh ? `${rows.length - fresh} restocked` : ''].filter(Boolean).join(' · ')
          : ''}
        right={(
          <Link href="/products?new=1" className="text-[11px] text-slate-500 hover:text-emerald-300 transition-colors">
            Products →
          </Link>
        )}
      />

      {rows === null ? (
        <div className="p-4 sm:p-5 space-y-2">
          {[...Array(3)].map((_, i) => <div key={i} className="h-10 bg-slate-800/40 rounded-xl animate-pulse" />)}
        </div>
      ) : rows.length === 0 ? (
        <p className="px-5 py-8 text-center text-xs text-slate-500">
          {tf('Nothing has landed in the last {days} days. Settings › Defaults sets how long an item counts as new.', { days })}
        </p>
      ) : (
        <>
          <div className="divide-y divide-slate-800/50">
            {rows.slice(0, SHOWN).map((r) => (
              /* One shape at every width. On a phone this row used to wrap
                 wherever the item name happened to end — the New badge on line
                 one for a short name, on line two for a long one, so six rows
                 made six different shapes (owner's screenshot, 2026-08-23).
                 The zero-height `basis-full` spacer is a deliberate line break
                 below `sm`: the NAME gets the first line to itself, the badges
                 the second. Above `sm` the break is display:none and the row
                 is exactly what it always was. */
              <Link key={r.component_id} href={`/products?q=${encodeURIComponent(r.name)}`}
                className="flex items-center gap-x-2.5 gap-y-1 flex-wrap px-4 sm:px-5 py-2.5 hover:bg-slate-800/40 transition-colors group">
                <span className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${r.brandNew ? 'bg-emerald-400' : 'bg-slate-600'}`} />
                <span className="min-w-0 flex-1 sm:flex-none sm:max-w-[300px] text-[13px] font-semibold text-slate-100 group-hover:text-white truncate">{r.name}</span>
                <span aria-hidden className="basis-full h-0 sm:hidden" />
                {r.brandNew && (
                  <span className="text-[9px] font-bold uppercase tracking-widest px-1.5 py-0.5 rounded-md bg-emerald-500/15 text-emerald-300 ring-1 ring-emerald-500/25"
                    title="The first time we have ever taken this item into stock">
                    New
                  </span>
                )}
                <span className="text-[11px] tabular-nums text-slate-400">{fmtInt(r.qty)}{r.unit ? ` ${r.unit}` : ''}</span>
                {r.needsPrice && (
                  <span className="text-[10px] font-bold text-amber-300"
                    title="It is on the shelf but has no selling price, so nobody can quote it">
                    no selling price
                  </span>
                )}
                <span className="ml-auto flex-shrink-0 text-[10px] tabular-nums text-slate-500">
                  {r.daysAgo === 0 ? 'today' : `${r.daysAgo}d ago`}
                </span>
              </Link>
            ))}
          </div>
          <div className="px-4 sm:px-5 py-2.5 border-t border-slate-800/70 flex items-center gap-3 flex-wrap">
            {unpriced > 0 ? (
              <span className="text-[11px] text-amber-300/90">
                {unpriced} of {rows.length} cannot be quoted yet — no selling price.
              </span>
            ) : (
              <span className="text-[11px] text-slate-600">Everything that landed has a price.</span>
            )}
            {rows.length > SHOWN && (
              <Link href="/products?new=1" className="ml-auto text-[11px] text-slate-500 hover:text-emerald-300 transition-colors">
                +{rows.length - SHOWN} more →
              </Link>
            )}
          </div>
        </>
      )}
    </div>
  );
}

/**
 * What is on the water, and when it should land.
 *
 * The honesty is the design. A date the supplier stamped on the PO and a date
 * we ESTIMATED from that supplier's own history are not the same promise, so
 * the panel marks the estimates and counts the POs carrying no date at all.
 *
 * And it refuses to pretend about the awkward case: an open PO long past its
 * expected date with not one receipt booked against it is either a late
 * shipment or goods that arrived and were never received into the system. The
 * panel says so and points at the lookup rather than picking one — that count
 * is buy-side, because it is a purchasing question, not a sales one.
 */
export function ArrivingSoon({ data, buySide }: { data: ArrivingSummary | null; buySide: boolean }) {
  const { t } = useT();
  const SHOWN = 5;
  const rows = data ? [...data.soon, ...data.late] : null;
  const when = (r: { expected: string | null; daysAway: number | null; overdue: boolean }) => {
    if (!r.expected) return 'no date';
    if (r.overdue) return `${Math.abs(r.daysAway ?? 0)}d late`;
    return r.daysAway === 0 ? 'today' : `in ${r.daysAway}d`;
  };
  return (
    <div className="bg-slate-900/60 border border-slate-800/80 ring-1 ring-white/5 rounded-2xl overflow-hidden">
      <CardHead
        title="Arriving soon"
        meta={data && rows!.length > 0
          ? `${rows!.length} item${rows!.length !== 1 ? 's' : ''}${data.late.length > 0 ? ` · ${data.late.length} late` : ''}`
          : ''}
        right={buySide && (
          <Link href="/purchasing?tab=lookup" className="text-[11px] text-slate-500 hover:text-sky-300 transition-colors">
            Deal Lookup →
          </Link>
        )}
      />

      {data === null ? (
        <div className="p-4 sm:p-5 space-y-2">
          {[...Array(3)].map((_, i) => <div key={i} className="h-10 bg-slate-800/40 rounded-xl animate-pulse" />)}
        </div>
      ) : rows!.length === 0 ? (
        <p className="px-5 py-8 text-center text-xs text-slate-500">
          {t('Nothing is on order — every purchase order has been received or closed.')}
        </p>
      ) : (
        <>
          <div className="divide-y divide-slate-800/50">
            {rows!.slice(0, SHOWN).map((r) => (
              <div key={r.component_id} className="flex items-center gap-x-2.5 gap-y-1 flex-wrap px-4 sm:px-5 py-2.5">
                <span className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${r.overdue ? 'bg-amber-400' : 'bg-sky-400'}`} />
                <span className="min-w-0 flex-1 sm:flex-none sm:max-w-[280px] text-[13px] font-semibold text-slate-100 truncate">{r.name}</span>
                {/* The phone line break — see New arrivals above. */}
                <span aria-hidden className="basis-full h-0 sm:hidden" />
                <span className="text-[11px] tabular-nums text-slate-400">{fmtInt(r.qty)}{r.unit ? ` ${r.unit}` : ''}</span>
                {/* An estimate never wears the clothes of a promise. */}
                {r.source && r.source !== 'eta' && (
                  <span className="text-[10px] text-slate-500"
                    title="Estimated from this supplier's own measured lead time — the supplier gave us no date">
                    est.
                  </span>
                )}
                {buySide && r.pos.length > 0 && (
                  <span className="font-mono text-[10px] text-slate-600 truncate max-w-[140px]">{r.pos.join(' · ')}</span>
                )}
                <span className={`ml-auto flex-shrink-0 text-[11px] font-bold tabular-nums ${r.overdue ? 'text-amber-300' : 'text-sky-300'}`}>
                  {when(r)}
                </span>
              </div>
            ))}
          </div>
          <div className="px-4 sm:px-5 py-2.5 border-t border-slate-800/70 space-y-1">
            {data.posWithoutEta > 0 && (
              <p className="text-[11px] text-slate-600">
                {data.posWithoutEta} of {data.openPos} open PO{data.openPos !== 1 ? 's' : ''} carry no supplier date — those are estimates.
              </p>
            )}
            {buySide && data.stalePos > 0 && (
              <p className="text-[11px] text-amber-300/90">
                {data.stalePos} PO{data.stalePos !== 1 ? 's are' : ' is'} past due with nothing received
                {data.oldestStaleDays != null ? `, the oldest raised ${data.oldestStaleDays} days ago` : ''} — late, or already here and never booked in.
              </p>
            )}
            {rows!.length > SHOWN && (
              <p className="text-[11px] text-slate-600">+{rows!.length - SHOWN} more on order.</p>
            )}
          </div>
        </>
      )}
    </div>
  );
}

/**
 * One kind of event, five deep — the narrow counterpart to the mixed activity
 * stream beside it.
 *
 * The stream answers "what has everyone been doing"; these answer "show me the
 * payments", which is a different question and a poor one to answer by
 * scrolling past everything else. Same rows, same links, different question.
 *
 * WHAT IT DOES NOT CONTAIN IS PART OF WHAT IT SAYS. A payments feed for a
 * sell-side reader holds customer receipts and nothing else, because supplier
 * payments are the buy price read backwards and buy-side only. A list headed
 * "Last payments" showing half the payments would read as all of them, so the
 * card names the directions it carries.
 */
export function FeedCard({ title, feed, href, empty, showMoney = false }: {
  title: string;
  feed: Feed | null;
  href: string;
  empty: string;
  showMoney?: boolean;
}) {
  const { t } = useT();
  const both = feed?.includes.includes('in') && feed?.includes.includes('out');
  const half = feed && !both && (feed.includes.includes('in') || feed.includes.includes('out'));
  return (
    <div className="bg-slate-900/40 border border-slate-800/80 ring-1 ring-white/5 rounded-2xl overflow-hidden h-full flex flex-col">
      <div className="flex items-center gap-2.5 px-4 py-3 border-b border-slate-800/70">
        <h2 className="text-sm font-bold text-white flex-1 min-w-0 truncate">{title}</h2>
        <Link href={href} className="text-[11px] text-slate-500 hover:text-emerald-300 transition-colors whitespace-nowrap">
          {t('All')} →
        </Link>
      </div>

      {feed === null ? (
        <div className="p-4 space-y-2">
          {[...Array(4)].map((_, i) => <div key={i} className="h-8 bg-slate-800/40 rounded-lg animate-pulse" />)}
        </div>
      ) : feed.rows.length === 0 ? (
        <p className="px-4 py-8 text-center text-xs text-slate-500 flex-1">{t(empty)}</p>
      ) : (
        <div className="divide-y divide-slate-800/50 flex-1">
          {feed.rows.map((r) => (
            <Link key={r.key} href={r.href}
              className="flex items-baseline gap-2 px-4 py-2 hover:bg-slate-800/40 transition-colors group">
              {/* Direction is the first thing read on a money row: emerald in,
                  rose out — the colours the rest of the app already uses. */}
              <span className={`w-1.5 h-1.5 rounded-full self-center flex-shrink-0 ${
                r.direction === 'in' ? 'bg-emerald-400' : r.direction === 'out' ? 'bg-rose-400' : 'bg-slate-600'}`} />
              <span className="min-w-0 flex-1">
                <span className="block text-[12px] font-semibold text-slate-200 group-hover:text-white truncate">{r.title}</span>
                <span className="block text-[10px] text-slate-500 truncate">
                  {r.sub}
                  {r.badge ? ` · ${r.badge}` : ''}
                </span>
              </span>
              <span className="flex-shrink-0 text-right">
                {showMoney && r.amount != null && (
                  <span className={`block text-[12px] font-extrabold tabular-nums ${
                    r.direction === 'out' ? 'text-rose-300' : 'text-emerald-300'}`}>
                    {fmtIdr(r.amount)}
                  </span>
                )}
                <span className="block text-[10px] tabular-nums text-slate-600">{fmtDate(r.at)}</span>
              </span>
            </Link>
          ))}
        </div>
      )}

      {/* Only where it changes the meaning: a feed carrying one direction of
          the money must not be read as carrying both. */}
      {half && (
        <p className="px-4 py-2 border-t border-slate-800/70 text-[10px] text-slate-600">
          {feed!.includes.includes('in')
            ? t('Money in only — supplier payments are buy-side.')
            : t('Money out only — customer receipts are not shown here.')}
        </p>
      )}
    </div>
  );
}

/**
 * A league table — the ten names that earned the most, and how much of the
 * whole they are.
 *
 * TWO MEASURES, ONE BOARD. Revenue and gross profit answer different
 * questions and routinely disagree: the biggest seller is often not the
 * biggest earner, and seeing that flip when you press Profit is the entire
 * value of putting them on one card. The choice is remembered per person.
 *
 * PROFIT IS NOT OFFERED TO EVERYONE. Gross profit is revenue minus what the
 * goods cost us, so the toggle appears only for a role that may see item
 * economics — and for anyone else the cost is never even fetched, so the board
 * ranks by revenue and says which measure it used rather than quietly serving
 * a different one.
 *
 * THE SHARE IS PART OF THE ANSWER. "Top 10" of four names says almost nothing;
 * the same four with "62% of everything delivered" says whether the business
 * rests on one customer. The bar is that share, not a bar for its own sake.
 */
export function TopBoard({ title, board, by, onPick, noun, period, canProfit, href }: {
  title: string;
  board: Leaderboard | null;
  by: RankBy;
  onPick: (b: RankBy) => void;
  noun: string;
  period: string;
  canProfit: boolean;
  href: string;
}) {
  const { t, tf } = useT();
  // The toggle needs BOTH: permission to see cost, and cost actually in hand.
  const profitOffered = canProfit && (board?.profitKnown ?? false);
  const measure = (r: { revenue: number; profit: number }) => (by === 'profit' ? r.profit : r.revenue);
  const windowLabel = period === 'all' ? t('all time') : tf('last {days} days', { days: period });

  return (
    <div className="bg-slate-900/60 border border-slate-800/80 ring-1 ring-white/5 rounded-2xl overflow-hidden">
      <div className="flex items-center gap-2.5 px-4 sm:px-5 py-3.5 border-b border-slate-800/70 flex-wrap">
        <h2 className="text-sm font-bold text-white">{title}</h2>
        <span className="text-[10px] uppercase tracking-widest text-slate-600">{windowLabel}</span>
        {profitOffered && (
          <div className="ml-auto flex items-center gap-0.5 p-0.5 rounded-lg border border-slate-800 bg-slate-900/60">
            {(['revenue', 'profit'] as RankBy[]).map((k) => (
              <button key={k} onClick={() => onPick(k)} aria-pressed={by === k}
                className={`px-2 py-0.5 rounded-md text-[11px] font-semibold transition-colors ${
                  by === k ? 'bg-emerald-500/15 text-emerald-300' : 'text-slate-500 hover:text-slate-200'}`}>
                {k === 'revenue' ? t('Revenue') : t('Profit')}
              </button>
            ))}
          </div>
        )}
        <Link href={href} className={`${profitOffered ? '' : 'ml-auto'} text-[11px] text-slate-500 hover:text-emerald-300 transition-colors whitespace-nowrap`}>
          {t('Details')} →
        </Link>
      </div>

      {board === null ? (
        <div className="p-4 sm:p-5 space-y-2">
          {[...Array(4)].map((_, i) => <div key={i} className="h-7 bg-slate-800/40 rounded-lg animate-pulse" />)}
        </div>
      ) : board.rows.length === 0 ? (
        <p className="px-5 py-8 text-center text-xs text-slate-500">
          {t('Nothing has been delivered in this period yet. A sale counts from the day the goods ship, not the day the order is signed.')}
        </p>
      ) : (
        <>
          <ol className="divide-y divide-slate-800/50">
            {board.rows.map((r, i) => {
              const v = measure(r);
              const negative = v < 0;
              return (
                <li key={r.key} className="relative px-4 sm:px-5 py-2">
                  {/* The share, drawn behind the row rather than beside it, so
                      the numbers stay on one line on a phone. */}
                  <span aria-hidden className="absolute inset-y-0 left-0 bg-emerald-500/[0.07]"
                    style={{ width: `${Math.round(r.share * 100)}%` }} />
                  <div className="relative flex items-baseline gap-2.5">
                    <span className="text-[10px] font-bold tabular-nums text-slate-600 w-4 flex-shrink-0">{i + 1}</span>
                    <span className="min-w-0 flex-1">
                      <span className="block text-[13px] font-semibold text-slate-100 truncate">{r.name}</span>
                      <span className="block text-[10px] text-slate-500 truncate">
                        {r.sub}
                        {by === 'profit' && r.margin != null && ` · ${r.margin.toFixed(0)}% margin`}
                        {r.estimated && ` · ${t('cost estimated')}`}
                      </span>
                    </span>
                    <span className={`flex-shrink-0 text-[13px] font-extrabold tabular-nums ${
                      negative ? 'text-rose-300' : by === 'profit' ? 'text-emerald-300' : 'text-slate-100'}`}>
                      {fmtIdr(v)}
                    </span>
                  </div>
                </li>
              );
            })}
          </ol>
          <div className="px-4 sm:px-5 py-2.5 border-t border-slate-800/70 space-y-1">
            <p className="text-[11px] text-slate-600">
              {/* The denominator, always — a top ten of four is not a league
                  table, and saying so costs one line. */}
              {board.ranked <= board.rows.length
                ? tf('All {n} {noun}s that have sold in this period.', { n: board.ranked, noun })
                : tf('Top {shown} of {n} {noun}s that have sold.', { shown: board.rows.length, n: board.ranked, noun })}
              {board.total > 0 && ` ${tf('These carry {pct}% of the total.',
                { pct: Math.round(board.rows.reduce((s, r) => s + r.share, 0) * 100) })}`}
            </p>
            {!profitOffered && canProfit && (
              <p className="text-[11px] text-slate-600">{t('Ranked by revenue — the cost of these goods could not be read.')}</p>
            )}
            {board.anyEstimated && by === 'profit' && (
              <p className="text-[11px] text-amber-300/80">
                {t('Some of this profit uses today’s average cost, because those deliveries predate the stock ledger.')}
              </p>
            )}
          </div>
        </>
      )}
    </div>
  );
}

/**
 * The warehouse's two alarms on the dashboard itself: Shortages = committed
 * orders that cannot ship today (red, /stock's exact rule), Reorder = items
 * whose live + incoming just crossed the reorder point (amber — demand rate ×
 * measured lead time says the next PO is due). Full detail stays on /stock;
 * this section is the daily glance.
 */
export function StockAlerts({ shortages, reorders }: { shortages: ShortageAlert[] | null; reorders: ReorderAlert[] | null }) {
  const loading = shortages === null || reorders === null;
  const quiet = !loading && shortages.length === 0 && reorders.length === 0;
  return (
    <div className="bg-slate-900/60 border border-slate-800/80 ring-1 ring-white/5 rounded-2xl overflow-hidden">
      <CardHead
        title="Stock alerts"
        meta={!loading
          ? [shortages.length > 0 ? `${shortages.length} short` : '', reorders.length > 0 ? `${reorders.length} to reorder` : ''].filter(Boolean).join(' · ')
          : ''}
        right={(
          <Link href="/stock" className="text-[11px] text-slate-500 hover:text-sky-300 transition-colors">
            Stock →
          </Link>
        )}
      />

      {loading ? (
        <div className="p-4 sm:p-5 space-y-2">
          {[...Array(2)].map((_, i) => <div key={i} className="h-12 bg-slate-800/40 rounded-xl animate-pulse" />)}
        </div>
      ) : quiet ? (
        <p className="px-5 py-6 text-center text-xs text-slate-500">
          Nothing to flag — every committed order can ship, and no item is at its reorder point.
        </p>
      ) : (
        <div className="divide-y divide-slate-800/50">
          {/* Shortages first — these are blocking revenue TODAY */}
          {shortages.map((sh) => (
            <div key={`sh-${sh.component_id}`} className="px-4 sm:px-5 py-3">
              {/* Same phone shape as the arrival rows: the item gets the first
                  line, everything measuring it the second. */}
              <div className="flex items-center gap-x-2.5 gap-y-1 flex-wrap">
                <span className="w-1.5 h-1.5 rounded-full bg-red-400 flex-shrink-0" />
                <span className="min-w-0 flex-1 sm:flex-none sm:max-w-[340px] text-[13px] font-semibold text-white truncate">{sh.name}</span>
                <span aria-hidden className="basis-full h-0 sm:hidden" />
                <span className="text-[11px] tabular-nums text-red-300 font-bold">
                  short {fmtInt(sh.short)}{sh.unit ? ` ${sh.unit}` : ''}
                </span>
                <span className="text-[10px] tabular-nums text-slate-500">
                  have {fmtInt(sh.physical)} · committed {fmtInt(sh.committed)}
                </span>
                <span className="ml-auto flex flex-wrap gap-1.5">
                  {sh.orders.slice(0, 3).map((o) => (
                    <Link key={`${o.quote_id}-${o.number}`} href={`/sales/${o.quote_id}`}
                      title={`${o.customer || 'No customer'} — waiting on ${fmtInt(o.qty)}${sh.unit ? ` ${sh.unit}` : ''}`}
                      className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-md bg-slate-800/70 hover:bg-slate-700 transition-colors font-mono text-[10px] text-violet-300">
                      {o.number}
                    </Link>
                  ))}
                  {sh.orders.length > 3 && <span className="text-[10px] text-slate-600 self-center">+{sh.orders.length - 3}</span>}
                </span>
              </div>
            </div>
          ))}
          {/* Then the reorder points — the shortages that haven't happened yet */}
          {reorders.map((a) => (
            <div key={`ro-${a.component_id}`} className="px-4 sm:px-5 py-3">
              <div className="flex items-center gap-x-2.5 gap-y-1 flex-wrap">
                <span className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${a.urgent ? 'bg-red-400' : 'bg-amber-400 opacity-80'}`} />
                <span className="min-w-0 flex-1 sm:flex-none sm:max-w-[340px] text-[13px] font-semibold text-slate-200 truncate">{a.name}</span>
                <span aria-hidden className="basis-full h-0 sm:hidden" />
                <span className="text-[11px] tabular-nums text-amber-300 font-bold">
                  order ~{fmtInt(a.suggestedQty)}{a.unit ? ` ${a.unit}` : ''}
                </span>
                {a.urgent && (
                  <span className="text-[10px] font-bold text-red-300 uppercase tracking-wide"
                    title="At the current demand rate, stock runs out before a PO raised today could arrive">
                    stock-out before replenishment
                  </span>
                )}
                <span className="text-[10px] tabular-nums text-slate-500">
                  live {fmtInt(a.live)}{a.incoming > 0 ? ` + ${fmtInt(a.incoming)} incoming` : ''} · covers {Math.round(a.coverDays)}d · lead {Math.round(a.leadDays)}d{a.leadMeasured ? '' : ' (est.)'}
                </span>
                <Link href="/purchasing?tab=quoting"
                  className="ml-auto text-[10px] px-2 py-0.5 rounded-lg bg-sky-500/10 text-sky-300 ring-1 ring-sky-500/25 hover:bg-sky-500/20 transition-colors whitespace-nowrap self-center">
                  New PO →
                </Link>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/**
 * One stream instead of five parallel feeds — a sales document no longer hides
 * behind a wall of purchase orders, and the space that bought pays for the
 * queue above.
 */
/**
 * The position strip — the four numbers that ARE the business before any list:
 * cash held, cash owed to us, cash we owe, and how many days one rupiah takes
 * to come back. Tiles gate individually by capability, exactly like the nav.
 */
export function PositionStrip({ data, perms }: { data: PositionData | null; perms: RolePermissions }) {
  const loading = data === null;
  const dashOr = (ready: boolean, v: () => string) => (loading ? '—' : ready ? v() : '—');
  const d = (n: number | null | undefined) => (n == null ? '—' : `${Math.round(n)}d`);

  const tiles: { key: string; label: string; value: string; sub: React.ReactNode; color: string; ring: string }[] = [];

  if (perms.canViewBanks) {
    const cash = data?.cash;
    const idrEntry = cash?.byCurrency.find((c) => c.currency === 'IDR');
    const others = (cash?.byCurrency ?? []).filter((c) => c.currency !== 'IDR');
    tiles.push({
      key: 'cash', label: 'Cash', color: 'text-amber-300', ring: 'ring-amber-500/20',
      value: dashOr(!!cash, () => (idrEntry || !others.length ? fmtIdr(idrEntry?.total ?? 0) : `${others[0].currency} ${fmtInt(others[0].total)}`)),
      sub: !cash ? (loading ? 'across all bank accounts' : 'unavailable right now') : (
        <>{cash.accounts} account{cash.accounts !== 1 ? 's' : ''}
          {others.length > 0 && idrEntry ? ` · + ${others.map((c) => `${c.currency} ${fmtInt(c.total)}`).join(' · ')}` : ''}</>
      ),
    });
  }
  if (perms.sellSide) {
    const ar = data?.ar;
    tiles.push({
      key: 'ar', label: 'Owed to us', color: 'text-emerald-300', ring: 'ring-emerald-500/20',
      value: dashOr(!!ar, () => fmtIdr(ar!.outstanding)),
      sub: !ar ? (loading ? 'open customer invoices' : 'unavailable right now') : ar.openCount === 0 ? 'every invoice is settled' : (
        <>{ar.openCount} open invoice{ar.openCount !== 1 ? 's' : ''}
          {ar.overdue > 0 && <span className="text-amber-400"> · {fmtIdr(ar.overdue)} overdue</span>}</>
      ),
    });
  }
  if (perms.buySide) {
    const ap = data?.ap;
    const it = data?.inTransit;
    // Cash already gone on goods not yet in the warehouse — often prepaid imports,
    // which is exactly what pushes DPO negative. Shown beside "we owe", never in it.
    const transit = it && it.paidIdr > 0 ? (
      <span className="block text-slate-500 mt-0.5">
        {fmtIdr(it.paidIdr)} on the water
        {it.overdueCount > 0 && <span className="text-amber-400"> · {it.overdueCount} overdue</span>}
      </span>
    ) : null;
    tiles.push({
      key: 'ap', label: 'We owe', color: 'text-sky-300', ring: 'ring-sky-500/20',
      value: dashOr(!!ap, () => fmtIdr(ap!.outstanding)),
      sub: !ap ? (loading ? 'unpaid across active POs' : 'unavailable right now') : (
        <>
          {ap.openCount === 0 ? 'every active PO is paid' : (
            <>{ap.openCount} PO{ap.openCount !== 1 ? 's' : ''}
              {ap.receivedOwed > 0 && <span className="text-amber-400"> · {fmtIdr(ap.receivedOwed)} for goods received</span>}
              {ap.excludedNoRate > 0 ? ` · ${ap.excludedNoRate} unrated excl.` : ''}</>
          )}
          {transit}
        </>
      ),
    });
  }
  if (perms.canViewEconomics) {
    const ccc = data?.ccc;
    // Why we cannot measure, in the words of the thing that would fix it. A
    // panel that says "needs delivered COGS" when five deliveries DID happen —
    // three of them booked with no unit cost — sends the reader looking in the
    // wrong place.
    const cannot = (c: NonNullable<typeof ccc>) =>
      c.outMoves === 0
        ? 'nothing delivered in the last 90d to measure against'
        : `${c.outMoves} deliver${c.outMoves === 1 ? 'y' : 'ies'} in 90d${
            c.uncostedOutMoves > 0 ? `, ${c.uncostedOutMoves} with no cost` : ''} — too little to measure`;
    // A negative DPO means we paid before the goods arrived, which LENGTHENS
    // the cycle. "− DPO −23d" is arithmetically right and reads as a typo.
    const cycle = (c: NonNullable<typeof ccc>) =>
      `DIO ${d(c.dio)} + DSO ${d(c.dso)} ${
        c.dpo != null && c.dpo < 0 ? `+ ${d(-c.dpo)} prepaid` : `− DPO ${d(c.dpo)}`} · 90-day basis`;
    tiles.push({
      key: 'ccc', label: 'CCC · the runway', color: 'text-slate-100', ring: 'ring-white/10',
      value: dashOr(!!ccc, () => (ccc!.ccc == null ? '—' : `${Math.round(ccc!.ccc)}d`)),
      sub: !ccc ? (loading ? 'cash out → cash back, in days' : 'unavailable right now')
        : ccc.ccc == null ? cannot(ccc) : cycle(ccc),
    });
  }

  if (!tiles.length) return null;
  const cols = ({ 1: 'lg:grid-cols-1', 2: 'lg:grid-cols-2', 3: 'lg:grid-cols-3', 4: 'lg:grid-cols-4' } as Record<number, string>)[tiles.length];
  return (
    <div className={`grid grid-cols-1 sm:grid-cols-2 ${cols} gap-4 xl:gap-5`}>
      {tiles.map((t) => (
        <div key={t.key} className={`bg-slate-900/60 border border-slate-800/80 ring-1 ${t.ring} rounded-2xl p-4 xl:p-5`}>
          <p className="text-[10px] xl:text-[11px] font-semibold uppercase tracking-widest text-slate-500 mb-1.5">{t.label}</p>
          <p className={`text-2xl xl:text-3xl font-extrabold tabular-nums ${t.color} leading-none`}><FitText text={t.value} /></p>
          <p className="text-[11px] text-slate-600 mt-1.5">{t.sub}</p>
        </div>
      ))}
    </div>
  );
}

/**
 * Month in motion — this month so far against the SAME days of last month
 * (the 9th compares to the 9th, never to a whole month), so the answer to
 * "are we ahead or behind?" is honest on any day of the month.
 */
export function MonthMotion({ rows }: { rows: MotionRow[] | null }) {
  if (rows !== null && rows.length === 0) return null;
  return (
    <div className="bg-slate-900/40 border border-slate-800/80 ring-1 ring-white/5 rounded-2xl p-5">
      <div className="flex items-baseline gap-2.5 mb-3">
        <h2 className="text-sm font-bold text-white">Month in motion</h2>
        <span className="text-[10px] uppercase tracking-widest text-slate-600">vs same days last month</span>
      </div>
      {rows === null ? (
        <div className="space-y-1.5">{[...Array(3)].map((_, i) => <div key={i} className="h-10 bg-slate-800/40 rounded-xl animate-pulse" />)}</div>
      ) : (
        <div className="space-y-1">
          {rows.map((r) => {
            const up = r.deltaPct != null && r.deltaPct >= 0;
            // Paid-out moving is neither win nor loss — it is just cash leaving on plan
            const tone = r.key === 'paid-out' ? 'text-slate-400'
              : r.deltaPct == null ? 'text-slate-500' : up ? 'text-emerald-400' : 'text-rose-400';
            return (
              <div key={r.key} className="flex items-center gap-3 px-3 py-2 rounded-xl bg-slate-800/20">
                <span className="text-xs font-semibold text-slate-300 w-[4.5rem] flex-shrink-0">{r.label}</span>
                <span className="text-[13px] font-extrabold tabular-nums text-slate-100 truncate">{fmtIdr(r.now)}</span>
                <span className={`ml-auto flex-shrink-0 text-[11px] font-bold tabular-nums ${tone}`}
                  title={`Same days last month: ${fmtIdr(r.prev)}`}>
                  {r.deltaPct == null ? (r.now > 0 ? 'no base' : '—') : `${up ? '▲' : '▼'} ${Math.abs(Math.round(r.deltaPct))}%`}
                </span>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

/**
 * The AI's read of the same numbers the page shows — ONE proposed step and its
 * economic consequence, cached for the day so the dashboard stays instant.
 * It only ever sees what this role's own tiles and queue already render.
 */
const NEXT_STEP_CACHE = 'icaproc_nextstep_v1';

export function NextStepCard({ position, queue, role }: { position: PositionData | null; queue: ActionItem[] | null; role: string }) {
  const supabase = createSupabaseClient();
  const [state, setState] = useState<{ s: 'idle' | 'loading' | 'done' | 'error'; text?: string }>({ s: 'idle' });
  const ready = position !== null && queue !== null;

  const load = useCallback(async (force: boolean) => {
    if (!ready) return;
    const today = new Date().toISOString().slice(0, 10);
    if (!force) {
      try {
        const c = JSON.parse(localStorage.getItem(NEXT_STEP_CACHE) ?? 'null') as { date: string; role: string; text: string } | null;
        if (c?.text && c.date === today && c.role === role) { setState({ s: 'done', text: c.text }); return; }
      } catch { /* stale cache is just re-asked */ }
    }
    setState({ s: 'loading' });
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session?.access_token) throw new Error('no session');
      const idrOf = (ccy: 'IDR') => position!.cash?.byCurrency.find((c) => c.currency === ccy)?.total ?? null;
      const res = await fetch('/api/next-step', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session.access_token}` },
        body: JSON.stringify({
          position: {
            cashIdr: position!.cash ? (idrOf('IDR') ?? 0) : null,
            cashOther: position!.cash?.byCurrency.filter((c) => c.currency !== 'IDR'),
            arOutstanding: position!.ar?.outstanding, arOverdue: position!.ar?.overdue, arCount: position!.ar?.openCount,
            apOutstanding: position!.ap?.outstanding, apReceivedOwed: position!.ap?.receivedOwed, apCount: position!.ap?.openCount,
            ccc: position!.ccc?.ccc, dio: position!.ccc?.dio, dso: position!.ccc?.dso, dpo: position!.ccc?.dpo,
            stockValue: position!.ccc?.stockValue,
          },
          motion: position!.motion.map((m) => ({ label: m.label, now: m.now, prev: m.prev })),
          queue: (queue ?? []).map((q) => ({ title: q.title, detail: q.detail, amount: q.amount })),
        }),
      });
      const j = await res.json() as { suggestion?: string; error?: string };
      if (!res.ok || !j.suggestion) throw new Error(j.error || 'failed');
      try { localStorage.setItem(NEXT_STEP_CACHE, JSON.stringify({ date: today, role, text: j.suggestion })); } catch { /* private mode */ }
      setState({ s: 'done', text: j.suggestion });
    } catch { setState({ s: 'error' }); }
  }, [ready, position, queue, role]);   // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => { if (ready && state.s === 'idle') void load(false); }, [ready, state.s, load]);

  return (
    <div className="bg-slate-900/60 border border-slate-800/80 ring-1 ring-violet-500/20 rounded-2xl p-5">
      <div className="flex items-center gap-2.5 mb-2.5">
        <h2 className="text-sm font-bold text-white">Next best step</h2>
        <span className="text-[9px] font-bold uppercase tracking-widest px-1.5 py-0.5 rounded-md bg-violet-500/15 text-violet-300 ring-1 ring-violet-500/25">AI</span>
        <button onClick={() => void load(true)} disabled={state.s === 'loading' || !ready}
          title="Ask again with today's numbers"
          className="ml-auto text-[11px] text-slate-500 hover:text-violet-300 transition-colors disabled:opacity-40">
          ↻ refresh
        </button>
      </div>
      {state.s === 'done' ? (
        <p className="text-[13px] leading-relaxed text-slate-200">{state.text}</p>
      ) : state.s === 'error' ? (
        <p className="text-xs text-slate-500">The advisor is unavailable right now — the queue above still ranks what matters by money at stake.</p>
      ) : (
        <div className="space-y-1.5">{[...Array(2)].map((_, i) => <div key={i} className="h-4 bg-slate-800/40 rounded-lg animate-pulse" />)}</div>
      )}
      <p className="text-[10px] text-slate-600 mt-2.5">Reads the same numbers this page shows. It proposes — you decide.</p>
    </div>
  );
}

export function ActivityStream({ rows }: { rows: ActivityRow[] | null }) {
  return (
    <div className="bg-slate-900/40 border border-slate-800/80 ring-1 ring-white/5 rounded-2xl p-5 h-full">
      <div className="flex items-center gap-2.5 mb-3">
        <h2 className="text-sm font-bold text-white flex-1">Latest activity</h2>
        <span className="text-[10px] uppercase tracking-widest text-slate-600">across every module</span>
      </div>
      {rows === null ? (
        <div className="space-y-1.5">{[...Array(8)].map((_, i) => <div key={i} className="h-10 bg-slate-800/40 rounded-xl animate-pulse" />)}</div>
      ) : rows.length === 0 ? (
        <p className="text-slate-600 text-xs italic py-8 text-center">Nothing recent.</p>
      ) : (
        <div className="space-y-1">
          {rows.map((r) => (
            <Link key={r.key} href={r.href}
              className="flex items-center gap-3 px-3 py-2 rounded-xl bg-slate-800/20 hover:bg-slate-800/50 transition-colors group">
              <span className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${DOMAIN_DOT[r.domain]}`} />
              <span className={`flex-shrink-0 w-[4.5rem] text-[10px] font-bold uppercase tracking-wider ${DOMAIN_TEXT[r.domain]}`}>{r.kind}</span>
              <span className="text-xs font-semibold text-slate-100 group-hover:text-white transition-colors truncate">{r.title}</span>
              <span className="text-[11px] text-slate-500 truncate hidden sm:block">{r.sub}</span>
              <span className="ml-auto flex-shrink-0 text-[10px] text-slate-500 tabular-nums">{fmtDate(r.at)}</span>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
