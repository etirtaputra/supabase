'use client';

import { useState, useEffect, useLayoutEffect } from 'react';
import { createSupabaseClient } from '@/lib/supabase';
import type { User } from '@supabase/supabase-js';
import type { UserRole } from '@/constants/roles';

export interface UserProfile {
  id: string;
  email: string;
  display_name?: string;
  role: UserRole;
}

/**
 * The last role this browser saw, so the menu is right on the FIRST frame.
 *
 * Knowing the role takes two round trips — resolve the session, then read
 * `user_profiles` — and until it lands the menu cannot say what someone may
 * open. Staff saw the whole menu and then watched it shrink. Remembering the
 * answer removes the wait for every visit after the first sign-in.
 *
 * It is a HINT, never an authority: the live profile overwrites it as soon as
 * it arrives, every page gates on the live one, and the database's own row
 * policies never consult it. The worst a stale value can do is paint a menu
 * entry that the page behind it then refuses.
 */
const PROFILE_HINT = 'icaproc:profile-hint';

/** useLayoutEffect on the client, useEffect on the server (which never runs it). */
const useIsomorphicLayoutEffect = typeof window !== 'undefined' ? useLayoutEffect : useEffect;

const readHint = (): UserProfile | null => {
  if (typeof window === 'undefined') return null;
  try {
    // Only trust it while Supabase still holds a session in this browser —
    // otherwise a signed-out visitor would flash a menu before /login.
    const signedIn = Object.keys(window.localStorage).some((k) => /^sb-.*-auth-token$/.test(k));
    if (!signedIn) return null;
    const raw = window.localStorage.getItem(PROFILE_HINT);
    if (!raw) return null;
    const p = JSON.parse(raw) as UserProfile;
    return p && typeof p.id === 'string' && typeof p.role === 'string' ? p : null;
  } catch { return null; }
};

const writeHint = (p: UserProfile | null) => {
  if (typeof window === 'undefined') return;
  try {
    if (p) window.localStorage.setItem(PROFILE_HINT, JSON.stringify({ id: p.id, email: p.email, role: p.role }));
    else window.localStorage.removeItem(PROFILE_HINT);
  } catch { /* a browser refusing storage just means the old two-hop wait */ }
};

export function useAuth() {
  const supabase = createSupabaseClient();
  const [user, setUser]       = useState<User | null>(null);
  // Starts null so the client's first render matches what the server sent;
  // the hint is applied below, before the browser paints.
  const [profile, setProfile] = useState<UserProfile | null>(null);
  // `loading` still tracks the SESSION, not the hint — pages redirect to
  // /login off it, and a hint must never make a page think it can decide yet.
  const [loading, setLoading] = useState(true);

  const fetchProfile = async (u: User) => {
    const { data } = await supabase
      .from('user_profiles')
      .select('*')
      .eq('id', u.id)
      .single();
    if (data) {
      setProfile(data as UserProfile);
      writeHint(data as UserProfile);
    } else {
      // Profile doesn't exist yet — create it (trigger may not have fired)
      await supabase.from('user_profiles').upsert({ id: u.id, email: u.email ?? '' });
      const fresh = { id: u.id, email: u.email ?? '', role: 'viewer' as const };
      setProfile(fresh);
      writeHint(fresh);
    }
    setLoading(false);
  };

  // Before paint, not after: applying the remembered role in a normal effect
  // would still let one frame of empty menu through.
  useIsomorphicLayoutEffect(() => {
    const hint = readHint();
    if (hint) setProfile((p) => p ?? hint);
  }, []);

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      setUser(session?.user ?? null);
      // The hint belongs to whoever signed in last; a different person (or
      // nobody) must not inherit their menu.
      setProfile((p) => (p && p.id !== session?.user?.id ? null : p));
      if (session?.user) fetchProfile(session.user);
      else setLoading(false);
    });

    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      setUser(session?.user ?? null);
      if (session?.user) {
        fetchProfile(session.user);
      } else {
        setProfile(null);
        writeHint(null);
        setLoading(false);
      }
    });

    return () => subscription.unsubscribe();
  }, []);

  const signOut = () => { writeHint(null); return supabase.auth.signOut(); };

  return { user, profile, loading, signOut };
}
