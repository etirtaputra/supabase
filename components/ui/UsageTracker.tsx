'use client';
import { useEffect } from 'react';
import { createSupabaseClient } from '@/lib/supabase';
import { useAuth } from '@/hooks/useAuth';
import { startUsageTracking } from '@/lib/usageTracker';
import { destinationFor } from '@/lib/usage';
import { DESTINATIONS } from '@/constants/navigation';

/**
 * Mounts the page-view recorder for a signed-in user. Renders nothing.
 *
 * It waits for `user` on purpose: `42.0_page_views.user_id` defaults to
 * `auth.uid()` and is NOT NULL, so a view recorded before sign-in would be
 * rejected by the database anyway — and the login screen is not a destination
 * anybody chose.
 */
export default function UsageTracker() {
  const { user } = useAuth();
  useEffect(() => {
    if (!user) return;
    const supabase = createSupabaseClient();
    return startUsageTracking(
      (view) => {
        // Fire and forget. The row is evidence about the menu, not part of
        // anybody's work — it must never delay a navigation or surface an
        // error on a screen someone is trying to use.
        void supabase.from('42.0_page_views').insert(view).then(
          () => {}, () => {},
        );
      },
      (path) => destinationFor(path, DESTINATIONS)?.href ?? null,
    );
  }, [user]);
  return null;
}
