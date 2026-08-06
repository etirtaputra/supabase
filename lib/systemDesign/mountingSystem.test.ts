/**
 * Shortlisting tests, written against the REAL catalog naming — the model
 * strings below are copied from `3.0_components`, spelling quirks and all
 * ("MIBET\n" brands, "T-slot MD" vs "MD T-slot" word order).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { seriesOf, railProfileOf, mountingSystems, shortlist } from './mountingSystem.ts';
import { specCovers, resolveLine, type DesignCandidate } from './resolve.ts';
import type { BomLine } from './types.ts';

const c = (supplier_model: string, brand: string | null, specs: Record<string, unknown>): DesignCandidate & { brand: string | null } => ({
  component_id: supplier_model, supplier_model, internal_description: supplier_model,
  brand, category: 'mounting', unit: 'pcs', specifications: specs,
});

// A slice of the real mounting catalog
const CATALOG = [
  c('MIBET MD T-slot Rail H38.5 L4850mm AL6005-T5', 'MIBET\n', { bom_role: 'rail', rail_length_mm: 4850 }),
  c('MIBET T-slot MD Rail H38.5 L3650mm AL6005-T5', 'MIBET', { bom_role: 'rail', rail_length_mm: 3650 }),
  c('MIBET MD Symmetric Rail H40 L4850mm AL6005-T5', 'MIBET\n', { bom_role: 'rail', rail_length_mm: 4850 }),
  c('MIBET MA Symmetric Rail H43 L4850mm AL6005-T5', 'MIBET', { bom_role: 'rail', rail_length_mm: 4850 }),
  c('SOEASY Base Rail F43 - 4850', 'SOEASY', { bom_role: 'rail', rail_length_mm: 4850 }),
  c('MIBET Splice Kit of T-slot MD Rail H38.5 L100mm AL6005-T5', 'MIBET', { bom_role: 'rail_joint' }),
  c('MIBET Splice Kit for MD Symmetric Rail H40 L100mm AL6005-T5', 'MIBET\n', { bom_role: 'rail_joint' }),
  c('MIBET MD U20 Inter Clamp 35-39 Kit L50mm AL6005-T5', 'MIBET', { bom_role: 'mid_clamp', clamp_thickness_mm: '35-39' }),
  c('MIBET MD U20 Inter Clamp 30-33 Kit L50mm AL6005-T5', 'MIBET', { bom_role: 'mid_clamp', clamp_thickness_mm: '30-33' }),
  c('MIBET MA U20 Inter Clamp 30 Kit L50mm AL6005-T5', 'MIBET', { bom_role: 'mid_clamp', clamp_thickness_mm: 30 }),
  c('MIBET MD End Clamp 35 Kit L50mm AL6005-T5', 'MIBET', { bom_role: 'end_clamp', clamp_thickness_mm: 35 }),
  c('MIBET MD End Clamp 30/33 Kit L50mm AL6005-T5', 'MIBET', { bom_role: 'end_clamp', clamp_thickness_mm: '30/33' }),
  c('MIBET MD Grounding Clip L40mm SUS304', 'MIBET', { bom_role: 'grounding_clip' }),
  c('MIBET MA Grounding Clip L30mm SUS304', 'MIBET', { bom_role: 'grounding_clip' }),
  c('MIBET MD L Feet Kit ￠9*t6*L40 AL6005-T5', 'MIBET\n', { bom_role: 'roof_hook', roof_type: 'metal' }),
];

test('the series is read from the model, whatever the word order', () => {
  assert.equal(seriesOf(CATALOG[0]), 'MIBET MD');   // "MD T-slot"
  assert.equal(seriesOf(CATALOG[1]), 'MIBET MD');   // "T-slot MD"
  assert.equal(seriesOf(CATALOG[3]), 'MIBET MA');
  assert.equal(seriesOf(CATALOG[4]), 'SOEASY');
});

test('a declared mounting_series spec beats the derived one', () => {
  const explicit = c('Some Rail', 'MIBET', { bom_role: 'rail', mounting_series: 'MIBET MD' });
  assert.equal(seriesOf(explicit), 'MIBET MD');
});

test('rail profile separates T-slot from symmetric', () => {
  assert.equal(railProfileOf(CATALOG[0]), 't_slot');
  assert.equal(railProfileOf(CATALOG[2]), 'symmetric');
  assert.equal(railProfileOf(CATALOG[3]), 'symmetric');
});

test('shortlisting MIBET MD keeps only that family', () => {
  const md = shortlist(CATALOG, 'MIBET MD');
  assert.ok(md.every((x) => seriesOf(x) === 'MIBET MD'));
  assert.ok(!md.some((x) => x.supplier_model.includes('MA ')));
  assert.ok(!md.some((x) => x.supplier_model.startsWith('SOEASY')));
});

test('the T-slot profile also filters the splice, not just the rail', () => {
  const md = shortlist(CATALOG, 'MIBET MD', 't_slot');
  const joints = md.filter((x) => x.specifications?.bom_role === 'rail_joint');
  assert.equal(joints.length, 1);
  assert.match(joints[0].supplier_model, /T-slot/);
  const rails = md.filter((x) => x.specifications?.bom_role === 'rail');
  assert.ok(rails.every((r) => /T-slot/i.test(r.supplier_model)));
});

test('clamps and grounding are NOT profile-filtered — they belong to the series', () => {
  const md = shortlist(CATALOG, 'MIBET MD', 't_slot');
  assert.ok(md.some((x) => x.specifications?.bom_role === 'mid_clamp'));
  assert.ok(md.some((x) => x.specifications?.bom_role === 'grounding_clip'));
});

test('the rail lengths offered come from the shortlisted rails', () => {
  const systems = mountingSystems(CATALOG, 't_slot');
  const md = systems.find((s) => s.series === 'MIBET MD');
  assert.deepEqual(md?.railLengths, [3650, 4850]);
  const ma = systems.find((s) => s.series === 'MIBET MA');
  assert.deepEqual(ma?.railLengths, []);   // MA has no T-slot rail
});

// ── Fit ranges — the bug this catalog would have exposed ────────────────────
test('a fit range covers the frame thickness inside it', () => {
  assert.equal(specCovers('35-39', 35), true);
  assert.equal(specCovers('35-39', 39), true);
  assert.equal(specCovers('35-39', 34), false);
  assert.equal(specCovers('30-33', 35), false);
});

test('a slash lists sizes, it does not span them', () => {
  assert.equal(specCovers('30/33', 30), true);
  assert.equal(specCovers('30/33', 33), true);
  assert.equal(specCovers('30/33', 31), false, '31 is not covered by a 30-or-33 part');
});

test('mixed forms — "30-34/50" is a span or a size', () => {
  assert.equal(specCovers('30-34/50', 32), true);
  assert.equal(specCovers('30-34/50', 50), true);
  assert.equal(specCovers('30-34/50', 40), false);
});

test('a plain number still means exactly that size', () => {
  assert.equal(specCovers(35, 35), true);
  assert.equal(specCovers(35, 36), false);
});

test('a 35 mm panel resolves to the MD 35-39 mid clamp, not a hand-priced line', () => {
  const line: BomLine = { role: 'mid_clamp', param: 35, qty: 12, label: 'Mid clamp 35 mm' };
  const md = shortlist(CATALOG, 'MIBET MD', 't_slot');
  const r = resolveLine(line, { candidates: md, priceOf: () => 25_000 });
  assert.equal(r.resolved, true);
  assert.match(r.description, /35-39/);
});

test('shortlisting keeps the MA clamp out of an MD design', () => {
  const line: BomLine = { role: 'mid_clamp', param: 30, qty: 4, label: 'Mid clamp 30 mm' };
  const md = shortlist(CATALOG, 'MIBET MD', 't_slot');
  const r = resolveLine(line, { candidates: md, priceOf: () => 20_000 });
  assert.equal(r.resolved, true);
  assert.match(r.description, /MD U20 Inter Clamp 30-33/);
});
