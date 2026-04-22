/**
 * Management Intelligence
 * Analysis-focused view for management: TUC, pricing, and cash cycle.
 * Procurement-sensitive data — not for general staff use.
 */
'use client';
import { useState } from 'react';
import { useSupabaseData } from '@/hooks/useSupabaseData';
import ProductCostLookup from '@/components/ui/ProductCostLookup';
import POCashCycle from '@/components/ui/POCashCycle';
import PricingIntelligence from '@/components/ui/PricingIntelligence';
import ExchangeRateTrends from '@/components/ui/ExchangeRateTrends';
import { ToastProvider } from '@/hooks/useToast';

type TabId = 'lookup' | 'pricing' | 'cash' | 'xrates';

const TABS: { id: TabId; label: string }[] = [
  { id: 'lookup',  label: 'Cost Lookup'  },
  { id: 'pricing', label: 'Pricing'      },
  { id: 'cash',    label: 'Cash Cycle'   },
  { id: 'xrates',  label: 'Exchange Rates' },
];

const TAB_ICONS: Record<TabId, React.ReactNode> = {
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
};

export default function DatabaseViewPage() {
  const { data, loading } = useSupabaseData();
  const [activeTab, setActiveTab] = useState<TabId>('lookup');

  return (
    <ToastProvider>
      <div className="min-h-screen bg-[#0B1120] text-slate-200 font-sans text-sm selection:bg-white/20">

        {/* ── Sticky header + tab bar ── */}
        <div className="sticky top-0 z-50 bg-[#0B1120]/90 backdrop-blur-xl border-b border-white/[0.07]">
          <header className="px-4 md:px-8 xl:px-12 pt-4 xl:pt-5 pb-2 max-w-[1800px] mx-auto">
            <h1 className="text-lg md:text-xl xl:text-2xl font-bold text-white tracking-tight">
              Supply Chain Intelligence
            </h1>
            <p className="text-slate-500 text-[11px] mt-0.5 hidden sm:block">
              True Unit Cost · Pricing · Cash Cycle
            </p>
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
              isLoading={loading}
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
              rates={data.exchangeRates || []}
              suppliers={data.suppliers}
            />
          </div>

        </main>
      </div>
    </ToastProvider>
  );
}
