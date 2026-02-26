'use client';

import { useState, useCallback, useRef } from 'react';
import { useRouter } from 'next/navigation';
import * as XLSX from 'xlsx';
import { format, parse, isValid } from 'date-fns';
import {
  bulkInsertTransactions,
  fetchExistingTransactionKeys,
  addUserAccount,
  fetchUserAccounts,
  getUser,
  type BulkRow,
} from '@/lib/money-supabase';

// ── Types ─────────────────────────────────────────────────────

type TxType = 'Inc' | 'Exp' | 'Trf' | 'TrfIn' | 'TrfOut' | 'IncBal' | 'ExpBal';
type Step = 'upload' | 'map' | 'preview' | 'importing' | 'done';

interface RawRow {
  [key: string]: string | number | null | undefined;
}

interface MappedRow extends BulkRow {
  _raw:    RawRow;
  _error?: string;
  _dupKey: string;        // for dedup display
}

interface ColumnMap {
  date:         string;
  time:         string;
  account:      string;
  category:     string;
  subcategory:  string;
  note:         string;
  type:         string;
  description:  string;
  amount:       string;
  currency:     string;
  original_amount: string;
  raw_accounts1:   string;
}

interface ImportResult {
  inserted:    number;
  duplicates:  number;
  errors:      { row: number; message: string }[];
  newAccounts: string[];
}

// ── Helpers ───────────────────────────────────────────────────

const FIELD_LABELS: Record<keyof ColumnMap, string> = {
  date:            'Date / Period',
  time:            'Time (if separate)',
  account:         'Account',
  category:        'Category',
  subcategory:     'Subcategory',
  note:            'Note / Memo',
  type:            'Type (Income/Expense)',
  description:     'Description',
  amount:          'Amount (IDR)',
  currency:        'Currency',
  original_amount: 'Original Amount',
  raw_accounts1:   'Accounts.1 (redundant)',
};

const OPTIONAL_FIELDS: (keyof ColumnMap)[] = ['time', 'currency', 'original_amount', 'raw_accounts1'];
const REQUIRED_FIELDS:  (keyof ColumnMap)[] = ['date', 'amount', 'type'];

/** Best-guess column name matching */
function autoDetect(headers: string[]): Partial<ColumnMap> {
  const lower = headers.map(h => h.toLowerCase().trim());
  const find = (...candidates: string[]): string =>
    headers[lower.findIndex(h => candidates.some(c => h === c || h.includes(c)))] ?? '';

  return {
    date:            find('period', 'date', 'tanggal', 'tgl', 'datetime'),
    time:            find('time', 'waktu', 'jam'),
    account:         find('accounts', 'account', 'akun', 'rekening', 'wallet', 'bank'),
    category:        find('category', 'kategori'),
    subcategory:     find('subcategory', 'sub cat', 'sub-cat', 'subkategori'),
    note:            find('note', 'memo', 'catatan', 'keterangan'),
    type:            find('income/expense', 'type', 'tipe', 'jenis'),
    description:     find('description', 'deskripsi', 'desc'),
    amount:          find('idr', 'amount', 'nominal', 'jumlah', 'nilai'),
    currency:        find('currency', 'mata uang'),
    original_amount: find('original_amount', 'original amount'),
    raw_accounts1:   find('accounts.1', 'accounts1'),
  };
}

/** Normalise type strings → TxType */
function normaliseType(raw: string): TxType | null {
  const s = String(raw ?? '').toLowerCase().trim();
  // Exact spec values first
  if (s === 'income')           return 'Inc';
  if (s === 'exp.' || s === 'expense' || s === 'exp') return 'Exp';
  if (s === 'transfer-out' || s === 'transfer out')   return 'TrfOut';
  if (s === 'transfer-in'  || s === 'transfer in')    return 'TrfIn';
  if (s === 'income balance')   return 'IncBal';
  if (s === 'expense balance')  return 'ExpBal';
  // Aliases
  if (['inc', 'in', 'pemasukan', 'masuk', '+'].includes(s)) return 'Inc';
  if (['keluar', 'pengeluaran', 'out', '-'].includes(s))     return 'Exp';
  if (['expbal', 'exp bal', 'exp.bal', 'balance', 'balance adjustment',
       'balance exp', 'selisih kurang', 'koreksi kurang'].includes(s)) return 'ExpBal';
  if (['incbal', 'inc bal', 'inc.bal', 'balance inc',
       'selisih lebih', 'koreksi lebih'].includes(s)) return 'IncBal';
  if (['trf-in', 'trfin', 'masuk transfer', 'terima'].includes(s))  return 'TrfIn';
  if (['trf-out', 'trfout', 'kirim', 'keluar transfer'].includes(s)) return 'TrfOut';
  if (['trf', 'transfer', 'tr', 'tf', 'pindah'].includes(s)) return 'Trf';
  return null;
}

/** Normalise various date formats → 'YYYY-MM-DD' */
function normaliseDate(raw: string | number): string {
  if (typeof raw === 'number') {
    const d = XLSX.SSF.parse_date_code(raw);
    if (d) {
      return `${d.y}-${String(d.m).padStart(2,'0')}-${String(d.d).padStart(2,'0')}`;
    }
  }
  let s = String(raw).trim();
  if (!s) return '';
  // Strip embedded time from combined datetime: "23/02/2026, 08.35.11" → "23/02/2026"
  const commaIdx = s.indexOf(',');
  if (commaIdx > 0) s = s.slice(0, commaIdx).trim();
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10);
  const formats = [
    'dd/MM/yyyy', 'MM/dd/yyyy', 'dd-MM-yyyy', 'MM-dd-yyyy',
    'yyyy/MM/dd', 'd/M/yyyy', 'M/d/yyyy',
    'dd MMM yyyy', 'dd MMMM yyyy', 'MMM dd yyyy',
  ];
  for (const fmt of formats) {
    try {
      const parsed = parse(s, fmt, new Date());
      if (isValid(parsed)) return format(parsed, 'yyyy-MM-dd');
    } catch { /* try next */ }
  }
  return s.slice(0, 10);
}

/** Normalise time → 'HH:MM:SS' */
function normaliseTime(raw: string | number | undefined): string {
  if (raw == null || raw === '') return '00:00:00';
  if (typeof raw === 'number') {
    const fraction = raw % 1; // strip date portion
    const total = Math.round(fraction * 86400);
    const h = Math.floor(total / 3600);
    const m = Math.floor((total % 3600) / 60);
    const s = total % 60;
    return `${String(h).padStart(2,'0')}:${String(m).padStart(2,'0')}:${String(s).padStart(2,'0')}`;
  }
  let s = String(raw).trim();
  const commaIdx = s.indexOf(',');
  if (commaIdx > 0) s = s.slice(commaIdx + 1).trim();
  if (/^\d{1,2}:\d{2}(:\d{2})?/.test(s)) {
    const parts = s.split(':');
    return [parts[0].padStart(2,'0'), parts[1].padStart(2,'0'), (parts[2] ?? '00').slice(0,2).padStart(2,'0')].join(':');
  }
  if (/^\d{1,2}\.\d{2}(\.\d{2})?/.test(s)) {
    const parts = s.split('.');
    return [parts[0].padStart(2,'0'), parts[1].padStart(2,'0'), (parts[2] ?? '00').slice(0,2).padStart(2,'0')].join(':');
  }
  return '00:00:00';
}

/** Map one raw row using the user's column map */
function mapRow(raw: RawRow, colMap: ColumnMap, typeMap: Record<string, TxType>): MappedRow {
  const get = (field: keyof ColumnMap): string =>
    String(raw[colMap[field]] ?? '').trim();

  const rawType     = get('type');
  const resolvedType: TxType = typeMap[rawType] ?? normaliseType(rawType) ?? 'Exp';

  const rawAmount = raw[colMap.amount];
  const amount = Math.abs(parseFloat(String(rawAmount ?? '0').replace(/[^0-9.-]/g, '')) || 0);

  const rawDate    = raw[colMap.date];
  const rawDateStr = typeof rawDate === 'number' ? rawDate : String(rawDate ?? '');
  const date       = normaliseDate(rawDateStr);

  // Extract embedded time from combined datetime column
  let embeddedTime: string | number | undefined;
  if (typeof rawDate === 'number' && rawDate % 1 !== 0) {
    embeddedTime = rawDate; // normaliseTime will use raw % 1
  } else if (typeof rawDateStr === 'string' && rawDateStr.includes(',')) {
    embeddedTime = rawDateStr.split(',')[1]?.trim();
  }
  const rawTime = colMap.time ? raw[colMap.time] : embeddedTime;
  const time    = normaliseTime(rawTime as string | number | undefined);

  const rawOriginal = raw[colMap.original_amount];
  const originalAmount = rawOriginal != null && rawOriginal !== ''
    ? Math.abs(parseFloat(String(rawOriginal).replace(/[^0-9.-]/g, '')) || 0)
    : null;

  const rawAcc1 = raw[colMap.raw_accounts1];
  const rawAccounts1 = rawAcc1 != null && rawAcc1 !== ''
    ? Math.abs(parseFloat(String(rawAcc1).replace(/[^0-9.-]/g, '')) || 0)
    : null;

  const currency = get('currency') || 'IDR';

  let _error: string | undefined;
  if (!date)    _error = 'Invalid date';
  else if (!amount) _error = 'Zero or missing amount';
  else if (!resolvedType) _error = 'Unknown type';

  const account = get('account') || 'Cash';
  const _dupKey = `${date}|${time}|${account}|${amount}|${resolvedType}`;

  return {
    _raw: raw,
    _error,
    _dupKey,
    date,
    time,
    account,
    category:        get('category'),
    subcategory:     get('subcategory'),
    note:            get('note'),
    description:     get('description'),
    amount,
    type:            resolvedType,
    currency,
    original_amount: originalAmount,
    raw_accounts1:   rawAccounts1,
  };
}

/** Generate a UUID v4 (crypto.randomUUID if available, else fallback) */
function uuid(): string {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) return crypto.randomUUID();
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = Math.random() * 16 | 0;
    return (c === 'x' ? r : (r & 0x3 | 0x8)).toString(16);
  });
}

/**
 * Assign shared transfer_id UUIDs to TrfOut+TrfIn pairs.
 * Pairs matched by: date + time + amount (same or within 1 second).
 */
function assignTransferIds(rows: MappedRow[]): MappedRow[] {
  // Build a lookup: "date|time|amount" → [index, ...]
  const trfOut = new Map<string, number[]>();
  const trfIn  = new Map<string, number[]>();

  rows.forEach((r, i) => {
    if (r._error) return;
    const key = `${r.date}|${r.time}|${r.amount}`;
    if (r.type === 'TrfOut' || r.type === 'Trf') {
      trfOut.set(key, [...(trfOut.get(key) ?? []), i]);
    } else if (r.type === 'TrfIn') {
      trfIn.set(key, [...(trfIn.get(key) ?? []), i]);
    }
  });

  const result = rows.map(r => ({ ...r }));

  for (const [key, outIdxs] of trfOut.entries()) {
    const inIdxs = trfIn.get(key);
    if (!inIdxs) continue;
    const pairCount = Math.min(outIdxs.length, inIdxs.length);
    for (let p = 0; p < pairCount; p++) {
      const id = uuid();
      result[outIdxs[p]].transfer_id = id;
      result[inIdxs[p]].transfer_id  = id;
    }
  }
  return result;
}

// ── Sub-components ────────────────────────────────────────────

function StepIndicator({ step }: { step: Step }) {
  const steps: { id: Step; label: string }[] = [
    { id: 'upload',    label: 'Upload' },
    { id: 'map',       label: 'Map Columns' },
    { id: 'preview',   label: 'Preview' },
    { id: 'importing', label: 'Import' },
    { id: 'done',      label: 'Done' },
  ];
  const activeIdx = steps.findIndex(s => s.id === step);
  return (
    <div className="flex items-center gap-0 mb-8">
      {steps.map((s, i) => {
        const done    = i < activeIdx;
        const current = i === activeIdx;
        return (
          <div key={s.id} className="flex items-center">
            <div className={`flex items-center justify-center w-7 h-7 rounded-full text-xs font-bold
              ${done ? 'bg-emerald-500 text-white' : current ? 'bg-violet-600 text-white' : 'bg-slate-700 text-slate-400'}`}>
              {done ? '✓' : i + 1}
            </div>
            <span className={`ml-1.5 text-xs font-medium
              ${current ? 'text-white' : done ? 'text-emerald-400' : 'text-slate-500'}`}>
              {s.label}
            </span>
            {i < steps.length - 1 && (
              <div className={`mx-3 h-px w-6 ${done ? 'bg-emerald-500' : 'bg-slate-700'}`} />
            )}
          </div>
        );
      })}
    </div>
  );
}

// ── Main Component ────────────────────────────────────────────

export default function ImportPage() {
  const router = useRouter();

  const [step,          setStep]          = useState<Step>('upload');
  const [headers,       setHeaders]       = useState<string[]>([]);
  const [rawRows,       setRawRows]       = useState<RawRow[]>([]);
  const [colMap,        setColMap]        = useState<ColumnMap>({
    date:'', time:'', account:'', category:'', subcategory:'',
    note:'', type:'', description:'', amount:'',
    currency:'', original_amount:'', raw_accounts1:'',
  });
  const [distinctTypes, setDistinctTypes] = useState<string[]>([]);
  const [typeMap,       setTypeMap]       = useState<Record<string, TxType>>({});
  const [mapped,        setMapped]        = useState<MappedRow[]>([]);
  const [dupKeys,       setDupKeys]       = useState<Set<string>>(new Set());
  const [progress,      setProgress]      = useState(0);
  const [progressLabel, setProgressLabel] = useState('');
  const [result,        setResult]        = useState<ImportResult | null>(null);
  const [dragging,      setDragging]      = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  // ── Parse file ─────────────────────────────────────────────
  const parseFile = useCallback((file: File) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      const data = new Uint8Array(e.target!.result as ArrayBuffer);
      const wb   = XLSX.read(data, { type: 'array', cellDates: false, raw: false });
      const ws   = wb.Sheets[wb.SheetNames[0]];
      const json = XLSX.utils.sheet_to_json<RawRow>(ws, { defval: '' });
      if (json.length === 0) return;

      const hdrs    = Object.keys(json[0]);
      const detected = autoDetect(hdrs);

      setHeaders(hdrs);
      setRawRows(json);
      setColMap({
        date:            detected.date            ?? '',
        time:            detected.time            ?? '',
        account:         detected.account         ?? '',
        category:        detected.category        ?? '',
        subcategory:     detected.subcategory     ?? '',
        note:            detected.note            ?? '',
        type:            detected.type            ?? '',
        description:     detected.description     ?? '',
        amount:          detected.amount          ?? '',
        currency:        detected.currency        ?? '',
        original_amount: detected.original_amount ?? '',
        raw_accounts1:   detected.raw_accounts1   ?? '',
      });

      if (detected.type) {
        const vals = [...new Set(json.map(r => String(r[detected.type!] ?? '').trim()).filter(Boolean))];
        setDistinctTypes(vals);
        const auto: Record<string, TxType> = {};
        vals.forEach(v => { const t = normaliseType(v); if (t) auto[v] = t; });
        setTypeMap(auto);
      }
      setStep('map');
    };
    reader.readAsArrayBuffer(file);
  }, []);

  const onDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setDragging(false);
    const file = e.dataTransfer.files[0];
    if (file) parseFile(file);
  }, [parseFile]);

  const onFileChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) parseFile(file);
  }, [parseFile]);

  // ── Build preview ──────────────────────────────────────────
  const buildPreview = useCallback(async () => {
    // Re-collect distinct types in case colMap changed
    if (colMap.type) {
      const vals = [...new Set(rawRows.map(r => String(r[colMap.type] ?? '').trim()).filter(Boolean))];
      setDistinctTypes(vals);
      setTypeMap(prev => {
        const next = { ...prev };
        vals.forEach(v => { if (!next[v]) { const t = normaliseType(v); if (t) next[v] = t; } });
        return next;
      });
    }

    // Fetch existing keys for dedup
    setProgressLabel('Checking for duplicates…');
    const existingKeys = await fetchExistingTransactionKeys();
    setDupKeys(existingKeys);

    const rows = rawRows.map(r => mapRow(r, colMap, typeMap));
    // Assign transfer_id to paired TrfOut+TrfIn rows
    const withIds = assignTransferIds(rows);
    setMapped(withIds);
    setProgressLabel('');
    setStep('preview');
  }, [rawRows, colMap, typeMap]);

  // ── Do import ──────────────────────────────────────────────
  const doImport = useCallback(async () => {
    setStep('importing');
    setProgress(0);

    // Filter valid, non-duplicate rows
    const toInsert: BulkRow[] = mapped
      .filter(r => !r._error && !dupKeys.has(r._dupKey))
      .map(({ _raw: _r, _error: _e, _dupKey: _d, ...rest }) => rest);

    // Auto-create accounts that don't exist
    const newAccounts: string[] = [];
    try {
      setProgressLabel('Setting up accounts…');
      const user = await getUser();
      if (user) {
        const existing = await fetchUserAccounts();
        const existingNames = new Set(existing.map(a => a.name));
        const neededNames   = [...new Set(toInsert.map(r => r.account))];
        for (const name of neededNames) {
          if (!existingNames.has(name)) {
            try {
              await addUserAccount(name, 'debit');
              newAccounts.push(name);
            } catch { /* ignore duplicate-key errors */ }
          }
        }
      }
    } catch { /* non-fatal */ }

    setProgressLabel('Inserting transactions…');
    try {
      const res = await bulkInsertTransactions(toInsert, (done, total) => {
        setProgress(Math.round((done / total) * 100));
      });
      setResult({ ...res, duplicates: dupKeys.size > 0 ? mapped.filter(r => !r._error && dupKeys.has(r._dupKey)).length : 0, newAccounts });
      setStep('done');
    } catch (err) {
      setResult({ inserted: 0, duplicates: 0, errors: [{ row: 0, message: String(err) }], newAccounts });
      setStep('done');
    }
  }, [mapped, dupKeys]);

  const validCount     = mapped.filter(r => !r._error && !dupKeys.has(r._dupKey)).length;
  const dupCount       = mapped.filter(r => !r._error &&  dupKeys.has(r._dupKey)).length;
  const invalidCount   = mapped.filter(r =>  r._error).length;
  const transferPairs  = mapped.filter(r => !r._error && r.transfer_id != null).length / 2;

  // ── Render ─────────────────────────────────────────────────
  return (
    <div className="min-h-screen bg-slate-950 text-white">
      {/* Header */}
      <header className="flex items-center gap-3 px-5 py-4 border-b border-slate-700/50 bg-slate-900">
        <button
          onClick={() => router.push('/money')}
          className="p-2 rounded-lg hover:bg-slate-700 text-slate-400 hover:text-white transition-colors"
          aria-label="Back"
        >
          <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none"
            stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
            className="w-5 h-5"><polyline points="15 18 9 12 15 6"/></svg>
        </button>
        <div>
          <h1 className="text-base font-bold">Import Transactions</h1>
          <p className="text-xs text-slate-400">Excel (.xlsx) — 11-column format</p>
        </div>
      </header>

      <div className="max-w-3xl mx-auto px-4 py-8">
        <StepIndicator step={step} />

        {/* ── STEP 1: Upload ── */}
        {step === 'upload' && (
          <div
            className={`border-2 border-dashed rounded-2xl p-12 text-center transition-colors cursor-pointer
              ${dragging ? 'border-violet-500 bg-violet-500/5' : 'border-slate-700 hover:border-slate-500'}`}
            onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
            onDragLeave={() => setDragging(false)}
            onDrop={onDrop}
            onClick={() => fileRef.current?.click()}
          >
            <input ref={fileRef} type="file" accept=".xlsx,.xls,.csv" className="hidden"
              onChange={onFileChange} />
            <div className="w-16 h-16 mx-auto mb-4 rounded-2xl bg-violet-600/20 flex items-center justify-center">
              <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none"
                stroke="#8b5cf6" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"
                className="w-8 h-8">
                <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
                <polyline points="14 2 14 8 20 8"/>
                <line x1="12" y1="18" x2="12" y2="12"/>
                <polyline points="9 15 12 12 15 15"/>
              </svg>
            </div>
            <p className="text-white font-semibold mb-1">Drop your Excel file here</p>
            <p className="text-slate-400 text-sm mb-4">or click to browse</p>
            <div className="inline-block bg-slate-800/80 rounded-xl px-4 py-2 text-left">
              <p className="text-slate-400 text-xs font-semibold mb-1">Expected columns:</p>
              <p className="text-slate-500 text-xs">Period · Accounts · Category · Subcategory · Note · IDR · Income/Expense · Description · Amount · Currency · Accounts.1</p>
            </div>
          </div>
        )}

        {/* ── STEP 2: Map Columns ── */}
        {step === 'map' && (
          <div className="space-y-6">
            <div className="bg-slate-800 rounded-xl p-4 text-sm text-slate-300">
              <span className="text-violet-400 font-semibold">{rawRows.length}</span> rows found.
              Map the columns from your file to the fields below.
              <span className="text-slate-500 ml-1">(Required: Date, Amount, Type)</span>
            </div>

            {/* Column mapping grid */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              {(Object.keys(FIELD_LABELS) as (keyof ColumnMap)[]).map(field => (
                <div key={field}>
                  <label className="block text-xs text-slate-400 mb-1.5">
                    {FIELD_LABELS[field]}
                    {REQUIRED_FIELDS.includes(field) && <span className="text-rose-400 ml-0.5">*</span>}
                    {OPTIONAL_FIELDS.includes(field) && <span className="text-slate-600 ml-1">(optional)</span>}
                  </label>
                  <select
                    value={colMap[field]}
                    onChange={e => setColMap(prev => ({ ...prev, [field]: e.target.value }))}
                    className="w-full bg-slate-900 border border-slate-700 text-white text-sm rounded-xl px-3 py-2.5 focus:outline-none focus:ring-2 focus:ring-violet-500"
                  >
                    <option value="">— skip —</option>
                    {headers.map(h => <option key={h} value={h}>{h}</option>)}
                  </select>
                </div>
              ))}
            </div>

            {/* Type value mapping */}
            {colMap.type && distinctTypes.length > 0 && (
              <div className="bg-slate-800/60 border border-slate-700/50 rounded-xl p-4">
                <p className="text-sm font-semibold text-white mb-3">Map type values in your file:</p>
                <div className="space-y-2">
                  {distinctTypes.map(val => (
                    <div key={val} className="flex items-center gap-3">
                      <span className="text-sm text-slate-300 w-44 truncate font-mono bg-slate-900 rounded px-2 py-1 shrink-0">
                        {val}
                      </span>
                      <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none"
                        stroke="currentColor" strokeWidth="2" className="w-4 h-4 text-slate-600 shrink-0">
                        <polyline points="9 18 15 12 9 6"/>
                      </svg>
                      <div className="flex flex-wrap gap-1.5">
                        {([
                          ['Inc',    'bg-emerald-500/20 border-emerald-500/40 text-emerald-400'],
                          ['Exp',    'bg-rose-500/20 border-rose-500/40 text-rose-400'],
                          ['IncBal', 'bg-teal-500/20 border-teal-500/40 text-teal-400'],
                          ['ExpBal', 'bg-orange-500/20 border-orange-500/40 text-orange-400'],
                          ['TrfIn',  'bg-indigo-500/20 border-indigo-500/40 text-indigo-400'],
                          ['TrfOut', 'bg-sky-500/20 border-sky-500/40 text-sky-400'],
                          ['Trf',    'bg-slate-500/20 border-slate-500/40 text-slate-400'],
                        ] as [TxType, string][]).map(([t, color]) => {
                          const selected = typeMap[val] === t;
                          return (
                            <button key={t}
                              onClick={() => setTypeMap(prev => ({ ...prev, [val]: t }))}
                              className={`px-2 py-0.5 rounded-lg border text-[10px] font-semibold transition-all
                                ${selected ? color + ' ring-1 ring-offset-0' :
                                  'bg-slate-700 border-slate-600 text-slate-400 hover:text-white'}`}>
                              {t}
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {progressLabel && (
              <p className="text-xs text-slate-500 text-center">{progressLabel}</p>
            )}

            <button
              onClick={buildPreview}
              disabled={!colMap.date || !colMap.amount || !colMap.type}
              className="w-full py-3.5 bg-violet-600 hover:bg-violet-500 disabled:opacity-40 text-white rounded-xl font-semibold transition-colors"
            >
              Preview Import →
            </button>
          </div>
        )}

        {/* ── STEP 3: Preview ── */}
        {step === 'preview' && (
          <div className="space-y-4">
            {/* Stats bar */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              <div className="bg-emerald-500/10 border border-emerald-500/20 rounded-xl p-3 text-center">
                <p className="text-emerald-400 text-xl font-bold">{validCount}</p>
                <p className="text-xs text-slate-400">Ready</p>
              </div>
              {dupCount > 0 && (
                <div className="bg-amber-500/10 border border-amber-500/20 rounded-xl p-3 text-center">
                  <p className="text-amber-400 text-xl font-bold">{dupCount}</p>
                  <p className="text-xs text-slate-400">Duplicates</p>
                </div>
              )}
              {invalidCount > 0 && (
                <div className="bg-rose-500/10 border border-rose-500/20 rounded-xl p-3 text-center">
                  <p className="text-rose-400 text-xl font-bold">{invalidCount}</p>
                  <p className="text-xs text-slate-400">Invalid</p>
                </div>
              )}
              {transferPairs > 0 && (
                <div className="bg-sky-500/10 border border-sky-500/20 rounded-xl p-3 text-center">
                  <p className="text-sky-400 text-xl font-bold">{Math.round(transferPairs)}</p>
                  <p className="text-xs text-slate-400">Transfer pairs</p>
                </div>
              )}
            </div>

            {/* Table preview */}
            <div className="rounded-xl border border-slate-700 overflow-hidden">
              <div className="overflow-x-auto max-h-[52vh]">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="bg-slate-800 sticky top-0">
                      <th className="px-3 py-2.5 text-left text-slate-400 font-semibold">Date</th>
                      <th className="px-3 py-2.5 text-left text-slate-400 font-semibold">Account</th>
                      <th className="px-3 py-2.5 text-left text-slate-400 font-semibold">Category</th>
                      <th className="px-3 py-2.5 text-left text-slate-400 font-semibold">Note</th>
                      <th className="px-3 py-2.5 text-left text-slate-400 font-semibold">Type</th>
                      <th className="px-3 py-2.5 text-right text-slate-400 font-semibold">Amount (IDR)</th>
                      <th className="px-3 py-2.5 text-center text-slate-400 font-semibold">Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {mapped.map((row, i) => {
                      const isDup = !row._error && dupKeys.has(row._dupKey);
                      return (
                        <tr key={i}
                          className={`border-t border-slate-800 ${row._error || isDup ? 'opacity-40' : 'hover:bg-slate-800/40'}`}>
                          <td className="px-3 py-2 text-slate-300 whitespace-nowrap">{row.date}</td>
                          <td className="px-3 py-2 text-slate-300 max-w-[80px] truncate">{row.account}</td>
                          <td className="px-3 py-2 text-slate-400 max-w-[80px] truncate">{row.category}</td>
                          <td className="px-3 py-2 text-slate-400 max-w-[120px] truncate">{row.note}</td>
                          <td className="px-3 py-2">
                            <span className={`px-1.5 py-0.5 rounded text-[10px] font-bold
                              ${row.type === 'Inc' || row.type === 'IncBal' ? 'bg-emerald-500/20 text-emerald-400' :
                                row.type === 'Exp' || row.type === 'ExpBal' ? 'bg-rose-500/20 text-rose-400' :
                                'bg-sky-500/20 text-sky-400'}`}>
                              {row.type}
                            </span>
                            {row.transfer_id && (
                              <span className="ml-1 text-[9px] text-sky-600">⇄</span>
                            )}
                          </td>
                          <td className="px-3 py-2 text-right font-semibold text-slate-300">
                            {new Intl.NumberFormat('id-ID').format(row.amount)}
                          </td>
                          <td className="px-3 py-2 text-center">
                            {row._error
                              ? <span className="text-rose-400" title={row._error}>✗</span>
                              : isDup
                              ? <span className="text-amber-400" title="Already exists">⊘</span>
                              : <span className="text-emerald-400">✓</span>}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>

            <div className="text-xs text-slate-500 space-y-0.5">
              {dupCount > 0 && <p>⊘ = already exists in DB — will be skipped</p>}
              {invalidCount > 0 && <p>✗ = invalid date, zero amount, or unknown type — will be skipped</p>}
              {transferPairs > 0 && <p>⇄ = transfer pair detected — both rows share a transfer ID</p>}
            </div>

            <div className="flex gap-3">
              <button
                onClick={() => setStep('map')}
                className="flex-1 py-3.5 border border-slate-600 hover:border-slate-500 text-slate-300 hover:text-white rounded-xl font-semibold transition-colors text-sm"
              >
                ← Back
              </button>
              <button
                onClick={doImport}
                disabled={validCount === 0}
                className="flex-1 py-3.5 bg-violet-600 hover:bg-violet-500 disabled:opacity-40 text-white rounded-xl font-semibold transition-colors text-sm"
              >
                Import {validCount} transactions
              </button>
            </div>
          </div>
        )}

        {/* ── STEP 4: Importing ── */}
        {step === 'importing' && (
          <div className="flex flex-col items-center justify-center py-20 gap-6">
            <div className="w-16 h-16 rounded-full border-4 border-violet-600 border-t-transparent animate-spin" />
            <div className="text-center">
              <p className="text-white font-semibold text-lg">
                {progressLabel || 'Importing transactions…'}
              </p>
              {!progressLabel && <p className="text-slate-400 text-sm mt-1">{progress}% complete</p>}
            </div>
            {!progressLabel && (
              <div className="w-64 h-2 bg-slate-800 rounded-full overflow-hidden">
                <div
                  className="h-full bg-violet-600 rounded-full transition-all duration-300"
                  style={{ width: `${progress}%` }}
                />
              </div>
            )}
          </div>
        )}

        {/* ── STEP 5: Done ── */}
        {step === 'done' && result && (
          <div className="space-y-4">
            <div className={`rounded-2xl p-6 text-center
              ${result.inserted > 0
                ? 'bg-emerald-500/10 border border-emerald-500/20'
                : 'bg-rose-500/10 border border-rose-500/20'}`}>
              <div className="text-4xl mb-2">{result.inserted > 0 ? '🎉' : '⚠️'}</div>
              <p className="text-white font-bold text-xl">
                {result.inserted} transaction{result.inserted !== 1 ? 's' : ''} imported
              </p>
              {result.duplicates > 0 && (
                <p className="text-amber-400 text-sm mt-1">{result.duplicates} duplicate{result.duplicates !== 1 ? 's' : ''} skipped</p>
              )}
              {result.errors.length > 0 && (
                <p className="text-rose-400 text-sm mt-1">{result.errors.length} row{result.errors.length !== 1 ? 's' : ''} failed</p>
              )}
              {result.newAccounts.length > 0 && (
                <p className="text-sky-400 text-sm mt-2">
                  {result.newAccounts.length} new account{result.newAccounts.length !== 1 ? 's' : ''} auto-created: {result.newAccounts.join(', ')}
                </p>
              )}
            </div>

            {result.errors.length > 0 && (
              <div className="bg-slate-800 rounded-xl p-4">
                <p className="text-sm font-semibold text-white mb-2">Failed rows:</p>
                <div className="space-y-1 max-h-40 overflow-y-auto">
                  {result.errors.map((e, i) => (
                    <p key={i} className="text-xs text-rose-400">Row {e.row}: {e.message}</p>
                  ))}
                </div>
              </div>
            )}

            <div className="flex gap-3">
              <button
                onClick={() => {
                  setStep('upload');
                  setRawRows([]); setHeaders([]); setMapped([]); setResult(null); setDupKeys(new Set());
                }}
                className="flex-1 py-3.5 border border-slate-600 hover:border-slate-500 text-slate-300 rounded-xl font-semibold transition-colors text-sm"
              >
                Import another file
              </button>
              <button
                onClick={() => router.push('/money')}
                className="flex-1 py-3.5 bg-violet-600 hover:bg-violet-500 text-white rounded-xl font-semibold transition-colors text-sm"
              >
                View Transactions →
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
