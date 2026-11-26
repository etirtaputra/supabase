/**
 * The authority table is a TRANSCRIPTION, and this keeps it one.
 *
 * `docs/agents/MIRA-AUTHORITY_*.md` says, on one page, what MIRA does alone,
 * when asked, after Eric's yes, and never. It adds no rule: every row cites
 * the pack it was copied from (owner, 2026-11-26 — he asked twice in one day
 * what she was allowed to do, and the answers sat in three documents).
 *
 * A one-page summary of three documents goes stale the day one of them
 * changes, and an agent follows a stale table confidently. So:
 *   - the table names the exact files it was transcribed from, and the build
 *     fails when the registry's current file is a different one;
 *   - every citation must point at a rule or a section that exists;
 *   - only the four levels may appear.
 *
 * WHEN THIS FAILS because you bumped a runbook or the boot prompt: read the
 * table against your change, correct any row it touches, re-issue the table
 * under a new version and date (registry, INDEX.md, Drive — the same steps as
 * any pack), and name the new source file in its "Transcribed from" list.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { AGENT_DOCS } from './agentDocs.ts';

const DOCS_DIR = join(process.cwd(), 'docs', 'agents');
const fileOf = (id: string) => {
  const doc = AGENT_DOCS.find((d) => d.id === id);
  assert.ok(doc, `AGENT_DOCS has no '${id}'`);
  return doc.file;
};
const read = (file: string) => readFileSync(join(DOCS_DIR, file), 'utf8');

const table = read(fileOf('mira-authority'));
const SOURCES = {
  P: fileOf('purchasing-runbook'),
  S: fileOf('purchasing-sync'),
  B: fileOf('mira-boot'),
} as const;

/** Table rows: `| action | LEVEL | sources |`, minus headers and separators. */
const rows = table.split('\n')
  .filter((l) => l.startsWith('| ') && !/^\|\s*-/.test(l))
  .map((l) => l.split('|').slice(1, -1).map((c) => c.trim()))
  .filter((c) => c.length === 3 && c[0] !== 'Action' && c[0] !== 'Level');

test('the table names the CURRENT file of each pack it was transcribed from', () => {
  for (const [code, file] of Object.entries(SOURCES)) {
    assert.ok(table.includes(`\`${file}\` — **${code}**`),
      `The MIRA authority table was transcribed from an older ${code} pack; the registry now names ${file}. ` +
      'Check every row that cites it, then re-issue the table (see the note at the top of this test).');
  }
});

test('only the four levels appear', () => {
  const levels = new Set(['ALONE', 'WHEN ASKED', 'YES FIRST', 'NEVER']);
  const actionRows = rows.filter((r) => !r[0].startsWith('**'));
  assert.ok(actionRows.length >= 50, `expected the action rows, found ${actionRows.length}`);
  for (const [action, level] of actionRows) {
    assert.ok(levels.has(level), `"${action}" has level "${level}" — a fifth level is a new rule, and this table adds none`);
  }
});

test('every row cites a source, and every citation exists in that source', () => {
  const text = { P: read(SOURCES.P), S: read(SOURCES.S) };
  const has = (code: 'P' | 'S', ref: string): boolean => {
    const t = text[code];
    if (ref === 'Escalate') return /^## Escalate to a human/m.test(t);
    const rule = ref.match(/^rule (\d+)$/);
    if (rule) return new RegExp(`^${rule[1]}\\. \\*\\*`, 'm').test(t);
    const sec = ref.match(/^§(\d+)(?:\.(\d+))?(?:-([ABC]))?$/);
    if (!sec) return false;
    const [, n, sub, letter] = sec;
    const heading = sub ? new RegExp(`^### ${n}\\.${sub} `, 'm') : new RegExp(`^## ${n}\\. `, 'm');
    if (!heading.test(t)) return false;
    return letter ? new RegExp(`^\\*\\*${letter} — `, 'm').test(t) : true;
  };
  for (const [action, , sources] of rows) {
    const cites = sources.split(',').map((c) => c.trim()).filter(Boolean);
    assert.ok(cites.length > 0, `"${action}" cites no source — a row without one is a rule this table invented`);
    for (const cite of cites) {
      if (cite === 'B') continue; // the boot prompt has no numbered sections
      const m = cite.match(/^([PS]) (.+)$/);
      assert.ok(m, `"${action}": cannot read the citation "${cite}" (use "P rule 8", "P §9", "S §5-A", "S §11.4", "P Escalate" or "B")`);
      assert.ok(has(m[1] as 'P' | 'S', m[2]),
        `"${action}" cites ${cite}, which ${SOURCES[m[1] as 'P' | 'S']} does not have`);
    }
  }
});

test('the table says, in its own words, that it adds no rule and that the source wins', () => {
  assert.match(table, /adds NO rule/);
  assert.match(table, /the source is right and this table is stale/);
});
