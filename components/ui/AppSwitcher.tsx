'use client';
import Link from 'next/link';
import { usePathname } from 'next/navigation';

const APPS = [
  { href: '/catalog',   label: 'Catalog' },
  { href: '/customers', label: 'Customers' },
  { href: '/products',  label: 'Products' },
  { href: '/pricing',   label: 'Pricing' },
  { href: '/sales',     label: 'Sales' },
  { href: '/stock',     label: 'Stock' },
  { href: '/insights',  label: 'Insights' },
  { href: '/quotes',    label: 'Quotes' },
];

/**
 * Fixed cross-app navigation. Rendered unconditionally on Data Entry and
 * Intelligence; the Quotes app renders it only for Owners.
 */
export default function AppSwitcher() {
  const pathname = usePathname();
  return (
    <div className="hidden sm:flex items-center gap-0.5 p-0.5 bg-slate-800/60 border border-slate-700/60 rounded-xl">
      {APPS.map((a) => {
        const active = pathname === a.href || pathname.startsWith(a.href + '/');
        if (active) {
          return (
            <span key={a.href} className="px-3 py-1 rounded-lg text-[11px] font-semibold whitespace-nowrap bg-slate-700 text-white">
              {a.label}
            </span>
          );
        }
        return (
          <Link
            key={a.href}
            href={a.href}
            target="_blank"
            rel="noopener"
            title={`Open ${a.label} in a new tab`}
            className="px-3 py-1 rounded-lg text-[11px] font-medium whitespace-nowrap transition-colors text-slate-400 hover:text-white hover:bg-slate-700/50"
          >
            {a.label}
          </Link>
        );
      })}
    </div>
  );
}
