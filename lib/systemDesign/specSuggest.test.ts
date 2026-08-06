/**
 * Suggestion tests, written against REAL catalog names — every string below is
 * a `supplier_model` from `3.0_components`. A suggestion that misreads one of
 * these would put a wrong number in front of someone about to accept it.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { suggestSpecs } from './specSuggest.ts';

const v = (s: ReturnType<typeof suggestSpecs>, k: string) => s[k]?.value;
const src = (s: ReturnType<typeof suggestSpecs>, k: string) => s[k]?.source;

test('EPEVER names carry the rating and the bus', () => {
  const s = suggestSpecs('inverter_charger', 'EPEVER ELS3K-E 3kW/48V', {});
  assert.equal(v(s, 'rated_output_power_w'), 3000);
  assert.equal(v(s, 'battery_nominal_voltage_vdc'), 48);
  assert.equal(src(s, 'rated_output_power_w'), 'name');
});

test('a 15 kW unit is not read as 15 W', () => {
  const s = suggestSpecs('inverter_charger', 'EPEVER ELS15K 15kW/48V', {});
  assert.equal(v(s, 'rated_output_power_w'), 15000);
  assert.equal(v(s, 'battery_nominal_voltage_vdc'), 48);
});

test('DEYE shorthand — SUN-5K reads as 5 kW', () => {
  const s = suggestSpecs('inverter_charger', 'DEYE SUN-5K-SG05LP1-EU-SM2', {});
  assert.equal(v(s, 'rated_output_power_w'), 5000);
});

test('VOLTRONIC "VM 1K-24" gives both the rating and the 24 V bus', () => {
  const s = suggestSpecs('inverter_charger', 'VOLTRONIC Axpert VM 1K-24', {});
  assert.equal(v(s, 'rated_output_power_w'), 1000);
  assert.equal(v(s, 'battery_nominal_voltage_vdc'), 24);
});

test('the calculator database outranks the name', () => {
  const s = suggestSpecs('inverter_charger', 'ICA SOLAR SNV-GH30081 30kW', {});
  assert.equal(src(s, 'rated_output_power_w'), 'calculator');
  assert.equal(v(s, 'rated_output_power_w'), 30000);
});

test('on-grid: three-phase is read from the name, single-phase is the default', () => {
  const three = suggestSpecs('on_grid_inverter', 'EPEVER EHT15K Three-Phase 15kW', {});
  assert.equal(v(three, 'rated_output_power_kw'), 15);
  assert.equal(v(three, 'nominal_ac_voltage_vac'), '400 3L+N');
  const one = suggestSpecs('on_grid_inverter', 'Some 5kW string inverter', {});
  assert.equal(v(one, 'nominal_ac_voltage_vac'), '230 L-N');
});

test('batteries: volts, amp-hours, chemistry and the energy they imply', () => {
  const s = suggestSpecs('batteries', 'ICAL LIP12100D 12V/100Ah Lead-Acid Deep Cycle', {});
  assert.equal(v(s, 'nominal_voltage_v'), 12);
  assert.equal(v(s, 'rated_capacity_ah'), 100);
  assert.equal(v(s, 'energy_wh'), 1200);
  // The calculator knows this model, so its fuller wording wins — and the
  // system engine tests chemistry with includes(), so it still sizes right.
  assert.equal(v(s, 'battery_type'), 'Lead-Acid (Deep Cycle)');
  assert.ok(String(v(s, 'battery_type')).includes('Lead-Acid'));
});

test('a lithium battery is not filed as lead-acid', () => {
  const s = suggestSpecs('batteries', 'ICAL LIP48100LF 48V 100Ah LiFePO4 with BMS', {});
  assert.ok(String(v(s, 'battery_type')).includes('LiFePO4'));
  assert.ok(!String(v(s, 'battery_type')).includes('Lead-Acid'));
  assert.equal(v(s, 'energy_wh'), 4800);
});

test('a battery the calculator does not know is still read from its name', () => {
  const s = suggestSpecs('batteries', 'PYLONTECH US3000C 48V 74Ah LiFePO4', {});
  assert.equal(v(s, 'battery_type'), 'LiFePO4');
  assert.equal(src(s, 'battery_type'), 'name');
  assert.equal(v(s, 'energy_wh'), 48 * 74);
});

test('PV modules: watt-peak and the dimension string', () => {
  const s = suggestSpecs('pv_module', 'ICA SOLAR ICA550-72HMI 550Wp Mono 2278x1134x35mm', {});
  assert.equal(v(s, 'power_stc_w'), 550);
  assert.equal(v(s, 'dimensions_l_w_h_mm'), '2278 x 1134 x 35');
  // Voc is on no datasheet-free name — the calculator database supplies it
  assert.equal(v(s, 'voc_stc_v'), 50.2);
  assert.equal(src(s, 'voc_stc_v'), 'calculator');
});

test('a spec already on the item is never suggested over', () => {
  const s = suggestSpecs('inverter_charger', 'EPEVER ELS3K-E 3kW/48V', { rated_output_power_w: 3200 });
  assert.equal(s.rated_output_power_w, undefined, 'the stored 3200 W stands');
  assert.equal(v(s, 'battery_nominal_voltage_vdc'), 48, 'the missing one is still offered');
});

test('a name with nothing to read yields nothing — no invented numbers', () => {
  const s = suggestSpecs('inverter_charger', 'HUAWEI LUNA2000-241 Smart String', {});
  assert.equal(v(s, 'rated_output_power_w'), undefined);
});

test('every suggestion explains itself', () => {
  const s = suggestSpecs('inverter_charger', 'EPEVER ELS6K-E 6kW/48V', {});
  for (const key of Object.keys(s)) assert.ok(s[key].why.length > 0, `${key} has no reason`);
});
