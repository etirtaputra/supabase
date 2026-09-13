/**
 * What the Product list shows before anyone touches a control.
 *
 * OWNER, 2026-09-13: *"for product list, should default to items in stock /
 * incoming and priced."*
 *
 * Two ticks, and together they answer the question the screen is actually
 * opened to answer — WHAT CAN I SELL TODAY. Measured the day it shipped: 1,022
 * active items, 203 with a sell price, 164 with stock on hand, 113 with both
 * before incoming is counted. Landing on a thousand rows to find a hundred is
 * not a catalogue, it is a search problem the user has to solve every time.
 *
 * WHY A TEST AND NOT A COMMENT. A default is one word — `useState(false)` — and
 * it is the single easiest thing in this file to flip back by accident while
 * fixing something else nearby. Nothing about the screen looks broken
 * afterwards; it just quietly shows a different list than the owner asked for,
 * and the only person who would notice is him. The same reasoning as the
 * control-size guard: a rule that lives only in a comment is a rule that
 * survives exactly as long as the next person's attention.
 *
 * The deep link is the deliberate exception and is asserted too — `?new=1`
 * turns BOTH ticks off, because the whole reason to follow the dashboard's New
 * arrivals panel is usually the items nobody has priced yet, and an arrival
 * that has since sold out would otherwise vanish from the very list built to
 * show it.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const SRC = readFileSync(join(process.cwd(), 'app/products/page.tsx'), 'utf8');

test('both default ticks are ON, and both defer to the ?new=1 deep link', () => {
  // Written as `!arrivedDeepLink` rather than `true` precisely so the two
  // cannot drift apart — one default that honours the deep link and one that
  // ignores it is the bug this shape prevents.
  assert.match(SRC, /const \[pricedOnly, setPricedOnly\] = useState\(!arrivedDeepLink\)/,
    'Priced must default ON, and OFF when ?new=1 opens the list');
  assert.match(SRC, /const \[stockOnly, setStockOnly\] = useState\(!arrivedDeepLink\)/,
    'In stock / incoming must default ON, and OFF when ?new=1 opens the list');
});

test('"In stock" means on the shelf OR on an unreceived PO — never on-hand alone', () => {
  // The owner asked for "in stock / incoming" as ONE tick. If this predicate
  // ever loses its `inc` half it becomes a stricter filter wearing the same
  // label, and an item arriving next week disappears from the default view.
  assert.match(SRC, /if \(stockOnly && phys <= 0 && inc <= 0\) return false/,
    'the stock filter must let incoming through');
});

test('Clear returns to the default view, not to everything', () => {
  // "Clear" that emptied every tick would be a trapdoor: one click from the
  // list you want to a thousand rows, with the way back no longer obvious.
  const clear = SRC.match(/onClick=\{\(\) => \{ setSearch\(''\);[^}]*\}\}/)?.[0] ?? '';
  assert.ok(clear, 'the Clear handler should still be findable');
  assert.match(clear, /setStockOnly\(true\)/, 'Clear restores the stock tick');
  assert.match(clear, /setPricedOnly\(true\)/, 'Clear restores the priced tick');
  assert.match(clear, /setNewFirst\(false\)/, 'Clear drops the New pin');
});

test('Clear is offered whenever the view deviates — including an UNTICKED default', () => {
  // The subtle half: unticking a default WIDENS the list, and without this the
  // link that narrows it again would be hidden at exactly the moment it is
  // wanted.
  const line = SRC.match(/const hasFilters = .*/)?.[0] ?? '';
  assert.match(line, /!pricedOnly/, 'an unticked Priced counts as a deviation');
  assert.match(line, /!stockOnly/, 'an unticked In stock counts as a deviation');
});
