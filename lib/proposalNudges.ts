/**
 * EPC proposals that need someone — the projects block of "Needs you today",
 * and the `?due=` filter on the proposals list. ONE rule for both, so the
 * dashboard's count and the list it opens can never disagree.
 *
 * Measured 2026-10-05 (latest version of each proposal): 2 sent this week;
 * 31 sent 7–30 days ago but for only 6 customers; 31 older than 30 days across
 * 15 customers; nothing ever marked won or lost. So:
 *   · a follow-up is counted by CUSTOMER — you call a customer, not a row;
 *   · past OUTCOME_DAYS the ask changes from "chase it" to "say how it ended",
 *     because a pipeline where nothing is ever won or lost is not a pipeline.
 */
import { groupProposals, type GroupableQuote } from './proposalGroups.ts';

/** Sent this long ago with no outcome: mark it won or lost. */
export const EPC_OUTCOME_DAYS = 30;
/** A draft nobody has touched for this long. */
export const EPC_IDLE_DRAFT_DAYS = 7;

export type EpcDue = 'followup' | 'outcome' | 'idle';

export interface NudgeQuote extends GroupableQuote {
  /** Stamped by the database each time the proposal goes draft → sent. */
  sent_at?: string | null;
}

const DAY = 86_400_000;
const ageDays = (iso: string | null | undefined, now: number): number | null => {
  const t = Date.parse(iso ?? '');
  return Number.isFinite(t) ? (now - t) / DAY : null;
};

/** What the NEWEST version of a proposal needs, if anything. */
export function epcDue(latest: NudgeQuote, now: number, followUpDays: number): EpcDue | null {
  if (latest.status === 'sent') {
    const age = ageDays(latest.sent_at || latest.updated_at || latest.created_at, now);
    if (age == null) return null;
    if (age >= EPC_OUTCOME_DAYS) return 'outcome';
    if (age >= followUpDays) return 'followup';
    return null;
  }
  if (latest.status === 'draft') {
    const age = ageDays(latest.updated_at || latest.created_at, now);
    if (age != null && age >= EPC_IDLE_DRAFT_DAYS) return 'idle';
  }
  return null;
}

export interface EpcNudge {
  due: EpcDue;
  proposals: number;
  customers: number;
  /** Sum of the newest versions' subtotals (excl. PPN). */
  value: number;
  /** Days since the oldest one was sent (or, for a draft, last edited). */
  oldestDays: number;
}

/** One nudge per kind that has anything in it, by value. Versions never count twice. */
export function epcNudges<Q extends NudgeQuote>(quotes: Q[], opts: {
  now: number; followUpDays: number; valueOf: (quoteId: string) => number;
}): EpcNudge[] {
  const acc = new Map<EpcDue, { proposals: number; customers: Set<string>; value: number; oldest: number }>();
  for (const g of groupProposals(quotes, { now: opts.now })) {
    for (const f of g.families) {
      const due = epcDue(f.latest, opts.now, opts.followUpDays);
      if (!due) continue;
      const a = acc.get(due) ?? { proposals: 0, customers: new Set<string>(), value: 0, oldest: 0 };
      a.proposals += 1;
      a.customers.add(g.key);
      a.value += opts.valueOf(f.latest.quote_id);
      const l = f.latest;
      const age = ageDays(due === 'idle' ? (l.updated_at || l.created_at) : (l.sent_at || l.updated_at || l.created_at), opts.now) ?? 0;
      a.oldest = Math.max(a.oldest, Math.floor(age));
      acc.set(due, a);
    }
  }
  return [...acc].map(([due, a]) => ({ due, proposals: a.proposals, customers: a.customers.size, value: a.value, oldestDays: a.oldest }))
    .sort((x, y) => y.value - x.value);
}

/** Subtotal per proposal (top-level lines only — sub-items are descriptions). */
export function subtotalsByQuote(items: { quote_id: string; parent_item_id: string | null; quantity: number | string | null; sell_price: number | string | null }[]): Map<string, number> {
  const m = new Map<string, number>();
  for (const it of items) {
    if (it.parent_item_id) continue;
    m.set(it.quote_id, (m.get(it.quote_id) ?? 0) + (Number(it.quantity) || 0) * (Number(it.sell_price) || 0));
  }
  return m;
}
