/**
 * AC side of the BOM calculator: inverter → combiner → service breaker →
 * transformer / interconnection — the 'Kabel AC' sheets of the EPC workbooks.
 *
 * Each SEGMENT is a set of identical circuits (e.g. "5 inverters, 18 m each").
 * From it come the metres of phase, neutral and earth conductor, the cable
 * lugs, and two checks the workbooks only ever wrote out by hand:
 *
 *  - ampacity: runs × catalogue rating × k1·k2·k3 ≥ 1.25 × circuit current.
 *    Hon Chuan's feeder conclusion was typed as "sufficient" against the
 *    under-rated figure; here the comparison is arithmetic, not prose.
 *  - voltage drop: ΔV = √3 · I · (R·cosφ + X·sinφ) · L / runs. The sheets
 *    left out sinφ on X (slightly pessimistic) and only ever checked the short
 *    inverter cable, never the long feeder.
 *
 * The rating comes from the catalogue the engineer is quoting from — it is an
 * input, never a number this file makes up (see cables.ts).
 */
import { acResistance, CABLE_TYPES, type CableType } from './cables.ts';
import type { Check } from './dc.ts';

export interface AcSegment {
  id: string;
  label: string;
  /** Identical circuits in this segment (inverters at this distance, or 1 feeder). */
  circuits: number;
  /** Route length of one circuit, m (one way). */
  lengthM: number;
  /** Extra per conductor for terminations and slack, m (the sheets: 1.5–4). */
  tailM: number;
  /** Current of ONE circuit at full output, A (inverter max AC current, or the sum it feeds). */
  currentA: number;
  /** Line-to-line voltage, V. */
  voltageV: number;
  powerFactor: number;
  cableType: CableType;
  sizeMm2: number;
  /** Parallel runs per phase. */
  runs: number;
  /** Neutral conductors per circuit (0 for a 3-wire inverter output). */
  neutrals: number;
  /** Catalogue current rating of ONE conductor as laid, A. */
  ampacityA: number | null;
  /** Derating: temperature, grouping, installation. */
  k1: number;
  k2: number;
  k3: number;
  /** Earth conductor per circuit; null = none in this segment. */
  pe: { cableType: CableType; sizeMm2: number; count: number } | null;
  /** Reactance, Ω/km (single-core trefoil ≈ 0.08). */
  reactanceOhmKm: number;
}

export interface AcSettings {
  /** Safety factor on the circuit current for sizing (PUIL: 125 %). */
  designFactor: number;
  /** Voltage-drop limit, % (PUIL: 3 %). */
  maxVdPct: number;
  /** Spare lugs on top of the counted ones, per size. */
  spareLugs: number;
}

export const AC_DEFAULTS: AcSettings = { designFactor: 1.25, maxVdPct: 3, spareLugs: 2 };

export interface AcSegmentResult {
  id: string;
  label: string;
  cable: string;
  phaseM: number;
  neutralM: number;
  peM: number;
  peCable: string | null;
  designCurrentA: number;
  capacityA: number | null;
  vdPct: number | null;
  lugs: number;
}

export interface AcResult {
  segments: AcSegmentResult[];
  /** Metres by "TYPE size" (e.g. "NYY 300"), phase + neutral + earth together. */
  metresByCable: Record<string, number>;
  lugsBySize: Record<number, number>;
  checks: Check[];
}

const round2 = (n: number) => Math.round(n * 100) / 100;
export const cableKey = (t: CableType, size: number) => `${t} ${size}`;

export function calculateAc(segments: AcSegment[], settings: Partial<AcSettings> = {}): AcResult {
  const st = { ...AC_DEFAULTS, ...settings };
  const checks: Check[] = [];
  const metresByCable: Record<string, number> = {};
  const lugsBySize: Record<number, number> = {};
  const add = (k: string, m: number) => { metresByCable[k] = round2((metresByCable[k] ?? 0) + m); };
  const addLugs = (size: number, n: number) => { lugsBySize[size] = (lugsBySize[size] ?? 0) + n; };

  const results = segments.map((s): AcSegmentResult => {
    const where = s.label || 'AC segment';
    const circuits = Math.max(0, s.circuits);
    const runs = Math.max(1, s.runs);
    const perConductor = Math.max(0, s.lengthM) + Math.max(0, s.tailM);
    const phaseM = round2(circuits * perConductor * 3 * runs);
    const neutralM = round2(circuits * perConductor * Math.max(0, s.neutrals));
    const key = cableKey(s.cableType, s.sizeMm2);
    add(key, phaseM + neutralM);
    const phaseConductors = circuits * (3 * runs + Math.max(0, s.neutrals));
    addLugs(s.sizeMm2, phaseConductors * 2);

    let peM = 0, peCable: string | null = null;
    if (s.pe && s.pe.count > 0) {
      peM = round2(circuits * perConductor * s.pe.count);
      peCable = cableKey(s.pe.cableType, s.pe.sizeMm2);
      add(peCable, peM);
      addLugs(s.pe.sizeMm2, circuits * s.pe.count * 2);
    }

    // ── Ampacity ──
    const designCurrentA = round2(s.currentA * st.designFactor);
    let capacityA: number | null = null;
    if (s.ampacityA != null && s.ampacityA > 0) {
      capacityA = round2(runs * s.ampacityA * s.k1 * s.k2 * s.k3);
      checks.push(capacityA < designCurrentA
        ? { level: 'error', where, message: `${runs} × ${key} carries ${capacityA} A after derating — below the ${designCurrentA} A needed (${st.designFactor} × ${s.currentA} A). Add a run or go up a size.` }
        : { level: 'ok', where, message: `${runs} × ${key}: ${capacityA} A ≥ ${designCurrentA} A.` });
    } else {
      checks.push({ level: 'warn', where, message: `No catalogue rating entered for ${key}, so its current capacity is not checked.` });
    }

    // ── Voltage drop ──
    let vdPct: number | null = null;
    const spec = CABLE_TYPES[s.cableType];
    const r = acResistance(spec.material, s.sizeMm2, spec.maxTempC);
    if (r == null) {
      checks.push({ level: 'warn', where, message: `${key}: no standard resistance for this size, so voltage drop is not checked.` });
    } else if (s.voltageV > 0 && s.lengthM > 0) {
      const pf = Math.min(1, Math.max(0, s.powerFactor));
      const sin = Math.sqrt(1 - pf * pf);
      const dv = Math.sqrt(3) * designCurrentA * (r * pf + s.reactanceOhmKm * sin) * (s.lengthM / 1000) / runs;
      vdPct = round2(dv / s.voltageV * 100);
      if (vdPct > st.maxVdPct) checks.push({ level: 'error', where, message: `Voltage drop ${vdPct} % over ${s.lengthM} m — above ${st.maxVdPct} %. Add a run or go up a size.` });
    }
    return { id: s.id, label: s.label, cable: key, phaseM, neutralM, peM, peCable, designCurrentA, capacityA, vdPct, lugs: phaseConductors * 2 };
  });

  for (const size of Object.keys(lugsBySize)) lugsBySize[Number(size)] += st.spareLugs;
  return { segments: results, metresByCable, lugsBySize, checks };
}
