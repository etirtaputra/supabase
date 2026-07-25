'use client';
import { useSyncExternalStore } from 'react';
import { DEFAULT_SETTINGS, getSettings, subscribeSettings, type AppSettings } from '@/lib/settings';

/**
 * The live app settings, re-rendering the component when they change.
 *
 * Only needed when a component must REACT to a settings change (e.g. the
 * Settings page's own preview). Plain formatting doesn't need this hook —
 * `lib/formatters.ts` reads the same store directly, so any render picks up
 * the current values.
 */
export function useSettings(): AppSettings {
  return useSyncExternalStore(subscribeSettings, getSettings, () => DEFAULT_SETTINGS);
}
