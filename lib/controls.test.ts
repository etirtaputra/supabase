/**
 * One control height, one border, everywhere — and the guard that keeps it.
 *
 * OWNER'S STANDING RULE, 2026-09-10: *"it's important for me to use the same
 * border size. always. to maintain consistencies and uniformity."*
 *
 * The reason this needs a test and not a note: the rule was already being
 * followed on both screens, separately, with different numbers. Products'
 * toolbar stood at 36px because its own local `BAR_H` said so. Selling Prices'
 * chips stood at 26px because THEIR file said so. Each file was internally
 * consistent and the two disagreed, and the filter bar that copied chips from
 * one into the other ended up with both heights in a single row.
 *
 * A convention with two homes is a convention with none.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { BAR_H, BAR_BOX, BAR_SELECT, BAR_INPUT, BAR_BTN, BAR_BTN_OFF, BAR_BTN_ON, BAR_BTN_ON_SKY } from '../constants/controls.ts';

const ROOT = process.cwd();

/** Every .ts/.tsx under app/ and components/, so a NEW screen is covered too. */
function sourceFiles(): string[] {
  const out: string[] = [];
  const walk = (dir: string) => {
    for (const name of readdirSync(dir)) {
      if (name === 'node_modules' || name === '.next' || name.startsWith('.')) continue;
      const full = join(dir, name);
      if (statSync(full).isDirectory()) walk(full);
      else if (/\.tsx?$/.test(name)) out.push(full);
    }
  };
  for (const d of ['app', 'components']) walk(join(ROOT, d));
  return out;
}

test('the tokens are one height, one radius, one border', () => {
  // 44px on a phone, 36px on a mouse. One rule, two viewports — not two rules.
  assert.equal(BAR_H, 'h-11 sm:h-9');
  for (const token of [BAR_SELECT, BAR_INPUT, BAR_BTN]) {
    assert.ok(token.includes('h-11 sm:h-9'), `a bar token stands at some other height: ${token}`);
    assert.ok(token.includes('rounded-lg'), `a bar token has its own radius: ${token}`);
  }
  assert.ok(BAR_BOX.includes('border border-slate-700'));
  // The on/off states must share a border WIDTH, or a chip resizes its
  // neighbours when you click it.
  for (const st of [BAR_BTN_OFF, BAR_BTN_ON, BAR_BTN_ON_SKY]) {
    assert.ok(/border-(slate|emerald|sky)-\d{3}(\/\d+)?/.test(st), `${st} does not set a border colour`);
    assert.ok(!/border-[024]\b/.test(st), `${st} changes the border WIDTH between states`);
  }
});

/**
 * Nothing may write the bar height by hand.
 *
 * `h-11 sm:h-9` appearing anywhere outside `constants/controls.ts` means a
 * screen has copied the number instead of importing it, which is exactly how
 * the two heights happened.
 */
test('no screen writes the toolbar height for itself', () => {
  const offenders: string[] = [];
  for (const file of sourceFiles()) {
    const src = readFileSync(file, 'utf8');
    if (!/h-11 sm:h-9/.test(src)) continue;
    if (/from ['"]@\/constants\/controls['"]/.test(src)) continue;
    offenders.push(relative(ROOT, file));
  }
  assert.deepEqual(offenders, [],
    `these write the bar height by hand instead of importing BAR_H: ${offenders.join(', ')}`);
});

/**
 * The two screens the owner compares must actually agree.
 *
 * He named Selling Prices as the pattern for the Products filter bar. If one
 * of them stops importing the tokens, "like in Selling Prices" stops meaning
 * anything, and the next person to copy a control between them reintroduces
 * the mismatch by hand.
 */
test('Products and Selling Prices both dress from the same tokens', () => {
  for (const rel of [['app', 'products', 'page.tsx'], ['app', 'pricing', 'page.tsx']]) {
    const src = readFileSync(join(ROOT, ...rel), 'utf8');
    const name = rel.join('/');
    assert.match(src, /from '@\/constants\/controls'/, `${name} does not import the shared controls`);
    // The shapes each of them had invented before.
    assert.ok(!/rounded-lg px-3 py-2 text-\[13px\]/.test(src), `${name} still hand-builds a bar input`);
    assert.ok(!/py-1 rounded-lg text-\[11\.5px\]/.test(src), `${name} still hand-builds a short chip`);
  }
});

/**
 * A filter chip and a mode button sit side by side in the same row on
 * Products, so they must be the same control with different contents — not two
 * controls that happen to look similar today.
 */
test('the chips and the mode buttons are built from the same button token', () => {
  const src = readFileSync(join(ROOT, 'app', 'products', 'page.tsx'), 'utf8');
  const uses = (src.match(/\$\{BAR_BTN\}/g) ?? []).length;
  assert.ok(uses >= 3, `only ${uses} controls use BAR_BTN — a bar control is being drawn by hand`);
});


/**
 * A bar input must be 16px on a phone, and this is the least taste-driven rule
 * in the file.
 *
 * iOS Safari zooms the whole page when you focus an input under 16px, and it
 * does not zoom back out. At 13px the Products search did that every time
 * somebody searched on a phone: tap the box, the layout jumps, pinch to
 * recover. `text-base` is exactly 16px.
 *
 * It is easy to undo by accident, because on a desktop browser — where anyone
 * would be testing — 13px and 16px both look fine and 13 looks tidier.
 */
test('a bar input is 16px on a phone, so iOS does not zoom the page', () => {
  assert.match(BAR_INPUT, /(^|\s)text-base(\s|$)/, 'the phone size is not 16px');
  assert.match(BAR_INPUT, /sm:text-\[13px\]/, 'the desktop size is gone');
  // The order matters: an unprefixed utility after a `sm:` one still loses to
  // it at the breakpoint, but writing the base size second reads as an
  // override and invites someone to "tidy" the wrong one away.
  assert.ok(BAR_INPUT.indexOf('text-base') < BAR_INPUT.indexOf('sm:text-['),
    'write the phone size first — it is the base, not the exception');
});

/**
 * Selects and buttons step DOWN half a point at the breakpoint, not up: a
 * phone is held further from the eye than a monitor sits.
 */
test('selects and buttons carry a phone size and a desktop size', () => {
  for (const [name, token] of [['BAR_SELECT', BAR_SELECT], ['BAR_BTN', BAR_BTN]] as const) {
    const phone = token.match(/(?:^|\s)text-\[(\d+(?:\.\d+)?)px\]/)?.[1];
    const desk = token.match(/sm:text-\[(\d+(?:\.\d+)?)px\]/)?.[1];
    assert.ok(phone && desk, `${name} does not state both sizes`);
    assert.ok(Number(phone) > Number(desk), `${name} is not larger on a phone than on a monitor`);
  }
});
