/**
 * The feeds' only real logic is the merge — and that is where the quiet
 * failures live: an undated row taking the top spot because an empty string
 * sorts high, or two sources interleaving by the order they were fetched
 * rather than by when they happened.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mergeRecent, type FeedRow } from './recentFeeds.ts';

const row = (key: string, at: string, over: Partial<FeedRow> = {}): FeedRow => ({
  key, at, title: key, sub: '', direction: 'neutral', href: '/', ...over,
});

test('newest first, whichever source it came from', () => {
  const merged = mergeRecent([
    row('out-1', '2026-08-01'),
    row('in-1', '2026-08-20'),
    row('out-2', '2026-08-15'),
    row('in-2', '2026-07-01'),
  ], 5);
  assert.deepEqual(merged.map((r) => r.key), ['in-1', 'out-2', 'out-1', 'in-2']);
});

test('an undated event sorts last, never first', () => {
  // An empty date string sorts ABOVE every real date in a naive compare, which
  // would put "we do not know when this happened" at the top of a feed whose
  // entire promise is recency.
  const merged = mergeRecent([row('dated', '2026-08-01'), row('undated', '')], 5);
  assert.deepEqual(merged.map((r) => r.key), ['dated', 'undated']);
});

test('the cap is a cap, and it keeps the newest', () => {
  const rows = Array.from({ length: 12 }, (_, i) =>
    row(`r${i}`, `2026-08-${String(i + 1).padStart(2, '0')}`));
  const merged = mergeRecent(rows, 5);
  assert.equal(merged.length, 5);
  assert.equal(merged[0].key, 'r11', 'the newest survives the cap');
  assert.equal(merged[4].key, 'r7');
});

test('two events on the same day keep a stable order rather than shuffling', () => {
  const a = mergeRecent([row('b', '2026-08-01'), row('a', '2026-08-01')], 5);
  const b = mergeRecent([row('a', '2026-08-01'), row('b', '2026-08-01')], 5);
  assert.deepEqual(a.map((r) => r.key), b.map((r) => r.key),
    'the same day must not reorder itself between loads');
});

test('merging leaves the caller’s array alone', () => {
  const rows = [row('a', '2026-08-01'), row('b', '2026-08-20')];
  mergeRecent(rows, 1);
  assert.deepEqual(rows.map((r) => r.key), ['a', 'b'], 'sorting in place would reorder the caller’s data');
});
