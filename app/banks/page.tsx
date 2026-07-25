/**
 * ICAPROC — Banks (41.x): where the two flows meet in cash.
 *
 * Each account belongs to one of the group companies and carries its own
 * statement, ASSEMBLED from the documents that already exist — customer
 * receipts in, PO payments out, plus the manual entries (transfers, charges)
 * and the corrections an owner writes when setting a balance. Nothing is
 * duplicated into a second ledger, so fixing a payment fixes the bank position.
 *
 * The statement is filterable by any date range (week / month / quarter / year,
 * a month or year picker, or a free from–to), searchable, and shows a running
 * balance that starts from the balance carried INTO the range — so a filtered
 * view still reconciles.
 *
 * Accounts are created and edited in Settings › Banks (owner-only); balances
 * are corrected here, also owner-only.
 */
'use client';
import { useState, useEffect, useMemo, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { createSupabaseClient } from '@/lib/supabase';
import { useAuth } from '@/hooks/useAuth';
import { ROLE_PERMISSIONS } from '@/constants/roles';
import BrandMenu from '@/components/ui/BrandMenu';
import DateRangeFilter from '@/components/ui/DateRangeFilter';
import LayoutToggle from '@/components/ui/LayoutToggle';
import { useListLayout } from '@/hooks/useListLayout';
import { ALL_TIME, inRange, isOpenRange, type DateRange } from '@/lib/dateRange';
import { accountLabel, fetchStatement, signedAmount, type BankAccount, type StatementRow } from '@/lib/banks';
import { fmtDay, fmtInt, fmtRupiah, fmtRupiahShort } from '@/lib/formatters';

interface Company { company_id: string; legal_name: string }

const KIND_TONE: Record<StatementRow['kind'], string> = {
  receipt:    'bg-emerald-500/15 text-emerald-300',
  payment:    'bg-sky-500/15 text-sky-300',
  manual:     'bg-slate-700/60 text-slate-300',
  adjustment: 'bg-amber-500/15 text-amber-300',
};
const KIND_LABEL: Record<StatementRow['kind'], string> = {
  receipt: 'receipt', payment: 'payment', manual: 'manual', adjustment: 'correction',
};

const num = (v: string): number => {
  const n = Number(String(v).replace(/[, ]/g, ''));
  return isNaN(n) ? 0 : n;
};

export default function BanksPage() {
  const supabase = createSupabaseClient();
  const router = useRouter();
  const { user, profile, loading: authLoading } = useAuth();
  const canView = !!profile && ROLE_PERMISSIONS[profile.role].canViewBanks;
  const canEdit = !!profile && ROLE_PERMISSIONS[profile.role].canEditBanks;

  const [accounts, setAccounts] = useState<BankAccount[]>([]);
  const [companies, setCompanies] = useState<Company[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [rows, setRows] = useState<StatementRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [rowsLoading, setRowsLoading] = useState(false);
  const [schemaMissing, setSchemaMissing] = useState(false);
  const [range, setRange] = useState<DateRange>(ALL_TIME);
  const [search, setSearch] = useState('');
  const [layout, setLayout] = useListLayout('banks');
  const compact = layout === 'compact';
  const [entryOpen, setEntryOpen] = useState(false);
  const [balanceOpen, setBalanceOpen] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const flash = (m: string) => { setToast(m); setTimeout(() => setToast(null), 3000); };

  useEffect(() => { document.title = 'Banks — ICAPROC'; }, []);
  useEffect(() => {
    if (authLoading) return;
    if (!user) { router.replace(`/login?next=${encodeURIComponent('/banks')}`); return; }
    if (profile && !ROLE_PERMISSIONS[profile.role].canViewBanks) router.replace('/unauthorized');
  }, [authLoading, user, profile, router]);

  const loadAccounts = useCallback(async () => {
    setLoading(true);
    const [accRes, coRes] = await Promise.all([
      supabase.from('41.0_bank_accounts').select('*').order('sort_order'),
      supabase.from('1.0_companies').select('company_id, legal_name'),
    ]);
    if (accRes.error) { setSchemaMissing(true); setLoading(false); return; }
    const list = ((accRes.data as BankAccount[]) ?? []).filter((a) => a.is_active !== false);
    setAccounts(list);
    setCompanies((coRes.data as Company[]) ?? []);
    setSelected((prev) => prev ?? list[0]?.bank_account_id ?? null);
    setLoading(false);
  }, []);   // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (canView) loadAccounts(); }, [canView, loadAccounts]);

  const account = accounts.find((a) => a.bank_account_id === selected) ?? null;

  const loadStatement = useCallback(async (acc: BankAccount) => {
    setRowsLoading(true);
    setRows(await fetchStatement(supabase, acc));
    setRowsLoading(false);
  }, []);   // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (account) loadStatement(account); }, [account?.bank_account_id, loadStatement]);   // eslint-disable-line react-hooks/exhaustive-deps

  const companyName = useMemo(() => new Map(companies.map((c) => [c.company_id, c.legal_name])), [companies]);

  // ── The filtered statement, with a running balance that carries in ─────────
  const view = useMemo(() => {
    const q = search.trim().toLowerCase();
    const opening = Number(account?.opening_balance) || 0;
    // Everything before the range opens is the balance brought forward
    const before = rows.filter((r) => range.from && r.date && r.date < range.from);
    const broughtForward = opening + before.reduce((s, r) => s + signedAmount(r), 0);

    const inWindow = rows.filter((r) => inRange(r.date, range));
    const matched = q
      ? inWindow.filter((r) => `${r.description} ${r.reference} ${r.who ?? ''} ${KIND_LABEL[r.kind]}`.toLowerCase().includes(q))
      : inWindow;

    // Running balance follows the ACCOUNT, so it is computed on the whole
    // window (not the search subset) and then read off for the rows shown.
    const asc = [...inWindow].sort((a, b) => (a.date || '').localeCompare(b.date || ''));
    const runningById = new Map<string, number>();
    let run = broughtForward;
    for (const r of asc) { run += signedAmount(r); runningById.set(r.id, run); }

    const totalIn  = inWindow.filter((r) => r.direction === 'in').reduce((s, r) => s + r.amount, 0);
    const totalOut = inWindow.filter((r) => r.direction === 'out').reduce((s, r) => s + r.amount, 0);
    // Closing = every movement up to the end of the range (open end = all)
    const upToEnd = rows.filter((r) => !range.to || (r.date && r.date <= range.to));
    const closing = opening + upToEnd.reduce((s, r) => s + signedAmount(r), 0);

    return {
      rows: matched.sort((a, b) => (b.date || '').localeCompare(a.date || '')),
      runningById, broughtForward, totalIn, totalOut, closing,
      hiddenBySearch: inWindow.length - matched.length,
    };
  }, [rows, range, search, account]);

  // Balance of every account today (for the cards)
  const [balances, setBalances] = useState<Map<string, number>>(new Map());
  useEffect(() => {
    if (!accounts.length) return;
    let cancelled = false;
    (async () => {
      const entries = await Promise.all(accounts.map(async (a) => {
        const st = await fetchStatement(supabase, a);
        return [a.bank_account_id, (Number(a.opening_balance) || 0) + st.reduce((s, r) => s + signedAmount(r), 0)] as const;
      }));
      if (!cancelled) setBalances(new Map(entries));
    })();
    return () => { cancelled = true; };
  }, [accounts]);   // eslint-disable-line react-hooks/exhaustive-deps

  const totalCash = useMemo(
    () => accounts.reduce((s, a) => s + (balances.get(a.bank_account_id) ?? 0), 0),
    [accounts, balances],
  );

  if (authLoading || !user || (profile && !canView)) {
    return (
      <div className="min-h-screen bg-[#0f1012] flex items-center justify-center">
        <div className="w-6 h-6 border-2 border-emerald-500/30 border-t-emerald-500 rounded-full animate-spin" />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#0f1012] text-slate-200 font-sans text-sm">
      <div className="border-b border-slate-800/60 bg-[#0f1012]/80 backdrop-blur-md sticky top-0 z-30">
        <div className="max-w-[1600px] 2xl:max-w-[2120px] mx-auto px-3 sm:px-4 md:px-6 py-3 sm:py-4 flex flex-col sm:flex-row sm:items-center justify-between gap-2.5 sm:gap-4">
          <BrandMenu wordmarkClass="text-xl md:text-2xl font-extrabold" subtitle="Banks · Accounts & cash position" />
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-[11px] text-slate-500 whitespace-nowrap">
              Cash across {accounts.length} account{accounts.length !== 1 ? 's' : ''}
              <span className="ml-1.5 text-slate-200 font-bold tabular-nums">{fmtRupiah(totalCash)}</span>
            </span>
            {canEdit && (
              <Link href="/settings?tab=banks"
                className="text-xs text-slate-400 hover:text-white px-3 py-1.5 border border-slate-700 rounded-lg hover:bg-slate-800 transition-colors whitespace-nowrap"
                title="Accounts are created and edited in Settings">
                Manage accounts: Settings →
              </Link>
            )}
          </div>
        </div>
      </div>

      <main className="max-w-[1600px] 2xl:max-w-[2120px] mx-auto px-3 sm:px-4 md:px-6 py-6 space-y-5">
        {schemaMissing ? (
          <div className="bg-amber-500/10 border border-amber-500/40 rounded-xl p-4 text-xs text-amber-200">
            Bank tables are not set up yet — run <span className="font-mono">migrations/create_bank_accounts.sql</span> in Supabase → SQL Editor.
          </div>
        ) : loading ? (
          <div className="space-y-2">{[...Array(3)].map((_, i) => <div key={i} className="h-24 bg-slate-800/40 rounded-2xl animate-pulse" />)}</div>
        ) : accounts.length === 0 ? (
          <div className="bg-slate-900/50 border border-slate-800 rounded-2xl p-8 text-center space-y-2">
            <p className="text-slate-300 font-semibold">No active bank accounts yet</p>
            <p className="text-xs text-slate-500">
              {canEdit ? 'Add one in Settings › Banks — company, bank, account number and opening balance.' : 'An owner needs to set one up in Settings.'}
            </p>
            {canEdit && <Link href="/settings?tab=banks" className="inline-block text-xs font-semibold text-emerald-300 hover:text-emerald-200">Open Settings →</Link>}
          </div>
        ) : (
          <>
            {/* Accounts — one line each by default; the card view gives each
                account its own tile. Selecting one loads its statement below. */}
            <div className="flex items-center justify-between gap-3">
              <p className="text-[10px] uppercase tracking-widest text-slate-600">Accounts</p>
              <LayoutToggle value={layout} onChange={setLayout} />
            </div>
            {compact ? (
              <div className="bg-slate-900/40 border border-slate-800/80 rounded-2xl overflow-hidden">
                <div className="hidden md:grid grid-cols-[1fr_200px_120px_60px_140px] gap-3 px-3 py-1.5 border-b border-slate-800 text-[10px] font-semibold uppercase tracking-widest text-slate-500">
                  <span>Bank</span><span>Company</span><span>Account no.</span><span>Ccy</span><span className="text-right">Balance</span>
                </div>
                <div className="divide-y divide-slate-800/60">
                  {accounts.map((a) => {
                    const on = a.bank_account_id === selected;
                    const bal = balances.get(a.bank_account_id);
                    return (
                      <button key={a.bank_account_id} onClick={() => setSelected(a.bank_account_id)}
                        className={`w-full text-left grid grid-cols-2 md:grid-cols-[1fr_200px_120px_60px_140px] gap-1 md:gap-3 px-3 py-1.5 items-center transition-colors ${
                          on ? 'bg-emerald-500/[0.08]' : 'hover:bg-slate-800/40'
                        }`}>
                        <span className={`text-sm truncate ${on ? 'text-emerald-200 font-semibold' : 'text-slate-100'}`}>
                          {a.bank_name || 'Bank not set'}
                          {a.is_default_payment && <span className="ml-1.5 text-[9px] font-bold text-sky-400" title="Default account for supplier payments">PAY</span>}
                          {a.is_default_receipt && <span className="ml-1.5 text-[9px] font-bold text-emerald-400" title="Default account for customer receipts">RCV</span>}
                        </span>
                        <span className="text-[11px] text-slate-500 truncate">{companyName.get(a.company_id ?? '') || '—'}</span>
                        <span className="text-[11px] text-slate-500 font-mono truncate">{a.account_number || '—'}</span>
                        <span className="text-[10px] text-slate-600">{a.currency}</span>
                        <span className={`md:text-right tabular-nums font-semibold ${bal == null ? 'text-slate-600' : bal < 0 ? 'text-rose-300' : 'text-emerald-300'}`}
                          title={bal == null ? '' : fmtRupiah(bal)}>
                          {bal == null ? '—' : fmtInt(bal)}
                        </span>
                      </button>
                    );
                  })}
                </div>
              </div>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
                {accounts.map((a) => {
                  const on = a.bank_account_id === selected;
                  const bal = balances.get(a.bank_account_id);
                  return (
                    <button key={a.bank_account_id} onClick={() => setSelected(a.bank_account_id)}
                      className={`text-left bg-slate-900/40 border rounded-2xl p-4 transition-colors ${
                        on ? 'border-emerald-500/50 bg-emerald-500/[0.06]' : 'border-slate-800/80 hover:border-slate-700'
                      }`}>
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0">
                          <p className="text-sm font-bold text-white truncate">{a.bank_name || 'Bank not set'}</p>
                          <p className="text-[11px] text-slate-500 truncate">{companyName.get(a.company_id ?? '') || a.account_name || '—'}</p>
                        </div>
                        <span className="text-[10px] px-1.5 py-0.5 rounded bg-slate-800 text-slate-400 flex-shrink-0">{a.currency}</span>
                      </div>
                      <p className="text-[11px] text-slate-600 font-mono mt-1.5 truncate">{a.account_number || 'no account number'}</p>
                      <p className={`text-xl font-bold tabular-nums mt-2 ${bal == null ? 'text-slate-600' : bal < 0 ? 'text-rose-300' : 'text-emerald-300'}`}
                        title={bal == null ? '' : fmtRupiah(bal)}>
                        {bal == null ? '—' : fmtRupiahShort(bal)}
                      </p>
                    </button>
                  );
                })}
              </div>
            )}

            {/* Statement */}
            {account && (
              <div className="bg-slate-900/40 border border-slate-800/80 rounded-2xl overflow-hidden">
                <div className="px-4 py-3 border-b border-slate-800/80 flex flex-col lg:flex-row lg:items-center justify-between gap-2.5">
                  <div className="min-w-0">
                    <p className="text-sm font-bold text-white truncate">
                      {account.bank_name || 'Bank not set'}
                      <span className="text-slate-500 font-normal"> · {account.account_number || 'no account number'}</span>
                    </p>
                    <p className="text-[11px] text-slate-500">
                      {companyName.get(account.company_id ?? '') || '—'}
                      {account.opening_date ? ` · opened ${fmtDay(account.opening_date)}` : ''}
                    </p>
                  </div>
                  <div className="flex items-center gap-2 flex-wrap">
                    <div className="relative w-full sm:w-56">
                      <input value={search} onChange={(e) => setSearch(e.target.value)}
                        placeholder="Search description, reference…"
                        className="w-full pl-3 pr-3 h-9 sm:h-8 rounded-lg bg-slate-900/80 border border-slate-700/80 focus:border-emerald-500/60 outline-none text-white text-base sm:text-xs placeholder:text-slate-500 transition-colors" />
                    </div>
                    <DateRangeFilter value={range} onChange={setRange} label="Statement dates" />
                    {canEdit && (
                      <>
                        <button onClick={() => setEntryOpen(true)}
                          className="text-xs font-semibold px-3 py-1.5 rounded-lg border border-slate-700 text-slate-300 hover:bg-slate-800 transition-colors whitespace-nowrap">
                          + Entry
                        </button>
                        <button onClick={() => setBalanceOpen(true)}
                          className="text-xs font-bold px-3 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white transition-colors whitespace-nowrap">
                          Set balance
                        </button>
                      </>
                    )}
                  </div>
                </div>

                {/* Summary for the range in force */}
                <div className="grid grid-cols-2 lg:grid-cols-4 divide-x divide-y lg:divide-y-0 divide-slate-800/60 border-b border-slate-800/60">
                  {[
                    { label: isOpenRange(range) ? 'Opening balance' : 'Brought forward', value: isOpenRange(range) ? Number(account.opening_balance) || 0 : view.broughtForward, cls: 'text-slate-300' },
                    { label: 'Money in',  value: view.totalIn,  cls: 'text-emerald-300' },
                    { label: 'Money out', value: view.totalOut, cls: 'text-sky-300' },
                    { label: 'Closing balance', value: view.closing, cls: view.closing < 0 ? 'text-rose-300' : 'text-white' },
                  ].map((k) => (
                    <div key={k.label} className="px-4 py-3">
                      <p className="text-[10px] uppercase tracking-widest text-slate-600">{k.label}</p>
                      <p className={`text-base font-bold tabular-nums mt-0.5 ${k.cls}`} title={fmtRupiah(k.value)}>{fmtRupiah(k.value)}</p>
                    </div>
                  ))}
                </div>

                {rowsLoading ? (
                  <div className="px-4 py-10 text-center text-slate-600 text-sm">Loading statement…</div>
                ) : view.rows.length === 0 ? (
                  <div className="px-4 py-10 text-center text-slate-600 text-sm">
                    {rows.length === 0
                      ? 'No movements yet — payments and receipts appear here once they are tagged with this account.'
                      : 'Nothing in this range.'}
                  </div>
                ) : (
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead className="text-[10px] uppercase tracking-widest text-slate-500 border-b border-slate-800/80">
                        <tr>
                          <th className="text-left px-4 py-2 font-semibold">Date</th>
                          <th className="text-left px-3 py-2 font-semibold">Description</th>
                          <th className="text-left px-3 py-2 font-semibold">Reference</th>
                          <th className="text-right px-3 py-2 font-semibold">In</th>
                          <th className="text-right px-3 py-2 font-semibold">Out</th>
                          <th className="text-right px-4 py-2 font-semibold">Balance</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-800/60">
                        {view.rows.map((r) => (
                          <tr key={r.id} className="hover:bg-white/[0.02]">
                            <td className={`px-4 whitespace-nowrap text-slate-400 tabular-nums ${compact ? 'py-1' : 'py-2'}`}>{fmtDay(r.date) || '—'}</td>
                            <td className={`px-3 ${compact ? 'py-1' : 'py-2'}`}>
                              <div className="flex items-center gap-2 min-w-0">
                                <span className={`text-[9px] px-1.5 py-0.5 rounded font-semibold flex-shrink-0 ${KIND_TONE[r.kind]}`}>{KIND_LABEL[r.kind]}</span>
                                {r.href
                                  ? <Link href={r.href} className="text-slate-200 hover:text-emerald-300 truncate transition-colors">{r.description}</Link>
                                  : <span className="text-slate-200 truncate">{r.description}</span>}
                              </div>
                            </td>
                            <td className={`px-3 text-[11px] text-slate-500 max-w-[220px] truncate ${compact ? 'py-1' : 'py-2'}`} title={r.reference}>
                              {r.reference || '—'}
                              {r.original && (
                                <span className="ml-1.5 text-slate-600">({r.original.currency} {fmtInt(r.original.amount)})</span>
                              )}
                            </td>
                            <td className={`px-3 text-right tabular-nums text-emerald-300 ${compact ? 'py-1' : 'py-2'}`}>{r.direction === 'in' ? fmtInt(r.amount) : ''}</td>
                            <td className={`px-3 text-right tabular-nums text-sky-300 ${compact ? 'py-1' : 'py-2'}`}>{r.direction === 'out' ? fmtInt(r.amount) : ''}</td>
                            <td className={`px-4 text-right tabular-nums text-slate-300 ${compact ? 'py-1' : 'py-2'}`}>{fmtInt(view.runningById.get(r.id) ?? 0)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                    {view.hiddenBySearch > 0 && (
                      <p className="px-4 py-2 text-[11px] text-slate-600 border-t border-slate-800/60">
                        {view.hiddenBySearch} more row{view.hiddenBySearch !== 1 ? 's' : ''} in this range hidden by the search — the balance column still counts them.
                      </p>
                    )}
                  </div>
                )}
              </div>
            )}
          </>
        )}
      </main>

      {canEdit && !schemaMissing && accounts.length > 0 && (
        <div className="max-w-[1600px] 2xl:max-w-[2120px] mx-auto px-3 sm:px-4 md:px-6 pb-8">
          <UntaggedPanel accounts={accounts}
            onAssigned={() => { if (account) loadStatement(account); loadAccounts(); flash('Movement assigned'); }} />
        </div>
      )}

      {entryOpen && account && (
        <EntryModal account={account} onClose={() => setEntryOpen(false)}
          onSaved={() => { setEntryOpen(false); loadStatement(account); loadAccounts(); flash('Entry recorded'); }} />
      )}
      {balanceOpen && account && (
        <SetBalanceModal account={account} current={view.closing} onClose={() => setBalanceOpen(false)}
          onSaved={() => { setBalanceOpen(false); loadStatement(account); loadAccounts(); flash('Balance corrected'); }} />
      )}

      {toast && <div className="fixed bottom-6 right-6 z-[140] px-4 py-2.5 bg-slate-800 border border-slate-700 text-white text-sm font-semibold rounded-xl shadow-lg">{toast}</div>}
    </div>
  );
}


// ── Untagged movements ──────────────────────────────────────────────────────
// Payments and receipts recorded before accounts existed (or entered without
// picking one) carry no account, so they are missing from every statement.
// This is where they get attached — the alternative is a bank page that stays
// empty on day one while the money is plainly in the system.

interface Untagged {
  id: string; table: 'receipt' | 'cost'; pk: string;
  date: string; amount: number; currency: string; label: string;
}

function UntaggedPanel({ accounts, onAssigned }: { accounts: BankAccount[]; onAssigned: () => void }) {
  const supabase = createSupabaseClient();
  const [rows, setRows] = useState<Untagged[]>([]);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    const [rcpRes, costRes] = await Promise.all([
      supabase.from('26.0_customer_receipts')
        .select('receipt_id, quote_id, receipt_number, amount, payment_date, bank_ref')
        .is('bank_account_id', null).order('payment_date', { ascending: false }).limit(60),
      supabase.from('6.0_po_costs')
        .select('cost_id, po_id, cost_category, amount, currency, payment_date, notes')
        .is('bank_account_id', null).not('payment_date', 'is', null)
        .order('payment_date', { ascending: false }).limit(60),
    ]);

    const out: Untagged[] = [];
    const receipts = (rcpRes.data ?? []) as { receipt_id: string; quote_id: string; receipt_number: string; amount: number; payment_date: string; bank_ref: string }[];
    const quoteIds = [...new Set(receipts.map((r) => r.quote_id).filter(Boolean))];
    const numberOf = new Map<string, string>();
    if (quoteIds.length) {
      const { data } = await supabase.from('22.0_sales_quotes').select('quote_id, quote_number, order_number').in('quote_id', quoteIds);
      for (const q of (data ?? []) as { quote_id: string; quote_number: string; order_number: string | null }[]) {
        numberOf.set(q.quote_id, q.order_number || q.quote_number);
      }
    }
    for (const r of receipts) {
      out.push({
        id: `rcpt-${r.receipt_id}`, table: 'receipt', pk: r.receipt_id,
        date: (r.payment_date ?? '').slice(0, 10), amount: Number(r.amount) || 0, currency: 'IDR',
        label: `Received · ${numberOf.get(r.quote_id) ?? r.receipt_number ?? ''}${r.bank_ref ? ` · ${r.bank_ref}` : ''}`,
      });
    }

    const costs = (costRes.data ?? []) as { cost_id: string; po_id: string; cost_category: string; amount: number; currency: string; payment_date: string; notes: string }[];
    const poIds = [...new Set(costs.map((c) => String(c.po_id)).filter(Boolean))];
    const poNumber = new Map<string, string>();
    if (poIds.length) {
      const { data } = await supabase.from('5.0_purchases').select('po_id, po_number').in('po_id', poIds);
      for (const p of (data ?? []) as { po_id: string; po_number: string }[]) poNumber.set(String(p.po_id), p.po_number);
    }
    for (const c of costs) {
      out.push({
        id: `cost-${c.cost_id}`, table: 'cost', pk: c.cost_id,
        date: (c.payment_date ?? '').slice(0, 10), amount: Number(c.amount) || 0, currency: c.currency || 'IDR',
        label: `Paid · ${poNumber.get(String(c.po_id)) ?? ''} · ${(c.cost_category ?? '').replace(/_/g, ' ')}`,
      });
    }

    setRows(out.sort((a, b) => (b.date || '').localeCompare(a.date || '')));
    setLoading(false);
  }, []);   // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { load(); }, [load]);

  const assign = async (row: Untagged, bankId: string) => {
    if (!bankId) return;
    setBusy(row.id);
    const table = row.table === 'receipt' ? '26.0_customer_receipts' : '6.0_po_costs';
    const key = row.table === 'receipt' ? 'receipt_id' : 'cost_id';
    const { error } = await supabase.from(table).update({ bank_account_id: bankId }).eq(key, row.pk);
    setBusy(null);
    if (error) return;
    setRows((prev) => prev.filter((r) => r.id !== row.id));
    onAssigned();
  };

  if (loading || rows.length === 0) return null;

  return (
    <div className="bg-slate-900/40 border border-amber-500/25 rounded-2xl overflow-hidden">
      <button onClick={() => setOpen((o) => !o)} className="w-full px-4 py-3 flex items-center justify-between gap-3 text-left hover:bg-white/[0.02] transition-colors">
        <div>
          <p className="text-sm font-bold text-amber-200">{rows.length} movement{rows.length !== 1 ? 's' : ''} not linked to an account</p>
          <p className="text-[11px] text-slate-500">Payments and receipts recorded without a bank account — assign them and they appear on that account&apos;s statement.</p>
        </div>
        <span className="text-slate-500 text-xs">{open ? 'Hide' : 'Show'}</span>
      </button>
      {open && (
        <div className="divide-y divide-slate-800/60 border-t border-slate-800/60 max-h-[420px] overflow-y-auto">
          {rows.map((r) => (
            <div key={r.id} className="px-4 py-2.5 flex flex-wrap items-center gap-x-3 gap-y-1.5">
              <span className="text-[11px] text-slate-500 tabular-nums w-20 flex-shrink-0">{fmtDay(r.date) || '—'}</span>
              <span className="text-sm text-slate-200 truncate flex-1 min-w-[140px]">{r.label}</span>
              <span className="text-xs tabular-nums text-slate-300 flex-shrink-0">{r.currency} {fmtInt(r.amount)}</span>
              <select defaultValue="" disabled={busy === r.id}
                onChange={(e) => assign(r, e.target.value)}
                className="text-xs bg-slate-800 border border-slate-700 text-slate-300 rounded-lg px-2 py-1.5 focus:outline-none focus:ring-1 focus:ring-emerald-500/40 disabled:opacity-50 cursor-pointer flex-shrink-0 ml-auto">
                <option value="">Assign to…</option>
                {accounts.map((a) => <option key={a.bank_account_id} value={a.bank_account_id}>{accountLabel(a)}</option>)}
              </select>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ── Manual entry (transfer, bank charge, interest…) ─────────────────────────

function EntryModal({ account, onClose, onSaved }: { account: BankAccount; onClose: () => void; onSaved: () => void }) {
  const supabase = createSupabaseClient();
  const [direction, setDirection] = useState<'in' | 'out'>('out');
  const [amount, setAmount] = useState('');
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10));
  const [description, setDescription] = useState('');
  const [reference, setReference] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const save = async () => {
    const amt = num(amount);
    if (amt <= 0) { setErr('Enter an amount'); return; }
    setBusy(true); setErr(null);
    const { error } = await supabase.from('41.1_bank_transactions').insert({
      bank_account_id: account.bank_account_id,
      txn_date: date, direction, amount: amt,
      description: description.trim(), reference: reference.trim(), source: 'manual',
    });
    setBusy(false);
    if (error) { setErr(error.message); return; }
    onSaved();
  };

  return (
    <Modal title="Record a bank entry" subtitle="For movements that are not a PO payment or a customer receipt — transfers, bank charges, interest." onClose={onClose}>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <Labeled label="Direction">
          <select value={direction} onChange={(e) => setDirection(e.target.value as 'in' | 'out')} className={modalInput}>
            <option value="out">Money out</option>
            <option value="in">Money in</option>
          </select>
        </Labeled>
        <Labeled label="Date">
          <input type="date" value={date} onChange={(e) => setDate(e.target.value)} className={modalInput} />
        </Labeled>
      </div>
      <Labeled label={`Amount (${account.currency})`}>
        <input value={amount} onChange={(e) => setAmount(e.target.value)} inputMode="decimal" placeholder="0" className={`${modalInput} text-right tabular-nums`} />
      </Labeled>
      <Labeled label="Description">
        <input value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Transfer to G63 petty cash" className={modalInput} />
      </Labeled>
      <Labeled label="Reference">
        <input value={reference} onChange={(e) => setReference(e.target.value)} placeholder="Optional" className={modalInput} />
      </Labeled>
      {err && <p className="text-xs text-rose-400">{err}</p>}
      <div className="flex justify-end gap-2 pt-1">
        <button onClick={onClose} className="text-xs text-slate-400 hover:text-white px-3 py-2">Cancel</button>
        <button onClick={save} disabled={busy}
          className="text-xs font-bold px-4 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-500 disabled:bg-slate-800 disabled:text-slate-600 text-white transition-colors">
          {busy ? 'Saving…' : 'Record entry'}
        </button>
      </div>
    </Modal>
  );
}

// ── Set the balance (writes the correction, never rewrites history) ─────────

function SetBalanceModal({ account, current, onClose, onSaved }: {
  account: BankAccount; current: number; onClose: () => void; onSaved: () => void;
}) {
  const supabase = createSupabaseClient();
  const [target, setTarget] = useState(String(Math.round(current)));
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10));
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const delta = num(target) - current;

  const save = async () => {
    if (Math.abs(delta) < 0.005) { setErr('That is already the balance'); return; }
    setBusy(true); setErr(null);
    const { error } = await supabase.from('41.1_bank_transactions').insert({
      bank_account_id: account.bank_account_id,
      txn_date: date,
      direction: delta > 0 ? 'in' : 'out',
      amount: Math.abs(delta),
      description: note.trim() || 'Balance set to match the bank statement',
      source: 'adjustment',
    });
    setBusy(false);
    if (error) { setErr(error.message); return; }
    onSaved();
  };

  return (
    <Modal title="Set the balance" subtitle="Records the difference as a dated correction, so the statement still adds up and nothing is rewritten." onClose={onClose}>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <Labeled label="Balance now">
          <p className="text-sm font-bold text-slate-300 tabular-nums px-2.5 py-2">{fmtRupiah(current)}</p>
        </Labeled>
        <Labeled label="Should be">
          <input value={target} onChange={(e) => setTarget(e.target.value)} inputMode="decimal" className={`${modalInput} text-right tabular-nums`} />
        </Labeled>
      </div>
      <p className={`text-xs tabular-nums ${Math.abs(delta) < 0.005 ? 'text-slate-600' : delta > 0 ? 'text-emerald-300' : 'text-sky-300'}`}>
        {Math.abs(delta) < 0.005 ? 'No change' : `${delta > 0 ? 'Adds' : 'Removes'} ${fmtRupiah(Math.abs(delta))}`}
      </p>
      <Labeled label="Dated">
        <input type="date" value={date} onChange={(e) => setDate(e.target.value)} className={modalInput} />
      </Labeled>
      <Labeled label="Why">
        <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="Opening balance from the bank statement" className={modalInput} />
      </Labeled>
      {err && <p className="text-xs text-rose-400">{err}</p>}
      <div className="flex justify-end gap-2 pt-1">
        <button onClick={onClose} className="text-xs text-slate-400 hover:text-white px-3 py-2">Cancel</button>
        <button onClick={save} disabled={busy}
          className="text-xs font-bold px-4 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-500 disabled:bg-slate-800 disabled:text-slate-600 text-white transition-colors">
          {busy ? 'Saving…' : 'Correct balance'}
        </button>
      </div>
    </Modal>
  );
}

// ── Modal chrome (portaled — page headers use backdrop-blur, which WebKit
//    treats as a containing block for fixed descendants) ─────────────────────

const modalInput = 'w-full bg-slate-950 border border-slate-700 rounded-lg px-2.5 py-2 text-sm text-white focus:outline-none focus:border-emerald-500/60 transition-colors';

function Labeled({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="block text-[11px] font-semibold uppercase tracking-wider text-slate-500 mb-1">{label}</label>
      {children}
    </div>
  );
}

function Modal({ title, subtitle, onClose, children }: {
  title: string; subtitle?: string; onClose: () => void; children: React.ReactNode;
}) {
  const [mounted, setMounted] = useState(false);
  useEffect(() => { setMounted(true); }, []);
  if (!mounted) return null;
  return createPortal(
    <div className="fixed inset-0 z-[150] flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/60" onClick={onClose} />
      <div className="relative w-full max-w-md bg-slate-900 border border-slate-700 rounded-2xl shadow-2xl p-5 space-y-3.5 max-h-[90vh] overflow-y-auto">
        <div>
          <h2 className="text-base font-bold text-white">{title}</h2>
          {subtitle && <p className="text-[11px] text-slate-500 mt-1 leading-snug">{subtitle}</p>}
        </div>
        {children}
      </div>
    </div>,
    document.body,
  );
}
