'use client';
/**
 * Sales Description Library — OWNER-ONLY editor for curated custom line texts
 * that feed the Sales Quote item autocomplete (LIB entries), mirroring the
 * project-quote Description Library. Entries carry a unit and an optional
 * default sell price. RLS enforces owner-only writes; this page also hides
 * itself from every other role.
 */
import { useState, useEffect, useCallback, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import { createSupabaseClient } from '@/lib/supabase';
import { useAuth } from '@/hooks/useAuth';
import BrandMenu from '@/components/ui/BrandMenu';

interface Entry { entry_id: string; description: string; unit: string; default_price: number | null; notes: string; updated_at?: string; }

const fmtInt = (n: number) => Math.round(n).toLocaleString('en-US');
const num = (v: string): number | null => {
  const n = Number(v.replace(/[, ]/g, ''));
  return v.trim() === '' || isNaN(n) ? null : n;
};
const inp = 'w-full px-3 py-2 rounded-lg bg-slate-900 border border-slate-700 focus:border-emerald-500/60 outline-none text-white text-sm placeholder:text-slate-600 transition-colors';

export default function SalesLibraryPage() {
  const supabase = createSupabaseClient();
  const router = useRouter();
  const { user, profile, loading: authLoading } = useAuth();
  const isOwner = profile?.role === 'owner';

  const [entries, setEntries] = useState<Entry[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [draft, setDraft] = useState({ description: '', unit: '', price: '' });
  const [editingId, setEditingId] = useState<string | null>(null);
  const [edit, setEdit] = useState({ description: '', unit: '', price: '' });
  const [busy, setBusy] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const flash = (m: string) => { setToast(m); setTimeout(() => setToast(null), 2400); };

  useEffect(() => { document.title = 'Sales Library — ICAPROC'; }, []);
  useEffect(() => {
    if (authLoading) return;
    if (!user) { router.replace(`/login?next=${encodeURIComponent('/sales/library')}`); return; }
    if (profile && profile.role !== 'owner') router.replace('/unauthorized');
  }, [authLoading, user, profile, router]);

  const fetchAll = useCallback(async () => {
    setLoading(true);
    const { data } = await supabase.from('22.2_sales_description_library')
      .select('entry_id, description, unit, default_price, notes, updated_at')
      .order('description');
    setEntries((data as Entry[]) ?? []);
    setLoading(false);
  }, [supabase]);
  useEffect(() => { if (isOwner) fetchAll(); }, [isOwner, fetchAll]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return q ? entries.filter((e) => `${e.description} ${e.unit}`.toLowerCase().includes(q)) : entries;
  }, [entries, search]);

  async function add() {
    const desc = draft.description.trim();
    if (desc.length < 3) { flash('Description needs at least 3 characters'); return; }
    if (entries.some((e) => e.description.trim().toLowerCase() === desc.toLowerCase())) { flash('That entry already exists'); return; }
    setBusy(true);
    const { error } = await supabase.from('22.2_sales_description_library').insert({
      description: desc, unit: draft.unit.trim(), default_price: num(draft.price),
      created_by_email: profile?.email ?? '',
    });
    setBusy(false);
    if (error) { flash(`Failed: ${error.message}`); return; }
    setDraft({ description: '', unit: '', price: '' });
    flash('Entry added');
    fetchAll();
  }

  function startEdit(e: Entry) {
    setEditingId(e.entry_id);
    setEdit({ description: e.description, unit: e.unit ?? '', price: e.default_price != null ? String(Math.round(e.default_price)) : '' });
  }

  async function saveEdit() {
    if (!editingId) return;
    const desc = edit.description.trim();
    if (desc.length < 3) { flash('Description needs at least 3 characters'); return; }
    setBusy(true);
    const { error } = await supabase.from('22.2_sales_description_library')
      .update({ description: desc, unit: edit.unit.trim(), default_price: num(edit.price), updated_at: new Date().toISOString() })
      .eq('entry_id', editingId);
    setBusy(false);
    if (error) { flash(`Failed: ${error.message}`); return; }
    setEditingId(null);
    flash('Saved');
    fetchAll();
  }

  async function remove(e: Entry) {
    const { error } = await supabase.from('22.2_sales_description_library').delete().eq('entry_id', e.entry_id);
    if (error) { flash(`Failed: ${error.message}`); return; }
    flash('Entry removed');
    fetchAll();
  }

  if (authLoading || !profile || !isOwner) {
    return <div className="min-h-screen bg-[#0f1012] flex items-center justify-center"><div className="w-6 h-6 border-2 border-emerald-500/30 border-t-emerald-500 rounded-full animate-spin" /></div>;
  }

  return (
    <div className="min-h-screen bg-[#0f1012] text-slate-200 font-sans text-sm">
      <div className="border-b border-slate-800/60 bg-[#0f1012]/80 backdrop-blur-md sticky top-0 z-30">
        <div className="max-w-[1000px] mx-auto px-3 sm:px-4 md:px-6 py-4 flex items-center justify-between gap-4">
          <BrandMenu wordmarkClass="text-xl md:text-2xl font-extrabold" subtitle="Sales · Description Library (owner)" />
          <button onClick={() => router.push('/sales')} className="text-xs text-slate-400 hover:text-white px-3 py-1.5 border border-slate-700 rounded-lg hover:bg-slate-800 transition-colors">← Back to Sales</button>
        </div>
      </div>

      <main className="max-w-[1000px] mx-auto px-3 sm:px-4 md:px-6 py-6 space-y-4">
        <p className="text-[11px] text-slate-600">
          Curated custom line texts that appear as <span className="px-1 py-0.5 rounded bg-violet-500/20 text-violet-300 text-[9px] font-bold">LIB</span> suggestions
          in the Sales Quote item picker for every sales user. Only owners see and manage this page.
        </p>

        {/* Add row */}
        <div className="bg-slate-900/40 border border-slate-800/80 rounded-2xl p-4 grid grid-cols-1 sm:grid-cols-[1fr_110px_150px_auto] gap-2 items-end">
          <div>
            <label className="block text-[11px] font-medium text-slate-500 mb-1">New entry — description</label>
            <input value={draft.description} onChange={(e) => setDraft((d) => ({ ...d, description: e.target.value }))}
              onKeyDown={(e) => { if (e.key === 'Enter') add(); }}
              placeholder="e.g. Instalasi dan komisioning sistem" className={inp} />
          </div>
          <div>
            <label className="block text-[11px] font-medium text-slate-500 mb-1">Unit</label>
            <input value={draft.unit} onChange={(e) => setDraft((d) => ({ ...d, unit: e.target.value }))} placeholder="ls / pcs" className={inp} />
          </div>
          <div>
            <label className="block text-[11px] font-medium text-slate-500 mb-1">Default price (IDR)</label>
            <input value={draft.price} inputMode="decimal" onChange={(e) => setDraft((d) => ({ ...d, price: e.target.value }))} placeholder="optional" className={`${inp} text-right tabular-nums`} />
          </div>
          <button onClick={add} disabled={busy}
            className="px-4 py-2 rounded-xl bg-emerald-500/15 text-emerald-300 ring-1 ring-emerald-500/30 hover:bg-emerald-500/25 text-sm font-semibold transition-colors disabled:opacity-50">
            + Add
          </button>
        </div>

        {/* Search + list */}
        <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search entries…"
          className="w-full px-4 h-11 rounded-xl bg-slate-900/80 border border-slate-700/80 focus:border-emerald-500/60 outline-none text-white text-base sm:text-sm placeholder:text-[13px] sm:placeholder:text-sm placeholder:text-slate-500 transition-colors" />

        <div className="bg-slate-900/40 border border-slate-800/80 rounded-2xl overflow-hidden">
          {loading ? (
            <div className="p-4 space-y-1.5">{[...Array(5)].map((_, i) => <div key={i} className="h-10 bg-slate-800/40 rounded-xl animate-pulse" />)}</div>
          ) : filtered.length === 0 ? (
            <div className="px-4 py-10 text-center text-slate-600 text-sm">{entries.length === 0 ? 'No library entries yet — add your first above.' : 'No matches.'}</div>
          ) : (
            <div className="divide-y divide-slate-800/60">
              {filtered.map((e) => editingId === e.entry_id ? (
                <div key={e.entry_id} className="px-4 py-3 grid grid-cols-1 sm:grid-cols-[1fr_100px_140px_auto] gap-2 items-center bg-slate-800/30">
                  <input value={edit.description} onChange={(ev) => setEdit((d) => ({ ...d, description: ev.target.value }))} className={inp} />
                  <input value={edit.unit} onChange={(ev) => setEdit((d) => ({ ...d, unit: ev.target.value }))} placeholder="unit" className={inp} />
                  <input value={edit.price} inputMode="decimal" onChange={(ev) => setEdit((d) => ({ ...d, price: ev.target.value }))} placeholder="price" className={`${inp} text-right tabular-nums`} />
                  <div className="flex items-center gap-2">
                    <button onClick={saveEdit} disabled={busy} className="px-3 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-bold transition-colors disabled:opacity-50">Save</button>
                    <button onClick={() => setEditingId(null)} className="px-2 py-1.5 text-xs text-slate-400 hover:text-white transition-colors">Cancel</button>
                  </div>
                </div>
              ) : (
                <div key={e.entry_id} className="px-4 py-2.5 flex items-center gap-3 hover:bg-slate-800/30 transition-colors">
                  <span className="text-sm text-slate-200 flex-1 min-w-0 truncate">{e.description}</span>
                  <span className="text-xs text-slate-500 flex-shrink-0">{e.unit || '—'}</span>
                  <span className="text-xs text-slate-300 tabular-nums flex-shrink-0 w-28 text-right">{e.default_price != null ? `Rp${fmtInt(Number(e.default_price))}` : <span className="text-slate-600">no price</span>}</span>
                  <button onClick={() => startEdit(e)} className="text-[11px] text-slate-500 hover:text-white transition-colors flex-shrink-0">Edit</button>
                  <button onClick={() => remove(e)} className="text-[11px] text-red-400/60 hover:text-red-400 transition-colors flex-shrink-0">Delete</button>
                </div>
              ))}
            </div>
          )}
        </div>
      </main>

      {toast && <div className="fixed bottom-6 right-6 z-[110] px-4 py-2.5 bg-slate-800 border border-slate-700 text-white text-sm font-semibold rounded-xl shadow-lg">{toast}</div>}
    </div>
  );
}
