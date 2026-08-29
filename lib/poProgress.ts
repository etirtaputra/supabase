/**
 * Where a purchase order has got to, derived from what the database already
 * knows.
 *
 * The team ran this board in Basecamp, and a Basecamp board is a SECOND COPY
 * of the truth: someone records a balance payment in ICAPROC on Tuesday and
 * the card sits in "DP Paid" until a human remembers to drag it. The whole
 * reason to bring it in here is that ICAPROC can already answer five of the
 * seven questions from rows it holds — so those five are COMPUTED, never
 * stored, and the card moves the moment the work is done.
 *
 * Only two milestones have no data behind them. Those are stored, and they are
 * the only two a person can click.
 *
 *   PI Received        ← the PO carries a pi_number / pi_date, or a linked quote
 *   PO Sent            ← po_date is set and the PO has left Draft
 *   DP Paid            ← a down_payment cost row exists
 *   Balance Paid       ← principal payments meet the obligation
 *   Docs Checked       ← STORED (docs_checked_at)
 *   Hard Copy Received ← STORED (hard_copy_received_at)
 *   PIB & OPS Paid     ← an import duty / VAT / income tax / import tax row exists
 *
 * Pure on purpose: the page does the I/O, this file makes the decisions, and
 * the rules can be tested without a database. See lib/poProgress.test.ts.
 */

import type { PurchaseOrder, POCost } from '../types/database.ts';
import { PRINCIPAL_CATS } from '../constants/costCategories.ts';

/**
 * The import-declaration bundle. PIB (Pemberitahuan Impor Barang) and the
 * charges that clear customs alongside it — the last money that goes out
 * before the goods are ours.
 */
export const PIB_CATS = new Set([
  'local_import_duty',
  'local_vat',
  'local_income_tax',
  'local_import_tax',
]);

export type MilestoneId =
  | 'pi_received' | 'po_sent' | 'dp_paid' | 'balance_paid'
  | 'docs_checked' | 'hard_copy' | 'pib_paid';

export interface Milestone {
  id: MilestoneId;
  label: string;
  /** false = computed from data; true = a person ticks it. */
  manual: boolean;
  /** What the card offers when this is the next thing to do. */
  action?: { label: string; tab: 'quoting' | 'financials' };
}

/**
 * Board order. This is the sequence the columns appear in, NOT a state
 * machine — see `furthest` below for why that distinction matters.
 */
export const MILESTONES: Milestone[] = [
  { id: 'pi_received', label: 'PI Received',       manual: false },
  { id: 'po_sent',     label: 'PO Sent',           manual: false },
  { id: 'dp_paid',     label: 'DP Paid',           manual: false, action: { label: 'Log DP',      tab: 'financials' } },
  { id: 'balance_paid',label: 'Balance Paid',      manual: false, action: { label: 'Log balance', tab: 'financials' } },
  { id: 'docs_checked',label: 'Docs Checked',      manual: true },
  { id: 'hard_copy',   label: 'Hard Copy Received',manual: true },
  { id: 'pib_paid',    label: 'PIB & OPS Paid',    manual: false, action: { label: 'Log PIB / OPS', tab: 'financials' } },
];

export const MILESTONE_IDS = MILESTONES.map((m) => m.id);

/** A PO whose milestones we can read. Loosened so callers can pass a row. */
export interface ProgressPo extends Partial<PurchaseOrder> {
  po_id: PurchaseOrder['po_id'];
  track_progress?: boolean | null;
  docs_checked_at?: string | null;
  hard_copy_received_at?: string | null;
}

export type Reached = Record<MilestoneId, boolean>;

/**
 * Has the supplier been paid what the PO commits us to?
 *
 * Mirrors `lib/dealGroups.ts`: when the PO is in a foreign currency and the
 * payments are too, the obligation is measured in THOSE units, because that is
 * what the supplier is owed — an exchange-rate move is not an underpayment.
 * The IDR comparison is the fallback for IDR orders and mixed-currency runs.
 *
 * The tolerance is deliberate. Bank amounts land a few units light on rounding,
 * and a card stuck one rupiah short of "paid" is exactly the drift this board
 * exists to stop.
 */
function obligationMet(po: ProgressPo, principal: POCost[]): boolean {
  const total = Number(po.total_value) || 0;
  if (total <= 0 || principal.length === 0) return false;

  if (po.currency && po.currency !== 'IDR') {
    const sameCcy = principal.filter((c) => c.currency === po.currency);
    if (sameCcy.length > 0) {
      const paid = sameCcy.reduce((s, c) => s + (Number(c.amount) || 0), 0);
      return total - paid < 0.005;
    }
  }

  const rate = Number(po.exchange_rate) || 1;
  const totalIdr = po.currency === 'IDR' ? total : total * rate;
  const paidIdr = principal.reduce((s, c) => {
    if (c.currency === 'IDR') return s + (Number(c.amount) || 0);
    return s + (Number(c.amount) || 0) * (Number(c.exchange_rate) || rate);
  }, 0);
  return totalIdr > 0 && totalIdr - paidIdr < 1;
}

/**
 * Which milestones this PO has reached.
 *
 * `costs` must already be the rows for THIS po_id — the caller indexes them
 * once rather than making this scan every payment in the system per card.
 */
export function milestonesReached(po: ProgressPo, costs: POCost[]): Reached {
  const cats = new Set(costs.map((c) => String(c.cost_category)));
  const principal = costs.filter((c) => PRINCIPAL_CATS.has(String(c.cost_category)));

  const paid = obligationMet(po, principal);

  return {
    // A PI number or date, or a quote this PO was raised from: any of the three
    // means a supplier document arrived before we ordered.
    pi_received: Boolean(po.pi_number || po.pi_date || po.quote_id),
    // Draft means it is still being written. Anything past that has gone out.
    po_sent: Boolean(po.po_date) && po.status !== 'Draft',
    dp_paid: cats.has('down_payment'),
    // Reaching the total settles the down payment question too: a PO paid in
    // full without a DP has not skipped anything, it just never had one.
    balance_paid: paid,
    docs_checked: Boolean(po.docs_checked_at),
    hard_copy: Boolean(po.hard_copy_received_at),
    pib_paid: [...cats].some((c) => PIB_CATS.has(c)),
  };
}

/**
 * The column this card belongs in: the FURTHEST milestone reached, not the
 * last unbroken one.
 *
 * This is the rule the production data forced. Only 15 of 223 POs carry a
 * `down_payment` while 65 carry a balance — most deals are paid in one go. A
 * strict sequence would park two thirds of the board behind a DP that is never
 * coming, so a gap is not a blocker; it is a stage that did not apply.
 *
 * Returns null when nothing has been reached at all.
 */
export function furthest(reached: Reached): MilestoneId | null {
  for (let i = MILESTONE_IDS.length - 1; i >= 0; i -= 1) {
    if (reached[MILESTONE_IDS[i]]) return MILESTONE_IDS[i];
  }
  return null;
}

/** Everything done — the card leaves the board. */
export function isComplete(reached: Reached): boolean {
  return MILESTONE_IDS.every((id) => reached[id]);
}

/**
 * The next thing worth doing, so the card can offer it instead of making
 * someone go and find the right screen. Skips the manual ticks: those are
 * already one click on the card itself.
 *
 * Only looks PAST the furthest milestone reached, for the same reason
 * `furthest` does: on a PO paid in one go, `dp_paid` is false forever, and
 * offering "Log DP" on a fully-settled order is how a board starts giving
 * advice nobody should take.
 */
export function nextAction(reached: Reached): Milestone | null {
  const done = furthest(reached);
  const from = done ? MILESTONE_IDS.indexOf(done) + 1 : 0;
  for (const m of MILESTONES.slice(from)) {
    if (reached[m.id]) continue;
    if (m.action) return m;
  }
  return null;
}

/** How many of the seven are done — for the card's progress bar. */
export function reachedCount(reached: Reached): number {
  return MILESTONE_IDS.filter((id) => reached[id]).length;
}
