'use client';
import { useEffect } from 'react';
import { createSupabaseClient } from '@/lib/supabase';
import { getSettings, hydrateSettingsFromCache, loadSettings } from '@/lib/settings';
import { applyCompanyDefaultTheme } from '@/lib/theme';

/**
 * Puts the app settings in force. Mounted once in the root layout; renders
 * nothing.
 *
 * Order matters: localStorage is read SYNCHRONOUSLY on mount (so the first
 * render that shows data already formats the way this browser last saw), then
 * the database copy lands and overwrites it. Subscribers (`useSettings`) are
 * notified; everything else simply reads the newest values on its next render.
 * Before either step, `DEFAULT_SETTINGS` applies — the app never waits on this.
 */
export default function SettingsLoader() {
  useEffect(() => {
    hydrateSettingsFromCache();
    const supabase = createSupabaseClient();
    let cancelled = false;
    // The company-default skin follows the settings: cache it for the boot
    // script and apply it now in browsers with no personal choice.
    const refresh = () => {
      if (cancelled) return;
      void loadSettings(supabase).then(() => {
        if (!cancelled) applyCompanyDefaultTheme(getSettings().defaultTheme);
      });
    };

    // Settings are RLS-gated to signed-in users: load now if there's already a
    // session, and again whenever one is established.
    supabase.auth.getSession().then(({ data: { session } }) => { if (session) refresh(); });
    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
      if (session && (event === 'SIGNED_IN' || event === 'INITIAL_SESSION' || event === 'TOKEN_REFRESHED')) refresh();
    });
    return () => { cancelled = true; subscription.unsubscribe(); };
  }, []);

  return null;
}
