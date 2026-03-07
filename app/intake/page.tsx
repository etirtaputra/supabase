'use client';
export const dynamic = 'force-dynamic';

import { IntakeProvider, useIntake } from '@/context/IntakeContext';
import AuthGate from '@/components/intake/AuthGate';
import BottomNav from '@/components/intake/BottomNav';
import TodayView from '@/components/intake/TodayView';
import HistoryView from '@/components/intake/HistoryView';
import StatsView from '@/components/intake/StatsView';
import SettingsView from '@/components/intake/SettingsView';
import type { ViewType } from '@/types/intake';

// ── Constants ─────────────────────────────────────────────────

const VIEW_TITLES: Record<ViewType, string> = {
  today:    'Today',
  history:  'History',
  stats:    'Statistics',
  settings: 'Settings',
};

const NAV_ITEMS: { view: ViewType; label: string; icon: React.ReactNode }[] = [
  {
    view: 'today',
    label: 'Today',
    icon: (
      <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none"
        stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="w-5 h-5">
        <path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/>
        <polyline points="9 22 9 12 15 12 15 22"/>
      </svg>
    ),
  },
  {
    view: 'history',
    label: 'History',
    icon: (
      <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none"
        stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="w-5 h-5">
        <rect x="3" y="4" width="18" height="18" rx="2" ry="2"/>
        <line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/>
        <line x1="3" y1="10" x2="21" y2="10"/>
      </svg>
    ),
  },
  {
    view: 'stats',
    label: 'Statistics',
    icon: (
      <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none"
        stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="w-5 h-5">
        <line x1="18" y1="20" x2="18" y2="10"/>
        <line x1="12" y1="20" x2="12" y2="4"/>
        <line x1="6"  y1="20" x2="6"  y2="14"/>
      </svg>
    ),
  },
  {
    view: 'settings',
    label: 'Settings',
    icon: (
      <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none"
        stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="w-5 h-5">
        <circle cx="12" cy="12" r="3"/>
        <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"/>
      </svg>
    ),
  },
];

// ── Desktop sidebar ───────────────────────────────────────────

function Sidebar() {
  const { activeView, setActiveView } = useIntake();
  return (
    <aside className="hidden lg:flex flex-col w-56 bg-slate-900 border-r border-slate-700/50 shrink-0">
      <div className="flex items-center gap-3 px-4 py-5 border-b border-slate-700/50">
        <div className="w-9 h-9 rounded-xl bg-violet-600 flex items-center justify-center text-xl">💊</div>
        <div>
          <p className="font-bold text-white text-sm">Intake Tracker</p>
          <p className="text-[11px] text-slate-500">Daily log</p>
        </div>
      </div>
      <nav className="flex-1 px-2 py-3 space-y-1">
        {NAV_ITEMS.map(({ view, label, icon }) => (
          <button key={view} onClick={() => setActiveView(view)}
            className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium transition-colors
              ${activeView === view ? 'bg-violet-600/20 text-violet-300' : 'text-slate-400 hover:text-white hover:bg-slate-800'}`}>
            {icon}
            {label}
          </button>
        ))}
      </nav>
    </aside>
  );
}

// ── Inner app ─────────────────────────────────────────────────

function IntakeApp() {
  const { activeView, loading } = useIntake();

  return (
    <div className="flex h-dvh bg-slate-950 text-white overflow-hidden">
      <Sidebar />

      <div className="flex-1 flex flex-col min-w-0 overflow-hidden">
        {/* Header */}
        <header className="flex items-center gap-3 px-4 py-3 border-b border-slate-700/50 bg-slate-900/80 backdrop-blur-sm shrink-0">
          <div className="lg:hidden w-8 h-8 rounded-lg bg-violet-600 flex items-center justify-center text-lg">💊</div>
          <h1 className="text-white font-bold text-base lg:text-lg">{VIEW_TITLES[activeView]}</h1>
          {loading && (
            <div className="ml-auto w-4 h-4 rounded-full border border-violet-500 border-t-transparent animate-spin" />
          )}
        </header>

        {/* Main content */}
        <main className="flex-1 overflow-hidden">
          {activeView === 'today'    && <TodayView   />}
          {activeView === 'history'  && <HistoryView />}
          {activeView === 'stats'    && <StatsView   />}
          {activeView === 'settings' && <SettingsView />}
        </main>
      </div>

      <BottomNav />
    </div>
  );
}

// ── Page ──────────────────────────────────────────────────────

export default function IntakePage() {
  return (
    <AuthGate>
      <IntakeProvider>
        <IntakeApp />
      </IntakeProvider>
    </AuthGate>
  );
}
