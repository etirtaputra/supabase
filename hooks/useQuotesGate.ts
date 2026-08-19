'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from './useAuth';
import { ROLE_PERMISSIONS } from '@/constants/roles';
import { canOpenPath } from '@/constants/navigation';

/**
 * Guards the EPC proposal pages (list, editor, library, AND print).
 *
 * - No session → /login?next=<current path> (magic-link sign-in)
 * - Session but the role may not open this path → /unauthorized
 *
 * The rule itself comes from constants/navigation.ts, the same answer the menu
 * and the search bar use, so EPC can never be hidden from someone it would let
 * in — or offered to someone it throws out. `path` is the screen being guarded
 * (the list, its library, its directory); each carries its own entry there.
 *
 * viewOnly (print page): same check — the print renders the whole proposal, so
 * a role without EPC access must not reach it either. RLS on 10.x mirrors this
 * at the data layer.
 *
 * Render nothing sensitive until `ready` is true.
 */
export function useQuotesGate(viewOnly = false, path = '/proposals') {
  const router = useRouter();
  const { user, profile, loading, signOut } = useAuth();

  const allowed = !!user && !!profile && canOpenPath(ROLE_PERMISSIONS[profile.role], path);

  useEffect(() => {
    if (loading) return;
    if (!user) {
      router.replace(`/login?next=${encodeURIComponent(window.location.pathname)}`);
      return;
    }
    if (profile && !canOpenPath(ROLE_PERMISSIONS[profile.role], path)) {
      router.replace('/unauthorized');
    }
  }, [loading, user, profile, viewOnly, path]);

  return { ready: !loading && allowed, loading, user, profile, signOut };
}
