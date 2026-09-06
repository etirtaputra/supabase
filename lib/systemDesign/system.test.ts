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
import { calculateSystem, sizePvStrings, vocAtTemp, voltageClassOf, seriesOnBus, isChemistry, type SystemInput, type BatterySpec, type PanelSpec } from './system.ts';
import { V7_PANELS, V7_ON_GRID_INVERTERS, V7_HYBRID_INVERTERS, V7_BATTERIES } from './v7Fixture.ts';

const CANDIDATES = {
  onGridInverters: V7_ON_GRID_INVERTERS,
  hybridInverters: V7_HYBRID_INVERTERS,
  batteries: V7_BATTERIES,
};

/**
 * v7 sizes strings on a FLAT 0.95 of the inverter maximum. ICA's engine moved
 * to temperature-corrected Voc on 2026-09-06 (owner's decision), so these
 * parity tests pass the flat rule EXPLICITLY: their job is to prove the port
 * still matches the original calculator, not to describe current practice.
 * Without this they would pass only by accident, because v7's fixture happens
 * to carry no temperature coefficients.
 */
const V7_RULE = { vocRule: 'flat' as const };

const qtyOf = (lines: { role: string; qty: number }[], role: string) =>
  lines.filter((l) => l.role === role).reduce((s, l) => s + l.qty, 0);

test('v7 parity — on-grid 5500 VA single phase, DC/AC 1.2', () => {
  const input: SystemInput = {
    systemType: 'on-grid', panel: V7_PANELS[0],          // ICA100-36M
    gridVA: 5500, gridPhase: 1, dcAcRatio: 1.2,
    rows: 2, railLengthMm: 4850, panelSpacingMm: 20, mountType: 'roof', orientation: 'portrait',
  };
  const r = calculateSystem(input, CANDIDATES, V7_RULE);
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
  }, CANDIDATES, V7_RULE);
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
  }, CANDIDATES, V7_RULE);
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
  }, CANDIDATES, V7_RULE);
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
  }, CANDIDATES, V7_RULE);
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


// ─────────────────────────────────────────────────────────────────────────────
// Battery bank correctness — three defects found 2026-09-05 while writing the
// MANDA knowledge pack. v7's own fixture (12 V lead-acid, 48 V lithium) hides
// all three because those voltages divide evenly and its chemistry strings
// happen to match the code's casing. ICAPROC's real catalogue does neither.
// ─────────────────────────────────────────────────────────────────────────────

const OFFGRID = {
  systemType: 'off-grid' as const, panel: V7_PANELS[0], autonomyDays: 1, pshHours: 4,
  rows: 1, railLengthMm: 4850, panelSpacingMm: 20, mountType: 'roof' as const, orientation: 'portrait' as const,
  loads: [{ watts: 1000, hoursPerDay: 5, qty: 1 }],
};
const inv48 = { model: 'X-5K/48', rated_output_power_w: 5000, battery_nominal_voltage_vdc: 48, surge_power_va: 10000, pv_max_open_circuit_voltage_vdc: 500, no_of_mpp_trackers: 2 };
const batt = (model: string, battery_type: string, nominal_voltage_v: number, energy_wh: number): BatterySpec =>
  ({ model, battery_type, nominal_voltage_v, energy_wh });

test('a pack reads its bus CLASS, so 51.2 V and 48 V are one bank', () => {
  assert.equal(voltageClassOf(48), 48);
  assert.equal(voltageClassOf(51.2), 48);      // 16S LiFePO4
  assert.equal(voltageClassOf(25.6), 24);      // 8S
  assert.equal(voltageClassOf(12.8), 12);      // 4S
  assert.equal(voltageClassOf(409.6), 384);    // 128S
  // Nothing standard is not silently coerced into something standard.
  assert.equal(voltageClassOf(30), null);
  assert.equal(voltageClassOf(0), null);
  assert.equal(voltageClassOf(null), null);
});

test('series on a bus is a whole number of packs, or no answer at all', () => {
  assert.equal(seriesOnBus(48, 12), 4);
  assert.equal(seriesOnBus(48, 24), 2);
  assert.equal(seriesOnBus(48, 51.2), 1);      // the literal 51.2 V row
  assert.equal(seriesOnBus(384, 48), 8);
  assert.equal(seriesOnBus(48, 36), null);     // 1.333 was never an answer
  assert.equal(seriesOnBus(24, 48), null);     // a bigger pack than the bus
});

test('chemistry matching is case-insensitive — the live catalogue says "Lead-acid"', () => {
  assert.equal(isChemistry('Lead-Acid (Deep Cycle)', false), true);   // v7 fixture
  assert.equal(isChemistry('Lead-acid (deep cycle)', false), true);   // ICAPROC
  assert.equal(isChemistry('LiFePO4 (with BMS)', true), true);
  assert.equal(isChemistry('LiFePO4', true), true);
  assert.equal(isChemistry('Lead-acid (deep cycle)', true), false);
  assert.equal(isChemistry(null, true), false);
});

test('REGRESSION: a 25.6 V pack on a 48 V bus quoted 3.75 batteries', () => {
  const r = calculateSystem({ ...OFFGRID, batteryPreference: 'LiFePO4' }, {
    hybridInverters: [inv48],
    batteries: [batt('25.6V pack', 'LiFePO4', 25.6, 2560)],
  });
  assert.equal(r.ok, true);
  assert.equal(r.battery?.series, 2, 'two packs in series make the 48 V bus');
  assert.ok(Number.isInteger(r.battery?.qty ?? 0.5), 'a quote can never carry a fraction of a battery');
  assert.equal(r.battery?.qty, 4);
});

test('REGRESSION: the 51.2 V row the catalogue types literally still banks', () => {
  const r = calculateSystem({ ...OFFGRID, batteryPreference: 'LiFePO4' }, {
    hybridInverters: [inv48],
    batteries: [batt('EPEVER LR51100A 51.2V/100Ah', 'LiFePO4', 51.2, 5120)],
  });
  assert.equal(r.ok, true);
  assert.equal(r.battery?.series, 1);
  assert.deepEqual(r.errors, []);
});

test('REGRESSION: a 24 V lithium system is designable — the bus list was hard-coded', () => {
  const r = calculateSystem({ ...OFFGRID, loads: [{ watts: 300, hoursPerDay: 4, qty: 1 }], batteryPreference: 'LiFePO4' }, {
    hybridInverters: [{ model: 'EPEVER QI1522 1500W/24V', rated_output_power_w: 1500, battery_nominal_voltage_vdc: 24, surge_power_va: 3000, pv_max_open_circuit_voltage_vdc: 400, no_of_mpp_trackers: 1 }],
    batteries: [batt('EPEVER LW25205A 25.6V/205Ah', 'LiFePO4', 24, 5248)],
  });
  assert.equal(r.ok, true);
  assert.equal(r.inverter?.model, 'EPEVER QI1522 1500W/24V');
  assert.equal(r.battery?.series, 1);
});

test('REGRESSION: a lead-acid design picks lead-acid, not whatever is first in the list', () => {
  const r = calculateSystem({ ...OFFGRID, batteryPreference: 'Lead-Acid' }, {
    hybridInverters: [inv48],
    batteries: [
      batt('ICAL LIP48100LF 48V LiFePO4', 'LiFePO4 (with BMS)', 48, 4800),   // first, and wrong
      batt('ICAL LIP12200D 12V', 'Lead-acid (deep cycle)', 12, 2400),
    ],
  });
  assert.equal(r.battery?.model, 'ICAL LIP12200D 12V');
  assert.equal(r.battery?.series, 4);
});

test('a pack that cannot build the bus is refused, never rounded into place', () => {
  const r = calculateSystem({ ...OFFGRID, batteryPreference: 'LiFePO4' }, {
    hybridInverters: [inv48],
    batteries: [batt('38.4V pack', 'LiFePO4', 38.4, 3840)],
  });
  assert.equal(r.ok, false);
  assert.match(r.errors.join(' '), /whole number of units in series|no .*battery/i);
});


// ─────────────────────────────────────────────────────────────────────────────
// Temperature-corrected Voc (owner's decision, 2026-09-06 — engine version 8).
//
// v7 sized every module on a flat 0.95 of the inverter maximum. That single
// factor is equivalent to designing for 3–9 °C depending on the module's β,
// which is conservative for Indonesian lowlands — so correcting properly
// generally makes strings LONGER, and the engine says so when it does.
// ─────────────────────────────────────────────────────────────────────────────

// The real catalogue's Trina TSM-620NEG19RC.20: 49.6 Voc, β −0.24 %/°C.
const TRINA: PanelSpec = {
  model: 'TRINA TSM-620NEG19RC.20', power_stc_w: 620, voc_stc_v: 49.6,
  temp_coeff_voc_percent_per_c: -0.24, dimensions_l_w_h_mm: '2382 x 1134 x 30',
};
// The real catalogue's JINKO, which carries Voc but NO temperature coefficient.
const JINKO: PanelSpec = {
  model: 'JINKO JKM575N-72HL4-V', power_stc_w: 575, voc_stc_v: 50.88,
  dimensions_l_w_h_mm: '2278 x 1134 x 35',
};
const INV_1000V = { model: 'INV-1000', rated_output_power_kw: 10, nominal_ac_voltage_vac: '400 3L',
  pv_max_voltage_vdc: 1000, no_of_mppts: 4, strings_per_mppt: 2 };

test('Voc rises as the module cools, by its own coefficient', () => {
  // At STC nothing moves.
  assert.equal(Number(vocAtTemp(49.6, -0.24, 25).toFixed(4)), 49.6);
  // 18 °C is 7 K below STC: 49.6 × (1 + 0.0024 × 7) = 50.43 V
  assert.equal(Number(vocAtTemp(49.6, -0.24, 18).toFixed(2)), 50.43);
  // A cold highland dawn at 0 °C: 49.6 × (1 + 0.0024 × 25) = 52.58 V
  assert.equal(Number(vocAtTemp(49.6, -0.24, 0).toFixed(2)), 52.58);
  // Above STC it falls.
  assert.ok(vocAtTemp(49.6, -0.24, 45) < 49.6);
});

test('the default rule corrects to the site temperature, not a flat margin', () => {
  const r = sizePvStrings(TRINA, INV_1000V, 40, 'on-grid');
  assert.equal(r.rule, 'temperature');
  assert.equal(r.minCellTempC, 18);
  assert.equal(Number(r.vocAtMinTempV?.toFixed(2)), 50.43);
  // floor(1000 / 50.43) = 19
  assert.equal(r.maxSeriesLength, 19);
  // v7's flat rule: floor(1000 × 0.95 / 49.6) = 19 as well, for this module.
  assert.equal(r.flatRuleMaxSeriesLength, 19);
});

test('a colder site shortens the string — lower is always the safe direction', () => {
  const highland = sizePvStrings(TRINA, INV_1000V, 40, 'on-grid', { minCellTempC: 0 });
  assert.equal(Number(highland.vocAtMinTempV?.toFixed(2)), 52.58);
  assert.equal(highland.maxSeriesLength, 19 - 0, 'floor(1000/52.58) = 19');
  const arctic = sizePvStrings(TRINA, INV_1000V, 40, 'on-grid', { minCellTempC: -20 });
  assert.ok(arctic.maxSeriesLength < highland.maxSeriesLength, 'colder must never lengthen a string');
});

test('a warmer site lengthens it, and the engine says so out loud', () => {
  const warm = sizePvStrings(TRINA, INV_1000V, 40, 'on-grid', { minCellTempC: 25 });
  assert.equal(warm.maxSeriesLength, 20, 'floor(1000/49.6) = 20 at STC');
  assert.ok(warm.maxSeriesLength > warm.flatRuleMaxSeriesLength);
  assert.ok(warm.warnings.some((w) => /above the 19 the old flat margin allowed/.test(w)),
    'a string longer than the old rule is visible on review, never silent');
});

test('a module with no temperature coefficient falls back to the flat rule AND says so', () => {
  const r = sizePvStrings(JINKO, INV_1000V, 40, 'on-grid');
  assert.equal(r.rule, 'flat');
  assert.equal(r.vocAtMinTempV, null);
  assert.equal(r.minCellTempC, null);
  assert.equal(r.maxSeriesLength, r.flatRuleMaxSeriesLength);
  assert.ok(r.warnings.some((w) => /no Temp Coeff\. Voc on file/.test(w)),
    'sizing on the old margin is never silent — it names the missing spec');
});

test('the flat rule stays available and reproduces v7 exactly', () => {
  const flat = sizePvStrings(TRINA, INV_1000V, 40, 'on-grid', { vocRule: 'flat' });
  assert.equal(flat.rule, 'flat');
  assert.equal(flat.maxSeriesLength, Math.floor(1000 * 0.95 / 49.6));
  assert.equal(flat.warnings.length, 0);
});

test('the site temperature travels on the design input, so a quote records it', () => {
  const r = calculateSystem({
    systemType: 'on-grid', panel: TRINA, gridVA: 23000, gridPhase: 3, dcAcRatio: 1.2,
    minCellTempC: 5,
    rows: 2, railLengthMm: 4850, panelSpacingMm: 20, mountType: 'roof', orientation: 'portrait',
  }, { onGridInverters: [INV_1000V] });
  assert.equal(r.ok, true);
  assert.equal(r.strings?.minCellTempC, 5);
  assert.equal(r.strings?.rule, 'temperature');
});
