'use client';

import React, {
  createContext,
  useContext,
  useState,
  useCallback,
  useEffect,
  useRef,
} from 'react';
import { format, startOfMonth, endOfMonth } from 'date-fns';
import type {
  Transaction,
  TransactionFormData,
  ViewType,
  GroupedTransactions,
  AccountBalance,
} from '@/types/money';
import {
  fetchTransactions,
  addTransaction,
  updateTransaction,
  deleteTransaction,
  toggleBookmark,
  duplicateTransaction,
} from '@/lib/money-supabase';

// ── helpers ──────────────────────────────────────────────────

function groupByDate(transactions: Transaction[]): GroupedTransactions[] {
  const map = new Map<string, Transaction[]>();
  for (const t of transactions) {
    const existing = map.get(t.date) ?? [];
    existing.push(t);
    map.set(t.date, existing);
  }

  // Sort dates descending
  const dates = [...map.keys()].sort((a, b) => (a < b ? 1 : -1));

  return dates.map((date) => {
    const txns = map.get(date)!.sort((a, b) => (a.time < b.time ? 1 : -1));
    const dailyIncome  = txns.filter(t => t.type === 'Inc').reduce((s, t) => s + t.amount, 0);
    const dailyExpense = txns.filter(t => t.type === 'Exp').reduce((s, t) => s + t.amount, 0);

    // Human-readable date: "Monday, 17 Feb"
    const d = new Date(date + 'T00:00:00');
    const displayDate = format(d, 'EEEE, d MMM');

    return { date, displayDate, transactions: txns, dailyIncome, dailyExpense };
  });
}

function calcAccountBalances(transactions: Transaction[]): AccountBalance[] {
  const map = new Map<string, AccountBalance>();

  const ensure = (acc: string) => {
    if (!map.has(acc)) {
      map.set(acc, { account: acc, income: 0, expense: 0, balance: 0 });
    }
    return map.get(acc)!;
  };

  for (const t of transactions) {
    const ab = ensure(t.account);
    if (t.type === 'Inc') {
      ab.income  += t.amount;
      ab.balance += t.amount;
    } else if (t.type === 'Exp') {
      ab.expense += t.amount;
      ab.balance -= t.amount;
    } else {
      // Transfer – debit from this account
      ab.expense += t.amount;
      ab.balance -= t.amount;
    }
  }

  return [...map.values()].sort((a, b) => b.balance - a.balance);
}

// ── Context shape ─────────────────────────────────────────────

interface MoneyContextValue {
  // Data
  allTransactions: Transaction[];
  filteredTransactions: Transaction[];
  groupedTransactions: GroupedTransactions[];
  accountBalances: AccountBalance[];

  // UI state
  activeView: ViewType;
  setActiveView: (v: ViewType) => void;
  selectedMonth: Date;
  setSelectedMonth: (d: Date) => void;

  // Loading / error
  isLoading: boolean;
  error: string | null;

  // Modal
  showModal: boolean;
  openAddModal: (defaultType?: Transaction['type']) => void;
  openEditModal: (t: Transaction) => void;
  closeModal: () => void;
  editingTransaction: Transaction | null;

  // Action menu
  actionTransaction: Transaction | null;
  openActionMenu: (t: Transaction) => void;
  closeActionMenu: () => void;

  // CRUD
  handleAddTransaction:    (form: TransactionFormData) => Promise<void>;
  handleUpdateTransaction: (id: string, form: TransactionFormData) => Promise<void>;
  handleDeleteTransaction: (id: string) => Promise<void>;
  handleToggleBookmark:    (id: string, current: boolean) => Promise<void>;
  handleDuplicate:         (t: Transaction, useToday: boolean) => Promise<void>;
  refreshTransactions:     () => Promise<void>;

  // Derived totals for selected month
  monthlyIncome:  number;
  monthlyExpense: number;
  monthlyBalance: number;
}

const MoneyContext = createContext<MoneyContextValue | null>(null);

export function MoneyProvider({ children }: { children: React.ReactNode }) {
  const [allTransactions, setAllTransactions] = useState<Transaction[]>([]);
  const [activeView, setActiveView] = useState<ViewType>('transactions');
  const [selectedMonth, setSelectedMonth] = useState<Date>(startOfMonth(new Date()));
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Modal state
  const [showModal, setShowModal] = useState(false);
  const [editingTransaction, setEditingTransaction] = useState<Transaction | null>(null);
  const [defaultModalType, setDefaultModalType] = useState<Transaction['type']>('Exp');

  // Action menu state
  const [actionTransaction, setActionTransaction] = useState<Transaction | null>(null);

  // Track if we've loaded once
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

  useEffect(() => {
    if (!loaded.current) {
      loaded.current = true;
      refreshTransactions();
    }
  }, [refreshTransactions]);

  // ── Derived: filter to selected month ────────────────────────
  const filteredTransactions = allTransactions.filter((t) => {
    const start = format(startOfMonth(selectedMonth), 'yyyy-MM-dd');
    const end   = format(endOfMonth(selectedMonth),   'yyyy-MM-dd');
    return t.date >= start && t.date <= end;
  });

  const groupedTransactions  = groupByDate(filteredTransactions);
  const accountBalances      = calcAccountBalances(allTransactions);

  const monthlyIncome  = filteredTransactions.filter(t => t.type === 'Inc').reduce((s, t) => s + t.amount, 0);
  const monthlyExpense = filteredTransactions.filter(t => t.type === 'Exp').reduce((s, t) => s + t.amount, 0);
  const monthlyBalance = monthlyIncome - monthlyExpense;

  // ── Modal helpers ─────────────────────────────────────────────
  const openAddModal = useCallback((defaultType: Transaction['type'] = 'Exp') => {
    setEditingTransaction(null);
    setDefaultModalType(defaultType);
    setShowModal(true);
  }, []);

  const openEditModal = useCallback((t: Transaction) => {
    setEditingTransaction(t);
    setShowModal(true);
  }, []);

  const closeModal = useCallback(() => {
    setShowModal(false);
    setEditingTransaction(null);
  }, []);

  // ── Action menu helpers ───────────────────────────────────────
  const openActionMenu  = useCallback((t: Transaction) => setActionTransaction(t), []);
  const closeActionMenu = useCallback(() => setActionTransaction(null), []);

  // ── CRUD ──────────────────────────────────────────────────────
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
    setAllTransactions(prev =>
      prev.map(t => t.id === id ? { ...t, bookmarked: !current } : t)
    );
  }, []);

  const handleDuplicate = useCallback(async (t: Transaction, useToday: boolean) => {
    const newTxn = await duplicateTransaction(t, useToday);
    setAllTransactions(prev => [newTxn, ...prev]);
    closeActionMenu();
  }, [closeActionMenu]);

  const value: MoneyContextValue = {
    allTransactions,
    filteredTransactions,
    groupedTransactions,
    accountBalances,
    activeView,
    setActiveView,
    selectedMonth,
    setSelectedMonth,
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
    monthlyIncome,
    monthlyExpense,
    monthlyBalance,
  };

  // Expose defaultModalType via a context trick: attach it to editingTransaction being null
  // We pass it separately via a dedicated field
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

// Extra hook to get the defaultModalType set when opening the add modal
export function useDefaultModalType(): Transaction['type'] {
  const ctx = useContext(MoneyContext) as (MoneyContextValue & { _defaultModalType?: Transaction['type'] }) | null;
  return ctx?._defaultModalType ?? 'Exp';
}
