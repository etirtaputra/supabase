'use client';
import { milestoneIndex } from '@/lib/salesStatus';

/**
 * Milestone stepper for a sales document — the defined progression the whole
 * sell-side funnel follows, with each stage's document code and date:
 *   Quote (SQ) → Validated → Sent → Sales Order (SO) → Invoice (INV)
 *   → Payment (RCPT receipts) → Delivery (DO) → Complete.
 * Revisions show on the Quote step (Rev n). Payment and Complete are derived
 * (receipts vs grand total; delivered AND fully paid). Cancelled/rejected
 * documents show a terminal banner instead of progress.
 */

export interface MilestoneQuote {
  quote_number: string; order_number?: string; invoice_number?: string; do_number?: string;
  status: string; quote_date: string; revision?: number;
  validated_at?: string | null; sent_at?: string | null; accepted_at?: string | null;
  ordered_at?: string | null; invoiced_at?: string | null; preparing_at?: string | null; delivered_at?: string | null;
  delivery_date?: string | null;
}

const fmtD = (d?: string | null) => {
  if (!d) return '';
  const dt = new Date(d.length <= 10 ? `${d}T00:00:00` : d);
  return isNaN(dt.getTime()) ? '' : dt.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: '2-digit' });
};

export default function SalesMilestones({ q, received, billTotal }: {
  q: MilestoneQuote; received: number; billTotal: number;
}) {
  if (['cancelled', 'rejected'].includes(q.status)) {
    return (
      <div className="rounded-xl border border-red-500/25 bg-red-500/[0.06] px-4 py-2.5 text-xs text-red-300">
        This document was {q.status}. Reopen it to continue the milestone flow.
      </div>
    );
  }

  const idx = milestoneIndex(q.status);
  const fullyPaid = billTotal > 0 && received >= billTotal - 0.5;
  const delivered = q.status === 'delivered';
  const paymentPct = billTotal > 0 ? Math.min(100, (received / billTotal) * 100) : 0;

  const steps: { label: string; sub: string; done: boolean; active?: boolean }[] = [
    {
      label: 'Quote',
      sub: [q.quote_number, q.revision ? `Rev ${q.revision}` : '', fmtD(q.quote_date)].filter(Boolean).join(' · '),
      done: true,
    },
    {
      label: 'Validated',
      sub: fmtD(q.validated_at) || (idx > 1 ? 'skipped' : ''),
      done: !!q.validated_at || idx > 1,
    },
    {
      label: 'Sent',
      sub: fmtD(q.sent_at) || (idx > 2 ? '—' : ''),
      done: !!q.sent_at || idx > 2,
    },
    {
      label: 'Sales Order',
      sub: q.order_number ? `${q.order_number} · ${fmtD(q.ordered_at)}` : '',
      done: idx >= 4,
    },
    {
      label: 'Invoice',
      sub: q.invoice_number ? `${q.invoice_number} · ${fmtD(q.invoiced_at)}` : '',
      done: idx >= 5,
    },
    {
      label: 'Payment',
      sub: billTotal > 0 && received > 0
        ? (fullyPaid ? 'Paid in full' : `${paymentPct.toFixed(0)}% received`)
        : (idx >= 4 ? 'awaiting payment' : ''),
      done: fullyPaid && idx >= 4,
      active: idx >= 4 && received > 0 && !fullyPaid,
    },
    {
      label: 'Delivery',
      sub: q.do_number
        ? `${q.do_number} · ${delivered
            ? fmtD(q.delivered_at)
            : q.status === 'preparing'
            ? `preparing${q.delivery_date ? ` · target ${fmtD(q.delivery_date)}` : ''}`
            : ''}`
        : '',
      done: delivered,
      active: q.status === 'preparing',
    },
    {
      label: 'Complete',
      sub: delivered && fullyPaid ? 'delivered & fully paid' : '',
      done: delivered && fullyPaid,
    },
  ];

  // The "current" step = first not-done one
  const currentIdx = steps.findIndex((s) => !s.done);

  return (
    // Each step column has a real width and its texts TRUNCATE inside it —
    // nowrap subs used to overflow into neighboring columns on phones
    // ("ValidatedSent"). The strip scrolls horizontally on narrow screens.
    <div className="rounded-2xl border border-slate-800/80 bg-slate-900/40 px-3 sm:px-4 py-3 overflow-x-auto scrollbar-none">
      <div className="flex items-start min-w-[880px]">
        {steps.map((s, i) => (
          <div key={s.label} className="flex-1 min-w-0 px-1 flex flex-col items-center relative">
            {/* connector */}
            {i > 0 && (
              <div className={`absolute top-[9px] right-1/2 w-full h-0.5 ${steps[i - 1].done ? 'bg-emerald-500/50' : 'bg-slate-800'}`} />
            )}
            <div className={`relative z-10 w-[18px] h-[18px] rounded-full flex items-center justify-center text-[9px] font-bold border transition-colors ${
              s.done
                ? 'bg-emerald-500/20 border-emerald-500/60 text-emerald-300'
                : s.active || i === currentIdx
                ? 'bg-amber-500/15 border-amber-500/60 text-amber-300'
                : 'bg-slate-900 border-slate-700 text-slate-600'
            }`}>
              {s.done ? '✓' : i + 1}
            </div>
            <p className={`mt-1 max-w-full truncate text-[10px] font-semibold ${s.done ? 'text-emerald-300' : s.active || i === currentIdx ? 'text-amber-300' : 'text-slate-600'}`}>
              {s.label}
            </p>
            {s.sub && <p className="max-w-full truncate text-center text-[9px] text-slate-500 font-mono" title={s.sub}>{s.sub}</p>}
          </div>
        ))}
      </div>
    </div>
  );
}
