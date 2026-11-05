'use client';

/**
 * The description library manager — one screen for both libraries, separate
 * data: EPC proposals (10.4) and Sales quotes (22.2). Owner, 2026-11-04:
 * "free-text libraries ... separated ... logs and the right indexing ...
 * autocomplete and duplicate merge to make data entries consistent."
 *
 * Every change goes through the database's library_* functions, which log it
 * (10.5_library_log) and refuse what the role may not do. Merge and rename
 * reword DRAFT documents only; sent / accepted ones keep their wording and
 * simply follow the entry (owner's decision). Any change can be undone from
 * the History tab, newest first.
 *
 * Tabs: Entries · To review (proposed by engineers / sales) · Similar
 * (probable duplicates) · Archived · History.
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { createSupabaseClient } from '@/lib/supabase';
import { selectAll } from '@/lib/fetchAllRows';
import { useT } from '@/hooks/useT';
import { fmtDay, fmtDayTime, fmtInt } from '@/lib/formatters';
import { rankLibrary, nearEntries, similarGroups, mainComponentKind, libraryErrorKey } from '@/lib/libraryMatch';
import { BAR_INPUT, BAR_SELECT, BAR_BTN, BAR_BTN_OFF, BAR_BTN_ON } from '@/constants/controls';
import { SECTION_GROUPS } from '@/types/quotes';

export type LibraryKind = 'epc' | 'sales';

interface Entry {
  entry_id: string;
  description: string;
  brand: string | null;
  unit: string | null;
  status: 'proposed' | 'approved';
  aliases: string[] | null;
  merged_into: string | null;
  archived_at: string | null;
  created_at: string;
  created_by_email: string | null;
  updated_at: string | null;
  updated_by_email: string | null;
  // EPC
  group_key?: string | null;
  section_title?: string | null;
  default_cost?: number | null;
  // Sales
  section?: string | null;
  default_price?: number | null;
  notes?: string | null;
}
interface Usage { entry_id: string; uses: number; documents: number; last_used: string | null; last_cost?: number | null; last_sell?: number | null; last_price?: number | null }
type Row = Entry & Partial<Omit<Usage, 'entry_id'>>;
interface LogRow { log_id: number; action: string; entry_ids: string[]; summary: string; actor_email: string; at: string; undone_at: string | null; undone_by_email: string | null }
interface DocLine { item_id: string; description: string; quote_id: string; quote_number: string; quote_date: string | null; status: string; customer: string; price: number | null }

type Tab = 'entries' | 'review' | 'similar' | 'archived' | 'history';

const CFG = {
  epc: {
    table: '10.4_description_library', usage: 'v_epc_library_usage',
    lines: '10.2_quote_items', docs: '10.0_project_quotes', docHref: (id: string) => `/proposals/${id}`,
  },
  sales: {
    table: '22.2_sales_description_library', usage: 'v_sales_library_usage',
    lines: '22.1_sales_quote_items', docs: '22.0_sales_quotes', docHref: (id: string) => `/sales/${id}`,
  },
} as const;

const ACTION_LABEL: Record<string, string> = {
  create: 'Added', propose: 'Proposed', edit: 'Edited', merge: 'Merged', archive: 'Archived', approve: 'Approved', undo: 'Undone',
};

const box = 'bg-slate-900/40 border border-slate-800/80 rounded-2xl';
const inp = 'w-full px-3 py-2 rounded-lg bg-slate-900 border border-slate-700 focus:border-emerald-500/60 outline-none text-white text-base sm:text-sm placeholder:text-slate-600 transition-colors';
const linkBtn = 'text-[11px] font-semibold transition-colors disabled:opacity-40';

export default function LibraryManager({ library }: { library: LibraryKind }) {
  const { t, tf } = useT();
  const supabase = createSupabaseClient();
  const cfg = CFG[library];

  const [rows, setRows] = useState<Row[]>([]);
  const [log, setLog] = useState<LogRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<Tab>('entries');
  const [search, setSearch] = useState('');
  const [group, setGroup] = useState('');
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [edit, setEdit] = useState<{ id: string; description: string; brand: string; unit: string; group: string; price: string } | null>(null);
  const [merge, setMerge] = useState<{ ids: string[]; target: string } | null>(null);
  const [draft, setDraft] = useState<{ description: string; brand: string; unit: string; group: string; price: string } | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  const [docLines, setDocLines] = useState<DocLine[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [flash, setFlash] = useState('');
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    const [lib, use, lg] = await Promise.all([
      selectAll<Entry>((f, to) => supabase.from(cfg.table).select('*').order('description').order('entry_id').range(f, to)),
      selectAll<Usage>((f, to) => supabase.from(cfg.usage).select('*').order('entry_id').range(f, to)),
      supabase.from('10.5_library_log').select('log_id, action, entry_ids, summary, actor_email, at, undone_at, undone_by_email')
        .eq('library', library).order('log_id', { ascending: false }).limit(300),
    ]);
    if (lib.error) setError(lib.error.message);
    const byId = new Map((use.data ?? []).map((u) => [u.entry_id, u]));
    setRows((lib.data ?? []).map((e) => ({ ...e, ...(byId.get(e.entry_id) ?? {}) })));
    setLog((lg.data as LogRow[]) ?? []);
    setLoading(false);
  }, [supabase, cfg.table, cfg.usage, library]);
  useEffect(() => { load(); }, [load]);

  const live = useMemo(() => rows.filter((r) => !r.archived_at), [rows]);
  const archived = useMemo(() => rows.filter((r) => r.archived_at), [rows]);
  const proposed = useMemo(() => live.filter((r) => r.status === 'proposed'), [live]);
  const approved = useMemo(() => live.filter((r) => r.status === 'approved'), [live]);
  const groups = useMemo(() => similarGroups(live), [live]);
  const byId = useMemo(() => new Map(rows.map((r) => [r.entry_id, r])), [rows]);

  const groupOf = (r: Row) => (library === 'epc' ? r.group_key ?? '' : r.section ?? 'sales');
  const groupOptions: { key: string; label: string }[] = library === 'epc'
    ? SECTION_GROUPS.map((g) => ({ key: g.key, label: g.label }))
    : [{ key: 'sales', label: 'Sales' }, { key: 'aftersales', label: 'After-sales' }];

  const visible = useMemo(() => {
    const base = (tab === 'archived' ? archived : tab === 'review' ? proposed : live).filter((r) => !group || groupOf(r) === group);
    if (!search.trim()) {
      return [...base].sort((a, b) => (b.uses ?? 0) - (a.uses ?? 0) || a.description.localeCompare(b.description));
    }
    return rankLibrary(base, search, 500).shown;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab, live, archived, proposed, group, search]);

  // ── Calls ───────────────────────────────────────────────────────────────────
  async function call(fn: string, args: Record<string, unknown>, ok: string) {
    setBusy(true); setError('');
    const { error: e } = await supabase.rpc(fn, args);
    setBusy(false);
    if (e) { const k = libraryErrorKey(e.message); setError(tf(k.key, k.vars)); return false; }
    setFlash(ok); setTimeout(() => setFlash(''), 3500);
    setSelected(new Set());
    await load();
    return true;
  }

  const fields = (x: { description?: string; brand: string; unit: string; group: string; price: string }) => (library === 'epc'
    ? { ...(x.description !== undefined ? { description: x.description } : {}), brand: x.brand, unit: x.unit, group_key: x.group, default_cost: x.price.replace(/[, ]/g, '') }
    : { ...(x.description !== undefined ? { description: x.description } : {}), brand: x.brand, unit: x.unit, section: x.group || 'sales', default_price: x.price.replace(/[, ]/g, '') });

  async function saveEdit() {
    if (!edit) return;
    const r = byId.get(edit.id);
    const f = fields({ ...edit, description: edit.description.trim() === r?.description ? undefined : edit.description });
    if (await call('library_edit', { p_library: library, p_entry: edit.id, p_fields: f }, t('Saved — drafts follow, sent documents keep their wording'))) setEdit(null);
  }
  async function create() {
    if (!draft) return;
    if (await call('library_create', { p_library: library, p_fields: fields(draft) }, tf('Added “{d}”', { d: draft.description.trim() }))) setDraft(null);
  }
  async function doMerge() {
    if (!merge) return;
    const sources = merge.ids.filter((x) => x !== merge.target);
    if (await call('library_merge', { p_library: library, p_target: merge.target, p_sources: sources },
      tf('Merged {n} into “{d}”', { n: sources.length, d: byId.get(merge.target)?.description ?? '' }))) setMerge(null);
  }
  const archive = (ids: string[]) => call('library_archive', { p_library: library, p_entries: ids }, tf('Archived {n}', { n: ids.length }));
  const approve = (ids: string[]) => call('library_approve', { p_library: library, p_entries: ids }, tf('Approved {n}', { n: ids.length }));
  const undo = (id: number) => call('library_undo', { p_log_id: id }, tf('Change #{n} undone', { n: id }));
  const restore = (entryId: string) => {
    const row = log.find((l) => l.action === 'archive' && !l.undone_at && l.entry_ids.includes(entryId));
    if (!row) { setError(t('This entry was archived by a merge — undo the merge in History to bring it back.')); return; }
    return undo(row.log_id);
  };

  async function openDocs(id: string) {
    if (open === id) { setOpen(null); return; }
    setOpen(id); setDocLines(null);
    const priceCol = library === 'epc' ? 'sell_price' : 'unit_price';
    const { data: lines } = await selectAll<Record<string, unknown>>((f, to) => supabase.from(cfg.lines)
      .select(`item_id, description, quote_id, ${priceCol}`).eq('library_entry_id', id).order('item_id').range(f, to));
    const qids = [...new Set((lines ?? []).map((l) => String(l.quote_id)))];
    const docCols = library === 'epc' ? 'quote_id, quote_number, quote_date, status, customer_name' : 'quote_id, quote_number, quote_date, status, customer_id';
    const { data: docs } = qids.length ? await supabase.from(cfg.docs).select(docCols).in('quote_id', qids) : { data: [] };
    const dById = new Map(((docs ?? []) as unknown as Record<string, unknown>[]).map((d) => [String(d.quote_id), d]));
    setDocLines((lines ?? []).map((l) => {
      const d = dById.get(String(l.quote_id)) ?? {};
      return {
        item_id: String(l.item_id), description: String(l.description ?? ''), quote_id: String(l.quote_id),
        quote_number: String(d.quote_number ?? '—'), quote_date: (d.quote_date as string) ?? null, status: String(d.status ?? ''),
        customer: String(d.customer_name ?? ''), price: l[priceCol] != null ? Number(l[priceCol]) : null,
      };
    }).sort((a, b) => (b.quote_date ?? '').localeCompare(a.quote_date ?? '')));
  }

  const toggle = (id: string) => setSelected((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  const startMerge = (ids: string[]) => {
    const sorted = [...ids].sort((a, b) => (byId.get(b)?.uses ?? 0) - (byId.get(a)?.uses ?? 0));
    setMerge({ ids: sorted, target: sorted[0] });
  };

  // ── Pieces ──────────────────────────────────────────────────────────────────
  const price = (r: Row) => library === 'epc' ? (r.last_sell ?? r.default_cost ?? null) : (r.last_price ?? r.default_price ?? null);
  const priceTitle = library === 'epc' ? t('Last selling price on a proposal (or the default cost)') : t('Last unit price on a sales quote (or the default price)');

  // A render function, not a component: a component declared in here would be
  // a new type every render, and the edit box would lose focus on each key.
  function entryRow(r: Row) {
    const near = r.status === 'proposed' ? nearEntries(approved, r.description, 0.8, 3) : [];
    const main = mainComponentKind(r.description);
    const inGroup = groups.find((g) => g.some((x) => x.entry_id === r.entry_id));
    if (edit?.id === r.entry_id) {
      return (
        <div key={r.entry_id} className="px-4 py-3 space-y-2 bg-slate-800/30">
          <input value={edit.description} onChange={(e) => setEdit({ ...edit, description: e.target.value })} className={inp} />
          <div className="grid grid-cols-2 sm:grid-cols-[1fr_110px_180px_150px_auto] gap-2 items-center">
            <input value={edit.brand} onChange={(e) => setEdit({ ...edit, brand: e.target.value })} placeholder={t('Brand')} className={inp} />
            <input value={edit.unit} onChange={(e) => setEdit({ ...edit, unit: e.target.value })} placeholder={t('Unit')} className={inp} />
            <select value={edit.group} onChange={(e) => setEdit({ ...edit, group: e.target.value })} className={inp}>
              {library === 'epc' && <option value="">{t('No group')}</option>}
              {groupOptions.map((g) => <option key={g.key} value={g.key}>{t(g.label)}</option>)}
            </select>
            <input value={edit.price} inputMode="decimal" onChange={(e) => setEdit({ ...edit, price: e.target.value })}
              placeholder={library === 'epc' ? t('Default cost') : t('Default price')} className={`${inp} text-right tabular-nums`} />
            <div className="flex items-center gap-2 col-span-2 sm:col-span-1">
              <button onClick={saveEdit} disabled={busy} className="px-3 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-bold disabled:opacity-50">{t('Save')}</button>
              <button onClick={() => setEdit(null)} className="px-2 py-1.5 text-xs text-slate-400 hover:text-white">{t('Cancel')}</button>
            </div>
          </div>
          <p className="text-[11px] text-slate-500">{t('A new wording renames the entry: draft documents take it, sent and accepted ones keep theirs, and the old spelling keeps finding this entry.')}</p>
        </div>
      );
    }
    return (
      <div key={r.entry_id} className={`px-4 py-2.5 hover:bg-slate-800/30 transition-colors ${selected.has(r.entry_id) ? 'bg-emerald-500/[0.06]' : ''}`}>
        <div className="flex items-start gap-3">
          {!r.archived_at && (
            <input type="checkbox" checked={selected.has(r.entry_id)} onChange={() => toggle(r.entry_id)}
              className="mt-1 accent-emerald-500 flex-shrink-0" aria-label={t('Select')} />
          )}
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <button onClick={() => openDocs(r.entry_id)} className="text-sm text-slate-100 text-left hover:text-white">{r.description}</button>
              {r.status === 'proposed' && <span className="px-1.5 py-0.5 rounded bg-amber-500/15 text-amber-300 text-[10px] font-bold">{t('PROPOSED')}</span>}
              {(r.aliases?.length ?? 0) > 0 && (
                <span className="px-1.5 py-0.5 rounded bg-slate-800 text-slate-400 text-[10px]" title={(r.aliases ?? []).join('\n')}>
                  {tf('+{n} spellings', { n: r.aliases!.length })}
                </span>
              )}
              {inGroup && tab !== 'similar' && (
                <button onClick={() => startMerge(inGroup.map((x) => x.entry_id))}
                  className="px-1.5 py-0.5 rounded bg-violet-500/15 text-violet-300 text-[10px] font-bold hover:bg-violet-500/25"
                  title={inGroup.map((x) => x.description).join('\n')}>
                  {tf('~{n} similar', { n: inGroup.length - 1 })}
                </button>
              )}
              {main && (
                <span className="px-1.5 py-0.5 rounded bg-sky-500/15 text-sky-300 text-[10px] font-bold"
                  title={t('This reads like a main component. Add it to Items (purchasing) and pick it from the catalogue, so its price is tracked.')}>
                  {t('MAIN COMPONENT')}
                </span>
              )}
            </div>
            <p className="text-[11px] text-slate-500 mt-0.5">
              {[r.brand, r.unit, groupOptions.find((g) => g.key === groupOf(r))?.label && t(groupOptions.find((g) => g.key === groupOf(r))!.label),
                library === 'epc' && r.section_title ? r.section_title : null].filter(Boolean).join(' · ') || '—'}
              {r.status === 'proposed' && r.created_by_email && <> · {tf('proposed by {who} on {d}', { who: r.created_by_email, d: fmtDay(r.created_at) })}</>}
              {r.archived_at && <> · {r.merged_into ? tf('merged into “{d}”', { d: byId.get(r.merged_into)?.description ?? '—' }) : tf('archived {d}', { d: fmtDay(r.archived_at) })}</>}
            </p>
            {near.length > 0 && (
              <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                <span className="text-[11px] text-slate-500">{t('Similar entries')}</span>
                {near.map(({ entry, score }) => (
                  <button key={entry.entry_id} disabled={busy}
                    onClick={() => setMerge({ ids: [entry.entry_id, r.entry_id], target: entry.entry_id })}
                    className="px-2 py-0.5 rounded-md bg-slate-800 hover:bg-slate-700 text-[11px] text-slate-200 disabled:opacity-50"
                    title={t('Merge this proposal into the existing entry')}>
                    {entry.description} <span className="text-slate-500">{Math.round(score * 100)}% · ×{entry.uses ?? 0}</span>
                  </button>
                ))}
              </div>
            )}
          </div>
          <div className="text-right flex-shrink-0 w-24">
            <p className="text-xs text-slate-300 tabular-nums" title={t('Lines that use this entry, in how many documents')}>×{r.uses ?? 0}{r.documents ? <span className="text-slate-600"> · {r.documents} {t('docs')}</span> : null}</p>
            <p className="text-[10px] text-slate-600">{r.last_used ? fmtDay(r.last_used) : t('never used')}</p>
          </div>
          <div className="text-right flex-shrink-0 w-28 hidden sm:block" title={priceTitle}>
            <p className="text-xs text-slate-300 tabular-nums">{price(r) != null ? `Rp${fmtInt(Number(price(r)))}` : <span className="text-slate-600">—</span>}</p>
          </div>
          <div className="flex flex-col items-end gap-1 flex-shrink-0 w-20">
            {r.archived_at ? (
              <button onClick={() => restore(r.entry_id)} disabled={busy} className={`${linkBtn} text-emerald-400 hover:text-emerald-300`}>{t('Restore')}</button>
            ) : (
              <>
                {r.status === 'proposed' && <button onClick={() => approve([r.entry_id])} disabled={busy} className={`${linkBtn} text-emerald-400 hover:text-emerald-300`}>{t('Approve')}</button>}
                <button onClick={() => setEdit({ id: r.entry_id, description: r.description, brand: r.brand ?? '', unit: r.unit ?? '',
                  group: groupOf(r), price: String((library === 'epc' ? r.default_cost : r.default_price) ?? '') })}
                  className={`${linkBtn} text-slate-400 hover:text-white`}>{t('Edit')}</button>
                <button onClick={() => archive([r.entry_id])} disabled={busy} className={`${linkBtn} text-red-400/70 hover:text-red-400`}>{t('Archive')}</button>
              </>
            )}
          </div>
        </div>
        {open === r.entry_id && (
          <div className="mt-2 ml-7 rounded-xl bg-slate-950/40 border border-slate-800 p-2">
            {docLines == null ? <p className="text-[11px] text-slate-500 px-2 py-1">{t('Loading…')}</p>
              : docLines.length === 0 ? <p className="text-[11px] text-slate-500 px-2 py-1">{t('No document uses this entry yet.')}</p>
              : (
                <div className="max-h-56 overflow-y-auto divide-y divide-slate-800/60">
                  {docLines.map((d) => (
                    <Link key={d.item_id} href={cfg.docHref(d.quote_id)} className="flex items-center gap-3 px-2 py-1.5 text-[11px] hover:bg-slate-800/40 rounded">
                      <span className="font-mono text-slate-300 w-40 truncate">{d.quote_number}</span>
                      <span className="text-slate-500 w-20">{d.quote_date ? fmtDay(d.quote_date) : '—'}</span>
                      <span className="text-slate-500 w-16">{t(d.status)}</span>
                      <span className="text-slate-400 flex-1 truncate">{d.description !== r.description ? `“${d.description}”` : d.customer}</span>
                      <span className="text-slate-300 tabular-nums w-24 text-right">{d.price != null ? `Rp${fmtInt(d.price)}` : ''}</span>
                    </Link>
                  ))}
                </div>
              )}
          </div>
        )}
      </div>
    );
  }

  // ── Layout ──────────────────────────────────────────────────────────────────
  const tabs: [Tab, string, number | null][] = [
    ['entries', t('Entries'), live.length], ['review', t('To review'), proposed.length],
    ['similar', t('Similar'), groups.length], ['archived', t('Archived'), archived.length], ['history', t('History'), null],
  ];

  return (
    <div className="space-y-4">
      <p className="text-[11px] text-slate-500 leading-relaxed">
        {library === 'epc'
          ? t('Texts for EPC proposal lines that are not catalogue items: services, accessories, works. Every free-text line links to its entry here; a new wording typed by an engineer arrives in “To review”.')
          : t('Texts for sales-quote lines that are not catalogue items. Every custom line links to its entry here; a new wording typed by sales arrives in “To review”.')}
        {' '}{t('Merging or renaming changes drafts only — sent and accepted documents keep their wording. Every change is in History and can be undone.')}
      </p>

      <div className="flex items-center gap-1.5 overflow-x-auto">
        {tabs.map(([k, label, n]) => (
          <button key={k} onClick={() => { setTab(k); setSelected(new Set()); }}
            className={`${BAR_BTN} px-3 ${tab === k ? BAR_BTN_ON : BAR_BTN_OFF}`}>
            {label}{n != null && <span className={`ml-1.5 tabular-nums ${k === 'review' && n > 0 ? 'text-amber-300' : 'text-slate-500'}`}>{n}</span>}
          </button>
        ))}
        <span className="flex-1" />
        <button onClick={() => setDraft({ description: '', brand: '', unit: '', group: library === 'epc' ? 'bos' : 'sales', price: '' })}
          className={`${BAR_BTN} px-3 ${BAR_BTN_OFF}`}>+ {t('New entry')}</button>
      </div>

      {(flash || error) && (
        <div className={`px-4 py-2.5 rounded-xl text-sm ${error ? 'bg-red-500/10 text-red-300 border border-red-500/20' : 'bg-emerald-500/10 text-emerald-300 border border-emerald-500/20'}`}>
          {error || flash}
          {error && <button onClick={() => setError('')} className="ml-3 text-xs text-slate-400 hover:text-white">{t('Dismiss')}</button>}
        </div>
      )}

      {draft && (
        <div className={`${box} p-4 space-y-2`}>
          <input autoFocus value={draft.description} onChange={(e) => setDraft({ ...draft, description: e.target.value })}
            placeholder={t('Description, as it should print on the document')} className={inp} />
          {draft.description.trim().length >= 4 && (() => {
            const near = nearEntries(live, draft.description, 0.8, 3);
            return near.length ? (
              <p className="text-[11px] text-amber-300">{tf('Already close to: {list}', { list: near.map((x) => `“${x.entry.description}”`).join(', ') })}</p>
            ) : null;
          })()}
          <div className="grid grid-cols-2 sm:grid-cols-[1fr_110px_180px_150px_auto] gap-2 items-center">
            <input value={draft.brand} onChange={(e) => setDraft({ ...draft, brand: e.target.value })} placeholder={t('Brand')} className={inp} />
            <input value={draft.unit} onChange={(e) => setDraft({ ...draft, unit: e.target.value })} placeholder={t('Unit')} className={inp} />
            <select value={draft.group} onChange={(e) => setDraft({ ...draft, group: e.target.value })} className={inp}>
              {groupOptions.map((g) => <option key={g.key} value={g.key}>{t(g.label)}</option>)}
            </select>
            <input value={draft.price} inputMode="decimal" onChange={(e) => setDraft({ ...draft, price: e.target.value })}
              placeholder={library === 'epc' ? t('Default cost') : t('Default price')} className={`${inp} text-right tabular-nums`} />
            <div className="flex items-center gap-2 col-span-2 sm:col-span-1">
              <button onClick={create} disabled={busy || draft.description.trim().length < 3}
                className="px-3 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-bold disabled:opacity-50">{t('Add')}</button>
              <button onClick={() => setDraft(null)} className="px-2 py-1.5 text-xs text-slate-400 hover:text-white">{t('Cancel')}</button>
            </div>
          </div>
        </div>
      )}

      {merge && (
        <div className={`${box} p-4 space-y-3 ring-1 ring-violet-500/30`}>
          <p className="text-sm font-semibold text-white">{t('Merge — which wording stays?')}</p>
          <div className="space-y-1">
            {merge.ids.map((id) => {
              const r = byId.get(id);
              return (
                <label key={id} className="flex items-center gap-2 text-sm cursor-pointer">
                  <input type="radio" name="merge-target" checked={merge.target === id} onChange={() => setMerge({ ...merge, target: id })} className="accent-violet-500" />
                  <span className="text-slate-200">{r?.description}</span>
                  <span className="text-[11px] text-slate-500">×{r?.uses ?? 0}{r?.status === 'proposed' ? ` · ${t('proposed')}` : ''}</span>
                </label>
              );
            })}
          </div>
          <p className="text-[11px] text-slate-500">{t('Every line follows the chosen entry. Draft documents take its wording; sent and accepted documents keep theirs. The other spellings keep finding it. Undo from History.')}</p>
          <div className="flex items-center gap-2">
            <button onClick={doMerge} disabled={busy || merge.ids.length < 2} className="px-3 py-1.5 rounded-lg bg-violet-600 hover:bg-violet-500 text-white text-xs font-bold disabled:opacity-50">{t('Merge')}</button>
            <button onClick={() => setMerge(null)} className="px-2 py-1.5 text-xs text-slate-400 hover:text-white">{t('Cancel')}</button>
          </div>
        </div>
      )}

      {tab !== 'history' && tab !== 'similar' && (
        <div className="flex flex-col sm:flex-row gap-2">
          <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder={t('Search — any words, any order')} className={`${BAR_INPUT} flex-1`} />
          <select value={group} onChange={(e) => setGroup(e.target.value)} className={BAR_SELECT}>
            <option value="">{library === 'epc' ? t('All groups') : t('Sales and after-sales')}</option>
            {groupOptions.map((g) => <option key={g.key} value={g.key}>{t(g.label)}</option>)}
          </select>
        </div>
      )}

      {selected.size > 0 && (
        <div className="flex items-center gap-2 flex-wrap text-xs">
          <span className="text-slate-400">{tf('{n} selected', { n: selected.size })}</span>
          <button onClick={() => startMerge([...selected])} disabled={selected.size < 2 || busy} className={`${BAR_BTN} px-3 ${BAR_BTN_OFF}`}>{t('Merge')}</button>
          {[...selected].some((id) => byId.get(id)?.status === 'proposed') && (
            <button onClick={() => approve([...selected].filter((id) => byId.get(id)?.status === 'proposed'))} disabled={busy} className={`${BAR_BTN} px-3 ${BAR_BTN_OFF}`}>{t('Approve')}</button>
          )}
          <button onClick={() => archive([...selected])} disabled={busy} className={`${BAR_BTN} px-3 ${BAR_BTN_OFF}`}>{t('Archive')}</button>
          <button onClick={() => setSelected(new Set())} className="text-slate-500 hover:text-white">{t('Clear')}</button>
        </div>
      )}

      <div className={`${box} overflow-hidden`}>
        {loading ? (
          <div className="p-4 space-y-1.5">{[...Array(6)].map((_, i) => <div key={i} className="h-10 bg-slate-800/40 rounded-xl animate-pulse" />)}</div>
        ) : tab === 'history' ? (
          log.length === 0 ? <p className="px-4 py-10 text-center text-slate-600 text-sm">{t('No changes yet.')}</p> : (
            <div className="divide-y divide-slate-800/60">
              {log.map((l) => (
                <div key={l.log_id} className={`px-4 py-2.5 flex items-start gap-3 ${l.undone_at ? 'opacity-50' : ''}`}>
                  <span className="text-[10px] font-mono text-slate-600 w-10 pt-0.5">#{l.log_id}</span>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm text-slate-200"><span className="font-semibold">{t(ACTION_LABEL[l.action] ?? l.action)}</span> · <span className="text-slate-300">{l.summary}</span></p>
                    <p className="text-[11px] text-slate-500">{fmtDayTime(l.at)} · {l.actor_email}
                      {l.undone_at && <> · {tf('undone {d} by {who}', { d: fmtDayTime(l.undone_at), who: l.undone_by_email ?? '—' })}</>}</p>
                  </div>
                  {!l.undone_at && l.action !== 'undo' && (
                    <button onClick={() => undo(l.log_id)} disabled={busy} className={`${linkBtn} text-slate-400 hover:text-white flex-shrink-0`}>{t('Undo')}</button>
                  )}
                </div>
              ))}
            </div>
          )
        ) : tab === 'similar' ? (
          groups.length === 0 ? <p className="px-4 py-10 text-center text-slate-600 text-sm">{t('No probable duplicates.')}</p> : (
            <div className="divide-y divide-slate-800/60">
              {groups.map((g) => (
                <div key={g.map((x) => x.entry_id).join('|')} className="px-4 py-3 flex items-start gap-3">
                  <div className="flex-1 min-w-0 space-y-0.5">
                    {g.map((x) => (
                      <p key={x.entry_id} className="text-sm text-slate-200">{x.description} <span className="text-[11px] text-slate-500">×{x.uses ?? 0}{x.status === 'proposed' ? ` · ${t('proposed')}` : ''}</span></p>
                    ))}
                  </div>
                  <button onClick={() => startMerge(g.map((x) => x.entry_id))} disabled={busy} className={`${BAR_BTN} px-3 ${BAR_BTN_OFF} flex-shrink-0`}>{t('Merge…')}</button>
                </div>
              ))}
            </div>
          )
        ) : visible.length === 0 ? (
          <p className="px-4 py-10 text-center text-slate-600 text-sm">{tab === 'review' ? t('Nothing to review — every entry is approved.') : t('No matches.')}</p>
        ) : (
          <div className="divide-y divide-slate-800/60">
            {visible.map((r) => entryRow(r))}
          </div>
        )}
      </div>
    </div>
  );
}
