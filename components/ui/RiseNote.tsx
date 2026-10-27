'use client';
import { useT } from '@/hooks/useT';
import { fmtDay, fmtMoneyCell, fmtRupiah } from '@/lib/formatters';
import type { CostRise } from '@/lib/incomingCost';

/**
 * The warning under a cost that is about to go up: the next unit's estimated
 * landed cost, how much dearer, and — on hover — the PO or quote it comes
 * from, the arithmetic, and how the import uplift was learned.
 */
export default function RiseNote({ rise, supplierName, showRefs }: {
  rise: CostRise;
  /** The incoming document's supplier, for the "as on {supplier}'s last delivery" line. */
  supplierName?: string | null;
  /** PO / PI numbers are buy-side detail: a sell-side admin sees the cost, not the order. */
  showRefs: boolean;
}) {
  const { t, tf } = useT();
  const inc = rise.incoming;
  const doc = !showRefs ? (inc.source === 'po' ? t('Open PO') : t('Supplier quote'))
    : inc.source === 'po' ? tf('Open PO {ref}', { ref: inc.label }) : tf('Supplier quote {ref}', { ref: inc.label });
  const sup = supplierName || t('this supplier');
  const pct = inc.uplift != null ? ((inc.uplift - 1) * 100).toFixed(1) : '';
  const est = fmtRupiah(inc.estLandedIdr);
  // Where the import markup was learned (lib/incomingCost.ts, UpliftSource).
  const upliftLine = inc.upliftSource === 'item'
    ? tf('+{pct}% import costs, as on this item’s last delivery from {supplier} → about {est}', { pct, supplier: sup, est })
    : inc.upliftSource === 'supplier'
      ? tf('+{pct}% import costs, as on {supplier}’s last delivery → about {est}', { pct, supplier: sup, est })
      : inc.upliftSource === 'item_elsewhere'
        ? tf('+{pct}% import costs, as on this item’s last delivery from another supplier → about {est}', { pct, est })
        : t('Never delivered before, so no import costs are added: the real landed cost will be HIGHER.');
  const price = inc.currency === 'IDR' ? fmtRupiah(inc.unitForeign)
    : `${inc.currency} ${inc.unitForeign.toLocaleString('en-US')} × ${Math.round(inc.rate).toLocaleString('en-US')}`;
  const lines = [
    `${doc} · ${fmtDay(inc.date)} · ${inc.status}`,
    tf('{price} = {fob} before freight, duty and fees', { price, fob: fmtRupiah(Math.round(inc.fobIdr)) }),
    // Which exchange rate, and why (owner, 2026-10-27: the benchmark until the final rate is known).
    inc.currency === 'IDR' ? ''
      : inc.rateSource === 'blend' ? tf('{pct}% already paid at the bank rate; the rest at today’s company rate.', { pct: inc.ratePaidPct.toFixed(0) })
      : inc.rateSource === 'benchmark' ? t('Not paid yet: converted at today’s company rate.')
      : inc.rateSource === 'paid' ? t('Fully paid: converted at the rate the bank charged.')
      : t('No company rate for this currency: converted at the rate on the PO.'),
    upliftLine,
    showRefs && inc.upliftRef ? tf('Import costs learned from {ref}.', { ref: inc.upliftRef }) : '',
    tf('{pct}% above the current cost ({cur}).', { pct: rise.risePct.toFixed(1), cur: fmtRupiah(Math.round(rise.current)) }),
    rise.fobAlreadyAbove ? t('The supplier price alone is already above it.') : '',
    t('Margins on this row are calculated on the new cost.'),
  ].filter(Boolean);
  return (
    <p className="mt-0.5 text-[10px] text-amber-300 font-semibold cursor-help" title={lines.join('\n')}>
      ▲ {fmtMoneyCell(inc.estLandedIdr)}
      <span className="ml-1 px-1 py-px rounded text-[9px] font-bold tracking-wide bg-amber-500/15">
        {inc.source === 'po' ? 'PO' : 'QUOTE'} +{rise.risePct.toFixed(0)}%
      </span>
    </p>
  );
}
