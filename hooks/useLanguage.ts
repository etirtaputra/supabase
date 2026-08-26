'use client';
import { useCallback, useEffect, useLayoutEffect, useSyncExternalStore } from 'react';
import { useSettings } from './useSettings';
import {
  subscribeLang, getPersonalLang, getHouseLangCache, hydrateLangFromStorage,
  setPersonalLang, cacheHouseLang, DEFAULT_LANG, type Lang,
} from '@/lib/language';

/** useLayoutEffect on the client, useEffect on the server (which never runs it). */
const useIsomorphicLayoutEffect = typeof window !== 'undefined' ? useLayoutEffect : useEffect;

/** Both stored values start as null — on the server, and on the client's first
 *  (hydrating) render, so the markup React builds matches the markup it got. */
const noPick = (): Lang | null => null;

/**
 * Which language this person reads the app in — their own pick if they made
 * one, otherwise the company default from Settings › Defaults.
 *
 * SUBSCRIBED, NOT COPIED. The pick lives in the module-level store in
 * `lib/language.ts` and is read here through `useSyncExternalStore`, so every
 * component calling this hook — directly, or through `useT()` — is looking at
 * the SAME value and re-renders the moment it changes.
 *
 * It used to be a `useState` per caller, which meant `setLang` reached only
 * the component holding the switch: pressing EN lit the button and left the
 * rest of the page in Indonesian (owner's screenshot, 2026-08-25). A language
 * switch has to move the whole app or it has not switched anything.
 *
 * Read in a LAYOUT effect (pre-paint, post-hydration) and seeded from the
 * cached company default, so a returning browser renders the right language on
 * its first painted frame instead of flashing English and correcting itself.
 */
export function useLanguage(): { lang: Lang; setLang: (l: Lang | null) => void; house: Lang; isPersonal: boolean } {
  const house = (useSettings().language ?? DEFAULT_LANG) as Lang;
  const personal = useSyncExternalStore(subscribeLang, getPersonalLang, noPick);
  const cachedHouse = useSyncExternalStore(subscribeLang, getHouseLangCache, noPick);

  // Idempotent, so it costs nothing that every consumer asks.
  useIsomorphicLayoutEffect(() => { hydrateLangFromStorage(); }, []);

  // Settings are the authority; the cache only covers the moment before they
  // arrive, so it is refreshed every time they do. `cacheHouseLang` returns
  // early when the value is unchanged, so this cannot loop.
  useEffect(() => { cacheHouseLang(house); }, [house]);

  const setLang = useCallback((l: Lang | null) => { setPersonalLang(l); }, []);

  return {
    lang: personal ?? cachedHouse ?? house,
    setLang, house, isPersonal: personal !== null,
  };
}
