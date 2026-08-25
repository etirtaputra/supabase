'use client';

import { useMemo } from 'react';
import { useLanguage } from './useLanguage';
import { t as translate, tf as translateF, type Lang } from '@/lib/i18n';

/**
 * The translator, bound to the language THIS PERSON reads in.
 *
 * A hook rather than a bare import so a screen re-renders the moment the
 * language changes — whether that is the person flipping EN/ID in the nav
 * menu or the owner changing the company default in Settings. Resolution
 * (personal → company → English) lives in `useLanguage`, so every call site
 * asks one question and gets one answer.
 */
export function useT(): {
  t: (en: string) => string;
  /** A sentence with values in it — `t` with `{name}` placeholders filled. */
  tf: (en: string, vars: Record<string, string | number>) => string;
  lang: Lang;
} {
  const { lang } = useLanguage();
  // Memoised on `lang`, so `t` and `tf` are STABLE between renders. That is not
  // a micro-optimisation: a caller that translates inside a useMemo or a
  // useEffect has to list them as dependencies, and a function rebuilt every
  // render would make that memo recompute every render (2026-08-25 — the
  // dashboard's two leaderboards are exactly this case). Stable per language
  // means they recompute when the language changes, which is when they should.
  return useMemo(() => ({
    t: (en: string) => translate(en, lang),
    tf: (en: string, vars: Record<string, string | number>) => translateF(en, lang, vars),
    lang,
  }), [lang]);
}
