/**
 * The brightness switch is a TWO-state control over an EIGHT-skin list.
 *
 * That gap is the whole risk, and it already bit once: `toggleTheme` was
 * written to cycle `THEMES` in order back when there were four, so once the
 * owner narrowed the offer to the terminal pair (2026-08-28) a single tap
 * could still walk someone onto Dim or Paper — skins that are deliberately no
 * longer offered anywhere in the UI.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { nextTheme, pickOffered, pairOf, isLightTheme, isTheme, LIGHT_THEMES, THEMES, THEME_PAIRS, OFFERED_THEME_VALUES, THEME_BOOT_SCRIPT } from './theme.ts';

test('every skin is classified bright or dark — none is left unanswered', () => {
  for (const th of THEMES) {
    assert.equal(typeof isLightTheme(th.value), 'boolean', `${th.value} has no answer`);
  }
  assert.deepEqual([...LIGHT_THEMES].sort(), ['corporate', 'light', 'paper', 'terminal-light'],
    'the four lights; everything else is a dark');
});

test('a tap always flips brightness — the icon can never lie', () => {
  for (const th of THEMES) {
    assert.notEqual(isLightTheme(nextTheme(th.value)), isLightTheme(th.value),
      `${th.value} did not change brightness`);
  }
});

test('a tap NEVER lands on a hidden skin — this is the bug the old cycle had', () => {
  for (const th of THEMES) {
    assert.ok(OFFERED_THEME_VALUES.includes(nextTheme(th.value)),
      `${th.value} → ${nextTheme(th.value)}, which is not offered anywhere`);
  }
});

test('the terminal pair flips to each other and stays there', () => {
  assert.equal(nextTheme('terminal'), 'terminal-light');
  assert.equal(nextTheme('terminal-light'), 'terminal');
  assert.equal(nextTheme(nextTheme('terminal')), 'terminal', 'two taps is where you started');
});

test('a legacy skin leaves for the offered pair on the first tap, and stays', () => {
  // Someone still on Paper taps once: they get the terminal dark, not `light`.
  assert.equal(nextTheme('paper'), 'terminal');
  assert.equal(nextTheme('light'), 'terminal');
  assert.equal(nextTheme('dim'), 'terminal-light');
  assert.equal(nextTheme('dark'), 'terminal-light');
  // …and tapping back does not return them to the legacy skin, by design.
  assert.equal(nextTheme(nextTheme('paper')), 'terminal-light');
});

// ── The corporate pair (2026-09-27): a second design, flipped within itself ──

test('the corporate pair flips to each other and never falls back to terminal', () => {
  assert.equal(nextTheme('corporate'), 'corporate-dark');
  assert.equal(nextTheme('corporate-dark'), 'corporate');
  assert.equal(nextTheme(nextTheme('corporate')), 'corporate', 'two taps is where you started');
});

test('every pair is one dark and one light, and every offered skin is in exactly one pair', () => {
  for (const [dark, light] of THEME_PAIRS) {
    assert.equal(isLightTheme(dark), false, `${dark} is listed as a pair's dark side`);
    assert.equal(isLightTheme(light), true, `${light} is listed as a pair's light side`);
  }
  const paired = THEME_PAIRS.flat();
  assert.deepEqual([...paired].sort(), [...OFFERED_THEME_VALUES].sort(), 'offered = paired, no more, no less');
  assert.equal(new Set(paired).size, paired.length, 'no skin sits in two pairs');
  for (const th of THEMES) {
    assert.equal(pairOf(th.value) !== null, OFFERED_THEME_VALUES.includes(th.value), th.value);
  }
});

test('every skin in THEMES is recognised — by the type guard AND the pre-paint script', () => {
  // The boot script carries its own list because it runs before any module
  // loads. A skin missing there paints the default on every reload, then
  // snaps to the right one once React hydrates.
  for (const th of THEMES) {
    assert.ok(isTheme(th.value), `${th.value} fails isTheme — Settings would drop it`);
    assert.ok(THEME_BOOT_SCRIPT.includes(`'${th.value}'`), `${th.value} is missing from the boot script`);
  }
});

// ── The segmented switch sets a SIDE, it does not flip ──────────────────────

test('picking a side lands on the offered skin of that brightness, in your own pair', () => {
  for (const th of THEMES) {
    for (const light of [true, false]) {
      const to = pickOffered(light, th.value);
      assert.equal(isLightTheme(to), light, `${th.value} → ${to}`);
      assert.ok(OFFERED_THEME_VALUES.includes(to), `${th.value} → ${to}, which is not offered`);
      const pair = pairOf(th.value);
      if (pair) assert.ok(pair.includes(to), `${th.value} left its own pair for ${to}`);
    }
  }
  // With no skin to go by, the terminal pair — the default design.
  assert.equal(pickOffered(false), 'terminal');
  assert.equal(pickOffered(true), 'terminal-light');
});

test('picking the side you are already on is a no-op, from any skin', () => {
  for (const th of THEMES) {
    assert.equal(pickOffered(isLightTheme(th.value), th.value) === th.value,
      OFFERED_THEME_VALUES.includes(th.value),
      `${th.value}: a legacy skin should move to the offered one, an offered skin should stay`);
  }
});

test('the two sides agree with the flip — one rule, not two', () => {
  for (const th of THEMES) assert.equal(nextTheme(th.value), pickOffered(!isLightTheme(th.value), th.value));
});
