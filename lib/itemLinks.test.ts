import { test } from 'node:test';
import assert from 'node:assert/strict';
import { linkCandidates, categoryPeers, likeness, matchesFilter, buildLinkRows, reasonRequired, LINK_TYPES, LINK_REASONS, type LinkableItem } from './itemLinks.ts';

const I = (id: string, desc: string, o: Partial<LinkableItem> = {}): LinkableItem =>
  ({ component_id: id, supplier_model: desc, internal_description: desc, brand: null, category: 'solar_charge_controller', norm_value: null, archived_at: null, ...o });

const scc = [
  I('x42', 'EPEVER XTRA4210N-G3 MPPT 40A', { brand: 'EPEVER' }),
  I('x32', 'EPEVER XTRA3210N-G3 MPPT 30A', { brand: 'EPEVER' }),
  I('srne', 'SRNE ML4840 MPPT 40A', { brand: 'SRNE' }),
  I('vs', 'EPEVER VS1024AU PWM SCC 10A', { brand: 'EPEVER' }),
  I('old', 'EPEVER XTRA4210N MPPT 40A (old)', { archived_at: '2026-01-01' }),
  ...Array.from({ length: 70 }, (_, i) => I(`f${i}`, `Filler controller ${i}`)),
  I('cab', 'NYY 4x300mm cable', { category: 'ac_cable' }),
];

test('the WHOLE category is offered — the 30-item cap is gone', () => {
  const c = linkCandidates(scc, scc[0], { filter: '', exclude: new Set() });
  assert.equal(c.sameCategory.length, 73, '74 active in the category minus itself; archived and other categories out');
  assert.equal(c.elsewhere.length, 0, 'other categories only while typing');
});

test('filtering inside the category, and "select all shown" means these', () => {
  const c = linkCandidates(scc, scc[0], { filter: 'mppt 40a', exclude: new Set() });
  assert.deepEqual(c.sameCategory.map((x) => x.component_id), ['srne']);
  assert.equal(matchesFilter(scc[1], 'xtra mppt'), true);
  assert.equal(matchesFilter(scc[1], 'xtra pwm'), false);
});

test('typing also searches other categories — some real links cross them', () => {
  const c = linkCandidates(scc, scc[0], { filter: 'nyy', exclude: new Set() });
  assert.deepEqual(c.elsewhere.map((x) => x.component_id), ['cab']);
});

test('suggestions are the look-alikes, listed first, never pre-ticked', () => {
  const c = linkCandidates(scc, scc[0], { filter: '', exclude: new Set() });
  assert.ok(c.suggested.has('x32'), 'same family, different amperage');
  assert.ok(!c.suggested.has('f3'));
  assert.equal(c.sameCategory[0].component_id, 'x32');
  assert.ok(likeness(I('a', 'TRINA 630Wp TOPCon', { norm_value: 630 }), I('b', 'JINKO 625Wp TOPCon', { norm_value: 625 })) > likeness(I('a', 'TRINA 630Wp TOPCon'), I('b', 'JINKO 625Wp TOPCon')),
    'capacity within 10% counts');
});

test('already-linked items are not offered again', () => {
  const c = linkCandidates(scc, scc[0], { filter: '', exclude: new Set(['x32']) });
  assert.ok(!c.sameCategory.some((x) => x.component_id === 'x32'));
});

test('rows: successor direction, normalized values, the reason on every row', () => {
  const rows = buildLinkRows('self', [{ component_id: 't1' }, { component_id: 't2' }], {
    type: 'successor', succDir: 'self_succeeds', normUnit: 'Wp', normSelf: null, normByTarget: {}, reason: ' Newer version ',
  });
  assert.deepEqual(rows.map((r) => [r.component_id_a, r.component_id_b, r.notes]), [['t1', 'self', 'Newer version'], ['t2', 'self', 'Newer version']]);
  const n = buildLinkRows('self', [{ component_id: 't1' }], { type: 'normalized', succDir: 'target_succeeds', normUnit: 'Wp', normSelf: 630, normByTarget: { t1: 550 }, reason: '' });
  assert.deepEqual([n[0].normalization_unit, n[0].norm_value_a, n[0].norm_value_b, n[0].notes], ['Wp', 630, 550, null]);
});

test('a successor link needs a reason; category reference is no longer offered', () => {
  assert.equal(reasonRequired('successor'), true);
  assert.equal(reasonRequired('brand_equivalent'), false);
  assert.ok(!LINK_TYPES.some((t) => (t.value as string) === 'category_comparable'));
  for (const t of LINK_TYPES) assert.ok(LINK_REASONS[t.value].length > 0, t.value);
});

test('others in this category: this item included, cheapest per unit first, big categories trimmed to the most alike', () => {
  const self = I('p630', 'TRINA 630Wp TOPCon', { category: 'pv_module', norm_value: 630 });
  const peers = [
    I('p550', 'JINKO 550Wp Mono', { category: 'pv_module', norm_value: 550 }),
    I('p620', 'TRINA 620Wp TOPCon', { category: 'pv_module', norm_value: 620 }),
    I('nop', 'Unpriced panel', { category: 'pv_module', norm_value: 600 }),
    I('cab', 'NYY cable', { category: 'ac_cable' }),
  ];
  const price: Record<string, number | null> = { p630: 1_764_706, p550: 1_650_000, p620: 1_700_000, nop: null };
  const { rows, total } = categoryPeers(self, [self, ...peers], (c) => price[c.component_id] ?? null, { perUnit: true, limit: 10 });
  assert.equal(total, 3);
  assert.deepEqual(rows.map((r) => r.item.component_id), ['p620', 'p630', 'p550', 'nop'], 'per Wp: 2742 < 2801 < 3000; unpriced last');
  assert.equal(rows.find((r) => r.self)!.item.component_id, 'p630');
  const big = categoryPeers(self, [self, ...Array.from({ length: 50 }, (_, i) => I(`x${i}`, i === 7 ? 'TRINA 630Wp TOPCon bifacial' : `Other thing ${i}`, { category: 'pv_module' }))],
    () => null, { perUnit: true, limit: 5 });
  assert.equal(big.total, 50);
  assert.equal(big.rows.length, 6, 'five most alike + this item');
  assert.ok(big.rows.some((r) => r.item.component_id === 'x7'));
});
