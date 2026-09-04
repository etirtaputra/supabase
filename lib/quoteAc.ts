/**
 * Inverter AC power carried by a quote's line items — the AC mirror of
 * lib/quoteWp.ts, so "kW AC" is derived from the same place the customer's
 * bill of quantities is: the inverters actually on the quote.
 *
 * Power per inverter comes from the catalog (`norm_value`, always stored in
 * the base unit — W — for every inverter category; see constants/categoryUnits),
 * else is parsed from the description of a free-typed line.
 *
 * The description fallback is deliberately narrow. A number followed by "kW"
 * appears on cables, switchgear and service lines too, so it is only read from
 * a line that calls itself an inverter. `\b` after the unit is what keeps
 * "550 Wp" (a module) and "5 kWh" (a battery) out: neither ends there.
 */

import type { WpComponent } from './quoteWp';

/**
 * Categories whose `norm_value` IS inverter AC output.
 *
 * A hybrid quote may carry an inverter-charger instead of an on-grid inverter,
 * and both convert DC to AC for the same load — so both count toward the kW AC
 * the proposal states. Charge controllers (A) and PV modules (Wp) are measured
 * in other units and never count.
 */
export const AC_INVERTER_CATEGORIES = [
  'on_grid_inverter',
  'power_inverter',
  'inverter_charger',
  'solar_pump_inverter',
] as const;

const isInverterCategory = (c: string | undefined | null) =>
  !!c && (AC_INVERTER_CATEGORIES as readonly string[]).includes(c);

/** A power rating read off a line's own text, in watts. 0 when it states none. */
function parseAcWatts(text: string): number {
  const kw = text.match(/(\d{1,4}(?:[.,]\d+)?)\s*kw\b/i);
  if (kw) return parseFloat(kw[1].replace(',', '.')) * 1000;
  const w = text.match(/(\d{3,6}(?:[.,]\d+)?)\s*w\b/i);
  return w ? parseFloat(w[1].replace(',', '.')) : 0;
}

/** AC watts per unit of one line — 0 when the line is not an inverter. */
export function acWattsPerUnit(
  components: WpComponent[],
  componentId: string | null,
  description: string,
): number {
  if (componentId) {
    const comp = components.find((c) => c.component_id === componentId);
    if (comp) {
      // The catalog settles WHAT the line is: a module or a battery is never
      // AC power, whatever its description says.
      if (!isInverterCategory(comp.category)) return 0;
      if (Number(comp.norm_value) > 0) return Number(comp.norm_value);
      // A known inverter whose Capacity was never filled in (most on-grid
      // inverters on file, 2026-09) — read the rating off its own text. The
      // category has already established this is an inverter, so the "must say
      // inverter" guard below would only lose the number, not protect anything.
      return parseAcWatts(description);
    }
  }
  // Free-typed line: "100 kW" appears on cables, switchgear and service lines
  // too, so it counts only where the line calls itself an inverter.
  return /invert/i.test(description) ? parseAcWatts(description) : 0;
}

/** Total AC watts contributed by one quote line (top-level lines only). */
export function lineAcWatts(
  components: WpComponent[],
  item: { component_id: string | null; description: string; quantity: number },
): number {
  return item.quantity * acWattsPerUnit(components, item.component_id, item.description);
}
