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
import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

/** Every .ts/.tsx under a directory, tests excluded. */
function sourceFilesUnder(dir: string): string[] {
  const out: string[] = [];
  for (const e of readdirSync(join(process.cwd(), dir), { withFileTypes: true })) {
    if (e.name === 'node_modules' || e.name.startsWith('.')) continue;
    const rel = `${dir}/${e.name}`;
    if (e.isDirectory()) out.push(...sourceFilesUnder(rel));
    else if (/\.tsx?$/.test(e.name) && !/\.test\.tsx?$/.test(e.name)) out.push(join(process.cwd(), rel));
  }
  return out;
}
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

/**
 * EVERY CATALOGUE FETCH DECIDES ABOUT ARCHIVING, OUT LOUD.
 *
 * The picker test above could not have caught the 2026-09-09 report: Selling
 * Prices never mentioned `isHiddenItem`, because it never asked a visibility
 * question at all — it simply fetched all 1,012 components and listed them,
 * archived ones included, while /products had filtered since the day archiving
 * shipped. Nothing was wrong with the code that was written; the bug was in the
 * code that was NOT written, which is exactly what a source-scanning test for a
 * present symptom cannot see.
 *
 * So the rule is inverted here. `fetchAllComponents` defaults to including
 * archived rows — a default chosen for the readers that predate the column —
 * and every call site must therefore say which side it is on: pass
 * `{ activeOnly: true }`, or be listed below with the reason it wants history.
 * A new screen cannot quietly inherit the wrong default.
 */
const INCLUDES_ARCHIVED: Record<string, string> = {
  'app/items/page.tsx':
    'The Item Hub is the 360° view of one item, including a retired one — its purchases, its sales and why it was retired.',
  'app/stock/page.tsx':
    'An archived item can still hold stock, and hiding it would hide the units somebody has to clear.',
  'app/profitability/page.tsx':
    'History. An item archived today still sold last quarter, and dropping it would silently change last quarter’s margin.',
  'app/specs/page.tsx':
    'Tech Specs compares products side by side, including against a superseded model. Back-office, never customer-facing.',
  'components/ui/CommandPalette.tsx':
    'Spotlight finds an item BY NAME so you can open it. Refusing to find a retired item reads as a broken search.',
};

test('every screen that reads the catalogue says whether archived items belong in it', () => {
  const files = [...sourceFilesUnder('app'), ...sourceFilesUnder('components')];
  const undeclared: string[] = [];

  for (const abs of files) {
    const src = readFileSync(abs, 'utf8');
    if (!src.includes('fetchAllComponents')) continue;
    const rel = abs.slice(process.cwd().length + 1);
    if (/activeOnly:\s*true/.test(src)) continue;        // decided: no archived rows
    if (rel in INCLUDES_ARCHIVED) continue;              // decided: history wanted, and why
    undeclared.push(rel);
  }

  assert.deepEqual(undeclared, [],
    `these fetch the whole catalogue without deciding about archived items — pass { activeOnly: true }, `
    + `or add the file to INCLUDES_ARCHIVED with the reason it needs them: ${undeclared.join(', ')}`);
});

test('the archived-by-design list has a real reason for every entry, and no dead paths', () => {
  for (const [rel, why] of Object.entries(INCLUDES_ARCHIVED)) {
    assert.ok(existsSync(join(process.cwd(), rel)), `${rel} no longer exists — drop it from INCLUDES_ARCHIVED`);
    assert.ok(why.trim().length > 40, `${rel} needs a reason someone can disagree with, not a label`);
  }
});

test('Selling Prices and Products both exclude archived items', () => {
  // The two screens named in the 2026-09-09 report. /products had it right all
  // along; /pricing showed all 1,012 rows against 1,007 active ones.
  for (const rel of ['app/pricing/page.tsx', 'app/products/page.tsx']) {
    const src = readFileSync(join(process.cwd(), rel), 'utf8');
    assert.match(src, /activeOnly:\s*true/, `${rel} must not list archived items`);
    assert.ok(!(rel in INCLUDES_ARCHIVED), `${rel} must never be excused from the rule`);
  }
});
