/**
 * The API's wiring, pinned to the engine's own golden numbers.
 *
 * `calculateMounting` is already proven against the v11 calculator. What is
 * NEW here is the layer between an HTTP body and that engine — defaults and
 * string→number coercion — and that is exactly where an API quietly stops
 * matching the screen it claims to mirror. So these tests feed the route's
 * normaliser and check the ENGINE'S OUTPUT against the numbers in the design
 * pack's worked example, not against the normaliser's own fields.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { mountingInputFrom } from './mountingInput.ts';
import { calculateMounting } from './mounting.ts';

test('an agent posting the pack\'s worked example gets the pack\'s numbers', () => {
  // docs/agents/MANDA-SOLAR-DESIGN §3.4: 4 panels, 1 row, portrait,
  // 2278×1134×35, 4850 rail, 20 mm spacing, roof.
  const { input, missing } = mountingInputFrom({
    panelCount: 4, panelLengthMm: 2278, panelWidthMm: 1134,
    panelThicknessMm: 35, railLengthMm: 4850,
  });
  assert.deepEqual(missing, []);
  const r = calculateMounting(input);
  assert.equal(r.ok, true);
  assert.equal(r.panelsPerRow, 4);
  assert.equal(r.arrayWidthMm, 4596);
  assert.equal(r.edgeSpacingMm, 127);
  assert.equal(r.totalRails, 2);
  assert.equal(r.endClamps, 4);
  assert.equal(r.midClamps, 6);
  assert.equal(r.supports, 8);
  assert.equal(r.groundingLugs, 2);
  assert.deepEqual(r.warnings, []);
});

test('strings from JSON coerce, so a body typed by an agent behaves', () => {
  const { input } = mountingInputFrom({
    panelCount: '4', panelLengthMm: ' 2278 ', panelWidthMm: '1134', railLengthMm: '4850',
  });
  const r = calculateMounting(input);
  assert.equal(r.edgeSpacingMm, 127, 'a quoted number must size the same as a bare one');
  assert.equal(r.midClamps, 6);
});

test('the defaults are the designer screen\'s, not invented here', () => {
  const { input } = mountingInputFrom({
    panelCount: 4, panelLengthMm: 2278, panelWidthMm: 1134, railLengthMm: 4850,
  });
  assert.equal(input.numberOfRows, 1);
  assert.equal(input.panelSpacingMm, 20);
  assert.equal(input.panelThicknessMm, 35);
  assert.equal(input.mountType, 'roof');
  assert.equal(input.orientation, 'portrait');
});

test('a nonsense mountType falls back rather than reaching the engine', () => {
  const { input } = mountingInputFrom({
    panelCount: 4, panelLengthMm: 2278, panelWidthMm: 1134, railLengthMm: 4850,
    mountType: 'trebuchet', orientation: 'sideways',
  });
  assert.equal(input.mountType, 'roof');
  assert.equal(input.orientation, 'portrait');
});

test('landscape is honoured, and changes the answer', () => {
  const base = { panelCount: 12, numberOfRows: 2, panelLengthMm: 2278, panelWidthMm: 1134,
                 panelThicknessMm: 35, railLengthMm: 4850, panelSpacingMm: 20 };
  const land = calculateMounting(mountingInputFrom({ ...base, orientation: 'landscape' }).input);
  // Golden row from mounting.test.ts: 12 panels, 2 rows, landscape, ground.
  assert.equal(land.totalRails, 12);
  assert.equal(land.railJoints, 8);
  assert.equal(land.midClamps, 20);
  assert.equal(land.supports, 48);
  assert.equal(land.edgeSpacingMm, 391);
});

test('a missing dimension is named, never guessed', () => {
  const { missing } = mountingInputFrom({ panelCount: 4, railLengthMm: 4850 });
  assert.deepEqual(missing, ['panelLengthMm', 'panelWidthMm']);

  const empty = mountingInputFrom({});
  assert.deepEqual(empty.missing, ['panelCount', 'panelLengthMm', 'panelWidthMm', 'railLengthMm']);
});

test('garbage in a numeric field is zero, so it reports as missing', () => {
  const { missing } = mountingInputFrom({
    panelCount: 'four', panelLengthMm: 2278, panelWidthMm: 1134, railLengthMm: 4850,
  });
  assert.deepEqual(missing, ['panelCount'], 'better a 400 than a design built on NaN');
});
