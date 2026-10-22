'use client';
import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { createSupabaseClient } from '@/lib/supabase';
import { useT } from '@/hooks/useT';
import { fmtDay } from '@/lib/formatters';
import { personName, type FlagKind } from '@/lib/quoteFlags';

/**
 * "⏳ Waiting on you" — the proposal lines someone tagged to THIS person
 * (10.7_quote_item_flags, owner 2026-10-22). Each one is a link straight to
 * the line on the proposal, so the person tagged does not have to go looking;
 * nothing is shown when nothing is waiting on them.
 *
 * The CALLER gates it on the /proposals permission; RLS (can_view_epc) backs
 * that up. Only owners and project engineers can be tagged in the first place.
 */
interface Row {
  flag_id: number; quote_id: string; item_id: string; kind: FlagKind; note: string;
  created_at: string; created_by_email: string;
}

export default function WaitingOnYou({ email }: { email: string }) {
  const supabase = useMemo(() => createSupabaseClient(), []);
  const { t, tf } = useT();
  const [rows, setRows] = useState<Row[]>([]);
  const [items, setItems] = useState<Map<string, string>>(new Map());
  const [quotes, setQuotes] = useState<Map<string, { number: string; customer: string }>>(new Map());

  useEffect(() => {
    let live = true;
    (async () => {
      const { data } = await supabase.from('10.7_quote_item_flags')
        .select('flag_id, quote_id, item_id, kind, note, created_at, created_by_email')
        .eq('assignee_email', email).is('resolved_at', null).order('created_at');
      const flags = (data ?? []) as Row[];
      if (!live || !flags.length) { if (live) setRows([]); return; }
      const [it, qs] = await Promise.all([
        supabase.from('10.2_quote_items').select('item_id, description').in('item_id', flags.map((f) => f.item_id)),
        supabase.from('10.0_project_quotes').select('quote_id, quote_number, customer_name').in('quote_id', [...new Set(flags.map((f) => f.quote_id))]),
      ]);
      if (!live) return;
      setItems(new Map(((it.data ?? []) as { item_id: string; description: string }[]).map((r) => [r.item_id, r.description])));
      setQuotes(new Map(((qs.data ?? []) as { quote_id: string; quote_number: string; customer_name: string }[])
        .map((q) => [q.quote_id, { number: q.quote_number, customer: q.customer_name }])));
      setRows(flags);
    })().catch(() => {});
    return () => { live = false; };
  }, [supabase, email]);

  if (!rows.length) return null;
  return (
    <div className="rounded-2xl border border-sky-500/40 bg-sky-500/10 p-4 sm:p-5">
      <p className="text-xs font-bold uppercase tracking-widest text-sky-300">
        ⏳ {rows.length === 1 ? t('1 line waiting on you') : tf('{n} lines waiting on you', { n: rows.length })}
      </p>
      <div className="mt-3 divide-y divide-sky-500/15">
        {rows.map((r) => {
          const q = quotes.get(r.quote_id);
          return (
            <Link key={r.flag_id} href={`/proposals/${r.quote_id}#line-${r.item_id}`}
              className="flex items-center gap-3 py-2 text-[12px] hover:bg-sky-500/10 rounded-lg px-2 -mx-2 transition-colors">
              <div className="min-w-0 flex-1">
                <p className="text-slate-100 font-medium truncate">{items.get(r.item_id)?.trim() || '—'}</p>
                <p className="text-slate-400 truncate">
                  {r.kind === 'price' ? t('Price') : t('Technical')} · {q ? `${q.customer} · ${q.number}` : ''}
                  {' · '}{tf('from {name} {date}', { name: personName(r.created_by_email), date: fmtDay(r.created_at) })}
                  {r.note && <span className="italic"> · “{r.note}”</span>}
                </p>
              </div>
              <span className="flex-shrink-0 text-sky-200 whitespace-nowrap">{t('Go to line')} →</span>
            </Link>
          );
        })}
      </div>
    </div>
  );
}
