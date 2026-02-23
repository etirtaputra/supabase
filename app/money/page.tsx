'use client';
export const dynamic = 'force-dynamic';
import { MoneyProvider, useMoney } from '@/context/MoneyContext';
import AuthGate from '@/components/money/AuthGate';
import Sidebar from '@/components/money/Sidebar';
import BottomNav from '@/components/money/BottomNav';
import MonthNavigator from '@/components/money/MonthNavigator';
import SummaryCards from '@/components/money/SummaryCards';
import TransactionList from '@/components/money/TransactionList';
import TransactionModal from '@/components/money/TransactionModal';
import TransactionActionMenu from '@/components/money/TransactionActionMenu';
import StatsView from '@/components/money/StatsView';
import AccountsView from '@/components/money/AccountsView';
import { signOut } from '@/lib/money-supabase';

// ── Inner app (needs MoneyProvider context) ───────────────────

function MoneyApp() {
  const { activeView, setActiveView, refreshTransactions } = useMoney();

  const viewTitles: Record<string, string> = {
    transactions: 'Transactions',
    stats:        'Statistics',
    accounts:     'Accounts',
  };

  return (
    <div className="flex h-dvh bg-slate-950 text-white overflow-hidden">
      {/* Desktop sidebar */}
      <Sidebar />

      {/* Main content area */}
      <div className="flex-1 flex flex-col min-w-0 overflow-hidden">
        {/* Top header */}
        <header className="flex items-center justify-between px-4 py-3 border-b border-slate-700/50 bg-slate-900/80 backdrop-blur-sm shrink-0">
          <div className="flex items-center gap-3">
            {/* Mobile: show app icon */}
            <div className="lg:hidden w-7 h-7 rounded-lg bg-violet-600 flex items-center justify-center">
              <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none"
                stroke="white" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"
                className="w-4 h-4">
                <circle cx="12" cy="12" r="10"/>
                <path d="M16 8h-6a2 2 0 1 0 0 4h4a2 2 0 1 1 0 4H8"/>
                <line x1="12" y1="6" x2="12" y2="8"/>
                <line x1="12" y1="16" x2="12" y2="18"/>
              </svg>
            </div>
            <h1 className="text-white font-bold text-base lg:text-lg">
              {viewTitles[activeView]}
            </h1>
          </div>

          <div className="flex items-center gap-2">
            {/* Month navigator for transactions + stats */}
            {(activeView === 'transactions' || activeView === 'stats') && (
              <MonthNavigator />
            )}

            {/* Refresh */}
            <button
              onClick={refreshTransactions}
              className="p-2 rounded-lg hover:bg-slate-700 text-slate-400 hover:text-white transition-colors"
              aria-label="Refresh"
            >
              <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none"
                stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
                className="w-4 h-4">
                <polyline points="23 4 23 10 17 10"/>
                <path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"/>
              </svg>
            </button>

            {/* Sign out */}
            <button
              onClick={async () => { await signOut(); window.location.reload(); }}
              className="p-2 rounded-lg hover:bg-slate-700 text-slate-400 hover:text-white transition-colors"
              aria-label="Sign out"
              title="Sign out"
            >
              <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none"
                stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
                className="w-4 h-4">
                <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/>
                <polyline points="16 17 21 12 16 7"/>
                <line x1="21" y1="12" x2="9" y2="12"/>
              </svg>
            </button>
          </div>
        </header>

        {/* Summary cards (only on transactions view) */}
        {activeView === 'transactions' && <SummaryCards />}

        {/* Scrollable content */}
        <main className="flex-1 overflow-y-auto">
          {activeView === 'transactions' && <TransactionList />}
          {activeView === 'stats'        && <StatsView />}
          {activeView === 'accounts'     && <AccountsView />}
        </main>
      </div>

      {/* Mobile bottom nav + FAB */}
      <BottomNav />

      {/* Modals */}
      <TransactionModal />
      <TransactionActionMenu />
    </div>
  );
}

// ── Page export ────────────────────────────────────────────────

export default function MoneyPage() {
  return (
    <AuthGate>
      <MoneyProvider>
        <MoneyApp />
      </MoneyProvider>
    </AuthGate>
  );
}
