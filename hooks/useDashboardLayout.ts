'use client';
import { useCallback, useEffect, useLayoutEffect, useMemo, useState } from 'react';
import { useSettings } from './useSettings';
import {
  arrangeWidgets, orderedWidgetKeys, hiddenWidgetKeys, layoutForRole, roleLeadFor,
  type DashboardLayout, type DashboardWidget,
} from '@/constants/dashboardWidgets';
import type { RolePermissions, UserRole } from '@/constants/roles';

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
 *
 * The chain has THREE links since 2026-08-23: role default → house → personal.
 * `layoutForRole` floats this role's own panels to the top of the house order
 * (constants/dashboardWidgets.ts owns which), so a warehouse login and the
 * finance lead no longer open on the same arrangement with different holes in
 * it. The role layer is inside `base` deliberately — retune a role's defaults
 * and every stale personal arrangement dissolves exactly as a house change
 * does, instead of the new default never reaching the person it was for.
 */
export function useDashboardLayout(perms: RolePermissions | null, role: UserRole | null) {
  const { dashboardOrder, dashboardHidden } = useSettings();

  // The house layout as THIS ROLE receives it, normalised — this is also the
  // `base` a personal arrangement is pinned to, so a settings change (or a
  // change to the role's own defaults) invalidates it.
  const house = useMemo<DashboardLayout>(
    () => layoutForRole(role, { order: dashboardOrder, hidden: dashboardHidden }),
    [role, dashboardOrder, dashboardHidden]);
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
  const recommended = useMemo(() => roleLeadFor(perms, role), [perms, role]);

  return {
    /** What to draw, in order. */
    visible,
    /** The panels this role is recommended — the Customise panel's top group. */
    recommended,
    /** What the customise panel lists — including what is switched off. */
    arranged,
    layout,
    /** True when this person has arranged their own, so "Reset" means something. */
    isPersonal: personal !== null,
    save,
    reset: useCallback(() => save(null), [save]),
  };
}
