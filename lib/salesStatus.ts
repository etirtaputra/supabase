/** Sales-quote lifecycle status metadata, shared by the list and editor. */
export const SALES_STATUS: Record<string, { label: string; cls: string }> = {
  draft:     { label: 'Draft',           cls: 'bg-slate-700/40 text-slate-300' },
  validated: { label: 'Validated',       cls: 'bg-cyan-500/15 text-cyan-300' },
  sent:      { label: 'Sent',            cls: 'bg-blue-500/15 text-blue-300' },
  accepted:  { label: 'Accepted',        cls: 'bg-teal-500/15 text-teal-300' },
  ordered:   { label: 'Confirmed Order', cls: 'bg-violet-500/15 text-violet-300' },
  invoiced:  { label: 'Invoiced',        cls: 'bg-amber-500/15 text-amber-300' },
  preparing: { label: 'Preparing Items', cls: 'bg-orange-500/15 text-orange-300' },
  delivered: { label: 'Delivered',       cls: 'bg-emerald-500/15 text-emerald-300' },
  cancelled: { label: 'Cancelled',       cls: 'bg-red-500/15 text-red-300' },
  rejected:  { label: 'Rejected',        cls: 'bg-red-500/10 text-red-400/80' },
};

// Statuses that reserve stock (Live = Physical − Reserved). Items being
// prepared for delivery are still reserved until they physically leave.
export const COMMITTED_STATUSES = new Set(['ordered', 'invoiced', 'preparing']);

/**
 * The milestone ladder every sales document climbs:
 *   Draft (SQ) → Validated → Sent → Accepted → Sales Order (SO) →
 *   Invoice (INV) → Delivery (DO); payment (RCPT receipts) runs from SO
 *   onward and "complete" = delivered AND fully paid (both derived).
 * Index comparisons let the UI mark a milestone done even when an older
 * document skipped a step (e.g. sent directly without validation).
 */
export const MILESTONE_ORDER = ['draft', 'validated', 'sent', 'accepted', 'ordered', 'invoiced', 'preparing', 'delivered'] as const;
export const milestoneIndex = (status: string) => MILESTONE_ORDER.indexOf(status as (typeof MILESTONE_ORDER)[number]);
