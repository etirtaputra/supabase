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
import { readFileSync } from 'node:fs';
import { THEME_VARS_CSS } from '../constants/palette.ts';
import { nextTheme, pickOffered, pairOf, isLightTheme, isTheme, LIGHT_THEMES, THEMES, THEME_PAIRS, OFFERED_THEME_VALUES, THEME_BOOT_SCRIPT, LEGACY_THEME_MIGRATION, DEFAULT_THEME } from './theme.ts';

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

test('a legacy skin leaves for the DEFAULT pair on the first tap, and stays', () => {
  // Someone still on Paper taps once: they get the default design's dark side
  // (Corporate since 2026-09-28), not `light`.
  assert.equal(nextTheme('paper'), 'corporate-dark');
  assert.equal(nextTheme('light'), 'corporate-dark');
  assert.equal(nextTheme('dim'), 'corporate');
  assert.equal(nextTheme('dark'), 'corporate');
  // …and tapping back does not return them to the legacy skin, by design.
  assert.equal(nextTheme(nextTheme('paper')), 'corporate');
});

// ── Corporate becomes the default (owner, 2026-09-28) ───────────────────────
// "make Corporate the default, but color preference (light or dark) follow
// the user's current preference."

test('every saved older skin moves to Corporate on its own side — dark stays dark, light stays light', () => {
  for (const th of THEMES) {
    if (th.value === 'corporate' || th.value === 'corporate-dark') {
      assert.equal(LEGACY_THEME_MIGRATION[th.value], undefined, `${th.value} is already corporate — nothing to move`);
      continue;
    }
    const to = LEGACY_THEME_MIGRATION[th.value];
    assert.ok(to === 'corporate' || to === 'corporate-dark', `${th.value} is not moved onto the corporate pair`);
    assert.equal(isLightTheme(to), isLightTheme(th.value), `${th.value} → ${to} changed brightness`);
  }
  assert.equal(DEFAULT_THEME, 'corporate');
});

test('the move runs once, before first paint, and also moves the cached company default', () => {
  assert.match(THEME_BOOT_SCRIPT, /icaproc_theme_migrated_v3/);
  assert.ok(THEME_BOOT_SCRIPT.includes('l.setItem(D,m[d])'), 'the cached company default is not migrated');
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
  // With no skin to go by, the default design — Corporate.
  assert.equal(pickOffered(false), 'corporate-dark');
  assert.equal(pickOffered(true), 'corporate');
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

// ── Settings › Appearance: a click is the real thing (owner, 2026-09-28) ─────
// "When I click on corporate it is not applied in all pages, and somehow
// there's still the Save button." A card click only PREVIEWED the skin on that
// screen (gone on the next page) and put it in the Save draft. A click must be
// this device's choice, applied everywhere; the company default saves itself.

test('Settings applies a skin for real, and never through the Save draft', () => {
  const src = readFileSync('app/settings/page.tsx', 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
  assert.ok(!/previewTheme|endThemePreview/.test(src), 'a preview that ends when you leave the tab is what looked applied and was not');
  assert.ok(!/set\(\s*'defaultTheme'/.test(src), "the skin must not go into the draft — that is what left Save lit");
  assert.match(src, /onClick=\{\(\) => setMine\(th?\.value\)\}/, 'a card click must set THIS device’s skin');
  assert.match(src, /saveSettings\(supabase, \{ defaultTheme: theme \}/, 'the company default saves on the spot');
});

test('the navy button re-dress leaves a greyed-out button grey', () => {
  const rule = THEME_VARS_CSS.split('\n').find((l) => l.includes('background-color:rgb(var(--c-brand))'));
  assert.ok(rule, 'the corporate primary-button rule is gone');
  assert.match(rule!, /:not\(:disabled\)/, 'an enabled button only');
  assert.match(rule!, /:disabled:not\(\[class\*="disabled:bg-"\]\)/,
    'a disabled button keeps its own disabled:bg-… look — Settings’ Save rendered navy while greyed out');
});
