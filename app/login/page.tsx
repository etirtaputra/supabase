'use client';
import { useState } from 'react';
import { createSupabaseClient } from '@/lib/supabase';

export default function LoginPage() {
  const supabase = createSupabaseClient();
  const [mode, setMode]       = useState<'password' | 'link'>('password');
  const [email, setEmail]     = useState('');
  const [password, setPassword] = useState('');
  const [sent, setSent]       = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError]     = useState<string | null>(null);

  // Send the user back to the page that required login (e.g. /quotes)
  const dest = () => {
    const next = new URLSearchParams(window.location.search).get('next');
    return next && next.startsWith('/') ? next : '/insert';
  };

  const handleLink = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError(null);
    const { error } = await supabase.auth.signInWithOtp({
      email: email.trim().toLowerCase(),
      options: { emailRedirectTo: `${window.location.origin}${dest()}` },
    });
    setLoading(false);
    if (error) setError(error.message);
    else setSent(true);
  };

  const handlePassword = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError(null);
    const { error } = await supabase.auth.signInWithPassword({
      email: email.trim().toLowerCase(),
      password,
    });
    setLoading(false);
    if (error) {
      setError(error.message === 'Invalid login credentials'
        ? 'Wrong email or password. First time here? Use the login link tab, then set a password from the app.'
        : error.message);
    } else {
      window.location.assign(dest());
    }
  };

  const inputCls = "w-full px-3 py-2.5 bg-slate-800/80 border border-slate-700 rounded-lg text-white text-sm placeholder-slate-600 focus:outline-none focus:ring-2 focus:ring-emerald-500/40 focus:border-emerald-500/50";

  return (
    <div className="min-h-screen bg-[#060D1A] flex items-center justify-center p-4">
      <div className="w-full max-w-sm">
        {/* Logo */}
        <div className="text-center mb-8">
          <h1 className="text-2xl font-extrabold text-transparent bg-clip-text bg-gradient-to-r from-emerald-400 to-sky-400 tracking-tight">
            ICAPROC
          </h1>
          <p className="text-slate-500 text-xs mt-1 uppercase tracking-widest">Supply Chain</p>
        </div>

        <div className="bg-slate-900/60 border border-slate-800 rounded-2xl p-6 shadow-2xl">
          {sent ? (
            <div className="text-center space-y-3">
              <div className="text-3xl">📬</div>
              <p className="text-white font-semibold">Check your email</p>
              <p className="text-slate-400 text-sm">
                We sent a login link to <span className="text-slate-300 font-medium">{email}</span>.
                Click it to sign in — no password needed.
              </p>
              <p className="text-slate-600 text-xs">Link expires in 10 minutes.</p>
              <button
                onClick={() => { setSent(false); setEmail(''); }}
                className="text-xs text-slate-500 hover:text-slate-300 underline mt-2"
              >
                Use a different email
              </button>
            </div>
          ) : (
            <>
              <h2 className="text-white font-semibold text-base mb-4">Sign in</h2>

              {/* Mode tabs */}
              <div className="flex gap-1 p-1 bg-slate-800/60 rounded-lg mb-5">
                {([['password', 'Password'], ['link', 'Login link']] as const).map(([key, label]) => (
                  <button
                    key={key}
                    type="button"
                    onClick={() => { setMode(key); setError(null); }}
                    className={`flex-1 py-1.5 text-xs font-semibold rounded-md transition-colors ${
                      mode === key ? 'bg-slate-700 text-white' : 'text-slate-500 hover:text-slate-300'
                    }`}
                  >
                    {label}
                  </button>
                ))}
              </div>

              <form onSubmit={mode === 'password' ? handlePassword : handleLink} className="space-y-4">
                <div>
                  <label className="block text-[11px] font-semibold uppercase tracking-wider text-slate-400 mb-1.5">
                    Email address
                  </label>
                  <input
                    type="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder="you@company.com"
                    required
                    autoFocus
                    className={inputCls}
                  />
                </div>
                {mode === 'password' && (
                  <div>
                    <label className="block text-[11px] font-semibold uppercase tracking-wider text-slate-400 mb-1.5">
                      Password
                    </label>
                    <input
                      type="password"
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      placeholder="••••••••"
                      required
                      className={inputCls}
                    />
                  </div>
                )}
                {mode === 'link' && (
                  <p className="text-slate-500 text-xs">
                    We&apos;ll email you a one-time login link — no password needed.
                  </p>
                )}
                {error && (
                  <p className="text-red-400 text-xs bg-red-500/10 border border-red-500/20 rounded-lg px-3 py-2">
                    {error}
                  </p>
                )}
                <button
                  type="submit"
                  disabled={loading || !email.trim() || (mode === 'password' && !password)}
                  className="w-full py-2.5 px-4 bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 disabled:cursor-not-allowed text-white font-semibold text-sm rounded-lg transition-colors"
                >
                  {loading ? 'Signing in…' : mode === 'password' ? 'Sign in' : 'Send login link'}
                </button>
              </form>
              {mode === 'password' && (
                <p className="text-slate-600 text-[11px] mt-4 leading-relaxed">
                  No password yet? Sign in once with the login link, then use <span className="text-slate-500">Set password</span> in the app.
                </p>
              )}
            </>
          )}
        </div>

        <p className="text-center text-slate-700 text-xs mt-6">
          Access is by invite only. Contact your administrator if you need access.
        </p>
      </div>
    </div>
  );
}
