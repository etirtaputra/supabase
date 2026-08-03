'use client';
import { milestoneIndex } from '@/lib/salesStatus';
import { fmtDay, fmtDayTime } from '@/lib/formatters';

/**
 * Milestone stepper for a sales document — the defined progression the whole
 * sell-side funnel follows, with each stage's document code and stamp:
 *   Quote (SQ) → Validated → Sent → Sales Order (SO) → Invoice (INV)
 *   → Payment (RCPT receipts) → Delivery (DO) → Complete.
 * Split fulfillment stacks: EVERY invoice and EVERY delivery order gets its
 * own line under its milestone, each with its own timestamp. Timestamps render
 * with the time of day (settings-driven fmtDayTime); date-only fields (the
 * quote date, an invoice's issue date) stay dates. Cancelled/rejected
 * documents show a terminal banner instead of progress.
 */

export interface MilestoneQuote {
  quote_number: string; order_number?: string; invoice_number?: string; do_number?: string;
  status: string; quote_date: string; revision?: number;
  validated_at?: string | null; sent_at?: string | null; accepted_at?: string | null;
  ordered_at?: string | null; invoiced_at?: string | null; preparing_at?: string | null; delivered_at?: string | null;
  delivery_date?: string | null;
}
export interface MilestoneInvoice { invoice_id: string; invoice_number: string; issued_at?: string | null; }
export interface MilestoneDo { do_id: string; do_number: string; status: string; delivered_at?: string | null; delivery_date?: string | null; }

// Timestamps carry the clock; date-only strings stay dates.
const fmtD = (d?: string | null) => (!d ? '' : d.length > 10 ? fmtDayTime(d) : fmtDay(d));

export default function SalesMilestones({ q, received, billTotal, invoices = [], dos = [] }: {
  q: MilestoneQuote; received: number; billTotal: number;
  invoices?: MilestoneInvoice[]; dos?: MilestoneDo[];
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

  // Split fulfillment: one line per child document; the legacy single-number
  // columns only back-fill documents from before the child tables existed.
  const invoiceSubs = invoices.length > 0
    ? invoices.map((i) => [i.invoice_number, fmtD(i.issued_at)].filter(Boolean).join(' · '))
    : q.invoice_number ? [[q.invoice_number, fmtD(q.invoiced_at)].filter(Boolean).join(' · ')] : [];
  const doSubs = dos.length > 0
    ? dos.map((d) => [
        d.do_number,
        d.status === 'delivered' ? fmtD(d.delivered_at) || 'delivered' : `preparing${d.delivery_date ? ` · target ${fmtD(d.delivery_date)}` : ''}`,
      ].filter(Boolean).join(' · '))
    : q.do_number
      ? [[q.do_number, delivered ? fmtD(q.delivered_at) : q.status === 'preparing' ? `preparing${q.delivery_date ? ` · target ${fmtD(q.delivery_date)}` : ''}` : ''].filter(Boolean).join(' · ')]
      : [];

  const steps: { label: string; subs: string[]; done: boolean; active?: boolean }[] = [
    {
      label: 'Quote',
      subs: [[q.quote_number, q.revision ? `Rev ${q.revision}` : '', fmtD(q.quote_date)].filter(Boolean).join(' · ')],
      done: true,
    },
    {
      label: 'Validated',
      subs: [fmtD(q.validated_at) || (idx > 1 ? 'skipped' : '')].filter(Boolean),
      done: !!q.validated_at || idx > 1,
    },
    {
      label: 'Sent',
      subs: [fmtD(q.sent_at) || (idx > 2 ? '—' : '')].filter(Boolean),
      done: !!q.sent_at || idx > 2,
    },
    {
      label: 'Sales Order',
      subs: q.order_number ? [[q.order_number, fmtD(q.ordered_at)].filter(Boolean).join(' · ')] : [],
      done: idx >= 4,
    },
    {
      label: invoiceSubs.length > 1 ? `Invoice ×${invoiceSubs.length}` : 'Invoice',
      subs: invoiceSubs,
      done: idx >= 5,
    },
    {
      label: 'Payment',
      subs: [billTotal > 0 && received > 0
        ? (fullyPaid ? 'Paid in full' : `${paymentPct.toFixed(0)}% received`)
        : (idx >= 4 ? 'awaiting payment' : '')].filter(Boolean),
      done: fullyPaid && idx >= 4,
      active: idx >= 4 && received > 0 && !fullyPaid,
    },
    {
      label: doSubs.length > 1 ? `Delivery ×${doSubs.length}` : 'Delivery',
      subs: doSubs,
      done: delivered,
      active: q.status === 'preparing' || (!delivered && dos.some((d) => d.status === 'delivered')),
    },
    {
      label: 'Complete',
      subs: delivered && fullyPaid ? ['delivered & fully paid'] : [],
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
            {s.subs.map((t, j) => (
              <p key={j} className="max-w-full truncate text-center text-[9px] text-slate-500 font-mono leading-relaxed" title={t}>{t}</p>
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}
