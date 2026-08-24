/**
 * Drag to reorder is ONE mechanism (2026-08-23).
 *
 * Six lists could be reordered by dragging, and all six had grown their own
 * copy of the same drag state and their own idea of what to draw. The owner's
 * verdict: *"it feels off and not enough indication. It should have a clear
 * positioning and line where it will land."* Every copy drew a ring around the
 * row under the pointer — which says "this row", not "here is the seam" — and
 * three of the six ignored which half of the row the pointer was in while the
 * other three honoured it, so the same gesture meant different things on
 * different screens.
 *
 * `components/ui/dragReorder.tsx` is the whole rule now. This file fails the
 * build if a screen starts its own drag again, because the first symptom of
 * that is exactly what the owner reported: two screens that feel different.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const MODULE = 'components/ui/dragReorder.tsx';

const sourceFiles = (dir: string): string[] => {
  const out: string[] = [];
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    if (e.name === 'node_modules' || e.name.startsWith('.')) continue;
    const p = join(dir, e.name);
    if (e.isDirectory()) out.push(...sourceFiles(p));
    else if (/\.tsx$/.test(e.name)) out.push(p);
  }
  return out;
};
const appFiles = () => [...sourceFiles('app'), ...sourceFiles('components')].filter((f) => !f.endsWith('dragReorder.tsx'));

test('no screen starts a drag of its own — every grip comes from the one hook', () => {
  const offenders = appFiles().filter((f) => {
    const src = readFileSync(f, 'utf8');
    // A type annotation naming the prop is fine; a real handler is not.
    return /onDragStart=/.test(src) || /\sdraggable(=\{|\s|>)/.test(src);
  });
  assert.deepEqual(offenders, [],
    `these files hand-roll a drag instead of using ${MODULE}`);
});

/**
 * Three drop targets legitimately are NOT a seam between two rows, and they
 * keep their own handler and their own highlight — a ring around the thing
 * they mean, which is the honest shape for "put it IN here":
 *   • the EPC group header  — "move this section into this group"
 *   • the sales end zone    — "move this line past the last one"
 *   • the CSV import box    — a file from the desktop, not a row at all
 * Anything beyond those three is a row drag that escaped the hook.
 */
test('only the three container drop zones handle a drag themselves', () => {
  const zones = appFiles()
    .flatMap((f) => (readFileSync(f, 'utf8').match(/onDragOver=/g) ?? []).map(() => f));
  assert.equal(zones.length, 3, `unexpected drag handlers outside ${MODULE}: ${zones.join(', ')}`);
});

test('the landing line is a line, in the app colour, on either side of a row', () => {
  const src = readFileSync(MODULE, 'utf8');
  // Above and below are the same line mirrored — never two different ideas.
  assert.ok(src.includes("edge === 'above' ? '3px' : '-3px'"), 'the seam must be drawn on the side it lands');
  assert.ok(src.includes('rgb(var(--c-emerald-400))'), 'the line follows the palette, never a hardcoded hex');
  // Tables cannot carry a reliable box-shadow on the row itself.
  assert.ok(src.includes('[&>td]:shadow-['), 'a table row needs its line drawn on the cells');
  // The pointer's half decides, and it is read fresh on the drop as well as
  // on the hover — a stale half is how a row lands on the wrong side.
  assert.equal(src.split('halfOf(e)').length - 1, 2, 'the drop must re-read which half the pointer is in');
});

test('every reorderable list carries the shared row classes', () => {
  // The six lists, by the file they live in.
  for (const f of [
    'components/ui/WidgetArranger.tsx',      // dashboard widgets (and Settings › Dashboard)
    'app/settings/page.tsx',                 // menu groups + their entries
    'components/forms/NewDealForm.tsx',      // buy-side deal lines
    'app/sales/[id]/page.tsx',               // sales quote lines
    'app/proposals/[id]/page.tsx',           // EPC sections + items
  ]) {
    const src = readFileSync(f, 'utf8');
    assert.ok(src.includes('useDragReorder'), `${f} should reorder through the shared hook`);
    assert.ok(src.includes('REORDER_ROW'), `${f} needs the row transition, or the line snaps in`);
    assert.ok(src.includes('DRAGGING_ROW'), `${f} needs the carried row to look carried`);
    assert.ok(src.includes('.lineAt('), `${f} never draws the landing line`);
  }
});
