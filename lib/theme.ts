/**
 * ICAPROC — the four skins: dark · dim · light · paper.
 *
 * The PERSONAL choice still lives in localStorage per browser (nothing to
 * sync, works before any network call) — but since 2026-08-01 there is also a
 * COMPANY DEFAULT, set by the owner in Settings › Appearance and stored in
 * `40.0_settings`. Resolution order, everywhere including the pre-paint boot
 * script:
 *
 *   personal choice (this browser)  →  company default  →  dark
 *
 * The company default is CACHED in localStorage under its own key whenever
 * settings load, so the boot script can honour it before first paint on the
 * next visit — a browser that never chose for itself follows the office
 * default with no flash. A browser that DID choose keeps its choice forever;
 * changing the company default never overwrites anyone's personal pick.
 *
 * Switching is one attribute on <html>: every colour resolves through the CSS
 * variables in `constants/palette.ts`, so a theme change re-skins ~4,200
 * class sites at once with no re-render. Dark is the absence of the
 * attribute, so an untouched install renders the original skin.
 */
import type { ThemeName } from '@/constants/palette';

export type { ThemeName };

export const THEME_STORAGE_KEY = 'icaproc_theme';
/** Cached copy of Settings › Appearance's company default (for the boot script). */
export const THEME_DEFAULT_KEY = 'icaproc_theme_default';
export const DEFAULT_THEME: ThemeName = 'terminal';

/**
 * The skins Settings › Appearance OFFERS as a house default (owner, 2026-08-28:
 * "do not delete but just hide the original 4 colors").
 *
 * Hidden, not removed. The four house skins still exist in THEMES, still have
 * their palette blocks, still migrate (LEGACY_THEME_MIGRATION) and a browser
 * already sitting on one keeps it — they are simply no longer offered as a NEW
 * choice. Settings still SHOWS a legacy skin when it is the current default,
 * because a setting you cannot see is worse than one you cannot pick.
 *
 * This is also the only list the wordmark menu's brightness switch can land on
 * — `nextTheme` picks out of it rather than naming skins itself, so changing
 * the offered pair here changes the switch too. (There used to be a second
 * constant, MENU_THEME_VALUES, holding the same two values for the menu's own
 * picker; the menu became a one-tap switch on 2026-08-28 and the duplicate
 * went with it.)
 */
export const OFFERED_THEME_VALUES: ThemeName[] = ['terminal', 'terminal-light'];

/**
 * Which skins are LIGHT. Six skins, but only ever two answers to "is the
 * screen bright or dark" — which is what the one-tap switch in the wordmark
 * menu asks, and what its icon has to be honest about.
 */
export const LIGHT_THEMES: ThemeName[] = ['light', 'paper', 'terminal-light'];
export const isLightTheme = (t: ThemeName): boolean => LIGHT_THEMES.includes(t);

/**
 * What one tap of the brightness switch gives you from here.
 *
 * It always lands in the OFFERED pair, never on a hidden legacy skin — six
 * skins behind a two-state switch is how someone ends up on Paper without
 * having asked for it. Someone sitting on a legacy skin therefore leaves it
 * the first time they tap, which is a choice they just made, not a migration
 * done behind their back (LEGACY_THEME_MIGRATION is the one that runs
 * unasked, and it runs once). Settings › Appearance still has all six.
 */
export const nextTheme = (t: ThemeName): ThemeName => {
  const wantLight = !isLightTheme(t);
  return OFFERED_THEME_VALUES.find((v) => isLightTheme(v) === wantLight) ?? DEFAULT_THEME;
};

/**
 * What a browser that chose a skin BEFORE the terminal pair existed should
 * see now. The owner's rule: everyone lands on the terminal skin, but whether
 * it is the dark or the light one follows what they already preferred.
 *
 * Applied ONCE, guarded by a marker, because it must not fight the person: if
 * someone deliberately picks Paper from Settings tomorrow, that is a choice,
 * not a stale preference, and re-mapping it every load would make the setting
 * look broken.
 */
export const LEGACY_THEME_MIGRATION: Record<string, ThemeName> = {
  dark: 'terminal', dim: 'terminal',
  light: 'terminal-light', paper: 'terminal-light',
};
export const THEME_MIGRATED_KEY = 'icaproc_theme_migrated_v2';

/**
 * Order = the Appearance switcher's order: the two darks, then the two lights.
 * `swatch` holds each skin's REAL render values (canvas / card / ink / accent)
 * so switchers can show the colour itself instead of naming it — the menu
 * draws circles from these, Settings draws its preview cards from them.
 */
export const THEMES: {
  value: ThemeName; label: string; blurb: string;
  swatch: { bg: string; card: string; ink: string; accent: string };
}[] = [
  { value: 'dark',  label: 'Dark',  blurb: 'The original — near-black, highest contrast',
    swatch: { bg: '#141518', card: '#1b1c1f', ink: '#e1e2e5', accent: '#49eacb' } },
  { value: 'dim',   label: 'Dim',   blurb: 'Softened dark — graphite surfaces, easier on office monitors',
    swatch: { bg: '#1e222a', card: '#232730', ink: '#e1e2e5', accent: '#49eacb' } },
  { value: 'light', label: 'Light', blurb: 'Soft light — cool off-whites, for bright rooms',
    swatch: { bg: '#eaecef', card: '#f8f9fa', ink: '#26272b', accent: '#17937c' } },
  { value: 'paper', label: 'Paper', blurb: 'Warm light — cream, the gentlest for all-day reading',
    swatch: { bg: '#ece6d7', card: '#faf7ef', ink: '#2b2720', accent: '#17937c' } },
  // The terminal pair (2026-08-21). Cues from a trading screen: flat panels or
  // plain white cards, hairline separators instead of ringed edges, market
  // green/red rather than the house teal, squarer corners, and Inter with
  // monospaced figures so columns of numbers line up.
  // The dark one moved off near-black onto Dim's graphite on 2026-08-28 —
  // near-black smears on the cheap panels the office runs. These swatches are
  // painted with the REAL values, so they track TERMINAL_SURFACES in
  // scripts/generate-palette.js and must be changed with it.
  { value: 'terminal', label: 'Terminal', blurb: 'Trading-desk dark on graphite — kinder to office monitors, market green, lined-up figures',
    swatch: { bg: '#1e222a', card: '#232730', ink: '#e8eaee', accent: '#0ecb81' } },
  { value: 'terminal-light', label: 'Terminal Light', blurb: 'Trading-desk light — white cards on soft grey, the same figures',
    swatch: { bg: '#f6f7f9', card: '#ffffff', ink: '#0d0e11', accent: '#089981' } },
];

export const isTheme = (v: unknown): v is ThemeName =>
  v === 'dark' || v === 'light' || v === 'dim' || v === 'paper'
  || v === 'terminal' || v === 'terminal-light';

/**
 * Runs before first paint, inlined in <head>. Written as a plain string
 * because it must execute BEFORE React hydrates — otherwise every page load
 * flashes dark before switching, which is worse than not offering themes at
 * all. Kept tiny and exception-safe (private browsing can throw on
 * localStorage access; a throw here would blank the page).
 * Mirrors the resolution order above: personal → cached company default.
 */
export const THEME_BOOT_SCRIPT = `(function(){try{var v=['dark','light','dim','paper','terminal','terminal-light'];var l=window.localStorage;var K=${JSON.stringify(
  THEME_STORAGE_KEY,
)};var t=l.getItem(K);var M=${JSON.stringify(THEME_MIGRATED_KEY)};if(!l.getItem(M)){var m=${JSON.stringify(
  LEGACY_THEME_MIGRATION,
)};if(t&&m[t]){t=m[t];l.setItem(K,t);}l.setItem(M,'1');}if(v.indexOf(t)<0){t=l.getItem(${JSON.stringify(
  THEME_DEFAULT_KEY,
)});}if(v.indexOf(t)>=0&&t!==${JSON.stringify(DEFAULT_THEME)}){document.documentElement.setAttribute('data-theme',t);}}catch(e){}})();`;

let current: ThemeName = DEFAULT_THEME;
const listeners = new Set<(t: ThemeName) => void>();

const paint = (theme: ThemeName): void => {
  if (typeof document === 'undefined') return;
  // The DEFAULT is the absence of the attribute, so the skin most people see
  // costs nothing to render. That used to be the house dark; since 2026-08-21
  // it is the terminal skin, and dark carries an attribute like any other.
  if (theme === DEFAULT_THEME) document.documentElement.removeAttribute('data-theme');
  else document.documentElement.setAttribute('data-theme', theme);
};

/** The theme in effect right now (readable outside React). */
export function getTheme(): ThemeName {
  return current;
}

/**
 * Migrate a pre-terminal preference, once. The boot script does this before
 * first paint; this is the same rule for any path that reaches storage first
 * (SSR hydration, a tab opened while the script was blocked). Sharing the
 * marker means whichever runs first wins and the other is a no-op.
 */
function migrateLegacyChoice(): void {
  try {
    if (window.localStorage.getItem(THEME_MIGRATED_KEY)) return;
    const stored = window.localStorage.getItem(THEME_STORAGE_KEY);
    const mapped = stored ? LEGACY_THEME_MIGRATION[stored] : undefined;
    if (mapped) window.localStorage.setItem(THEME_STORAGE_KEY, mapped);
    window.localStorage.setItem(THEME_MIGRATED_KEY, '1');
  } catch { /* private mode — the default simply applies */ }
}

/** Resolve the stored preference: personal → company default → terminal. */
export function readStoredTheme(): ThemeName {
  if (typeof window === 'undefined') return DEFAULT_THEME;
  try {
    migrateLegacyChoice();
    const personal = window.localStorage.getItem(THEME_STORAGE_KEY);
    if (isTheme(personal)) return personal;
    const fallback = window.localStorage.getItem(THEME_DEFAULT_KEY);
    return isTheme(fallback) ? fallback : DEFAULT_THEME;
  } catch {
    return DEFAULT_THEME;
  }
}

/** Apply a PERSONAL choice: paint it, persist it, tell subscribers. */
export function setTheme(theme: ThemeName): void {
  current = theme;
  paint(theme);
  try { window.localStorage.setItem(THEME_STORAGE_KEY, theme); } catch { /* private mode */ }
  listeners.forEach((fn) => fn(theme));
}

/**
 * The company default just arrived from Settings (40.0). Cache it for the
 * boot script, and follow it NOW — but only in a browser whose person never
 * made their own choice. Never writes the personal key.
 */
export function applyCompanyDefaultTheme(theme: ThemeName): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(THEME_DEFAULT_KEY, theme);
    if (isTheme(window.localStorage.getItem(THEME_STORAGE_KEY))) return;
  } catch { return; }
  if (current === theme) return;
  current = theme;
  paint(theme);
  listeners.forEach((fn) => fn(theme));
}

/**
 * Settings › Appearance preview: paint a skin on the spot so the owner sees
 * what they are choosing BEFORE saving. Persists nothing and never touches
 * `current` — ending the preview repaints whatever is actually in effect
 * (their personal pick, usually), so browsing the options is consequence-free.
 */
export function previewTheme(theme: ThemeName): void {
  paint(theme);
}

/** Leave preview mode: repaint the theme actually in effect. */
export function endThemePreview(): void {
  paint(current);
}

/**
 * Flip between bright and dark, in one tap.
 *
 * This used to cycle through every skin in `THEMES` order — written when
 * there were four and never updated when there were six, so a switch the
 * owner had deliberately narrowed to two would still walk someone onto Dim
 * or Paper. It is a two-state switch now; `nextTheme` holds the rule.
 */
export function toggleTheme(): ThemeName {
  const next = nextTheme(getTheme());
  setTheme(next);
  return next;
}

/** Sync the module store with whatever the boot script already painted. */
export function initTheme(): ThemeName {
  current = readStoredTheme();
  return current;
}

export function subscribeTheme(fn: (t: ThemeName) => void): () => void {
  listeners.add(fn);
  return () => { listeners.delete(fn); };
}
