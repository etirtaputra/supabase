/**
 * The phrase book, kept honest.
 *
 * Keying translations by their English text buys readable call sites and a
 * safe fallback, and costs one thing: edit the English and its translation is
 * orphaned in silence. So the orphans are found here — every entry's English
 * side must still appear somewhere in the app, or the entry is dead weight
 * that will never render again.
 *
 * The other half is the promise the fallback makes: a string with no
 * translation reads as the English it was given, never as a blank or a key.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { t, tf, ID, KEEPERS, isKeeper, translationCount } from './i18n.ts';
import { DESTINATIONS } from '../constants/navigation.ts';
import { DASHBOARD_WIDGETS, QUICK_ACTIONS } from '../constants/dashboardWidgets.ts';
import { ROLE_LABELS, ROLE_DESCRIPTIONS } from '../constants/roles.ts';

const sourceFiles = (dir: string): string[] => {
  const out: string[] = [];
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    if (e.name === 'node_modules' || e.name.startsWith('.')) continue;
    const p = join(dir, e.name);
    if (e.isDirectory()) out.push(...sourceFiles(p));
    else if (/\.tsx?$/.test(e.name) && !/\.test\.ts$/.test(e.name)) out.push(p);
  }
  return out;
};

test('a string with no translation reads as its English, never as a key or a blank', () => {
  assert.equal(t('Something nobody has translated', 'id'), 'Something nobody has translated');
  assert.equal(t('Something nobody has translated', 'en'), 'Something nobody has translated');
  // English asks for no lookup at all — the app it was written in
  assert.equal(t('On-hand per warehouse, moving-average cost, shortages', 'en'),
    'On-hand per warehouse, moving-average cost, shortages');
  assert.equal(t('', 'id'), '');
});

test('Bahasa Indonesia answers where it has an answer', () => {
  assert.equal(t('On-hand per warehouse, moving-average cost, shortages', 'id'),
    'Stok per gudang, biaya rata-rata bergerak, kekurangan barang');
  // Was 'Stock · Gudang' until 2026-08-25 — the menus-stay-English rule left
  // the module's own name untranslated inside its subtitle.
  assert.equal(t('Stock · Warehouse', 'id'), 'Stok · Gudang');
  assert.ok(translationCount('id') > 50, 'the phrase book has emptied out');
  assert.equal(translationCount('en'), 0, 'English needs no dictionary');
});

test('every translation still has an English side that the app renders', () => {
  const haystack = [...sourceFiles('app'), ...sourceFiles('components'), ...sourceFiles('constants'), ...sourceFiles('lib')]
    .filter((f) => !f.endsWith('lib/i18n.ts'))
    .map((f) => readFileSync(f, 'utf8'))
    .join('\n');
  const orphans = Object.keys(ID).filter((en) => !haystack.includes(en));
  assert.deepEqual(orphans, [],
    `these translations no longer match any text in the app, so they can never render: ${orphans.join(' | ')}`);
});

test('no translation is left as its own English — that is just an untranslated line', () => {
  const lazy = Object.entries(ID).filter(([en, id]) => en === id);
  assert.deepEqual(lazy.map(([en]) => en), []);
});

/**
 * The fragment trap, closed.
 *
 * Gluing a translated fragment to a value ("of" + n + "quotes") reads fine in
 * English and falls apart everywhere else: word order, plurals and
 * prepositions are exactly what differs between languages, and a fragment
 * carries none of them. Whole sentences with {placeholders} let the
 * Indonesian put the pieces where Indonesian puts them.
 */
const DANGLING = /\b(of|in|for|and|or|to|on|at|by|with|from|the|a|an|is|are|was|were|than|per|into|over|under)$/i;

test('a phrase-book entry is a whole thought, not a fragment glued to a value', () => {
  const offenders = Object.keys(ID)
    // A trailing ellipsis is a deliberate prompt ("Replace with…"), not a
    // fragment; and a long sentence may legitimately end on a preposition
    // ("the warehouse these goods are received into"). Short ones may not.
    .filter((en) => !en.trim().endsWith('…'))
    .map((en) => en.trim().replace(/[.,:;—-]+$/, '').trim())
    .filter((en) => en.split(/\s+/).length <= 5 && DANGLING.test(en));
  assert.deepEqual(offenders, [],
    `these read as sentence fragments — write the whole sentence with {placeholders} and use tf(): ${offenders.join(' | ')}`);
});

test('values drop into a sentence rather than being concatenated onto it', () => {
  assert.equal(tf('{won} of {total} quotes', 'en', { won: 3, total: 8 }), '3 of 8 quotes');
  assert.equal(tf('{won} of {total} quotes', 'id', { won: 3, total: 8 }), '3 dari 8 penawaran');
  // A placeholder nobody supplied stays visible — a typo must show itself on
  // screen, not silently delete a number.
  assert.equal(tf('{a} and {b}', 'en', { a: 1 }), '1 and {b}');
  // The same value can appear twice, which is exactly why word order matters.
  assert.equal(tf('{n} of {n}', 'en', { n: 4 }), '4 of 4');
});

test('every {placeholder} in an English sentence survives into its translation', () => {
  const holes = (s: string) => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort();
  const broken = Object.entries(ID)
    .filter(([en, id]) => JSON.stringify(holes(en)) !== JSON.stringify(holes(id)))
    .map(([en]) => en);
  assert.deepEqual(broken, [],
    `a translation dropped or invented a placeholder, so it would render a hole or lose a value: ${broken.join(' | ')}`);
});

/**
 * THE GUARD, added with the 2026-08-25 reversal.
 *
 * "Fully Bahasa Indonesia, including the menus" is a promise that decays: the
 * next module adds a screen, registers its nav entry, and ships an English
 * word into an Indonesian menu that nobody notices because the fallback is
 * silent by design. So every NAME the app navigates by is checked here.
 *
 * A name may be missing from the phrase book on exactly one condition — it is
 * a KEEPER, a code rather than a word (PO, GRN, SKU). That is a decision, and
 * it has to be written down in `KEEPERS` to count. "I forgot" and "it stays
 * English on purpose" look identical on screen; this is what separates them.
 */
const untranslated = (names: string[]): string[] =>
  [...new Set(names)].filter((n) => n && !isKeeper(n) && !ID[n]);

test('every menu label and group header has an Indonesian name, or is a declared keeper', () => {
  const labels = DESTINATIONS.map((d) => d.label);
  const groups = DESTINATIONS.map((d) => d.group);
  assert.deepEqual(untranslated([...labels, ...groups]), [],
    'these would render in English inside an Indonesian menu — translate them in lib/i18n.ts, or add them to KEEPERS if they are codes rather than words');
});

test('every menu entry still explains itself in Indonesian', () => {
  // The hints were translated before the menus were; this keeps them that way
  // when a new destination is registered.
  const hints = DESTINATIONS.map((d) => d.hint).filter((h): h is string => !!h);
  assert.deepEqual(untranslated(hints), []);
});

test('every dashboard panel and quick action has an Indonesian name', () => {
  assert.deepEqual(untranslated([
    ...DASHBOARD_WIDGETS.map((w) => w.label),
    ...DASHBOARD_WIDGETS.map((w) => w.hint),
    ...QUICK_ACTIONS.map((a) => a.label),
  ]), []);
});

test('every role reads in Indonesian — its name and what it may do', () => {
  assert.deepEqual(untranslated([
    ...Object.values(ROLE_LABELS),
    ...Object.values(ROLE_DESCRIPTIONS),
  ]), []);
});

test('a keeper is left OUT of the phrase book, never translated to itself', () => {
  // Belt and braces on the rule above: an entry equal to its own English
  // already fails, but a keeper listed as 'PO': 'PO Pembelian' would pass that
  // test while quietly giving one document two names.
  const listed = KEEPERS.filter((k) => k in ID);
  assert.deepEqual(listed, [],
    `a keeper stays English by being absent from ID, not by having an entry: ${listed.join(' | ')}`);
});
