/**
 * The price-direction rule, and the guard that keeps it in one place.
 *
 * This rule has been flipped twice. Both times it was spelled out inline at
 * every call site, so "flip it" meant finding all of them by grep and hoping
 * the grep was complete. The last assertion in this file is the one that
 * matters most: it reads the screens and fails if any of them writes the
 * colours by hand again.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { priceMovement, PRICE_ARROW, PRICE_TONE, PRICE_INK, PRICE_WORD,
         type PriceMovement } from './priceMovement.ts';

// ── The classification ──────────────────────────────────────────────────────

test('up is up and down is down', () => {
  assert.equal(priceMovement(4.2), 'up');
  assert.equal(priceMovement(-4.2), 'down');
  assert.equal(priceMovement(0), 'flat');
});

test('a missing delta is unknown, never flat', () => {
  // "no earlier price to compare against" and "the price did not move" are
  // different facts, and colouring them alike hides the first one.
  assert.equal(priceMovement(null), 'unknown');
  assert.equal(priceMovement(undefined), 'unknown');
  assert.equal(priceMovement(NaN), 'unknown');
  assert.equal(priceMovement(Infinity), 'unknown');
});

test('the deadband suppresses noise without swallowing a real move', () => {
  assert.equal(priceMovement(0.2, 0.5), 'flat', 'a fifth of a percent is not a trend');
  assert.equal(priceMovement(-0.2, 0.5), 'flat');
  assert.equal(priceMovement(0.51, 0.5), 'up');
  assert.equal(priceMovement(-0.51, 0.5), 'down');
  assert.equal(priceMovement(0.5, 0.5), 'flat', 'the band is inclusive at its edge');
  // A negative deadband is somebody's arithmetic accident, not an inversion.
  assert.equal(priceMovement(0.2, -0.5), 'flat');
});

test('with no deadband every movement counts', () => {
  // Right for a single price change: 0.2% on ONE quote really did happen.
  assert.equal(priceMovement(0.2), 'up');
  assert.equal(priceMovement(-0.000001), 'down');
});

// ── The rule itself ─────────────────────────────────────────────────────────

/**
 * UP IS GREEN. Owner, 2026-09-10, reversing his own reversal:
 *
 *   "at first i wanted to revert the color because when material price goes
 *    up, it means it's bad. But i now realize it's not intuitive."
 *
 * The premise was right — a rise in material cost IS bad — and the conclusion
 * still failed, because the colour then answers a different question from the
 * arrow, and the reader has to work out which. Direction is what a colour can
 * say without ambiguity. Judgement goes in words.
 */
test('up is green, down is red — the arrow, not the consequence', () => {
  assert.match(PRICE_TONE.up, /emerald/);
  assert.match(PRICE_TONE.down, /rose|red/);
  assert.match(PRICE_INK.up, /emerald/);
  assert.match(PRICE_INK.down, /red|rose/);
});

test('the judgement is carried by the word, which is where it can be', () => {
  assert.equal(PRICE_WORD.up, 'rising');
  assert.equal(PRICE_WORD.down, 'falling');
});

test('every movement has an arrow, a tone, an ink and a word', () => {
  for (const m of ['up', 'down', 'flat', 'unknown'] as PriceMovement[]) {
    assert.ok(PRICE_ARROW[m]?.trim(), `${m} has no arrow`);
    assert.ok(PRICE_TONE[m]?.trim(), `${m} has no tone`);
    assert.ok(PRICE_INK[m]?.startsWith('--c-'), `${m}'s ink is not a palette variable`);
    assert.ok(PRICE_WORD[m]?.trim(), `${m} has no word`);
  }
});

test('flat and unknown are not coloured as an opinion', () => {
  for (const m of ['flat', 'unknown'] as PriceMovement[]) {
    assert.ok(!/emerald|rose|red/.test(PRICE_TONE[m]), `${m} must not read as good or bad`);
    assert.ok(!/emerald|rose|red/.test(PRICE_INK[m]));
  }
});

// ── The guard ───────────────────────────────────────────────────────────────

/**
 * Every screen that shows a price against an earlier price must ASK, not
 * decide for itself.
 *
 * These three each had the rule written inline — `delta > 0 ? 'text-rose-400'
 * : 'text-emerald-400'` and a hand-picked arrow. That is how one convention
 * became three copies of a convention, and why reversing it twice meant
 * grepping for colour names and hoping nothing was missed.
 */
const PRICE_SCREENS = [
  ['components', 'ui', 'ProductCostLookup.tsx'],
  ['components', 'ui', 'ItemCostForensics.tsx'],
  ['components', 'ui', 'SpendOverview.tsx'],
];

test('no price screen decides the direction colour for itself', () => {
  for (const rel of PRICE_SCREENS) {
    const src = readFileSync(join(process.cwd(), ...rel), 'utf8');
    const name = rel.join('/');
    assert.ok(/from ['"].*lib\/priceMovement['"]/.test(src),
      `${name} shows a price delta but does not import the rule`);
    // The specific shape that was there before: a delta compared to zero,
    // picking a colour class or a palette variable on the spot.
    assert.ok(!/[Dd]elta\w*\s*[<>]=?\s*0\s*\?\s*['"`][^'"`]*(?:rose|emerald|red|green)/.test(src),
      `${name} still picks a direction colour inline`);
    assert.ok(!/[Dd]elta\w*\s*[<>]=?\s*0\s*\?\s*['"`][▲▼↑↓]/.test(src),
      `${name} still picks a direction arrow inline`);
  }
});

/**
 * Deliberately NOT on that list: the cost-impact preview on a proposal
 * (`app/proposals/[id]/page.tsx`) and the reconciliation variances.
 *
 * They look like price deltas and are not. "This cost update takes Rp 4.2 m
 * out of THIS proposal" is a decision about money now, sitting in the same row
 * as a gross-margin figure that goes red on its own terms — colouring the
 * rise green there would put two contradictory colours on one line. A ticker
 * reports; a variance judges. Only the reporting ones follow this rule.
 */
test('the rule is scoped to price REPORTING, and says so', () => {
  const src = readFileSync(join(process.cwd(), 'lib', 'priceMovement.ts'), 'utf8');
  assert.match(src, /compared to an earlier\s*\n?\s*\*?\s*price|earlier price/i,
    'the module must state what it applies to, or it will spread by resemblance');
});
