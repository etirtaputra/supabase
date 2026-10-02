import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  askAllowed, askKeywords, companyCode, matchComponents, matchSuppliers, purchaseLines,
  supplierPerformance, toIdr, componentStats, withQuoteParties, type AskPo, type AskLine, type AskComponent,
} from './askContext.ts';

test('Ask ICAPROC answers buy-side roles only — the /ask screen\'s own gate', () => {
  for (const r of ['owner', 'buy_admin', 'data_entry', 'finance']) assert.equal(askAllowed(r), true, r);
  for (const r of ['engineer', 'sales', 'sell_admin', 'warehouse', 'aftersales', 'viewer']) assert.equal(askAllowed(r), false, r);
  assert.equal(askAllowed(null), false, 'no profile → no answer (a server is not a page still loading)');
  assert.equal(askAllowed('made_up'), false);
});

test('keywords drop the question words and punctuation', () => {
  assert.deepEqual(askKeywords('What did we pay for the EPEVER XTRA3210N?'), ['epever', 'xtra3210n']);
  assert.deepEqual(askKeywords('show me the last price'), []);
});

test('company codes are the ones people say', () => {
  assert.equal(companyCode('PT Indodaya Surya Lestari'), 'ISL');
  assert.equal(companyCode('PT Mandala Bersama Sejahtera'), 'MBS');
  assert.equal(companyCode('PT Indodaya Cipta Lestari'), 'ICL');
  assert.equal(companyCode(null), '?');
});

const comps: AskComponent[] = [
  { component_id: 'c1', internal_description: 'EPEVER XTRA3210N-G3 MPPT 30A', supplier_model: 'XTRA3210N-G3', brand: 'EPEVER', category: null },
  { component_id: 'c2', internal_description: 'EPEVER Tracer 5210AN', supplier_model: 'TRACER5210AN', brand: 'EPEVER', category: null },
  { component_id: 'c3', internal_description: 'ICA550-72HMI 550Wp', supplier_model: 'ICA550-72HMI', brand: 'ICA', category: null },
];

test('the item asked about wins over every item of the same brand', () => {
  assert.deepEqual(matchComponents(comps, ['epever', 'xtra3210n']).map((c) => c.component_id), ['c1']);
  assert.deepEqual(matchComponents(comps, ['epever']).map((c) => c.component_id), ['c1', 'c2']);
  assert.deepEqual(matchComponents(comps, []), []);
  assert.deepEqual([...matchSuppliers(new Map([['s1', 'Epever Tech'], ['s2', 'Kstar']]), ['kstar'])], ['s2']);
});

const po = (id: string, o: Partial<AskPo>): AskPo => ({
  po_id: id, po_number: id.toUpperCase(), po_date: '2026-09-01', status: 'Confirmed', currency: 'IDR',
  exchange_rate: null, total_value: 0, supplier_id: 's1', company_id: 'k1',
  estimated_delivery_date: null, actual_received_date: null, ...o,
});

test('Draft and Replaced POs are not purchases — in lines, stats and supplier spend', () => {
  const pos = [
    po('p1', { po_date: '2026-08-01', total_value: 1000 }),
    po('p2', { status: 'Draft', po_date: '2026-09-20', total_value: 99999 }),
    po('p3', { status: 'Replaced', po_date: '2026-09-10', total_value: 88888 }),
    po('p4', { po_date: '2026-09-05', currency: 'USD', exchange_rate: 16000, total_value: 10,
      estimated_delivery_date: '2026-09-10', actual_received_date: '2026-09-14' }),
  ];
  const lines: AskLine[] = [
    { po_id: 'p1', component_id: 'c1', supplier_description: null, quantity: 2, unit_cost: 500, currency: 'IDR' },
    { po_id: 'p2', component_id: 'c1', supplier_description: null, quantity: 1, unit_cost: 99999, currency: 'IDR' },
    { po_id: 'p3', component_id: 'c1', supplier_description: null, quantity: 1, unit_cost: 88888, currency: 'IDR' },
    { po_id: 'p4', component_id: 'c1', supplier_description: null, quantity: 1, unit_cost: 10, currency: 'USD' },
  ];
  const m = new Map(comps.map((c) => [c.component_id, c]));
  const rows = purchaseLines({
    pos, lines, comps: m, suppliers: new Map([['s1', 'Epever Tech']]), companies: new Map([['k1', 'ISL']]),
    tuc: new Map(), componentIds: new Set(['c1']), supplierIds: new Set(), limit: 10,
  });
  assert.deepEqual(rows.map((r) => r.poNumber), ['P4', 'P1'], 'newest first, no Draft, no Replaced');
  assert.equal(rows[0].unitCostIdr, 160000, 'USD at the PO\'s own rate');
  assert.equal(rows[0].tucIdr, null, 'no settled PO → no True Unit Cost, said as such');

  const [perf] = supplierPerformance(pos, new Map([['s1', 'Epever Tech']]));
  assert.equal(perf.orders, 2);
  assert.equal(perf.spendIdr, 1000 + 160000);
  assert.equal(perf.avgDelayDays, 4);
  assert.equal(perf.lastOrder, '2026-09-05');

  const stats = componentStats({ componentIds: ['c1'], pos, lines, comps: m, companies: new Map([['k1', 'ISL']]), tuc: new Map(), limit: 5 });
  assert.match(stats, /POs: 2 \(ISL=2\)/);
  assert.match(stats, /min Rp500, max Rp160,000/);
  assert.doesNotMatch(stats, /99,999|88,888/);
});

test('a PO without its own supplier/company takes them from its supplier quote — never overrides', () => {
  const pos = [
    po('p1', { supplier_id: null, company_id: null, quote_id: 'q1' }),
    po('p2', { supplier_id: 's9', company_id: 'k9', quote_id: 'q1' }),
    po('p3', { supplier_id: null, company_id: null, quote_id: null }),
  ];
  const out = withQuoteParties(pos, [{ quote_id: 'q1', supplier_id: 's1', company_id: 'k1' }]);
  assert.deepEqual(out.map((p) => [p.supplier_id, p.company_id]), [['s1', 'k1'], ['s9', 'k9'], [null, null]]);
});

test('a foreign PO with no rate is not converted at a guess', () => {
  assert.equal(toIdr(10, { currency: 'USD', exchange_rate: null }), null);
  assert.equal(toIdr(10, { currency: 'IDR', exchange_rate: null }), 10);
});

test('a settled PO line carries the TUC engine\'s number for THAT PO, not a second formula', () => {
  const pos = [po('p1', { po_number: 'PO-1', po_date: '2026-08-01' }), po('p2', { po_number: 'PO-2', po_date: '2026-09-01' })];
  const lines: AskLine[] = [
    { po_id: 'p1', component_id: 'c1', supplier_description: null, quantity: 2, unit_cost: 500, currency: 'IDR' },
    { po_id: 'p2', component_id: 'c1', supplier_description: null, quantity: 1, unit_cost: 600, currency: 'IDR' },
  ];
  // The shape computeTUCMap returns: one entry per settled PO, labelled by PO number.
  const tuc = new Map([['c1', {
    tuc: 700, avgTuc: 650, latestTuc: 700, latestPoDate: '2026-09-01', latestXr: null, poCount: 2,
    entries: [
      { kind: 'tuc' as const, label: 'PO-2', date: '2026-09-01', unitCost: 700 },
      { kind: 'tuc' as const, label: 'PO-1', date: '2026-08-01', unitCost: 600 },
    ],
  }]]);
  const rows = purchaseLines({
    pos, lines, comps: new Map(comps.map((c) => [c.component_id, c])), suppliers: new Map(), companies: new Map(),
    tuc, componentIds: null, supplierIds: null, limit: 5,
  });
  assert.deepEqual(rows.map((r) => [r.poNumber, r.tucIdr]), [['PO-2', 700], ['PO-1', 600]]);
  const stats = componentStats({ componentIds: ['c1'], pos, lines, comps: new Map(comps.map((c) => [c.component_id, c])), companies: new Map(), tuc, limit: 5 });
  assert.match(stats, /True Unit Cost \(headline = max of latest and average\): Rp700, latest Rp700 on 2026-09-01, average Rp650 over 2 settled POs/);
});

test('the route reads no view that is gone, and checks the role before reading anything', () => {
  const src = readFileSync(new URL('../app/api/ask/route.ts', import.meta.url), 'utf8');
  for (const gone of ['v_analytics_master', 'mv_component_analytics', 'v_supplier_performance', 'v_purchase_history_analytics', 'v_quote_history_analytics']) {
    assert.doesNotMatch(src, new RegExp(gone), gone);
  }
  const gate = src.indexOf('askAllowed(');
  assert.ok(gate > 0, 'the route applies the /ask gate');
  assert.ok(gate < src.indexOf("from('5.0_purchases')"), 'before the first buy-side read');
});
