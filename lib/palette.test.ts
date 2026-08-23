/**
 * Every colour a screen names must actually exist in every skin.
 *
 * The whole point of the token palette is that a component names a VARIABLE
 * and each skin fills it in. The failure that buys is silent: name a variable
 * no skin defines — `--c-pink-400`, when `pink` was never one of the generated
 * scales — and `rgb(var(--c-pink-400))` resolves to nothing at all. No error,
 * no warning, just a dot that isn't there. (That is a real one, caught while
 * moving the chart palettes off hardcoded hex on 2026-08-21.)
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { THEME_VARS_CSS } from '../constants/palette.ts';

const sourceFiles = (dir: string): string[] => {
  const out: string[] = [];
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    if (e.name === 'node_modules' || e.name.startsWith('.')) continue;
    const p = join(dir, e.name);
    if (e.isDirectory()) out.push(...sourceFiles(p));
    else if (/\.tsx?$/.test(e.name) && !/\.test\.ts$/.test(e.name)) out.push(p);
  }
  return out;
};

/** Every skin's block, so a variable can be checked against each in turn. */
const blocks = (): { name: string; body: string }[] => {
  const out: { name: string; body: string }[] = [];
  for (const m of THEME_VARS_CSS.matchAll(/:root(\[data-theme="([a-z-]+)"\])?\{([^}]*)\}/g)) {
    out.push({ name: m[2] ?? '(default)', body: m[3] });
  }
  return out;
};

test('every colour variable a screen names is defined by every skin', () => {
  const used = new Set<string>();
  for (const f of [...sourceFiles('app'), ...sourceFiles('components'), ...sourceFiles('lib')]) {
    if (f.endsWith('constants/palette.ts')) continue;
    for (const m of readFileSync(f, 'utf8').matchAll(/var\((--c-[a-z0-9-]+)\)/g)) used.add(m[1]);
  }
  assert.ok(used.size > 0, 'no colour variables found — has the scan stopped working?');

  const skins = blocks().filter((b) => b.body.includes('--c-slate-900'));
  assert.ok(skins.length >= 6, `expected every skin's block, found ${skins.length}`);

  const missing: string[] = [];
  for (const v of [...used].sort()) {
    for (const skin of skins) {
      if (!skin.body.includes(`${v}:`)) missing.push(`${v} (missing in ${skin.name})`);
    }
  }
  assert.deepEqual(missing, [],
    `these resolve to nothing, so whatever they colour renders invisible: ${missing.join(', ')}`);
});

test('the default skin is a real skin, not an empty block', () => {
  const def = blocks().find((b) => b.name === '(default)');
  assert.ok(def, 'there must be an unattributed :root block — it is what most people see');
  // The terminal page colour, which is what the default is meant to be.
  assert.ok(def!.body.includes('--c-app-bg:10 11 13'),
    'the unattributed default should be the terminal skin');
  assert.ok(def!.body.includes('--font-app:Inter'), 'and it should carry the terminal typeface');
});

/**
 * A colour TOKEN is not a colour.
 *
 * `SpendOverview` and the positioning map hold their series colours as
 * variable NAMES ('--c-indigo-400') so a call site can ask for the ink or a
 * tint of the same hue. Hand one of those straight to an SVG `fill` and it is
 * not an error — SVG shrugs and paints black. That is precisely how the Spend
 * & Cash donuts became black discs the day the palette was tokenised, and it
 * type-checked, built, and passed every other test on the way there.
 *
 * The two legitimate shapes are `ink(PALETTE[…])` / `tint(PALETTE[…], a)` and
 * `const x = PALETTE[…]` (whose uses are then wrapped). Anything else is the
 * bug.
 */
test('a series colour is never handed over as a bare token', () => {
  const src = readFileSync('components/ui/SpendOverview.tsx', 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
  const offenders: string[] = [];
  for (const m of src.matchAll(/PALETTE\[/g)) {
    const before = src.slice(Math.max(0, m.index! - 40), m.index!);
    const wrapped = /(ink|tint)\($/.test(before);
    const declared = /=\s*$/.test(before);
    if (!wrapped && !declared) {
      offenders.push(src.slice(Math.max(0, m.index! - 60), m.index! + 30).replace(/\s+/g, ' ').trim());
    }
  }
  assert.deepEqual(offenders, [],
    `these pass a variable NAME where a colour is expected, which renders black: ${offenders.join(' | ')}`);
});

/**
 * The component preview is a development tool and must stay one.
 *
 * It renders fabricated vendors and categories. Reaching it in production
 * would show a stranger invented company data on a page that looks like the
 * real thing — so the guard is not a nicety, and a route is exactly the kind
 * of thing that gets un-gated during a refactor and never noticed.
 */
test('the component preview is refused outside development', () => {
  const src = readFileSync('app/preview/page.tsx', 'utf8');
  assert.ok(/process\.env\.NODE_ENV === 'production'/.test(src) && /notFound\(\)/.test(src),
    'app/preview must 404 when NODE_ENV is production');
  // And it must not be reachable from the app: no menu entry, no link.
  const nav = readFileSync('constants/navigation.ts', 'utf8');
  assert.ok(!nav.includes("'/preview'"), 'the preview must never be a registered destination');
});
