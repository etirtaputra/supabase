/**
 * The Dolibarr survey script only ever READS Dolibarr.
 *
 * Owner, 2026-10-27: "Only ever READ from Dolibarr — never create, change or
 * delete anything there. Never print the key or put it in the repo." The key
 * the script runs with belongs to the owner's own Dolibarr user and can do
 * everything, so the guard is in the code, not in the key's rights:
 *
 *   - exactly one place builds a request, and it hard-codes method='GET';
 *   - no other HTTP verb appears anywhere in the file;
 *   - the key comes from the environment and is only ever sent as a header —
 *     never printed, never written into the output files.
 *
 * The script is Python (the Jakarta VPS that can reach Dolibarr runs Python,
 * not Node), so this test reads it as text.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const SRC = readFileSync(join(process.cwd(), 'scripts', 'dolibarr-survey.py'), 'utf8');
// Code only: drop comments and docstrings, which are allowed to SAY "never POST".
const CODE = SRC
  .replace(/"""[\s\S]*?"""/g, '')
  .split('\n')
  .map((l) => l.replace(/#.*$/, ''))
  .join('\n');

test('one request builder, and it is a GET', () => {
  const builders = CODE.match(/urllib\.request\.Request\(/g) ?? [];
  assert.equal(builders.length, 1, 'exactly one urllib.request.Request(...) in the script');
  assert.match(CODE, /urllib\.request\.Request\(url, method='GET'/);
});

test('no other HTTP verb, and no other way out', () => {
  for (const verb of ['POST', 'PUT', 'PATCH', 'DELETE']) {
    assert.ok(!new RegExp(`['"]${verb}['"]`).test(CODE), `${verb} appears in the survey script`);
  }
  for (const lib of ['requests', 'http.client', 'subprocess', 'socket']) {
    assert.ok(!new RegExp(`import\\s+${lib.replace('.', '\\.')}\\b`).test(CODE), `imports ${lib}`);
  }
  assert.ok(!/urlopen\([^)]*data=/.test(CODE), 'urlopen with a body');
});

test('the key is read from the environment and only sent as the DOLAPIKEY header', () => {
  assert.match(CODE, /os\.environ\.get\('DOLIBARR_API_KEY'/);
  const uses = CODE.match(/\bself\.key\b/g) ?? [];
  assert.equal(uses.length, 2, 'self.key: set once, sent once');
  assert.match(CODE, /'DOLAPIKEY': self\.key/);
  assert.ok(!/print\([^)]*\bkey\b/.test(CODE), 'the key is printed');
  assert.ok(!/json\.dump\([^)]*\bkey\b\s*[,)]/.test(CODE), 'the key is written to a file');
});

test('no key or credential is checked in', () => {
  assert.ok(!/DOLAPIKEY['"]?\s*[:=]\s*['"][A-Za-z0-9]{12,}/.test(SRC));
});

test('a list endpoint that ignores paging cannot loop forever', () => {
  // bankaccounts/{id}/lines answers the whole list on every page; on
  // 2026-10-27 the survey re-read it for 20 minutes (2.6 GB) until killed.
  assert.match(CODE, /if len\(data\) < self\.page or not fresh:/);
  assert.match(CODE, /r\.get\('id'\) not in seen/);
});

test('--resume keeps what an earlier run saved, open documents included', () => {
  assert.match(CODE, /p\.add_argument\('--resume'/);
  assert.match(CODE, /keys\.setdefault\('open_documents', \{\}\)/);
  assert.ok(!/keys\['open_documents'\] = \{\}/.test(CODE), 'open documents reset on resume');
});
