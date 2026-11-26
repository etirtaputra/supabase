import { test } from 'node:test';
import assert from 'node:assert/strict';
import { systemWp, lineWp } from './quoteWp.ts';

test('price per Wp divides by the panel lines first, the typed kWp only when there are none', () => {
  assert.deepEqual(systemWp(58_000, 60), { wp: 58_000, fromSpecs: false }, 'the items are the system');
  assert.deepEqual(systemWp(0, 234), { wp: 234_000, fromSpecs: true });
  assert.deepEqual(systemWp(0, '18.7'), { wp: 18_700, fromSpecs: true });
  assert.deepEqual(systemWp(0, null), { wp: 0, fromSpecs: false }, 'a non-solar job has no price per Wp');
  assert.deepEqual(systemWp(0, 0), { wp: 0, fromSpecs: false });
});

test('a panel line counts its Wp from the catalogue, else from "725Wp" in the description', () => {
  const comps = [{ component_id: 'p', category: 'pv_module', norm_value: 725 }];
  assert.equal(lineWp(comps, { component_id: 'p', description: 'TRINA', unit: 'unit', quantity: 80 }), 58_000);
  assert.equal(lineWp([], { component_id: null, description: 'TRINA TSM 720Wp Bifacial', unit: 'unit', quantity: 10 }), 7_200);
  assert.equal(lineWp([], { component_id: null, description: 'Modules', unit: 'Wp', quantity: 5_000 }), 5_000);
});
