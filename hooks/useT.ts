'use client';

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
  return {
    t: (en: string) => translate(en, lang),
    tf: (en: string, vars: Record<string, string | number>) => translateF(en, lang, vars),
    lang,
  };
}
