'use client';
/**
 * ICAPROC — Import & Export.
 *
 * Built for the Dolibarr cutover and kept afterwards, because the same screen
 * is how you get data out for the accountant and back in after a bulk edit.
 *
 * The import is a three-step wizard on purpose: choose → check → commit.
 * Nothing is written until a dry run has told you, row by row, what will
 * happen. A migration you cannot rehearse is a migration you get one attempt
 * at, and this one runs against the live business.
 */
import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { createSupabaseClient } from '@/lib/supabase';
import { useAuth } from '@/hooks/useAuth';
import { ROLE_PERMISSIONS } from '@/constants/roles';
import { canOpenPath } from '@/constants/navigation';
import BrandMenu from '@/components/ui/BrandMenu';
import { downloadCsv, parseCsv, readFileText } from '@/lib/csv';
import { fmtInt, fmtDayTime } from '@/lib/formatters';
import {
  ENTITIES, IMPORT_ORDER, entitySpec, autoMap, applyMap, loadLookups, resolveRows,
  dryRun, commit, attachOrderLines, exportEntity,
  type PortEntity, type DryRun, type Resolved, type Lookups, type CommitResult,
} from '@/lib/dataPorting';

interface Batch {
  batch_id: string; entity: string; filename: string; row_count: number;
  created_count: number; updated_count: number; skipped_count: number; error_count: number;
  created_at: string; created_by_email: string; notes: string;
}

type Stage = 'pick' | 'check' | 'done';

export default function DataPage() {
  const supabase = createSupabaseClient();
  const router = useRouter();
  const { user, profile, loading: authLoading } = useAuth();
  const perms = profile ? ROLE_PERMISSIONS[profile.role] : null;
  const canImport = !!perms?.canManageUsers;      // a bulk write can rewrite the business — owner only
  const canExport = !!perms && canOpenPath(perms, '/import-export');

  const [tab, setTab] = useState<'export' | 'import'>('export');
  const [msg, setMsg] = useState('');
  const [batches, setBatches] = useState<Batch[]>([]);

  // Export state
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [busy, setBusy] = useState<PortEntity | 'all' | null>(null);

  // Import state
  const [entity, setEntity] = useState<PortEntity>('customers');
  const [file, setFile] = useState<File | null>(null);
  const [headers, setHeaders] = useState<string[]>([]);
  const [raw, setRaw] = useState<Record<string, string>[]>([]);
  const [map, setMap] = useState<Record<string, string>>({});
  const [unmatched, setUnmatched] = useState<string[]>([]);
  const [plan, setPlan] = useState<DryRun | null>(null);
  const [resolved, setResolved] = useState<Resolved[]>([]);
  const [lookups, setLookups] = useState<Lookups | null>(null);
  const [stage, setStage] = useState<Stage>('pick');
  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState({ done: 0, total: 0 });
  const [result, setResult] = useState<CommitResult | null>(null);

  useEffect(() => { document.title = 'Import & Export — ICAPROC'; }, []);
  useEffect(() => {
    if (authLoading) return;
    if (!user) { router.replace(`/login?next=${encodeURIComponent('/import-export')}`); return; }
    if (profile && !canExport) router.replace('/unauthorized');
  }, [authLoading, user, profile, canExport, router]);

  const loadBatches = () => {
    supabase.from('40.1_import_batches').select('*').order('created_at', { ascending: false }).limit(20)
      .then(({ data }) => setBatches((data as Batch[]) ?? []));
  };
  useEffect(() => { if (user) loadBatches(); }, [user]);

  const flash = (m: string) => { setMsg(m); setTimeout(() => setMsg(''), 6000); };

  // ── Export ────────────────────────────────────────────────────────────────
  async function doExport(k: PortEntity) {
    setBusy(k);
    try {
      const { headers, rows } = await exportEntity(supabase, k, from || undefined, to || undefined);
      if (!rows.length) { flash(`No ${entitySpec(k).label.toLowerCase()} in that range.`); return; }
      const stamp = from || to ? `-${from || 'start'}_${to || 'today'}` : '';
      downloadCsv(`icaproc-${k}${stamp}-${new Date().toISOString().slice(0, 10)}`, headers, rows);
      flash(`Exported ${fmtInt(rows.length)} ${entitySpec(k).label.toLowerCase()}.`);
    } catch (e) {
      flash(`Export failed — ${(e as Error).message}`);
    } finally { setBusy(null); }
  }

  async function exportAll() {
    setBusy('all');
    for (const k of IMPORT_ORDER) {
      const { headers, rows } = await exportEntity(supabase, k, from || undefined, to || undefined);
      if (rows.length) downloadCsv(`icaproc-${k}-${new Date().toISOString().slice(0, 10)}`, headers, rows);
    }
    setBusy(null);
    flash('Exported every entity in dependency order — import them back in the same order.');
  }

  function downloadTemplate(k: PortEntity) {
    const spec = entitySpec(k);
    downloadCsv(`icaproc-template-${k}`, spec.fields.map((f) => f.label), []);
  }

  // ── Import ────────────────────────────────────────────────────────────────
  async function onFile(f: File) {
    setFile(f);
    setStage('pick'); setPlan(null); setResult(null);
    const { headers, rows } = parseCsv(await readFileText(f));
    if (!rows.length) { flash('No data rows found in that file.'); return; }
    setHeaders(headers);
    setRaw(rows);
    const spec = entitySpec(entity);
    const { map, unmatched } = autoMap(headers, spec);
    setMap(map); setUnmatched(unmatched);
    flash(`${fmtInt(rows.length)} rows read · ${Object.keys(map).length} of ${headers.length} columns matched.`);
  }

  // Re-map when the target entity changes under an already-loaded file
  useEffect(() => {
    if (!headers.length) return;
    const { map, unmatched } = autoMap(headers, entitySpec(entity));
    setMap(map); setUnmatched(unmatched);
    setPlan(null); setStage('pick');
  }, [entity]);

  async function doDryRun() {
    setRunning(true);
    try {
      const L = await loadLookups(supabase);
      setLookups(L);
      const mapped = applyMap(raw, headers, map);
      let res = resolveRows(entity, mapped, L);
      if (entity === 'invoices') res = attachOrderLines(res, L);
      setResolved(res);
      setPlan(dryRun(entity, res));
      setStage('check');
    } catch (e) {
      flash(`Could not check the file — ${(e as Error).message}`);
    } finally { setRunning(false); }
  }

  async function doCommit() {
    if (!plan || !lookups) return;
    setRunning(true);
    setProgress({ done: 0, total: plan.create + plan.update });
    try {
      const r = await commit(supabase, entity, resolved, (done, total) => setProgress({ done, total }));
      setResult(r);
      setStage('done');
      await supabase.from('40.1_import_batches').insert({
        entity, filename: file?.name ?? '', row_count: plan.total,
        created_count: r.created, updated_count: r.updated, skipped_count: r.skipped, error_count: r.failed,
        notes: plan.issues.filter((i) => !i.fatal).length ? `${plan.issues.filter((i) => !i.fatal).length} warnings` : '',
      });
      loadBatches();
    } catch (e) {
      flash(`Import failed — ${(e as Error).message}`);
    } finally { setRunning(false); }
  }

  function reset() {
    setFile(null); setHeaders([]); setRaw([]); setMap({}); setUnmatched([]);
    setPlan(null); setResolved([]); setResult(null); setStage('pick');
  }

  const spec = entitySpec(entity);
  const fatal = useMemo(() => (plan?.issues ?? []).filter((i) => i.fatal), [plan]);
  const warnings = useMemo(() => (plan?.issues ?? []).filter((i) => !i.fatal), [plan]);

  if (authLoading || !user) {
    return <div className="min-h-screen bg-chrome flex items-center justify-center"><div className="w-6 h-6 border-2 border-emerald-500/30 border-t-emerald-500 rounded-full animate-spin" /></div>;
  }

  return (
    <div className="min-h-screen bg-chrome text-slate-200 font-sans text-sm">
      <div className="border-b border-slate-800/60 bg-chrome/80 backdrop-blur-md sticky top-0 z-30">
        <div className="max-w-[1400px] mx-auto px-3 sm:px-4 md:px-6 py-2.5 sm:py-3 flex flex-col sm:flex-row sm:items-center justify-between sm:flex-wrap gap-2.5">
          <BrandMenu wordmarkClass="text-xl md:text-2xl font-extrabold" subtitle="Import & Export · bulk data in and out" />
          <Link href="/settings" className="text-xs text-slate-400 hover:text-white px-3 py-1.5 border border-slate-700 rounded-lg hover:bg-slate-800 transition-colors self-start sm:self-auto">
            Settings →
          </Link>
        </div>
      </div>

      <main className="max-w-[1400px] mx-auto px-3 sm:px-4 md:px-6 py-4 sm:py-5 space-y-5">
        {msg && <div className="rounded-xl border border-emerald-500/30 bg-emerald-500/10 px-4 py-2.5 text-xs text-emerald-200">{msg}</div>}

        <div className="flex items-center gap-1 border-b border-slate-800/80">
          {([['export', 'Export'], ['import', 'Import']] as ['export' | 'import', string][]).map(([k, label]) => (
            <button key={k} onClick={() => setTab(k)} disabled={k === 'import' && !canImport}
              className={`text-xs font-semibold px-3.5 py-2.5 border-b-2 -mb-px transition-colors disabled:opacity-40 disabled:cursor-not-allowed ${tab === k ? 'border-emerald-400 text-emerald-300' : 'border-transparent text-slate-500 hover:text-slate-300'}`}>
              {label}{k === 'import' && !canImport ? ' (owner only)' : ''}
            </button>
          ))}
        </div>

        {tab === 'export' ? (
          <>
            <div className="bg-slate-900/40 border border-slate-800/80 rounded-2xl p-4 sm:p-5 space-y-4">
              <div className="flex flex-wrap items-end gap-3">
                <label className="text-[11px] text-slate-500">
                  <span className="block mb-1">From</span>
                  <input type="date" value={from} onChange={(e) => setFrom(e.target.value)}
                    className="h-9 px-3 rounded-lg bg-slate-900 border border-slate-700 text-white text-xs outline-none focus:border-emerald-500/60" />
                </label>
                <label className="text-[11px] text-slate-500">
                  <span className="block mb-1">To</span>
                  <input type="date" value={to} onChange={(e) => setTo(e.target.value)}
                    className="h-9 px-3 rounded-lg bg-slate-900 border border-slate-700 text-white text-xs outline-none focus:border-emerald-500/60" />
                </label>
                {(from || to) && (
                  <button onClick={() => { setFrom(''); setTo(''); }} className="h-9 px-3 text-[11px] text-slate-400 hover:text-white border border-slate-700 rounded-lg hover:bg-slate-800 transition-colors">Clear</button>
                )}
                <button onClick={exportAll} disabled={busy !== null}
                  className="h-9 px-4 ml-auto text-xs font-bold rounded-lg bg-emerald-500/15 border border-emerald-500/40 text-emerald-300 hover:bg-emerald-500/25 transition-colors disabled:opacity-50">
                  {busy === 'all' ? 'Exporting…' : 'Export everything'}
                </button>
              </div>
              <p className="text-[10px] text-slate-600">
                Blank dates export everything. Each entity filters on its own date — customers on date added, orders on quote date, invoices on issue date, receipts on payment date.
                The columns match what the importer reads, so an export can be edited and imported straight back.
              </p>
            </div>

            <div className="grid sm:grid-cols-2 xl:grid-cols-3 gap-3">
              {ENTITIES.map((e) => (
                <div key={e.key} className="bg-slate-900/40 border border-slate-800/80 rounded-2xl p-4 flex flex-col">
                  <p className="text-sm font-bold text-white">{e.label}</p>
                  <p className="text-[11px] text-slate-500 mt-1 leading-relaxed flex-1">{e.blurb}</p>
                  <div className="flex items-center gap-2 mt-3">
                    <button onClick={() => doExport(e.key)} disabled={busy !== null}
                      className="flex-1 h-9 text-xs font-semibold rounded-lg bg-slate-800/60 border border-slate-700 text-slate-200 hover:bg-slate-800 transition-colors disabled:opacity-50">
                      {busy === e.key ? 'Exporting…' : 'Export CSV'}
                    </button>
                    <button onClick={() => downloadTemplate(e.key)}
                      className="h-9 px-3 text-[11px] text-slate-400 hover:text-white border border-slate-700 rounded-lg hover:bg-slate-800 transition-colors whitespace-nowrap"
                      title="Empty CSV with just the headers — shape your source data to match">
                      Template
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </>
        ) : !canImport ? (
          <p className="text-slate-500 text-xs py-10 text-center">Importing is restricted to owners.</p>
        ) : (
          <>
            {/* ── Step 1 — pick entity + file ── */}
            <div className="bg-slate-900/40 border border-slate-800/80 rounded-2xl p-4 sm:p-5 space-y-4">
              <div className="flex items-center gap-2">
                <StepDot n={1} active={stage === 'pick'} done={stage !== 'pick'} />
                <h2 className="text-sm font-bold text-white">Choose what you are importing</h2>
              </div>

              <div className="flex flex-wrap gap-1.5">
                {IMPORT_ORDER.map((k, i) => (
                  <button key={k} onClick={() => setEntity(k)}
                    className={`text-[11px] px-2.5 py-1.5 rounded-lg border transition-colors ${entity === k ? 'bg-emerald-500/15 border-emerald-500/40 text-emerald-300 font-bold' : 'border-slate-700/80 text-slate-500 hover:text-slate-300'}`}>
                    <span className="opacity-50 mr-1">{i + 1}.</span>{entitySpec(k).label}
                  </button>
                ))}
              </div>
              <p className="text-[11px] text-slate-500 leading-relaxed">{spec.blurb}</p>
              {spec.needs.length > 0 && (
                <p className="text-[10px] text-amber-400/90">
                  Import {spec.needs.map((n) => entitySpec(n).label).join(' and ')} first — this file attaches to {spec.needs.length > 1 ? 'them' : 'it'}.
                </p>
              )}

              <div className="flex flex-wrap items-center gap-3">
                <label className="h-9 px-4 text-xs font-semibold rounded-lg bg-slate-800/60 border border-slate-700 text-slate-200 hover:bg-slate-800 transition-colors cursor-pointer flex items-center">
                  {file ? 'Choose another file' : 'Choose CSV file'}
                  <input type="file" accept=".csv,text/csv" className="hidden"
                    onChange={(e) => { const f = e.target.files?.[0]; if (f) onFile(f); e.target.value = ''; }} />
                </label>
                <button onClick={() => downloadTemplate(entity)} className="h-9 px-3 text-[11px] text-slate-400 hover:text-white border border-slate-700 rounded-lg hover:bg-slate-800 transition-colors">
                  Download template
                </button>
                {file && <span className="text-[11px] text-slate-400 truncate">{file.name} · {fmtInt(raw.length)} rows</span>}
                {file && <button onClick={reset} className="text-[11px] text-slate-500 hover:text-red-300 transition-colors">Clear</button>}
              </div>

              {/* Column mapping */}
              {headers.length > 0 && (
                <div className="space-y-2">
                  <p className="text-[10px] font-bold uppercase tracking-widest text-slate-500">Column mapping</p>
                  <div className="grid sm:grid-cols-2 xl:grid-cols-3 gap-2">
                    {headers.map((h) => (
                      <div key={h} className="flex items-center gap-2 text-[11px]">
                        <span className="truncate flex-1 text-slate-400" title={h}>{h || '(blank)'}</span>
                        <span className="text-slate-700">→</span>
                        <select value={map[h] ?? ''} onChange={(e) => setMap((m) => ({ ...m, [h]: e.target.value }))}
                          className="w-36 h-8 px-2 rounded-lg bg-slate-900 border border-slate-700 text-slate-200 text-[11px] outline-none focus:border-emerald-500/60">
                          <option value="">— ignore —</option>
                          {spec.fields.map((f) => <option key={f.key} value={f.key}>{f.label}</option>)}
                        </select>
                      </div>
                    ))}
                  </div>
                  {unmatched.length > 0 && (
                    <p className="text-[10px] text-slate-600">{unmatched.length} column{unmatched.length !== 1 ? 's' : ''} unmatched and will be ignored: {unmatched.slice(0, 8).join(', ')}{unmatched.length > 8 ? '…' : ''}</p>
                  )}
                  <div className="flex flex-wrap gap-2 text-[10px] text-slate-600">
                    Required: {spec.fields.filter((f) => f.required).map((f) => {
                      const ok = Object.values(map).includes(f.key);
                      return <span key={f.key} className={ok ? 'text-emerald-400' : 'text-red-400'}>{f.label}{ok ? ' ✓' : ' ✗'}</span>;
                    })}
                  </div>
                  <button onClick={doDryRun} disabled={running || !raw.length}
                    className="h-9 px-4 text-xs font-bold rounded-lg bg-emerald-500/15 border border-emerald-500/40 text-emerald-300 hover:bg-emerald-500/25 transition-colors disabled:opacity-50">
                    {running ? 'Checking…' : 'Check the file'}
                  </button>
                </div>
              )}
            </div>

            {/* ── Step 2 — dry run ── */}
            {plan && (
              <div className="bg-slate-900/40 border border-slate-800/80 rounded-2xl p-4 sm:p-5 space-y-4">
                <div className="flex items-center gap-2">
                  <StepDot n={2} active={stage === 'check'} done={stage === 'done'} />
                  <h2 className="text-sm font-bold text-white">What will happen</h2>
                  <span className="ml-auto text-[10px] text-slate-600">nothing has been written yet</span>
                </div>

                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5">
                  <Stat label="Will create" value={plan.create} tone="emerald" />
                  <Stat label="Will update" value={plan.update} tone="sky" />
                  <Stat label="Will skip" value={plan.skip} tone={plan.skip ? 'red' : 'slate'} />
                  <Stat label="Warnings" value={warnings.length} tone={warnings.length ? 'amber' : 'slate'} />
                </div>

                {fatal.length > 0 && (
                  <IssueList title={`${fatal.length} row${fatal.length !== 1 ? 's' : ''} cannot be imported`} tone="red" issues={fatal} />
                )}
                {warnings.length > 0 && (
                  <IssueList title={`${warnings.length} warning${warnings.length !== 1 ? 's' : ''} — these rows still import`} tone="amber" issues={warnings} />
                )}

                {plan.sample.length > 0 && (
                  <details className="text-[11px]">
                    <summary className="cursor-pointer text-slate-500 hover:text-slate-300">Preview the first {plan.sample.length} resolved rows</summary>
                    <pre className="mt-2 p-3 rounded-xl bg-slate-950/60 border border-slate-800 overflow-x-auto text-[10px] text-slate-400">{JSON.stringify(plan.sample, null, 2)}</pre>
                  </details>
                )}

                {stage === 'check' && (
                  <div className="flex flex-wrap items-center gap-3">
                    <button onClick={doCommit} disabled={running || plan.create + plan.update === 0}
                      className="h-10 px-5 text-xs font-bold rounded-lg bg-emerald-500 text-slate-950 hover:bg-emerald-400 transition-colors disabled:opacity-40">
                      {running ? `Importing ${progress.done}/${progress.total}…` : `Import ${fmtInt(plan.create + plan.update)} row${plan.create + plan.update !== 1 ? 's' : ''}`}
                    </button>
                    <button onClick={reset} disabled={running} className="h-10 px-4 text-xs text-slate-400 hover:text-white border border-slate-700 rounded-lg hover:bg-slate-800 transition-colors">Cancel</button>
                    {running && progress.total > 0 && (
                      <div className="flex-1 min-w-[120px] h-1.5 bg-slate-800 rounded-full overflow-hidden">
                        <div className="h-full bg-emerald-500 rounded-full transition-all" style={{ width: `${(progress.done / progress.total) * 100}%` }} />
                      </div>
                    )}
                  </div>
                )}
              </div>
            )}

            {/* ── Step 3 — result ── */}
            {result && (
              <div className="bg-slate-900/40 border border-emerald-500/30 rounded-2xl p-4 sm:p-5 space-y-3">
                <div className="flex items-center gap-2">
                  <StepDot n={3} active done />
                  <h2 className="text-sm font-bold text-white">Imported</h2>
                </div>
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5">
                  <Stat label="Created" value={result.created} tone="emerald" />
                  <Stat label="Updated" value={result.updated} tone="sky" />
                  <Stat label="Skipped" value={result.skipped} tone={result.skipped ? 'amber' : 'slate'} />
                  <Stat label="Failed" value={result.failed} tone={result.failed ? 'red' : 'slate'} />
                </div>
                {result.issues.length > 0 && <IssueList title="Write errors" tone="red" issues={result.issues} />}
                <div className="flex flex-wrap gap-2">
                  <button onClick={reset} className="h-9 px-4 text-xs font-semibold rounded-lg bg-slate-800/60 border border-slate-700 text-slate-200 hover:bg-slate-800 transition-colors">Import another file</button>
                  {IMPORT_ORDER[IMPORT_ORDER.indexOf(entity) + 1] && (
                    <button onClick={() => { reset(); setEntity(IMPORT_ORDER[IMPORT_ORDER.indexOf(entity) + 1]); }}
                      className="h-9 px-4 text-xs font-semibold rounded-lg bg-emerald-500/15 border border-emerald-500/40 text-emerald-300 hover:bg-emerald-500/25 transition-colors">
                      Next: {entitySpec(IMPORT_ORDER[IMPORT_ORDER.indexOf(entity) + 1]).label} →
                    </button>
                  )}
                </div>
              </div>
            )}
          </>
        )}

        {/* ── Batch history ── */}
        {batches.length > 0 && (
          <div className="bg-slate-900/40 border border-slate-800/80 rounded-2xl p-4 sm:p-5">
            <p className="text-[10px] font-bold uppercase tracking-widest text-slate-500 mb-3">Import history</p>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[620px] text-[11px]">
                <thead>
                  <tr className="text-[10px] uppercase tracking-widest text-slate-600 border-b border-slate-800">
                    <th className="text-left py-2 font-semibold">When</th>
                    <th className="text-left py-2 font-semibold">Entity</th>
                    <th className="text-left py-2 font-semibold">File</th>
                    <th className="text-right py-2 font-semibold">Rows</th>
                    <th className="text-right py-2 font-semibold">Created</th>
                    <th className="text-right py-2 font-semibold">Updated</th>
                    <th className="text-right py-2 font-semibold">Failed</th>
                    <th className="text-left py-2 font-semibold pl-3">By</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-800/50">
                  {batches.map((b) => (
                    <tr key={b.batch_id} className="text-slate-400">
                      <td className="py-2 whitespace-nowrap">{fmtDayTime(b.created_at)}</td>
                      <td className="py-2 text-slate-200">{entitySpec(b.entity as PortEntity).label}</td>
                      <td className="py-2 truncate max-w-[180px]" title={b.filename}>{b.filename || '—'}</td>
                      <td className="py-2 text-right tabular-nums">{fmtInt(b.row_count)}</td>
                      <td className="py-2 text-right tabular-nums text-emerald-400">{fmtInt(b.created_count)}</td>
                      <td className="py-2 text-right tabular-nums text-sky-400">{fmtInt(b.updated_count)}</td>
                      <td className={`py-2 text-right tabular-nums ${b.error_count ? 'text-red-400' : 'text-slate-700'}`}>{fmtInt(b.error_count)}</td>
                      <td className="py-2 pl-3 truncate max-w-[160px]">{b.created_by_email || '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        <p className="text-[10px] text-slate-600 leading-relaxed max-w-4xl">
          Imported rows carry the source system&apos;s own reference, so re-running the same file updates instead of duplicating.
          Importing an order does <span className="text-slate-400">not</span> move stock: the ledger already holds the real receipt history,
          and replaying historical deliveries into it would double-count. Migrated orders restore the commercial record — who bought what, when, at what price.
        </p>
      </main>
    </div>
  );
}

function StepDot({ n, active, done }: { n: number; active?: boolean; done?: boolean }) {
  return (
    <span className={`w-5 h-5 rounded-full grid place-items-center text-[10px] font-bold flex-shrink-0 ${
      done ? 'bg-emerald-500 text-slate-950' : active ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/40' : 'bg-slate-800 text-slate-500'}`}>
      {done ? '✓' : n}
    </span>
  );
}

const TONE: Record<string, string> = {
  emerald: 'text-emerald-300', sky: 'text-sky-300', amber: 'text-amber-300', red: 'text-red-400', slate: 'text-slate-500',
};

function Stat({ label, value, tone }: { label: string; value: number; tone: string }) {
  return (
    <div className="rounded-xl border border-slate-800 bg-slate-950/40 px-3.5 py-2.5">
      <p className="text-[10px] uppercase tracking-wider text-slate-600">{label}</p>
      <p className={`text-lg font-bold tabular-nums ${TONE[tone]}`}>{fmtInt(value)}</p>
    </div>
  );
}

function IssueList({ title, tone, issues }: { title: string; tone: string; issues: { row: number; field?: string; message: string }[] }) {
  const shown = issues.slice(0, 40);
  return (
    <details open={tone === 'red'} className="rounded-xl border border-slate-800 bg-slate-950/40 px-3.5 py-2.5">
      <summary className={`cursor-pointer text-[11px] font-semibold ${TONE[tone]}`}>{title}</summary>
      <ul className="mt-2 space-y-1 max-h-56 overflow-y-auto">
        {shown.map((i, n) => (
          <li key={n} className="text-[11px] text-slate-400">
            {i.row > 0 && <span className="text-slate-600 tabular-nums">row {i.row}</span>}
            {i.field && <span className="text-slate-600"> · {i.field}</span>}
            <span className="text-slate-600"> — </span>{i.message}
          </li>
        ))}
        {issues.length > shown.length && <li className="text-[11px] text-slate-600 italic">…and {issues.length - shown.length} more</li>}
      </ul>
    </details>
  );
}
