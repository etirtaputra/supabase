import type { RolePermissions } from './roles';
import type { NavSection } from './navigation';
// Extension-qualified: `node --test` type-strips this module for
// lib/dashboardWidgets.test.ts and needs the specifier to resolve as written.
import { sectionAllowed } from './navigation.ts';

/**
 * Every panel the Dashboard can show — the single list behind BOTH what the
 * page renders and what the "Customise" panel offers.
 *
 * This is `constants/navigation.ts` applied to one screen, and for the same
 * reason: the dashboard's sections used to carry their gate inline
 * (`perms?.buySide && <StockAlerts …>`), which is a rule written once per
 * panel and therefore a rule that drifts. A widget now declares what it needs
 * in the SAME vocabulary the menu uses — `section` for a flow, `cap` for a
 * capability, `caps` for "any one of these" — and `widgetAllowed` is the only
 * place that answers.
 *
 * The gate is not decoration. A widget must never render a number this role
 * cannot see the inputs for (the honesty doctrine): its gate is the permission
 * its DATA SOURCE needs, not the permission that makes it look tidy. Anything
 * reading supplier costs (`6.0_po_costs`) or stock valuation is buy-side, full
 * stop — `lib/dashboardWidgets.test.ts` fails the build if that slips.
 */

/**
 * How wide a widget sits on a big screen, in twelfths. Phones stack everything
 * except `quarter`, which pairs up two-across — the shape the KPI tiles have
 * always had.
 */
export type WidgetWidth = 'full' | 'twoThirds' | 'half' | 'third' | 'quarter';

/**
 * Column spans per width. The breakpoints reproduce the hand-built layout the
 * dashboard had before it became modular: KPI tiles go four-across at `lg`,
 * the two-up rows only split at `xl`.
 */
export const WIDTH_SPAN: Record<WidgetWidth, string> = {
  full:      'col-span-2 lg:col-span-12',
  twoThirds: 'col-span-2 lg:col-span-12 xl:col-span-8',
  half:      'col-span-2 lg:col-span-12 xl:col-span-6',
  third:     'col-span-2 lg:col-span-12 xl:col-span-4',
  quarter:   'col-span-1 lg:col-span-3',
};

export interface DashboardWidget {
  key: string;
  /** What the customise panel calls it. English, like every other name. */
  label: string;
  /** What it tells you — the customise panel's sub-line. Translated. */
  hint: string;
  section: NavSection;              // flow gate
  cap?: keyof RolePermissions;      // extra capability gate (all must pass)
  /** Gated on "any one of these" — the shape most dashboard panels need. */
  caps?: (keyof RolePermissions)[];
  width: WidgetWidth;
  /** On for a person who has never customised anything. */
  defaultOn: boolean;
}

/**
 * Shipped order — top to bottom, exactly the dashboard as it stood before it
 * was made modular: the position, then what needs a human, then the read of
 * it, then the month's numbers, then the warehouse's alarms, then the log.
 */
export const DASHBOARD_WIDGETS: DashboardWidget[] = [
  { key: 'position', label: 'Position', width: 'full', defaultOn: true,
    section: null, caps: ['canViewBanks', 'sellSide', 'buySide', 'canViewEconomics'],
    hint: 'Cash held, owed to us, we owe, and how fast a rupiah comes back' },
  { key: 'queue', label: 'Needs you today', width: 'full', defaultOn: true,
    section: null, caps: ['buySide', 'sellSide'],
    hint: 'What is stuck, what it is worth, and one tap to unstick it' },
  { key: 'nextStep', label: 'Next best step', width: 'half', defaultOn: true,
    section: null, caps: ['buySide', 'sellSide', 'canViewBanks'],
    hint: 'The AI reads the same numbers and proposes one move' },
  { key: 'motion', label: 'Month in motion', width: 'half', defaultOn: true,
    section: null, caps: ['buySide', 'sellSide'],
    hint: 'This month so far against the same days of last month' },
  // The four buy-side KPIs. Separate widgets on purpose: someone who watches
  // cash out every morning should be able to keep that tile and drop the
  // catalog count, which changes once a week.
  { key: 'kpiPaid', label: 'Paid This Month', width: 'quarter', defaultOn: true,
    section: 'buySide', hint: 'Principal paid to suppliers so far this month' },
  { key: 'kpiStockValue', label: 'Stock Value', width: 'quarter', defaultOn: true,
    section: 'buySide', hint: 'On-hand quantity at moving-average landed cost' },
  { key: 'kpiActivePos', label: 'Active POs', width: 'quarter', defaultOn: true,
    section: 'buySide', hint: 'Purchase orders that are not cancelled' },
  { key: 'kpiComponents', label: 'Components', width: 'quarter', defaultOn: true,
    section: 'buySide', hint: 'How many items the catalog carries' },
  // The item is the pivot, so the two sides of its journey get a panel each:
  // what has just landed and can be sold, and what is still on the water.
  // Neither needs a cost or a supplier, so both are safe for sell-side eyes.
  { key: 'newArrivals', label: 'New arrivals', width: 'half', defaultOn: true,
    section: null, caps: ['sellSide', 'buySide'],
    hint: 'What landed recently — and what still has no selling price' },
  { key: 'arriving', label: 'Arriving soon', width: 'half', defaultOn: true,
    section: null, caps: ['sellSide', 'buySide', 'canManageStock'],
    hint: 'What is on the water and when it should land' },
  // The two league tables. Revenue is a sell-side number, so the sell side may
  // rank by it; PROFIT needs what the goods cost us, which is why the profit
  // view is offered only to a role that may already see item economics — and
  // why the fetch itself never asks for a cost it may not show.
  { key: 'topProducts', label: 'Top products', width: 'half', defaultOn: true,
    section: null, caps: ['sellSide', 'canViewEconomics'],
    hint: 'What earns the most — by revenue, or by gross profit' },
  { key: 'topCustomers', label: 'Top customers', width: 'half', defaultOn: true,
    section: null, caps: ['sellSide', 'canViewEconomics'],
    hint: 'Who earns you the most — by revenue, or by gross profit' },
  { key: 'stockAlerts', label: 'Stock alerts', width: 'full', defaultOn: true,
    section: 'buySide', hint: 'Orders that cannot ship, and items at their reorder point' },
  // Three narrow feeds beside the one wide mixed stream. The stream answers
  // "what has everyone been doing"; these answer "show me the payments", which
  // is a different question and a worse one to answer by scrolling.
  // Payments gate on EITHER side of the money: a buy-side reader sees what
  // went out, a sell-side reader what came in, and the card says which.
  { key: 'lastPayments', label: 'Last payments', width: 'third', defaultOn: true,
    section: null, caps: ['buySide', 'sellSide', 'canViewBanks', 'canRecordReceipts'],
    hint: 'The most recent money in and out' },
  { key: 'lastDeliveries', label: 'Last deliveries', width: 'third', defaultOn: true,
    section: null, caps: ['canEditSalesDocs', 'canManageStock'],
    hint: 'What left the warehouse, and whether it landed' },
  { key: 'lastCases', label: 'Last service tickets', width: 'third', defaultOn: true,
    section: null, cap: 'canHandleService',
    hint: 'What came back, and what is still open' },
  { key: 'activity', label: 'Latest activity', width: 'twoThirds', defaultOn: true,
    section: null, caps: ['buySide', 'sellSide', 'projects'],
    hint: 'One stream of what everyone saved, across every module' },
  { key: 'quickActions', label: 'Quick Actions', width: 'third', defaultOn: true,
    section: null, caps: ['buySide', 'sellSide', 'projects', 'canManageStock', 'canHandleService', 'canViewBanks'],
    hint: 'The screens this role starts its day on, one tap away' },
];

/**
 * THE widget rule — the same shape as `destinationAllowed`, and deliberately
 * so. A widget a role may not have is not hidden after loading: it is never
 * offered, never ordered and never rendered.
 */
export const widgetAllowed = (perms: RolePermissions | null, w: DashboardWidget): boolean => {
  if (!perms) return false;                        // profile unknown: draw nothing yet
  if (!sectionAllowed(perms, w.section)) return false;
  if (w.cap && !perms[w.cap]) return false;
  if (w.caps && !w.caps.some((c) => !!perms[c])) return false;
  return true;
};

/**
 * "Profile still loading" is answered the OPPOSITE way to a page gate, for the
 * same reason the menu was changed on 2026-08-19: a page must not bounce
 * someone mid-load, but a dashboard that renders every panel and then removes
 * the ones a role may not see tells them what they are missing and looks
 * broken while it happens. Filling in is honest; emptying out is not.
 */
export const widgetsFor = (perms: RolePermissions | null): DashboardWidget[] =>
  DASHBOARD_WIDGETS.filter((w) => widgetAllowed(perms, w));

export const WIDGET_BY_KEY = new Map(DASHBOARD_WIDGETS.map((w) => [w.key, w]));

/** Shipped order and shipped hidden set — what an unconfigured install shows. */
export const DEFAULT_WIDGET_ORDER: string[] = DASHBOARD_WIDGETS.map((w) => w.key);
export const DEFAULT_WIDGET_HIDDEN: string[] = DASHBOARD_WIDGETS.filter((w) => !w.defaultOn).map((w) => w.key);

/** One saved arrangement: the order to render in, and what is switched off. */
export interface DashboardLayout { order: string[]; hidden: string[] }

/**
 * The order to actually render, given a stored preference. Robust by
 * construction, exactly like `orderedNavGroups`: a stored key that is no
 * longer a widget is dropped, and a widget the stored list never mentions (one
 * added after the preference was saved) keeps its shipped position — so no
 * saved arrangement can silently swallow a panel that ships later.
 */
export function orderedWidgetKeys(stored: string[] | null | undefined): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const k of stored ?? []) {
    if (WIDGET_BY_KEY.has(k) && !seen.has(k)) { out.push(k); seen.add(k); }
  }
  // A widget the stored order never named is NEW. Put it back where it ships,
  // not at the end: a KPI tile added between two others belongs between them.
  if (out.length !== DEFAULT_WIDGET_ORDER.length) {
    const missing = DEFAULT_WIDGET_ORDER.filter((k) => !seen.has(k));
    for (const k of missing) {
      const at = DEFAULT_WIDGET_ORDER.indexOf(k);
      // Insert after the nearest earlier-shipping widget that survived.
      let idx = 0;
      for (let i = at - 1; i >= 0; i--) {
        const p = out.indexOf(DEFAULT_WIDGET_ORDER[i]);
        if (p >= 0) { idx = p + 1; break; }
      }
      out.splice(idx, 0, k);
      seen.add(k);
    }
  }
  return out;
}

/**
 * What is switched off, given a stored preference. Unknown keys are dropped.
 * A widget that ships OFF and was never mentioned in the stored order is new,
 * so it stays off — otherwise every saved arrangement would flip on the next
 * opt-in panel we ship.
 */
export function hiddenWidgetKeys(
  storedOrder: string[] | null | undefined,
  storedHidden: string[] | null | undefined,
): Set<string> {
  const mentioned = new Set((storedOrder ?? []).filter((k) => WIDGET_BY_KEY.has(k)));
  const out = new Set((storedHidden ?? []).filter((k) => WIDGET_BY_KEY.has(k)));
  for (const w of DASHBOARD_WIDGETS) if (!w.defaultOn && !mentioned.has(w.key)) out.add(w.key);
  return out;
}

/**
 * The whole answer for one person: every widget this role may see, in the
 * arranged order, each marked shown or hidden. The page renders the shown
 * ones; the customise panel lists them all, which is how something the house
 * switched off can be switched back on by the person who needs it.
 */
export function arrangeWidgets(
  perms: RolePermissions | null,
  layout: Partial<DashboardLayout> | null | undefined,
): { widget: DashboardWidget; shown: boolean }[] {
  const allowed = new Set(widgetsFor(perms).map((w) => w.key));
  const hidden = hiddenWidgetKeys(layout?.order, layout?.hidden);
  return orderedWidgetKeys(layout?.order)
    .filter((k) => allowed.has(k))
    .map((k) => ({ widget: WIDGET_BY_KEY.get(k)!, shown: !hidden.has(k) }));
}

/** Just the widgets to draw, in order. */
export const visibleWidgets = (
  perms: RolePermissions | null,
  layout: Partial<DashboardLayout> | null | undefined,
): DashboardWidget[] => arrangeWidgets(perms, layout).filter((r) => r.shown).map((r) => r.widget);
