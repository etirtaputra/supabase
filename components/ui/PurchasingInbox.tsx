'use client';
import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { createSupabaseClient } from '@/lib/supabase';
import { useT } from '@/hooks/useT';
import { fmtDay, fmtInt, fmtRupiah } from '@/lib/formatters';
import { receiptGaps, type ReceiptMove, type GapPo, type GapLine } from '@/lib/receiptGap';
import { supplierLeadTimes, type LtPo, type LtQuote, type LtCost, type LtGrn } from '@/lib/supplierLeadTimes';
import { fetchShortages, type ShortageAlert } from '@/lib/reorder';
import { latePos, unpaidReceived } from '@/lib/purchasingInbox';
import { PRINCIPAL_CATS } from '@/constants/costCategories';
import type { BalanceCost, BalancePo } from '@/lib/dealBalance';
import type { PurchaseOrder, PurchaseLineItem, POCost, PriceQuote } from '@/types/database';

/**
 * "Needs action" — the top of Deal Lookup (owner, 2026-10-23: the Purchasing
 * menu cut to four, and "what should I do next" answered where the deals are).
 *
 * Four counts; tap one for its list. Every line goes straight to the thing to
 * do: the deal (narrowed in place), the goods receipt, the sales order. Nothing
 * here is stored — it is read off the same rows the deals below are built from.
 * Shows nothing at all when nothing needs doing.
 */
type Kind = 'stock' | 'late' | 'short' | 'unpay';

export default function PurchasingInbox({ pos: rawPos, poItems: rawItems, poCosts: rawCosts, quotes: rawQuotes, supplierName, receiptMoves, onOpenDeal }: {
  pos: PurchaseOrder[];
  poItems: PurchaseLineItem[];
  poCosts: POCost[];
  quotes: PriceQuote[];
  supplierName: (id: string | null | undefined) => string;
  receiptMoves: ReceiptMove[] | null;
  onOpenDeal: (poNumber: string) => void;
}) {
  const { t, tf } = useT();
  const supabase = useMemo(() => createSupabaseClient(), []);
  // The app's row types, read as the shapes each engine asks for (all are subsets).
  const pos = rawPos as unknown as (GapPo & LtPo & BalancePo)[];
  const poItems = rawItems as unknown as GapLine[];
  const poCosts = rawCosts as unknown as (LtCost & BalanceCost)[];
  const quotes = rawQuotes as unknown as LtQuote[];
  const [open, setOpen] = useState<Kind | null>(null);
  const [shortages, setShortages] = useState<ShortageAlert[]>([]);
  const [grns, setGrns] = useState<LtGrn[]>([]);
  useEffect(() => {
    let live = true;
    fetchShortages(supabase).then((s) => { if (live) setShortages(s); }, () => {});
    supabase.from('30.2_goods_receipts').select('po_id, received_at')
      .then(({ data }) => { if (live) setGrns((data ?? []) as LtGrn[]); }, () => {});
    return () => { live = false; };
  }, [supabase]);

  const today = new Date().toISOString().slice(0, 10);
  const gaps = useMemo(() => (receiptMoves ? receiptGaps(pos, poItems, receiptMoves) : []), [pos, poItems, receiptMoves]);
  const late = useMemo(() => latePos(supplierLeadTimes({
    pos, quotes, costs: poCosts.filter((c) => PRINCIPAL_CATS.has(c.cost_category)), grns, today,
  }), today), [pos, quotes, poCosts, grns, today]);
  const unpaid = useMemo(() => unpaidReceived(pos, poCosts), [pos, poCosts]);
  const poById = useMemo(() => new Map(pos.map((p) => [String(p.po_id), p])), [pos]);

  const counts: Record<Kind, number> = { stock: gaps.length, late: late.length, short: shortages.length, unpay: unpaid.length };
  if (!Object.values(counts).some((n) => n > 0)) return null;

  const chip = (k: Kind, label: string, tone: string) => counts[k] > 0 && (
    <button key={k} type="button" onClick={() => setOpen((o) => (o === k ? null : k))} aria-expanded={open === k}
      className={`inline-flex items-center gap-1.5 h-9 px-3 rounded-lg border text-[12.5px] font-semibold whitespace-nowrap transition-colors ${open === k ? tone : 'border-slate-700 text-slate-300 hover:text-white hover:border-slate-500'}`}>
      <span className="tabular-nums">{counts[k]}</span> {label} <span aria-hidden className="text-[10px]">{open === k ? '▴' : '▾'}</span>
    </button>
  );
  const dealBtn = (poNumber: string) => poNumber ? (
    <button type="button" onClick={() => onOpenDeal(poNumber)} className="text-sky-300 hover:text-sky-200 font-semibold whitespace-nowrap">{t('Open deal')} →</button>
  ) : null;
  const line = (key: string, main: React.ReactNode, sub: React.ReactNode, actions: React.ReactNode) => (
    <div key={key} className="flex flex-wrap items-center gap-x-4 gap-y-1 px-3 py-2 text-[12.5px]">
      <div className="min-w-0 flex-1"><p className="text-slate-100 font-medium truncate">{main}</p><p className="text-slate-500 truncate">{sub}</p></div>
      <div className="flex items-center gap-3">{actions}</div>
    </div>
  );

  return (
    <div className="mb-3 rounded-xl border border-slate-800 bg-slate-900/50">
      <div className="flex flex-wrap items-center gap-2 px-3 py-2.5">
        <span className="text-[11px] font-bold uppercase tracking-widest text-slate-400 mr-1">{t('Needs action')}</span>
        {chip('stock', t('arrived, not in stock'), 'border-amber-500/50 bg-amber-500/10 text-amber-200')}
        {chip('late', t('late'), 'border-red-500/50 bg-red-500/10 text-red-200')}
        {chip('short', t('short for a sales order'), 'border-violet-500/50 bg-violet-500/10 text-violet-200')}
        {chip('unpay', t('balance to pay'), 'border-sky-500/50 bg-sky-500/10 text-sky-200')}
      </div>
      {open && (
        <div className="border-t border-slate-800 divide-y divide-slate-800/70 max-h-80 overflow-y-auto">
          {open === 'stock' && gaps.map((g) => line(g.poId,
            g.poNumber || '—',
            tf('{n} units marked received, not booked into stock · {date}', { n: fmtInt(g.missingQty), date: fmtDay(g.receivedOn) }),
            <>
              <Link href={`/stock/receive?po=${encodeURIComponent(g.poId)}${g.receivedOn ? `&date=${g.receivedOn.slice(0, 10)}` : ''}`}
                className="text-amber-200 hover:text-amber-100 font-semibold whitespace-nowrap">{t('Receive into stock')} →</Link>
              {dealBtn(g.poNumber)}
            </>))}
          {open === 'late' && late.map((l) => line(l.poId,
            <>{l.poNumber} <span className="text-slate-500 font-normal">· {supplierName(poById.get(l.poId)?.supplier_id)}</span></>,
            l.basis === 'promised'
              ? tf('{n} days past the promised {date}', { n: l.lateDays, date: fmtDay(l.due) })
              : tf('{n} days past the usual arrival, {date}', { n: l.lateDays, date: fmtDay(l.due) }),
            dealBtn(l.poNumber)))}
          {open === 'short' && shortages.map((s) => line(s.component_id,
            s.name,
            tf('short {n} {unit} · on hand {have}, ordered {need}', { n: fmtInt(s.short), unit: s.unit ?? '', have: fmtInt(s.physical), need: fmtInt(s.committed) }),
            <span className="flex flex-wrap gap-x-3 gap-y-1">
              {s.orders.slice(0, 3).map((o) => (
                <Link key={o.quote_id} href={`/sales/${o.quote_id}`} className="text-violet-200 hover:text-violet-100 font-semibold whitespace-nowrap" title={o.customer}>
                  {o.number} →
                </Link>
              ))}
            </span>))}
          {open === 'unpay' && unpaid.map((u) => line(u.poId,
            u.poNumber || '—',
            <>{u.currency} {fmtInt(u.remaining)}{u.currency !== 'IDR' && u.idr ? ` ≈ ${fmtRupiah(u.idr)}` : ''} · {t('goods received')}</>,
            dealBtn(u.poNumber)))}
        </div>
      )}
    </div>
  );
}
