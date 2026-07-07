'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from './useAuth';
import { ROLE_PERMISSIONS } from '@/constants/roles';

/**
 * Guards the project-quote pages.
 *
 * - No session → /login?next=<current path> (magic-link sign-in)
 * - Session but role lacks canEditQuotes → /unauthorized
 *   (the owner grants roles per email on /admin)
 * - viewOnly (print page): any signed-in role may proceed
 *
 * Render nothing sensitive until `ready` is true.
 */
export function useQuotesGate(viewOnly = false) {
  const router = useRouter();
  const { user, profile, loading, signOut } = useAuth();

  const allowed = !!user && (viewOnly || (!!profile && ROLE_PERMISSIONS[profile.role].canEditQuotes));

  useEffect(() => {
    if (loading) return;
    if (!user) {
      router.replace(`/login?next=${encodeURIComponent(window.location.pathname)}`);
      return;
    }
    if (!viewOnly && profile && !ROLE_PERMISSIONS[profile.role].canEditQuotes) {
      router.replace('/unauthorized');
    }
  }, [loading, user, profile, viewOnly]);

  return { ready: !loading && allowed, loading, user, profile, signOut };
}
