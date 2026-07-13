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
import ProductCostLookup from '@/components/ui/ProductCostLookup';
import AppSwitcher from '@/components/ui/AppSwitcher';
import CommandPalette from '@/components/ui/CommandPalette';
import POCashCycle from '@/components/ui/POCashCycle';
import PricingIntelligence from '@/components/ui/PricingIntelligence';
import ExchangeRateTrends from '@/components/ui/ExchangeRateTrends';
import SpendOverview from '@/components/ui/SpendOverview';
import CategoryPositioningMap from '@/components/ui/CategoryPositioningMap';
import CostBreakdown from '@/components/ui/CostBreakdown';
import { ToastProvider } from '@/hooks/useToast';
import { deriveExchangeRates } from '@/lib/exchangeRates';

type TabId = 'spend' | 'lookup' | 'pricing' | 'cash' | 'xrates' | 'positioning' | 'costs';

const TABS: { id: TabId; label: string }[] = [
  { id: 'spend',       label: 'Spend Overview'  },
  { id: 'lookup',      label: 'Cost Lookup'     },
  { id: 'costs',       label: 'Cost Breakdown'  },
  { id: 'pricing',     label: 'Pricing'         },
  { id: 'cash',        label: 'Cash Cycle'      },
  { id: 'xrates',      label: 'Exchange Rates'  },
  { id: 'positioning', label: 'Positioning Map' },
];

const TAB_ICONS: Record<TabId, React.ReactNode> = {
  spend: (
    <svg className="w-3.5 h-3.5 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="1.8">
      <path strokeLinecap="round" strokeLinejoin="round" d="M11 3.055A9.001 9.001 0 1020.945 13H11V3.055z" />
      <path strokeLinecap="round" strokeLinejoin="round" d="M20.488 9H15V3.512A9.025 9.025 0 0120.488 9z" />
    </svg>
  ),
  lookup: (
    <svg className="w-3.5 h-3.5 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="1.8">
      <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
    </svg>
  ),
  pricing: (
    <svg className="w-3.5 h-3.5 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="1.8">
      <path strokeLinecap="round" strokeLinejoin="round" d="M13 7h8m0 0v8m0-8l-8 8-4-4-6 6" />
    </svg>
  ),
  cash: (
    <svg className="w-3.5 h-3.5 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="1.8">
      <path strokeLinecap="round" strokeLinejoin="round" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
    </svg>
  ),
  xrates: (
    <svg className="w-3.5 h-3.5 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="1.8">
      <path strokeLinecap="round" strokeLinejoin="round" d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
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
  const { user, profile, loading: authLoading, signOut } = useAuth();
  const { data, loading, lastFetched, refetch } = useSupabaseData();
  const [activeTab, setActiveTab] = useState<TabId>('spend');
  const [refreshing, setRefreshing] = useState(false);
  const now = useNow(30_000); // tick every 30s to update "X min ago"

  // Procurement-sensitive data — sign-in required
  useEffect(() => {
    if (!authLoading && !user) router.replace('/login?next=/insights');
  }, [authLoading, user, router]);

  // Deep links from the global search palette: /insights?tab=lookup&q=<name>
  const [lookupQuery, setLookupQuery] = useState('');
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const tab = params.get('tab');
    if (tab && TABS.some((t) => t.id === tab)) setActiveTab(tab as TabId);
    const q = params.get('q');
    if (q) setLookupQuery(q);
  }, []);

  // Derive exchange rates on-the-fly from PO payments — always up-to-date
  const exchangeRates = useMemo(
    () => deriveExchangeRates(data.pos, data.poItems, data.poCosts, data.quotes),
    [data.pos, data.poItems, data.poCosts, data.quotes],
  );

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
      <div className="min-h-screen bg-[#141518] flex items-center justify-center">
        <div className="w-6 h-6 border-2 border-emerald-500/30 border-t-emerald-500 rounded-full animate-spin" />
      </div>
    );
  }

  return (
    <ToastProvider>
      <div className="min-h-screen bg-[#141518] text-slate-200 font-sans text-sm selection:bg-white/20">
        <CommandPalette />

        {/* ── Sticky header + tab bar ── */}
        <div className="sticky top-0 z-50 bg-[#141518]/90 backdrop-blur-xl border-b border-white/[0.07]">
          <header className="px-4 md:px-8 xl:px-12 pt-4 xl:pt-5 pb-2 max-w-[1800px] mx-auto flex items-start justify-between gap-4">
            <div>
              <h1 className="text-lg md:text-xl xl:text-2xl font-bold text-white tracking-tight">
                ICAPROC
              </h1>
              <p className="text-slate-500 text-[11px] mt-0.5 hidden sm:block">
                Insights · True Unit Cost · Pricing · Cash Cycle
              </p>
            </div>
            {/* Refresh control */}
            <div className="flex items-center gap-2 mt-1 flex-shrink-0">
              <AppSwitcher />
              {profile && (
                <div className="text-right hidden lg:block mr-1">
                  <p className="text-[11px] text-slate-400 leading-tight">{profile.email}</p>
                  <button onClick={() => signOut().then(() => router.replace('/login'))} className="text-[10px] text-slate-600 hover:text-slate-300 underline transition-colors">
                    Sign out
                  </button>
                </div>
              )}
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
          <nav className="px-4 md:px-8 xl:px-12 pb-3 xl:pb-4 max-w-[1800px] mx-auto flex overflow-x-auto gap-1.5 xl:gap-2 scrollbar-none snap-x snap-mandatory">
            {TABS.map((tab) => (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                className={`snap-start px-3 py-1.5 xl:px-4 xl:py-2 rounded-full text-xs xl:text-sm font-medium whitespace-nowrap transition-all duration-150 flex items-center gap-1.5 flex-shrink-0 ${
                  activeTab === tab.id
                    ? 'bg-white/10 text-white'
                    : 'text-slate-500 hover:text-slate-300 hover:bg-white/5'
                }`}
              >
                {TAB_ICONS[tab.id]}
                {tab.label}
              </button>
            ))}
          </nav>
        </div>

        {/* ── Tab content ── */}
        <main className="p-4 md:p-8 xl:p-10 2xl:p-12 max-w-[1800px] mx-auto animate-in fade-in duration-300">

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

          {/* Cost Lookup */}
          <div className={activeTab !== 'lookup' ? 'hidden' : 'space-y-6'}>
            <div className="mb-6">
              <h2 className="text-base md:text-lg font-semibold text-white tracking-tight">Product Cost Lookup</h2>
              <p className="text-slate-500 text-[11px] mt-1 max-w-2xl">
                All amounts are ex-PPN (tax). True unit cost = payments + bank fees + landed costs, split by line share of PO value.
              </p>
            </div>
            <ProductCostLookup
              components={data.components}
              quotes={data.quotes}
              quoteItems={data.quoteItems}
              pos={data.pos}
              poItems={data.poItems}
              poCosts={data.poCosts}
              suppliers={data.suppliers}
              componentLinks={data.componentLinks}
              isLoading={loading}
              key={lookupQuery || 'lookup'}
              initialQuery={lookupQuery}
            />
          </div>

          {/* Pricing Intelligence */}
          <div className={activeTab !== 'pricing' ? 'hidden' : 'space-y-6'}>
            <div className="mb-6">
              <h2 className="text-base md:text-lg font-semibold text-white tracking-tight">Pricing Intelligence</h2>
              <p className="text-slate-500 text-[11px] mt-1 max-w-2xl">
                Connect True Unit Cost with market / competitor prices to set margin-aware sell prices. Gross margin = (Sell − TUC) / Sell.
              </p>
            </div>
            <PricingIntelligence
              components={data.components}
              poItems={data.poItems}
              pos={data.pos}
              quoteItems={data.quoteItems}
              quotes={data.quotes}
              poCosts={data.poCosts}
              competitorPrices={data.competitorPrices}
              isLoading={loading}
            />
          </div>

          {/* Cash Cycle */}
          <div className={activeTab !== 'cash' ? 'hidden' : 'space-y-6'}>
            <div className="mb-6">
              <h2 className="text-base md:text-lg font-semibold text-white tracking-tight">Cash Conversion Cycle</h2>
              <p className="text-slate-500 text-[11px] mt-1 max-w-2xl">
                Per-product reorder cycles: time between consecutive balance-settled POs for the same item.
                Shows how long a batch lasts before you need to reorder.
                Only products with ≥2 fully-paid POs are shown.
              </p>
            </div>
            <POCashCycle
              pos={data.pos}
              poItems={data.poItems}
              poCosts={data.poCosts}
              components={data.components}
              quotes={data.quotes}
              suppliers={data.suppliers}
              isLoading={loading}
            />
          </div>

          {/* Exchange Rate Trends */}
          <div className={activeTab !== 'xrates' ? 'hidden' : 'space-y-6'}>
            <div className="mb-6">
              <h2 className="text-base md:text-lg font-semibold text-white tracking-tight">Currency Exchange Rates</h2>
              <p className="text-slate-500 text-[11px] mt-1 max-w-2xl">
                Historical FX rates realized from procurement: implied rate = total payments in IDR ÷ quoted amount in foreign currency.
                Shows trends by supplier and currency to inform future PO pricing.
              </p>
            </div>
            <ExchangeRateTrends
              rates={exchangeRates}
              suppliers={data.suppliers}
            />
          </div>

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
