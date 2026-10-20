/**
 * Battery storage carried by a quote's line items — the BESS kWh and the PCS
 * kW a hybrid proposal states, read off the lines it sells. The storage mirror
 * of lib/quoteAc.ts (owner, 2026-10-21: "can you also auto-detect the PCS and
 * BESS capacity?").
 *
 * BESS energy per unit comes from the catalog (`norm_value`, stored in Wh for
 * `batteries` and `portable_power`; see constants/categoryUnits), else from a
 * free-typed line's own text: "255 kWh", "1.2 MWh", or "51.2V 100Ah".
 *
 * PCS power is the battery side's AC conversion. A C&I storage cabinet states
 * it beside its energy — "Powerstack Battery 255 kWh / 125 kW" is a 125 kW PCS
 * in the box — and a separate converter names itself ("PCS 125 kW", "Power
 * Conversion System"). Those are the only two places it is read from. A hybrid
 * inverter is NOT counted here even when it charges the battery: it is already
 * the kW AC, and counting it twice would print a PCS the customer is not buying.
 *
 * As in quoteAc, the free-text readers are deliberately narrow. "kWh" sits on
 * energy meters ("kWh meter 3 phase") and "kW" on cables, switchgear and
 * labour, so a number is only read from a line that calls itself storage.
 */

import type { WpComponent } from './quoteWp';

/** Categories whose `norm_value` IS stored energy, in Wh. */
export const BESS_CATEGORIES = ['batteries', 'portable_power'] as const;

const isBessCategory = (c: string | undefined | null) =>
  !!c && (BESS_CATEGORIES as readonly string[]).includes(c);

const num = (s: string) => parseFloat(s.replace(',', '.'));

/** A line that calls itself stored energy. A meter that counts kWh is not one. */
const SAYS_STORAGE = /batter|bess|storage|powerstack|lifepo|lithium|accu/i;
const IS_METER = /meter/i;

/** A line that names itself a power conversion system. */
const SAYS_PCS = /\bpcs\b|power\s*conversion|bi-?directional\s+(?:inverter|converter)|storage\s+(?:inverter|converter)/i;

/** Energy read off a line's own text, in Wh. 0 when it states none. */
function parseWh(text: string): number {
  const mwh = text.match(/(\d{1,4}(?:[.,]\d+)?)\s*mwh\b/i);
  if (mwh) return num(mwh[1]) * 1_000_000;
  const kwh = text.match(/(\d{1,5}(?:[.,]\d+)?)\s*kwh\b/i);
  if (kwh) return num(kwh[1]) * 1000;
  // "51.2V 100Ah" — a cell or module rated by voltage and charge.
  const v = text.match(/(\d{1,4}(?:[.,]\d+)?)\s*v\b/i);
  const ah = text.match(/(\d{1,5}(?:[.,]\d+)?)\s*ah\b/i);
  return v && ah ? num(v[1]) * num(ah[1]) : 0;
}

/** Power read off a line's own text, in W — "kW" only, never "kWh" or "kWp". */
function parseKw(text: string): number {
  const mw = text.match(/(\d{1,4}(?:[.,]\d+)?)\s*mw\b/i);
  if (mw) return num(mw[1]) * 1_000_000;
  const kw = text.match(/(\d{1,5}(?:[.,]\d+)?)\s*kw\b/i);
  return kw ? num(kw[1]) * 1000 : 0;
}

/** Stored energy per unit of one line, in Wh — 0 when the line is not storage. */
export function bessWhPerUnit(components: WpComponent[], componentId: string | null, description: string): number {
  if (componentId) {
    const comp = components.find((c) => c.component_id === componentId);
    if (comp) {
      // The catalog settles WHAT the line is: an inverter or a meter is never
      // storage, whatever its description says.
      if (!isBessCategory(comp.category)) return 0;
      if (Number(comp.norm_value) > 0) return Number(comp.norm_value);
      return parseWh(description);
    }
  }
  // A free-typed inverter "with battery input" is the kW AC, not the storage.
  if (IS_METER.test(description) || /invert/i.test(description) || !SAYS_STORAGE.test(description)) return 0;
  return parseWh(description);
}

/** PCS power per unit of one line, in W — 0 when the line carries no PCS. */
export function pcsWattsPerUnit(components: WpComponent[], componentId: string | null, description: string): number {
  if (SAYS_PCS.test(description)) {
    // A catalog PCS (filed as an inverter, power in W) answers from the
    // catalog: "DEYE PCS SUN-100K-PCS01HP3" never writes "100 kW".
    const comp = componentId ? components.find((c) => c.component_id === componentId) : undefined;
    if (comp && !isBessCategory(comp.category) && Number(comp.norm_value) > 0) return Number(comp.norm_value);
    return parseKw(description);
  }
  // A storage cabinet that states both its energy and its power has the PCS
  // inside it. Energy alone ("LiFePO4 5.12 kWh") states no PCS.
  if (bessWhPerUnit(components, componentId, description) > 0) return parseKw(description);
  return 0;
}

/** kWh BESS and kW PCS over a quote's top-level lines, 2 dp; 0 when nothing to go on. */
export function storageSize(
  components: WpComponent[],
  items: { component_id: string | null; description: string; quantity: number }[],
): { kwh_bess: number; kw_pcs: number } {
  let wh = 0, w = 0;
  for (const it of items) {
    wh += it.quantity * bessWhPerUnit(components, it.component_id, it.description);
    w += it.quantity * pcsWattsPerUnit(components, it.component_id, it.description);
  }
  const round2 = (v: number) => Math.round(v / 10) / 100;   // Wh → kWh, W → kW
  return { kwh_bess: wh > 0 ? round2(wh) : 0, kw_pcs: w > 0 ? round2(w) : 0 };
}
