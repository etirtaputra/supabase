'use client';
/**
 * One rule for every print view: the document title IS the filename the
 * browser proposes for Save-as-PDF, so it carries the house convention
 * (lib/quoteFilename.ts) and nothing else — no page name, no " — ICAPROC".
 *
 * iOS is the exception the web cannot win. A WKWebView browser (Brave,
 * Chrome, Edge — everything on iOS that is not Safari) names the printed PDF
 * after ITSELF, whatever the page is called: that is where "Brave.pdf" comes
 * from. The iOS save sheet does let you rename before saving, so on iOS the
 * name goes to the clipboard on the way into the print dialog and the caller
 * shows it too (PrintFileNameNotice) — a paste instead of retyping.
 *
 * Pass '' while the document is still loading; nothing is written until there
 * is a real name.
 */
import { useCallback, useEffect, useState } from 'react';
import { copyOnly } from '@/lib/whatsappQuote';

export function usePrintFileName(fileName: string) {
  const [isIOS, setIsIOS] = useState(false);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    const ua = navigator.userAgent || '';
    // iPadOS 13+ reports itself as a Mac; touch points are what give it away.
    setIsIOS(/iPad|iPhone|iPod/.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1));
  }, []);

  useEffect(() => {
    if (fileName) document.title = fileName;
  }, [fileName]);

  const copyName = useCallback(async () => {
    if (!fileName) return;
    if (await copyOnly(fileName) === 'copied') {
      setCopied(true);
      setTimeout(() => setCopied(false), 8000);
    }
  }, [fileName]);

  const printNow = useCallback(() => {
    if (fileName) document.title = fileName;   // re-assert: it is the filename
    // Fire-and-forget, so the print dialog still opens inside the click itself.
    if (isIOS && fileName) void copyName();
    window.print();
  }, [fileName, isIOS, copyName]);

  return { isIOS, copied, copyName, printNow };
}
