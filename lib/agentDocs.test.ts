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


/**
 * The tier-price rule has to be in the RULES, not only in the pack.
 *
 * On 2026-09-11 an agent reported eight items as having "T2/T3 empty in
 * ICAPROC itself". It was right about the tables and wrong about the business:
 * those tiers are computed from the net, not stored. The pack now has §3.1,
 * but a pack is read once at the start of a session and the rules travel with
 * every onboarding call — so the sentence lives in both.
 */
test('agents are told that tier prices are computed, not stored', () => {
  const rule = AGENT_RULES.find((r) => /Tier-2 and Tier-3/.test(r));
  assert.ok(rule, 'the standing rules no longer warn that tier prices are derived');
  assert.match(rule, /NOT in any table/, 'the rule no longer says the tiers are absent from the tables');
  assert.match(rule, /\/api\/agent\/prices/, 'the rule does not say where to get them instead');
  assert.match(rule, /NO OVERRIDE, never no price/,
    'the rule does not name the exact wrong conclusion it exists to prevent');
});

test('the prices endpoint is offered, and says why it exists', () => {
  const ep = AGENT_ENDPOINTS.find((e) => e.path === '/api/agent/prices');
  assert.ok(ep, 'the tier-price endpoint is not in the registry, so no agent will find it');
  assert.match(ep.purpose, /COMPUTED/, 'the endpoint listing does not explain why a table read is not enough');
});

/**
 * And the endpoint must not re-derive the chain. There is one implementation of
 * tier pricing; a server-side copy would drift from the grid the first time a
 * step percentage changed — silently, and in a number a customer is quoted.
 */
test('the prices route runs the shared chain rather than its own arithmetic', () => {
  const src = readFileSync(join(process.cwd(), 'app', 'api', 'agent', 'prices', 'route.ts'), 'utf8');
  assert.match(src, /import \{ computeTierChain \} from '@\/lib\/tierPricing'/,
    'the route no longer uses the shared markup chain');
  assert.ok(!/1 - .*discount|\* 1\.0[0-9]/.test(src), 'the route is doing tier arithmetic of its own');
  // The rounding step is a SETTING; without loading it the server rounds to the
  // built-in default and returns prices that differ from the screen.
  assert.match(src, /await loadSettings\(client\)/,
    'the route does not load settings, so its rounding will not match the grid');
});
