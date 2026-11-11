/**
 * Screen-level state machines that once lied about their own state.
 *
 * Not every lifecycle is a status column. A screen has states too — "saved",
 * "failed", "checked, ready to import" — and when they are implied by a string
 * or left behind by a later edit, the screen says one thing and does another.
 * Each test here pins one that did (2026-11-11).
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const read = (p: string) => readFileSync(join(process.cwd(), p), 'utf8');

test('proposal editor: a save note says whether it is good news, never by its wording', () => {
  const src = read('app/proposals/[id]/page.tsx');
  // The old rule: green only when the text was exactly 'Saved'. Every other
  // success ("Saved · merged …", "3 costs updated", the win message) was red.
  assert.ok(!/saveMsg === '/.test(src), 'the colour must not be decided by comparing the message text');
  assert.match(src, /saveNote\.ok \? 'text-emerald-400' : 'text-red-400'/);
  const calls = [...src.matchAll(/setSaveMsg\((.*)\);/g)].map((m) => m[1]);
  const good = calls.filter((c) => /, true$/.test(c));
  assert.equal(good.length, 5, 'saved, saved-and-merged, merged, costs updated / up to date, won');
  for (const c of calls) {
    const bad = /Not saved|Error|Locked/.test(c);
    if (bad) assert.ok(!/, true$/.test(c), `a failure is shown as success: ${c.slice(0, 60)}`);
  }
  for (const c of good) assert.ok(!/Not saved|Error|Locked/.test(c), `a success reads as a failure: ${c.slice(0, 60)}`);
});

test('import: changing a column mapping after the check sends the file back to be checked', () => {
  const src = read('app/import-export/page.tsx');
  // Commit writes `resolved`, built at the last check. A mapping changed after
  // that would be shown on screen and ignored by the import.
  const remap = src.slice(src.indexOf('function remap('), src.indexOf('async function doDryRun('));
  assert.match(remap, /if \(stage === 'check'\)/);
  assert.match(remap, /setPlan\(null\); setResolved\(\[\]\); setStage\('pick'\)/);
  assert.match(src, /onChange=\{\(e\) => remap\(h, e\.target\.value\)\}/, 'the mapping selects must go through remap()');
  assert.ok(!/onChange=\{\(e\) => setMap\(/.test(src), 'a mapping select that sets the map directly leaves the plan stale');
});
