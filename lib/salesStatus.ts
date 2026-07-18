/** Sales-quote lifecycle status metadata, shared by the list and editor. */
export const SALES_STATUS: Record<string, { label: string; cls: string }> = {
  draft:     { label: 'Draft',           cls: 'bg-slate-700/40 text-slate-300' },
  sent:      { label: 'Sent',            cls: 'bg-blue-500/15 text-blue-300' },
  accepted:  { label: 'Accepted',        cls: 'bg-teal-500/15 text-teal-300' },
  ordered:   { label: 'Confirmed Order', cls: 'bg-violet-500/15 text-violet-300' },
  invoiced:  { label: 'Invoiced',        cls: 'bg-amber-500/15 text-amber-300' },
  delivered: { label: 'Delivered',       cls: 'bg-emerald-500/15 text-emerald-300' },
  cancelled: { label: 'Cancelled',       cls: 'bg-red-500/15 text-red-300' },
  rejected:  { label: 'Rejected',        cls: 'bg-red-500/10 text-red-400/80' },
};

// Statuses that reserve stock (Live = Physical − Reserved).
export const COMMITTED_STATUSES = new Set(['ordered', 'invoiced']);
