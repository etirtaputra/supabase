'use client';
import React, { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import { createSupabaseClient } from '@/lib/supabase';
import type { ProjectQuote, QuoteSection, QuoteItem } from '@/types/quotes';

function fmtIdr(v: number) {
  return new Intl.NumberFormat('id-ID', { style: 'currency', currency: 'IDR', maximumFractionDigits: 0 }).format(v);
}
function fmtDate(d: string) {
  if (!d) return '';
  return new Date(d).toLocaleDateString('id-ID', { day: '2-digit', month: 'long', year: 'numeric' });
}

interface Section extends QuoteSection { items: QuoteItem[] }

export default function PrintPage() {
  const { id } = useParams<{ id: string }>();
  const supabase = createSupabaseClient();

  const [quote, setQuote] = useState<ProjectQuote | null>(null);
  const [sections, setSections] = useState<Section[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function load() {
      const [qRes, secRes, itemRes] = await Promise.all([
        supabase.from('10.0_project_quotes').select('*').eq('quote_id', id).single(),
        supabase.from('10.1_quote_sections').select('*').eq('quote_id', id).order('sort_order'),
        supabase.from('10.2_quote_items').select('*').eq('quote_id', id).order('sort_order'),
      ]);
      if (!qRes.data) return;
      setQuote(qRes.data as ProjectQuote);
      const secs = (secRes.data ?? []) as QuoteSection[];
      const items = (itemRes.data ?? []) as QuoteItem[];
      setSections(secs.map((s) => ({
        ...s,
        items: items.filter((i) => i.section_id === s.section_id),
      })));
      setLoading(false);
    }
    load();
  }, [id]);

  useEffect(() => {
    if (!loading && quote) {
      setTimeout(() => window.print(), 400);
    }
  }, [loading, quote]);

  if (loading || !quote) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: '100vh', fontFamily: 'sans-serif', color: '#666' }}>
        Preparing document…
      </div>
    );
  }

  const ppnPct = Number(quote.ppn_pct) || 11;
  let subtotal = 0;
  for (const sec of sections) {
    for (const item of sec.items) {
      if (item.parent_item_id) continue;
      subtotal += (Number(item.quantity) || 0) * (Number(item.sell_price) || 0);
    }
  }
  const ppn = subtotal * ppnPct / 100;
  const grandTotal = subtotal + ppn;

  let rowNum = 0;

  return (
    <>
      <style>{`
        * { margin: 0; padding: 0; box-sizing: border-box; }
        body { font-family: 'Arial', sans-serif; font-size: 10pt; color: #1a1a1a; background: white; }
        @page { size: A4; margin: 15mm 12mm; }
        @media print {
          .no-print { display: none !important; }
          body { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
        }
        .page { max-width: 210mm; margin: 0 auto; padding: 10mm 0; }
        .header { display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 6mm; border-bottom: 2px solid #1e3a5f; padding-bottom: 4mm; }
        .company-name { font-size: 18pt; font-weight: 900; color: #1e3a5f; letter-spacing: -0.5px; }
        .company-sub { font-size: 8pt; color: #666; margin-top: 1mm; }
        .doc-title { text-align: right; }
        .doc-title h2 { font-size: 14pt; font-weight: 700; color: #1e3a5f; text-transform: uppercase; letter-spacing: 1px; }
        .doc-title .quote-num { font-size: 10pt; color: #444; margin-top: 1mm; }
        .doc-title .quote-date { font-size: 9pt; color: #666; }
        .meta { display: grid; grid-template-columns: 1fr 1fr; gap: 4mm; margin-bottom: 5mm; }
        .meta-block { }
        .meta-label { font-size: 7pt; font-weight: 700; text-transform: uppercase; letter-spacing: 0.8px; color: #888; margin-bottom: 1mm; }
        .meta-value { font-size: 10pt; font-weight: 600; color: #1a1a1a; line-height: 1.4; }
        .meta-sub { font-size: 9pt; color: #444; line-height: 1.4; }
        .project-bar { background: #f0f4fa; border-left: 3px solid #1e3a5f; padding: 2mm 3mm; margin-bottom: 5mm; font-size: 9pt; color: #333; }
        .project-label { font-size: 7pt; font-weight: 700; text-transform: uppercase; color: #888; margin-bottom: 0.5mm; }
        table { width: 100%; border-collapse: collapse; font-size: 9pt; }
        thead tr { background: #1e3a5f; color: white; }
        thead th { padding: 2.5mm 2mm; text-align: left; font-size: 8pt; font-weight: 700; text-transform: uppercase; letter-spacing: 0.5px; }
        thead th.right { text-align: right; }
        tbody tr.section-row { background: #e8eef7; }
        tbody tr.section-row td { padding: 2mm 2mm; font-weight: 700; font-size: 9pt; color: #1e3a5f; }
        tbody tr.item-row td { padding: 1.5mm 2mm; border-bottom: 0.3pt solid #e5e7eb; vertical-align: top; }
        tbody tr.item-row:hover { background: #fafafa; }
        tbody tr.sub-row td { padding: 1mm 2mm 1mm 8mm; border-bottom: 0.3pt solid #f0f0f0; color: #666; font-size: 8.5pt; font-style: italic; }
        td.right { text-align: right; }
        td.num { text-align: right; font-variant-numeric: tabular-nums; }
        .totals-wrap { display: flex; justify-content: flex-end; margin-top: 4mm; }
        .totals { width: 70mm; }
        .totals-row { display: flex; justify-content: space-between; padding: 1mm 0; font-size: 9.5pt; border-bottom: 0.3pt solid #e5e7eb; }
        .totals-row.grand { font-weight: 700; font-size: 11pt; color: #1e3a5f; border-top: 1.5pt solid #1e3a5f; border-bottom: none; padding-top: 2mm; margin-top: 1mm; }
        .footer { margin-top: 10mm; border-top: 0.5pt solid #ccc; padding-top: 4mm; display: grid; grid-template-columns: 1fr 1fr; gap: 5mm; font-size: 8.5pt; color: #555; }
        .sig-label { font-size: 8pt; color: #888; margin-bottom: 8mm; }
        .sig-line { border-bottom: 0.5pt solid #999; margin-bottom: 1mm; height: 10mm; }
        .sig-name { font-size: 8pt; color: #444; text-align: center; }
        .notes { margin-top: 5mm; font-size: 8.5pt; color: #555; }
        .notes-label { font-size: 7pt; font-weight: 700; text-transform: uppercase; color: #888; margin-bottom: 1mm; }
        .print-btn { position: fixed; bottom: 20px; right: 20px; padding: 10px 20px; background: #1e3a5f; color: white; border: none; border-radius: 8px; font-size: 13px; font-weight: 600; cursor: pointer; box-shadow: 0 4px 12px rgba(0,0,0,0.2); }
      `}</style>

      <div className="page">
        {/* Header */}
        <div className="header">
          <div>
            <div className="company-name">ICAPROC</div>
            <div className="company-sub">PT ICA Procure &amp; Supply</div>
          </div>
          <div className="doc-title">
            <h2>Penawaran Harga</h2>
            <div className="quote-num">{quote.quote_number}</div>
            <div className="quote-date">{fmtDate(quote.quote_date)}</div>
          </div>
        </div>

        {/* Meta: customer */}
        <div className="meta">
          <div className="meta-block">
            <div className="meta-label">Kepada Yth.</div>
            <div className="meta-value">{quote.customer_name || '—'}</div>
            {quote.customer_address && (
              <div className="meta-sub" style={{ whiteSpace: 'pre-line' }}>{quote.customer_address}</div>
            )}
          </div>
          <div className="meta-block" style={{ textAlign: 'right' }}>
            <div className="meta-label">Nomor Penawaran</div>
            <div className="meta-value">{quote.quote_number}</div>
            <div className="meta-sub" style={{ marginTop: '2mm' }}>Tanggal: {fmtDate(quote.quote_date)}</div>
          </div>
        </div>

        {/* Project description */}
        {quote.project_description && (
          <div className="project-bar">
            <div className="project-label">Perihal / Project</div>
            {quote.project_description}
          </div>
        )}

        {/* Items table */}
        <table>
          <thead>
            <tr>
              <th style={{ width: '28px' }}>No</th>
              <th>Uraian / Description</th>
              <th style={{ width: '45px' }}>Brand</th>
              <th style={{ width: '50px' }}>Lead Time</th>
              <th className="right" style={{ width: '35px' }}>Qty</th>
              <th style={{ width: '30px' }}>Unit</th>
              <th className="right" style={{ width: '65px' }}>Harga/Unit</th>
              <th className="right" style={{ width: '72px' }}>Jumlah</th>
            </tr>
          </thead>
          <tbody>
            {sections.map((sec) => {
              const mainItems = sec.items.filter((i) => !i.parent_item_id);
              const secTotal = mainItems.reduce((s, i) => s + (Number(i.quantity) || 0) * (Number(i.sell_price) || 0), 0);
              return (
                <React.Fragment key={sec.section_id}>
                  <tr className="section-row">
                    <td />
                    <td colSpan={6} style={{ fontWeight: 700 }}>{sec.title}</td>
                    <td className="num" style={{ fontWeight: 700, color: '#1e3a5f' }}>
                      {secTotal > 0 ? fmtIdr(secTotal) : ''}
                    </td>
                  </tr>
                  {mainItems.map((item) => {
                    rowNum += 1;
                    const subItems = sec.items.filter((i) => i.parent_item_id === item.item_id);
                    const total = (Number(item.quantity) || 0) * (Number(item.sell_price) || 0);
                    return (
                      <React.Fragment key={item.item_id}>
                        <tr className="item-row">
                          <td className="num" style={{ color: '#888', fontSize: '8pt' }}>{rowNum}</td>
                          <td>{item.description}</td>
                          <td style={{ color: '#555' }}>{item.brand}</td>
                          <td style={{ color: '#555', fontSize: '8.5pt' }}>{sec.lead_time}</td>
                          <td className="num">{item.quantity ?? ''}</td>
                          <td style={{ color: '#555' }}>{item.unit}</td>
                          <td className="num">{item.sell_price ? fmtIdr(Number(item.sell_price)) : ''}</td>
                          <td className="num" style={{ fontWeight: total > 0 ? 600 : 400 }}>
                            {total > 0 ? fmtIdr(total) : ''}
                          </td>
                        </tr>
                        {subItems.map((sub) => (
                          <tr key={sub.item_id} className="sub-row">
                            <td />
                            <td colSpan={3}>↳ {sub.description}{sub.brand ? ` — ${sub.brand}` : ''}</td>
                            <td className="num">{sub.quantity ?? ''}</td>
                            <td>{sub.unit}</td>
                            <td /><td />
                          </tr>
                        ))}
                      </React.Fragment>
                    );
                  })}
                </React.Fragment>
              );
            })}
          </tbody>
        </table>

        {/* Totals */}
        <div className="totals-wrap">
          <div className="totals">
            <div className="totals-row">
              <span>Subtotal (excl. PPN)</span>
              <span>{fmtIdr(subtotal)}</span>
            </div>
            <div className="totals-row">
              <span>PPN {ppnPct}%</span>
              <span>{fmtIdr(ppn)}</span>
            </div>
            <div className="totals-row grand">
              <span>TOTAL</span>
              <span>{fmtIdr(grandTotal)}</span>
            </div>
          </div>
        </div>

        {/* Notes */}
        {quote.notes && (
          <div className="notes">
            <div className="notes-label">Catatan</div>
            <div style={{ whiteSpace: 'pre-line' }}>{quote.notes}</div>
          </div>
        )}

        {/* Signature footer */}
        <div className="footer">
          <div>
            <div className="sig-label">Hormat kami,</div>
            <div className="sig-line" />
            <div className="sig-name">PT ICA Procure &amp; Supply</div>
          </div>
          <div>
            <div className="sig-label">Disetujui oleh,</div>
            <div className="sig-line" />
            <div className="sig-name">{quote.customer_name || '(nama &amp; jabatan)'}</div>
          </div>
        </div>
      </div>

      {/* Print button (hidden when printing) */}
      <button className="print-btn no-print" onClick={() => window.print()}>
        Print / Save PDF
      </button>
    </>
  );
}
