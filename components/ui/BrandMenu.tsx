'use client';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useState } from 'react';
import { useAuth } from '@/hooks/useAuth';
import { ROLE_PERMISSIONS } from '@/constants/roles';

/**
 * ICAPROC wordmark that doubles as the cross-app navigator.
 *
 *  • The wordmark itself links to the Dashboard (home).
 *  • A caret beside it opens a small menu (Dashboard / Catalog / Insights /
 *    Quotes) — on desktop it also opens on hover; on touch, tap the caret.
 *
 * Replaces the old always-visible nav buttons / AppSwitcher pills so the
 * header stays clean, especially on mobile.
 */
// Grouped into the two mirror flows of the ERP: buy-side (procure-to-pay) and
// sell-side (order-to-cash), with the shared dashboard and EPC projects apart.
type Section = 'buySide' | 'sellSide' | 'projects' | null;
const APP_GROUPS: { title: string | null; section: Section; apps: { href: string; label: string }[] }[] = [
  { title: null, section: null, apps: [{ href: '/', label: 'Dashboard' }] },
  { title: 'Buy side', section: 'buySide', apps: [
    { href: '/catalog',  label: 'Catalog' },
    { href: '/insights', label: 'Insights' },
  ] },
  { title: 'Sell side', section: 'sellSide', apps: [
    { href: '/customers', label: 'Customers' },
    { href: '/products',  label: 'Products' },
    { href: '/sales',     label: 'Sales' },
    { href: '/invoices',  label: 'Invoices' },
    { href: '/delivery',  label: 'Delivery' },
  ] },
  { title: 'Projects', section: 'projects', apps: [{ href: '/quotes', label: 'Quotes' }] },
];

export default function BrandMenu({
  wordmarkClass = 'text-xl font-bold',
  subtitle,
}: { wordmarkClass?: string; subtitle?: string }) {
  const pathname = usePathname();
  const router = useRouter();
  const { profile, signOut } = useAuth();
  const [open, setOpen] = useState(false);

  const isActive = (href: string) =>
    href === '/' ? pathname === '/' : pathname === href || pathname.startsWith(href + '/');

  // Show only the flows this role can access (Dashboard always). While the
  // profile loads, show everything to avoid a nav flash.
  const perms = profile ? ROLE_PERMISSIONS[profile.role] : null;
  const groups = APP_GROUPS.filter((g) => !g.section || !perms || perms[g.section]);

  return (
    <div
      className="relative min-w-0"
      onMouseEnter={() => setOpen(true)}
      onMouseLeave={() => setOpen(false)}
    >
      <div className="flex items-center gap-1">
        <Link href="/" className={`${wordmarkClass} text-white tracking-tight hover:text-emerald-300 transition-colors`}>
          ICAPROC
        </Link>
        <button
          onClick={() => setOpen((o) => !o)}
          aria-label="Switch app"
          aria-expanded={open}
          className="p-1 -m-0.5 text-slate-500 hover:text-white transition-colors flex-shrink-0"
        >
          <svg className={`w-4 h-4 transition-transform duration-150 ${open ? 'rotate-180' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2"><path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" /></svg>
        </button>
      </div>
      {subtitle && <p className="text-slate-500 text-[11px] mt-0.5 truncate">{subtitle}</p>}
      {open && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
          <div className="absolute left-0 top-full mt-2 z-50 w-48 bg-slate-900 border border-slate-700 rounded-xl shadow-2xl p-1.5 max-h-[80vh] overflow-y-auto">
            {groups.map((group, gi) => (
              <div key={gi} className={gi > 0 ? 'mt-1 pt-1 border-t border-slate-800/70' : ''}>
                {group.title && <p className="px-2.5 pt-1 pb-1 text-[9px] uppercase tracking-widest text-slate-600">{group.title}</p>}
                {group.apps.map((a) => {
                  const active = isActive(a.href);
                  return (
                    <Link
                      key={a.href}
                      href={a.href}
                      onClick={() => setOpen(false)}
                      className={`flex items-center justify-between px-2.5 py-2 rounded-lg text-sm transition-colors ${
                        active ? 'bg-emerald-500/15 text-emerald-300' : 'text-slate-300 hover:bg-white/10 hover:text-white'
                      }`}
                    >
                      {a.label}
                      {active && <span className="w-1.5 h-1.5 rounded-full bg-emerald-400" />}
                    </Link>
                  );
                })}
              </div>
            ))}
            {/* Owner-only: user management */}
            {perms?.canManageUsers && (
              <div className="mt-1 pt-1 border-t border-slate-800/70">
                <p className="px-2.5 pt-1 pb-1 text-[9px] uppercase tracking-widest text-slate-600">Admin</p>
                <Link href="/admin" onClick={() => setOpen(false)}
                  className={`flex items-center justify-between px-2.5 py-2 rounded-lg text-sm transition-colors ${
                    isActive('/admin') ? 'bg-emerald-500/15 text-emerald-300' : 'text-slate-300 hover:bg-white/10 hover:text-white'
                  }`}>
                  Manage users
                  {isActive('/admin') && <span className="w-1.5 h-1.5 rounded-full bg-emerald-400" />}
                </Link>
              </div>
            )}
            {/* Signed-in user + sign out — lives here so headers stay clean on mobile */}
            {profile && (
              <div className="mt-1 pt-1.5 border-t border-slate-800/70">
                <div className="flex items-center gap-2 px-2.5 py-1.5">
                  <span className="w-5 h-5 rounded-full bg-emerald-500/20 border border-emerald-500/30 flex items-center justify-center text-[9px] font-bold text-emerald-400 uppercase flex-shrink-0">
                    {(profile.display_name || profile.email).charAt(0)}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block text-[11px] text-slate-300 truncate">{profile.display_name || profile.email}</span>
                    {profile.display_name && <span className="block text-[9px] text-slate-600 truncate">{profile.email}</span>}
                  </span>
                  <button
                    onClick={() => { setOpen(false); signOut().then(() => router.replace('/login')); }}
                    className="text-[10px] text-slate-500 hover:text-red-400 font-semibold px-1.5 py-1 transition-colors flex-shrink-0"
                  >
                    Sign out
                  </button>
                </div>
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}
