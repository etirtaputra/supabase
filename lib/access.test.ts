/**
 * Access is ONE rule — the menu shows exactly what the screen admits.
 *
 * The failure this guards against is not exotic: the menu offered a door that
 * threw you out ("Access restricted" on a page you were invited to), or hid a
 * door you were allowed to walk through. Both came from the same cause — the
 * rule was written twice, once in constants/navigation.ts for the menu and
 * again by hand inside each page.
 *
 *   1. Every screen that can bounce someone must ask `canOpenPath`, so its gate
 *      IS the menu's gate. Checked by reading the app's own source.
 *   2. What each role sees is pinned below, so widening or narrowing anyone's
 *      access shows up as a failing test rather than as a surprise in someone's
 *      menu on a Monday morning.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { DESTINATIONS, destinationsFor, menuDestinationsFor, canOpenPath } from '../constants/navigation.ts';
import { ROLE_PERMISSIONS, type UserRole } from '../constants/roles.ts';

/**
 * The one screen allowed to keep its own rule: /purchasing admits anyone with
 * buy-side access OR a single visible tab, which no single capability names.
 */
const OWN_RULE = new Set(['app/purchasing/page.tsx']);

const pageFiles = (dir: string): string[] => {
  const out: string[] = [];
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) out.push(...pageFiles(p));
    else if (e.name === 'page.tsx') out.push(p);
  }
  return out;
};

test('every screen that can turn someone away asks the shared rule', () => {
  const offenders: string[] = [];
  for (const f of pageFiles('app')) {
    const src = readFileSync(f, 'utf8');
    if (!src.includes('/unauthorized')) continue;          // no gate, nothing to align
    if (OWN_RULE.has(f)) continue;
    if (f === 'app/unauthorized/page.tsx') continue;        // it IS the restricted screen
    if (!src.includes('canOpenPath')) offenders.push(f);
  }
  assert.deepEqual(offenders, [],
    `these screens gate access by hand, so the menu can disagree with them: ${offenders.join(', ')}`);
});

test('a menu entry never leads to a door that throws you out', () => {
  for (const role of Object.keys(ROLE_PERMISSIONS) as UserRole[]) {
    const perms = ROLE_PERMISSIONS[role];
    for (const d of destinationsFor(perms)) {
      assert.ok(canOpenPath(perms, d.href), `${role} is shown ${d.href} but would be bounced`);
    }
  }
});

test('an unregistered path is open — registering it is how a page gets a gate', () => {
  assert.equal(canOpenPath(ROLE_PERMISSIONS.viewer, '/somewhere-nobody-declared'), true);
  // A query string is not part of the identity — /settings?tab=users is /settings
  assert.equal(canOpenPath(ROLE_PERMISSIONS.viewer, '/settings?tab=users'), false);
  assert.equal(canOpenPath(ROLE_PERMISSIONS.owner, '/settings?tab=users'), true);
  // Still loading a profile: never flash a locked door before the answer is known
  assert.equal(canOpenPath(null, '/settings'), true);
});

/** What each role finds in its menu. Change this only on purpose. */
const EXPECTED: Record<UserRole, string[]> = {
  owner: [
    '/', '/purchasing?tab=catalog', '/purchasing?tab=quoting', '/purchasing?tab=progress', '/purchasing?tab=financials',
    '/purchasing?tab=lookup', '/suppliers', '/stock', '/stock/receive', '/stock/reconcile',
    '/customers', '/products', '/sales', '/invoices', '/delivery', '/serials', '/aftersales',
    '/support-letters', '/banks', '/spend-cash', '/profitability', '/items', '/specs',
    '/purchasing?tab=market-intel', '/pricing', '/proposals', '/settings', '/import-export',
  ],
  buy_admin: [
    '/', '/purchasing?tab=catalog', '/purchasing?tab=quoting', '/purchasing?tab=progress', '/purchasing?tab=financials',
    '/purchasing?tab=lookup', '/suppliers', '/stock', '/stock/receive', '/stock/reconcile',
    '/products', '/delivery', '/serials', '/banks', '/specs',
    '/purchasing?tab=market-intel', '/import-export',
  ],
  sell_admin: [
    '/', '/customers', '/products', '/sales', '/invoices', '/delivery', '/serials',
    '/aftersales', '/support-letters', '/banks', '/specs', '/pricing', '/import-export',
  ],
  sales: [
    '/', '/customers', '/products', '/sales', '/invoices', '/delivery', '/serials',
    '/aftersales', '/support-letters',
  ],
  engineer: [
    '/', '/customers', '/products', '/sales', '/invoices', '/delivery', '/serials',
    '/aftersales', '/support-letters', '/proposals',
  ],
  warehouse: ['/', '/stock', '/stock/receive', '/delivery', '/serials'],
  aftersales: ['/', '/customers', '/serials', '/aftersales'],
  viewer: ['/'],
  data_entry: [
    '/', '/purchasing?tab=catalog', '/purchasing?tab=quoting', '/purchasing?tab=progress', '/purchasing?tab=lookup',
    '/suppliers', '/stock', '/stock/receive', '/stock/reconcile', '/delivery', '/serials',
    '/specs', '/purchasing?tab=market-intel',
  ],
  finance: [
    '/', '/purchasing?tab=catalog', '/purchasing?tab=quoting', '/purchasing?tab=progress', '/purchasing?tab=financials',
    '/purchasing?tab=lookup', '/suppliers', '/stock', '/stock/reconcile', '/invoices',
    '/banks', '/specs', '/purchasing?tab=market-intel', '/import-export',
  ],
};

test('each role sees exactly the menu it is meant to see', () => {
  for (const role of Object.keys(ROLE_PERMISSIONS) as UserRole[]) {
    const shown = menuDestinationsFor(ROLE_PERMISSIONS[role]).map((d) => d.href);
    assert.deepEqual(shown, EXPECTED[role], `menu changed for ${role}`);
  }
});

test('the single-job roles reach their job and stop there', () => {
  const wh = ROLE_PERMISSIONS.warehouse;
  const svc = ROLE_PERMISSIONS.aftersales;
  // The warehouse handles goods
  for (const p of ['/stock', '/stock/receive', '/serials', '/delivery']) {
    assert.equal(canOpenPath(wh, p), true, `warehouse cannot open ${p}`);
  }
  // ...and never the money or the prices
  for (const p of ['/purchasing', '/purchasing?tab=catalog', '/stock/reconcile', '/banks', '/products', '/sales', '/invoices', '/settings']) {
    assert.equal(canOpenPath(wh, p), false, `warehouse can open ${p}`);
  }
  // The service desk handles tickets, units and the customer behind them
  for (const p of ['/aftersales', '/serials', '/customers']) {
    assert.equal(canOpenPath(svc, p), true, `after-sales cannot open ${p}`);
  }
  // ...and never pricing, invoicing or the bank
  for (const p of ['/pricing', '/invoices', '/banks', '/sales', '/purchasing', '/stock/receive', '/settings']) {
    assert.equal(canOpenPath(svc, p), false, `after-sales can open ${p}`);
  }
  // Nobody who had After Sales lost it when it moved to its own capability
  for (const r of ['owner', 'sell_admin', 'sales', 'engineer'] as UserRole[]) {
    assert.equal(canOpenPath(ROLE_PERMISSIONS[r], '/aftersales'), true, `${r} lost After Sales`);
  }
});

test('a menu with no role yet shows NOTHING, never everything', () => {
  // Staff used to see every module for a moment and watch it shrink. Unknown
  // means show nothing; the role arrives and the menu fills in.
  assert.deepEqual(menuDestinationsFor(null), []);
  // The page gates keep the opposite default on purpose — they must not bounce
  // someone before the answer is known.
  assert.ok(destinationsFor(null).length > 0);
  assert.equal(canOpenPath(null, '/settings'), true);
});

test('the menu component keeps the unknown-role rule', () => {
  const src = readFileSync('components/ui/BrandMenu.tsx', 'utf8');
  assert.ok(/roleKnown/.test(src), 'BrandMenu no longer checks whether the role is known');
  assert.ok(!/!a\.cap \|\| !perms/.test(src),
    'BrandMenu is back to treating an unknown role as permission to show everything');
});

test('every menu entry is a real destination with a hint someone can read', () => {
  for (const d of DESTINATIONS) {
    assert.ok(d.href.startsWith('/'), `${d.label} has no path`);
    if (d.inNav) assert.ok(d.label.length > 0, `${d.href} has no label`);
  }
});

/**
 * A screen may delegate its gate to a shared hook instead of redirecting
 * inline — the EPC proposal screens do, through useQuotesGate. That is still
 * the one rule (the hook asks canOpenPath), so the delegation must be visible
 * here rather than looking like an ungated page.
 */
const DELEGATED = 'useQuotesGate';

test('a menu-gated screen always enforces a gate — inline or through the shared hook', () => {
  const ungated: string[] = [];
  for (const d of DESTINATIONS) {
    const rel = d.href.split('?')[0].replace(/^\//, '');
    const f = rel ? join('app', rel, 'page.tsx') : 'app/page.tsx';
    let src: string;
    try { src = readFileSync(f, 'utf8'); } catch { continue; }   // dynamic route, no plain page
    const gatedInMenu = !!d.cap || !!d.caps || !!d.section;
    if (!gatedInMenu) continue;
    if (!src.includes('/unauthorized') && !src.includes(DELEGATED)) ungated.push(d.href.split('?')[0]);
  }
  assert.deepEqual(ungated, [],
    `hidden in the menu but open to anyone with the link: ${ungated.join(', ')}`);
});

test('the EPC screens are guarded by the path they actually are', () => {
  const list = readFileSync('app/proposals/page.tsx', 'utf8');
  const lib = readFileSync('app/proposals/library/page.tsx', 'utf8');
  const dir = readFileSync('app/proposals/directory/page.tsx', 'utf8');
  assert.ok(list.includes('useQuotesGate()'), 'the proposal list guards /proposals');
  assert.ok(lib.includes("'/proposals/library'"), 'the library guards its own path');
  assert.ok(dir.includes("'/proposals/directory'"), 'the directory guards its own path');
  // Owner-only library, any projects role may review the directory
  assert.equal(canOpenPath(ROLE_PERMISSIONS.engineer, '/proposals/library'), false);
  assert.equal(canOpenPath(ROLE_PERMISSIONS.owner, '/proposals/library'), true);
  assert.equal(canOpenPath(ROLE_PERMISSIONS.engineer, '/proposals/directory'), true);
  // EPC belongs to the project roles — a warehouse or finance login is not one
  assert.equal(canOpenPath(ROLE_PERMISSIONS.data_entry, '/proposals'), false);
  assert.equal(canOpenPath(ROLE_PERMISSIONS.finance, '/proposals'), false);
  assert.equal(canOpenPath(ROLE_PERMISSIONS.sell_admin, '/proposals'), false);
});
