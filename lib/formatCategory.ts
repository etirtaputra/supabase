/**
 * The human name of a product category, for every screen that shows one.
 *
 * There is ONE list of those names — `CATEGORY_LABEL` in
 * `constants/productTaxonomy.ts` — and this reads it. Before that list existed
 * the app gave three different answers for the same category: the Item Editor
 * rendered the raw enum (`pv_module`), the Products and Items lists rendered
 * this function's humanised guess ("PV Module"), and the cost views rendered a
 * separate hand-written map. The owner asked for one name, everywhere
 * (2026-09-05) — so a category that is named in the taxonomy is named by it.
 *
 * The humaniser stays as the FALLBACK, with proper acronym casing, so a
 * category added to the database before it is added to the taxonomy still
 * renders as "EV Charger" and never as "Ev Charger" or a bare snake_case key.
 */

import { CATEGORY_LABEL } from '../constants/productTaxonomy.ts';

const ACRONYMS = new Set(['ev', 'ups', 'pv', 'ac', 'dc', 'bess', 'pcs', 'evcs', 'bms', 'hdg']);

/** Title Case with acronyms respected — used when the taxonomy has no name. */
export function humanizeKey(s: string): string {
  return s
    .replace(/_/g, ' ')
    .split(' ')
    .filter(Boolean)
    .map((w) => ACRONYMS.has(w.toLowerCase())
      ? w.toUpperCase()
      : w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
    .join(' ');
}

export function formatCategory(s: string): string {
  if (!s) return '';
  return CATEGORY_LABEL[s] ?? humanizeKey(s);
}
