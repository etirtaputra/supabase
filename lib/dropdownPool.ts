/**
 * What a searchable dropdown shows — the one rule, in one place.
 *
 * Two lists, not one:
 *
 *   BROWSING (nothing typed) is a suggestion. It may be SCOPED to the deal the
 *   form is already on — a quote is nearly always replaced by one from the same
 *   supplier, so opening the menu should offer that supplier's quotes, not all
 *   140 on file — and it is capped, because a menu is for picking, not reading.
 *
 *   SEARCHING is a question, and a question is answered from EVERYTHING: the
 *   scope is a good guess, never a restriction, and "nearly always" is not
 *   always. Uncapped, so a typed reference can never be hidden behind a limit.
 *
 * The caller renders; this decides.
 */

export const BROWSE_LIMIT = 50;

export interface PoolOptions {
  /** What the person has typed. Empty = browsing. */
  search: string;
  labelKey: string;
  subLabelKey: string;
  /** Key on each option matched against browseValue. */
  browseKey?: string;
  /** The scope. Empty/null/undefined = no scoping. */
  browseValue?: string | number | null;
  limit?: number;
}

export interface Pool<T> {
  /** The rows to render. */
  items: T[];
  /** Whether the browse list was narrowed by the scope. */
  scoped: boolean;
  /** How many rows the browse list has BEFORE the cap. */
  poolSize: number;
  /** Whether the cap hid some of them. */
  truncated: boolean;
  /** Everything, for "type to search all N". */
  total: number;
}

const text = (v: unknown) => (typeof v === 'string' ? v : v == null ? '' : String(v));

export function dropdownPool<T extends Record<string, unknown>>(
  options: T[],
  { search, labelKey, subLabelKey, browseKey, browseValue, limit = BROWSE_LIMIT }: PoolOptions,
): Pool<T> {
  const total = options.length;
  const q = search.trim().toLowerCase();
  if (q) {
    const items = options.filter((o) =>
      text(o[labelKey]).toLowerCase().includes(q) || text(o[subLabelKey]).toLowerCase().includes(q));
    return { items, scoped: false, poolSize: items.length, truncated: false, total };
  }
  const scoped = !!browseKey && browseValue != null && browseValue !== '';
  const pool = scoped
    ? options.filter((o) => text(o[browseKey!]) === String(browseValue))
    : options;
  return {
    items: pool.slice(0, limit),
    scoped,
    poolSize: pool.length,
    truncated: pool.length > limit,
    total,
  };
}
