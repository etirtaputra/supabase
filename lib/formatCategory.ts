/**
 * Human labels for snake_case enums (product categories, etc.) with proper
 * acronym casing: ev_charger → "EV Charger", ups → "UPS", pv_module →
 * "PV Module" — not the naive "Ev Charger" / "Ups".
 */
const ACRONYMS = new Set(['ev', 'ups', 'pv', 'ac', 'dc', 'bess', 'pcs', 'evcs', 'bms', 'hdg']);

export function formatCategory(s: string): string {
  return s
    .replace(/_/g, ' ')
    .split(' ')
    .filter(Boolean)
    .map((w) => ACRONYMS.has(w.toLowerCase())
      ? w.toUpperCase()
      : w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
    .join(' ');
}
