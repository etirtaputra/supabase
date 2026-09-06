/**
 * Offerability is ONE rule, and the build fails if a picker forgets half of it.
 *
 * There are two independent reasons an item must not reach a new
 * customer-facing document: Cost Basis → Hidden, and Archived. `archived_at`
 * arrived on 2026-09-03, a year after the pickers were written, so all five of
 * them went on asking only about Cost Basis — and an archived JINKO module kept
 * appearing in the mounting designer until the owner spotted it on 2026-09-05.
 *
 * The last test reads the app's own source, the way `access.test.ts` does: a
 * picker that asks `isHiddenItem` without also asking about archiving is the
 * exact shape of that bug, and it should not survive a build.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { isHiddenItem, isArchivedItem, isOfferable, visibleBrands, VISIBILITY_COLUMNS } from './itemVisibility.ts';

test('the two reasons are independent, and either one withholds an item', () => {
  const shelf = { quote_cost_mode: 'buffered', archived_at: null };
  const hidden = { quote_cost_mode: 'hidden', archived_at: null };
  const archived = { quote_cost_mode: 'buffered', archived_at: '2026-09-05T00:00:00Z' };
  const both = { quote_cost_mode: 'hidden', archived_at: '2026-09-05T00:00:00Z' };

  assert.equal(isOfferable(shelf), true);
  assert.equal(isOfferable(hidden), false);
  assert.equal(isOfferable(archived), false, 'an archived item is never offered');
  assert.equal(isOfferable(both), false);

  // Each predicate still answers only its own question.
  assert.equal(isHiddenItem(archived), false);
  assert.equal(isArchivedItem(hidden), false);
});

test('the legacy Hidden boolean still means Hidden', () => {
  assert.equal(isOfferable({ show_tuc_in_quotes: false }), false);
  assert.equal(isOfferable({ show_tuc_in_quotes: true }), true);
  assert.equal(isOfferable({}), true, 'an unflagged row is on the shelf');
  assert.equal(isOfferable(null), true);
});

test('a brand survives while ONE of its items is offerable', () => {
  const rows = [
    { brand: 'JINKO', quote_cost_mode: 'buffered', archived_at: '2026-09-05T00:00:00Z' },
    { brand: 'TRINA', quote_cost_mode: 'buffered', archived_at: null },
    { brand: 'TRINA', quote_cost_mode: 'hidden', archived_at: null },
  ];
  assert.deepEqual(visibleBrands(rows), ['TRINA'], 'a wholly archived brand leaves the list');
});

test('VISIBILITY_COLUMNS names every column the rule reads', () => {
  for (const col of ['quote_cost_mode', 'show_tuc_in_quotes', 'archived_at']) {
    assert.ok(VISIBILITY_COLUMNS.includes(col), `${col} must be selected for isOfferable to mean anything`);
  }
});

/**
 * Every customer-facing picker asks the WHOLE question.
 *
 * Asking `isHiddenItem` in one of these files is not wrong in itself — but it
 * is only ever half the rule, and half the rule is what shipped the bug. If a
 * file here genuinely needs to distinguish the two reasons, it should import
 * `isArchivedItem` as well, which is what this test looks for.
 */
test('no customer-facing picker asks only about Cost Basis', () => {
  const PICKERS = [
    'lib/systemDesign/resolve.ts',
    'components/ui/SystemDesigner.tsx',
    'components/ui/MountingDesigner.tsx',
    'app/support-letters/page.tsx',
    'app/proposals/[id]/page.tsx',
  ];
  for (const rel of PICKERS) {
    const path = new URL(`../${rel}`, import.meta.url).pathname;
    if (!existsSync(path)) continue;          // a renamed file is not a failure here
    const src = readFileSync(path, 'utf8');
    if (!/\bisHiddenItem\b/.test(src)) continue;
    assert.ok(
      /\bisArchivedItem\b|\bisOfferable\b/.test(src),
      `${rel} asks isHiddenItem without asking about archiving — use isOfferable`,
    );
  }
});
