/**
 * Client-facing Sales Quote / Order PDF. Same corporate steel-blue language as
 * the Project Quote print. Line items are grouped into sections by product
 * category. Selling prices are client-facing; no cost/margin ever appears here.
 * PDF via the browser's Print → Save as PDF (document.title = filename).
 */
'use client';
import React, { useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { createSupabaseClient } from '@/lib/supabase';
import { useAuth } from '@/hooks/useAuth';

function fmtIdr(v: number) { return `Rp${Math.round(v).toLocaleString('en-US')}`; }
function fmtDate(d?: string | null) {
  if (!d) return '';
  return new Date(d.length <= 10 ? `${d}T00:00:00` : d).toLocaleDateString('id-ID', { day: '2-digit', month: 'long', year: 'numeric' });
}
function humanize(s: string) { return s.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase()); }

interface Quote {
  quote_id: string; quote_number: string; order_number?: string; invoice_number?: string; do_number?: string;
  customer_id: string | null; company_id: string | null; quote_date: string; status: string;
  ppn_pct: number; notes: string;
}
interface Line { item_id: string; component_id: string | null; description: string; unit: string; quantity: number; unit_price: number; line_total: number; sort_order: number; }
interface Section { key: string; label: string; items: Line[]; }

export default function SalesPrintPage() {
  const { id } = useParams<{ id: string }>();
  const supabase = createSupabaseClient();
  const router = useRouter();
  const { user, loading: authLoading } = useAuth();

  const [quote, setQuote] = useState<Quote | null>(null);
  const [sections, setSections] = useState<Section[]>([]);
  const [companyName, setCompanyName] = useState('');
  const [customerName, setCustomerName] = useState('');
  const [customerAddr, setCustomerAddr] = useState('');
  const [loading, setLoading] = useState(true);

  useEffect(() => { if (!authLoading && !user) router.replace(`/login?next=${encodeURIComponent(`/sales/${id}/print`)}`); }, [authLoading, user, id, router]);

  useEffect(() => {
    if (!user) return;
    async function load() {
      const [qRes, iRes, coRes] = await Promise.all([
        supabase.from('22.0_sales_quotes').select('*').eq('quote_id', id).single(),
        supabase.from('22.1_sales_quote_items').select('*').eq('quote_id', id).order('sort_order'),
        supabase.from('1.0_companies').select('company_id, legal_name'),
      ]);
      if (!qRes.data) { setLoading(false); return; }
      const q = qRes.data as Quote;
      setQuote(q);
      setCompanyName(((coRes.data ?? []).find((c) => c.company_id === q.company_id)?.legal_name as string) ?? '');

      if (q.customer_id) {
        const { data: cust } = await supabase.from('20.0_customers').select('display_name, legal_name, billing_address').eq('customer_id', q.customer_id).single();
        if (cust) { setCustomerName((cust.legal_name as string) || (cust.display_name as string) || ''); setCustomerAddr((cust.billing_address as string) || ''); }
      }

      const items = (iRes.data as Line[]) ?? [];
      // Group into sections by product category (client-friendly headings).
      const compIds = [...new Set(items.map((i) => i.component_id).filter(Boolean))] as string[];
      const catById = new Map<string, string>();
      if (compIds.length) {
        const { data: comps } = await supabase.from('3.0_components').select('component_id, category').in('component_id', compIds);
        for (const c of comps ?? []) catById.set(c.component_id as string, (c.category as string) || '');
      }
      const order: string[] = [];
      const byCat = new Map<string, Line[]>();
      for (const it of items) {
        const cat = (it.component_id && catById.get(it.component_id)) || 'lain_lain';
        if (!byCat.has(cat)) { byCat.set(cat, []); order.push(cat); }
        byCat.get(cat)!.push(it);
      }
      setSections(order.map((key) => ({ key, label: key === 'lain_lain' ? 'Lain-lain' : humanize(key), items: byCat.get(key)! })));
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
  const sectionTotal = (sec: Section) => sec.items.reduce((s, i) => s + (Number(i.quantity) || 0) * (Number(i.unit_price) || 0), 0);
  const subtotal = sections.reduce((s, sec) => s + sectionTotal(sec), 0);
  const ppn = subtotal * ppnPct / 100;
  const grandTotal = subtotal + ppn;
  const isOrder = ['ordered', 'invoiced', 'delivered'].includes(quote.status);

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
        .meta { display: grid; grid-template-columns: 1fr 1fr; gap: 4mm; margin-bottom: 5mm; }
        .meta-label { font-size: 7pt; font-weight: 700; text-transform: uppercase; letter-spacing: 1.2px; color: #94a3b8; margin-bottom: 1mm; }
        .meta-value { font-size: 10.5pt; font-weight: 600; color: #0f172a; line-height: 1.4; }
        .meta-sub { font-size: 9pt; color: #475569; line-height: 1.45; }
        table { width: 100%; border-collapse: collapse; font-size: 9pt; }
        thead th { padding: 2mm 1.5mm; text-align: left; font-size: 7pt; font-weight: 700; text-transform: uppercase; letter-spacing: 1.2px; color: #64748b; border-bottom: 1.5pt solid #1f5aa8; white-space: nowrap; }
        thead th.right { text-align: right; }
        tbody tr.group-row td { padding: 4.5mm 1.5mm 1.6mm; font-weight: 800; font-size: 9.5pt; color: #1f5aa8; text-transform: uppercase; letter-spacing: 1.5px; border-bottom: 1pt solid #1f5aa8; }
        tbody tr.item-row td { padding: 1.7mm 1.5mm; border-bottom: 0.4pt solid #e8edf3; vertical-align: top; color: #334155; }
        tbody tr.item-row td:first-child { color: #1f2937; }
        td.num { text-align: right; font-variant-numeric: tabular-nums; white-space: nowrap; }
        tbody tr.subtotal-row td { padding: 1.6mm 1.5mm; text-align: right; font-weight: 650; color: #1f5aa8; font-size: 8.5pt; background: #f6f9fc; }
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
        .print-btn { padding: 11px 22px; background: #1f5aa8; color: #fff; border: none; border-radius: 10px; font-size: 13px; font-weight: 600; cursor: pointer; box-shadow: 0 6px 20px rgba(15,23,42,0.25); }
        .print-btn:hover { background: #1a4e91; }
      `}</style>

      <div className="page">
        <div className="header">
          <div className="company-name">{companyName || 'ICAPROC'}</div>
          <div className="doc-title">
            <div className="doc-label">{isOrder ? 'Konfirmasi Pesanan' : 'Penawaran Harga'}</div>
            <div className="quote-num">{isOrder && quote.order_number ? quote.order_number : quote.quote_number}</div>
            <div className="quote-date">{fmtDate(quote.quote_date)}</div>
            {isOrder && quote.order_number && <div className="quote-sub">Ref. Penawaran: {quote.quote_number}</div>}
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
              <th>Items</th>
              <th className="right" style={{ width: '60px' }}>Qty</th>
              <th style={{ width: '55px' }}>Unit</th>
              <th className="right" style={{ width: '95px' }}>Harga</th>
              <th className="right" style={{ width: '105px' }}>Jumlah</th>
            </tr>
          </thead>
          <tbody>
            {sections.map((sec) => (
              <React.Fragment key={sec.key}>
                {sections.length > 1 && (
                  <tr className="group-row"><td colSpan={5}>{sec.label}</td></tr>
                )}
                {sec.items.map((it) => (
                  <tr key={it.item_id} className="item-row">
                    <td>{it.description || '—'}</td>
                    <td className="num">{Number(it.quantity).toLocaleString('en-US')}</td>
                    <td style={{ color: '#64748b', whiteSpace: 'nowrap' }}>{it.unit}</td>
                    <td className="num">{fmtIdr(Number(it.unit_price))}</td>
                    <td className="num">{fmtIdr(Number(it.quantity) * Number(it.unit_price))}</td>
                  </tr>
                ))}
                {sections.length > 1 && (
                  <tr className="subtotal-row"><td colSpan={5}>Subtotal {sec.label}: {fmtIdr(sectionTotal(sec))}</td></tr>
                )}
              </React.Fragment>
            ))}
            {sections.length === 0 && (
              <tr className="item-row"><td colSpan={5} style={{ color: '#94a3b8', fontStyle: 'italic' }}>Tidak ada item.</td></tr>
            )}
          </tbody>
        </table>

        <div className="totals-wrap">
          <div className="totals">
            <div className="totals-row"><span>Total (excld. PPN {ppnPct}%)</span><span>{fmtIdr(subtotal)}</span></div>
            <div className="totals-row"><span>PPN {ppnPct}%</span><span>{fmtIdr(ppn)}</span></div>
            <div className="totals-row grand"><span>GRAND TOTAL</span><span>{fmtIdr(grandTotal)}</span></div>
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

      <div className="no-print" style={{ position: 'fixed', bottom: '20px', right: '20px', zIndex: 50 }}>
        <button className="print-btn" onClick={() => window.print()}>Print / Save PDF</button>
      </div>
    </>
  );
}
