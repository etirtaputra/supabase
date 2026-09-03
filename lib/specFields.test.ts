/**
 * specFields — one table read by the form, the comparison and SpecRenderer.
 *
 * The comparison is the reason these live together: a field the form calls
 * "Max PV Voc" must be called that in every column, or a side-by-side table
 * is comparing two different questions.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { CATEGORY_SPEC_FIELDS } from './specSchema.ts';
import {
  SPEC_FIELD_META, SPEC_GROUP_ORDER, fieldMeta, fieldsInGroup, groupsFor,
  isAnswered, displaySpecValue, prettifyKey,
} from './specFields.ts';

test('every declared field of every category has metadata', () => {
  const missing: string[] = [];
  for (const [cat, fields] of Object.entries(CATEGORY_SPEC_FIELDS)) {
    for (const key of fields ?? []) if (!(key in SPEC_FIELD_META)) missing.push(`${cat}.${key}`);
  }
  assert.deepEqual(missing, [], 'a declared field with no metadata renders as a raw key');
});

test('every declared group is one the order knows about', () => {
  const unknown = Object.entries(SPEC_FIELD_META)
    .filter(([, m]) => !(SPEC_GROUP_ORDER as readonly string[]).includes(m.group))
    .map(([k]) => k);
  assert.deepEqual(unknown, [], 'a group outside SPEC_GROUP_ORDER never renders');
});

test('grouping a category loses no field and invents none', () => {
  for (const fields of Object.values(CATEGORY_SPEC_FIELDS)) {
    const list = (fields ?? []) as readonly string[];
    const regrouped = groupsFor(list).flatMap((g) => fieldsInGroup(list, g));
    assert.equal(regrouped.length, list.length);
    assert.deepEqual([...regrouped].sort(), [...list].sort());
  }
});

test('an undeclared key still gets a label rather than being swallowed', () => {
  const m = fieldMeta('hail_impact_diameter_mm');
  assert.equal(m.label, 'Hail Impact Diameter Mm');
  assert.equal(m.group, 'General');
  assert.equal(m.kind, 'text');
});

test('kind is declared, never guessed from the suffix', () => {
  // Both end in a unit; one is a number and the other a range a number input
  // would refuse. This is why `kind` is written down.
  assert.equal(fieldMeta('weight_kg').kind, 'number');
  assert.equal(fieldMeta('operating_temperature_range_c').kind, 'text');
  assert.equal(fieldMeta('certifications').kind, 'list');
  assert.equal(fieldMeta('bifacial').kind, 'boolean');
});

test('null is unanswered; zero and false are answers', () => {
  assert.equal(isAnswered(null), false);
  assert.equal(isAnswered(undefined), false);
  assert.equal(isAnswered('  '), false);
  assert.equal(isAnswered([]), false);
  assert.equal(isAnswered(0), true);
  assert.equal(isAnswered(false), true);
});

test('a value reads the way a person would say it', () => {
  assert.equal(displaySpecValue(null), '—');
  assert.equal(displaySpecValue(true), 'Yes');
  assert.equal(displaySpecValue(false), 'No');
  assert.equal(displaySpecValue(['IEC 61215', 'IEC 61730']), 'IEC 61215, IEC 61730');
  assert.equal(displaySpecValue(42), '42');
  assert.equal(prettifyKey('packing_pcs_per_pallet'), 'Packing Pcs Per Pallet');
});
