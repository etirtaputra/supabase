/**
 * Surat Dukungan (Support Letter) — Module 28.
 *
 * The document we issue as principal/distributor so a reseller can enter a
 * tender carrying our backing. The point of the module is speed: the clauses,
 * the fee, the numbering and the warranties are all PRE-FORMATTED here, so
 * writing one is picking a customer, a project and some items — not opening
 * last month's letter and overtyping the names.
 *
 * Everything a letter says about an item (type, warranty) is derived from the
 * item master, then SNAPSHOT onto the letter: a letter already signed must
 * keep saying what it said, even after the catalog is edited.
 */
import { fmtWarranty, type WarrantyFields } from './warranty';

export type LetterStatus = 'draft' | 'issued' | 'cancelled';

export const LETTER_STATUS: Record<LetterStatus, { label: string; cls: string }> = {
  draft:     { label: 'Draft',     cls: 'bg-slate-700/40 text-slate-300' },
  issued:    { label: 'Issued',    cls: 'bg-emerald-500/15 text-emerald-300' },
  cancelled: { label: 'Cancelled', cls: 'bg-rose-500/15 text-rose-300' },
};

/** The administration fee charged per letter — prefilled on every new one. */
export const DEFAULT_LETTER_FEE = 300_000;

/** The undertakings, one per line. Numbering is applied when printing. */
export const DEFAULT_STATEMENTS = [
  'Seluruh barang/produk yang kami sampaikan adalah 100% baru, asli (genuine), tidak cacat, baik yang terlihat maupun yang tersembunyi.',
  'Kami sanggup menyuplai barang sesuai dengan spesifikasi, jumlah dan jadwal yang ditentukan pada tender paket pekerjaan ini.',
  'Memiliki cadangan dan sanggup menyediakan barang pengganti apabila dibutuhkan.',
].join('\n');

export const DEFAULT_VALIDITY_NOTE =
  'Surat Dukungan ini berlaku jika perusahaan yang kami dukung tersebut di atas ditetapkan sebagai Penyedia barang/jasa untuk paket pekerjaan seperti yang tercantum dalam surat dukungan ini dan menggunakan produk yang tertera pada surat dukungan ini.';

export const DEFAULT_CLOSING_NOTE =
  'Demikian surat pernyataan ini dibuat dengan sesungguhnya untuk dipergunakan sebagaimana mestinya.';

export interface SupportLetter {
  letter_id: string;
  letter_number: string;
  letter_date: string;
  customer_id: string | null;
  supported_person_name: string;
  supported_person_title: string;
  supported_company_name: string;
  supported_company_address: string;
  project_name: string;
  end_user_name: string;
  end_user_address: string;
  company_id: string | null;
  company_code: string;
  signatory_name: string;
  signatory_title: string;
  brands: string;
  place_of_issue: string;
  sales_rep_id: string | null;
  status: LetterStatus;
  notes: string;
  statements: string;
  validity_note: string;
  closing_note: string;
  fee_amount: number;
  fee_paid_at: string | null;
  created_at: string;
  updated_at: string;
  created_by_email: string;
  updated_by_email: string;
}

export interface SupportLetterItem {
  item_id: string;
  letter_id: string;
  component_id: string | null;
  category_label: string;
  type_text: string;
  warranty_text: string;
  quantity: number | null;
  sort_order: number;
}

// ── Indonesian document language ────────────────────────────────────────────
const BULAN = ['Januari', 'Februari', 'Maret', 'April', 'Mei', 'Juni',
  'Juli', 'Agustus', 'September', 'Oktober', 'November', 'Desember'];
const ROMAN = ['I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII', 'IX', 'X', 'XI', 'XII'];

/** "30 Juli 2026" — the date as the letter prints it. */
export function fmtDateID(iso: string | null | undefined): string {
  if (!iso) return '';
  const d = new Date(`${String(iso).slice(0, 10)}T00:00:00`);
  if (isNaN(d.getTime())) return '';
  return `${d.getDate()} ${BULAN[d.getMonth()]} ${d.getFullYear()}`;
}

/** The document number the database will assign, for previewing on a draft. */
export function previewLetterNumber(dateISO: string, companyCode = 'ISL', seq = 0): string {
  const d = new Date(`${String(dateISO).slice(0, 10)}T00:00:00`);
  const m = isNaN(d.getTime()) ? new Date().getMonth() : d.getMonth();
  const y = isNaN(d.getTime()) ? new Date().getFullYear() : d.getFullYear();
  return `${String(seq || 1).padStart(3, '0')}-${companyCode || 'ISL'}-SD-${ROMAN[m]}-${y}`;
}

/** Garansi as the letter states it: "2 Tahun" / "18 Bulan" / "90 Hari". */
export function warrantyTextID(c: WarrantyFields | null | undefined): string {
  if (!c) return '';
  const v = Number(c.warranty_value);
  if (!c.warranty_value || !isFinite(v) || v <= 0) {
    // Nothing structured — fall back to whatever the legacy note said
    return (c.warranty ?? '').trim();
  }
  const unit = (c.warranty_unit ?? 'years') as string;
  const word = unit === 'months' ? 'Bulan' : unit === 'days' ? 'Hari' : 'Tahun';
  return `${v % 1 === 0 ? v : v.toFixed(1)} ${word}`;
}

/** The English label, for screens rather than the printed letter. */
export const warrantyTextEN = (c: WarrantyFields | null | undefined): string =>
  (c && fmtWarranty(c.warranty_value, c.warranty_unit)) || (c?.warranty ?? '').trim();

/** Brands line ("ICA SOLAR, ICAL, EPEVER") from the items being supported. */
export function brandsOf(brands: (string | null | undefined)[]): string {
  const seen: string[] = [];
  for (const b of brands) {
    const t = (b ?? '').trim();
    if (t && !seen.some((x) => x.toLowerCase() === t.toLowerCase())) seen.push(t);
  }
  return seen.join(', ');
}

/** Statements as printed: numbered lines, blanks dropped. */
export const statementLines = (s: string): string[] =>
  (s || '').split('\n').map((l) => l.trim()).filter(Boolean);
