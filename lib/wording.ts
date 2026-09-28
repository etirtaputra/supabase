/**
 * The house rules for what a screen CALLS things — page names and button
 * words — as data the tests read (owner, 2026-09-28: "make page titles and
 * button wording consistent across screens").
 *
 * Two rules, one home each:
 *
 *   1. A page is called by its MENU NAME, everywhere: the menu, the phone
 *      header, the browser tab. The name lives once, in DESTINATIONS
 *      (constants/navigation.ts); `pageLabelFor` finds it for any path and
 *      `usePageTitle` puts it on the tab.
 *   2. A button's words go through the phrase book (lib/i18n.ts), so an
 *      Indonesian screen never shows an English button — and the same action
 *      is the same word on every screen (ACTION_WORDS below).
 *
 * Also home to the small JSX scanner the source-scanning test uses to find
 * button text, kept here (not in the test) so it can be tested itself.
 */

/**
 * One word per action, in both languages. A button that saves says "Save" /
 * "Simpan" on every screen — not "Save changes" here and "✓ Save" there. The
 * English keys are sentence case ("Record payment", never "Record Payment"):
 * a button is an instruction, not a title.
 *
 * The Indonesian side is asserted against the phrase book, so the two can
 * never drift: change a word here and the test says which translation to fix.
 */
export const ACTION_WORDS: Record<string, string> = {
  Save: 'Simpan',
  Cancel: 'Batal',
  Delete: 'Hapus',
  Remove: 'Hapus',
  Add: 'Tambah',
  Edit: 'Ubah',
  Back: 'Kembali',
  Close: 'Tutup',
  // Empties a field, a filter or a list — NOT a delete. It said "Hapus" until
  // 2026-09-28, the same word as Delete, which is exactly the confusion to
  // avoid on a button next to real data.
  Clear: 'Kosongkan',
  Discard: 'Buang perubahan',
  Done: 'Selesai',
  Print: 'Cetak',
  Refresh: 'Muat ulang',
  Duplicate: 'Duplikat',
  Revert: 'Kembalikan',
};

/**
 * Button text that is not a phrase — symbols, codes and units read the same in
 * both languages and need no entry. (Anything else that stays English belongs
 * in KEEPERS, lib/i18n.ts.)
 */
export const BUTTON_TEXT_EXEMPT = new Set<string>(['CSV', 'PDF', 'Excel', 'USD', 'IDR', 'CNY', 'JSON', 'OK', 'Rp', 'SQL', 'TUC', 'ID', 'EN', 'ICAPROC', 'sku', 'CRM']);

/** The end of a JSX opening tag starting at `i` (index of its `>`), braces and quotes respected. */
function tagEnd(src: string, i: number): number {
  let depth = 0; let q: string | null = null;
  for (let k = i; k < src.length; k++) {
    const c = src[k];
    if (q) { if (c === '\\') { k++; continue; } if (c === q) q = null; continue; }
    if (c === '"' || c === "'" || c === '`') { q = c; continue; }
    if (c === '{') depth++;
    else if (c === '}') depth--;
    else if (c === '>' && depth === 0) return k;
  }
  return -1;
}

/**
 * Every <button>'s CHILDREN, with nested tags' attributes stripped (a
 * className is not something the reader sees). Crude by design — it is a
 * guard, not a compiler — but it respects braces and quotes, so an arrow
 * function inside an onClick does not end the tag early.
 */
export function buttonBodies(raw: string): { body: string; line: number }[] {
  // Block comments go first (kept the same length, so line numbers hold): a
  // doc comment that mentions `<button>` is prose, not a button.
  const src = raw.replace(/\/\*[\s\S]*?\*\//g, (c) => c.replace(/[^\n]/g, ' '));
  const out: { body: string; line: number }[] = [];
  const re = /<button\b/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(src))) {
    const open = tagEnd(src, m.index + 7);
    if (open < 0) continue;
    if (src[open - 1] === '/') continue;                    // <button … />
    const close = src.indexOf('</button>', open);
    if (close < 0) continue;
    let body = src.slice(open + 1, close);
    // Nested tags: keep their children, drop their attributes.
    let out2 = ''; let k = 0;
    while (k < body.length) {
      if (body[k] === '<' && /[A-Za-z/]/.test(body[k + 1] ?? '')) {
        const e = tagEnd(body, k + 1);
        if (e < 0) break;
        const tag = body.slice(k, e + 1);
        // An <svg>…</svg> draws, it does not say anything.
        if (/^<svg\b/.test(tag)) { const endSvg = body.indexOf('</svg>', e); k = endSvg < 0 ? body.length : endSvg + 6; continue; }
        k = e + 1; out2 += ' '; continue;
      }
      out2 += body[k]; k++;
    }
    body = out2.replace(/\{\/\*[\s\S]*?\*\/\}/g, ' ');
    out.push({ body, line: src.slice(0, m.index).split('\n').length });
  }
  return out;
}

/**
 * The words in a button body that a reader would see UNTRANSLATED: bare JSX
 * text, and string literals inside `{…}` that are not the argument of t()/tf().
 * Returns them trimmed; symbols-only and exempt codes are skipped.
 */
export function untranslatedWords(body: string, keepers: readonly string[] = []): string[] {
  const found: string[] = [];
  const keep = (s: string) => {
    const x = s.replace(/&[a-z]+;/g, ' ').replace(/\s+/g, ' ').trim();
    if (!/[A-Za-z]{2}/.test(x)) return;                     // ×, ▾, "…", numbers
    // Every word a code or a keeper ("PI+PO", "PDF · CSV")? Then nothing to translate.
    const words = x.split(/[^A-Za-z]+/).filter(Boolean);
    if (words.every((w) => BUTTON_TEXT_EXEMPT.has(w) || keepers.includes(w))) return;
    found.push(x);
  };
  // Split into JSX text and {expressions}, braces respected.
  let depth = 0; let q: string | null = null; let text = ''; let expr = '';
  for (let k = 0; k < body.length; k++) {
    const c = body[k];
    if (depth === 0) {
      if (c === '{') { keep(text); text = ''; depth = 1; expr = ''; continue; }
      text += c; continue;
    }
    if (q) { expr += c; if (c === '\\') { expr += body[++k] ?? ''; continue; } if (c === q) q = null; continue; }
    if (c === '"' || c === "'" || c === '`') { q = c; expr += c; continue; }
    if (c === '{') depth++;
    if (c === '}') { depth--; if (depth === 0) { scanExpr(expr, keep); continue; } }
    expr += c;
  }
  keep(text);
  return found;
}

function scanExpr(expr: string, keep: (s: string) => void) {
  // String literals not directly handed to t( / tf( — and not a property
  // access like obj['key'], nor a comparison operand (x === 'draft').
  const re = /(['"])((?:\\.|(?!\1)[^\\])*)\1|`((?:\\.|[^`\\])*)`/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(expr))) {
    const before = expr.slice(0, m.index).trimEnd();
    if (/\b(t|tf)\($/.test(before)) continue;
    // An argument to some other call — a locale, a format, a separator — is
    // not text the reader sees on its own.
    if (/[(,]$/.test(before)) continue;
    if (/(===|!==|==|!=|\[|\bin|\bcase)$/.test(before)) continue;
    const after = expr.slice(m.index + m[0].length).trimStart();
    if (/^(===|!==|==|!=|\]|:(?!\s*['"`]))/.test(after) && !/\?$/.test(before)) continue;
    if (m[3] !== undefined) {
      // A template: only its literal parts are words.
      keep(m[3].replace(/\$\{[^}]*\}/g, ' '));
    } else keep(m[2]);
  }
}
