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
 * WHAT TRANSLATES: everything. Sentences, empty states, buttons, hints, page
 * subtitles — and, since the owner reversed the 2026-08-19 rule on 2026-08-25,
 * the NAMES of things too: menu entries, module names, panel titles, role
 * names, document statuses.
 *
 * WHAT DOES NOT: the codes in `KEEPERS` (`lib/i18n.ts`) — PO, PI, GRN, DO, SO,
 * SKU, kWp and the rest — plus every document number. Those are printed on
 * paper a supplier holds; translating one would give a single document two
 * names, which costs more than it buys.
 *
 * HOW THE CHOICE PROPAGATES. The personal pick is a MODULE-LEVEL STORE with
 * subscribers, not component state — the same shape `lib/settings.ts` uses,
 * and for a reason paid for on 2026-08-25: it used to be a `useState` inside
 * `useLanguage()`, so every caller of that hook held its OWN copy. `useT()`
 * calls it and so does the EN/ID switch in `BrandMenu`, which meant pressing
 * the switch updated the switch's copy and nothing else's. The button lit up
 * and the page stayed in the other language. One store, every subscriber
 * re-rendered.
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

/** The other one — two languages, so the switch is a flip, not a picker. */
export const otherLang = (l: Lang): Lang => (l === 'en' ? 'id' : 'en');
/** Its row in LANGUAGES, for the switch's label and tooltip. */
export const langInfo = (l: Lang) => LANGUAGES.find((x) => x.value === l) ?? LANGUAGES[0];

// ── The store (module-level, so ONE answer serves every subscriber) ─────────

let personal: Lang | null = null;
let houseCache: Lang | null = null;
let hydrated = false;
const listeners = new Set<() => void>();

/**
 * Subscribe to language changes. Returns the unsubscribe function, the shape
 * `useSyncExternalStore` wants.
 */
export function subscribeLang(fn: () => void): () => void {
  listeners.add(fn);
  return () => { listeners.delete(fn); };
}

const publish = (): void => {
  listeners.forEach((fn) => { try { fn(); } catch { /* one bad subscriber must not break the rest */ } });
};

/** The personal pick on this browser, or null when this browser never chose. */
export const getPersonalLang = (): Lang | null => personal;
/** The cached company default, or null before settings have ever landed. */
export const getHouseLangCache = (): Lang | null => houseCache;

const readStored = (key: string): Lang | null => {
  try {
    const v = window.localStorage.getItem(key);
    return isLang(v) ? v : null;
  } catch { return null; }
};

/**
 * Read both stored values into the store, once.
 *
 * Deliberately NOT done at import time: the server has no localStorage, so a
 * store already populated on the client's first render is a hydration
 * mismatch. `useLanguage` calls this from a LAYOUT effect — after hydration,
 * before paint — so the first frame matches the server and the correction
 * lands without a visible flash. Idempotent, because every consumer calls it.
 */
export function hydrateLangFromStorage(): void {
  if (hydrated) return;
  hydrated = true;
  personal = readStored(LANG_STORAGE_KEY);
  houseCache = readStored(LANG_DEFAULT_KEY);
  if (personal !== null || houseCache !== null) publish();
}

/** Remember (or forget, with null) the personal pick, and tell everyone. */
export function setPersonalLang(lang: Lang | null): void {
  if (personal === lang) return;
  personal = lang;
  try {
    if (lang) window.localStorage.setItem(LANG_STORAGE_KEY, lang);
    else window.localStorage.removeItem(LANG_STORAGE_KEY);
  } catch { /* private mode — the choice simply doesn't persist */ }
  publish();
}

/** Cache the company default whenever settings land, for the next cold start. */
export function cacheHouseLang(lang: Lang): void {
  if (houseCache === lang) return;
  houseCache = lang;
  try { window.localStorage.setItem(LANG_DEFAULT_KEY, lang); } catch { /* ignore */ }
  publish();
}

/** Test seam: forget everything this store has learned. */
export function resetLangStore(): void {
  personal = null; houseCache = null; hydrated = false; listeners.clear();
}
