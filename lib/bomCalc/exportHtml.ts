/**
 * The BOM as the customer's file — the standard layout: category, description,
 * qty, unit, material unit/total, installation unit/total, total, per Wp,
 * remarks. Cost and margin never leave ICAPROC: they are not columns here.
 *
 * An HTML table saved as .xls, like the EPC proposal export — Excel opens it
 * without a library, and every figure is the one the screen shows.
 */
import type { BomCalcDoc, BomCalcResult } from './index.ts';
import { STANDARD_CATEGORIES } from './template.ts';

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const num = (n: number, dp = 0) => n.toLocaleString('en-US', { minimumFractionDigits: dp, maximumFractionDigits: dp });

export function bomExportHtml(doc: BomCalcDoc, res: BomCalcResult, title: string): string {
  const byId = new Map(res.rows.map((r) => [r.id, r]));
  let body = '';
  for (const cat of STANDARD_CATEGORIES) {
    const rows = doc.rows.filter((r) => r.category === cat.key && (byId.get(r.id)?.qty ?? 0) > 0);
    if (!rows.length) continue;
    const t = res.totals.byCategory[cat.key];
    body += `<tr style="background:#12463b;color:#fff;font-weight:bold"><td colspan="10">${esc(cat.label)}</td><td style="text-align:right">${t ? num(t.total) : ''}</td></tr>`;
    for (const r of rows) {
      const p = byId.get(r.id)!;
      body += `<tr>
        <td></td><td>${esc(r.description)}</td><td style="text-align:right">${num(p.qty, p.qty % 1 ? 2 : 0)}</td><td>${esc(r.unit)}</td>
        <td style="text-align:right">${num(p.materialUnit)}</td><td style="text-align:right">${num(p.materialTotal)}</td>
        <td style="text-align:right">${num(p.installTotal && p.qty ? p.installTotal / p.qty : 0)}</td><td style="text-align:right">${num(p.installTotal)}</td>
        <td style="text-align:right">${num(p.total)}</td><td style="text-align:right">${p.perWp == null ? '' : num(p.perWp, 2)}</td>
        <td>${esc([r.brand, r.remarks].filter(Boolean).join(' — '))}</td></tr>`;
    }
  }
  const T = res.totals;
  const foot = (label: string, v: string, bold = true) =>
    `<tr style="${bold ? 'font-weight:bold' : ''}"><td colspan="8" style="text-align:right">${label}</td><td style="text-align:right">${v}</td><td colspan="2"></td></tr>`;
  return `<html><head><meta charset="utf-8"/>
<style>table{border-collapse:collapse}th,td{border:1px solid #ccc;padding:4px 8px;font-size:11px}th{background:#12463b;color:#fff}</style></head><body>
<p><b>${esc(doc.project.customer || title)}</b>${doc.project.location ? ` — ${esc(doc.project.location)}` : ''}</p>
<p>${esc(title)} · ${num(res.plantWp / 1000, 2)} kWp</p>
<table>
<tr><th>Category</th><th>Description</th><th>Qty</th><th>Unit</th><th>Material Unit Price</th><th>Material Total</th><th>Installation Unit Price</th><th>Installation Total</th><th>Total Price (IDR)</th><th>/Wp</th><th>Remarks</th></tr>
${body}
${foot('TOTAL PRICE in IDR (Excl. PPN)', num(T.total))}
${foot(`PPN ${doc.project.ppnPct}%`, num(T.ppn), false)}
${foot('GRAND TOTAL (Incl. PPN)', num(T.totalInclPpn))}
${T.perWp != null ? foot('Price per Wp (Excl. PPN)', num(T.perWp, 2)) : ''}
</table></body></html>`;
}
