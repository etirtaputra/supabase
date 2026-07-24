/**
 * Structured project classification for quotes.
 *
 * The user picks a project type and fills in the capacity numbers for it;
 * the description ("EPC for PV Hybrid 1,8 MWp DC / … , at SITE"), the list
 * title, and the export filename are all generated from the same data so
 * they never drift apart.
 */

import type { EconAssumptions } from './energyEconomics';

export type ProjectType = 'on_grid' | 'hybrid_bess' | 'off_grid' | 'evcs' | 'custom';

export type Phase = 'single' | 'triple';

export interface SystemSpecs {
  kwp_dc?: number | null;   // PV modules
  kw_ac?: number | null;    // on-grid inverters
  kw_pcs?: number | null;   // PCS (hybrid only)
  kwh_bess?: number | null; // BESS energy
  kw_evcs?: number | null;  // EV charger power (EVCS only)
  phase?: Phase | null;     // supply phase (EVCS only)
  econ?: EconAssumptions | null; // LCOE / NPV / IRR assumptions (on-grid & hybrid)
}

export const PROJECT_TYPES: { key: ProjectType; label: string }[] = [
  { key: 'on_grid',     label: 'PV On-Grid' },
  { key: 'hybrid_bess', label: 'PV Hybrid + BESS' },
  { key: 'off_grid',    label: 'PV Off-Grid' },
  { key: 'evcs',        label: 'EV Charging Station' },
  { key: 'custom',      label: 'Custom / Other' },
];

/** Whether this project type uses the PV capacity fields (DC/AC/BESS). */
export const isSolarType = (t: ProjectType | string | null | undefined) =>
  t === 'on_grid' || t === 'hybrid_bess' || t === 'off_grid';

const PHASE_LABEL: Record<Phase, string> = { single: 'Single-Phase', triple: 'Three-Phase' };

function trimNum(v: number): string {
  return Number.isInteger(v) ? String(v) : String(Math.round(v * 100) / 100);
}

/**
 * Format a capacity: 1800 kWp → "1.8 MWp", 750 kW → "750 kW".
 * decimalComma renders Indonesian style ("1,8 MWp") for prose.
 */
export function fmtCap(value: number, unit: 'kWp' | 'kW' | 'kWh', decimalComma = false): string {
  let v = value;
  let u: string = unit;
  if (value >= 1000) { v = value / 1000; u = 'M' + unit.slice(1); }
  let s = trimNum(v);
  if (decimalComma) s = s.replace('.', ',');
  return `${s} ${u}`;
}

/** Composed prose description, matching the house style. Empty for custom. */
export function composeDescription(type: ProjectType, specs: SystemSpecs, location: string): string {
  if (type === 'custom') return '';
  const loc = location.trim() ? `, at ${location.trim()}` : '';
  if (type === 'evcs') {
    const kw = specs.kw_evcs ? fmtCap(specs.kw_evcs, 'kW', true) : '… kW';
    const phase = specs.phase ? `, ${PHASE_LABEL[specs.phase]}` : '';
    return `EPC for EV Charging Station ${kw}${phase}${loc}`;
  }
  const dc = specs.kwp_dc ? fmtCap(specs.kwp_dc, 'kWp', true) : '… kWp';
  const ac = specs.kw_ac ? fmtCap(specs.kw_ac, 'kW', true) : '… kW';
  if (type === 'on_grid') {
    return `EPC for PV On-Grid ${dc} DC / ${ac} AC${loc}`;
  }
  if (type === 'hybrid_bess') {
    // Inverter (AC) and PCS are alternative power-conversion paths — a hybrid
    // may use only PCS. Show each only when entered, so there's no blank
    // "… kW AC" segment when the inverter isn't part of the system.
    const bess = specs.kwh_bess ? fmtCap(specs.kwh_bess, 'kWh', true) : '… kWh';
    const seg: string[] = [`${dc} DC`];
    if (specs.kw_ac) seg.push(`${fmtCap(specs.kw_ac, 'kW', true)} AC`);
    const storage = specs.kw_pcs ? `${fmtCap(specs.kw_pcs, 'kW', true)} ${bess} BESS` : `${bess} BESS`;
    seg.push(storage);
    return `EPC for PV Hybrid ${seg.join(' / ')}${loc}`;
  }
  // off_grid
  const bess = specs.kwh_bess ? fmtCap(specs.kwh_bess, 'kWh', true) : '… kWh';
  return `EPC for PV Off-Grid ${dc} DC / ${ac} AC / ${bess} BESS${loc}`;
}

/** Compact filename tag, e.g. "Hybrid-1.8MWpDC-1.5MWAC-750kWPCS-1.53MWhBESS". */
export function specFileTag(type: ProjectType | string | null | undefined, specs: SystemSpecs): string {
  if (type === 'evcs') {
    const bits = ['EVCS'];
    if (specs.kw_evcs) bits.push(fmtCap(specs.kw_evcs, 'kW').replace(' ', ''));
    if (specs.phase) bits.push(specs.phase === 'triple' ? '3ph' : '1ph');
    return bits.join('-');
  }
  const names: Record<string, string> = { on_grid: 'OnGrid', hybrid_bess: 'Hybrid', off_grid: 'OffGrid' };
  const name = type ? names[type] : undefined;
  if (!name) return '';
  const bits: string[] = [name];
  if (specs.kwp_dc) bits.push(fmtCap(specs.kwp_dc, 'kWp').replace(' ', '') + 'DC');
  if (specs.kw_ac) bits.push(fmtCap(specs.kw_ac, 'kW').replace(' ', '') + 'AC');
  if (type === 'hybrid_bess' && specs.kw_pcs) bits.push(fmtCap(specs.kw_pcs, 'kW').replace(' ', '') + 'PCS');
  if (type !== 'on_grid' && specs.kwh_bess) bits.push(fmtCap(specs.kwh_bess, 'kWh').replace(' ', '') + 'BESS');
  return bits.join('-');
}
