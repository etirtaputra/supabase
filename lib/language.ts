/**
 * ICAPROC speaks two languages: English and Bahasa Indonesia.
 *
 * WHOSE CHOICE. The same answer the theme switcher gives, and for the same
 * reason — a language is a personal comfort, not a company policy:
 *
 *   personal choice (this browser)  →  company default  →  English
 *
 * The company default is Settings › Defaults and lives in `40.0_settings`; it
 * decides what a browser that has never chosen shows. A browser that DID
 * choose keeps its choice: a buyer who writes to suppliers all day in English
 * should not be flipped into Indonesian because the warehouse prefers it, and
 * the reverse. (This is deliberately UNLIKE the list-layout preference, which
 * dissolves when the house default changes: that one is a per-screen tweak, so
 * a stale pin makes Settings look broken. A language is the person, not the
 * screen.)
 *
 * WHAT TRANSLATES. Everything that EXPLAINS or ASKS: sentences, empty states,
 * button and filter labels, placeholders, tooltips, hints, page subtitles.
 *
 * WHAT DOES NOT, by the owner's rule (2026-08-19): the NAMES of things — menu
 * entries, module names, and the shared trading vocabulary the team already
 * uses with suppliers and customers (Stock, PO, SO, GRN, Deal Lookup, Surat
 * Jalan, Surat Dukungan), plus every document number. Translating those would
 * give one thing two names, which costs more than it buys.
 */
// The type itself lives with the phrase book, so there is one definition of
// "a language this app speaks" rather than two that can drift apart.
export type { Lang } from './i18n.ts';
import type { Lang } from './i18n.ts';

export const LANG_STORAGE_KEY = 'icaproc_lang';
/** Cached copy of the company default, so a fresh tab honours it immediately. */
export const LANG_DEFAULT_KEY = 'icaproc_lang_default';
export const DEFAULT_LANG: Lang = 'en';

export const isLang = (v: unknown): v is Lang => v === 'en' || v === 'id';

export const LANGUAGES: { value: Lang; label: string; short: string }[] = [
  { value: 'en', label: 'English', short: 'EN' },
  { value: 'id', label: 'Bahasa Indonesia', short: 'ID' },
];

/** The personal pick on this browser, or null when this browser never chose. */
export function readPersonalLang(): Lang | null {
  try {
    const v = window.localStorage.getItem(LANG_STORAGE_KEY);
    return isLang(v) ? v : null;
  } catch { return null; }
}

/** Remember (or forget, with null) the personal pick. */
export function writePersonalLang(lang: Lang | null): void {
  try {
    if (lang) window.localStorage.setItem(LANG_STORAGE_KEY, lang);
    else window.localStorage.removeItem(LANG_STORAGE_KEY);
  } catch { /* private mode — the choice simply doesn't persist */ }
}

/** Cache the company default whenever settings land, for the next cold start. */
export function cacheHouseLang(lang: Lang): void {
  try { window.localStorage.setItem(LANG_DEFAULT_KEY, lang); } catch { /* ignore */ }
}

export function readHouseLangCache(): Lang | null {
  try {
    const v = window.localStorage.getItem(LANG_DEFAULT_KEY);
    return isLang(v) ? v : null;
  } catch { return null; }
}
