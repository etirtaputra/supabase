/**
 * useSearchHistory
 *
 * Persists a short list of recently-selected components in localStorage.
 * Keyed by storageKey so Cost Lookup and Pricing use separate histories.
 *
 * Max 8 entries, most recent first, deduplicated by componentId.
 */
'use client';
import { useState, useEffect, useCallback } from 'react';

export interface HistoryEntry {
  componentId: string;
  label: string;
  sublabel?: string;
}

const MAX = 8;

export function useSearchHistory(storageKey: string) {
  const [history, setHistory] = useState<HistoryEntry[]>([]);

  // Load once on mount (client-only)
  useEffect(() => {
    try {
      const raw = localStorage.getItem(storageKey);
      if (raw) setHistory(JSON.parse(raw));
    } catch { /* localStorage unavailable */ }
  }, [storageKey]);

  const push = useCallback((entry: HistoryEntry) => {
    setHistory((prev) => {
      const deduped = prev.filter((h) => h.componentId !== entry.componentId);
      const next = [entry, ...deduped].slice(0, MAX);
      try { localStorage.setItem(storageKey, JSON.stringify(next)); } catch { /* ignore */ }
      return next;
    });
  }, [storageKey]);

  const clear = useCallback(() => {
    setHistory([]);
    try { localStorage.removeItem(storageKey); } catch { /* ignore */ }
  }, [storageKey]);

  return { history, push, clear };
}
