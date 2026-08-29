/**
 * ProgressBoard — where every live purchase order has got to, in columns.
 *
 * Replaces the team's Basecamp board, and deliberately does NOT work the way
 * that one did. There, a card is dragged: someone records a balance payment in
 * ICAPROC and the card stays where it was until a human remembers to move it.
 * Here five of the seven columns are DERIVED from the payments and documents
 * already in the database (lib/poProgress.ts), so the card moves itself the
 * moment the work is done, and the board cannot disagree with the ledger.
 *
 * Which means only two things on a card are clickable:
 *   · Docs Checked and Hard Copy Received — the two milestones nothing else in
 *     ICAPROC knows, so a person ticks them;
 *   · the next real action — "Log balance", "Log PIB / OPS" — which does not
 *     move the card, it opens Payments with this PO already selected. The card
 *     moves when the payment lands, because then it is true.
 *
 * There is no drag-and-drop, on purpose. Dragging a card to "Balance Paid"
 * would be a claim about money that no payment backs.
 */
'use client';
import { useMemo, useState } from 'react';
import type { PurchaseOrder, POCost, Supplier } from '@/types/database';
import {
  MILESTONES, milestonesReached, furthest, isComplete, nextAction, reachedCount,
  type MilestoneId, type Reached,
} from '@/lib/poProgress';
import { fmtIdr, fmtCcy, fmtDate } from '@/lib/formatters';

export interface ProgressPoRow extends PurchaseOrder {
  track_progress?: boolean | null;
  docs_checked_at?: string | null;
  hard_copy_received_at?: string | null;
}

interface Props {
  pos: ProgressPoRow[];
  costs: POCost[];
  suppliers: Supplier[];
  canEdit: boolean;
  /** Tick / un-tick one of the two stored milestones. */
  onToggleMilestone: (poId: PurchaseOrder['po_id'], field: 'docs_checked_at' | 'hard_copy_received_at', on: boolean) => Promise<void>;
  /** Take this PO off the board without touching the deal itself. */
  onUntrack: (poId: PurchaseOrder['po_id']) => Promise<void>;
  /** Jump to another tab with this PO in hand. */
  onAction: (tab: 'quoting' | 'financials', poId: PurchaseOrder['po_id']) => void;
  onOpenDeal: (po: ProgressPoRow) => void;
}

interface Card {
  po: ProgressPoRow;
  reached: Reached;
  stage: MilestoneId | null;
  supplier: string;
  done: boolean;
  count: number;
}

/** One accent per column, walking cool → warm as money goes out. */
const COL_ACCENT: Record<MilestoneId, string> = {
  pi_received:  'border-slate-500/50',
  po_sent:      'border-blue-500/50',
  dp_paid:      'border-amber-500/50',
  balance_paid: 'border-orange-500/50',
  docs_checked: 'border-violet-500/50',
  hard_copy:    'border-fuchsia-500/50',
  pib_paid:     'border-emerald-500/50',
};

const DOT: Record<MilestoneId, string> = {
  pi_received:  'bg-slate-400',
  po_sent:      'bg-blue-400',
  dp_paid:      'bg-amber-400',
  balance_paid: 'bg-orange-400',
  docs_checked: 'bg-violet-400',
  hard_copy:    'bg-fuchsia-400',
  pib_paid:     'bg-emerald-400',
};

export default function ProgressBoard({
  pos, costs, suppliers, canEdit, onToggleMilestone, onUntrack, onAction, onOpenDeal,
}: Props) {
  const [showDone, setShowDone] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [q, setQ] = useState('');

  // Index the payments once. A card asking "are there costs for me?" against
  // every row would be O(cards × payments) on a board that reloads often.
  const costsByPo = useMemo(() => {
    const m = new Map<string, POCost[]>();
    for (const c of costs) {
      const k = String(c.po_id);
      const list = m.get(k);
      if (list) list.push(c); else m.set(k, [c]);
    }
    return m;
  }, [costs]);

  const supplierName = useMemo(() => {
    const m = new Map<string, string>();
    for (const s of suppliers) m.set(String(s.supplier_id), s.supplier_name ?? '');
    return m;
  }, [suppliers]);

  const cards = useMemo<Card[]>(() => {
    const needle = q.trim().toLowerCase();
    return pos
      .filter((p) => p.track_progress)
      .map((po) => {
        const reached = milestonesReached(po, costsByPo.get(String(po.po_id)) ?? []);
        return {
          po,
          reached,
          stage: furthest(reached),
          supplier: supplierName.get(String(po.supplier_id)) ?? '',
          done: isComplete(reached),
          count: reachedCount(reached),
        };
      })
      .filter((c) => {
        if (!needle) return true;
        return [c.po.po_number, c.po.pi_number, c.supplier]
          .some((v) => (v ?? '').toLowerCase().includes(needle));
      })
      .sort((a, b) => String(b.po.po_date ?? '').localeCompare(String(a.po.po_date ?? '')));
  }, [pos, costsByPo, supplierName, q]);

  const live = cards.filter((c) => !c.done);
  const done = cards.filter((c) => c.done);

  const byStage = (id: MilestoneId) => live.filter((c) => c.stage === id);
  // A tracked PO that has reached nothing at all still has to be visible, or
  // it is on the board and invisible — the worst of both.
  const unstarted = live.filter((c) => c.stage === null);

  const toggle = async (c: Card, field: 'docs_checked_at' | 'hard_copy_received_at', on: boolean) => {
    const k = `${c.po.po_id}-${field}`;
    setBusy(k);
    try { await onToggleMilestone(c.po.po_id, field, on); } finally { setBusy(null); }
  };

  const untrack = async (c: Card) => {
    setBusy(`${c.po.po_id}-untrack`);
    try { await onUntrack(c.po.po_id); } finally { setBusy(null); }
  };

  const renderCard = (c: Card) => {
    const next = nextAction(c.reached);
    const value = c.po.currency === 'IDR'
      ? fmtIdr(Number(c.po.total_value) || 0)
      : fmtCcy(Number(c.po.total_value) || 0, String(c.po.currency ?? ''));

    return (
      <div key={String(c.po.po_id)}
        className="rounded-lg bg-slate-800/70 border border-slate-700/60 p-3 hover:border-slate-600 transition-colors">
        <button type="button" onClick={() => onOpenDeal(c.po)}
          className="text-left w-full group">
          <p className="text-[13px] font-semibold text-slate-100 leading-snug group-hover:text-sky-300 transition-colors">
            {c.supplier || 'Unknown supplier'}
          </p>
          <p className="text-[11.5px] text-slate-400 font-mono mt-0.5 break-all">
            {[c.po.pi_number, c.po.po_number].filter(Boolean).join(' · ')}
          </p>
        </button>

        <div className="flex items-baseline justify-between mt-2 gap-2">
          <span className="text-[12px] text-slate-300 tabular-nums">{value}</span>
          <span className="text-[11px] text-slate-500">{fmtDate(c.po.po_date)}</span>
        </div>

        {/* Seven pips: the whole journey at a glance, without opening anything. */}
        <div className="flex items-center gap-1 mt-2.5" aria-label={`${c.count} of ${MILESTONES.length} milestones`}>
          {MILESTONES.map((m) => (
            <span key={m.id} title={m.label}
              className={`h-1.5 flex-1 rounded-full ${c.reached[m.id] ? DOT[m.id] : 'bg-slate-700'}`} />
          ))}
        </div>

        <div className="flex flex-wrap items-center gap-1.5 mt-2.5">
          {canEdit && !c.reached.docs_checked && (
            <button type="button" disabled={busy === `${c.po.po_id}-docs_checked_at`}
              onClick={() => toggle(c, 'docs_checked_at', true)}
              className="text-[11px] px-2 py-1 rounded border border-violet-500/40 text-violet-300 hover:bg-violet-500/15 disabled:opacity-50">
              ✓ Docs
            </button>
          )}
          {canEdit && c.reached.docs_checked && !c.reached.hard_copy && (
            <button type="button" disabled={busy === `${c.po.po_id}-hard_copy_received_at`}
              onClick={() => toggle(c, 'hard_copy_received_at', true)}
              className="text-[11px] px-2 py-1 rounded border border-fuchsia-500/40 text-fuchsia-300 hover:bg-fuchsia-500/15 disabled:opacity-50">
              ✓ Hard copy
            </button>
          )}
          {next && (
            <button type="button" onClick={() => onAction(next.action!.tab, c.po.po_id)}
              className="text-[11px] px-2 py-1 rounded border border-slate-600 text-slate-300 hover:bg-slate-700/60">
              {next.action!.label} →
            </button>
          )}
        </div>
      </div>
    );
  };

  const column = (id: MilestoneId, label: string, items: Card[], key = id as string) => (
    <div key={key} className="flex-shrink-0 w-[236px] flex flex-col">
      <div className={`flex items-center justify-between px-2.5 py-2 rounded-t-lg bg-slate-800/40 border-t-2 ${COL_ACCENT[id]}`}>
        <span className="text-[11px] font-semibold tracking-wide uppercase text-slate-300">{label}</span>
        <span className="text-[11px] text-slate-500 tabular-nums">{items.length}</span>
      </div>
      <div className="flex flex-col gap-2 p-2 rounded-b-lg bg-slate-900/40 border border-t-0 border-slate-800 min-h-[120px]">
        {items.length === 0
          ? <p className="text-[11px] text-slate-600 text-center py-6">—</p>
          : items.map(renderCard)}
      </div>
    </div>
  );

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <input value={q} onChange={(e) => setQ(e.target.value)}
          placeholder="Filter by supplier, PI or PO…"
          className="flex-1 min-w-[200px] max-w-sm bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-sm text-slate-200 placeholder-slate-500 focus:outline-none focus:ring-1 focus:ring-sky-500/50" />
        <span className="text-xs text-slate-500 tabular-nums">
          {live.length} live · {done.length} done
        </span>
      </div>

      {cards.length === 0 ? (
        <div className="rounded-lg border border-dashed border-slate-700 p-10 text-center">
          <p className="text-sm text-slate-400">No deals on the board yet.</p>
          <p className="text-xs text-slate-500 mt-1.5 max-w-md mx-auto">
            Tick <b className="text-slate-400">Track on Progress board</b> when you raise a
            PO in New Deal, and it appears here. Quote-only deals stay off.
          </p>
        </div>
      ) : (
        <div className="overflow-x-auto pb-2">
          <div className="flex gap-3 min-w-min">
            {unstarted.length > 0 && column('pi_received', 'Not started', unstarted, 'unstarted')}
            {MILESTONES.map((m) => column(m.id, m.label, byStage(m.id)))}
          </div>
        </div>
      )}

      {done.length > 0 && (
        <div className="border-t border-slate-800 pt-3">
          <button type="button" onClick={() => setShowDone((v) => !v)}
            className="text-xs text-slate-400 hover:text-slate-200 flex items-center gap-1.5">
            <span className={`transition-transform ${showDone ? 'rotate-90' : ''}`}>▸</span>
            Done ({done.length})
          </button>
          {showDone && (
            <div className="grid gap-2 mt-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
              {done.map((c) => (
                <div key={String(c.po.po_id)} className="rounded-lg bg-slate-800/40 border border-emerald-500/20 p-3">
                  <p className="text-[13px] text-slate-300">{c.supplier}</p>
                  <p className="text-[11.5px] font-mono text-slate-500 mt-0.5 break-all">
                    {[c.po.pi_number, c.po.po_number].filter(Boolean).join(' · ')}
                  </p>
                  {canEdit && (
                    <button type="button" disabled={busy === `${c.po.po_id}-untrack`}
                      onClick={() => untrack(c)}
                      className="mt-2 text-[11px] text-slate-500 hover:text-rose-300 disabled:opacity-50">
                      Take off board
                    </button>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
