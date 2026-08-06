/**
 * specSchema — the contract between `3.0_components.specifications` and the
 * System Designer calculators (Module 28).
 *
 * Specs arrive from many sources (datasheet extraction, seed files, hand
 * entry) under many spellings. Everything is normalised ONCE, at write time,
 * into the canonical key vocabulary below — readers (SpecRenderer, the
 * sizing engines) never see aliases. `specReadiness` is the single judge of
 * whether an item carries enough data for its category's calculator: an item
 * that fails simply never appears as a design candidate, so the calculator
 * cannot size a system from missing numbers.
 *
 * `model`, `brand` and prices are COLUMN data, never specs — they are
 * stripped on normalisation. This also keeps the spec blob safe to print on
 * a customer-facing annex, where brand/supplier model must not appear.
 */

import type { ProductCategory } from '../constants/enums';

export type Specs = Record<string, unknown>;

/** Column data that must never live inside the specifications blob. */
export const NON_SPEC_KEYS = ['model', 'brand', 'selling_price_idr'] as const;

// ─── Alias normalisation ────────────────────────────────────────────────────

export interface AliasRule {
  to: string;
  /** Multiply numeric values on rename (e.g. kW → W). Non-numeric values rename unscaled. */
  scale?: number;
}

/** Aliases that apply to every category. */
const GLOBAL_ALIASES: Record<string, AliasRule> = {
  peak_power_wp: { to: 'power_stc_w' },
  efficiency_pct: { to: 'efficiency_percent' },
  phases: { to: 'phase' },
};

/**
 * Category-specific aliases — the same source key can mean different
 * canonical keys per category (`rated_power_kw` is W-canonical on hybrids
 * but kW-canonical on grid-tie units; `battery_voltage_v` is the system
 * voltage on a charge controller but the battery bus on an inverter).
 */
const CATEGORY_ALIASES: Partial<Record<ProductCategory, Record<string, AliasRule>>> = {
  inverter_charger: {
    rated_power_kw: { to: 'rated_output_power_w', scale: 1000 },
    battery_voltage_v: { to: 'battery_nominal_voltage_vdc' },
  },
  power_inverter: {
    rated_power_kw: { to: 'rated_output_power_w', scale: 1000 },
    battery_voltage_v: { to: 'battery_nominal_voltage_vdc' },
  },
  on_grid_inverter: {
    rated_power_kw: { to: 'rated_output_power_kw' },
    pv_max_open_circuit_voltage_vdc: { to: 'pv_max_voltage_vdc' },
    no_of_mpp_trackers: { to: 'no_of_mppts' },
  },
  solar_charge_controller: {
    type: { to: 'controller_type' },
    rated_current_a: { to: 'rated_charge_current_a' },
    max_pv_voc_v: { to: 'pv_max_voc_v' },
    battery_voltage_v: { to: 'system_voltage_v' },
  },
};

/** Parse a numeric spec value ("13.82", 13.82, "1,500") → number, else null. */
export function specNumber(value: unknown): number | null {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value === 'string') {
    const s = value.trim().replace(/,/g, '');
    if (s === '' || !/^-?\d+(\.\d+)?$/.test(s)) return null;
    return parseFloat(s);
  }
  return null;
}

/**
 * Normalise a raw spec object for one component:
 * renames aliases (category-aware), coerces pure-numeric strings to numbers,
 * drops empty values and non-spec keys, and derives what is cheaply
 * derivable (battery energy_wh from V × Ah). Canonical keys already present
 * always win over an alias of the same key.
 */
export function normalizeSpecs(category: string | null | undefined, raw: Specs): Specs {
  const aliases: Record<string, AliasRule> = {
    ...GLOBAL_ALIASES,
    ...(category ? CATEGORY_ALIASES[category as ProductCategory] : undefined),
  };
  const out: Specs = {};
  const fromAlias = new Set<string>();

  for (const [key, value] of Object.entries(raw)) {
    if ((NON_SPEC_KEYS as readonly string[]).includes(key)) continue;
    if (value === null || value === undefined) continue;
    if (typeof value === 'string' && value.trim() === '') continue;

    const rule = aliases[key];
    const target = rule ? rule.to : key;
    let v: unknown = typeof value === 'string' ? value.trim() : value;
    const asNum = specNumber(v);
    if (asNum !== null) v = rule?.scale ? asNum * rule.scale : asNum;

    if (rule) {
      // an explicit canonical key beats its alias, whatever the object order
      if (target in out && !fromAlias.has(target)) continue;
      out[target] = v;
      fromAlias.add(target);
    } else {
      out[target] = v;
      fromAlias.delete(target);
    }
  }

  if (category === 'batteries' && specNumber(out.energy_wh) === null) {
    const v = specNumber(out.nominal_voltage_v);
    const ah = specNumber(out.rated_capacity_ah);
    if (v !== null && ah !== null) out.energy_wh = v * ah;
  }

  return out;
}

// ─── Calculator contracts ───────────────────────────────────────────────────

/**
 * Keys a category's calculator cannot run without. Categories absent here
 * have no calculator contract yet — readiness is "not applicable", never
 * "failed". Mounting parts are ready once they declare their BOM role (plus
 * the role's own discriminator, checked by BOM_ROLE_PARAMS).
 */
export const CATEGORY_SPEC_REQUIREMENTS: Partial<Record<ProductCategory, string[]>> = {
  pv_module: ['power_stc_w', 'voc_stc_v', 'dimensions_l_w_h_mm'],
  inverter_charger: ['rated_output_power_w', 'battery_nominal_voltage_vdc', 'pv_max_open_circuit_voltage_vdc'],
  on_grid_inverter: ['rated_output_power_kw', 'pv_max_voltage_vdc', 'nominal_ac_voltage_vac'],
  batteries: ['nominal_voltage_v', 'energy_wh', 'battery_type'],
  solar_charge_controller: ['controller_type', 'rated_charge_current_a', 'pv_max_voc_v', 'system_voltage_v'],
  mounting: ['bom_role'],
  accessories: ['bom_role'],
  // Cables live in their own category but serve a BoM role like any other part
  pv_cable: ['bom_role'],
};

/**
 * The generic line items the mounting/BoM engines emit, resolved to real
 * catalog items by matching `specifications.bom_role` (+ the discriminating
 * parameter where one exists — a 35mm mid clamp is not a 30mm one).
 */
export const BOM_ROLES = [
  'rail',            // param: rail_length_mm
  'rail_joint',
  'mid_clamp',       // param: clamp_thickness_mm
  'end_clamp',       // param: clamp_thickness_mm
  'roof_hook',       // param: roof_type ('metal' | 'tile' | 'concrete')
  'grounding_clip',
  'grounding_lug',
  'solar_cable',     // param: cable_cross_section_mm2
  'mc4_pair',
  'combiner_box',
  'dc_breaker',
  'ac_distribution', // param: phase
] as const;
export type BomRole = typeof BOM_ROLES[number];

/** Per-role discriminating spec key that must accompany bom_role. */
export const BOM_ROLE_PARAMS: Partial<Record<BomRole, string>> = {
  rail: 'rail_length_mm',
  mid_clamp: 'clamp_thickness_mm',
  end_clamp: 'clamp_thickness_mm',
  roof_hook: 'roof_type',
  solar_cable: 'cable_cross_section_mm2',
  ac_distribution: 'phase',
};

export interface SpecReadiness {
  /** false = this category has no calculator contract (nothing to be ready FOR). */
  relevant: boolean;
  ready: boolean;
  missing: string[];
}

/** Judge whether one item's specs satisfy its category's calculator contract. */
export function specReadiness(category: string | null | undefined, specs: Specs | null | undefined): SpecReadiness {
  const required = category ? CATEGORY_SPEC_REQUIREMENTS[category as ProductCategory] : undefined;
  if (!required) return { relevant: false, ready: false, missing: [] };
  const s = specs ?? {};
  const missing = required.filter((k) => {
    const v = s[k];
    return v === null || v === undefined || (typeof v === 'string' && v.trim() === '');
  });
  if (missing.length === 0 && typeof s.bom_role === 'string') {
    const param = BOM_ROLE_PARAMS[s.bom_role as BomRole];
    if (param && (s[param] === null || s[param] === undefined || s[param] === '')) missing.push(param);
  }
  return { relevant: true, ready: missing.length === 0, missing };
}
