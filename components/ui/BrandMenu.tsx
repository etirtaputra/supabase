'use client';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useState } from 'react';

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
const APP_GROUPS: { title: string | null; apps: { href: string; label: string }[] }[] = [
  { title: null, apps: [{ href: '/', label: 'Dashboard' }] },
  { title: 'Buy side', apps: [
    { href: '/catalog',  label: 'Catalog' },
    { href: '/insights', label: 'Insights' },
  ] },
  { title: 'Sell side', apps: [
    { href: '/customers', label: 'Customers' },
    { href: '/pricing',   label: 'Pricing' },
    { href: '/sales',     label: 'Sales' },
    { href: '/stock',     label: 'Stock' },
  ] },
  { title: 'Projects', apps: [{ href: '/quotes', label: 'Quotes' }] },
];

export default function BrandMenu({
  wordmarkClass = 'text-xl font-bold',
  subtitle,
}: { wordmarkClass?: string; subtitle?: string }) {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);

  const isActive = (href: string) =>
    href === '/' ? pathname === '/' : pathname === href || pathname.startsWith(href + '/');

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
            {APP_GROUPS.map((group, gi) => (
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
          </div>
        </>
      )}
    </div>
  );
}
