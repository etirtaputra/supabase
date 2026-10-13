/**
 * The agent's view of the Progress board must be the board's view.
 *
 * Built for MIRA's three-way sync (ICAPROC ↔ Dolibarr ↔ Basecamp PROGRESS
 * IMPOR, owner 2026-10-13). The cases are the ones read off the real board
 * that day: TRISINDO PO-038 was Fully Received in ICAPROC while its Basecamp
 * card still sat in "PO SENT".
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { progressRow, basecampColumnFor, BASECAMP_DONE } from './progressExport.ts';
import { MILESTONES, milestonesReached } from './poProgress.ts';

type AnyPo = Parameters<typeof milestonesReached>[0];
type AnyCost = Parameters<typeof milestonesReached>[1][number];

const po = (o: Partial<AnyPo> = {}): AnyPo => ({
  po_id: 1 as never, po_number: 'PIO-1', po_date: '2026-08-01', pi_number: 'PI-1',
  currency: 'CNY' as never, exchange_rate: 2645, total_value: 1000, status: 'Confirmed' as never,
  ...o,
} as AnyPo);

const cost = (cat: string, amount: number, currency = 'CNY'): AnyCost =>
  ({ cost_id: `c${Math.random()}`, po_id: 1, cost_category: cat, amount, currency } as unknown as AnyCost);

test('the Basecamp columns are the milestone labels in capitals, as on the real board', () => {
  // Read off PROGRESS IMPOR on 2026-10-13. If a milestone is renamed, the
  // board in Basecamp has to be renamed too, and this test says so.
  const onBasecamp = ['PI RECEIVED', 'PO SENT', 'DP PAID', 'BALANCE PAID',
    'DOCS CHECKED', 'HARD COPY RECEIVED', 'PIB & OPS PAID'];
  assert.deepEqual(MILESTONES.map((m) => basecampColumnFor(m.id, false)), onBasecamp);
  assert.equal(basecampColumnFor('po_sent', true), BASECAMP_DONE);
  assert.equal(basecampColumnFor(null, false), null);
});

test('a confirmed PO with nothing paid belongs in PO SENT', () => {
  const r = progressRow(po(), []);
  assert.equal(r.stage, 'po_sent');
  assert.equal(r.basecamp_column, 'PO SENT');
  assert.equal(r.complete, false);
});

test('Fully Received and paid in full is Done — the TRISINDO PO-038 case', () => {
  const r = progressRow(po({ status: 'Fully Received' as never, currency: 'IDR' as never, exchange_rate: 1 }),
    [cost('balance_payment', 1000, 'IDR')]);
  assert.equal(r.goods_received, true);
  assert.equal(r.complete, true);
  assert.equal(r.basecamp_column, 'Done');
});

test('goods in and paid, customs never recorded: NOT done, and the alarm is up', () => {
  const r = progressRow(po({ status: 'Fully Received' as never }), [cost('balance_payment', 1000)]);
  assert.equal(r.import_costs_outstanding, true);
  assert.equal(r.complete, false);
  assert.equal(r.basecamp_column, 'BALANCE PAID');
});

test('the route runs the board\'s own functions, not a copy of them', () => {
  const src = readFileSync(join(process.cwd(), 'app', 'api', 'agent', 'purchasing', 'progress', 'route.ts'), 'utf8');
  assert.match(src, /progressRow/);
  assert.ok(!/down_payment|balance_paid\s*:/.test(src), 'the route is deciding stages itself');
});
