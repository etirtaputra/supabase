'use client';
/**
 * The browser tab's title: the page's MENU name, in the reader's language,
 * then an optional detail (a document number, an item), then the app.
 *
 *     Stok — ICAPROC
 *     Pesanan Penjualan · SO2609-4791 — ICAPROC
 *
 * The name is never typed by the page: it comes from `pageLabelFor`
 * (constants/navigation.ts), the same rule that lights the menu entry and
 * names the page in the phone header. Before 2026-09-28 every page wrote its
 * own English title by hand, so /banks said "Banks" on the tab and "Finance"
 * in the menu, and no tab followed the language switch.
 *
 * `detail` is DATA (a number, a name) and is shown as given; a detail that is
 * a word must be translated by the caller.
 */
import { useEffect } from 'react';
import { usePathname } from 'next/navigation';
import { pageLabelFor } from '@/constants/navigation';
import { useT } from '@/hooks/useT';

export const APP_TITLE = 'ICAPROC';

export function usePageTitle(detail?: string | null, deps: unknown[] = []): void {
  const pathname = usePathname();
  const { t, lang } = useT();
  useEffect(() => {
    const label = pageLabelFor(pathname, window.location.search);
    const parts = [label ? t(label) : null, detail || null].filter(Boolean);
    const want = parts.length ? `${parts.join(' · ')} — ${APP_TITLE}` : APP_TITLE;
    document.title = want;
    // Next re-applies the section's static metadata (app/<section>/layout.tsx,
    // English, rendered on the server before anyone's language is known) on a
    // soft navigation — AFTER this effect has run. Purchasing found that the
    // hard way and re-ran its effect on every URL change; watching the <head>
    // and putting ours back is the general answer.
    const obs = new MutationObserver(() => { if (document.title !== want) document.title = want; });
    obs.observe(document.head, { subtree: true, childList: true, characterData: true });
    return () => obs.disconnect();
    // `deps` lets a page whose tab lives in the query (?tab=) re-title when
    // it switches tab with replaceState, which changes no pathname.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pathname, detail, lang, t, ...deps]);
}
