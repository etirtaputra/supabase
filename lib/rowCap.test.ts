/**
 * No query may ask for more rows than the server will ever send.
 *
 * The API stops at 1,000 rows per response ("Max rows", lib/fetchAllRows.ts)
 * and says nothing when it does. A `.limit(8000)` reads like a promise of 8,000
 * and delivers 1,000 — which is how, on 2026-10-08, the newest supplier quotes
 * (12 Deye inverters) went missing from every cost read once
 * `4.1_price_quote_line_items` reached 1,015 rows, and ~50 catalogue items
 * fell out of the sales item picker, Support Letters, Serials and Landed Cost
 * once `3.0_components` reached 1,050.
 *
 * A list that can grow past 1,000 is read with `selectAll` / `fetchAllRows`
 * (pages until the server runs dry). `.limit(n)` is fine for a deliberate
 * "newest n" — with n ≤ 1000, where it means what it says.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

function sources(dir: string): string[] {
  const out: string[] = [];
  for (const e of readdirSync(join(process.cwd(), dir), { withFileTypes: true })) {
    if (e.name === 'node_modules' || e.name.startsWith('.')) continue;
    const rel = `${dir}/${e.name}`;
    if (e.isDirectory()) out.push(...sources(rel));
    else if (/\.tsx?$/.test(e.name) && !/\.test\.tsx?$/.test(e.name)) out.push(rel);
  }
  return out;
}

test('no .limit() above the 1,000-row cap — it would silently return 1,000', () => {
  const offenders: string[] = [];
  for (const f of ['app', 'components', 'lib', 'hooks'].flatMap(sources)) {
    readFileSync(join(process.cwd(), f), 'utf8').split('\n').forEach((line, i) => {
      if (/^\s*(\*|\/\/)/.test(line)) return;                    // prose about the rule
      for (const m of line.matchAll(/\.limit\(\s*([\d_]+)\s*\)/g)) {
        if (Number(m[1].replace(/_/g, '')) > 1000) offenders.push(`${f}:${i + 1}  ${line.trim().slice(0, 120)}`);
      }
    });
  }
  assert.deepEqual(offenders, [], `read these with selectAll (lib/fetchAllRows.ts):\n${offenders.join('\n')}`);
});
