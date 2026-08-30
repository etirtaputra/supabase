/**
 * The filters on Set Pricing decide what a person spends their morning on, so
 * a wrong verdict is worse than no verdict: "below floor" on a healthy item
 * teaches people to ignore the flag, and a silent under-earner never gets
 * fixed.
 *
 * The cases below are the ones where the honest answer and the convenient
 * answer differ.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { issuesFor, matchesIssues, marginPct, priceForMargin } from './priceGrid.ts';
import type { MarginProfile } from './marginProfiles.ts';

const profile = (min: number, max: number): MarginProfile =>
  ({ id: 'p1', code: 'VC', label: 'Value Capture', margin_target_min: min, margin_target_max: max, description: null });

const TIERS = [
  { tier_id: 't1', margin_floor_pct: 10 },
  { tier_id: 't2', margin_floor_pct: 15 },
];

const row = (o: Partial<Parameters<typeof issuesFor>[0]> = {}) => issuesFor({
  net: 1000, cost: 800,
  priceByTier: new Map([['t1', 1000], ['t2', 1100]]),
  tiers: TIERS, profile: profile(20, 25),
  ...o,
});

// ── margin arithmetic ──────────────────────────────────────────────────────

test('margin is against the price, not the cost', () => {
  assert.equal(marginPct(1000, 800), 20, '200 on a 1000 sale is 20%, not 25%');
  assert.equal(marginPct(1000, 0), 100);
});

test('a margin nobody can compute is null, never zero', () => {
  assert.equal(marginPct(null, 800), null);
  assert.equal(marginPct(1000, null), null, 'no landed cost yet is not a 100% margin');
  assert.equal(marginPct(0, 800), null);
});

// ── no price short-circuits everything ─────────────────────────────────────

test('an unpriced item reports only that, because nothing else is knowable', () => {
  for (const net of [null, 0]) {
    const i = row({ net });
    assert.deepEqual([...i], ['no_price'], `net ${net} should say one thing`);
  }
});

test('an unpriced item is not also called unclassified', () => {
  // It may well have a profile; the point is we have no price to judge.
  assert.ok(!row({ net: null }).has('unclassified'));
});

// ── floors: per tier, because each tier sells at its own price ─────────────

test('a tier under its own floor is caught even when the net tier is fine', () => {
  // t1 earns 20% (fine, floor 10). t2 is overridden down to 850: 5.9% vs floor 15.
  const i = row({ priceByTier: new Map([['t1', 1000], ['t2', 850]]) });
  assert.ok(i.has('below_floor'));
});

test('a healthy chain trips no floor', () => {
  assert.ok(!row().has('below_floor'));
});

test('a rounding hair under the floor is not a breach', () => {
  // floor 10%, price 1000, cost 900.0004 → 9.99996%. Flagging this trains
  // people to ignore the flag.
  const i = issuesFor({
    net: 1000, cost: 900.0004, priceByTier: new Map([['t1', 1000]]),
    tiers: [{ tier_id: 't1', margin_floor_pct: 10 }], profile: null,
  });
  assert.ok(!i.has('below_floor'));
});

test('no landed cost means no floor verdict — not a passing one', () => {
  const i = row({ cost: null });
  assert.ok(!i.has('below_floor'), 'we cannot claim it clears a floor we cannot measure');
  assert.ok(i.has('unclassified'));
});

// ── bands: judged on the item's own economics ──────────────────────────────

test('the band is judged on the NET price, not the top tier', () => {
  // Net earns 20% — bottom of the band. The upper tier earns more purely
  // because it is a markup step, and judging it would say everything passes.
  const i = row({ profile: profile(20, 25) });
  assert.ok(!i.has('below_band'));
  assert.ok(!i.has('above_band'), 'within the band is silent');
});

test('an under-earner is called out even though it breaks no floor', () => {
  // 20% net margin, band wants 30–40, floors are 10/15 — legal but leaving
  // money on the table. This is the whole point of the "optimise" filter.
  const i = row({ profile: profile(30, 40) });
  assert.ok(i.has('below_band'));
  assert.ok(!i.has('below_floor'));
});

test('beating the target is reported but is not a fault', () => {
  const i = row({ profile: profile(5, 10) });
  assert.ok(i.has('above_band'));
  assert.ok(!i.has('below_band'));
});

test('no profile is unclassified — never quietly "fine"', () => {
  const i = row({ profile: null });
  assert.ok(i.has('unclassified'));
  assert.ok(!i.has('below_band'));
  assert.ok(!i.has('above_band'), '693 of 990 items have no profile; none of them is a verdict');
});

test('a row can be both below its floor and below its band', () => {
  // cost 990 against a 1000 net: 1% margin. Under the 10% floor AND under a
  // 30–40 band. Someone fixing this needs to see both.
  const i = row({ cost: 990, profile: profile(30, 40), priceByTier: new Map([['t1', 1000]]), tiers: [TIERS[0]] });
  assert.ok(i.has('below_floor'));
  assert.ok(i.has('below_band'));
});

// ── the filter ─────────────────────────────────────────────────────────────

test('no filter selected shows everything', () => {
  assert.ok(matchesIssues(new Set(), new Set()));
  assert.ok(matchesIssues(new Set(['no_price']), new Set()));
});

test('the filter is OR across issues, so two boxes widen the list', () => {
  const i = new Set(['below_band'] as const);
  assert.ok(!matchesIssues(i, new Set(['no_price'])));
  assert.ok(matchesIssues(i, new Set(['no_price', 'below_band'])));
});

test('a clean row survives no filter at all', () => {
  const clean = row({ profile: profile(15, 30) });
  assert.equal(clean.size, 0, 'a well-priced, classified item reports nothing');
  assert.ok(!matchesIssues(clean, new Set(['no_price', 'below_floor', 'below_band', 'unclassified'])));
});

// ── the suggestion ─────────────────────────────────────────────────────────

test('the suggested price puts the item at the bottom of its band', () => {
  // cost 800, target 20% → 800 / 0.8 = 1000, which earns exactly 20%.
  const p = priceForMargin(800, 20);
  assert.equal(p, 1000);
  assert.equal(marginPct(p, 800), 20);
});

test('a suggestion nobody can compute is null, not a wild number', () => {
  assert.equal(priceForMargin(null, 20), null);
  assert.equal(priceForMargin(0, 20), null);
  assert.equal(priceForMargin(800, 99), null, 'dividing by ~0 is not a price');
  assert.equal(priceForMargin(800, NaN), null);
});
