'use client';

import { useSettings } from './useSettings';
import { t as translate, type Lang } from '@/lib/i18n';

/**
 * The translator, bound to the language setting.
 *
 * A hook rather than a bare import so a screen re-renders the moment the
 * company language changes in Settings — the same subscription the number and
 * date formats already use.
 */
export function useT(): { t: (en: string) => string; lang: Lang } {
  const lang = (useSettings().language ?? 'en') as Lang;
  return { t: (en: string) => translate(en, lang), lang };
}
