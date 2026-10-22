/**
 * Received-but-not-in-stock. The first case is the real one (2026-10-22):
 * PIO-2026012 marked Fully Received on 20 Oct with 1,200 + 1,000 panels and no
 * goods receipt, so ON HAND showed nothing.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { receiptGaps, LEDGER_START } from './receiptGap.ts';

const po = (id: string, status: string, received: string | null, po_date = '2026-08-10') =>
  ({ po_id: id, po_number: id, status, po_date, actual_received_date: received });

test('PIO-2026012: Fully Received with no receipt is a gap, with every unit it is missing', () => {
  const gaps = receiptGaps([po('p12', 'Fully Received', '2026-10-20')],
    [{ po_id: 'p12', component_id: 'ica100', quantity: 1200 }, { po_id: 'p12', component_id: 'ica200', quantity: 1000 }], []);
  assert.equal(gaps.length, 1);
  assert.equal(gaps[0].missingQty, 2200);
  assert.deepEqual(gaps[0].missing.map((m) => m.componentId).sort(), ['ica100', 'ica200']);
});

test('once received in full it is no longer a gap; a short receipt still is', () => {
  const lines = [{ po_id: 'p', component_id: 'a', quantity: 10 }, { po_id: 'p', component_id: 'b', quantity: 5 }];
  const full = [{ source_id: 'p', component_id: 'a', quantity: 10 }, { source_id: 'p', component_id: 'b', quantity: 5 }];
  assert.deepEqual(receiptGaps([po('p', 'Fully Received', '2026-10-01')], lines, full), []);
  const short = receiptGaps([po('p', 'Fully Received', '2026-10-01')], lines, [{ source_id: 'p', component_id: 'a', quantity: 10 }]);
  assert.deepEqual(short[0].missing, [{ componentId: 'b', ordered: 5, received: 0 }]);
});

test('project lines go to site, not the warehouse — never a gap', () => {
  const gaps = receiptGaps([po('p', 'Fully Received', '2026-10-08')],
    [{ po_id: 'p', component_id: 'cable', quantity: 500, reason: 'project' }], []);
  assert.deepEqual(gaps, []);
});

test('Partially Received is a gap only when nothing at all was received', () => {
  const lines = [{ po_id: 'p', component_id: 'a', quantity: 10 }];
  assert.equal(receiptGaps([po('p', 'Partially Received', '2026-10-01')], lines, []).length, 1);
  assert.equal(receiptGaps([po('p', 'Partially Received', '2026-10-01')], lines, [{ source_id: 'p', component_id: 'a', quantity: 4 }]).length, 0);
});

test('before the ledger went live, and statuses that are not "received", never count', () => {
  const lines = [{ po_id: 'p', component_id: 'a', quantity: 10 }];
  assert.deepEqual(receiptGaps([po('p', 'Fully Received', '2025-07-23')], lines, []), [], 'pre-ledger');
  assert.deepEqual(receiptGaps([po('p', 'Fully Received', null, '2026-06-01')], lines, []), [], 'no received date, PO date pre-ledger');
  assert.equal(receiptGaps([po('p', 'Fully Received', LEDGER_START)], lines, []).length, 1, 'the first ledger day counts');
  for (const s of ['Sent', 'Confirmed', 'Draft', 'Cancelled', 'Replaced']) {
    assert.deepEqual(receiptGaps([po('p', s, '2026-10-01')], lines, []), [], s);
  }
});
