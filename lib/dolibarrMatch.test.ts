/**
 * Batch 0 of the Dolibarr move: "already in ICAPROC / possible match / new".
 *
 * The rule under test is that `same` stays narrow. Batch 1 writes the Dolibarr
 * id onto every `same` row without asking, so a false `same` would move one
 * customer's history onto another. Every looser case must come back
 * `possible`, with the candidates, for the owner to confirm.
 * (Names below are invented; the real lists stay out of git.)
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  partyKey, looseKey, similarity, matchParties, lookAlikes, unclaimed,
  compact, modelCodes, ratings, itemName, looksInternal, matchItems, matchUsers, tally, type Party,
} from './dolibarrMatch.ts';

const P = (id: string, ...names: string[]): Party => ({ id, names, label: names[0] });

test('partyKey sets aside case, punctuation, PT/CV and Bpk/Ibu', () => {
  assert.equal(partyKey('PT. Maju Jaya Abadi'), 'maju jaya abadi');
  assert.equal(partyKey('Maju Jaya Abadi, PT'), 'maju jaya abadi');
  assert.equal(partyKey('CV  MAJU-JAYA abadi'), 'maju jaya abadi');
  assert.equal(partyKey('Bpk. Hendro'), 'hendro');
  assert.equal(partyKey('Abc Science & Technology'), partyKey('Abc Science and Technology'));
  assert.equal(partyKey('Toko Besi dan Kayu'), partyKey('Toko Besi & Kayu'));
  assert.equal(partyKey('Bpk./Ibu Didi'), 'didi');
  assert.equal(partyKey('Shenzhen Abc Technology Co., Ltd.'), 'shenzhen abc technology');
  // a name made only of a legal form keeps it, so it still has a key
  assert.equal(partyKey('PT'), 'pt');
  assert.equal(partyKey(''), '');
});

test('looseKey also ignores spacing inside words and known spellings', () => {
  assert.equal(looseKey('PT Karya Mas'), looseKey('PT Karyamas'));
  assert.equal(looseKey('PT Anugerah Tehnik'), looseKey('PT Anugrah Teknik'));
  assert.notEqual(partyKey('PT Anugerah Tehnik'), partyKey('PT Anugrah Teknik'));
});

test('similarity is 1 for equal text and falls with differences', () => {
  assert.equal(similarity('abc', 'abc'), 1);
  assert.equal(similarity('', 'abc'), 0);
  assert.ok(similarity('wiratamasistemintegrasi', 'wiratamasistemintregasi') > 0.85);
  assert.ok(similarity('majujaya', 'suryakencana') < 0.3);
});

test('customers: same, possible, new', () => {
  const icaproc = [
    P('c1', 'PT Maju Jaya Abadi'),
    P('c2', 'PT Karya Mas Sentosa'),
    P('c3', 'PT Wiratama Sistem Integrasi'),
    P('c4', 'PT Lestari Hotel Group', 'Hotel Lestari Bali'),
    P('c5', 'Bpk. Hendro'),
  ];
  const dolibarr = [
    P('d1', 'PT. MAJU JAYA ABADI'),          // same: case + punctuation
    P('d2', 'PT Karyamas Sentosa'),          // possible: spacing
    P('d3', 'PT Wiratama Sistem Intregasi'), // possible: typo
    P('d4', 'Hotel Lestari Bali'),           // same: via the display name
    P('d5', 'Hendro'),                       // same: honorific set aside
    P('d6', 'CV Sumber Baru'),               // new
  ];
  const m = matchParties(dolibarr, icaproc);
  const by = Object.fromEntries(m.map((x) => [x.source.id, x]));
  assert.equal(by.d1.status, 'same'); assert.equal(by.d1.match?.id, 'c1');
  assert.equal(by.d2.status, 'possible'); assert.equal(by.d2.match?.id, 'c2');
  assert.equal(by.d3.status, 'possible'); assert.equal(by.d3.match?.id, 'c3');
  assert.match(by.d3.why, /mirip/);
  assert.equal(by.d4.status, 'same'); assert.equal(by.d4.match?.id, 'c4');
  assert.equal(by.d5.status, 'same'); assert.equal(by.d5.match?.id, 'c5');
  assert.equal(by.d6.status, 'new'); assert.equal(by.d6.match, null);
  assert.deepEqual(tally(m), { same: 3, possible: 2, new: 1 });
});

test('same is never given when ICAPROC has two rows with that name', () => {
  const m = matchParties([P('d1', 'PT Maju')], [P('c1', 'PT Maju'), P('c2', 'CV Maju')]);
  assert.equal(m[0].status, 'possible');
  assert.equal(m[0].candidates.length, 2);
});

test('same is never given to two Dolibarr rows for one ICAPROC row', () => {
  const m = matchParties([P('d1', 'PT Maju'), P('d2', 'Maju, PT')], [P('c1', 'PT Maju')]);
  assert.deepEqual(m.map((x) => x.status), ['possible', 'possible']);
  assert.match(m[0].why, /2 baris Dolibarr/);
});

test('suppliers: a short name inside the full legal name is possible, not same', () => {
  const generic = new Set(['huizhou', 'technology', 'shenzhen', 'science', 'new', 'energi']);
  const icaproc = [P('s1', 'Huizhou Epever Technology Co., Ltd.', 'EPEVER'), P('s2', 'Shenzhen Kstar Science & Technology Co., Ltd.', 'KSTAR')];
  const m = matchParties([P('d1', 'Epever Technology'), P('d2', 'KSTAR'), P('d3', 'Kstar New Energy')], icaproc, { generic });
  assert.equal(m[0].status, 'possible'); assert.equal(m[0].match?.id, 's1');
  assert.equal(m[1].status, 'same'); assert.equal(m[1].match?.id, 's2'); // the supplier code is one of its names
  assert.equal(m[2].status, 'possible'); assert.equal(m[2].match?.id, 's2');
});

test('lookAlikes finds rows on one side that are probably one party', () => {
  const g = lookAlikes([P('a', 'PT Karya Mas'), P('b', 'PT Karyamas'), P('c', 'PT Lain')]);
  assert.equal(g.length, 1);
  assert.deepEqual(g[0].map((p) => p.id).sort(), ['a', 'b']);
});

test('unclaimed lists ICAPROC rows no Dolibarr row points at', () => {
  const icaproc = [P('c1', 'PT Maju'), P('c2', 'PT Sendiri')];
  const m = matchParties([P('d1', 'PT Maju')], icaproc);
  assert.deepEqual(unclaimed(icaproc, m).map((p) => p.id), ['c2']);
});

test('item keys: compact, model codes, ratings', () => {
  assert.equal(compact('JEMBO Kabel NYAF 6 mm²'), 'jembokabelnyaf6mm2');
  assert.deepEqual([...modelCodes('EPEVER IT6420NC-G3 MPPT 60A (IP32)')], ['IT6420NCG3']);
  assert.deepEqual([...modelCodes('SL7N-63_25A_2P_600V')], ['SL7N63']);
  assert.deepEqual([...modelCodes('Kabel NYAF 1 x 6mm')], []);
  assert.deepEqual([...modelCodes('MIBET MA Symmetric Rail H43 L3600mm AL6005-T5')], []);
  assert.deepEqual([...ratings('DC MCB 25A 2P 600V')].sort(), ['25a', '2p', '600v']);
  assert.deepEqual([...ratings('Kabel 6 mm²')], ['6mm2']);
});

test('items: same name, same model code, brandless, rating clash, new', () => {
  const icaproc = [
    { id: 'i1', model: 'EPEVER TRACER5210LPLI MPPT 20A', brand: 'EPEVER' },
    { id: 'i2', model: 'EPEVER IT6420NC-G3 MPPT 60A (IP32)', brand: 'EPEVER' },
    { id: 'i3', model: 'SUNTREE DC MCB SL7N-63 25A 2P 600V', brand: 'SUNTREE' },
    { id: 'i4', model: 'SUNTREE DC MCB SL7N-63 32A 2P 600V', brand: 'SUNTREE' },
    { id: 'i5', model: 'ICA SOLAR SNV-GT2002DM 20kW 2xMPPT', brand: 'ICA SOLAR' },
    { id: 'i6', model: 'SUPREME Kabel NYAF 4 mm²', brand: 'SUPREME' },
    { id: 'i7', model: 'EPEVER UP1500-M6322 1500W', brand: 'EPEVER' },
  ];
  const dolibarr = [
    { id: 'd1', ref: 'BF2-1202006-000', label: 'EPEVER TRACER5210LPLI MPPT 20A' }, // same: name
    { id: 'd2', ref: 'IT6420NC-G3', label: 'EPEVER IT6420NC-G3 60A' },            // same: code, ratings agree
    { id: 'd3', ref: 'SL7N-63_40A_2P_600V', label: 'SUNTREE DC MCB SL7N-63 40A 2P 600V' }, // possible: code on 2 items
    { id: 'd4', ref: 'AE0-2320001-010', label: 'ICASolar SNV-GT2002DM 20kW 2xMPPT' },   // same: ICA SOLAR = ICASolar
    { id: 'd5', ref: 'Kabel_NYAF_4', label: 'Kabel NYAF 4 mm²' },                       // possible: brandless
    { id: 'd6', ref: 'UP1500-M6322', label: 'EPEVER UP1500-M6322 3000W' },               // possible: rating clash
    { id: 'd7', ref: 'Fuse_Tanam_2A', label: 'Fuse Tanam 2A' },                          // new
  ];
  const m = matchItems(dolibarr, icaproc);
  const by = Object.fromEntries(m.map((x) => [x.source.id, x]));
  assert.equal(by.d1.status, 'same'); assert.equal(by.d1.match?.id, 'i1');
  assert.equal(by.d2.status, 'same'); assert.equal(by.d2.match?.id, 'i2');
  assert.equal(by.d3.status, 'possible'); assert.equal(by.d3.candidates.length, 2);
  assert.equal(by.d4.status, 'same'); assert.equal(by.d4.match?.id, 'i5');
  assert.equal(by.d5.status, 'possible'); assert.equal(by.d5.match?.id, 'i6');
  assert.equal(by.d6.status, 'possible'); assert.match(by.d6.why, /rating/);
  assert.equal(by.d7.status, 'new');
});

test('cable sizes: "1 x 185mm" is "185 mm²"; a clamp length is left alone', () => {
  assert.equal(compact(itemName('Kabel NYAF 1 x 185mm')), compact(itemName('Kabel NYAF 185 mm²')));
  assert.equal(compact(itemName('Kabel NYY 1 x 185 mm²')), compact(itemName('Kabel NYY 185mm')));
  assert.equal(compact(itemName('Kabel NYM 3 x 4mm')), compact(itemName('Kabel NYM 3 x 4 mm²')));
  assert.equal(itemName('C Clamp Kit L35/40mm'), 'C Clamp Kit L35/40mm');
  const m = matchItems(
    [{ id: 'd1', ref: 'NYAF_1_x_185mm', label: 'Kabel NYAF 1 x 185mm' }],
    [{ id: 'i1', model: 'JEMBO Kabel NYAF 185 mm²', brand: 'JEMBO' }, { id: 'i2', model: 'KMI Kabel NYAF 185 mm²', brand: 'KMI' }],
  );
  assert.equal(m[0].status, 'possible');            // which brand is a person's call
  assert.equal(m[0].candidates.length, 2);
  assert.equal(m[0].source.label, 'Kabel NYAF 1 x 185mm'); // the report shows Dolibarr's own words
});

test('a model code that starts a longer one is possible', () => {
  const m = matchItems(
    [{ id: 'd1', ref: 'LFP5.12KWH-25.6V-P65L2GF40', label: 'EPEVER LFP5.12KWH-25.6V-P65L2GF40' }],
    [{ id: 'i1', model: 'EPEVER LFP5.12KWH-25.6V-P65L2GF40-Colombia LiFePO4 25.6V/205Ah', brand: 'EPEVER' }],
  );
  assert.equal(m[0].status, 'possible');
  assert.equal(m[0].match?.id, 'i1');
});

test('placeholder parties are told apart from customers', () => {
  assert.ok(looksInternal('13213'));
  assert.ok(looksInternal('(PERAKITAN INTERNAL)'));
  assert.ok(looksInternal('  '));
  assert.ok(!looksInternal('PT Maju (Persero)'));
  assert.ok(!looksInternal('Bpk. Hendro'));
});

test('a model code without the brand is only possible', () => {
  const m = matchItems(
    [{ id: 'd1', ref: 'GT500-4G', label: 'GT500 4G-Global-NoGPS for pump' }],
    [{ id: 'i1', model: 'EPSIVO GT500 4G-Global-NoGPS', brand: 'EPSIVO' }],
  );
  assert.equal(m[0].status, 'possible');
  assert.match(m[0].why, /merek/);
});

test('users: email is same; a name or login is only possible', () => {
  const icaproc = [
    { email: 'ade@example.com', name: 'Ade Siti Fatimah', role: 'sell_admin' },
    { email: 'po@example.com', name: null, role: 'buy_admin' },
    { email: 'boss@example.com', name: 'Budi Santoso', role: 'owner' },
  ];
  const m = matchUsers([
    { login: 'budi', name: 'Budi Santoso', email: 'BOSS@example.com' }, // same: email, any case
    { login: 'ade', name: 'Ade', email: null },                         // possible: login = email name
    { login: 'po', name: 'Purchasing', email: 'po@other.com' },          // possible: login = email name
    { login: 'rina', name: 'Rina Wati', email: 'rina@other.com' },       // new
  ], icaproc);
  assert.deepEqual(m.map((x) => x.status), ['same', 'possible', 'possible', 'new']);
  assert.equal(m[0].match?.id, 'boss@example.com');
  assert.equal(m[1].match?.id, 'ade@example.com');
});

test('the matcher writes nothing: no I/O in the module', async () => {
  const { readFileSync } = await import('node:fs');
  const src = readFileSync(new URL('./dolibarrMatch.ts', import.meta.url), 'utf8');
  for (const word of ['supabase', 'fetch(', 'node:fs', 'node:http', '.from(', '.rpc(', 'XMLHttpRequest']) {
    assert.ok(!src.includes(word), `dolibarrMatch.ts mentions ${word}`);
  }
});
