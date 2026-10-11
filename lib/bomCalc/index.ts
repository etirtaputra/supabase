/**
 * BOM calculator — the advanced EPC costing that replaces the engineers'
 * multi-sheet Excel workbooks (owner, 2026-10-11: "when manually linked, my
 * engineers often missed linking to the right formula or even missing rows or
 * columns"). One document holds every input; `computeBomCalc` derives every
 * quantity, price, total and check from it. Nothing is typed twice.
 *
 * Runs beside the existing EPC proposals and never writes to them.
 * Study of the source workbooks: docs/epc-bom/WORKBOOK_STUDY.md.
 */
import { calculateDc, DC_DEFAULTS, type Check, type DcResult, type DcSettings, type InverterGroup, type ModuleSpec, type RoofRun } from './dc.ts';
import { calculateAc, AC_DEFAULTS, type AcResult, type AcSegment, type AcSettings } from './ac.ts';
import { priceBom, type BomRow, type BomTotals, type PricedRow } from './bom.ts';
import { CABLE_TYPES, type CableType } from './cables.ts';
import { standardRows } from './template.ts';
import { describeKey, unusedKeys, type SourceTab } from './links.ts';

export type { Check, ModuleSpec, InverterGroup, RoofRun, AcSegment, BomRow, PricedRow, BomTotals, DcResult, AcResult };

export interface BomCalcDoc {
  version: 1;
  /** 'standard' (older documents may still say 'hon_chuan' — the same layout). */
  template: 'standard' | 'hon_chuan';
  project: { customer: string; location: string; defaultMargin: number; ppnPct: number; targetPerWp: number | null };
  module: ModuleSpec & { componentId: string | null };
  inverterGroups: (InverterGroup & { componentId: string | null })[];
  roofs: RoofRun[];
  dc: DcSettings;
  acSegments: AcSegment[];
  ac: AcSettings;
  rows: BomRow[];
}

export interface BomCalcResult {
  dc: DcResult;
  ac: AcResult;
  /** Every value a BOM row can link to, by key. */
  values: Record<string, number>;
  rows: PricedRow[];
  totals: BomTotals;
  /** Plant size the per-Wp figures use. */
  plantWp: number;
  /** All checks, errors first. */
  checks: Check[];
}

export const EMPTY_MODULE: BomCalcDoc['module'] = { model: '', wp: 0, vocV: 0, vmpV: 0, iscA: 0, impA: 0, tempCoeffVocPct: null, maxSystemV: null, componentId: null };

const segment = (id: string, label: string, over: Partial<AcSegment>): AcSegment => ({
  id, label, circuits: 1, lengthM: 0, tailM: 0, currentA: 0, voltageV: 800, powerFactor: 0.9,
  cableType: 'NYY', sizeMm2: 185, runs: 1, neutrals: 0, ampacityA: null, k1: 0.94, k2: 1, k3: 1,
  pe: null, reactanceOhmKm: 0.08, ...over,
});

/** A new, empty calculation in the standard layout. */
export function newBomCalcDoc(): BomCalcDoc {
  return {
    version: 1,
    template: 'standard',
    project: { customer: '', location: '', defaultMargin: 0.11, ppnPct: 11, targetPerWp: null },
    module: { ...EMPTY_MODULE },
    inverterGroups: [],
    roofs: [],
    dc: { ...DC_DEFAULTS },
    acSegments: [
      segment('inv', 'Inverter → AC combiner', { pe: { cableType: 'NYA', sizeMm2: 95, count: 1 }, tailM: 1.5 }),
      segment('feeder', 'AC combiner → interconnection', { sizeMm2: 300, runs: 1, pe: { cableType: 'NYA', sizeMm2: 300, count: 1 } }),
      segment('mv', 'MV transformer → cubicle', { cableType: 'N2XSY', sizeMm2: 50, voltageV: 20000, circuits: 0 }),
    ],
    ac: { ...AC_DEFAULTS },
    rows: standardRows(),
  };
}

/** Cable family names as written in descriptions, longest first so "NA2XY" is not read as "NYY"-ish. */
const FAMILY_NAMES = (Object.keys(CABLE_TYPES) as CableType[]).sort((a, b) => b.length - a.length);
function familyIn(text: string): CableType | null {
  const up = ` ${text.toUpperCase()} `;
  for (const f of FAMILY_NAMES) if (new RegExp(`[^A-Z0-9]${f}[^A-Z0-9]`).test(up)) return f;
  return null;
}

export function computeBomCalc(doc: BomCalcDoc): BomCalcResult {
  const dc = calculateDc(doc.module, doc.inverterGroups, doc.roofs, doc.dc);
  const ac = calculateAc(doc.acSegments, doc.ac);

  const values: Record<string, number> = {
    'pv.modules': dc.modules, 'pv.strings': dc.strings, 'pv.wp': dc.wp, 'pv.kwp': dc.wp / 1000,
    'inv.count': dc.inverters, 'inv.kw': dc.acKw,
  };
  for (const g of doc.inverterGroups) values[`inv.${g.id}`] = g.count;
  for (const s of [4, 6, 10, 16]) {
    values[`dc.cable.${s}`] = dc.cableBySize[s] ?? 0;
    values[`dc.connectors.${s}`] = dc.connectorsBySize[s] ?? 0;
  }
  for (const s of ac.segments) {
    values[`ac.seg.${s.id}.phase`] = s.phaseM + s.neutralM;
    values[`ac.seg.${s.id}.pe`] = s.peM;
    values[`ac.seg.${s.id}.lugs`] = s.lugs;
  }
  for (const [k, m] of Object.entries(ac.metresByCable)) values[`ac.cable.${k}`] = m;
  for (const [size, n] of Object.entries(ac.lugsBySize)) values[`ac.lugs.${size}`] = n;

  const plantWp = dc.wp;
  const bom = priceBom(doc.rows, values, { defaultMargin: doc.project.defaultMargin, plantWp, ppnPct: doc.project.ppnPct });

  // A row that says one cable but is linked to another — the copper-vs-aluminium
  // mistake that swung one 2026-10 rooftop bid by about Rp 2 billion.
  const checks: Check[] = [...dc.checks, ...ac.checks, ...bom.checks];
  for (const r of doc.rows) {
    if (r.qty.mode !== 'link') continue;
    let linkedType: CableType | null = null;
    const seg = /^ac\.seg\.([^.]+)\.(phase|pe)$/.exec(r.qty.key);
    if (seg) {
      const s = doc.acSegments.find((x) => x.id === seg[1]);
      linkedType = s ? (seg[2] === 'pe' ? s.pe?.cableType ?? null : s.cableType) : null;
    } else {
      const fam = /^ac\.cable\.(\S+) /.exec(r.qty.key)?.[1];
      if (fam && fam in CABLE_TYPES) linkedType = fam as CableType;
    }
    const written = familyIn(`${r.description} ${r.remarks}`);
    if (linkedType && written && written !== linkedType) {
      checks.push({ level: 'error', where: r.description, message: `The row says ${written} but the design uses ${linkedType} (${CABLE_TYPES[linkedType].material === 'al' ? 'aluminium' : 'copper'}). Price the cable that is designed.` });
    }
  }
  // Designed but never priced: a result no BOM row reads.
  for (const k of unusedKeys(doc, values)) {
    const info = describeKey(doc, k);
    if (info) checks.push({ level: 'warn', where: info.label, message: `${Math.round(values[k] * 100) / 100} ${info.unit} calculated, but no BOM row takes it. Add a row and link it, or it is not in the price.` });
  }
  if (doc.project.targetPerWp && bom.totals.perWp != null) {
    const gap = bom.totals.perWp - doc.project.targetPerWp;
    if (Math.abs(gap) > 0.005 * doc.project.targetPerWp) {
      checks.push({ level: 'warn', where: 'Target price', message: `Rp ${bom.totals.perWp.toFixed(0)}/Wp against the target Rp ${doc.project.targetPerWp}/Wp (${gap > 0 ? '+' : ''}${gap.toFixed(0)}).` });
    }
  }
  const order = { error: 0, warn: 1, ok: 2 } as const;
  checks.sort((a, b) => order[a.level] - order[b.level]);
  return { dc, ac, values, rows: bom.rows, totals: bom.totals, plantWp, checks };
}

/** What a BOM row can link its quantity to — name, source tab, unit and today's value. */
export function linkOptions(doc: BomCalcDoc, res: BomCalcResult): { key: string; label: string; tab: SourceTab; unit: string; value: number }[] {
  const keys = ['pv.modules', 'pv.wp', 'pv.strings', 'inv.count', ...doc.inverterGroups.map((g) => `inv.${g.id}`)];
  for (const s of [4, 6, 10, 16]) if (res.values[`dc.cable.${s}`] > 0 || s === 4 || s === 6) keys.push(`dc.cable.${s}`, `dc.connectors.${s}`);
  for (const s of doc.acSegments) keys.push(`ac.seg.${s.id}.phase`, `ac.seg.${s.id}.pe`, `ac.seg.${s.id}.lugs`);
  keys.push(...Object.keys(res.ac.metresByCable).map((k) => `ac.cable.${k}`), ...Object.keys(res.ac.lugsBySize).map((k) => `ac.lugs.${k}`));
  return keys.flatMap((key) => {
    const info = key in res.values ? describeKey(doc, key) : null;
    return info ? [{ key, label: info.label, tab: info.tab, unit: info.unit, value: res.values[key] }] : [];
  });
}
