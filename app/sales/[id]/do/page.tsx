'use client';
/**
 * Delivery Order (Surat Jalan) print view — the paper the warehouse/driver
 * carries. NO PRICES anywhere: item descriptions, qty, unit, and the delivery
 * instructions (target date/time, method, address + Maps link, contact),
 * plus signature boxes for warehouse, driver, and receiver.
 * PDF via the browser's Print → Save as PDF (document.title = filename).
 */
import React, { useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { createSupabaseClient } from '@/lib/supabase';
import { useAuth } from '@/hooks/useAuth';

interface Quote {
  quote_id: string; quote_number: string; order_number?: string; invoice_number?: string; do_number?: string;
  customer_id: string | null; company_id: string | null; status: string;
  preparing_at?: string | null; delivered_at?: string | null;
  delivery_date?: string | null; delivery_time?: string; delivery_method?: string; delivery_via?: string;
  delivery_address?: string; delivery_map_url?: string; delivery_contact?: string;
  notes: string;
}
interface Line { item_id: string; is_section: boolean; description: string; note: string; unit: string; quantity: number; sort_order: number; }

function fmtDate(d?: string | null) {
  if (!d) return '';
  return new Date(d.length <= 10 ? `${d}T00:00:00` : d).toLocaleDateString('id-ID', { day: '2-digit', month: 'long', year: 'numeric' });
}

export default function DeliveryOrderPrintPage() {
  const { id } = useParams<{ id: string }>();
  const supabase = createSupabaseClient();
  const router = useRouter();
  const { user, loading: authLoading } = useAuth();

  const [quote, setQuote] = useState<Quote | null>(null);
  const [lines, setLines] = useState<Line[]>([]);
  const [companyName, setCompanyName] = useState('');
  const [customerName, setCustomerName] = useState('');
  const [loading, setLoading] = useState(true);

  useEffect(() => { if (!authLoading && !user) router.replace(`/login?next=${encodeURIComponent(`/sales/${id}/do`)}`); }, [authLoading, user, id, router]);

  useEffect(() => {
    if (!user) return;
    async function load() {
      const [qRes, iRes, coRes] = await Promise.all([
        supabase.from('22.0_sales_quotes').select('*').eq('quote_id', id).single(),
        supabase.from('22.1_sales_quote_items').select('item_id, is_section, description, note, unit, quantity, sort_order').eq('quote_id', id).order('sort_order'),
        supabase.from('1.0_companies').select('company_id, legal_name'),
      ]);
      if (!qRes.data) { setLoading(false); return; }
      let q = qRes.data as Quote;
      // ?do=<do_id> prints a SPECIFIC delivery order (split shipments) — its
      // own number, its own lines, its own instructions. No param = legacy
      // order-level Surat Jalan.
      const doId = new URLSearchParams(window.location.search).get('do');
      let doLines: Line[] | null = null;
      if (doId) {
        const [dRes, diRes] = await Promise.all([
          supabase.from('24.0_delivery_orders').select('*').eq('do_id', doId).single(),
          supabase.from('24.1_delivery_order_items').select('do_item_id, description, unit, qty, sort_order').eq('do_id', doId).order('sort_order'),
        ]);
        if (dRes.data) {
          const d = dRes.data as { do_number: string; delivery_date: string | null; delivery_time: string; delivery_method: string; delivery_via: string; delivery_address: string; delivery_map_url: string; delivery_contact: string; created_at: string; delivered_at: string | null };
          q = {
            ...q, do_number: d.do_number, delivery_date: d.delivery_date, delivery_time: d.delivery_time,
            delivery_method: d.delivery_method, delivery_via: d.delivery_via, delivery_address: d.delivery_address,
            delivery_map_url: d.delivery_map_url, delivery_contact: d.delivery_contact,
            preparing_at: d.created_at, delivered_at: d.delivered_at,
          };
          doLines = (((diRes.data ?? []) as { do_item_id: string; description: string; unit: string; qty: number; sort_order: number }[])
            .map((x) => ({ item_id: x.do_item_id, is_section: false, description: x.description, note: '', unit: x.unit, quantity: Number(x.qty) || 0, sort_order: x.sort_order })));
        }
      }
      setQuote(q);
      setCompanyName(((coRes.data ?? []).find((c) => c.company_id === q.company_id)?.legal_name as string) ?? '');
      if (q.customer_id) {
        const { data: cust } = await supabase.from('20.0_customers').select('display_name, legal_name').eq('customer_id', q.customer_id).single();
        if (cust) setCustomerName((cust.legal_name as string) || (cust.display_name as string) || '');
      }
      setLines(doLines ?? ((iRes.data as Line[]) ?? []));
      setLoading(false);
    }
    load();
  }, [user, id]);

  useEffect(() => {
    if (!loading && quote) document.title = `${quote.do_number || 'DO'}${customerName ? ` - ${customerName}` : ''}`;
  }, [loading, quote, customerName]);

  if (authLoading || !user || loading || !quote) {
    return <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: '100vh', fontFamily: 'sans-serif', color: '#666' }}>Preparing document…</div>;
  }

  const items = lines.filter((l) => !l.is_section);
  const isPickup = quote.delivery_method === 'pickup';
  // Continuous numbering (sections don't count)
  const itemNo = new Map<string, number>();
  { let n = 0; for (const l of lines) if (!l.is_section) itemNo.set(l.item_id, ++n); }

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
        .do-num { font-size: 12.5pt; font-weight: 700; color: #1f5aa8; }
        .doc-sub { font-size: 8pt; color: #64748b; margin-top: 0.8mm; }
        .meta { display: grid; grid-template-columns: 1fr 1fr; gap: 4mm; margin-bottom: 5mm; }
        .meta-label { font-size: 7pt; font-weight: 700; text-transform: uppercase; letter-spacing: 1.2px; color: #94a3b8; margin-bottom: 1mm; }
        .meta-value { font-size: 10.5pt; font-weight: 600; color: #0f172a; line-height: 1.4; }
        .meta-sub { font-size: 9pt; color: #475569; line-height: 1.45; white-space: pre-line; }
        .instr { background: #edf3fa; border-left: 2.5pt solid #1f5aa8; border-radius: 0 1.5mm 1.5mm 0; padding: 3mm 3.5mm; margin-bottom: 5mm; }
        .instr-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 2mm 6mm; font-size: 9pt; }
        .instr-grid .k { font-size: 7pt; font-weight: 700; text-transform: uppercase; letter-spacing: 1px; color: #64748b; }
        .instr-grid .v { color: #0f172a; font-weight: 600; white-space: pre-line; }
        table { width: 100%; border-collapse: collapse; font-size: 9.5pt; }
        thead th { padding: 2mm 1.5mm; text-align: left; font-size: 7pt; font-weight: 700; text-transform: uppercase; letter-spacing: 1.2px; color: #64748b; border-bottom: 1.5pt solid #1f5aa8; white-space: nowrap; }
        thead th.right { text-align: right; }
        tbody tr.group-row td { padding: 4mm 1.5mm 1.4mm; font-weight: 800; font-size: 9pt; color: #1f5aa8; text-transform: uppercase; letter-spacing: 1.5px; border-bottom: 1pt solid #1f5aa8; }
        tbody tr.item-row td { padding: 2mm 1.5mm; border-bottom: 0.4pt solid #e8edf3; vertical-align: top; color: #1f2937; }
        tbody tr.note-row td { padding: 0.6mm 1.5mm 1.6mm 8mm; border-bottom: 0.4pt solid #f1f5f9; color: #64748b; font-size: 8.5pt; font-style: italic; }
        td.num { text-align: right; font-variant-numeric: tabular-nums; white-space: nowrap; }
        td.check { width: 12mm; }
        .checkbox { display: inline-block; width: 4mm; height: 4mm; border: 0.6pt solid #94a3b8; border-radius: 0.8mm; }
        .note { margin-top: 4mm; font-size: 8pt; color: #94a3b8; line-height: 1.5; }
        .footer { margin-top: 12mm; display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 6mm; font-size: 8.5pt; color: #64748b; }
        .sig-label { font-size: 7pt; font-weight: 700; text-transform: uppercase; letter-spacing: 1.2px; color: #94a3b8; margin-bottom: 14mm; }
        .sig-line { border-bottom: 0.6pt solid #cbd5e1; margin-bottom: 1.2mm; }
        .sig-name { font-size: 8pt; color: #475569; text-align: center; }
        .print-btn { padding: 11px 22px; background: #1f5aa8; color: #fff; border: none; border-radius: 10px; font-size: 13px; font-weight: 600; cursor: pointer; box-shadow: 0 6px 20px rgba(15,23,42,0.25); }
        .print-btn:hover { background: #1a4e91; }
      `}</style>

      <div className="page">
        <div className="header">
          <div><div className="company-name">{companyName || 'ICAPROC'}</div></div>
          <div className="doc-title">
            <div className="doc-label">Surat Jalan · Delivery Order</div>
            <div className="do-num">{quote.do_number || '(belum terbit)'}</div>
            <div className="doc-sub">Ref: {quote.order_number || quote.quote_number}{quote.invoice_number ? ` · ${quote.invoice_number}` : ''}</div>
            <div className="doc-sub">Diterbitkan: {fmtDate(quote.preparing_at || quote.delivered_at)}</div>
          </div>
        </div>

        <div className="meta">
          <div>
            <div className="meta-label">Kepada</div>
            <div className="meta-value">{customerName || '—'}</div>
            {!isPickup && quote.delivery_address && <div className="meta-sub">{quote.delivery_address}</div>}
            {isPickup && <div className="meta-sub">Diambil sendiri di gudang (pick-up)</div>}
          </div>
          <div style={{ textAlign: 'right' }}>
            <div className="meta-label">Kontak Penerima</div>
            <div className="meta-value">{quote.delivery_contact || '—'}</div>
          </div>
        </div>

        {/* Delivery instructions — no prices anywhere on this document */}
        <div className="instr">
          <div className="instr-grid">
            <div><div className="k">Target pengiriman</div><div className="v">{fmtDate(quote.delivery_date)}{quote.delivery_time ? ` · ${quote.delivery_time}` : ''}</div></div>
            <div><div className="k">Metode</div><div className="v">{isPickup ? 'Pick-up oleh customer' : `Dikirim${quote.delivery_via ? ` · ${quote.delivery_via}` : ''}`}</div></div>
            {quote.delivery_map_url && (
              <div style={{ gridColumn: '1 / -1' }}><div className="k">Lokasi (Google Maps)</div><div className="v" style={{ fontWeight: 400, fontSize: '8.5pt', wordBreak: 'break-all' }}>{quote.delivery_map_url}</div></div>
            )}
          </div>
        </div>

        <table>
          <thead>
            <tr>
              <th style={{ width: '28px' }}>No.</th>
              <th>Deskripsi Barang</th>
              <th className="right" style={{ width: '70px' }}>Qty</th>
              <th style={{ width: '70px' }}>Satuan</th>
              <th className="check">Cek ✓</th>
            </tr>
          </thead>
          <tbody>
            {lines.map((l) => {
              if (l.is_section) {
                return <tr key={l.item_id} className="group-row"><td colSpan={5}>{l.description}</td></tr>;
              }
              return (
                <React.Fragment key={l.item_id}>
                  <tr className="item-row">
                    <td className="num" style={{ color: '#94a3b8' }}>{itemNo.get(l.item_id)}</td>
                    <td>{l.description || '—'}</td>
                    <td className="num" style={{ fontWeight: 700 }}>{Number(l.quantity).toLocaleString('en-US')}</td>
                    <td style={{ color: '#64748b' }}>{l.unit}</td>
                    <td className="check"><span className="checkbox" /></td>
                  </tr>
                  {l.note && <tr className="note-row"><td colSpan={5}>↳ {l.note}</td></tr>}
                </React.Fragment>
              );
            })}
            {items.length === 0 && (
              <tr className="item-row"><td colSpan={5} style={{ color: '#94a3b8', fontStyle: 'italic' }}>Tidak ada item.</td></tr>
            )}
          </tbody>
        </table>

        <p className="note">
          Barang telah diperiksa dan diterima dalam kondisi baik dan jumlah yang sesuai. Dokumen ini bukan bukti tagihan — tidak memuat harga.
        </p>

        <div className="footer">
          <div>
            <div className="sig-label">Disiapkan oleh (Gudang)</div>
            <div className="sig-line" />
            <div className="sig-name">(nama & tanda tangan)</div>
          </div>
          <div>
            <div className="sig-label">Pengirim / Driver</div>
            <div className="sig-line" />
            <div className="sig-name">(nama & tanda tangan)</div>
          </div>
          <div>
            <div className="sig-label">Diterima oleh</div>
            <div className="sig-line" />
            <div className="sig-name">(nama, tanggal & tanda tangan)</div>
          </div>
        </div>
      </div>

      <div className="no-print" style={{ position: 'fixed', bottom: '20px', right: '20px', zIndex: 50 }}>
        <button className="print-btn" onClick={() => window.print()}>Print / Save PDF</button>
      </div>
    </>
  );
}
