'use client';

import { useEffect, useState } from 'react';
import { createClient } from '@supabase/supabase-js';
import type { User } from '@supabase/supabase-js';
import { signInWithEmail, signUpWithEmail } from '@/lib/intake-supabase';

function getClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  );
}

function LoginScreen() {
  const [mode,     setMode]     = useState<'login' | 'signup'>('login');
  const [email,    setEmail]    = useState('');
  const [password, setPassword] = useState('');
  const [error,    setError]    = useState('');
  const [success,  setSuccess]  = useState('');
  const [loading,  setLoading]  = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(''); setSuccess(''); setLoading(true);
    try {
      if (mode === 'login') {
        const { error: err } = await signInWithEmail(email, password);
        if (err) setError(err.message);
      } else {
        const { error: err } = await signUpWithEmail(email, password);
        if (err) setError(err.message);
        else setSuccess('Check your email to confirm your account, then sign in.');
      }
    } finally { setLoading(false); }
  };

  return (
    <div className="min-h-screen bg-slate-950 flex items-center justify-center px-4">
      <div className="w-full max-w-sm">
        <div className="flex flex-col items-center mb-8">
          <div className="w-16 h-16 rounded-2xl bg-violet-600 flex items-center justify-center mb-4 text-3xl">
            💊
          </div>
          <h1 className="text-2xl font-bold text-white">Intake Tracker</h1>
          <p className="text-slate-400 text-sm mt-1">Track supplements, meds &amp; caffeine</p>
        </div>

        <div className="bg-slate-900 rounded-2xl p-6 border border-slate-700/50">
          <div className="flex gap-1 mb-6 bg-slate-800 rounded-xl p-1">
            {(['login', 'signup'] as const).map(m => (
              <button key={m} onClick={() => { setMode(m); setError(''); setSuccess(''); }}
                className={`flex-1 py-2 rounded-lg text-sm font-semibold transition-colors
                  ${mode === m ? 'bg-violet-600 text-white' : 'text-slate-400 hover:text-white'}`}>
                {m === 'login' ? 'Sign In' : 'Sign Up'}
              </button>
            ))}
          </div>

          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label className="block text-xs text-slate-400 mb-1.5">Email</label>
              <input type="email" value={email} onChange={e => setEmail(e.target.value)} required
                placeholder="you@example.com"
                className="w-full bg-slate-800 border border-slate-700 text-white rounded-xl px-4 py-3 text-sm placeholder-slate-600 focus:outline-none focus:ring-2 focus:ring-violet-500 focus:border-transparent" />
            </div>
            <div>
              <label className="block text-xs text-slate-400 mb-1.5">Password</label>
              <input type="password" value={password} onChange={e => setPassword(e.target.value)} required minLength={6}
                placeholder="••••••••"
                className="w-full bg-slate-800 border border-slate-700 text-white rounded-xl px-4 py-3 text-sm placeholder-slate-600 focus:outline-none focus:ring-2 focus:ring-violet-500 focus:border-transparent" />
            </div>
            {error   && <p className="text-rose-400 text-xs bg-rose-500/10 border border-rose-500/20 rounded-lg px-3 py-2">{error}</p>}
            {success && <p className="text-emerald-400 text-xs bg-emerald-500/10 border border-emerald-500/20 rounded-lg px-3 py-2">{success}</p>}
            <button type="submit" disabled={loading}
              className="w-full py-3 bg-violet-600 hover:bg-violet-500 disabled:opacity-50 text-white rounded-xl font-semibold text-sm transition-colors">
              {loading ? 'Please wait…' : mode === 'login' ? 'Sign In' : 'Create Account'}
            </button>
          </form>
        </div>
        <p className="text-center text-slate-600 text-xs mt-6">Intake Tracker · Powered by Supabase</p>
      </div>
    </div>
  );
}

export default function AuthGate({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null | undefined>(undefined);

  useEffect(() => {
    const client = getClient();
    client.auth.getUser().then(({ data }) => setUser(data.user ?? null));
    const { data: { subscription } } = client.auth.onAuthStateChange((_e, session) => {
      setUser(session?.user ?? null);
    });
    return () => subscription.unsubscribe();
  }, []);

  if (user === undefined) {
    return (
      <div className="min-h-screen bg-slate-950 flex items-center justify-center">
        <div className="w-8 h-8 rounded-full border-2 border-violet-500 border-t-transparent animate-spin" />
      </div>
    );
  }

  if (!user) return <LoginScreen />;
  return <>{children}</>;
}
