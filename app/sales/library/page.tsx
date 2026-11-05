'use client';
/**
 * Sales Description Library — owner-only. The texts for sales-quote lines
 * that are not catalogue items (sales and after-sales shelves), curated in
 * components/library/LibraryManager — the same screen as the EPC library,
 * separate data (22.2). Every change is logged and can be undone.
 */
import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { ROLE_PERMISSIONS } from '@/constants/roles';
import { canOpenPath } from '@/constants/navigation';
import { useAuth } from '@/hooks/useAuth';
import BrandMenu from '@/components/ui/BrandMenu';
import { useT } from '@/hooks/useT';
import { usePageTitle } from '@/hooks/usePageTitle';
import LibraryManager from '@/components/library/LibraryManager';

export default function SalesLibraryPage() {
  const { t } = useT();
  const router = useRouter();
  const { user, profile, loading: authLoading } = useAuth();
  const isOwner = profile?.role === 'owner';

  usePageTitle();
  useEffect(() => {
    if (authLoading) return;
    if (!user) { router.replace(`/login?next=${encodeURIComponent('/sales/library')}`); return; }
    if (profile && !canOpenPath(ROLE_PERMISSIONS[profile.role], '/sales/library')) router.replace('/unauthorized');
  }, [authLoading, user, profile, router]);

  if (authLoading || !profile || !isOwner) {
    return <div className="min-h-screen bg-chrome flex items-center justify-center"><div className="w-6 h-6 border-2 border-emerald-500/30 border-t-emerald-500 rounded-full animate-spin" /></div>;
  }

  return (
    <div className="min-h-screen bg-chrome text-slate-200 font-sans text-sm">
      <div className="border-b border-slate-800/60 bg-chrome/80 backdrop-blur-md sticky top-0 z-30">
        <div className="max-w-[1100px] mx-auto px-3 sm:px-4 md:px-6 py-2.5 sm:py-3 flex flex-col sm:flex-row sm:items-center justify-between sm:flex-wrap gap-2.5 sm:gap-x-4 sm:gap-y-2.5">
          <BrandMenu wordmarkClass="text-xl md:text-2xl font-extrabold" />
          <button onClick={() => router.push('/sales')} className="text-xs text-slate-400 hover:text-white px-3 py-1.5 border border-slate-700 rounded-lg hover:bg-slate-800 transition-colors">← {t('Back to Sales')}</button>
        </div>
      </div>
      <main className="max-w-[1100px] mx-auto px-3 sm:px-4 md:px-6 py-4 sm:py-5">
        <LibraryManager library="sales" />
      </main>
    </div>
  );
}
