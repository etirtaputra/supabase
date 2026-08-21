'use client';
import { useCallback, useEffect, useLayoutEffect, useState } from 'react';
import { useSettings } from './useSettings';
import {
  readPersonalLang, writePersonalLang, readHouseLangCache, cacheHouseLang,
  DEFAULT_LANG, type Lang,
} from '@/lib/language';

/** useLayoutEffect on the client, useEffect on the server (which never runs it). */
const useIsomorphicLayoutEffect = typeof window !== 'undefined' ? useLayoutEffect : useEffect;

/**
 * Which language this person reads the app in — their own pick if they made
 * one, otherwise the company default from Settings › Defaults.
 *
 * Read in a LAYOUT effect (pre-paint, post-hydration) and seeded from the
 * cached company default, so a returning browser renders the right language on
 * its first frame instead of flashing English and correcting itself.
 */
export function useLanguage(): { lang: Lang; setLang: (l: Lang | null) => void; house: Lang; isPersonal: boolean } {
  const house = (useSettings().language ?? DEFAULT_LANG) as Lang;
  const [personal, setPersonal] = useState<Lang | null>(null);
  const [cachedHouse, setCachedHouse] = useState<Lang | null>(null);

  useIsomorphicLayoutEffect(() => {
    setPersonal(readPersonalLang());
    setCachedHouse(readHouseLangCache());
  }, []);

  // Settings are the authority; the cache only covers the moment before they
  // arrive, so it is refreshed every time they do.
  useEffect(() => { cacheHouseLang(house); setCachedHouse(house); }, [house]);

  const setLang = useCallback((l: Lang | null) => {
    setPersonal(l);
    writePersonalLang(l);
  }, []);

  return {
    lang: personal ?? cachedHouse ?? house,
    setLang, house, isPersonal: personal !== null,
  };
}
