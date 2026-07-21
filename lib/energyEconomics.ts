/**
 * Energy-economics engine for PV Project Quotes (on-grid & hybrid).
 *
 * Ports the "LCOE Calculator — On-Grid PV System" Google Sheet 1:1 so the
 * proposal PDF and the quote editor compute the same numbers the analysts
 * validated:
 *   - Year-1 generation = DC kWp × specific production (kWh/kWp/yr)
 *   - Performance: year 1 = 100% − first-year degradation, then compounding
 *     yearly degradation
 *   - PLN tariff escalates by tariff inflation each year
 *   - Annual savings = (PV generation + battery output) × that year's tariff
 *   - Hybrid battery: effective kWh/day dispatched, linear capacity
 *     degradation, contribution stops at battery lifetime
 *   - NPV at the hurdle rate, IRR, payback = first year cumulative ≥ 0
 *   - LCOE = Total CAPEX ÷ lifetime kWh (fixed over lifetime, per the sheet)
 *
 * CAPEX and DC kWp come live from the quote (subtotal excl. PPN, system
 * size) — the whole point is that a quote revision can never drift apart
 * from its economics page.
 */

export interface EconAssumptions {
  enabled?: boolean;               // include the economics page on the proposal PDF
  specific_production?: number;    // kWh/kWp/yr incl. system losses
  first_year_deg_pct?: number;     // initial output loss vs nameplate, %
  yearly_deg_pct?: number;         // annual performance loss, %/yr
  lifetime_years?: number;         // PV design life
  hurdle_rate_pct?: number;        // discount rate for NPV / IRR, %
  om_per_mwp_year?: number;        // O&M, IDR per MWp per year
  pln_tariff?: number;             // Rp/kWh today — scenario 1, the billed rate (with subsidy); drives the headline KPIs
  pln_tariff_label?: string;       // which PLN golongan the tariff came from ('' = custom)
  pln_tariff_alt?: number | null;  // optional scenario 2 (e.g. tarif dasar, without subsidy) for the comparison block
  pln_tariff_alt_label?: string;   // golongan label for scenario 2 ('' = custom)
  tariff_inflation_pct?: number;   // %/yr
  // Hybrid battery contribution (from the LCOS calculator)
  battery_kwh_day?: number;        // effective kWh dispatched per day
  battery_lifetime_years?: number; // whichever comes first: cycle life or warranty
  battery_deg_pct?: number;        // annual capacity degradation, %/yr
}

/**
 * Official PLN "tarif adjustment" per golongan — Triwulan III 2026
 * (July–September, unchanged from prior quarters per Kementerian ESDM).
 * Pre-populates the tariff picker; the user can always override with a
 * custom Rp/kWh (e.g. blended WBP/LWBP or a B2B PPA rate).
 */
export const PLN_TARIFF_PERIOD = 'Tarif Adjustment PLN · Triwulan III 2026 (Jul–Sep)';
export const PLN_TARIFF_OPTIONS: { label: string; value: number }[] = [
  { label: 'R-1/TR 900 VA RTM (rumah tangga)', value: 1352 },
  { label: 'R-1/TR 1.300–2.200 VA (rumah tangga)', value: 1444.70 },
  { label: 'R-2/TR 3.500–5.500 VA (rumah tangga)', value: 1699.53 },
  { label: 'R-3/TR ≥6.600 VA (rumah tangga besar)', value: 1699.53 },
  { label: 'B-2/TR 6.600 VA–200 kVA (bisnis)', value: 1444.70 },
  { label: 'B-3/TM >200 kVA (bisnis besar — tarif dasar)', value: 1114.74 },
  { label: 'I-3/TM >200 kVA (industri — tarif dasar)', value: 1114.74 },
  // What TM customers are actually billed after subsidy (LWBP block) — field-
  // confirmed Jul 2026. Savings should offset the BILLED rate, not the base.
  { label: 'B-3 / I-3 TM — LWBP setelah subsidi (billed)', value: 1035.78 },
  { label: 'I-4/TT ≥30.000 kVA (industri besar)', value: 996.74 },
  { label: 'P-1/TR 6.600 VA–200 kVA (pemerintah)', value: 1699.53 },
  { label: 'P-2/TM >200 kVA (pemerintah)', value: 1522.88 },
  { label: 'P-3/TR (penerangan jalan umum)', value: 1699.53 },
  { label: 'L/TR-TM-TT (layanan khusus)', value: 1644.52 },
];

export const ECON_DEFAULTS: Required<Pick<EconAssumptions,
  'specific_production' | 'first_year_deg_pct' | 'yearly_deg_pct' | 'lifetime_years' |
  'hurdle_rate_pct' | 'om_per_mwp_year' | 'pln_tariff' | 'tariff_inflation_pct'>> = {
  specific_production: 1440,
  first_year_deg_pct: 2.5,
  yearly_deg_pct: 0.7,
  lifetime_years: 25,
  hurdle_rate_pct: 10,
  om_per_mwp_year: 0,
  pln_tariff: 1699.53,
  tariff_inflation_pct: 2.5,
};

export interface EconYearRow {
  year: number;
  pvPerfPct: number;      // 0–100, '—' for year 0 in UI
  pvGenKwh: number;
  battOutKwh: number;
  tariff: number;         // Rp/kWh that year
  savings: number;        // Rp
  om: number;             // Rp
  net: number;            // Rp
  cumulative: number;     // Rp
}

export interface EconResult {
  years: EconYearRow[];
  npv: number;
  irr: number | null;       // decimal (0.26 = 26%); null if no sign change
  paybackYears: number | null;
  lifetimeKwh: number;      // PV + battery
  pvLifetimeKwh: number;
  battLifetimeKwh: number;
  costAvoided: number;      // Σ savings
  lcoe: number;             // Rp/kWh = CAPEX ÷ lifetime kWh
  lcoeVsTariff: number;     // lcoe − today's tariff (negative = cheaper than grid)
  economical: boolean;
  yr1GenKwh: number;        // nameplate year-1 generation (before degradation)
  pricePerWp: number;       // CAPEX ÷ (kWp × 1000)
}

export function computeEnergyEconomics(
  capexIdr: number,
  dcKwp: number,
  a: EconAssumptions,
  hybrid: boolean,
): EconResult | null {
  if (!(capexIdr > 0) || !(dcKwp > 0)) return null;
  const spec = a.specific_production ?? ECON_DEFAULTS.specific_production;
  const firstDeg = (a.first_year_deg_pct ?? ECON_DEFAULTS.first_year_deg_pct) / 100;
  const yearDeg = (a.yearly_deg_pct ?? ECON_DEFAULTS.yearly_deg_pct) / 100;
  const life = Math.max(1, Math.round(a.lifetime_years ?? ECON_DEFAULTS.lifetime_years));
  const hurdle = (a.hurdle_rate_pct ?? ECON_DEFAULTS.hurdle_rate_pct) / 100;
  const omYear = (a.om_per_mwp_year ?? ECON_DEFAULTS.om_per_mwp_year) * (dcKwp / 1000);
  const tariff0 = a.pln_tariff ?? ECON_DEFAULTS.pln_tariff;
  const infl = (a.tariff_inflation_pct ?? ECON_DEFAULTS.tariff_inflation_pct) / 100;
  const battKwhDay = hybrid ? (a.battery_kwh_day ?? 0) : 0;
  const battLife = a.battery_lifetime_years ?? 0;
  const battDeg = (a.battery_deg_pct ?? 0) / 100;
  if (!(spec > 0) || !(tariff0 > 0)) return null;

  const yr1Gen = dcKwp * spec;
  const years: EconYearRow[] = [{
    year: 0, pvPerfPct: 0, pvGenKwh: 0, battOutKwh: 0, tariff: tariff0,
    savings: 0, om: 0, net: -capexIdr, cumulative: -capexIdr,
  }];

  let perf = 1;
  let cumulative = -capexIdr;
  let pvKwh = 0, battKwh = 0, avoided = 0;
  for (let t = 1; t <= life; t++) {
    perf = t === 1 ? 1 - firstDeg : perf * (1 - yearDeg);
    const gen = yr1Gen * perf;
    const battPerf = battKwhDay > 0 && t <= battLife ? Math.max(0, 1 - battDeg * t) : 0;
    const batt = battKwhDay * 365 * battPerf;
    const tariff = tariff0 * Math.pow(1 + infl, t);
    const savings = (gen + batt) * tariff;
    const net = savings - omYear;
    cumulative += net;
    pvKwh += gen; battKwh += batt; avoided += savings;
    years.push({ year: t, pvPerfPct: perf * 100, pvGenKwh: gen, battOutKwh: batt, tariff, savings, om: omYear, net, cumulative });
  }

  const npv = years.reduce((s, r) => s + r.net / Math.pow(1 + hurdle, r.year), 0);
  const payback = years.find((r) => r.year > 0 && r.cumulative >= 0)?.year ?? null;
  const lifetimeKwh = pvKwh + battKwh;

  // IRR by bisection — cash flows start negative, so f(r) is decreasing in r
  let irr: number | null = null;
  const npvAt = (r: number) => years.reduce((s, x) => s + x.net / Math.pow(1 + r, x.year), 0);
  if (npvAt(-0.95) > 0 && npvAt(10) < 0) {
    let lo = -0.95, hi = 10;
    for (let i = 0; i < 80; i++) {
      const mid = (lo + hi) / 2;
      if (npvAt(mid) > 0) lo = mid; else hi = mid;
    }
    irr = (lo + hi) / 2;
  }

  const lcoe = lifetimeKwh > 0 ? capexIdr / lifetimeKwh : 0;
  return {
    years, npv, irr, paybackYears: payback,
    lifetimeKwh, pvLifetimeKwh: pvKwh, battLifetimeKwh: battKwh,
    costAvoided: avoided, lcoe,
    lcoeVsTariff: lcoe - tariff0,
    economical: lcoe < tariff0,
    yr1GenKwh: yr1Gen,
    pricePerWp: capexIdr / (dcKwp * 1000),
  };
}
