/**
 * The description libraries' matching rules (owner, 2026-11-04). The examples
 * are the real duplicates and free-text main components found in the review.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  libNorm, wordingSimilarity, differentItems, rankLibrary, exactEntry, nearEntries, similarGroups, mainComponentKind,
  libraryErrorKey, LIBRARY_SERVER_MESSAGES,
  type LibEntryLite,
} from './libraryMatch.ts';

const E = (id: string, description: string, extra: Partial<LibEntryLite> = {}): LibEntryLite => ({ entry_id: id, description, ...extra });

test('libNorm is the database rule: case, punctuation and spacing set aside', () => {
  assert.equal(libNorm('Equipment Transport '), 'equipment transport');
  assert.equal(libNorm('DC SPD 2P 40KA 600V'), libNorm('DC SPD 2P 40kA 600V'));
  assert.equal(libNorm('Final inspection, testing commissioning, and training '), 'final inspection testing commissioning and training');
  // The SQL in migrations/description_libraries_v2.sql must say the same thing.
  const sql = readFileSync(join(process.cwd(), 'migrations/description_libraries_v2.sql'), 'utf8');
  assert.match(sql, /regexp_replace\(lower\(coalesce\(t, ''\)\), '\[\^a-z0-9\]\+', ' ', 'g'\)/);
});

test('rankLibrary: every word in any order, best first, aliases count', () => {
  const lib = [
    E('a', 'Equipment transport', { uses: 69 }),
    E('b', 'Local transport', { uses: 75 }),
    E('c', 'Transport crane 25 ton', { uses: 2 }),
    E('d', 'Cable Tray 100mm', { aliases: ['Kabel tray 100mm'], uses: 4 }),
    E('e', 'Equipment transport by sea', { uses: 1, status: 'proposed' }),
  ];
  assert.deepEqual(rankLibrary(lib, 'transport').shown.map((e) => e.entry_id), ['c', 'b', 'a', 'e']);
  assert.deepEqual(rankLibrary(lib, 'transport equipment').shown.map((e) => e.entry_id), ['a', 'e']);
  assert.deepEqual(rankLibrary(lib, 'kabel tray').shown.map((e) => e.entry_id), ['d']);
  assert.equal(rankLibrary(lib, '').total, 0);
});

test('exactEntry: the wording the database would link to', () => {
  const lib = [E('a', 'Equipment transport'), E('d', 'Cable Tray 100mm', { aliases: ['Kabel tray 100mm'] })];
  assert.equal(exactEntry(lib, 'EQUIPMENT  Transport ')?.entry_id, 'a');
  assert.equal(exactEntry(lib, 'kabel-tray 100mm')?.entry_id, 'd');
  assert.equal(exactEntry(lib, 'Equipment transport by sea'), null);
});

test('nearEntries: did-you-mean for a new wording, never for the same one', () => {
  const lib = [E('a', 'Food and accomodation', { uses: 77 }), E('b', 'Manpower Mobilization', { uses: 31 })];
  assert.deepEqual(nearEntries(lib, 'Food and accommodation').map((x) => x.entry.entry_id), ['a']);
  assert.deepEqual(nearEntries(lib, 'Food and Accomodation'), [], 'same words: that is the entry, not a near one');
  assert.deepEqual(nearEntries(lib, 'Site survey'), []);
});

test('similarGroups: probable duplicates grouped, most used first', () => {
  const lib = [
    E('1', 'Wifi plug Pro SNV-GT', { uses: 3 }), E('2', 'WiFi Plug Pro SNVGT', { uses: 1 }),
    E('3', 'Grounding system', { uses: 4 }), E('4', 'Grounding sistem', { uses: 1 }),
    E('5', 'Detailed site survey', { uses: 41 }),
  ];
  const g = similarGroups(lib);
  assert.equal(g.length, 2);
  assert.deepEqual(g.map((x) => x.map((e) => e.entry_id)), [['3', '4'], ['1', '2']]);
  assert.ok(wordingSimilarity('Grounding system', 'Grounding sistem') >= 0.85);
});

test('differentItems: a rating or variant apart is a different item, not a duplicate', () => {
  for (const [a, b] of [['AC MCB 1P 25A', 'AC MCB 1P 32A'], ['Kabel NYA 6 mm² (Kuning Hijau)', 'Kabel NYA 300 mm² (Kuning Hijau)'],
    ['Bungasari Medan Phase 1', 'Bungasari Medan Phase 2'], ['AC Cables Tray / Conduit and Acc', 'DC Cables Tray / Conduit and Acc'],
    ['Data Logger Wifi SNV-GT', 'Data Logger Wifi SNV-GH'], ['NYA 150mm', 'NYY 150mm'], ['Cluster A', 'Cluster C'],
    ['Power Meter PM2120', 'Power Meter PM2220']]) {
    assert.ok(differentItems(a, b), `${a} / ${b}`);
  }
  for (const [a, b] of [['1600A DC NH4 SIBA + Holder', '1600 A DC NH4 SIBA + Holder'], ['Fitting Lampu', 'Fiting lampu'],
    ['Food and accomodation', 'Food accomodation'], ['Manpower Mobilization', 'Manpower Mobilisation']]) {
    assert.ok(!differentItems(a, b), `${a} / ${b}`);
  }
});

test('mainComponentKind: a stated rating makes it a main component; accessories stay free text', () => {
  assert.equal(mainComponentKind('JINKO JKM650-66HL4M-BDV 650Wp'), 'panel');
  assert.equal(mainComponentKind('SUNGROW SG125CX-P2 C&I Three Phase On-grid Inverter 125 kW'), 'inverter');
  assert.equal(mainComponentKind('SUNGROW ST255C2-2h Powerstack Battery 255 kWh / 125 kW'), 'battery');
  assert.equal(mainComponentKind('EPEVER LFP2.56KWH25.6V-P65H1'), null, 'no space before kWh inside a model code: not claimed');
  assert.equal(mainComponentKind('LiFePO4 25.6V 205Ah'), 'battery');
  assert.equal(mainComponentKind('HUAWEI SUN2000-100KTL-M2 100kW 3P'), 'inverter');
  for (const acc of ['Material Unloading PV Module and Inverter', 'Cable Jumper Battery', 'Box Battery BSP2002', 'DC MCCB 2P 65A, 1000V (Battery)',
    'Support Inverter', 'Inverter Mounting System', 'Battery Rack (Open Rack)', 'Equipment transport']) {
    assert.equal(mainComponentKind(acc), null, acc);
  }
});

test('every refusal the library functions can raise has a phrase-book key', () => {
  const sql = readFileSync(join(process.cwd(), 'migrations/description_libraries_v2.sql'), 'utf8');
  const raised = [...new Set([...sql.matchAll(/RAISE EXCEPTION '([^']+)'/g)].map((m) => m[1]))]
    .filter((m) => !m.startsWith('Unknown library'));
  for (const m of raised) {
    const { key } = libraryErrorKey(m.replace('%', '7'));
    assert.ok((LIBRARY_SERVER_MESSAGES as readonly string[]).includes(key) || key.includes('{n}'), m);
  }
  assert.deepEqual(libraryErrorKey('A later change (#42) touched the same entries — undo that first'),
    { key: 'A later change (#{n}) touched the same entries — undo that first', vars: { n: '42' } });
});
