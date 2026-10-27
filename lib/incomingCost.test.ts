/**
 * The next unit's cost vs the cost we price on — EPEVER LR51100A, as it stood
 * on 2026-10-27, is the case the owner raised.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { incomingCosts, costRise, RISE_THRESHOLD_PCT,
         type IncPo, type IncPoLine, type IncQuote, type IncQuoteLine, type IncReceipt } from './incomingCost.ts';
import type { FxRate } from './computeTUC.ts';

const CID = 'lr51100';
const FX: Record<string, FxRate> = { USD: { rate: 18_000, date: '2026-10-23', source: 'benchmark', label: 'company rate' } };

// Production rows, trimmed to what the rule reads.
const OLD_PO: IncPo = { po_id: 'po-008', po_number: 'PIO-008-ISL-05-2026', po_date: '2026-05-13', status: 'Fully Received', currency: 'USD', exchange_rate: 17_490 };
const NEW_PO: IncPo = { po_id: 'po-017', po_number: 'PIO-017-ISL-09-2026', po_date: '2026-09-30', status: 'Confirmed', currency: 'USD', exchange_rate: 17_912 };
const LINES: IncPoLine[] = [
  { po_id: 'po-008', component_id: CID, unit_cost: 509, currency: 'USD' },
  { po_id: 'po-017', component_id: CID, unit_cost: 539, currency: 'USD' },
];
const RECEIPT: IncReceipt = { component_id: CID, unit_cost_idr: 9_477_538, moved_at: '2026-08-22T12:00:00+00:00', source_id: 'po-008' };
const OLD_Q: IncQuote = { quote_id: 'q1', pi_number: 'LC26050010', quote_date: '2026-05-11', status: 'Accepted', currency: 'USD' };
const NEW_Q: IncQuote = { quote_id: 'q2', pi_number: 'LC26090003', quote_date: '2026-09-28', status: 'Open', currency: 'USD' };
const QLINES: IncQuoteLine[] = [
  { quote_id: 'q1', component_id: CID, unit_price: 509, currency: 'USD' },
  { quote_id: 'q2', component_id: CID, unit_price: 539, currency: 'USD' },
];

const all = () => incomingCosts({ pos: [OLD_PO, NEW_PO], poItems: LINES, quotes: [OLD_Q, NEW_Q], quoteItems: QLINES, receipts: [RECEIPT] }, FX);

test('LR51100: the Confirmed reorder is the incoming cost, at the PO’s own rate', () => {
  const inc = all().get(CID)!;
  assert.equal(inc.source, 'po');
  assert.equal(inc.label, 'PIO-017-ISL-09-2026');
  assert.equal(inc.rate, 17_912, 'the PO commits a rate — use it, not the company rate');
  assert.equal(inc.fobIdr, 539 * 17_912);
});

test('LR51100: uplift learned from its own last landing, applied to the reorder', () => {
  const inc = all().get(CID)!;
  const uplift = 9_477_538 / (509 * 17_490);
  assert.ok(Math.abs(inc.uplift! - uplift) < 1e-9);
  assert.equal(inc.estLandedIdr, Math.round(539 * 17_912 * uplift));
  assert.equal(inc.provisional, false);
  assert.ok(inc.estLandedIdr > 10_250_000 && inc.estLandedIdr < 10_300_000, `≈ Rp 10.28m, got ${inc.estLandedIdr}`);
});

test('LR51100: the rise is flagged, and the supplier price alone already beats landed', () => {
  const r = costRise(9_477_538, all().get(CID))!;
  assert.ok(r);
  assert.ok(r.risePct > 8 && r.risePct < 9, `≈ 8.5%, got ${r.risePct}`);
  assert.equal(r.fobAlreadyAbove, true);
});

test('a PO and its own quote on the same item: the PO wins on a date tie, the newer wins otherwise', () => {
  const sameDay = incomingCosts({ pos: [{ ...NEW_PO, po_date: '2026-09-28' }], poItems: [LINES[1]], quotes: [NEW_Q],
    quoteItems: [{ ...QLINES[1], unit_price: 999 }], receipts: [] }, FX).get(CID)!;
  assert.equal(sameDay.source, 'po');
  const newerQuote = incomingCosts({ pos: [NEW_PO], poItems: [LINES[1]], quotes: [{ ...NEW_Q, quote_date: '2026-10-20' }],
    quoteItems: [{ ...QLINES[1], unit_price: 560 }], receipts: [] }, FX).get(CID)!;
  assert.equal(newerQuote.source, 'quote');
  assert.equal(newerQuote.rate, 18_000, 'a quote carries no rate: the company rate converts it');
});

test('draft, received, cancelled and replaced POs are not incoming', () => {
  for (const status of ['Draft', 'Fully Received', 'Cancelled', 'Replaced']) {
    const m = incomingCosts({ pos: [{ ...NEW_PO, status }], poItems: [LINES[1]], quotes: [], quoteItems: [], receipts: [] }, FX);
    assert.equal(m.has(CID), false, status);
  }
  for (const status of ['Sent', 'Confirmed', 'Partially Received']) {
    const m = incomingCosts({ pos: [{ ...NEW_PO, status }], poItems: [LINES[1]], quotes: [], quoteItems: [], receipts: [] }, FX);
    assert.equal(m.has(CID), true, status);
  }
});

test('a quote dated on or before the last landing is history, not incoming', () => {
  const m = incomingCosts({ pos: [OLD_PO], poItems: [LINES[0]], quotes: [OLD_Q], quoteItems: [QLINES[0]], receipts: [RECEIPT] }, FX);
  assert.equal(m.has(CID), false);
});

test('rejected and expired quotes are not incoming', () => {
  for (const status of ['Rejected', 'Expired', 'Replaced']) {
    const m = incomingCosts({ pos: [], poItems: [], quotes: [{ ...NEW_Q, status }], quoteItems: [QLINES[1]], receipts: [] }, FX);
    assert.equal(m.has(CID), false, status);
  }
});

test('never landed: raw FOB, flagged provisional (it can only be too low)', () => {
  const inc = incomingCosts({ pos: [], poItems: [], quotes: [NEW_Q], quoteItems: [QLINES[1]], receipts: [] }, FX).get(CID)!;
  assert.equal(inc.uplift, null);
  assert.equal(inc.estLandedIdr, 539 * 18_000);
  assert.equal(inc.provisional, true);
});

test('an absurd uplift (wrong rate, unit mismatch) is ignored, not applied', () => {
  const bad = { ...RECEIPT, unit_cost_idr: 539 * 17_490 * 5 };
  const inc = incomingCosts({ pos: [OLD_PO, NEW_PO], poItems: LINES, quotes: [], quoteItems: [], receipts: [bad] }, FX).get(CID)!;
  assert.equal(inc.uplift, null);
  assert.equal(inc.provisional, true);
});

test('IDR documents convert at 1', () => {
  const inc = incomingCosts({ pos: [{ ...NEW_PO, currency: 'IDR', exchange_rate: null }],
    poItems: [{ ...LINES[1], currency: 'IDR', unit_cost: 9_800_000 }], quotes: [], quoteItems: [], receipts: [] }, FX).get(CID)!;
  assert.equal(inc.fobIdr, 9_800_000);
});

test('costRise: only a rise of at least the threshold, never a fall', () => {
  const inc = all().get(CID)!;
  assert.equal(costRise(inc.estLandedIdr, inc), null, 'no change');
  assert.equal(costRise(inc.estLandedIdr * 1.2, inc), null, 'cheaper reorder: no warning');
  assert.equal(costRise(inc.estLandedIdr / (1 + (RISE_THRESHOLD_PCT / 2) / 100), inc), null, 'under the threshold');
  assert.ok(costRise(inc.estLandedIdr / 1.02, inc));
  assert.equal(costRise(null, inc), null, 'no current cost: nothing to compare');
  assert.equal(costRise(9_000_000, undefined), null);
});

// ── Where the uplift comes from (owner, 2026-10-27: "the previous estimated
//    Landed Cost mark up from the same supplier") ───────────────────────────

const EPEVER = 'sup-epever';
const OTHER = 'sup-other';
const withSup = (po: IncPo, supplier_id: string | null): IncPo => ({ ...po, supplier_id });

test('LR51100 with suppliers: its own last delivery from EPEVER sets the uplift', () => {
  const inc = incomingCosts({ pos: [withSup(OLD_PO, EPEVER), withSup(NEW_PO, EPEVER)], poItems: LINES,
    quotes: [], quoteItems: [], receipts: [RECEIPT] }, FX).get(CID)!;
  assert.equal(inc.upliftSource, 'item');
  assert.equal(inc.upliftRef, 'PIO-008-ISL-05-2026');
  assert.equal(inc.supplierId, EPEVER);
});

test('an item the supplier never sent takes that supplier’s last delivery, weighted by value', () => {
  // EPEVER's last delivered PO carried two other items: 10 × USD 100 landing at
  // 1.10 and 2 × USD 1,000 landing at 1.20. Value-weighted: (1,100 + 2,400) ÷ 3,000.
  const po: IncPo = withSup({ po_id: 'po-x', po_number: 'PIO-X', po_date: '2026-06-01', status: 'Fully Received', currency: 'USD', exchange_rate: 17_000 }, EPEVER);
  const lines: IncPoLine[] = [
    { po_id: 'po-x', component_id: 'a', unit_cost: 100, currency: 'USD' },
    { po_id: 'po-x', component_id: 'b', unit_cost: 1_000, currency: 'USD' },
    { po_id: 'po-017', component_id: 'new-item', unit_cost: 200, currency: 'USD' },
  ];
  const receipts: IncReceipt[] = [
    { component_id: 'a', unit_cost_idr: 100 * 17_000 * 1.10, moved_at: '2026-07-01', source_id: 'po-x', quantity: 10 },
    { component_id: 'b', unit_cost_idr: 1_000 * 17_000 * 1.20, moved_at: '2026-07-01', source_id: 'po-x', quantity: 2 },
  ];
  const inc = incomingCosts({ pos: [po, withSup(NEW_PO, EPEVER)], poItems: lines, quotes: [], quoteItems: [], receipts }, FX).get('new-item')!;
  assert.equal(inc.upliftSource, 'supplier');
  assert.equal(inc.upliftRef, 'PIO-X');
  assert.ok(Math.abs(inc.uplift! - 3_500 / 3_000) < 1e-9, `got ${inc.uplift}`);
  assert.equal(inc.estLandedIdr, Math.round(200 * 17_912 * 3_500 / 3_000));
  assert.equal(inc.provisional, false);
});

test('the same-supplier history beats the item’s history with another supplier', () => {
  const otherPo: IncPo = withSup({ po_id: 'po-o', po_number: 'PO-OTHER', po_date: '2026-08-01', status: 'Fully Received', currency: 'USD', exchange_rate: 17_000 }, OTHER);
  const supPo: IncPo = withSup({ po_id: 'po-s', po_number: 'PO-EPEVER-OLD', po_date: '2026-03-01', status: 'Fully Received', currency: 'USD', exchange_rate: 17_000 }, EPEVER);
  const lines: IncPoLine[] = [
    { po_id: 'po-o', component_id: CID, unit_cost: 500, currency: 'USD' },
    { po_id: 'po-s', component_id: 'z', unit_cost: 100, currency: 'USD' },
    LINES[1],
  ];
  const receipts: IncReceipt[] = [
    { component_id: CID, unit_cost_idr: 500 * 17_000 * 1.30, moved_at: '2026-09-01', source_id: 'po-o', quantity: 5 },
    { component_id: 'z', unit_cost_idr: 100 * 17_000 * 1.08, moved_at: '2026-04-01', source_id: 'po-s', quantity: 5 },
  ];
  const inc = incomingCosts({ pos: [otherPo, supPo, withSup(NEW_PO, EPEVER)], poItems: lines, quotes: [], quoteItems: [], receipts }, FX).get(CID)!;
  assert.equal(inc.upliftSource, 'supplier', 'EPEVER’s own markup, not the other supplier’s');
  assert.ok(Math.abs(inc.uplift! - 1.08) < 1e-9);
});

test('no history with this supplier at all: the item’s delivery from another supplier, said so', () => {
  const inc = incomingCosts({ pos: [withSup(OLD_PO, OTHER), withSup(NEW_PO, EPEVER)], poItems: LINES,
    quotes: [], quoteItems: [], receipts: [RECEIPT] }, FX).get(CID)!;
  assert.equal(inc.upliftSource, 'item_elsewhere');
  assert.equal(inc.provisional, false);
});

test('a PO with no supplier of its own takes it from the quote it was raised from', () => {
  const q: IncQuote = { ...NEW_Q, status: 'Accepted', supplier_id: EPEVER };
  const po: IncPo = { ...NEW_PO, supplier_id: null, quote_id: 'q2' };
  const inc = incomingCosts({ pos: [withSup(OLD_PO, EPEVER), po], poItems: LINES, quotes: [q], quoteItems: [], receipts: [RECEIPT] }, FX).get(CID)!;
  assert.equal(inc.supplierId, EPEVER);
  assert.equal(inc.upliftSource, 'item');
});

test('a quote carries its supplier, and uses that supplier’s markup', () => {
  const inc = incomingCosts({ pos: [withSup(OLD_PO, EPEVER)], poItems: [LINES[0]],
    quotes: [{ ...NEW_Q, supplier_id: EPEVER }], quoteItems: [{ quote_id: 'q2', component_id: 'brand-new', unit_price: 300, currency: 'USD' }],
    receipts: [RECEIPT] }, FX).get('brand-new')!;
  assert.equal(inc.upliftSource, 'supplier');
  assert.equal(inc.upliftRef, 'PIO-008-ISL-05-2026');
  assert.equal(inc.estLandedIdr, Math.round(300 * 18_000 * (9_477_538 / (509 * 17_490))));
});

test('an import received at its bare USD price taught nothing: freight and duty were never booked', () => {
  // KSTAR, 2026-10-27: deliveries sitting at exactly the PO price.
  const unbooked = { ...RECEIPT, unit_cost_idr: 509 * 17_490 };
  const inc = incomingCosts({ pos: [withSup(OLD_PO, EPEVER), withSup(NEW_PO, EPEVER)], poItems: LINES,
    quotes: [], quoteItems: [], receipts: [unbooked] }, FX).get(CID)!;
  assert.equal(inc.uplift, null);
  assert.equal(inc.provisional, true, 'shown as the bare price, flagged as an underestimate');
});

test('a local rupiah supplier really can land at ~0%: that is learned', () => {
  const po: IncPo = withSup({ po_id: 'loc', po_number: 'PO-LOCAL', po_date: '2026-09-01', status: 'Fully Received', currency: 'IDR' }, 'sup-local');
  const next: IncPo = withSup({ po_id: 'loc2', po_number: 'PO-LOCAL-2', po_date: '2026-10-12', status: 'Confirmed', currency: 'IDR' }, 'sup-local');
  const inc = incomingCosts({ pos: [po, next], poItems: [
      { po_id: 'loc', component_id: 'cable', unit_cost: 60_000, currency: 'IDR' },
      { po_id: 'loc2', component_id: 'cable', unit_cost: 69_000, currency: 'IDR' }],
    quotes: [], quoteItems: [], receipts: [{ component_id: 'cable', unit_cost_idr: 60_000, moved_at: '2026-09-05', source_id: 'loc', quantity: 100 }] }, FX).get('cable')!;
  assert.equal(inc.uplift, 1);
  assert.equal(inc.upliftSource, 'item');
  assert.equal(inc.provisional, false);
});
