/**
 * The datasheet prompt asks for exactly the declared field set, describes
 * each field the way the form does, and carries the item's current values so
 * a pasted answer cannot wipe them.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildSpecPrompt, specFieldGuide } from './specPrompt.ts';
import { CATEGORY_SPEC_FIELDS } from './specSchema.ts';

const templateOf = (prompt: string) => JSON.parse(prompt.slice(prompt.indexOf('TEMPLATE\n') + 'TEMPLATE\n'.length));

test('every declared category gets a guide line per field, in declared order', () => {
  for (const [cat, fields] of Object.entries(CATEGORY_SPEC_FIELDS)) {
    const guide = specFieldGuide(cat);
    assert.equal(guide.length, fields!.length, cat);
    assert.deepEqual(guide.map((l) => l.slice(2, l.indexOf(':'))), [...fields!], cat);
  }
});

test('the template is the item\'s current specs, conformed: every key, values kept, nulls for the rest', () => {
  const p = buildSpecPrompt({ category: 'on_grid_inverter', supplier_model: 'SNV-GT3033TT', specifications: { rated_power_kw: 30, brand: 'X', no_of_mppts: '3' } });
  const tpl = templateOf(p);
  assert.deepEqual(Object.keys(tpl), [...CATEGORY_SPEC_FIELDS.on_grid_inverter!]);
  assert.equal(tpl.rated_output_power_kw, 30, 'an old spelling arrives under its canonical key');
  assert.equal(tpl.no_of_mppts, 3);
  assert.equal(tpl.strings_per_mppt, null);
  assert.ok(!('brand' in tpl), 'brand is column data, never a spec');
  assert.match(p, /MODEL: SNV-GT3033TT/);
  assert.match(p, /- pv_mppt_voltage_range_vdc: MPPT Voltage Range \(Vdc\) — text, as printed, e\.g\. 120~430/);
  assert.match(p, /- weight_kg: Weight \(kg\) — a plain number/);
});

test('the fields the BOM Calculator reads from the catalogue are all asked for', () => {
  const inv = new Set(CATEGORY_SPEC_FIELDS.on_grid_inverter);
  for (const k of ['rated_output_power_kw', 'nominal_ac_voltage_vac', 'max_output_current_a', 'pv_max_voltage_vdc',
    'pv_mppt_voltage_range_vdc', 'no_of_mppts', 'strings_per_mppt', 'max_short_circuit_current_per_mppt_a']) assert.ok(inv.has(k), k);
  const mod = new Set(CATEGORY_SPEC_FIELDS.pv_module);
  for (const k of ['power_stc_w', 'voc_stc_v', 'vmp_stc_v', 'isc_stc_a', 'imp_stc_a', 'temp_coeff_voc_percent_per_c', 'max_system_voltage_vdc']) assert.ok(mod.has(k), k);
});
