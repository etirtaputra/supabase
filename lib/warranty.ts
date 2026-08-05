/**
 * Structured warranty — the one clock After Sales runs on.
 *
 * An item carries up to two warranties (owner, 2026-08-06):
 *  - PRODUCT warranty (warranty_value/_unit): the claimable repair/replace
 *    period — the clock warranty judgement runs on.
 *  - PERFORMANCE warranty (perf_warranty_value/_unit): PV modules' output
 *    guarantee (e.g. 25–30 years) — informational, not a repair claim.
 * Units: years (the UI default) | months | days. The legacy free-text
 * `warranty` column remains as display fallback for items never re-edited.
 */

export type WarrantyUnit = 'years' | 'months' | 'days';

export const WARRANTY_UNITS: { value: WarrantyUnit; label: string; short: string }[] = [
  { value: 'years',  label: 'Years',  short: 'y' },
  { value: 'months', label: 'Months', short: 'mo' },
  { value: 'days',   label: 'Days',   short: 'd' },
];

/** The structured warranty fields as they sit on 3.0_components. */
export interface WarrantyFields {
  warranty?: string | null;             // legacy free text (fallback display)
  warranty_value?: number | null;
  warranty_unit?: string | null;
  perf_warranty_value?: number | null;
  perf_warranty_unit?: string | null;
}

/** "10 years" / "18 months" / "90 days" — null when not set. */
export function fmtWarranty(value: number | null | undefined, unit: string | null | undefined): string | null {
  const v = Number(value);
  if (!value || !isFinite(v) || v <= 0) return null;
  const u = (unit as WarrantyUnit) || 'years';
  const one = v === 1;
  const label = u === 'years' ? (one ? 'year' : 'years') : u === 'months' ? (one ? 'month' : 'months') : (one ? 'day' : 'days');
  return `${v % 1 === 0 ? v : v.toFixed(1)} ${label}`;
}

/** The item's product-warranty label: structured first, legacy text second. */
export function warrantyLabel(c: WarrantyFields): string | null {
  return fmtWarranty(c.warranty_value, c.warranty_unit) ?? ((c.warranty ?? '').trim() || null);
}

/** Warranty end date from a start date. Integer values use calendar
 *  arithmetic (10 years from 05 Aug 26 = 05 Aug 36); fractions fall back to
 *  day-precision (1 y = 365.25 d, 1 mo = 30.44 d). */
export function warrantyEnd(startISO: string, value: number, unit: WarrantyUnit): Date {
  const d = new Date(`${startISO.slice(0, 10)}T00:00:00`);
  if (Number.isInteger(value)) {
    if (unit === 'years') { d.setFullYear(d.getFullYear() + value); return d; }
    if (unit === 'months') { d.setMonth(d.getMonth() + value); return d; }
    d.setDate(d.getDate() + value); return d;
  }
  const days = unit === 'years' ? value * 365.25 : unit === 'months' ? value * 30.44 : value;
  d.setDate(d.getDate() + Math.round(days));
  return d;
}

export interface WarrantyRun {
  end: Date;
  daysLeft: number;      // negative when expired
  expired: boolean;
  /** "8.2 years left" / "expired 3 months ago" */
  label: string;
}

const spanLabel = (days: number): string => {
  const a = Math.abs(days);
  if (a < 31) return `${a} day${a === 1 ? '' : 's'}`;
  if (a < 365) return `${(a / 30.44).toFixed(1)} months`;
  return `${(a / 365.25).toFixed(1)} years`;
};

/** Where the clock stands today, from a document date. */
export function warrantyRun(startISO: string, value: number, unit: WarrantyUnit, now: Date = new Date()): WarrantyRun {
  const end = warrantyEnd(startISO, value, unit);
  const daysLeft = Math.floor((end.getTime() - now.getTime()) / 86_400_000);
  const expired = daysLeft < 0;
  return { end, daysLeft, expired, label: expired ? `expired ${spanLabel(daysLeft)} ago` : `${spanLabel(daysLeft)} left` };
}
