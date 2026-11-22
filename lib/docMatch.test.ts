import test from 'node:test';
import assert from 'node:assert/strict';
import { matchByName, matchComponent, docNumberKey } from './docMatch.ts';

const comps = [
  { component_id: 'a', supplier_model: 'SIN202-9 II', internal_description: 'KSTAR SIN202-9 II', brand: 'KSTAR' },
  { component_id: 'b', supplier_model: 'YDC3330H', internal_description: 'KSTAR YDC3330H Long Run 30kVA', brand: 'KSTAR' },
  { component_id: 'c', supplier_model: null, internal_description: 'Cable Tray Steel HDG + Cover and Accesories', brand: 'TIMS' },
];

test('a line finds its item: SKU exact, SKU inside, brand + description, description', () => {
  assert.equal(matchComponent({ model_sku: 'sin202-9 ii' }, comps)?.component_id, 'a');
  assert.equal(matchComponent({ model_sku: 'YDC3330H-LR' }, comps)?.component_id, 'b');
  assert.equal(matchComponent({ brand: 'TIMS', description: 'Cable Tray Steel HDG' }, comps)?.component_id, 'c');
  assert.equal(matchComponent({ description: 'cable tray steel hdg + cover and accesories' }, comps)?.component_id, 'c');
  assert.equal(matchComponent({ description: 'short' }, comps), null, 'a short description alone is too weak to match');
  assert.equal(matchComponent({ model_sku: 'XYZ-999', description: 'Unknown battery' }, comps), null);
});

test('a supplier or company by name: exact, then contained', () => {
  const sups = [{ id: 1, name: 'Shenzhen Kstar Science & Technology Co., Ltd.' }, { id: 2, name: 'PT Anugrah Megateratai' }];
  assert.equal(matchByName('PT Anugrah Megateratai', sups, (s) => s.name)?.id, 2);
  assert.equal(matchByName('Shenzhen Kstar Science & Technology', sups, (s) => s.name)?.id, 1);
  assert.equal(matchByName('', sups, (s) => s.name), null);
  assert.equal(matchByName('Someone Else', sups, (s) => s.name), null);
});

test('document numbers compare however they were typed', () => {
  assert.equal(docNumberKey('PIO-016-ISL-09-2026'), docNumberKey('pio 016/isl/09/2026'));
  assert.equal(docNumberKey(' KST226-6823 '), 'kst2266823');
});
