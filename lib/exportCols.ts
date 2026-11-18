/**
 * Which columns the client-facing exports (PDF + Excel) include.
 * The choice sticks across quotes and is shared between the editor's Excel
 * export and the print page. It belongs to the PERSON, not the browser:
 * hooks/useExportCols keeps it in public.user_preferences so a phone prints
 * what the desktop prints (2026-11-18). localStorage here is only its cache.
 */
export interface ExportCols {
  brand: boolean;
  qty: boolean;
  unit: boolean;
  lead: boolean;    // lead time tag on sub-section rows
  amount: boolean;  // sub-section amounts (turning off gives a scope-only BOM)
  notes: boolean;   // engineering notes / comments (internal — off by default)
}

export const DEFAULT_EXPORT_COLS: ExportCols = { brand: true, qty: true, unit: true, lead: true, amount: true, notes: false };

export const EXPORT_COL_KEYS = ['brand', 'qty', 'unit', 'lead', 'amount', 'notes'] as const;

export const EXPORT_COL_LABELS: Record<keyof ExportCols, string> = {
  brand: 'Brand',
  qty: 'Qty',
  unit: 'Unit',
  lead: 'Lead time',
  amount: 'Amounts',
  notes: 'Eng. notes',
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

/** Has THIS browser ever saved a choice? (Lets it seed the account once.) */
export function hasStoredExportCols(): boolean {
  try { return localStorage.getItem(KEY) != null; } catch { return false; }
}

export function saveExportCols(c: ExportCols) {
  try { localStorage.setItem(KEY, JSON.stringify(c)); } catch { /* private mode */ }
}
