/**
 * Project works and manpower — category 10 of the standard layout and the
 * 'Jasa' sheet of the EPC workbooks (docs/epc-bom/WORKBOOK_STUDY.md §1–3).
 *
 * PROJECT WORKS. Each item (site survey, site office, scaffolding, CAR
 * insurance …) is priced one of four ways:
 *
 *   lump     a sum
 *   month    rate × project months           (rentals, site management)
 *   wp       rate × plant Wp                 (cleaning after installation)
 *   percent  rate % × the total of every OTHER row (insurance)
 *
 * and the BOM row reads the item's cost (costKey 'works.<id>.cost', qty 1).
 * A percent item is worked out on the rows that are not percent items, so it
 * can never feed on itself — the circular "1.35 % of the grand total" of one
 * workbook — and an insurance left at Rp 0 shows as "not priced", not as a
 * quiet zero (one rooftop bid carried CAR insurance and its warehouse at 0).
 *
 * MANPOWER. The crew, costed bottom-up: people × days × day rate, a role's
 * days either typed or the whole project (months × working days). It is a
 * CROSS-CHECK, not a price: the BOM sells installation per row; the crew says
 * what that work costs. One workbook sold Rp 1,841 m of installation against
 * Rp 1,762 m of manpower — Rp 79 m apart, never compared on the sheet. Here
 * the two sit side by side, per category where a role names one, and an
 * installation sold below its labour cost is flagged.
 */
import type { Check } from './dc.ts';

export type WorksBasis = 'lump' | 'month' | 'wp' | 'percent';

export interface WorksItem {
  id: string;
  label: string;
  basis: WorksBasis;
  /** Rp (lump), Rp a month, Rp/Wp, or % for percent. Null = not priced yet. */
  rate: number | null;
}

export interface CrewRole {
  id: string;
  label: string;
  /** BOM category the work belongs to ('' = the whole project), for the per-category check. */
  category: string;
  people: number;
  /** Days on site; null = the whole project. */
  days: number | null;
  dayRate: number | null;
}

export interface WorksSettings {
  durationMonths: number;
  workingDaysPerMonth: number;
}

export interface WorksDoc {
  items: WorksItem[];
  crew: CrewRole[];
  settings: WorksSettings;
}

/** Working figures — the engineers set their own. */
export const WORKS_DEFAULTS: WorksSettings = { durationMonths: 4, workingDaysPerMonth: 26 };

/** The project-works items the standard layout prices; ids are what the template's rows read. */
export const STANDARD_WORKS_ITEMS: WorksItem[] = [
  { id: 'survey', label: 'Site survey', basis: 'lump', rate: null },
  { id: 'hse', label: 'HSE, safety signs, safety equipment, temporary walkway', basis: 'month', rate: null },
  { id: 'warehouse', label: 'Temporary warehouse', basis: 'month', rate: null },
  { id: 'office', label: 'Temporary site office', basis: 'month', rate: null },
  { id: 'scaffolding', label: 'Scaffolding', basis: 'month', rate: null },
  { id: 'machinery', label: 'Heavy machinery', basis: 'lump', rate: null },
  { id: 'civil', label: 'Civil works, if required', basis: 'lump', rate: null },
  { id: 'management', label: 'Site management, supervision and reporting', basis: 'month', rate: null },
  { id: 'liaison', label: 'Liaisoning with authorities', basis: 'lump', rate: null },
  { id: 'cleaning', label: 'Complete PV module cleaning after installation', basis: 'wp', rate: null },
  { id: 'insurance', label: 'Construction All Risk (CAR) insurance incl. third-party liability', basis: 'percent', rate: null },
  { id: 'design', label: 'Overall engineering design', basis: 'lump', rate: null },
  { id: 'commissioning', label: 'Overall commissioning', basis: 'lump', rate: null },
];

export function newWorksDoc(): WorksDoc {
  return { items: STANDARD_WORKS_ITEMS.map((i) => ({ ...i })), crew: [], settings: { ...WORKS_DEFAULTS } };
}

export interface WorksItemResult {
  id: string;
  label: string;
  basis: WorksBasis;
  /** Cost, IDR. A percent item reads 0 here until priceWorksPercent fills it. */
  cost: number;
  priced: boolean;
}

export interface CrewRoleResult {
  id: string;
  label: string;
  category: string;
  days: number;
  manDays: number;
  /** Null while the role has people but no day rate. */
  cost: number | null;
}

export interface WorksResult {
  items: WorksItemResult[];
  crew: CrewRoleResult[];
  months: number;
  projectDays: number;
  manDays: number;
  /** Σ priced roles, IDR. */
  labourCost: number;
  /** Set by crossCheckLabour once the BOM is priced. */
  crossCheck: LabourCheck | null;
  inputs: { plantWp: number };
  settings: WorksSettings;
  checks: Check[];
}

export interface LabourCheck {
  /** Installation sold, Σ every row's installation total. */
  installSold: number;
  labourCost: number;
  /** (installation sold − labour cost) ÷ installation sold, %; null when nothing is sold. */
  marginPct: number | null;
  byCategory: { category: string; installSold: number; labourCost: number }[];
}

const round2 = (n: number) => Math.round(n * 100) / 100;

export function calculateWorks(w: WorksDoc, inp: { plantWp: number }): WorksResult {
  const st = { ...WORKS_DEFAULTS, ...w.settings };
  const checks: Check[] = [];
  const months = Math.max(0, st.durationMonths);
  const projectDays = round2(months * Math.max(0, st.workingDaysPerMonth));
  const plantWp = Math.max(0, inp.plantWp);

  const items = w.items.map((it): WorksItemResult => {
    const r = it.rate;
    const priced = r != null && r > 0;
    let cost = 0;
    if (r != null) {
      if (it.basis === 'lump') cost = r;
      else if (it.basis === 'month') cost = r * months;
      else if (it.basis === 'wp') cost = r * plantWp;
    }
    if (it.basis === 'month' && priced && months === 0) checks.push({ level: 'warn', where: it.label || 'Project works', message: 'Priced per month, but the project duration is 0 months.' });
    return { id: it.id, label: it.label, basis: it.basis, cost: round2(Math.max(0, cost)), priced };
  });

  const crew = w.crew.map((c): CrewRoleResult => {
    const people = Math.max(0, c.people || 0);
    const days = c.days == null ? projectDays : Math.max(0, c.days);
    const manDays = round2(people * days);
    if (manDays > 0 && c.dayRate == null) checks.push({ level: 'warn', where: c.label || 'Crew role', message: `${manDays} man-days with no day rate — the labour cross-check leaves them out.` });
    return { id: c.id, label: c.label, category: c.category, days, manDays, cost: c.dayRate == null ? null : round2(manDays * c.dayRate) };
  });

  return {
    items, crew, months, projectDays,
    manDays: round2(crew.reduce((a, c) => a + c.manDays, 0)),
    labourCost: round2(crew.reduce((a, c) => a + (c.cost ?? 0), 0)),
    crossCheck: null, inputs: { plantWp }, settings: st, checks,
  };
}

/** Percent items, priced on the total of every row that does not read a percent item. */
export function priceWorksPercent(w: WorksDoc, res: WorksResult, baseTotal: number): void {
  for (const r of res.items) {
    if (r.basis !== 'percent') continue;
    const rate = w.items.find((i) => i.id === r.id)?.rate ?? null;
    r.cost = rate == null ? 0 : round2(Math.max(0, rate) / 100 * Math.max(0, baseTotal));
  }
}

/**
 * Installation sold against what the crew costs — overall and per category
 * where a role names one. Selling the work below its labour cost is an error;
 * the rest is information the engineer reads.
 */
export function crossCheckLabour(res: WorksResult, install: { total: number; byCategory: Record<string, number> }, categoryLabel: (key: string) => string): LabourCheck {
  const checks = res.checks;
  const byCat = new Map<string, number>();
  for (const c of res.crew) if (c.category && c.cost != null) byCat.set(c.category, (byCat.get(c.category) ?? 0) + c.cost);
  const byCategory = [...byCat.entries()].map(([category, labourCost]) => ({ category, installSold: round2(install.byCategory[category] ?? 0), labourCost: round2(labourCost) }));
  const lc: LabourCheck = {
    installSold: round2(install.total), labourCost: res.labourCost,
    marginPct: install.total > 0 ? round2((install.total - res.labourCost) / install.total * 100) : null,
    byCategory,
  };
  if (res.labourCost > 0) {
    if (install.total < res.labourCost) {
      checks.push({ level: 'error', where: 'Manpower', message: `Installation is sold at Rp ${Math.round(install.total).toLocaleString('en-US')} but the crew costs Rp ${Math.round(res.labourCost).toLocaleString('en-US')} — the work is sold below its labour cost.` });
    } else {
      checks.push({ level: 'ok', where: 'Manpower', message: `Installation sold Rp ${Math.round(install.total).toLocaleString('en-US')} against a crew cost of Rp ${Math.round(res.labourCost).toLocaleString('en-US')} (${lc.marginPct} % above).` });
    }
    for (const b of byCategory) {
      if (b.installSold < b.labourCost) checks.push({ level: 'warn', where: categoryLabel(b.category), message: `Installation in this category is sold at Rp ${Math.round(b.installSold).toLocaleString('en-US')}, below its crew cost of Rp ${Math.round(b.labourCost).toLocaleString('en-US')}.` });
    }
  }
  res.crossCheck = lc;
  return lc;
}
