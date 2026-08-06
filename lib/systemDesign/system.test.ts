/**
 * GOLDEN TESTS — system engine vs "Smart Solar BoM v7".
 *
 * Same method as the mounting engine: the HTML app was loaded in headless
 * Chromium, each scenario's inputs were set, its own `calculateBOM()` was run,
 * and the rendered bill of materials was captured. The expected numbers below
 * are that capture, and the engine is fed v7's own component database
 * (`v7Fixture.ts`) so a difference can only be arithmetic.
 *
 * Change a number here only when the RULE deliberately changed.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { calculateSystem, type SystemInput } from './system.ts';
import { V7_PANELS, V7_ON_GRID_INVERTERS, V7_HYBRID_INVERTERS, V7_BATTERIES } from './v7Fixture.ts';

const CANDIDATES = {
  onGridInverters: V7_ON_GRID_INVERTERS,
  hybridInverters: V7_HYBRID_INVERTERS,
  batteries: V7_BATTERIES,
};

const qtyOf = (lines: { role: string; qty: number }[], role: string) =>
  lines.filter((l) => l.role === role).reduce((s, l) => s + l.qty, 0);

test('v7 parity — on-grid 5500 VA single phase, DC/AC 1.2', () => {
  const input: SystemInput = {
    systemType: 'on-grid', panel: V7_PANELS[0],          // ICA100-36M
    gridVA: 5500, gridPhase: 1, dcAcRatio: 1.2,
    rows: 2, railLengthMm: 4850, panelSpacingMm: 20, mountType: 'roof', orientation: 'portrait',
  };
  const r = calculateSystem(input, CANDIDATES);
  assert.equal(r.ok, true);
  assert.equal(r.inverter?.model, 'SNV-GT5023DSC');       // largest inside 5500 VA
  assert.equal(r.inverter?.qty, 1);
  assert.equal(r.numPanels, 60);
  assert.equal(Number(r.arrayKwp.toFixed(2)), 6.00);
  assert.equal(r.strings?.numStrings, 3);
  assert.equal(r.strings?.maxSeriesLength, 21);
  // The MPPT limit is exceeded — v7 says so, and so must we
  assert.ok(r.warnings.some((w) => /only supports 2 string/.test(w)));
  // Structure, from v7's own output
  assert.equal(qtyOf(r.lines, 'rail'), 16);
  assert.equal(qtyOf(r.lines, 'rail_joint'), 12);
  assert.equal(qtyOf(r.lines, 'roof_hook'), 64);
  assert.equal(qtyOf(r.lines, 'end_clamp'), 8);
  assert.equal(qtyOf(r.lines, 'mid_clamp'), 116);
  assert.equal(qtyOf(r.lines, 'grounding_clip'), 116);
  assert.equal(qtyOf(r.lines, 'grounding_lug'), 4);
  // Balance of system
  assert.equal(qtyOf(r.lines, 'solar_cable'), 360);
  assert.equal(qtyOf(r.lines, 'mc4_pair'), 8);
  assert.equal(qtyOf(r.lines, 'ac_distribution'), 1);
  assert.equal(qtyOf(r.lines, 'combiner_box'), 0, 'on-grid has no combiner line in v7');
});

test('v7 parity — on-grid 23000 VA three phase, DC/AC 1.3', () => {
  const r = calculateSystem({
    systemType: 'on-grid', panel: V7_PANELS[1],           // ICA200-72M
    gridVA: 23000, gridPhase: 3, dcAcRatio: 1.3,
    rows: 3, railLengthMm: 4850, panelSpacingMm: 20, mountType: 'roof', orientation: 'landscape',
  }, CANDIDATES);
  assert.equal(r.inverter?.model, 'SNV-GT1033DT');        // 10 kW, three phase
  assert.equal(r.numPanels, 65);
  assert.equal(Number(r.arrayKwp.toFixed(2)), 13.00);
  assert.equal(r.strings?.numStrings, 4);
  assert.equal(r.strings?.maxSeriesLength, 18);
  assert.equal(qtyOf(r.lines, 'rail'), 42);
  assert.equal(qtyOf(r.lines, 'rail_joint'), 36);
  assert.equal(qtyOf(r.lines, 'roof_hook'), 168);
  assert.equal(qtyOf(r.lines, 'end_clamp'), 12);
  assert.equal(qtyOf(r.lines, 'mid_clamp'), 124);
  assert.equal(qtyOf(r.lines, 'solar_cable'), 390);
  assert.equal(qtyOf(r.lines, 'mc4_pair'), 10);
  // Three-phase distribution board
  assert.equal(r.lines.find((l) => l.role === 'ac_distribution')?.param, 'triple');
});

test('v7 parity — off-grid, lithium, 1 day autonomy, inductive pump', () => {
  const r = calculateSystem({
    systemType: 'off-grid', panel: V7_PANELS[0],
    loads: [
      { watts: 100, hoursPerDay: 8, qty: 6 },
      { watts: 750, hoursPerDay: 4, qty: 1, inductive: true },
      { watts: 40, hoursPerDay: 12, qty: 10 },
    ],
    autonomyDays: 1, pshHours: 4.0, batteryPreference: 'LiFePO4',
    rows: 2, railLengthMm: 4850, panelSpacingMm: 20, mountType: 'roof', orientation: 'portrait',
  }, CANDIDATES);
  // Load analysis: 1750 W running, 2500 W surge (the pump counted twice)
  assert.equal(r.runningW, 1750);
  assert.equal(r.surgeW, 2500);
  assert.equal(Math.ceil(r.requiredContinuousW ?? 0), 2188);
  assert.equal(r.inverter?.model, 'SNV-GH3041');
  assert.equal(r.inverter?.qty, 1);
  // 48 V lithium bank, 4 strings of 1
  assert.equal(r.battery?.model, 'LIP48100LF');
  assert.equal(r.battery?.qty, 4);
  assert.equal(r.battery?.series, 1);
  assert.equal(r.battery?.parallel, 4);
  assert.equal(Number(r.battery?.usableKwh.toFixed(2)), 19.20);
  assert.equal(r.numPanels, 40);
  assert.equal(qtyOf(r.lines, 'rail'), 12);
  assert.equal(qtyOf(r.lines, 'rail_joint'), 8);
  assert.equal(qtyOf(r.lines, 'mid_clamp'), 76);
  assert.equal(qtyOf(r.lines, 'solar_cable'), 240);
  assert.equal(qtyOf(r.lines, 'mc4_pair'), 8);
  assert.equal(qtyOf(r.lines, 'combiner_box'), 1);
  assert.equal(qtyOf(r.lines, 'dc_breaker'), 1);
  assert.equal(qtyOf(r.lines, 'ac_distribution'), 1);
});

test('v7 parity — off-grid, lead-acid, 2 days autonomy', () => {
  const r = calculateSystem({
    systemType: 'off-grid', panel: V7_PANELS[1],
    loads: [
      { watts: 1500, hoursPerDay: 2, qty: 1, inductive: true },
      { watts: 200, hoursPerDay: 10, qty: 3 },
    ],
    autonomyDays: 2, pshHours: 3.5, batteryPreference: 'Lead-Acid',
    rows: 1, railLengthMm: 3600, panelSpacingMm: 15, mountType: 'roof', orientation: 'portrait',
  }, CANDIDATES);
  assert.equal(r.runningW, 2100);
  assert.equal(r.surgeW, 3600);
  assert.equal(Math.ceil(r.requiredContinuousW ?? 0), 2625);
  assert.equal(r.inverter?.model, 'SNV-GH3041');
  // 12 V lead-acid: 4 in series for the 48 V bus, 8 strings for the energy
  assert.equal(r.battery?.model, 'LIP12100D');
  assert.equal(r.battery?.series, 4);
  assert.equal(r.battery?.parallel, 8);
  assert.equal(r.battery?.qty, 32);
  assert.equal(Number(r.battery?.usableKwh.toFixed(2)), 38.40);
  assert.equal(r.numPanels, 17);
  assert.equal(qtyOf(r.lines, 'rail'), 8);
  assert.equal(qtyOf(r.lines, 'rail_joint'), 6);
  assert.equal(qtyOf(r.lines, 'end_clamp'), 4);
  assert.equal(qtyOf(r.lines, 'mid_clamp'), 32);
  assert.equal(qtyOf(r.lines, 'grounding_lug'), 2);
  assert.equal(qtyOf(r.lines, 'solar_cable'), 102);
});

test('v7 parity — hybrid, small lithium system', () => {
  const r = calculateSystem({
    systemType: 'hybrid', panel: V7_PANELS[0],
    loads: [{ watts: 60, hoursPerDay: 6, qty: 4 }],
    autonomyDays: 0.5, pshHours: 4.5, batteryPreference: 'LiFePO4',
    rows: 1, railLengthMm: 4850, panelSpacingMm: 20, mountType: 'roof', orientation: 'portrait',
  }, CANDIDATES);
  assert.equal(r.runningW, 240);
  assert.equal(r.surgeW, 240);
  assert.equal(r.inverter?.model, 'SNV-GH2041');      // smallest that fits
  assert.equal(r.battery?.qty, 1);
  assert.equal(Number(r.battery?.usableKwh.toFixed(2)), 4.80);
  assert.equal(r.numPanels, 4);
  assert.equal(qtyOf(r.lines, 'rail'), 2);
  assert.equal(qtyOf(r.lines, 'rail_joint'), 0, 'one rail per line needs no splice');
  assert.equal(qtyOf(r.lines, 'mid_clamp'), 6);
  assert.equal(qtyOf(r.lines, 'solar_cable'), 24);
  assert.equal(qtyOf(r.lines, 'mc4_pair'), 4);
  assert.equal(r.warnings.length, 0, 'a one-string array raises nothing');
});

// ── Guards the calculator has, kept honest ─────────────────────────────────
test('a load inside the biggest unit takes ONE inverter, not several', () => {
  // 12 kW running → 15 kW continuous required. v7's database has a 30 kW
  // 384 V hybrid, so a single unit carries it — parallelling would be wrong.
  const r = calculateSystem({
    systemType: 'off-grid', panel: V7_PANELS[4],
    loads: [{ watts: 12000, hoursPerDay: 8, qty: 1 }],
    autonomyDays: 1, pshHours: 4, batteryPreference: 'LiFePO4',
    rows: 4, railLengthMm: 4850, panelSpacingMm: 20, mountType: 'ground', orientation: 'portrait',
  }, CANDIDATES);
  assert.equal(r.ok, true);
  assert.equal(r.inverter?.model, 'SNV-GHT30071');
  assert.equal(r.inverter?.qty, 1);
  // 384 V bus from 48 V blocks: eight in series
  assert.equal(r.battery?.series, 8);
});

test('a load beyond the biggest unit parallels rather than failing', () => {
  const r = calculateSystem({
    systemType: 'off-grid', panel: V7_PANELS[4],
    loads: [{ watts: 40000, hoursPerDay: 8, qty: 1 }],
    autonomyDays: 1, pshHours: 4, batteryPreference: 'LiFePO4',
    rows: 4, railLengthMm: 4850, panelSpacingMm: 20, mountType: 'ground', orientation: 'portrait',
  }, CANDIDATES);
  assert.equal(r.ok, true);
  // 50 kW continuous required against a 30 kW unit → two in parallel
  assert.equal(r.inverter?.qty, 2);
  assert.equal(qtyOf(r.lines, 'dc_breaker'), 2, 'a breaker per inverter');
});

test('no inverter fits the grid connection → a plain error, no BoM', () => {
  const r = calculateSystem({
    systemType: 'on-grid', panel: V7_PANELS[0], gridVA: 900, gridPhase: 1, dcAcRatio: 1.2,
    rows: 1, railLengthMm: 4850, panelSpacingMm: 20, mountType: 'roof', orientation: 'portrait',
  }, CANDIDATES);
  assert.equal(r.ok, false);
  assert.equal(r.lines.length, 0);
  assert.match(r.errors.join(' '), /No suitable inverter/);
});

test('an empty load table is refused, not silently sized', () => {
  const r = calculateSystem({
    systemType: 'off-grid', panel: V7_PANELS[0], loads: [], autonomyDays: 1, pshHours: 4,
    rows: 1, railLengthMm: 4850, panelSpacingMm: 20, mountType: 'roof', orientation: 'portrait',
  }, CANDIDATES);
  assert.equal(r.ok, false);
  assert.match(r.errors.join(' '), /at least one load/i);
});

test('lithium requested but only lead-acid stocked → falls back and says so', () => {
  const r = calculateSystem({
    systemType: 'off-grid', panel: V7_PANELS[0],
    loads: [{ watts: 200, hoursPerDay: 5, qty: 1 }],
    autonomyDays: 1, pshHours: 4, batteryPreference: 'LiFePO4',
    rows: 1, railLengthMm: 4850, panelSpacingMm: 20, mountType: 'roof', orientation: 'portrait',
  }, { ...CANDIDATES, batteries: V7_BATTERIES.filter((b) => b.battery_type.includes('Lead-Acid')) });
  assert.equal(r.ok, true);
  assert.ok(r.warnings.some((w) => /fell back to lead-acid/i.test(w)));
});
