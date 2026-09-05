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
