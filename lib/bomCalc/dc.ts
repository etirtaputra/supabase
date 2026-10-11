/**
 * DC side of the BOM calculator: strings per inverter, string cable per roof,
 * PV connectors — the 'String' and 'Kabel DC' sheets of the EPC workbooks.
 *
 * ONE source of truth for strings. In the workbooks the inverter sheet and the
 * cable sheet each typed their own string counts and drifted apart (one
 * 'String' sheet listed 18 inverters for a 9-inverter plant; its 'Kabel DC'
 * cabled 198 strings for 180). Here the roofs are checked against the inverters, and the
 * BOM reads quantities only from this calculation.
 */
import { pvResistance, PV_SIZES_MM2 } from './cables.ts';

export interface ModuleSpec {
  model: string;
  wp: number;
  vocV: number;
  vmpV: number;
  iscA: number;
  impA: number;
  /** %/°C, negative. Null = unknown: the cold-voltage check then says it cannot run. */
  tempCoeffVocPct: number | null;
  /** Module's own maximum system voltage (1000 / 1500 V). */
  maxSystemV: number | null;
}

export interface InverterSpec {
  model: string;
  acKw: number;
  /** Line-to-line AC voltage, V (400 / 800). */
  acVoltageV: number | null;
  /** Max AC output current, A — the basis of the AC cable. */
  acCurrentA: number | null;
  maxDcV: number | null;
  mpptMinV: number | null;
  mpptMaxV: number | null;
  mppts: number | null;
  stringsPerMppt: number | null;
  /** Max input (short-circuit) current per MPPT, A. */
  maxIscPerMpptA: number | null;
}

export interface InverterGroup {
  id: string;
  label: string;
  inverter: InverterSpec;
  count: number;
  stringsEach: number;
  modulesPerString: number;
}

export type PvSize = 4 | 6 | 10 | 16;

export interface RoofRun {
  id: string;
  label: string;
  strings: number;
  /** Modules per string on this roof; null = the project's usual string length. */
  modulesPerString: number | null;
  /** Cable route from the inverter to the start of the strings, m (one way). */
  distanceM: number;
  /** Average run along the array from the start of a string to its end, m. */
  runM: number;
  /** Conductor size, or 'auto' = the smallest that keeps the voltage drop within the limit. */
  size: PvSize | 'auto';
}

export interface DcSettings {
  /** Lowest cell temperature the site can see, °C — sets the cold string voltage. */
  minCellTempC: number;
  /** Hottest cell temperature, °C — sets the low end of the MPPT window. */
  maxCellTempC: number;
  /** Voltage-drop limit for a string loop, % (the sheets use 4 %). */
  maxVdPct: number;
  /** Extra cable on top of the measured routes, % (sheets: 0, 5, 10, 14). */
  slackPct: number;
  /** Connector pairs per string besides its own end pair (the 2026-10 rooftop workbook used 2). */
  jumpersPerString: number;
}

export const DC_DEFAULTS: DcSettings = { minCellTempC: 18, maxCellTempC: 70, maxVdPct: 4, slackPct: 0, jumpersPerString: 2 };

export interface Check {
  level: 'error' | 'warn' | 'ok';
  where: string;
  message: string;
  /** 'unpriced' = a row still waiting for its price — counted apart from real faults, so a fresh calculation does not read as broken. */
  tag?: 'unpriced';
}

export interface RoofResult {
  id: string;
  label: string;
  size: PvSize | null;
  modules: number;
  /** Cable to buy for this roof, m — (distance + run) × 2 × strings, plus slack. */
  cableM: number;
  /** Voltage drop over one string's electrical loop (2·distance + run), %. */
  vdPct: number | null;
  connectorPairs: number;
}

export interface DcResult {
  modules: number;
  strings: number;
  wp: number;
  inverters: number;
  acKw: number;
  dcAcRatio: number | null;
  roofs: RoofResult[];
  /** Metres of PV cable by size. */
  cableBySize: Record<number, number>;
  connectorsBySize: Record<number, number>;
  vocColdV: number | null;
  checks: Check[];
}

const round2 = (n: number) => Math.round(n * 100) / 100;

/** The voltage drop of one string loop of `loopM` metres, %. */
export function stringVdPct(m: ModuleSpec, modulesPerString: number, sizeMm2: number, loopM: number): number | null {
  const r = pvResistance(sizeMm2);
  if (r == null || !(modulesPerString > 0) || !(m.vmpV > 0)) return null;
  return (m.impA * (r / 1000) * loopM) / (modulesPerString * m.vmpV) * 100;
}

/** The smallest PV size whose loop stays within the limit; null if even the largest does not. */
export function autoPvSize(m: ModuleSpec, modulesPerString: number, loopM: number, maxVdPct: number): PvSize | null {
  for (const s of PV_SIZES_MM2) {
    const vd = stringVdPct(m, modulesPerString, s, loopM);
    if (vd != null && vd <= maxVdPct) return s as PvSize;
  }
  return null;
}

export function calculateDc(module: ModuleSpec, groups: InverterGroup[], roofs: RoofRun[], settings: Partial<DcSettings> = {}): DcResult {
  const st = { ...DC_DEFAULTS, ...settings };
  const checks: Check[] = [];

  // ── Inverters and strings ─────────────────────────────────────────────────
  let modules = 0, strings = 0, inverters = 0, acKw = 0;
  let vocColdV: number | null = null;
  const vocPerModuleCold = module.tempCoeffVocPct != null
    ? module.vocV * (1 + (module.tempCoeffVocPct / 100) * (st.minCellTempC - 25))
    : null;
  for (const g of groups) {
    const n = Math.max(0, g.count) * Math.max(0, g.stringsEach);
    strings += n;
    modules += n * Math.max(0, g.modulesPerString);
    inverters += Math.max(0, g.count);
    acKw += Math.max(0, g.count) * (g.inverter.acKw || 0);
    const inv = g.inverter;
    const where = g.label || inv.model;

    if (vocPerModuleCold == null) {
      checks.push({ level: 'warn', where, message: `${module.model || 'The module'} has no Voc temperature coefficient, so the cold string voltage cannot be checked.` });
    } else {
      const v = vocPerModuleCold * g.modulesPerString;
      vocColdV = Math.max(vocColdV ?? 0, v);
      const limit = Math.min(inv.maxDcV ?? Infinity, module.maxSystemV ?? Infinity);
      if (Number.isFinite(limit)) {
        checks.push(v > limit
          ? { level: 'error', where, message: `${g.modulesPerString} modules in series reach ${v.toFixed(0)} V at ${st.minCellTempC} °C — above the ${limit} V limit. Shorten the string.` }
          : { level: 'ok', where, message: `Cold string voltage ${v.toFixed(0)} V ≤ ${limit} V.` });
      } else {
        checks.push({ level: 'warn', where, message: 'No maximum DC voltage on file for the inverter or the module; the cold string voltage is not checked.' });
      }
    }
    if (inv.mpptMinV != null && module.tempCoeffVocPct != null) {
      const vmpHot = module.vmpV * (1 + (module.tempCoeffVocPct / 100) * (st.maxCellTempC - 25)) * g.modulesPerString;
      if (vmpHot < inv.mpptMinV) checks.push({ level: 'warn', where, message: `At ${st.maxCellTempC} °C the string works at about ${vmpHot.toFixed(0)} V, below the ${inv.mpptMinV} V MPPT minimum — yield will be lost on hot days.` });
    }
    if (inv.mpptMaxV != null && module.vmpV * g.modulesPerString > inv.mpptMaxV) {
      checks.push({ level: 'warn', where, message: `String Vmp ${(module.vmpV * g.modulesPerString).toFixed(0)} V is above the ${inv.mpptMaxV} V MPPT maximum.` });
    }
    if (inv.mppts && inv.stringsPerMppt) {
      const cap = inv.mppts * inv.stringsPerMppt;
      if (g.stringsEach > cap) checks.push({ level: 'error', where, message: `${g.stringsEach} strings per inverter, but ${inv.model} takes ${cap} (${inv.mppts} MPPT × ${inv.stringsPerMppt}).` });
      const perMppt = Math.ceil(g.stringsEach / inv.mppts);
      if (inv.maxIscPerMpptA != null && perMppt * module.iscA > inv.maxIscPerMpptA) {
        checks.push({ level: 'error', where, message: `${perMppt} strings on one MPPT carry ${(perMppt * module.iscA).toFixed(1)} A — above the ${inv.maxIscPerMpptA} A MPPT limit.` });
      }
    }
  }
  const wp = modules * (module.wp || 0);
  const dcAcRatio = acKw > 0 ? wp / (acKw * 1000) : null;

  // ── String cable per roof ─────────────────────────────────────────────────
  const cableBySize: Record<number, number> = {};
  const connectorsBySize: Record<number, number> = {};
  let roofStrings = 0, roofModules = 0;
  const usual = groups.find((g) => g.modulesPerString > 0)?.modulesPerString ?? 0;
  const roofResults: RoofResult[] = roofs.map((r) => {
    const n = Math.max(0, r.strings);
    const mps = r.modulesPerString ?? usual;
    // Quantity — the workbooks' rule: (distance + run) × 2 per string, + and −.
    // It buys one array run more than the conductors physically need, which
    // is the engineers' working allowance; keep it, and say so.
    const d = Math.max(0, r.distanceM), run = Math.max(0, r.runM);
    const buyM = 2 * (d + run);
    // Voltage drop — the electrical path: out to the first module, back from
    // the last one (2·distance + run), not the purchasing allowance.
    const loopM = 2 * d + run;
    const size = r.size === 'auto' ? autoPvSize(module, mps, loopM, st.maxVdPct) : r.size;
    const vdPct = size ? stringVdPct(module, mps, size, loopM) : null;
    const cableM = round2(n * buyM * (1 + st.slackPct / 100));
    const connectorPairs = n * (1 + st.jumpersPerString);
    roofStrings += n;
    roofModules += n * mps;
    if (size) {
      cableBySize[size] = round2((cableBySize[size] ?? 0) + cableM);
      connectorsBySize[size] = (connectorsBySize[size] ?? 0) + connectorPairs;
    }
    const where = r.label || 'Roof';
    if (!size) checks.push({ level: 'error', where, message: `A ${loopM.toFixed(0)} m string loop exceeds ${st.maxVdPct} % drop even on 16 mm². Move the inverter closer or split the run.` });
    else if (vdPct != null && vdPct > st.maxVdPct) checks.push({ level: 'error', where, message: `${size} mm² over a ${loopM.toFixed(0)} m loop drops ${vdPct.toFixed(2)} % — above ${st.maxVdPct} %. Use a larger size.` });
    return { id: r.id, label: r.label, size, modules: n * mps, cableM, vdPct: vdPct == null ? null : round2(vdPct), connectorPairs };
  });

  if (roofs.length) {
    if (roofStrings !== strings) checks.push({ level: 'error', where: 'Roofs vs inverters', message: `The roofs cable ${roofStrings} strings; the inverters take ${strings}. Every string must be cabled exactly once.` });
    if (roofModules !== modules) checks.push({ level: 'error', where: 'Roofs vs inverters', message: `The roofs hold ${roofModules} modules; the inverters ${modules}.` });
  }
  if (dcAcRatio != null && (dcAcRatio < 1 || dcAcRatio > 1.4)) {
    checks.push({ level: 'warn', where: 'DC/AC ratio', message: `DC/AC ratio is ${dcAcRatio.toFixed(2)} — usually between 1.0 and 1.4.` });
  }

  return { modules, strings, wp, inverters, acKw, dcAcRatio: dcAcRatio == null ? null : round2(dcAcRatio), roofs: roofResults, cableBySize, connectorsBySize, vocColdV: vocColdV == null ? null : round2(vocColdV), checks };
}
