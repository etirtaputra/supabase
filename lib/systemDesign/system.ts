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
  /** Cold-temperature Voc headroom on string length. v7: 0.95. */
  vocMarginFactor?: number;
  /** Metres of string cable per panel. v7: 6. */
  cableMetresPerPanel?: number;
}

export const SYSTEM_DEFAULTS: Required<SystemOptions> = {
  continuousSafetyFactor: 1.25,
  assumedSurgeMultiple: 2,
  dodLithium: 0.8,
  dodLeadAcid: 0.5,
  systemEfficiency: 0.8,
  vocMarginFactor: 0.95,
  cableMetresPerPanel: 6,
};

// ── The specs each candidate must carry ─────────────────────────────────────
export interface PanelSpec {
  component_id?: string | null;
  model: string;
  power_stc_w: number;
  voc_stc_v: number;
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
  warnings: string[];
}

export interface SystemResult {
  ok: boolean;
  /** What was chosen, for the summary the salesperson reads. */
  inverter?: { model: string; component_id?: string | null; qty: number; note: string };
  battery?: { model: string; component_id?: string | null; qty: number; series: number; parallel: number; usableKwh: number };
  numPanels: number;
  arrayKwp: number;
  strings?: StringConfig;
  /** Load analysis (off-grid / hybrid). */
  totalWh?: number;
  runningW?: number;
  surgeW?: number;
  requiredContinuousW?: number;
  lines: BomLine[];
  /** Non-mounting picks that must resolve by identity, not by BoM role. */
  picks: { component_id: string | null; label: string; qty: number; note?: string }[];
  errors: string[];
  warnings: string[];
}

/**
 * String length and count against the inverter's real limits — v7's
 * `sizePvStrings`, unchanged.
 */
export function sizePvStrings(
  panel: PanelSpec,
  inv: OnGridInverterSpec | HybridInverterSpec,
  numPanels: number,
  invCategory: 'on-grid' | 'hybrid',
  options: SystemOptions = {},
): StringConfig {
  const { vocMarginFactor } = { ...SYSTEM_DEFAULTS, ...options };
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
  const maxSeriesLength = Math.max(1, Math.floor((maxVoltage * vocMarginFactor) / panel.voc_stc_v));
  const numStrings = Math.max(1, Math.ceil(numPanels / maxSeriesLength));
  const maxAllowedStrings = mpptCount * stringsPerMppt;
  const warnings: string[] = [];
  if (numStrings > maxAllowedStrings) {
    warnings.push(`PV array needs ${numStrings} string(s) of up to ${maxSeriesLength} panel(s) each, but ${inv.model} only supports ${maxAllowedStrings} string(s) (${mpptCount} MPPT × ${stringsPerMppt}/MPPT). Add an external combiner or a larger/second inverter.`);
  }
  return { numStrings, maxSeriesLength, warnings };
}

/** An on-grid inverter's phase, read the way v7 reads it. */
export const phaseOf = (inv: OnGridInverterSpec): 1 | 3 =>
  (inv.nominal_ac_voltage_vac ?? '').includes('3L') || (inv.nominal_ac_voltage_vac ?? '').includes('3-phase') ? 3 : 1;

export function calculateSystem(
  input: SystemInput,
  candidates: SystemCandidates,
  options: SystemOptions = {},
): SystemResult {
  const opt = { ...SYSTEM_DEFAULTS, ...options };
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

    const { lines, mountWarnings } = buildStructureAndBos(input, numPanels, strings.numStrings, 1, gridPhase, opt);
    warnings.push(...mountWarnings);
    return {
      ok: true,
      inverter: { model: inv.model, component_id: inv.component_id ?? null, qty: 1, note: `${inv.rated_output_power_kw} kW AC` },
      numPanels, arrayKwp: actualDCW / 1000, strings, lines, picks, errors, warnings,
    };
  }

  // ── Off-grid / hybrid ─────────────────────────────────────────────────────
  let totalWh = 0;
  let runningW = 0;
  let surgeW = 0;
  for (const l of input.loads ?? []) {
    const w = Number(l.watts) || 0;
    const h = Number(l.hoursPerDay) || 0;
    const q = Number(l.qty) || 0;
    const lineWatts = w * q;
    runningW += lineWatts;
    totalWh += w * h * q;
    surgeW += l.inductive ? lineWatts * 2 : lineWatts;
  }
  if (totalWh === 0) {
    errors.push('Add at least one load with watts and hours per day.');
    return empty;
  }

  const requiredContinuousW = runningW * opt.continuousSafetyFactor;
  const requiredSurgeW = surgeW;
  const isLithium = (input.batteryPreference ?? 'LiFePO4') === 'LiFePO4';
  const surgeCapacityOf = (i: HybridInverterSpec) => i.surge_power_va || i.rated_output_power_w * opt.assumedSurgeMultiple;

  const viable = (candidates.hybridInverters ?? [])
    .filter((i) => {
      if (i.battery_nominal_voltage_vdc === undefined || i.battery_nominal_voltage_vdc === null) return false;
      if (isLithium && i.battery_nominal_voltage_vdc !== 48 && i.battery_nominal_voltage_vdc !== 384) return false;
      return true;
    })
    .sort((a, b) => a.rated_output_power_w - b.rated_output_power_w);

  // Smallest unit that carries both the continuous and the surge load; failing
  // that, the biggest available in parallel.
  let inv = viable.find((i) => i.rated_output_power_w >= requiredContinuousW && surgeCapacityOf(i) >= requiredSurgeW) ?? null;
  let invQty = 1;
  if (!inv && viable.length) {
    inv = viable[viable.length - 1];
    invQty = Math.ceil(Math.max(requiredContinuousW, requiredSurgeW / 2) / inv.rated_output_power_w);
  }
  if (!inv) {
    errors.push('No compatible inverter found (check the battery voltage match).');
    return { ...empty, totalWh, runningW, surgeW, requiredContinuousW };
  }

  // Battery bank: series to reach the inverter's bus, parallel to hold the energy
  const sysV = inv.battery_nominal_voltage_vdc as number;
  const dod = isLithium ? opt.dodLithium : opt.dodLeadAcid;
  const reqBattWh = (totalWh * (Number(input.autonomyDays) || 1)) / dod;
  const pool = candidates.batteries ?? [];
  let batt = pool.find((b) =>
    (isLithium ? b.battery_type.includes('LiFePO4') : b.battery_type.includes('Lead-Acid'))
    && b.nominal_voltage_v <= sysV) ?? null;
  if (!batt) {
    if (isLithium) {
      warnings.push('No suitable lithium battery in the catalog — fell back to lead-acid.');
      batt = pool.find((b) => b.battery_type.includes('Lead-Acid')) ?? null;
    } else {
      batt = pool[0] ?? null;
    }
  }
  if (!batt) {
    errors.push('No battery in the catalog can serve this system.');
    return { ...empty, totalWh, runningW, surgeW, requiredContinuousW };
  }

  const battSeries = sysV / batt.nominal_voltage_v;
  const stringWh = battSeries * batt.energy_wh;
  const battParallel = Math.ceil(reqBattWh / stringWh);
  const totalBatt = battSeries * battParallel;

  // Array from the daily energy, the sun and the system losses
  const psh = Number(input.pshHours) || 1;
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
  const { lines, mountWarnings } = buildStructureAndBos(input, numPanels, strings.numStrings, invQty, phase, opt);
  warnings.push(...mountWarnings);

  return {
    ok: true,
    inverter: { model: inv.model, component_id: inv.component_id ?? null, qty: invQty, note: `${inv.rated_output_power_w}W · ${sysV}V bus` },
    battery: { model: batt.model, component_id: batt.component_id ?? null, qty: totalBatt, series: battSeries, parallel: battParallel, usableKwh: (totalBatt * batt.energy_wh) / 1000 },
    numPanels, arrayKwp: (numPanels * panel.power_stc_w) / 1000, strings,
    totalWh, runningW, surgeW, requiredContinuousW,
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
): { lines: BomLine[]; mountWarnings: string[] } {
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
  // String cabling and connectors
  lines.push({ role: 'solar_cable', param: 6, qty: numPanels * opt.cableMetresPerPanel, unit: 'm', label: 'Solar cable 1×6 mm²', note: 'String cabling' });
  lines.push({ role: 'mc4_pair', qty: numStrings * 2 + 2, unit: 'pcs', label: 'MC4 connector pair', note: `${numStrings} string(s)` });

  if (input.systemType === 'on-grid') {
    lines.push({ role: 'ac_distribution', param: phase === 3 ? 'triple' : 'single', qty: 1, unit: 'pcs', label: `AC distribution panel (${phase}-phase)`, note: 'Grid connection' });
  } else {
    lines.push({ role: 'combiner_box', qty: Math.ceil(numInverters), unit: 'pcs', label: 'PV combiner box / DC protection', note: 'Surge & overcurrent protection' });
    lines.push({ role: 'dc_breaker', qty: numInverters, unit: 'pcs', label: 'Battery DC breaker / fuse', note: 'Between battery and inverter' });
    lines.push({ role: 'ac_distribution', param: phase === 3 ? 'triple' : 'single', qty: 1, unit: 'pcs', label: 'AC distribution box (load side)', note: 'House connection' });
  }
  return { lines, mountWarnings: mount.warnings };
}
