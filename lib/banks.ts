/**
 * Bank accounts (41.x) — the cash side of the conversion cycle.
 *
 * An account's statement is ASSEMBLED from the documents that already exist,
 * never duplicated into a second ledger:
 *   • money in  — customer receipts (26.0) tagged with this account
 *   • money out — PO payments (6.0_po_costs) tagged with this account
 *   • either    — manual entries (41.1): transfers, bank charges, interest,
 *                 and the corrections an owner writes when setting a balance.
 * Balance = opening_balance + Σ in − Σ out, so correcting a document corrects
 * the bank position automatically.
 */
import type { SupabaseClient } from '@supabase/supabase-js';

export interface BankAccount {
  bank_account_id: string;
  company_id: string | null;
  bank_name: string;
  account_name: string;
  account_number: string;
  branch?: string | null;
  currency: string;
  opening_balance: number;
  opening_date: string | null;
  is_active: boolean;
  /** Preselected when a supplier payment is made by this account's company. */
  is_default_payment?: boolean;
  /** Preselected when a customer receipt is recorded for this company. */
  is_default_receipt?: boolean;
  sort_order: number;
  notes?: string | null;
  updated_at?: string | null;
  updated_by_email?: string | null;
}

export type StatementKind = 'receipt' | 'payment' | 'manual' | 'adjustment';

export interface StatementRow {
  id: string;
  date: string;                 // YYYY-MM-DD
  direction: 'in' | 'out';
  amount: number;               // in the ACCOUNT's currency (see convertToAccount)
  kind: StatementKind;
  description: string;
  reference: string;
  href?: string;                // the document this row came from
  who?: string;
  /** Set when a foreign-currency payment was converted at the PO's rate. */
  original?: { amount: number; currency: string };
}

export const accountLabel = (a: BankAccount): string =>
  [a.bank_name, a.account_number].filter(Boolean).join(' · ') || a.account_name || 'Unnamed account';

export async function fetchBankAccounts(supabase: SupabaseClient, includeInactive = false): Promise<BankAccount[]> {
  const { data, error } = await supabase.from('41.0_bank_accounts').select('*').order('sort_order');
  if (error || !data) return [];
  const list = data as BankAccount[];
  return includeInactive ? list : list.filter((a) => a.is_active !== false);
}

/** The bank-name library (41.2), lowest sort_order first. */
export async function fetchBankNames(supabase: SupabaseClient): Promise<string[]> {
  const { data, error } = await supabase.from('41.2_bank_names')
    .select('bank_name, is_active, sort_order').order('sort_order').order('bank_name');
  if (error || !data) return [];
  return (data as { bank_name: string; is_active: boolean }[])
    .filter((b) => b.is_active !== false)
    .map((b) => b.bank_name);
}

/**
 * Which account a payment or a receipt should preselect.
 * Each company banks separately, so the company on the document decides first;
 * failing that (or when the document carries no company) the first account
 * flagged for that use wins, then simply the first account.
 */
export function defaultAccountFor(
  accounts: BankAccount[],
  kind: 'payment' | 'receipt',
  companyId?: string | null,
): BankAccount | null {
  const flagged = (a: BankAccount) => (kind === 'payment' ? a.is_default_payment : a.is_default_receipt);
  const active = accounts.filter((a) => a.is_active !== false);
  if (companyId) {
    const own = active.filter((a) => a.company_id === companyId);
    return own.find(flagged) ?? own[0] ?? active.find(flagged) ?? null;
  }
  return active.find(flagged) ?? null;
}

/**
 * A payment row is stored in the currency it was paid in. When that differs
 * from the account's own currency we convert at the rate recorded on the
 * payment (the PO's exchange rate); with no rate we take the amount at face
 * value and flag the original so the screen can show it.
 */
function convertToAccount(amount: number, currency: string, rate: number | null, accountCcy: string) {
  if (!currency || currency === accountCcy) return { value: amount, original: undefined };
  const r = Number(rate) || 0;
  return { value: r > 0 ? amount * r : amount, original: { amount, currency } };
}

/**
 * Every movement through one account, newest first. Filtering by date is left
 * to the caller (the UI filters the same rows it charts and totals).
 */
export async function fetchStatement(supabase: SupabaseClient, account: BankAccount): Promise<StatementRow[]> {
  const id = account.bank_account_id;
  const [rcpRes, costRes, txnRes] = await Promise.all([
    supabase.from('26.0_customer_receipts')
      .select('receipt_id, quote_id, receipt_number, amount, payment_date, payment_method, bank_ref, notes, created_by_email')
      .eq('bank_account_id', id),
    supabase.from('6.0_po_costs')
      .select('cost_id, po_id, cost_category, amount, currency, exchange_rate, payment_date, notes')
      .eq('bank_account_id', id),
    supabase.from('41.1_bank_transactions')
      .select('txn_id, txn_date, direction, amount, description, reference, source, created_by_email')
      .eq('bank_account_id', id),
  ]);

  const rows: StatementRow[] = [];

  const receipts = (rcpRes.data ?? []) as {
    receipt_id: string; quote_id: string; receipt_number: string; amount: number;
    payment_date: string; payment_method: string; bank_ref: string; notes: string; created_by_email: string;
  }[];
  // One lookup for the order numbers behind the receipts
  const quoteIds = [...new Set(receipts.map((r) => r.quote_id).filter(Boolean))];
  const quoteById = new Map<string, { quote_number: string; order_number: string | null; customer_id: string | null }>();
  if (quoteIds.length) {
    const { data } = await supabase.from('22.0_sales_quotes')
      .select('quote_id, quote_number, order_number, customer_id').in('quote_id', quoteIds);
    for (const q of (data ?? []) as { quote_id: string; quote_number: string; order_number: string | null; customer_id: string | null }[]) {
      quoteById.set(q.quote_id, q);
    }
  }
  const customerIds = [...new Set([...quoteById.values()].map((q) => q.customer_id).filter(Boolean) as string[])];
  const customerName = new Map<string, string>();
  if (customerIds.length) {
    const { data } = await supabase.from('20.0_customers').select('customer_id, display_name, legal_name').in('customer_id', customerIds);
    for (const c of (data ?? []) as { customer_id: string; display_name: string; legal_name: string }[]) {
      customerName.set(c.customer_id, c.display_name || c.legal_name);
    }
  }
  for (const r of receipts) {
    const q = quoteById.get(r.quote_id);
    const cust = q?.customer_id ? customerName.get(q.customer_id) : '';
    rows.push({
      id: `rcpt-${r.receipt_id}`,
      date: (r.payment_date ?? '').slice(0, 10),
      direction: 'in',
      amount: Number(r.amount) || 0,
      kind: 'receipt',
      description: [cust, q?.order_number || q?.quote_number].filter(Boolean).join(' · ') || 'Customer payment',
      reference: r.bank_ref || r.receipt_number || '',
      href: q ? `/sales/${r.quote_id}` : undefined,
      who: r.created_by_email,
    });
  }

  const costs = (costRes.data ?? []) as {
    cost_id: string; po_id: string; cost_category: string; amount: number;
    currency: string; exchange_rate: number | null; payment_date: string; notes: string;
  }[];
  const poIds = [...new Set(costs.map((c) => String(c.po_id)).filter(Boolean))];
  const poById = new Map<string, { po_number: string; supplier_id: string | null }>();
  if (poIds.length) {
    // po_id is a UUID in the live database even though the generated types say
    // number — always compare it as a string.
    const { data } = await supabase.from('5.0_purchases').select('po_id, po_number, supplier_id').in('po_id', poIds);
    for (const p of (data ?? []) as { po_id: string; po_number: string; supplier_id: string | null }[]) {
      poById.set(String(p.po_id), { po_number: p.po_number, supplier_id: p.supplier_id });
    }
  }
  const supplierIds = [...new Set([...poById.values()].map((p) => p.supplier_id).filter(Boolean) as string[])];
  const supplierName = new Map<string, string>();
  if (supplierIds.length) {
    const { data } = await supabase.from('2.0_suppliers').select('supplier_id, supplier_name').in('supplier_id', supplierIds);
    for (const s of (data ?? []) as { supplier_id: string; supplier_name: string }[]) supplierName.set(s.supplier_id, s.supplier_name);
  }
  for (const c of costs) {
    const po = poById.get(String(c.po_id));
    const supp = po?.supplier_id ? supplierName.get(po.supplier_id) : '';
    const conv = convertToAccount(Number(c.amount) || 0, c.currency, c.exchange_rate, account.currency);
    rows.push({
      id: `cost-${c.cost_id}`,
      date: (c.payment_date ?? '').slice(0, 10),
      direction: 'out',
      amount: conv.value,
      kind: 'payment',
      description: [supp, po?.po_number, (c.cost_category ?? '').replace(/_/g, ' ')].filter(Boolean).join(' · ') || 'Supplier payment',
      reference: c.notes || '',
      original: conv.original,
    });
  }

  for (const t of (txnRes.data ?? []) as {
    txn_id: string; txn_date: string; direction: 'in' | 'out'; amount: number;
    description: string; reference: string; source: string; created_by_email: string;
  }[]) {
    rows.push({
      id: `txn-${t.txn_id}`,
      date: (t.txn_date ?? '').slice(0, 10),
      direction: t.direction === 'out' ? 'out' : 'in',
      amount: Number(t.amount) || 0,
      kind: t.source === 'adjustment' ? 'adjustment' : 'manual',
      description: t.description || (t.source === 'adjustment' ? 'Balance correction' : 'Manual entry'),
      reference: t.reference || '',
      who: t.created_by_email,
    });
  }

  return rows.sort((a, b) => (b.date || '').localeCompare(a.date || ''));
}

export const signedAmount = (r: StatementRow): number => (r.direction === 'in' ? r.amount : -r.amount);

/** Opening balance plus every movement — the account's position today. */
export const balanceOf = (account: BankAccount, rows: StatementRow[]): number =>
  (Number(account.opening_balance) || 0) + rows.reduce((s, r) => s + signedAmount(r), 0);
