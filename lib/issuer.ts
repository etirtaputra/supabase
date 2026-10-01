/**
 * WHO ISSUES A DOCUMENT — one rule for every printed page (owner, 2026-10-01:
 * "a Company Editor to input the company and address or contact info to be
 * used in Quote, Proposal, or Support Letters … and the bank account to
 * transfer to including for quotes").
 *
 * The group trades through several PTs, and every quotation, delivery order,
 * EPC proposal and support letter already records WHICH one issues it
 * (`company_id` → 1.0_companies). Until now only the company's NAME followed
 * that link; address, phone, email, NPWP and the bank account came from ONE
 * global block in Settings › Company — which, measured 2026-10-01, was empty,
 * so quotes printed no address and no account at all.
 *
 * Now each field is taken from the issuing company's own row, and the global
 * block is only the fallback for a field that row leaves blank.
 *
 * THE BANK ACCOUNT IS NEVER GUESSED. `defaultAccountFor` (lib/banks.ts) falls
 * back to a company's FIRST account, which is right for preselecting a picker
 * a person then checks — and wrong on a customer's quote, where it could print
 * a director's personal account. A document prints only the account the owner
 * marked "for receiving" for that company; otherwise the global bank-details
 * text; otherwise nothing.
 */

export interface CompanyRecord {
  company_id: string;
  legal_name: string | null;
  address?: string | null;
  phone?: string | null;
  email?: string | null;
  tax_id?: string | null;
}

/** The columns a document needs from 1.0_companies — one select, everywhere. */
export const COMPANY_COLUMNS = 'company_id, legal_name, address, phone, email, tax_id';
/** …and from 41.0_bank_accounts, to find the account marked for receiving. */
export const RECEIVING_ACCOUNT_COLUMNS = 'company_id, bank_name, account_number, account_name, branch, currency, is_active, is_default_receipt';

/** The Settings › Company fallback block (lib/settings.ts AppSettings). */
export interface IssuerFallback {
  companyName: string;
  companyAddress: string;
  companyPhone: string;
  companyEmail: string;
  companyTaxId: string;
  companyBankDetails: string;
}

export interface ReceivingAccount {
  company_id: string | null;
  bank_name: string;
  account_number: string;
  account_name: string;
  branch?: string | null;
  currency: string;
  is_active: boolean;
  is_default_receipt?: boolean;
}

export interface Issuer {
  name: string;
  address: string;
  phone: string;
  email: string;
  taxId: string;
  /** Lines to print under "Pembayaran ke" — empty when nothing is set. */
  bankLines: string[];
}

const pick = (own: string | null | undefined, fallback: string): string => (own ?? '').trim() || (fallback ?? '').trim();

/** The account a customer is told to pay into: the one flagged for receiving, and only that. */
export function receivingAccountFor(accounts: ReceivingAccount[], companyId: string | null | undefined): ReceivingAccount | null {
  if (!companyId) return null;
  return accounts.find((a) => a.company_id === companyId && a.is_active !== false && a.is_default_receipt) ?? null;
}

export function accountLines(a: ReceivingAccount): string[] {
  return [
    [a.bank_name, a.branch ? `(${a.branch})` : ''].filter(Boolean).join(' '),
    `No. Rek. ${a.account_number}${a.currency && a.currency !== 'IDR' ? ` (${a.currency})` : ''}`,
    `a.n. ${a.account_name}`,
  ];
}

export function resolveIssuer(
  company: CompanyRecord | null | undefined,
  s: IssuerFallback,
  accounts: ReceivingAccount[] = [],
  defaultName = 'ICAPROC',
): Issuer {
  const account = receivingAccountFor(accounts, company?.company_id);
  const fallbackBank = (s.companyBankDetails ?? '').trim();
  return {
    name: pick(company?.legal_name, s.companyName) || defaultName,
    address: pick(company?.address, s.companyAddress),
    phone: pick(company?.phone, s.companyPhone),
    email: pick(company?.email, s.companyEmail),
    taxId: pick(company?.tax_id, s.companyTaxId),
    bankLines: account ? accountLines(account) : fallbackBank ? fallbackBank.split('\n').map((l) => l.trim()).filter(Boolean) : [],
  };
}
