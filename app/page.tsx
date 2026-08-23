'use client';
import { useMemo, useEffect, useState, useCallback } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { createSupabaseClient } from '@/lib/supabase';
import { useSupabaseData } from '@/hooks/useSupabaseData';
import { useAuth } from '@/hooks/useAuth';
import { useSettings } from '@/hooks/useSettings';
import { useT } from '@/hooks/useT';
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
import { fetchNewArrivals, fetchArrivals, type NewArrival, type ArrivingSummary } from '@/lib/catalogSignals';
import {
  fetchSalesFacts, fetchLeaderNames, factsInPeriod, rank,
  type SalesFact, type RankBy, type Leaderboard,
} from '@/lib/salesFacts';
import {
  fetchRecentPayments, fetchRecentDeliveries, fetchRecentCases, type Feed,
} from '@/lib/recentFeeds';
import { fmtInt } from '@/lib/formatters';
import { useDashboardLayout } from '@/hooks/useDashboardLayout';
import { WIDTH_SPAN, type DashboardLayout } from '@/constants/dashboardWidgets';
import { canOpenPath } from '@/constants/navigation';
import WidgetArranger from '@/components/ui/WidgetArranger';

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
  const { arOverdueDays, quoteFollowUpDays, newArrivalDays, economicsPeriod } = useSettings();
  const { t } = useT();
  // Module visibility mirrors the nav: a role only sees panels for flows it
  // can access (nothing sensitive renders until the profile has resolved).
  const perms = profile ? ROLE_PERMISSIONS[profile.role] : null;
  const [stockValue, setStockValue] = useState<number | null>(null);
  const [queue, setQueue] = useState<ActionItem[] | null>(null);
  const [activity, setActivity] = useState<ActivityRow[] | null>(null);
  const [shortages, setShortages] = useState<ShortageAlert[] | null>(null);
  const [reorders, setReorders] = useState<ReorderAlert[] | null>(null);
  const [position, setPosition] = useState<PositionData | null>(null);
  const [arrivedItems, setArrivedItems] = useState<NewArrival[] | null>(null);
  const [arriving, setArriving] = useState<ArrivingSummary | null>(null);
  const [salesFacts, setSalesFacts] = useState<SalesFact[] | null>(null);
  const [payments, setPayments] = useState<Feed | null>(null);
  const [deliveries, setDeliveries] = useState<Feed | null>(null);
  const [cases, setCases] = useState<Feed | null>(null);
  const [leaderNames, setLeaderNames] = useState<{ products: Map<string, string>; customers: Map<string, string> } | null>(null);
  // Which measure each board is ranked by — the person's own choice, kept on
  // this browser. Profit is only ever an option for a role that may see cost.
  const [rankProducts, setRankProducts] = useState<RankBy>('revenue');
  const [rankCustomers, setRankCustomers] = useState<RankBy>('revenue');
  useEffect(() => {
    try {
      const p = localStorage.getItem('icaproc:rank-products');
      const c = localStorage.getItem('icaproc:rank-customers');
      if (p === 'revenue' || p === 'profit') setRankProducts(p);
      if (c === 'revenue' || c === 'profit') setRankCustomers(c);
    } catch { /* private mode */ }
  }, []);
  const pickRank = useCallback((which: 'products' | 'customers', by: RankBy) => {
    (which === 'products' ? setRankProducts : setRankCustomers)(by);
    try { localStorage.setItem(`icaproc:rank-${which}`, by); } catch { /* private mode */ }
  }, []);

  // ── Which panels this person watches ──────────────────────────────────────
  // The house layout from Settings › Dashboard, unless they arranged their own.
  // `visible` is the whole answer: role gate, house default and personal
  // arrangement resolved in one place (constants/dashboardWidgets.ts), so a
  // panel can never render for a role that may not read what feeds it.
  const { visible, arranged, isPersonal, save, reset } = useDashboardLayout(perms);
  const shown = useMemo(() => new Set(visible.map((w) => w.key)), [visible]);
  const [customising, setCustomising] = useState(false);

  // Nothing is fetched for a panel nobody is looking at. The advisor reads the
  // position and the queue, so it keeps them alive even when their own tiles
  // are switched off — it must never reason from half the numbers.
  const needQueue    = shown.has('queue') || shown.has('nextStep');
  const needPosition = shown.has('position') || shown.has('motion') || shown.has('nextStep');
  const needActivity = shown.has('activity');
  const needAlerts   = shown.has('stockAlerts');
  const needStockVal = shown.has('kpiStockValue');
  const needArrived  = shown.has('newArrivals');
  const needArriving = shown.has('arriving');
  const needLeaders  = shown.has('topProducts') || shown.has('topCustomers');
  const needPayments = shown.has('lastPayments');
  const needDeliv    = shown.has('lastDeliveries');
  const needCases    = shown.has('lastCases');

  useEffect(() => { document.title = 'Dashboard — ICAPROC'; }, []);

  // PO values and payment status are sensitive — sign-in required
  useEffect(() => {
    if (!authLoading && !user) router.replace('/login?next=/');
  }, [authLoading, user, router]);

  // ── What needs a human, and what has moved ────────────────────────────────
  // Both derive from the owning modules' own tables, so fixing a row on Sales
  // or Banks clears it here on the next load — no second source of truth.
  useEffect(() => {
    if (!user || !perms || !needQueue) return;
    let live = true;
    fetchActionQueue(supabase, perms, { arOverdueDays, quoteFollowUpDays })
      .then((r) => { if (live) setQueue(r); })
      .catch(() => { if (live) setQueue([]); });
    return () => { live = false; };
  }, [user, profile?.role, needQueue, arOverdueDays, quoteFollowUpDays]);   // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!user || !perms || !needActivity) return;
    let live = true;
    fetchActivity(supabase, perms)
      .then((r) => { if (live) setActivity(r); })
      .catch(() => { if (live) setActivity([]); });
    return () => { live = false; };
  }, [user, profile?.role, needActivity]);   // eslint-disable-line react-hooks/exhaustive-deps

  // ── The position: Cash / Owed to us / We owe / CCC + month-in-motion ──────
  // Same rules as /banks, /invoices, the unpaid-PO queue and /profitability —
  // the strip is a window onto those screens, never a second truth.
  useEffect(() => {
    if (!user || !perms || !needPosition) return;
    let live = true;
    fetchPosition(supabase, perms, { arOverdueDays })
      .then((r) => { if (live) setPosition(r); })
      .catch(() => { if (live) setPosition({ motion: [] }); });
    return () => { live = false; };
  }, [user, profile?.role, needPosition, arOverdueDays]);   // eslint-disable-line react-hooks/exhaustive-deps

  // ── Stock alerts: shortages (orders that cannot ship) + reorder points ────
  // Same engines /stock uses — the dashboard is a window, not a second truth.
  useEffect(() => {
    if (!user || !perms?.buySide || !needAlerts) return;
    let live = true;
    fetchShortages(supabase).then((r) => { if (live) setShortages(r); }).catch(() => { if (live) setShortages([]); });
    fetchReorderAlerts(supabase).then((r) => { if (live) setReorders(r); }).catch(() => { if (live) setReorders([]); });
    return () => { live = false; };
  }, [user, perms?.buySide, needAlerts]);   // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!user || !perms?.buySide || !needStockVal) return;
    // Warehouse value = Σ on-hand × moving-avg landed cost (30.1 balances)
    supabase.from('30.1_stock_balances')
      .select('qty_on_hand, avg_cost_idr')
      .then(({ data, error }) => {
        if (error || !data) { setStockValue(0); return; }
        setStockValue(data.reduce((s, b) => s + (Number(b.qty_on_hand) || 0) * (Number(b.avg_cost_idr) || 0), 0));
      });
  }, [user, perms?.buySide, needStockVal]);

  // ── The item's two ends: what landed, and what is still on the water ──────
  // Both read the engines /products already uses, so a date here and a date
  // there can never disagree. Neither asks for a cost or a supplier.
  useEffect(() => {
    if (!user || !perms || !needArrived) return;
    let live = true;
    fetchNewArrivals(supabase, newArrivalDays)
      .then((r) => { if (live) setArrivedItems(r); })
      .catch(() => { if (live) setArrivedItems([]); });
    return () => { live = false; };
  }, [user, profile?.role, needArrived, newArrivalDays]);   // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!user || !perms || !needArriving) return;
    let live = true;
    fetchArrivals(supabase, { buySide: !!perms.buySide })
      .then((r) => { if (live) setArriving(r); })
      .catch(() => { if (live) setArriving({ soon: [], late: [], openPos: 0, posWithoutEta: 0, stalePos: 0, oldestStaleDays: null }); });
    return () => { live = false; };
  }, [user, profile?.role, needArriving]);   // eslint-disable-line react-hooks/exhaustive-deps

  // ── What sold, and who bought it ──────────────────────────────────────────
  // The same delivered-sales engine /profitability uses, so a figure here and
  // a figure there cannot disagree. Cost is fetched ONLY for a role that may
  // see item economics — without it the boards rank by revenue and say so.
  useEffect(() => {
    if (!user || !perms || !needLeaders) return;
    let live = true;
    const withCost = !!perms.canViewEconomics;
    Promise.all([fetchSalesFacts(supabase, { withCost }), fetchLeaderNames(supabase)])
      .then(([f, n]) => { if (live) { setSalesFacts(f); setLeaderNames(n); } })
      .catch(() => { if (live) { setSalesFacts([]); setLeaderNames({ products: new Map(), customers: new Map() }); } });
    return () => { live = false; };
  }, [user, profile?.role, needLeaders]);   // eslint-disable-line react-hooks/exhaustive-deps

  // ── Three narrow feeds ────────────────────────────────────────────────────
  // Payments ask for only the directions this role may read: a sell-side
  // reader's request never mentions supplier costs at all.
  useEffect(() => {
    if (!user || !perms || !needPayments) return;
    let live = true;
    fetchRecentPayments(supabase, {
      moneyIn: !!(perms.sellSide || perms.canRecordReceipts || perms.canViewBanks),
      moneyOut: !!perms.buySide,
    })
      .then((r) => { if (live) setPayments(r); })
      .catch(() => { if (live) setPayments({ rows: [], includes: [] }); });
    return () => { live = false; };
  }, [user, profile?.role, needPayments]);   // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!user || !perms || !needDeliv) return;
    let live = true;
    fetchRecentDeliveries(supabase)
      .then((r) => { if (live) setDeliveries(r); })
      .catch(() => { if (live) setDeliveries({ rows: [], includes: [] }); });
    return () => { live = false; };
  }, [user, profile?.role, needDeliv]);   // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!user || !perms || !needCases) return;
    let live = true;
    fetchRecentCases(supabase)
      .then((r) => { if (live) setCases(r); })
      .catch(() => { if (live) setCases({ rows: [], includes: [] }); });
    return () => { live = false; };
  }, [user, profile?.role, needCases]);   // eslint-disable-line react-hooks/exhaustive-deps

  const periodFacts = useMemo(
    () => (salesFacts ? factsInPeriod(salesFacts, economicsPeriod, new Date().toISOString()) : null),
    [salesFacts, economicsPeriod]);

  const productBoard = useMemo<Leaderboard | null>(() => {
    if (!periodFacts || !leaderNames) return null;
    return rank(periodFacts, rankProducts, (f) => f.component_id, (key) => ({
      name: leaderNames.products.get(key) ?? 'Unnamed item',
      sub: (a) => `${fmtInt(a.qty)} sold · ${a.orders} order${a.orders !== 1 ? 's' : ''}`,
    }));
  }, [periodFacts, leaderNames, rankProducts]);

  const customerBoard = useMemo<Leaderboard | null>(() => {
    if (!periodFacts || !leaderNames) return null;
    return rank(periodFacts, rankCustomers, (f) => f.customer_id, (key) => ({
      name: leaderNames.customers.get(key) ?? 'Unnamed customer',
      sub: (a) => `${a.orders} order${a.orders !== 1 ? 's' : ''} · ${fmtInt(a.qty)} items`,
    }));
  }, [periodFacts, leaderNames, rankCustomers]);

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

  // The screens this role starts its day on. Computed here rather than inside
  // the card so the widget can be skipped entirely when a role has none — an
  // empty panel headed "Quick Actions" is a broken panel.
  const quickActions = useMemo(() => [
    ...(perms?.sellSide ? [
      { href: '/sales/new',  label: 'New Sales Quotation', accent: 'emerald' },
      { href: '/customers',  label: 'Customers',           accent: 'emerald' },
    ] : []),
    ...(perms?.buySide ? [
      { href: '/purchasing?tab=quoting',    label: 'New Deal — PI / PO',        accent: 'blue' },
      { href: '/purchasing?tab=financials', label: 'Log Payment',                accent: 'rose' },
      { href: '/purchasing?tab=lookup',     label: 'Deal Lookup',                accent: 'blue' },
    ] : []),
    ...(perms?.canManageStock ? [
      { href: '/stock/receive',             label: 'Receive Goods',              accent: 'blue' },
      { href: '/stock',                     label: 'Stock',                      accent: 'blue' },
    ] : []),
    // The service desk and the warehouse have a dashboard too — without this
    // their Quick Actions card had nothing in it at all.
    ...(perms?.canHandleService ? [
      { href: '/aftersales',                label: 'After Sales',                accent: 'violet' },
      { href: '/serials',                   label: 'Serial Numbers',             accent: 'violet' },
    ] : []),
    ...(perms?.projects ? [
      { href: '/proposals',              label: 'New EPC Proposal',          accent: 'violet' },
    ] : []),
    ...(perms?.canViewBanks ? [
      { href: '/banks',                  label: 'Bank Accounts',             accent: 'amber' },
    ] : []),
    // Last word to the shared access rule: a shortcut may never lead to a door
    // that throws you out, whatever the capability above suggested.
  ].filter((a) => canOpenPath(perms, a.href)), [perms]);

  if (authLoading || !user) {
    return (
      <div className="min-h-screen bg-canvas flex items-center justify-center">
        <div className="w-6 h-6 border-2 border-emerald-500/30 border-t-emerald-500 rounded-full animate-spin" />
      </div>
    );
  }

  /**
   * One widget, drawn from data the page has already fetched. A widget that
   * has nothing to say returns null and its cell is skipped — the honesty
   * doctrine applied to layout: no empty box wearing a heading.
   */
  const widgetNode = (key: string): React.ReactNode => {
    switch (key) {
      case 'position':   return perms ? <PositionStrip data={position} perms={perms} /> : null;
      case 'queue':      return <ActionQueue items={queue} atStake={atStake} />;
      case 'nextStep':   return <NextStepCard position={position} queue={queue} role={profile?.role ?? ''} />;
      case 'motion':     return position && position.motion.length === 0 ? null
                                : <MonthMotion rows={position === null ? null : position.motion} />;
      case 'kpiPaid':    return <KpiTile label="Paid This Month" value={loading ? '—' : fmtIdr(stats.paidThisMonthIdr)}
                                  sub={new Date().toLocaleDateString('en-GB', { month: 'long' })}
                                  color="text-rose-300" ring="ring-rose-500/20" />;
      case 'kpiStockValue': return <KpiTile label="Stock Value" value={stockValue == null ? '—' : fmtIdr(stockValue)}
                                  sub="on-hand × avg landed cost" color="text-violet-300" ring="ring-violet-500/20" />;
      case 'kpiActivePos':  return <KpiTile label="Active POs" value={loading ? '—' : stats.activePOs.toString()}
                                  sub="not cancelled" color="text-sky-300" ring="ring-sky-500/20" />;
      case 'kpiComponents': return <KpiTile label="Components" value={loading ? '—' : stats.componentCount.toLocaleString('en-US')}
                                  sub="in catalog" color="text-emerald-300" ring="ring-emerald-500/20" />;
      case 'newArrivals':   return <NewArrivals rows={arrivedItems} days={newArrivalDays} />;
      case 'arriving':      return <ArrivingSoon data={arriving} buySide={!!perms?.buySide} />;
      case 'topProducts':   return <TopBoard title="Top products" board={productBoard} by={rankProducts}
                                  onPick={(b) => pickRank('products', b)} noun="product" period={economicsPeriod}
                                  canProfit={!!perms?.canViewEconomics} href="/profitability" />;
      case 'topCustomers':  return <TopBoard title="Top customers" board={customerBoard} by={rankCustomers}
                                  onPick={(b) => pickRank('customers', b)} noun="customer" period={economicsPeriod}
                                  canProfit={!!perms?.canViewEconomics} href="/customers" />;
      case 'lastPayments':  return <FeedCard title="Last payments" feed={payments} href="/banks"
                                  empty="No payment has been recorded yet." showMoney />;
      case 'lastDeliveries': return <FeedCard title="Last deliveries" feed={deliveries} href="/delivery"
                                  empty="Nothing has shipped yet." />;
      case 'lastCases':     return <FeedCard title="Last service tickets" feed={cases} href="/aftersales"
                                  empty="No service ticket has been raised yet." />;
      case 'stockAlerts':   return <StockAlerts shortages={shortages} reorders={reorders} />;
      case 'activity':      return <ActivityStream rows={activity} />;
      case 'quickActions':  return quickActions.length === 0 ? null : <QuickActions items={quickActions} />;
      default:              return null;
    }
  };

  return (
    <div className="min-h-screen bg-chrome text-slate-200 font-sans text-sm">
      {/* ── Header ── */}
      <div className="border-b border-slate-800/60 bg-chrome/80 backdrop-blur-md sticky top-0 z-30">
        {/* One row at every width. The other pages stack on phones because
            they carry three action buttons that would squeeze the wordmark;
            this header carries one small toggle, so stacking it only produced
            a third, ragged, left-hung row. BrandMenu reports its true minimum
            width, so if it ever stops fitting the button wraps by itself. */}
        <div className="max-w-[1800px] 2xl:max-w-[2460px] mx-auto px-3 sm:px-4 md:px-6 xl:px-8 py-3 sm:py-4 flex flex-row items-center justify-between flex-wrap gap-x-3 gap-y-2 sm:gap-4">
          <BrandMenu
            wordmarkClass="text-xl md:text-2xl font-extrabold"
            subtitle={new Date().toLocaleDateString('en-GB', { weekday: 'short', year: 'numeric', month: 'short', day: 'numeric' })}
          />
          {arranged.length > 0 && (
            <button onClick={() => setCustomising((v) => !v)} aria-expanded={customising}
              className={`flex-shrink-0 flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-[11px] font-semibold border transition-colors ${
                customising ? 'bg-emerald-500/15 text-emerald-300 border-emerald-500/40'
                            : 'border-slate-800 text-slate-400 hover:text-white hover:border-slate-600'}`}>
              <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
                <path strokeLinecap="round" strokeLinejoin="round" d="M4 6h10M18 6h2M4 12h2M10 12h10M4 18h8M16 18h4" />
                <circle cx="16" cy="6" r="2" /><circle cx="8" cy="12" r="2" /><circle cx="14" cy="18" r="2" />
              </svg>
              Customise
            </button>
          )}
        </div>
      </div>

      <main className="max-w-[1800px] 2xl:max-w-[2460px] mx-auto px-3 sm:px-4 md:px-6 xl:px-8 py-6 xl:py-8 space-y-6 xl:space-y-7">

        {/* ── Customise: what this person watches, and in what order ──
               Personal and per-device. The house layout stays in
               Settings › Dashboard, and changing it dissolves every stale
               personal arrangement so the setting never looks dead. */}
        {customising && (
          <div className="bg-slate-900/60 border border-slate-800/80 ring-1 ring-emerald-500/15 rounded-2xl p-4 sm:p-5 space-y-3.5">
            <div className="flex items-center justify-between gap-3 flex-wrap">
              <div className="min-w-0">
                <p className="text-xs font-bold uppercase tracking-widest text-emerald-300">Your dashboard</p>
                <p className="text-[11px] text-slate-500 leading-snug mt-1 max-w-2xl">
                  {t('Tick what you want to watch, drag a row to move it (the arrows do the same on touch). This is your own arrangement, on this browser — it does not change anyone else’s.')}
                  {perms?.canManageUsers && (
                    <> <Link href="/settings?tab=dashboard" className="text-slate-400 hover:text-emerald-300 font-semibold transition-colors">Settings › Dashboard</Link>{' '}
                      {t('sets the starting point for everyone.')}</>
                  )}
                </p>
              </div>
              <div className="flex items-center gap-2 flex-shrink-0">
                <button onClick={reset} disabled={!isPersonal}
                  className="text-[11px] font-semibold text-slate-400 hover:text-white disabled:text-slate-700 disabled:hover:text-slate-700 transition-colors">
                  Reset to house default
                </button>
                <button onClick={() => setCustomising(false)}
                  className="text-[11px] font-semibold px-2.5 py-1.5 rounded-lg bg-slate-800/60 text-slate-300 hover:bg-slate-700 hover:text-white transition-colors">
                  Done
                </button>
              </div>
            </div>
            <WidgetArranger rows={arranged} onChange={(next: DashboardLayout) => save(next)} />
            {visible.length === 0 && (
              <p className="text-[11px] text-amber-300/80">Everything is switched off — the dashboard below is empty until you tick something.</p>
            )}
          </div>
        )}

        {/* ── The widgets, in this person's order ──
               One grid rather than a stack of hand-placed sections: a widget
               declares its width in constants/dashboardWidgets.ts and lands
               wherever the order puts it. */}
        {perms === null ? (
          <div className="grid grid-cols-1 xl:grid-cols-2 gap-5">
            {[...Array(4)].map((_, i) => <div key={i} className="h-28 bg-slate-800/30 rounded-2xl animate-pulse" />)}
          </div>
        ) : visible.length === 0 ? (
          <p className="text-center text-xs text-slate-500 py-16">
            {arranged.length === 0
              ? 'There is no dashboard panel for this role — your work lives in the menu above.'
              : customising
                ? 'Nothing is switched on yet.'
                : 'Every panel is switched off — press Customise to bring one back.'}
          </p>
        ) : (
          <div className="grid grid-cols-2 lg:grid-cols-12 gap-x-4 xl:gap-x-5 gap-y-6 xl:gap-y-7">
            {visible.map((w) => {
              const node = widgetNode(w.key);
              if (!node) return null;
              return (
                <div key={w.key} className={`${WIDTH_SPAN[w.width]} min-w-0 h-full [&>*]:h-full`}>{node}</div>
              );
            })}
          </div>
        )}
      </main>
    </div>
  );
}

/** One KPI tile — a label, one big number, and what the number means. */
function KpiTile({ label, value, sub, color, ring }: {
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
function QuickActions({ items }: { items: { href: string; label: string; accent: string }[] }) {
  return (
    <div className="bg-slate-900/40 border border-slate-800/80 ring-1 ring-white/5 rounded-2xl p-5">
      <p className="text-[10px] font-semibold uppercase tracking-widest text-slate-500 mb-3">Quick Actions</p>
      <div className="space-y-2">
        {items.map(({ href, label, accent }) => (
          <Link key={href} href={href}
            className="flex items-center gap-3 px-3 py-2.5 rounded-xl bg-slate-800/30 hover:bg-slate-800/60 border border-transparent hover:border-slate-700 transition-colors group">
            <span className={`w-1.5 h-1.5 rounded-full ${DOT[accent]}`} />
            <span className="text-sm text-slate-300 group-hover:text-white transition-colors">{label}</span>
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
 * What just landed — and what still cannot be sold.
 *
 * A newsfeed of arrivals would be pleasant and useless. The useful half is the
 * gap it exposes: goods sitting on the shelf that nobody has priced, so no
 * salesperson can quote them. That badge is the reason this panel exists.
 *
 * Deliberately free of money and suppliers, so a sell-side login sees exactly
 * what a buyer sees: what came in, how much of it, and when.
 */
function NewArrivals({ rows, days }: { rows: NewArrival[] | null; days: number }) {
  const { tf } = useT();
  const fresh = rows?.filter((r) => r.brandNew).length ?? 0;
  const unpriced = rows?.filter((r) => r.needsPrice).length ?? 0;
  const SHOWN = 6;
  return (
    <div className="bg-slate-900/60 border border-slate-800/80 ring-1 ring-white/5 rounded-2xl overflow-hidden">
      <div className="flex items-center gap-3 px-4 sm:px-5 py-3.5 border-b border-slate-800/70">
        <h2 className="text-sm font-bold text-white">New arrivals</h2>
        {rows && rows.length > 0 && (
          <span className="text-[10px] font-bold uppercase tracking-widest text-slate-500">
            {fresh > 0 ? `${fresh} new` : ''}
            {fresh > 0 && rows.length > fresh ? ' · ' : ''}
            {rows.length > fresh ? `${rows.length - fresh} restocked` : ''}
          </span>
        )}
        <Link href="/products?new=1" className="ml-auto text-[11px] text-slate-500 hover:text-emerald-300 transition-colors whitespace-nowrap">
          Products →
        </Link>
      </div>

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
              <Link key={r.component_id} href={`/products?q=${encodeURIComponent(r.name)}`}
                className="flex items-baseline gap-x-2.5 gap-y-1 flex-wrap px-4 sm:px-5 py-2.5 hover:bg-slate-800/40 transition-colors group">
                <span className={`w-1.5 h-1.5 rounded-full self-center flex-shrink-0 ${r.brandNew ? 'bg-emerald-400' : 'bg-slate-600'}`} />
                <span className="text-[13px] font-semibold text-slate-100 group-hover:text-white truncate max-w-[300px]">{r.name}</span>
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
function ArrivingSoon({ data, buySide }: { data: ArrivingSummary | null; buySide: boolean }) {
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
      <div className="flex items-center gap-3 px-4 sm:px-5 py-3.5 border-b border-slate-800/70">
        <h2 className="text-sm font-bold text-white">Arriving soon</h2>
        {data && rows!.length > 0 && (
          <span className="text-[10px] font-bold uppercase tracking-widest text-slate-500">
            {rows!.length} item{rows!.length !== 1 ? 's' : ''}
            {data.late.length > 0 ? ` · ${data.late.length} late` : ''}
          </span>
        )}
        {buySide && (
          <Link href="/purchasing?tab=lookup" className="ml-auto text-[11px] text-slate-500 hover:text-sky-300 transition-colors whitespace-nowrap">
            Deal Lookup →
          </Link>
        )}
      </div>

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
              <div key={r.component_id} className="flex items-baseline gap-x-2.5 gap-y-1 flex-wrap px-4 sm:px-5 py-2.5">
                <span className={`w-1.5 h-1.5 rounded-full self-center flex-shrink-0 ${r.overdue ? 'bg-amber-400' : 'bg-sky-400'}`} />
                <span className="text-[13px] font-semibold text-slate-100 truncate max-w-[280px]">{r.name}</span>
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
function FeedCard({ title, feed, href, empty, showMoney = false }: {
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
function TopBoard({ title, board, by, onPick, noun, period, canProfit, href }: {
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
