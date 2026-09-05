/**
 * The storefront's reading of the catalogue.
 *
 * These tests are mostly about what must NOT reach a customer: the 607
 * one-off project lines, an item with no name, and a 33 kg module quietly
 * routed to a parcel courier.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  DEPARTMENTS, departmentOf, departmentByKey, shopName, isShoppable, hasPrice,
  pricePerUnit, weightKg, needsFreight, slugify, warrantyLine, cartSubtotal,
  freightLines, COURIER_WEIGHT_LIMIT_KG, formatIdr, formatIdrUnit, withPpn, PPN_PCT,
  type ShopItem,
} from './shopCatalog.ts';
import { ENUMS } from '../constants/enums.ts';

const item = (p: Partial<ShopItem>): ShopItem => ({
  component_id: 'x', internal_description: 'Item', supplier_model: 'SKU',
  brand: 'B', category: 'pv_module', unit: 'unit', norm_value: null,
  selling_price_idr: null, datasheet_url: null,
  warranty_value: null, warranty_unit: null,
  perf_warranty_value: null, perf_warranty_unit: null, specifications: null, ...p,
});

test('every department category is a real product category', () => {
  const known = new Set<string>(ENUMS.product_category as readonly string[]);
  for (const d of DEPARTMENTS) {
    for (const c of d.categories) assert.ok(known.has(c), `${d.key}: unknown category ${c}`);
  }
});

test('no category shops under two departments', () => {
  const seen = new Set<string>();
  for (const d of DEPARTMENTS) {
    for (const c of d.categories) {
      assert.ok(!seen.has(c), `${c} is in two departments`);
      seen.add(c);
    }
  }
});

test('non_stock never reaches the shop', () => {
  // 607 of the catalogue's 1,002 live rows are one-off project lines. A
  // storefront that listed them would be 60% noise.
  assert.equal(departmentOf('non_stock'), null);
  assert.equal(isShoppable(item({ category: 'non_stock' })), false);
});

test('an item with no name is not shoppable', () => {
  assert.equal(isShoppable(item({ internal_description: '  ', supplier_model: '' })), false);
  // …but a supplier model alone is a name.
  assert.equal(isShoppable(item({ internal_description: null, supplier_model: 'TSM-620' })), true);
});

test('an unpriced item still shops — quote-only is a real way to sell', () => {
  const i = item({ selling_price_idr: null });
  assert.equal(isShoppable(i), true);
  assert.equal(hasPrice(i), false);
  assert.equal(pricePerUnit(i), null);
});

test('the customer-facing name prefers our description', () => {
  assert.equal(shopName(item({ internal_description: 'TRINA 620Wp', supplier_model: 'TSM-620' })), 'TRINA 620Wp');
  assert.equal(shopName(item({ internal_description: null, supplier_model: 'TSM-620' })), 'TSM-620');
});

test('price per unit speaks each category’s own unit', () => {
  const mod = pricePerUnit(item({ category: 'pv_module', norm_value: 620, selling_price_idr: 1656000 }));
  assert.equal(mod?.unit, 'Wp');
  assert.equal(Math.round(mod!.value), 2671);

  const bat = pricePerUnit(item({ category: 'batteries', norm_value: 5120, selling_price_idr: 12300000 }));
  assert.equal(bat?.unit, 'Wh');
  assert.equal(Math.round(bat!.value), 2402);

  const scc = pricePerUnit(item({ category: 'solar_charge_controller', norm_value: 40, selling_price_idr: 1200000 }));
  assert.equal(scc?.unit, 'A');
});

test('cable is priced BY the metre, so it has no per-unit price', () => {
  // norm_value there is cross-section, not quantity — dividing would be noise.
  assert.equal(pricePerUnit(item({ category: 'pv_cable', norm_value: 6, selling_price_idr: 12500 })), null);
});

test('no capacity on file means no per-unit price, not a wrong one', () => {
  assert.equal(pricePerUnit(item({ category: 'pv_module', norm_value: null, selling_price_idr: 1500000 })), null);
  assert.equal(pricePerUnit(item({ category: 'pv_module', norm_value: 0, selling_price_idr: 1500000 })), null);
});

test('weight decides freight when the datasheet states it', () => {
  assert.equal(weightKg(item({ specifications: { weight_kg: 33 } })), 33);
  assert.equal(needsFreight(item({ category: 'accessories', specifications: { weight_kg: 40 } })), true);
  assert.equal(needsFreight(item({ category: 'accessories', specifications: { weight_kg: 1.72 } })), false);
  assert.equal(needsFreight(item({ category: 'accessories', specifications: { weight_kg: COURIER_WEIGHT_LIMIT_KG } })), false);
});

test('size decides freight when weight is silent', () => {
  // A 2,4 m module and a 4,85 m rail are refused for length, and neither
  // states a weight — a rule waiting for complete data would parcel a pallet.
  assert.equal(needsFreight(item({ category: 'pv_module', specifications: null })), true);
  assert.equal(needsFreight(item({ category: 'mounting', specifications: {} })), true);
  assert.equal(needsFreight(item({ category: 'accessories', specifications: null })), false);
});

test('a stated light weight beats the category rule', () => {
  // A mounting clip is 40 g. Category alone would send it by truck.
  assert.equal(needsFreight(item({ category: 'mounting', specifications: { weight_kg: 0.04 } })), false);
});

test('slugs are url-safe and never empty', () => {
  assert.equal(slugify('TRINA TSM-620NEG19RC.20 620Wp Bifacial'), 'trina-tsm-620neg19rc-20-620wp-bifacial');
  assert.equal(slugify('  ---  '), 'item');
  assert.ok(slugify('x'.repeat(200)).length <= 80);
});

test('warranty reads as one phrase, or nothing', () => {
  assert.equal(warrantyLine(item({ warranty_value: 12, warranty_unit: 'years', perf_warranty_value: 30, perf_warranty_unit: 'years' })),
    '12 tahun produk · 30 tahun performa');
  assert.equal(warrantyLine(item({ warranty_value: 12, warranty_unit: 'years' })), '12 tahun');
  assert.equal(warrantyLine(item({})), null);
});

test('a cart totals its lines and knows what needs a truck', () => {
  const panel = item({ component_id: 'p', category: 'pv_module', selling_price_idr: 1656000 });
  const mc4 = item({ component_id: 'm', category: 'accessories', selling_price_idr: 16000, specifications: { weight_kg: 0.1 } });
  const lines = [{ item: panel, qty: 6 }, { item: mc4, qty: 24 }];
  assert.equal(cartSubtotal(lines), 6 * 1656000 + 24 * 16000);
  assert.deepEqual(freightLines(lines).map((l) => l.item.component_id), ['p']);
});

test('an unpriced line adds nothing to the total rather than NaN', () => {
  assert.equal(cartSubtotal([{ item: item({ selling_price_idr: null }), qty: 3 }]), 0);
});

test('department lookup is by key and by category, and misses are null', () => {
  assert.equal(departmentByKey('panel')?.label, 'Panel Surya');
  assert.equal(departmentByKey('nope'), null);
  assert.equal(departmentOf('on_grid_inverter')?.key, 'inverter');
  assert.equal(departmentOf(null), null);
});

test('prices read the Indonesian way, whatever the back office is set to', () => {
  assert.equal(formatIdr(1656000), 'Rp 1.656.000');
  assert.equal(formatIdr(16000), 'Rp 16.000');
  assert.equal(formatIdr(1655999.6), 'Rp 1.656.000');
});

test('per-unit prices keep a decimal only when they are small', () => {
  assert.equal(formatIdrUnit(2671.0), 'Rp 2.671');
  assert.equal(formatIdrUnit(2.4), 'Rp 2,4');
});

test('PPN is the rate the documents already use', () => {
  assert.equal(PPN_PCT, 11);
  assert.equal(withPpn(1656000), 1656000 * 1.11);
});

// ── Generated filters, columns, search ─────────────────────────────────────
import { facetsFor, applyFacets, columnsFor, searchItems, matchesQuery, searchText, categoryLabel } from './shopCatalog.ts';

const mod = (id: string, p: number, eff: number, voc: number, bif: boolean, cell = 'N-type i-TOPCon') => item({
  component_id: id, category: 'pv_module', supplier_model: `TSM-${p}`, internal_description: `TRINA TSM-${p} ${p}Wp`,
  norm_value: p, selling_price_idr: 1000000,
  specifications: { power_stc_w: p, efficiency_percent: eff, voc_stc_v: voc, bifacial: bif, cell_type: cell, weight_kg: 33 },
});
const MODS = [mod('a', 620, 23, 49.6, true), mod('b', 720, 23.2, 49.4, true), mod('c', 550, 21.29, 50.2, false, 'Monocrystalline')];

test('facets are the category’s own declared fields', () => {
  const f = facetsFor('pv_module', MODS);
  const keys = f.map((x) => x.key);
  assert.ok(keys.includes('power_stc_w'));
  assert.ok(keys.includes('efficiency_percent'));
  assert.ok(keys.includes('bifacial'));
  assert.ok(keys.includes('cell_type'));
  // a field no item answers is not offered
  assert.ok(!keys.includes('isc_stc_a'));
});

test('a numeric field with a few distinct values is a ticked list, in numeric order', () => {
  // Twelve modules have six wattages: showing them beats a min/max pair.
  const f = facetsFor('pv_module', MODS).find((x) => x.key === 'power_stc_w');
  assert.equal(f?.kind, 'options');
  if (f?.kind === 'options') {
    assert.deepEqual(f.options.map((o) => o.value), ['550', '620', '720']);
    assert.equal(f.unit, 'W');
  }
});

test('a numeric field with many distinct values becomes a range', () => {
  const many = Array.from({ length: 20 }, (_, k) => mod(`m${k}`, 400 + k * 10, 20, 40, true));
  const f = facetsFor('pv_module', many).find((x) => x.key === 'power_stc_w');
  assert.equal(f?.kind, 'range');
  if (f?.kind === 'range') { assert.equal(f.min, 400); assert.equal(f.max, 590); }
});

test('ticking a numeric option filters by that exact value', () => {
  assert.deepEqual(applyFacets(MODS, { power_stc_w: ['620', '720'] }).map((i) => i.component_id), ['a', 'b']);
});

test('a field every item answers the same way is not a filter', () => {
  // weight_kg is 33 on all three: a range from 33 to 33 returns everything or nothing.
  const keys = facetsFor('pv_module', MODS).map((x) => x.key);
  assert.ok(!keys.includes('weight_kg'));
});

test('a boolean and a short text field become options with counts', () => {
  const f = facetsFor('pv_module', MODS);
  const bif = f.find((x) => x.key === 'bifacial');
  assert.equal(bif?.kind, 'options');
  if (bif?.kind === 'options') assert.deepEqual(bif.options, [{ value: 'Yes', count: 2 }, { value: 'No', count: 1 }]);
  const cell = f.find((x) => x.key === 'cell_type');
  if (cell?.kind === 'options') assert.equal(cell.options[0].value, 'N-type i-TOPCon');
});

test('highlighted fields lead the facet list', () => {
  const f = facetsFor('pv_module', MODS);
  assert.equal(f[0].key, 'power_stc_w');
});

test('a category with no declared fields has no facets', () => {
  assert.deepEqual(facetsFor('mounting', [item({ category: 'mounting' })]), []);
  assert.deepEqual(facetsFor(null, MODS), []);
});

test('a range keeps items inside it and drops items that do not answer', () => {
  const noVoc = item({ component_id: 'z', category: 'pv_module', specifications: { power_stc_w: 600 } });
  const out = applyFacets([...MODS, noVoc], { power_stc_w: { min: 600, max: 700 } });
  assert.deepEqual(out.map((i) => i.component_id), ['a', 'z']);
  const out2 = applyFacets([...MODS, noVoc], { voc_stc_v: { min: 49, max: 50 } });
  assert.deepEqual(out2.map((i) => i.component_id), ['a', 'b']);   // z has no Voc
});

test('options are an OR within a field and an AND across fields', () => {
  assert.deepEqual(applyFacets(MODS, { bifacial: ['Yes'] }).map((i) => i.component_id), ['a', 'b']);
  assert.deepEqual(applyFacets(MODS, { bifacial: ['Yes', 'No'] }).map((i) => i.component_id), ['a', 'b', 'c']);
  assert.deepEqual(applyFacets(MODS, { bifacial: ['Yes'], power_stc_w: { min: 700 } }).map((i) => i.component_id), ['b']);
});

test('an empty state passes everything', () => {
  assert.equal(applyFacets(MODS, {}).length, 3);
  assert.equal(applyFacets(MODS, { bifacial: [], power_stc_w: {} }).length, 3);
});

test('table columns are the highlighted fields, at most five', () => {
  const cols = columnsFor('pv_module');
  assert.ok(cols.length > 0 && cols.length <= 5);
  assert.ok(cols.includes('power_stc_w'));
  assert.deepEqual(columnsFor('mounting'), []);
});

test('search needs every token, in any spelling of the capacity', () => {
  assert.ok(matchesQuery(MODS[0], '620wp'));
  assert.ok(matchesQuery(MODS[0], '620 wp'));
  assert.ok(matchesQuery(MODS[0], 'trina 620'));
  assert.ok(!matchesQuery(MODS[0], 'trina 720'));
  assert.ok(matchesQuery(MODS[0], ''));
});

test('search ranks a model-number hit above a description hit', () => {
  const inv = item({ component_id: 'i', category: 'inverter_charger', supplier_model: 'SNV-GH5042', internal_description: 'ICA SOLAR SNV-GH5042 5kW/48V', norm_value: 5000, specifications: { rated_output_power_w: 5000, battery_nominal_voltage_vdc: 48 } });
  const cable = item({ component_id: 'k', category: 'pv_cable', supplier_model: 'PV1-F', internal_description: 'Kabel PV untuk inverter SNV-GH5042 kit' });
  const r = searchItems([cable, inv], 'snv-gh5042');
  assert.deepEqual(r.map((i) => i.component_id), ['i', 'k']);
  assert.deepEqual(searchItems([cable, inv], '5kw 48v').map((i) => i.component_id), ['i']);
  assert.deepEqual(searchItems([cable, inv], ''), []);
});

test('searchText carries the spec values engineers type', () => {
  const inv = item({ category: 'inverter_charger', norm_value: 5000, specifications: { rated_output_power_w: 5000, battery_nominal_voltage_vdc: 48 } });
  const t = searchText(inv);
  assert.ok(t.includes('5000w'));
  assert.ok(t.includes('48vdc'));
});

test('category labels are customer-facing, and never empty for a known category', () => {
  assert.equal(categoryLabel('inverter_charger'), 'Inverter hybrid / off-grid');
  assert.notEqual(categoryLabel('box_bsp'), '');
  assert.equal(categoryLabel(null), '');
});
