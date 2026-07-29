/**
 * Regenerates constants/palette.ts — the ICAPROC light/dark colour tables.
 *
 *   npm i -D tailwindcss@3   # only needed to read Tailwind's stock ramps
 *   node scripts/generate-palette.js
 *
 * Why a generator: the light theme is DERIVED from the dark one (each ramp
 * read from the other end), so hand-maintaining 400 values in two columns
 * would guarantee drift. Change a rule here, re-run, commit the output.
 */
const colors = require('tailwindcss/colors');
const fs = require('fs');

// The three scales layout.tsx already remaps (kaspa.stream-inspired dark).
const CUSTOM = {
  slate: {50:'#f7f7f8',100:'#f0f0f2',200:'#e1e2e5',300:'#c3c5ca',400:'#9a9da4',500:'#6e7178',600:'#4a4c52',700:'#333539',800:'#26272b',900:'#1b1c1f',950:'#0e0f11'},
  emerald: {50:'#effdf9',100:'#d7faf0',200:'#aff5e2',300:'#7defd3',400:'#49eacb',500:'#2bd4b4',600:'#1cb497',700:'#17937c',800:'#187463',900:'#175d51',950:'#0b332c'},
  violet: {50:'#f4f4fe',100:'#e9eafd',200:'#d6d8fa',300:'#b3b8f5',400:'#9297ec',500:'#7a7fe0',600:'#6366d9',700:'#5052c4',800:'#4244a0',900:'#3a3c80',950:'#23234d'},
};
// Every scale the app actually uses (measured from the source).
const SCALES = ['slate','gray','red','orange','amber','yellow','lime','green','emerald','teal','cyan','sky','blue','indigo','violet','purple','rose'];
const STEPS = [50,100,200,300,400,500,600,700,800,900,950];

const hexToRgb = (h) => {
  const m = h.replace('#','');
  const f = m.length === 3 ? m.split('').map(c=>c+c).join('') : m;
  return [parseInt(f.slice(0,2),16), parseInt(f.slice(2,4),16), parseInt(f.slice(4,6),16)].join(' ');
};

const dark = {}, light = {};
for (const s of SCALES) {
  const src = CUSTOM[s] ?? colors[s];
  if (!src) throw new Error('missing scale ' + s);
  dark[s] = {}; light[s] = {};
  for (let i = 0; i < STEPS.length; i++) {
    const step = STEPS[i];
    // LIGHT = the same ramp read from the other end: lightness flips, hue stays.
    const mirror = STEPS[STEPS.length - 1 - i];
    if (!src[step] || !src[mirror]) throw new Error(`${s} missing ${step}/${mirror}`);
    dark[s][step] = hexToRgb(src[step]);
    light[s][step] = hexToRgb(src[mirror]);
  }
}
// `white` is the app's emphasis ink (text-white ×602) and its subtle overlays
// (bg-white/10). Both must invert, so white is a variable too.
dark.white = { DEFAULT: '255 255 255' };
light.white = { DEFAULT: '14 15 17' };

// Named surfaces. These were literal hex in ~125 class sites (bg-[#0f1012]
// and friends) — literals can't follow a theme, so they become tokens. The
// DARK value of each is the exact hex it replaces, so the dark skin is
// pixel-identical; only the light column is new.
const SURFACES = {
  chrome: ['#0f1012', '#ffffff'],  // headers, nav, sticky bars, table row base
  canvas: ['#141518', '#fafafb'],  // the page behind everything
  sunken: ['#101214', '#f2f2f4'],  // inset strips (expanded detail panels)
  raised: ['#171a1f', '#f4f5f7'],  // hovered / expanded row
  rail:   ['#15171b', '#f7f7f8'],  // alternating row rail
  deep:   ['#020617', '#ffffff'],  // native <option> background
  navy:   ['#0d1829', '#eff3fa'],  // pricing-intelligence cards
  moss:   ['#12463b', '#d7faf0'],  // emerald section header
  moss2:  ['#1a5c4c', '#aff5e2'],  // emerald section header, stronger
};
for (const [name, [d, l]] of Object.entries(SURFACES)) {
  dark[name] = { DEFAULT: hexToRgb(d) };
  light[name] = { DEFAULT: hexToRgb(l) };
}
// App canvas — one step darker than the darkest card in dark mode; one step
// lighter than the lightest card in light mode.
const APP_BG = { dark: '20 21 24', light: '242 243 245' };

// Light-mode corrections to the mirrored ramp. Mirroring alone makes the
// SURFACE steps (950/900) a touch darker than the page, so cards read as
// recessed; light UIs read better the other way round — a soft grey page with
// white cards lifted off it. Only the three surface steps are pinned; every
// other step stays mirrored.
const LIGHT_FIX = {
  slate: { 950: '#ffffff', 900: '#fbfbfc', 800: '#e8e9ec' },
};
for (const [scale, steps] of Object.entries(LIGHT_FIX)) {
  for (const [step, hex] of Object.entries(steps)) light[scale][step] = hexToRgb(hex);
}

const varName = (s, step) => step === 'DEFAULT' ? `--c-${s}` : `--c-${s}-${step}`;
const block = (map, bg) => {
  const lines = [];
  for (const s of Object.keys(map)) for (const step of Object.keys(map[s])) lines.push(`${varName(s, step)}:${map[s][step]}`);
  lines.push(`--c-app-bg:${bg}`);
  return lines.join(';');
};

// Shadows are tuned for a dark canvas — `shadow-black/50` is invisible depth
// there and a grey smudge on white. In light mode the shadow COLOUR is
// softened (the blur/spread from shadow-lg/2xl is kept), via an attribute
// selector so it catches every opacity suffix without listing them.
const SHADOW_FIX = ':root[data-theme="light"] [class*="shadow-black"]{--tw-shadow-color:rgb(15 23 42 / 0.10);--tw-shadow:var(--tw-shadow-colored)}';

const css = `:root{${block(dark, APP_BG.dark)}}\n:root[data-theme="light"]{${block(light, APP_BG.light)}}\n${SHADOW_FIX}`;

// Colors object for the Tailwind CDN config (raw JS source text).
const colorEntries = SCALES.map((s) => {
  const steps = STEPS.map((st) => `${st}:'rgb(var(${varName(s, st)}) / <alpha-value>)'`).join(',');
  return `${s}:{${steps}}`;
}).join(',');
const surfaceEntries = Object.keys(SURFACES)
  .map((n) => `${n}:'rgb(var(--c-${n}) / <alpha-value>)'`).join(',');
const colorsJs = `{${colorEntries},white:'rgb(var(--c-white) / <alpha-value>)',${surfaceEntries}}`;

const out = `/**
 * Generated palette — DO NOT hand-edit the tables below; regenerate instead.
 *
 * The whole ICAPROC skin comes from ONE place: layout.tsx remaps Tailwind's
 * colour scales, so every \`bg-slate-900\` / \`text-white\` site in the app reads
 * from here. Making those scales CSS VARIABLES (as rgb channel triplets, so
 * \`bg-slate-900/60\` keeps working) means switching theme is a single
 * \`data-theme\` attribute on <html> — instant, no re-render, no component edits.
 *
 * LIGHT is the same ramp read from the other end: step 50 takes 950's value,
 * 100 takes 900's, and so on. Lightness flips, hue stays. That works because
 * the app consistently uses HIGH steps for surfaces (bg-slate-900) and LOW
 * steps for text (text-slate-300) — flip the ramp and surfaces go light while
 * text goes dark, in one move. \`white\` flips with them: it is the emphasis
 * ink (text-white) and the subtle overlay (bg-white/10), never a literal
 * page colour. (The customer-facing print pages use their own raw CSS and are
 * untouched by any of this.)
 */

export const THEME_VARS_CSS = ${JSON.stringify(css)};

export const TAILWIND_COLORS_JS = ${JSON.stringify(colorsJs)};

export type ThemeName = 'dark' | 'light';
`;
fs.writeFileSync(require('path').join(__dirname, '..', 'constants', 'palette.ts'), out);
console.log('css bytes:', css.length, '| colors js bytes:', colorsJs.length);
console.log('sample dark slate-900:', dark.slate[900], '| light slate-900:', light.slate[900]);
console.log('sample dark white:', dark.white.DEFAULT, '| light white:', light.white.DEFAULT);
