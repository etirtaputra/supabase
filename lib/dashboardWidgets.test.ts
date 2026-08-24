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
  DASHBOARD_WIDGETS, DEFAULT_WIDGET_ORDER, DEFAULT_WIDGET_HIDDEN, WIDTH_SPAN, WIDGET_BY_KEY,
  widgetsFor, widgetAllowed, orderedWidgetKeys, hiddenWidgetKeys, arrangeWidgets, visibleWidgets,
  ROLE_DASHBOARDS, QUICK_ACTIONS, layoutForRole, roleLeadFor, quickActionsFor,
} from '../constants/dashboardWidgets.ts';
import { ROLE_PERMISSIONS, type UserRole } from '../constants/roles.ts';
import { canOpenPath } from '../constants/navigation.ts';

const HOUSE = { order: DEFAULT_WIDGET_ORDER, hidden: DEFAULT_WIDGET_HIDDEN };
const keysFor = (role: UserRole) => visibleWidgets(ROLE_PERMISSIONS[role], HOUSE).map((w) => w.key);

/**
 * What each role finds on its dashboard, shipped defaults. Change this only on
 * purpose — a diff here is someone gaining or losing a panel.
 */
const EXPECTED: Record<UserRole, string[]> = {
  owner: ['position', 'queue', 'nextStep', 'motion', 'kpiPaid', 'kpiStockValue', 'kpiActivePos', 'kpiComponents', 'newArrivals', 'arriving', 'topProducts', 'topCustomers', 'stockAlerts', 'lastPayments', 'lastDeliveries', 'lastCases', 'activity', 'quickActions'],
  // Buy-side-only roles see no sales league table: revenue by customer is a
  // sell-side number, and they have no sell-side.
  buy_admin: ['position', 'queue', 'nextStep', 'motion', 'kpiPaid', 'kpiStockValue', 'kpiActivePos', 'kpiComponents', 'newArrivals', 'arriving', 'stockAlerts', 'lastPayments', 'lastDeliveries', 'activity', 'quickActions'],
  sell_admin: ['position', 'queue', 'nextStep', 'motion', 'newArrivals', 'arriving', 'topProducts', 'topCustomers', 'lastPayments', 'lastDeliveries', 'lastCases', 'activity', 'quickActions'],
  sales: ['position', 'queue', 'nextStep', 'motion', 'newArrivals', 'arriving', 'topProducts', 'topCustomers', 'lastPayments', 'lastDeliveries', 'lastCases', 'activity', 'quickActions'],
  engineer: ['position', 'queue', 'nextStep', 'motion', 'newArrivals', 'arriving', 'topProducts', 'topCustomers', 'lastPayments', 'lastDeliveries', 'lastCases', 'activity', 'quickActions'],
  // The warehouse lands on /stock, but what is on the water and what has
  // shipped are both its job. Still no price, still no cost.
  warehouse: ['arriving', 'lastDeliveries', 'quickActions'],
  aftersales: ['lastCases', 'quickActions'],
  // Read-only deal lookup and nothing else. An empty dashboard is the honest
  // answer — panels that could only ever say "nothing here" say nothing.
  viewer: [],
  data_entry: ['position', 'queue', 'nextStep', 'motion', 'kpiPaid', 'kpiStockValue', 'kpiActivePos', 'kpiComponents', 'newArrivals', 'arriving', 'stockAlerts', 'lastPayments', 'lastDeliveries', 'activity', 'quickActions'],
  // Legacy finance: buy-side money, but no stock and no sell-side, so no
  // deliveries feed.
  finance: ['position', 'queue', 'nextStep', 'motion', 'kpiPaid', 'kpiStockValue', 'kpiActivePos', 'kpiComponents', 'newArrivals', 'arriving', 'stockAlerts', 'lastPayments', 'activity', 'quickActions'],
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

/**
 * The payments feed is the one card that spans both sides of the money, so it
 * is the one most able to leak. A sell-side reader must get customer receipts
 * and nothing else — enforced at the fetch, not merely at the render.
 */
test('the payments feed asks only for the directions its reader may see', () => {
  const src = readFileSync('lib/recentFeeds.ts', 'utf8');
  const code = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
  // Supplier costs are reached only behind the moneyOut flag...
  const outIdx = code.indexOf('opts.moneyOut');
  const costIdx = code.indexOf('6.0_po_costs');
  assert.ok(outIdx >= 0 && costIdx > outIdx,
    'supplier payments must sit behind the moneyOut flag, never fetched unconditionally');
  // ...and the page decides that flag from buySide alone.
  const page = readFileSync('app/page.tsx', 'utf8');
  assert.ok(page.includes('moneyOut: !!perms.buySide'),
    'only a buy-side role may ask for money out');
});

test('a saved arrangement cannot smuggle in a widget the role may not have', () => {
  // A hostile (or simply stale) local arrangement naming everything, unhidden.
  const greedy = { order: DASHBOARD_WIDGETS.map((w) => w.key), hidden: [] };
  assert.deepEqual(visibleWidgets(ROLE_PERMISSIONS.sales, greedy), visibleWidgets(ROLE_PERMISSIONS.sales, HOUSE));
  assert.deepEqual(visibleWidgets(ROLE_PERMISSIONS.warehouse, greedy).map((w) => w.key), ['arriving', 'lastDeliveries', 'quickActions']);
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

// ── Role-relevant defaults (2026-08-23) ───────────────────────────────────────
/**
 * `defaultOn` used to be one global flag: everyone who had never customised
 * opened on the same eighteen panels, minus what their role gated out. The
 * tailoring was subtractive only — permissions removed things, nothing was
 * ever ordered for the job someone actually does.
 *
 * `ROLE_DASHBOARDS` closes that, and these tests are the price of it: a role's
 * lead is a PROMISE that the role can actually see those panels, the house
 * layout must still win where it says off, and the Quick Actions card must
 * keep coming out of the same map as the panels rather than a second list.
 */

/**
 * What each role OPENS ON — the shipped house, resolved through its role.
 * Change this only on purpose: a diff here is somebody's dashboard being
 * rearranged underneath them.
 */
const EXPECTED_START: Record<UserRole, string[]> = {
  owner: ['position', 'queue', 'nextStep', 'motion', 'kpiPaid', 'kpiStockValue', 'kpiActivePos', 'kpiComponents', 'newArrivals', 'arriving', 'topProducts', 'topCustomers', 'stockAlerts', 'lastPayments', 'lastDeliveries', 'lastCases', 'activity', 'quickActions'],
  // Procurement opens on the blockage, not the cash position.
  buy_admin: ['queue', 'stockAlerts', 'arriving', 'newArrivals', 'position', 'nextStep', 'motion', 'kpiPaid', 'kpiStockValue', 'kpiActivePos', 'kpiComponents', 'lastPayments', 'lastDeliveries', 'activity', 'quickActions'],
  sell_admin: ['queue', 'position', 'topCustomers', 'topProducts', 'nextStep', 'motion', 'newArrivals', 'arriving', 'lastPayments', 'lastDeliveries', 'lastCases', 'activity', 'quickActions'],
  sales: ['queue', 'newArrivals', 'topCustomers', 'position', 'nextStep', 'motion', 'arriving', 'topProducts', 'lastPayments', 'lastDeliveries', 'lastCases', 'activity', 'quickActions'],
  // EPC starts the two sales league tables switched OFF — offered, unticked.
  engineer: ['queue', 'newArrivals', 'arriving', 'position', 'nextStep', 'motion', 'lastPayments', 'lastDeliveries', 'lastCases', 'activity', 'quickActions'],
  warehouse: ['arriving', 'lastDeliveries', 'quickActions'],
  aftersales: ['lastCases', 'quickActions'],
  viewer: [],
  data_entry: ['queue', 'stockAlerts', 'arriving', 'newArrivals', 'position', 'nextStep', 'motion', 'kpiPaid', 'kpiStockValue', 'kpiActivePos', 'kpiComponents', 'lastPayments', 'lastDeliveries', 'activity', 'quickActions'],
  finance: ['position', 'queue', 'nextStep', 'motion', 'kpiPaid', 'kpiStockValue', 'kpiActivePos', 'kpiComponents', 'newArrivals', 'arriving', 'stockAlerts', 'lastPayments', 'activity', 'quickActions'],
};

const startFor = (role: UserRole) =>
  visibleWidgets(ROLE_PERMISSIONS[role], layoutForRole(role, HOUSE)).map((w) => w.key);

test('what each role OPENS ON is what we meant it to open on', () => {
  for (const role of Object.keys(ROLE_PERMISSIONS) as UserRole[]) {
    assert.deepEqual(startFor(role), EXPECTED_START[role], `${role}'s starting dashboard changed`);
  }
});

test('a role never leads with, or switches off, a panel it cannot see', () => {
  for (const role of Object.keys(ROLE_PERMISSIONS) as UserRole[]) {
    const mine = new Set(widgetsFor(ROLE_PERMISSIONS[role]).map((w) => w.key));
    const rd = ROLE_DASHBOARDS[role];
    for (const k of rd.lead) {
      assert.ok(WIDGET_BY_KEY.has(k), `${role} leads with ${k}, which is not a widget`);
      assert.ok(mine.has(k), `${role} leads with ${k}, which its permissions never let it see`);
    }
    for (const k of rd.off ?? []) {
      assert.ok(mine.has(k), `${role} switches off ${k}, which it could not see anyway`);
    }
    assert.deepEqual([...new Set(rd.lead)], rd.lead, `${role}'s lead names a panel twice`);
    // ...and what the person is TOLD is recommended is the same, gate applied.
    const lead = roleLeadFor(ROLE_PERMISSIONS[role], role);
    for (const k of lead) assert.ok(mine.has(k), `${role} is recommended ${k} but may not see it`);
  }
});

test('no role is handed an empty dashboard by its own defaults', () => {
  for (const role of Object.keys(ROLE_PERMISSIONS) as UserRole[]) {
    // A role that may see nothing at all legitimately opens on nothing — that
    // is the gate, not the role default. Every other role must open on
    // something, or its defaults have switched off its whole screen.
    if (widgetsFor(ROLE_PERMISSIONS[role]).length === 0) continue;
    assert.ok(startFor(role).length > 0, `${role} opens on an empty dashboard`);
  }
});

test('the role layer floats its panels up without losing the house underneath', () => {
  // A house that has been rearranged AND has switched something off.
  const houseOrder = [...DEFAULT_WIDGET_ORDER].reverse();
  const house = { order: houseOrder, hidden: ['queue', 'motion'] };
  const out = layoutForRole('buy_admin', house);
  const lead = ROLE_DASHBOARDS.buy_admin.lead;

  // The role's panels lead, in the role's order...
  assert.deepEqual(out.order.slice(0, lead.length), lead);
  // ...and everything else keeps the order the house put it in.
  const rest = out.order.slice(lead.length);
  assert.deepEqual(rest, houseOrder.filter((k) => !lead.includes(k)));
  // The house's switch-off WINS: a role may promote a panel, never un-hide one
  // the owner turned off — otherwise Settings › Dashboard would look dead.
  assert.ok(out.hidden.includes('queue'), 'the house switched queue off; the role must not switch it back on');
  assert.ok(!visibleWidgets(ROLE_PERMISSIONS.buy_admin, out).some((w) => w.key === 'queue'));
});

test('a role default switches a panel off, and the person can still switch it back', () => {
  const start = layoutForRole('engineer', HOUSE);
  assert.ok(start.hidden.includes('topProducts'), 'engineer starts with the league tables off');
  const rows = arrangeWidgets(ROLE_PERMISSIONS.engineer, start);
  const row = rows.find((r) => r.widget.key === 'topProducts');
  assert.ok(row && !row.shown, 'a role-off panel must still be offered, unticked, or it can never come back');
  // Ticking it on is an ordinary personal arrangement — nothing special.
  assert.ok(visibleWidgets(ROLE_PERMISSIONS.engineer,
    { order: start.order, hidden: start.hidden.filter((k) => k !== 'topProducts') })
    .some((w) => w.key === 'topProducts'));
});

test('no role and no house can smuggle in a panel the permissions refuse', () => {
  // Every role's own resolved start, checked against its gate.
  for (const role of Object.keys(ROLE_PERMISSIONS) as UserRole[]) {
    const mine = new Set(widgetsFor(ROLE_PERMISSIONS[role]).map((w) => w.key));
    for (const k of startFor(role)) assert.ok(mine.has(k), `${role} was shown ${k}`);
  }
  // ...and a greedy house naming everything, unhidden, still cannot.
  const greedy = { order: DASHBOARD_WIDGETS.map((w) => w.key), hidden: [] };
  assert.deepEqual(
    visibleWidgets(ROLE_PERMISSIONS.warehouse, layoutForRole('warehouse', greedy)).map((w) => w.key),
    ['arriving', 'lastDeliveries', 'quickActions']);
});

/**
 * The dissolve rule, one layer deeper (the subtle part of this module).
 *
 * A personal arrangement pins the layout it diverged from, so changing the
 * house dissolves every stale personal copy instead of leaving Settings
 * looking dead. Now that a ROLE also shapes the starting layout, that pin must
 * include the role layer — otherwise retuning a role's defaults would reach
 * nobody who had ever touched their dashboard.
 */
test('a personal arrangement is pinned to the ROLE-resolved layout, not the bare house', () => {
  const src = readFileSync('hooks/useDashboardLayout.ts', 'utf8');
  const code = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
  assert.ok(/const house[\s\S]{0,200}layoutForRole\(role,/.test(code),
    'the house a personal arrangement is measured against must be resolved through the role');
  assert.ok(code.includes('JSON.stringify(house)'),
    'the base pin must be that resolved layout, or a role change never dissolves anything');
  // Two roles must not resolve to the same pin, or the layer does nothing.
  assert.notEqual(JSON.stringify(layoutForRole('warehouse', HOUSE)),
    JSON.stringify(layoutForRole('buy_admin', HOUSE)));
});

/**
 * Quick Actions comes out of the SAME role map as the panels. The card's hint
 * has always claimed to show "the screens this role starts its day on"; until
 * 2026-08-23 that claim was backed by a second hand-kept list inside
 * `app/page.tsx` — one rule, two places, which is how the two drift apart.
 */
test('the quick-action shortcuts are the role map, not a second list', () => {
  const hrefs = new Set(QUICK_ACTIONS.map((a) => a.href));
  for (const role of Object.keys(ROLE_PERMISSIONS) as UserRole[]) {
    for (const h of ROLE_DASHBOARDS[role].starts ?? []) {
      assert.ok(hrefs.has(h), `${role} starts its day on ${h}, which is not a shortcut we offer`);
    }
  }
  const page = readFileSync('app/page.tsx', 'utf8');
  assert.ok(page.includes('quickActionsFor(perms, profile?.role ?? null)'),
    'the dashboard must ask the role map for its shortcuts');
  assert.ok(!page.includes("label: 'Deal Lookup'"),
    'the page is keeping its own copy of the shortcut list again');
});

test('a shortcut never leads to a door that throws you out', () => {
  for (const role of Object.keys(ROLE_PERMISSIONS) as UserRole[]) {
    const perms = ROLE_PERMISSIONS[role];
    const mine = quickActionsFor(perms, role);
    for (const a of mine) {
      assert.ok(canOpenPath(perms, a.href), `${role} is offered ${a.href} but may not open it`);
    }
    // The role's own screens come first, then the rest of the catalogue.
    const starts = (ROLE_DASHBOARDS[role].starts ?? []).filter((h) => mine.some((a) => a.href === h));
    assert.deepEqual(mine.slice(0, starts.length).map((a) => a.href), starts,
      `${role}'s shortcuts do not start with the screens it starts its day on`);
    // Any role with a dashboard at all has somewhere to go from it.
    if (widgetsFor(perms).length > 0) assert.ok(mine.length > 0, `${role} has a dashboard but no shortcut`);
  }
  // The warehouse sees WHAT and HOW MANY, never a price: no shortcut of its
  // own may lead to a selling screen.
  assert.deepEqual(quickActionsFor(ROLE_PERMISSIONS.warehouse, 'warehouse').map((a) => a.href),
    ['/stock/receive', '/stock', '/serials']);
  assert.deepEqual(quickActionsFor(null, 'owner'), [], 'profile unknown: offer nothing yet');
});

/**
 * The card head is ONE rule (2026-08-23).
 *
 * Four panels had hand-copied the same header row, and all four broke the same
 * way on the owner's phone: a single flex line with no wrapping rule, so the
 * browser broke inside the phrases — "Needs you / today", "4 / ITEMS",
 * "IDR / 2.816.173.107", "New / arrivals". Fixing four copies is how three of
 * them quietly drift back. There is one `CardHead` now, and this fails the
 * build if a fifth copy appears.
 */
test('no dashboard panel hand-rolls its own card head', () => {
  const src = readFileSync('components/dashboard/Widgets.tsx', 'utf8');
  const handRolled = src.split('flex items-center gap-3 px-4 sm:px-5 py-3.5 border-b').length - 1;
  assert.equal(handRolled, 0, 'a panel is building the old non-wrapping header row again');
  assert.ok(src.split('<CardHead').length - 1 >= 4, 'the panels should be using the shared head');
  // The head must be allowed to wrap BETWEEN its parts and never inside one.
  assert.ok(src.includes('flex items-center gap-x-3 gap-y-1 flex-wrap px-4 sm:px-5 py-3.5'),
    'the shared head must wrap');
  assert.ok(src.includes('text-sm font-bold text-white whitespace-nowrap'),
    'a card title must never break mid-phrase');
});

/**
 * On a phone, a row that wraps wherever its text happens to end gives six rows
 * six different shapes. Both arrival panels lay the name on the first line and
 * the badges on the second, using a zero-height `basis-full` spacer that is
 * display:none from `sm` up — so the desktop row is untouched.
 */
test('the arrival rows break in the same place on every phone row', () => {
  const src = readFileSync('components/dashboard/Widgets.tsx', 'utf8');
  assert.equal(src.split('basis-full h-0 sm:hidden').length - 1, 4,
    'New arrivals, Arriving soon and both Stock alert rows need the phone line break');
  assert.equal(src.split('items-baseline gap-x-2.5 gap-y-1 flex-wrap').length - 1, 0,
    'the old free-wrapping arrival row is back');
  // The queue's money moves to its own line on a phone, and back BEFORE the
  // arrow from sm up — which is what keeps it under the head's At-stake total.
  assert.ok(src.includes('order-4 sm:order-3 w-full sm:w-auto text-right sm:text-left'),
    'the queue amount must stack on a phone and sit before the arrow on a desktop');
  // The head's spacer exists to clear the rows' arrow; on a phone there is no
  // arrow beside the amount, so reserving it pushes the total off the column.
  assert.ok(src.includes('hidden sm:inline flex-shrink-0 invisible'),
    'the At-stake spacer must not apply where the rows carry no arrow');
});
