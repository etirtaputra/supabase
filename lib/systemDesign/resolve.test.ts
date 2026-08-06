/**
 * Resolver tests — `node --test` (Node runs the TypeScript directly, no
 * toolchain). These pin the translation from generic BoM line to catalog
 * item; the engines' own golden tests live beside each engine.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { resolveLine, resolveBom, summarise, type DesignCandidate } from './resolve.ts';
import type { BomLine } from './types.ts';

const item = (over: Partial<DesignCandidate> & { component_id: string }): DesignCandidate => ({
  internal_description: 'Item',
  supplier_model: 'MODEL',
  category: 'mounting',
  unit: 'pcs',
  specifications: {},
  ...over,
});

const RAIL_4200 = item({
  component_id: 'rail-4200', internal_description: 'Mounting Rail 4200mm',
  specifications: { bom_role: 'rail', rail_length_mm: 4200 },
});
const RAIL_3300 = item({
  component_id: 'rail-3300', internal_description: 'Mounting Rail 3300mm',
  specifications: { bom_role: 'rail', rail_length_mm: 3300 },
});
const CLAMP_35 = item({
  component_id: 'clamp-35', internal_description: 'Mid Clamp 35mm',
  specifications: { bom_role: 'mid_clamp', clamp_thickness_mm: 35 },
});
const HOOK_METAL = item({
  component_id: 'hook-metal', internal_description: 'Roof Hook Metal',
  specifications: { bom_role: 'roof_hook', roof_type: 'metal' },
});

const ctx = (candidates: DesignCandidate[], prices: Record<string, number | null> = {}, stock: Record<string, number> = {}) => ({
  candidates,
  priceOf: (id: string) => (id in prices ? prices[id] : 100_000),
  stockOf: (id: string) => (id in stock ? stock[id] : null),
});

const line = (over: Partial<BomLine> & { role: BomLine['role'] }): BomLine =>
  ({ qty: 1, label: 'Generic line', ...over });

test('matches the role and its discriminating parameter', () => {
  const r = resolveLine(line({ role: 'rail', param: 4200, qty: 18 }), ctx([RAIL_3300, RAIL_4200]));
  assert.equal(r.component_id, 'rail-4200');
  assert.equal(r.description, 'Mounting Rail 4200mm');
  assert.equal(r.resolved, true);
  assert.equal(r.candidates, 1);
});

test('a 35mm clamp never resolves to a 30mm one', () => {
  const clamp30 = item({
    component_id: 'clamp-30', internal_description: 'Mid Clamp 30mm',
    specifications: { bom_role: 'mid_clamp', clamp_thickness_mm: 30 },
  });
  const r = resolveLine(line({ role: 'mid_clamp', param: 35, qty: 36 }), ctx([clamp30]));
  assert.equal(r.resolved, false);
  assert.match(r.warning ?? '', /Not in catalog/);
  assert.equal(r.description, 'Generic line');   // the engine's own label survives
});

test('string parameters match case-insensitively', () => {
  const r = resolveLine(line({ role: 'roof_hook', param: 'Metal' }), ctx([HOOK_METAL]));
  assert.equal(r.component_id, 'hook-metal');
});

test('items Hidden from customer-facing pickers are never design candidates', () => {
  const hidden = item({ ...RAIL_4200, component_id: 'rail-hidden', quote_cost_mode: 'hidden' });
  const r = resolveLine(line({ role: 'rail', param: 4200 }), ctx([hidden]));
  assert.equal(r.resolved, false);
});

test('an item missing its role parameter is not calculator-ready, so not a candidate', () => {
  const vague = item({
    component_id: 'rail-vague', internal_description: 'Rail, length unknown',
    specifications: { bom_role: 'rail' },      // rail_length_mm missing
  });
  const r = resolveLine(line({ role: 'rail', param: 4200 }), ctx([vague]));
  assert.equal(r.resolved, false);
});

test('stock beats price: what we can ship today leads', () => {
  const cheapNoStock = item({ ...RAIL_4200, component_id: 'rail-cheap' });
  const dearInStock = item({ ...RAIL_4200, component_id: 'rail-dear' });
  const r = resolveLine(line({ role: 'rail', param: 4200, qty: 5 }),
    ctx([cheapNoStock, dearInStock], { 'rail-cheap': 50_000, 'rail-dear': 90_000 }, { 'rail-cheap': 0, 'rail-dear': 12 }));
  assert.equal(r.component_id, 'rail-dear');
  assert.equal(r.available, 12);
  assert.equal(r.candidates, 2);
});

test('with stock equal, the cheaper item wins', () => {
  const a = item({ ...RAIL_4200, component_id: 'rail-a' });
  const b = item({ ...RAIL_4200, component_id: 'rail-b' });
  const r = resolveLine(line({ role: 'rail', param: 4200 }),
    ctx([a, b], { 'rail-a': 90_000, 'rail-b': 50_000 }));
  assert.equal(r.component_id, 'rail-b');
});

test('a priced item beats an unpriced one, and an unpriced pick is flagged', () => {
  const unpriced = item({ ...RAIL_4200, component_id: 'rail-unpriced' });
  const r = resolveLine(line({ role: 'rail', param: 4200 }), ctx([unpriced], { 'rail-unpriced': null }));
  assert.equal(r.component_id, 'rail-unpriced');
  assert.match(r.warning ?? '', /No sell price/);
});

test('resolution is stable — the same design resolves the same way twice', () => {
  const a = item({ ...RAIL_4200, component_id: 'rail-b' });
  const b = item({ ...RAIL_4200, component_id: 'rail-a' });
  const l = line({ role: 'rail', param: 4200 });
  const first = resolveLine(l, ctx([a, b], { 'rail-a': null, 'rail-b': null }));
  const second = resolveLine(l, ctx([b, a], { 'rail-a': null, 'rail-b': null }));
  assert.equal(first.component_id, second.component_id);
});

test('summary counts what the review step must warn about', () => {
  const lines = resolveBom([
    line({ role: 'rail', param: 4200, qty: 10 }),
    line({ role: 'mid_clamp', param: 35, qty: 36 }),          // resolves, short on stock
    line({ role: 'end_clamp', param: 35, qty: 8 }),           // not in catalog
  ], ctx([RAIL_4200, CLAMP_35], { 'rail-4200': 200_000, 'clamp-35': 25_000 }, { 'clamp-35': 4 }));
  const s = summarise(lines);
  assert.equal(s.lines, 3);
  assert.equal(s.unresolved, 1);
  assert.equal(s.short, 1);
  assert.equal(s.total, 10 * 200_000 + 36 * 25_000);
});
