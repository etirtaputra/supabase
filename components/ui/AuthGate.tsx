'use client';
import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/hooks/useAuth';
import type { UserRole } from '@/constants/roles';

interface AuthGateProps {
  children: React.ReactNode;
  allowedRoles?: UserRole[];
}

export default function AuthGate({ children, allowedRoles }: AuthGateProps) {
  const { user, profile, loading } = useAuth();
  const router = useRouter();

  useEffect(() => {
    if (loading) return;
    if (!user) { router.replace('/login'); return; }
    if (allowedRoles && profile && !allowedRoles.includes(profile.role)) {
      router.replace('/unauthorized');
    }
  }, [user, profile, loading, allowedRoles, router]);

  if (loading) {
    return (
      <div className="min-h-screen bg-[#060D1A] flex items-center justify-center">
        <div className="flex flex-col items-center gap-3">
          <div className="w-6 h-6 border-2 border-emerald-500/30 border-t-emerald-500 rounded-full animate-spin" />
          <p className="text-slate-500 text-xs uppercase tracking-widest">Loading…</p>
        </div>
      </div>
    );
  }

  if (!user || !profile) return null;
  if (allowedRoles && !allowedRoles.includes(profile.role)) return null;

  return <>{children}</>;
}
