/**
 * ICAPROC — light / dark skin.
 *
 * The theme is a PERSONAL choice, not a company default: one person reading
 * the app in a bright warehouse office and another at night should not have to
 * agree. So it lives in localStorage per browser, not in `40.0_settings` —
 * nothing to sync, nothing to migrate, and it works before any network call.
 *
 * Switching is one attribute on <html>: every colour in the app resolves
 * through the CSS variables in `constants/palette.ts`, so `data-theme="light"`
 * re-skins ~4,200 class sites at once with no re-render and no component edits.
 *
 * Dark stays the default — it is what the app has always looked like, and an
 * install that never touches this module is unchanged.
 */
import type { ThemeName } from '@/constants/palette';

export type { ThemeName };

export const THEME_STORAGE_KEY = 'icaproc_theme';
export const DEFAULT_THEME: ThemeName = 'dark';

/**
 * Runs before first paint, inlined in <head>. Written as a plain string
 * because it must execute BEFORE React hydrates — otherwise every page load
 * flashes dark before switching to light, which is worse than not offering
 * the theme at all. Kept tiny and exception-safe (private browsing can throw
 * on localStorage access; a throw here would blank the page).
 */
export const THEME_BOOT_SCRIPT = `(function(){try{var t=localStorage.getItem(${JSON.stringify(
  THEME_STORAGE_KEY,
)});if(t==='light'||t==='dark'){document.documentElement.setAttribute('data-theme',t);}}catch(e){}})();`;

let current: ThemeName = DEFAULT_THEME;
const listeners = new Set<(t: ThemeName) => void>();

/** The theme in effect right now (readable outside React). */
export function getTheme(): ThemeName {
  return current;
}

/** Read the stored preference. Safe on the server, where there is none. */
export function readStoredTheme(): ThemeName {
  if (typeof window === 'undefined') return DEFAULT_THEME;
  try {
    const t = window.localStorage.getItem(THEME_STORAGE_KEY);
    return t === 'light' || t === 'dark' ? t : DEFAULT_THEME;
  } catch {
    return DEFAULT_THEME;
  }
}

/** Apply a theme: paint it, persist it, tell subscribers. */
export function setTheme(theme: ThemeName): void {
  current = theme;
  if (typeof document !== 'undefined') {
    // Dark is the absence of the attribute, so the default costs nothing and
    // a browser that never stored a preference renders the original skin.
    if (theme === 'dark') document.documentElement.removeAttribute('data-theme');
    else document.documentElement.setAttribute('data-theme', theme);
  }
  try { window.localStorage.setItem(THEME_STORAGE_KEY, theme); } catch { /* private mode */ }
  listeners.forEach((fn) => fn(theme));
}

export function toggleTheme(): ThemeName {
  const next: ThemeName = getTheme() === 'dark' ? 'light' : 'dark';
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
