import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { browserTitleText, tabTitle } from './pageTitle.ts';

test('the tab title is written exactly as the browser reads it back', () => {
  // The proposal that hung on 2026-10-02: a customer name ending in a space.
  assert.equal(tabTitle('Proposals', 'Q-20261002-SXD2 · P TDelta Marlin Sandang Tekstile '),
    'Proposals · Q-20261002-SXD2 · P TDelta Marlin Sandang Tekstile — ICAPROC');
  // Mid-typing a two-word name: the space bar leaves a trailing space.
  assert.equal(tabTitle('Proposals', 'Q-1 · PT '), 'Proposals · Q-1 · PT — ICAPROC');
  assert.equal(tabTitle('Stok', 'A  B\t C\n'), 'Stok · A B C — ICAPROC');
  assert.equal(tabTitle('Stok', '   '), 'Stok — ICAPROC', 'a blank detail is no detail');
  assert.equal(tabTitle(null, null), 'ICAPROC');
  assert.equal(tabTitle('Stok'), 'Stok — ICAPROC');
});

test('whatever goes in, the title is a fixed point of the browser\'s whitespace rule', () => {
  for (const d of [' x', 'x ', 'a  b', '\ta\tb\t', 'PT ', 'Q · ', '']) {
    const t = tabTitle('Proposals', d);
    assert.equal(browserTitleText(t), t, JSON.stringify(d));
  }
});

test('non-ASCII spaces are kept — the browser does not collapse them either', () => {
  assert.equal(browserTitleText('a  b'), 'a  b');
});

test('usePageTitle re-applies against what the browser read back, not what it wrote', () => {
  const src = readFileSync(new URL('../hooks/usePageTitle.ts', import.meta.url), 'utf8');
  assert.match(src, /tabTitle\(/, 'the title is built by lib/pageTitle.ts');
  assert.match(src, /const applied = document\.title;/);
  assert.match(src, /document\.title !== applied/);
  assert.doesNotMatch(src, /document\.title !== want/, 'comparing to `want` is the loop that hung the proposal editor');
});
