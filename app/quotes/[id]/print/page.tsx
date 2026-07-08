'use client';
import React, { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import { createSupabaseClient } from '@/lib/supabase';
import { SECTION_GROUPS, type SectionGroup, type ProjectQuote, type QuoteSection, type QuoteItem } from '@/types/quotes';
import { quoteFileName } from '@/lib/quoteFilename';
import { specFileTag, type SystemSpecs } from '@/lib/projectSpec';
import { useQuotesGate } from '@/hooks/useQuotesGate';
import { DEFAULT_EXPORT_COLS, EXPORT_COL_KEYS, EXPORT_COL_LABELS, loadExportCols, saveExportCols, type ExportCols } from '@/lib/exportCols';

function fmtIdr(v: number) {
  return `Rp${Math.round(v).toLocaleString('en-US')}`;
}
function fmtDate(d: string) {
  if (!d) return '';
  return new Date(d).toLocaleDateString('id-ID', { day: '2-digit', month: 'long', year: 'numeric' });
}

interface Section extends QuoteSection { items: QuoteItem[] }

export default function PrintPage() {
  const { id } = useParams<{ id: string }>();
  const supabase = createSupabaseClient();
  // Any signed-in role may print; no session redirects to login
  const gate = useQuotesGate(true);

  const [quote, setQuote] = useState<ProjectQuote | null>(null);
  const [sections, setSections] = useState<Section[]>([]);
  const [companyName, setCompanyName] = useState('');
  // component_id → Wp per module, for pv_module components used on this quote
  const [wpMap, setWpMap] = useState<Map<string, number>>(new Map());
  const [loading, setLoading] = useState(true);

  // Column choices (shared with the editor's Excel export via localStorage)
  const [cols, setCols] = useState<ExportCols>(DEFAULT_EXPORT_COLS);
  useEffect(() => { setCols(loadExportCols()); }, []);
  const setCol = (k: keyof ExportCols, v: boolean) => {
    setCols((prev) => { const next = { ...prev, [k]: v }; saveExportCols(next); return next; });
  };

  useEffect(() => {
    async function load() {
      const [qRes, secRes, itemRes, compRes] = await Promise.all([
        supabase.from('10.0_project_quotes').select('*').eq('quote_id', id).single(),
        supabase.from('10.1_quote_sections').select('*').eq('quote_id', id).order('sort_order'),
        supabase.from('10.2_quote_items').select('*').eq('quote_id', id).order('sort_order'),
        supabase.from('1.0_companies').select('company_id, legal_name'),
      ]);
      if (!qRes.data) return;
      const q = qRes.data as ProjectQuote;
      setQuote(q);
      const comp = (compRes.data ?? []).find((c) => c.company_id === q.company_id);
      setCompanyName((comp?.legal_name as string) ?? '');
      const secs = (secRes.data ?? []) as QuoteSection[];
      const items = (itemRes.data ?? []) as QuoteItem[];
      setSections(secs.map((s) => ({
        ...s,
        group_key: (s.group_key as SectionGroup) || 'bos',
        items: items.filter((i) => i.section_id === s.section_id),
      })));

      const compIds = [...new Set(items.map((i) => i.component_id).filter(Boolean))] as string[];
      if (compIds.length) {
        const { data: comps } = await supabase
          .from('3.0_components')
          .select('component_id, category, norm_value')
          .in('component_id', compIds);
        setWpMap(new Map(
          (comps ?? [])
            .filter((c) => c.category === 'pv_module' && Number(c.norm_value) > 0)
            .map((c) => [c.component_id as string, Number(c.norm_value)])
        ));
      }
      setLoading(false);
    }
    load();
  }, [id]);

  // Wp per module: catalog norm_value, else parsed from the description.
  // Lines with unit 'Wp' keep qty-as-total-Wp behavior.
  const wpPerModule = (item: QuoteItem): number => {
    if (item.component_id && wpMap.has(item.component_id)) return wpMap.get(item.component_id)!;
    const m = (item.description ?? '').match(/(\d{2,4}(?:[.,]\d+)?)\s*wp\b/i);
    return m ? parseFloat(m[1].replace(',', '.')) : 0;
  };
  const itemWp = (item: QuoteItem): number => {
    if (item.parent_item_id) return 0;
    const qty = Number(item.quantity) || 0;
    if ((item.unit ?? '').trim().toLowerCase() === 'wp') return qty;
    return qty * wpPerModule(item);
  };
  const totalWp = sections
    .filter((s) => s.group_key === 'solar_panels')
    .flatMap((s) => s.items.filter((i) => !i.parent_item_id))
    .reduce((s, i) => s + itemWp(i), 0);

  useEffect(() => {
    if (!loading && quote && gate.ready) {
      // Browsers use the document title as the default Save-as-PDF filename
      document.title = quoteFileName(quote.quote_number, quote.customer_name, totalWp, {
        specTag: specFileTag(quote.project_type, (quote.system_specs as SystemSpecs) ?? {}),
        location: quote.location ?? '',
      });
      setTimeout(() => window.print(), 400);
    }
  }, [loading, quote, totalWp, gate.ready]);

  if (!gate.ready || loading || !quote) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: '100vh', fontFamily: 'sans-serif', color: '#666' }}>
        Preparing document…
      </div>
    );
  }

  const ppnPct = Number(quote.ppn_pct) || 11;
  const sectionTotal = (sec: Section) =>
    sec.items.filter((i) => !i.parent_item_id)
      .reduce((s, i) => s + (Number(i.quantity) || 0) * (Number(i.sell_price) || 0), 0);
  const subtotal = sections.reduce((s, sec) => s + sectionTotal(sec), 0);
  const ppn = subtotal * ppnPct / 100;
  const grandTotal = subtotal + ppn;

  return (
    <>
      <style>{`
        * { margin: 0; padding: 0; box-sizing: border-box; }
        body { font-family: -apple-system, 'Segoe UI', 'Helvetica Neue', Helvetica, Arial, sans-serif; font-size: 9.5pt; color: #1f2937; background: #fff; -webkit-font-smoothing: antialiased; }
        @page { size: A4; margin: 10mm 8mm; }
        @media print {
          .no-print { display: none !important; }
          body { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
          .page { max-width: none; padding: 0; }
        }
        .page { max-width: 210mm; margin: 0 auto; padding: 8mm 0; }

        .header { display: flex; justify-content: space-between; align-items: flex-end; margin-bottom: 6mm; padding-bottom: 3mm; border-bottom: 2.5pt solid #1e3a5f; }
        .company-name { font-size: 16pt; font-weight: 800; color: #1e3a5f; letter-spacing: -0.3px; }
        .doc-title { text-align: right; }
        .doc-label { font-size: 8pt; font-weight: 700; text-transform: uppercase; letter-spacing: 2.5px; color: #94a3b8; margin-bottom: 1mm; }
        .quote-num { font-size: 12.5pt; font-weight: 700; color: #1e3a5f; }
        .quote-date { font-size: 8.5pt; color: #64748b; margin-top: 0.5mm; }

        .meta { display: grid; grid-template-columns: 1fr 1fr; gap: 4mm; margin-bottom: 5mm; }
        .meta-label { font-size: 7pt; font-weight: 700; text-transform: uppercase; letter-spacing: 1.2px; color: #94a3b8; margin-bottom: 1mm; }
        .meta-value { font-size: 10.5pt; font-weight: 600; color: #0f172a; line-height: 1.4; }
        .meta-sub { font-size: 9pt; color: #475569; line-height: 1.45; }

        .project-bar { background: #f4f7fb; border-left: 2.5pt solid #1e3a5f; border-radius: 0 1.5mm 1.5mm 0; padding: 2.5mm 3.5mm; margin-bottom: 5mm; font-size: 9.5pt; color: #1f2937; }
        .project-label { font-size: 6.5pt; font-weight: 700; text-transform: uppercase; letter-spacing: 1.2px; color: #94a3b8; margin-bottom: 0.8mm; }

        table { width: 100%; border-collapse: collapse; font-size: 9pt; }
        thead th { padding: 2mm 1.5mm; text-align: left; font-size: 7pt; font-weight: 700; text-transform: uppercase; letter-spacing: 1.2px; color: #64748b; border-bottom: 1.5pt solid #1e3a5f; white-space: nowrap; }
        thead th.right { text-align: right; }
        tbody tr.group-row td { padding: 4.5mm 1.5mm 1.6mm; font-weight: 800; font-size: 9.5pt; color: #1e3a5f; text-transform: uppercase; letter-spacing: 1.5px; border-bottom: 1pt solid #1e3a5f; }
        tbody tr.section-row { background: #f4f7fb; }
        tbody tr.section-row td { padding: 2mm 1.5mm; font-weight: 650; font-size: 9pt; color: #1e3a5f; }
        .lead-tag { font-weight: 500; font-style: italic; font-size: 8pt; color: #64748b; white-space: nowrap; }
        tbody tr.item-row td { padding: 1.7mm 1.5mm; border-bottom: 0.4pt solid #e8edf3; vertical-align: top; color: #334155; }
        tbody tr.item-row td:first-child { color: #1f2937; }
        tbody tr.sub-row td { padding: 1mm 1.5mm 1mm 8mm; border-bottom: 0.4pt solid #f1f5f9; color: #64748b; font-size: 8.5pt; font-style: italic; }
        td.right { text-align: right; }
        td.num { text-align: right; font-variant-numeric: tabular-nums; white-space: nowrap; }
        td.lead { white-space: nowrap; }

        .totals-wrap { display: flex; justify-content: flex-end; margin-top: 5mm; }
        .totals { width: 88mm; }
        .totals-row { display: flex; justify-content: space-between; padding: 1.4mm 3mm; font-size: 9.5pt; color: #475569; border-bottom: 0.4pt solid #e8edf3; font-variant-numeric: tabular-nums; }
        .totals-row span:last-child { font-weight: 650; color: #0f172a; }
        .totals-row.grand { background: #1e3a5f; color: #fff; border: none; border-radius: 1.5mm; font-weight: 700; font-size: 11pt; padding: 2.4mm 3mm; margin-top: 1.5mm; }
        .totals-row.grand span:last-child { color: #fff; font-weight: 800; }

        .terms { margin-top: 8mm; padding-top: 2mm; page-break-inside: avoid; }
        .terms-title { font-size: 8pt; font-weight: 800; text-transform: uppercase; letter-spacing: 2px; color: #1e3a5f; border-left: 2.5pt solid #1e3a5f; padding-left: 2.5mm; margin-bottom: 2.5mm; }
        .terms-header { font-weight: 650; text-decoration: underline; text-underline-offset: 2px; margin-top: 1.8mm; line-height: 1.55; color: #1f2937; font-size: 8.5pt; white-space: pre-wrap; }
        .terms-line { font-style: italic; line-height: 1.55; color: #475569; font-size: 8.5pt; white-space: pre-wrap; }
        .terms-thanks { font-weight: 700; font-style: italic; margin-top: 2.5mm; line-height: 1.5; color: #1e3a5f; font-size: 8.5pt; white-space: pre-wrap; }

        .footer { margin-top: 10mm; padding-top: 4mm; border-top: 0.5pt solid #e2e8f0; display: grid; grid-template-columns: 1fr 1fr; gap: 8mm; font-size: 8.5pt; color: #64748b; }
        .sig-label { font-size: 7pt; font-weight: 700; text-transform: uppercase; letter-spacing: 1.2px; color: #94a3b8; margin-bottom: 10mm; }
        .sig-line { border-bottom: 0.6pt solid #cbd5e1; margin-bottom: 1.2mm; height: 8mm; }
        .sig-name { font-size: 8pt; color: #475569; text-align: center; font-weight: 600; }

        .print-btn { position: fixed; bottom: 20px; right: 20px; padding: 11px 22px; background: #1e3a5f; color: #fff; border: none; border-radius: 10px; font-size: 13px; font-weight: 600; cursor: pointer; box-shadow: 0 6px 20px rgba(15,23,42,0.25); }
      `}</style>

      <div className="page">
        {/* Header */}
        <div className="header">
          <div>
            <div className="company-name">{companyName || 'ICAPROC'}</div>
          </div>
          <div className="doc-title">
            <div className="doc-label">Penawaran Harga</div>
            <div className="quote-num">{quote.quote_number}</div>
            <div className="quote-date">{fmtDate(quote.quote_date)}</div>
          </div>
        </div>

        {/* Meta: customer */}
        <div className="meta">
          <div>
            <div className="meta-label">Kepada Yth.</div>
            <div className="meta-value">{quote.customer_name || '—'}</div>
            {quote.customer_address && (
              <div className="meta-sub" style={{ whiteSpace: 'pre-line' }}>{quote.customer_address}</div>
            )}
          </div>
          {quote.location ? (
            <div style={{ textAlign: 'right' }}>
              <div className="meta-label">Lokasi / Site</div>
              <div className="meta-value">{quote.location}</div>
            </div>
          ) : <div />}
        </div>

        {/* Project description */}
        {quote.project_description && (
          <div className="project-bar">
            <div className="project-label">Perihal / Project</div>
            {quote.project_description}
          </div>
        )}

        {/* Items table — client-facing: amounts only at sub-section level */}
        <table>
          <thead>
            <tr>
              <th>Items</th>
              {cols.brand && <th style={{ width: '75px' }}>Brand</th>}
              {cols.qty && <th className="right" style={{ width: '60px' }}>Qty</th>}
              {cols.unit && <th style={{ width: '60px' }}>Unit</th>}
              {cols.amount && <th className="right" style={{ width: '95px' }}>Amount</th>}
            </tr>
          </thead>
          <tbody>
            {SECTION_GROUPS.map((group) => {
              const groupSecs = sections.filter((s) => s.group_key === group.key);
              if (!groupSecs.length) return null;
              const colCount = 1 + (cols.brand ? 1 : 0) + (cols.qty ? 1 : 0) + (cols.unit ? 1 : 0) + (cols.amount ? 1 : 0);
              return (
                <React.Fragment key={group.key}>
                  <tr className="group-row">
                    <td colSpan={colCount}>{group.label}</td>
                  </tr>
                  {groupSecs.map((sec) => {
                    const mainItems = sec.items.filter((i) => !i.parent_item_id);
                    const secTotal = sectionTotal(sec);
                    return (
                      <React.Fragment key={sec.section_id}>
                        <tr className="section-row">
                          <td colSpan={colCount - (cols.amount ? 1 : 0)}>
                            {sec.title}
                            {cols.lead && sec.lead_time && <span className="lead-tag"> · lead time {sec.lead_time}</span>}
                          </td>
                          {cols.amount && <td className="num">{secTotal > 0 ? fmtIdr(secTotal) : ''}</td>}
                        </tr>
                        {mainItems.map((item) => {
                          const subItems = sec.items.filter((i) => i.parent_item_id === item.item_id);
                          return (
                            <React.Fragment key={item.item_id}>
                              <tr className="item-row">
                                <td>{item.description}</td>
                                {cols.brand && <td style={{ color: '#64748b' }}>{item.brand}</td>}
                                {cols.qty && <td className="num">{item.quantity != null ? Number(item.quantity).toLocaleString('en-US') : ''}</td>}
                                {cols.unit && <td style={{ color: '#64748b', whiteSpace: 'nowrap' }}>{item.unit}</td>}
                                {cols.amount && <td />}
                              </tr>
                              {subItems.map((sub) => (
                                <tr key={sub.item_id} className="sub-row">
                                  <td colSpan={1 + (cols.brand ? 1 : 0)}>↳ {sub.description}{sub.brand ? ` — ${sub.brand}` : ''}</td>
                                  {cols.qty && <td className="num">{sub.quantity != null ? Number(sub.quantity).toLocaleString('en-US') : ''}</td>}
                                  {cols.unit && <td style={{ whiteSpace: 'nowrap' }}>{sub.unit}</td>}
                                  {cols.amount && <td />}
                                </tr>
                              ))}
                              {sec.group_key === 'solar_panels' && itemWp(item) > 0 && (item.unit ?? '').trim().toLowerCase() !== 'wp' && (
                                <tr className="sub-row">
                                  <td colSpan={1 + (cols.brand ? 1 : 0)} style={{ color: '#047857' }}>Total system size</td>
                                  {cols.qty && <td className="num" style={{ color: '#047857', fontWeight: 700 }}>{itemWp(item).toLocaleString('en-US')}</td>}
                                  {cols.unit && <td style={{ color: '#047857' }}>Wp</td>}
                                  {cols.amount && <td />}
                                </tr>
                              )}
                            </React.Fragment>
                          );
                        })}
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
              <span>Total (excld. PPN{ppnPct}%)</span>
              <span>{fmtIdr(subtotal)}</span>
            </div>
            <div className="totals-row">
              <span>PPN{ppnPct}%</span>
              <span>{fmtIdr(ppn)}</span>
            </div>
            <div className="totals-row grand">
              <span>GRAND TOTAL</span>
              <span>{fmtIdr(grandTotal)}</span>
            </div>
            {totalWp > 0 && (
              <>
                <div className="totals-row" style={{ fontWeight: 700, marginTop: '2mm' }}>
                  <span>Harga per Wp (Exc. PPN{ppnPct}%)</span>
                  <span>{fmtIdr(subtotal / totalWp)}</span>
                </div>
                <div className="totals-row" style={{ fontWeight: 700 }}>
                  <span>Harga per Wp (Inc. PPN{ppnPct}%)</span>
                  <span>{fmtIdr(grandTotal / totalWp)}</span>
                </div>
              </>
            )}
          </div>
        </div>

        {/* Terms and Conditions */}
        {quote.notes && (
          <div className="terms">
            <div className="terms-title">Terms and Conditions</div>
            {quote.notes.split('\n').map((line, i) => {
              const t = line.trim();
              if (!t) return <div key={i} style={{ height: '2mm' }} />;
              if (/:$/.test(t)) return <div key={i} className="terms-header">{line}</div>;
              if (/^thank you/i.test(t)) return <div key={i} className="terms-thanks">{line}</div>;
              return <div key={i} className="terms-line">{line}</div>;
            })}
          </div>
        )}

        {/* Signature footer */}
        <div className="footer">
          <div>
            <div className="sig-label">Hormat kami,</div>
            <div className="sig-line" />
            <div className="sig-name">{companyName || '(perusahaan)'}</div>
          </div>
          <div>
            <div className="sig-label">Disetujui oleh,</div>
            <div className="sig-line" />
            <div className="sig-name">{quote.customer_name || '(nama & jabatan)'}</div>
          </div>
        </div>
      </div>

      {/* Column toggles + print button (hidden when printing) */}
      <div className="no-print" style={{ position: 'fixed', bottom: '20px', left: '20px', background: '#fff', border: '1px solid #e2e8f0', borderRadius: '12px', padding: '12px 14px', boxShadow: '0 6px 20px rgba(15,23,42,0.15)', fontSize: '12px', color: '#334155' }}>
        <p style={{ fontSize: '10px', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '1px', color: '#94a3b8', marginBottom: '8px' }}>Columns</p>
        {EXPORT_COL_KEYS.map((k) => (
          <label key={k} style={{ display: 'flex', alignItems: 'center', gap: '7px', marginBottom: '5px', cursor: 'pointer' }}>
            <input type="checkbox" checked={cols[k]} onChange={(e) => setCol(k, e.target.checked)} />
            {EXPORT_COL_LABELS[k]}
          </label>
        ))}
        <p style={{ fontSize: '10px', color: '#94a3b8', marginTop: '6px', maxWidth: '150px' }}>Also applies to the Excel export</p>
      </div>
      <button className="print-btn no-print" onClick={() => window.print()}>
        Print / Save PDF
      </button>
    </>
  );
}
