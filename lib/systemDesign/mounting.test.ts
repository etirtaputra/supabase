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
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { calculateMounting, type MountingInput } from './mounting.ts';

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
    const r = calculateMounting(g.input);
    assert.equal(r.ok, true);
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
  const qty = (role: string, lines = calculateMounting(g.input).lines) =>
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
