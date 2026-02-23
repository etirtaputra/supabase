'use client';

import { useMoney } from '@/context/MoneyContext';
import type { ViewType } from '@/types/money';

const navItems: { view: ViewType; label: string; icon: (active: boolean) => React.ReactNode }[] = [
  {
    view: 'transactions',
    label: 'Transactions',
    icon: (active) => (
      <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"
        fill={active ? 'currentColor' : 'none'}
        stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
        className="w-6 h-6">
        <path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/>
        <polyline points="9 22 9 12 15 12 15 22"/>
      </svg>
    ),
  },
  {
    view: 'stats',
    label: 'Stats',
    icon: (active) => (
      <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"
        fill={active ? 'currentColor' : 'none'}
        stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
        className="w-6 h-6">
        <line x1="18" y1="20" x2="18" y2="10"/>
        <line x1="12" y1="20" x2="12" y2="4"/>
        <line x1="6"  y1="20" x2="6"  y2="14"/>
      </svg>
    ),
  },
  {
    view: 'accounts',
    label: 'Accounts',
    icon: (active) => (
      <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"
        fill={active ? 'currentColor' : 'none'}
        stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
        className="w-6 h-6">
        <rect x="2" y="5" width="20" height="14" rx="2"/>
        <line x1="2" y1="10" x2="22" y2="10"/>
      </svg>
    ),
  },
];

export default function BottomNav() {
  const { activeView, setActiveView, openAddModal } = useMoney();

  return (
    <>
      {/* Bottom nav bar */}
      <nav className="lg:hidden fixed bottom-0 inset-x-0 bg-slate-900 border-t border-slate-700/50 flex items-center z-40 safe-area-bottom">
        {/* Left items */}
        <div className="flex flex-1 justify-around">
          {navItems.slice(0, 2).map(({ view, label, icon }) => {
            const active = activeView === view;
            return (
              <button
                key={view}
                onClick={() => setActiveView(view)}
                className={`flex flex-col items-center gap-1 py-2 px-4 text-xs font-medium transition-colors
                  ${active ? 'text-violet-400' : 'text-slate-500'}`}
              >
                {icon(active)}
                {label}
              </button>
            );
          })}
        </div>

        {/* FAB placeholder space */}
        <div className="w-16" />

        {/* Right items */}
        <div className="flex flex-1 justify-around">
          {navItems.slice(2).map(({ view, label, icon }) => {
            const active = activeView === view;
            return (
              <button
                key={view}
                onClick={() => setActiveView(view)}
                className={`flex flex-col items-center gap-1 py-2 px-4 text-xs font-medium transition-colors
                  ${active ? 'text-violet-400' : 'text-slate-500'}`}
              >
                {icon(active)}
                {label}
              </button>
            );
          })}
        </div>
      </nav>

      {/* Floating Action Button */}
      <button
        onClick={() => openAddModal('Exp')}
        className="lg:hidden fixed bottom-12 left-1/2 -translate-x-1/2 z-50 w-14 h-14 rounded-full bg-violet-600 hover:bg-violet-500 shadow-lg shadow-violet-600/40 flex items-center justify-center transition-colors"
        aria-label="Add transaction"
      >
        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none"
          stroke="white" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"
          className="w-6 h-6">
          <line x1="12" y1="5" x2="12" y2="19"/>
          <line x1="5" y1="12" x2="19" y2="12"/>
        </svg>
      </button>
    </>
  );
}
