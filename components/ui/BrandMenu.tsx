'use client';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { useAuth } from '@/hooks/useAuth';
import { ROLE_PERMISSIONS, type RolePermissions } from '@/constants/roles';
import { DESTINATIONS, NAV_GROUP_ORDER, sectionAllowed, type NavSection } from '@/constants/navigation';
import { useIsDesktop } from '@/hooks/useIsDesktop';
import { useTheme } from '@/hooks/useTheme';
import CommandPalette from './CommandPalette';

/**
 * ICAPROC navigation, ERP-style:
 *  • The wordmark opens the full menu (it is a button, not a link) — Dashboard
 *    is the first entry inside it.
 *  • Desktop (lg+): the wordmark plus compact grouped dropdowns — Dashboard
 *    and single-app groups stay direct links; Buy/Sell open on hover or click
 *    and show their modules. The group you're inside keeps its domain color
 *    and shows the current module name, so the bar never overflows. The caret
 *    keeps the full menu (all groups + admin + sign-out) for narrow widths.
 *  • Mobile (<md): a fixed bottom tab bar (thumb reach) with Home, the
 *    role's three primary modules, and "More" — a bottom sheet listing every
 *    module, Settings (owner), and sign-out. Pages with their own bottom
 *    action bar (e.g. the sales editor) pass mobileNav={false}.
 * Everything is role-filtered via ROLE_PERMISSIONS sections.
 */
type Section = NavSection;

// The menu is DERIVED from constants/navigation.ts — the same list Spotlight
// indexes as "Pages", so a module can never exist in one and not the other.
// `cap` narrows an app beyond its section (e.g. Economics shows margin data →
// canManagePricing). Configuration screens (Settings, Pricing) are NOT modules:
// they sit in the Admin group at the bottom of the menu, out of the daily list.
const GROUP_TITLE: Record<string, string | null> = {
  Home: null, Buy: 'Buy', Sell: 'Sell', Finance: 'Finance', Analytics: 'Analytics', Projects: 'Projects',
};

const APP_GROUPS: { title: string | null; section: Section; apps: { href: string; label: string; cap?: keyof RolePermissions }[] }[] =
  NAV_GROUP_ORDER
    .map((g) => ({
      title: GROUP_TITLE[g] ?? null,
      section: (DESTINATIONS.find((d) => d.group === g)?.section ?? null) as Section,
      apps: DESTINATIONS.filter((d) => d.group === g && d.inNav)
        .map((d) => ({ href: d.href, label: d.label, cap: d.cap })),
    }))
    .filter((g) => g.apps.length > 0);

// Preferred order for the mobile bottom bar's primary slots
const MOBILE_PRIORITY = ['/sales', '/products', '/purchasing', '/proposals', '/customers', '/stock', '/suppliers', '/invoices', '/delivery', '/spend-cash', '/banks'];

// Domain color language, used everywhere a module appears: buy-side is SKY
// (the supplier/PI-PO color), sell-side is EMERALD (the house sell color),
// projects is VIOLET (the project-quote accent). The nav teaches the split.
const ACCENT: Record<string, { active: string; dot: string; label: string; tab: string }> = {
  home:     { active: 'bg-white/10 text-white',              dot: 'bg-slate-300',   label: 'text-slate-600',    tab: 'text-white' },
  buySide:  { active: 'bg-sky-500/15 text-sky-300',         dot: 'bg-sky-400',     label: 'text-sky-500/70',   tab: 'text-sky-300' },
  sellSide: { active: 'bg-emerald-500/15 text-emerald-300', dot: 'bg-emerald-400', label: 'text-emerald-500/70', tab: 'text-emerald-300' },
  projects: { active: 'bg-violet-500/15 text-violet-300',   dot: 'bg-violet-400',  label: 'text-violet-500/70', tab: 'text-violet-300' },
  // The Item hub spans both flows — neutral, like Money/Analytics.
  trading:  { active: 'bg-white/10 text-white',              dot: 'bg-slate-300',   label: 'text-slate-600',    tab: 'text-white' },
};
/**
 * Finance and Analytics deliberately span both flows (Analytics holds a buy
 * screen, the Item hub and a sell screen), so they take the neutral accent
 * instead of inheriting whichever domain happens to be listed first —
 * colouring them sky or emerald would claim a side they don't have.
 */
const GROUP_NEUTRAL = new Set(['Finance', 'Analytics']);
const accentOf = (section: Section, groupTitle?: string | null) =>
  ACCENT[groupTitle && GROUP_NEUTRAL.has(groupTitle) ? 'home' : (section ?? 'home')];
const GROUP_SHORT: Record<string, string> = { Projects: 'EPC' };

const NAV_ICONS: Record<string, React.ReactNode> = {
  '/':          <path strokeLinecap="round" strokeLinejoin="round" d="M3 12l9-9 9 9M5 10v10a1 1 0 001 1h3m10-11v10a1 1 0 01-1 1h-3m-6 0h6m-6 0v-6h6v6" />,
  '/purchasing':   <path strokeLinecap="round" strokeLinejoin="round" d="M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-10L4 7m8 4v10M4 7v10l8 4" />,
  '/spend-cash':  <path strokeLinecap="round" strokeLinejoin="round" d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />,
  '/customers': <path strokeLinecap="round" strokeLinejoin="round" d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0zm6 3a2 2 0 11-4 0 2 2 0 014 0zM7 10a2 2 0 11-4 0 2 2 0 014 0z" />,
  '/products':  <path strokeLinecap="round" strokeLinejoin="round" d="M7 7h.01M7 3h5a1.99 1.99 0 011.414.586l7 7a2 2 0 010 2.828l-7 7a2 2 0 01-2.828 0l-7-7A1.99 1.99 0 013 12V7a4 4 0 014-4z" />,
  '/pricing':   <path strokeLinecap="round" strokeLinejoin="round" d="M7 7h.01M7 3h5a1.99 1.99 0 011.414.586l7 7a2 2 0 010 2.828l-7 7a2 2 0 01-2.828 0l-7-7A1.99 1.99 0 013 12V7a4 4 0 014-4zm9.5 10.5l4-4" />,
  '/sales':     <path strokeLinecap="round" strokeLinejoin="round" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />,
  '/invoices':  <path strokeLinecap="round" strokeLinejoin="round" d="M9 14l6-6m-5.5.5h.01m4.99 5h.01M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16l3.5-2 3.5 2 3.5-2 3.5 2z" />,
  '/delivery':  <path strokeLinecap="round" strokeLinejoin="round" d="M13 16V6a1 1 0 00-1-1H4a1 1 0 00-1 1v10a1 1 0 001 1h1m8-1a1 1 0 01-1 1H9m4-1V8a1 1 0 011-1h2.586a1 1 0 01.707.293l3.414 3.414a1 1 0 01.293.707V16a1 1 0 01-1 1h-1m-6-1a2 2 0 104 0m-4 0a2 2 0 114 0m6 0a2 2 0 104 0m-4 0a2 2 0 114 0" />,
  '/suppliers': <path strokeLinecap="round" strokeLinejoin="round" d="M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-5 10v-5a1 1 0 011-1h2a1 1 0 011 1v5m-4 0h4" />,
  '/stock':     <path strokeLinecap="round" strokeLinejoin="round" d="M5 8h14M5 8a2 2 0 110-4h14a2 2 0 110 4M5 8v10a2 2 0 002 2h10a2 2 0 002-2V8m-9 4h4" />,
  '/items':     <path strokeLinecap="round" strokeLinejoin="round" d="M21 7.5l-9-5.25L3 7.5m18 0l-9 5.25m9-5.25v9l-9 5.25M3 7.5l9 5.25M3 7.5v9l9 5.25m0-9v9" />,
  '/profitability': <path strokeLinecap="round" strokeLinejoin="round" d="M13 7h8m0 0v8m0-8l-8 8-4-4-6 6" />,
  '/banks':     <path strokeLinecap="round" strokeLinejoin="round" d="M3 10l9-6 9 6M5 10v9m14-9v9M9 19v-5h6v5M3 21h18" />,
  '/proposals':    <path strokeLinecap="round" strokeLinejoin="round" d="M13 10V3L4 14h7v7l9-11h-7z" />,
  '/stock/receive': <path strokeLinecap="round" strokeLinejoin="round" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1M12 3v10m0 0l-4-4m4 4l4-4" />,
  '/purchasing?tab=financials': <path strokeLinecap="round" strokeLinejoin="round" d="M3 10h18M3 10a2 2 0 012-2h14a2 2 0 012 2M3 10v8a2 2 0 002 2h14a2 2 0 002-2v-8M7 15h4" />,
};

export default function BrandMenu({
  wordmarkClass = 'text-xl font-bold',
  subtitle,
  mobileNav = true,
}: { wordmarkClass?: string; subtitle?: string; mobileNav?: boolean }) {
  const pathname = usePathname();
  const router = useRouter();
  const { profile, signOut } = useAuth();
  const { theme, setTheme } = useTheme();
  const [open, setOpen] = useState(false);         // caret dropdown (narrow widths)
  const [moreOpen, setMoreOpen] = useState(false); // mobile "More" sheet
  const [deskOpen, setDeskOpen] = useState<number | null>(null); // desktop group dropdown
  const [mounted, setMounted] = useState(false);                 // portal target exists
  useEffect(() => { setMounted(true); }, []);

  const isActive = (href: string) =>
    href === '/' ? pathname === '/' : pathname === href || pathname.startsWith(href + '/');

  /**
   * Spotlight lives in the nav bar, so it is impossible for a page to ship
   * without it — the old bottom-right pill had to be remembered per page and
   * was hidden on phones entirely.
   *
   * On a wide screen the bar IS the search — results drop straight out of it,
   * so the field you clicked is the field you type into. On a phone the
   * magnifier fires `icaproc:spotlight` and the full overlay (mounted by
   * GlobalSpotlight) takes over, which is the better interaction there.
   * `useIsDesktop` decides which of the two owns ⌘I, so the shortcut can never
   * focus a hidden field and open an overlay at the same time.
   */
  const isDesktop = useIsDesktop();
  const openSpotlight = () => window.dispatchEvent(new Event('icaproc:spotlight'));

  // Show only the flows this role can access (Dashboard always). While the
  // profile loads, show everything to avoid a nav flash.
  const perms = profile ? ROLE_PERMISSIONS[profile.role] : null;
  const groups = APP_GROUPS
    .map((g) => ({ ...g, apps: g.apps.filter((a) => !a.cap || !perms || !!perms[a.cap]) }))
    .filter((g) => g.apps.length && sectionAllowed(perms, g.section));
  const allLinks = groups.flatMap((g) => g.apps.map((a) => ({ ...a, section: g.section })));
  // Configuration entries, same source, shown under Admin
  const adminLinks = DESTINATIONS.filter((d) => d.group === 'Admin' && d.inNav && (!perms || !d.cap || !!perms[d.cap]));

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

  // Close any open desktop dropdown on Escape or route change
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setDeskOpen(null); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
  useEffect(() => { setDeskOpen(null); }, [pathname]);

  // Compact rows (py-1 / 13px): the menu has grown enough groups that the
  // roomier spacing forced desktop users to SCROLL a navigation menu —
  // density is the feature here; the whole list should fit in one glance.
  const menuPanel = (
    <>
      {groups.map((group, gi) => (
        <div key={gi} className={gi > 0 ? 'mt-0.5 pt-0.5 border-t border-slate-800/70' : ''}>
          {group.title && <p className={`px-2.5 pt-1 pb-0.5 text-[9px] uppercase tracking-widest ${accentOf(group.section, group.title).label}`}>{group.title}</p>}
          {group.apps.map((a) => {
            const active = isActive(a.href);
            const acc = accentOf(group.section, group.title);
            return (
              <Link
                key={a.href}
                href={a.href}
                onClick={() => { setOpen(false); setMoreOpen(false); }}
                className={`flex items-center justify-between px-2.5 py-1 rounded-lg text-[13px] leading-5 transition-colors ${
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
      {/* Configuration, not modules: Settings (which absorbs user management)
          and Pricing, which sets the tiers every quote is priced from. Hidden
          from everyone who doesn't run them. */}
      {adminLinks.length > 0 && (
        <div className="mt-0.5 pt-0.5 border-t border-slate-800/70">
          <p className="px-2.5 pt-1 pb-0.5 text-[9px] uppercase tracking-widest text-slate-600">Admin</p>
          {adminLinks.map((d) => (
            <Link key={d.href} href={d.href} onClick={() => { setOpen(false); setMoreOpen(false); }}
              className={`flex items-center justify-between px-2.5 py-1 rounded-lg text-[13px] leading-5 transition-colors ${
                isActive(d.href) ? 'bg-emerald-500/15 text-emerald-300' : 'text-slate-300 hover:bg-white/10 hover:text-white'
              }`}>
              {d.label}
              {isActive(d.href) && <span className="w-1.5 h-1.5 rounded-full bg-emerald-400" />}
            </Link>
          ))}
        </div>
      )}
      {/* Appearance — a personal preference, so it sits with the account
          rather than in Settings (which holds company-wide defaults). */}
      <div className="mt-1 pt-1.5 border-t border-slate-800/70">
        <div className="flex items-center gap-2 px-2.5 py-1.5">
          <span className="text-[10px] font-bold uppercase tracking-wider text-slate-600 flex-1">Appearance</span>
          <div className="flex bg-slate-950/60 border border-slate-800 rounded-lg p-0.5 gap-0.5">
            {(['dark', 'light'] as const).map((t) => (
              <button
                key={t}
                onClick={() => setTheme(t)}
                aria-pressed={theme === t}
                title={t === 'dark' ? 'Dark theme' : 'Light theme'}
                className={`px-1.5 py-1 rounded-md transition-colors ${
                  theme === t ? 'bg-slate-800 text-emerald-300' : 'text-slate-600 hover:text-slate-300'
                }`}
              >
                {t === 'dark' ? (
                  <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2"><path strokeLinecap="round" strokeLinejoin="round" d="M20.354 15.354A9 9 0 018.646 3.646 9.003 9.003 0 0012 21a9.003 9.003 0 008.354-5.646z" /></svg>
                ) : (
                  <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2"><path strokeLinecap="round" strokeLinejoin="round" d="M12 3v1m0 16v1m9-9h-1M4 12H3m15.364 6.364l-.707-.707M6.343 6.343l-.707-.707m12.728 0l-.707.707M6.343 17.657l-.707.707M16 12a4 4 0 11-8 0 4 4 0 018 0z" /></svg>
                )}
              </button>
            ))}
          </div>
        </div>
      </div>
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
    <div className="relative min-w-0 flex-1 flex items-center gap-1 lg:gap-3">
      <div
        className="relative min-w-0 flex-shrink-0"
        onMouseEnter={() => setOpen(true)}
        onMouseLeave={() => setOpen(false)}
      >
        <div className="flex items-center gap-1">
          {/* The wordmark IS the menu button — clicking it opens the app list
              rather than jumping to the dashboard, which is the first entry in
              that list anyway (and a direct link in the desktop bar). */}
          <button
            onClick={() => setOpen((o) => !o)}
            aria-label="Open menu"
            aria-expanded={open}
            className={`${wordmarkClass} text-white tracking-tight hover:text-emerald-300 transition-colors`}>
            ICAPROC
          </button>
          <button
            onClick={() => setOpen((o) => !o)}
            aria-label="Open menu"
            aria-expanded={open}
            className="p-1 -m-0.5 text-slate-500 hover:text-white transition-colors flex-shrink-0"
          >
            <svg className={`w-4 h-4 transition-transform duration-150 ${open ? 'rotate-180' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2"><path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" /></svg>
          </button>
          {/* Spotlight, below lg: an icon immediately right of the caret, so it
              is in the SAME place on every page and at every width without
              costing the header a row. Tapping it opens the full-screen
              palette — a better phone interaction than a cramped inline field. */}
          <button
            onClick={openSpotlight}
            aria-label="Search"
            title="Search"
            className="lg:hidden ml-0.5 p-1.5 -m-0.5 text-slate-500 hover:text-emerald-300 transition-colors flex-shrink-0 print:hidden"
          >
            <svg className="w-[18px] h-[18px]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2"><path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-4.35-4.35M17 11a6 6 0 11-12 0 6 6 0 0112 0z" /></svg>
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

      {/* ── Desktop: compact grouped dropdowns — direct links for standalone
             modules (Dashboard, single-app groups), a colored dropdown per
             domain otherwise. The open group shows its module list; the
             button of the group you're inside carries the domain accent and
             the current module's name, so context never disappears. ── */}
      <nav className="hidden lg:flex items-center gap-1 min-w-0">
        {groups.map((group, gi) => {
          const acc = accentOf(group.section, group.title);
          const activeApp = group.apps.find((a) => isActive(a.href));
          // Standalone modules don't need a one-item dropdown
          if (group.apps.length === 1) {
            const a = group.apps[0];
            const label = group.title ? `${GROUP_SHORT[group.title] ?? group.title} ${a.label}` : a.label;
            return (
              <Link key={gi} href={a.href}
                className={`px-3 py-1.5 rounded-lg text-[13px] font-medium whitespace-nowrap transition-colors ${
                  activeApp ? acc.active : 'text-slate-400 hover:text-white hover:bg-white/[0.07]'
                }`}>
                {label}
              </Link>
            );
          }
          const isOpen = deskOpen === gi;
          return (
            <div key={gi} className="relative"
              onMouseEnter={() => setDeskOpen(gi)}
              onMouseLeave={() => setDeskOpen((o) => (o === gi ? null : o))}>
              <button
                onClick={() => setDeskOpen((o) => (o === gi ? null : gi))}
                aria-expanded={isOpen}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[13px] font-medium whitespace-nowrap transition-colors ${
                  activeApp ? acc.active : isOpen ? 'text-white bg-white/[0.07]' : 'text-slate-400 hover:text-white hover:bg-white/[0.07]'
                }`}>
                <span className={`w-1.5 h-1.5 rounded-full ${acc.dot} ${activeApp ? '' : 'opacity-40'}`} />
                {group.title ? (GROUP_SHORT[group.title] ?? group.title) : ''}
                {activeApp && <span className="font-normal opacity-80">· {activeApp.label}</span>}
                <svg className={`w-3 h-3 transition-transform duration-150 ${isOpen ? 'rotate-180' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2.5"><path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" /></svg>
              </button>
              {isOpen && (
                <div className="absolute left-0 top-full pt-1.5 z-50">
                  <div className="w-48 bg-slate-900 border border-slate-700 rounded-xl shadow-2xl p-1.5">
                    {group.title && <p className={`px-2.5 pt-1 pb-1 text-[9px] uppercase tracking-widest ${acc.label}`}>{group.title}</p>}
                    {group.apps.map((a) => {
                      const active = isActive(a.href);
                      return (
                        <Link key={a.href} href={a.href} onClick={() => setDeskOpen(null)}
                          className={`flex items-center gap-2.5 px-2.5 py-2 rounded-lg text-sm transition-colors ${
                            active ? acc.active : 'text-slate-300 hover:bg-white/10 hover:text-white'
                          }`}>
                          <svg className="w-4 h-4 flex-shrink-0 opacity-70" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="1.8">{NAV_ICONS[a.href] ?? NAV_ICONS['/']}</svg>
                          {a.label}
                          {active && <span className={`ml-auto w-1.5 h-1.5 rounded-full ${acc.dot}`} />}
                        </Link>
                      );
                    })}
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </nav>

      {/* ── Spotlight, lg and up: the real field, not a button that opens one.

             It sits directly after the nav groups rather than floating right,
             so its LEFT edge is fixed by the ROLE (whose nav never changes)
             rather than by whichever buttons a page happens to carry — the
             anchor stays put while the field grows into whatever room the
             monitor has. Capped, because a 1500px search box on an ultrawide
             reads as a mistake. ── */}
      <div className="hidden lg:block flex-1 min-w-0 max-w-[420px] xl:max-w-[560px] 2xl:max-w-[680px] print:hidden">
        <CommandPalette variant="inline" hotkey={isDesktop} />
      </div>

      {/* ── Mobile: fixed bottom tab bar (thumb reach) + More sheet.
             Portaled to <body>: page headers use backdrop-blur, which WebKit
             treats as a containing block for fixed descendants — rendered
             in place, the "bottom" bar pins to the header instead of the
             viewport (same hijack as the import modal). ── */}
      {mobileNav && mounted && createPortal(
        <div className="md:hidden fixed bottom-0 inset-x-0 z-40 bg-chrome/95 backdrop-blur-xl border-t border-slate-800/80" style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}>
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
        </div>,
        document.body
      )}
      {moreOpen && mounted && createPortal(
        <div className="md:hidden fixed inset-0 z-[120]">
          <div className="absolute inset-0 bg-black/60" onClick={() => setMoreOpen(false)} />
          <div className="absolute inset-x-0 bottom-0 bg-slate-900 border-t border-slate-700 rounded-t-2xl p-3 max-h-[80vh] overflow-y-auto" style={{ paddingBottom: 'calc(1.5rem + env(safe-area-inset-bottom))' }}>
            <div className="w-10 h-1 rounded-full bg-slate-700 mx-auto mb-3" />
            {menuPanel}
          </div>
        </div>,
        document.body
      )}
    </div>
  );
}
