/**
 * A primary action never sits behind a horizontal scroll.
 *
 * The EPC proposal editor's header put seven controls in one row that scrolls
 * sideways on a narrow screen. That row ended with SAVE — so on a phone the
 * one thing people open the editor to press was off-screen, with no scrollbar
 * to say so, while the quote number was squeezed to "Q-20…" (owner's
 * screenshot, 2026-08-24: "buttons clashing here").
 *
 * Measured on a class-verbatim replica at 360/390/430/640/768/1024/1280: the
 * quote number went from 78px and truncated to 188px and whole, and Save from
 * off-screen to visible at every width. The scroll row stays — for the tools
 * nobody needs in a hurry — and this test fails the build if the primary
 * action is ever put back inside it.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const EDITOR = 'app/proposals/[id]/page.tsx';

test('the EPC editor keeps Save out of the row that scrolls sideways', () => {
  const src = readFileSync(EDITOR, 'utf8');
  const scroller = src.indexOf('order-4 lg:order-3 w-full lg:w-auto flex items-center gap-2 min-w-0 overflow-x-auto');
  const save = src.indexOf('order-3 lg:order-5 flex-shrink-0 flex items-center gap-1.5 px-4 py-1.5');
  assert.ok(scroller > 0, 'the tools row should still scroll — that is what it is for');
  assert.ok(save > 0, 'Save must carry its own place in the header, not the toolbar’s');
  assert.ok(save < scroller,
    'Save is inside the scrolling toolbar again — on a phone that hides it completely');
  // ...and the header must be allowed to use a second row, or pinning Save
  // just squeezes the quote number instead.
  assert.ok(src.includes('py-3 flex items-center justify-between gap-x-3 gap-y-2 flex-wrap'),
    'the editor header must wrap, or the identity gets crushed instead');
});

test('the identity and the status keep the first row at every width', () => {
  const src = readFileSync(EDITOR, 'utf8');
  assert.ok(src.includes('order-1 flex-1 flex items-center gap-3 min-w-0'),
    'the quote number must take the room the row has');
  assert.ok(src.includes('order-2 flex-shrink-0 appearance-none'),
    'the status pill says whether this quote can be edited — it stays visible');
  // The tools rejoin the first row at lg, not sm: at 640 a single row crushed
  // the quote number to nothing, and at 768 it still clipped it.
  assert.ok(!/order-4 sm:order-3 w-full sm:w-auto/.test(src),
    'the tools must not rejoin the first row until lg — measured 2026-08-24');
});
