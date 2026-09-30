/**
 * "Brand + model" without saying the brand twice.
 *
 * Owner, 2026-09-30, on a printed support letter: the Tipe column read
 * "ICA SOLAR ICA SOLAR ICA550-72HMI…" and "EPEVER EPEVER XTRA3210N-G3…".
 * The letter builds the type as `brand + supplier_model`, and many supplier
 * models already begin with the brand — so it doubled. One home for the rule,
 * used where the text is BUILT (the letter form) and where it is SHOWN (the
 * print page), so letters saved before the fix print clean too, without
 * rewriting what was stored.
 */

const norm = (s: string) => s.trim().replace(/\s+/g, ' ').toLowerCase();

/** "EPEVER" + "EPEVER XTRA3210N" → "EPEVER XTRA3210N"; "EPEVER" + "XTRA3210N" → "EPEVER XTRA3210N". */
export function brandedModel(brand: string | null | undefined, model: string | null | undefined): string {
  const b = (brand ?? '').trim();
  const m = (model ?? '').trim();
  if (!b) return m;
  if (!m) return b;
  const nm = norm(m);
  const nb = norm(b);
  if (nm === nb || nm.startsWith(nb + ' ')) return m;
  return `${b} ${m}`;
}

/**
 * A phrase said twice at the start — "ICA SOLAR ICA SOLAR ICA550" →
 * "ICA SOLAR ICA550". Up to four words, case-insensitive. Only the LEADING
 * repeat is removed; anything later in the text is left as typed.
 */
export function collapseRepeatedLead(text: string | null | undefined): string {
  const s = (text ?? '').trim();
  const words = s.split(/\s+/);
  for (let n = 4; n >= 1; n--) {
    if (words.length < 2 * n) continue;
    const a = words.slice(0, n).join(' ').toLowerCase();
    const b = words.slice(n, 2 * n).join(' ').toLowerCase();
    if (a === b) return words.slice(n).join(' ');
  }
  return s;
}
