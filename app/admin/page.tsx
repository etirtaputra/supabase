'use client';
import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { createSupabaseClient } from '@/lib/supabase';
import { useAuth } from '@/hooks/useAuth';
import { ROLE_LABELS, ROLE_DESCRIPTIONS, type UserRole } from '@/constants/roles';
import type { UserProfile } from '@/hooks/useAuth';

const ROLES: UserRole[] = ['owner', 'data_entry', 'finance', 'viewer'];

export default function AdminPage() {
  const supabase = createSupabaseClient();
  const router = useRouter();
  const { profile: myProfile, loading: authLoading } = useAuth();
  const [users, setUsers]     = useState<UserProfile[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving]   = useState<string | null>(null);
  const [toast, setToast]     = useState<string | null>(null);

  useEffect(() => {
    if (authLoading) return;
    if (!myProfile) { router.replace('/login'); return; }
    if (myProfile.role !== 'owner') { router.replace('/unauthorized'); return; }
    fetchUsers();
  }, [myProfile, authLoading]);

  const fetchUsers = async () => {
    setLoading(true);
    const { data } = await supabase
      .from('user_profiles')
      .select('*')
      .order('created_at', { ascending: true });
    if (data) setUsers(data as UserProfile[]);
    setLoading(false);
  };

  const updateRole = async (userId: string, role: UserRole) => {
    setSaving(userId);
    const { error } = await supabase
      .from('user_profiles')
      .update({ role })
      .eq('id', userId);
    if (!error) {
      setUsers((prev) => prev.map((u) => u.id === userId ? { ...u, role } : u));
      setToast('Role updated');
      setTimeout(() => setToast(null), 2500);
    }
    setSaving(null);
  };

  const updateName = async (userId: string, display_name: string) => {
    await supabase.from('user_profiles').update({ display_name }).eq('id', userId);
    setUsers((prev) => prev.map((u) => u.id === userId ? { ...u, display_name } : u));
  };

  if (authLoading || loading) {
    return (
      <div className="min-h-screen bg-[#060D1A] flex items-center justify-center">
        <div className="w-6 h-6 border-2 border-emerald-500/30 border-t-emerald-500 rounded-full animate-spin" />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#060D1A] text-white">
      <div className="max-w-3xl mx-auto px-4 py-10">
        {/* Header */}
        <div className="flex items-center justify-between mb-8">
          <div>
            <h1 className="text-xl font-extrabold text-white">User Management</h1>
            <p className="text-slate-500 text-xs mt-1">Set roles for who can access what in ICAPROC</p>
          </div>
          <button
            onClick={() => router.push('/insert')}
            className="text-xs text-slate-400 hover:text-slate-200 px-3 py-1.5 border border-slate-700 rounded-lg hover:bg-slate-800 transition-colors"
          >
            ← Back to app
          </button>
        </div>

        {/* Role legend */}
        <div className="grid grid-cols-2 gap-2 mb-8">
          {ROLES.map((role) => (
            <div key={role} className="bg-slate-900/60 border border-slate-800 rounded-xl p-3">
              <p className="text-xs font-bold text-slate-200 mb-0.5">{ROLE_LABELS[role]}</p>
              <p className="text-[11px] text-slate-500">{ROLE_DESCRIPTIONS[role]}</p>
            </div>
          ))}
        </div>

        {/* Users table */}
        <div className="bg-slate-900/60 border border-slate-800 rounded-2xl overflow-hidden">
          <div className="px-4 py-3 border-b border-slate-800 flex items-center justify-between">
            <p className="text-xs font-semibold uppercase tracking-widest text-slate-400">
              {users.length} user{users.length !== 1 ? 's' : ''}
            </p>
            <p className="text-[11px] text-slate-600">New users appear here after their first sign-in</p>
          </div>
          {users.length === 0 ? (
            <div className="px-4 py-8 text-center text-slate-600 text-sm">No users yet</div>
          ) : (
            <div className="divide-y divide-slate-800/60">
              {users.map((u) => (
                <div key={u.id} className="px-4 py-3 flex items-center gap-4">
                  {/* Avatar initial */}
                  <div className="w-8 h-8 rounded-full bg-slate-800 border border-slate-700 flex items-center justify-center text-xs font-bold text-slate-300 flex-shrink-0 uppercase">
                    {(u.display_name || u.email).charAt(0)}
                  </div>

                  {/* Email + editable name */}
                  <div className="flex-1 min-w-0">
                    <p className="text-sm text-white truncate">{u.email}</p>
                    <input
                      defaultValue={u.display_name ?? ''}
                      onBlur={(e) => { if (e.target.value !== u.display_name) updateName(u.id, e.target.value); }}
                      placeholder="Add display name…"
                      className="text-[11px] text-slate-500 bg-transparent focus:outline-none focus:text-slate-300 placeholder-slate-700 w-full"
                    />
                  </div>

                  {/* Role selector */}
                  <div className="flex items-center gap-2 flex-shrink-0">
                    {u.id === myProfile?.id && (
                      <span className="text-[10px] text-emerald-500/70 font-semibold">You</span>
                    )}
                    <select
                      value={u.role}
                      disabled={saving === u.id || u.id === myProfile?.id}
                      onChange={(e) => updateRole(u.id, e.target.value as UserRole)}
                      className="text-xs bg-slate-800 border border-slate-700 text-slate-300 rounded-lg px-2 py-1.5 focus:outline-none focus:ring-1 focus:ring-emerald-500/40 disabled:opacity-50 cursor-pointer"
                    >
                      {ROLES.map((r) => (
                        <option key={r} value={r}>{ROLE_LABELS[r]}</option>
                      ))}
                    </select>
                    {saving === u.id && (
                      <div className="w-3.5 h-3.5 border border-emerald-500/30 border-t-emerald-500 rounded-full animate-spin" />
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Toast */}
        {toast && (
          <div className="fixed bottom-6 right-6 px-4 py-2.5 bg-emerald-600 text-white text-sm font-semibold rounded-xl shadow-lg">
            ✓ {toast}
          </div>
        )}
      </div>
    </div>
  );
}
