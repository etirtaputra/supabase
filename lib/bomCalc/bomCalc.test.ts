/**
 * Golden tests for the BOM calculator, read out of the Hon Chuan R1 workbook
 * (2026-10). Where the workbook is right, the engine must give its numbers;
 * where it was wrong, the test pins the corrected number and says why.
 * Never change a number here to make a build pass.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { calculateDc, stringVdPct, autoPvSize, type ModuleSpec, type InverterGroup, type RoofRun } from './dc.ts';
import { calculateAc, type AcSegment } from './ac.ts';
import { priceBom, type BomRow } from './bom.ts';
import { acResistance } from './cables.ts';
import { computeBomCalc, newBomCalcDoc } from './index.ts';
import { linkedRow, typedRow } from './template.ts';

// TRINA TSM-725NEG21C.20 as it stands in the catalogue (3.0_components.specifications).
const TRINA_725: ModuleSpec = { model: 'TRINA TSM-725NEG21C.20', wp: 725, vocV: 49.6, vmpV: 41.5, iscA: 18.54, impA: 17.47, tempCoeffVocPct: -0.24, maxSystemV: 1500 };
const HUAWEI_330 = { model: 'SUN2000-330KTL-H1', acKw: 330, acVoltageV: 800, acCurrentA: 238.2, maxDcV: 1500, mpptMinV: 500, mpptMaxV: 1500, mppts: 6, stringsPerMppt: 5, maxIscPerMpptA: 120 };
const groups: InverterGroup[] = [{ id: 'g1', label: 'INV 1–9', inverter: HUAWEI_330, count: 9, stringsEach: 20, modulesPerString: 27 }];
const roof = (label: string, distanceM: number, strings: number, runM: number, size: 4 | 6): RoofRun =>
  ({ id: label, label, strings, modulesPerString: null, distanceM, runM, size });

// 'Kabel DC' rows 5–12, without the row-12 ghost (18 strings already counted on 4 mm²).
const HC_ROOFS: RoofRun[] = [
  roof('Oil Grinder', 340, 13, 56, 6), roof('Loading', 245, 19, 45, 6),
  roof('Packaging Barat', 175, 32, 78, 6), roof('Packaging Timur', 162, 34, 76, 6),
  roof('Factory Barat 2', 114, 22, 52, 4), roof('Factory Barat 1', 88, 20, 44, 4),
  roof('Factory Timur 1', 62, 20, 44, 4), roof('Factory Timur 2', 38, 20, 43, 4),
];

test('Hon Chuan DC cable: the workbook\'s own per-roof rule, without its double-counted roof', () => {
  const r = calculateDc(TRINA_725, groups, HC_ROOFS, { slackPct: 0, jumpersPerString: 2 });
  assert.equal(r.strings, 180);
  assert.equal(r.modules, 4860);
  assert.equal(r.wp, 3_523_500);
  assert.equal(r.cableBySize[4], 20_064, "= 'Kabel DC'!I14");
  assert.equal(r.cableBySize[6], 53_692, "'Kabel DC'!N14 was 57,652 — 3,960 m of it re-cabled row 12's 18 strings on 6 mm²");
  assert.equal(r.connectorsBySize[6], 294, "= 'Kabel DC'!B25");
  assert.equal(r.connectorsBySize[4], 246, "'Kabel DC'!B21 was 540 — it counted all 180 strings as 4 mm², not the 82 that are");
  assert.equal(r.checks.filter((c) => c.level === 'error').length, 0);
});

test('Roofs must cable every inverter string exactly once', () => {
  const ghost = [...HC_ROOFS, roof('Factory Timur 2 (again)', 88, 18, 22, 6)];
  const r = calculateDc(TRINA_725, groups, ghost);
  assert.ok(r.checks.some((c) => c.level === 'error' && /198 strings; the inverters take 180/.test(c.message)));
});

test("The engineers' 4 % rule: 18 × 41.4 V, 14.99 A — 4 mm² to 195 m one way, then 6 mm²", () => {
  const m: ModuleSpec = { ...TRINA_725, vmpV: 41.4, impA: 14.99 };
  assert.ok((stringVdPct(m, 18, 4, 390) as number) <= 4);
  assert.ok((stringVdPct(m, 18, 4, 392) as number) > 4);
  assert.equal(autoPvSize(m, 18, 390, 4), 4);
  assert.equal(autoPvSize(m, 18, 392, 4), 6);
  assert.equal(autoPvSize(m, 18, 586, 4), 6);   // 293 m one way
  assert.equal(autoPvSize(m, 18, 590, 4), 10);
});

test('Cold string voltage: 27 × Trina 725 at 18 °C against 1500 V', () => {
  const r = calculateDc(TRINA_725, groups, HC_ROOFS);
  assert.equal(r.vocColdV, 1361.7);    // 49.6 × (1 − 0.24 % × (18 − 25)) × 27
  const long = calculateDc(TRINA_725, [{ ...groups[0], modulesPerString: 30 }], []);
  assert.ok(long.checks.some((c) => c.level === 'error' && /above the 1500 V limit/.test(c.message)));
});

test("Hon Chuan AC lengths: 'Kabel AC'!E7 = 308.25 m inverter cable, C13 feeder = 151 m × 3 × 5", () => {
  const base: Omit<AcSegment, 'id' | 'label' | 'circuits' | 'lengthM'> = {
    tailM: 0, currentA: 238.2, voltageV: 800, powerFactor: 0.9, cableType: 'NYY', sizeMm2: 185, runs: 1, neutrals: 0,
    ampacityA: 511, k1: 0.94, k2: 1, k3: 1, pe: { cableType: 'NYA', sizeMm2: 95, count: 1 }, reactanceOhmKm: 0.08,
  };
  const r = calculateAc([
    { ...base, id: 'a', label: '5 inverters', circuits: 5, lengthM: 18 - 5 * 1.25 },
    { ...base, id: 'b', label: '4 inverters', circuits: 4, lengthM: 16 - 4 * 1.25 },
    { ...base, id: 'feeder', label: 'Feeder', circuits: 1, lengthM: 151, currentA: 9 * 238.2, sizeMm2: 300, runs: 5, ampacityA: 587, k1: 0.91, pe: null },
  ]);
  assert.equal(r.segments[0].phaseM + r.segments[1].phaseM, 308.25);
  assert.equal(r.segments[2].phaseM, 2265);
  // 5 × 587 A × 0.91 = 2,670.85 A against 1.25 × 2,143.8 = 2,679.75 A — the
  // workbook typed "sufficient"; it is 0.3 % short.
  assert.equal(r.segments[2].capacityA, 2670.85);
  assert.ok(r.checks.some((c) => c.level === 'error' && c.where === 'Feeder'));
  assert.equal(r.lugsBySize[185], 9 * 3 * 2 + 2);
});

test('AC voltage drop uses X·sinφ (the sheets left sinφ out)', () => {
  assert.ok(Math.abs((acResistance('al', 120, 90) as number) - 0.3244) < 0.0005, 'NA2XY 120 at 90 °C ≈ the 0.325 Ω/km the sheet used');
  const r = calculateAc([{ id: 'x', label: 'x', circuits: 1, lengthM: 20, tailM: 0, currentA: 238.2, voltageV: 800, powerFactor: 0.9,
    cableType: 'NA2XY', sizeMm2: 120, runs: 1, neutrals: 0, ampacityA: 368, k1: 0.94, k2: 1, k3: 1, pe: null, reactanceOhmKm: 0.082 }]);
  assert.equal(r.segments[0].vdPct, 0.42);
});

test("BOM row arithmetic = Hon Chuan row 6, and a permit row priced from its cost (row 131's Rp 250 m was typed)", () => {
  const row = (over: Partial<BomRow>): BomRow => ({ ...typedRow('x', 'x', 'pcs', 1), ...over });
  const { rows, totals } = priceBom([
    row({ qty: { mode: 'typed', value: 4860 }, cost: 1_600_000, margin: 0.12, install: 85_000 }),
    row({ cost: 25_000_000, margin: 0.11 }),
  ], {}, { defaultMargin: 0.11, plantWp: 3_523_500, ppnPct: 11 });
  assert.equal(rows[0].materialUnit, 1_818_181.82);
  assert.equal(rows[0].total, 9_249_463_645.2);   // J6 = 9,249,463,636 (unrounded unit)
  assert.equal(rows[1].total, 28_089_887.64);
  assert.equal(totals.total, rows[0].total + rows[1].total);
});

test('A quantity with installation but no material price is flagged (Hon Chuan tray rows 74–75)', () => {
  const tray: BomRow = { ...typedRow('raceway', 'HDG cable tray', 'm', 1159), install: 20_000 };
  const { checks } = priceBom([tray], {}, { defaultMargin: 0.11, plantWp: 1, ppnPct: 11 });
  assert.ok(checks.some((c) => c.level === 'warn' && /material is not/.test(c.message)));
  const { checks: c2 } = priceBom([{ ...tray, install: null }], {}, { defaultMargin: 0.11, plantWp: 1, ppnPct: 11 });
  assert.ok(c2.some((c) => c.tag === 'unpriced' && /Not priced yet/.test(c.message)));
});

test('A link to a value the calculation does not produce is an error, never a silent zero', () => {
  const { checks, rows } = priceBom([{ ...linkedRow('x', 'Cable', 'm', 'dc.cable.7'), cost: 1000 }], { 'dc.cable.6': 10 }, { defaultMargin: 0.1, plantWp: 1, ppnPct: 11 });
  assert.equal(rows[0].qty, 0);
  assert.ok(checks.some((c) => c.level === 'error' && /dc\.cable\.7/.test(c.message)));
});

test('The full document: linked rows follow the design, and a copper row on an aluminium design is caught', () => {
  const doc = newBomCalcDoc();
  doc.module = { ...TRINA_725, componentId: null };
  doc.inverterGroups = groups.map((g) => ({ ...g, componentId: null }));
  doc.roofs = HC_ROOFS;
  const res = computeBomCalc(doc);
  assert.equal(res.values['pv.modules'], 4860);
  assert.equal(res.values['dc.cable.6'], 53_692);
  const modRow = res.rows.find((r) => r.id === doc.rows[0].id);
  assert.equal(modRow?.qty, 4860);

  const feeder = doc.acSegments.find((s) => s.id === 'feeder')!;
  feeder.cableType = 'NA2XY';
  const row = doc.rows.find((r) => r.qty.mode === 'link' && r.qty.key === 'ac.seg.feeder.phase')!;
  row.description = 'AC cable AC Combiner to Interconnection : NYY 1Cx300';
  const res2 = computeBomCalc(doc);
  assert.ok(res2.checks.some((c) => c.level === 'error' && /says NYY but the design uses NA2XY/.test(c.message)));
});

import { bomExportHtml } from './exportHtml.ts';

test('The export carries no cost or margin, and its total is the screen total', () => {
  const doc = newBomCalcDoc();
  doc.module = { ...TRINA_725, componentId: null };
  doc.inverterGroups = groups.map((g) => ({ ...g, componentId: null }));
  doc.roofs = HC_ROOFS;
  doc.rows[0].cost = 1_600_000; doc.rows[0].margin = 0.12; doc.rows[0].install = 85_000;
  const res = computeBomCalc(doc);
  const html = bomExportHtml(doc, res, 'Test');
  assert.ok(!/1,600,000/.test(html), 'the cost never reaches the customer file');
  assert.ok(html.includes((9_249_463_645.2).toLocaleString('en-US', { maximumFractionDigits: 0 })));
  assert.ok(!/Margin/i.test(html));
});

import { moduleFromSpecs, inverterFromSpecs, specRange } from './specs.ts';

test('Catalogue specs arrive as text and are read as numbers, or left unknown', () => {
  const m = moduleFromSpecs('TRINA TSM-725NEG21C.20', { power_stc_w: '725', voc_stc_v: '49.6', vmp_stc_v: '41.5', isc_stc_a: '18.54', imp_stc_a: '17.47', temp_coeff_voc_percent_per_c: '-0.24', max_system_voltage_vdc: '1500' });
  assert.deepEqual(m, TRINA_725);
  const inv = inverterFromSpecs('SNV-GT8033QT', { rated_output_power_kw: '80', nominal_ac_voltage_vac: '400 3L+N+PE', max_output_current_a: '127.5', pv_max_voltage_vdc: '1100', pv_mppt_voltage_range_vdc: '200-1000', no_of_mppts: '4', strings_per_mppt: '3', max_short_circuit_current_per_mppt_a: '60' });
  assert.equal(inv.acVoltageV, 400);
  assert.equal(inv.mpptMinV, 200);
  assert.equal(inv.mpptMaxV, 1000);
  assert.equal(inv.maxIscPerMpptA, 60);
  assert.deepEqual(specRange('200~1500'), [200, 1500]);
  assert.equal(inverterFromSpecs('x', {}).maxDcV, null);
});
