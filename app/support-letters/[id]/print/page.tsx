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
import { useEffect, useRef, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { createSupabaseClient } from '@/lib/supabase';
import { useAuth } from '@/hooks/useAuth';
import { ROLE_PERMISSIONS } from '@/constants/roles';
import { useSettings } from '@/hooks/useSettings';
import { fmtDateID, statementLines, type SupportLetter, type SupportLetterItem } from '@/lib/supportLetters';

/** CSS pixels per millimetre at the 96dpi the print pipeline assumes. */
const MM = 96 / 25.4;
const HEAD_SPACE_KEY = 'icaproc.suratDukungan.headSpaceMm';

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

  // How much of the top to leave blank for pre-printed letterhead paper.
  // 0 = plain stock, print our own letterhead instead. Remembered per browser.
  const [headSpace, setHeadSpace] = useState(30);
  useEffect(() => {
    const raw = window.localStorage.getItem(HEAD_SPACE_KEY);
    if (raw !== null && !isNaN(Number(raw))) setHeadSpace(Number(raw));
  }, []);
  useEffect(() => {
    try { window.localStorage.setItem(HEAD_SPACE_KEY, String(headSpace)); } catch {}
  }, [headSpace]);

  /**
   * One sheet, always. The type is sized so an ordinary letter (five-ish
   * materials, three clauses) fits at full size; a longer one is scaled down
   * to fit rather than spilling onto a second page nobody wants to sign.
   * `zoom` is a layout property in Blink, so the printed page scales with it.
   * Below the floor we stop shrinking and say so — that letter needs editing,
   * not smaller print.
   */
  const bodyRef = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(1);
  const [fits, setFits] = useState(true);
  useEffect(() => {
    const el = bodyRef.current;
    if (!el) return;
    const MIN_SCALE = 0.8;
    const measure = () => {
      const availableMm = 297 - 24;      // A4 less the @page top/bottom margins
      el.style.zoom = '1';               // always measure the natural height
      const naturalMm = el.scrollHeight / MM;
      const s = naturalMm <= availableMm ? 1 : Math.max(MIN_SCALE, availableMm / naturalMm);
      el.style.zoom = String(s);
      setScale(s);
      setFits(naturalMm * s <= availableMm + 1);
    };
    measure();
    // Web fonts land after first paint and change every line height
    document.fonts?.ready.then(measure).catch(() => {});
  }, [letter, items, headSpace, loading]);

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
      {/* One A4 page, and the top left blank for the pre-printed letterhead
          (owner, 2026-08-06). Page margins stay modest; the blank band is a
          spacer whose height the user picks, so switching to plain paper is a
          toggle rather than a different stylesheet. Every dimension below is
          tuned to keep a normal letter — five-ish materials, three clauses —
          on a single sheet. */}
      <style>{`
        * { margin: 0; padding: 0; box-sizing: border-box; }
        body { font-family: Rubik, -apple-system, 'Segoe UI', 'Helvetica Neue', Helvetica, Arial, sans-serif; font-size: 9.5pt; color: #1f2937; background: #f1f5f9; -webkit-font-smoothing: antialiased; line-height: 1.34; }
        @page { size: A4; margin: 12mm 16mm 12mm 16mm; }
        @media print {
          .no-print { display: none !important; }
          body { background: #fff; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
          .page { width: auto; min-height: 0; margin: 0; padding: 0; box-shadow: none; }
          .letterhead-space { border: none !important; }
          .letterhead-space span { display: none !important; }
        }
        /* On screen the sheet is drawn to scale so the reserved band is visible */
        .page { width: 210mm; min-height: 297mm; margin: 24px auto; padding: 12mm 16mm; background: #fff; box-shadow: 0 10px 40px rgba(15,23,42,0.18); }
        .letterhead-space { border: 1px dashed #cbd5e1; display: flex; align-items: center; justify-content: center; }
        .letterhead-space span { font-size: 8pt; letter-spacing: 2px; text-transform: uppercase; color: #cbd5e1; }
        .header { padding-bottom: 2.5mm; margin-bottom: 1mm; border-bottom: 2pt solid #1f5aa8; }
        .company-name { font-size: 14pt; font-weight: 800; color: #1f5aa8; letter-spacing: -0.3px; }
        .company-meta { font-size: 8pt; color: #64748b; line-height: 1.4; margin-top: 0.8mm; max-width: 92mm; }
        .doc-title { text-align: center; margin: 3mm 0 3mm; }
        .doc-title h1 { font-size: 12.5pt; font-weight: 800; letter-spacing: 0.5px; text-decoration: underline; text-underline-offset: 3px; color: #0f172a; }
        .doc-num { font-size: 9.5pt; margin-top: 0.8mm; color: #334155; }
        .to-block { margin-bottom: 3mm; }
        .to-label, .to-name { font-weight: 700; }
        .to-addr { color: #334155; white-space: pre-line; }
        .lead { margin-bottom: 1.2mm; }
        .party { margin: 0 0 2.6mm 6mm; }
        .party-row { display: flex; gap: 1.5mm; }
        .party-key { width: 30mm; flex-shrink: 0; }
        .party-val { font-weight: 600; color: #0f172a; white-space: pre-line; }
        table { width: 100%; border-collapse: collapse; font-size: 9pt; margin: 1.2mm 0 3mm; page-break-inside: avoid; }
        th, td { border: 0.6pt solid #94a3b8; padding: 1mm 1.8mm; text-align: left; vertical-align: top; line-height: 1.3; }
        th { background: #eef3fa; font-weight: 700; font-size: 8.5pt; color: #1f2937; }
        td.no, th.no { width: 11mm; text-align: center; }
        td.wty, th.wty { width: 26mm; white-space: nowrap; }
        ol { margin: 0 0 2.6mm 6mm; padding-left: 5mm; }
        ol li { margin-bottom: 0.8mm; text-align: justify; }
        p.body { margin-bottom: 2.4mm; text-align: justify; }
        .sign { margin-top: 4mm; display: flex; justify-content: flex-end; page-break-inside: avoid; }
        .sign-inner { width: 76mm; text-align: center; }
        .sign-space { height: 15mm; }
        .sign-name { font-weight: 700; text-decoration: underline; text-underline-offset: 2px; }
        .sign-title { color: #334155; }
        .toolbar { position: fixed; top: 14px; right: 14px; display: flex; align-items: center; gap: 8px; z-index: 50; background: rgba(255,255,255,0.95); padding: 8px 10px; border-radius: 12px; box-shadow: 0 6px 20px rgba(15,23,42,0.18); }
        .toolbar label { font-size: 12px; color: #475569; display: flex; align-items: center; gap: 6px; }
        .toolbar select { font-size: 12px; padding: 5px 7px; border: 1px solid #cbd5e1; border-radius: 8px; color: #1f2937; background: #fff; }
        .print-btn { padding: 9px 18px; background: #1f5aa8; color: #fff; border: none; border-radius: 10px; font-size: 13px; font-weight: 600; cursor: pointer; }
        .print-btn.ghost { background: #fff; color: #1f5aa8; border: 1px solid #cbd5e1; }
        .fitline { font-size: 11px; font-weight: 600; padding: 4px 8px; border-radius: 8px; }
        .fitline.ok { color: #15803d; background: #dcfce7; }
        .fitline.over { color: #b91c1c; background: #fee2e2; }
        .draft-note { background: #fef3c7; border: 1pt solid #f59e0b; color: #92400e; padding: 2mm 3mm; border-radius: 2mm; font-size: 9pt; margin-bottom: 4mm; }
      `}</style>

      <div className="toolbar no-print">
        <button className="print-btn ghost" onClick={() => router.push('/support-letters')}>← Back</button>
        <label title="Blank band left at the top for paper that already carries the printed letterhead">
          Top space
          <select value={headSpace} onChange={(e) => setHeadSpace(Number(e.target.value))}>
            <option value={0}>Plain paper — print our letterhead</option>
            <option value={20}>Letterhead paper · 20 mm</option>
            <option value={30}>Letterhead paper · 30 mm</option>
            <option value={40}>Letterhead paper · 40 mm</option>
            <option value={50}>Letterhead paper · 50 mm</option>
          </select>
        </label>
        <span className={`fitline ${fits ? 'ok' : 'over'}`}
          title={fits
            ? `Measured against the A4 print area${scale < 1 ? ` — scaled to ${Math.round(scale * 100)}% to keep it on one sheet` : ''}`
            : 'Too long even at the smallest size — trim the clauses or the material list'}>
          {fits ? `Fits one page${scale < 1 ? ` · ${Math.round(scale * 100)}%` : ''}` : 'Too long for one page'}
        </span>
        <button className="print-btn" onClick={() => window.print()}>Print / Save PDF</button>
      </div>

      <div className="page">
        {/* Only this wrapper has to fit the sheet — it is what gets measured. */}
        <div className="sheet-body" ref={bodyRef}>
        {/* Either the blank band for pre-printed letterhead paper, or our own
            letterhead when printing on plain stock. */}
        {headSpace > 0 ? (
          <div className="letterhead-space" style={{ height: `${headSpace}mm` }}>
            <span>letterhead area</span>
          </div>
        ) : (
          <div className="header">
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
        )}

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
