'use client';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { useAuth } from '@/hooks/useAuth';
import { ROLE_PERMISSIONS } from '@/constants/roles';

/**
 * ICAPROC navigation, ERP-style:
 *  • Desktop (lg+): the wordmark plus a persistent inline link bar — every
 *    module is one click away, active module highlighted. The caret keeps the
 *    full menu (all groups + admin + sign-out) for narrow desktop widths.
 *  • Mobile (<md): a fixed bottom tab bar (thumb reach) with Home, the
 *    role's three primary modules, and "More" — a bottom sheet listing every
 *    module, Manage users (owner), and sign-out. Pages with their own bottom
 *    action bar (e.g. the sales editor) pass mobileNav={false}.
 * Everything is role-filtered via ROLE_PERMISSIONS sections.
 */
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

// Preferred order for the mobile bottom bar's primary slots
const MOBILE_PRIORITY = ['/sales', '/products', '/catalog', '/quotes', '/customers', '/invoices', '/delivery', '/insights'];

// Domain color language, used everywhere a module appears: buy-side is SKY
// (the supplier/PI-PO color), sell-side is EMERALD (the house sell color),
// projects is VIOLET (the project-quote accent). The nav teaches the split.
const ACCENT: Record<string, { active: string; dot: string; label: string; tab: string }> = {
  home:     { active: 'bg-white/10 text-white',              dot: 'bg-slate-300',   label: 'text-slate-600',    tab: 'text-white' },
  buySide:  { active: 'bg-sky-500/15 text-sky-300',         dot: 'bg-sky-400',     label: 'text-sky-500/70',   tab: 'text-sky-300' },
  sellSide: { active: 'bg-emerald-500/15 text-emerald-300', dot: 'bg-emerald-400', label: 'text-emerald-500/70', tab: 'text-emerald-300' },
  projects: { active: 'bg-violet-500/15 text-violet-300',   dot: 'bg-violet-400',  label: 'text-violet-500/70', tab: 'text-violet-300' },
};
const accentOf = (section: Section) => ACCENT[section ?? 'home'];
const GROUP_SHORT: Record<string, string> = { 'Buy side': 'Buy', 'Sell side': 'Sell', 'Projects': 'EPC' };

const NAV_ICONS: Record<string, React.ReactNode> = {
  '/':          <path strokeLinecap="round" strokeLinejoin="round" d="M3 12l9-9 9 9M5 10v10a1 1 0 001 1h3m10-11v10a1 1 0 01-1 1h-3m-6 0h6m-6 0v-6h6v6" />,
  '/catalog':   <path strokeLinecap="round" strokeLinejoin="round" d="M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-10L4 7m8 4v10M4 7v10l8 4" />,
  '/insights':  <path strokeLinecap="round" strokeLinejoin="round" d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />,
  '/customers': <path strokeLinecap="round" strokeLinejoin="round" d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0zm6 3a2 2 0 11-4 0 2 2 0 014 0zM7 10a2 2 0 11-4 0 2 2 0 014 0z" />,
  '/products':  <path strokeLinecap="round" strokeLinejoin="round" d="M7 7h.01M7 3h5a1.99 1.99 0 011.414.586l7 7a2 2 0 010 2.828l-7 7a2 2 0 01-2.828 0l-7-7A1.99 1.99 0 013 12V7a4 4 0 014-4z" />,
  '/sales':     <path strokeLinecap="round" strokeLinejoin="round" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />,
  '/invoices':  <path strokeLinecap="round" strokeLinejoin="round" d="M9 14l6-6m-5.5.5h.01m4.99 5h.01M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16l3.5-2 3.5 2 3.5-2 3.5 2z" />,
  '/delivery':  <path strokeLinecap="round" strokeLinejoin="round" d="M13 16V6a1 1 0 00-1-1H4a1 1 0 00-1 1v10a1 1 0 001 1h1m8-1a1 1 0 01-1 1H9m4-1V8a1 1 0 011-1h2.586a1 1 0 01.707.293l3.414 3.414a1 1 0 01.293.707V16a1 1 0 01-1 1h-1m-6-1a2 2 0 104 0m-4 0a2 2 0 114 0m6 0a2 2 0 104 0m-4 0a2 2 0 114 0" />,
  '/quotes':    <path strokeLinecap="round" strokeLinejoin="round" d="M13 10V3L4 14h7v7l9-11h-7z" />,
};

export default function BrandMenu({
  wordmarkClass = 'text-xl font-bold',
  subtitle,
  mobileNav = true,
}: { wordmarkClass?: string; subtitle?: string; mobileNav?: boolean }) {
  const pathname = usePathname();
  const router = useRouter();
  const { profile, signOut } = useAuth();
  const [open, setOpen] = useState(false);         // caret dropdown (narrow widths)
  const [moreOpen, setMoreOpen] = useState(false); // mobile "More" sheet

  const isActive = (href: string) =>
    href === '/' ? pathname === '/' : pathname === href || pathname.startsWith(href + '/');

  // Show only the flows this role can access (Dashboard always). While the
  // profile loads, show everything to avoid a nav flash.
  const perms = profile ? ROLE_PERMISSIONS[profile.role] : null;
  const groups = APP_GROUPS.filter((g) => !g.section || !perms || perms[g.section]);
  const allLinks = groups.flatMap((g) => g.apps.map((a) => ({ ...a, section: g.section })));

  // Mobile bottom bar: Home + the role's three primary modules + More
  const primary = MOBILE_PRIORITY
    .map((href) => allLinks.find((l) => l.href === href))
    .filter((l): l is { href: string; label: string; section: Section } => !!l)
    .slice(0, 3);

  // Reserve room under the page content for the fixed bottom bar (mobile only;
  // the CSS rule lives in app/layout.tsx)
  useEffect(() => {
    if (!mobileNav) return;
    document.body.classList.add('has-bottom-nav');
    return () => document.body.classList.remove('has-bottom-nav');
  }, [mobileNav]);

  const menuPanel = (
    <>
      {groups.map((group, gi) => (
        <div key={gi} className={gi > 0 ? 'mt-1 pt-1 border-t border-slate-800/70' : ''}>
          {group.title && <p className={`px-2.5 pt-1 pb-1 text-[9px] uppercase tracking-widest ${accentOf(group.section).label}`}>{group.title}</p>}
          {group.apps.map((a) => {
            const active = isActive(a.href);
            const acc = accentOf(group.section);
            return (
              <Link
                key={a.href}
                href={a.href}
                onClick={() => { setOpen(false); setMoreOpen(false); }}
                className={`flex items-center justify-between px-2.5 py-2 rounded-lg text-sm transition-colors ${
                  active ? acc.active : 'text-slate-300 hover:bg-white/10 hover:text-white'
                }`}
              >
                {a.label}
                {active && <span className={`w-1.5 h-1.5 rounded-full ${acc.dot}`} />}
              </Link>
            );
          })}
        </div>
      ))}
      {/* Owner-only: user management */}
      {perms?.canManageUsers && (
        <div className="mt-1 pt-1 border-t border-slate-800/70">
          <p className="px-2.5 pt-1 pb-1 text-[9px] uppercase tracking-widest text-slate-600">Admin</p>
          <Link href="/admin" onClick={() => { setOpen(false); setMoreOpen(false); }}
            className={`flex items-center justify-between px-2.5 py-2 rounded-lg text-sm transition-colors ${
              isActive('/admin') ? 'bg-emerald-500/15 text-emerald-300' : 'text-slate-300 hover:bg-white/10 hover:text-white'
            }`}>
            Manage users
            {isActive('/admin') && <span className="w-1.5 h-1.5 rounded-full bg-emerald-400" />}
          </Link>
        </div>
      )}
      {/* Signed-in user + sign out — lives here so headers stay clean */}
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
              onClick={() => { setOpen(false); setMoreOpen(false); signOut().then(() => router.replace('/login')); }}
              className="text-[10px] text-slate-500 hover:text-red-400 font-semibold px-1.5 py-1 transition-colors flex-shrink-0"
            >
              Sign out
            </button>
          </div>
        </div>
      )}
    </>
  );

  return (
    <div className="relative min-w-0 flex items-center gap-1 lg:gap-3">
      <div
        className="relative min-w-0 flex-shrink-0"
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
            className="p-1 -m-0.5 text-slate-500 hover:text-white transition-colors flex-shrink-0 lg:hidden"
          >
            <svg className={`w-4 h-4 transition-transform duration-150 ${open ? 'rotate-180' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2"><path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" /></svg>
          </button>
        </div>
        {subtitle && <p className="text-slate-500 text-[11px] mt-0.5 truncate lg:hidden">{subtitle}</p>}
        {open && (
          <>
            <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
            <div className="absolute left-0 top-full mt-2 z-50 w-48 bg-slate-900 border border-slate-700 rounded-xl shadow-2xl p-1.5 max-h-[80vh] overflow-y-auto">
              {menuPanel}
            </div>
          </>
        )}
      </div>

      {/* ── Desktop: persistent top-bar links, grouped by domain — the buy /
             sell / projects split reads at a glance via dividers + colors ── */}
      <nav className="hidden lg:flex items-center min-w-0 overflow-x-auto scrollbar-none">
        {groups.map((group, gi) => {
          const acc = accentOf(group.section);
          return (
            <div key={gi} className={`flex items-center gap-0.5 ${gi > 0 ? 'ml-2 pl-2 border-l border-slate-800' : ''}`}>
              {group.title && (
                <span className={`mr-0.5 text-[8px] font-bold uppercase tracking-widest ${acc.label} select-none`}>
                  {GROUP_SHORT[group.title] ?? group.title}
                </span>
              )}
              {group.apps.map((a) => {
                const active = isActive(a.href);
                return (
                  <Link
                    key={a.href}
                    href={a.href}
                    className={`px-2.5 py-1.5 rounded-lg text-[13px] font-medium whitespace-nowrap transition-colors ${
                      active ? acc.active : 'text-slate-400 hover:text-white hover:bg-white/[0.07]'
                    }`}
                  >
                    {a.label}
                  </Link>
                );
              })}
            </div>
          );
        })}
      </nav>

      {/* ── Mobile: fixed bottom tab bar (thumb reach) + More sheet ── */}
      {mobileNav && (
        <div className="md:hidden fixed bottom-0 inset-x-0 z-40 bg-[#0f1012]/95 backdrop-blur-xl border-t border-slate-800/80" style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}>
          <div className="flex items-stretch">
            {[{ href: '/', label: 'Home', section: null as Section }, ...primary].map((a) => {
              const active = isActive(a.href);
              const acc = accentOf(a.section);
              return (
                <Link key={a.href} href={a.href}
                  className={`flex-1 flex flex-col items-center gap-0.5 pt-2 pb-1.5 transition-colors ${active ? acc.tab : 'text-slate-500 active:text-slate-300'}`}>
                  <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="1.8">{NAV_ICONS[a.href] ?? NAV_ICONS['/']}</svg>
                  <span className="text-[10px] font-medium">{a.label}</span>
                </Link>
              );
            })}
            <button onClick={() => setMoreOpen(true)}
              className={`flex-1 flex flex-col items-center gap-0.5 pt-2 pb-1.5 transition-colors ${moreOpen ? 'text-emerald-300' : 'text-slate-500 active:text-slate-300'}`}>
              <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="1.8"><path strokeLinecap="round" strokeLinejoin="round" d="M4 6h16M4 12h16M4 18h16" /></svg>
              <span className="text-[10px] font-medium">More</span>
            </button>
          </div>
        </div>
      )}
      {moreOpen && (
        <div className="md:hidden fixed inset-0 z-[120]">
          <div className="absolute inset-0 bg-black/60" onClick={() => setMoreOpen(false)} />
          <div className="absolute inset-x-0 bottom-0 bg-slate-900 border-t border-slate-700 rounded-t-2xl p-3 max-h-[80vh] overflow-y-auto" style={{ paddingBottom: 'calc(1.5rem + env(safe-area-inset-bottom))' }}>
            <div className="w-10 h-1 rounded-full bg-slate-700 mx-auto mb-3" />
            {menuPanel}
          </div>
        </div>
      )}
    </div>
  );
}
