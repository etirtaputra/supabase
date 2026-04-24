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

  const fetchProfile = async (userId: string) => {
    const { data } = await supabase
      .from('user_profiles')
      .select('*')
      .eq('id', userId)
      .single();
    if (data) setProfile(data as UserProfile);
  };

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      setUser(session?.user ?? null);
      if (session?.user) fetchProfile(session.user.id);
      else setLoading(false);
    });

    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      setUser(session?.user ?? null);
      if (session?.user) {
        fetchProfile(session.user.id).finally(() => setLoading(false));
      } else {
        setProfile(null);
        setLoading(false);
      }
    });

    return () => subscription.unsubscribe();
  }, []);

  // Mark loading done once profile is fetched
  useEffect(() => {
    if (profile) setLoading(false);
  }, [profile]);

  const signOut = () => supabase.auth.signOut();

  return { user, profile, loading, signOut };
}
