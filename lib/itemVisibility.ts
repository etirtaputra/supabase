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
 *
 * ARCHIVED (`archived_at`, added 2026-09-03) is a SECOND and independent way
 * an item leaves the shelf, and every customer-facing picker had been written
 * before that column existed — so an archived item still appeared in all of
 * them (owner found the archived JINKO module still listed in Design mounting,
 * 2026-09-05). `isOfferable` is the one question a picker should ask, so a
 * third reason to withhold an item can never again be added in one place and
 * missed in five.
 */
import type { QuoteCostMode } from './computeTUC';

export interface VisibilityFields {
  quote_cost_mode?: string | null;
  show_tuc_in_quotes?: boolean | null;
  /** Set when the item was archived; null while it is on the shelf. */
  archived_at?: string | null;
}

/** The columns any picker must SELECT for `isOfferable` to mean anything. */
export const VISIBILITY_COLUMNS = 'quote_cost_mode, show_tuc_in_quotes, archived_at';

/** The effective Cost Basis mode, legacy boolean included. */
export const costModeOf = (c: VisibilityFields | null | undefined): QuoteCostMode =>
  (c?.quote_cost_mode as QuoteCostMode | undefined)
  ?? (c?.show_tuc_in_quotes === false ? 'hidden' : 'buffered');

/** Cost Basis → Hidden. One of the two reasons an item is not offered. */
export const isHiddenItem = (c: VisibilityFields | null | undefined): boolean =>
  costModeOf(c) === 'hidden';

/** Archived in the Item Editor. The other reason. */
export const isArchivedItem = (c: VisibilityFields | null | undefined): boolean =>
  !!c?.archived_at;

/**
 * May this item be offered on a NEW customer-facing document?
 *
 * Ask this, never `isHiddenItem` alone. A picker that asks only about Cost
 * Basis will keep offering something the catalogue has retired — which is how
 * an archived module went on appearing in the mounting designer.
 */
export const isOfferable = (c: VisibilityFields | null | undefined): boolean =>
  !isHiddenItem(c) && !isArchivedItem(c);

/**
 * Brands worth offering: a brand disappears once EVERY item carrying it is
 * hidden or archived — that is what "the brand is gone" means when the flag
 * lives on the item. One offerable item is enough to keep the brand listed.
 */
export function visibleBrands<T extends VisibilityFields & { brand?: string | null }>(items: T[]): string[] {
  const anyVisible = new Map<string, boolean>();
  for (const c of items) {
    const b = (c.brand ?? '').trim();
    if (!b) continue;
    anyVisible.set(b, (anyVisible.get(b) ?? false) || isOfferable(c));
  }
  return [...anyVisible.entries()].filter(([, ok]) => ok).map(([b]) => b).sort((a, b) => a.localeCompare(b));
}
