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
export const DEFAULT_THEME: ThemeName = 'dark';

/** Order = the Appearance switcher's order: the two darks, then the two lights. */
export const THEMES: { value: ThemeName; label: string; blurb: string }[] = [
  { value: 'dark',  label: 'Dark',  blurb: 'The original — near-black, highest contrast' },
  { value: 'dim',   label: 'Dim',   blurb: 'Softened dark — graphite surfaces, easier on office monitors' },
  { value: 'light', label: 'Light', blurb: 'Soft light — cool off-whites, for bright rooms' },
  { value: 'paper', label: 'Paper', blurb: 'Warm light — cream, the gentlest for all-day reading' },
];

export const isTheme = (v: unknown): v is ThemeName =>
  v === 'dark' || v === 'light' || v === 'dim' || v === 'paper';

/**
 * Runs before first paint, inlined in <head>. Written as a plain string
 * because it must execute BEFORE React hydrates — otherwise every page load
 * flashes dark before switching, which is worse than not offering themes at
 * all. Kept tiny and exception-safe (private browsing can throw on
 * localStorage access; a throw here would blank the page).
 * Mirrors the resolution order above: personal → cached company default.
 */
export const THEME_BOOT_SCRIPT = `(function(){try{var v=['dark','light','dim','paper'];var l=window.localStorage;var t=l.getItem(${JSON.stringify(
  THEME_STORAGE_KEY,
)});if(v.indexOf(t)<0){t=l.getItem(${JSON.stringify(
  THEME_DEFAULT_KEY,
)});}if(v.indexOf(t)>=0&&t!=='dark'){document.documentElement.setAttribute('data-theme',t);}}catch(e){}})();`;

let current: ThemeName = DEFAULT_THEME;
const listeners = new Set<(t: ThemeName) => void>();

const paint = (theme: ThemeName): void => {
  if (typeof document === 'undefined') return;
  // Dark is the absence of the attribute, so the default costs nothing and
  // a browser that never stored a preference renders the original skin.
  if (theme === 'dark') document.documentElement.removeAttribute('data-theme');
  else document.documentElement.setAttribute('data-theme', theme);
};

/** The theme in effect right now (readable outside React). */
export function getTheme(): ThemeName {
  return current;
}

/** Resolve the stored preference: personal → company default → dark. */
export function readStoredTheme(): ThemeName {
  if (typeof window === 'undefined') return DEFAULT_THEME;
  try {
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

/** Cycle through the four skins in switcher order. */
export function toggleTheme(): ThemeName {
  const i = THEMES.findIndex((t) => t.value === getTheme());
  const next = THEMES[(i + 1) % THEMES.length].value;
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
