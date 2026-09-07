/**
 * The versioning rule, enforced by the build.
 *
 * A pack rename that does not reach `INDEX.md` leaves every agent prompt
 * pointing at a filename that no longer exists — and an agent that cannot find
 * its pack improvises rather than stopping. These tests make that a red build
 * instead of a wrong answer three days later.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { AGENT_DOCS, AGENT_ENDPOINTS, AGENT_RULES } from './agentDocs.ts';

const DOCS_DIR = join(process.cwd(), 'docs', 'agents');
const index = readFileSync(join(DOCS_DIR, 'INDEX.md'), 'utf8');

test('every document the registry names exists on disk', () => {
  for (const doc of AGENT_DOCS) {
    assert.ok(existsSync(join(DOCS_DIR, doc.file)),
      `docs/agents/${doc.file} is named by AGENT_DOCS but is not there — rename or update the registry`);
  }
});

test('INDEX.md names every current document', () => {
  for (const doc of AGENT_DOCS) {
    assert.ok(index.includes(doc.file),
      `INDEX.md does not mention ${doc.file}. The index is what agent prompts follow; it cannot lag the registry.`);
  }
});

test('no superseded pack is left beside its replacement', () => {
  // Two files answering the same question is the failure the whole document
  // set exists to prevent: git history holds old versions, the folder holds one.
  const current = new Set(AGENT_DOCS.map((d) => d.file));
  const strays = readdirSync(DOCS_DIR)
    .filter((f) => f.endsWith('.md') && f !== 'INDEX.md' && !current.has(f));
  assert.deepEqual(strays, [],
    `docs/agents/ holds ${strays.join(', ')}, which the registry does not name. Delete the superseded copy — git keeps it.`);
});

test('every filename carries a version and a date (owner\'s rule, 2026-09-06)', () => {
  for (const doc of AGENT_DOCS) {
    assert.match(doc.file, /_v\d+_\d{4}-\d{2}-\d{2}\.md$/,
      `${doc.file} must end _v<N>_YYYY-MM-DD.md so a Drive copy can be compared without opening it`);
  }
});

test('exactly one document is the one to read first', () => {
  assert.equal(AGENT_DOCS.filter((d) => d.first).length, 1);
  assert.equal(AGENT_DOCS.find((d) => d.first)?.id, 'schema');
});

test('document ids are stable, unique keys — not filenames', () => {
  const ids = AGENT_DOCS.map((d) => d.id);
  assert.equal(new Set(ids).size, ids.length, 'duplicate document id');
  for (const id of ids) assert.match(id, /^[a-z0-9-]+$/, `${id} should be a slug an agent can ask for`);
});

test('every endpoint the registry advertises has a route file', () => {
  for (const ep of AGENT_ENDPOINTS) {
    const route = join(process.cwd(), 'app', `${ep.path}`, 'route.ts');
    assert.ok(existsSync(route), `${ep.path} is advertised but ${route} does not exist`);
  }
});

test('the rules an agent is handed cover the mistakes actually made', () => {
  const all = AGENT_RULES.join(' ').toLowerCase();
  for (const must of ['3.0_components', 'service-role', 'archived_at', 'total']) {
    assert.ok(all.includes(must), `AGENT_RULES no longer mentions ${must}`);
  }
});
