/**
 * Which columns the client-facing exports (PDF + Excel) include.
 * Persisted in localStorage so the choice sticks across quotes and is shared
 * between the editor's Excel export and the print page.
 */
export interface ExportCols {
  brand: boolean;
  qty: boolean;
  unit: boolean;
  lead: boolean;    // lead time tag on sub-section rows
  amount: boolean;  // sub-section amounts (turning off gives a scope-only BOM)
}

export const DEFAULT_EXPORT_COLS: ExportCols = { brand: true, qty: true, unit: true, lead: true, amount: true };

export const EXPORT_COL_KEYS = ['brand', 'qty', 'unit', 'lead', 'amount'] as const;

export const EXPORT_COL_LABELS: Record<keyof ExportCols, string> = {
  brand: 'Brand',
  qty: 'Qty',
  unit: 'Unit',
  lead: 'Lead time',
  amount: 'Amounts',
};

const KEY = 'quote_export_cols';

export function loadExportCols(): ExportCols {
  try {
    const s = localStorage.getItem(KEY);
    return s ? { ...DEFAULT_EXPORT_COLS, ...JSON.parse(s) } : DEFAULT_EXPORT_COLS;
  } catch {
    return DEFAULT_EXPORT_COLS;
  }
}

export function saveExportCols(c: ExportCols) {
  try { localStorage.setItem(KEY, JSON.stringify(c)); } catch { /* private mode */ }
}
