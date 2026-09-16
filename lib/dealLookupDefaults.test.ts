/**
 * Deal Lookup opens on the work, and holds one view instead of three.
 *
 * OWNER, 2026-09-16: *"Deal Lookup page should default into Active page. And
 * can we somehow filter by vendor and company all in the All Deals so we don't
 * need to switch to other sub-tabs … Right now the experience to have three
 * tabs in Deal Lookup is not a good UX."*
 *
 * WHAT WAS WRONG. The screen opened on all ~287 deals, so the first act of
 * every visit was narrowing to the ~58 that are actually running. And the three
 * tabs — All Deals / By Vendor / By Company — were never three questions. They
 * were ONE question with a filter on it: the two extra pages re-rendered the
 * same deals behind a picker, so finding a vendor's position meant leaving the
 * list, and coming back meant losing your place in it.
 *
 * WHY A TEST. Every line of this is one word long in the source — a `useState`
 * default, a `.filter()` — and each is the kind of thing a later edit flips
 * back while fixing something nearby, with nothing looking broken afterwards.
 * The same reasoning as `lib/productDefaults.test.ts`.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const SRC = readFileSync(join(process.cwd(), 'components/ui/DealLookupTab.tsx'), 'utf8');

test('the stage filter opens on Active — except behind a deep link', () => {
  // Arriving from the command palette with a PO number means you want THAT
  // deal, and it is usually completed. Landing on Active would show an empty
  // list over a search that matched.
  assert.match(SRC, /useState<[^>]*>\(\s*\n?\s*initialSearch \? 'all' : 'active'\)/,
    "stageFilter must default to 'active', and to 'all' when initialSearch is set");
});

test('the three view tabs are gone, not hidden', () => {
  for (const dead of ['by-vendor', 'by-company', 'viewMode', 'renderLeftItem']) {
    assert.ok(!SRC.includes(dead), `${dead} should have been deleted with the tab bar`);
  }
});

test('vendor and company are filters on the one list', () => {
  // The two deleted pages, in their proper form. Both must narrow the SAME
  // list rather than reopening a parallel one.
  assert.match(SRC, /selectedSuppId\)\s*base = base\.filter/,
    'a chosen vendor must narrow the list');
  assert.match(SRC, /selectedCompId\)\s*base = base\.filter/,
    'a chosen company must narrow the list');
});

test('the counts and the money follow the filter, not the catalogue', () => {
  // The point of folding the tabs in: pick a vendor and every chip renumbers
  // and the totals become that vendor's position. A summary computed over
  // allGroups would leave "Active (58)" describing deals you cannot see.
  assert.match(SRC, /const summary = useMemo\(\(\) => \{[\s\S]{0,400}?for \(const g of scoped\)/,
    'summary must count within `scoped`, never over allGroups');
  assert.match(SRC, /const money = useMemo\(\(\) => \{[\s\S]{0,300}?for \(const g of filtered\)/,
    'the money figures must describe the rows on screen');
});

test('Paid is derived from ordered and outstanding, never counted separately', () => {
  // Two numbers that must agree should never have two sources.
  assert.match(SRC, /paid: ordered - outstanding/);
});

test('a search that matches outside the stage says so', () => {
  // Opening on Active is right for the daily job and wrong for a search. The
  // screen must never go quiet while the match sits one chip away — and must
  // never silently widen the filter either.
  assert.match(SRC, /scoped\.length > filtered\.length/,
    'the out-of-stage match notice must compare scoped against filtered');
  assert.match(SRC, /Show all stages/);
});
