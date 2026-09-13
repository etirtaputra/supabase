/**
 * Which landed-cost true-ups may post themselves, and which wait for a human.
 *
 * Owner, 2026-09-13, after asking the question that exposed the gap — *"when we
 * already filled in all the payments, does it have to appear in true up?"*:
 *
 *   *"yes do that, auto-post on settlement but hold back the anomalies"*
 *
 * THE GAP. A cost lives in two books. `6.0_po_costs` is the bills, and it is
 * current the moment a payment is entered. `30.0_stock_movements` is a
 * photograph taken the day the goods arrived, and it is append-only — nothing
 * rewrites a photograph. Entering the final payment moves the first book and
 * says nothing to the second. The only path between them is a true-up, and
 * until now that path was a button somebody had to remember to press.
 *
 * Nobody pressed it. 24 POs accumulated, IDR 777,984,457 of understated landed
 * cost, the oldest settled in January 2025 — twenty months of COGS reading low
 * and gross profit reading high on every item those containers brought in.
 * A checkpoint nobody reaches is not a control; it is friction with a cost.
 *
 * SO THE DEFAULT FLIPS: posting is what happens, holding is the exception that
 * has to earn itself. This file is the whole of that judgement, kept pure and
 * tested because it now decides — without a human in the loop — whether a
 * number goes into the ledger.
 *
 * WHY A HOLD LIST AT ALL, given the maths is identical either way. Posting is
 * the one irreversible act here. `30.0_stock_movements` is append-only, so
 * undoing a true-up means posting an opposite entry and living with both. And
 * because a moving average keeps no lots, the correction lands on EVERYTHING on
 * hand — including units that arrived on other POs — so a wrong true-up cannot
 * be surgically unwound. What the hold list buys is not arithmetic safety. It
 * is a last look at the handful of POs whose numbers suggest the INPUTS are
 * wrong, before those inputs become ledger truth.
 *
 * The live data makes the shape of that obvious. Eight ready POs sat at 3.5%,
 * 3.6%, 3.7%, 3.8%, 4.1%, 4.3%, 7.1% — and one at **32.6%**. The cluster is
 * ordinary freight and duty on an import. The outlier is either a genuinely
 * freight-heavy small shipment or a cost row attached to the wrong PO, and the
 * two look identical from here. That one deserves eyes; the other seven never
 * did.
 *
 * NOT A RULE HERE: absolute size. A 4% variance on a large PO is a large
 * number, not an anomaly — the percentage is what says whether the allocation
 * is sane, and holding POs for being big would only rebuild the backlog out of
 * the healthiest rows. Add `maxIdr` below if that judgement ever changes.
 */
import { revaluationRows, type PoVariance } from './landedCost.ts';

/**
 * Beyond this share of booked value, a variance stops looking like freight and
 * starts looking like a mistake. 15% sits well clear of the 3–7% band real
 * imports land in, and well under the 32.6% that prompted the rule.
 */
export const OUTLIER_PCT = 0.15;

export type HoldReason =
  /** The bills are still arriving. Not an anomaly — just not time yet. */
  | 'not_ready'
  /** Goods received that no PO line explains. A DATA problem: the allocation
   *  is spread over lines, so an unexplained receipt means the divisor and the
   *  dividend disagree about what this PO contains. Never auto-post that. */
  | 'unmatched'
  /** The bills say LESS than the receipt booked. Possible (a credit note, a
   *  refunded duty) and rare enough that the likelier cause is a cost row
   *  entered against the wrong PO or with the wrong sign. A true-up that
   *  REMOVES stock value without a human agreeing is the wrong default. */
  | 'credit'
  /** Too far from what an import's freight and duty normally come to. */
  | 'outlier'
  /** Every unit has been sold. There is nothing left for the correction to
   *  land on, so there is no row to write — the whole variance is COGS that
   *  was already booked at the estimate. Reported, never posted. */
  | 'nothing_on_hand';

export interface AutoPostVerdict {
  /** Post this one without asking. */
  post: boolean;
  /** Why not, when `post` is false. Null only when posting. */
  hold: HoldReason | null;
}

/** What the screen says beside a held PO. Name the SUSPICION, not the rule. */
export const HOLD_NOTE: Record<HoldReason, string> = {
  not_ready: 'The supplier is not paid off yet — more bills are coming, so the number will move.',
  unmatched: 'Goods were received against this PO that no PO line explains. Costs are spread over the lines, so the allocation cannot be trusted until that is resolved.',
  credit: 'The bills come to LESS than the receipt booked. That happens — a credit note, a refunded duty — but a cost row on the wrong PO looks exactly the same, and this would take value OUT of stock.',
  // Written out rather than interpolated, so the phrase book can key on it and
  // the orphan guard can find it in source. The test below asserts it still
  // quotes OUTLIER_PCT, so the two cannot drift apart in silence.
  outlier: 'This variance is over 15% of what the goods were booked at. Real imports land at 3–7%; this is either a very freight-heavy shipment or a cost entered against the wrong PO.',
  nothing_on_hand: 'Every unit has been sold. Nothing is left to revalue — the whole difference is gross profit already overstated, and posting cannot recover it.',
};

/** The short word the row shows. */
export const HOLD_LABEL: Record<HoldReason, string> = {
  not_ready: 'awaiting bills',
  unmatched: 'unexplained receipt',
  credit: 'bills came in lower',
  outlier: 'unusually large',
  nothing_on_hand: 'nothing on hand',
};

/**
 * May this PO's true-up post itself?
 *
 * Materiality is NOT re-tested here: `computeLandedVariances` has already
 * dropped everything under the floor, so anything reaching this function is
 * worth acting on. Testing it twice would give one rule two homes.
 */
export function autoPostVerdict(
  v: PoVariance,
  opts: { outlierPct?: number } = {},
): AutoPostVerdict {
  const outlierPct = opts.outlierPct ?? OUTLIER_PCT;

  // Order matters: the most diagnostic reason wins, so a held PO tells the
  // reader the thing most worth knowing rather than the first thing tripped.
  if (v.status !== 'ready') return { post: false, hold: 'not_ready' };
  if (v.unmatched > 0) return { post: false, hold: 'unmatched' };
  if (v.delta < 0) return { post: false, hold: 'credit' };
  if (Math.abs(v.deltaPct) >= outlierPct) return { post: false, hold: 'outlier' };
  // Last, because it is a no-op rather than a suspicion: a PO whose stock has
  // all sold has nothing to write, and a ledger row that changes nothing is
  // noise. Checked via `revaluationRows` so this can never disagree with what
  // posting would actually insert.
  if (revaluationRows(v).length === 0) return { post: false, hold: 'nothing_on_hand' };
  return { post: true, hold: null };
}

/** Split a set of variances the way the auto-poster will act on them. */
export function partitionForAutoPost(
  pos: PoVariance[],
  opts: { outlierPct?: number } = {},
): { post: PoVariance[]; held: { po: PoVariance; hold: HoldReason }[] } {
  const post: PoVariance[] = [];
  const held: { po: PoVariance; hold: HoldReason }[] = [];
  for (const po of pos) {
    const v = autoPostVerdict(po, opts);
    if (v.post) post.push(po);
    else if (v.hold) held.push({ po, hold: v.hold });
  }
  return { post, held };
}
