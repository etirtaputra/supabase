/**
 * specSchema — the canonical shape of `3.0_components.specifications`.
 *
 * The point of the field set is that a query can trust it: every PV module
 * carries every declared key, so `specifications->>'voc_stc_v' IS NULL` means
 * "the datasheet does not say" and never "this brand spells it differently".
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  CATEGORY_SPEC_FIELDS, conformSpecs, specGaps, normalizeSpecs, specNumber,
} from './specSchema.ts';

test('every declared pv_module key is present, even when nothing is known', () => {
  const out = conformSpecs('pv_module', {});
  const fields = CATEGORY_SPEC_FIELDS.pv_module!;
  assert.deepEqual(Object.keys(out), [...fields]);
  assert.ok(fields.every((k) => out[k] === null));
});

test('two modules from different brands come out with identical key sets', () => {
  const ica = conformSpecs('pv_module', {
    power_stc_w: 550, voc_stc_v: 50.2, dimensions_l_w_h_mm: '2278 x 1134 x 30',
    glass_description: '2.0mm low iron tempered glass',
    packing_container_40ft_total_pcs: 620,
  });
  const trina = conformSpecs('pv_module', { power_stc_w: 715, weight_kg: 38.3 });
  assert.deepEqual(Object.keys(ica), Object.keys(trina));
});

test('declared order is kept, so two records diff line-for-line', () => {
  const a = Object.keys(conformSpecs('pv_module', { weight_kg: 1, power_stc_w: 2 }));
  const b = Object.keys(conformSpecs('pv_module', { power_stc_w: 2, weight_kg: 1 }));
  assert.deepEqual(a, b);
});

test('legacy spellings fold into the canonical key', () => {
  const out = conformSpecs('pv_module', {
    power_tolerance_w: '0 to +5',
    glass_description: '3.2mm tempered low iron glass',
    packing_container_40ft_pcs_per_pallet: 31,
    packing_container_40ft_pallets_per_container: 20,
    packing_container_40ft_total_pcs: 620,
  });
  assert.equal(out.power_tolerance, '0 to +5');
  assert.equal(out.front_glass, '3.2mm tempered low iron glass');
  assert.equal(out.packing_pcs_per_pallet, 31);
  assert.equal(out.packing_pallets_per_container_40ft, 20);
  assert.equal(out.packing_pcs_per_container_40ft, 620);
  // and the old spellings do not survive alongside them
  assert.ok(!('power_tolerance_w' in out));
  assert.ok(!('glass_description' in out));
});

test('an undeclared key is kept rather than dropped, but sorts after the declared ones', () => {
  const out = conformSpecs('pv_module', { power_stc_w: 550, hail_impact_mm: 25 });
  assert.equal(out.hail_impact_mm, 25);
  const keys = Object.keys(out);
  assert.equal(keys[keys.length - 1], 'hail_impact_mm');
});

test('a category with no declared field set passes through', () => {
  const out = conformSpecs('accessories', { bom_role: 'mc4_pair' });
  assert.deepEqual(out, { bom_role: 'mc4_pair' });
});

test('specGaps names the declared keys still unanswered', () => {
  const gaps = specGaps('pv_module', conformSpecs('pv_module', { power_stc_w: 550, voc_stc_v: 50.2 }));
  assert.ok(gaps.includes('weight_kg'));
  assert.ok(!gaps.includes('power_stc_w'));
  assert.ok(!gaps.includes('voc_stc_v'));
});

test('null is a real answer, not a missing key — a gap count is possible', () => {
  const out = conformSpecs('pv_module', { power_stc_w: 715 });
  assert.ok('bifaciality_percent' in out);
  assert.equal(out.bifaciality_percent, null);
  assert.equal(specGaps('pv_module', out).length, CATEGORY_SPEC_FIELDS.pv_module!.length - 1);
});

test('numeric strings from a datasheet become numbers', () => {
  assert.equal(specNumber('13.82'), 13.82);
  assert.equal(specNumber('1,500'), 1500);
  assert.equal(specNumber('45 ± 2'), null);
  const out = normalizeSpecs('pv_module', { voc_stc_v: '50.20' });
  assert.equal(out.voc_stc_v, 50.2);
});
