'use client';
import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { createSupabaseClient } from '@/lib/supabase';
import { useT } from '@/hooks/useT';
import { fmtDay, fmtRupiah } from '@/lib/formatters';
import { displayDocNumber } from '@/lib/salesStatus';
import { fetchShortages } from '@/lib/reorder';
import {
  waitingQuotes, undeliveredOrders, deliveredNotInvoiced, unpaidInvoices,
  type InboxQuote, type InboxDo, type InboxInvoice, type InboxReceipt,
} from '@/lib/salesInbox';

/**
 * "Needs action" — the top of Sales Orders (owner, 2026-10-23), the sell-side
 * twin of Deal Lookup's. Four counts walking order-to-cash; tap one for its
 * list, and every line opens the document where the next step is done.
 * Nothing here is stored — it is read off the rows the list below is built
 * from. Shows nothing at all when nothing needs doing.
 */
type Kind = 'quote' | 'deliver' | 'bill' | 'collect';
export type InboxDoc = InboxQuote & { quote_number: string; order_number?: string | null; customer_id: string | null };

export default function SalesInbox({ quotes, dos, invoices, receipts, customerName }: {
  quotes: InboxDoc[];
  dos: InboxDo[];
  invoices: InboxInvoice[];
  receipts: InboxReceipt[];
  customerName: (id: string | null) => string;
}) {
  const { t, tf } = useT();
  const supabase = useMemo(() => createSupabaseClient(), []);
  const [open, setOpen] = useState<Kind | null>(null);
  // Which items each order is short of — the usual reason an order sits.
  const [shortByOrder, setShortByOrder] = useState<Map<string, string[]>>(new Map());
  useEffect(() => {
    let live = true;
    fetchShortages(supabase).then((rows) => {
      if (!live) return;
      const m = new Map<string, string[]>();
      for (const r of rows) for (const o of r.orders) (m.get(o.quote_id) ?? m.set(o.quote_id, []).get(o.quote_id)!).push(r.name);
      setShortByOrder(m);
    }, () => {});
    return () => { live = false; };
  }, [supabase]);

  const today = new Date().toISOString().slice(0, 10);
  const byId = useMemo(() => new Map(quotes.map((q) => [q.quote_id, q])), [quotes]);
  const waiting = useMemo(() => waitingQuotes(quotes, today), [quotes, today]);
  const toDeliver = useMemo(() => undeliveredOrders(quotes, dos, today), [quotes, dos, today]);
  const toBill = useMemo(() => deliveredNotInvoiced(quotes, dos, invoices), [quotes, dos, invoices]);
  const toCollect = useMemo(() => unpaidInvoices(quotes, invoices, receipts, today), [quotes, invoices, receipts, today]);

  const counts: Record<Kind, number> = { quote: waiting.length, deliver: toDeliver.length, bill: toBill.length, collect: toCollect.length };
  if (!Object.values(counts).some((n) => n > 0)) return null;

  const chip = (k: Kind, label: string, tone: string) => counts[k] > 0 && (
    <button key={k} type="button" onClick={() => setOpen((o) => (o === k ? null : k))} aria-expanded={open === k}
      className={`inline-flex items-center gap-1.5 h-9 px-3 rounded-lg border text-[12.5px] font-semibold whitespace-nowrap transition-colors ${open === k ? tone : 'border-slate-700 text-slate-300 hover:text-white hover:border-slate-500'}`}>
      <span className="tabular-nums">{counts[k]}</span> {label} <span aria-hidden className="text-[10px]">{open === k ? '▴' : '▾'}</span>
    </button>
  );
  const docTitle = (id: string) => {
    const q = byId.get(id);
    return <>{q ? displayDocNumber(q) : '—'} <span className="text-slate-500 font-normal">· {q ? customerName(q.customer_id) : ''}</span></>;
  };
  const go = (id: string, label: string, tone: string) => (
    <Link href={`/sales/${id}`} className={`${tone} font-semibold whitespace-nowrap`}>{label} →</Link>
  );
  const line = (key: string, main: React.ReactNode, sub: React.ReactNode, action: React.ReactNode) => (
    <div key={key} className="flex flex-wrap items-center gap-x-4 gap-y-1 px-3 py-2 text-[12.5px]">
      <div className="min-w-0 flex-1"><p className="text-slate-100 font-medium truncate">{main}</p><p className="text-slate-500 sm:truncate">{sub}</p></div>
      <div className="flex items-center gap-3">{action}</div>
    </div>
  );
  const quoteNote = (status: string, n: number) =>
    status === 'validated' ? tf('Validated {n} days ago, not sent yet', { n })
      : status === 'accepted' ? tf('Accepted {n} days ago, not confirmed as an order', { n })
        : tf('Sent {n} days ago, no answer yet', { n });

  return (
    <div className="rounded-xl border border-slate-800 bg-slate-900/50">
      <div className="flex flex-wrap items-center gap-2 px-3 py-2.5">
        <span className="text-[11px] font-bold uppercase tracking-widest text-slate-400 mr-1">{t('Needs action')}</span>
        {chip('quote', t('quotes waiting'), 'border-sky-500/50 bg-sky-500/10 text-sky-200')}
        {chip('deliver', t('not delivered'), 'border-violet-500/50 bg-violet-500/10 text-violet-200')}
        {chip('bill', t('delivered, not invoiced'), 'border-amber-500/50 bg-amber-500/10 text-amber-200')}
        {chip('collect', t('invoices unpaid'), 'border-red-500/50 bg-red-500/10 text-red-200')}
      </div>
      {open && (
        <div className="border-t border-slate-800 divide-y divide-slate-800/70 max-h-80 overflow-y-auto">
          {open === 'quote' && waiting.map((w) => line(w.quoteId,
            docTitle(w.quoteId),
            <>{quoteNote(w.status, w.days)}{w.expired && <span className="text-red-300"> · {tf('expired {date}', { date: fmtDay(byId.get(w.quoteId)?.valid_until ?? '') })}</span>} · {fmtRupiah(w.total)}</>,
            go(w.quoteId, t('Open quote'), 'text-sky-300 hover:text-sky-200')))}
          {open === 'deliver' && toDeliver.map((o) => {
            const short = shortByOrder.get(o.quoteId) ?? [];
            return line(o.quoteId,
              docTitle(o.quoteId),
              <>
                {tf('Ordered {n} days ago', { n: o.days })}
                {o.partly && <> · {t('Partly delivered')}</>}
                {o.lateSince && <span className="text-red-300"> · {tf('promised {date}', { date: fmtDay(o.lateSince) })}</span>}
                {short.length > 0 && <span className="text-violet-300"> · {tf('short: {items}', { items: short.join(', ') })}</span>}
              </>,
              go(o.quoteId, t('Open order'), 'text-violet-200 hover:text-violet-100'));
          })}
          {open === 'bill' && toBill.map((u) => line(u.quoteId,
            docTitle(u.quoteId),
            u.invoiced > 0
              ? tf('{amount} not invoiced yet, of {total}', { amount: fmtRupiah(u.remaining), total: fmtRupiah(u.total) })
              : tf('{amount} delivered, no invoice yet', { amount: fmtRupiah(u.remaining) }),
            go(u.quoteId, t('Make the invoice'), 'text-amber-200 hover:text-amber-100')))}
          {open === 'collect' && toCollect.map((i) => line(i.invoiceId,
            <>{i.number} <span className="text-slate-500 font-normal">· {customerName(byId.get(i.quoteId)?.customer_id ?? null)}</span></>,
            <>
              {tf('{amount} to collect', { amount: fmtRupiah(i.remaining) })}
              {' · '}
              {i.overdueDays != null
                ? <span className="text-red-300">{tf('{n} days overdue', { n: i.overdueDays })}</span>
                : i.due ? tf('due {date}', { date: fmtDay(i.due) }) : t('no due date')}
            </>,
            go(i.quoteId, t('Record payment'), 'text-red-200 hover:text-red-100')))}
        </div>
      )}
    </div>
  );
}
