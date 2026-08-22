/**
 * The dashboard is ONE rule too — a widget shows only what its role may read.
 *
 * The dashboard used to carry its gate inline, panel by panel
 * (`perms?.buySide && <StockAlerts …>`), which is the same shape of bug the
 * menu had before `lib/access.test.ts`: a rule written once per place is a rule
 * that drifts, and every drift leaks a number at someone who may not see its
 * inputs. Now the gate lives in `constants/dashboardWidgets.ts`, and this file
 * fails the build if:
 *
 *   1. a widget reading buy-side data is offered to a role without buy-side;
 *   2. a role's dashboard silently widens or narrows;
 *   3. a saved arrangement can smuggle in a widget the role may not have, or
 *      swallow a widget that ships later;
 *   4. a registered widget has no case in the page that renders it.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  DASHBOARD_WIDGETS, DEFAULT_WIDGET_ORDER, DEFAULT_WIDGET_HIDDEN, WIDTH_SPAN,
  widgetsFor, widgetAllowed, orderedWidgetKeys, hiddenWidgetKeys, arrangeWidgets, visibleWidgets,
} from '../constants/dashboardWidgets.ts';
import { ROLE_PERMISSIONS, type UserRole } from '../constants/roles.ts';

const HOUSE = { order: DEFAULT_WIDGET_ORDER, hidden: DEFAULT_WIDGET_HIDDEN };
const keysFor = (role: UserRole) => visibleWidgets(ROLE_PERMISSIONS[role], HOUSE).map((w) => w.key);

/**
 * What each role finds on its dashboard, shipped defaults. Change this only on
 * purpose — a diff here is someone gaining or losing a panel.
 */
const EXPECTED: Record<UserRole, string[]> = {
  owner: ['position', 'queue', 'nextStep', 'motion', 'kpiPaid', 'kpiStockValue', 'kpiActivePos', 'kpiComponents', 'newArrivals', 'arriving', 'topProducts', 'topCustomers', 'stockAlerts', 'activity', 'quickActions'],
  // Buy-side-only roles see no sales league table: revenue by customer is a
  // sell-side number, and they have no sell-side.
  buy_admin: ['position', 'queue', 'nextStep', 'motion', 'kpiPaid', 'kpiStockValue', 'kpiActivePos', 'kpiComponents', 'newArrivals', 'arriving', 'stockAlerts', 'activity', 'quickActions'],
  sell_admin: ['position', 'queue', 'nextStep', 'motion', 'newArrivals', 'arriving', 'topProducts', 'topCustomers', 'activity', 'quickActions'],
  sales: ['position', 'queue', 'nextStep', 'motion', 'newArrivals', 'arriving', 'topProducts', 'topCustomers', 'activity', 'quickActions'],
  engineer: ['position', 'queue', 'nextStep', 'motion', 'newArrivals', 'arriving', 'topProducts', 'topCustomers', 'activity', 'quickActions'],
  // The warehouse lands on /stock, but knowing what is on the water is its
  // job — it is the desk that will receive it. Still no price, still no cost.
  warehouse: ['arriving', 'quickActions'],
  aftersales: ['quickActions'],
  // Read-only deal lookup and nothing else. An empty dashboard is the honest
  // answer — panels that could only ever say "nothing here" say nothing.
  viewer: [],
  data_entry: ['position', 'queue', 'nextStep', 'motion', 'kpiPaid', 'kpiStockValue', 'kpiActivePos', 'kpiComponents', 'newArrivals', 'arriving', 'stockAlerts', 'activity', 'quickActions'],
  finance: ['position', 'queue', 'nextStep', 'motion', 'kpiPaid', 'kpiStockValue', 'kpiActivePos', 'kpiComponents', 'newArrivals', 'arriving', 'stockAlerts', 'activity', 'quickActions'],
};

test('what each role sees on the dashboard is what we meant it to see', () => {
  for (const role of Object.keys(ROLE_PERMISSIONS) as UserRole[]) {
    assert.deepEqual(keysFor(role), EXPECTED[role], `${role}'s dashboard changed`);
  }
});

/**
 * Widgets whose numbers come from supplier costs or stock valuation —
 * `6.0_po_costs`, `30.1_stock_balances`, the unpaid-PO queue. The buy price
 * read forwards or backwards is buy-side, and a sell-side login must never
 * meet one of these on a dashboard it customised.
 */
const BUY_SIDE_DATA = ['kpiPaid', 'kpiStockValue', 'kpiActivePos', 'kpiComponents', 'stockAlerts'];

test('a widget fed by buy-side data is never offered to a sell-side role', () => {
  for (const key of BUY_SIDE_DATA) {
    const w = DASHBOARD_WIDGETS.find((x) => x.key === key);
    assert.ok(w, `${key} is in the buy-side data list but not in the registry`);
    assert.equal(w!.section, 'buySide', `${key} reads buy-side data but is not gated on it`);
  }
  for (const role of Object.keys(ROLE_PERMISSIONS) as UserRole[]) {
    if (ROLE_PERMISSIONS[role].buySide) continue;
    for (const key of BUY_SIDE_DATA) {
      assert.ok(!keysFor(role).includes(key), `${role} has no buy side but is shown ${key}`);
    }
  }
});

/**
 * The two item panels are sell-side safe BY CONSTRUCTION — neither needs a
 * cost, a supplier or a PO number to answer its question. If either ever
 * starts reading buy-side data, it must move into BUY_SIDE_DATA above and this
 * test is where that decision gets made rather than quietly skipped.
 */
test('the arrival panels reach the sell side, because they carry no buy-side number', () => {
  for (const key of ['newArrivals', 'arriving']) {
    assert.ok(!BUY_SIDE_DATA.includes(key), `${key} is claimed sell-side safe`);
    assert.ok(keysFor('sales').includes(key), `sales should see ${key}`);
    assert.ok(keysFor('sell_admin').includes(key), `sell_admin should see ${key}`);
  }
  // ...and the source keeps its side of that bargain: the fetcher asks for a
  // PO number only for buy-side eyes, the /products network-tab rule.
  const src = readFileSync('lib/catalogSignals.ts', 'utf8');
  assert.ok(src.includes("opts.buySide ? ', po_number' : ''"),
    'the arrivals fetch must request po_number conditionally, not for everyone');
  // Comments stripped first: the file NAMES the columns it refuses to read,
  // and a promise written in prose must not read as a violation.
  const code = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
  assert.ok(!code.includes('6.0_po_costs'), 'nothing here may read supplier costs');
  assert.ok(!code.includes('unit_cost_idr'), 'nor the cost stamped on a stock movement');
});

/**
 * The league tables rank by revenue for the sell side and by profit only for a
 * role that may see item economics. The gate is half the promise; the other
 * half is that the FETCH never asks for a cost it may not show, so a sell-side
 * reader cannot find one in the network tab either.
 */
test('a sell-side reader may rank by revenue, and never sees a cost to rank by', () => {
  for (const key of ['topProducts', 'topCustomers']) {
    assert.ok(keysFor('sales').includes(key), `sales should see ${key}`);
    assert.ok(keysFor('sell_admin').includes(key), `sell_admin should see ${key}`);
    assert.ok(!keysFor('buy_admin').includes(key), `buy_admin has no sell side and should not see ${key}`);
  }
  const src = readFileSync('lib/salesFacts.ts', 'utf8');
  assert.ok(src.includes("opts.withCost ? ', unit_cost_idr' : ''"),
    'the sales-facts fetch must request unit cost conditionally, not for everyone');
  const code = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
  assert.ok(!code.includes('6.0_po_costs'), 'nothing here may read supplier costs');
});

test('a saved arrangement cannot smuggle in a widget the role may not have', () => {
  // A hostile (or simply stale) local arrangement naming everything, unhidden.
  const greedy = { order: DASHBOARD_WIDGETS.map((w) => w.key), hidden: [] };
  assert.deepEqual(visibleWidgets(ROLE_PERMISSIONS.sales, greedy), visibleWidgets(ROLE_PERMISSIONS.sales, HOUSE));
  assert.deepEqual(visibleWidgets(ROLE_PERMISSIONS.warehouse, greedy).map((w) => w.key), ['arriving', 'quickActions']);
});

test('the profile is not known yet: draw nothing rather than draw and remove', () => {
  // The opposite default to a page gate, and deliberately so — a page must not
  // bounce someone mid-load, but a dashboard that fills in is honest while one
  // that empties out tells people what they are missing.
  assert.deepEqual(widgetsFor(null), []);
  assert.deepEqual(visibleWidgets(null, HOUSE), []);
  assert.equal(widgetAllowed(null, DASHBOARD_WIDGETS[0]), false);
});

test('a stale arrangement never swallows a widget, and never resurrects a dead one', () => {
  // Unknown keys are dropped...
  assert.ok(!orderedWidgetKeys(['position', 'a-widget-we-deleted']).includes('a-widget-we-deleted'));
  // ...and a widget the stored order never mentioned comes back where it ships,
  // not dumped at the end: a KPI added between two others belongs between them.
  const withoutKpis = DEFAULT_WIDGET_ORDER.filter((k) => !k.startsWith('kpi'));
  assert.deepEqual(orderedWidgetKeys(withoutKpis), DEFAULT_WIDGET_ORDER);
  // An empty or absent preference is simply the shipped order.
  assert.deepEqual(orderedWidgetKeys(null), DEFAULT_WIDGET_ORDER);
  assert.deepEqual(orderedWidgetKeys([]), DEFAULT_WIDGET_ORDER);
});

test('a widget that ships switched off stays off for arrangements saved before it', () => {
  const old = ['position', 'queue'];                     // saved before the rest existed
  const hidden = hiddenWidgetKeys(old, []);
  for (const w of DASHBOARD_WIDGETS) {
    assert.equal(hidden.has(w.key), !w.defaultOn && !old.includes(w.key),
      `${w.key} should ${w.defaultOn ? 'not ' : ''}be hidden for an arrangement that predates it`);
  }
  // Unknown keys in the hidden list are dropped rather than carried forever.
  assert.ok(!hiddenWidgetKeys(DEFAULT_WIDGET_ORDER, ['ghost']).has('ghost'));
});

test('hiding a widget hides it — and the customise panel still lists it', () => {
  const layout = { order: DEFAULT_WIDGET_ORDER, hidden: ['queue'] };
  const perms = ROLE_PERMISSIONS.owner;
  assert.ok(!visibleWidgets(perms, layout).some((w) => w.key === 'queue'));
  const row = arrangeWidgets(perms, layout).find((r) => r.widget.key === 'queue');
  assert.ok(row && !row.shown, 'a hidden widget must still be offered, unticked, or it can never come back');
});

test('every registered widget is one the page can actually draw', () => {
  const src = readFileSync('app/page.tsx', 'utf8');
  const missing = DASHBOARD_WIDGETS.filter((w) => !src.includes(`case '${w.key}':`));
  assert.deepEqual(missing.map((w) => w.key), [],
    'these widgets are offered in the customise panel but nothing renders them');
});

test('the registry is well formed — unique keys, a known width, a hint', () => {
  const seen = new Set<string>();
  for (const w of DASHBOARD_WIDGETS) {
    assert.ok(!seen.has(w.key), `duplicate widget key ${w.key}`);
    seen.add(w.key);
    assert.ok(WIDTH_SPAN[w.width], `${w.key} has no column span for width ${w.width}`);
    assert.ok(w.label.trim() && w.hint.trim(), `${w.key} needs a label and a hint`);
  }
  assert.deepEqual(DEFAULT_WIDGET_ORDER, DASHBOARD_WIDGETS.map((w) => w.key));
});
