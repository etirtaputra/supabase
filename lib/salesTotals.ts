/**
 * What a sales document is worth — the ONE implementation.
 *
 * `22.0_sales_quotes.subtotal`, `.ppn_amount` and `.grand_total` are plain
 * columns. No trigger computes them (checked against `pg_trigger`, 2026-09-17:
 * the table carries only `log_sales_quote` and `stamp_sales_quote`, both audit).
 * Whoever writes the document computes the totals, and until now that was the
 * browser editor and nothing else — which is exactly why the schema pack said
 * *"read the sell side, do not write it — not yet"*. An agent inserting rows
 * directly would leave a document whose header disagrees with its own lines:
 * no error, no mismatch flagged anywhere, wrong only when someone invoices it.
 *
 * So the rule got a home before the write path got built. The editor and
 * `POST /api/agent/sales/mirror` both call this; `lib/salesTotals.test.ts`
 * fails the build if the editor grows its own copy again.
 *
 * THE ARITHMETIC IS DELIBERATELY UNROUNDED. `subtotal`, `ppn_amount` and
 * `grand_total` are `numeric` columns, and rupiah rounding belongs at the point
 * of DISPLAY (`fmtIdr`), not at the point of storage — rounding here would make
 * the stored grand total disagree with the sum of its own lines by a rupiah or
 * two, which is the kind of difference that costs an afternoon to explain.
 */

/** The only three things a line contributes to a total. */
export interface TotalsLine {
  /** A section header carries no money — it is a heading, not a line. */
  is_section?: boolean | null;
  quantity?: number | string | null;
  unit_price?: number | string | null;
}

export interface SalesTotals {
  subtotal: number;
  ppn: number;
  grand: number;
}

const num = (v: unknown): number => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};

/**
 * Order value from a line list — the same arithmetic whether it runs on the
 * rows on screen or on a Dolibarr order being mirrored in.
 */
export function salesTotals(lines: TotalsLine[], ppnPct: number | string | null | undefined): SalesTotals {
  const subtotal = lines.reduce(
    (s, l) => s + (l.is_section ? 0 : num(l.quantity) * num(l.unit_price)), 0);
  const ppn = subtotal * (num(ppnPct) / 100);
  return { subtotal, ppn, grand: subtotal + ppn };
}

/** One line's own value, for `22.1_sales_quote_items.line_total` (NOT NULL). */
export const lineTotal = (l: TotalsLine): number =>
  l.is_section ? 0 : num(l.quantity) * num(l.unit_price);
