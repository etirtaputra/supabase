/**
 * EPC Proposal Directory — the "Library" for the proposal header fields
 * (customers, sites/locations, addresses). Surfaces near-duplicate spellings
 * of the same entity across all proposals and lets an owner MERGE them into one
 * canonical value (rewrites every proposal that used a variant). Keeps the
 * autocomplete lists clean so future entries stay consistent.
 */
'use client';
import { useState, useEffect, useCallback, useMemo } from 'react';
import Link from 'next/link';
import { createSupabaseClient } from '@/lib/supabase';
import { useQuotesGate } from '@/hooks/useQuotesGate';
import BrandMenu from '@/components/ui/BrandMenu';
import { PROPOSAL_FIELDS, type ProposalFieldKey, clusterDuplicates } from '@/lib/proposalFields';

interface Row { customer_name: string; customer_address: string; location: string }

export default function ProposalDirectoryPage() {
  const supabase = createSupabaseClient();
  const gate = useQuotesGate();
  const isOwner = gate.profile?.role === 'owner';

  const [rows, setRows] = useState<Row[]>([]);       // 10.0 header fields
  const [brandVals, setBrandVals] = useState<string[]>([]); // 10.2 line-item brands (with repeats, for counts)
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<ProposalFieldKey>('customer_name');
  const [busy, setBusy] = useState(false);
  const [flash, setFlash] = useState('');
  const [error, setError] = useState('');
  const [search, setSearch] = useState('');

  useEffect(() => { document.title = 'Proposal Directory | ICAPROC'; }, []);

  const load = useCallback(async () => {
    setLoading(true);
    const [hdr, brands] = await Promise.all([
      supabase.from('10.0_project_quotes').select('customer_name, customer_address, location'),
      supabase.from('10.2_quote_items').select('brand').neq('brand', ''),
    ]);
    if (hdr.error) setError(hdr.error.message);
    setRows((hdr.data ?? []) as Row[]);
    setBrandVals(((brands.data ?? []) as { brand: string | null }[]).map((r) => String(r.brand ?? '').trim()).filter(Boolean));
    setLoading(false);
  }, [supabase]);
  useEffect(() => { if (gate.ready) load(); }, [gate.ready, load]);

  const flashMsg = (m: string) => { setFlash(m); setTimeout(() => setFlash(''), 3500); };

  // Distinct values + usage counts for the active field (from its own source)
  const counts = useMemo(() => {
    const m = new Map<string, number>();
    if (tab === 'brand') {
      for (const v of brandVals) m.set(v, (m.get(v) ?? 0) + 1);
    } else {
      for (const r of rows) {
        const v = String(r[tab as 'customer_name' | 'customer_address' | 'location'] ?? '').trim();
        if (!v) continue;
        m.set(v, (m.get(v) ?? 0) + 1);
      }
    }
    return m;
  }, [rows, brandVals, tab]);

  const clusters = useMemo(() => clusterDuplicates(counts), [counts]);
  const distinct = useMemo(() => {
    const q = search.trim().toLowerCase();
    return [...counts.entries()]
      .filter(([v]) => !q || v.toLowerCase().includes(q))
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  }, [counts, search]);

  // Merge every `variant` value into `canonical` (rewrites the column on all
  // matching rows in the field's table). Exact-string match on full values.
  async function mergeInto(canonical: string, variants: string[]) {
    if (!isOwner || !variants.length) return;
    const { table, column } = PROPOSAL_FIELDS[tab];
    setBusy(true); setError('');
    let moved = 0;
    for (const v of variants) {
      if (v === canonical) continue;
      const { data, error } = await supabase.from(table)
        .update({ [column]: canonical }).eq(column, v).select(tab === 'brand' ? 'item_id' : 'quote_id');
      if (error) { setError(error.message); setBusy(false); return; }
      moved += data?.length ?? 0;
    }
    setBusy(false);
    flashMsg(`Merged into “${canonical}” — ${moved} ${unitWord(moved)} updated`);
    load();
  }

  async function renameValue(oldVal: string, newVal: string) {
    const nv = newVal.trim();
    if (!isOwner || !nv || nv === oldVal) return;
    const { table, column } = PROPOSAL_FIELDS[tab];
    setBusy(true); setError('');
    const { data, error } = await supabase.from(table)
      .update({ [column]: nv }).eq(column, oldVal).select(tab === 'brand' ? 'item_id' : 'quote_id');
    setBusy(false);
    if (error) { setError(error.message); return; }
    flashMsg(`Renamed to “${nv}” — ${data?.length ?? 0} ${unitWord(data?.length ?? 0)} updated`);
    load();
  }
  const unitWord = (n: number) => tab === 'brand' ? `line item${n !== 1 ? 's' : ''}` : `proposal${n !== 1 ? 's' : ''}`;

  const dupCount = clusters.reduce((s, c) => s + c.variants.length, 0);

  if (!gate.ready) {
    return <div className="min-h-screen bg-[#141518] flex items-center justify-center text-slate-500">Loading…</div>;
  }

  return (
    <div className="min-h-screen bg-[#141518] text-slate-200 font-sans text-sm">
      <div className="sticky top-0 z-40 bg-[#141518]/90 backdrop-blur-xl border-b border-white/[0.07]">
        <div className="max-w-5xl mx-auto px-3 sm:px-6 py-4 flex items-center justify-between gap-3">
          <BrandMenu wordmarkClass="text-xl font-bold" subtitle="Proposal Directory · customers · sites · addresses" />
          <Link href="/proposals" className="px-3 py-1.5 rounded-xl border border-white/[0.08] text-slate-400 hover:text-white hover:bg-white/10 text-xs font-semibold transition-all whitespace-nowrap">← Proposals</Link>
        </div>
      </div>

      <main className="max-w-5xl mx-auto px-3 sm:px-6 py-6 space-y-5">
        {!isOwner && (
          <div className="bg-amber-500/10 border border-amber-500/30 rounded-xl px-4 py-2.5 text-xs text-amber-200">
            You can review duplicates here; merging &amp; renaming is owner-only.
          </div>
        )}

        {/* Field tabs */}
        <div className="flex items-center gap-5 border-b border-white/[0.07]">
          {(Object.keys(PROPOSAL_FIELDS) as ProposalFieldKey[]).map((k) => (
            <button key={k} onClick={() => { setTab(k); setSearch(''); }}
              className={`pb-2.5 -mb-px text-[13px] transition-colors border-b-2 ${tab === k ? 'border-violet-400 text-white font-bold' : 'border-transparent text-slate-500 hover:text-slate-300 font-normal'}`}>
              {PROPOSAL_FIELDS[k].label}
            </button>
          ))}
        </div>

        {loading ? (
          <div className="space-y-2">{[...Array(4)].map((_, i) => <div key={i} className="h-16 bg-slate-800/40 rounded-2xl animate-pulse" />)}</div>
        ) : (
          <>
            {/* Duplicate warning + clusters */}
            <div className={`rounded-xl px-4 py-2.5 text-xs ${dupCount ? 'bg-amber-500/10 border border-amber-500/30 text-amber-200' : 'bg-emerald-500/10 border border-emerald-500/25 text-emerald-300'}`}>
              {dupCount
                ? `⚠ ${clusters.length} group${clusters.length !== 1 ? 's' : ''} of possible duplicates (${dupCount} variant${dupCount !== 1 ? 's' : ''} to fold in) across ${counts.size} distinct ${PROPOSAL_FIELDS[tab].label.toLowerCase()}.`
                : `✓ No likely duplicates — ${counts.size} distinct ${PROPOSAL_FIELDS[tab].label.toLowerCase()} look clean.`}
            </div>

            {clusters.length > 0 && (
              <div className="space-y-3">
                <h2 className="text-[11px] font-bold uppercase tracking-widest text-amber-300/80">Possible duplicates</h2>
                {clusters.map((c, i) => (
                  <DupClusterCard key={i} cluster={c} canMerge={isOwner} busy={busy} onMerge={mergeInto} />
                ))}
              </div>
            )}

            {/* Full distinct list */}
            <div className="space-y-2">
              <div className="flex items-center gap-3">
                <h2 className="text-[11px] font-bold uppercase tracking-widest text-slate-500">All {PROPOSAL_FIELDS[tab].label.toLowerCase()}</h2>
                <span className="text-[11px] text-slate-600 tabular-nums">{distinct.length}</span>
                <div className="flex-1" />
                <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search…"
                  className="w-48 bg-slate-950 border border-slate-700 rounded-lg px-3 py-1.5 text-xs text-white placeholder-slate-600 focus:outline-none focus:ring-2 focus:ring-violet-500/20" />
              </div>
              <div className="rounded-2xl border border-slate-800 divide-y divide-slate-800/60 overflow-hidden">
                {distinct.map(([value, count]) => (
                  <ValueRow key={value} value={value} count={count} unit={tab === 'brand' ? 'use' : 'proposal'} canEdit={isOwner} busy={busy} onRename={renameValue} />
                ))}
                {distinct.length === 0 && <p className="px-4 py-8 text-center text-slate-600 text-xs">No values{search ? ' match' : ''}.</p>}
              </div>
            </div>
          </>
        )}

        {error && <p className="text-xs text-red-400">{error}</p>}
      </main>

      {flash && <div className="fixed bottom-6 right-6 z-[110] px-4 py-2.5 bg-slate-800 border border-slate-700 text-white text-sm font-semibold rounded-xl shadow-lg max-w-[90vw]">{flash}</div>}
    </div>
  );
}

// One near-duplicate group: pick which spelling wins, fold the rest into it.
function DupClusterCard({ cluster, canMerge, busy, onMerge }: {
  cluster: { canonical: string; count: number; variants: { value: string; count: number }[] };
  canMerge: boolean; busy: boolean;
  onMerge: (canonical: string, variants: string[]) => void;
}) {
  const members = useMemo(
    () => [{ value: cluster.canonical, count: cluster.count - cluster.variants.reduce((s, v) => s + v.count, 0) }, ...cluster.variants],
    [cluster]);
  const [canonical, setCanonical] = useState(cluster.canonical);
  const variants = members.filter((m) => m.value !== canonical).map((m) => m.value);

  return (
    <div className="bg-slate-900/50 border border-amber-500/20 rounded-2xl p-4">
      <div className="space-y-1.5 mb-3">
        {members.map((m) => (
          <label key={m.value} className="flex items-center gap-2.5 cursor-pointer">
            <input type="radio" name={`canon-${cluster.canonical}`} checked={canonical === m.value}
              onChange={() => setCanonical(m.value)} className="accent-violet-500 flex-shrink-0" disabled={!canMerge} />
            <span className={`text-xs truncate ${canonical === m.value ? 'text-white font-semibold' : 'text-slate-400'}`}>{m.value}</span>
            <span className="text-[10px] text-slate-600 tabular-nums flex-shrink-0">{m.count}×</span>
            {canonical === m.value && <span className="text-[9px] px-1.5 py-0.5 rounded bg-violet-500/15 text-violet-300 font-bold flex-shrink-0">keep</span>}
          </label>
        ))}
      </div>
      {canMerge && (
        <button onClick={() => onMerge(canonical, variants)} disabled={busy || !variants.length}
          className="px-3 py-1.5 rounded-lg bg-violet-600 hover:bg-violet-500 text-white text-xs font-bold transition-colors disabled:opacity-50">
          Merge {variants.length} into “{canonical.length > 30 ? canonical.slice(0, 30) + '…' : canonical}”
        </button>
      )}
    </div>
  );
}

// A distinct value with its usage count and an owner rename affordance.
function ValueRow({ value, count, unit, canEdit, busy, onRename }: {
  value: string; count: number; unit: string; canEdit: boolean; busy: boolean;
  onRename: (oldVal: string, newVal: string) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value);
  return (
    <div className="flex items-center gap-3 px-4 py-2.5 hover:bg-slate-800/30 transition-colors">
      {editing ? (
        <>
          <input autoFocus value={draft} onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') { onRename(value, draft); setEditing(false); } if (e.key === 'Escape') { setDraft(value); setEditing(false); } }}
            className="flex-1 bg-slate-950 border border-violet-500/40 rounded-lg px-2.5 py-1 text-xs text-white focus:outline-none" />
          <button onClick={() => { onRename(value, draft); setEditing(false); }} disabled={busy} className="text-[11px] text-violet-300 hover:text-violet-200 font-semibold">Save</button>
          <button onClick={() => { setDraft(value); setEditing(false); }} className="text-[11px] text-slate-500 hover:text-slate-300">Cancel</button>
        </>
      ) : (
        <>
          <span className="flex-1 text-xs text-slate-200 truncate">{value}</span>
          <span className="text-[10px] text-slate-600 tabular-nums flex-shrink-0">{count} {unit}{count !== 1 ? 's' : ''}</span>
          {canEdit && (
            <button onClick={() => setEditing(true)} className="text-[11px] text-slate-500 hover:text-white transition-colors flex-shrink-0">Rename</button>
          )}
        </>
      )}
    </div>
  );
}
