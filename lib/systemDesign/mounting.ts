/**
 * Mounting engine — a pure port of "Kalkulator Pemasangan Solar ICA v11"
 * (`calculate()` in the standalone HTML app).
 *
 * The arithmetic here is the calculator's, line for line. Where the HTML mixed
 * calculation with DOM writing, only the calculation came across; where it
 * hard-coded a rule of thumb (support spacing 1700 mm, the 25 mm minimum edge,
 * the 30% last-rail threshold) the number is an option with the calculator's
 * value as its default, so Settings can own it later without changing results.
 *
 * `mounting.test.ts` pins every output to values read out of the HTML app
 * itself. If a rule ever changes, that test changes with it — deliberately,
 * never silently.
 *
 * The engine knows nothing about the catalog: it emits GENERIC lines (a role,
 * its discriminating parameter and a quantity). `resolve.ts` turns those into
 * items and prices.
 */
import type { BomLine } from './types.ts';

export type MountType = 'roof' | 'ground' | 'flat';
export type Orientation = 'portrait' | 'landscape';

export interface MountingInput {
  panelCount: number;
  numberOfRows: number;
  /** Module long side, mm (the datasheet's "length"). */
  panelLengthMm: number;
  /** Module short side, mm. */
  panelWidthMm: number;
  /** Frame thickness, mm — this IS the clamp size. */
  panelThicknessMm: number;
  railLengthMm: number;
  /** Gap between panels in a row, mm (thermal expansion + mid clamp). */
  panelSpacingMm: number;
  mountType: MountType;
  orientation: Orientation;
}

/** Rules of thumb the calculator hard-codes; Settings may override them. */
export interface MountingOptions {
  /** Rafter/purlin spacing that sets supports per rail. v11: 1700 mm. */
  supportSpacingMm?: number;
  /** Below this the rail end is structurally risky. v11: 25 mm. */
  minEdgeSpacingMm?: number;
  /** Last rail used less than this fraction = wasteful overhang. v11: 0.3. */
  overhangThreshold?: number;
}

export const MOUNTING_DEFAULTS: Required<MountingOptions> = {
  supportSpacingMm: 1700,
  minEdgeSpacingMm: 25,
  overhangThreshold: 0.3,
};

/** The rail lengths the calculator offers as stock items. */
export const RAIL_LENGTHS_MM = [4850, 3600] as const;

/** Panels the calculator ships with, kept so the wizard can offer them when
 *  the catalog item carries no dimensions yet. Values are the v11 database. */
export const V11_PANEL_PRESETS: { model: string; lengthMm: number; widthMm: number; thicknessMm: number }[] = [
  { model: 'ICA100-36M',   lengthMm: 890,  widthMm: 580,  thicknessMm: 28 },
  { model: 'ICA200-72M',   lengthMm: 1328, widthMm: 765,  thicknessMm: 28 },
  { model: 'ICA390-72MF',  lengthMm: 1979, widthMm: 1002, thicknessMm: 35 },
  { model: 'ICA450-72HMG', lengthMm: 2108, widthMm: 1048, thicknessMm: 35 },
  { model: 'ICA550-72HMI', lengthMm: 2278, widthMm: 1134, thicknessMm: 35 },
];

/** What the support line is called, per mount type (v11 wording). */
export const SUPPORT_LABEL: Record<MountType, string> = {
  roof:   'Roof Support',
  ground: 'Ground Mount Post',
  flat:   'Ballast/Support Flat',
};

export interface MountingResult {
  /** false when dimensions or rail length are missing — the HTML bails too. */
  ok: boolean;
  /** Rows actually used: never more than there are panels. */
  numberOfRows: number;
  panelsPerRow: number;
  effectiveWidthMm: number;
  effectiveHeightMm: number;
  /** Panels + inter-panel gaps across one row, mm. */
  arrayWidthMm: number;
  railsPerLine: number;
  /** Spare rail at EACH end of a row, mm. */
  edgeSpacingMm: number;
  railUtilPercent: number;
  totalRails: number;
  totalRailLengthM: number;
  railJoints: number;
  endClamps: number;
  midClamps: number;
  supportsPerRail: number;
  supports: number;
  groundClips: number;
  groundingLugs: number;
  /** Engineering notes for the review step — never silent. */
  warnings: string[];
  /** The bill of materials, ready for `resolveBom`. */
  lines: BomLine[];
}

const EMPTY: Omit<MountingResult, 'numberOfRows' | 'panelsPerRow' | 'warnings'> = {
  ok: false, effectiveWidthMm: 0, effectiveHeightMm: 0, arrayWidthMm: 0,
  railsPerLine: 0, edgeSpacingMm: 0, railUtilPercent: 0, totalRails: 0,
  totalRailLengthM: 0, railJoints: 0, endClamps: 0, midClamps: 0,
  supportsPerRail: 0, supports: 0, groundClips: 0, groundingLugs: 0, lines: [],
};

export function calculateMounting(input: MountingInput, options: MountingOptions = {}): MountingResult {
  const { supportSpacingMm, minEdgeSpacingMm, overhangThreshold } = { ...MOUNTING_DEFAULTS, ...options };
  const warnings: string[] = [];

  const panelCount = Math.max(1, Math.floor(input.panelCount) || 0);
  let numberOfRows = Math.max(1, Math.floor(input.numberOfRows) || 1);
  // More rows than panels would leave rows empty yet still bill their materials
  if (numberOfRows > panelCount) {
    numberOfRows = panelCount;
    warnings.push(`Rows exceeded the panel count — adjusted to ${numberOfRows}.`);
  }

  const rawLength = Number(input.panelLengthMm) || 0;
  const rawWidth = Number(input.panelWidthMm) || 0;
  const thickness = Number(input.panelThicknessMm) || 0;
  const railLength = Number(input.railLengthMm) || 0;
  const panelSpacing = Math.floor(Number(input.panelSpacingMm)) || 0;

  // Portrait stands the module on its short side; landscape lays it on the long
  // one. min/max rather than the raw fields, so swapped inputs still behave.
  let effectiveWidth: number;
  let effectiveHeight: number;
  if (input.orientation === 'portrait') {
    effectiveWidth = Math.min(rawLength, rawWidth);
    effectiveHeight = Math.max(rawLength, rawWidth);
    if (rawLength === 0 || rawWidth === 0) { effectiveWidth = 0; effectiveHeight = 0; }
  } else {
    effectiveWidth = Math.max(rawLength, rawWidth);
    effectiveHeight = Math.min(rawLength, rawWidth);
  }

  const panelsPerRow = Math.ceil(panelCount / numberOfRows);

  if (effectiveWidth === 0 || railLength === 0) {
    warnings.push('Panel dimensions and rail length are needed before anything can be sized.');
    return { ...EMPTY, numberOfRows, panelsPerRow, warnings };
  }

  const arrayWidthMm = (panelsPerRow * effectiveWidth) + ((panelsPerRow - 1) * panelSpacing);
  const railsPerLine = Math.ceil(arrayWidthMm / railLength);
  const totalPhysicalLengthPerLine = railsPerLine * railLength;
  const edgeSpacingMm = (totalPhysicalLengthPerLine - arrayWidthMm) / 2;

  // How much of the last rail the panels actually use. Pulling in a whole extra
  // rail for a sliver of array is the classic material waste.
  const lastRailUsage = arrayWidthMm - (railsPerLine - 1) * railLength;
  const isLargeOverhang = railsPerLine > 1 && lastRailUsage < railLength * overhangThreshold;

  if (edgeSpacingMm < minEdgeSpacingMm) {
    warnings.push(`Edge spacing ${edgeSpacingMm.toFixed(1)} mm is under ${minEdgeSpacingMm} mm — structurally risky.`);
  } else if (isLargeOverhang) {
    warnings.push('Large rail overhang — consider a cut-to-length rail to save material.');
  }

  const railUtilPercent = Math.min(100, (arrayWidthMm / totalPhysicalLengthPerLine) * 100);

  const totalRails = railsPerLine * 2 * numberOfRows;
  const totalRailLengthM = Number(((totalRails * railLength) / 1000).toFixed(2));
  const railJoints = railsPerLine > 1 ? (railsPerLine - 1) * 2 * numberOfRows : 0;
  const endClamps = numberOfRows * 4;
  const midClamps = Math.max(0, (panelCount - numberOfRows) * 2);
  // Supports follow the rail's length rather than a flat count per rail
  const supportsPerRail = Math.max(2, Math.ceil(railLength / supportSpacingMm) + 1);
  const supports = totalRails * supportsPerRail;
  // Bonding clips scale with the panels; structural attachment is `supports`
  const groundClips = midClamps;
  const groundingLugs = Math.ceil(endClamps / 2);

  const lines: BomLine[] = [
    { role: 'rail', param: railLength, qty: totalRails, unit: 'pcs',
      label: `Mounting rail ${railLength} mm`,
      note: `${railsPerLine} per rail line · ${railUtilPercent.toFixed(0)}% used` },
    ...(railJoints > 0 ? [{ role: 'rail_joint' as const, qty: railJoints, unit: 'pcs', label: 'Rail joint' }] : []),
    { role: 'end_clamp', param: thickness, qty: endClamps, unit: 'pcs', label: `End clamp ${thickness} mm` },
    ...(midClamps > 0 ? [{ role: 'mid_clamp' as const, param: thickness, qty: midClamps, unit: 'pcs', label: `Mid clamp ${thickness} mm` }] : []),
    { role: 'roof_hook', qty: supports, unit: 'pcs', label: SUPPORT_LABEL[input.mountType],
      note: `${supportsPerRail} per rail at ${supportSpacingMm} mm spacing` },
    ...(groundClips > 0 ? [{ role: 'grounding_clip' as const, qty: groundClips, unit: 'pcs', label: 'Grounding clip (bonding)' }] : []),
    { role: 'grounding_lug', qty: groundingLugs, unit: 'pcs', label: 'Grounding lug' },
  ];

  return {
    ok: true,
    numberOfRows, panelsPerRow,
    effectiveWidthMm: effectiveWidth, effectiveHeightMm: effectiveHeight,
    arrayWidthMm, railsPerLine, edgeSpacingMm, railUtilPercent,
    totalRails, totalRailLengthM, railJoints, endClamps, midClamps,
    supportsPerRail, supports, groundClips, groundingLugs,
    warnings, lines,
  };
}
