/**
 * The recorder behind /usage — one row per screen opened, and nothing else.
 *
 * ── WHY IT LISTENS TO `history`, NOT TO THE ROUTER ───────────────────────────
 *
 * The obvious build is `usePathname()` in the root layout. It would miss FIVE
 * of the menu's entries. Purchasing's Item Editor, New Deal, Progress,
 * Payments and Deal Lookup are all `/purchasing?tab=…`, and the page switches
 * between them with `window.history.replaceState` — which changes the URL
 * without telling Next's router anything. The pages the owner most needs
 * counted are exactly the ones that hook would not see.
 *
 * So the tracker wraps `pushState` / `replaceState` once, emits its own event,
 * and listens to that plus `popstate`. Every URL change reaches it, whoever
 * made it and however — including any screen added later that navigates its own
 * way, with nobody having to remember this file.
 *
 * ── HOW IT KNOWS THE WAY IN ──────────────────────────────────────────────────
 *
 * One capture-phase click listener on the document, which walks up from
 * whatever was clicked to the nearest `[data-nav]` region. The menu carries
 * `data-nav="menu"`; anything else inside a link is `link`. That is one
 * attribute instead of instrumenting several hundred link sites — and a new
 * link anywhere in the app is classified correctly the day it is written.
 *
 * Spotlight is the exception and says so itself, via `noteNavSource`. Its
 * results are not links: every one of them — clicked or chosen with Enter —
 * goes through one `go(href)` function, and a keypress is not a click at all,
 * so no DOM listener could have seen the keyboard half. One call at that
 * funnel covers both, and "did they use the menu or hunt for it in search" is
 * the single most useful thing this module measures.
 *
 * Nothing here blocks navigation or awaits anything: the insert is fired and
 * forgotten, every failure is swallowed, and a missing table (the migration
 * not yet applied) costs a rejected promise and nothing else. A usage counter
 * that can break a page is not worth having.
 */
import { normalizePath, isTracked, type NavSource } from './usage';

export interface TrackedView {
  session_id: string;
  path: string;
  dest_href: string | null;
  from_path: string | null;
  nav_source: NavSource;
  depth: number;
  viewport: 'phone' | 'desktop';
}

const URL_EVENT = 'icaproc:urlchange';
const SID_KEY = 'icaproc.usage.sid';
const PREV_KEY = 'icaproc.usage.prev';
const DEPTH_KEY = 'icaproc.usage.depth';
/** A click older than this did not cause the navigation we are looking at. */
const CLICK_WINDOW_MS = 3000;

/**
 * The way in that the NEXT navigation will be attributed to.
 *
 * Module-level rather than closed over, so a navigation control that is not a
 * link (Spotlight's results) can declare itself without the tracker having to
 * recognise it.
 */
let pending: { source: NavSource; at: number } | null = null;

/** Tell the tracker how the navigation that is about to happen was chosen. */
export function noteNavSource(source: NavSource) {
  pending = { source, at: Date.now() };
}

const ss = {
  get(k: string): string | null { try { return sessionStorage.getItem(k); } catch { return null; } },
  set(k: string, v: string) { try { sessionStorage.setItem(k, v); } catch { /* private mode */ } },
};

const randomId = (): string => {
  try {
    if (crypto?.randomUUID) return crypto.randomUUID();
  } catch { /* fall through */ }
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
};

/** One browser tab, from load to close. */
function sessionId(): string {
  let sid = ss.get(SID_KEY);
  if (!sid) { sid = randomId(); ss.set(SID_KEY, sid); }
  return sid;
}

/** Patch history ONCE per page load, so a hot reload cannot stack wrappers. */
let patched = false;

/**
 * Has the landing view of THIS page load been recorded yet?
 *
 * Module-level, not per-call: React's StrictMode mounts every effect twice in
 * development, and a per-call flag would make each mount record the landing
 * again — two rows for one arrival, in the log the owner is about to delete
 * modules from. Every later navigation is already protected by the
 * "same path as last time" guard; only the landing needed this.
 */
let landed = false;
function patchHistory() {
  if (patched || typeof history === 'undefined') return;
  patched = true;
  for (const name of ['pushState', 'replaceState'] as const) {
    const original = history[name];
    history[name] = function patchedHistoryMethod(this: History, ...args: Parameters<History['pushState']>) {
      const out = original.apply(this, args);
      // A microtask, not a synchronous dispatch: the caller is usually
      // mid-render and the URL should be settled before anyone reads it.
      queueMicrotask(() => window.dispatchEvent(new Event(URL_EVENT)));
      return out;
    } as History[typeof name];
  }
}

/**
 * Start recording. Returns a teardown. Safe to call when already started —
 * the second call is a no-op, which matters because React 18's development
 * StrictMode mounts every effect twice.
 */
export function startUsageTracking(
  send: (view: TrackedView) => void,
  destHrefFor: (path: string) => string | null,
): () => void {
  if (typeof window === 'undefined') return () => {};

  const onClick = (e: MouseEvent) => {
    const t = e.target as Element | null;
    if (!t?.closest) return;
    // Only a real navigation control counts. A click on a table cell is not a
    // way into a page; the link inside it is.
    const hit = t.closest('a[href], [data-nav-link]');
    if (!hit) return;
    const region = hit.closest('[data-nav]') as HTMLElement | null;
    const named = region?.dataset?.nav;
    noteNavSource(named === 'menu' || named === 'spotlight' ? named : 'link');
  };

  const onPop = () => noteNavSource('back');

  const record = () => {
    try {
      const path = normalizePath(location.pathname, location.search);
      if (!isTracked(path)) return;
      const prev = ss.get(PREV_KEY);
      // A fresh page load is always a landing, even onto the page the tab was
      // already showing — a refresh restarts the click count honestly.
      if (landed && path === prev) return;

      let source: NavSource = 'direct';
      if (landed && pending && Date.now() - pending.at < CLICK_WINDOW_MS) source = pending.source;
      pending = null;

      const depth = source === 'direct' ? 0 : (Number(ss.get(DEPTH_KEY)) || 0) + 1;
      const wasLanding = !landed;
      landed = true;

      ss.set(PREV_KEY, path);
      ss.set(DEPTH_KEY, String(depth));

      send({
        session_id: sessionId(),
        path,
        dest_href: destHrefFor(path),
        from_path: wasLanding ? null : prev,
        nav_source: source,
        depth,
        viewport: window.innerWidth < 768 ? 'phone' : 'desktop',
      });
    } catch { /* a counter never breaks a page */ }
  };

  patchHistory();
  document.addEventListener('click', onClick, true);
  window.addEventListener('popstate', onPop);
  window.addEventListener(URL_EVENT, record);
  record();

  return () => {
    document.removeEventListener('click', onClick, true);
    window.removeEventListener('popstate', onPop);
    window.removeEventListener(URL_EVENT, record);
  };
}
