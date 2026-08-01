/**
 * Excel-style "=" cell formulas: "=2520*720" → 1814400.
 * Digits and + - * / ( ) . only; anything else refuses to evaluate — the
 * whitelist is what makes the Function() call safe. Shared by the EPC
 * proposal editor and the sales quote editor so both cells behave the same.
 */
export function evalFormula(raw: string): number | null {
  const expr = raw.replace(/^=/, '').replace(/,/g, '').trim();
  if (!expr || !/^[0-9+\-*/().\s]+$/.test(expr)) return null;
  try {
    const v = Function(`"use strict"; return (${expr});`)();
    return typeof v === 'number' && isFinite(v) ? v : null;
  } catch {
    return null;
  }
}

/** Evaluate a leading-"=" cell on blur: a valid formula becomes its number,
 *  anything else is left exactly as typed. */
export function evalCell(raw: string): string {
  const t = raw.trim();
  if (!t.startsWith('=')) return raw;
  const v = evalFormula(t);
  return v != null ? String(v) : raw;
}
