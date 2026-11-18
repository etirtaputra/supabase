'use client';
/**
 * The EPC proposal's export columns (PDF + Excel), the same on every device a
 * person signs in on (owner, 2026-11-18: "i want the mobile pdf to follow the
 * desktop version").
 *
 * The choice lives with the person's account (public.user_preferences, key
 * `quote_export_cols`); localStorage is only a cache so the first paint is not
 * the defaults. On load:
 *   - the account has a choice  → use it (and refresh the cache);
 *   - it has none, but THIS device has one → that device seeds the account
 *     (the desktop that was set up before this existed carries its choice
 *     over the first time it opens a proposal);
 *   - neither → the defaults, and nothing is written.
 * `ready` turns true once the account has answered (or after 3 s offline), so
 * a print never goes out with a choice that is about to be replaced.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import type { SupabaseClient } from '@supabase/supabase-js';
import { DEFAULT_EXPORT_COLS, hasStoredExportCols, loadExportCols, saveExportCols, type ExportCols } from '@/lib/exportCols';

const PREF_KEY = 'quote_export_cols';

async function writePref(supabase: SupabaseClient, userId: string, cols: ExportCols) {
  const { data } = await supabase.from('user_preferences').select('prefs').eq('user_id', userId).maybeSingle();
  const prefs = { ...((data?.prefs as Record<string, unknown> | null) ?? {}), [PREF_KEY]: cols };
  await supabase.from('user_preferences').upsert({ user_id: userId, prefs, updated_at: new Date().toISOString() });
}

export function useExportCols(supabase: SupabaseClient, userId: string | null | undefined) {
  const [cols, setCols] = useState<ExportCols>(DEFAULT_EXPORT_COLS);
  const [ready, setReady] = useState(false);
  const userRef = useRef<string | null>(null);
  userRef.current = userId ?? null;

  useEffect(() => { setCols(loadExportCols()); }, []);

  useEffect(() => {
    if (!userId) return;
    let done = false;
    const timer = setTimeout(() => { if (!done) setReady(true); }, 3000);
    (async () => {
      try {
        const { data, error } = await supabase.from('user_preferences').select('prefs').eq('user_id', userId).maybeSingle();
        if (error) return;
        const saved = (data?.prefs as Record<string, unknown> | null)?.[PREF_KEY] as Partial<ExportCols> | undefined;
        if (saved) {
          const c = { ...DEFAULT_EXPORT_COLS, ...saved };
          setCols(c);
          saveExportCols(c);
        } else if (hasStoredExportCols()) {
          await writePref(supabase, userId, loadExportCols());
        }
      } finally {
        done = true;
        clearTimeout(timer);
        setReady(true);
      }
    })();
    return () => { done = true; clearTimeout(timer); };
  }, [supabase, userId]);

  const setCol = useCallback((k: keyof ExportCols, v: boolean) => {
    setCols((prev) => {
      const next = { ...prev, [k]: v };
      saveExportCols(next);
      if (userRef.current) void writePref(supabase, userRef.current, next);
      return next;
    });
  }, [supabase]);

  return { cols, setCol, ready };
}
