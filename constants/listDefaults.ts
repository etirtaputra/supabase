import type { RangePreset } from '@/lib/dateRange';

/**
 * How each list opens: which order, and over which period.
 *
 * One registry, two consumers — Settings › Lists renders a row per entry, and
 * each page reads its own entry through `useListDefaults`. A list appears here
 * ONLY when the page honours it; a setting that changes nothing is worse than
 * no setting at all.
 *
 * `sorts` is what that page can actually order by. An empty list means the page
 * has one natural order and only the period is configurable.
 */

export type ListKey = 'sales' | 'invoices' | 'customers' | 'products' | 'delivery' | 'deals';

export interface ListSort { value: string; label: string }

export interface ListSpec {
  key: ListKey;
  label: string;
  href: string;
  /** Which date the period filters on — printed so the setting is unambiguous. */
  dateLabel: string;
  sorts: ListSort[];
  defaults: { sort: string; period: RangePreset };
  /** What the default is for, in one line. */
  hint?: string;
}

export const LIST_SPECS: ListSpec[] = [
  {
    key: 'sales', label: 'Sales', href: '/sales', dateLabel: 'quote date',
    sorts: [
      { value: 'created',  label: 'Newest first' },
      { value: 'updated',  label: 'Recently updated' },
      { value: 'value',    label: 'Largest value' },
      { value: 'customer', label: 'Customer A→Z' },
    ],
    defaults: { sort: 'created', period: 'mtd' },
    hint: 'What this month has actually been quoted and ordered.',
  },
  {
    key: 'invoices', label: 'Invoices', href: '/invoices', dateLabel: 'issue date',
    sorts: [
      { value: 'issued',      label: 'Latest issued' },
      { value: 'oldest',      label: 'Oldest first' },
      { value: 'outstanding', label: 'Most outstanding' },
      { value: 'value',       label: 'Largest value' },
    ],
    defaults: { sort: 'issued', period: 'all' },
    hint: 'Newest invoices first; the whole ledger, since AR does not expire.',
  },
  {
    key: 'customers', label: 'Customers', href: '/customers', dateLabel: 'date added',
    sorts: [
      { value: 'created', label: 'Newest additions' },
      { value: 'updated', label: 'Recently updated' },
      { value: 'name',    label: 'Name A→Z' },
    ],
    defaults: { sort: 'created', period: 'all' },
  },
  {
    key: 'products', label: 'Products', href: '/products', dateLabel: 'order date',
    sorts: [
      { value: 'traded',   label: 'Most sold in the period' },
      { value: 'activity', label: 'Most traded (all time)' },
      { value: 'updated',  label: 'Last updated' },
      { value: 'price',    label: 'Sell price' },
      { value: 'stock',    label: 'Live stock' },
      { value: 'category', label: 'Category' },
    ],
    defaults: { sort: 'traded', period: 'month' },
    hint: 'What is moving right now floats to the top of the catalogue.',
  },
  {
    key: 'delivery', label: 'Delivery', href: '/delivery', dateLabel: 'delivery date',
    sorts: [],
    defaults: { sort: '', period: 'all' },
  },
  {
    key: 'deals', label: 'Deal Lookup', href: '/purchasing?tab=lookup', dateLabel: 'deal date',
    sorts: [],
    defaults: { sort: '', period: 'all' },
  },
];

export const listSpec = (key: ListKey): ListSpec =>
  LIST_SPECS.find((l) => l.key === key) ?? LIST_SPECS[0];

/** The shipped defaults, as the settings store holds them. */
export const DEFAULT_LIST_DEFAULTS: Record<string, { sort: string; period: RangePreset }> =
  Object.fromEntries(LIST_SPECS.map((l) => [l.key, { ...l.defaults }]));
