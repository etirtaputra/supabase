/**
 * Every printed document sets its type from one place (lib/documentType.ts).
 * Four print pages each used to carry their own copy of the font stack.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { DOC_FONT_FAMILY, DOC_LINE_HEIGHT } from './documentType.ts';

const PRINT_PAGES = [
  'app/sales/[id]/print/page.tsx',
  'app/sales/[id]/do/page.tsx',
  'app/proposals/[id]/print/page.tsx',
  'app/support-letters/[id]/print/page.tsx',
];

test('documents are set in IBM Plex Sans, with Rubik as the fallback', () => {
  assert.match(DOC_FONT_FAMILY, /^'IBM Plex Sans', Rubik,/);
  // Rubik's measured "normal" line height — pinned so the switch moves no line.
  assert.equal(DOC_LINE_HEIGHT, 1.19);
});

test('every print page takes its typeface from the one home', () => {
  for (const f of PRINT_PAGES) {
    const src = readFileSync(f, 'utf8');
    assert.match(src, /body \{ font-family: \$\{DOC_FONT_FAMILY\};/, `${f} sets its own body font`);
    assert.ok(!/font-family:\s*Rubik/.test(src), `${f} still names Rubik directly`);
  }
});
