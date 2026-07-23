/**
 * Client-facing Sales Quote / Order PDF. Same corporate steel-blue language as
 * the Project Quote print. Line items render under user-defined sections (if
 * any). Selling prices are client-facing; no cost/margin ever appears here.
 * The user chooses which columns / comments show (persisted in localStorage).
 * PDF via the browser's Print → Save as PDF (document.title = filename).
 */
'use client';
import React, { useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { createSupabaseClient } from '@/lib/supabase';
import { useAuth } from '@/hooks/useAuth';
import { DEFAULT_SALES_COLS, SALES_COL_KEYS, SALES_COL_LABELS, loadSalesCols, saveSalesCols, type SalesExportCols } from '@/lib/salesExportCols';

function fmtIdr(v: number) { return `Rp${Math.round(v).toLocaleString('en-US')}`; }
function fmtDate(d?: string | null) {
  if (!d) return '';
  return new Date(d.length <= 10 ? `${d}T00:00:00` : d).toLocaleDateString('id-ID', { day: '2-digit', month: 'long', year: 'numeric' });
}

interface Quote {
  quote_id: string; quote_number: string; order_number?: string; invoice_number?: string; do_number?: string;
  customer_id: string | null; company_id: string | null; quote_date: string; status: string;
  ppn_pct: number; notes: string;
}
interface Line { item_id: string; is_section: boolean; description: string; brand: string; note: string; lead_time: string; unit: string; quantity: number; unit_price: number; sort_order: number; }

export default function SalesPrintPage() {
  const { id } = useParams<{ id: string }>();
  const supabase = createSupabaseClient();
  const router = useRouter();
  const { user, loading: authLoading } = useAuth();

  const [quote, setQuote] = useState<Quote | null>(null);
  const [lines, setLines] = useState<Line[]>([]);
  const [companyName, setCompanyName] = useState('');
  const [customerName, setCustomerName] = useState('');
  const [customerAddr, setCustomerAddr] = useState('');
  const [received, setReceived] = useState(0);
  const [loading, setLoading] = useState(true);
  const [cols, setCols] = useState<SalesExportCols>(DEFAULT_SALES_COLS);

  useEffect(() => { setCols(loadSalesCols()); }, []);
  const setCol = (k: keyof SalesExportCols, v: boolean) => setCols((prev) => { const next = { ...prev, [k]: v }; saveSalesCols(next); return next; });

  useEffect(() => { if (!authLoading && !user) router.replace(`/login?next=${encodeURIComponent(`/sales/${id}/print`)}`); }, [authLoading, user, id, router]);

  useEffect(() => {
    if (!user) return;
    async function load() {
      const [qRes, iRes, coRes, rRes] = await Promise.all([
        supabase.from('22.0_sales_quotes').select('*').eq('quote_id', id).single(),
        supabase.from('22.1_sales_quote_items').select('*').eq('quote_id', id).order('sort_order'),
        supabase.from('1.0_companies').select('company_id, legal_name'),
        supabase.from('26.0_customer_receipts').select('amount').eq('quote_id', id),
      ]);
      setReceived(rRes.error ? 0 : ((rRes.data ?? []) as { amount: number }[]).reduce((s, r) => s + (Number(r.amount) || 0), 0));
      if (!qRes.data) { setLoading(false); return; }
      let q = qRes.data as Quote;
      // ?inv=<invoice_id> prints a SPECIFIC invoice (split billing) — its own
      // number, its own lines (so totals follow), payments against IT only.
      const invId = new URLSearchParams(window.location.search).get('inv');
      let invLines: Line[] | null = null;
      if (invId) {
        const [invRes, invIRes, invRcv] = await Promise.all([
          supabase.from('25.0_sales_invoices').select('*').eq('invoice_id', invId).single(),
          supabase.from('25.1_sales_invoice_items').select('*').eq('invoice_id', invId).order('sort_order'),
          supabase.from('26.0_customer_receipts').select('amount').eq('invoice_id', invId),
        ]);
        if (invRes.data) {
          const inv = invRes.data as { invoice_number: string; ppn_pct: number };
          q = { ...q, invoice_number: inv.invoice_number, status: 'invoiced', ppn_pct: Number(inv.ppn_pct) || q.ppn_pct };
          invLines = (((invIRes.data ?? []) as { inv_item_id: string; description: string; unit: string; qty: number; unit_price: number; sort_order: number }[])
            .map((x) => ({ item_id: x.inv_item_id, is_section: false, description: x.description, brand: '', note: '', lead_time: '', unit: x.unit, quantity: Number(x.qty) || 0, unit_price: Number(x.unit_price) || 0, sort_order: x.sort_order })));
          setReceived(invRcv.error ? 0 : ((invRcv.data ?? []) as { amount: number }[]).reduce((s, r) => s + (Number(r.amount) || 0), 0));
        }
      }
      setQuote(q);
      setCompanyName(((coRes.data ?? []).find((c) => c.company_id === q.company_id)?.legal_name as string) ?? '');
      if (q.customer_id) {
        const { data: cust } = await supabase.from('20.0_customers').select('display_name, legal_name, billing_address').eq('customer_id', q.customer_id).single();
        if (cust) { setCustomerName((cust.legal_name as string) || (cust.display_name as string) || ''); setCustomerAddr((cust.billing_address as string) || ''); }
      }
      setLines(invLines ?? ((iRes.data as Line[]) ?? []));
      setLoading(false);
    }
    load();
  }, [user, id]);

  useEffect(() => {
    if (!loading && quote) document.title = `${quote.quote_number}${customerName ? ` - ${customerName}` : ''}`;
  }, [loading, quote, customerName]);

  if (authLoading || !user || loading || !quote) {
    return <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: '100vh', fontFamily: 'sans-serif', color: '#666' }}>Preparing document…</div>;
  }

  const ppnPct = Number(quote.ppn_pct) || 11;
  const items = lines.filter((l) => !l.is_section);
  const subtotal = items.reduce((s, i) => s + (Number(i.quantity) || 0) * (Number(i.unit_price) || 0), 0);
  const ppn = subtotal * ppnPct / 100;
  const grandTotal = subtotal + ppn;
  const isInvoice = ['invoiced', 'preparing', 'delivered'].includes(quote.status) && !!quote.invoice_number;
  const isOrder = !isInvoice && quote.status === 'ordered' && !!quote.order_number;
  const hasSections = lines.some((l) => l.is_section);
  const outstanding = Math.max(0, grandTotal - received);
  const fullyPaid = grandTotal > 0 && received >= grandTotal - 0.5;

  // No. + Items + optional columns
  const colCount = 2 + (cols.qty ? 1 : 0) + (cols.unit ? 1 : 0) + (cols.price ? 1 : 0) + (cols.amount ? 1 : 0);

  // Continuous item numbering across the document (sections don't count/reset)
  const itemNo = new Map<string, number>();
  {
    let n = 0;
    for (const l of lines) if (!l.is_section) itemNo.set(l.item_id, ++n);
  }

  return (
    <>
      <style>{`
        * { margin: 0; padding: 0; box-sizing: border-box; }
        body { font-family: Rubik, -apple-system, 'Segoe UI', 'Helvetica Neue', Helvetica, Arial, sans-serif; font-size: 9.5pt; color: #1f2937; background: #fff; -webkit-font-smoothing: antialiased; }
        @page { size: A4; margin: 10mm 8mm; }
        @media print { .no-print { display: none !important; } body { -webkit-print-color-adjust: exact; print-color-adjust: exact; } .page { max-width: none; padding: 0; } }
        .page { max-width: 210mm; margin: 0 auto; padding: 8mm 0; }
        .header { display: flex; justify-content: space-between; align-items: flex-end; margin-bottom: 6mm; padding-bottom: 3mm; border-bottom: 2.5pt solid #1f5aa8; }
        .company-name { font-size: 16pt; font-weight: 800; color: #1f5aa8; letter-spacing: -0.3px; }
        .doc-title { text-align: right; }
        .doc-label { font-size: 8pt; font-weight: 700; text-transform: uppercase; letter-spacing: 2.5px; color: #94a3b8; margin-bottom: 1mm; }
        .quote-num { font-size: 12.5pt; font-weight: 700; color: #1f5aa8; }
        .quote-date { font-size: 8.5pt; color: #64748b; margin-top: 0.5mm; }
        .quote-sub { font-size: 8pt; color: #64748b; margin-top: 0.8mm; }
        .paid-stamp { display: inline-block; margin-top: 1.5mm; padding: 1mm 2.5mm; border: 1.5pt solid #16a34a; border-radius: 1.5mm; color: #16a34a; font-size: 9pt; font-weight: 800; letter-spacing: 1.5px; }
        .meta { display: grid; grid-template-columns: 1fr 1fr; gap: 4mm; margin-bottom: 5mm; }
        .meta-label { font-size: 7pt; font-weight: 700; text-transform: uppercase; letter-spacing: 1.2px; color: #94a3b8; margin-bottom: 1mm; }
        .meta-value { font-size: 10.5pt; font-weight: 600; color: #0f172a; line-height: 1.4; }
        .meta-sub { font-size: 9pt; color: #475569; line-height: 1.45; }
        table { width: 100%; border-collapse: collapse; font-size: 9pt; }
        thead th { padding: 2mm 1.5mm; text-align: left; font-size: 7pt; font-weight: 700; text-transform: uppercase; letter-spacing: 1.2px; color: #64748b; border-bottom: 1.5pt solid #1f5aa8; white-space: nowrap; }
        thead th.right { text-align: right; }
        tbody tr.group-row td { padding: 4.5mm 1.5mm 1.6mm; font-weight: 800; font-size: 9.5pt; color: #1f5aa8; text-transform: uppercase; letter-spacing: 1.5px; border-bottom: 1pt solid #1f5aa8; }
        .lead-tag { font-weight: 500; font-style: italic; font-size: 8pt; color: #64748b; text-transform: none; letter-spacing: 0; }
        tbody tr.item-row td { padding: 1.7mm 1.5mm; border-bottom: 0.4pt solid #e8edf3; vertical-align: top; color: #334155; }
        tbody tr.item-row td:first-child { color: #1f2937; }
        tbody tr.note-row td { padding: 0 1.5mm 1.7mm; border-bottom: 0.4pt solid #e8edf3; color: #64748b; font-size: 8.5pt; font-style: italic; }
        td.num { text-align: right; font-variant-numeric: tabular-nums; white-space: nowrap; }
        .totals-wrap { display: flex; justify-content: flex-end; margin-top: 5mm; }
        .totals { width: 88mm; }
        .totals-row { display: flex; justify-content: space-between; padding: 1.4mm 3mm; font-size: 9.5pt; color: #475569; border-bottom: 0.4pt solid #e8edf3; font-variant-numeric: tabular-nums; }
        .totals-row span:last-child { font-weight: 650; color: #0f172a; }
        .totals-row.grand { background: #1f5aa8; color: #fff; border: none; border-radius: 1.5mm; font-weight: 700; font-size: 11pt; padding: 2.4mm 3mm; margin-top: 1.5mm; }
        .totals-row.grand span:last-child { color: #fff; font-weight: 800; }
        .terms { margin-top: 8mm; padding-top: 2mm; page-break-inside: avoid; }
        .terms-title { font-size: 8pt; font-weight: 800; text-transform: uppercase; letter-spacing: 2px; color: #1f5aa8; border-left: 2.5pt solid #1f5aa8; padding-left: 2.5mm; margin-bottom: 2.5mm; }
        .terms-header { font-weight: 650; text-decoration: underline; text-underline-offset: 2px; margin-top: 1.8mm; line-height: 1.55; color: #1f2937; font-size: 8.5pt; white-space: pre-wrap; }
        .terms-line { font-style: italic; line-height: 1.55; color: #475569; font-size: 8.5pt; white-space: pre-wrap; }
        .footer { margin-top: 10mm; padding-top: 4mm; border-top: 0.5pt solid #e2e8f0; display: grid; grid-template-columns: 1fr 1fr; gap: 8mm; font-size: 8.5pt; color: #64748b; }
        .sig-label { font-size: 7pt; font-weight: 700; text-transform: uppercase; letter-spacing: 1.2px; color: #94a3b8; margin-bottom: 10mm; }
        .sig-line { border-bottom: 0.6pt solid #cbd5e1; margin-bottom: 1.2mm; height: 8mm; }
        .sig-name { font-size: 8pt; color: #475569; text-align: center; font-weight: 600; }
        .print-btn { padding: 11px 22px; background: #1f5aa8; color: #fff; border: none; border-radius: 10px; font-size: 13px; font-weight: 600; cursor: pointer; box-shadow: 0 6px 20px rgba(15,23,42,0.25); width: 100%; }
        .print-btn:hover { background: #1a4e91; }
      `}</style>

      <div className="page">
        <div className="header">
          <div className="company-name">{companyName || 'ICAPROC'}</div>
          <div className="doc-title">
            <div className="doc-label">{isInvoice ? 'Invoice' : isOrder ? 'Konfirmasi Pesanan' : 'Penawaran Harga'}</div>
            <div className="quote-num">{isInvoice ? quote.invoice_number : isOrder ? quote.order_number : quote.quote_number}</div>
            <div className="quote-date">{fmtDate(quote.quote_date)}</div>
            {(isInvoice || isOrder) && (
              <div className="quote-sub">Ref. Penawaran: {quote.quote_number}{isInvoice && quote.order_number ? ` · Pesanan: ${quote.order_number}` : ''}</div>
            )}
            {isInvoice && fullyPaid && <div className="paid-stamp">LUNAS / PAID</div>}
          </div>
        </div>

        <div className="meta">
          <div>
            <div className="meta-label">Kepada Yth.</div>
            <div className="meta-value">{customerName || '—'}</div>
            {customerAddr && <div className="meta-sub" style={{ whiteSpace: 'pre-line' }}>{customerAddr}</div>}
          </div>
          <div style={{ textAlign: 'right' }}>
            {quote.invoice_number && <div className="quote-sub">No. Invoice: {quote.invoice_number}</div>}
            {quote.do_number && <div className="quote-sub">No. Surat Jalan: {quote.do_number}</div>}
          </div>
        </div>

        <table>
          <thead>
            <tr>
              <th style={{ width: '28px' }}>No.</th>
              <th>Items</th>
              {cols.qty && <th className="right" style={{ width: '55px' }}>Qty</th>}
              {cols.unit && <th style={{ width: '55px' }}>Unit</th>}
              {cols.price && <th className="right" style={{ width: '95px' }}>Harga</th>}
              {cols.amount && <th className="right" style={{ width: '105px' }}>Jumlah</th>}
            </tr>
          </thead>
          <tbody>
            {lines.map((l) => {
              if (l.is_section) {
                return (
                  // Sections are separators only — no per-section subtotal
                  <tr key={l.item_id} className="group-row"><td colSpan={colCount}>{l.description}{cols.lead && l.lead_time ? <span className="lead-tag"> · lead time {l.lead_time}</span> : null}</td></tr>
                );
              }
              const amt = (Number(l.quantity) || 0) * (Number(l.unit_price) || 0);
              return (
                <React.Fragment key={l.item_id}>
                  <tr className="item-row">
                    <td style={{ color: '#94a3b8' }} className="num">{itemNo.get(l.item_id)}</td>
                    <td>{l.description || '—'}</td>
                    {cols.qty && <td className="num">{Number(l.quantity).toLocaleString('en-US')}</td>}
                    {cols.unit && <td style={{ color: '#64748b', whiteSpace: 'nowrap' }}>{l.unit}</td>}
                    {cols.price && <td className="num">{fmtIdr(Number(l.unit_price))}</td>}
                    {cols.amount && <td className="num">{fmtIdr(amt)}</td>}
                  </tr>
                  {cols.notes && l.note && (
                    <tr className="note-row"><td colSpan={colCount}>↳ {l.note}</td></tr>
                  )}
                </React.Fragment>
              );
            })}
            {items.length === 0 && !hasSections && (
              <tr className="item-row"><td colSpan={colCount} style={{ color: '#94a3b8', fontStyle: 'italic' }}>Tidak ada item.</td></tr>
            )}
          </tbody>
        </table>

        <div className="totals-wrap">
          <div className="totals">
            <div className="totals-row"><span>Total (excld. PPN {ppnPct}%)</span><span>{fmtIdr(subtotal)}</span></div>
            <div className="totals-row"><span>PPN {ppnPct}%</span><span>{fmtIdr(ppn)}</span></div>
            <div className="totals-row grand"><span>GRAND TOTAL</span><span>{fmtIdr(grandTotal)}</span></div>
            {isInvoice && received > 0 && !fullyPaid && (
              <>
                <div className="totals-row" style={{ marginTop: '2mm' }}><span>Terbayar</span><span>{fmtIdr(received)}</span></div>
                <div className="totals-row" style={{ fontWeight: 700 }}><span>Sisa Tagihan</span><span>{fmtIdr(outstanding)}</span></div>
              </>
            )}
          </div>
        </div>

        {quote.notes && (
          <div className="terms">
            <div className="terms-title">Syarat &amp; Ketentuan</div>
            {quote.notes.split('\n').map((line, i) => {
              const t = line.trim();
              if (!t) return <div key={i} style={{ height: '2mm' }} />;
              if (/:$/.test(t)) return <div key={i} className="terms-header">{line}</div>;
              return <div key={i} className="terms-line">{line}</div>;
            })}
          </div>
        )}

        <div className="footer">
          <div>
            <div className="sig-label">Hormat kami,</div>
            <div className="sig-line" />
            <div className="sig-name">{companyName || '(perusahaan)'}</div>
          </div>
          <div>
            <div className="sig-label">Disetujui oleh,</div>
            <div className="sig-line" />
            <div className="sig-name">{customerName || '(nama & jabatan)'}</div>
          </div>
        </div>
      </div>

      {/* Column toggles + print button (hidden when printing) */}
      <div className="no-print" style={{ position: 'fixed', bottom: '20px', right: '20px', display: 'flex', flexDirection: 'column', alignItems: 'stretch', gap: '10px', width: '190px', zIndex: 50 }}>
        <div style={{ background: '#fff', border: '1px solid #e2e8f0', borderRadius: '12px', padding: '12px 14px', boxShadow: '0 6px 20px rgba(15,23,42,0.15)', fontSize: '12px', color: '#334155' }}>
          <p style={{ fontSize: '10px', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '1px', color: '#94a3b8', marginBottom: '8px' }}>Show in PDF</p>
          {SALES_COL_KEYS.map((k) => (
            <label key={k} style={{ display: 'flex', alignItems: 'center', gap: '7px', marginBottom: '5px', cursor: 'pointer' }}>
              <input type="checkbox" checked={cols[k]} onChange={(e) => setCol(k, e.target.checked)} />
              {SALES_COL_LABELS[k]}
            </label>
          ))}
        </div>
        <button className="print-btn" onClick={() => window.print()}>Print / Save PDF</button>
      </div>
    </>
  );
}
