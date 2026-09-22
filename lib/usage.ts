/**
 * What the team actually opens — the arithmetic behind /usage.
 *
 * OWNER, 2026-09-21: *"i feel right now there's too many menus and pages but
 * not sure what to get rid of."*
 *
 * Every function here is pure and takes its data as an argument, so the whole
 * module is testable without a database and the dashboard cannot grow its own
 * second opinion about what "dead" means.
 *
 * THE IDEA THE WHOLE MODULE TURNS ON: a page is not judged by its view count.
 * A count alone says "Market Intel: 3 views" and leaves you exactly where you
 * started. What decides a menu entry is the SHAPE of its use —
 *
 *   · reached from the MENU, or by searching for it? A page people hunt for in
 *     Spotlight is a page the menu is hiding, however often it is opened.
 *   · reached from the menu, or from the screen before it? A page only ever
 *     opened from another page does not need a menu entry at all — the link
 *     that already works is the menu entry.
 *   · one person, or the company? A page with exactly one user is a personal
 *     tool wearing a menu slot.
 *   · how many clicks in? A daily page four clicks deep is a design fault; a
 *     yearly page four clicks deep is correct.
 *
 * So `buildUsageReport` returns those four, per destination, and states a
 * verdict in words rather than leaving the owner to infer one from a number.
 */
import type { Destination } from '@/constants/navigation';

export type NavSource = 'menu' | 'spotlight' | 'link' | 'direct' | 'back';
export const NAV_SOURCES: NavSource[] = ['menu', 'spotlight', 'link', 'direct', 'back'];

export interface PageViewRow {
  viewed_at: string;
  user_email: string;
  user_role: string;
  session_id: string;
  path: string;
  dest_href: string | null;
  from_path: string | null;
  nav_source: string;
  depth: number;
  viewport?: string | null;
}

/**
 * Screens the tracker never records.
 *
 * `/shop` is the customer-facing storefront — a different audience asking a
 * different question, and once it is public its volume would bury eleven
 * people's staff traffic (owner's call, 2026-09-21: staff app only). The print
 * surfaces are a PDF being produced, not a screen being used, and /login is
 * not a destination anybody chooses.
 */
export const isTracked = (path: string): boolean => {
  const bare = (path.split('?')[0] || '/').replace(/\/+$/, '') || '/';
  if (bare === '/login' || bare === '/unauthorized') return false;
  if (bare === '/shop' || bare.startsWith('/shop/')) return false;
  if (bare.endsWith('/print') || bare.endsWith('/do')) return false;
  return true;
};

/** A uuid, a long opaque id, or a bare number standing in for one record. */
const ID_SEGMENT = /^([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}|\d+|[A-Za-z0-9_-]{16,})$/i;

/**
 * One screen, one key.
 *
 * `/proposals/<uuid>` becomes `/proposals/:id`, because the question is
 * whether the proposal EDITOR earns its place, never who read which quote —
 * and because leaving the id in would turn one row of evidence into four
 * hundred rows of noise. The `tab` parameter is kept and everything else is
 * dropped: the menu itself addresses `?tab=financials`, so a tab IS a
 * destination here, while `?q=huawei` is one person's search.
 */
export function normalizePath(pathname: string, search?: string): string {
  const bare = (pathname.split('?')[0] || '/').replace(/\/+$/, '') || '/';
  const segs = bare.split('/').map((s) => (ID_SEGMENT.test(s) ? ':id' : s));
  const clean = segs.join('/') || '/';
  const raw = search ?? (pathname.includes('?') ? pathname.slice(pathname.indexOf('?')) : '');
  const tab = /[?&]tab=([A-Za-z0-9_-]{1,40})/.exec(raw)?.[1];
  return tab ? `${clean}?tab=${tab}` : clean;
}

/**
 * The menu entry a path belongs to.
 *
 * Exact first (so `/purchasing?tab=financials` is Payments, not Purchasing),
 * then the bare path (so `/proposals/:id` counts towards Proposals — the
 * editor is how the Proposals module is USED, and crediting its traffic to
 * nothing would make the module look dead).
 */
export function destinationFor(path: string, destinations: Destination[]): Destination | null {
  const exact = destinations.find((d) => d.href === path);
  if (exact) return exact;
  const bare = path.split('?')[0];
  // Longest matching prefix wins: /sales/:id belongs to /sales, but
  // /sales/library must not be swallowed by it when both are registered.
  let best: Destination | null = null;
  for (const d of destinations) {
    const dh = d.href.split('?')[0];
    if (bare === dh || bare.startsWith(`${dh}/`)) {
      if (dh !== '/' && (!best || dh.length > best.href.split('?')[0].length)) best = d;
    }
  }
  return best;
}

/** Longer than this and they went to lunch — not time spent on the page. */
export const DWELL_CAP_MS = 15 * 60 * 1000;

export type Verdict = 'core' | 'steady' | 'rare' | 'personal' | 'dead';

export interface UsageRow {
  href: string;
  label: string;
  group: string;
  inNav: boolean;
  views: number;
  people: string[];
  roles: string[];
  lastAt: string | null;
  /** Typical clicks from landing in the app to standing on this page. */
  medianDepth: number | null;
  /** Typical seconds spent before moving on. Null until there are two views. */
  medianDwellMs: number | null;
  sources: Record<NavSource, number>;
  /** Of the arrivals that were a deliberate choice, how many used the menu. */
  menuShare: number | null;
  verdict: Verdict;
  /** What to DO about it — the sentence the owner actually reads. */
  advice: string | null;
}

export interface UsageReport {
  rows: UsageRow[];
  /** Paths that were opened but are in neither the menu nor search. */
  orphans: { path: string; views: number; people: string[]; lastAt: string }[];
  totals: { views: number; people: number; sessions: number; days: number };
  bySource: Record<NavSource, number>;
  /** Days between the oldest recorded view and now — how far to trust this. */
  coverageDays: number;
  /** Below this, no verdict is worth stating and the report says so instead. */
  confident: boolean;
}

const median = (xs: number[]): number | null => {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};

/** A report is only as trustworthy as the log is old and busy. */
export const MIN_DAYS = 7;
export const MIN_VIEWS = 100;

export function buildUsageReport(
  views: PageViewRow[],
  destinations: Destination[],
  opts: { now?: Date; rareBelow?: number; coreAbove?: number } = {},
): UsageReport {
  const now = opts.now ?? new Date();
  const rareBelow = opts.rareBelow ?? 5;
  const coreAbove = opts.coreAbove ?? 50;

  // ── dwell: the gap to the next view in the SAME tab ────────────────────────
  // Computed rather than recorded. The alternative is a second write when the
  // page is left, which `beforeunload` delivers unreliably and never at all
  // when a phone browser is killed — so the number would be missing exactly
  // for the mobile sessions this is meant to measure.
  const bySession = new Map<string, PageViewRow[]>();
  for (const v of views) {
    const list = bySession.get(v.session_id);
    if (list) list.push(v); else bySession.set(v.session_id, [v]);
  }
  const dwellFor = new Map<PageViewRow, number>();
  for (const list of bySession.values()) {
    list.sort((a, b) => a.viewed_at.localeCompare(b.viewed_at));
    for (let i = 0; i < list.length - 1; i++) {
      const ms = Date.parse(list[i + 1].viewed_at) - Date.parse(list[i].viewed_at);
      if (ms > 0 && ms <= DWELL_CAP_MS) dwellFor.set(list[i], ms);
    }
  }

  const blank = (): Record<NavSource, number> =>
    ({ menu: 0, spotlight: 0, link: 0, direct: 0, back: 0 });

  interface Acc {
    views: number; people: Set<string>; roles: Set<string>;
    lastAt: string | null; depths: number[]; dwells: number[];
    sources: Record<NavSource, number>;
  }
  const newAcc = (): Acc => ({
    views: 0, people: new Set(), roles: new Set(), lastAt: null,
    depths: [], dwells: [], sources: blank(),
  });

  const acc = new Map<string, Acc>();
  const orphanAcc = new Map<string, Acc>();
  const bySource = blank();
  const people = new Set<string>();
  const sessions = new Set<string>();
  let oldest: string | null = null;

  for (const v of views) {
    const dest = v.dest_href
      ? destinations.find((d) => d.href === v.dest_href) ?? destinationFor(v.path, destinations)
      : destinationFor(v.path, destinations);
    const key = dest?.href ?? v.path;
    const bucket = dest ? acc : orphanAcc;
    let a = bucket.get(key);
    if (!a) { a = newAcc(); bucket.set(key, a); }
    a.views++;
    if (v.user_email) { a.people.add(v.user_email); people.add(v.user_email); }
    if (v.user_role) a.roles.add(v.user_role);
    if (!a.lastAt || v.viewed_at > a.lastAt) a.lastAt = v.viewed_at;
    if (Number.isFinite(v.depth)) a.depths.push(Number(v.depth));
    const d = dwellFor.get(v);
    if (d != null) a.dwells.push(d);
    const src = (NAV_SOURCES as string[]).includes(v.nav_source) ? v.nav_source as NavSource : 'link';
    a.sources[src]++;
    bySource[src]++;
    sessions.add(v.session_id);
    if (!oldest || v.viewed_at < oldest) oldest = v.viewed_at;
  }

  const coverageDays = oldest
    ? Math.max(0, Math.round((now.getTime() - Date.parse(oldest)) / 86_400_000))
    : 0;
  const confident = coverageDays >= MIN_DAYS && views.length >= MIN_VIEWS;

  const rows: UsageRow[] = destinations.map((d) => {
    const a = acc.get(d.href) ?? newAcc();
    // A "deliberate" arrival is one where the person chose this page from
    // somewhere that lists it. Back and refresh are neither a menu's success
    // nor its failure, so they are left out of the share entirely.
    const deliberate = a.sources.menu + a.sources.spotlight + a.sources.link;
    const menuShare = deliberate > 0 ? a.sources.menu / deliberate : null;
    const verdict: Verdict =
      a.views === 0 ? 'dead'
      : a.people.size === 1 && a.views >= rareBelow ? 'personal'
      : a.views < rareBelow ? 'rare'
      : a.views >= coreAbove ? 'core'
      : 'steady';
    return {
      href: d.href, label: d.label, group: d.group, inNav: !!d.inNav,
      views: a.views,
      people: [...a.people].sort(),
      roles: [...a.roles].sort(),
      lastAt: a.lastAt,
      medianDepth: median(a.depths),
      medianDwellMs: median(a.dwells),
      sources: a.sources,
      menuShare,
      verdict,
      advice: null,
    };
  });
  for (const r of rows) r.advice = adviseOn(r, { confident, coverageDays, rareBelow });

  const orphans = [...orphanAcc.entries()]
    .map(([path, a]) => ({ path, views: a.views, people: [...a.people].sort(), lastAt: a.lastAt ?? '' }))
    .sort((x, y) => y.views - x.views);

  rows.sort((a, b) => b.views - a.views || a.label.localeCompare(b.label));

  return {
    rows, orphans,
    totals: { views: views.length, people: people.size, sessions: sessions.size, days: coverageDays },
    bySource, coverageDays, confident,
  };
}

/**
 * The sentence the owner reads instead of doing the inference themselves.
 *
 * Order matters — each page gets ONE recommendation, the strongest that
 * applies, because a list where every row carries three suggestions is a list
 * nobody acts on. And nothing is recommended for REMOVAL while the log is too
 * young to tell a quiet fortnight from a dead page: a wrong "nobody uses this"
 * is how a working module gets deleted.
 */
export function adviseOn(
  r: UsageRow,
  ctx: { confident: boolean; coverageDays: number; rareBelow: number },
): string | null {
  const { confident, coverageDays, rareBelow } = ctx;
  if (r.views === 0) {
    return confident
      ? `Nobody has opened this in ${coverageDays} days.${r.inNav ? ' Take it out of the menu — search will still find it.' : ''}`
      : `No views yet — only ${coverageDays} day${coverageDays === 1 ? '' : 's'} of log so far.`;
  }
  if (!confident) return null;
  if (r.inNav && r.menuShare != null && r.menuShare < 0.15 && r.views >= rareBelow) {
    return `Opened ${r.views}× but almost never from the menu — people arrive from the screen before it. The menu slot is not earning its place.`;
  }
  if (!r.inNav && r.sources.spotlight >= rareBelow) {
    return `Not in the menu, yet people search for it ${r.sources.spotlight}× — it should have a menu entry.`;
  }
  if (r.inNav && r.people.length === 1) {
    return `One person opens this (${r.people[0]}). It is a personal tool in a company menu.`;
  }
  if (r.medianDepth != null && r.medianDepth >= 3 && r.views >= 20) {
    return `Used often and sits ${r.medianDepth} clicks deep. Promote it.`;
  }
  if (r.sources.spotlight > r.sources.menu && r.views >= rareBelow) {
    return `Searched for more often than it is clicked in the menu — the menu is burying it.`;
  }
  return null;
}

/** Groups, with their totals — "is a whole section dead?" is the bigger cut. */
export function byGroup(rows: UsageRow[]): { group: string; views: number; entries: number; dead: number }[] {
  const m = new Map<string, { group: string; views: number; entries: number; dead: number }>();
  for (const r of rows) {
    let g = m.get(r.group);
    if (!g) { g = { group: r.group, views: 0, entries: 0, dead: 0 }; m.set(r.group, g); }
    g.views += r.views;
    g.entries++;
    if (r.views === 0) g.dead++;
  }
  return [...m.values()].sort((a, b) => b.views - a.views);
}
