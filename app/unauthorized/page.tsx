'use client';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/hooks/useAuth';
import { createSupabaseClient } from '@/lib/supabase';

export default function UnauthorizedPage() {
  const router = useRouter();
  const { profile } = useAuth();
  const supabase = createSupabaseClient();

  return (
    <div className="min-h-screen bg-[#060D1A] flex items-center justify-center p-4">
      <div className="text-center space-y-4 max-w-sm">
        <div className="text-4xl">🔒</div>
        <h1 className="text-white font-bold text-lg">Access restricted</h1>
        <p className="text-slate-400 text-sm">
          Your account ({profile?.email}) doesn't have permission to view this page.
          Contact your administrator to request access.
        </p>
        <div className="flex flex-col gap-2 pt-2">
          <button
            onClick={() => router.back()}
            className="px-4 py-2 bg-slate-800 hover:bg-slate-700 text-slate-200 text-sm font-medium rounded-lg transition-colors"
          >
            Go back
          </button>
          <button
            onClick={() => supabase.auth.signOut().then(() => router.replace('/login'))}
            className="text-xs text-slate-600 hover:text-slate-400"
          >
            Sign out
          </button>
        </div>
      </div>
    </div>
  );
}
