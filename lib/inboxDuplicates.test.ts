import test from 'node:test';
import assert from 'node:assert/strict';
import { dealsFrom, findDuplicates, DUP_TEXTS, type DupDoc } from './inboxDuplicates.ts';

const deals = dealsFrom(
  [
    { quote_id: 'q1', pi_number: 'PI-2026092101', supplier_id: 's1', total_value: 1000, currency: 'USD', quote_date: '2026-09-21' },
    { quote_id: 'q2', pi_number: 'Q-77', supplier_id: 's2', total_value: 500, currency: 'USD', quote_date: '2026-11-01' },
  ],
  [{ po_id: 'p1', po_number: 'PIO-016-ISL-09-2026', pi_number: 'PI-2026092101', quote_id: 'q1', supplier_id: 's1', total_value: 1000, currency: 'USD', pi_date: '2026-09-21' }],
);
const doc = (o: Partial<DupDoc>): DupDoc => ({ supplier_id: 's1', numbers: [], total: null, currency: 'USD', date: null, ...o });

test('a quote with a PO is one deal, a quote without one is its own', () => {
  assert.deepEqual(deals.map((d) => d.label), ['PIO-016-ISL-09-2026', 'Q-77']);
});

test('same number however it was written — PI or PO number', () => {
  assert.equal(findDuplicates(doc({ numbers: ['pi 2026/092101'] }), deals)[0].kind, 'same');
  assert.equal(findDuplicates(doc({ numbers: ['PIO016ISL092026'] }), deals)[0].label, 'PIO-016-ISL-09-2026');
});

test('same number from ANOTHER supplier is not a duplicate; unknown supplier matches by number', () => {
  assert.deepEqual(findDuplicates(doc({ supplier_id: 's9', numbers: ['PI-2026092101'] }), deals), []);
  assert.equal(findDuplicates(doc({ supplier_id: null, numbers: ['PI-2026092101'] }), deals).length, 1);
});

test('totals within half a percent are the same document; beyond, a revision', () => {
  assert.equal(findDuplicates(doc({ numbers: ['PI-2026092101'], total: 1004 }), deals)[0].kind, 'same');
  assert.equal(findDuplicates(doc({ numbers: ['PI-2026092101'], total: 1200 }), deals)[0].kind, 'revision');
});

test('no number read: same supplier, currency and total within 120 days is a lookalike', () => {
  assert.equal(findDuplicates(doc({ total: 1000, date: '2026-10-01' }), deals)[0].kind, 'lookalike');
  assert.deepEqual(findDuplicates(doc({ total: 1000, date: '2027-06-01' }), deals), []);
  assert.deepEqual(findDuplicates(doc({ total: 1000, currency: 'CNY' }), deals), []);
  // A number WAS read and matches nothing: a repeat order of the same amount is not flagged.
  assert.deepEqual(findDuplicates(doc({ numbers: ['PI-NEW-1'], total: 1000 }), deals), []);
});

test('the Inbox: itself, dismissed and done documents never count', () => {
  const inbox = ['proposed', 'dismissed', 'done'].map((status, i) => ({
    item_id: `i${i}`, file_name: `f${i}.pdf`, received_at: '2026-11-22T00:00:00Z', status,
    supplier_id: 's1', numbers: ['NEW-9'], total: 10, currency: 'USD', date: null,
  }));
  assert.deepEqual(findDuplicates(doc({ item_id: 'x', numbers: ['NEW 9'] }), [], inbox).map((h) => h.item_id), ['i0']);
  assert.deepEqual(findDuplicates(doc({ item_id: 'i0', numbers: ['NEW 9'] }), [], inbox), []);
});

test('every duplicate phrase is in the phrase book', async () => {
  const { ID } = await import('./i18n.ts');
  for (const t of DUP_TEXTS) assert.ok(ID[t], `no Indonesian for: ${t}`);
});
