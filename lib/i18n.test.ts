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
import { t, ID, translationCount } from './i18n.ts';

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
  assert.equal(t('Stock · Warehouse', 'id'), 'Stock · Gudang');
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
