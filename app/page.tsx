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
import { fmtIdr } from '@/lib/formatters';
import { fetchActionQueue, fetchActivity, type ActionItem, type ActivityRow } from '@/lib/dashboard';
import { fetchPosition, type PositionData } from '@/lib/position';
import { fetchShortages, fetchReorderAlerts, type ShortageAlert, type ReorderAlert } from '@/lib/reorder';
import {
  KpiTile, QuickActions, ActionQueue, NewArrivals, ArrivingSoon, FeedCard, TopBoard,
  StockAlerts, PositionStrip, MonthMotion, NextStepCard, ActivityStream,
} from '@/components/dashboard/Widgets';
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
        <div className="max-w-[1800px] 2xl:max-w-[2460px] mx-auto px-3 sm:px-4 md:px-6 xl:px-8 py-2.5 sm:py-3 flex flex-row items-center justify-between flex-wrap gap-x-3 gap-y-2 sm:gap-x-4 sm:gap-y-2.5">
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

      <main className="max-w-[1800px] 2xl:max-w-[2460px] mx-auto px-3 sm:px-4 md:px-6 xl:px-8 py-4 sm:py-5 xl:py-6 space-y-6 xl:space-y-7">

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