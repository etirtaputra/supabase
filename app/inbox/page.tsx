'use client';
/**
 * The Inbox — zero-entry ERP, first stream (owner, 2026-11-22: "Yes i love the
 * zero-entry ERP, path of least resistance").
 *
 * A supplier's PI, quote or PO comes in — a file, or a photo taken on the
 * phone — and nobody types it. POST /api/inbox stores it, Claude reads it
 * (lib/inboxRead) and the system proposes the deal (lib/inboxMatch): which
 * supplier, which catalogue items, quote or quote + PO, and what a person
 * should look at first (a new supplier, an unmatched line, totals that do not
 * add up, the same PI already entered). "Create deal" opens New Deal
 * pre-filled from it (/purchasing?inbox=…); saving there marks it Done and
 * links the deal. Statuses: lifecycle `inbox_item` (lib/lifecycles.ts).
 */
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/hooks/useAuth';
import { usePageTitle } from '@/hooks/usePageTitle';
import { useT } from '@/hooks/useT';
import { createSupabaseClient } from '@/lib/supabase';
import { ROLE_PERMISSIONS } from '@/constants/roles';
import { canOpenPath } from '@/constants/navigation';
import { BAR_BTN, BAR_BTN_OFF, BAR_BTN_ON } from '@/constants/controls';
import { badgeMap, canMove, groupList } from '@/lib/lifecycles';
import { fmtDay, fmtDayTime } from '@/lib/formatters';
import BrandMenu from '@/components/ui/BrandMenu';
import type { InboxProposal, ReadDocument } from '@/lib/inboxMatch';

const STATUS = badgeMap('inbox_item');
const OPEN = new Set(groupList('inbox_item', 'open'));

interface InboxItem {
  item_id: string; received_at: string; received_by_email: string | null; source: string; note: string | null;
  file_path: string; file_name: string; mime_type: string; status: string; kind: string | null;
  extracted: ReadDocument | null; proposal: InboxProposal | null; error: string | null;
  quote_id: string | null; po_id: string | null; done_at: string | null; dismissed_reason: string | null;
}

type View = 'open' | 'all';
const money = (n: number | null | undefined, ccy?: string | null) =>
  n == null ? '—' : `${ccy ? `${ccy} ` : ''}${n.toLocaleString('id-ID', { maximumFractionDigits: 2 })}`;

export default function InboxPage() {
  const { t, tf } = useT();
  const router = useRouter();
  const supabase = createSupabaseClient();
  const { user, profile, loading: authLoading } = useAuth();
  usePageTitle();

  useEffect(() => { if (!authLoading && !user) router.replace('/login?next=/inbox'); }, [authLoading, user, router]);
  useEffect(() => {
    if (profile && !canOpenPath(ROLE_PERMISSIONS[profile.role], '/inbox')) router.replace('/unauthorized');
  }, [profile, router]);

  const [items, setItems] = useState<InboxItem[] | null>(null);
  const [view, setView] = useState<View>('open');
  const [busy, setBusy] = useState<Record<string, string>>({});          // item_id → what it is doing
  const [uploads, setUploads] = useState<{ key: string; name: string; state: 'reading' | 'error'; msg?: string }[]>([]);
  const fileRef = useRef<HTMLInputElement>(null);
  const camRef = useRef<HTMLInputElement>(null);

  const load = useCallback(async () => {
    const { data } = await supabase.from('43.0_inbox_items').select('*').order('received_at', { ascending: false }).limit(300);
    setItems((data ?? []) as InboxItem[]);
  }, [supabase]);
  useEffect(() => { if (user) void load(); }, [user, load]);

  const token = async () => (await supabase.auth.getSession()).data.session?.access_token ?? '';

  async function addFiles(files: FileList | null) {
    if (!files?.length) return;
    for (const f of Array.from(files)) {
      const key = `${f.name}-${f.size}-${Date.now()}`;
      setUploads((u) => [...u, { key, name: f.name, state: 'reading' }]);
      try {
        const body = new FormData();
        body.append('file', f);
        const res = await fetch('/api/inbox', { method: 'POST', headers: { Authorization: `Bearer ${await token()}` }, body });
        const j = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(j.error || `HTTP ${res.status}`);
        setUploads((u) => u.filter((x) => x.key !== key));
        await load();
      } catch (e) {
        setUploads((u) => u.map((x) => (x.key === key ? { ...x, state: 'error', msg: e instanceof Error ? e.message : String(e) } : x)));
        // A read cut short (timeout) still stored the file: it is in the list as Received — Read again finishes it.
        await load();
      }
    }
  }

  async function readAgain(it: InboxItem) {
    setBusy((b) => ({ ...b, [it.item_id]: 'reading' }));
    try {
      const res = await fetch(`/api/inbox/${it.item_id}/read`, { method: 'POST', headers: { Authorization: `Bearer ${await token()}` } });
      if (!res.ok) { const j = await res.json().catch(() => ({})); alert(j.error || `HTTP ${res.status}`); }
      await load();
    } finally { setBusy((b) => { const n = { ...b }; delete n[it.item_id]; return n; }); }
  }

  async function setStatus(it: InboxItem, status: 'dismissed' | 'proposed' | 'received', reason?: string) {
    await supabase.from('43.0_inbox_items').update({ status, dismissed_reason: status === 'dismissed' ? reason ?? null : null }).eq('item_id', it.item_id);
    await load();
  }

  async function openFile(it: InboxItem) {
    const { data } = await supabase.storage.from('inbox').createSignedUrl(it.file_path, 600);
    if (data?.signedUrl) window.open(data.signedUrl, '_blank', 'noopener');
  }

  const shown = useMemo(() => (items ?? []).filter((i) => view === 'all' || OPEN.has(i.status)), [items, view]);
  const openCount = useMemo(() => (items ?? []).filter((i) => OPEN.has(i.status)).length, [items]);

  return (
    <div className="min-h-screen bg-chrome text-slate-200 font-sans text-sm">
      <div className="border-b border-slate-800/60 bg-chrome/80 backdrop-blur-md sticky top-0 z-30">
        <div className="max-w-[1200px] 2xl:max-w-[1760px] mx-auto px-3 sm:px-4 md:px-6 py-2.5 sm:py-3 flex items-center justify-between gap-2.5">
          <BrandMenu wordmarkClass="text-xl md:text-2xl font-extrabold" subtitle={t('Documents in, deals out — nothing to type')} />
        </div>
      </div>

      <main className="max-w-[1200px] 2xl:max-w-[1760px] mx-auto px-3 sm:px-4 md:px-6 py-4 sm:py-5 space-y-4">
        {/* Add: a file, or a photo straight from the phone's camera. */}
        <section className="rounded-2xl border border-dashed border-sky-500/40 bg-sky-500/[0.04] p-4 sm:p-5 flex flex-col sm:flex-row sm:items-center gap-3"
          onDragOver={(e) => e.preventDefault()} onDrop={(e) => { e.preventDefault(); void addFiles(e.dataTransfer.files); }}>
          <div className="flex-1 min-w-0">
            <p className="text-slate-100 font-semibold">{t('Add a supplier document')}</p>
            <p className="text-[12px] text-slate-400 mt-0.5">{t('A PI, quote or PO — PDF or a photo. ICAPROC reads it and proposes the deal; you check and save.')}</p>
          </div>
          <div className="flex gap-2 flex-shrink-0">
            <button type="button" onClick={() => fileRef.current?.click()} className={`${BAR_BTN} px-4 ${BAR_BTN_ON}`}>{t('Choose file')}</button>
            <button type="button" onClick={() => camRef.current?.click()} className={`${BAR_BTN} px-4 ${BAR_BTN_OFF} sm:hidden`}>{t('Take photo')}</button>
          </div>
          <input ref={fileRef} type="file" accept="application/pdf,image/jpeg,image/png,image/webp" multiple className="hidden"
            onChange={(e) => { void addFiles(e.target.files); e.target.value = ''; }} />
          <input ref={camRef} type="file" accept="image/*" capture="environment" className="hidden"
            onChange={(e) => { void addFiles(e.target.files); e.target.value = ''; }} />
        </section>

        {uploads.map((u) => (
          <div key={u.key} className={`flex items-center gap-3 rounded-xl border px-4 py-3 ${u.state === 'error' ? 'border-red-500/30 bg-red-500/10' : 'border-slate-700 bg-slate-800/40'}`}>
            {u.state === 'reading' && <span className="w-4 h-4 border-2 border-sky-400/30 border-t-sky-400 rounded-full animate-spin flex-shrink-0" />}
            <span className="truncate text-slate-200">{u.name}</span>
            <span className={`ml-auto text-[12px] ${u.state === 'error' ? 'text-red-300' : 'text-slate-400'}`}>
              {u.state === 'reading' ? t('Reading… (about half a minute)') : tf('Not added: {error}', { error: u.msg ?? '' })}
            </span>
            {u.state === 'error' && (
              <button type="button" onClick={() => setUploads((x) => x.filter((y) => y.key !== u.key))} className="text-slate-500 hover:text-slate-300" aria-label={t('Close')}>✕</button>
            )}
          </div>
        ))}

        <div className="flex items-center gap-1.5" role="group" aria-label={t('Show')}>
          <button type="button" onClick={() => setView('open')} aria-pressed={view === 'open'} className={`${BAR_BTN} px-3 ${view === 'open' ? BAR_BTN_ON : BAR_BTN_OFF}`}>
            {tf('To do ({n})', { n: openCount })}
          </button>
          <button type="button" onClick={() => setView('all')} aria-pressed={view === 'all'} className={`${BAR_BTN} px-3 ${view === 'all' ? BAR_BTN_ON : BAR_BTN_OFF}`}>
            {t('All')}
          </button>
        </div>

        {items === null ? (
          <p className="text-slate-500">{t('Loading…')}</p>
        ) : shown.length === 0 ? (
          <div className="rounded-2xl border border-slate-800 bg-slate-900/40 p-8 text-center text-slate-400">
            {view === 'open' ? t('Nothing waiting. Add a document above, or forward it to MIRA.') : t('No documents yet.')}
          </div>
        ) : (
          <div className="space-y-3">
            {shown.map((it) => {
              const p = it.proposal;
              const d = it.extracted;
              const st = STATUS[it.status];
              const reading = busy[it.item_id] === 'reading';
              return (
                <article key={it.item_id} className="rounded-2xl border border-slate-800 bg-slate-900/40 p-4 space-y-2.5">
                  {/* Line 1: what it is, and its state */}
                  <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                    {st && <span className={`px-2 py-0.5 rounded-full text-[10px] font-semibold uppercase tracking-wider ${st.cls}`}>{t(st.label)}</span>}
                    <span className="font-semibold text-slate-100">{d?.summary || it.file_name}</span>
                    <span className="text-[11px] text-slate-500 ml-auto">
                      {fmtDayTime(it.received_at)}{it.received_by_email ? ` · ${it.received_by_email.split('@')[0]}` : ''}{it.source === 'agent' ? ' · MIRA' : ''}
                    </span>
                  </div>

                  {/* What the system proposes */}
                  {p && (
                    <div className="grid gap-x-6 gap-y-1 text-[12px] sm:grid-cols-2 lg:grid-cols-4">
                      <div>
                        <span className="text-slate-500">{t('Supplier')} </span>
                        {p.supplier.id
                          ? <span className="text-emerald-300">✓ {p.supplier.matchedName}</span>
                          : <span className="text-amber-300">{p.supplier.name || '—'} · {t('new')}</span>}
                      </div>
                      <div>
                        <span className="text-slate-500">{p.withPo ? t('PI / PO') : t('Quote')} </span>
                        <span className="text-slate-200 font-mono">{p.docNumber || '—'}</span>
                        {p.docDate && <span className="text-slate-500"> · {fmtDay(p.docDate)}</span>}
                      </div>
                      <div>
                        <span className="text-slate-500">{t('Total')} </span>
                        <span className="text-slate-100 font-semibold tabular-nums">{money(p.total ?? p.itemsSum, p.currency)}</span>
                      </div>
                      <div>
                        <span className="text-slate-500">{t('Items')} </span>
                        <span className={p.matchedLines === p.lines.length ? 'text-emerald-300' : 'text-amber-300'}>
                          {tf('{m} of {n} matched', { m: p.matchedLines, n: p.lines.length })}
                        </span>
                      </div>
                    </div>
                  )}
                  {p && p.warnings.length > 0 && OPEN.has(it.status) && (
                    <ul className="space-y-0.5 text-[12px] text-amber-300/90">
                      {/* notes = the same warnings as phrases, so they read in the screen's language */}
                      {(p.notes ?? p.warnings.map((w) => ({ text: w, vars: undefined }))).map((n, i) => (
                        <li key={i}>⚠ {n.vars ? tf(n.text, n.vars) : t(n.text)}</li>
                      ))}
                    </ul>
                  )}
                  {it.status === 'failed' && it.error && <p className="text-[12px] text-red-300">{it.error}</p>}
                  {it.status === 'dismissed' && it.dismissed_reason && <p className="text-[12px] text-slate-500">{tf('Dismissed: {reason}', { reason: it.dismissed_reason })}</p>}

                  {/* What to do next — one tap each */}
                  <div className="flex flex-wrap items-center gap-2 pt-0.5">
                    {it.status === 'proposed' && p?.action === 'create_deal' && (
                      <Link href={`/purchasing?tab=quoting&inbox=${it.item_id}`} className={`${BAR_BTN} px-4 ${BAR_BTN_ON}`}>
                        {p.duplicate ? t('Create deal anyway') : p.withPo ? t('Create deal (quote + PO)') : t('Create deal (quote)')} →
                      </Link>
                    )}
                    {p?.duplicate && (
                      <Link href={`/purchasing?tab=lookup&q=${encodeURIComponent(p.duplicate.label)}`} className={`${BAR_BTN} px-3 ${BAR_BTN_OFF}`}>
                        {tf('Open {label}', { label: p.duplicate.label })}
                      </Link>
                    )}
                    {it.status === 'done' && p?.docNumber && (
                      <Link href={`/purchasing?tab=lookup&q=${encodeURIComponent(p.docNumber)}`} className={`${BAR_BTN} px-3 ${BAR_BTN_OFF}`}>{t('Open the deal')}</Link>
                    )}
                    <button type="button" onClick={() => void openFile(it)} className={`${BAR_BTN} px-3 ${BAR_BTN_OFF}`}>{t('View document')}</button>
                    {canMove('inbox_item', it.status, 'proposed') && (
                      <button type="button" disabled={reading} onClick={() => void readAgain(it)} className={`${BAR_BTN} px-3 ${BAR_BTN_OFF} disabled:opacity-50`}>
                        {reading ? t('Reading…') : t('Read again')}
                      </button>
                    )}
                    {OPEN.has(it.status) && (
                      <>
                        {p?.duplicate && (
                          <button type="button" onClick={() => void setStatus(it, 'dismissed', t('Already entered'))} className={`${BAR_BTN} px-3 ${BAR_BTN_OFF}`}>{t('Already entered')}</button>
                        )}
                        <button type="button" onClick={() => void setStatus(it, 'dismissed', t('Not needed'))} className={`${BAR_BTN} px-3 ${BAR_BTN_OFF} ml-auto`}>{t('Dismiss')}</button>
                      </>
                    )}
                    {it.status === 'dismissed' && (
                      <button type="button" onClick={() => void setStatus(it, it.extracted ? 'proposed' : 'received')} className={`${BAR_BTN} px-3 ${BAR_BTN_OFF} ml-auto`}>{t('Put back')}</button>
                    )}
                  </div>
                </article>
              );
            })}
          </div>
        )}
      </main>
    </div>
  );
}
