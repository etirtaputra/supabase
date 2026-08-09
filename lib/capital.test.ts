/**
 * Capital-allocation tests — the verdict must gate downside first, reward real
 * return, and tighten defensively. Written against hand-built items.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { capitalCall, summariseCapital, type CapitalInput } from './capital.ts';

const it = (over: Partial<CapitalInput>): CapitalInput => ({
  band: 'solid', superseded: false, marginPct: 20, soldRecently: true, slow: false,
  dueToReorder: false, stockValue: 1_000_000, gmroi: 2.5, ...over,
});

test('below cost is always divest, however it scores', () => {
  const c = capitalCall(it({ band: 'core', marginPct: -5 }));
  assert.equal(c.verdict, 'divest');
  assert.match(c.reason, /below cost/i);
  assert.equal(c.frozenCash, 1_000_000);
});

test('dead stock and superseded stock are divest (free the cash)', () => {
  assert.equal(capitalCall(it({ slow: true })).verdict, 'divest');
  assert.equal(capitalCall(it({ superseded: true })).verdict, 'divest');
});

test('a proven, high-return staple is deploy', () => {
  const c = capitalCall(it({ band: 'core', gmroi: 3, soldRecently: true }));
  assert.equal(c.verdict, 'deploy');
});

test('a pure-flow item (no cash locked) can deploy — it clears the return bar', () => {
  assert.equal(capitalCall(it({ band: 'core', gmroi: null, stockValue: 0 })).verdict, 'deploy');
});

test('weak return on locked cash is not deployed', () => {
  const c = capitalCall(it({ band: 'solid', gmroi: 0.6 }));
  assert.notEqual(c.verdict, 'deploy');
  assert.equal(c.verdict, 'trim');
});

test('defensive mode raises the bar: a modest earner deploys normally but not defensively', () => {
  const item = it({ band: 'solid', gmroi: 1.4, soldRecently: true, dueToReorder: false });
  assert.equal(capitalCall(item, false).verdict, 'deploy');   // normal: 1.4 ≥ floor
  assert.notEqual(capitalCall(item, true).verdict, 'deploy');  // defensive: needs ≥2 AND due
});

test('defensive mode: a strong earner that is due to reorder still deploys', () => {
  const c = capitalCall(it({ band: 'core', gmroi: 2.5, soldRecently: true, dueToReorder: true }), true);
  assert.equal(c.verdict, 'deploy');
});

test('defensive mode widens trims: low-GMROI held stock becomes trim', () => {
  const c = capitalCall(it({ band: 'solid', gmroi: 0.8 }), true);
  assert.equal(c.verdict, 'trim');
  assert.ok(c.frozenCash > 0);
});

test('the summary totals frozen vs working cash', () => {
  const calls = [
    { call: capitalCall(it({ marginPct: -1, stockValue: 500 })), stockValue: 500 },     // divest
    { call: capitalCall(it({ slow: true, stockValue: 300 })), stockValue: 300 },        // divest
    { call: capitalCall(it({ band: 'core', gmroi: 3, stockValue: 900 })), stockValue: 900 }, // deploy
  ];
  const s = summariseCapital(calls);
  assert.equal(s.divest, 2);
  assert.equal(s.deploy, 1);
  assert.equal(s.frozenCash, 800);
  assert.equal(s.workingCash, 900);
});
