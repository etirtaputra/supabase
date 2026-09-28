/**
 * What a screen calls things (owner, 2026-09-28: "make page titles and button
 * wording consistent across screens").
 *
 * Measured before this existed: 377 buttons across 65 files showed English on
 * the Indonesian screen ("Cancel" untranslated on 9 screens, translated on 10),
 * the same screen said "Record Payment" and "Record payment", "Clear" and
 * "Delete" were the same Indonesian word, and every browser tab was typed by
 * hand in English — "Banks" on the tab of the page the menu calls "Finance".
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { ACTION_WORDS, buttonBodies, untranslatedWords } from './wording.ts';
import { ID, KEEPERS } from './i18n.ts';
import { DESTINATIONS, pageLabelFor } from '../constants/navigation.ts';
import { SALES_STATUS } from './salesStatus.ts';

const tsx = (dir: string): string[] => readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
  if (e.name === 'node_modules' || e.name.startsWith('.')) return [];
  const p = join(dir, e.name);
  return e.isDirectory() ? tsx(p) : p.endsWith('.tsx') ? [p] : [];
});

// Out of scope, each for a stated reason: the Shop is its own Indonesian-only
// storefront with its own words; family-tree/ and layout/ are not imported by
// any page (dead code, flagged in the handoff rather than deleted unasked).
const OUT_OF_SCOPE = /(^|\/)(app\/shop|components\/shop|components\/family-tree|components\/layout)\//;
const screens = (): string[] => [...tsx('app'), ...tsx('components')].filter((f) => !OUT_OF_SCOPE.test(f));

// ── Buttons ─────────────────────────────────────────────────────────────────

test('the scanner itself: finds bare words, ignores translated ones, codes and arguments', () => {
  const [b] = buttonBodies(`<button onClick={() => go(a > b)} className="x">
      <svg><path d="M1 1"/></svg>{busy ? t('Saving…') : 'Save'} Cancel {n.toLocaleString('en-US')} PDF
      <span className="text-xs">{t('Done')}</span></button>`);
  assert.deepEqual(untranslatedWords(b.body, KEEPERS), ['Save', 'Cancel']);
  const [c] = buttonBodies(`<button>{t('Add entry')} ×</button>`);
  assert.deepEqual(untranslatedWords(c.body, KEEPERS), []);
});

test('no button shows English on an Indonesian screen — its words go through the phrase book', () => {
  const bad: string[] = [];
  for (const f of screens()) {
    for (const b of buttonBodies(readFileSync(f, 'utf8'))) {
      const w = untranslatedWords(b.body, KEEPERS);
      if (w.length) bad.push(`${f}:${b.line} ${JSON.stringify(w)}`);
    }
  }
  assert.deepEqual(bad, [], 'wrap these in t() and give them an Indonesian entry in lib/i18n.ts');
});

test('one word per action: the action words and the phrase book agree', () => {
  const drift = Object.entries(ACTION_WORDS)
    .filter(([en, id]) => en in ID && ID[en] !== id)
    .map(([en, id]) => `${en}: phrase book says "${ID[en]}", house word is "${id}"`);
  assert.deepEqual(drift, []);
  // "Clear" empties; "Delete" destroys. They must never read the same.
  assert.notEqual(ACTION_WORDS.Clear, ACTION_WORDS.Delete);
});

/**
 * Sentence case on buttons: "Record payment", never "Record Payment". A word
 * after the first may be capitalised only when it is a name — a code (PO,
 * CSV), a keeper, or a word from a page's menu name ("Back to Stock").
 */
test('button words are sentence case, except names', () => {
  const names = new Set<string>([
    ...KEEPERS,
    ...DESTINATIONS.flatMap((d) => d.label.split(/[\s·&]+/)),
    // Document statuses are names too ("Confirmed Order" on a status badge).
    ...Object.values(SALES_STATUS).flatMap((st) => st.label.split(/\s+/)),
    'ICAPROC', 'Dolibarr', 'Excel', 'Google', 'Telegram', 'MIRA', 'MANDA', 'I', 'IDR', 'USD', 'CNY', 'PPN', 'EPC',
  ]);
  const bad: string[] = [];
  for (const f of screens()) {
    for (const b of buttonBodies(readFileSync(f, 'utf8'))) {
      for (const m of b.body.matchAll(/\bt\(\s*(['"])((?:\\.|(?!\1).)*)\1/g)) {
        // From the first real word on ("3 · Attach…", "+ Add item" start there).
        const words = m[2].split(/\s+/).map((w) => w.replace(/[^A-Za-z]/g, '')).filter(Boolean).slice(1);
        const caps = words.filter((w) => /^[A-Z][a-z]/.test(w) && !names.has(w));
        if (caps.length) bad.push(`${f}:${b.line} "${m[2]}"`);
      }
    }
  }
  assert.deepEqual(bad, [], 'a button is an instruction, not a title — sentence case');
});

// ── Page titles ─────────────────────────────────────────────────────────────

test('a page is called by its menu name', () => {
  assert.equal(pageLabelFor('/banks'), 'Finance');
  assert.equal(pageLabelFor('/items'), 'Item Hub');
  assert.equal(pageLabelFor('/items/3ef54ee2'), 'Item Hub');
  assert.equal(pageLabelFor('/stock'), 'Stock');
  assert.equal(pageLabelFor('/stock/receive'), 'Receive Goods', 'the most specific entry wins');
  assert.equal(pageLabelFor('/sales/abc-123'), 'Sales Orders');
  assert.equal(pageLabelFor('/sales/new'), 'New Quotation');
  assert.equal(pageLabelFor('/purchasing', '?tab=lookup'), 'Deal Lookup');
  assert.equal(pageLabelFor('/purchasing'), 'Item Editor', 'the bare page opens its first tab');
  assert.equal(pageLabelFor('/settings', '?tab=appearance'), 'Settings · Appearance');
  assert.equal(pageLabelFor('/'), 'Dashboard');
  assert.equal(pageLabelFor('/login'), null);
});

test('every page name has its Indonesian', () => {
  const missing = DESTINATIONS.map((d) => d.label).filter((l) => !(l in ID) && !KEEPERS.includes(l));
  assert.deepEqual(missing, []);
});

test('no page types its own browser-tab title — usePageTitle names it from the menu', () => {
  // Print pages set the tab to the FILE NAME a PDF is saved under; that is a
  // document's name, not a page's, and stays theirs.
  const own: string[] = [];
  for (const f of tsx('app').filter((x) => !OUT_OF_SCOPE.test(x) && !/\/print\/|\/do\//.test(x))) {
    const src = readFileSync(f, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
    if (/document\.title\s*=/.test(src)) own.push(f);
  }
  assert.deepEqual(own, []);
});

test('every page with the app header also titles its tab', () => {
  const missing = tsx('app').filter((f) => /\/page\.tsx$/.test(f) && !OUT_OF_SCOPE.test(f))
    .filter((f) => { const s = readFileSync(f, 'utf8'); return /<BrandMenu\b/.test(s) && !/usePageTitle\(/.test(s); });
  assert.deepEqual(missing, []);
});

test('a subtitle never repeats the page name — the header already says it', () => {
  const bad: string[] = [];
  for (const f of tsx('app').filter((x) => /\/page\.tsx$/.test(x) && !OUT_OF_SCOPE.test(x))) {
    const route = '/' + f.replace(/^app\/?/, '').replace(/\/?page\.tsx$/, '').replace(/\[[^\]]+\]/g, 'x');
    const label = pageLabelFor(route === '/' ? '/' : route.replace(/\/$/, ''));
    if (!label) continue;
    const head = label.split(' · ')[0];
    for (const m of readFileSync(f, 'utf8').matchAll(/subtitle=\{?\s*(?:t\()?\s*[`'"]([^`'"]*)/g)) {
      if (m[1].startsWith(head + ' ·') || m[1] === head || m[1].startsWith(label)) bad.push(`${f}: "${m[1]}"`);
    }
  }
  assert.deepEqual(bad, []);
});
