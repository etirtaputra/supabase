/**
 * One purchase order's place on the Progress board, as a row an agent can read.
 *
 * WHY THIS EXISTS (owner, 2026-10-13): MIRA is to keep ICAPROC, Dolibarr and
 * the team's Basecamp board "PROGRESS IMPOR" in sync. ICAPROC is the record —
 * `lib/poProgress.ts` says so in its first paragraph: a Basecamp board is a
 * SECOND COPY of the truth. An agent that re-derived the stages itself would
 * make it a third copy, and the first one to drift. So this runs the SAME
 * functions the board runs and adds only the one thing the board does not
 * need: the title of the Basecamp column the card belongs in.
 *
 * Pure on purpose — the route does the I/O. See progressExport.test.ts.
 */
import type { POCost } from '../types/database.ts';
import {
  MILESTONES, milestonesReached, furthest, isComplete, goodsReceived,
  importCostsOutstanding, type ProgressPo, type Reached, type MilestoneId,
} from './poProgress.ts';

/**
 * The Basecamp PROGRESS IMPOR columns are the ICAPROC milestone labels in
 * capitals (read from the board on 2026-10-13: PI RECEIVED, PO SENT, DP PAID,
 * BALANCE PAID, DOCS CHECKED, HARD COPY RECEIVED, PIB & OPS PAID), plus
 * Basecamp's own "Done". Derived from MILESTONES rather than typed out, so a
 * renamed milestone cannot leave this list behind.
 */
export const BASECAMP_DONE = 'Done';

export function basecampColumnFor(stage: MilestoneId | null, done: boolean): string | null {
  if (done) return BASECAMP_DONE;
  if (!stage) return null;
  const m = MILESTONES.find((x) => x.id === stage);
  return m ? m.label.toUpperCase() : null;
}

export interface ProgressRow {
  stage: MilestoneId | null;
  stage_label: string | null;
  reached: Reached;
  goods_received: boolean;
  complete: boolean;
  /** Goods in, supplier paid, customs charges never recorded — the board's red alarm. */
  import_costs_outstanding: boolean;
  /** Title of the PROGRESS IMPOR column this PO belongs in; null = not on the board yet. */
  basecamp_column: string | null;
}

export function progressRow(po: ProgressPo, costs: POCost[]): ProgressRow {
  const reached = milestonesReached(po, costs);
  const stage = furthest(reached);
  const complete = isComplete(reached, po);
  return {
    stage,
    stage_label: stage ? MILESTONES.find((m) => m.id === stage)?.label ?? null : null,
    reached,
    goods_received: goodsReceived(po),
    complete,
    import_costs_outstanding: importCostsOutstanding(reached, po),
    basecamp_column: basecampColumnFor(stage, complete),
  };
}
