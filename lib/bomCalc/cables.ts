/**
 * Cable data for the BOM calculator (lib/bomCalc).
 *
 * RESISTANCE comes from the standard, not from a catalogue: IEC 60228 maximum
 * DC resistance of the conductor at 20 °C, Ω/km. Class 2 (stranded) for AC
 * power cable — copper (NYY, NYA, N2XSY) and aluminium (NA2XY, NAYY) — and
 * class 5 tinned copper for PV cable (H1Z2Z2-K). The engineers' own sheets
 * used exactly these: 5.09 / 3.39 / 1.95 Ω/km for 4 / 6 / 10 mm² PV cable, and
 * 0.325 Ω/km for NA2XY 120 mm², which is 0.253 at 20 °C corrected to 90 °C.
 *
 * AMPACITY is NOT here. It depends on the maker's catalogue and the way the
 * cable is laid, and the workbooks typed it from Jembo/KMI tables — sometimes
 * two different numbers for the same cable. The calculator asks for it beside
 * the cable choice and does the check itself; it never invents a rating.
 */

export type ConductorMaterial = 'cu' | 'al';

/** IEC 60228 class 2, Ω/km at 20 °C. */
const R20_CLASS2: Record<ConductorMaterial, Record<number, number>> = {
  cu: { 1.5: 12.1, 2.5: 7.41, 4: 4.61, 6: 3.08, 10: 1.83, 16: 1.15, 25: 0.727, 35: 0.524, 50: 0.387, 70: 0.268, 95: 0.193, 120: 0.153, 150: 0.124, 185: 0.0991, 240: 0.0754, 300: 0.0601, 400: 0.047, 500: 0.0366, 630: 0.0283 },
  al: { 16: 1.91, 25: 1.2, 35: 0.868, 50: 0.641, 70: 0.443, 95: 0.32, 120: 0.253, 150: 0.206, 185: 0.164, 240: 0.125, 300: 0.1, 400: 0.0778, 500: 0.0605, 630: 0.0469 },
};

/** IEC 60228 class 5 tinned copper (PV cable), Ω/km at 20 °C. */
const R20_PV: Record<number, number> = { 1.5: 13.7, 2.5: 8.21, 4: 5.09, 6: 3.39, 10: 1.95, 16: 1.24, 25: 0.795, 35: 0.565 };

/** Temperature coefficient of resistance, per °C. */
const ALPHA: Record<ConductorMaterial, number> = { cu: 0.00393, al: 0.00403 };

export const AC_SIZES_MM2 = [16, 25, 35, 50, 70, 95, 120, 150, 185, 240, 300, 400, 500, 630] as const;
export const PV_SIZES_MM2 = [4, 6, 10, 16] as const;

/** Ω/km of an AC power conductor at the given conductor temperature. Null for a size the standard does not list. */
export function acResistance(material: ConductorMaterial, sizeMm2: number, conductorTempC = 20): number | null {
  const r20 = R20_CLASS2[material][sizeMm2];
  if (r20 == null) return null;
  return r20 * (1 + ALPHA[material] * (conductorTempC - 20));
}

/** Ω/km of a PV string conductor at 20 °C — the value the engineers' 4 % rule uses. */
export function pvResistance(sizeMm2: number): number | null {
  return R20_PV[sizeMm2] ?? null;
}

/**
 * The cable families the sheets use, with their conductor and the
 * temperature their resistance is taken at (PVC 70 °C, XLPE 90 °C).
 */
export const CABLE_TYPES = {
  NYY: { material: 'cu', insulation: 'PVC', maxTempC: 70, label: 'NYY (Cu, PVC)' },
  N2XY: { material: 'cu', insulation: 'XLPE', maxTempC: 90, label: 'N2XY (Cu, XLPE)' },
  NA2XY: { material: 'al', insulation: 'XLPE', maxTempC: 90, label: 'NA2XY (Al, XLPE)' },
  NAYY: { material: 'al', insulation: 'PVC', maxTempC: 70, label: 'NAYY (Al, PVC)' },
  NYA: { material: 'cu', insulation: 'PVC', maxTempC: 70, label: 'NYA (Cu, earth)' },
  N2XSY: { material: 'cu', insulation: 'XLPE', maxTempC: 90, label: 'N2XSY (Cu, MV)' },
  NA2XSY: { material: 'al', insulation: 'XLPE', maxTempC: 90, label: 'NA2XSY (Al, MV)' },
} as const satisfies Record<string, { material: ConductorMaterial; insulation: string; maxTempC: number; label: string }>;
export type CableType = keyof typeof CABLE_TYPES;
