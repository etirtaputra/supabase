/**
 * Catalogue specifications (3.0_components.specifications) → the calculator's
 * module and inverter data. Values arrive as text ("200-1000", "400 3L+N+PE",
 * "200~1500"); a value that is not there stays null and the check that needs
 * it says so — nothing is guessed.
 */
import type { InverterSpec, ModuleSpec } from './dc.ts';

type Specs = Record<string, unknown> | null | undefined;

/** First number in a value ("400 3L+N+PE" → 400, "1,500" → 1500). */
export function specNum(v: unknown): number | null {
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  if (typeof v !== 'string') return null;
  const m = v.replace(/,/g, '').match(/-?\d+(?:\.\d+)?/);
  return m ? Number(m[0]) : null;
}

/** A range "200-1000" / "200~1500" / "200 – 1000 V" → [200, 1000]. */
export function specRange(v: unknown): [number, number] | null {
  if (typeof v !== 'string') return null;
  const nums = v.replace(/,/g, '').match(/\d+(?:\.\d+)?/g);
  return nums && nums.length >= 2 ? [Number(nums[0]), Number(nums[nums.length - 1])] : null;
}

export function moduleFromSpecs(model: string, s: Specs): ModuleSpec {
  const g = (k: string) => specNum(s?.[k]);
  return {
    model,
    wp: g('power_stc_w') ?? 0, vocV: g('voc_stc_v') ?? 0, vmpV: g('vmp_stc_v') ?? 0,
    iscA: g('isc_stc_a') ?? 0, impA: g('imp_stc_a') ?? 0,
    tempCoeffVocPct: g('temp_coeff_voc_percent_per_c'), maxSystemV: g('max_system_voltage_vdc'),
  };
}

export function inverterFromSpecs(model: string, s: Specs): InverterSpec {
  const g = (k: string) => specNum(s?.[k]);
  const mppt = specRange(s?.pv_mppt_voltage_range_vdc);
  return {
    model,
    acKw: g('rated_output_power_kw') ?? 0,
    acVoltageV: g('nominal_ac_voltage_vac'),
    acCurrentA: g('max_output_current_a'),
    maxDcV: g('pv_max_voltage_vdc'),
    mpptMinV: mppt?.[0] ?? null, mpptMaxV: mppt?.[1] ?? null,
    mppts: g('no_of_mppts'), stringsPerMppt: g('strings_per_mppt'),
    maxIscPerMpptA: g('max_short_circuit_current_per_mppt_a') ?? g('max_input_current_per_mppt_a'),
  };
}
