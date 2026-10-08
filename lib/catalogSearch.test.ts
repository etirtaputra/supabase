import { test } from 'node:test';
import assert from 'node:assert/strict';
import { catalogMatches, matchRank, lastQuotedDates } from './catalogSearch.ts';

// The real Deye catalogue order on 2026-10-08 (alphabetical by model) — the
// three quoted on 2026-10-07 sat 9th, 11th and 22nd.
const models = [
  'DEYE BOS-A-Pack7.68', 'DEYE BOS-A-PDU-2', 'DEYE BOS-B Pro-A3 BOS-B-PDU-2', 'DEYE BOS-B-Accessories', 'DEYE BOS-B-Pack16-A3',
  'DEYE LSE-3 Stick Logger Ethernet', 'DEYE MPPT SUN-MPPT-L01-EU-AM8', 'DEYE PCS SUN-100K-PCS01HP3', 'DEYE SUN-100K-G03',
  'DEYE SUN-100K-SG02HP3-EU-GM8', 'DEYE SUN-110K-G03', 'DEYE SUN-125K-SG02HP3-EU-GM10', 'DEYE SUN-12K-SG05LP3-EU-SM2',
  'DEYE SUN-20K-SG01HP3-EU-AM2', 'DEYE SUN-20K-SG05LP3-EU-SM2', 'DEYE SUN-25K-SG01HP3-EU-AM2', 'DEYE SUN-25K-SG02HP3-EU-AM3',
  'DEYE SUN-30K-SG01HP3-EU-BM3', 'DEYE SUN-30K-SG02HP3-EU-AM3', 'DEYE SUN-35K-SG01HP3-EU-BM3', 'DEYE SUN-40K-SG01HP3-EU-BM4',
  'DEYE SUN-50K-G04', 'DEYE SUN-50K-SG01HP3-EU-BM4', 'DEYE SUN-5K-SG05LP1-EU-SM2-P', 'DEYE SUN-60K-SG02HP3-EU-EM6',
  'DEYE SUN-80K-SG02HP3-EU-EM6', 'DEYE SUN-8K-SG06LP1-EU-CM3', 'DEYE SUN-STS500L',
];
const deye = models.map((m) => ({ component_id: m, supplier_model: m, internal_description: m, brand: 'DEYE', category: 'inverter' }));
const NEW = ['DEYE SUN-100K-G03', 'DEYE SUN-110K-G03', 'DEYE SUN-50K-G04'];
const quoted = new Map<string, string>([...NEW.map((m): [string, string] => [m, '2026-10-07']), ['DEYE SUN-80K-SG02HP3-EU-EM6', '2026-09-11']]);

test('"deye" shows the freshly quoted inverters first, and says how many more matched', () => {
  const r = catalogMatches(deye, 'deye', { limit: 12, lastQuoted: quoted });
  assert.deepEqual(r.shown.slice(0, 3).map((c) => c.component_id).sort(), [...NEW].sort());
  assert.equal(r.shown[3].component_id, 'DEYE SUN-80K-SG02HP3-EU-EM6');
  assert.equal(r.total, 28);
  assert.equal(r.shown.length, 12);
});

test('words match in any order — "deye 100k" and "100k g03" find it', () => {
  assert.ok(catalogMatches(deye, 'deye 100k', { limit: 12 }).shown.some((c) => c.component_id === 'DEYE SUN-100K-G03'));
  assert.deepEqual(catalogMatches(deye, '100k g03', { limit: 12 }).shown.map((c) => c.component_id), ['DEYE SUN-100K-G03']);
  assert.equal(catalogMatches(deye, 'deye 999k', { limit: 12 }).total, 0);
});

test('closest first: starts-with, then the phrase as typed, then words anywhere', () => {
  const it = { component_id: 'x', supplier_model: 'SUN-50K-G04', internal_description: 'DEYE SUN-50K-G04', brand: 'DEYE', category: 'on_grid_inverter' };
  assert.equal(matchRank(it, 'sun-50k'), 3);
  assert.equal(matchRank(it, 'deye sun-50k'), 3);
  assert.equal(matchRank(it, '50k-g04'), 2);
  assert.equal(matchRank(it, 'g04 deye'), 1);
  assert.equal(matchRank(it, 'on_grid'), 2, 'category still searchable');
  assert.equal(matchRank(it, ''), 0);
});

test('last-quoted date per item is the newest quote that prices it', () => {
  const m = lastQuotedDates(
    [{ quote_id: 'a', quote_date: '2026-09-11' }, { quote_id: 'b', quote_date: '2026-10-07' }],
    [{ quote_id: 'a', component_id: 'c1' }, { quote_id: 'b', component_id: 'c1' }, { quote_id: 'a', component_id: 'c2' }, { quote_id: 'b', component_id: null }],
  );
  assert.equal(m.get('c1'), '2026-10-07');
  assert.equal(m.get('c2'), '2026-09-11');
});
