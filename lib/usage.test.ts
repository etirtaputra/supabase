/**
 * Screen Usage — the module that decides which menu entries get deleted.
 *
 * OWNER, 2026-09-21: *"i feel right now there's too many menus and pages but
 * not sure what to get rid of."*
 *
 * A dashboard that can be wrong about "nobody uses this" is worse than no
 * dashboard: the cost of the mistake is a working module removed from an ERP
 * eleven people depend on. So the tests here are mostly about the ways this
 * could LIE — a page credited to nothing because its URL carries a uuid, a
 * verdict stated from three days of log, a click count that never saw the five
 * Purchasing tabs because they navigate with `replaceState`.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  normalizePath, destinationFor, isTracked, buildUsageReport, byGroup,
  MIN_DAYS, MIN_VIEWS, type PageViewRow,
} from './usage.ts';
import { DESTINATIONS } from '../constants/navigation.ts';

const read = (p: string) => readFileSync(join(process.cwd(), p), 'utf8');
/**
 * Source with its comments removed.
 *
 * Every guard below that forbids a token has to read this, not the raw file:
 * these modules EXPLAIN why they avoid `usePathname`, and a test that trips
 * over the sentence stating the rule is a test that punishes writing the
 * reason down. (Learned the hard way twice already — lib/trueUpQueue.test.ts
 * and lib/itemEditorActions.test.ts carry the same helper.)
 */
const code = (src: string) =>
  src.replace(/\/\*[\s\S]*?\*\//g, '')
     .split('\n').map((l) => l.replace(/(^|[^:])\/\/.*$/, '$1')).join('\n');
const TRACKER = read('lib/usageTracker.ts');
const MENU = read('components/ui/BrandMenu.tsx');
const PALETTE = read('components/ui/CommandPalette.tsx');
const SQL = read('migrations/usage_analytics.sql');
const SQL_CODE = SQL.split('\n').map((l) => l.replace(/--.*$/, '')).join('\n');

const at = (iso: string) => `2026-09-${iso}`;
const view = (o: Partial<PageViewRow>): PageViewRow => ({
  viewed_at: at('01T09:00:00Z'), user_email: 'a@ica.id', user_role: 'owner',
  session_id: 's1', path: '/', dest_href: null, from_path: null,
  nav_source: 'menu', depth: 0, ...o,
});

// ── The path is the identity of a SCREEN, not of a record ──────────────────
test('a document id collapses, so the editor is one row and not four hundred', () => {
  assert.equal(normalizePath('/proposals/092cd84a-9591-4d2c-8d1e-9c600fc99d0c'), '/proposals/:id');
  assert.equal(normalizePath('/items/6b775f12-b0d6-4fc9-8644-e5592c5ef312'), '/items/:id');
  assert.equal(normalizePath('/sales/42/print'), '/sales/:id/print');
  // …and a real page is never mistaken for an id.
  assert.equal(normalizePath('/sales/library'), '/sales/library');
  assert.equal(normalizePath('/stock/reconcile'), '/stock/reconcile');
});

test('the tab is kept and everything else is dropped', () => {
  // Five of the menu's entries ARE tabs — Item Editor, New Deal, Progress,
  // Payments, Deal Lookup are all /purchasing?tab=…. Drop the tab and those
  // five collapse into one row called "Purchasing" and the report is useless.
  assert.equal(normalizePath('/purchasing', '?tab=financials'), '/purchasing?tab=financials');
  assert.equal(normalizePath('/purchasing?tab=lookup&q=huawei%20inverter'), '/purchasing?tab=lookup');
  // A search term is one person's question, not a screen. It must not be stored.
  assert.ok(!normalizePath('/purchasing?tab=lookup&q=huawei').includes('huawei'));
});

test('the customer-facing and private surfaces are not counted', () => {
  for (const off of ['/login', '/unauthorized', '/shop', '/shop/p/abc', '/sales/:id/print', '/sales/:id/do']) {
    assert.equal(isTracked(off), false, `${off} must not be recorded`);
  }
  for (const on of ['/', '/purchasing?tab=progress', '/proposals/:id', '/stock']) {
    assert.equal(isTracked(on), true, `${on} must be recorded`);
  }
});

// ── Crediting traffic to the right menu entry ───────────────────────────────
test('a deep page counts towards the module that owns it', () => {
  // The proposal EDITOR is how Proposals is used. Crediting its traffic to
  // nothing would make the module look dead and get it cut.
  assert.equal(destinationFor('/proposals/:id', DESTINATIONS)?.href, '/proposals');
  // …but a registered sibling is not swallowed by the shorter prefix.
  assert.equal(destinationFor('/proposals/library', DESTINATIONS)?.href, '/proposals/library');
  assert.equal(destinationFor('/sales/library', DESTINATIONS)?.href, '/sales/library');
  // The exact tab beats the bare page.
  assert.equal(destinationFor('/purchasing?tab=financials', DESTINATIONS)?.href, '/purchasing?tab=financials');
  // '/' must not act as a prefix for the whole application.
  assert.equal(destinationFor('/nowhere-at-all', DESTINATIONS), null);
});

// ── The verdicts ────────────────────────────────────────────────────────────
const busyLog = (): PageViewRow[] => {
  const out: PageViewRow[] = [];
  for (let i = 0; i < MIN_VIEWS + 20; i++) {
    out.push(view({
      viewed_at: `2026-09-${String((i % 20) + 1).padStart(2, '0')}T09:00:00Z`,
      session_id: `s${i}`, path: '/stock', dest_href: '/stock',
      user_email: i % 2 ? 'a@ica.id' : 'b@ica.id', nav_source: 'menu', depth: 1,
    }));
  }
  return out;
};

test('NOTHING is recommended for removal until the log is old enough and busy enough', () => {
  // The whole failure mode this module has: a quiet fortnight reads exactly
  // like a dead page, and the difference is a module deleted by mistake.
  const thin = [view({ path: '/stock', dest_href: '/stock', viewed_at: at('20T09:00:00Z') })];
  const r = buildUsageReport(thin, DESTINATIONS, { now: new Date('2026-09-22T09:00:00Z') });
  assert.equal(r.confident, false);
  const unopened = r.rows.find((x) => x.href === '/banks')!;
  assert.equal(unopened.views, 0);
  assert.ok(!/Take it out of the menu/.test(unopened.advice ?? ''),
    'a two-day-old log must not tell anyone to delete a module');
  assert.match(unopened.advice ?? '', /day.? of log so far/);
});

test('with enough log, an unopened menu entry is named for removal', () => {
  const r = buildUsageReport(busyLog(), DESTINATIONS, { now: new Date('2026-09-22T09:00:00Z') });
  assert.equal(r.confident, true, `${r.totals.views} views over ${r.coverageDays} days should clear ${MIN_VIEWS}/${MIN_DAYS}`);
  const unopened = r.rows.find((x) => x.href === '/banks')!;
  assert.match(unopened.advice ?? '', /Take it out of the menu/);
  assert.equal(unopened.verdict, 'dead');
});

test('a page reached from a page, not from the menu, loses its menu slot', () => {
  // THE insight the module exists for: the count alone says "used 60 times"
  // and tells you to keep it. The SHAPE says nobody ever picked it out of the
  // menu — the link on the screen before it is already the menu entry.
  const log = busyLog();
  for (let i = 0; i < 60; i++) {
    log.push(view({ session_id: `x${i}`, viewed_at: at('10T09:00:00Z'), path: '/serials', dest_href: '/serials', nav_source: 'link', user_email: i % 3 ? 'a@ica.id' : 'c@ica.id' }));
  }
  const r = buildUsageReport(log, DESTINATIONS, { now: new Date('2026-09-22T09:00:00Z') });
  const row = r.rows.find((x) => x.href === '/serials')!;
  assert.equal(row.menuShare, 0);
  assert.match(row.advice ?? '', /almost never from the menu/);
});

test('a page people SEARCH for is a page the menu is hiding', () => {
  const log = busyLog();
  for (let i = 0; i < 9; i++) {
    log.push(view({ session_id: `y${i}`, viewed_at: at('11T09:00:00Z'), path: '/ask', dest_href: '/ask', nav_source: 'spotlight', user_email: i % 2 ? 'a@ica.id' : 'c@ica.id' }));
  }
  const r = buildUsageReport(log, DESTINATIONS, { now: new Date('2026-09-22T09:00:00Z') });
  const row = r.rows.find((x) => x.href === '/ask')!;
  assert.equal(row.inNav, false);
  assert.match(row.advice ?? '', /should have a menu entry/);
});

test('one person is not a company — and it says whose page it is', () => {
  const log = busyLog();
  for (let i = 0; i < 12; i++) {
    log.push(view({ session_id: `z${i}`, viewed_at: at('12T09:00:00Z'), path: '/specs', dest_href: '/specs', nav_source: 'menu', user_email: 'budi@ptmbs.co' }));
  }
  const r = buildUsageReport(log, DESTINATIONS, { now: new Date('2026-09-22T09:00:00Z') });
  const row = r.rows.find((x) => x.href === '/specs')!;
  assert.equal(row.verdict, 'personal');
  assert.match(row.advice ?? '', /budi@ptmbs\.co/);
});

test('each page carries ONE recommendation, never a pile of them', () => {
  const r = buildUsageReport(busyLog(), DESTINATIONS, { now: new Date('2026-09-22T09:00:00Z') });
  for (const row of r.rows) {
    if (!row.advice) continue;
    assert.ok(!row.advice.includes('\n'), `${row.href} stacked advice`);
  }
});

// ── Time on a page, without a second write ──────────────────────────────────
test('dwell is the gap to the next screen in the SAME tab, and lunch is excluded', () => {
  const log: PageViewRow[] = [
    view({ session_id: 'a', path: '/stock', dest_href: '/stock', viewed_at: at('01T09:00:00Z') }),
    view({ session_id: 'a', path: '/banks', dest_href: '/banks', viewed_at: at('01T09:00:30Z') }),
    // Another tab's view in between must not shorten either of them.
    view({ session_id: 'b', path: '/stock', dest_href: '/stock', viewed_at: at('01T09:00:10Z') }),
    // …and a two-hour gap is a person who went home, not time on the page.
    view({ session_id: 'b', path: '/banks', dest_href: '/banks', viewed_at: at('01T11:00:00Z') }),
  ];
  const r = buildUsageReport(log, DESTINATIONS, { now: new Date('2026-09-02T09:00:00Z') });
  assert.equal(r.rows.find((x) => x.href === '/stock')!.medianDwellMs, 30_000);
  // The last view of a session has no next view, so no dwell — never a zero,
  // which would drag every median towards "nobody stays here".
  assert.equal(r.rows.find((x) => x.href === '/banks')!.medianDwellMs, null);
});

test('a screen nobody registered is reported rather than silently dropped', () => {
  const r = buildUsageReport(
    [view({ path: '/secret-tool', dest_href: null }), view({ path: '/secret-tool', dest_href: null, session_id: 's2' })],
    DESTINATIONS, { now: new Date('2026-09-02T09:00:00Z') });
  assert.equal(r.orphans[0].path, '/secret-tool');
  assert.equal(r.orphans[0].views, 2);
});

test('groups add up to the rows they came from', () => {
  const r = buildUsageReport(busyLog(), DESTINATIONS, { now: new Date('2026-09-22T09:00:00Z') });
  const total = byGroup(r.rows).reduce((s, g) => s + g.views, 0);
  assert.equal(total, r.rows.reduce((s, x) => s + x.views, 0));
});

// ── The recorder ────────────────────────────────────────────────────────────
test('the tracker listens to history, not to the router', () => {
  // `usePathname()` would miss the five Purchasing tabs, which switch with
  // `window.history.replaceState` and tell Next's router nothing. Those are
  // exactly the entries the owner most needs counted.
  assert.match(TRACKER, /for \(const name of \['pushState', 'replaceState'\] as const\)/);
  assert.ok(!/usePathname/.test(code(TRACKER)), 'the router hook cannot see a replaceState tab switch');
  assert.match(TRACKER, /window\.addEventListener\('popstate', onPop\)/);
  assert.match(read('app/purchasing/page.tsx'), /window\.history\.replaceState\(null, '', `\/purchasing\?tab=/,
    'this is the navigation usePathname cannot see — if Purchasing stops doing it, revisit this test, not the tracker');
});

test('the menu declares itself on every one of its surfaces', () => {
  // The phone bottom bar and the More sheet are PORTALED to <body>: React
  // children of the bar, but not DOM descendants of it, so `closest()` would
  // never find a single attribute on the root. Three surfaces, three marks.
  assert.equal((code(MENU).match(/data-nav="menu"/g) ?? []).length, 3);
});

test('Spotlight says so itself, because its results are not links', () => {
  // Its rows are buttons and Enter is not a click, so no DOM listener could
  // have seen the keyboard half. One call at the single `go(href)` funnel
  // covers both halves.
  assert.match(PALETTE, /function go\(href: string, item\?: Item\) \{\s*\n\s*\/\//);
  assert.match(PALETTE, /noteNavSource\('spotlight'\)/);
  assert.equal((code(PALETTE).match(/noteNavSource\(/g) ?? []).length, 1,
    'one call, at the single funnel every result goes through — not sprinkled per row');
});

test('a counter never breaks a page', () => {
  assert.match(TRACKER, /catch \{ \/\* a counter never breaks a page \*\/ \}/);
  const COMPONENT = read('components/ui/UsageTracker.tsx');
  assert.match(COMPONENT, /\.then\(\s*\n?\s*\(\) => \{\}, \(\) => \{\},?\s*\n?\s*\)/,
    'the insert must swallow its own failure — a missing table is not a broken screen');
});

// ── The log itself ──────────────────────────────────────────────────────────
test('the browser says WHERE; the database says WHO', () => {
  // A usage log a user can forge is not evidence, and the conclusion drawn
  // from this one is which modules get deleted. Verified by impersonation
  // (rolled back, 2026-09-21): an engineer inserting user_id/user_email/role
  // belonging to the owner produced a row stamped with their own.
  assert.match(SQL_CODE, /NEW\.user_id := auth\.uid\(\);/);
  assert.match(SQL_CODE, /NEW\.viewed_at\s+:= now\(\);/);
  assert.match(SQL_CODE, /BEFORE INSERT ON public\."42\.0_page_views"/);
});

test('reads are owner-only, and nobody can edit or erase a trail', () => {
  assert.match(SQL_CODE, /can_view_usage[\s\S]*?role = 'owner'/);
  assert.match(SQL_CODE, /CREATE POLICY "page views read"[\s\S]*?USING \(public\.can_view_usage\(\)\)/);
  assert.match(SQL_CODE, /CREATE POLICY "page views insert"[\s\S]*?WITH CHECK \(user_id = auth\.uid\(\)\)/);
  for (const forbidden of ['FOR UPDATE', 'FOR DELETE']) {
    assert.ok(!SQL_CODE.includes(`${forbidden} TO authenticated`),
      `an ${forbidden} policy would let people edit their own trail`);
  }
});

test('the page is registered, owner-gated, and stays out of the menu', () => {
  const NAV = read('constants/navigation.ts');
  assert.match(NAV, /href: '\/usage'[\s\S]{0,200}?cap: 'canViewAnalytics'/);
  assert.match(NAV, /href: '\/usage'[\s\S]{0,200}?inNav: false/,
    'a module about there being too many menu entries does not add one');
});

test('the landing is recorded once per page load, not once per React mount', () => {
  // StrictMode mounts every effect twice in development. A per-call flag would
  // record the arrival twice — two rows for one arrival, in the log the owner
  // is about to delete modules from.
  const src = code(TRACKER);
  assert.match(src, /^let landed = false;$/m, 'the landing flag must be module-level');
  assert.ok(!/let landed/.test(src.slice(src.indexOf('export function startUsageTracking'))),
    'a per-call landing flag re-records the arrival on every mount');
});
