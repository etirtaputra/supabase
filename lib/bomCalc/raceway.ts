/**
 * Cable raceway — the tray sheets ('Tray DCAC', 'DC Tray', 'Tray AC') and
 * the count rows of category 7 in the EPC workbooks.
 *
 * TRAYS. Each tray RUN is a route with the cables it carries. Its size comes
 * from the fill ratio the sheets use:
 *
 *   fill = Σ cables × π·(OD/2)² ÷ (W × H)  ≤ limit (default 40 %)
 *
 * "auto" picks the smallest size in the stick-price table that holds the
 * cables. Then, per run:
 *
 *   pieces = ROUNDUP(length ÷ stick length)   covers = pieces
 *   clamps = covers × clamps per cover        joints = pieces × joints per piece
 *   bolts  = joints × bolts per joint
 *
 * and the stick-price table turns that into one blended cost per metre — the
 * figure the workbooks typed into the BOM by hand (and, on two of the four
 * jobs, forgot: 1,159 m and 524 m of tray with no material price).
 *
 * A cable in a tray can READ its count from the calculation: a roof's strings
 * (+ and − = 2 cables per string) or an AC segment's conductors. Then adding
 * a string or a run updates the tray fill too — nothing is typed twice.
 *
 * The outer diameter is the maker's catalogue figure — an input, never a
 * number this file makes up (same rule as ampacity in ac.ts).
 *
 * COUNTS. Conduit, glands, labels, ties and clips come from the string,
 * inverter, module and AC-circuit counts with per-item factors the engineer
 * can change. One 2026-10 workbook read them off an inverter list typed twice
 * (360 strings for 180) and a label count copied from another job's 96
 * strings; here they read the one string count the inverters define.
 */
import type { Check, RoofRun } from './dc.ts';
import type { AcSegment } from './ac.ts';

export interface TraySize {
  widthMm: number;
  heightMm: number;
  /** Cost of one stick of tray, IDR. Null = not priced yet. */
  stickCost: number | null;
  /** Cost of one stick of cover, IDR. Null = included in the stick cost. */
  coverCost: number | null;
}

/** Where a tray cable's count comes from. */
export type TrayCableSource =
  | { kind: 'typed'; count: number }
  /** A roof's strings: + and − = 2 cables per string. */
  | { kind: 'roof'; roofId: string }
  /** An AC segment's phase + neutral conductors, or its earth conductors. */
  | { kind: 'seg'; segId: string; part: 'phase' | 'pe' };

export interface TrayCable {
  id: string;
  label: string;
  source: TrayCableSource;
  /** Outer diameter of ONE cable, mm — from the maker's catalogue. */
  odMm: number | null;
}

export interface TrayRun {
  id: string;
  label: string;
  /** Route length, m. */
  lengthM: number;
  /** 'auto' = the smallest size in the table within the fill limit; else "WxH" (e.g. "300x100"). */
  size: 'auto' | string;
  cables: TrayCable[];
}

export interface RacewaySettings {
  /** Fill limit, % of the tray's cross-section (the sheets: about 40 %). */
  fillLimitPct: number;
  /** Length of one tray stick, m. */
  stickM: number;
  clampsPerCover: number;
  jointsPerPiece: number;
  boltsPerJoint: number;
  /** Accessory costs, IDR each. Null = included in the stick cost. */
  clampCost: number | null;
  jointCost: number | null;
  boltCost: number | null;
  /** Flexible conduit, m per string and per inverter. */
  conduitPerStringM: number;
  conduitPerInverterM: number;
  glandsPerString: number;
  glandsPerInverter: number;
  labelsPerString: number;
  labelsPerInverter: number;
  labelsPerAcCircuit: number;
  /** Labels on top of the counted ones (panels, warning signs). */
  labelsExtra: number;
  tiesPerModule: number;
  clipsPerModule: number;
}

export interface RacewayDoc {
  trays: TrayRun[];
  sizes: TraySize[];
  settings: RacewaySettings;
}

/**
 * Factors as recorded from the 2026-10 workbooks (docs/epc-bom/WORKBOOK_STUDY.md
 * §2): 3 m sticks, 2 clamps per cover, 2 joints per piece, 8 bolts per joint,
 * 2 m conduit per string and per inverter, 1.2 glands per string and 6 per
 * inverter, 14 labels per string + 50, 1.2 clips per module. Labels per
 * inverter, labels per AC circuit and ties per module were not recorded —
 * they start as working figures for the engineer to confirm.
 */
export const RACEWAY_DEFAULTS: RacewaySettings = {
  fillLimitPct: 40, stickM: 3, clampsPerCover: 2, jointsPerPiece: 2, boltsPerJoint: 8,
  clampCost: null, jointCost: null, boltCost: null,
  conduitPerStringM: 2, conduitPerInverterM: 2,
  glandsPerString: 1.2, glandsPerInverter: 6,
  labelsPerString: 14, labelsPerInverter: 10, labelsPerAcCircuit: 2, labelsExtra: 50,
  tiesPerModule: 2, clipsPerModule: 1.2,
};

/** Common hot-dip galvanised tray sizes, W × H mm — unpriced; the engineer adds prices and sizes. */
export const STANDARD_TRAY_SIZES: [number, number][] = [
  [100, 50], [150, 50], [200, 50], [300, 50], [200, 100], [300, 100], [400, 100], [500, 100], [600, 100], [800, 100], [1000, 100],
];

export function newRacewayDoc(): RacewayDoc {
  return {
    trays: [],
    sizes: STANDARD_TRAY_SIZES.map(([w, h]) => ({ widthMm: w, heightMm: h, stickCost: null, coverCost: null })),
    settings: { ...RACEWAY_DEFAULTS },
  };
}

export const sizeKey = (s: { widthMm: number; heightMm: number }) => `${s.widthMm}x${s.heightMm}`;
export const sizeLabel = (key: string) => key.replace('x', ' × ');

/** What the counts read from the rest of the calculation. */
export interface RacewayInputs {
  strings: number;
  inverters: number;
  modules: number;
  roofs: RoofRun[];
  acSegments: AcSegment[];
}

export interface TrayCableResult {
  id: string;
  label: string;
  count: number;
  odMm: number | null;
  areaMm2: number | null;
}

export interface TrayRunResult {
  id: string;
  label: string;
  lengthM: number;
  /** "WxH", or null when the run could not be sized. */
  size: string | null;
  cables: TrayCableResult[];
  /** Σ cable cross-sections, mm²; null if an outer diameter is missing. */
  cableAreaMm2: number | null;
  fillPct: number | null;
  pieces: number;
  covers: number;
  clamps: number;
  joints: number;
  bolts: number;
  /** Tray + cover + accessories, IDR; null while the size has no stick cost. */
  cost: number | null;
}

export interface RacewayResult {
  trays: TrayRunResult[];
  trayM: number;
  pieces: number;
  covers: number;
  clamps: number;
  joints: number;
  bolts: number;
  /** Metres and pieces per size ("WxH"). */
  bySize: Record<string, { m: number; pieces: number }>;
  /** Σ run costs, IDR; null if any sized run is unpriced or any run unsized. */
  trayCost: number | null;
  /** The blended cost per metre that the BOM's tray row takes. */
  costPerM: number | null;
  conduitM: number;
  glands: number;
  labels: number;
  ties: number;
  clips: number;
  /** AC circuits the labels count (Σ segment circuits). */
  acCircuits: number;
  /** What the counts were read from, and the factors applied — for the explanations. */
  counts: { strings: number; inverters: number; modules: number };
  settings: RacewaySettings;
  checks: Check[];
}

const round2 = (n: number) => Math.round(n * 100) / 100;
const up = (n: number) => Math.ceil(n - 1e-9);

/** The number of cables a source stands for, or an error when what it reads is gone. */
export function cableCount(src: TrayCableSource, inp: Pick<RacewayInputs, 'roofs' | 'acSegments'>): { count: number; error: string | null } {
  if (src.kind === 'typed') return { count: Math.max(0, src.count || 0), error: null };
  if (src.kind === 'roof') {
    const r = inp.roofs.find((x) => x.id === src.roofId);
    return r ? { count: 2 * Math.max(0, r.strings), error: null } : { count: 0, error: 'reads a roof that no longer exists' };
  }
  const s = inp.acSegments.find((x) => x.id === src.segId);
  if (!s) return { count: 0, error: 'reads an AC segment that no longer exists' };
  const circuits = Math.max(0, s.circuits);
  if (src.part === 'pe') return { count: s.pe ? circuits * Math.max(0, s.pe.count) : 0, error: null };
  return { count: circuits * (3 * Math.max(1, s.runs) + Math.max(0, s.neutrals)), error: null };
}

export function calculateRaceway(rw: RacewayDoc, inp: RacewayInputs): RacewayResult {
  const st = { ...RACEWAY_DEFAULTS, ...rw.settings };
  const checks: Check[] = [];
  const limit = st.fillLimitPct / 100;
  const stick = st.stickM > 0 ? st.stickM : 3;
  // Smallest cross-section first; the narrower tray wins a tie (less roof space).
  const sizes = [...rw.sizes].filter((s) => s.widthMm > 0 && s.heightMm > 0)
    .sort((a, b) => a.widthMm * a.heightMm - b.widthMm * b.heightMm || a.widthMm - b.widthMm);
  const byKey = new Map(sizes.map((s) => [sizeKey(s), s]));

  const bySize: RacewayResult['bySize'] = {};
  let trayM = 0, pieces = 0, covers = 0, clamps = 0, joints = 0, bolts = 0;
  let trayCost: number | null = 0;
  const unpricedSizes = new Set<string>();

  const trays = rw.trays.map((t): TrayRunResult => {
    const where = t.label || 'Tray run';
    const lengthM = Math.max(0, t.lengthM || 0);
    const cables = t.cables.map((c): TrayCableResult => {
      const { count, error } = cableCount(c.source, inp);
      if (error) checks.push({ level: 'error', where, message: `Cable "${c.label || '?'}" ${error}. Pick its source again.` });
      const src = c.source;
      const label = c.label
        || (src.kind === 'roof' ? `PV — ${inp.roofs.find((x) => x.id === src.roofId)?.label || 'roof'}` : '')
        || (src.kind === 'seg' ? inp.acSegments.find((x) => x.id === src.segId)?.label ?? '' : '');
      const od = c.odMm != null && c.odMm > 0 ? c.odMm : null;
      return { id: c.id, label, count, odMm: od, areaMm2: od == null ? null : round2(count * Math.PI * (od / 2) ** 2) };
    });
    const counted = cables.filter((c) => c.count > 0);
    const missingOd = counted.filter((c) => c.odMm == null);
    const cableAreaMm2 = missingOd.length ? null : round2(counted.reduce((a, c) => a + (c.areaMm2 ?? 0), 0));
    if (missingOd.length) {
      checks.push({ level: 'warn', where, message: `No outer diameter for ${missingOd.map((c) => c.label || 'a cable').join(', ')} — the tray fill is not checked${t.size === 'auto' ? ' and the run is not sized' : ''}. Take it from the maker's catalogue.` });
    }

    let size: string | null = null;
    if (t.size === 'auto') {
      if (cableAreaMm2 != null && counted.length) {
        const fit = sizes.find((s) => cableAreaMm2 / (s.widthMm * s.heightMm) <= limit + 1e-9);
        if (fit) size = sizeKey(fit);
        else checks.push({ level: 'error', where, message: `No tray in the size table holds ${Math.round(cableAreaMm2).toLocaleString('en-US')} mm² of cable at ${st.fillLimitPct} % fill. Add a larger size or split the run.` });
      } else if (!counted.length && lengthM > 0) {
        checks.push({ level: 'warn', where, message: 'No cables listed, so the tray cannot be sized. Add the cables it carries, or pick a size.' });
      }
    } else if (byKey.has(t.size)) {
      size = t.size;
    } else {
      checks.push({ level: 'error', where, message: `Size ${sizeLabel(t.size)} is not in the size table. Add it there or pick another.` });
    }

    let fillPct: number | null = null;
    if (size && cableAreaMm2 != null && counted.length) {
      const s = byKey.get(size)!;
      fillPct = round2(cableAreaMm2 / (s.widthMm * s.heightMm) * 100);
      checks.push(fillPct > st.fillLimitPct + 1e-9
        ? { level: 'error', where, message: `The cables fill ${fillPct} % of ${sizeLabel(size)} — above ${st.fillLimitPct} %. Use a larger tray or split the run.` }
        : { level: 'ok', where, message: `Fill ${fillPct} % of ${sizeLabel(size)} ≤ ${st.fillLimitPct} %.` });
    }

    const p = lengthM > 0 ? up(lengthM / stick) : 0;
    const cv = p;
    const cl = up(cv * Math.max(0, st.clampsPerCover));
    const jn = up(p * Math.max(0, st.jointsPerPiece));
    const bl = up(jn * Math.max(0, st.boltsPerJoint));
    trayM += lengthM; pieces += p; covers += cv; clamps += cl; joints += jn; bolts += bl;

    let cost: number | null = null;
    if (size) {
      const b = (bySize[size] ??= { m: 0, pieces: 0 });
      b.m = round2(b.m + lengthM); b.pieces += p;
      const s = byKey.get(size)!;
      if (s.stickCost != null && s.stickCost > 0) {
        cost = round2(p * (s.stickCost + (s.coverCost ?? 0)) + cl * (st.clampCost ?? 0) + jn * (st.jointCost ?? 0) + bl * (st.boltCost ?? 0));
      } else if (lengthM > 0) unpricedSizes.add(size);
    }
    if (lengthM > 0) trayCost = cost == null || trayCost == null ? null : trayCost + cost;
    return { id: t.id, label: t.label, lengthM, size, cables, cableAreaMm2, fillPct, pieces: p, covers: cv, clamps: cl, joints: jn, bolts: bl, cost };
  });

  for (const s of unpricedSizes) {
    checks.push({ level: 'warn', where: `Tray ${sizeLabel(s)}`, message: 'No stick cost in the size table, so the blended tray cost per metre cannot be worked out.' });
  }
  trayM = round2(trayM);
  const costPerM = trayCost != null && trayM > 0 ? round2(trayCost / trayM) : null;

  // ── Counts from strings, inverters, modules and AC circuits ──
  const strings = Math.max(0, inp.strings), inverters = Math.max(0, inp.inverters), modules = Math.max(0, inp.modules);
  const acCircuits = inp.acSegments.reduce((a, s) => a + Math.max(0, s.circuits), 0);
  const conduitM = round2(strings * st.conduitPerStringM + inverters * st.conduitPerInverterM);
  const glands = up(strings * st.glandsPerString) + up(inverters * st.glandsPerInverter);
  const labels = up(strings * st.labelsPerString + inverters * st.labelsPerInverter + acCircuits * st.labelsPerAcCircuit + st.labelsExtra);
  const ties = up(modules * st.tiesPerModule);
  const clips = up(modules * st.clipsPerModule);

  return {
    trays, trayM, pieces, covers, clamps, joints, bolts, bySize,
    trayCost: trayCost == null ? null : round2(trayCost), costPerM,
    conduitM, glands, labels, ties, clips, acCircuits, counts: { strings, inverters, modules }, settings: st, checks,
  };
}
