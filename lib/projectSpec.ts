/**
 * Structured project classification for quotes.
 *
 * The user picks a project type and fills in the capacity numbers for it;
 * the description ("EPC for PV Hybrid 1,8 MWp DC / … , at SITE"), the list
 * title, and the export filename are all generated from the same data so
 * they never drift apart.
 */

export type ProjectType = 'on_grid' | 'hybrid_bess' | 'off_grid' | 'custom';

export interface SystemSpecs {
  kwp_dc?: number | null;   // PV modules
  kw_ac?: number | null;    // on-grid inverters
  kw_pcs?: number | null;   // PCS (hybrid only)
  kwh_bess?: number | null; // BESS energy
}

export const PROJECT_TYPES: { key: ProjectType; label: string }[] = [
  { key: 'on_grid',     label: 'PV On-Grid' },
  { key: 'hybrid_bess', label: 'PV Hybrid + BESS' },
  { key: 'off_grid',    label: 'PV Off-Grid' },
  { key: 'custom',      label: 'Custom / Other' },
];

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
  const dc = specs.kwp_dc ? fmtCap(specs.kwp_dc, 'kWp', true) : '… kWp';
  const ac = specs.kw_ac ? fmtCap(specs.kw_ac, 'kW', true) : '… kW';
  if (type === 'on_grid') {
    return `EPC for PV On-Grid ${dc} DC / ${ac} AC${loc}`;
  }
  if (type === 'hybrid_bess') {
    const pcs = specs.kw_pcs ? fmtCap(specs.kw_pcs, 'kW', true) : '… kW';
    const bess = specs.kwh_bess ? fmtCap(specs.kwh_bess, 'kWh', true) : '… kWh';
    return `EPC for PV Hybrid ${dc} DC / ${ac} AC / ${pcs} ${bess} BESS${loc}`;
  }
  // off_grid
  const bess = specs.kwh_bess ? fmtCap(specs.kwh_bess, 'kWh', true) : '… kWh';
  return `EPC for PV Off-Grid ${dc} DC / ${ac} AC / ${bess} BESS${loc}`;
}

/** Compact filename tag, e.g. "Hybrid-1.8MWpDC-1.5MWAC-750kWPCS-1.53MWhBESS". */
export function specFileTag(type: ProjectType | string | null | undefined, specs: SystemSpecs): string {
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
