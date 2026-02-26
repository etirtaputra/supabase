import { createClient } from '@supabase/supabase-js';
import type { Transaction, TransactionFormData, NoteSuggestion, UserAccount, AccountCategory } from '@/types/money';

export function getSupabaseClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  );
}

// ── Auth helpers ─────────────────────────────────────────────

export async function signInWithEmail(email: string, password: string) {
  const supabase = getSupabaseClient();
  return supabase.auth.signInWithPassword({ email, password });
}

export async function signUpWithEmail(email: string, password: string) {
  const supabase = getSupabaseClient();
  return supabase.auth.signUp({ email, password });
}

export async function signOut() {
  const supabase = getSupabaseClient();
  return supabase.auth.signOut();
}

export async function getUser() {
  const supabase = getSupabaseClient();
  const { data: { user } } = await supabase.auth.getUser();
  return user;
}

// ── Transaction CRUD ─────────────────────────────────────────

/** Fetch all transactions for the logged-in user (no month filter; filtering done client-side). */
export async function fetchTransactions(): Promise<Transaction[]> {
  const supabase = getSupabaseClient();
  const { data, error } = await supabase
    .from('transactions')
    .select('*')
    .order('date', { ascending: false })
    .order('time', { ascending: false });

  if (error) throw error;
  return (data ?? []) as Transaction[];
}

/** Fetch transactions for a specific month (YYYY-MM). */
export async function fetchTransactionsByMonth(yearMonth: string): Promise<Transaction[]> {
  const supabase = getSupabaseClient();
  const start = `${yearMonth}-01`;
  // last day of month
  const [y, m] = yearMonth.split('-').map(Number);
  const end = new Date(y, m, 0).toISOString().split('T')[0];

  const { data, error } = await supabase
    .from('transactions')
    .select('*')
    .gte('date', start)
    .lte('date', end)
    .order('date', { ascending: false })
    .order('time', { ascending: false });

  if (error) throw error;
  return (data ?? []) as Transaction[];
}

/** Insert a new transaction. */
export async function addTransaction(form: TransactionFormData): Promise<Transaction> {
  const supabase = getSupabaseClient();
  const user = await getUser();
  if (!user) throw new Error('Not authenticated');

  const { data, error } = await supabase
    .from('transactions')
    .insert({ ...form, user_id: user.id })
    .select()
    .single();

  if (error) throw error;
  return data as Transaction;
}

/** Update an existing transaction. */
export async function updateTransaction(id: string, form: TransactionFormData): Promise<Transaction> {
  const supabase = getSupabaseClient();
  const { data, error } = await supabase
    .from('transactions')
    .update(form)
    .eq('id', id)
    .select()
    .single();

  if (error) throw error;
  return data as Transaction;
}

/** Delete a transaction by id. */
export async function deleteTransaction(id: string): Promise<void> {
  const supabase = getSupabaseClient();
  const { error } = await supabase.from('transactions').delete().eq('id', id);
  if (error) throw error;
}

/** Toggle the bookmarked flag. */
export async function toggleBookmark(id: string, current: boolean): Promise<void> {
  const supabase = getSupabaseClient();
  const { error } = await supabase
    .from('transactions')
    .update({ bookmarked: !current })
    .eq('id', id);
  if (error) throw error;
}

/** Duplicate a transaction, optionally replacing date/time with today. */
export async function duplicateTransaction(
  transaction: Transaction,
  useTodayDate: boolean
): Promise<Transaction> {
  const now = new Date();
  const form: TransactionFormData = {
    date: useTodayDate ? now.toISOString().split('T')[0] : transaction.date,
    time: useTodayDate
      ? now.toTimeString().split(' ')[0]
      : transaction.time,
    account:     transaction.account,
    category:    transaction.category,
    subcategory: transaction.subcategory,
    note:        transaction.note,
    description: transaction.description,
    amount:      transaction.amount,
    type:        transaction.type,
  };
  return addTransaction(form);
}

export interface BulkRow {
  date: string;        // 'YYYY-MM-DD'
  time: string;        // 'HH:MM:SS'
  account: string;
  category: string;
  subcategory: string;
  note: string;
  description: string;
  amount: number;
  type: 'Inc' | 'Exp' | 'Trf' | 'TrfIn' | 'TrfOut' | 'IncBal' | 'ExpBal';
  // Extended fields (Phase 4)
  transfer_id?:     string | null;
  currency?:        string;        // ISO 3-char, default 'IDR'
  original_amount?: number | null;
  raw_accounts1?:   number | null;
}

export interface BulkInsertResult {
  inserted: number;
  errors: { row: number; message: string }[];
}

/**
 * Fetch a Set of existing transaction deduplication keys.
 * Key format: "date|time|account|amount|type"
 * Used by ImportPage to skip rows that are already in the DB.
 */
export async function fetchExistingTransactionKeys(): Promise<Set<string>> {
  const supabase = getSupabaseClient();
  const { data, error } = await supabase
    .from('transactions')
    .select('date, time, account, amount, type');
  if (error) return new Set();
  const keys = new Set<string>();
  for (const row of data ?? []) {
    keys.add(`${row.date}|${row.time}|${row.account}|${row.amount}|${row.type}`);
  }
  return keys;
}

/**
 * Batch-insert rows from an import file.
 * Splits into chunks of 500 to stay within Supabase limits.
 */
export async function bulkInsertTransactions(
  rows: BulkRow[],
  onProgress?: (done: number, total: number) => void
): Promise<BulkInsertResult> {
  const supabase = getSupabaseClient();
  const user = await getUser();
  if (!user) throw new Error('Not authenticated');

  const CHUNK = 500;
  let inserted = 0;
  const errors: { row: number; message: string }[] = [];

  for (let i = 0; i < rows.length; i += CHUNK) {
    const chunk = rows.slice(i, i + CHUNK).map((r, idx) => ({
      ...r,
      user_id: user.id,
      bookmarked: false,
      // row index for error reporting
      _idx: i + idx,
    }));

    // strip _idx before insert
    const payload = chunk.map(({ _idx: _i, ...rest }) => rest);

    const { error, data: insertedRows } = await supabase
      .from('transactions')
      .insert(payload)
      .select('id');

    if (error) {
      // Record the whole chunk as errored
      chunk.forEach(({ _idx }) =>
        errors.push({ row: _idx + 2, message: error.message })
      );
    } else {
      inserted += insertedRows?.length ?? chunk.length;
    }

    onProgress?.(Math.min(i + CHUNK, rows.length), rows.length);

  }

  return { inserted, errors };
}

/** Autocomplete: find distinct notes matching a prefix, plus their most-recent metadata. */
export async function fetchNoteSuggestions(prefix: string): Promise<NoteSuggestion[]> {
  if (!prefix.trim()) return [];
  const supabase = getSupabaseClient();

  const { data, error } = await supabase
    .from('transactions')
    .select('note, account, category, subcategory')
    .ilike('note', `${prefix}%`)
    .order('created_at', { ascending: false })
    .limit(50);

  if (error) return [];

  // deduplicate by note (keep first / most-recent occurrence)
  const seen = new Set<string>();
  const suggestions: NoteSuggestion[] = [];
  for (const row of data ?? []) {
    if (!seen.has(row.note) && row.note) {
      seen.add(row.note);
      suggestions.push(row as NoteSuggestion);
    }
    if (suggestions.length >= 8) break;
  }
  return suggestions;
}

// ── User Account CRUD ─────────────────────────────────────────

export async function fetchUserAccounts(): Promise<UserAccount[]> {
  const supabase = getSupabaseClient();
  const { data, error } = await supabase
    .from('user_accounts')
    .select('*')
    .order('created_at', { ascending: true });
  if (error) throw error;
  return (data ?? []) as UserAccount[];
}

/** Add a top-level account group (parent_id = null). */
export async function addUserAccount(name: string, category: AccountCategory): Promise<UserAccount> {
  const supabase = getSupabaseClient();
  const user = await getUser();
  if (!user) throw new Error('Not authenticated');
  const { data, error } = await supabase
    .from('user_accounts')
    .insert({ name, category, parent_id: null, user_id: user.id })
    .select()
    .single();
  if (error) throw error;
  return data as UserAccount;
}

/** Add a subaccount under a parent account group. */
export async function addSubAccount(name: string, parentId: string): Promise<UserAccount> {
  const supabase = getSupabaseClient();
  const user = await getUser();
  if (!user) throw new Error('Not authenticated');
  const { data, error } = await supabase
    .from('user_accounts')
    .insert({ name, parent_id: parentId, category: 'debit', user_id: user.id })
    .select()
    .single();
  if (error) throw error;
  return data as UserAccount;
}

export async function updateUserAccount(id: string, name: string, category: AccountCategory): Promise<UserAccount> {
  const supabase = getSupabaseClient();
  const { data, error } = await supabase
    .from('user_accounts')
    .update({ name, category })
    .eq('id', id)
    .select()
    .single();
  if (error) throw error;
  return data as UserAccount;
}

export async function deleteUserAccount(id: string): Promise<void> {
  const supabase = getSupabaseClient();
  const { error } = await supabase.from('user_accounts').delete().eq('id', id);
  if (error) throw error;
}

/** Delete ALL transactions and user accounts for the logged-in user. */
export async function resetAllData(): Promise<void> {
  const supabase = getSupabaseClient();
  const user = await getUser();
  if (!user) throw new Error('Not authenticated');

  const { error: txnError } = await supabase
    .from('transactions')
    .delete()
    .eq('user_id', user.id);
  if (txnError) throw txnError;

  const { error: accError } = await supabase
    .from('user_accounts')
    .delete()
    .eq('user_id', user.id);
  if (accError) throw accError;
}
