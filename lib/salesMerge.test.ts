/**
 * Two people on the same sales order at the same moment.
 *
 * Every case here is the failure the merge exists to stop: a colleague's edit
 * to a line I never touched being written back to its old value by MY save,
 * 2.5 seconds after I typed something on a completely different row. The
 * assertions are therefore about WHOSE value survives, not about shape.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mergeLines, mergeHeader, sameLine, normField, mergeMessage } from './salesMerge.ts';

type L = { key: string; description: string; quantity: string; unit_price: string; is_section?: boolean };
const line = (key: string, description: string, quantity = '1', unit_price = '100'): L =>
  ({ key, description, quantity, unit_price, is_section: false });
const descs = (ls: L[]) => ls.map((l) => `${l.key}:${l.description}`);

test('an empty string, null and undefined are the same emptiness', () => {
  assert.equal(normField('note', ''), normField('note', null));
  assert.equal(normField('note', undefined), normField('note', ''));
  assert.equal(normField('quantity', '3.0'), normField('quantity', 3), '3.0 is not an edit over 3');
  assert.equal(normField('quantity', '1,500'), '1500', 'a typed thousands separator is not an edit');
  assert.equal(normField('is_section', false), normField('is_section', undefined));
});

test('sameLine ignores the fields that never reach the database', () => {
  const a = { ...line('db-a', 'Panel'), showNote: true, key: 'db-a' };
  const b = { ...line('db-a', 'Panel'), showNote: false, key: 'db-a' };
  assert.ok(sameLine(a, b), 'a disclosure toggle is not a change to the line');
  assert.ok(!sameLine(a, { ...b, description: 'Inverter' }));
  assert.ok(!sameLine(undefined, b), 'a missing row is never equal to a present one');
});

// ── The bug this file exists for ───────────────────────────────────────────

test("a row I never touched takes THEIR value — this is the whole fix", () => {
  const base = [line('db-a', 'Panel'), line('db-b', 'Inverter')];
  const local = [line('db-a', 'Panel 550Wp'), line('db-b', 'Inverter')];   // I edited a
  const remote = [line('db-a', 'Panel'), line('db-b', 'Inverter 5kW')];    // they edited b
  const { lines, conflicts } = mergeLines(base, local, remote);
  assert.deepEqual(descs(lines), ['db-a:Panel 550Wp', 'db-b:Inverter 5kW']);
  assert.equal(conflicts, 0, 'different rows are not a conflict');
});

test('a row we BOTH edited keeps mine, and is counted so I can be told', () => {
  const base = [line('db-a', 'Panel'), line('db-b', 'Inverter')];
  const local = [line('db-a', 'Panel 550Wp'), line('db-b', 'Inverter')];
  const remote = [line('db-a', 'Panel 450Wp'), line('db-b', 'Inverter')];
  const { lines, conflicts } = mergeLines(base, local, remote);
  assert.deepEqual(descs(lines), ['db-a:Panel 550Wp', 'db-b:Inverter']);
  assert.equal(conflicts, 1);
});

test('a price change counts the same as a description change', () => {
  const base = [line('db-a', 'Panel', '2', '1000')];
  const local = [line('db-a', 'Panel', '2', '1200')];
  const remote = [line('db-a', 'Panel', '5', '1000')];
  const { lines, conflicts } = mergeLines(base, local, remote);
  assert.equal(lines[0].unit_price, '1200');
  assert.equal(lines[0].quantity, '2', 'my whole row wins, not field by field');
  assert.equal(conflicts, 1);
});

test('a line a colleague ADDED is adopted, not ignored and not deleted', () => {
  const base = [line('db-a', 'Panel')];
  const local = [line('db-a', 'Panel 550Wp')];
  const remote = [line('db-a', 'Panel'), line('db-c', 'Cable')];
  const { lines, conflicts } = mergeLines(base, local, remote);
  assert.deepEqual(descs(lines), ['db-a:Panel 550Wp', 'db-c:Cable']);
  assert.equal(conflicts, 0);
});

test('a line I am still typing has no id yet and survives the merge, last', () => {
  const base = [line('db-a', 'Panel')];
  const local = [line('db-a', 'Panel'), line('new-1', 'Mounting rail')];
  const remote = [line('db-a', 'Panel'), line('db-c', 'Cable')];
  const { lines } = mergeLines(base, local, remote);
  assert.deepEqual(descs(lines), ['db-a:Panel', 'db-c:Cable', 'new-1:Mounting rail']);
});

test('a line a colleague DELETED goes, if I had not touched it', () => {
  const base = [line('db-a', 'Panel'), line('db-b', 'Inverter')];
  const local = [line('db-a', 'Panel'), line('db-b', 'Inverter')];
  const remote = [line('db-a', 'Panel')];
  const { lines, conflicts } = mergeLines(base, local, remote);
  assert.deepEqual(descs(lines), ['db-a:Panel']);
  assert.equal(conflicts, 0);
});

test('a line a colleague deleted but I EDITED stays — losing typing is worse', () => {
  const base = [line('db-a', 'Panel'), line('db-b', 'Inverter')];
  const local = [line('db-a', 'Panel'), line('db-b', 'Inverter 5kW')];
  const remote = [line('db-a', 'Panel')];
  const { lines } = mergeLines(base, local, remote);
  assert.deepEqual(descs(lines), ['db-a:Panel', 'db-b:Inverter 5kW']);
});

test('a line I removed stays removed, and their edit to it is called out', () => {
  const base = [line('db-a', 'Panel'), line('db-b', 'Inverter')];
  const local = [line('db-a', 'Panel')];                                  // I removed b
  const remote = [line('db-a', 'Panel'), line('db-b', 'Inverter 5kW')];   // they edited b
  const { lines, conflicts } = mergeLines(base, local, remote);
  assert.deepEqual(descs(lines), ['db-a:Panel']);
  assert.equal(conflicts, 1, 'they should hear that their edit is being dropped');
});

test('a row I removed that they left alone drops silently', () => {
  const base = [line('db-a', 'Panel'), line('db-b', 'Inverter')];
  const local = [line('db-a', 'Panel')];
  const remote = [line('db-a', 'Panel'), line('db-b', 'Inverter')];
  const { lines, conflicts } = mergeLines(base, local, remote);
  assert.deepEqual(descs(lines), ['db-a:Panel']);
  assert.equal(conflicts, 0);
});

// ── Order ──────────────────────────────────────────────────────────────────

test('the database order wins while I have not dragged anything', () => {
  const base = [line('db-a', 'Panel'), line('db-b', 'Inverter')];
  const local = [line('db-a', 'Panel 550Wp'), line('db-b', 'Inverter')];
  const remote = [line('db-b', 'Inverter'), line('db-a', 'Panel')];      // they reordered
  const { lines } = mergeLines(base, local, remote);
  assert.deepEqual(descs(lines), ['db-b:Inverter', 'db-a:Panel 550Wp']);
});

test('a drag I just made is an edit, so MY order is the one that shows', () => {
  const base = [line('db-a', 'Panel'), line('db-b', 'Inverter'), line('db-c', 'Cable')];
  const local = [line('db-c', 'Cable'), line('db-a', 'Panel'), line('db-b', 'Inverter')];
  const remote = [line('db-a', 'Panel'), line('db-b', 'Inverter 5kW'), line('db-c', 'Cable')];
  const { lines } = mergeLines(base, local, remote);
  assert.deepEqual(descs(lines), ['db-c:Cable', 'db-a:Panel', 'db-b:Inverter 5kW'],
    'my order, their text — both survive');
});

test('nothing changed anywhere is a no-op that keeps every row exactly once', () => {
  const rows = [line('db-a', 'Panel'), line('db-b', 'Inverter')];
  const { lines, conflicts } = mergeLines(rows, rows, rows);
  assert.deepEqual(descs(lines), ['db-a:Panel', 'db-b:Inverter']);
  assert.equal(conflicts, 0);
});

test('an empty order merging a colleague\'s first lines takes all of them', () => {
  const { lines } = mergeLines<L>([], [], [line('db-a', 'Panel'), line('db-b', 'Inverter')]);
  assert.deepEqual(descs(lines), ['db-a:Panel', 'db-b:Inverter']);
});

// ── Header ─────────────────────────────────────────────────────────────────

type H = Record<string, unknown>;
const head = (o: Partial<H> = {}): H => ({
  status: 'draft', customer_id: 'c1', notes: '', payment_terms: '30 hari', ppn_pct: 11, ...o,
});

test('a header field I did not touch takes theirs, field by field', () => {
  const base = head();
  const local = head({ notes: 'Deliver to site B' });
  const remote = head({ payment_terms: '60 hari' });
  const { header, conflicts } = mergeHeader(base, local, remote);
  assert.equal(header.notes, 'Deliver to site B');
  assert.equal(header.payment_terms, '60 hari', 'their terms are not reverted by my note');
  assert.equal(conflicts, 0);
});

test('a header field we both changed keeps mine and is counted', () => {
  const { header, conflicts } = mergeHeader(head(), head({ notes: 'mine' }), head({ notes: 'theirs' }));
  assert.equal(header.notes, 'mine');
  assert.equal(conflicts, 1);
});

test('status always comes from the database — a stale tab can never write it back', () => {
  const local = head({ status: 'draft', notes: 'mine' });
  const remote = head({ status: 'ordered', order_number: 'SO-20260828-0007' });
  const { header } = mergeHeader(head(), local, remote);
  assert.equal(header.status, 'ordered', 'this is the un-confirming bug');
  assert.equal(header.order_number, 'SO-20260828-0007', 'and the stamped number comes with it');
  assert.equal(header.notes, 'mine');
});

test('11 typed over 11 is not a change, so their PPN is not clobbered', () => {
  const { header, conflicts } = mergeHeader(head(), head({ ppn_pct: '11' }), head({ ppn_pct: 12 }));
  assert.equal(header.ppn_pct, 12);
  assert.equal(conflicts, 0);
});

// ── What the person is told ────────────────────────────────────────────────

test('the message names the colleague and counts only the overlapping lines', () => {
  assert.equal(mergeMessage('sarah@ica.id', 0), "↻ Merged sarah@ica.id's changes");
  assert.equal(mergeMessage('sarah@ica.id', 1), "↻ Merged sarah@ica.id's changes — 1 line you both edited (yours shown)");
  assert.equal(mergeMessage('sarah@ica.id', 2), "↻ Merged sarah@ica.id's changes — 2 lines you both edited (yours shown)");
  assert.equal(mergeMessage('', 0), "↻ Merged a colleague's changes", 'an unstamped row still reads as a sentence');
});
