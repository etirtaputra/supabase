/**
 * "Hidden" items — the one rule, in one place.
 *
 * An item set to Cost Basis → **Hidden** (`3.0_components.quote_cost_mode`,
 * owner-only, on the Item Editor's Inspect panel) is deliberately kept out of
 * customer-facing document builders: it never appears in the Project Quote
 * item picker, and it never appears in a Surat Dukungan's catalog picker or
 * its brand list (owner, 2026-08-06).
 *
 * `show_tuc_in_quotes === false` is the legacy boolean the mode replaced; it
 * still means Hidden for rows written before the migration.
 *
 * Documents already SAVED keep whatever they said — their item text is a
 * snapshot. Hiding an item stops the next document quoting it, it never
 * rewrites one already issued.
 */
import type { QuoteCostMode } from './computeTUC';

export interface VisibilityFields {
  quote_cost_mode?: string | null;
  show_tuc_in_quotes?: boolean | null;
}

/** The effective Cost Basis mode, legacy boolean included. */
export const costModeOf = (c: VisibilityFields | null | undefined): QuoteCostMode =>
  (c?.quote_cost_mode as QuoteCostMode | undefined)
  ?? (c?.show_tuc_in_quotes === false ? 'hidden' : 'buffered');

/** Keep this item out of customer-facing pickers? */
export const isHiddenItem = (c: VisibilityFields | null | undefined): boolean =>
  costModeOf(c) === 'hidden';

/**
 * Brands worth offering: a brand disappears once EVERY item carrying it is
 * hidden — that is what "the brand is hidden" means when the flag lives on
 * the item. One visible item is enough to keep the brand listed.
 */
export function visibleBrands<T extends VisibilityFields & { brand?: string | null }>(items: T[]): string[] {
  const anyVisible = new Map<string, boolean>();
  for (const c of items) {
    const b = (c.brand ?? '').trim();
    if (!b) continue;
    anyVisible.set(b, (anyVisible.get(b) ?? false) || !isHiddenItem(c));
  }
  return [...anyVisible.entries()].filter(([, ok]) => ok).map(([b]) => b).sort((a, b) => a.localeCompare(b));
}
