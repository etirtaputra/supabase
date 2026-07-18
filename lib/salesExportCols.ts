/**
 * Which columns / elements the client-facing Sales Quote PDF shows.
 * Persisted in localStorage so the choice sticks across quotes.
 */
export interface SalesExportCols {
  brand: boolean;
  qty: boolean;
  unit: boolean;
  price: boolean;   // unit price column (Harga)
  amount: boolean;  // line amount column (Jumlah)
  notes: boolean;   // per-line comments/descriptions under each item
  lead: boolean;    // lead-time tag on section headers
}

export const DEFAULT_SALES_COLS: SalesExportCols = { brand: false, qty: true, unit: true, price: true, amount: true, notes: true, lead: true };

export const SALES_COL_KEYS = ['qty', 'unit', 'price', 'amount', 'brand', 'notes', 'lead'] as const;

export const SALES_COL_LABELS: Record<keyof SalesExportCols, string> = {
  brand: 'Brand',
  qty: 'Qty',
  unit: 'Unit',
  price: 'Unit price',
  amount: 'Amounts',
  notes: 'Comments',
  lead: 'Lead time',
};

const KEY = 'sales_export_cols';

export function loadSalesCols(): SalesExportCols {
  try {
    const s = localStorage.getItem(KEY);
    return s ? { ...DEFAULT_SALES_COLS, ...JSON.parse(s) } : DEFAULT_SALES_COLS;
  } catch {
    return DEFAULT_SALES_COLS;
  }
}

export function saveSalesCols(c: SalesExportCols) {
  try { localStorage.setItem(KEY, JSON.stringify(c)); } catch { /* private mode */ }
}
