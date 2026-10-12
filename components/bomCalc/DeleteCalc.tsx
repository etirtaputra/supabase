'use client';
/**
 * Delete one BOM calculation — two steps ("Delete" → "Delete X? Yes / No"),
 * like Support Letters and the Customers merge: no browser confirm() in this
 * app. Only 10.6_bom_calcs is touched; the proposals never read it.
 *
 * RLS answers a refused delete with zero rows and no error, so the row count
 * is checked — a delete that did nothing says so instead of looking done.
 */
import React, { useState } from 'react';
import { createSupabaseClient } from '@/lib/supabase';
import { useT } from '@/hooks/useT';
import { BAR_BTN, BAR_BTN_OFF } from '@/constants/controls';

export function DeleteCalc({ calcId, name, onDeleted, onError, bar = false }: {
  calcId: string;
  name: string;
  onDeleted: () => void;
  onError: (message: string) => void;
  /** Toolbar size (the editor header); otherwise a small link (a list row). */
  bar?: boolean;
}) {
  const { t, tf } = useT();
  const [asking, setAsking] = useState(false);
  const [busy, setBusy] = useState(false);

  const remove = async () => {
    setBusy(true);
    const { data, error } = await createSupabaseClient().from('10.6_bom_calcs').delete().eq('calc_id', calcId).select('calc_id');
    setBusy(false);
    setAsking(false);
    if (error) { onError(error.message); return; }
    if (!data?.length) { onError(t('The calculation was not deleted. You may not have permission to delete it.')); return; }
    onDeleted();
  };

  const btn = bar ? `${BAR_BTN} px-3` : 'px-2 py-0.5 rounded-md text-[11px]';
  if (!asking) {
    return (
      <button onClick={() => setAsking(true)}
        className={bar ? `${btn} ${BAR_BTN_OFF} hover:!text-red-300 hover:!border-red-500/40` : `${btn} text-slate-600 hover:text-red-400 transition-colors`}>
        {t('Delete')}
      </button>
    );
  }
  return (
    <span className="inline-flex items-center gap-1.5">
      <span className={`text-red-300 ${bar ? 'text-xs' : 'text-[11px]'}`}>{tf('Delete {name}?', { name: name || t('Untitled') })}</span>
      <button onClick={remove} disabled={busy} className={`${btn} border border-red-500 bg-red-600 hover:bg-red-500 text-white font-bold disabled:opacity-50`}>
        {busy ? t('Deleting…') : t('Yes')}
      </button>
      <button onClick={() => setAsking(false)} disabled={busy} className={`${btn} ${bar ? BAR_BTN_OFF : 'border border-slate-700 text-slate-400 hover:text-white'}`}>{t('No')}</button>
    </span>
  );
}
