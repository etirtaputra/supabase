'use client';

import React, { createContext, useContext, useState, useCallback, useEffect } from 'react';
import type { IntakeItem, IntakeLog, ViewType, Category } from '@/types/intake';
import {
  fetchItems,
  fetchLogs,
  addItem,
  updateItem,
  deleteItem,
  addLog,
  deleteLog,
} from '@/lib/intake-supabase';

// ── Streak + average helpers ──────────────────────────────────

function toDay(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function calcStreak(logs: IntakeLog[], itemId: string): { current: number; best: number } {
  const dates = [...new Set(
    logs.filter(l => l.item_id === itemId).map(l => l.date)
  )].sort(); // ascending

  if (dates.length === 0) return { current: 0, best: 0 };

  const today     = toDay(new Date());
  const yesterday = toDay(new Date(Date.now() - 86400000));

  // Current streak: consecutive days up to today or yesterday
  let current = 0;
  const lastDate = dates[dates.length - 1];
  if (lastDate === today || lastDate === yesterday) {
    let expected = lastDate;
    for (let i = dates.length - 1; i >= 0; i--) {
      if (dates[i] === expected) {
        current++;
        expected = toDay(new Date(new Date(expected).getTime() - 86400000));
      } else {
        break;
      }
    }
  }

  // Best streak: sliding window
  let best = current;
  let streak = 1;
  for (let i = 1; i < dates.length; i++) {
    const diff = (new Date(dates[i]).getTime() - new Date(dates[i - 1]).getTime()) / 86400000;
    if (diff === 1) { streak++; if (streak > best) best = streak; }
    else streak = 1;
  }

  return { current, best };
}

// Returns { avg, daysTracked } where daysTracked = distinct days with logs in the window.
// days=0 means all-time (no cutoff).
function calcAverage(logs: IntakeLog[], itemId: string, days: number): { avg: number; daysTracked: number } {
  const cutoff = days > 0 ? toDay(new Date(Date.now() - days * 86400000)) : null;
  const relevant = logs.filter(l => l.item_id === itemId && (cutoff === null || l.date >= cutoff));
  const daysTracked = new Set(relevant.map(l => l.date)).size;
  if (daysTracked === 0) return { avg: 0, daysTracked: 0 };
  const total = relevant.reduce((s, l) => s + l.amount, 0);
  return { avg: total / daysTracked, daysTracked };
}

// ── Context type ──────────────────────────────────────────────

interface IntakeContextType {
  items: IntakeItem[];
  logs: IntakeLog[];
  activeView: ViewType;
  loading: boolean;
  error: string | null;
  setActiveView: (v: ViewType) => void;
  refresh: () => Promise<void>;
  // Item CRUD
  handleAddItem: (data: {
    name: string; category: Category; default_unit: string;
    default_amount: number; serving_count: number; serving_label: string; color: string;
  }) => Promise<void>;
  handleUpdateItem: (id: string, patch: Partial<Omit<IntakeItem, 'id' | 'user_id' | 'created_at'>>) => Promise<void>;
  handleDeleteItem: (id: string) => Promise<void>;
  // Log CRUD
  handleAddLog: (data: {
    item_id: string; date: string; amount: number;
    unit: string; notes?: string; time_of_day?: string;
  }) => Promise<void>;
  handleDeleteLog: (id: string) => Promise<void>;
  // Computed
  getLogsForDate: (date: string) => IntakeLog[];
  getStreak: (itemId: string) => { current: number; best: number };
  getAverage: (itemId: string, days: number) => { avg: number; daysTracked: number };
}

const IntakeContext = createContext<IntakeContextType | null>(null);

export function useIntake() {
  const ctx = useContext(IntakeContext);
  if (!ctx) throw new Error('useIntake must be used inside IntakeProvider');
  return ctx;
}

// ── Provider ──────────────────────────────────────────────────

export function IntakeProvider({ children }: { children: React.ReactNode }) {
  const [items,      setItems]      = useState<IntakeItem[]>([]);
  const [logs,       setLogs]       = useState<IntakeLog[]>([]);
  const [activeView, setActiveView] = useState<ViewType>('logs');
  const [loading,    setLoading]    = useState(true);
  const [error,      setError]      = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [i, l] = await Promise.all([fetchItems(), fetchLogs()]);
      setItems(i);
      setLogs(l);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Failed to load data');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { refresh(); }, [refresh]);

  // Item handlers
  const handleAddItem = useCallback(async (data: Parameters<typeof addItem>[0]) => {
    const item = await addItem(data);
    setItems(prev => [...prev, item].sort((a, b) => a.name.localeCompare(b.name)));
  }, []);

  const handleUpdateItem = useCallback(async (id: string, patch: Parameters<typeof updateItem>[1]) => {
    const updated = await updateItem(id, patch);
    setItems(prev => prev.map(i => i.id === id ? updated : i));
  }, []);

  const handleDeleteItem = useCallback(async (id: string) => {
    await deleteItem(id);
    setItems(prev => prev.filter(i => i.id !== id));
    setLogs(prev => prev.filter(l => l.item_id !== id));
  }, []);

  // Log handlers
  const handleAddLog = useCallback(async (data: Parameters<typeof addLog>[0]) => {
    const log = await addLog(data);
    setLogs(prev => [log, ...prev]);
  }, []);

  const handleDeleteLog = useCallback(async (id: string) => {
    await deleteLog(id);
    setLogs(prev => prev.filter(l => l.id !== id));
  }, []);

  // Computed helpers
  const getLogsForDate = useCallback((date: string) =>
    logs.filter(l => l.date === date), [logs]);

  const getStreak = useCallback((itemId: string) =>
    calcStreak(logs, itemId), [logs]);

  const getAverage = useCallback((itemId: string, days: number) =>
    calcAverage(logs, itemId, days), [logs]);

  const value: IntakeContextType = {
    items, logs, activeView, loading, error,
    setActiveView, refresh,
    handleAddItem, handleUpdateItem, handleDeleteItem,
    handleAddLog, handleDeleteLog,
    getLogsForDate, getStreak, getAverage,
  };

  return <IntakeContext.Provider value={value}>{children}</IntakeContext.Provider>;
}
