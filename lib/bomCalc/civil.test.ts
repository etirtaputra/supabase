/**
 * Civil works and O&M — tests of the recipes recorded from the 2026-10
 * workbooks (docs/epc-bom/WORKBOOK_STUDY.md §2–3), on the quantities the
 * study records: the 3,008 m lifeline of one 8 MWp job, a 969 m walkway, the
 * 3,523.5 kWp rooftop's cleaning visits and its 17-year O&M at Rp 195 m a year.
 *
 * The workbooks were not available to the thread that wrote these, so the
 * numbers are the recorded rules applied to the recorded quantities, not
 * cells read off the sheets. Prices here are test inputs. Never change a
 * number to make a build pass.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { calculateCivil, newCivilDoc, type CivilDoc } from './civil.ts';
import { computeBomCalc, newBomCalcDoc, linkOptions, type BomCalcDoc } from './index.ts';
import { explainKey, unusedKeys, isCostKey } from './links.ts';
import { priceBom } from './bom.ts';
import { linkedRow } from './template.ts';

const area = (label: string, over: Partial<{ walkwayM: number; lifelineM: number; pipeM: number }>) =>
  ({ id: label, label, walkwayM: 0, lifelineM: 0, pipeM: 0, ...over });
const INP = { inverters: 9, plantWp: 3_523_500 };

test('Lifeline 3,008 m: anchors from the length, and the cost per metre over the SAME metres', () => {
  const cv = newCivilDoc();
  cv.areas = [area('Roof 1', { lifelineM: 3008 })];
  cv.settings = { ...cv.settings, lifelineWireCostPerM: 100_000, lifelineEndAnchorCost: 750_000, lifelineIntAnchorCost: 250_000 };
  const r = calculateCivil(cv, INP);
  assert.equal(r.endAnchors, 101, 'ROUNDUP(3,008 ÷ 30)');
  assert.equal(r.intAnchors, 401, 'ROUNDUP(3,008 ÷ 6) − 101');
  assert.equal(r.lifelineM, 3038.08, '× 1.01');
  assert.equal(r.lifelineCost, 479_808_000);
  // The sheet divided a 3,008 m cost by 4,361 m. Here qty × cost per metre
  // gives back the recipe's cost (to the rupiah rounding of the unit price).
  assert.ok(Math.abs((r.lifelineCostPerM as number) * r.lifelineM - 479_808_000) < 100);
});

test('Walkway 969 m: panels of 2.4 m and supports — the BOM row reads the metres, never left blank', () => {
  const doc = newBomCalcDoc();
  doc.civil!.areas = [area('Roof 1', { walkwayM: 969 })];
  doc.civil!.settings = { ...doc.civil!.settings, walkwayPanelCost: 900_000, walkwaySupportCost: 150_000 };
  const res = computeBomCalc(doc);
  assert.equal(res.civil.walkwayM, 978.69);
  assert.equal(res.civil.walkwayPanels, 408, 'ROUNDUP(978.69 ÷ 2.4)');
  assert.equal(res.civil.walkwaySupports, 816);
  const row = doc.rows.find((x) => x.description.startsWith('Steel walkway'))!;
  const p = res.rows.find((x) => x.id === row.id)!;
  assert.equal(p.qty, 978.69);
  assert.ok(Math.abs(p.costTotal - (408 * 900_000 + 816 * 150_000)) < 100, 'the row costs exactly the recipe');

  doc.rows = doc.rows.filter((x) => x.id !== row.id);
  assert.ok(unusedKeys(doc, computeBomCalc(doc).values).includes('civil.walkway.m'));
});

test('Cleaning: one visits figure drives what is sold and what is costed', () => {
  const doc = newBomCalcDoc();
  doc.module = { model: 'M', wp: 725, vocV: 49.6, vmpV: 41.5, iscA: 18.54, impA: 17.47, tempCoeffVocPct: -0.24, maxSystemV: 1500, componentId: null };
  doc.inverterGroups = [{ id: 'g', label: 'INV', count: 9, stringsEach: 20, modulesPerString: 27, componentId: null,
    inverter: { model: 'I', acKw: 330, acVoltageV: 800, acCurrentA: 238.2, maxDcV: 1500, mpptMinV: 500, mpptMaxV: 1500, mppts: 6, stringsPerMppt: 5, maxIscPerMpptA: 120 } }];
  const om = doc.civil!.om;
  om.settings = { includedYears: 3, escalationPct: 0, contractYears: 0 };
  om.items = om.items.map((i) => (i.id === 'cleaning' ? { ...i, rate: 2, visitsPerYear: 4 } : i));
  const res = computeBomCalc(doc);
  const row = doc.rows.find((x) => x.costKey === 'om.cleaning.perYear')!;
  const p = res.rows.find((x) => x.id === row.id)!;
  assert.equal(p.qty, 3, 'years in the price');
  assert.equal(p.costTotal, 84_564_000, '2 Rp/Wp × 3,523,500 Wp × 4 visits × 3 years');
  assert.equal(res.values['om.cleaning.visits'], 12);

  om.items = om.items.map((i) => (i.id === 'cleaning' ? { ...i, visitsPerYear: 2 } : i));
  const half = computeBomCalc(doc).rows.find((x) => x.id === row.id)!;
  assert.equal(half.costTotal, 42_282_000);
  assert.ok(Math.abs(half.total - p.total / 2) < 0.02, 'the selling price follows the same visits (to the cent of a rounded unit price)');
});

test('O&M escalation, and a separate contract that starts after the included years (17 years at Rp 195 m)', () => {
  const cv: CivilDoc = newCivilDoc();
  cv.om.items = [{ id: 'om', label: 'O&M', basis: 'year', rate: 195_000_000, visitsPerYear: 0 }];
  cv.om.settings = { includedYears: 0, escalationPct: 0, contractYears: 17 };
  assert.deepEqual(calculateCivil(cv, INP).om.contract, { fromYear: 1, toYear: 17, firstYear: 195_000_000, total: 3_315_000_000 });

  cv.om.settings = { includedYears: 0, escalationPct: 3, contractYears: 17 };
  assert.equal(calculateCivil(cv, INP).om.contract?.total, 4_243_509_609.77, 'flat pricing left Rp 0.93 bn on the table');

  // Three years inside the EPC price: the contract picks up at year 4, at the escalated price — no year sold twice.
  cv.om.settings = { includedYears: 3, escalationPct: 3, contractYears: 17 };
  const r = calculateCivil(cv, INP);
  assert.deepEqual(r.om.items[0].years, [195_000_000, 200_850_000, 206_875_500]);
  assert.equal(r.om.items[0].perYear, 200_908_500);
  assert.deepEqual(r.om.contract, { fromYear: 4, toYear: 20, firstYear: 213_081_765, total: 4_636_997_525.35 });
});

test('Pump and tank where there is pipe; grounding pits and inverter stations from the inverters', () => {
  const cv = newCivilDoc();
  cv.areas = [area('Roof 1', { pipeM: 500 })];
  cv.settings = { ...cv.settings, invertersPerStation: 3, pitsExtra: 2 };
  const r = calculateCivil(cv, INP);
  assert.equal(r.pipeM, 505);
  assert.equal(r.pumps, 1);
  assert.equal(r.pits, 11, '9 inverters × 1 + 2');
  assert.equal(r.stations, 3, 'ROUNDUP(9 ÷ 3)');
  assert.equal(calculateCivil(newCivilDoc(), INP).pumps, 0, 'no pipe, no pump');

  const doc = newBomCalcDoc();
  doc.civil!.areas = cv.areas;
  doc.rows = doc.rows.filter((x) => !(x.qty.mode === 'link' && x.qty.key === 'civil.pump'));
  assert.ok(computeBomCalc(doc).checks.some((c) => c.where === 'Water pump and tank' && /no BOM row takes it/.test(c.message)),
    'a promised pump with no row is flagged (it once went unpriced)');
});

test('A linked cost: read from the calculation, an error when it points at nothing', () => {
  const ok = priceBom([{ ...linkedRow('x', 'Tray', 'm', 'q'), costKey: 'c' }], { q: 10, c: 1_000 }, { defaultMargin: 0.2, plantWp: 1, ppnPct: 11 });
  assert.equal(ok.rows[0].costTotal, 10_000);
  assert.equal(ok.rows[0].materialUnit, 1_250);
  const bad = priceBom([{ ...linkedRow('x', 'Tray', 'm', 'q'), costKey: 'nope', cost: 5 }], { q: 10 }, { defaultMargin: 0.2, plantWp: 1, ppnPct: 11 });
  assert.equal(bad.rows[0].costTotal, 0, 'a broken cost link never falls back to a stale typed cost');
  assert.ok(bad.checks.some((c) => c.level === 'error' && /Cost linked to "nope"/.test(c.message)));
});

test('Every civil and O&M key explains itself; a calculation saved before them still opens', () => {
  const doc = newBomCalcDoc();
  doc.inverterGroups = [{ id: 'g', label: 'INV', count: 9, stringsEach: 1, modulesPerString: 1, componentId: null,
    inverter: { model: 'I', acKw: 1, acVoltageV: 800, acCurrentA: 1, maxDcV: null, mpptMinV: null, mpptMaxV: null, mppts: null, stringsPerMppt: null, maxIscPerMpptA: null } }];
  doc.civil!.areas = [area('Roof 1', { walkwayM: 100, lifelineM: 120, pipeM: 80 })];
  doc.civil!.settings = { ...doc.civil!.settings, walkwayPanelCost: 900_000, walkwaySupportCost: 150_000, lifelineWireCostPerM: 100_000, lifelineEndAnchorCost: 750_000, lifelineIntAnchorCost: 250_000 };
  doc.civil!.om.settings = { includedYears: 2, escalationPct: 5, contractYears: 0 };
  doc.civil!.om.items = doc.civil!.om.items.map((i) => ({ ...i, rate: i.basis === 'year' ? 12_000_000 : 1 }));
  const res = computeBomCalc(doc);
  const keys = linkOptions(doc, res).filter((l) => l.tab === 'civil');
  assert.ok(keys.some((l) => l.key === 'om.cleaning.perYear' && l.cost) && keys.some((l) => l.key === 'civil.pits' && !l.cost));
  for (const { key } of keys) {
    const e = explainKey(doc, res.values, res.dc, res.ac, key, res.raceway, res.civil)!;
    assert.ok(e.rule, `${key} has a rule`);
    const sum = e.parts.reduce((a, p) => a + p.value, 0);
    assert.ok(Math.abs(sum - e.value) < (isCostKey(key) ? 0.05 : 0.001), `${key}: the parts add up to the value (${sum} vs ${e.value})`);
  }
  assert.deepEqual(unusedKeys(doc, res.values).filter((k) => /^(civil|om)\./.test(k)), [], 'the standard layout takes every civil and O&M result');

  const old: BomCalcDoc = newBomCalcDoc();
  delete old.civil;
  const r2 = computeBomCalc(old);
  assert.equal(r2.values['om.years'], 1);
  assert.equal(r2.values['civil.walkway.m'], 0);
});
