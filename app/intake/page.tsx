'use client';
export const dynamic = 'force-dynamic';

import { IntakeProvider, useIntake } from '@/context/IntakeContext';
import AuthGate from '@/components/intake/AuthGate';
import BottomNav from '@/components/intake/BottomNav';
import LogsView from '@/components/intake/LogsView';
import StatsView from '@/components/intake/StatsView';
import SettingsView from '@/components/intake/SettingsView';
import type { ViewType } from '@/types/intake';

const VIEW_TITLES: Record<ViewType, string> = {
  logs:     'Logs',
  streaks:  'Streaks',
  settings: 'Settings',
};

const NAV_ITEMS: { view: ViewType; label: string; icon: React.ReactNode }[] = [
  {
    view: 'logs',
    label: 'Logs',
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
    view: 'streaks',
    label: 'Streaks',
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

function IntakeApp() {
  const { activeView, loading, error, refresh } = useIntake();

  return (
    <div className="flex h-dvh bg-slate-950 text-white overflow-hidden">
      <Sidebar />
      <div className="flex-1 flex flex-col min-w-0 overflow-hidden">
        <header className="flex items-center gap-3 px-4 py-3 border-b border-slate-700/50 bg-slate-900/80 backdrop-blur-sm shrink-0">
          <div className="lg:hidden w-8 h-8 rounded-lg bg-violet-600 flex items-center justify-center text-lg">💊</div>
          <h1 className="text-white font-bold text-base lg:text-lg">{VIEW_TITLES[activeView]}</h1>
          {loading && <div className="ml-auto w-4 h-4 rounded-full border border-violet-500 border-t-transparent animate-spin" />}
        </header>
        <main className="flex-1 overflow-hidden">
          {error ? (
            <div className="flex flex-col items-center justify-center h-full px-6 text-center">
              <div className="text-4xl mb-3">⚠️</div>
              <p className="text-white font-semibold text-base mb-1">Failed to load data</p>
              <p className="text-slate-400 text-sm mb-4 font-mono bg-slate-800 rounded-xl px-4 py-2 max-w-sm break-all">{error}</p>
              <button onClick={refresh} className="px-4 py-2 bg-violet-600 hover:bg-violet-500 text-white rounded-xl text-sm font-semibold">Retry</button>
            </div>
          ) : (
            <>
              {activeView === 'logs'     && <LogsView     />}
              {activeView === 'streaks'  && <StatsView    />}
              {activeView === 'settings' && <SettingsView />}
            </>
          )}
        </main>
      </div>
      <BottomNav />
    </div>
  );
}

export default function IntakePage() {
  return (
    <AuthGate>
      <IntakeProvider>
        <IntakeApp />
      </IntakeProvider>
    </AuthGate>
  );
}
