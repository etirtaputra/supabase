/**
 * Which sales-order line gets written, which gets deleted, and in what order.
 *
 * The sales editor used to save its lines by deleting every row for the quote
 * and inserting the whole list back. The data it wrote was right; the ORDER of
 * operations was the bug — and it cost two things silently:
 *
 *   • `24.1_delivery_order_items.so_item_id` and
 *     `25.1_sales_invoice_items.so_item_id` are foreign keys onto these rows
 *     with ON DELETE SET NULL. Re-minting every `item_id` on every save cut a
 *     delivered or invoiced line's link back to the order line it came from —
 *     on the autosaver, 2.5s after any keystroke.
 *   • A second tab's save deleted the first tab's rows wholesale.
 *
 * So identity is the whole game: a row that still exists keeps its `item_id`,
 * a new row is given one up front, and the delete names ONLY the rows this tab
 * loaded and has since removed. A row a colleague added in another tab is not
 * in `known`, so it is never collateral — the same "write only what you
 * changed" rule the EPC proposal editor follows.
 *
 * This is the decision half, kept pure so it can be tested; the page does the
 * I/O. See lib/salesLines.test.ts.
 */

/** `db-<uuid>` once the row exists in the table; `new-…` until then. */
export const dbItemId = (key: string): string | null =>
  key.startsWith('db-') ? key.slice(3) || null : null;

export interface LinePlan {
  /** Rows to upsert, in order, deduped, each with the id to write it under. */
  assign: { key: string; itemId: string }[];
  /** New rows only: local key → the id it was just given. */
  rekey: Record<string, string>;
  /** Rows THIS TAB had and no longer wants. Delete these, and only these. */
  gone: string[];
}

/**
 * @param keys     the surviving lines' keys, in display order
 * @param known    every item_id this tab has seen (loaded, or written earlier)
 * @param mintId   how to make an id for a new row — injected so a test can be
 *                 deterministic and so this file never touches `crypto`
 */
export function planLineWrite(
  keys: string[],
  known: Iterable<string>,
  mintId: () => string,
): LinePlan {
  const assign: { key: string; itemId: string }[] = [];
  const rekey: Record<string, string> = {};
  const seen = new Set<string>();

  for (const key of keys) {
    const existing = dbItemId(key);
    // Postgres refuses an ON CONFLICT that would touch one row twice, so a
    // repeated key would fail the entire save with a baffling message. Keep
    // the first occurrence and drop the rest.
    if (existing && seen.has(existing)) continue;
    const itemId = existing ?? (rekey[key] ??= mintId());
    if (seen.has(itemId)) continue;
    seen.add(itemId);
    assign.push({ key, itemId });
  }

  const gone: string[] = [];
  for (const id of known) if (!seen.has(id)) gone.push(id);

  return { assign, rekey, gone };
}
