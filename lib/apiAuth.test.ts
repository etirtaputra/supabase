/**
 * No API route may act without knowing who is asking.
 *
 * THE INCIDENT, 2026-09-14. `app/api/insert-from-pdf/route.ts` held the
 * SERVICE-ROLE key — which bypasses every RLS policy and makes `auth.uid()`
 * NULL — and checked NOTHING. No token, no role. A POST from anywhere on the
 * internet could insert suppliers, components, companies, price quotes, quote
 * line items and proforma invoices into production, and every row landed
 * stamped `'system'` because there was no identity to stamp.
 *
 * Nothing in the app had called it for months. It was deleted, not hardened.
 *
 * Its sibling `extract-pdf` took any PDF from anyone and billed the company's
 * Anthropic key to read it. Nothing was stolen — it touches no table — but an
 * open endpoint with a metered key behind it is a bill waiting to be found.
 *
 * WHY A TEST. Both routes were written early, worked, and were never looked at
 * again; the hole was invisible precisely because nothing was broken. A new
 * route is a new file that nobody diffs against this rule, and the next one
 * will be written under the same time pressure as the last. The Shop will put
 * this deployment on a public domain, which changes "a hole nobody has found"
 * into "a hole on a site we advertise".
 *
 * THE RULE, in two halves:
 *   1. A route that touches the SERVICE-ROLE key must authenticate the caller.
 *      Service-role is the key that answers to nobody, so the route has to.
 *   2. A route that spends money on an external API must authenticate too.
 *
 * `lib/agentApi.callerFromRequest` is the sanctioned way: it validates the
 * bearer token, resolves the profile, and hands back a client that queries AS
 * THE CALLER so RLS and the audit triggers stay honest.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

const ROOT = process.cwd();
const API_DIR = join(ROOT, 'app/api');

function routeFiles(): string[] {
  const out: string[] = [];
  const walk = (dir: string) => {
    for (const name of readdirSync(dir)) {
      const full = join(dir, name);
      if (statSync(full).isDirectory()) walk(full);
      else if (/^route\.tsx?$/.test(name)) out.push(full);
    }
  };
  walk(API_DIR);
  return out;
}

/** Does this source establish who the caller is before doing anything? */
const authenticates = (src: string): boolean =>
  /callerFromRequest/.test(src) || /auth\.getUser\(/.test(src);

test('every API route authenticates its caller', () => {
  const open: string[] = [];
  for (const f of routeFiles()) {
    const src = readFileSync(f, 'utf8');
    if (!authenticates(src)) open.push(relative(ROOT, f));
  }
  assert.deepEqual(open, [],
    `These routes act without knowing who is asking:\n  ${open.join('\n  ')}\n` +
    'Use callerFromRequest from lib/agentApi — it validates the bearer token and ' +
    'returns a client that queries AS THE CALLER, so RLS and the audit triggers hold.');
});

test('no route holds the service-role key without authenticating', () => {
  // The narrower, sharper half of the rule. Service-role bypasses RLS
  // completely, so an unauthenticated route holding it is not a small hole —
  // it is full write access to every table, attributed to nobody.
  const bad: string[] = [];
  for (const f of routeFiles()) {
    const src = readFileSync(f, 'utf8');
    if (/SERVICE_ROLE/.test(src) && !authenticates(src)) bad.push(relative(ROOT, f));
  }
  assert.deepEqual(bad, [],
    `SERVICE-ROLE with no caller check — this is how insert-from-pdf happened:\n  ${bad.join('\n  ')}`);
});

test('the deleted route stays deleted', () => {
  // It was dead code holding a live key. If it ever comes back, it should come
  // back through a diff somebody argued for, not by being restored from an old
  // branch because a doc still mentioned it.
  let exists = true;
  try { statSync(join(API_DIR, 'insert-from-pdf/route.ts')); } catch { exists = false; }
  assert.equal(exists, false,
    'app/api/insert-from-pdf was deleted on 2026-09-14: service-role key, no auth, ' +
    'wrote suppliers/components/quotes, and nothing in the app called it.');
});

test('extract-pdf gates on the buy side and caps the upload', () => {
  // It reads a SUPPLIER document and bills a metered key. Both matter: the
  // role gate keeps supplier costs on the buy side, the size cap keeps one
  // request from being an expensive one.
  const src = readFileSync(join(API_DIR, 'extract-pdf/route.ts'), 'utf8');
  assert.match(src, /callerFromRequest/);
  assert.match(src, /buySide/, 'a supplier document is buy-side information');
  assert.match(src, /MAX_PDF_BYTES/, 'an unbounded upload is an unbounded bill');
});
