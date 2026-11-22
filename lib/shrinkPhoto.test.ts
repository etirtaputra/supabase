import test from 'node:test';
import assert from 'node:assert/strict';
import { shrunkSize, PHOTO_MAX_EDGE } from './shrinkPhoto.ts';

test('a 12-megapixel phone photo is drawn at 1600 px on its long edge, proportions kept', () => {
  assert.deepEqual(shrunkSize(4032, 3024), { w: 1600, h: 1200 });
  assert.deepEqual(shrunkSize(3024, 4032), { w: 1200, h: 1600 });
});

test('a photo already small enough is never enlarged', () => {
  assert.deepEqual(shrunkSize(1280, 960), { w: 1280, h: 960 });
});

test('1600 px: at or above what the reader looks at (about 1568 px)', () => {
  assert.ok(PHOTO_MAX_EDGE >= 1568);
});
