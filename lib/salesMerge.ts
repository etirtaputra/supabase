/**
 * Folding a colleague's sales-order edits into this tab, row by row.
 *
 * `lib/salesLines.ts` settled IDENTITY — which row is which, so two tabs stop
 * deleting each other's lines. What it did not settle is CONTENT: two people
 * editing the SAME line in the same moment was still last-one-wins, because
 * every save wrote every row. Whoever's autosave fired second won, silently.
 *
 * The rule here is the one the EPC proposal editor has run in production
 * since August (`app/proposals/[id]/page.tsx`), and it is deliberately the
 * same mechanism rather than a second one:
 *
 *   - each tab keeps a BASE snapshot: the version it last agreed on with the
 *     database;
 *   - a row this tab did not change since base is taken from the DATABASE, so
 *     a colleague's edit to it survives;
 *   - a row this tab did change is kept, and only if the database ALSO moved
 *     it since base does it count as a conflict — the saver is told, and their
 *     version is the one that shows.
 *
 * Only rows both sides touched are conflicts. Everything else merges without
 * anyone noticing, which is the point.
 *
 * Pure on purpose — the page does the I/O, this file makes the decisions and
 * can be tested without a database. See lib/salesMerge.test.ts.
 */

/**
 * What makes a line's CONTENT. `key` is identity (settled by salesLines) and
 * position is handled separately, so neither belongs here. `showNote` is a
 * disclosure toggle that never reaches the database, so it is not content.
 */
export const LINE_FIELDS = [
  'component_id', 'is_section', 'description', 'brand', 'note', 'lead_time',
  'unit', 'quantity', 'unit_price', 'qty_formula', 'price_formula', 'design_role',
] as const;

/**
 * Header fields a person edits on this screen. `status` is NOT one of them —
 * it moves through the transition buttons, and gets its own stale-tab guard.
 */
export const HEADER_FIELDS = [
  'customer_id', 'company_id', 'quote_date', 'valid_until',
  'payment_terms', 'delivery_terms', 'ppn_pct', 'notes',
] as const;

/** Compared as numbers, so `3.0` typed over `3` is not an edit. */
const NUMERIC = new Set<string>(['quantity', 'unit_price', 'ppn_pct']);

export type Fielded = Record<string, unknown>;
/** Anything with a row key. Read as a bag of fields via `fields()` — an
 *  interface (EditLine) never satisfies an index signature on its own. */
export type Keyed = { key: string };
const fields = (o: unknown): Fielded => o as Fielded;

/**
 * One comparable string per value: '', null and undefined are the same
 * emptiness, and a number is compared as a number.
 */
export function normField(field: string, v: unknown): string {
  if (NUMERIC.has(field)) {
    const n = Number(String(v ?? '').replace(/[, ]/g, ''));
    return String(isNaN(n) ? 0 : n);
  }
  if (typeof v === 'boolean') return v ? '1' : '';
  return String(v ?? '');
}

/** Do two versions of a line say the same thing? */
export function sameLine(a: unknown, b: unknown): boolean {
  if (!a || !b) return false;
  const [x, y] = [fields(a), fields(b)];
  return LINE_FIELDS.every((f) => normField(f, x[f]) === normField(f, y[f]));
}

export interface MergeResult<T> {
  /** The list this tab should now show. */
  lines: T[];
  /** Rows BOTH sides changed since base. This tab's version is what shows. */
  conflicts: number;
}

const index = <T extends Keyed>(ls: T[]) => new Map(ls.map((l) => [l.key, l]));

/**
 * Fold the database's rows into this tab's rows.
 *
 * @param base   what this tab last agreed on with the database
 * @param local  what this tab shows now (base plus whatever was typed since)
 * @param remote what the database holds now
 */
export function mergeLines<T extends Keyed>(base: T[], local: T[], remote: T[]): MergeResult<T> {
  const b = index(base), l = index(local), r = index(remote);
  let conflicts = 0;

  // Did this tab drag rows around? Compare the order of the rows BOTH this tab
  // and base still hold. A reorder is an edit like any other, so where it
  // happened this tab's order is the spine; otherwise the database's is.
  const localOrder = local.filter((x) => b.has(x.key)).map((x) => x.key).join(' ');
  const baseOrder = base.filter((x) => l.has(x.key)).map((x) => x.key).join(' ');
  const reordered = localOrder !== baseOrder;

  const pick = (key: string): T | null => {
    const rr = r.get(key), ll = l.get(key), bb = b.get(key);
    if (!rr) {
      // Not in the database. Either this tab created it and has not saved it
      // yet, or a colleague deleted it — in which case it only stays if this
      // tab has typing on it that would otherwise be lost.
      if (!ll) return null;
      if (!bb) return ll;                       // created here, never saved
      return sameLine(ll, bb) ? null : ll;      // their deletion stands unless I edited it
    }
    if (!ll) {
      if (!bb) return rr;                       // a colleague's new row — adopt it
      // This tab removed a row the database still has. The removal is an edit
      // like any other; if they edited it too, that is worth saying out loud.
      if (!sameLine(rr, bb)) conflicts += 1;
      return null;                              // the removal stands
    }
    if (!bb) return ll;                         // never in base: created here
    if (sameLine(ll, bb)) return rr;            // untouched here — take theirs
    if (!sameLine(rr, bb)) conflicts += 1;      // both sides edited it
    return ll;                                  // ours shows
  };

  const out: T[] = [];
  const done = new Set<string>();
  const walk = (ls: T[]) => {
    for (const x of ls) {
      if (done.has(x.key)) continue;
      done.add(x.key);
      const row = pick(x.key);
      if (row) out.push(row);
    }
  };
  walk(reordered ? local : remote);
  // Whatever the spine did not cover: rows created in this tab and never
  // saved, or — after a local reorder — rows a colleague has just added.
  walk(reordered ? remote : local);
  return { lines: out, conflicts };
}

export interface HeaderMerge<T> { header: T; conflicts: number }

/**
 * The same rule for the document header, field by field: a field this tab
 * edited is kept, anything else comes from the database. Fields not listed —
 * status, the stamped document numbers, the milestone timestamps — always come
 * from the database, because nobody types them into this screen.
 */
export function mergeHeader<T extends object>(
  base: T, local: T, remote: T, keys: readonly string[] = HEADER_FIELDS,
): HeaderMerge<T> {
  const [b, l, r] = [fields(base), fields(local), fields(remote)];
  const header = { ...remote };
  let conflicts = 0;
  for (const f of keys) {
    if (normField(f, l[f]) === normField(f, b[f])) continue;      // untouched here
    if (normField(f, r[f]) !== normField(f, b[f])) conflicts += 1;
    fields(header)[f] = l[f];
  }
  return { header, conflicts };
}

/** One phrasing for what just happened, used on every path that merges. */
export function mergeMessage(actor: string, conflicts: number): string {
  const who = actor || 'a colleague';
  const merged = `↻ Merged ${who}'s changes`;
  if (conflicts <= 0) return merged;
  return `${merged} — ${conflicts} line${conflicts > 1 ? 's' : ''} you both edited (yours shown)`;
}
