import test from 'node:test';
import assert from 'node:assert/strict';
import { clearAfter } from './inboxFiling.ts';

const d = (s: string) => Date.parse(s);

test('filed in Drive: the ICAPROC copy may go 30 days later', () => {
  assert.equal(clearAfter({ status: 'done', filed_at: '2026-11-01T00:00:00Z' }), d('2026-12-01T00:00:00Z'));
});

test('dismissed: 30 days after it was dismissed', () => {
  assert.equal(clearAfter({ status: 'dismissed', dismissed_at: '2026-11-01T00:00:00Z' }), d('2026-12-01T00:00:00Z'));
});

test('a deal not yet filed, or anything still open, is never deleted', () => {
  assert.equal(clearAfter({ status: 'done' }), null);
  assert.equal(clearAfter({ status: 'proposed' }), null);
  // Put back after a dismissal: the old date no longer counts.
  assert.equal(clearAfter({ status: 'proposed', dismissed_at: '2026-01-01T00:00:00Z' }), null);
});
