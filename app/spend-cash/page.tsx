/**
 * Management Intelligence
 * Analysis-focused view for management: TUC, pricing, and cash cycle.
 * Procurement-sensitive data — not for general staff use.
 */
'use client';
import React, { useState, useEffect, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import { useSupabaseData } from '@/hooks/useSupabaseData';
import { useAuth } from '@/hooks/useAuth';
import { ROLE_PERMISSIONS } from '@/constants/roles';
import { canOpenPath } from '@/constants/navigation';
import BrandMenu from '@/components/ui/BrandMenu';
import MobileNotice from '@/components/ui/MobileNotice';
import SpendOverview from '@/components/ui/SpendOverview';
import CategoryPositioningMap from '@/components/ui/CategoryPositioningMap';
import CostBreakdown from '@/components/ui/CostBreakdown';
import { ToastProvider } from '@/hooks/useToast';

// 'lookup' (Product Cost Lookup) retired 2026-08-01 — its forensic layer lives
// in Analytics › Items now (components/ui/ProductCostLookup.tsx kept on disk
// until the owner is ready to delete it for good).
// 'pricing', 'cash' and 'xrates' (Pricing Intelligence, Cash Cycle, Exchange
// Rates) retired here 2026-08-11 (owner's call) — all three live on the Item
// hub now as per-item tabs (the components are reused there, not copied;
// POCashCycle + PricingIntelligence render on the hub, the hub's FxTab uses
// the same deriveExchangeRates engine). Old ?tab= deep links fall back to
// Spend Overview via the TABS guard below.
type TabId = 'spend' | 'positioning' | 'costs';

const TABS: { id: TabId; label: string }[] = [
  { id: 'spend',       label: 'Spend Overview'  },
  { id: 'costs',       label: 'Cost Breakdown'  },
  { id: 'positioning', label: 'Positioning Map' },
];

const TAB_ICONS: Record<TabId, React.ReactNode> = {
  spend: (
    <svg className="w-3.5 h-3.5 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="1.8">
      <path strokeLinecap="round" strokeLinejoin="round" d="M11 3.055A9.001 9.001 0 1020.945 13H11V3.055z" />
      <path strokeLinecap="round" strokeLinejoin="round" d="M20.488 9H15V3.512A9.025 9.025 0 0120.488 9z" />
    </svg>
  ),
  positioning: (
    <svg className="w-3.5 h-3.5 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="1.8">
      <circle cx="5" cy="18" r="1.5" />
      <circle cx="9" cy="12" r="1.5" />
      <circle cx="15" cy="7" r="1.5" />
      <circle cx="19" cy="15" r="1.5" />
      <line x1="3" y1="21" x2="21" y2="21" strokeLinecap="round" />
      <line x1="3" y1="3" x2="3" y2="21" strokeLinecap="round" />
    </svg>
  ),
  costs: (
    <svg className="w-3.5 h-3.5 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="1.8">
      <path strokeLinecap="round" strokeLinejoin="round" d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
    </svg>
  ),
};

function useNow(intervalMs: number) {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), intervalMs);
    return () => clearInterval(id);
  }, [intervalMs]);
  return now;
}

export default function DatabaseViewPage() {
  const router = useRouter();
  const { user, profile, loading: authLoading } = useAuth();
  const { data, loading, lastFetched, refetch } = useSupabaseData();
  const [activeTab, setActiveTab] = useState<TabId>('spend');
  const [refreshing, setRefreshing] = useState(false);
  const now = useNow(30_000); // tick every 30s to update "X min ago"
  useEffect(() => { document.title = 'Spend & Cash — ICAPROC'; }, []);

  // Procurement-sensitive data — sign-in required
  useEffect(() => {
    if (!authLoading && !user) router.replace('/login?next=/spend-cash');
  }, [authLoading, user, router]);
  // Analytics is OWNER ONLY (canViewAnalytics, decided 2026-07-30) — this
  // screen aggregates spend, TUC and the cash cycle across the business.
  // Deal/cost lookup for buy-side roles lives in Purchasing (/purchasing?tab=lookup).
  useEffect(() => {
    if (!profile) return;
    const p = ROLE_PERMISSIONS[profile.role];
    if (!canOpenPath(p, '/spend-cash')) router.replace('/unauthorized');
  }, [profile, router]);

  // Deep links: /spend-cash?tab=<id>. Old ?tab=lookup links (the retired Cost
  // Lookup) fall back to the first tab rather than erroring.
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const tab = params.get('tab');
    if (tab && TABS.some((t) => t.id === tab)) setActiveTab(tab as TabId);
  }, []);

  const minutesStale = lastFetched ? Math.floor((now.getTime() - lastFetched.getTime()) / 60_000) : null;
  const isStale = minutesStale !== null && minutesStale >= 30;

  async function handleRefresh() {
    setRefreshing(true);
    await refetch();
    setRefreshing(false);
  }

  function fmtTime(d: Date) {
    return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  }

  if (authLoading || !user) {
    return (
      <div className="min-h-screen bg-canvas flex items-center justify-center">
        <div className="w-6 h-6 border-2 border-emerald-500/30 border-t-emerald-500 rounded-full animate-spin" />
      </div>
    );
  }

  return (
    <ToastProvider>
      <div className="min-h-screen bg-canvas text-slate-200 font-sans text-sm selection:bg-white/20">

        {/* ── Sticky header + tab bar ── */}
        <div className="sticky top-0 z-50 bg-canvas/90 backdrop-blur-xl border-b border-white/[0.07]">
          <header className="px-3 sm:px-4 md:px-6 xl:px-8 pt-4 xl:pt-5 pb-2 max-w-[1800px] 2xl:max-w-[2460px] mx-auto flex items-start justify-between flex-wrap gap-4">
            <BrandMenu wordmarkClass="text-lg md:text-xl xl:text-2xl font-bold" subtitle="Spend & Cash · Spend · Costs · Positioning" showStatus={false} />
            {/* Refresh control. No account block here — the ICAPROC menu
                already shows the signed-in user + Sign out; repeating them
                next to the clock made the header read as clutter. */}
            <div className="flex items-center gap-2 mt-1 flex-shrink-0">
              {lastFetched && (
                <span className={`text-[11px] ${isStale ? 'text-amber-400' : 'text-slate-500'}`}>
                  {isStale && (
                    <span className="inline-block w-1.5 h-1.5 rounded-full bg-amber-400 mr-1.5 animate-pulse align-middle" />
                  )}
                  {minutesStale === 0
                    ? `Updated ${fmtTime(lastFetched)}`
                    : `Updated ${minutesStale}m ago`}
                </span>
              )}
              <button
                onClick={handleRefresh}
                disabled={refreshing || loading}
                title="Refresh data"
                className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-[11px] font-medium text-slate-400 hover:text-white hover:bg-white/10 transition-all disabled:opacity-40 border border-white/[0.06]"
              >
                <svg
                  className={`w-3 h-3 ${refreshing ? 'animate-spin' : ''}`}
                  fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2"
                >
                  <path strokeLinecap="round" strokeLinejoin="round" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                </svg>
                Refresh
              </button>
            </div>
          </header>
          {/* Text-only underline tabs — same treatment as the Catalog bar:
              shared bottom rail groups them, sky underline marks the active one. */}
          <nav className="px-3 sm:px-4 md:px-6 xl:px-8 scroll-px-3 sm:scroll-px-4 md:scroll-px-6 xl:scroll-px-8 max-w-[1800px] 2xl:max-w-[2460px] mx-auto flex overflow-x-auto gap-4 xl:gap-6 scrollbar-none snap-x snap-mandatory">
            {TABS.map((tab) => (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                className={`snap-start pt-1 pb-2.5 xl:pb-3 text-xs xl:text-sm whitespace-nowrap transition-colors flex-shrink-0 border-b-2 ${
                  activeTab === tab.id
                    ? 'border-sky-400 text-white font-semibold tracking-tight'
                    : 'border-transparent text-slate-500 hover:text-slate-300 font-normal tracking-wide'
                }`}
              >
                {tab.label}
              </button>
            ))}
          </nav>
        </div>

        {/* ── Tab content ── */}
        <main className="p-4 md:p-8 xl:p-10 2xl:p-12 max-w-[1800px] 2xl:max-w-[2460px] mx-auto animate-in fade-in duration-300">
          <MobileNotice variant="view" />

          {/* Spend Overview */}
          <div className={activeTab !== 'spend' ? 'hidden' : ''}>
            <SpendOverview
              components={data.components}
              suppliers={data.suppliers}
              quotes={data.quotes}
              pos={data.pos}
              poItems={data.poItems}
              poCosts={data.poCosts}
              quoteItems={data.quoteItems}
              isLoading={loading}
            />
          </div>

          {/* Pricing Intelligence, Cash Cycle and Exchange Rates retired here
              2026-08-11 — all three live on the Item hub now, pinned to the
              item being viewed. See the TabId note. */}

          {/* Positioning Map */}
          <div className={activeTab !== 'positioning' ? 'hidden' : 'space-y-6'}>
            <div className="mb-6">
              <h2 className="text-base md:text-lg font-semibold text-white tracking-tight">Category Positioning Map</h2>
              <p className="text-slate-500 text-[11px] mt-1 max-w-2xl">
                Price per unit vs. capacity for each product category. Quadrant lines at median X and Y.
                Set a <span className="text-slate-400">Capacity</span> value on components (in the Catalog editor) to place them on the map.
                Price source priority: TUC → last quote → last PO cost.
              </p>
            </div>
            <CategoryPositioningMap
              components={data.components}
              quoteItems={data.quoteItems}
              quotes={data.quotes}
              pos={data.pos}
              poItems={data.poItems}
              poCosts={data.poCosts}
              isLoading={loading}
            />
          </div>

          {/* Cost Breakdown */}
          <div className={activeTab !== 'costs' ? 'hidden' : 'space-y-6'}>
            <div className="mb-6">
              <h2 className="text-base md:text-lg font-semibold text-white tracking-tight">Cost Breakdown</h2>
              <p className="text-slate-500 text-[11px] mt-1 max-w-2xl">
                How total procurement spend splits across supplier cost, bank fees, landed costs, and taxes —
                aggregated by category, vendor, or individual product.
                Only POs with both line items and payment records are included.
              </p>
            </div>
            <CostBreakdown
              components={data.components}
              pos={data.pos}
              poItems={data.poItems}
              poCosts={data.poCosts}
              suppliers={data.suppliers}
              quotes={data.quotes}
              isLoading={loading}
            />
          </div>

        </main>
      </div>
    </ToastProvider>
  );
}
