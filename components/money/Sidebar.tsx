'use client';

import { useMoney } from '@/context/MoneyContext';
import type { ViewType } from '@/types/money';

const navItems: { view: ViewType; label: string; icon: React.ReactNode }[] = [
  {
    view: 'transactions',
    label: 'Transactions',
    icon: (
      <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none"
        stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
        className="w-5 h-5">
        <path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/>
        <polyline points="9 22 9 12 15 12 15 22"/>
      </svg>
    ),
  },
  {
    view: 'stats',
    label: 'Statistics',
    icon: (
      <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none"
        stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
        className="w-5 h-5">
        <line x1="18" y1="20" x2="18" y2="10"/>
        <line x1="12" y1="20" x2="12" y2="4"/>
        <line x1="6"  y1="20" x2="6"  y2="14"/>
      </svg>
    ),
  },
  {
    view: 'accounts',
    label: 'Accounts',
    icon: (
      <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none"
        stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
        className="w-5 h-5">
        <rect x="2" y="5" width="20" height="14" rx="2"/>
        <line x1="2" y1="10" x2="22" y2="10"/>
      </svg>
    ),
  },
];

export default function Sidebar() {
  const { activeView, setActiveView, openAddModal } = useMoney();

  return (
    <aside className="hidden lg:flex flex-col w-60 min-h-screen bg-slate-900 border-r border-slate-700/50 p-4">
      {/* App logo / title */}
      <div className="flex items-center gap-3 mb-8 px-2">
        <div className="w-9 h-9 rounded-xl bg-violet-600 flex items-center justify-center shrink-0">
          <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none"
            stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
            className="w-5 h-5">
            <circle cx="12" cy="12" r="10"/>
            <path d="M16 8h-6a2 2 0 1 0 0 4h4a2 2 0 1 1 0 4H8"/>
            <line x1="12" y1="6" x2="12" y2="8"/>
            <line x1="12" y1="16" x2="12" y2="18"/>
          </svg>
        </div>
        <span className="text-white font-bold text-lg tracking-tight">Money Manager</span>
      </div>

      {/* Navigation */}
      <nav className="flex-1 space-y-1">
        {navItems.map(({ view, label, icon }) => {
          const active = activeView === view;
          return (
            <button
              key={view}
              onClick={() => setActiveView(view)}
              className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium transition-colors
                ${active
                  ? 'bg-violet-600 text-white'
                  : 'text-slate-400 hover:text-white hover:bg-slate-800'
                }`}
            >
              {icon}
              {label}
            </button>
          );
        })}
      </nav>

      {/* Add transaction button */}
      <button
        onClick={() => openAddModal('Exp')}
        className="flex items-center gap-2 w-full mt-4 px-4 py-3 bg-violet-600 hover:bg-violet-500 text-white rounded-xl font-semibold text-sm transition-colors"
      >
        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none"
          stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"
          className="w-4 h-4">
          <line x1="12" y1="5" x2="12" y2="19"/>
          <line x1="5" y1="12" x2="19" y2="12"/>
        </svg>
        Add Transaction
      </button>
    </aside>
  );
}
