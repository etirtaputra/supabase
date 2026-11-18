/**
 * Server-side PDF of a print page — the same engine as desktop Chrome, so a
 * proposal downloaded on a phone is the file the desktop saves (owner,
 * 2026-11-18: "i want the mobile pdf to follow the desktop version"; an iPhone
 * printed it ~115% larger, 4 pages instead of 3).
 *
 * The page is the app's own print view, rendered as the person who asked:
 * their session goes into the headless browser's localStorage before the
 * first script runs, so RLS, the role gate and their column choice apply
 * exactly as on their screen. The refresh token is NOT passed — the caller
 * sends an access token with minutes to spare, and a headless browser that
 * could refresh would rotate (and so revoke) the person's own refresh token.
 *
 * Server-only (puppeteer-core + @sparticuz/chromium; both are external
 * packages in next.config.ts). PDF_CHROME_PATH points at a local Chromium for
 * development.
 */
import type { Browser } from 'puppeteer-core';

export async function launchBrowser(): Promise<Browser> {
  const puppeteer = (await import('puppeteer-core')).default;
  const local = process.env.PDF_CHROME_PATH;
  if (local) return puppeteer.launch({ executablePath: local, headless: true, args: ['--no-sandbox', '--disable-dev-shm-usage'] });
  const chromium = (await import('@sparticuz/chromium')).default;
  return puppeteer.launch({ args: chromium.args, executablePath: await chromium.executablePath(), headless: true });
}

export class RenderError extends Error {
  status: number;
  constructor(status: number, message: string) { super(message); this.status = status; }
}

/**
 * Open `url` with `storage` pre-loaded, wait for the page to mark itself
 * ready (`<html data-pdf-ready="1">`, set by the print view once data, the
 * column choice and the fonts are in), and print it to PDF with the page's
 * own @page size and margins.
 */
export async function renderPdf(browser: Browser, url: string, storage: Record<string, string>, timeoutMs = 40_000): Promise<{ pdf: Uint8Array; title: string }> {
  const page = await browser.newPage();
  try {
    // A desktop-sized window, so nothing on the page takes its phone layout.
    await page.setViewport({ width: 1280, height: 900, deviceScaleFactor: 1 });
    await page.evaluateOnNewDocument((entries: [string, string][]) => {
      try { for (const [k, v] of entries) window.localStorage.setItem(k, v); } catch { /* storage blocked */ }
    }, Object.entries(storage));
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: timeoutMs });
    const ready = await Promise.race([
      page.waitForSelector('html[data-pdf-ready="1"]', { timeout: timeoutMs }).then(() => 'ready' as const),
      page.waitForFunction(() => /\/(login|unauthorized)\b/.test(location.pathname), { timeout: timeoutMs }).then(() => 'refused' as const),
    ]).catch(() => 'timeout' as const);
    if (ready === 'refused') throw new RenderError(403, 'This proposal could not be opened with your sign-in (signed out, or no EPC access).');
    if (ready === 'timeout') throw new RenderError(504, 'The proposal took too long to load for the PDF. Try again.');
    await page.emulateMediaType('print');
    const title = await page.title();
    const pdf = await page.pdf({ preferCSSPageSize: true, printBackground: true });
    return { pdf, title };
  } finally {
    await page.close().catch(() => {});
  }
}
