import { test } from 'node:test';
import assert from 'node:assert/strict';
import { winsFrom, unseenWins, winSeenKey, type WinQuoteRow } from './proposalWins.ts';

const Q = (id: string, status: string, o: Partial<WinQuoteRow> = {}): WinQuoteRow => ({
  quote_id: id, quote_number: `Q-${id}`, customer_name: 'PT Delta Marlin Sandang Tekstile ', location: 'Delta Mas 1',
  status, created_by_email: 'adminproject@ptmbs.co', ...o,
});

test('a win is the latest move to accepted on a proposal that is still accepted', () => {
  const wins = winsFrom([
    { quote_id: 'a', actor_email: 'eric@ica.id', at: '2026-10-05T03:00:00Z', detail: 'sent -> accepted' },
    { quote_id: 'a', actor_email: 'eric@ica.id', at: '2026-10-04T03:00:00Z', detail: 'sent -> accepted' },
    { quote_id: 'b', actor_email: 'eric@ica.id', at: '2026-10-05T04:00:00Z', detail: 'sent -> accepted' },   // reversed since
    { quote_id: 'c', actor_email: 'eric@ica.id', at: '2026-10-05T05:00:00Z', detail: 'draft -> sent' },      // not a win
  ], [Q('a', 'accepted'), Q('b', 'sent'), Q('c', 'sent')], new Map([['a', 13_322_527_347]]));
  assert.equal(wins.length, 1);
  assert.deepEqual(
    { id: wins[0].quoteId, at: wins[0].wonAt, value: wins[0].value, customer: wins[0].customer, by: wins[0].markedBy, made: wins[0].madeBy },
    { id: 'a', at: '2026-10-05T03:00:00Z', value: 13_322_527_347, customer: 'PT Delta Marlin Sandang Tekstile', by: 'eric@ica.id', made: 'adminproject@ptmbs.co' });
});

test('each person celebrates a win once; a win re-marked later celebrates again', () => {
  const w = winsFrom([{ quote_id: 'a', actor_email: 'e', at: '2026-10-05T03:00:00Z', detail: 'sent -> accepted' }], [Q('a', 'accepted')], new Map());
  assert.equal(unseenWins(w, []).length, 1);
  assert.equal(unseenWins(w, [winSeenKey(w[0])]).length, 0);
  assert.equal(unseenWins(w, ['a@2026-09-01T00:00:00Z']).length, 1);
});
