'use client';
import { useMemo, useEffect, useState, useCallback } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { createSupabaseClient } from '@/lib/supabase';
import { useSupabaseData } from '@/hooks/useSupabaseData';
import { useAuth } from '@/hooks/useAuth';
import { useSettings } from '@/hooks/useSettings';
import BrandMenu from '@/components/ui/BrandMenu';
import { PRINCIPAL_CATS } from '@/constants/costCategories';
import { ROLE_PERMISSIONS } from '@/constants/roles';
import { fmtIdr, parseDate } from '@/lib/formatters';
import FitText from '@/components/ui/FitText';
import { getSettings } from '@/lib/settings';
import { fetchActionQueue, fetchActivity, type ActionItem, type ActivityRow } from '@/lib/dashboard';
import { fetchPosition, type PositionData, type MotionRow } from '@/lib/position';
import type { RolePermissions } from '@/constants/roles';
import { fetchShortages, fetchReorderAlerts, type ShortageAlert, type ReorderAlert } from '@/lib/reorder';
import { fmtInt } from '@/lib/formatters';

function fmtDate(d?: string | null) {
  const dt = parseDate(d);
  if (!dt) return '';
  return dt.toLocaleDateString(getSettings().dateLocaleInternal, { day: '2-digit', month: 'short' });
}
function thisMonth() { return new Date().toISOString().slice(0, 7); }

export default function Home() {
  const router = useRouter();
  const supabase = createSupabaseClient();
  const { user, profile, loading: authLoading } = useAuth();
  const { data, loading } = useSupabaseData();
  const { arOverdueDays, quoteFollowUpDays } = useSettings();
  // Module visibility mirrors the nav: a role only sees panels for flows it
  // can access (nothing sensitive renders until the profile has resolved).
  const perms = profile ? ROLE_PERMISSIONS[profile.role] : null;
  const [stockValue, setStockValue] = useState<number | null>(null);
  const [queue, setQueue] = useState<ActionItem[] | null>(null);
  const [activity, setActivity] = useState<ActivityRow[] | null>(null);
  const [shortages, setShortages] = useState<ShortageAlert[] | null>(null);
  const [reorders, setReorders] = useState<ReorderAlert[] | null>(null);
  const [position, setPosition] = useState<PositionData | null>(null);

  useEffect(() => { document.title = 'Dashboard — ICAPROC'; }, []);

  // PO values and payment status are sensitive — sign-in required
  useEffect(() => {
    if (!authLoading && !user) router.replace('/login?next=/');
  }, [authLoading, user, router]);

  // ── What needs a human, and what has moved ────────────────────────────────
  // Both derive from the owning modules' own tables, so fixing a row on Sales
  // or Banks clears it here on the next load — no second source of truth.
  useEffect(() => {
    if (!user || !perms) return;
    let live = true;
    fetchActionQueue(supabase, perms, { arOverdueDays, quoteFollowUpDays })
      .then((r) => { if (live) setQueue(r); })
      .catch(() => { if (live) setQueue([]); });
    fetchActivity(supabase, perms)
      .then((r) => { if (live) setActivity(r); })
      .catch(() => { if (live) setActivity([]); });
    return () => { live = false; };
  }, [user, profile?.role, arOverdueDays, quoteFollowUpDays]);

  // ── The position: Cash / Owed to us / We owe / CCC + month-in-motion ──────
  // Same rules as /banks, /invoices, the unpaid-PO queue and /profitability —
  // the strip is a window onto those screens, never a second truth.
  useEffect(() => {
    if (!user || !perms) return;
    let live = true;
    fetchPosition(supabase, perms, { arOverdueDays })
      .then((r) => { if (live) setPosition(r); })
      .catch(() => { if (live) setPosition({ motion: [] }); });
    return () => { live = false; };
  }, [user, profile?.role, arOverdueDays]);   // eslint-disable-line react-hooks/exhaustive-deps

  // ── Stock alerts: shortages (orders that cannot ship) + reorder points ────
  // Same engines /stock uses — the dashboard is a window, not a second truth.
  useEffect(() => {
    if (!user || !perms?.buySide) return;
    let live = true;
    fetchShortages(supabase).then((r) => { if (live) setShortages(r); }).catch(() => { if (live) setShortages([]); });
    fetchReorderAlerts(supabase).then((r) => { if (live) setReorders(r); }).catch(() => { if (live) setReorders([]); });
    return () => { live = false; };
  }, [user, perms?.buySide]);   // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!user || !perms?.buySide) return;
    // Warehouse value = Σ on-hand × moving-avg landed cost (30.1 balances)
    supabase.from('30.1_stock_balances')
      .select('qty_on_hand, avg_cost_idr')
      .then(({ data, error }) => {
        if (error || !data) { setStockValue(0); return; }
        setStockValue(data.reduce((s, b) => s + (Number(b.qty_on_hand) || 0) * (Number(b.avg_cost_idr) || 0), 0));
      });
  }, [user, perms?.buySide]);

  const poById = useMemo(
    () => new Map(data.pos.map((p) => [String(p.po_id), p])),
    [data.pos]);

  // ── KPI stats ─────────────────────────────────────────────────────────────
  // "Outstanding" moved into the position strip's "We owe" tile above.
  const stats = useMemo(() => {
    const monthStr = thisMonth();
    const activePOs = data.pos.filter((p) => p.status !== 'Cancelled');
    const paidThisMonthIdr = data.poCosts
      .filter((c) => c.payment_date?.startsWith(monthStr) && PRINCIPAL_CATS.has(c.cost_category))
      .reduce((s, c) => {
        const xr = Number(c.exchange_rate) || Number(poById.get(String(c.po_id))?.exchange_rate) || 1;
        return s + (c.currency === 'IDR' ? Number(c.amount) : Number(c.amount) * xr);
      }, 0);
    return {
      activePOs: activePOs.length,
      paidThisMonthIdr,
      componentCount: data.components.length,
    };
  }, [data, poById]);

  const atStake = useMemo(() => (queue ?? []).reduce((s, i) => s + i.amount, 0), [queue]);

  if (authLoading || !user) {
    return (
      <div className="min-h-screen bg-canvas flex items-center justify-center">
        <div className="w-6 h-6 border-2 border-emerald-500/30 border-t-emerald-500 rounded-full animate-spin" />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-chrome text-slate-200 font-sans text-sm">
      {/* ── Header ── */}
      <div className="border-b border-slate-800/60 bg-chrome/80 backdrop-blur-md sticky top-0 z-30">
        <div className="max-w-[1800px] 2xl:max-w-[2460px] mx-auto px-3 sm:px-4 md:px-6 xl:px-8 py-3 sm:py-4 flex flex-col sm:flex-row sm:items-center justify-between sm:flex-wrap gap-2.5 sm:gap-4">
          <BrandMenu
            wordmarkClass="text-xl md:text-2xl font-extrabold"
            subtitle={new Date().toLocaleDateString('en-GB', { weekday: 'short', year: 'numeric', month: 'short', day: 'numeric' })}
          />
        </div>
      </div>

      <main className="max-w-[1800px] 2xl:max-w-[2460px] mx-auto px-3 sm:px-4 md:px-6 xl:px-8 py-6 xl:py-8 space-y-8">

        {/* Spotlight used to open this page as a hero. It now lives in the nav
            bar on every page including this one, so the dashboard leads with
            the thing only the dashboard can tell you: what needs a human. */}

        {/* ── The position: what the company holds, is owed, owes, and how fast
               cash cycles — read before the queue asks for anything ── */}
        {perms && <PositionStrip data={position} perms={perms} />}

        {/* ── Needs you today — the queue leads, at full width ── */}
        <ActionQueue items={queue} atStake={atStake} />

        {/* ── The AI's read of that queue, and the month's trend beside it.
               Kept as a two-up row so neither card floats in a half-empty
               rail next to a short queue. Bank-only roles have no motion, so
               the advisor takes the full width there. ── */}
        {perms && (perms.sellSide || perms.buySide) ? (
          <div className="grid grid-cols-1 xl:grid-cols-2 gap-5 items-stretch">
            <NextStepCard position={position} queue={queue} role={profile?.role ?? ''} />
            <MonthMotion rows={position === null ? null : position.motion} />
          </div>
        ) : perms?.canViewBanks ? (
          <NextStepCard position={position} queue={queue} role={profile?.role ?? ''} />
        ) : null}

        {/* ── KPI row (buy-side economics — hidden from sell-side-only roles) ── */}
        {perms?.buySide && (
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 xl:gap-5">
          {[
            { label: 'Paid This Month', value: loading ? '—' : fmtIdr(stats.paidThisMonthIdr),
              sub: new Date().toLocaleDateString('en-GB', { month: 'long' }), color: 'text-rose-300', ring: 'ring-rose-500/20' },
            { label: 'Stock Value', value: stockValue == null ? '—' : fmtIdr(stockValue), sub: 'on-hand × avg landed cost', color: 'text-violet-300', ring: 'ring-violet-500/20' },
            { label: 'Active POs', value: loading ? '—' : stats.activePOs.toString(), sub: 'not cancelled', color: 'text-sky-300', ring: 'ring-sky-500/20' },
            { label: 'Components', value: loading ? '—' : stats.componentCount.toLocaleString('en-US'), sub: 'in catalog', color: 'text-emerald-300', ring: 'ring-emerald-500/20' },
          ].map(({ label, value, sub, color, ring }) => (
            <div key={label} className={`bg-slate-900/60 border border-slate-800/80 ring-1 ${ring} rounded-2xl p-4 xl:p-5`}>
              <p className="text-[10px] xl:text-[11px] font-semibold uppercase tracking-widest text-slate-500 mb-1.5">{label}</p>
              <p className={`text-2xl xl:text-3xl font-extrabold tabular-nums ${color} leading-none`}><FitText text={value} /></p>
              <p className="text-[11px] text-slate-600 mt-1.5">{sub}</p>
            </div>
          ))}
        </div>
        )}

        {/* ── Stock alerts — shortages (the fire) + reorder points (the smoke
               detector), in one dedicated section ── */}
        {perms?.buySide && <StockAlerts shortages={shortages} reorders={reorders} />}

        {/* ── Activity + quick actions ── */}
        <div className="grid grid-cols-1 xl:grid-cols-3 gap-5">
          <div className="xl:col-span-2"><ActivityStream rows={activity} /></div>

          {/* Quick actions (text only, no emoji) */}
          <div className="bg-slate-900/40 border border-slate-800/80 ring-1 ring-white/5 rounded-2xl p-5">
            <p className="text-[10px] font-semibold uppercase tracking-widest text-slate-500 mb-3">Quick Actions</p>
            <div className="space-y-2">
              {[
                ...(perms?.sellSide ? [
                  { href: '/sales/new',  label: 'New Sales Quotation', accent: 'emerald' },
                  { href: '/customers',  label: 'Customers',           accent: 'emerald' },
                ] : []),
                ...(perms?.buySide ? [
                  { href: '/purchasing?tab=quoting',    label: 'New Deal — PI / PO',        accent: 'blue' },
                  { href: '/purchasing?tab=financials', label: 'Log Payment',                accent: 'rose' },
                ] : []),
                ...(perms?.projects ? [
                  { href: '/proposals',              label: 'New EPC Proposal',          accent: 'violet' },
                ] : []),
                ...(perms?.canViewBanks ? [
                  { href: '/banks',                  label: 'Bank Accounts',             accent: 'amber' },
                ] : []),
              ].map(({ href, label, accent }) => (
                <Link key={href} href={href}
                  className="flex items-center gap-3 px-3 py-2.5 rounded-xl bg-slate-800/30 hover:bg-slate-800/60 border border-transparent hover:border-slate-700 transition-colors group">
                  <span className={`w-1.5 h-1.5 rounded-full ${DOT[accent]}`} />
                  <span className="text-sm text-slate-300 group-hover:text-white transition-colors">{label}</span>
                  <span className="ml-auto text-slate-700 group-hover:text-slate-400 transition-colors">→</span>
                </Link>
              ))}
            </div>
          </div>
        </div>
      </main>
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
 * The queue is the point of the dashboard: what is stuck, what it is worth,
 * and one tap to the screen that unsticks it. Ranked by money, not recency.
 */
function ActionQueue({ items, atStake }: { items: ActionItem[] | null; atStake: number }) {
  return (
    <div className="bg-slate-900/60 border border-slate-800/80 ring-1 ring-white/5 rounded-2xl overflow-hidden">
      <div className="flex items-center gap-3 px-4 sm:px-5 py-3.5 border-b border-slate-800/70">
        <h2 className="text-sm font-bold text-white">Needs you today</h2>
        {items && items.length > 0 && (
          <span className="text-[10px] font-bold uppercase tracking-widest text-slate-500">
            {items.length} item{items.length !== 1 ? 's' : ''}
          </span>
        )}
        {atStake > 0 && (
          <span className="ml-auto text-right">
            <span className="block text-[10px] uppercase tracking-widest text-slate-500 leading-none">At stake</span>
            <span className="block text-sm font-extrabold tabular-nums text-amber-300 mt-1 leading-none">{fmtIdr(atStake)}</span>
          </span>
        )}
      </div>

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
            <Link key={it.key} href={it.href}
              className="flex items-center gap-3 px-4 sm:px-5 py-3 hover:bg-slate-800/40 transition-colors group">
              <span className={`rounded-full flex-shrink-0 ${DOMAIN_DOT[it.domain]} ${it.tone === 'urgent' ? 'w-2 h-2' : 'w-1.5 h-1.5 opacity-60'}`} />
              <div className="min-w-0 flex-1">
                <p className={`text-[13px] font-semibold truncate ${it.tone === 'urgent' ? 'text-white' : 'text-slate-200'}`}>{it.title}</p>
                <p className="text-[11px] text-slate-500 truncate mt-0.5">{it.detail}</p>
              </div>
              {it.amount > 0 && (
                <span className={`flex-shrink-0 text-sm font-extrabold tabular-nums ${it.tone === 'urgent' ? 'text-amber-300' : DOMAIN_TEXT[it.domain]}`}>
                  {fmtIdr(it.amount)}
                </span>
              )}
              <span className="flex-shrink-0 text-slate-700 group-hover:text-slate-400 transition-colors">→</span>
            </Link>
          ))}
        </div>
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
function StockAlerts({ shortages, reorders }: { shortages: ShortageAlert[] | null; reorders: ReorderAlert[] | null }) {
  const loading = shortages === null || reorders === null;
  const quiet = !loading && shortages.length === 0 && reorders.length === 0;
  return (
    <div className="bg-slate-900/60 border border-slate-800/80 ring-1 ring-white/5 rounded-2xl overflow-hidden">
      <div className="flex items-center gap-3 px-4 sm:px-5 py-3.5 border-b border-slate-800/70">
        <h2 className="text-sm font-bold text-white">Stock alerts</h2>
        {!loading && (shortages.length > 0 || reorders.length > 0) && (
          <span className="text-[10px] font-bold uppercase tracking-widest text-slate-500">
            {shortages.length > 0 ? `${shortages.length} short` : ''}
            {shortages.length > 0 && reorders.length > 0 ? ' · ' : ''}
            {reorders.length > 0 ? `${reorders.length} to reorder` : ''}
          </span>
        )}
        <Link href="/stock" className="ml-auto text-[11px] text-slate-500 hover:text-sky-300 transition-colors whitespace-nowrap">
          Stock →
        </Link>
      </div>

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
              <div className="flex items-baseline gap-x-2.5 gap-y-1 flex-wrap">
                <span className="w-1.5 h-1.5 rounded-full bg-red-400 self-center flex-shrink-0" />
                <span className="text-[13px] font-semibold text-white truncate max-w-[340px]">{sh.name}</span>
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
              <div className="flex items-baseline gap-x-2.5 gap-y-1 flex-wrap">
                <span className={`w-1.5 h-1.5 rounded-full self-center flex-shrink-0 ${a.urgent ? 'bg-red-400' : 'bg-amber-400 opacity-80'}`} />
                <span className="text-[13px] font-semibold text-slate-200 truncate max-w-[340px]">{a.name}</span>
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
function PositionStrip({ data, perms }: { data: PositionData | null; perms: RolePermissions }) {
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
    tiles.push({
      key: 'ap', label: 'We owe', color: 'text-sky-300', ring: 'ring-sky-500/20',
      value: dashOr(!!ap, () => fmtIdr(ap!.outstanding)),
      sub: !ap ? (loading ? 'unpaid across active POs' : 'unavailable right now') : ap.openCount === 0 ? 'every active PO is paid' : (
        <>{ap.openCount} PO{ap.openCount !== 1 ? 's' : ''}
          {ap.receivedOwed > 0 && <span className="text-amber-400"> · {fmtIdr(ap.receivedOwed)} for goods received</span>}
          {ap.excludedNoRate > 0 ? ` · ${ap.excludedNoRate} unrated excl.` : ''}</>
      ),
    });
  }
  if (perms.canViewEconomics) {
    const ccc = data?.ccc;
    tiles.push({
      key: 'ccc', label: 'CCC · the runway', color: 'text-slate-100', ring: 'ring-white/10',
      value: dashOr(!!ccc, () => (ccc!.ccc == null ? '—' : `${Math.round(ccc!.ccc)}d`)),
      sub: !ccc ? (loading ? 'cash out → cash back, in days' : 'unavailable right now')
        : ccc.ccc == null ? 'needs delivered COGS in the last 90d'
        : `DIO ${d(ccc.dio)} + DSO ${d(ccc.dso)} − DPO ${d(ccc.dpo)} · 90-day basis`,
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
function MonthMotion({ rows }: { rows: MotionRow[] | null }) {
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

function NextStepCard({ position, queue, role }: { position: PositionData | null; queue: ActionItem[] | null; role: string }) {
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

function ActivityStream({ rows }: { rows: ActivityRow[] | null }) {
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
