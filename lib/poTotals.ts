/**
 * Does a purchase order's stated total agree with its own line items?
 *
 * `5.0_purchases.total_value` is the COMMITTED obligation — the grand total off
 * the supplier's document — and it is deliberately allowed to exceed the lines,
 * because the supplier bills freight on top of them. That licence is what makes
 * the field dangerous: any wrong total also looks legitimate, and everything
 * downstream believes it. Outstanding balance, the paid percentage, the
 * dashboard's "We owe", the deal's progress bar — all of them are computed from
 * `total_value`, never from the lines.
 *
 * On 2026-08-24 the owner found PO-149-MBS-08-2026 showing IDR 1.619.460
 * committed and "50% paid, IDR 809.730 out" while its single line item said
 * IDR 809.730 and the bank had paid exactly that, in full. The deal was
 * settled; the screen said half of it was still owed. Three POs carry a total
 * that is exactly TWICE their own lines, and eleven more carry one that is
 * short by exactly their freight — under-stating what we owe.
 *
 * So the comparison is written down once, here, and both faults come out of the
 * same function: a total is EXPLAINED when it equals the lines plus whatever
 * freight the PO records, and anything else is a disagreement the screen has to
 * say out loud rather than print in grey beside the number it contradicts.
 */

export type TotalVerdict =
  /** The document total is the line items exactly. Nothing to say. */
  | { state: 'exact'; gap: 0 }
  /** Total = items + freight. The gap is accounted for; show the workings. */
  | { state: 'freight'; gap: number }
  /** Total is MORE than items + freight, and nothing explains the rest. */
  | { state: 'over'; gap: number }
  /** Total is LESS than items + freight — the PO under-states what we owe. */
  | { state: 'under'; gap: number };

export interface TotalInputs {
  /** `5.0_purchases.total_value` — what the document says. */
  docTotal: number;
  /** Σ quantity × unit_cost over `5.1_purchase_line_items`. */
  itemsSum: number;
  /** `freight_charges_intl`, when the supplier bills it on top. */
  freight?: number | null;
}

/**
 * Money compared in whole currency units. Rupiah has no cents in practice and
 * a foreign PO's rounding never reaches one unit, so anything under 1 is the
 * arithmetic of a decimal column, not a disagreement worth a warning.
 */
export const TOTAL_TOLERANCE = 1;

export function checkPoTotal({ docTotal, itemsSum, freight }: TotalInputs): TotalVerdict {
  const f = Number(freight) || 0;
  const expected = itemsSum + f;
  const gap = docTotal - expected;
  if (Math.abs(gap) < TOTAL_TOLERANCE) return f > 0 ? { state: 'freight', gap: f } : { state: 'exact', gap: 0 };
  return gap > 0 ? { state: 'over', gap } : { state: 'under', gap: -gap };
}

/** True when the screen must warn rather than merely inform. */
export const totalDisagrees = (v: TotalVerdict): boolean => v.state === 'over' || v.state === 'under';
