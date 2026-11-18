/**
 * The Content-Disposition for a downloaded PDF, carrying the SAME name the
 * desktop's Save-as-PDF proposes (the print page's title — lib/quoteFilename).
 * Pure; tested in lib/pdfFileName.test.ts.
 *
 * Two forms, because browsers read different ones: `filename="…"` must be
 * plain ASCII (non-ASCII and quotes are replaced), `filename*=UTF-8''…` keeps
 * the exact name for every browser that reads it (all current ones do).
 */
/**
 * The file name desktop Chrome gives a printed page: its title, keeping only
 * letters, digits, "-", "_" and "." — so `PV+BESS_SBO-(PV-CU+AC-AL)` saves as
 * `PVBESS_SBO-PV-CUAC-AL` and `Atap-BOH-&-Atap` as `Atap-BOH--Atap`, exactly
 * the names the owner's desktop PDFs carry (2026-11-18).
 */
export function desktopPdfName(title: string): string {
  const base = (title || '').replace(/\.pdf$/i, '').replace(/[^\p{L}\p{N}._-]/gu, '') || 'proposal';
  return `${base}.pdf`;
}

export function pdfDisposition(title: string): string {
  const name = desktopPdfName(title);
  const ascii = name.replace(/[^\x20-\x7e]/g, '_').replace(/["\\]/g, '_');
  const utf8 = encodeURIComponent(name).replace(/['()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);
  return `attachment; filename="${ascii}"; filename*=UTF-8''${utf8}`;
}

/** The storage key supabase-js keeps the session under, for a project URL. */
export function supabaseStorageKey(supabaseUrl: string): string {
  return `sb-${new URL(supabaseUrl).hostname.split('.')[0]}-auth-token`;
}
