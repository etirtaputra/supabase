/**
 * The browser tab's title text, written the way the browser will READ IT BACK.
 *
 * `document.title` strips and collapses whitespace on read (HTML spec), so a
 * title set to "PT  — ICAPROC" reads back as "PT — ICAPROC". usePageTitle
 * watches the <head> and puts its title back whenever it differs; with a
 * customer name ending in a space it always differed, so every rewrite of the
 * Tailwind CDN's <style> started a rewrite that triggered itself forever and
 * the page hung ("Page Unresponsive" on proposal Q-20261002-SXD2, 2026-10-02,
 * customer "P TDelta Marlin Sandang Tekstile "). Typing any two-word name
 * passes through that state on the space bar.
 */
export const APP_TITLE = 'ICAPROC';

/** Strip and collapse ASCII whitespace — exactly what the title getter does. */
export function browserTitleText(s: string): string {
  return s.replace(/[\t\n\f\r ]+/g, ' ').replace(/^ | $/g, '');
}

export function tabTitle(label: string | null | undefined, detail?: string | null): string {
  const parts = [label || null, detail ? browserTitleText(detail) || null : null].filter(Boolean);
  return browserTitleText(parts.length ? `${parts.join(' · ')} — ${APP_TITLE}` : APP_TITLE);
}
