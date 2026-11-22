/**
 * When may the Inbox's copy of a document go? — one rule for the cleanup job
 * (GET /api/cron/inbox-cleanup) and the screen's "deleted from ICAPROC on …"
 * line. Lifecycle `inbox_file` (lib/lifecycles.ts). Pure.
 *
 * 30 days after it was FILED in Drive, or 30 days after it was DISMISSED.
 * A document that became a deal but is not filed yet has no date: the Drive
 * copy must exist before ICAPROC's goes.
 */
export const CLEAR_AFTER_DAYS = 30;
const DAY = 86_400_000;

export function clearAfter(r: { status: string; filed_at?: string | null; dismissed_at?: string | null }): number | null {
  if (r.filed_at) return Date.parse(r.filed_at) + CLEAR_AFTER_DAYS * DAY;
  if (r.status === 'dismissed' && r.dismissed_at) return Date.parse(r.dismissed_at) + CLEAR_AFTER_DAYS * DAY;
  return null;
}
