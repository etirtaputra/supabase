import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { specsForType, composeDescription, specFileTag } from './projectSpec.ts';

// Q-20261125-BZ2E (2026-11-27): a hybrid proposal duplicated, then switched to
// on-grid, kept {"kwh_bess": 104.4}. An on-grid system has no storage.
const hybrid = { kwp_dc: 58, kw_ac: 50, kw_pcs: 50, kwh_bess: 104.4, econ: { enabled: true } };

test('an on-grid proposal keeps no BESS energy and no PCS power', () => {
  const onGrid = specsForType('on_grid', { ...hybrid, kwp_dc: 34.8, kw_ac: 30 });
  assert.deepEqual(onGrid, { kwp_dc: 34.8, kw_ac: 30, econ: { enabled: true } });
  assert.ok(!('kwh_bess' in onGrid) && !('kw_pcs' in onGrid));
});

test('the other types keep their specs untouched', () => {
  for (const t of ['hybrid_bess', 'off_grid', 'evcs', 'custom', null]) {
    assert.equal(specsForType(t, hybrid), hybrid, `${t} must be returned as is`);
  }
  const clean = { kwp_dc: 10, kw_ac: 8 };
  assert.equal(specsForType('on_grid', clean), clean, 'nothing to drop, same object');
});

test('the composed texts already ignore storage on on-grid (so the stale value was invisible, not harmless)', () => {
  assert.equal(composeDescription('on_grid', hybrid, 'Site'), 'EPC for PV On-Grid 58 kWp DC / 50 kW AC, at Site');
  assert.equal(specFileTag('on_grid', hybrid), 'OnGrid-58kWpDC-50kWAC');
});

test('a type change and a duplicate both go through specsForType', () => {
  const editor = readFileSync(new URL('../app/proposals/[id]/page.tsx', import.meta.url), 'utf8');
  const list = readFileSync(new URL('../app/proposals/page.tsx', import.meta.url), 'utf8');
  assert.match(editor, /function updateProject[\s\S]{0,600}specsForType\(type,/, 'updateProject must clean the specs for the new type');
  assert.match(list, /newQuote\.system_specs = specsForType\(src\.project_type,/, 'Duplicate must clean the copied specs');
});
