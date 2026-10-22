/**
 * quoteFlags — proposal lines waiting on a price or a technical answer. The
 * case that prompted it: AYANA BOH & Atap Ballroom, waiting on the updated
 * price of the ACDP (AC Electrical Box), tagged to whoever chases it.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { openFlagByItem, waitingLines, openFlagsByQuote, personName, lineHistory, isOpenFlag, type QuoteFlag } from './quoteFlags.ts';

const flag = (over: Partial<QuoteFlag>): QuoteFlag => ({
  flag_id: 1, quote_id: 'q', item_id: 'acdp', kind: 'price', assignee_email: 'budi@ica.id', note: '',
  created_by_email: 'eric@ica.id', created_at: '2026-10-22T08:00:00Z', resolved_at: null, resolved_by_email: null, ...over,
});

test('a cleared flag is history, not waiting', () => {
  const cleared = flag({ resolved_at: '2026-10-24T02:00:00Z', resolved_by_email: 'budi@ica.id' });
  assert.equal(isOpenFlag(cleared), false);
  assert.equal(openFlagByItem([cleared]).size, 0);
  assert.deepEqual(waitingLines([cleared], [{ item_id: 'acdp', description: 'AC Electrical Box' }]), []);
});

test('the waiting list walks the proposal top to bottom, not by when it was flagged', () => {
  const flags = [
    flag({ flag_id: 1, item_id: 'tray', kind: 'technical', created_at: '2026-10-21T00:00:00Z' }),
    flag({ flag_id: 2, item_id: 'acdp', created_at: '2026-10-22T00:00:00Z' }),
  ];
  const lines = [
    { item_id: 'cable', description: 'KMI NYY 1x95' },
    { item_id: 'acdp', description: '  AC Electrical Box Free Standing  ' },
    { item_id: 'tray', description: 'Cable Tray HDG' },
  ];
  const w = waitingLines(flags, lines);
  assert.deepEqual(w.map((x) => x.itemId), ['acdp', 'tray']);
  assert.equal(w[0].description, 'AC Electrical Box Free Standing');
});

test('a flag on a line that is gone from the page is not offered as a place to go', () => {
  assert.deepEqual(waitingLines([flag({ item_id: 'deleted' })], [{ item_id: 'acdp', description: 'x' }]), []);
});

test('one line, two open flags: the newest is the one shown', () => {
  const m = openFlagByItem([
    flag({ flag_id: 1, created_at: '2026-10-20T00:00:00Z', assignee_email: 'abel@ica.id' }),
    flag({ flag_id: 2, created_at: '2026-10-22T00:00:00Z' }),
  ]);
  assert.equal(m.get('acdp')?.flag_id, 2);
});

test('a line keeps its whole story, newest first', () => {
  const h = lineHistory([
    flag({ flag_id: 1, created_at: '2026-10-20T00:00:00Z', resolved_at: '2026-10-21T00:00:00Z' }),
    flag({ flag_id: 2, created_at: '2026-10-22T00:00:00Z' }),
    flag({ flag_id: 3, item_id: 'other' }),
  ], 'acdp');
  assert.deepEqual(h.map((f) => f.flag_id), [2, 1]);
});

test('the Proposals list: count per proposal, each person named once', () => {
  const m = openFlagsByQuote([
    { quote_id: 'ayana', assignee_email: 'budi@ica.id' },
    { quote_id: 'ayana', assignee_email: 'budi@ica.id' },
    { quote_id: 'ayana', assignee_email: 'abel@ica.id' },
    { quote_id: 'other', assignee_email: 'eric@ica.id' },
  ]);
  assert.deepEqual(m.get('ayana'), { n: 3, people: ['Budi', 'Abel'] });
  assert.deepEqual(m.get('other'), { n: 1, people: ['Eric'] });
});

test('people are called by name, without the domain', () => {
  assert.equal(personName('budi@ica.id'), 'Budi');
  assert.equal(personName('suwarti.icasolar@gmail.com'), 'Suwarti Icasolar');
  assert.equal(personName(''), '—');
});
