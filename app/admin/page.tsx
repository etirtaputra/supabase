'use client';
import { useEffect } from 'react';
import { useRouter } from 'next/navigation';

/**
 * User management moved into Settings › Users (app/settings/page.tsx), which
 * now also carries the sign-up allowlist. This route stays as a redirect so old
 * links and bookmarks keep working.
 */
export default function AdminPage() {
  const router = useRouter();
  useEffect(() => { router.replace('/settings?tab=users'); }, [router]);

  return (
    <div className="min-h-screen bg-[#0f1012] flex items-center justify-center">
      <div className="w-6 h-6 border-2 border-emerald-500/30 border-t-emerald-500 rounded-full animate-spin" />
    </div>
  );
}
