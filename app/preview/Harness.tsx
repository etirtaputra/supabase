'use client';
import { useEffect, useState } from 'react';
import SpendOverview from '@/components/ui/SpendOverview';
import CategoryPositioningMap from '@/components/ui/CategoryPositioningMap';
import { PALETTE_SCALES, PALETTE_STEPS, type ThemeName } from '@/constants/palette';
import { mockMotion } from '@/lib/dev/mockChartData';
import { THEMES } from '@/lib/theme';
import {
  mockComponents, mockSuppliers, mockPos, mockPoItems, mockPoCosts, mockQuotes, mockQuoteItems,
  mockQueue, mockActivity, mockNewArrivals, mockArriving, mockBoard, mockPayments, mockPosition,
} from '@/lib/dev/mockChartData';
import {
  ActionQueue, NewArrivals, ArrivingSoon, TopBoard, FeedCard, StockAlerts,
  PositionStrip, MonthMotion, ActivityStream, KpiTile, QuickActions,
} from '@/components/dashboard/Widgets';
import { ROLE_PERMISSIONS } from '@/constants/roles';

/**
 * Flip every skin against the same fabricated data and look.
 *
 * The skin is set on <html> directly rather than through lib/theme, so opening
 * the preview never writes anyone's stored preference — you can leave this page
 * on Paper and your own app is still on whatever you chose.
 */
export default function Harness() {
  const [skin, setSkin] = useState<ThemeName>('terminal');

  useEffect(() => {
    const el = document.documentElement;
    const had = el.getAttribute('data-theme');
    if (skin === 'terminal') el.removeAttribute('data-theme');
    else el.setAttribute('data-theme', skin);
    return () => { if (had) el.setAttribute('data-theme', had); else el.removeAttribute('data-theme'); };
  }, [skin]);

  const rows = { components: mockComponents, suppliers: mockSuppliers, pos: mockPos,
    poItems: mockPoItems, poCosts: mockPoCosts, quotes: mockQuotes, quoteItems: mockQuoteItems } as never;
  const r = rows as unknown as Record<string, never[]>;

  return (
    <div className="min-h-screen bg-canvas text-slate-200 font-sans text-sm">
      <div className="sticky top-0 z-30 bg-chrome/80 backdrop-blur-md border-b border-slate-800/60">
        <div className="max-w-[1800px] mx-auto px-4 py-3 flex items-center gap-3 flex-wrap">
          <span className="text-lg font-extrabold text-white">Component preview</span>
          <span className="text-[11px] text-slate-500">
            Fabricated data · development only · nothing here touches the database
          </span>
          <div className="ml-auto flex items-center gap-1 flex-wrap">
            {THEMES.map((t) => (
              <button key={t.value} onClick={() => setSkin(t.value)} aria-pressed={skin === t.value}
                className={`px-2.5 py-1 rounded-lg text-[11px] font-semibold border transition-colors ${
                  skin === t.value ? 'bg-emerald-500/15 text-emerald-300 border-emerald-500/40'
                                   : 'border-slate-800 text-slate-500 hover:text-white hover:border-slate-600'}`}>
                {t.label}
              </button>
            ))}
          </div>
        </div>
      </div>

      <main className="max-w-[1800px] mx-auto px-4 py-6 space-y-8">
        {/* The whole palette, every scale and step. A variable that no skin
            defines renders as a transparent hole here, which is how the
            missing --c-pink-400 would have announced itself. */}
        <section className="space-y-2">
          <h2 className="text-sm font-bold text-white">Palette</h2>
          <div className="space-y-1">
            {PALETTE_SCALES.map((scale) => (
              <div key={scale} className="flex items-center gap-2">
                <span className="w-20 flex-shrink-0 text-[10px] text-slate-500 text-right">{scale}</span>
                <div className="flex-1 flex gap-0.5">
                  {PALETTE_STEPS.map((step) => (
                    <div key={step} title={`--c-${scale}-${step}`}
                      className="h-6 flex-1 rounded-[3px] border border-slate-800/60"
                      style={{ background: `rgb(var(--c-${scale}-${step}))` }} />
                  ))}
                </div>
              </div>
            ))}
            <div className="flex items-center gap-2 pt-1">
              <span className="w-20 flex-shrink-0 text-[10px] text-slate-500 text-right">surfaces</span>
              <div className="flex-1 flex gap-0.5">
                {['white', 'chrome', 'canvas', 'sunken', 'raised', 'rail', 'deep', 'navy', 'moss', 'moss2'].map((n) => (
                  <div key={n} title={`--c-${n}`} className="h-6 flex-1 rounded-[3px] border border-slate-800/60"
                    style={{ background: `rgb(var(--c-${n}))` }} />
                ))}
              </div>
            </div>
          </div>
        </section>

        {/* The Dashboard's widgets. They take their rows as props, so every
            one of them renders here with no database — which is the whole
            reason they were lifted out of app/page.tsx. */}
        <section className="space-y-3">
          <h2 className="text-sm font-bold text-white">Dashboard widgets</h2>
          <PositionStrip data={mockPosition as never} perms={ROLE_PERMISSIONS.owner} />
          <ActionQueue items={mockQueue as never} atStake={2_816_173_107} />
          <div className="grid grid-cols-1 xl:grid-cols-2 gap-5">
            <TopBoard title="Top products" board={mockBoard as never} by="revenue"
              onPick={() => {}} noun="product" period="365" canProfit href="/profitability" />
            <MonthMotion rows={mockMotion as never} />
          </div>
          <div className="grid grid-cols-1 xl:grid-cols-2 gap-5">
            <NewArrivals rows={mockNewArrivals as never} days={14} />
            <ArrivingSoon data={mockArriving as never} buySide />
          </div>
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
            <KpiTile label="Paid This Month" value="Rp 1.138.500.000" sub="August" color="text-rose-300" ring="ring-rose-500/20" />
            <KpiTile label="Stock Value" value="Rp 3.100.000.000" sub="on-hand × avg landed cost" color="text-violet-300" ring="ring-violet-500/20" />
            <KpiTile label="Active POs" value="174" sub="not cancelled" color="text-sky-300" ring="ring-sky-500/20" />
            <KpiTile label="Components" value="990" sub="in catalog" color="text-emerald-300" ring="ring-emerald-500/20" />
          </div>
          <StockAlerts shortages={[] as never} reorders={[] as never} />
          <div className="grid grid-cols-1 xl:grid-cols-3 gap-5">
            <div className="xl:col-span-2"><ActivityStream rows={mockActivity as never} /></div>
            <FeedCard title="Last payments" feed={mockPayments as never} href="/banks"
              empty="No payment has been recorded yet." showMoney />
          </div>
          <QuickActions items={[
            { href: '/sales/new', label: 'New Sales Quotation', accent: 'emerald' },
            { href: '/purchasing?tab=quoting', label: 'New Deal — PI / PO', accent: 'blue' },
            { href: '/banks', label: 'Bank Accounts', accent: 'amber' },
          ]} />
        </section>

        {/* The two components whose colours are theme tokens — the ones that
            broke. Hover a donut slice: its label is a token too. */}
        <section className="space-y-2">
          <h2 className="text-sm font-bold text-white">Spend Overview — donuts, bars, ticker tiles</h2>
          <SpendOverview components={r.components} suppliers={r.suppliers} quotes={r.quotes}
            pos={r.pos} poItems={r.poItems} poCosts={r.poCosts} quoteItems={r.quoteItems} isLoading={false} />
        </section>

        <section className="space-y-2">
          <h2 className="text-sm font-bold text-white">Category Positioning Map — brand series</h2>
          <CategoryPositioningMap components={r.components} quoteItems={r.quoteItems} quotes={r.quotes}
            pos={r.pos} poItems={r.poItems} poCosts={r.poCosts} isLoading={false} />
        </section>
      </main>
    </div>
  );
}
