/**
 * The next unit's cost vs the cost we price on — EPEVER LR51100A, as it stood
 * on 2026-10-27, is the case the owner raised.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { incomingCosts, costRise, poRate, RISE_THRESHOLD_PCT,
         type IncPo, type IncPoLine, type IncQuote, type IncQuoteLine, type IncReceipt, type IncPoCost } from './incomingCost.ts';
import type { FxRate } from './computeTUC.ts';

const CID = 'lr51100';
const FX: Record<string, FxRate> = { USD: { rate: 18_000, date: '2026-10-23', source: 'benchmark', label: 'company rate' } };

// Production rows, trimmed to what the rule reads.
const OLD_PO: IncPo = { po_id: 'po-008', po_number: 'PIO-008-ISL-05-2026', po_date: '2026-05-13', status: 'Fully Received', currency: 'USD', exchange_rate: 17_490, total_value: 61_957 };
const NEW_PO: IncPo = { po_id: 'po-017', po_number: 'PIO-017-ISL-09-2026', po_date: '2026-09-30', status: 'Confirmed', currency: 'USD', exchange_rate: 17_912, total_value: 93_100 };
/** A fully-paid PO at a given bank rate — what every delivered PO in these fixtures is. */
const paid = (po_id: string, usd: number, rate: number): IncPoCost => ({ po_id, cost_category: 'balance_payment', amount: usd, currency: 'USD', exchange_rate: rate });
// Production bills, 2026-10-27. PIO-008: Rp 1,145,100,988 principal in rupiah rows without a
// rate; freight-side add-ons Rp 8,533,254 (local delivery, bank fees) — CIF, so no freight;
// VAT and income tax booked too, and never part of the markup. PIO-017: the 29% deposit at 17,912.
const COSTS: IncPoCost[] = [
  { po_id: 'po-008', cost_category: 'balance_payment', amount: 1_145_100_988, currency: 'IDR' },
  { po_id: 'po-008', cost_category: 'local_delivery', amount: 6_696_559, currency: 'IDR' },
  { po_id: 'po-008', cost_category: 'full_amount_bank_fee', amount: 1_836_695, currency: 'IDR' },
  { po_id: 'po-008', cost_category: 'local_vat', amount: 125_000_000, currency: 'IDR' },
  { po_id: 'po-008', cost_category: 'local_income_tax', amount: 28_000_000, currency: 'IDR' },
  { po_id: 'po-017', cost_category: 'down_payment', amount: 27_044, currency: 'USD', exchange_rate: 17_912 }];
/** PIO-008's import markup: add-ons ÷ principal, both rupiah actually paid. */
const U008 = 1 + 8_533_254 / 1_145_100_988;
/** PIO-017 today: the paid 29% at 17,912, the unpaid rest at the company benchmark (18,000 in FX). */
const PIO017_RATE = (27_044 * 17_912 + (93_100 - 27_044) * 18_000) / 93_100;
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

const all = () => incomingCosts({ pos: [OLD_PO, NEW_PO], poItems: LINES, quotes: [OLD_Q, NEW_Q], quoteItems: QLINES, receipts: [RECEIPT], poCosts: COSTS }, FX);

test('LR51100: the Confirmed reorder is the incoming cost — paid share at its rate, the rest at the benchmark', () => {
  const inc = all().get(CID)!;
  assert.equal(inc.source, 'po');
  assert.equal(inc.label, 'PIO-017-ISL-09-2026');
  assert.equal(inc.rateSource, 'blend');
  assert.ok(Math.abs(inc.ratePaidPct - 29.05) < 0.01, `29% paid, got ${inc.ratePaidPct}`);
  assert.ok(Math.abs(inc.rate - PIO017_RATE) < 1e-6);
  assert.ok(Math.abs(inc.fobIdr - 539 * PIO017_RATE) < 1e-3);
});

test('poRate: unpaid → benchmark; fully paid → the bank rate; no benchmark → the PO rate', () => {
  assert.deepEqual(poRate(NEW_PO, [], FX), { rate: 18_000, source: 'benchmark', paidPct: 0 });
  const full = poRate(OLD_PO, [paid('po-008', 61_957, 17_600)], FX);
  assert.equal(full.source, 'paid');
  assert.equal(full.rate, 17_600);
  assert.deepEqual(poRate(NEW_PO, [], {}), { rate: 17_912, source: 'po', paidPct: 0 });
  // A rupiah payment carries its own rate when typed, else the PO's stands in.
  const idr = poRate(OLD_PO, [{ po_id: 'po-008', cost_category: 'balance_payment', amount: 61_957 * 17_700, currency: 'IDR', exchange_rate: 17_700 }], FX);
  assert.equal(idr.source, 'paid');
  assert.ok(Math.abs(idr.rate - 17_700) < 1e-6);
  // Freight, tax and fees never move the rate.
  assert.equal(poRate(NEW_PO, [{ po_id: 'po-017', cost_category: 'freight', amount: 5_000, currency: 'USD', exchange_rate: 15_000 }], FX).source, 'benchmark');
});

test('LR51100: the markup is PIO-008’s add-ons ÷ principal (+0.75%), applied to the reorder', () => {
  const inc = all().get(CID)!;
  assert.ok(Math.abs(inc.uplift! - U008) < 1e-12, `got ${inc.uplift}`);
  assert.ok(Math.abs((inc.uplift! - 1) * 100 - 0.745) < 0.001, 'VAT and income tax are not in it');
  assert.equal(inc.estLandedIdr, Math.round(539 * PIO017_RATE * U008));
  assert.equal(inc.provisional, false);
  assert.ok(inc.estLandedIdr > 9_700_000 && inc.estLandedIdr < 9_800_000, `≈ Rp 9.76m at an 18,000 benchmark, got ${inc.estLandedIdr}`);
});

test('LR51100: the rise is flagged, and the supplier price alone already beats landed', () => {
  const r = costRise(9_477_538, all().get(CID))!;
  assert.ok(r);
  assert.ok(r.risePct > 2.5 && r.risePct < 3.5, `≈ 3.0% at an 18,000 benchmark, got ${r.risePct}`);
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

test('an absurd markup (add-ons above the goods themselves: a booking error) is ignored, not applied', () => {
  const inc = incomingCosts({ pos: [OLD_PO, NEW_PO], poItems: LINES, quotes: [], quoteItems: [], receipts: [RECEIPT],
    poCosts: [...COSTS, { po_id: 'po-008', cost_category: 'freight_cost', amount: 2_000_000_000, currency: 'IDR' }] }, FX).get(CID)!;
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
    quotes: [], quoteItems: [], receipts: [RECEIPT], poCosts: COSTS }, FX).get(CID)!;
  assert.equal(inc.upliftSource, 'item');
  assert.equal(inc.upliftRef, 'PIO-008-ISL-05-2026');
  assert.equal(inc.supplierId, EPEVER);
});

test('an item the supplier never sent takes that supplier’s last delivered PO markup', () => {
  // EPEVER's last delivered PO: USD 3,000 paid at 17,000 (Rp 51m), Rp 5.1m freight → +10%.
  const po: IncPo = withSup({ po_id: 'po-x', po_number: 'PIO-X', po_date: '2026-06-01', status: 'Fully Received', currency: 'USD', exchange_rate: 17_000, total_value: 3_000 }, EPEVER);
  const lines: IncPoLine[] = [
    { po_id: 'po-x', component_id: 'a', unit_cost: 100, currency: 'USD' },
    { po_id: 'po-017', component_id: 'new-item', unit_cost: 200, currency: 'USD' },
  ];
  const inc = incomingCosts({ pos: [po, withSup(NEW_PO, EPEVER)], poItems: lines, quotes: [], quoteItems: [], receipts: [],
    poCosts: [paid('po-x', 3_000, 17_000), { po_id: 'po-x', cost_category: 'freight_cost', amount: 5_100_000, currency: 'IDR' }] }, FX).get('new-item')!;
  assert.equal(inc.upliftSource, 'supplier');
  assert.equal(inc.upliftRef, 'PIO-X');
  assert.ok(Math.abs(inc.uplift! - 1.10) < 1e-9, `got ${inc.uplift}`);
  assert.equal(inc.rateSource, 'benchmark', 'nothing paid on the reorder: the benchmark converts it');
  assert.equal(inc.estLandedIdr, Math.round(200 * 18_000 * 1.10));
  assert.equal(inc.provisional, false);
});

test('the same-supplier history beats the item’s history with another supplier', () => {
  const otherPo: IncPo = withSup({ po_id: 'po-o', po_number: 'PO-OTHER', po_date: '2026-08-01', status: 'Fully Received', currency: 'USD', exchange_rate: 17_000, total_value: 500 }, OTHER);
  const supPo: IncPo = withSup({ po_id: 'po-s', po_number: 'PO-EPEVER-OLD', po_date: '2026-03-01', status: 'Fully Received', currency: 'USD', exchange_rate: 17_000, total_value: 100 }, EPEVER);
  const lines: IncPoLine[] = [
    { po_id: 'po-o', component_id: CID, unit_cost: 500, currency: 'USD' },
    { po_id: 'po-s', component_id: 'z', unit_cost: 100, currency: 'USD' },
    LINES[1],
  ];
  const inc = incomingCosts({ pos: [otherPo, supPo, withSup(NEW_PO, EPEVER)], poItems: lines, quotes: [], quoteItems: [], receipts: [],
    poCosts: [paid('po-o', 500, 17_000), { po_id: 'po-o', cost_category: 'freight_cost', amount: 500 * 17_000 * 0.30, currency: 'IDR' },
              paid('po-s', 100, 17_000), { po_id: 'po-s', cost_category: 'freight_cost', amount: 100 * 17_000 * 0.08, currency: 'IDR' }] }, FX).get(CID)!;
  assert.equal(inc.upliftSource, 'supplier', 'EPEVER’s own markup, not the other supplier’s');
  assert.ok(Math.abs(inc.uplift! - 1.08) < 1e-9);
});

test('no history with this supplier at all: the item’s delivery from another supplier, said so', () => {
  const inc = incomingCosts({ pos: [withSup(OLD_PO, OTHER), withSup(NEW_PO, EPEVER)], poItems: LINES,
    quotes: [], quoteItems: [], receipts: [RECEIPT], poCosts: COSTS }, FX).get(CID)!;
  assert.equal(inc.upliftSource, 'item_elsewhere');
  assert.equal(inc.provisional, false);
});

test('a PO with no supplier of its own takes it from the quote it was raised from', () => {
  const q: IncQuote = { ...NEW_Q, status: 'Accepted', supplier_id: EPEVER };
  const po: IncPo = { ...NEW_PO, supplier_id: null, quote_id: 'q2' };
  const inc = incomingCosts({ pos: [withSup(OLD_PO, EPEVER), po], poItems: LINES, quotes: [q], quoteItems: [], receipts: [RECEIPT], poCosts: COSTS }, FX).get(CID)!;
  assert.equal(inc.supplierId, EPEVER);
  assert.equal(inc.upliftSource, 'item');
});

test('a quote carries its supplier, and uses that supplier’s markup', () => {
  const inc = incomingCosts({ pos: [withSup(OLD_PO, EPEVER)], poItems: [LINES[0]],
    quotes: [{ ...NEW_Q, supplier_id: EPEVER }], quoteItems: [{ quote_id: 'q2', component_id: 'brand-new', unit_price: 300, currency: 'USD' }],
    receipts: [RECEIPT], poCosts: COSTS }, FX).get('brand-new')!;
  assert.equal(inc.rateSource, 'benchmark');
  assert.equal(inc.upliftSource, 'supplier');
  assert.equal(inc.upliftRef, 'PIO-008-ISL-05-2026');
  assert.equal(inc.estLandedIdr, Math.round(300 * 18_000 * U008));
});

test('no exchange rate enters the markup: rupiah payments booked without a rate (KSTAR EB.41875)', () => {
  // Production, 2026-10-27: CNY 796,020 typed at 2,502, paid Rp 2,124,757,246 in rupiah rows with no
  // rate (really ~2,669). Add-ons Rp 8,295,421 (delivery, duty, bank). CIF + ACFTA duty → +0.39%.
  // The receipts-based reading turned the rate gap into "+7% import costs".
  const po: IncPo = withSup({ po_id: 'eb41875', po_number: 'EB.41875', po_date: '2026-04-08', status: 'Fully Received', currency: 'CNY', exchange_rate: 2_502, total_value: 796_020 }, 'sup-kstar');
  const next: IncPo = withSup({ po_id: 'nx', po_number: 'PIO-NEXT', po_date: '2026-10-01', status: 'Confirmed', currency: 'CNY', exchange_rate: 2_626, total_value: 1_000 }, 'sup-kstar');
  const lines: IncPoLine[] = [{ po_id: 'eb41875', component_id: 'ups', unit_cost: 1_000, currency: 'CNY' }, { po_id: 'nx', component_id: 'ups', unit_cost: 1_100, currency: 'CNY' }];
  const fx = { ...FX, CNY: { rate: 2_800, date: '2026-10-23', source: 'benchmark' as const, label: 'company rate' } };
  const inc = incomingCosts({ pos: [po, next], poItems: lines, quotes: [], quoteItems: [],
    receipts: [{ component_id: 'ups', unit_cost_idr: 1_000 * 2_502, moved_at: '2026-07-16', source_id: 'eb41875', quantity: 10 }],
    poCosts: [
      { po_id: 'eb41875', cost_category: 'balance_payment', amount: 2_124_757_246, currency: 'IDR' },
      { po_id: 'eb41875', cost_category: 'local_delivery', amount: 7_900_400, currency: 'IDR' },
      { po_id: 'eb41875', cost_category: 'local_import_duty', amount: 345_643, currency: 'IDR' },
      { po_id: 'eb41875', cost_category: 'admin_bank_fee', amount: 49_378, currency: 'IDR' },
      { po_id: 'eb41875', cost_category: 'local_vat', amount: 231_808_460, currency: 'IDR' },
      { po_id: 'eb41875', cost_category: 'penalty_fee', amount: 5_000_000, currency: 'IDR' },
    ] }, fx).get('ups')!;
  assert.equal(inc.upliftSource, 'item');
  assert.ok(Math.abs(inc.uplift! - (1 + 8_295_421 / 2_124_757_246)) < 1e-12, `got ${inc.uplift}`);
  assert.ok((inc.uplift! - 1) * 100 < 0.4, 'VAT and the penalty stay out of it');
});

test('a PO not yet paid in full teaches nothing: its landed cost is not final', () => {
  const inc = incomingCosts({ pos: [withSup(OLD_PO, EPEVER), withSup(NEW_PO, EPEVER)], poItems: LINES,
    quotes: [], quoteItems: [], receipts: [RECEIPT],
    poCosts: [{ po_id: 'po-008', cost_category: 'down_payment', amount: 3_000, currency: 'USD', exchange_rate: 17_490 }] }, FX).get(CID)!;
  assert.equal(inc.uplift, null);
  assert.equal(inc.provisional, true);
});

test('a local rupiah supplier really can land at ~0%: that is learned', () => {
  const po: IncPo = withSup({ po_id: 'loc', po_number: 'PO-LOCAL', po_date: '2026-09-01', status: 'Fully Received', currency: 'IDR' }, 'sup-local');
  const next: IncPo = withSup({ po_id: 'loc2', po_number: 'PO-LOCAL-2', po_date: '2026-10-12', status: 'Confirmed', currency: 'IDR' }, 'sup-local');
  const inc = incomingCosts({ pos: [po, next], poItems: [
      { po_id: 'loc', component_id: 'cable', unit_cost: 60_000, currency: 'IDR' },
      { po_id: 'loc2', component_id: 'cable', unit_cost: 69_000, currency: 'IDR' }],
    quotes: [], quoteItems: [], receipts: [{ component_id: 'cable', unit_cost_idr: 60_000, moved_at: '2026-09-05', source_id: 'loc', quantity: 100 }],
    poCosts: [{ po_id: 'loc', cost_category: 'balance_payment', amount: 6_000_000, currency: 'IDR' }] }, FX).get('cable')!;
  assert.equal(inc.uplift, 1);
  assert.equal(inc.upliftSource, 'item');
  assert.equal(inc.provisional, false);
});
