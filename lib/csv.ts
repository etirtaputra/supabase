/**
 * Tiny CSV helpers for list import/export (Products, Customers).
 * - Export: RFC-4180 quoting + UTF-8 BOM so Excel opens it correctly.
 * - Import: parses quoted fields, commas, embedded newlines; first row is the
 *   header. Header matching is case-insensitive and ignores spaces/underscores
 *   so hand-edited Excel headers ("Selling Price (IDR)") still map.
 */

export function toCsv(headers: string[], rows: (string | number | null | undefined)[][]): string {
  const esc = (v: string | number | null | undefined) => {
    const s = v == null ? '' : String(v);
    return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return [headers.map(esc).join(','), ...rows.map((r) => r.map(esc).join(','))].join('\r\n');
}

export function downloadCsv(filename: string, headers: string[], rows: (string | number | null | undefined)[][]) {
  const blob = new Blob(['﻿' + toCsv(headers, rows)], { type: 'text/csv;charset=utf-8' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = filename.endsWith('.csv') ? filename : `${filename}.csv`;
  a.click();
  URL.revokeObjectURL(a.href);
}

/** Parse CSV text into an array of records keyed by normalized header. */
export function parseCsv(text: string): { headers: string[]; rows: Record<string, string>[] } {
  const src = text.replace(/^﻿/, '');
  const table: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let inQuotes = false;
  for (let i = 0; i < src.length; i++) {
    const ch = src[i];
    if (inQuotes) {
      if (ch === '"') {
        if (src[i + 1] === '"') { cell += '"'; i++; }
        else inQuotes = false;
      } else cell += ch;
    } else if (ch === '"') {
      inQuotes = true;
    } else if (ch === ',') {
      row.push(cell); cell = '';
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && src[i + 1] === '\n') i++;
      row.push(cell); cell = '';
      if (row.some((c) => c.trim() !== '')) table.push(row);
      row = [];
    } else cell += ch;
  }
  row.push(cell);
  if (row.some((c) => c.trim() !== '')) table.push(row);

  if (!table.length) return { headers: [], rows: [] };
  const headers = table[0].map((h) => normalizeHeader(h));
  const rows = table.slice(1).map((r) => {
    const rec: Record<string, string> = {};
    headers.forEach((h, i) => { if (h) rec[h] = (r[i] ?? '').trim(); });
    return rec;
  });
  return { headers, rows };
}

/** "Selling Price (IDR)" → "sellingpriceidr" — forgiving header matching. */
export function normalizeHeader(h: string): string {
  return h.toLowerCase().replace(/[^a-z0-9]/g, '');
}

/** Read a File as text (for <input type="file"> imports). */
export function readFileText(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result ?? ''));
    r.onerror = () => reject(r.error);
    r.readAsText(file);
  });
}

/** Forgiving number parse: "1.234.567", "1,234,567", "Rp 500", "" → number|null. */
export function csvNum(v: string | undefined): number | null {
  if (!v) return null;
  const cleaned = v.replace(/[^\d.,-]/g, '');
  if (!cleaned) return null;
  // If both separators appear, the last one is the decimal point
  let s = cleaned;
  const lastDot = s.lastIndexOf('.'), lastComma = s.lastIndexOf(',');
  if (lastDot >= 0 && lastComma >= 0) {
    const dec = Math.max(lastDot, lastComma);
    s = s.slice(0, dec).replace(/[.,]/g, '') + '.' + s.slice(dec + 1).replace(/[.,]/g, '');
  } else if (lastComma >= 0) {
    // "1,234,567" thousands vs "1234,5" decimal — treat 3-digit groups as thousands
    const parts = s.split(',');
    s = parts.every((p, i) => i === 0 || p.length === 3) ? parts.join('') : parts.join('.');
  } else if (lastDot >= 0) {
    const parts = s.split('.');
    s = parts.every((p, i) => i === 0 || p.length === 3) ? parts.join('') : s;
  }
  const n = Number(s);
  return isNaN(n) ? null : n;
}
