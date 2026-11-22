import test from 'node:test';
import assert from 'node:assert/strict';
import { buildProposal, type InboxLookups } from './inboxMatch.ts';

const db: InboxLookups = {
  suppliers: [{ supplier_id: 's1', supplier_name: 'Shenzhen Kstar Science & Technology Co., Ltd.' }],
  companies: [{ company_id: 'c1', legal_name: 'PT Indodaya Cipta Lestari' }],
  components: [
    { component_id: 'k1', supplier_model: 'SIN202-9 II', internal_description: 'KSTAR SIN202-9 II', brand: 'KSTAR' },
    { component_id: 'k2', supplier_model: 'YDC3330H', internal_description: 'KSTAR YDC3330H Long Run 30kVA', brand: 'KSTAR' },
  ],
  quotes: [{ quote_id: 'q-old', pi_number: 'KST226-6823', supplier_id: 's1' }],
  pos: [{ po_id: 'p-old', po_number: 'PIO-2026021', pi_number: 'KST226-6823', supplier_id: 's1' }],
};

// PIO-2026021 as KSTAR sent it: 250 × CNY 1,200 + 3 × CNY 11,266 = CNY 333,798.
const kstarPi = {
  document_type: 'proforma_invoice', is_supplier_document: true,
  supplier_name: 'Shenzhen Kstar Science & Technology', company_name: 'PT Indodaya Cipta Lestari',
  pi_number: 'KST226-6900', pi_date: '2026-11-20', currency: 'CNY', total_value: 333798,
  line_items: [
    { model_sku: 'SIN202-9 II', description: 'Inverter', quantity: 250, unit_price: 1200 },
    { model_sku: 'YDC3330H', description: 'Long Run 30kVA', quantity: 3, unit_price: 11266 },
  ],
};

test('a supplier PI becomes a proposed deal (quote + PO), everything matched', () => {
  const p = buildProposal(kstarPi, db);
  assert.equal(p.action, 'create_deal');
  assert.equal(p.withPo, true);
  assert.equal(p.supplier.id, 's1');
  assert.equal(p.company.id, 'c1');
  assert.equal(p.matchedLines, 2);
  assert.equal(p.itemsSum, 333798);
  assert.equal(p.duplicate, null);
  assert.deepEqual(p.warnings, []);
});

test('a quote alone is proposed as a quote, without a PO', () => {
  const p = buildProposal({ ...kstarPi, document_type: 'quote', pi_number: null, quote_number: 'Q-77' }, db);
  assert.equal(p.withPo, false);
  assert.equal(p.docNumber, 'Q-77');
});

test('the same PI already in ICAPROC is flagged, however its number was typed', () => {
  const p = buildProposal({ ...kstarPi, pi_number: 'kst226 6823' }, db);
  assert.deepEqual(p.duplicate, { quote_id: 'q-old', po_id: 'p-old', label: 'PIO-2026021' });
  assert.match(p.warnings.join(' '), /Already in ICAPROC: PIO-2026021/);
});

test('what needs a person: new supplier, unmatched line, totals that do not add up', () => {
  const p = buildProposal({
    ...kstarPi, supplier_name: 'Unknown Trading Co', total_value: 400000,
    line_items: [...kstarPi.line_items, { description: 'Mystery battery 48V', quantity: 1, unit_price: 100 }],
  }, db);
  const w = p.warnings.join(' | ');
  assert.match(w, /Supplier "Unknown Trading Co" is not in ICAPROC yet/);
  assert.match(w, /1 of 3 lines not matched/);
  assert.ok(p.notes?.some((n) => n.text.startsWith('{m} of {n} lines') && n.vars?.m === 1), 'the screen gets the phrase and its values');
  assert.match(w, /does not equal its lines/);
});

test('not a supplier deal document → review, never a deal', () => {
  const p = buildProposal({ document_type: 'payment_proof', is_supplier_document: true }, db);
  assert.equal(p.action, 'review');
  assert.equal(p.withPo, false);
  const q = buildProposal({ document_type: 'proforma_invoice', is_supplier_document: false }, db);
  assert.equal(q.action, 'review');
});
