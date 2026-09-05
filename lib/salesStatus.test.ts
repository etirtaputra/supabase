/**
 * The document number a sales document answers to — and, through it, the name
 * of the PDF someone saves.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { displayDocNumber, printedDocNumber } from './salesStatus.ts';

test('a draft is a DQ, an offer out is a PQ', () => {
  assert.equal(displayDocNumber({ quote_number: 'SQ-20260905-0036', status: 'draft' }), 'DQ-20260905-0036');
  assert.equal(displayDocNumber({ quote_number: 'SQ-20260905-0036', status: 'sent' }), 'PQ-20260905-0036');
});

test('once ordered, the order number takes over', () => {
  assert.equal(
    displayDocNumber({ quote_number: 'SQ-1', order_number: 'SO-9', status: 'ordered' }), 'SO-9');
});

test('a printed invoice carries its OWN number', () => {
  // The bug this rule exists for: printing a split invoice used to title the
  // file with the order number, so the file and the page disagreed.
  const q = { quote_number: 'SQ-1', order_number: 'SO-9', invoice_number: 'INV-3', status: 'invoiced' };
  assert.equal(printedDocNumber(q), 'INV-3');
  assert.equal(printedDocNumber({ ...q, status: 'delivered' }), 'INV-3');
});

test('an invoice number that is not yet the document does not take over', () => {
  assert.equal(
    printedDocNumber({ quote_number: 'SQ-1', order_number: 'SO-9', invoice_number: 'INV-3', status: 'ordered' }),
    'SO-9');
});

test('with no invoice in play the two rules agree', () => {
  for (const status of ['draft', 'sent', 'ordered']) {
    const q = { quote_number: 'SQ-1', order_number: 'SO-9', status };
    assert.equal(printedDocNumber(q), displayDocNumber(q), status);
  }
});
