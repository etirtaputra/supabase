'use client';
import { useCallback, useEffect, useLayoutEffect, useMemo, useState } from 'react';
import { useSettings } from './useSettings';
import {
  arrangeWidgets, orderedWidgetKeys, hiddenWidgetKeys,
  type DashboardLayout, type DashboardWidget,
} from '@/constants/dashboardWidgets';
import type { RolePermissions } from '@/constants/roles';

const STORE_KEY = 'icaproc.dashboard.v1';

/** useLayoutEffect on the client, useEffect on the server (which never runs it). */
const useIsomorphicLayoutEffect = typeof window !== 'undefined' ? useLayoutEffect : useEffect;

/**
 * How this person's dashboard is arranged: the house layout from
 * Settings › Dashboard, unless they arranged their own.
 *
 * A personal arrangement is stored on this device as {order, hidden, base} —
 * the choice AND the house layout it diverged from — following the same rule
 * `useListLayout` learned the hard way (the 2026-08-13 bug): a preference
 * pinned forever makes the Settings screen look dead. When the owner changes
 * the house dashboard, every stale personal arrangement DISSOLVES and the new
 * default flows through. Arranging it back to exactly the house layout clears
 * the personal copy rather than freezing a copy of it.
 *
 * The personal layer REPLACES the house one rather than stacking on it, which
 * is what makes "the house switched this off, but I need it" possible: the
 * customise panel lists every widget the role may see, house-hidden ones
 * included, unticked.
 */
export function useDashboardLayout(perms: RolePermissions | null) {
  const { dashboardOrder, dashboardHidden } = useSettings();

  // The house layout, normalised — this is also the `base` a personal
  // arrangement is pinned to, so a settings change invalidates it.
  const house = useMemo<DashboardLayout>(() => ({
    order: orderedWidgetKeys(dashboardOrder),
    hidden: [...hiddenWidgetKeys(dashboardOrder, dashboardHidden)],
  }), [dashboardOrder, dashboardHidden]);
  const base = useMemo(() => JSON.stringify(house), [house]);

  const [personal, setPersonal] = useState<DashboardLayout | null>(null);

  // Re-read when the house layout lands or changes (settings load async): an
  // arrangement whose base no longer matches is IGNORED, not deleted, so a
  // transient wrong default (cold cache) cannot destroy a valid arrangement.
  //
  // A LAYOUT effect (pre-paint, post-hydration), for the reason the menu was
  // fixed on 2026-08-19: read it after the first paint and the person watches
  // the house dashboard redraw itself into theirs.
  useIsomorphicLayoutEffect(() => {
    try {
      const raw = window.localStorage.getItem(STORE_KEY);
      if (!raw) { setPersonal(null); return; }
      const p = JSON.parse(raw) as { order?: unknown; hidden?: unknown; base?: unknown };
      const ok = p.base === base && Array.isArray(p.order) && Array.isArray(p.hidden);
      setPersonal(ok
        ? { order: (p.order as unknown[]).map(String), hidden: (p.hidden as unknown[]).map(String) }
        : null);
    } catch { setPersonal(null); }
  }, [base]);

  const layout = personal ?? house;

  const save = useCallback((next: DashboardLayout | null) => {
    // Arranging it back to the house layout is following the house, not a
    // frozen copy of today's house.
    const normalised = next && {
      order: orderedWidgetKeys(next.order),
      hidden: [...hiddenWidgetKeys(next.order, next.hidden)],
    };
    // "Same as the house" means same TO THIS PERSON: a role that sees six of
    // the eleven widgets has arranged nothing when those six sit as the house
    // put them, even though its stored order can never equal the house list.
    const asSeen = (l: DashboardLayout | null) =>
      JSON.stringify(arrangeWidgets(perms, l).map((r) => `${r.widget.key}:${r.shown}`));
    const same = normalised && asSeen(normalised) === asSeen(house);
    const effective = same ? null : normalised;
    setPersonal(effective);
    try {
      if (effective) window.localStorage.setItem(STORE_KEY, JSON.stringify({ ...effective, base }));
      else window.localStorage.removeItem(STORE_KEY);
    } catch { /* private mode — the arrangement simply doesn't persist */ }
  }, [base, house, perms]);

  /** Every widget this role may see, in order, each marked shown or hidden. */
  const arranged = useMemo(() => arrangeWidgets(perms, layout), [perms, layout]);
  const visible = useMemo<DashboardWidget[]>(
    () => arranged.filter((r) => r.shown).map((r) => r.widget), [arranged]);

  return {
    /** What to draw, in order. */
    visible,
    /** What the customise panel lists — including what is switched off. */
    arranged,
    layout,
    /** True when this person has arranged their own, so "Reset" means something. */
    isPersonal: personal !== null,
    save,
    reset: useCallback(() => save(null), [save]),
  };
}
