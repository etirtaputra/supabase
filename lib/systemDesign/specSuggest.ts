/**
 * Spec suggestions — filling the calculator contract without retyping a
 * catalog.
 *
 * Two sources, in order of authority:
 *  1. The calculator's OWN database (v7Fixture) when the model matches. Those
 *     numbers are the ones the standalone app has always sized from, so they
 *     are quoted verbatim rather than guessed.
 *  2. The item's own name. ICA's inverters are catalogued as "EPEVER ELS3K-E
 *     3kW/48V" and "DEYE SUN-5K-SG05LP1" — the rating and the battery bus are
 *     right there in the text.
 *
 * Everything returned is a SUGGESTION. The workbench shows it, marks where it
 * came from, and a human accepts or corrects it before anything is written —
 * a spec nobody checked is worse than a spec that is missing, because the
 * calculator would then size from it with confidence.
 */
import { specNumber, type Specs } from '../specSchema.ts';
import { V7_PANELS, V7_ON_GRID_INVERTERS, V7_HYBRID_INVERTERS, V7_BATTERIES } from './v7Fixture.ts';

export type SuggestionSource = 'calculator' | 'name';

export interface Suggestion {
  value: string | number;
  source: SuggestionSource;
  /** Why we think so — shown on hover, so a wrong guess is arguable. */
  why: string;
}

export type Suggestions = Record<string, Suggestion>;

/** Model tokens compare ignoring case, spaces, underscores and hyphens. */
const norm = (s: string) => s.toUpperCase().replace(/[\s_-]/g, '');

/** Does this catalog text name that calculator model? */
const namesModel = (text: string, model: string) => norm(text).includes(norm(model));

// ── 1. The calculator's own database ────────────────────────────────────────
const V7_KEYS = ['power_stc_w', 'voc_stc_v', 'dimensions_l_w_h_mm', 'rated_output_power_kw',
  'nominal_ac_voltage_vac', 'pv_max_voltage_vdc', 'no_of_mppts', 'strings_per_mppt',
  'rated_output_power_w', 'battery_nominal_voltage_vdc', 'surge_power_va',
  'pv_max_open_circuit_voltage_vdc', 'no_of_mpp_trackers', 'battery_type',
  'nominal_voltage_v', 'energy_wh', 'rated_capacity_ah'] as const;

function fromCalculator(category: string, text: string): Suggestions {
  const pool: Record<string, unknown>[] =
    category === 'pv_module' ? (V7_PANELS as unknown as Record<string, unknown>[])
    : category === 'on_grid_inverter' ? (V7_ON_GRID_INVERTERS as unknown as Record<string, unknown>[])
    : category === 'inverter_charger' ? (V7_HYBRID_INVERTERS as unknown as Record<string, unknown>[])
    : category === 'batteries' ? (V7_BATTERIES as unknown as Record<string, unknown>[])
    : [];
  const hit = pool.find((m) => namesModel(text, String(m.model ?? '')));
  if (!hit) return {};
  const out: Suggestions = {};
  for (const k of V7_KEYS) {
    const v = hit[k];
    if (v === undefined || v === null || v === '') continue;
    out[k] = { value: v as string | number, source: 'calculator', why: `${hit.model} in the ICA calculator database` };
  }
  return out;
}

// ── 2. The item's own name ──────────────────────────────────────────────────
/** "3kW", "15kW", "5K", "1500W" → watts. */
function ratedWattsFrom(text: string): { w: number; why: string } | null {
  const kw = text.match(/(\d+(?:[.,]\d+)?)\s*kW\b/i);
  if (kw) { const n = parseFloat(kw[1].replace(',', '.')); if (n > 0) return { w: n * 1000, why: `"${kw[0]}" in the name` }; }
  // DEYE/VOLTRONIC shorthand: SUN-5K-…, VM 1K-24
  const k = text.match(/[-\s](\d+(?:[.,]\d+)?)K\b/i);
  if (k) { const n = parseFloat(k[1].replace(',', '.')); if (n > 0 && n < 500) return { w: n * 1000, why: `"${k[0].trim()}" reads as kilowatts` }; }
  const w = text.match(/(\d{3,6})\s*W\b/i);
  if (w) { const n = parseInt(w[1], 10); if (n > 0) return { w: n, why: `"${w[0]}" in the name` }; }
  return null;
}

/** "3kW/48V", "VM 1K-24", "ELS15K 15kW/48V" → the battery bus. */
function batteryBusFrom(text: string): { v: number; why: string } | null {
  // Only real bus voltages count — "220/380V" on a PCS is AC, not a battery.
  const slash = text.match(/\/\s*(12|24|48|96|192|384)\s*V\b/i);
  if (slash) return { v: parseInt(slash[1], 10), why: `"${slash[0].trim()}" — the bus after the rating` };
  const bare = text.match(/\b(12|24|48|96|192|384)\s*V\b/i);
  if (bare) return { v: parseInt(bare[1], 10), why: `"${bare[0]}" in the name` };
  const dash = text.match(/\b\d+K-(12|24|48)\b/i);
  if (dash) return { v: parseInt(dash[1], 10), why: `"${dash[0]}" — kW then bus volts` };
  return null;
}

const isThreePhase = (text: string) => /three[-\s]?phase|3[-\s]?phase|3L\+N|\b3P\b|\bTT\b|\bDT\b/i.test(text);

/**
 * LiFePO4 packs are named by cell math (12.8 / 25.6 / 51.2 V) but the
 * calculator sizes by BUS CLASS — an inverter's 48 V bus takes the 51.2 V
 * pack as one series unit. Energy stays honest: it is derived from the
 * voltage the name actually states, before this mapping.
 */
const BUS_CLASS: Record<string, number> = { '12.8': 12, '25.6': 24, '51.2': 48 };
const BARE_VOLTAGES = new Set([2, 6, 12, 24, 48, 12.8, 25.6, 51.2]);

function fromName(category: string, text: string): Suggestions {
  const out: Suggestions = {};
  const put = (k: string, value: string | number, why: string) => { out[k] = { value, source: 'name', why }; };

  if (category === 'inverter_charger') {
    const w = ratedWattsFrom(text);
    if (w) put('rated_output_power_w', w.w, w.why);
    const v = batteryBusFrom(text);
    if (v) put('battery_nominal_voltage_vdc', v.v, v.why);
  }

  if (category === 'on_grid_inverter') {
    const w = ratedWattsFrom(text);
    if (w) put('rated_output_power_kw', Math.round((w.w / 1000) * 100) / 100, w.why);
    // Phase: read it from the name when stated; otherwise only the sizes that
    // settle it themselves get a default — small units are single-phase,
    // 20 kW+ units are only made three-phase. 8–20 kW unmarked stays open.
    if (isThreePhase(text)) put('nominal_ac_voltage_vac', '400 3L+N', 'the name says three-phase');
    else if (w && w.w >= 20000) put('nominal_ac_voltage_vac', '400 3L+N', `${w.w / 1000} kW grid-tie units are only made three-phase`);
    else if (!w || w.w <= 8000) put('nominal_ac_voltage_vac', '230 L-N', 'single-phase unless the name says otherwise');
  }

  if (category === 'batteries') {
    // The written voltage, before any bus-class mapping — energy math uses this.
    let rawV: number | null = null;
    let rawVWhy = '';
    // "51.2V/314Ah", "409.6V100Ah", "48V 74Ah" — a voltage glued to a capacity
    // is trusted at any value; the pair only reads one way.
    const pair = text.match(/(?<![\d.])(\d{1,3}(?:[.,]\d{1,2})?)\s*V\s*\/?\s*(\d{1,4}(?:[.,]\d{1,2})?)\s*Ah\b/i);
    if (pair) {
      rawV = parseFloat(pair[1].replace(',', '.'));
      rawVWhy = `"${pair[0].trim()}" in the name`;
      put('rated_capacity_ah', parseFloat(pair[2].replace(',', '.')), rawVWhy);
    } else {
      const v = text.match(/(?<![\d.])(\d{1,3}(?:\.\d{1,2})?)\s*V\b/i);
      const n = v ? parseFloat(v[1]) : null;
      if (v && n !== null && BARE_VOLTAGES.has(n)) { rawV = n; rawVWhy = `"${v[0].trim()}" in the name`; }
      const ah = text.match(/(?<![\d.])(\d{1,4}(?:[.,]\d{1,2})?)\s*Ah\b/i);
      if (ah) put('rated_capacity_ah', parseFloat(ah[1].replace(',', '.')), `"${ah[0].trim()}" in the name`);
    }
    if (rawV !== null) {
      const cls = BUS_CLASS[String(rawV)];
      if (cls) put('nominal_voltage_v', cls, `${rawV} V LiFePO4 is the ${cls} V bus class — the calculator sizes by bus`);
      else put('nominal_voltage_v', rawV, rawVWhy);
    }
    if (/lifepo4|lfp|lithium/i.test(text) || (rawV !== null && BUS_CLASS[String(rawV)]))
      put('battery_type', 'LiFePO4', /lifepo4|lfp|lithium/i.test(text) ? 'the name says lithium' : 'a cell-math voltage means LiFePO4');
    else if (/lead|vrla|agm|\bgel\b|deep\s*cycle/i.test(text)) put('battery_type', 'Lead-Acid', 'the name says lead-acid');
    // Energy: an explicit kWh in the name beats V × Ah; either way the true
    // written voltage is used, never the bus class.
    const kwh = text.match(/(?<![\d.])(\d+(?:[.,]\d+)?)\s*kWh/i);
    const aa = out.rated_capacity_ah ? Number(out.rated_capacity_ah.value) : null;
    if (kwh) put('energy_wh', Math.round(parseFloat(kwh[1].replace(',', '.')) * 1000), `"${kwh[0].trim()}" in the name`);
    else if (rawV && aa) put('energy_wh', Math.round(rawV * aa * 100) / 100, `${rawV} V × ${aa} Ah`);
  }

  if (category === 'pv_module') {
    const wp = text.match(/(\d{2,4})\s*Wp?\b/i);
    if (wp) put('power_stc_w', parseInt(wp[1], 10), `"${wp[0]}" in the name`);
    const dims = text.match(/(\d{3,4})\s*[x×]\s*(\d{3,4})\s*[x×]\s*(\d{1,3})/i);
    if (dims) put('dimensions_l_w_h_mm', `${dims[1]} x ${dims[2]} x ${dims[3]}`, `"${dims[0]}" in the name`);
  }

  return out;
}

/**
 * Everything we can offer for one item. The calculator database wins over the
 * name, and neither ever overwrites a spec already on the item.
 */
export function suggestSpecs(category: string | null | undefined, text: string, existing: Specs | null | undefined): Suggestions {
  if (!category) return {};
  const merged = { ...fromName(category, text), ...fromCalculator(category, text) };
  const specs = existing ?? {};
  for (const key of Object.keys(merged)) {
    const held = specs[key];
    const hasValue = held !== undefined && held !== null && String(held).trim() !== '';
    if (hasValue) delete merged[key];
  }
  return merged;
}

/** Suggestions that are numbers, coerced — the workbench writes these as numbers. */
export const suggestionValue = (s: Suggestion): string | number => {
  const n = specNumber(s.value);
  return n !== null ? n : s.value;
};
