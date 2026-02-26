'use client';

import React, {
  createContext,
  useContext,
  useState,
  useCallback,
  useEffect,
  useRef,
} from 'react';
import {
  format,
  startOfMonth, endOfMonth,
  startOfWeek,  endOfWeek,
  startOfYear,  endOfYear,
  addDays, subDays,
  addWeeks, subWeeks,
  addMonths, subMonths,
  addYears, subYears,
} from 'date-fns';
import type {
  Transaction,
  TransactionFormData,
  ViewType,
  ViewPeriod,
  GroupedTransactions,
  AccountBalance,
  UserAccount,
  AccountCategory,
} from '@/types/money';
import {
  fetchTransactions,
  addTransaction,
  updateTransaction,
  deleteTransaction,
  toggleBookmark,
  duplicateTransaction,
  fetchUserAccounts,
  addUserAccount,
  addSubAccount,
  updateUserAccount,
  deleteUserAccount,
  resetAllData,
} from '@/lib/money-supabase';

// ── Period helpers ────────────────────────────────────────────

function getPeriodRange(anchor: Date, period: ViewPeriod): { start: string; end: string } {
  switch (period) {
    case 'daily':
      const d = format(anchor, 'yyyy-MM-dd');
      return { start: d, end: d };
    case 'weekly':
      return {
        start: format(startOfWeek(anchor, { weekStartsOn: 1 }), 'yyyy-MM-dd'),
        end:   format(endOfWeek(anchor,   { weekStartsOn: 1 }), 'yyyy-MM-dd'),
      };
    case 'monthly':
      return {
        start: format(startOfMonth(anchor), 'yyyy-MM-dd'),
        end:   format(endOfMonth(anchor),   'yyyy-MM-dd'),
      };
    case 'annual':
      return {
        start: format(startOfYear(anchor), 'yyyy-MM-dd'),
        end:   format(endOfYear(anchor),   'yyyy-MM-dd'),
      };
  }
}

export function getPeriodLabel(anchor: Date, period: ViewPeriod): string {
  switch (period) {
    case 'daily':
      return format(anchor, 'EEE, d MMM yyyy');
    case 'weekly': {
      const ws = startOfWeek(anchor, { weekStartsOn: 1 });
      const we = endOfWeek(anchor,   { weekStartsOn: 1 });
      if (format(ws, 'MMM yyyy') === format(we, 'MMM yyyy')) {
        return `${format(ws, 'd')}–${format(we, 'd MMM yyyy')}`;
      }
      return `${format(ws, 'd MMM')}–${format(we, 'd MMM yyyy')}`;
    }
    case 'monthly':
      return format(anchor, 'MMMM yyyy');
    case 'annual':
      return format(anchor, 'yyyy');
  }
}

export function navigatePeriod(anchor: Date, period: ViewPeriod, dir: 1 | -1): Date {
  switch (period) {
    case 'daily':   return dir === 1 ? addDays(anchor, 1)    : subDays(anchor, 1);
    case 'weekly':  return dir === 1 ? addWeeks(anchor, 1)   : subWeeks(anchor, 1);
    case 'monthly': return dir === 1 ? addMonths(anchor, 1)  : subMonths(anchor, 1);
    case 'annual':  return dir === 1 ? addYears(anchor, 1)   : subYears(anchor, 1);
  }
}

// ── Data helpers ──────────────────────────────────────────────

/** Types that count as income for summary/stats purposes */
const INCOME_TYPES = new Set(['Inc', 'IncBal'] as const);
/** Types that count as expense for summary/stats purposes */
const EXPENSE_TYPES = new Set(['Exp', 'ExpBal'] as const);

function groupByDate(transactions: Transaction[]): GroupedTransactions[] {
  const map = new Map<string, Transaction[]>();
  for (const t of transactions) {
    const existing = map.get(t.date) ?? [];
    existing.push(t);
    map.set(t.date, existing);
  }

  const dates = [...map.keys()].sort((a, b) => (a < b ? 1 : -1));

  return dates.map((date) => {
    const txns = map.get(date)!.sort((a, b) => (a.time < b.time ? 1 : -1));
    const dailyIncome  = txns.filter(t => INCOME_TYPES.has(t.type as 'Inc' | 'IncBal')).reduce((s, t) => s + t.amount, 0);
    const dailyExpense = txns.filter(t => EXPENSE_TYPES.has(t.type as 'Exp' | 'ExpBal')).reduce((s, t) => s + t.amount, 0);

    const d = new Date(date + 'T00:00:00');
    const displayDate = format(d, 'EEEE, d MMM');

    return { date, displayDate, transactions: txns, dailyIncome, dailyExpense };
  });
}

function calcAccountBalances(transactions: Transaction[]): AccountBalance[] {
  const map = new Map<string, AccountBalance>();

  const ensure = (acc: string) => {
    if (!map.has(acc)) {
      map.set(acc, { account: acc, income: 0, expense: 0, balance: 0, transferIn: 0, transferOut: 0 });
    }
    return map.get(acc)!;
  };

  for (const t of transactions) {
    const ab = ensure(t.account);
    const { type, amount } = t;
    if (type === 'Inc' || type === 'IncBal') {
      ab.income  += amount;
      ab.balance += amount;
    } else if (type === 'Exp' || type === 'ExpBal') {
      ab.expense += amount;
      ab.balance -= amount;
    } else if (type === 'TrfIn') {
      ab.transferIn += amount;
      ab.balance    += amount;
    } else if (type === 'TrfOut' || type === 'Trf') {
      ab.transferOut += amount;
      ab.balance     -= amount;
    }
  }

  return [...map.values()].sort((a, b) => b.balance - a.balance);
}

// ── Context shape ─────────────────────────────────────────────

interface MoneyContextValue {
  // Data
  allTransactions:    Transaction[];
  filteredTransactions: Transaction[];
  groupedTransactions:  GroupedTransactions[];
  accountBalances:    AccountBalance[];
  userAccounts:       UserAccount[];

  // Period / view
  activeView:    ViewType;
  setActiveView: (v: ViewType) => void;
  periodAnchor:    Date;
  setPeriodAnchor: (d: Date) => void;
  viewPeriod:    ViewPeriod;
  setViewPeriod: (p: ViewPeriod) => void;
  periodLabel:   string;

  // Loading / error
  isLoading: boolean;
  error:     string | null;

  // Modal
  showModal:           boolean;
  openAddModal:        (defaultType?: Transaction['type']) => void;
  openEditModal:       (t: Transaction) => void;
  closeModal:          () => void;
  editingTransaction:  Transaction | null;

  // Action menu
  actionTransaction: Transaction | null;
  openActionMenu:    (t: Transaction) => void;
  closeActionMenu:   () => void;

  // Transaction CRUD
  handleAddTransaction:    (form: TransactionFormData) => Promise<void>;
  handleUpdateTransaction: (id: string, form: TransactionFormData) => Promise<void>;
  handleDeleteTransaction: (id: string) => Promise<void>;
  handleToggleBookmark:    (id: string, current: boolean) => Promise<void>;
  handleDuplicate:         (t: Transaction, useToday: boolean) => Promise<void>;
  refreshTransactions:     () => Promise<void>;

  // Account CRUD
  handleAddUserAccount:    (name: string, category: AccountCategory) => Promise<void>;
  handleAddSubAccount:     (name: string, parentId: string) => Promise<void>;
  handleUpdateUserAccount: (id: string, name: string, category: AccountCategory) => Promise<void>;
  handleDeleteUserAccount: (id: string) => Promise<void>;
  refreshUserAccounts:     () => Promise<void>;
  handleResetAllData:      () => Promise<void>;

  // Derived totals for selected period
  monthlyIncome:  number;
  monthlyExpense: number;
  monthlyBalance: number;
}

const MoneyContext = createContext<MoneyContextValue | null>(null);

export function MoneyProvider({ children }: { children: React.ReactNode }) {
  const [allTransactions, setAllTransactions] = useState<Transaction[]>([]);
  const [userAccounts,    setUserAccounts]    = useState<UserAccount[]>([]);
  const [activeView,      setActiveView]      = useState<ViewType>('transactions');
  const [periodAnchor,    setPeriodAnchor]    = useState<Date>(startOfMonth(new Date()));
  const [viewPeriod,      setViewPeriod]      = useState<ViewPeriod>('monthly');
  const [isLoading,       setIsLoading]       = useState(true);
  const [error,           setError]           = useState<string | null>(null);

  const [showModal,            setShowModal]            = useState(false);
  const [editingTransaction,   setEditingTransaction]   = useState<Transaction | null>(null);
  const [defaultModalType,     setDefaultModalType]     = useState<Transaction['type']>('Exp');
  const [actionTransaction,    setActionTransaction]    = useState<Transaction | null>(null);

  const loaded = useRef(false);

  const refreshTransactions = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      const txns = await fetchTransactions();
      setAllTransactions(txns);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Failed to load transactions');
    } finally {
      setIsLoading(false);
    }
  }, []);

  const refreshUserAccounts = useCallback(async () => {
    try {
      const accs = await fetchUserAccounts();
      setUserAccounts(accs);
    } catch { /* non-fatal if table doesn't exist yet */ }
  }, []);

  useEffect(() => {
    if (!loaded.current) {
      loaded.current = true;
      refreshTransactions();
      refreshUserAccounts();
    }
  }, [refreshTransactions, refreshUserAccounts]);

  // ── Derived: filter to selected period ───────────────────────
  const { start: periodStart, end: periodEnd } = getPeriodRange(periodAnchor, viewPeriod);

  const filteredTransactions = allTransactions.filter(
    (t) => t.date >= periodStart && t.date <= periodEnd
  );

  const groupedTransactions = groupByDate(filteredTransactions);
  const accountBalances     = calcAccountBalances(allTransactions);
  const periodLabel         = getPeriodLabel(periodAnchor, viewPeriod);

  const monthlyIncome  = filteredTransactions.filter(t => INCOME_TYPES.has(t.type as 'Inc' | 'IncBal')).reduce((s, t) => s + t.amount, 0);
  const monthlyExpense = filteredTransactions.filter(t => EXPENSE_TYPES.has(t.type as 'Exp' | 'ExpBal')).reduce((s, t) => s + t.amount, 0);
  const monthlyBalance = monthlyIncome - monthlyExpense;

  // ── Modal helpers ─────────────────────────────────────────────
  const openAddModal = useCallback((defaultType: Transaction['type'] = 'Exp') => {
    setEditingTransaction(null);
    setDefaultModalType(defaultType);
    setShowModal(true);
  }, []);

  const openEditModal  = useCallback((t: Transaction) => { setEditingTransaction(t); setShowModal(true); }, []);
  const closeModal     = useCallback(() => { setShowModal(false); setEditingTransaction(null); }, []);
  const openActionMenu = useCallback((t: Transaction) => setActionTransaction(t), []);
  const closeActionMenu = useCallback(() => setActionTransaction(null), []);

  // ── Transaction CRUD ──────────────────────────────────────────
  const handleAddTransaction = useCallback(async (form: TransactionFormData) => {
    const txn = await addTransaction(form);
    setAllTransactions(prev => [txn, ...prev]);
    closeModal();
  }, [closeModal]);

  const handleUpdateTransaction = useCallback(async (id: string, form: TransactionFormData) => {
    const txn = await updateTransaction(id, form);
    setAllTransactions(prev => prev.map(t => t.id === id ? txn : t));
    closeModal();
  }, [closeModal]);

  const handleDeleteTransaction = useCallback(async (id: string) => {
    await deleteTransaction(id);
    setAllTransactions(prev => prev.filter(t => t.id !== id));
    closeActionMenu();
  }, [closeActionMenu]);

  const handleToggleBookmark = useCallback(async (id: string, current: boolean) => {
    await toggleBookmark(id, current);
    setAllTransactions(prev => prev.map(t => t.id === id ? { ...t, bookmarked: !current } : t));
  }, []);

  const handleDuplicate = useCallback(async (t: Transaction, useToday: boolean) => {
    const newTxn = await duplicateTransaction(t, useToday);
    setAllTransactions(prev => [newTxn, ...prev]);
    closeActionMenu();
  }, [closeActionMenu]);

  // ── Account CRUD ──────────────────────────────────────────────
  const handleAddUserAccount = useCallback(async (name: string, category: AccountCategory) => {
    const acc = await addUserAccount(name, category);
    setUserAccounts(prev => [...prev, acc]);
  }, []);

  const handleAddSubAccount = useCallback(async (name: string, parentId: string) => {
    const acc = await addSubAccount(name, parentId);
    setUserAccounts(prev => [...prev, acc]);
  }, []);

  const handleUpdateUserAccount = useCallback(async (id: string, name: string, category: AccountCategory) => {
    const acc = await updateUserAccount(id, name, category);
    setUserAccounts(prev => prev.map(a => a.id === id ? acc : a));
  }, []);

  const handleDeleteUserAccount = useCallback(async (id: string) => {
    await deleteUserAccount(id);
    setUserAccounts(prev => prev.filter(a => a.id !== id));
  }, []);

  const handleResetAllData = useCallback(async () => {
    await resetAllData();
    setAllTransactions([]);
    setUserAccounts([]);
  }, []);

  const value: MoneyContextValue = {
    allTransactions,
    filteredTransactions,
    groupedTransactions,
    accountBalances,
    userAccounts,
    activeView,
    setActiveView,
    periodAnchor,
    setPeriodAnchor,
    viewPeriod,
    setViewPeriod,
    periodLabel,
    isLoading,
    error,
    showModal,
    openAddModal,
    openEditModal,
    closeModal,
    editingTransaction,
    actionTransaction,
    openActionMenu,
    closeActionMenu,
    handleAddTransaction,
    handleUpdateTransaction,
    handleDeleteTransaction,
    handleToggleBookmark,
    handleDuplicate,
    refreshTransactions,
    handleAddUserAccount,
    handleAddSubAccount,
    handleUpdateUserAccount,
    handleDeleteUserAccount,
    refreshUserAccounts,
    handleResetAllData,
    monthlyIncome,
    monthlyExpense,
    monthlyBalance,
  };

  return (
    <MoneyContext.Provider value={{ ...value, _defaultModalType: defaultModalType } as MoneyContextValue & { _defaultModalType: Transaction['type'] }}>
      {children}
    </MoneyContext.Provider>
  );
}

export function useMoney() {
  const ctx = useContext(MoneyContext);
  if (!ctx) throw new Error('useMoney must be used inside MoneyProvider');
  return ctx;
}

export function useDefaultModalType(): Transaction['type'] {
  const ctx = useContext(MoneyContext) as (MoneyContextValue & { _defaultModalType?: Transaction['type'] }) | null;
  return ctx?._defaultModalType ?? 'Exp';
}
