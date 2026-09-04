/**
 * quoteAc — the kW AC a proposal states, read off its own inverter lines.
 *
 * The whole point is that a stated capacity cannot drift from what is being
 * sold, so the tests are mostly about what must NOT count: modules, batteries,
 * charge controllers, and any "kW" that happens to appear on a cable.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { acWattsPerUnit, lineAcWatts, AC_INVERTER_CATEGORIES } from './quoteAc.ts';

const comps = [
  { component_id: 'ogi', category: 'on_grid_inverter', norm_value: 100000 },
  { component_id: 'ic',  category: 'inverter_charger', norm_value: 5000 },
  { component_id: 'pv',  category: 'pv_module',        norm_value: 550 },
  { component_id: 'bat', category: 'batteries',        norm_value: 5120 },
  { component_id: 'scc', category: 'solar_charge_controller', norm_value: 60 },
  { component_id: 'nyi', category: 'on_grid_inverter', norm_value: null },
];

test('a catalog inverter answers with its own norm_value, in watts', () => {
  assert.equal(acWattsPerUnit(comps, 'ogi', 'anything'), 100000);
  assert.equal(acWattsPerUnit(comps, 'ic', 'anything'), 5000);
});

test('every declared AC category is one the catalog stores in watts', () => {
  // Guards the unit assumption: adding a category here that stores A or Wh
  // would silently corrupt the stated kW AC.
  for (const c of AC_INVERTER_CATEGORIES) assert.match(c, /invert|pump/);
});

test('modules, batteries and charge controllers never count as AC power', () => {
  assert.equal(acWattsPerUnit(comps, 'pv', 'ICA 550Wp Mono'), 0);
  assert.equal(acWattsPerUnit(comps, 'bat', 'LiFePO4 5.12 kWh'), 0);
  assert.equal(acWattsPerUnit(comps, 'scc', 'MPPT 60A'), 0);
});

test('a catalog inverter with no capacity on file is read from its text', () => {
  // Most on-grid inverters carry no norm_value, and a proposal cannot wait for
  // the catalog to be complete — the category already proves it is an inverter.
  assert.equal(acWattsPerUnit(comps, 'nyi', 'Inverter On-Grid 60 kW'), 60000);
  assert.equal(acWattsPerUnit(comps, 'nyi', 'Inverter On-Grid, no rating stated'), 0);
});

test('the catalog still settles WHAT a line is', () => {
  // A module line whose description mentions an inverter must never add AC
  // power — the category wins over the words.
  assert.equal(acWattsPerUnit(comps, 'pv', 'Module bundled with a 100 kW inverter'), 0);
});

test('a free-typed inverter line is read from its description', () => {
  assert.equal(acWattsPerUnit(comps, null, 'Inverter On-Grid Huawei 100 kW'), 100000);
  assert.equal(acWattsPerUnit(comps, null, 'Hybrid inverter 5kW 48V'), 5000);
  assert.equal(acWattsPerUnit(comps, null, 'Inverter 3000W 24V'), 3000);
  assert.equal(acWattsPerUnit(comps, null, 'Inverter 5,5 kW'), 5500);
});

test('a free-typed line that is not an inverter is never read', () => {
  assert.equal(acWattsPerUnit(comps, null, 'AC cable for the 100 kW array'), 0);
  assert.equal(acWattsPerUnit(comps, null, 'Installation of a 100 kW system'), 0);
});

test('kWh and Wp are not kW and W', () => {
  assert.equal(acWattsPerUnit(comps, null, 'Inverter bundle with 10 kWh battery'), 0);
  assert.equal(acWattsPerUnit(comps, null, 'Inverter kit with 550 Wp module'), 0);
});

test('the real on-grid catalogue names all resolve', () => {
  // Every on-grid inverter on file states its rating in its own name, which is
  // why the no-norm_value fallback is worth having at all.
  const cases: [string, number][] = [
    ['ICA SOLAR SNV-GT1022SM 1kW 1xMPPT', 1000],
    ['ICA SOLAR SNV-GT1032DM 10kW 2xMPPT', 10000],
    ['ICA SOLAR SNV-GT5033QT 50kW 4xMPPT', 50000],
    ['ICA SOLAR SNV-GT6032TM 60kW 3xMPPT', 60000],
    ['SUNGROW SG150CX C&I Three-Phase On-grid Inverter 150 kW', 150000],
  ];
  for (const [name, want] of cases) assert.equal(acWattsPerUnit(comps, 'nyi', name), want, name);
});

test('a line multiplies by its quantity', () => {
  assert.equal(lineAcWatts(comps, { component_id: 'ogi', description: '', quantity: 3 }), 300000);
  assert.equal(lineAcWatts(comps, { component_id: null, description: 'Inverter 5 kW', quantity: 4 }), 20000);
  assert.equal(lineAcWatts(comps, { component_id: 'pv', description: '', quantity: 100 }), 0);
});
