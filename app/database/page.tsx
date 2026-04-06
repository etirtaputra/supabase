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
import { ToastProvider } from '@/hooks/useToast';

type TabId = 'lookup' | 'pricing' | 'cash';

const TABS: { id: TabId; label: string; icon: string; color: string; activeColor: string }[] = [
  { id: 'lookup',  label: 'Cost Lookup',  icon: '🔍',
    color: 'text-slate-400 hover:text-sky-300 hover:bg-slate-800/50',
    activeColor: 'bg-sky-500/15 text-sky-300 ring-1 ring-sky-500/30' },
  { id: 'pricing', label: 'Pricing',      icon: '📈',
    color: 'text-slate-400 hover:text-amber-300 hover:bg-slate-800/50',
    activeColor: 'bg-amber-500/15 text-amber-300 ring-1 ring-amber-500/30' },
  { id: 'cash',    label: 'Cash Cycle',   icon: '🔄',
    color: 'text-slate-400 hover:text-violet-300 hover:bg-slate-800/50',
    activeColor: 'bg-violet-500/15 text-violet-300 ring-1 ring-violet-500/30' },
];

export default function DatabaseViewPage() {
  const { data, loading } = useSupabaseData();
  const [activeTab, setActiveTab] = useState<TabId>('lookup');

  return (
    <ToastProvider>
      <div className="min-h-screen bg-[#0B1120] text-slate-200 font-sans text-sm selection:bg-sky-500/30">

        {/* ── Sticky header + tab bar ── */}
        <div className="sticky top-0 z-50 bg-[#0B1120]/80 backdrop-blur-md border-b border-slate-800/60 shadow-lg shadow-black/20">
          <header className="px-4 md:px-8 xl:px-12 pt-5 xl:pt-6 pb-3 max-w-[1800px] mx-auto flex flex-col sm:flex-row sm:items-end justify-between gap-2">
            <div>
              <h1 className="text-xl md:text-3xl xl:text-4xl font-extrabold text-white tracking-tight leading-tight">
                Supply Chain{' '}
                <span className="text-transparent bg-clip-text bg-gradient-to-r from-amber-400 to-rose-400">Intelligence</span>
              </h1>
              <p className="text-slate-400 text-xs mt-1 hidden sm:block font-medium">
                True Unit Cost · Pricing · Cash Cycle — management view
              </p>
            </div>
          </header>
          <nav className="px-4 md:px-8 xl:px-12 pb-3 xl:pb-4 max-w-[1800px] mx-auto flex overflow-x-auto gap-2 xl:gap-3 scrollbar-none snap-x snap-mandatory">
            {TABS.map((tab) => (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                className={`snap-start px-4 py-2 xl:px-6 xl:py-2.5 rounded-full text-xs xl:text-sm font-semibold whitespace-nowrap transition-all duration-200 flex items-center gap-1.5 flex-shrink-0 ${
                  activeTab === tab.id
                    ? 'bg-slate-700 text-white'
                    : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/60'
                }`}
              >
                <span className="text-sm xl:text-base leading-none">{tab.icon}</span>
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
              <h2 className="text-lg md:text-xl font-bold text-sky-400 tracking-tight">Product Cost Lookup</h2>
              <p className="text-slate-400 text-xs mt-1 max-w-2xl">
                All amounts are <span className="text-slate-200 font-medium">ex-PPN (tax)</span>.
                True unit cost = payments + bank fees + landed costs, split by line share of PO value.
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
              <h2 className="text-lg md:text-xl font-bold text-amber-400 tracking-tight">Pricing Intelligence</h2>
              <p className="text-slate-400 text-xs mt-1 max-w-2xl">
                Connect <span className="text-slate-200 font-medium">True Unit Cost</span> with{' '}
                <span className="text-slate-200 font-medium">market / competitor prices</span> to set margin-aware sell prices.
                Gross margin = (Sell − TUC) / Sell.
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
              <h2 className="text-lg md:text-xl font-bold text-violet-400 tracking-tight">Cash Conversion Cycle</h2>
              <p className="text-slate-400 text-xs mt-1 max-w-2xl">
                Per-product reorder cycles: time between consecutive balance-settled POs for the same item.
                Shows <span className="text-slate-200 font-medium">how long a batch lasts</span> before you need to reorder.
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

        </main>
      </div>
    </ToastProvider>
  );
}
