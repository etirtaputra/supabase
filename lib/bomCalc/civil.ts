/**
 * Civil works and O&M — the walkway, lifeline, water-cleaning, grounding-pit
 * and inverter-station rows, and the operation & maintenance years, from the
 * per-metre recipes and the O&M sheets of the EPC workbooks
 * (docs/epc-bom/WORKBOOK_STUDY.md §2–3).
 *
 * CIVIL. Metres per roof/area are typed off the layout and bought with a
 * waste factor (the sheets: × 1.01). Each item has a recipe:
 *
 *   walkway   panels   = ROUNDUP(metres ÷ panel length 2.4 m), supports = panels × per panel
 *   lifeline  anchors  : end = ROUNDUP(L ÷ 30), intermediate = ROUNDUP(L ÷ 6) − end
 *   water     pipe metres; one pump + tank set where there is pipe
 *
 * and the recipe's parts turn into ONE cost per bought metre, which the BOM
 * row reads (costKey). Quantity and cost come from the same metres, so the
 * workbook fault of costing a lifeline on 3,008 m and dividing it by
 * 4,361 m cannot happen; nor can a walkway computed at 969 m with its BOM
 * quantity left blank — the row reads the metres.
 *
 * Grounding pits = inverters × per inverter + extra; inverter stations =
 * ROUNDUP(inverters ÷ inverters per station).
 *
 * O&M. Each item is priced per year — either per visit at Rp/Wp × plant Wp
 * × visits a year, or a lump per year — and escalates every year. The years
 * included in the EPC price feed the BOM (qty = years, cost = the average
 * year, so qty × cost = the escalated total exactly). A SEPARATE long-term
 * O&M contract starts the year after them, at the escalated price, so the
 * same year is never sold twice. One visits figure drives both what is sold
 * and what is costed (one workbook sold cleaning 4× a year and costed it 2×).
 */
import type { Check } from './dc.ts';

export interface CivilArea {
  id: string;
  label: string;
  /** Metres off the layout, before waste. */
  walkwayM: number;
  lifelineM: number;
  pipeM: number;
}

export interface CivilSettings {
  /** Bought metres = layout metres × this (the sheets: 1.01). */
  wasteFactor: number;
  walkwayPanelM: number;
  supportsPerPanel: number;
  /** Costs, IDR each (per metre for wire). Null = not priced yet. */
  walkwayPanelCost: number | null;
  walkwaySupportCost: number | null;
  lifelineEndEveryM: number;
  lifelineIntEveryM: number;
  lifelineWireCostPerM: number | null;
  lifelineEndAnchorCost: number | null;
  lifelineIntAnchorCost: number | null;
  /** Pump + tank sets where there is water pipe. */
  pumpSets: number;
  pitsPerInverter: number;
  pitsExtra: number;
  invertersPerStation: number;
}

export interface OmItem {
  id: string;
  label: string;
  /** 'wpVisit' = rate is Rp/Wp per visit × plant Wp × visits a year; 'year' = rate is Rp a year. */
  basis: 'wpVisit' | 'year';
  rate: number | null;
  visitsPerYear: number;
}

export interface OmSettings {
  /** Years of O&M inside the EPC price (the BOM rows). */
  includedYears: number;
  /** Price rise per year, %. */
  escalationPct: number;
  /** Years of a separate long-term O&M contract, starting after the included years. 0 = none. */
  contractYears: number;
}

export interface CivilDoc {
  areas: CivilArea[];
  settings: CivilSettings;
  om: { items: OmItem[]; settings: OmSettings };
}

/**
 * Recorded from the workbooks: waste × 1.01, ZAM walkway panels of 2.4 m,
 * lifeline end anchors every 30 m and intermediate every 6 m. Supports per
 * panel, pump sets, pits per inverter and inverters per station were not
 * recorded — working figures for the engineers to confirm.
 */
export const CIVIL_DEFAULTS: CivilSettings = {
  wasteFactor: 1.01, walkwayPanelM: 2.4, supportsPerPanel: 2, walkwayPanelCost: null, walkwaySupportCost: null,
  lifelineEndEveryM: 30, lifelineIntEveryM: 6, lifelineWireCostPerM: null, lifelineEndAnchorCost: null, lifelineIntAnchorCost: null,
  pumpSets: 1, pitsPerInverter: 1, pitsExtra: 0, invertersPerStation: 1,
};

export const OM_DEFAULTS: OmSettings = { includedYears: 1, escalationPct: 0, contractYears: 0 };

/** The O&M items the standard layout prices; ids are what the template's rows link to. */
export const STANDARD_OM_ITEMS: OmItem[] = [
  { id: 'cleaning', label: 'Periodic module cleaning', basis: 'wpVisit', rate: null, visitsPerYear: 4 },
  { id: 'pm', label: 'Preventive and corrective maintenance', basis: 'year', rate: null, visitsPerYear: 0 },
  { id: 'k3l', label: 'Periodic inspection AC combiner box (K3L)', basis: 'year', rate: null, visitsPerYear: 0 },
  { id: 'report', label: 'Monthly report including performance analysis', basis: 'year', rate: null, visitsPerYear: 0 },
];

export function newCivilDoc(): CivilDoc {
  return { areas: [], settings: { ...CIVIL_DEFAULTS }, om: { items: STANDARD_OM_ITEMS.map((i) => ({ ...i })), settings: { ...OM_DEFAULTS } } };
}

export interface CivilAreaResult {
  id: string;
  label: string;
  walkwayM: number;
  walkwayPanels: number;
  lifelineM: number;
  endAnchors: number;
  intAnchors: number;
  pipeM: number;
}

export interface OmItemResult {
  id: string;
  label: string;
  /** Year-1 cost, IDR; null while unpriced. */
  firstYear: number | null;
  /** Cost per included year, escalated (index 0 = year 1). */
  years: number[];
  /** Σ over the included years. */
  total: number;
  /** The average included year — the BOM row's cost per 'year'. */
  perYear: number;
  /** Visits over the included years. */
  visits: number;
}

export interface CivilResult {
  areas: CivilAreaResult[];
  walkwayM: number;
  walkwayPanels: number;
  walkwaySupports: number;
  walkwayCost: number | null;
  walkwayCostPerM: number | null;
  lifelineM: number;
  endAnchors: number;
  intAnchors: number;
  lifelineCost: number | null;
  lifelineCostPerM: number | null;
  pipeM: number;
  pumps: number;
  pits: number;
  stations: number;
  om: {
    items: OmItemResult[];
    includedYears: number;
    /** Σ every item over the included years. */
    total: number;
    /** The separate contract: first and last year number, and its total. */
    contract: { fromYear: number; toYear: number; firstYear: number; total: number } | null;
  };
  /** Inputs read from the rest of the calculation, for the explanations. */
  inputs: { inverters: number; plantWp: number };
  settings: CivilSettings;
  omSettings: OmSettings;
  checks: Check[];
}

const round2 = (n: number) => Math.round(n * 100) / 100;
const up = (n: number) => Math.ceil(n - 1e-9);

/** A cost that needs every part priced: null as soon as a used part is not. */
function partsCost(parts: [qty: number, cost: number | null][]): number | null {
  let sum = 0;
  for (const [q, c] of parts) {
    if (q <= 0) continue;
    if (c == null) return null;
    sum += q * c;
  }
  return round2(sum);
}

export function calculateCivil(cv: CivilDoc, inp: { inverters: number; plantWp: number }): CivilResult {
  const st = { ...CIVIL_DEFAULTS, ...cv.settings };
  const os = { ...OM_DEFAULTS, ...cv.om.settings };
  const checks: Check[] = [];
  const waste = st.wasteFactor > 0 ? st.wasteFactor : 1;
  const panelM = st.walkwayPanelM > 0 ? st.walkwayPanelM : 2.4;
  const endEvery = st.lifelineEndEveryM > 0 ? st.lifelineEndEveryM : 30;
  const intEvery = st.lifelineIntEveryM > 0 ? st.lifelineIntEveryM : 6;

  // ── Per area ──
  const areas = cv.areas.map((a): CivilAreaResult => {
    const walkwayM = round2(Math.max(0, a.walkwayM || 0) * waste);
    const L = Math.max(0, a.lifelineM || 0);
    const endAnchors = L > 0 ? up(L / endEvery) : 0;
    const intAnchors = L > 0 ? Math.max(0, up(L / intEvery) - endAnchors) : 0;
    return {
      id: a.id, label: a.label, walkwayM, walkwayPanels: walkwayM > 0 ? up(walkwayM / panelM) : 0,
      lifelineM: round2(L * waste), endAnchors, intAnchors, pipeM: round2(Math.max(0, a.pipeM || 0) * waste),
    };
  });
  const sum = (f: (a: CivilAreaResult) => number) => areas.reduce((s, a) => s + f(a), 0);
  const walkwayM = round2(sum((a) => a.walkwayM));
  const walkwayPanels = sum((a) => a.walkwayPanels);
  const walkwaySupports = up(walkwayPanels * Math.max(0, st.supportsPerPanel));
  const lifelineM = round2(sum((a) => a.lifelineM));
  const endAnchors = sum((a) => a.endAnchors);
  const intAnchors = sum((a) => a.intAnchors);
  const pipeM = round2(sum((a) => a.pipeM));

  // Cost per bought metre — the recipe's parts over the SAME metres the row buys.
  const walkwayCost = walkwayM > 0 ? partsCost([[walkwayPanels, st.walkwayPanelCost], [walkwaySupports, st.walkwaySupportCost]]) : null;
  const lifelineCost = lifelineM > 0 ? partsCost([[lifelineM, st.lifelineWireCostPerM], [endAnchors, st.lifelineEndAnchorCost], [intAnchors, st.lifelineIntAnchorCost]]) : null;
  const walkwayCostPerM = walkwayCost != null && walkwayM > 0 ? round2(walkwayCost / walkwayM) : null;
  const lifelineCostPerM = lifelineCost != null && lifelineM > 0 ? round2(lifelineCost / lifelineM) : null;
  if (walkwayM > 0 && walkwayCost == null) checks.push({ level: 'warn', where: 'Walkway', message: 'Panel or support cost missing, so the walkway cost per metre cannot be worked out.' });
  if (lifelineM > 0 && lifelineCost == null) checks.push({ level: 'warn', where: 'Lifeline', message: 'Wire or anchor cost missing, so the lifeline cost per metre cannot be worked out.' });

  const inverters = Math.max(0, inp.inverters);
  const pumps = pipeM > 0 ? Math.max(0, st.pumpSets) : 0;
  const pits = up(inverters * Math.max(0, st.pitsPerInverter) + Math.max(0, st.pitsExtra));
  const stations = inverters > 0 ? up(inverters / Math.max(1, st.invertersPerStation)) : 0;

  // ── O&M ──
  const esc = Math.max(0, os.escalationPct) / 100;
  const n = Math.max(0, Math.floor(os.includedYears));
  const plantWp = Math.max(0, inp.plantWp);
  const items = cv.om.items.map((it): OmItemResult => {
    const visits = Math.max(0, it.visitsPerYear);
    const firstYear = it.rate == null ? null : round2(it.basis === 'wpVisit' ? it.rate * plantWp * visits : it.rate);
    const years = Array.from({ length: n }, (_, y) => round2((firstYear ?? 0) * (1 + esc) ** y));
    const total = round2(years.reduce((a, b) => a + b, 0));
    if (it.basis === 'wpVisit' && it.rate != null && visits === 0) checks.push({ level: 'warn', where: it.label || 'O&M item', message: 'Priced per visit, but 0 visits a year — it adds nothing.' });
    return { id: it.id, label: it.label, firstYear, years, total, perYear: n > 0 ? round2(total / n) : 0, visits: it.basis === 'wpVisit' ? visits * n : 0 };
  });
  const omTotal = round2(items.reduce((a, i) => a + i.total, 0));
  let contract: CivilResult['om']['contract'] = null;
  const cy = Math.max(0, Math.floor(os.contractYears));
  if (cy > 0) {
    const first = items.reduce((a, i) => a + (i.firstYear ?? 0), 0);
    let total = 0;
    for (let y = n; y < n + cy; y++) total += first * (1 + esc) ** y;
    contract = { fromYear: n + 1, toYear: n + cy, firstYear: round2(first * (1 + esc) ** n), total: round2(total) };
  }

  return {
    areas, walkwayM, walkwayPanels, walkwaySupports, walkwayCost, walkwayCostPerM,
    lifelineM, endAnchors, intAnchors, lifelineCost, lifelineCostPerM, pipeM, pumps, pits, stations,
    om: { items, includedYears: n, total: omTotal, contract },
    inputs: { inverters, plantWp }, settings: st, omSettings: os, checks,
  };
}
