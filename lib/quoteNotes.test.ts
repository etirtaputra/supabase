/**
 * The follow-up thread, kept honest.
 *
 * The list asks one question of this module — "what is this proposal waiting
 * on?" — and the answer has to be the NEWEST note still open, not the newest
 * note, and not the oldest open one. Getting that wrong shows a settled note
 * on a live row, which is worse than showing nothing: it reads as a job still
 * to do.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isOpen, threadOrder, newestOpenByQuote, openCountByQuote, type QuoteNote } from './quoteNotes.ts';

let seq = 0;
const note = (o: Partial<QuoteNote> & { quote_id: string; created_at: string }): QuoteNote => ({
  note_id: ++seq, body: 'note', author_email: 'eric@ica.id',
  cleared_at: null, cleared_by_email: null, ...o,
});

test('a note is open until somebody ticks it off', () => {
  assert.equal(isOpen(note({ quote_id: 'a', created_at: '2026-08-27T01:00:00Z' })), true);
  assert.equal(isOpen(note({ quote_id: 'a', created_at: '2026-08-27T01:00:00Z', cleared_at: '2026-08-27T02:00:00Z' })), false);
});

test('the thread reads newest first', () => {
  const rows = [
    note({ quote_id: 'a', created_at: '2026-08-20T09:00:00Z', body: 'older' }),
    note({ quote_id: 'a', created_at: '2026-08-27T09:00:00Z', body: 'newest' }),
    note({ quote_id: 'a', created_at: '2026-08-24T09:00:00Z', body: 'middle' }),
  ];
  assert.deepEqual(threadOrder(rows).map((n) => n.body), ['newest', 'middle', 'older']);
  // Two notes in the same minute still come out in a stable, sensible order.
  const tie = [
    note({ quote_id: 'a', created_at: '2026-08-27T09:00:00Z', body: 'first typed' }),
    note({ quote_id: 'a', created_at: '2026-08-27T09:00:00Z', body: 'second typed' }),
  ];
  assert.deepEqual(threadOrder(tie).map((n) => n.body), ['second typed', 'first typed']);
});

test('threadOrder does not disturb the array it was given', () => {
  const rows = [
    note({ quote_id: 'a', created_at: '2026-08-20T09:00:00Z', body: 'older' }),
    note({ quote_id: 'a', created_at: '2026-08-27T09:00:00Z', body: 'newest' }),
  ];
  const before = rows.map((n) => n.body);
  threadOrder(rows);
  assert.deepEqual(rows.map((n) => n.body), before);
});

test('the list shows the newest note STILL OPEN, not simply the newest', () => {
  const rows = [
    note({ quote_id: 'a', created_at: '2026-08-21T09:00:00Z', body: 'Awaiting answer from the customer' }),
    // Newer, but settled — showing this on the row would read as a live job.
    note({ quote_id: 'a', created_at: '2026-08-26T09:00:00Z', body: 'Sent revised BoQ', cleared_at: '2026-08-26T10:00:00Z' }),
  ];
  assert.equal(newestOpenByQuote(rows).get('a')?.body, 'Awaiting answer from the customer');
});

test('every proposal answers for itself', () => {
  const rows = [
    note({ quote_id: 'a', created_at: '2026-08-27T09:00:00Z', body: 'a-new' }),
    note({ quote_id: 'b', created_at: '2026-08-25T09:00:00Z', body: 'b-only' }),
    note({ quote_id: 'a', created_at: '2026-08-20T09:00:00Z', body: 'a-old' }),
  ];
  const m = newestOpenByQuote(rows);
  assert.equal(m.get('a')?.body, 'a-new');
  assert.equal(m.get('b')?.body, 'b-only');
  assert.equal(m.size, 2);
});

test('a proposal whose notes are all ticked off goes quiet', () => {
  const rows = [
    note({ quote_id: 'a', created_at: '2026-08-20T09:00:00Z', cleared_at: '2026-08-21T09:00:00Z' }),
    note({ quote_id: 'a', created_at: '2026-08-24T09:00:00Z', cleared_at: '2026-08-25T09:00:00Z' }),
  ];
  assert.equal(newestOpenByQuote(rows).has('a'), false,
    'a settled proposal must show nothing, not its last settled note');
  assert.equal(openCountByQuote(rows).get('a'), undefined);
});

test('no notes at all is not an error', () => {
  assert.equal(newestOpenByQuote([]).size, 0);
  assert.equal(openCountByQuote([]).size, 0);
});

test('the count is of what is still open', () => {
  const rows = [
    note({ quote_id: 'a', created_at: '2026-08-20T09:00:00Z' }),
    note({ quote_id: 'a', created_at: '2026-08-24T09:00:00Z' }),
    note({ quote_id: 'a', created_at: '2026-08-25T09:00:00Z', cleared_at: '2026-08-26T09:00:00Z' }),
    note({ quote_id: 'b', created_at: '2026-08-25T09:00:00Z' }),
  ];
  assert.equal(openCountByQuote(rows).get('a'), 2);
  assert.equal(openCountByQuote(rows).get('b'), 1);
});
