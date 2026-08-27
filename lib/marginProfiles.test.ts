/**
 * Margin profiles, kept honest.
 *
 * Two claims matter here and both are in the owner's acceptance criteria:
 * the target bands are DATA (so nothing may assume 10–15 / 20–25), and an
 * unclassified item is never silently treated as belonging to a tier.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { standingOf, bandOf, rangeError, byId, type MarginProfile } from './marginProfiles.ts';

const loss: MarginProfile = {
  id: 'p1', code: 'loss_leader', label: 'Loss Leader',
  margin_target_min: 10, margin_target_max: 15, description: null,
};
const value: MarginProfile = {
  id: 'p2', code: 'value_capture', label: 'Value Capture',
  margin_target_min: 20, margin_target_max: 25, description: null,
};

test('a margin is judged against its own profile, not a fixed number', () => {
  // 18% is ABOVE target for a loss leader and BELOW target for value capture.
  // Any code that hardcoded one band would have to get one of these wrong.
  assert.equal(standingOf(18, loss), 'above');
  assert.equal(standingOf(18, value), 'below');
});

test('the band edges are inclusive — hitting the target is being on target', () => {
  assert.equal(standingOf(10, loss), 'within');
  assert.equal(standingOf(15, loss), 'within');
  assert.equal(standingOf(9.99, loss), 'below');
  assert.equal(standingOf(15.01, loss), 'above');
});

test('an item with no profile is unclassified, never assumed into a tier', () => {
  assert.equal(standingOf(12, null), 'unclassified');
  assert.equal(standingOf(12, undefined), 'unclassified');
  assert.equal(standingOf(0, null), 'unclassified',
    'a 0% margin with no profile is still unknown, not "below target"');
});

test('a margin nobody can compute is unclassified, not zero', () => {
  // No cost on the item means no margin — saying "below target" there would
  // be inventing a fault out of missing data.
  assert.equal(standingOf(null, loss), 'unclassified');
  assert.equal(standingOf(undefined, loss), 'unclassified');
  assert.equal(standingOf(NaN, loss), 'unclassified');
  assert.equal(standingOf(Infinity, loss), 'unclassified');
});

test('the band reads from the row, so an edited target shows the new numbers', () => {
  assert.equal(bandOf(loss), '10–15%');
  assert.equal(bandOf({ ...loss, margin_target_min: 12, margin_target_max: 18 }), '12–18%');
  assert.equal(bandOf({ ...loss, margin_target_min: 12.5, margin_target_max: 17.5 }), '12.5–17.5%');
});

test('a range the admin could not have meant is refused before it is saved', () => {
  assert.equal(rangeError(10, 15), null);
  assert.equal(rangeError(15, 15), null, 'a single-point target is allowed');
  assert.ok(rangeError(20, 10), 'backwards range');
  assert.ok(rangeError(-1, 10), 'negative floor');
  assert.ok(rangeError(10, 140), 'over 100%');
  assert.ok(rangeError(NaN, 10), 'empty field');
});

test('profiles index by id so a list can turn a column into a label', () => {
  const m = byId([loss, value]);
  assert.equal(m.get('p1')?.label, 'Loss Leader');
  assert.equal(m.get('p2')?.label, 'Value Capture');
  assert.equal(m.get('nope'), undefined, 'an unknown id must not resolve to a tier');
});
