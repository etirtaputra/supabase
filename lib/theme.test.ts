/**
 * The brightness switch is a TWO-state control over a SIX-skin list.
 *
 * That gap is the whole risk, and it already bit once: `toggleTheme` was
 * written to cycle `THEMES` in order back when there were four, so once the
 * owner narrowed the offer to the terminal pair (2026-08-28) a single tap
 * could still walk someone onto Dim or Paper — skins that are deliberately no
 * longer offered anywhere in the UI.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { nextTheme, isLightTheme, LIGHT_THEMES, THEMES, OFFERED_THEME_VALUES } from './theme.ts';

test('every skin is classified bright or dark — none is left unanswered', () => {
  for (const th of THEMES) {
    assert.equal(typeof isLightTheme(th.value), 'boolean', `${th.value} has no answer`);
  }
  assert.deepEqual([...LIGHT_THEMES].sort(), ['light', 'paper', 'terminal-light'],
    'the three lights; everything else is a dark');
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
