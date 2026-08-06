'use client';
/**
 * The printable Surat Dukungan — the paper the reseller attaches to their
 * tender. Layout follows the letter the company has always issued: our
 * letterhead, the addressee, the undersigned block, the supported party, the
 * material table (Nama Barang / Tipe / Garansi), the undertakings, the
 * validity clause, then place, date and signature.
 *
 * Everything is stored on the letter itself, so a document printed today and
 * one printed next year say exactly the same thing. PDF via the browser's
 * Print → Save as PDF (document.title becomes the filename).
 */
import { useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { createSupabaseClient } from '@/lib/supabase';
import { useAuth } from '@/hooks/useAuth';
import { ROLE_PERMISSIONS } from '@/constants/roles';
import { useSettings } from '@/hooks/useSettings';
import { fmtDateID, statementLines, type SupportLetter, type SupportLetterItem } from '@/lib/supportLetters';

export default function SupportLetterPrintPage() {
  const { id } = useParams<{ id: string }>();
  const supabase = createSupabaseClient();
  const router = useRouter();
  const settings = useSettings();
  const { user, profile, loading: authLoading } = useAuth();

  const [letter, setLetter] = useState<SupportLetter | null>(null);
  const [items, setItems] = useState<SupportLetterItem[]>([]);
  const [companyName, setCompanyName] = useState('');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (authLoading) return;
    if (!user) { router.replace(`/login?next=${encodeURIComponent(`/support-letters/${id}/print`)}`); return; }
    if (profile && !ROLE_PERMISSIONS[profile.role].sellSide) router.replace('/unauthorized');
  }, [authLoading, user, profile, id, router]);

  useEffect(() => {
    if (!user) return;
    (async () => {
      const [lRes, iRes] = await Promise.all([
        supabase.from('28.0_support_letters').select('*').eq('letter_id', id).single(),
        supabase.from('28.1_support_letter_items').select('*').eq('letter_id', id).order('sort_order'),
      ]);
      const l = (lRes.data as SupportLetter) ?? null;
      setLetter(l);
      setItems((iRes.data as SupportLetterItem[]) ?? []);
      if (l?.company_id) {
        const { data } = await supabase.from('1.0_companies').select('legal_name').eq('company_id', l.company_id).maybeSingle();
        setCompanyName((data as { legal_name: string } | null)?.legal_name ?? '');
      }
      setLoading(false);
    })();
  }, [user, id]);   // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (letter) document.title = `${letter.letter_number || 'Surat Dukungan'}${letter.supported_company_name ? ` - ${letter.supported_company_name}` : ''}`;
  }, [letter]);

  if (authLoading || !user || loading || !letter) {
    return <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: '100vh', fontFamily: 'sans-serif', color: '#666' }}>Menyiapkan dokumen…</div>;
  }

  const issuer = companyName || settings.companyName || 'ICAPROC';
  const clauses = statementLines(letter.statements);

  return (
    <>
      <style>{`
        * { margin: 0; padding: 0; box-sizing: border-box; }
        body { font-family: Rubik, -apple-system, 'Segoe UI', 'Helvetica Neue', Helvetica, Arial, sans-serif; font-size: 10.5pt; color: #1f2937; background: #fff; -webkit-font-smoothing: antialiased; line-height: 1.6; }
        @page { size: A4; margin: 14mm 16mm; }
        @media print { .no-print { display: none !important; } body { -webkit-print-color-adjust: exact; print-color-adjust: exact; } .page { max-width: none; padding: 0; } }
        .page { max-width: 210mm; margin: 0 auto; padding: 10mm 12mm; }
        .header { display: flex; justify-content: space-between; align-items: flex-start; padding-bottom: 3mm; border-bottom: 2.5pt solid #1f5aa8; }
        .company-name { font-size: 15pt; font-weight: 800; color: #1f5aa8; letter-spacing: -0.3px; }
        .company-meta { font-size: 8pt; color: #64748b; line-height: 1.45; margin-top: 1mm; max-width: 92mm; }
        .doc-title { text-align: center; margin: 7mm 0 6mm; }
        .doc-title h1 { font-size: 14pt; font-weight: 800; letter-spacing: 0.5px; text-decoration: underline; text-underline-offset: 3px; color: #0f172a; }
        .doc-num { font-size: 10.5pt; margin-top: 1.5mm; color: #334155; }
        .to-block { margin-bottom: 6mm; }
        .to-label { font-weight: 700; }
        .to-name { font-weight: 700; }
        .to-addr { color: #334155; white-space: pre-line; }
        .lead { margin-bottom: 2mm; }
        .party { margin: 0 0 5mm 6mm; }
        .party-row { display: flex; gap: 2mm; }
        .party-key { width: 32mm; flex-shrink: 0; }
        .party-val { font-weight: 600; color: #0f172a; white-space: pre-line; }
        table { width: 100%; border-collapse: collapse; font-size: 10pt; margin: 2mm 0 5mm; }
        th, td { border: 0.6pt solid #94a3b8; padding: 1.8mm 2.5mm; text-align: left; vertical-align: top; }
        th { background: #eef3fa; font-weight: 700; font-size: 9.5pt; color: #1f2937; }
        td.no, th.no { width: 12mm; text-align: center; }
        td.wty, th.wty { width: 28mm; white-space: nowrap; }
        ol { margin: 0 0 5mm 6mm; padding-left: 5mm; }
        ol li { margin-bottom: 1.5mm; text-align: justify; }
        p.body { margin-bottom: 4mm; text-align: justify; }
        .sign { margin-top: 8mm; display: flex; justify-content: flex-end; page-break-inside: avoid; }
        .sign-inner { width: 78mm; text-align: center; }
        .sign-space { height: 24mm; }
        .sign-name { font-weight: 700; text-decoration: underline; text-underline-offset: 2px; }
        .sign-title { color: #334155; }
        .toolbar { position: fixed; top: 14px; right: 14px; display: flex; gap: 8px; z-index: 50; }
        .print-btn { padding: 10px 20px; background: #1f5aa8; color: #fff; border: none; border-radius: 10px; font-size: 13px; font-weight: 600; cursor: pointer; box-shadow: 0 6px 20px rgba(15,23,42,0.25); }
        .print-btn.ghost { background: #fff; color: #1f5aa8; border: 1px solid #cbd5e1; }
        .draft-note { background: #fef3c7; border: 1pt solid #f59e0b; color: #92400e; padding: 2mm 3mm; border-radius: 2mm; font-size: 9pt; margin-bottom: 5mm; }
      `}</style>

      <div className="toolbar no-print">
        <button className="print-btn ghost" onClick={() => router.push('/support-letters')}>← Back</button>
        <button className="print-btn" onClick={() => window.print()}>Print / Save PDF</button>
      </div>

      <div className="page">
        {/* Letterhead */}
        <div className="header">
          <div>
            <div className="company-name">{issuer}</div>
            {(settings.companyAddress || settings.companyPhone || settings.companyEmail) && (
              <div className="company-meta">
                {settings.companyAddress && <div style={{ whiteSpace: 'pre-line' }}>{settings.companyAddress}</div>}
                {[settings.companyPhone, settings.companyEmail].filter(Boolean).join(' · ') && (
                  <div>{[settings.companyPhone, settings.companyEmail].filter(Boolean).join(' · ')}</div>
                )}
              </div>
            )}
          </div>
        </div>

        {letter.status !== 'issued' && (
          <div className="draft-note no-print">
            This letter is <strong>{letter.status === 'draft' ? 'a draft' : 'cancelled'}</strong>
            {!letter.fee_paid_at && Number(letter.fee_amount) > 0 ? ' and the administration fee has not been recorded as received.' : '.'}
          </div>
        )}

        <div className="doc-title">
          <h1>Surat Dukungan</h1>
          <div className="doc-num">Nomor: {letter.letter_number || '—'}</div>
        </div>

        {/* Kepada Yth. */}
        <div className="to-block">
          <div className="to-label">Kepada Yth.</div>
          <div className="to-name">{letter.end_user_name || '—'}</div>
          {letter.end_user_address && <div className="to-addr">{letter.end_user_address}</div>}
        </div>

        {/* Us */}
        <p className="lead">Yang bertanda tangan di bawah ini:</p>
        <div className="party">
          <Row k="Nama" v={letter.signatory_name} />
          <Row k="Jabatan" v={letter.signatory_title} />
          <Row k="Perusahaan" v={issuer} />
          <Row k="Alamat" v={settings.companyAddress} />
          <Row k="Telp." v={settings.companyPhone} />
        </div>

        <p className="lead">
          Selaku distributor resmi dari produk Merk <strong>{letter.brands || '—'}</strong> dengan ini memberikan
          dukungan penuh kepada:
        </p>
        <div className="party">
          <Row k="Nama" v={letter.supported_person_name} />
          <Row k="Jabatan" v={letter.supported_person_title} />
          <Row k="Perusahaan" v={letter.supported_company_name} />
          <Row k="Alamat" v={letter.supported_company_address} />
          <Row k="Pekerjaan" v={letter.project_name} />
        </div>

        {/* Material yang didukung */}
        {items.length > 0 && (
          <>
            <p className="lead">Material yang didukung:</p>
            <table>
              <thead>
                <tr>
                  <th className="no">No</th>
                  <th>Nama Barang</th>
                  <th>Tipe</th>
                  <th className="wty">Garansi</th>
                </tr>
              </thead>
              <tbody>
                {items.map((it, i) => (
                  <tr key={it.item_id}>
                    <td className="no">{i + 1}</td>
                    <td>{it.category_label}</td>
                    <td>{it.type_text}</td>
                    <td className="wty">{it.warranty_text || '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </>
        )}

        {clauses.length > 0 && (
          <>
            <p className="lead">Melalui surat dukungan ini kami menyatakan bahwa:</p>
            <ol>{clauses.map((c, i) => <li key={i}>{c}</li>)}</ol>
          </>
        )}

        {letter.validity_note && <p className="body">{letter.validity_note}</p>}
        {letter.closing_note && <p className="body">{letter.closing_note}</p>}

        {/* Signature */}
        <div className="sign">
          <div className="sign-inner">
            <div>{[letter.place_of_issue, fmtDateID(letter.letter_date)].filter(Boolean).join(', ')}</div>
            <div>{issuer}</div>
            <div className="sign-space" />
            <div className="sign-name">{letter.signatory_name || ' '}</div>
            <div className="sign-title">{letter.signatory_title}</div>
          </div>
        </div>
      </div>
    </>
  );
}

/** One "Key : Value" line of a party block. */
function Row({ k, v }: { k: string; v?: string | null }) {
  return (
    <div className="party-row">
      <span className="party-key">{k}</span>
      <span>:&nbsp;</span>
      <span className="party-val">{v || '—'}</span>
    </div>
  );
}
