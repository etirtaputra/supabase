/**
 * Generic BoM line → real catalog item, at the customer's tier price.
 *
 * The engines speak in ROLES ("a 4200 mm rail"); the quote needs an item, a
 * description and a price. This is the only place that translation happens,
 * so both the mounting engine and the full system engine resolve identically.
 *
 * Rules, in order:
 *  1. A candidate must declare the role in `specifications.bom_role`, and —
 *     where the role has a discriminating parameter — match it exactly. A
 *     35 mm mid clamp is not a 30 mm one.
 *  2. A candidate must be a design candidate at all: its specs must satisfy
 *     `specReadiness`, and an item Hidden from customer-facing pickers is
 *     never offered (same rule as Project Quotes and Surat Dukungan).
 *  3. Among the survivors: something in stock beats something not, a priced
 *     item beats an unpriced one, then the cheapest wins — the quote should
 *     lead with what we can actually ship today.
 *  4. Nothing matched? The line survives as free text flagged "not in
 *     catalog". A missing clamp must never block a quotation.
 */
import { BOM_ROLE_PARAMS, specNumber, specReadiness, type BomRole, type Specs } from '../specSchema.ts';
import { isHiddenItem, type VisibilityFields } from '../itemVisibility.ts';
import type { BomLine, ResolvedLine } from './types.ts';

/** The catalog fields resolution needs — a subset of 3.0_components. */
export interface DesignCandidate extends VisibilityFields {
  component_id: string;
  internal_description: string | null;
  supplier_model: string;
  category: string | null;
  unit: string | null;
  specifications: Specs | null;
}

export interface ResolveContext {
  /** Every catalog item the caller loaded — filtered here, not by the caller. */
  candidates: DesignCandidate[];
  /** Tier price for this customer, by component. Null when the item has none. */
  priceOf: (componentId: string) => number | null;
  /** Live stock by component, when known. Absent = availability unknown. */
  stockOf?: (componentId: string) => number | null;
}

/**
 * Does a spec value cover a wanted number? Real catalog parts are specified as
 * FIT RANGES, not single sizes: a "MIBET MD U20 Inter Clamp 35-39" takes any
 * frame from 35 to 39 mm, and "30/33" is a part sold for either. So:
 *   "35"       → exactly 35
 *   "35-39"    → 35 … 39 inclusive
 *   "30/33"    → 30 or 33 (a list, not a span)
 *   "30-34/50" → 30 … 34, or 50
 * Matching these exactly would silently drop the right clamp and quote a
 * hand-priced line instead — the failure that hides until site.
 */
export function specCovers(specValue: unknown, wanted: number): boolean {
  const raw = typeof specValue === 'number' ? String(specValue) : String(specValue ?? '').trim();
  if (!raw) return false;
  return raw.split('/').some((part) => {
    const span = part.split(/[-–]/).map((s) => specNumber(s.trim())).filter((n): n is number => n !== null);
    if (span.length >= 2) return wanted >= Math.min(...span) && wanted <= Math.max(...span);
    return span.length === 1 && span[0] === wanted;
  });
}

/** Do a candidate's specs carry this role, and the role's parameter value? */
function matchesRole(c: DesignCandidate, role: BomRole, param: BomLine['param']): boolean {
  const specs = c.specifications ?? {};
  if (String(specs.bom_role ?? '').trim() !== role) return false;
  const paramKey = BOM_ROLE_PARAMS[role];
  if (!paramKey) return true;
  if (param === null || param === undefined || param === '') return true;   // engine did not discriminate
  const want = specNumber(param);
  if (want !== null) return specCovers(specs[paramKey], want);
  return String(specs[paramKey] ?? '').trim().toLowerCase() === String(param).trim().toLowerCase();
}

/** Resolve one generic line. Exported for the tests and the review step. */
export function resolveLine(line: BomLine, ctx: ResolveContext): ResolvedLine {
  const matches = ctx.candidates.filter((c) =>
    !isHiddenItem(c)
    && specReadiness(c.category, c.specifications).ready
    && matchesRole(c, line.role, line.param));

  const scored = matches
    .map((c) => {
      const price = ctx.priceOf(c.component_id);
      const stock = ctx.stockOf?.(c.component_id) ?? null;
      return { c, price, stock };
    })
    .sort((a, b) => {
      const aStock = (a.stock ?? 0) > 0 ? 1 : 0;
      const bStock = (b.stock ?? 0) > 0 ? 1 : 0;
      if (aStock !== bStock) return bStock - aStock;                 // in stock first
      const aPriced = a.price != null && a.price > 0 ? 1 : 0;
      const bPriced = b.price != null && b.price > 0 ? 1 : 0;
      if (aPriced !== bPriced) return bPriced - aPriced;             // priced next
      if (aPriced && bPriced) return (a.price as number) - (b.price as number);   // cheapest
      // Stable last resort so two runs of the same design agree
      return a.c.component_id.localeCompare(b.c.component_id);
    });

  const pick = scored[0];
  if (!pick) {
    return {
      ...line,
      component_id: null,
      description: line.label,
      unit: line.unit ?? 'pcs',
      unitPrice: null,
      available: null,
      resolved: false,
      candidates: 0,
      warning: 'Not in catalog — priced by hand',
    };
  }

  const desc = (pick.c.internal_description ?? '').trim() || pick.c.supplier_model;
  return {
    ...line,
    component_id: pick.c.component_id,
    description: desc,
    unit: line.unit ?? pick.c.unit ?? 'pcs',
    unitPrice: pick.price,
    available: pick.stock,
    resolved: true,
    candidates: scored.length,
    warning: pick.price == null || pick.price <= 0 ? 'No sell price set for this item' : undefined,
  };
}

/** Resolve a whole bill of materials, keeping the engine's order. */
export const resolveBom = (lines: BomLine[], ctx: ResolveContext): ResolvedLine[] =>
  lines.map((l) => resolveLine(l, ctx));

/** What the review step reports before anything is written to the quote. */
export interface BomSummary {
  lines: number;
  unresolved: number;
  unpriced: number;
  short: number;         // resolved lines whose live stock cannot cover the qty
  total: number;         // Σ qty × unit price, resolved+priced lines only
}

export function summarise(lines: ResolvedLine[]): BomSummary {
  let unresolved = 0, unpriced = 0, short = 0, total = 0;
  for (const l of lines) {
    if (!l.resolved) { unresolved += 1; continue; }
    if (l.unitPrice == null || l.unitPrice <= 0) unpriced += 1;
    else total += l.unitPrice * l.qty;
    if (l.available != null && l.available < l.qty) short += 1;
  }
  return { lines: lines.length, unresolved, unpriced, short, total };
}
