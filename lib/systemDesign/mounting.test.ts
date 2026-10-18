/**
 * GOLDEN TESTS — mounting engine vs "Kalkulator Pemasangan Solar ICA v11".
 *
 * Every expected number below was READ OUT OF THE HTML CALCULATOR: the app was
 * loaded in headless Chromium, the inputs of each scenario were set, its own
 * `calculate()` was called, and the rendered results were captured. They are
 * the calculator's answers, not a re-derivation of them.
 *
 * A failure here means the port and the calculator disagree. Change these
 * numbers only when the RULE has deliberately changed — never to make a
 * failing build pass.
 *
 * v11 lays WHOLE rails only. Cut rails (engine v12, owner 2026-10-18) are a
 * deliberate rule change, so the parity tests run with `allowCutRails: false`
 * — the calculator's own rule — and the cut-rail goldens are pinned below.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { calculateMounting, planCutLine, supportsForPiece, unitCostsFrom, COST_PROBE_LINES, MOUNTING_ENGINE_VERSION, CUT_RAIL, type MountingInput } from './mounting.ts';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const V11 = { allowCutRails: false };

interface Golden {
  name: string;
  input: MountingInput;
  panelsPerRow: number;
  edgeSpacingMm: number;
  totalRails: number;
  totalRailLengthM: number;
  railJoints: number;
  endClamps: number;
  midClamps: number;
  supports: number;
  groundClips: number;
  groundingLugs: number;
  railUtilPercentRounded: number;
  /** v11 flags the edge box: '' | 'warning' (too tight) | 'notice' (overhang) */
  edgeFlag: '' | 'warning' | 'notice';
  rowsAdjusted?: number;
}

const GOLDEN: Golden[] = [
  {
    name: 'default — 4 panels, one row, portrait, 4850 rail',
    input: { panelCount: 4, numberOfRows: 1, panelLengthMm: 2278, panelWidthMm: 1134, panelThicknessMm: 35, railLengthMm: 4850, panelSpacingMm: 20, mountType: 'roof', orientation: 'portrait' },
    panelsPerRow: 4, edgeSpacingMm: 127.0, totalRails: 2, totalRailLengthM: 9.70, railJoints: 0,
    endClamps: 4, midClamps: 6, supports: 8, groundClips: 6, groundingLugs: 2,
    railUtilPercentRounded: 95, edgeFlag: '',
  },
  {
    name: '12 panels, 2 rows, landscape, ground mount',
    input: { panelCount: 12, numberOfRows: 2, panelLengthMm: 2278, panelWidthMm: 1134, panelThicknessMm: 35, railLengthMm: 4850, panelSpacingMm: 20, mountType: 'ground', orientation: 'landscape' },
    panelsPerRow: 6, edgeSpacingMm: 391.0, totalRails: 12, totalRailLengthM: 58.20, railJoints: 8,
    endClamps: 8, midClamps: 20, supports: 48, groundClips: 20, groundingLugs: 4,
    railUtilPercentRounded: 95, edgeFlag: '',
  },
  {
    name: 'small panel, 3 rows, 3600 rail, flat roof',
    input: { panelCount: 9, numberOfRows: 3, panelLengthMm: 1328, panelWidthMm: 765, panelThicknessMm: 28, railLengthMm: 3600, panelSpacingMm: 15, mountType: 'flat', orientation: 'portrait' },
    panelsPerRow: 3, edgeSpacingMm: 637.5, totalRails: 6, totalRailLengthM: 21.60, railJoints: 0,
    endClamps: 12, midClamps: 12, supports: 24, groundClips: 12, groundingLugs: 6,
    railUtilPercentRounded: 65, edgeFlag: '',
  },
  {
    name: 'more rows than panels — rows clamp to the panel count',
    input: { panelCount: 3, numberOfRows: 8, panelLengthMm: 1979, panelWidthMm: 1002, panelThicknessMm: 35, railLengthMm: 4850, panelSpacingMm: 20, mountType: 'roof', orientation: 'portrait' },
    panelsPerRow: 1, edgeSpacingMm: 1924.0, totalRails: 6, totalRailLengthM: 29.10, railJoints: 0,
    endClamps: 12, midClamps: 0, supports: 24, groundClips: 0, groundingLugs: 6,
    railUtilPercentRounded: 21, edgeFlag: '', rowsAdjusted: 3,
  },
  {
    name: 'wide panel spills onto a second rail — overhang notice',
    input: { panelCount: 4, numberOfRows: 1, panelLengthMm: 2278, panelWidthMm: 1200, panelThicknessMm: 35, railLengthMm: 4850, panelSpacingMm: 20, mountType: 'roof', orientation: 'portrait' },
    panelsPerRow: 4, edgeSpacingMm: 2420.0, totalRails: 4, totalRailLengthM: 19.40, railJoints: 2,
    endClamps: 4, midClamps: 6, supports: 16, groundClips: 6, groundingLugs: 2,
    railUtilPercentRounded: 50, edgeFlag: 'notice',
  },
  {
    name: '5 panels — large overhang on the second rail',
    input: { panelCount: 5, numberOfRows: 1, panelLengthMm: 2278, panelWidthMm: 1134, panelThicknessMm: 35, railLengthMm: 4850, panelSpacingMm: 20, mountType: 'roof', orientation: 'portrait' },
    panelsPerRow: 5, edgeSpacingMm: 1975.0, totalRails: 4, totalRailLengthM: 19.40, railJoints: 2,
    endClamps: 4, midClamps: 8, supports: 16, groundClips: 8, groundingLugs: 2,
    railUtilPercentRounded: 59, edgeFlag: 'notice',
  },
  {
    name: 'custom 6000 rail, 20 panels over 4 rows',
    input: { panelCount: 20, numberOfRows: 4, panelLengthMm: 2108, panelWidthMm: 1048, panelThicknessMm: 35, railLengthMm: 6000, panelSpacingMm: 25, mountType: 'ground', orientation: 'portrait' },
    panelsPerRow: 5, edgeSpacingMm: 330.0, totalRails: 8, totalRailLengthM: 48.00, railJoints: 0,
    endClamps: 16, midClamps: 32, supports: 40, groundClips: 32, groundingLugs: 8,
    railUtilPercentRounded: 89, edgeFlag: '',
  },
  {
    name: 'single panel',
    input: { panelCount: 1, numberOfRows: 1, panelLengthMm: 890, panelWidthMm: 580, panelThicknessMm: 28, railLengthMm: 3600, panelSpacingMm: 20, mountType: 'roof', orientation: 'portrait' },
    panelsPerRow: 1, edgeSpacingMm: 1510.0, totalRails: 2, totalRailLengthM: 7.20, railJoints: 0,
    endClamps: 4, midClamps: 0, supports: 8, groundClips: 0, groundingLugs: 2,
    railUtilPercentRounded: 16, edgeFlag: '',
  },
];

for (const g of GOLDEN) {
  test(`v11 parity — ${g.name}`, () => {
    const r = calculateMounting(g.input, V11);
    assert.equal(r.ok, true);
    assert.equal(r.cutPlan, null, 'v11 never cuts');
    assert.equal(r.panelsPerRow, g.panelsPerRow, 'panels per row');
    assert.equal(Number(r.edgeSpacingMm.toFixed(1)), g.edgeSpacingMm, 'edge spacing');
    assert.equal(r.totalRails, g.totalRails, 'rails');
    assert.equal(r.totalRailLengthM, g.totalRailLengthM, 'total rail length');
    assert.equal(r.railJoints, g.railJoints, 'rail joints');
    assert.equal(r.endClamps, g.endClamps, 'end clamps');
    assert.equal(r.midClamps, g.midClamps, 'mid clamps');
    assert.equal(r.supports, g.supports, 'supports');
    assert.equal(r.groundClips, g.groundClips, 'grounding clips');
    assert.equal(r.groundingLugs, g.groundingLugs, 'grounding lugs');
    assert.equal(Math.round(r.railUtilPercent), g.railUtilPercentRounded, 'rail utilisation');
    if (g.rowsAdjusted !== undefined) {
      assert.equal(r.numberOfRows, g.rowsAdjusted, 'rows clamped to panel count');
      assert.ok(r.warnings.some((w) => /adjusted to/i.test(w)), 'row adjustment is reported');
    }
    // The HTML colours the edge box; we carry the same judgement as a warning
    const tooTight = r.warnings.some((w) => /structurally risky/i.test(w));
    const overhang = r.warnings.some((w) => /overhang/i.test(w));
    assert.equal(tooTight, g.edgeFlag === 'warning', 'tight-edge flag');
    assert.equal(overhang, g.edgeFlag === 'notice', 'overhang flag');
  });
}

test('the support line is named for the mount type, as v11 labels it', () => {
  const base: MountingInput = { panelCount: 4, numberOfRows: 1, panelLengthMm: 2278, panelWidthMm: 1134, panelThicknessMm: 35, railLengthMm: 4850, panelSpacingMm: 20, mountType: 'roof', orientation: 'portrait' };
  const labelOf = (mountType: MountingInput['mountType']) =>
    calculateMounting({ ...base, mountType }).lines.find((l) => l.role === 'roof_hook')?.label;
  assert.equal(labelOf('roof'), 'Roof Support');
  assert.equal(labelOf('ground'), 'Ground Mount Post');
  assert.equal(labelOf('flat'), 'Ballast/Support Flat');
});

test('missing dimensions size nothing and say why', () => {
  const r = calculateMounting({ panelCount: 4, numberOfRows: 1, panelLengthMm: 0, panelWidthMm: 0, panelThicknessMm: 35, railLengthMm: 4850, panelSpacingMm: 20, mountType: 'roof', orientation: 'portrait' });
  assert.equal(r.ok, false);
  assert.equal(r.lines.length, 0);
  assert.match(r.warnings.join(' '), /dimensions and rail length/i);
});

test('the BoM carries the quantities the results grid shows', () => {
  const g = GOLDEN[1];
  const qty = (role: string, lines = calculateMounting(g.input, V11).lines) =>
    lines.find((l) => l.role === role)?.qty ?? 0;
  assert.equal(qty('rail'), g.totalRails);
  assert.equal(qty('rail_joint'), g.railJoints);
  assert.equal(qty('end_clamp'), g.endClamps);
  assert.equal(qty('mid_clamp'), g.midClamps);
  assert.equal(qty('roof_hook'), g.supports);
  assert.equal(qty('grounding_clip'), g.groundClips);
  assert.equal(qty('grounding_lug'), g.groundingLugs);
});

test('clamps carry the frame thickness, rails their length — what resolution needs', () => {
  const r = calculateMounting(GOLDEN[0].input);
  assert.equal(r.lines.find((l) => l.role === 'mid_clamp')?.param, 35);
  assert.equal(r.lines.find((l) => l.role === 'end_clamp')?.param, 35);
  assert.equal(r.lines.find((l) => l.role === 'rail')?.param, 4850);
});

// ── Cut rails (owner, 2026-10-18; engine v12) ───────────────────────────────
// "It doesn't assume you can cut the rails. Maybe need to assume can do 1200
// and 2400 rails too." Decisions: pieces are CUT from the 4850 rail, up to two
// per rail line, best fit, and only when that buys fewer rails.
//
// Scenarios and expected numbers from the kickoff (website thread,
// 2026-10-18): ICA550-72HMI 2278 × 1134 × 30, portrait, 20 mm gap, roof, 4850
// rail. "today" = the v11 whole-rail answer for the same input.

interface CutGolden {
  panels: number; rows: number;
  arrayWidthMm: number; linePiecesMm: number[]; usedPercent: number;
  pieces: Record<number, number>;   // job total by length, 4850 = whole rails
  rails: number; joints: number; supports: number;
  today: { rails: number; joints: number; supports: number };
}
const CUT_GOLDEN: CutGolden[] = [
  { panels: 12, rows: 2, arrayWidthMm: 6904, linePiecesMm: [4850, 2400], usedPercent: 95, pieces: { 4850: 4, 2400: 4 }, rails: 6, joints: 4, supports: 28, today: { rails: 8, joints: 4, supports: 32 } },
  { panels: 10, rows: 2, arrayWidthMm: 5750, linePiecesMm: [4850, 1200], usedPercent: 95, pieces: { 4850: 4, 1200: 4 }, rails: 5, joints: 4, supports: 24, today: { rails: 8, joints: 4, supports: 32 } },
  { panels: 20, rows: 2, arrayWidthMm: 11520, linePiecesMm: [4850, 4850, 2400], usedPercent: 95, pieces: { 4850: 8, 2400: 4 }, rails: 10, joints: 8, supports: 44, today: { rails: 12, joints: 8, supports: 48 } },
  { panels: 4, rows: 2, arrayWidthMm: 2288, linePiecesMm: [2400], usedPercent: 95, pieces: { 2400: 4 }, rails: 2, joints: 0, supports: 12, today: { rails: 4, joints: 0, supports: 16 } },
  // No saving → whole rails (4850 + 2400 + 1200 would need 4 rails too)
  { panels: 7, rows: 1, arrayWidthMm: 8058, linePiecesMm: [4850, 4850], usedPercent: 83, pieces: { 4850: 4 }, rails: 4, joints: 2, supports: 16, today: { rails: 4, joints: 2, supports: 16 } },
  // No saving → whole rail (2400 + 1200 would need 2 rails too)
  { panels: 3, rows: 1, arrayWidthMm: 3442, linePiecesMm: [4850], usedPercent: 71, pieces: { 4850: 2 }, rails: 2, joints: 0, supports: 8, today: { rails: 2, joints: 0, supports: 8 } },
  { panels: 8, rows: 2, arrayWidthMm: 4596, linePiecesMm: [4850], usedPercent: 95, pieces: { 4850: 4 }, rails: 4, joints: 0, supports: 16, today: { rails: 4, joints: 0, supports: 16 } },
];
const cutInput = (panels: number, rows: number): MountingInput => ({
  panelCount: panels, numberOfRows: rows, panelLengthMm: 2278, panelWidthMm: 1134, panelThicknessMm: 30,
  railLengthMm: 4850, panelSpacingMm: 20, mountType: 'roof', orientation: 'portrait',
});

for (const g of CUT_GOLDEN) {
  test(`cut rails — ${g.panels} panels / ${g.rows} rows → ${g.rails} rails (whole rails: ${g.today.rails})`, () => {
    const r = calculateMounting(cutInput(g.panels, g.rows));
    assert.equal(r.arrayWidthMm, g.arrayWidthMm, 'row width');
    assert.equal(r.totalRails, g.rails, 'rails to buy');
    assert.equal(r.railJoints, g.joints, 'joints');
    assert.equal(r.supports, g.supports, 'supports');
    assert.equal(Math.round(r.railUtilPercent), g.usedPercent, 'used');
    const linePieces = r.cutPlan?.linePiecesMm ?? Array(r.railsPerLine).fill(4850);
    assert.deepEqual(linePieces, g.linePiecesMm, 'pieces per rail line');
    const lines = 2 * g.rows;
    const total: Record<number, number> = {};
    for (const p of linePieces) total[p] = (total[p] ?? 0) + lines;
    assert.deepEqual(total, g.pieces, 'pieces for the job');
    assert.ok(r.edgeSpacingMm >= 25, 'edge never under 25 mm');
    assert.equal(qtyOf(r, 'rail'), g.rails, 'the BoM buys what the result says');
    assert.equal(qtyOf(r, 'roof_hook'), g.supports);
    // ...and the v11 rule for the same job is what "today" says it was.
    const v11 = calculateMounting(cutInput(g.panels, g.rows), V11);
    assert.deepEqual({ rails: v11.totalRails, joints: v11.railJoints, supports: v11.supports }, g.today, 'whole-rail answer');
    // Overhang advice only where rails stay whole.
    if (r.cutPlan) assert.ok(!r.warnings.some((w) => /overhang/i.test(w)), 'a cut layout does not advise cutting');
  });
}
function qtyOf(r: ReturnType<typeof calculateMounting>, role: string) {
  return r.lines.filter((l) => l.role === role).reduce((a, l) => a + l.qty, 0);
}

test('the rail line says how to cut: "6 × 4850 mm · 2 cut into 2 × 2400 mm"', () => {
  const rail = calculateMounting(cutInput(12, 2)).lines.find((l) => l.role === 'rail')!;
  assert.equal(rail.param, 4850, 'still bought as the 4850 stock item');
  assert.match(rail.note ?? '', /^6 × 4850 mm · 2 cut into 2 × 2400 mm/);
  const mixed = calculateMounting(cutInput(10, 2)).lines.find((l) => l.role === 'rail')!;
  assert.match(mixed.note ?? '', /^5 × 4850 mm · 1 cut into 4 × 1200 mm/);
});

test('a rail line ends in at most two cut pieces, never two of the same', () => {
  for (let w = 500; w <= 30000; w += 37) {
    const ps = planCutLine(w);
    const cut = ps.filter((p) => p !== CUT_RAIL.stockMm);
    assert.ok(cut.length <= 2, `${w}: ${ps}`);
    assert.equal(new Set(cut).size, cut.length, `${w}: ${ps}`);
    assert.ok(ps.reduce((a, b) => a + b, 0) >= w + 50, `${w}: ${ps} too short`);
  }
});

test('cutting never buys MORE rails than whole rails would', () => {
  for (let panels = 1; panels <= 60; panels++) {
    for (const rows of [1, 2, 3]) {
      const cut = calculateMounting(cutInput(panels, rows));
      const whole = calculateMounting(cutInput(panels, rows), V11);
      assert.ok(cut.totalRails <= whole.totalRails, `${panels}/${rows}: ${cut.totalRails} > ${whole.totalRails}`);
      if (!cut.cutPlan) assert.equal(cut.totalRails, whole.totalRails);
    }
  }
});

test('only the 4850 rail is cut — 3600 keeps the whole-rail rule', () => {
  const r = calculateMounting({ ...cutInput(12, 2), railLengthMm: 3600 });
  assert.equal(r.cutPlan, null);
  assert.equal(r.totalRails, calculateMounting({ ...cutInput(12, 2), railLengthMm: 3600 }, V11).totalRails);
});

test('supports per piece: 4850 → 4, 2400 → 3, 1200 → 2', () => {
  assert.deepEqual([4850, 2400, 1200].map((p) => supportsForPiece(p)), [4, 3, 2]);
});

test('the mounting engine version is 13, and no screen restates it', () => {
  // 12: cut rails; 13: whole vs cut decided on total cost (owner, 2026-10-18).
  assert.equal(MOUNTING_ENGINE_VERSION, 13);
  for (const rel of [['app', 'api', 'agent', 'design', 'mounting', 'route.ts'], ['components', 'ui', 'MountingDesigner.tsx']]) {
    const src = readFileSync(join(process.cwd(), ...rel), 'utf8');
    assert.ok(/MOUNTING_ENGINE_VERSION/.test(src), `${rel.join('/')} must import the version`);
    assert.ok(!/version:\s*\d+/.test(src), `${rel.join('/')} still writes a literal engine version`);
  }
});

// ── Total cost, not just rails (owner, 2026-10-18; engine v13) ─────────────
// "make it compare total cost, not just rails". Prices below are the catalog's
// selling prices on 2026-10-18: MIBET MD T-slot rail 4850 Rp 205,000, MD
// splice kit Rp 8,000, MD L-feet support Rp 16,000.
const PRICES = { rail: 205_000, joint: 8_000, support: 16_000 };

test('at today\'s prices cost agrees with rail count: a rail outweighs the joints and supports cutting adds', () => {
  for (const g of CUT_GOLDEN) {
    const r = calculateMounting(cutInput(g.panels, g.rows), { unitCosts: PRICES });
    assert.equal(r.layoutDecision.basis, 'cost');
    assert.equal(r.totalRails, g.rails, `${g.panels}/${g.rows}`);
    assert.ok(r.layoutDecision.chosenCostIdr! <= r.layoutDecision.wholeCostIdr!);
  }
});

test('when cutting saves a rail but adds more in joints and supports, whole rails win', () => {
  // 30 panels / 2 rows: cut = 15 rails, 16 joints, 68 supports; whole = 16, 12, 64.
  const cheap = calculateMounting(cutInput(30, 2), { unitCosts: PRICES });
  assert.deepEqual([cheap.totalRails, cheap.railJoints, cheap.supports], [15, 16, 68]);
  assert.equal(cheap.layoutDecision.wholeCostIdr! - cheap.layoutDecision.chosenCostIdr!, 205_000 - 4 * 8_000 - 4 * 16_000);
  assert.match(cheap.lines.find((l) => l.role === 'rail')!.note ?? '', /saves Rp 109,000 against whole rails/);
  // Supports at Rp 60,000: 4 × 8,000 + 4 × 60,000 = 272,000 > one rail.
  const dear = calculateMounting(cutInput(30, 2), { unitCosts: { ...PRICES, support: 60_000 } });
  assert.equal(dear.cutPlan, null, 'whole rails');
  assert.deepEqual([dear.totalRails, dear.railJoints, dear.supports], [16, 12, 64]);
  // ...while the rail-count rule would still have cut.
  assert.notEqual(calculateMounting(cutInput(30, 2)).cutPlan, null);
});

test('a cost tie keeps whole rails — fewer parts for the same money', () => {
  // 4 × (8,000 + 43,250) = 205,000 = the rail cutting saves.
  const r = calculateMounting(cutInput(30, 2), { unitCosts: { rail: 205_000, joint: 8_000, support: 43_250 } });
  assert.equal(r.cutPlan, null);
  assert.equal(r.layoutDecision.chosenCostIdr, r.layoutDecision.wholeCostIdr);
});

test('a missing price falls back to rail count, and says which price is missing', () => {
  // The MD T-slot splice kit has no selling price in the catalog (2026-10-18).
  const r = calculateMounting(cutInput(12, 2), { unitCosts: { ...PRICES, joint: null } });
  assert.equal(r.layoutDecision.basis, 'rails');
  assert.deepEqual(r.layoutDecision.missingPrices, ['rail joint']);
  assert.equal(r.totalRails, 6, 'the v12 rule');
  assert.ok(r.warnings.some((w) => /rail count only — no catalog price for: rail joint/.test(w)));
  // No prices at all is the website's case: v12, silently.
  const none = calculateMounting(cutInput(12, 2));
  assert.equal(none.layoutDecision.basis, 'rails');
  assert.ok(!none.warnings.some((w) => /catalog price/.test(w)));
});

test('cost decisions never buy a dearer job than whole rails, over 1–60 panels × 1–3 rows', () => {
  for (const support of [16_000, 60_000, 150_000]) {
    for (let panels = 1; panels <= 60; panels++) {
      for (const rows of [1, 2, 3]) {
        const r = calculateMounting(cutInput(panels, rows), { unitCosts: { ...PRICES, support } });
        assert.ok(r.layoutDecision.chosenCostIdr! <= r.layoutDecision.wholeCostIdr!, `${panels}/${rows} @ ${support}`);
        assert.ok(r.edgeSpacingMm >= 0);
      }
    }
  }
});

test('the probe lines ask the resolver for exactly the three prices that decide', () => {
  const probes = COST_PROBE_LINES(4850, 'roof');
  assert.deepEqual(probes.map((l) => [l.role, l.param ?? null]), [['rail', 4850], ['rail_joint', null], ['roof_hook', null]]);
  assert.deepEqual(unitCostsFrom([{ role: 'rail', unitPrice: 205_000 }, { role: 'rail_joint', unitPrice: null }, { role: 'roof_hook', unitPrice: 16_000 }]),
    { rail: 205_000, joint: null, support: 16_000 });
});
