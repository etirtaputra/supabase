'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from './useAuth';
import { ROLE_PERMISSIONS } from '@/constants/roles';

/**
 * Guards the EPC proposal pages (list, editor, library, AND print).
 *
 * - No session → /login?next=<current path> (magic-link sign-in)
 * - Session but role lacks canEditQuotes → /unauthorized
 *   (the owner grants roles per email on /admin)
 * - viewOnly (print page): same role check — the print renders the full
 *   proposal, so roles without EPC access (e.g. sell-side sales) must not
 *   reach it either. RLS on 10.x mirrors this at the data layer.
 *
 * Render nothing sensitive until `ready` is true.
 */
export function useQuotesGate(viewOnly = false) {
  const router = useRouter();
  const { user, profile, loading, signOut } = useAuth();

  const allowed = !!user && !!profile && ROLE_PERMISSIONS[profile.role].canEditQuotes;

  useEffect(() => {
    if (loading) return;
    if (!user) {
      router.replace(`/login?next=${encodeURIComponent(window.location.pathname)}`);
      return;
    }
    if (profile && !ROLE_PERMISSIONS[profile.role].canEditQuotes) {
      router.replace('/unauthorized');
    }
  }, [loading, user, profile, viewOnly]);

  return { ready: !loading && allowed, loading, user, profile, signOut };
}
