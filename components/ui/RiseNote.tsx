'use client';
import { useT } from '@/hooks/useT';
import { fmtDay, fmtMoneyCell, fmtRupiah } from '@/lib/formatters';
import type { CostRise } from '@/lib/incomingCost';

/**
 * The warning under a cost that is about to go up: the next unit's estimated
 * landed cost, how much dearer, and — on hover — the PO or quote it comes
 * from, the arithmetic, and how the import uplift was learned.
 */
export default function RiseNote({ rise }: { rise: CostRise }) {
  const { t, tf } = useT();
  const inc = rise.incoming;
  const doc = inc.source === 'po' ? tf('Open PO {ref}', { ref: inc.label }) : tf('Supplier quote {ref}', { ref: inc.label });
  const price = inc.currency === 'IDR' ? fmtRupiah(inc.unitForeign)
    : `${inc.currency} ${inc.unitForeign.toLocaleString('en-US')} × ${Math.round(inc.rate).toLocaleString('en-US')}`;
  const lines = [
    `${doc} · ${fmtDay(inc.date)} · ${inc.status}`,
    tf('{price} = {fob} before freight, duty and fees', { price, fob: fmtRupiah(Math.round(inc.fobIdr)) }),
    inc.uplift != null
      ? tf('+{pct}% import costs, as on its last delivery → about {est}', { pct: ((inc.uplift - 1) * 100).toFixed(1), est: fmtRupiah(inc.estLandedIdr) })
      : t('Never delivered before, so no import costs are added: the real landed cost will be HIGHER.'),
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
