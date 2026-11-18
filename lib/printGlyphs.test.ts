/**
 * The EPC proposal PDF is made on a server with NO system fonts
 * (app/api/proposals/[id]/pdf → lib/pdfRender). A character outside IBM Plex
 * and the page's two symbol fallbacks prints there as an EMPTY BOX — the "↳"
 * before every component line did, on the owner's first iPhone download
 * (2026-11-18), while the desktop quietly borrowed it from a system font.
 *
 * So every non-ASCII character the print page itself writes must be one of
 * these. Add one only after checking it prints with the server's fonts
 * (FONTCONFIG_FILE=/tmp/fonts/fonts.conf after @sparticuz/chromium unpacks).
 * Anything else: draw it (see SubArrow) or spell it out. Text people TYPE into
 * a proposal is covered by the Noto fallbacks, not by this list.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const OK: Record<string, string> = {
  '—': 'IBM Plex (General Punctuation)',
  '…': 'IBM Plex (General Punctuation)',
  '·': 'IBM Plex (Latin-1)',
  '÷': 'IBM Plex (Latin-1)',
  '−': 'IBM Plex (minus sign)',
  '✓': 'Noto Sans Math (fallback, checked 2026-11-18)',
  '→': 'screen-only link (.no-print), never in the PDF',
};

test('the EPC print page writes only characters the PDF server can draw', () => {
  let src = readFileSync('app/proposals/[id]/print/page.tsx', 'utf8');
  src = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '').replace(/([^:])\/\/.*$/gm, '$1');
  const bad = [...new Set([...src].filter((c) => c.charCodeAt(0) > 127 && !(c in OK)))];
  assert.deepEqual(bad, [], `draw these or spell them out: ${bad.map((c) => `${c} U+${c.codePointAt(0)!.toString(16).toUpperCase()}`).join(', ')}`);
});
