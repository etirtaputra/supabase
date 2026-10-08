/**
 * Finding a catalogue item by typing — the EPC proposal line autocomplete.
 *
 * Owner, 2026-10-08: three Deye inverters quoted the day before "are not
 * showing in EPC Proposal autocomplete". They were in the catalogue; the list
 * was the problem. It kept the FIRST 6 matches in alphabetical model order, so
 * "deye" (28 items) only ever showed five DEYE BOS battery parts and a
 * logger, and SUN-100K-G03 (9th), SUN-110K-G03 (11th) and SUN-50K-G04 (22nd)
 * could not be reached by brand. And it matched the query as one phrase, so
 * "deye 100k" found nothing at all.
 *
 * Now: every word must appear, in any order; the closest matches rank first;
 * within a rank, the item with the freshest supplier quote comes first — the
 * one someone just priced is the one being looked for; and the caller is told
 * how many more matched, so a short list never looks like "that's all".
 */

export interface SearchableItem {
  component_id: string;
  supplier_model?: string | null;
  internal_description?: string | null;
  brand?: string | null;
  category?: string | null;
}

const norm = (s: string | null | undefined) => (s ?? '').toLowerCase().replace(/\s+/g, ' ').trim();

export const searchWords = (query: string): string[] => norm(query).split(' ').filter(Boolean);

/** 3 = name starts with the query · 2 = contains it as typed · 1 = every word, any order · 0 = no match */
export function matchRank(item: SearchableItem, query: string): number {
  const q = norm(query);
  const words = searchWords(query);
  if (!words.length) return 0;
  const names = [norm(item.internal_description), norm(item.supplier_model)];
  // Fields joined with a separator no one types, so a phrase cannot span two of them.
  const hay = [...names, norm(item.brand), norm(item.category)].join(' \u241f ');
  if (!words.every((w) => hay.includes(w))) return 0;
  if (names.some((n) => n.startsWith(q))) return 3;
  if (hay.includes(q)) return 2;
  return 1;
}

/**
 * @param lastQuoted component_id → ISO date of its newest supplier quote
 * @returns the best `limit` matches, and how many matched in all
 */
export function catalogMatches<T extends SearchableItem>(items: T[], query: string,
  opts: { limit: number; lastQuoted?: Map<string, string> }): { shown: T[]; total: number } {
  const label = (c: T) => norm(c.internal_description || c.supplier_model);
  const hits = items
    .map((c) => ({ c, r: matchRank(c, query), d: opts.lastQuoted?.get(c.component_id) ?? '' }))
    .filter((x) => x.r > 0)
    .sort((a, b) => (b.r - a.r) || b.d.localeCompare(a.d) || label(a.c).localeCompare(label(b.c)));
  return { shown: hits.slice(0, opts.limit).map((x) => x.c), total: hits.length };
}

/** component_id → newest quote_date among the supplier quotes that price it. */
export function lastQuotedDates(
  quotes: { quote_id: string | number; quote_date?: string | null }[],
  lines: { quote_id: string | number; component_id?: string | null }[],
): Map<string, string> {
  const dateOf = new Map(quotes.map((q) => [String(q.quote_id), q.quote_date ?? '']));
  const out = new Map<string, string>();
  for (const l of lines) {
    if (!l.component_id) continue;
    const d = dateOf.get(String(l.quote_id)) ?? '';
    if (d > (out.get(l.component_id) ?? '')) out.set(l.component_id, d);
  }
  return out;
}
