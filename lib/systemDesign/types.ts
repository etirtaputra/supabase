/**
 * System Designer (roadmap Module 28) — the shapes the engines and the quote
 * share.
 *
 * An ENGINE is pure arithmetic: context in (panel dimensions, layout, loads),
 * a list of GENERIC lines out — "18 rails of 4200 mm", "36 mid clamps for
 * 35 mm modules". An engine never touches the catalog, never sees a price and
 * never knows a brand; that is what makes it testable against the standalone
 * calculators.
 *
 * A RESOLVER then turns each generic line into a real catalog item by matching
 * `specifications.bom_role` (+ the role's discriminating parameter), and a
 * price by the customer's tier. Anything the catalog cannot satisfy survives
 * as free text flagged "not in catalog" — a missing clamp must never block a
 * quotation.
 */
import type { BomRole } from '../specSchema.ts';

/** One generic line as an engine emits it — no catalog, no price. */
export interface BomLine {
  role: BomRole;
  /** The discriminating value for roles that have one (rail_length_mm 4200,
   *  clamp_thickness_mm 35, roof_type 'metal', cable_cross_section_mm2 4…). */
  param?: string | number | null;
  qty: number;
  /** Selling unit the engine counted in ('pcs', 'meter'…). */
  unit?: string;
  /** Human label, used verbatim when the catalog has nothing to offer. */
  label: string;
  /** Engineering note carried onto the quote line (span, utilisation…). */
  note?: string;
}

/** A generic line after the catalog and the price list have had their say. */
export interface ResolvedLine extends BomLine {
  component_id: string | null;
  /** Customer-facing text: the internal description, never brand or model. */
  description: string;
  unit: string;
  /** Tier price for this customer, or null when the item carries no price. */
  unitPrice: number | null;
  /** Live stock at resolution time, when the caller supplied a stock map. */
  available: number | null;
  resolved: boolean;
  /** How many catalog items could have served this role (alternatives). */
  candidates: number;
  /** Why a line is imperfect — shown on the review step, never silent. */
  warning?: string;
}

/** What an engine run needs to be reproducible, stored on 22.0.system_design. */
export interface SystemDesign {
  /** Which engine produced the lines, so a REGENERATE knows what to re-run. */
  engine: 'mounting' | 'system';
  /** Engine version, bumped when a rule changes — old quotes stay explicable. */
  version: number;
  /** The answers the salesperson gave. Engine-specific, stored verbatim. */
  input: Record<string, unknown>;
  /** Warnings the engine raised (edge spacing, rail utilisation, DC/AC…). */
  warnings?: string[];
  /** When the lines were last generated. */
  generated_at?: string;
}

/**
 * Stamped on every generated quote line (22.1.design_role) so REGENERATE
 * replaces only what the engine owns. A line typed by hand has no role and is
 * never touched.
 */
export const designRoleOf = (line: BomLine): string =>
  line.param === null || line.param === undefined || line.param === ''
    ? line.role
    : `${line.role}:${line.param}`;
