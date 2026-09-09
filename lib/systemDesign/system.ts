/**
 * System engine — a pure port of `calculateBOM()` from "Smart Solar BoM v7".
 *
 * Two paths, exactly as v7 has them:
 *  · ON-GRID — the PLN connection caps the inverter; the DC/AC ratio then sets
 *    the array.
 *  · OFF-GRID / HYBRID — the load table sets the inverter (continuous AND
 *    surge, inductive loads counted twice), the inverter's battery voltage and
 *    the autonomy set the bank, and peak sun hours set the array.
 *
 * The structure is NOT re-derived here: v7's mounting block is v11's, so this
 * calls `calculateMounting` and appends the electrical balance-of-system. One
 * set of mounting rules, one set of tests.
 *
 * Everything the engine chooses from is passed IN — the catalog is the
 * caller's business. Items must carry the specs their category's calculator
 * contract requires (`specReadiness`), which is what stops a system being
 * sized from missing numbers.
 */
import { calculateMounting, type MountType, type Orientation } from './mounting.ts';
import type { BomLine } from './types.ts';

/**
 * The engine version stamped on every saved design.
 *
 *  7 — the pure v7 port.
 *  8 — temperature-corrected Voc replaces v7's flat 0.95 string margin.
 *  9 — the six silent defaults are named: demand factor, power loss factor,
 *      inverter headroom, battery string voltage, cable run, PSH provenance.
 *
 * It lives HERE, beside the rules it describes, because it was written out by
 * hand in two places — the API route and the designer screen — and a number
 * copied twice is a number that will disagree with itself. `system.test.ts`
 * fails if either copy comes back.
 */
export const SYSTEM_ENGINE_VERSION = 9;

/** Keep a fraction inside its meaningful range. */
const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

export type SystemType = 'on-grid' | 'off-grid' | 'hybrid';
export type BatteryPreference = 'LiFePO4' | 'Lead-Acid';

/** v7's engine defaults. Settings may override; the values are the app's. */
export interface SystemOptions {
  /** Continuous rating margin over the running load. v7: 1.25. */
  continuousSafetyFactor?: number;
  /** Assumed surge headroom when a datasheet lists none. v7: ×2 continuous. */
  assumedSurgeMultiple?: number;
  /** Depth of discharge by chemistry. v7: lithium 0.8, lead-acid 0.5. */
  dodLithium?: number;
  dodLeadAcid?: number;
  /** Wire-to-load system losses. v7: 0.8. */
  systemEfficiency?: number;
  /**
   * How string length answers cold-morning Voc rise.
   *
   * `'temperature'` (the default since 2026-09-06) corrects the module's own
   * Voc by its own temperature coefficient to the site's coldest expected
   * temperature. `'flat'` is v7's original rule and stays selectable so the
   * parity tests — and any quote saved under engine version 7 — remain
   * reproducible.
   */
  vocRule?: 'temperature' | 'flat';
  /** Cold-temperature Voc headroom on string length, `'flat'` rule. v7: 0.95. */
  vocMarginFactor?: number;
  /**
   * Coldest cell temperature the array is designed for, °C.
   *
   * Voc rises as a module cools, and the worst case is a cold clear dawn where
   * the cell sits at ambient with full irradiance arriving — so this is the
   * site's record MINIMUM, not its average.
   *
   * 18 °C is the Indonesian lowland default (owner, 2026-09-06): it matches
   * record lows around Jakarta and Surabaya, where most installations are.
   * HIGHLAND SITES MUST LOWER IT — Bandung reaches ~14 °C and the Dieng
   * plateau goes below zero. Lower is always the safe direction: it shortens
   * strings.
   *
   * For scale, v7's flat 0.95 was equivalent to designing for 3–9 °C depending
   * on the module, so 18 °C generally makes strings LONGER than they were.
   */
  minCellTempC?: number;
  /** Metres of string cable per panel. v7: 6. */
  cableMetresPerPanel?: number;
  /**
   * Least inverter headroom over the continuous requirement before the engine
   * says something, as a fraction. v9: 0.30.
   *
   * Headroom is not a comfort margin. It is what absorbs surge the load table
   * did not name, thermal derating on a 35 °C afternoon, and the load the site
   * adds next year. A design at 6 % over passes arithmetic and fails in
   * August.
   */
  minInverterHeadroomPct?: number;
  /**
   * Fraction of the inverter's maximum battery voltage above which the string
   * is called close. v9: 0.95.
   */
  batteryVoltageProximityThreshold?: number;
}

export const SYSTEM_DEFAULTS: Required<SystemOptions> = {
  continuousSafetyFactor: 1.25,
  assumedSurgeMultiple: 2,
  dodLithium: 0.8,
  dodLeadAcid: 0.5,
  systemEfficiency: 0.8,
  vocRule: 'temperature',
  vocMarginFactor: 0.95,
  minCellTempC: 18,
  cableMetresPerPanel: 6,
  minInverterHeadroomPct: 0.30,
  batteryVoltageProximityThreshold: 0.95,
};

// ── The specs each candidate must carry ─────────────────────────────────────
export interface PanelSpec {
  component_id?: string | null;
  model: string;
  power_stc_w: number;
  voc_stc_v: number;
  /**
   * %/°C, negative — the datasheet's temperature coefficient of Voc. Declared
   * on every module in the spec schema; absent on some rows, in which case
   * string length falls back to the flat margin AND says so.
   */
  temp_coeff_voc_percent_per_c?: number | null;
  /** "2278 x 1134 x 35" */
  dimensions_l_w_h_mm: string;
}
export interface OnGridInverterSpec {
  component_id?: string | null;
  model: string;
  rated_output_power_kw: number;
  nominal_ac_voltage_vac: string;
  pv_max_voltage_vdc?: number | null;
  no_of_mppts?: number | null;
  strings_per_mppt?: number | null;
}
export interface HybridInverterSpec {
  component_id?: string | null;
  model: string;
  rated_output_power_w: number;
  battery_nominal_voltage_vdc?: number | null;
  /**
   * The battery port's absolute ceiling, V — the top of the datasheet's
   * `battery_voltage_range_vdc` ("500~900" → 900).
   *
   * The NOMINAL bus above is what the bank is designed to; this is what it may
   * not exceed. They are not the same number and the gap is where the error
   * lives: a 48 V bus built from 51.2 V LiFePO4 packs sits 6.67 % over nominal
   * on every string, and 16 of them make 819.2 V against an 800 V port.
   *
   * Optional, and silent when absent — the engine will not invent a ceiling it
   * has not been given. Fill `battery_voltage_range_vdc` in Tech Specs to make
   * the check work (as of 2026-09-09 only 1 of 50 inverter-chargers carries it).
   */
  max_battery_voltage_vdc?: number | null;
  surge_power_va?: number | null;
  pv_max_open_circuit_voltage_vdc?: number | null;
  no_of_mpp_trackers?: number | null;
  phase?: string | null;
}
export interface BatterySpec {
  component_id?: string | null;
  model: string;
  battery_type: string;
  nominal_voltage_v: number;
  energy_wh: number;
  rated_capacity_ah?: number | null;
}

/** One line of the load table (off-grid / hybrid). */
export interface LoadRow {
  name?: string;
  watts: number;
  hoursPerDay: number;
  qty: number;
  /** Motors, pumps, compressors — sized at twice their running watts. */
  inductive?: boolean;
}

export interface SystemInput {
  systemType: SystemType;
  panel: PanelSpec;
  /** ON-GRID: the PLN connection. */
  gridVA?: number;
  gridPhase?: 1 | 3;
  dcAcRatio?: number;
  /** OFF-GRID / HYBRID: the loads, the days of autonomy, the sun. */
  loads?: LoadRow[];
  autonomyDays?: number;
  pshHours?: number;
  batteryPreference?: BatteryPreference;
  /**
   * Fraction of the rated load expected to run at once. 0.01–1.0, default 1.0.
   *
   * A load table is a list of everything INSTALLED. Sizing on its sum assumes
   * every MCB at full draw in the same second, which no housing estate has ever
   * done — 0.4–0.6 is the standard band there, 0.7–0.8 industrial. v8 expected
   * the designer to pre-multiply before calling, which meant a design carried
   * no record of whether they had. Now the engine applies it and stores it.
   *
   * It does NOT touch surge: a motor's inrush is a physical event, not an
   * average, and a diversified estate still has to start its pumps.
   */
  demandFactor?: number;
  /**
   * The site's stated power loss factor, 0–1 exclusive. Optional.
   *
   * A consultant's drawing that says "Fs = 30 %" means the inverter must be
   * sized at load / (1 − 0.30) = ×1.4286 — NOT the engine's default ×1.25
   * safety factor, which undersizes by 14 % against that brief. When present it
   * replaces `continuousSafetyFactor`, and the result says which rule ran.
   */
  powerLossFactorFs?: number;
  /**
   * Measured cable run from array to inverter, metres per string, one way.
   *
   * Absent, the engine falls back to v7's 6 m per panel — a ROOFTOP figure. On
   * a 250 m plantation estate that is out by an order of magnitude, and it is
   * out silently, which is how it survived.
   */
  cableRunPerStringM?: number;
  /**
   * Where the peak-sun-hours figure came from. Default `'estimate'`.
   *
   * PSH 3.5 against 3.0 moves the array by 17 %, so a design's second-largest
   * number deserves a provenance. Informational — it changes no arithmetic —
   * but an estimate says so on the review.
   */
  pshSource?: 'measured' | 'pvsyst' | 'estimate';
  /** Coldest expected cell temperature at the SITE, °C. Defaults to 18. */
  minCellTempC?: number;
  /** Array layout — feeds the mounting engine. */
  rows: number;
  railLengthMm: number;
  panelSpacingMm: number;
  mountType: MountType;
  orientation: Orientation;
}

export interface SystemCandidates {
  onGridInverters?: OnGridInverterSpec[];
  hybridInverters?: HybridInverterSpec[];
  batteries?: BatterySpec[];
}

export interface StringConfig {
  numStrings: number;
  maxSeriesLength: number;
  /** Which rule produced it, so a review can tell at a glance. */
  rule: 'temperature' | 'flat';
  /** Module Voc at the design minimum temperature, V — `null` on the flat rule. */
  vocAtMinTempV: number | null;
  /** The temperature it was corrected to, °C — `null` on the flat rule. */
  minCellTempC: number | null;
  /** What v7's flat 0.95 rule would have allowed, for comparison on review. */
  flatRuleMaxSeriesLength: number;
  warnings: string[];
}

/**
 * A module's open-circuit voltage at a given cell temperature.
 *
 *   Voc(T) = Voc_STC × (1 + β/100 × (T − 25))
 *
 * β is negative, so below 25 °C the voltage RISES. This is the number that
 * destroys an inverter on a cold clear morning, and the reason string length
 * is a temperature question rather than a fixed percentage.
 */
export function vocAtTemp(vocStc: number, betaPercentPerC: number, cellTempC: number): number {
  return vocStc * (1 + (betaPercentPerC / 100) * (cellTempC - 25));
}

export interface SystemResult {
  ok: boolean;
  /** What was chosen, for the summary the salesperson reads. */
  inverter?: { model: string; component_id?: string | null; qty: number; note: string };
  battery?: { model: string; component_id?: string | null; qty: number; series: number; parallel: number; usableKwh: number };
  numPanels: number;
  arrayKwp: number;
  strings?: StringConfig;
  /** Load analysis (off-grid / hybrid), AFTER the demand factor. */
  totalWh?: number;
  runningW?: number;
  surgeW?: number;
  requiredContinuousW?: number;
  /** The demand factor actually used — 1.0 when the caller named none. */
  demandFactor?: number;
  /** The load table's own sum, before diversity. Kept so both are checkable. */
  rawRunningW?: number;
  rawTotalWh?: number;
  /** Which rule set the continuous requirement. */
  inverterSizingMethod?: 'safety_factor' | 'power_loss_factor';
  /** Echoed when the caller supplied one. */
  powerLossFactorFs?: number;
  /** (installed W / required W) − 1. Negative means the units cannot carry it. */
  inverterHeadroomPct?: number;
  /** The bank's real terminal voltage — series × the pack's STATED volts. */
  batteryStringVoltageV?: number;
  /** The inverter's battery-port ceiling, when its datasheet is on file. */
  inverterMaxBatteryV?: number | null;
  /** Whether the string clears that ceiling, or whether we cannot tell. */
  batteryVoltageCheck?: 'ok' | 'close' | 'exceeds' | 'unknown';
  /** Whether the cable metreage was measured or fell back to 6 m per panel. */
  cableSource?: 'measured' | 'default';
  cableRunPerStringM?: number;
  totalCableM?: number;
  /** Provenance of the PSH figure the array was sized on. */
  pshSource?: 'measured' | 'pvsyst' | 'estimate';
  lines: BomLine[];
  /** Non-mounting picks that must resolve by identity, not by BoM role. */
  picks: { component_id: string | null; label: string; qty: number; note?: string }[];
  errors: string[];
  warnings: string[];
}

/**
 * String length and count against the inverter's real limits.
 *
 * v7 sized on a FLAT 0.95 of the inverter's maximum — a single fudge factor
 * standing in for cold-morning Voc rise, identical for every module. Since
 * 2026-09-06 the default corrects each module's own Voc by its own
 * temperature coefficient to the site's coldest expected temperature, which
 * is what IEC 62548 and NEC 690.7 actually ask for.
 *
 * The flat rule remains selectable (`vocRule: 'flat'`) because it is what v7
 * does, and the parity tests must keep testing v7.
 *
 * A module with no `temp_coeff_voc_percent_per_c` falls back to the flat rule
 * and SAYS SO (owner, 2026-09-06). Inventing a plausible β would put a number
 * nobody read off a datasheet into a safety-bearing calculation.
 */
export function sizePvStrings(
  panel: PanelSpec,
  inv: OnGridInverterSpec | HybridInverterSpec,
  numPanels: number,
  invCategory: 'on-grid' | 'hybrid',
  options: SystemOptions = {},
): StringConfig {
  const { vocRule, vocMarginFactor, minCellTempC } = { ...SYSTEM_DEFAULTS, ...options };
  let maxVoltage: number;
  let mpptCount: number;
  let stringsPerMppt: number;
  if (invCategory === 'on-grid') {
    const i = inv as OnGridInverterSpec;
    maxVoltage = i.pv_max_voltage_vdc || 1000;
    mpptCount = i.no_of_mppts || 1;
    stringsPerMppt = i.strings_per_mppt || 1;
  } else {
    const i = inv as HybridInverterSpec;
    maxVoltage = i.pv_max_open_circuit_voltage_vdc || 600;
    mpptCount = i.no_of_mpp_trackers || 1;
    stringsPerMppt = 1;   // the hybrid data does not state strings per tracker
  }
  const warnings: string[] = [];
  const flatRuleMaxSeriesLength = Math.max(1, Math.floor((maxVoltage * vocMarginFactor) / panel.voc_stc_v));

  const beta = Number(panel.temp_coeff_voc_percent_per_c);
  const haveBeta = Number.isFinite(beta) && beta !== 0;
  const useTemperature = vocRule === 'temperature' && haveBeta;

  if (vocRule === 'temperature' && !haveBeta) {
    warnings.push(`${panel.model} has no Temp Coeff. Voc on file, so its string length was sized on the old flat ${vocMarginFactor} margin instead of the site temperature. Fill that spec in Tech Specs to size it properly.`);
  }

  const vocAtMinTempV = useTemperature ? vocAtTemp(panel.voc_stc_v, beta, minCellTempC) : null;
  const maxSeriesLength = useTemperature
    ? Math.max(1, Math.floor(maxVoltage / (vocAtMinTempV as number)))
    : flatRuleMaxSeriesLength;

  const numStrings = Math.max(1, Math.ceil(numPanels / maxSeriesLength));
  const maxAllowedStrings = mpptCount * stringsPerMppt;
  if (numStrings > maxAllowedStrings) {
    warnings.push(`PV array needs ${numStrings} string(s) of up to ${maxSeriesLength} panel(s) each, but ${inv.model} only supports ${maxAllowedStrings} string(s) (${mpptCount} MPPT × ${stringsPerMppt}/MPPT). Add an external combiner or a larger/second inverter.`);
  }
  // A longer string than the old rule allowed is correct, not a mistake — but
  // it is a change a reviewer should see rather than discover.
  if (useTemperature && maxSeriesLength > flatRuleMaxSeriesLength) {
    warnings.push(`String length ${maxSeriesLength} is above the ${flatRuleMaxSeriesLength} the old flat margin allowed: ${panel.model} at ${minCellTempC} °C reaches ${(vocAtMinTempV as number).toFixed(1)} V per module against ${maxVoltage} V at the inverter. Lower the design temperature if this site can get colder than ${minCellTempC} °C.`);
  }
  return { numStrings, maxSeriesLength, rule: useTemperature ? 'temperature' : 'flat', vocAtMinTempV, minCellTempC: useTemperature ? minCellTempC : null, flatRuleMaxSeriesLength, warnings };
}

/** An on-grid inverter's phase, read the way v7 reads it. */
export const phaseOf = (inv: OnGridInverterSpec): 1 | 3 =>
  (inv.nominal_ac_voltage_vac ?? '').includes('3L') || (inv.nominal_ac_voltage_vac ?? '').includes('3-phase') ? 3 : 1;

// ── Battery bus arithmetic ──────────────────────────────────────────────────
//
// A battery bank is a WHOLE number of packs in series. That sounds obvious and
// the engine did not enforce it: `series = busV / nominal_voltage_v` with no
// integer guard, and a candidate filter that only asked `nominal_voltage_v <=
// busV`. A 25.6 V pack on a 48 V bus produced series 1.875 and a quantity of
// 3.75 batteries — a quote for three and three quarters of a battery.
//
// The reason it survived is that v7's own fixture holds only 12 V lead-acid
// and 48 V lithium, which divide evenly. ICAPROC's real catalogue does not:
// most rows state the voltage CLASS (a 51.2 V LiFePO4 pack typed as 48) but
// some state the literal pack voltage (`EPEVER LR51100A` says 51.2). Both
// describe the same 48 V bank and both must size it the same way.

/** The buses batteries are actually built and sold for. */
export const BATTERY_VOLTAGE_CLASSES = [12, 24, 36, 48, 96, 192, 384] as const;

/**
 * How far a stated voltage may sit from its class. A LiFePO4 cell is 3.2 V
 * against lead-acid's 3.0 V equivalent, so every lithium pack reads 6.67 %
 * high — 12.8, 25.6, 51.2, 409.6. Ten percent covers that and nothing else:
 * the classes are an octave apart, so no pack can be ambiguous between two.
 */
export const VOLTAGE_CLASS_TOLERANCE = 0.1;

/**
 * The bus class a stated voltage belongs to — 51.2 V and 48 V are both a
 * 48 V bank. `null` when the number is nothing standard, which makes the
 * battery a non-candidate rather than a silent fraction.
 */
export function voltageClassOf(nominalV: number | null | undefined): number | null {
  const v = Number(nominalV);
  if (!Number.isFinite(v) || v <= 0) return null;
  let best: number | null = null;
  let bestErr = Infinity;
  for (const c of BATTERY_VOLTAGE_CLASSES) {
    const err = Math.abs(v - c) / c;
    if (err < bestErr) { bestErr = err; best = c; }
  }
  return bestErr <= VOLTAGE_CLASS_TOLERANCE ? best : null;
}

/**
 * How many of this battery sit in series on this bus — a positive whole
 * number, or `null` when the pack does not build that bus at all. A 36 V pack
 * on a 48 V bus has no answer, and 1.333 was never one.
 */
export function seriesOnBus(busV: number, batteryNominalV: number | null | undefined): number | null {
  const bus = voltageClassOf(busV);
  const pack = voltageClassOf(batteryNominalV);
  if (bus === null || pack === null) return null;
  const series = bus / pack;
  return Number.isInteger(series) && series >= 1 ? series : null;
}

/**
 * Does this battery carry the chosen chemistry?
 *
 * Case-INSENSITIVE, and this is not a nicety. v7's fixture says "Lead-Acid
 * (Deep Cycle)" and ICAPROC's catalogue says "Lead-acid (deep cycle)", so the
 * old `battery_type.includes('Lead-Acid')` matched the test data and never the
 * real data. A lead-acid design then found no battery and fell through to
 * `pool[0]` — the first row in the list, which is quite possibly lithium.
 * The bank was sized at the wrong depth of discharge and nothing said so.
 */
export function isChemistry(batteryType: string | null | undefined, lithium: boolean): boolean {
  const t = String(batteryType ?? '').toLowerCase();
  return lithium
    ? t.includes('lifepo4') || t.includes('li-ion') || t.includes('lithium')
    : t.includes('lead');
}

export function calculateSystem(
  input: SystemInput,
  candidates: SystemCandidates,
  options: SystemOptions = {},
): SystemResult {
  const opt = {
    ...SYSTEM_DEFAULTS,
    ...(input.minCellTempC != null && Number.isFinite(Number(input.minCellTempC))
      ? { minCellTempC: Number(input.minCellTempC) } : {}),
    ...options,
  };
  const errors: string[] = [];
  const warnings: string[] = [];
  const picks: SystemResult['picks'] = [];
  const { panel } = input;

  const empty: SystemResult = { ok: false, numPanels: 0, arrayKwp: 0, lines: [], picks, errors, warnings };

  if (input.systemType === 'on-grid') {
    const gridVA = Number(input.gridVA) || 0;
    const gridPhase = input.gridPhase ?? 1;
    if (gridVA <= 0) { errors.push('Select or enter a valid PLN capacity.'); return empty; }

    // Biggest inverter of the right phase that still fits inside the connection
    const viable = (candidates.onGridInverters ?? [])
      .filter((inv) => phaseOf(inv) === gridPhase && inv.rated_output_power_kw * 1000 <= gridVA)
      .sort((a, b) => b.rated_output_power_kw - a.rated_output_power_kw);
    if (!viable.length) {
      errors.push(`No suitable inverter found for ${gridVA} VA (${gridPhase}-phase).`);
      return empty;
    }
    const inv = viable[0];
    const ratio = Number(input.dcAcRatio) || 1;
    const targetDCW = inv.rated_output_power_kw * 1000 * ratio;
    const numPanels = Math.ceil(targetDCW / panel.power_stc_w);
    const actualDCW = numPanels * panel.power_stc_w;
    const strings = sizePvStrings(panel, inv, numPanels, 'on-grid', opt);
    warnings.push(...strings.warnings);

    picks.push({ component_id: inv.component_id ?? null, label: `${inv.model} (${inv.rated_output_power_kw} kW, ${gridPhase}-phase)`, qty: 1, note: 'Largest inverter inside the grid limit' });
    picks.push({ component_id: panel.component_id ?? null, label: `${panel.model} ${panel.power_stc_w}W`, qty: numPanels, note: `${(actualDCW / 1000).toFixed(2)} kWp total` });

    const { lines, bomWarnings, cable } = buildStructureAndBos(input, numPanels, strings.numStrings, 1, gridPhase, opt);
    warnings.push(...bomWarnings);
    return {
      ok: true,
      inverter: { model: inv.model, component_id: inv.component_id ?? null, qty: 1, note: `${inv.rated_output_power_kw} kW AC` },
      numPanels, arrayKwp: actualDCW / 1000, strings, lines, picks, errors, warnings, ...cable,
    };
  }

  // ── Off-grid / hybrid ─────────────────────────────────────────────────────
  let rawTotalWh = 0;
  let rawRunningW = 0;
  let surgeW = 0;
  for (const l of input.loads ?? []) {
    const w = Number(l.watts) || 0;
    const h = Number(l.hoursPerDay) || 0;
    const q = Number(l.qty) || 0;
    const lineWatts = w * q;
    rawRunningW += lineWatts;
    rawTotalWh += w * h * q;
    surgeW += l.inductive ? lineWatts * 2 : lineWatts;
  }
  if (rawTotalWh === 0) {
    errors.push('Add at least one load with watts and hours per day.');
    return empty;
  }

  // DIVERSITY. The load table lists what is installed; the demand factor says
  // how much of it runs at once. Surge is deliberately left un-factored — an
  // inrush is a physical event, not an average.
  const namedDemandFactor = Number.isFinite(Number(input.demandFactor)) ? Number(input.demandFactor) : null;
  const demandFactor = namedDemandFactor == null ? 1 : clamp(namedDemandFactor, 0.01, 1);
  if (namedDemandFactor == null) {
    warnings.push('No demand factor specified — sizing at 100% of rated load. For housing estates, 40–60% is typical.');
  }
  const runningW = rawRunningW * demandFactor;
  const totalWh = rawTotalWh * demandFactor;

  // Continuous rating: the site's own power loss factor when it has one,
  // otherwise the engine's safety factor. load / (1 − Fs) and load × 1.25 are
  // different questions, and a drawing that states Fs has already answered it.
  const fs = Number(input.powerLossFactorFs);
  const useFs = Number.isFinite(fs) && fs > 0 && fs < 1;
  const requiredContinuousW = useFs ? runningW / (1 - fs) : runningW * opt.continuousSafetyFactor;
  const inverterSizingMethod: 'safety_factor' | 'power_loss_factor' = useFs ? 'power_loss_factor' : 'safety_factor';
  const requiredSurgeW = surgeW;
  /** Everything the load step established, carried onto the early returns too. */
  const loadFacts = {
    totalWh, runningW, surgeW, requiredContinuousW,
    demandFactor, rawRunningW, rawTotalWh,
    inverterSizingMethod, ...(useFs ? { powerLossFactorFs: fs } : {}),
  };
  const isLithium = (input.batteryPreference ?? 'LiFePO4') === 'LiFePO4';
  const surgeCapacityOf = (i: HybridInverterSpec) => i.surge_power_va || i.rated_output_power_w * opt.assumedSurgeMultiple;

  const pool = candidates.batteries ?? [];

  // An inverter is compatible when the CATALOGUE can actually build its bus in
  // the chosen chemistry — not when its bus appears on a hard-coded list.
  //
  // The old rule was `isLithium && bus !== 48 && bus !== 384 → reject`, which
  // ruled out every 24 V inverter on the shelf even though the catalogue
  // carries five 25.6 V LiFePO4 packs to serve them. Asking the battery pool
  // instead is both correct and self-maintaining: it widens as the catalogue
  // does, and it still refuses a bus nothing can build. (On v7's own fixture —
  // 12 V lead-acid and 48 V lithium only — it excludes the 24 V inverter for a
  // lithium design exactly as the old list did, so parity is unchanged.)
  const bankableIn = (busV: number | null | undefined, lithium: boolean): boolean =>
    pool.some((b) => isChemistry(b.battery_type, lithium) && seriesOnBus(Number(busV), b.nominal_voltage_v) !== null);

  const byPower = (list: HybridInverterSpec[]) =>
    [...list].sort((a, b) => a.rated_output_power_w - b.rated_output_power_w);
  const withBus = (candidates.hybridInverters ?? []).filter((i) => i.battery_nominal_voltage_vdc != null);

  // Two passes, so a catalogue gap costs the chemistry rather than the quote:
  // inverters whose bus the REQUESTED chemistry can build come first, and only
  // when there are none does lead-acid stand in for lithium (which the battery
  // step then warns about). Without the second pass, asking for lithium in a
  // shop that stocks only lead-acid would fail outright — and a missing
  // battery must no more block a quotation than a missing clamp does.
  const preferred = byPower(withBus.filter((i) => bankableIn(i.battery_nominal_voltage_vdc, isLithium)));
  const viable = preferred.length > 0
    ? preferred
    : byPower(withBus.filter((i) => isLithium && bankableIn(i.battery_nominal_voltage_vdc, false)));

  // Smallest unit that carries both the continuous and the surge load; failing
  // that, the biggest available in parallel.
  let inv = viable.find((i) => i.rated_output_power_w >= requiredContinuousW && surgeCapacityOf(i) >= requiredSurgeW) ?? null;
  let invQty = 1;
  if (!inv && viable.length) {
    inv = viable[viable.length - 1];
    invQty = Math.ceil(Math.max(requiredContinuousW, requiredSurgeW / 2) / inv.rated_output_power_w);
  }
  if (!inv) {
    errors.push(`No compatible inverter found: no ${isLithium ? 'lithium' : 'lead-acid'} battery in the catalog can build the bus of any available inverter.`);
    return { ...empty, ...loadFacts };
  }

  // HEADROOM. Picking the smallest unit that clears the requirement is right;
  // saying nothing when it clears it by 6 % is not. What is left over is what
  // absorbs an unlisted surge, a derated afternoon and next year's load.
  const installedW = invQty * inv.rated_output_power_w;
  const inverterHeadroomPct = requiredContinuousW > 0 ? installedW / requiredContinuousW - 1 : 0;
  if (inverterHeadroomPct < opt.minInverterHeadroomPct) {
    warnings.push(`Inverter headroom is only ${(inverterHeadroomPct * 100).toFixed(0)}% (${invQty}× ${inv.rated_output_power_w}W = ${installedW}W against ${requiredContinuousW.toFixed(0)}W required). Consider one more unit for surge, derating and expansion.`);
  }

  // Battery bank: a WHOLE number in series to reach the inverter's bus, then
  // strings in parallel to hold the energy. A pack that does not divide the
  // bus is not a candidate — it is not a fraction of one.
  const sysV = inv.battery_nominal_voltage_vdc as number;
  const dod = isLithium ? opt.dodLithium : opt.dodLeadAcid;
  const reqBattWh = (totalWh * (Number(input.autonomyDays) || 1)) / dod;

  const fits = (b: BatterySpec, lithium: boolean) =>
    isChemistry(b.battery_type, lithium) && seriesOnBus(sysV, b.nominal_voltage_v) !== null;

  let batt = pool.find((b) => fits(b, isLithium)) ?? null;
  if (!batt && isLithium) {
    // Falling back across chemistries changes the depth of discharge from 0.8
    // to 0.5, so it is never silent.
    batt = pool.find((b) => fits(b, false)) ?? null;
    if (batt) warnings.push(`No lithium battery in the catalog builds a ${sysV} V bus — fell back to lead-acid, which halves usable depth of discharge.`);
  }
  if (!batt) {
    errors.push(`No battery in the catalog builds a ${sysV} V bus in a whole number of units in series.`);
    return { ...empty, ...loadFacts };
  }

  // Non-null: `fits` is what selected this battery.
  const battSeries = seriesOnBus(sysV, batt.nominal_voltage_v) as number;

  // The bank is sized to the bus CLASS, but it is wired at the pack's STATED
  // voltage, and those differ by 6.67 % for every LiFePO4 pack ever made. The
  // nominal bus never trips the inverter's battery port; the real terminal
  // voltage does.
  const batteryStringVoltageV = battSeries * Number(batt.nominal_voltage_v);
  const maxBatteryV = Number(inv.max_battery_voltage_vdc);
  const haveMaxBatteryV = Number.isFinite(maxBatteryV) && maxBatteryV > 0;
  let batteryVoltageCheck: 'ok' | 'close' | 'exceeds' | 'unknown' = 'unknown';
  if (haveMaxBatteryV) {
    const proximity = batteryStringVoltageV / maxBatteryV;
    if (batteryStringVoltageV > maxBatteryV) {
      batteryVoltageCheck = 'exceeds';
      warnings.push(`Battery string voltage ${batteryStringVoltageV.toFixed(1)}V EXCEEDS the ${inv.model} battery input maximum of ${maxBatteryV}V. Reduce the series count.`);
    } else if (proximity > opt.batteryVoltageProximityThreshold) {
      batteryVoltageCheck = 'close';
      warnings.push(`Battery string voltage ${batteryStringVoltageV.toFixed(1)}V is ${(proximity * 100).toFixed(1)}% of the ${inv.model} maximum ${maxBatteryV}V — verify with the manufacturer that this is inside tolerance.`);
    } else {
      batteryVoltageCheck = 'ok';
    }
  }

  const stringWh = battSeries * batt.energy_wh;
  const battParallel = Math.ceil(reqBattWh / stringWh);
  const totalBatt = battSeries * battParallel;

  // Array from the daily energy, the sun and the system losses
  const psh = Number(input.pshHours) || 1;
  const pshSource = input.pshSource ?? 'estimate';
  if (pshSource === 'estimate') {
    warnings.push(`PSH ${psh} is an estimate, not irradiance data or a simulation — and PSH 3.5 against 3.0 moves the array by 17%. Consider a PVsyst run before the final design.`);
  }
  const reqPVW = totalWh / (psh * opt.systemEfficiency);
  const numPanels = Math.ceil(reqPVW / panel.power_stc_w);
  const strings = sizePvStrings(panel, inv, numPanels, 'hybrid', opt);
  warnings.push(...strings.warnings);

  picks.push({ component_id: inv.component_id ?? null, label: `${inv.model} (${inv.rated_output_power_w}W, ${sysV}V)`, qty: invQty,
    note: `${invQty} unit(s): ${Math.ceil(requiredContinuousW)}W continuous / ${Math.ceil(requiredSurgeW)}W surge required` });
  picks.push({ component_id: batt.component_id ?? null, label: `${batt.model} (${batt.nominal_voltage_v}V${batt.rated_capacity_ah ? ` ${batt.rated_capacity_ah}Ah` : ''})`, qty: totalBatt,
    note: `${battParallel} string(s) of ${battSeries} — ${sysV}V bus` });
  picks.push({ component_id: panel.component_id ?? null, label: `${panel.model} ${panel.power_stc_w}W`, qty: numPanels,
    note: `${(numPanels * panel.power_stc_w / 1000).toFixed(2)} kWp total` });

  const phase: 1 | 3 = (inv.phase ?? '').includes('3') ? 3 : 1;
  const { lines, bomWarnings, cable } = buildStructureAndBos(input, numPanels, strings.numStrings, invQty, phase, opt);
  warnings.push(...bomWarnings);

  return {
    ok: true,
    inverter: { model: inv.model, component_id: inv.component_id ?? null, qty: invQty, note: `${inv.rated_output_power_w}W · ${sysV}V bus` },
    battery: { model: batt.model, component_id: batt.component_id ?? null, qty: totalBatt, series: battSeries, parallel: battParallel, usableKwh: (totalBatt * batt.energy_wh) / 1000 },
    numPanels, arrayKwp: (numPanels * panel.power_stc_w) / 1000, strings,
    ...loadFacts,
    inverterHeadroomPct,
    batteryStringVoltageV, inverterMaxBatteryV: haveMaxBatteryV ? maxBatteryV : null, batteryVoltageCheck,
    pshSource, ...cable,
    lines, picks, errors, warnings,
  };
}

/**
 * The structure (v11, reused) plus v7's electrical balance of system.
 * v7 inlines v11's mounting block verbatim, so this composes rather than
 * duplicating it — one set of mounting rules, one set of tests.
 */
function buildStructureAndBos(
  input: SystemInput, numPanels: number, numStrings: number,
  numInverters: number, phase: 1 | 3, opt: Required<SystemOptions>,
): { lines: BomLine[]; bomWarnings: string[]; cable: CableRun } {
  const dims = (input.panel.dimensions_l_w_h_mm ?? '').split(/[x×]/i).map((s) => parseFloat(s.trim()));
  const mount = calculateMounting({
    panelCount: numPanels,
    numberOfRows: input.rows,
    panelLengthMm: dims[0] || 0,
    panelWidthMm: dims[1] || 0,
    panelThicknessMm: dims[2] || 35,      // v7 defaults a missing frame to 35
    railLengthMm: input.railLengthMm,
    panelSpacingMm: input.panelSpacingMm,
    mountType: input.mountType,
    orientation: input.orientation,
  });

  const lines: BomLine[] = [...mount.lines];
  const bomWarnings = [...mount.warnings];

  // CABLE. `cableMetresPerPanel = 6` is a rooftop residential placeholder: the
  // array is above the inverter and the run is short. On a ground-mount estate
  // where the field sits 250 m from the plant room it is out by five to ten
  // times, and the BoM shows a plausible number either way — which is the only
  // reason it lasted. A measured run per string is a straight answer; the
  // default now says out loud that it is not one.
  const measured = Number(input.cableRunPerStringM);
  const haveMeasured = Number.isFinite(measured) && measured > 0;
  // ×2: a string needs a positive and a negative conductor back to the inverter.
  const totalCableM = haveMeasured ? measured * numStrings * 2 : numPanels * opt.cableMetresPerPanel;
  const cable: CableRun = haveMeasured
    ? { cableSource: 'measured', cableRunPerStringM: measured, totalCableM }
    : { cableSource: 'default', totalCableM };
  if (!haveMeasured) {
    bomWarnings.push(`Cable distance defaulted to ${opt.cableMetresPerPanel}m per panel (${totalCableM}m total), which is a rooftop figure. For ground-mount or estate sites give the measured run per string — the default can understate it by 5–10×.`);
  }

  // String cabling and connectors
  lines.push({ role: 'solar_cable', param: 6, qty: totalCableM, unit: 'm', label: 'Solar cable 1×6 mm²', note: cable.cableSource === 'measured' ? `${measured}m per string × ${numStrings} string(s) × 2 conductors` : 'String cabling' });
  lines.push({ role: 'mc4_pair', qty: numStrings * 2 + 2, unit: 'pcs', label: 'MC4 connector pair', note: `${numStrings} string(s)` });

  if (input.systemType === 'on-grid') {
    lines.push({ role: 'ac_distribution', param: phase === 3 ? 'triple' : 'single', qty: 1, unit: 'pcs', label: `AC distribution panel (${phase}-phase)`, note: 'Grid connection' });
  } else {
    lines.push({ role: 'combiner_box', qty: Math.ceil(numInverters), unit: 'pcs', label: 'PV combiner box / DC protection', note: 'Surge & overcurrent protection' });
    lines.push({ role: 'dc_breaker', qty: numInverters, unit: 'pcs', label: 'Battery DC breaker / fuse', note: 'Between battery and inverter' });
    lines.push({ role: 'ac_distribution', param: phase === 3 ? 'triple' : 'single', qty: 1, unit: 'pcs', label: 'AC distribution box (load side)', note: 'House connection' });
  }
  return { lines, bomWarnings, cable };
}

/** What the cable step decided, and on what basis. */
interface CableRun {
  cableSource: 'measured' | 'default';
  cableRunPerStringM?: number;
  totalCableM: number;
}
