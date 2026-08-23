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
  chrome: ['#0f1012', '#f8f9fa'],  // headers, nav, sticky bars, table row base
  canvas: ['#141518', '#eff1f3'],  // the page behind everything
  sunken: ['#101214', '#e9ebef'],  // inset strips (expanded detail panels)
  raised: ['#171a1f', '#edeff2'],  // hovered / expanded row
  rail:   ['#15171b', '#f3f4f6'],  // alternating row rail
  deep:   ['#020617', '#f8f9fa'],  // native <option> background
  navy:   ['#0d1829', '#e9eef6'],  // pricing-intelligence cards
  moss:   ['#12463b', '#d7faf0'],  // emerald section header
  moss2:  ['#1a5c4c', '#aff5e2'],  // emerald section header, stronger
};
for (const [name, [d, l]] of Object.entries(SURFACES)) {
  dark[name] = { DEFAULT: hexToRgb(d) };
  light[name] = { DEFAULT: hexToRgb(l) };
}
// App canvas — one step darker than the darkest card in dark mode; one step
// lighter than the lightest card in light mode.
const APP_BG = { dark: '20 21 24', light: '234 236 239' };

// Light-mode corrections to the mirrored ramp. Mirroring alone makes the
// SURFACE steps (950/900) a touch darker than the page, so cards read as
// recessed; light UIs read better the other way round — a soft grey page with
// white cards lifted off it. Only the three surface steps are pinned; every
// other step stays mirrored.
// Nothing in the light theme is pure white: a full-screen #fff at office
// monitor brightness is what makes a light UI tiring to read all day. The
// surfaces sit at a soft off-white and the page behind them a step deeper,
// so the depth order still reads without any of it glaring.
const LIGHT_FIX = {
  slate: { 950: '#f8f9fa', 900: '#f4f5f7', 800: '#e2e4e8' },
};
for (const [scale, steps] of Object.entries(LIGHT_FIX)) {
  for (const [step, hex] of Object.entries(steps)) light[scale][step] = hexToRgb(hex);
}

// ── Two more skins (owner's ask, 2026-08-01) ────────────────────────────────
// The office runs lower-end monitors, where the two originals sit at the
// extremes: near-black smears and bands on cheap panels, and full office
// brightness makes even a soft cool white glare. So each extreme gets a
// gentler sibling — same layout, same accents, only the canvas moves:
//
//   DIM   = dark with the deep blacks lifted to graphite (a "dark dimmed"):
//           less contrast against reflections, no black smearing, still
//           reads as the house dark. Ink and accent ramps are untouched.
//   PAPER = light with WARM neutrals (cream instead of cool grey-white):
//           the classic all-day reading surface — lower glare at office
//           brightness, and renders consistently on TN panels. Accent ramps
//           stay the light ones so statuses keep their meaning.
const clone = (m) => JSON.parse(JSON.stringify(m));
const dim = clone(dark), paper = clone(light);

// DIM: only the SURFACE end of slate moves (950→700); text steps stay put so
// contrast is lost from the background side alone, which is the point.
const DIM_FIX = {
  slate: { 950: '#1a1d23', 900: '#232730', 800: '#2f343e', 700: '#3d434e' },
};
for (const [scale, steps] of Object.entries(DIM_FIX)) {
  for (const [step, hex] of Object.entries(steps)) dim[scale][step] = hexToRgb(hex);
}
const DIM_SURFACES = {
  chrome: '#181b21', canvas: '#1e222a', sunken: '#1a1e25', raised: '#272c35',
  rail: '#20242c', deep: '#171a20', navy: '#182640', moss: '#175247', moss2: '#20685a',
};
for (const [name, hex] of Object.entries(DIM_SURFACES)) dim[name] = { DEFAULT: hexToRgb(hex) };

// PAPER: the whole neutral ramp goes warm (greys pick up a paper tint at both
// ends), and every surface token follows. Nothing is pure white here either.
const PAPER_FIX = {
  slate: {
    950: '#faf7ef', 900: '#f4f0e5', 800: '#e5dfd0', 700: '#cfc8b8', 600: '#9d968a',
    500: '#6f6a5e', 400: '#4f4a40', 300: '#3a352c', 200: '#2b2720', 100: '#211d17', 50: '#171410',
  },
};
for (const [scale, steps] of Object.entries(PAPER_FIX)) {
  for (const [step, hex] of Object.entries(steps)) paper[scale][step] = hexToRgb(hex);
}
paper.white = { DEFAULT: hexToRgb('#171410') };   // the emphasis ink, warm near-black
const PAPER_SURFACES = {
  chrome: '#faf7ef', canvas: '#f1ecdf', sunken: '#e9e3d3', raised: '#efeade',
  rail: '#f5f1e6', deep: '#faf7ef', navy: '#eae6d8', moss: '#dcf3e6', moss2: '#bfe9d6',
};
for (const [name, hex] of Object.entries(PAPER_SURFACES)) paper[name] = { DEFAULT: hexToRgb(hex) };

// ── Two more skins: TERMINAL (owner's ask, 2026-08-21) ──────────────────────
// Design cues taken from a trading terminal the owner works in daily (JTX):
// near-black flat panels with hairline separators in dark, plain white cards
// on a soft grey page in light, and a market-standard green/red rather than a
// brand teal — on a trading screen green means UP, and borrowing it for
// "primary button" is exactly the confusion an ERP does not need.
//
// This is a SKIN, not a rewrite: it moves the neutral ramp, the surfaces and
// the two semantic accents, and adds a typeface plus tighter geometry (see
// TERMINAL_SHELL_CSS below). Every one of the four original skins is
// untouched — the owner picks later.
const terminal = clone(dark), terminalLight = clone(light);

// DARK: flatter and deeper than the house dark. The surface steps go nearly
// black and the borders stay a hair above them, which is what gives a
// terminal its "panels floating on nothing" look rather than stacked cards.
const TERMINAL_FIX = {
  slate: {
    950: '#0a0b0d', 900: '#101114', 800: '#1b1d21', 700: '#2a2d33', 600: '#4b5058',
    500: '#6e747c', 400: '#9aa0a8', 300: '#c8ccd2', 200: '#e2e5e9', 100: '#f0f1f3', 50: '#f8f9fa',
  },
  // Market green: gains, confirmations, the primary action.
  emerald: {
    50: '#eafaf3', 100: '#ccf3e1', 200: '#98e7c4', 300: '#5fd9a4', 400: '#22c780',
    500: '#0ecb81', 600: '#0aa568', 700: '#088452', 800: '#0a6743', 900: '#0a5138', 950: '#052b1e',
  },
  // Market red: losses, overdue, destructive.
  rose: {
    50: '#fdecee', 100: '#fbd3d7', 200: '#f6a7ae', 300: '#f07b85', 400: '#ea5560',
    500: '#e5484d', 600: '#c8353c', 700: '#a52a31', 800: '#82232a', 900: '#661d23', 950: '#380f13',
  },
};
for (const [scale, steps] of Object.entries(TERMINAL_FIX)) {
  for (const [step, hex] of Object.entries(steps)) terminal[scale][step] = hexToRgb(hex);
}
const TERMINAL_SURFACES = {
  chrome: '#0d0e11', canvas: '#0a0b0d', sunken: '#0e1013', raised: '#16181c',
  rail: '#101114', deep: '#08090b', navy: '#0e1520', moss: '#0a3d2a', moss2: '#0f5738',
};
for (const [name, hex] of Object.entries(TERMINAL_SURFACES)) terminal[name] = { DEFAULT: hexToRgb(hex) };

// LIGHT: plain white cards on a soft grey page — the inverse arrangement to
// the house light skin, which lifts off-white cards off a deeper grey. Here
// the CARD is the brightest thing and the page recedes, which is what makes a
// dense table read as a sheet of data rather than a stack of panels.
const TERMINAL_LIGHT_FIX = {
  slate: {
    950: '#ffffff', 900: '#ffffff', 800: '#e6e8eb', 700: '#d3d7dc', 600: '#9ba1a9',
    500: '#6b7280', 400: '#4b5058', 300: '#343941', 200: '#22262c', 100: '#15181c', 50: '#0d0e11',
  },
  emerald: {
    950: '#eafaf3', 900: '#ccf3e1', 800: '#98e7c4', 700: '#5fd9a4', 600: '#12b981',
    500: '#089981', 400: '#07836f', 300: '#066a5a', 200: '#055346', 100: '#043c33', 50: '#02231e',
  },
  rose: {
    950: '#fdecee', 900: '#fbd3d7', 800: '#f6a7ae', 700: '#f07b85', 600: '#e5484d',
    500: '#d13239', 400: '#b02a30', 300: '#8e2228', 200: '#6d1a1f', 100: '#4d1216', 50: '#2b0a0c',
  },
};
for (const [scale, steps] of Object.entries(TERMINAL_LIGHT_FIX)) {
  for (const [step, hex] of Object.entries(steps)) terminalLight[scale][step] = hexToRgb(hex);
}
terminalLight.white = { DEFAULT: hexToRgb('#0d0e11') };
const TERMINAL_LIGHT_SURFACES = {
  chrome: '#ffffff', canvas: '#f6f7f9', sunken: '#f0f2f4', raised: '#ffffff',
  rail: '#fafbfc', deep: '#ffffff', navy: '#eef2f8', moss: '#e6f7f0', moss2: '#c7ecdd',
};
for (const [name, hex] of Object.entries(TERMINAL_LIGHT_SURFACES)) terminalLight[name] = { DEFAULT: hexToRgb(hex) };

const APP_BG_EXTRA = {
  dim: hexToRgb('#1e222a'), paper: hexToRgb('#ece6d7'),
  terminal: hexToRgb('#0a0b0d'), 'terminal-light': hexToRgb('#f6f7f9'),
};

// ── Type, as a theme token ──────────────────────────────────────────────────
// The typeface is part of a skin, not a global constant: the house skins keep
// Rubik, and only the terminal skins switch to the grotesque + monospaced
// figures a trading screen uses. One variable, set per theme, read by both the
// Tailwind config and the body rule.
const FONTS = {
  house: {
    sans: "Rubik, Inter, system-ui, -apple-system, 'Segoe UI', sans-serif",
    mono: "'Roboto Mono', ui-monospace, SFMono-Regular, monospace",
  },
  terminal: {
    sans: "Inter, 'Inter Tight', system-ui, -apple-system, 'Segoe UI', sans-serif",
    mono: "'JetBrains Mono', 'Roboto Mono', ui-monospace, SFMono-Regular, monospace",
  },
};
const fontBlock = (f) => `--font-app:${f.sans};--font-mono-app:${f.mono}`;

/**
 * The terminal skins' GEOMETRY, scoped to those skins alone.
 *
 * A trading terminal reads the way it does as much from its edges as its
 * colours: square-ish corners, hairline separators instead of ringed cards,
 * and figures that line up in a column because every digit is the same width.
 * Those live in ~4,200 Tailwind class sites, so they cannot be re-authored per
 * theme — but they CAN be overridden for one theme from here, which keeps the
 * other four skins byte-identical to what they were.
 */
// `:root:not([data-theme])` is the default terminal skin — without it the
// geometry below would apply to every skin EXCEPT the one most people see.
const T = ':root:not([data-theme])';
const TL = ':root[data-theme="terminal"]';
const TT = ':root[data-theme="terminal-light"]';
const TERMINAL_SHELL_CSS = [
  // Corners: the house look is rounded-2xl cards; a terminal is nearly square.
  `${T} .rounded-2xl,${TL} .rounded-2xl,${TT} .rounded-2xl{border-radius:.5rem}`,
  `${T} .rounded-xl,${TL} .rounded-xl,${TT} .rounded-xl{border-radius:.375rem}`,
  `${T} .rounded-lg,${TL} .rounded-lg,${TT} .rounded-lg{border-radius:.25rem}`,
  // Panels sit flat: the decorative inner ring goes, the hairline border stays.
  // NB: this is an ATTRIBUTE substring match, so the value is the literal
  // class name as written in the HTML — `ring-white/5`, with no CSS escaping.
  // Escaping it the way a class SELECTOR needs (.ring-white\\/5) makes the
  // rule match a backslash that is not there, and it silently never applies.
  `${T} [class*="ring-white/5"],${TL} [class*="ring-white/5"],${TT} [class*="ring-white/5"]{--tw-ring-color:transparent}`,
  // Every figure in the app lines up, not only the ones already marked.
  `${T},${TL},${TT}{font-feature-settings:"tnum" 1,"cv01" 1;letter-spacing:-0.006em}`,
  // A light terminal draws its own separators, so shadows would double them.
  ':root[data-theme="terminal-light"] [class*="shadow-black"]{--tw-shadow-color:rgb(13 14 17 / 0.08);--tw-shadow:var(--tw-shadow-colored)}',
].join('\n');

const varName = (s, step) => step === 'DEFAULT' ? `--c-${s}` : `--c-${s}-${step}`;
const block = (map, bg) => {
  const lines = [];
  for (const s of Object.keys(map)) for (const step of Object.keys(map[s])) lines.push(`${varName(s, step)}:${map[s][step]}`);
  lines.push(`--c-app-bg:${bg}`);
  return lines.join(';');
};

// Shadows are tuned for a dark canvas — `shadow-black/50` is invisible depth
// there and a grey smudge on white. In the light-family themes the shadow
// COLOUR is softened (the blur/spread from shadow-lg/2xl is kept), via an
// attribute selector so it catches every opacity suffix without listing them.
const SHADOW_FIX = ':root[data-theme="light"] [class*="shadow-black"],:root[data-theme="paper"] [class*="shadow-black"]{--tw-shadow-color:rgb(15 23 42 / 0.10);--tw-shadow:var(--tw-shadow-colored)}';

// TERMINAL IS THE UNATTRIBUTED DEFAULT (owner's call, 2026-08-21). The skin
// that costs nothing to render is the one most people see, so the house dark
// hands that position over and takes an attribute of its own. Every legacy
// block now re-states the house typeface, because :root no longer carries it —
// without that, choosing Dark would keep the terminal's Inter.
const css = [
  `:root{${block(terminal, APP_BG_EXTRA.terminal)};${fontBlock(FONTS.terminal)}}`,
  `:root[data-theme="terminal"]{${block(terminal, APP_BG_EXTRA.terminal)};${fontBlock(FONTS.terminal)}}`,
  `:root[data-theme="terminal-light"]{${block(terminalLight, APP_BG_EXTRA['terminal-light'])};${fontBlock(FONTS.terminal)}}`,
  `:root[data-theme="dark"]{${block(dark, APP_BG.dark)};${fontBlock(FONTS.house)}}`,
  `:root[data-theme="light"]{${block(light, APP_BG.light)};${fontBlock(FONTS.house)}}`,
  `:root[data-theme="dim"]{${block(dim, APP_BG_EXTRA.dim)};${fontBlock(FONTS.house)}}`,
  `:root[data-theme="paper"]{${block(paper, APP_BG_EXTRA.paper)};${fontBlock(FONTS.house)}}`,
  SHADOW_FIX,
  TERMINAL_SHELL_CSS,
].join('\n');

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

export type ThemeName = 'dark' | 'light' | 'dim' | 'paper' | 'terminal' | 'terminal-light';
`;
fs.writeFileSync(require('path').join(__dirname, '..', 'constants', 'palette.ts'), out);
console.log('css bytes:', css.length, '| colors js bytes:', colorsJs.length);
console.log('sample dark slate-900:', dark.slate[900], '| light slate-900:', light.slate[900]);
console.log('sample dark white:', dark.white.DEFAULT, '| light white:', light.white.DEFAULT);
