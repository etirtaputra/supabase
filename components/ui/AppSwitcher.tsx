'use client';
import Link from 'next/link';
import { usePathname } from 'next/navigation';

const APPS = [
  { href: '/insert',   label: 'Data Entry',   icon: '✏️' },
  { href: '/database', label: 'Intelligence', icon: '📈' },
  { href: '/quotes',   label: 'Quotes',       icon: '📄' },
];

/**
 * Fixed cross-app navigation. Rendered unconditionally on Data Entry and
 * Intelligence; the Quotes app renders it only for Owners.
 */
export default function AppSwitcher() {
  const pathname = usePathname();
  return (
    <div className="flex items-center gap-0.5 p-0.5 bg-slate-800/60 border border-slate-700/60 rounded-xl">
      {APPS.map((a) => {
        const active = pathname === a.href || pathname.startsWith(a.href + '/');
        return (
          <Link
            key={a.href}
            href={a.href}
            className={`flex items-center gap-1 px-2 py-1 rounded-lg text-[11px] font-semibold whitespace-nowrap transition-colors ${
              active ? 'bg-slate-700 text-white' : 'text-slate-500 hover:text-slate-200 hover:bg-slate-700/50'
            }`}
          >
            <span className="text-[10px]">{a.icon}</span>
            <span className="hidden md:block">{a.label}</span>
          </Link>
        );
      })}
    </div>
  );
}
