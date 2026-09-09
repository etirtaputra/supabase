/**
 * The product P&L: revenue, COGS and gross profit, per period, per category,
 * per item.
 *
 * Owner's ask, 2026-09-09: *"a Monthly, Quarterly, Yearly Profit and Loss
 * statement based on the Sales of Products vs. TUC/COGS of products, but
 * categorized by Product Categories, and the Item names."*
 *
 * THIS IS A ROLLUP, NOT A SECOND DEFINITION OF A SALE. Every number here comes
 * from `SalesFact` (lib/salesFacts.ts) — revenue recognised on DELIVERY at the
 * sales order's unit price excl. PPN, COGS taken from the stock ledger's own
 * out-movement where it has one. This file only buckets those facts by time
 * and groups them by category and item. If the P&L and the Profitability tab
 * ever disagree, one of them has stopped reading `buildSalesFacts` and that is
 * the bug — not an arithmetic difference to reconcile.
 *
 * WHAT IT IS NOT: a company P&L. There is no opex, no salary, no rent, no tax
 * — nothing below the gross-profit line, because ICAPROC does not hold those
 * numbers. It is the trading margin on goods, which is what the item-centric
 * ERP actually knows. `GrossProfitOnly` is stated on the type so no screen can
 * quietly relabel it "net profit".
 */
import type { SalesFact } from './salesFacts.ts';

/** How wide one column of the statement is. */
export type Grain = 'month' | 'quarter' | 'year';

export const GRAIN_LABEL: Record<Grain, string> = {
  month: 'Monthly',
  quarter: 'Quarterly',
  year: 'Yearly',
};

/**
 * The period key a date falls in — sortable as a string, which is the whole
 * point: `'2026-Q2' < '2026-Q3'` and `'2026-02' < '2026-10'` both hold, so
 * nothing downstream needs a date comparator.
 *
 * Dates are ISO and read as calendar dates. A delivery stamped
 * `2026-03-31T23:00:00Z` belongs to March in the ledger's own terms; this does
 * not re-interpret it in the reader's timezone, because the statement must
 * total the same for everyone who opens it.
 */
export function periodKey(isoDate: string, grain: Grain): string {
  const y = isoDate.slice(0, 4);
  const m = Number(isoDate.slice(5, 7));
  if (grain === 'year') return y;
  if (grain === 'quarter') return `${y}-Q${Math.floor((m - 1) / 3) + 1}`;
  return isoDate.slice(0, 7);
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** The column heading a person reads: `2026-07` → `Jul 2026`. */
export function periodLabel(key: string, grain: Grain): string {
  if (grain === 'year') return key;
  if (grain === 'quarter') return key.replace('-', ' ');
  const m = Number(key.slice(5, 7));
  return `${MONTHS[m - 1] ?? key.slice(5, 7)} ${key.slice(0, 4)}`;
}

/** Revenue, cost and what is left — the three numbers every row carries. */
export interface Money {
  revenue: number;
  cogs: number;
  /** revenue − cogs. Gross only: nothing below this line exists here. */
  grossProfit: number;
  /** Gross margin as a percentage, or null when there is no revenue to divide by. */
  marginPct: number | null;
  qty: number;
  /** Any part of this total leans on today's average rather than the ledger. */
  estimated: boolean;
  /** False when the reader may not see cost at all — then cogs/GP mean nothing. */
  costKnown: boolean;
}

export interface ItemRow extends Money {
  componentId: string;
  name: string;
}

export interface CategoryRow extends Money {
  /** The stored enum value — `pv_module`. Screens translate it for display. */
  category: string;
  items: ItemRow[];
}

export interface PeriodColumn extends Money {
  key: string;
  label: string;
}

export interface PLStatement {
  grain: Grain;
  /** Oldest first — the reading order of a statement. */
  periods: PeriodColumn[];
  /** Categories, biggest gross profit first. */
  categories: CategoryRow[];
  total: Money;
  /** `category → periodKey → Money`, for the per-period columns of a row. */
  cellsByCategory: Map<string, Map<string, Money>>;
  /** `componentId → periodKey → Money`. */
  cellsByItem: Map<string, Map<string, Money>>;
  /**
   * How much of the COGS is a guess. An owner reading a margin needs to know
   * whether it came from the ledger or from today's average — those differ by
   * every price change since the goods shipped.
   */
  estimatedCogsShare: number;
  /** This is gross profit on goods, never net profit. Stated, not implied. */
  readonly grossProfitOnly: true;
}

const zero = (costKnown: boolean): Money =>
  ({ revenue: 0, cogs: 0, grossProfit: 0, marginPct: null, qty: 0, estimated: false, costKnown });

/** Fold one fact into a running total. Mutates `m` — it is always a local. */
function add(m: Money, f: SalesFact): void {
  m.revenue += f.revenue;
  m.qty += f.qty;
  if (f.costKnown) m.cogs += f.cogs;
  // One estimated line makes the whole total estimated. That is deliberate:
  // "mostly from the ledger" is not a thing a margin can be.
  if (f.cogsEstimated && f.costKnown) m.estimated = true;
  if (!f.costKnown) m.costKnown = false;
}

/** Close a running total: the two derived figures, computed once at the end. */
function seal(m: Money): Money {
  m.grossProfit = m.costKnown ? m.revenue - m.cogs : 0;
  m.marginPct = m.costKnown && m.revenue > 0 ? (m.grossProfit / m.revenue) * 100 : null;
  return m;
}

const bump = (map: Map<string, Money>, key: string, f: SalesFact): void => {
  const m = map.get(key) ?? zero(f.costKnown);
  add(m, f);
  map.set(key, m);
};

/**
 * Build the statement.
 *
 * `nameOf` and `categoryOf` are passed in rather than looked up here: the
 * catalogue is the screen's to fetch, and keeping this pure is what lets the
 * tests state the numbers without a database.
 */
export function buildPL(
  facts: readonly SalesFact[],
  grain: Grain,
  lookup: {
    nameOf: (componentId: string) => string;
    categoryOf: (componentId: string) => string;
  },
): PLStatement {
  const costKnown = facts.length === 0 || facts.every((f) => f.costKnown);

  const byPeriod = new Map<string, Money>();
  const byCategory = new Map<string, Money>();
  const byItem = new Map<string, Money>();
  const itemsOfCategory = new Map<string, Set<string>>();
  const cellsByCategory = new Map<string, Map<string, Money>>();
  const cellsByItem = new Map<string, Map<string, Money>>();
  const total = zero(costKnown);

  let estimatedCogs = 0;
  let allCogs = 0;

  for (const f of facts) {
    // A fact with no date cannot sit in a column, and a statement whose
    // columns do not add up to its total is not a statement. Skip it and let
    // the totals disagree with the raw fact count rather than the columns.
    if (!f.date) continue;
    const pk = periodKey(f.date, grain);
    const cat = lookup.categoryOf(f.component_id);

    bump(byPeriod, pk, f);
    bump(byCategory, cat, f);
    bump(byItem, f.component_id, f);
    add(total, f);

    if (!itemsOfCategory.has(cat)) itemsOfCategory.set(cat, new Set());
    itemsOfCategory.get(cat)!.add(f.component_id);

    if (!cellsByCategory.has(cat)) cellsByCategory.set(cat, new Map());
    bump(cellsByCategory.get(cat)!, pk, f);
    if (!cellsByItem.has(f.component_id)) cellsByItem.set(f.component_id, new Map());
    bump(cellsByItem.get(f.component_id)!, pk, f);

    if (f.costKnown) {
      allCogs += f.cogs;
      if (f.cogsEstimated) estimatedCogs += f.cogs;
    }
  }

  for (const m of byPeriod.values()) seal(m);
  for (const m of byCategory.values()) seal(m);
  for (const m of byItem.values()) seal(m);
  for (const inner of cellsByCategory.values()) for (const m of inner.values()) seal(m);
  for (const inner of cellsByItem.values()) for (const m of inner.values()) seal(m);
  seal(total);

  const periods: PeriodColumn[] = [...byPeriod.entries()]
    .sort((a, b) => a[0].localeCompare(b[0]))          // oldest first: a statement reads forward
    .map(([key, m]) => ({ key, label: periodLabel(key, grain), ...m }));

  // Biggest contributor first — and by GROSS PROFIT, not revenue. A category
  // that turns over more while earning less is not the top of this list; the
  // whole point of the statement is that those two orders differ.
  const rank = (a: Money, b: Money) =>
    (b.costKnown ? b.grossProfit : b.revenue) - (a.costKnown ? a.grossProfit : a.revenue);

  const categories: CategoryRow[] = [...byCategory.entries()]
    .map(([category, m]) => ({
      category,
      ...m,
      items: [...(itemsOfCategory.get(category) ?? [])]
        .map((componentId) => ({
          componentId,
          name: lookup.nameOf(componentId),
          ...(byItem.get(componentId) ?? zero(costKnown)),
        }))
        .sort(rank),
    }))
    .sort(rank);

  return {
    grain,
    periods,
    categories,
    total,
    cellsByCategory,
    cellsByItem,
    estimatedCogsShare: allCogs > 0 ? estimatedCogs / allCogs : 0,
    grossProfitOnly: true,
  };
}

/** One row of a CSV export — the statement flattened, category then item. */
export function toCsvRows(pl: PLStatement, categoryLabel: (c: string) => string): string[][] {
  const head = ['Level', 'Category', 'Item', 'Period', 'Qty', 'Revenue', 'COGS', 'Gross profit', 'Margin %', 'COGS basis'];
  const rows: string[][] = [head];
  const money = (m: Money) => [
    String(m.qty),
    String(Math.round(m.revenue)),
    m.costKnown ? String(Math.round(m.cogs)) : '',
    m.costKnown ? String(Math.round(m.grossProfit)) : '',
    m.marginPct == null ? '' : m.marginPct.toFixed(1),
    m.costKnown ? (m.estimated ? 'estimated' : 'ledger') : 'hidden',
  ];
  for (const c of pl.categories) {
    for (const p of pl.periods) {
      const cell = pl.cellsByCategory.get(c.category)?.get(p.key);
      if (cell) rows.push(['Category', categoryLabel(c.category), '', p.label, ...money(cell)]);
    }
    for (const it of c.items) {
      for (const p of pl.periods) {
        const cell = pl.cellsByItem.get(it.componentId)?.get(p.key);
        if (cell) rows.push(['Item', categoryLabel(c.category), it.name, p.label, ...money(cell)]);
      }
    }
  }
  for (const p of pl.periods) rows.push(['Total', '', '', p.label, ...money(p)]);
  return rows;
}
