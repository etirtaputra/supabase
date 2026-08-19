/**
 * Serial-number tests — the label in someone's hand against the paperwork:
 *   • matching forgives case, spaces and dashes, because three people type the
 *     same unit three ways;
 *   • a pasted column survives commas, tabs, blank lines and its own repeats;
 *   • the same serial on a DIFFERENT product is not a clash — on the same
 *     product it is;
 *   • the walk back fills the order in from the delivery or the invoice when
 *     the unit itself does not name it;
 *   • a unit we never sold traces to nothing, and says so.
 * Hand-built rows; no fetch.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  normSerial, parseSerialBatch, findExisting, traceSerial, lookupSerial, serialsForDoc,
  statusFor, isOut, SERIAL_STATUS,
  type SerialRow, type SerialSalesDoc, type SerialDo, type SerialInvoice,
} from './serials.ts';

const sn = (over: Partial<SerialRow> = {}): SerialRow => ({
  serial_id: 'S1', serial: 'SN-1234', serial_norm: 'SN1234', component_id: 'C1', product_text: '',
  customer_id: null, quote_id: null, do_id: null, invoice_id: null,
  status: 'delivered', is_external: false, delivered_at: null, location: null, notes: '',
  created_at: '2026-08-01T00:00:00Z', ...over,
});
const order = (over: Partial<SerialSalesDoc> = {}): SerialSalesDoc => ({
  quote_id: 'Q1', quote_number: 'DQ-1', order_number: 'SO-1', invoice_number: null, do_number: null,
  customer_id: 'CUST1', status: 'delivered', ...over,
});
const doc = (over: Partial<SerialDo> = {}): SerialDo =>
  ({ do_id: 'D1', do_number: 'DO-1', quote_id: 'Q1', delivery_date: '2026-07-01', delivered_at: '2026-07-02', status: 'delivered', ...over });
const inv = (over: Partial<SerialInvoice> = {}): SerialInvoice =>
  ({ invoice_id: 'I1', invoice_number: 'INV-1', quote_id: 'Q1', issued_at: '2026-07-03', ...over });

test('matching forgives how a serial gets typed', () => {
  assert.equal(normSerial('SN-1234'), 'SN1234');
  assert.equal(normSerial('sn 1234'), 'SN1234');
  assert.equal(normSerial(' sn/1234 '), 'SN1234');
  assert.equal(normSerial('SN1234'), 'SN1234');
  assert.equal(normSerial('---'), '');            // nothing to match on
  assert.equal(normSerial(''), '');
});

test('a pasted column survives commas, tabs, blank lines and its own repeats', () => {
  const b = parseSerialBatch('SN-1\nSN-2\r\n\n SN-3 ,SN-4\tSN-5;SN-6\n\nSN-1\n--\n');
  assert.deepEqual(b.serials, ['SN-1', 'SN-2', 'SN-3', 'SN-4', 'SN-5', 'SN-6']);
  assert.deepEqual(b.repeated, [{ serial: 'SN-1', times: 2 }]);   // the paste said it twice
  assert.deepEqual(b.rejected, ['--']);                            // nothing to match on
  assert.deepEqual(parseSerialBatch('').serials, []);
});

test('a serial spelled two ways in one paste is ONE unit, kept as first written', () => {
  const b = parseSerialBatch('AB-100\nab 100');
  assert.deepEqual(b.serials, ['AB-100']);
  assert.deepEqual(b.repeated, [{ serial: 'AB-100', times: 2 }]);
});

test('the same serial clashes on the same product, not across products', () => {
  const register = [sn({ serial_id: 'S1', serial: 'SN-1234', component_id: 'C1' })];
  // Same product, typed differently — still the same unit
  const clash = findExisting(['sn 1234', 'SN-9999'], 'C1', register);
  assert.equal(clash.size, 1);
  assert.equal(clash.get('sn 1234')?.serial_id, 'S1');
  // Different product: two manufacturers may run the same counter
  assert.equal(findExisting(['SN-1234'], 'C2', register).size, 0);
  // No product at all is its own bucket
  assert.equal(findExisting(['SN-1234'], null, register).size, 0);
});

test('the walk back fills the order in from the delivery', () => {
  // The unit names only its delivery — the order comes through it
  const t = traceSerial(sn({ do_id: 'D1' }), [order()], [doc()], [inv()]);
  assert.equal(t.order?.order_number, 'SO-1');
  assert.equal(t.delivery?.do_number, 'DO-1');
  assert.equal(t.customerId, 'CUST1');
  assert.equal(t.deliveredAt, '2026-07-02');       // delivered beats scheduled
  assert.equal(t.external, false);
});

test('an invoice alone also leads home, and the register wins over the documents', () => {
  const viaInvoice = traceSerial(sn({ invoice_id: 'I1' }), [order()], [doc()], [inv()]);
  assert.equal(viaInvoice.order?.order_number, 'SO-1');
  assert.equal(viaInvoice.invoice?.invoice_number, 'INV-1');
  // A delivery date stamped on the unit itself is the one warranty runs from
  const stamped = traceSerial(sn({ do_id: 'D1', delivered_at: '2026-06-01' }), [order()], [doc()], [inv()]);
  assert.equal(stamped.deliveredAt, '2026-06-01');
  // A customer named on the unit wins over the order's
  const moved = traceSerial(sn({ do_id: 'D1', customer_id: 'CUST2' }), [order()], [doc()], [inv()]);
  assert.equal(moved.customerId, 'CUST2');
});

test('a unit we never sold traces to nothing and says so', () => {
  const t = traceSerial(sn({ is_external: true, product_text: 'Some other brand inverter' }), [order()], [doc()], [inv()]);
  assert.equal(t.order, null);
  assert.equal(t.delivery, null);
  assert.equal(t.invoice, null);
  assert.equal(t.external, true);
  assert.equal(t.deliveredAt, null);
  // And a unit with no documents at all reads external even when nobody ticked it
  assert.equal(traceSerial(sn(), [order()], [doc()], [inv()]).external, true);
});

test('a lookup returns EVERY match, so two products are chosen between, not guessed', () => {
  const register = [
    sn({ serial_id: 'S1', component_id: 'C1' }),
    sn({ serial_id: 'S2', component_id: 'C2' }),
    sn({ serial_id: 'S3', serial: 'OTHER', serial_norm: 'OTHER', component_id: 'C1' }),
  ];
  assert.deepEqual(lookupSerial('sn-1234', register).map((r) => r.serial_id), ['S1', 'S2']);
  assert.deepEqual(lookupSerial('  ', register), []);
  assert.deepEqual(lookupSerial('nothing-like-it', register), []);
});

test('a document lists its units in the order they were entered', () => {
  const register = [
    sn({ serial_id: 'S2', do_id: 'D1', created_at: '2026-08-02T00:00:00Z' }),
    sn({ serial_id: 'S1', do_id: 'D1', created_at: '2026-08-01T00:00:00Z' }),
    sn({ serial_id: 'S3', do_id: 'D2', created_at: '2026-08-03T00:00:00Z' }),
  ];
  assert.deepEqual(serialsForDoc(register, 'do_id', 'D1').map((r) => r.serial_id), ['S1', 'S2']);
  assert.deepEqual(serialsForDoc(register, 'do_id', 'D9'), []);
});

test('a unit\'s state follows the paperwork on it — in stock, spoken for, or gone', () => {
  // Nothing attached: still ours, on the shelf
  assert.equal(statusFor({ quote_id: null, do_id: null }), 'in_stock');
  // Assigned to an order but not yet shipped — the warehouse still holds it
  assert.equal(statusFor({ quote_id: 'Q1', do_id: null }), 'allocated');
  // A delivery order means it left the building
  assert.equal(statusFor({ quote_id: 'Q1', do_id: 'D1' }), 'delivered');
  // A delivery with no order named is still gone
  assert.equal(statusFor({ quote_id: null, do_id: 'D1' }), 'delivered');
  // Returned and scrapped are facts about the UNIT, not about documents
  assert.equal(statusFor({ quote_id: 'Q1', do_id: 'D1', status: 'returned' }), 'returned');
  assert.equal(statusFor({ quote_id: null, do_id: null, status: 'scrapped' }), 'scrapped');
});

test('"out" means gone, not merely spoken for', () => {
  assert.equal(isOut({ status: 'delivered' }), true);
  assert.equal(isOut({ status: 'allocated' }), false);
  assert.equal(isOut({ status: 'in_stock' }), false);
  // Every state the rule can produce has a label the list can show
  for (const s of ['in_stock', 'allocated', 'delivered', 'returned', 'scrapped']) {
    assert.ok(SERIAL_STATUS[s]?.label, `${s} has no label`);
  }
});
