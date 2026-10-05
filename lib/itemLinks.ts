/**
 * Linking catalogue items (8.0_component_links) in bulk — the rules behind
 * the Item Editor's link picker (owner, 2026-10-05: "linking items is
 * one-by-one, and as items grow it becomes tedious").
 *
 * Measured that day: 1,040 active items in 18 categories, 38 links, 3 with a
 * reason. The picker showed the first 30 of the category, while six categories
 * are larger (ac_cable 416, non_stock 191, solar_charge_controller 74,
 * mounting 73, inverter_charger 61, solar_pump_inverter 31) — so most siblings
 * were unreachable without already knowing what to type.
 *
 * Category membership is NOT turned into links: ac_cable alone would make
 * ~86,000 pairs, most of them not alternatives at all (NYY 300 mm is not an
 * equivalent of NYA 1.5 mm). Links stay deliberate; the category is shown, not
 * stored ("Others in this category" on the Item Hub).
 */

export interface LinkableItem {
  component_id: string;
  supplier_model: string | null;
  internal_description: string | null;
  brand: string | null;
  category: string | null;
  norm_value?: number | null;
  archived_at?: string | null;
}

/** The link types offered when creating a link. `category_comparable` is not:
 *  the category already says it (0 such links were ever made). */
export const LINK_TYPES = [
  { value: 'brand_equivalent', label: 'Brand Equivalent — same function, different brand' },
  { value: 'exact_model', label: 'Exact Model — same specs, drop-in replacement' },
  { value: 'normalized', label: 'Normalized — compare via unit metric (cost/Wp, etc.)' },
  { value: 'successor', label: 'Successor — one replaces the other' },
] as const;
export type NewLinkType = (typeof LINK_TYPES)[number]['value'];

/** One-tap reasons per type — a link nobody can explain is a link nobody trusts. */
export const LINK_REASONS: Record<NewLinkType, string[]> = {
  brand_equivalent: ['Same specs, different brand', 'Same function, different brand', 'Customer-approved alternative'],
  exact_model: ['Same model, different supplier code', 'Same specs, drop-in replacement'],
  normalized: ['Compare cost per unit of capacity', 'Different size, same product family'],
  successor: ['Newer version replaces the older one', 'Old model discontinued by the supplier'],
};

/** A successor link changes what Products and Sales warn about — it must say why. */
export const reasonRequired = (type: string): boolean => type === 'successor';

const words = (s: string | null | undefined): string[] =>
  (s ?? '').toLowerCase().split(/[^a-z0-9.,]+/).map((w) => w.replace(/^[.,]+|[.,]+$/g, '')).filter((w) => w.length > 0);

const hay = (c: LinkableItem) => `${c.internal_description ?? ''} ${c.supplier_model ?? ''} ${c.brand ?? ''}`.toLowerCase();

/** Every word of the filter must appear (in description, model or brand). */
export function matchesFilter(c: LinkableItem, filter: string): boolean {
  const ws = words(filter);
  if (!ws.length) return true;
  const h = hay(c);
  return ws.every((w) => h.includes(w));
}

/**
 * How alike two items look: shared words in name/model (numbers with units
 * count — "40a", "630wp"), plus capacity within 10%. 0..1. Used only to sort
 * and badge "Suggested" — never to tick anything for the person.
 */
export function likeness(self: LinkableItem, other: LinkableItem): number {
  const a = new Set(words(`${self.internal_description} ${self.supplier_model}`));
  const b = new Set(words(`${other.internal_description} ${other.supplier_model}`));
  if (!a.size || !b.size) return 0;
  let inter = 0;
  for (const w of a) if (b.has(w)) inter += 1;
  let score = inter / (a.size + b.size - inter);
  const na = Number(self.norm_value), nb = Number(other.norm_value);
  if (na > 0 && nb > 0 && Math.abs(na - nb) / Math.max(na, nb) <= 0.1) score += 0.25;
  return Math.min(1, score);
}

export const SUGGEST_MIN = 0.3;
export const SUGGEST_MAX = 8;

export interface LinkCandidates<T extends LinkableItem> {
  /** The whole category (filtered), suggested first. */
  sameCategory: T[];
  /** Other categories — only while the person is typing; some real links cross categories. */
  elsewhere: T[];
  suggested: Set<string>;
}

export function linkCandidates<T extends LinkableItem>(all: T[], self: Pick<LinkableItem, 'component_id' | 'category'> & Partial<LinkableItem>,
  opts: { filter: string; exclude: Set<string>; elsewhereMax?: number }): LinkCandidates<T> {
  const usable = (c: T) => c.component_id !== self.component_id && !opts.exclude.has(c.component_id) && !c.archived_at;
  const inCat = all.filter((c) => usable(c) && !!self.category && c.category === self.category);
  const scored = inCat.map((c) => ({ c, s: likeness(self as LinkableItem, c) }));
  const suggested = new Set(scored.filter((x) => x.s >= SUGGEST_MIN).sort((x, y) => y.s - x.s).slice(0, SUGGEST_MAX).map((x) => x.c.component_id));
  const label = (c: T) => (c.internal_description || c.supplier_model || '').toLowerCase();
  const sameCategory = scored
    .filter((x) => matchesFilter(x.c, opts.filter))
    .sort((x, y) => (Number(suggested.has(y.c.component_id)) - Number(suggested.has(x.c.component_id))) || (y.s - x.s) || label(x.c).localeCompare(label(y.c)))
    .map((x) => x.c);
  const elsewhere = words(opts.filter).join('').length >= 2
    ? all.filter((c) => usable(c) && c.category !== self.category && matchesFilter(c, opts.filter)).slice(0, opts.elsewhereMax ?? 20)
    : [];
  return { sameCategory, elsewhere, suggested };
}

export interface NewLinkRow {
  component_id_a: string;
  component_id_b: string;
  link_type: string;
  normalization_unit: string | null;
  norm_value_a: number | null;
  norm_value_b: number | null;
  notes: string | null;
}

/** The rows to insert for one picker submit. Successor direction: b SUCCEEDS a. */
export function buildLinkRows(selfId: string, targets: { component_id: string; norm_value?: number | null }[], o: {
  type: string; succDir: 'target_succeeds' | 'self_succeeds'; normUnit: string;
  normSelf: number | null; normByTarget: Record<string, number | null>; reason: string;
}): NewLinkRow[] {
  const reason = o.reason.trim() || null;
  return targets.map((t) => {
    const swap = o.type === 'successor' && o.succDir === 'self_succeeds';
    const norm = o.type === 'normalized';
    const tv = o.normByTarget[t.component_id] ?? null;
    return {
      component_id_a: swap ? t.component_id : selfId,
      component_id_b: swap ? selfId : t.component_id,
      link_type: o.type,
      normalization_unit: norm ? o.normUnit : null,
      norm_value_a: norm ? (swap ? tv : o.normSelf) : null,
      norm_value_b: norm ? (swap ? o.normSelf : tv) : null,
      notes: reason,
    };
  });
}

export interface PeerRow<T> { item: T; price: number | null; perUnit: number | null; self: boolean }

/**
 * "Others in this category" — the automatic answer to "should items in the
 * same category be linked?": shown, never stored. Big categories (ac_cable
 * 416) show the `limit` most alike to this item; the list is then ordered by
 * price per unit of capacity where the category has one (cheapest first),
 * else by price. This item is included and flagged, so you see where it sits.
 */
export function categoryPeers<T extends LinkableItem>(self: T, all: T[], priceOf: (c: T) => number | null,
  opts: { perUnit: boolean; limit: number }): { rows: PeerRow<T>[]; total: number } {
  const peers = all.filter((c) => c.component_id !== self.component_id && !c.archived_at && !!self.category && c.category === self.category);
  const picked = peers.length <= opts.limit ? peers
    : peers.map((c) => ({ c, s: likeness(self, c) })).sort((x, y) => y.s - x.s).slice(0, opts.limit).map((x) => x.c);
  const row = (c: T, isSelf: boolean): PeerRow<T> => {
    const price = priceOf(c);
    const nv = Number(c.norm_value);
    return { item: c, price, perUnit: opts.perUnit && price != null && price > 0 && nv > 0 ? price / nv : null, self: isSelf };
  };
  const key = (r: PeerRow<T>) => r.perUnit ?? (opts.perUnit ? null : r.price);
  const rows = [row(self, true), ...picked.map((c) => row(c, false))]
    .sort((a, b) => {
      const ka = key(a), kb = key(b);
      if (ka == null && kb == null) return 0;
      if (ka == null) return 1;
      if (kb == null) return -1;
      return ka - kb;
    });
  return { rows, total: peers.length };
}
