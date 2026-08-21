/**
 * What just landed, and what is on its way — proved without a database.
 *
 * The failures worth guarding here are the quiet ones: a restock counted as a
 * brand-new product, an estimated date presented as a promise, or a sell-side
 * reader handed a PO number. Each of those is a number that looks right.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  receiptDates, newArrivals, summariseArrivals, itemName,
  type CompRow, type ReceiptMove, type BalanceRow, type PoLine,
} from './catalogSignals.ts';
import type { OpenPo } from './inTransit.ts';

const NOW = '2026-08-20T00:00:00Z';

const comp = (id: string, over: Partial<CompRow> = {}): CompRow => ({
  component_id: id, internal_description: `Item ${id}`, supplier_model: `SM-${id}`,
  unit: 'pcs', selling_price_idr: 1_000_000, ...over,
});

test('an item is named by our own words, then the supplier’s, then never blank', () => {
  assert.equal(itemName(comp('a')), 'Item a');
  assert.equal(itemName(comp('a', { internal_description: '  ' })), 'SM-a');
  assert.equal(itemName(comp('a', { internal_description: null, supplier_model: null })), 'Unnamed item');
});

test('first and last receipt are tracked per item, out-of-order rows included', () => {
  const moves: ReceiptMove[] = [
    { component_id: 'a', moved_at: '2026-08-10T04:00:00Z' },
    { component_id: 'a', moved_at: '2026-05-01T04:00:00Z' },
    { component_id: 'a', moved_at: '2026-08-19T23:00:00Z' },
    { component_id: null, moved_at: '2026-08-19T23:00:00Z' },   // orphan row, ignored
    { component_id: 'b', moved_at: null },                       // no date, ignored
  ];
  const r = receiptDates(moves);
  assert.deepEqual(r.get('a'), { first: '2026-05-01', last: '2026-08-19' });
  assert.equal(r.has('b'), false);
});

test('brand new and restocked are not the same thing', () => {
  const moves: ReceiptMove[] = [
    // First time we have ever held it — a product new to the business
    { component_id: 'new', moved_at: '2026-08-18T00:00:00Z' },
    // Carried for a year, just topped up — replenishment, not news
    { component_id: 'old', moved_at: '2025-09-01T00:00:00Z' },
    { component_id: 'old', moved_at: '2026-08-18T00:00:00Z' },
    // Landed before the window opened — not shown at all
    { component_id: 'stale', moved_at: '2026-06-01T00:00:00Z' },
  ];
  const comps = [comp('new'), comp('old'), comp('stale')];
  const bal: BalanceRow[] = [{ component_id: 'new', qty_on_hand: 5 }, { component_id: 'old', qty_on_hand: 12 }];
  const rows = newArrivals(comps, receiptDates(moves), bal, { days: 14, nowIso: NOW });

  assert.deepEqual(rows.map((r) => r.component_id), ['new', 'old'], 'the stale item is outside the window');
  assert.equal(rows[0].brandNew, true);
  assert.equal(rows[1].brandNew, false, 'an item we have carried for a year is a restock');
  assert.equal(rows[0].daysAgo, 2);
  assert.equal(rows[1].qty, 12, 'quantity is what is on hand now, not what arrived');
});

test('stock on the shelf with no selling price is the point of the widget', () => {
  const moves: ReceiptMove[] = [{ component_id: 'x', moved_at: '2026-08-19T00:00:00Z' }];
  const rows = (price: CompRow['selling_price_idr']) =>
    newArrivals([comp('x', { selling_price_idr: price })], receiptDates(moves),
      [{ component_id: 'x', qty_on_hand: 3 }], { days: 14, nowIso: NOW });
  assert.equal(rows(null)[0].needsPrice, true);
  assert.equal(rows(0)[0].needsPrice, true, 'zero is not a price');
  assert.equal(rows('0')[0].needsPrice, true, 'nor is a zero that arrived as text');
  assert.equal(rows(500_000)[0].needsPrice, false);
});

test('quantity on hand sums every warehouse, never just one', () => {
  const moves: ReceiptMove[] = [{ component_id: 'x', moved_at: '2026-08-19T00:00:00Z' }];
  const rows = newArrivals([comp('x')], receiptDates(moves), [
    { component_id: 'x', qty_on_hand: 4 },
    { component_id: 'x', qty_on_hand: 6 },
  ], { days: 14, nowIso: NOW });
  assert.equal(rows[0].qty, 10);
});

test('the window is a judgement, so widening it finds more', () => {
  const moves: ReceiptMove[] = [{ component_id: 'x', moved_at: '2026-06-15T00:00:00Z' }];
  const call = (days: number) =>
    newArrivals([comp('x')], receiptDates(moves), [], { days, nowIso: NOW });
  assert.equal(call(14).length, 0);
  assert.equal(call(90).length, 1, 'the same shipment, seen through a quarter instead of a fortnight');
});

// ── What is on its way ───────────────────────────────────────────────────────

const po = (id: string, over: Partial<OpenPo> = {}): OpenPo => ({
  po_id: id, po_number: `PO-${id}`, status: 'Confirmed', po_date: '2026-08-01',
  estimated_delivery_date: null, supplier_id: 's1', currency: 'USD',
  exchange_rate: 16000, total_value: 1000, ...over,
});

test('a stamped supplier date beats an estimate, and the widget says which', () => {
  const pos = [po('1', { estimated_delivery_date: '2026-08-28' })];
  const lines: PoLine[] = [{ po_id: '1', component_id: 'a', quantity: 7 }];
  const s = summariseArrivals(pos, lines, [comp('a')], new Set(), new Map(), NOW);
  assert.equal(s.soon.length, 1);
  assert.equal(s.soon[0].expected, '2026-08-28');
  assert.equal(s.soon[0].source, 'eta', 'a date the supplier gave us is not an estimate');
  assert.equal(s.soon[0].daysAway, 8);
  assert.equal(s.soon[0].qty, 7);
  assert.equal(s.posWithoutEta, 0);
});

test('no supplier date: the estimate is flagged as one, and counted', () => {
  const pos = [po('1')];                                    // no ETA at all
  const lines: PoLine[] = [{ po_id: '1', component_id: 'a', quantity: 1 }];
  const s = summariseArrivals(pos, lines, [comp('a')], new Set(), new Map(), NOW);
  const row = [...s.soon, ...s.late][0];
  assert.notEqual(row.source, 'eta', 'nothing was stamped, so nothing may claim to be');
  assert.equal(s.posWithoutEta, 1, 'the count is shown so the reader can discount the dates');
});

test('a closed or cancelled PO is not arriving', () => {
  const pos = [po('1', { status: 'Received' }), po('2', { status: 'Cancelled' }), po('3', { status: 'Sent' })];
  const lines: PoLine[] = [
    { po_id: '1', component_id: 'a', quantity: 1 },
    { po_id: '2', component_id: 'a', quantity: 1 },
    { po_id: '3', component_id: 'a', quantity: 4 },
  ];
  const s = summariseArrivals(pos, lines, [comp('a')], new Set(), new Map(), NOW);
  assert.equal(s.openPos, 1);
  assert.equal([...s.soon, ...s.late][0].qty, 4, 'only the open PO’s quantity is incoming');
});

test('past its date with nothing received is reported, not quietly dropped', () => {
  const pos = [po('1', { po_date: '2025-10-01', estimated_delivery_date: '2025-11-25' })];
  const lines: PoLine[] = [{ po_id: '1', component_id: 'a', quantity: 2 }];
  const s = summariseArrivals(pos, lines, [comp('a')], new Set(), new Map(), NOW);
  assert.equal(s.late.length, 1);
  assert.equal(s.late[0].daysAway! < 0, true, 'a past date reads as days late');
  assert.equal(s.stalePos, 1);
  assert.equal(s.oldestStaleDays, 323);
});

test('a PO that has received something is not stale, however late it looks', () => {
  const pos = [po('1', { po_date: '2025-10-01', estimated_delivery_date: '2025-11-25' })];
  const lines: PoLine[] = [{ po_id: '1', component_id: 'a', quantity: 2 }];
  const s = summariseArrivals(pos, lines, [comp('a')], new Set(['1']), new Map(), NOW);
  assert.equal(s.stalePos, 0, 'goods did arrive against it — that is a partial delivery, not a missing one');
  assert.equal(s.late.length, 1, 'the remaining quantity is still overdue, and still shown');
});

test('an item with no date never jumps the queue ahead of a known one', () => {
  const pos = [po('1', { estimated_delivery_date: '2026-09-30' }), po('2', { po_date: null })];
  const lines: PoLine[] = [
    { po_id: '1', component_id: 'a', quantity: 1 },
    { po_id: '2', component_id: 'b', quantity: 1 },
  ];
  const s = summariseArrivals(pos, lines, [comp('a'), comp('b')], new Set(), new Map(), NOW);
  const order = s.soon.map((r) => r.component_id);
  assert.equal(order[order.length - 1], 'b', '"we don’t know" sits at the end, never among the dates');
});

test('an item the catalogue cannot name is left out rather than shown as a blank row', () => {
  const pos = [po('1')];
  const lines: PoLine[] = [{ po_id: '1', component_id: 'ghost', quantity: 1 }];
  const s = summariseArrivals(pos, lines, [], new Set(), new Map(), NOW);
  assert.deepEqual([...s.soon, ...s.late], []);
});

test('several POs for one item roll up: total quantity, nearest date', () => {
  const pos = [
    po('1', { estimated_delivery_date: '2026-10-01' }),
    po('2', { estimated_delivery_date: '2026-09-05' }),
  ];
  const lines: PoLine[] = [
    { po_id: '1', component_id: 'a', quantity: 10 },
    { po_id: '2', component_id: 'a', quantity: 5 },
  ];
  const s = summariseArrivals(pos, lines, [comp('a')], new Set(), new Map(), NOW);
  assert.equal(s.soon.length, 1);
  assert.equal(s.soon[0].qty, 15);
  assert.equal(s.soon[0].expected, '2026-09-05', 'the soonest is what a salesperson can promise');
  assert.deepEqual(s.soon[0].pos.sort(), ['PO-1', 'PO-2']);
});

test('no PO number means none is shown — the sell-side fetch never asks for it', () => {
  const pos = [po('1', { po_number: null, estimated_delivery_date: '2026-09-05' })];
  const lines: PoLine[] = [{ po_id: '1', component_id: 'a', quantity: 1 }];
  const s = summariseArrivals(pos, lines, [comp('a')], new Set(), new Map(), NOW);
  assert.deepEqual(s.soon[0].pos, [], 'a document reference a role may not see never reaches the row');
});
