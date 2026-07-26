/**
 * One date-range vocabulary for every list in the app.
 *
 * A range is a plain `{ from, to }` pair of YYYY-MM-DD strings (either side may
 * be null = open-ended), so filtering is a string comparison against the date
 * column — no timezone maths, no Date objects in render paths.
 *
 * Presets cover how the business actually asks the question ("this week", "this
 * month", "this year"), plus an explicit month / year picker and a free custom
 * range. `describeRange` gives the label the page prints so the filter is never
 * silently on.
 */

export interface DateRange { from: string | null; to: string | null }

export const ALL_TIME: DateRange = { from: null, to: null };

export type RangePreset =
  | 'all' | 'today' | 'week' | 'month' | 'mtd' | 'quarter' | 'year' | 'ytd'
  | 'last7' | 'last30' | 'last90' | 'lastMonth' | 'lastYear' | 'custom';

export const PRESET_LABELS: Record<Exclude<RangePreset, 'custom'>, string> = {
  all:       'All time',
  today:     'Today',
  week:      'This week',
  month:     'This month',
  mtd:       'Month to date',
  quarter:   'This quarter',
  year:      'This year',
  ytd:       'Year to date',
  last7:     'Last 7 days',
  last30:    'Last 30 days',
  last90:    'Last 90 days',
  lastMonth: 'Last month',
  lastYear:  'Last year',
};

const iso = (d: Date): string => {
  // Local midnight, not UTC — a date-only value must not slide a day back.
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${d.getFullYear()}-${m}-${day}`;
};
const addDays = (d: Date, n: number): Date => { const x = new Date(d); x.setDate(x.getDate() + n); return x; };

/** Monday-based week start, matching how the team reads a working week. */
const startOfWeek = (d: Date): Date => {
  const x = new Date(d);
  const dow = (x.getDay() + 6) % 7;   // Mon = 0
  return addDays(x, -dow);
};

export function rangeForPreset(preset: RangePreset, now = new Date()): DateRange {
  const y = now.getFullYear();
  const m = now.getMonth();
  switch (preset) {
    case 'today':     return { from: iso(now), to: iso(now) };
    case 'week':      return { from: iso(startOfWeek(now)), to: iso(addDays(startOfWeek(now), 6)) };
    case 'month':     return { from: iso(new Date(y, m, 1)), to: iso(new Date(y, m + 1, 0)) };
    case 'quarter': {
      const q = Math.floor(m / 3) * 3;
      return { from: iso(new Date(y, q, 1)), to: iso(new Date(y, q + 3, 0)) };
    }
    case 'mtd':       return { from: iso(new Date(y, m, 1)), to: iso(now) };
    case 'year':      return { from: `${y}-01-01`, to: `${y}-12-31` };
    case 'ytd':       return { from: `${y}-01-01`, to: iso(now) };
    case 'last7':     return { from: iso(addDays(now, -6)), to: iso(now) };
    case 'last30':    return { from: iso(addDays(now, -29)), to: iso(now) };
    case 'last90':    return { from: iso(addDays(now, -89)), to: iso(now) };
    case 'lastMonth': return { from: iso(new Date(y, m - 1, 1)), to: iso(new Date(y, m, 0)) };
    case 'lastYear':  return { from: `${y - 1}-01-01`, to: `${y - 1}-12-31` };
    case 'all':
    case 'custom':
    default:          return ALL_TIME;
  }
}

/** A whole calendar month, "2026-07" → 1–31 July 2026. */
export const rangeForMonth = (ym: string): DateRange => {
  const [y, m] = ym.split('-').map(Number);
  if (!y || !m) return ALL_TIME;
  return { from: `${ym}-01`, to: iso(new Date(y, m, 0)) };
};

/** A whole calendar year. */
export const rangeForYear = (y: number | string): DateRange => ({ from: `${y}-01-01`, to: `${y}-12-31` });

export const isOpenRange = (r: DateRange): boolean => !r.from && !r.to;

/** Does a YYYY-MM-DD (or ISO timestamp) date fall inside the range? */
export function inRange(date: string | null | undefined, r: DateRange): boolean {
  if (isOpenRange(r)) return true;
  if (!date) return false;          // an undated row can't satisfy a date filter
  const d = date.slice(0, 10);
  if (r.from && d < r.from) return false;
  if (r.to && d > r.to) return false;
  return true;
}

/** Human label for the range currently in force ("1–31 Jul 2026"). */
export function describeRange(r: DateRange, fmt: (d: string) => string): string {
  if (isOpenRange(r)) return 'All time';
  if (r.from && r.to) return r.from === r.to ? fmt(r.from) : `${fmt(r.from)} – ${fmt(r.to)}`;
  if (r.from) return `From ${fmt(r.from)}`;
  return `Until ${fmt(r.to as string)}`;
}
