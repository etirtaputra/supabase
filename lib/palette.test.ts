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
  assert.ok(skins.length >= 8, `expected every skin's block, found ${skins.length}`);

  const missing: string[] = [];
  for (const v of [...used].sort()) {
    for (const skin of skins) {
      if (!skin.body.includes(`${v}:`)) missing.push(`${v} (missing in ${skin.name})`);
    }
  }
  assert.deepEqual(missing, [],
    `these resolve to nothing, so whatever they colour renders invisible: ${missing.join(', ')}`);
});

test('the default skin is a real skin, and it is the terminal one', () => {
  const all = blocks();
  const def = all.find((b) => b.name === '(default)');
  const term = all.find((b) => b.name === 'terminal');
  assert.ok(def, 'there must be an unattributed :root block — it is what most people see');
  assert.ok(term, 'and a terminal block for it to agree with');
  // Compared against the terminal block rather than a literal colour: this
  // assertion used to hardcode the near-black page (--c-app-bg:10 11 13) and
  // went red the moment the skin legitimately moved to graphite on
  // 2026-08-28. What it is really guarding is that the two AGREE.
  const appBg = (b: string) => /--c-app-bg:([^;}]*)/.exec(b)?.[1];
  assert.equal(appBg(def!.body), appBg(term!.body),
    'the unattributed default must be the terminal skin, whatever colour that is');
  assert.ok(def!.body.includes('--font-app:Inter'), 'and it should carry the terminal typeface');
});

// ── The corporate pair (owner, 2026-09-27) ──────────────────────────────────
// "Do it as a different skin — do not change or get rid of the current ones."

const rgbOf = (body: string, v: string): number[] => {
  const m = new RegExp(`--c-${v}:(\\d+ \\d+ \\d+)`).exec(body);
  assert.ok(m, `--c-${v} is not defined`);
  return m![1].split(' ').map(Number);
};
const contrast = (a: number[], b: number[]): number => {
  const lum = ([r, g, bl]: number[]) => {
    const f = (c: number) => { const x = c / 255; return x <= 0.03928 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4; };
    return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(bl);
  };
  const [hi, lo] = [lum(a), lum(b)].sort((p, q) => q - p);
  return (hi + 0.05) / (lo + 0.05);
};

test('the corporate skins keep every text ink readable (4.5:1) on the page and on a card', () => {
  const inks = ['white', 'slate-200', 'slate-300', 'slate-400', 'slate-500',
    'emerald-400', 'rose-400', 'red-400', 'amber-300', 'amber-400', 'sky-400', 'blue-400', 'violet-400'];
  const low: string[] = [];
  for (const name of ['corporate', 'corporate-dark']) {
    const body = blocks().find((b) => b.name === name && b.body.includes('--c-slate-900'))?.body;
    assert.ok(body, `no ${name} block`);
    for (const bg of ['app-bg', 'slate-900']) {
      for (const ink of inks) {
        const r = contrast(rgbOf(body!, ink), rgbOf(body!, bg));
        if (r < 4.5) low.push(`${name}: ${ink} on ${bg} = ${r.toFixed(2)}`);
      }
    }
    // The navy primary button carries literal white text.
    const onBrand = contrast([255, 255, 255], rgbOf(body!, 'brand'));
    const onHover = contrast([255, 255, 255], rgbOf(body!, 'brand-hover'));
    if (onBrand < 4.5) low.push(`${name}: white on brand = ${onBrand.toFixed(2)}`);
    if (onHover < 4.5) low.push(`${name}: white on brand-hover = ${onHover.toFixed(2)}`);
  }
  assert.deepEqual(low, [], 'under WCAG AA — a corporate skin that is harder to read is not more professional');
});

test('the corporate skin only ADDS — nothing it defines leaks into another skin', () => {
  // The brand tokens exist only in the two corporate blocks…
  // (Only the skins' VARIABLE blocks — a scoped rule such as
  // `:root[data-theme="corporate-dark"]{font-feature-settings:…}` has the same
  // shape to the scanner.)
  for (const b of blocks().filter((x) => x.body.includes('--c-slate-900'))) {
    const isCorp = b.name === 'corporate' || b.name === 'corporate-dark';
    assert.equal(b.body.includes('--c-brand:'), isCorp, `${b.name} ${isCorp ? 'lacks' : 'carries'} the brand token`);
  }
  // …and every rule that re-dresses buttons, labels or corners is scoped to
  // them: a bare `.tracking-widest{…}` would re-space all eight skins.
  const rules = THEME_VARS_CSS.split('\n').filter((l) => /c-brand|tracking-wid|IBM Plex/.test(l));
  assert.ok(rules.length > 0, 'the corporate rules have gone — has the scan stopped working?');
  for (const r of rules) {
    const selectors = r.startsWith(':root[data-theme="corporate') && r.includes('{--c-') ? [] : r.split('{')[0].split(',');
    for (const sel of selectors) {
      assert.match(sel.trim(), /^:root\[data-theme="corporate(-dark)?"\]/, `unscoped corporate rule: ${sel}`);
    }
  }
});

test('the navy button re-dress still has buttons to dress', () => {
  // The corporate skin finds the primary button by its exact class pair. If
  // the app ever renames it, the skin silently stops being navy — so check
  // the pair is still in use.
  let n = 0;
  for (const f of [...sourceFiles('app'), ...sourceFiles('components')]) {
    for (const m of readFileSync(f, 'utf8').matchAll(/["'`][^"'`]*\bbg-emerald-600\b(?!\/)[^"'`]*["'`]/g)) {
      if (/\btext-white\b/.test(m[0])) n++;
    }
  }
  assert.ok(n >= 20, `only ${n} bg-emerald-600 + text-white buttons left — the corporate re-dress is aimed at nothing`);
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
