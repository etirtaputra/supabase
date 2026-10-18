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
 * ONE DELIBERATE CHANGE since the port (owner, 2026-10-18 — engine v12): a
 * 4850 mm rail may be CUT into 2400 / 1200 mm pieces, up to two per rail line,
 * when that buys fewer rails for the job (`allowCutRails`, see `planCutLine`).
 * v11 only ever laid whole rails and warned "consider a cut-to-length rail"
 * without doing it. The v11 golden tests run with `allowCutRails: false`, which
 * is exactly the calculator's rule.
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

/**
 * The engine's version, stamped on every saved mounting design. 11 was the
 * straight port of the v11 calculator; 12 adds cut rails (2026-10-18).
 */
export const MOUNTING_ENGINE_VERSION = 12;

/**
 * Cut rails (owner's decisions, 2026-10-18, from Wendy's test of the website
 * calculator: "it doesn't assume you can cut the rails"):
 *   1. 2400 / 1200 mm pieces are CUT from the 4850 mm stock rail — not stocked.
 *   2. Up to TWO cut pieces per rail line, best fit.
 * One 4850 rail yields 4800 mm of pieces (2 × 2400, 4 × 1200 or 2400 + 2 × 1200)
 * — 50 mm goes to the saw. Only the 4850 rail is cut; any other stock length
 * keeps the whole-rail rule.
 */
export const CUT_RAIL = {
  stockMm: 4850,
  piecesMm: [2400, 1200],
  yieldMm: 4800,
  maxCutPiecesPerLine: 2,
} as const;

/** Rules of thumb the calculator hard-codes; Settings may override them. */
export interface MountingOptions {
  /** Rafter/purlin spacing that sets supports per rail. v11: 1700 mm. */
  supportSpacingMm?: number;
  /** Below this the rail end is structurally risky. v11: 25 mm. */
  minEdgeSpacingMm?: number;
  /** Last rail used less than this fraction = wasteful overhang. v11: 0.3. */
  overhangThreshold?: number;
  /**
   * Cut a 4850 rail into 2400 / 1200 pieces when that buys fewer rails
   * (CUT_RAIL). Default ON since engine v12; `false` is v11's whole-rail rule.
   */
  allowCutRails?: boolean;
}

export const MOUNTING_DEFAULTS: Required<MountingOptions> = {
  supportSpacingMm: 1700,
  minEdgeSpacingMm: 25,
  overhangThreshold: 0.3,
  allowCutRails: true,
};

/** Supports a rail piece needs: one per support span plus the end, never under two. */
export const supportsForPiece = (pieceMm: number, supportSpacingMm = MOUNTING_DEFAULTS.supportSpacingMm): number =>
  Math.max(2, Math.ceil(pieceMm / supportSpacingMm) + 1);

/** The cut tails a rail line may end in: none, or up to `maxCutPiecesPerLine` DIFFERENT
 *  piece lengths (2 × 2400 is a whole rail's worth, 2 × 1200 is one 2400). */
function cutTails(): number[][] {
  const out: number[][] = [[]];
  const p = [...CUT_RAIL.piecesMm];
  const pick = (from: number, cur: number[]) => {
    for (let i = from; i < p.length; i++) {
      const next = [...cur, p[i]];
      out.push(next);
      if (next.length < CUT_RAIL.maxCutPiecesPerLine) pick(i + 1, next);
    }
  };
  pick(0, []);
  return out;
}

/**
 * One rail line, best fit: N whole stock rails plus a cut tail, covering the
 * array width plus the minimum edge at both ends. The SHORTEST line wins; a
 * tie goes to fewer pieces (fewer joints). Pieces are listed whole rails first.
 */
export function planCutLine(arrayWidthMm: number, minEdgeSpacingMm = MOUNTING_DEFAULTS.minEdgeSpacingMm): number[] {
  const need = arrayWidthMm + 2 * minEdgeSpacingMm;
  let best: number[] | null = null;
  const len = (ps: number[]) => ps.reduce((a, b) => a + b, 0);
  for (let n = 0; n <= Math.ceil(need / CUT_RAIL.stockMm); n++) {
    for (const tail of cutTails()) {
      if (n === 0 && tail.length === 0) continue;
      const pieces = [...Array(n).fill(CUT_RAIL.stockMm), ...tail];
      if (len(pieces) < need) continue;
      if (!best || len(pieces) < len(best) || (len(pieces) === len(best) && pieces.length < best.length)) best = pieces;
    }
  }
  return best ?? [CUT_RAIL.stockMm];
}

export interface CutPlan {
  /** The pieces every rail line is built from, whole rails first, mm. */
  linePiecesMm: number[];
  /** Cut pieces for the whole job, by length. */
  pieces: { lengthMm: number; qty: number }[];
  /** How the stock rails are cut: `rails` rails, each into `pieces`. */
  patterns: { rails: number; piecesMm: number[] }[];
  wholeRails: number;
  railsCut: number;
}

/** Pack the job's cut pieces into stock rails (4800 mm of pieces each). */
function cutPatterns(pieces: Map<number, number>): CutPlan['patterns'] {
  // 2400 and 1200 are 2 and 1 "units" of a 4-unit rail; pairing 2400s, then
  // finishing an odd 2400 with 1200s, then 1200s in fours is optimal here.
  let big = pieces.get(2400) ?? 0;
  let small = pieces.get(1200) ?? 0;
  const out: CutPlan['patterns'] = [];
  const add = (rails: number, piecesMm: number[]) => { if (rails > 0) out.push({ rails, piecesMm }); };
  add(Math.floor(big / 2), [2400, 2400]);
  big %= 2;
  if (big === 1) {
    const take = Math.min(small, 2);
    add(1, [2400, ...Array(take).fill(1200)]);
    small -= take;
  }
  add(Math.floor(small / 4), [1200, 1200, 1200, 1200]);
  if (small % 4) add(1, Array(small % 4).fill(1200));
  return out;
}

const mmList = (ps: number[]) => {
  const counts = new Map<number, number>();
  for (const p of ps) counts.set(p, (counts.get(p) ?? 0) + 1);
  return [...counts.entries()].map(([l, n]) => (n > 1 ? `${n} × ${l}` : `${l}`)).join(' + ') + ' mm';
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
  /** Supports on one rail of the STOCK length (cut pieces need fewer — see `supports`). */
  supportsPerRail: number;
  supports: number;
  /** Set when the rails are cut (engine v12); null for a whole-rail layout. */
  cutPlan: CutPlan | null;
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
  supportsPerRail: 0, supports: 0, cutPlan: null, groundClips: 0, groundingLugs: 0, lines: [],
};

export function calculateMounting(input: MountingInput, options: MountingOptions = {}): MountingResult {
  const { supportSpacingMm, minEdgeSpacingMm, overhangThreshold, allowCutRails } = { ...MOUNTING_DEFAULTS, ...options };
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
  const railLines = 2 * numberOfRows;

  // ── v11: whole rails of one length ─────────────────────────────────────────
  const wholePerLine = Math.ceil(arrayWidthMm / railLength);
  const wholeRails = wholePerLine * railLines;

  // ── v12: cut the 4850 rail, when that buys fewer rails ─────────────────────
  let cutPlan: CutPlan | null = null;
  if (allowCutRails && railLength === CUT_RAIL.stockMm) {
    const linePiecesMm = planCutLine(arrayWidthMm, minEdgeSpacingMm);
    const whole = linePiecesMm.filter((p) => p === CUT_RAIL.stockMm).length * railLines;
    const counts = new Map<number, number>();
    for (const p of linePiecesMm) if (p !== CUT_RAIL.stockMm) counts.set(p, (counts.get(p) ?? 0) + railLines);
    const patterns = cutPatterns(counts);
    const railsCut = patterns.reduce((a, pt) => a + pt.rails, 0);
    // Only when it SAVES rails: otherwise whole rails — fewer joints and
    // supports for the same money.
    if (whole + railsCut < wholeRails) {
      cutPlan = {
        linePiecesMm,
        pieces: [...counts.entries()].sort((a, b) => b[0] - a[0]).map(([lengthMm, qty]) => ({ lengthMm, qty })),
        patterns, wholeRails: whole, railsCut,
      };
    }
  }

  const linePieces = cutPlan ? cutPlan.linePiecesMm : Array(wholePerLine).fill(railLength);
  const lineLengthMm = linePieces.reduce((a: number, b: number) => a + b, 0);
  const railsPerLine = linePieces.length;
  const edgeSpacingMm = (lineLengthMm - arrayWidthMm) / 2;

  // How much of the last rail the panels actually use. Pulling in a whole extra
  // rail for a sliver of array is the classic material waste.
  const lastRailUsage = arrayWidthMm - (wholePerLine - 1) * railLength;
  const isLargeOverhang = !cutPlan && wholePerLine > 1 && lastRailUsage < railLength * overhangThreshold;

  if (edgeSpacingMm < minEdgeSpacingMm) {
    warnings.push(`Edge spacing ${edgeSpacingMm.toFixed(1)} mm is under ${minEdgeSpacingMm} mm — structurally risky.`);
  } else if (isLargeOverhang) {
    warnings.push('Large rail overhang — consider a cut-to-length rail to save material.');
  }

  const railUtilPercent = Math.min(100, (arrayWidthMm / lineLengthMm) * 100);

  // Rails to BUY: whole rails, plus the stock rails the pieces are cut from.
  const totalRails = cutPlan ? cutPlan.wholeRails + cutPlan.railsCut : wholeRails;
  const totalRailLengthM = Number(((totalRails * railLength) / 1000).toFixed(2));
  const railJoints = railsPerLine > 1 ? (railsPerLine - 1) * railLines : 0;
  const endClamps = numberOfRows * 4;
  const midClamps = Math.max(0, (panelCount - numberOfRows) * 2);
  // Supports follow each piece's length rather than a flat count per rail
  const supportsPerRail = supportsForPiece(railLength, supportSpacingMm);
  const supportsPerLine = linePieces.reduce((a: number, p: number) => a + supportsForPiece(p, supportSpacingMm), 0);
  const supports = supportsPerLine * railLines;
  // Bonding clips scale with the panels; structural attachment is `supports`
  const groundClips = midClamps;
  const groundingLugs = Math.ceil(endClamps / 2);

  const railNote = cutPlan
    ? `${totalRails} × ${railLength} mm · ` + cutPlan.patterns.map((pt) => `${pt.rails} cut into ${mmList(pt.piecesMm)}`).join(', ')
      + ` · each rail line ${mmList(linePieces)} · ${railUtilPercent.toFixed(0)}% used`
    : `${railsPerLine} per rail line · ${railUtilPercent.toFixed(0)}% used`;
  const supportNote = cutPlan
    ? `${supportsPerLine} per rail line (${linePieces.map((p: number) => supportsForPiece(p, supportSpacingMm)).join(' + ')}) at ${supportSpacingMm} mm spacing`
    : `${supportsPerRail} per rail at ${supportSpacingMm} mm spacing`;

  const lines: BomLine[] = [
    { role: 'rail', param: railLength, qty: totalRails, unit: 'pcs',
      label: `Mounting rail ${railLength} mm`, note: railNote },
    ...(railJoints > 0 ? [{ role: 'rail_joint' as const, qty: railJoints, unit: 'pcs', label: 'Rail joint' }] : []),
    { role: 'end_clamp', param: thickness, qty: endClamps, unit: 'pcs', label: `End clamp ${thickness} mm` },
    ...(midClamps > 0 ? [{ role: 'mid_clamp' as const, param: thickness, qty: midClamps, unit: 'pcs', label: `Mid clamp ${thickness} mm` }] : []),
    { role: 'roof_hook', qty: supports, unit: 'pcs', label: SUPPORT_LABEL[input.mountType], note: supportNote },
    ...(groundClips > 0 ? [{ role: 'grounding_clip' as const, qty: groundClips, unit: 'pcs', label: 'Grounding clip (bonding)' }] : []),
    { role: 'grounding_lug', qty: groundingLugs, unit: 'pcs', label: 'Grounding lug' },
  ];

  return {
    ok: true,
    numberOfRows, panelsPerRow,
    effectiveWidthMm: effectiveWidth, effectiveHeightMm: effectiveHeight,
    arrayWidthMm, railsPerLine, edgeSpacingMm, railUtilPercent,
    totalRails, totalRailLengthM, railJoints, endClamps, midClamps,
    supportsPerRail, supports, cutPlan, groundClips, groundingLugs,
    warnings, lines,
  };
}
