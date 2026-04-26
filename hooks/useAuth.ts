'use client';

import { useState, useEffect } from 'react';
import { createSupabaseClient } from '@/lib/supabase';
import type { User } from '@supabase/supabase-js';
import type { UserRole } from '@/constants/roles';

export interface UserProfile {
  id: string;
  email: string;
  display_name?: string;
  role: UserRole;
}

export function useAuth() {
  const supabase = createSupabaseClient();
  const [user, setUser]       = useState<User | null>(null);
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [loading, setLoading] = useState(true);

  const fetchProfile = async (u: User) => {
    const { data } = await supabase
      .from('user_profiles' as any)
      .select('*')
      .eq('id', u.id)
      .single();
    if (data) {
      setProfile(data as UserProfile);
    } else {
      // Profile doesn't exist yet — create it (trigger may not have fired)
      await (supabase as any).from('user_profiles').upsert({ id: u.id, email: u.email ?? '' });
      setProfile({ id: u.id, email: u.email ?? '', role: 'viewer' });
    }
    setLoading(false);
  };

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      setUser(session?.user ?? null);
      if (session?.user) fetchProfile(session.user);
      else setLoading(false);
    });

    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      setUser(session?.user ?? null);
      if (session?.user) {
        fetchProfile(session.user);
      } else {
        setProfile(null);
        setLoading(false);
      }
    });

    return () => subscription.unsubscribe();
  }, []);

  const signOut = () => supabase.auth.signOut();

  return { user, profile, loading, signOut };
}
