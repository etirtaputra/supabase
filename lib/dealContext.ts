/**
 * Deal context — where a supplier quote came from, and why each line was asked
 * for or ordered (owner, 2026-10-09: "the added context will remind users of
 * the place and time, and added context for future negotiations").
 *
 * Measured that day: of 163 supplier quotes, 52 carried their context as
 * hand-typed text in the "PI number" box — "WA Wendy to Eric 2026-10-07 16:55",
 * "WhatsApp Jasmine Epsolar …", "WeChat EP-ICA …", "Email "subject" …" — with
 * WhatsApp spelled two ways and dates in four formats. The text was the right
 * instinct; it now has fields (migrations/deal_context.sql), and the PI number
 * goes back to meaning the supplier's document number.
 */

export const SOURCE_CHANNELS = [
  { value: 'whatsapp', label: 'WhatsApp' },
  { value: 'wechat', label: 'WeChat' },
  { value: 'email', label: 'Email' },
  { value: 'phone', label: 'Phone call' },
  { value: 'meeting', label: 'Meeting / visit' },
  { value: 'price_list', label: 'Price list / PDF' },
  { value: 'website', label: 'Supplier website' },
  { value: 'other', label: 'Other' },
] as const;
export type SourceChannel = (typeof SOURCE_CHANNELS)[number]['value'];

export const channelLabel = (v: string | null | undefined): string =>
  SOURCE_CHANNELS.find((c) => c.value === v)?.label ?? '';

/**
 * Why a line was asked for (quote) or ordered (PO). `needs` names the record
 * the reason points at, so the picker can offer it. A price check is a reason
 * to ASK, never to ORDER — the PO table's constraint refuses it.
 */
export const LINE_REASONS = [
  { value: 'stock', label: 'Stock / restock', needs: null, po: true },
  { value: 'project', label: 'For a project', needs: 'project', po: true },
  { value: 'customer_order', label: 'For a customer order', needs: 'sales_order', po: true },
  { value: 'replacement', label: 'Replaces an old model', needs: 'component', po: true },
  { value: 'warranty', label: 'Warranty / after-sales', needs: null, po: true },
  { value: 'new_product', label: 'New product / trial', needs: null, po: true },
  { value: 'price_check', label: 'Price check only', needs: null, po: false },
  { value: 'other', label: 'Other', needs: null, po: true },
] as const;
export type LineReason = (typeof LINE_REASONS)[number]['value'];

export const reasonsFor = (doc: 'quote' | 'po') => LINE_REASONS.filter((r) => doc === 'quote' || r.po);
export const reasonDef = (v: string | null | undefined) => LINE_REASONS.find((r) => r.value === v) ?? null;

/** What a PO line keeps of a quote line's reason (a price check becomes nothing — re-ask). */
export const reasonForPo = (v: string | null | undefined): LineReason | null =>
  v && reasonDef(v)?.po ? (v as LineReason) : null;

const pad = (n: number) => String(n).padStart(2, '0');

/**
 * "2026-10-07 16:55" in Jakarta time, or just the date when no time was known
 * (stored as local midnight). WIB has no daylight saving, so a fixed +7 is exact.
 */
export function fmtSourceAt(iso: string | null | undefined): string {
  if (!iso) return '';
  const t = new Date(iso).getTime();
  if (isNaN(t)) return '';
  const d = new Date(t + 7 * 3_600_000);
  const date = `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
  const hm = `${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}`;
  return hm === '00:00' ? date : `${date} ${hm}`;
}

export interface SourceFields {
  source_channel?: string | null;
  source_at?: string | null;
  source_contact?: string | null;
  received_by?: string | null;
}

/** "WhatsApp · Jasmine · 2026-09-15 15:34" — the reference when there is no document number. */
export function sourceLabel(s: SourceFields): string {
  return [channelLabel(s.source_channel), (s.source_contact ?? '').trim(), fmtSourceAt(s.source_at)]
    .filter(Boolean).join(' · ');
}

/** Short line under a quote: "WhatsApp from Jasmine to Wendy · 2026-09-15 15:34". */
export function sourceSentence(s: SourceFields): string {
  if (!s.source_channel && !s.source_at && !s.source_contact && !s.received_by) return '';
  const who = [s.source_contact ? `from ${s.source_contact}` : '', s.received_by ? `to ${s.received_by}` : ''].filter(Boolean).join(' ');
  return [[channelLabel(s.source_channel), who].filter(Boolean).join(' '), fmtSourceAt(s.source_at)].filter(Boolean).join(' · ');
}

/** A `datetime-local` input value ("2026-10-07T16:55") as an ISO instant, read as Jakarta time. */
export function localInputToIso(v: string | null | undefined): string | null {
  const m = (v ?? '').match(/^(\d{4})-(\d{2})-(\d{2})(?:T(\d{2}):(\d{2}))?/);
  if (!m) return null;
  return new Date(Date.UTC(+m[1], +m[2] - 1, +m[3], +(m[4] ?? 0) - 7, +(m[5] ?? 0))).toISOString();
}

/** The reverse, for filling the input back in. */
export function isoToLocalInput(iso: string | null | undefined): string {
  if (!iso) return '';
  const t = new Date(iso).getTime();
  if (isNaN(t)) return '';
  const d = new Date(t + 7 * 3_600_000);
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}T${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}`;
}

export interface ParsedSource { source_channel: SourceChannel; source_at: string | null; source_contact: string | null; received_by: string | null }

/**
 * Read one of the hand-typed notes ("WA Joe Trisindo to Wendy 2026-05-05 10:42")
 * into fields. Only for the one-off backfill of those 52 rows; returns null for
 * anything that is not a chat/email note (a real PI number stays a PI number).
 *
 * `staff` are our people's first names: a staff name in the note is who
 * RECEIVED it ("Wendy's WeChat", "WA Wendy to Eric"), anyone else is the
 * supplier's contact.
 */
export function parseLegacySource(text: string | null | undefined, staff: string[], quoteDate?: string | null): ParsedSource | null {
  const raw = (text ?? '').trim();
  if (!raw) return null;
  const channel: SourceChannel | null =
    /whatsapp|^wa\b/i.test(raw) ? 'whatsapp' : /wechat/i.test(raw) ? 'wechat' : /^e-?mail\b/i.test(raw) ? 'email' : null;
  if (!channel) return null;

  // Date (2026-10-07 / 2026-1-31 / 2026.01.06), then a time anywhere after it
  // ("16:55", "09.16", ", 19.27") — or, for an email whose subject carries the
  // date, the first time after the subject.
  const dm = raw.match(/(\d{4})[-.](\d{1,2})[-.](\d{1,2})/);
  const after = dm ? raw.slice((dm.index ?? 0) + dm[0].length) : '';
  const tm = after.match(/(?:^|[\s,"]+)(\d{1,2})[:.](\d{2})\b/);
  // A date INSIDE an email subject ("New EPEVER PI 2026.01.06") is the PI's
  // own date, not when the message arrived — use the quote's date for that.
  const inSubject = !!dm && (raw.slice(0, dm.index ?? 0).match(/"/g) ?? []).length % 2 === 1;
  const qd = (quoteDate ?? '').match(/^(\d{4})-(\d{2})-(\d{2})/);
  const ymd = inSubject && qd ? [qd[1], qd[2], qd[3]] : dm ? [dm[1], dm[2], dm[3]] : null;
  const source_at = ymd
    ? new Date(Date.UTC(+ymd[0], +ymd[1] - 1, +ymd[2], (tm ? +tm[1] : 0) - 7, tm ? +tm[2] : 0)).toISOString()
    : null;

  // What is left once the channel, the quoted subject, dates and times go.
  const rest = raw
    .replace(/"[^"]*"/g, ' ')
    .replace(/\b(whatsapp|wechat|e-?mail)\b|^wa\b/gi, ' ')
    .replace(/\d{4}[-.]\d{1,2}[-.]\d{1,2}/g, ' ')
    .replace(/\b\d{1,2}[:.]\d{2}\b/g, ' ')
    .replace(/\((?:revised)\)/gi, ' ')
    .replace(/[,]/g, ' ')
    .replace(/\s+/g, ' ').trim();
  const isStaff = (w: string) => staff.some((s) => s.toLowerCase() === w.replace(/'s$/i, '').toLowerCase());
  const cap = (w: string) => w.charAt(0).toUpperCase() + w.slice(1);
  let source_contact: string | null = null;
  let received_by: string | null = null;

  const to = rest.match(/^(.*?)\s+to\s+(\S+)$/i);
  const words = (to ? to[1] : rest).split(' ').filter(Boolean);
  if (to && isStaff(to[2]) && !isStaff(words[0] ?? '')) received_by = cap(to[2]);
  if (words.length) {
    const first = words[0];
    if (isStaff(first)) received_by = cap(first.replace(/'s$/i, ''));
    else source_contact = /^[a-z]+-/i.test(first) && words[1] && /[^\x00-\x7f]/.test(words[1])
      ? `${cap(first.split('-')[0])} (${words[1]})`      // "jasmine-epsolar 刘超" → "Jasmine (刘超)"
      : cap(first);
  }
  return { source_channel: channel, source_at, source_contact, received_by };
}

/**
 * What to show in a "PI #" column. A real supplier document number shows as
 * itself; a reference that is only a chat note — the 52 hand-typed "WA Joe
 * Trisindo 2026-…" ones, or the generated "WhatsApp · Joe · 2026-10-09 09:15" —
 * shows as "WhatsApp · Joe", because the time is already said elsewhere on the
 * row. `chat` tells the caller not to repeat the channel beside it.
 */
export function dealRef(pi: string | null | undefined, s: SourceFields = {}): { text: string; chat: boolean } {
  const raw = (pi ?? '').trim();
  const short = [channelLabel(s.source_channel), (s.source_contact ?? '').trim()].filter(Boolean).join(' · ');
  if (!raw) return { text: short, chat: !!short };
  if (s.source_channel && short && parseLegacySource(raw, []) !== null) return { text: short, chat: true };
  return { text: raw, chat: false };
}

const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/**
 * When it arrived, said as briefly as the row allows: just "12:46" when the
 * row's own date is the same day, "24 Sep 12:46" when it is not, "" when the
 * day matches and no time was recorded.
 */
export function fmtSourceAtShort(iso: string | null | undefined, rowDate?: string | null): string {
  const full = fmtSourceAt(iso);
  if (!full) return '';
  const [date, hm = ''] = full.split(' ');
  if (rowDate && date === rowDate.slice(0, 10)) return hm;
  const [, m, d] = date.split('-');
  return [`${Number(d)} ${MON[Number(m) - 1]}`, hm].filter(Boolean).join(' ');
}

export interface LineContext {
  reason?: string | null;
  reason_note?: string | null;
  reason_project_quote_id?: string | null;
  reason_sales_quote_id?: string | null;
  reason_replaces_component_id?: string | null;
}

/**
 * The reason columns to write for one line. A link is kept only when it is
 * the kind the reason points at (a project link on a "stock" line is a stale
 * pick, not data). On a PO, a "price check" reason is dropped: nobody orders
 * to check a price, so the line goes on without a reason rather than a wrong one.
 */
export function lineContextFields(l: LineContext, doc: 'quote' | 'po'): Required<LineContext> {
  const reason = doc === 'po' ? reasonForPo(l.reason) : (reasonDef(l.reason) ? (l.reason as LineReason) : null);
  const needs = reasonDef(reason)?.needs ?? null;
  return {
    reason,
    reason_note: (l.reason_note ?? '').trim() || null,
    reason_project_quote_id: needs === 'project' ? l.reason_project_quote_id || null : null,
    reason_sales_quote_id: needs === 'sales_order' ? l.reason_sales_quote_id || null : null,
    reason_replaces_component_id: needs === 'component' ? l.reason_replaces_component_id || null : null,
  };
}

/**
 * Lines whose reason is known before anyone types it (owner, 2026-10-09: "for
 * items ordered from PT Anugrah and PT Energi Surya Anugrah, and PT JJLAPP or
 * LAPP, PT Supreme, Jembo Cables, this is all for projects" — and everything
 * from PT Persada, the Jembo distributor). Jembo is a brand bought through
 * several distributors, so it is matched on the item, wherever it is bought.
 * The same rule marked the 149 quote lines and 58 PO lines already on file.
 */
export const PROJECT_ONLY_SUPPLIER_CODES: readonly string[] = ['ANUGRAH', 'ESA', 'JJLAPP', 'LAPP', 'PERSADA', 'SUPREME'];
export const PROJECT_ONLY_BRANDS: readonly string[] = ['JEMBO'];
/**
 * Owner, 2026-10-09: "For all Dongguan Epsivo's PI or PO they are for Stock."
 * The 31 quote lines and 19 PO lines already on file were marked the same day.
 */
export const STOCK_ONLY_SUPPLIER_CODES: readonly string[] = ['EPSIVO'];

/**
 * The reason a line has before anyone picks one: "project" for a project-only
 * supplier or brand, "stock" for a stock-only supplier, otherwise null (ask).
 * The supplier decides first — it is who the deal is with.
 */
export function defaultLineReason(supplierCode: string | null | undefined, brand: string | null | undefined): LineReason | null {
  const up = (s: string | null | undefined) => (s ?? '').trim().toUpperCase();
  const code = up(supplierCode);
  if (PROJECT_ONLY_SUPPLIER_CODES.includes(code)) return 'project';
  if (STOCK_ONLY_SUPPLIER_CODES.includes(code)) return 'stock';
  const b = up(brand);
  return b && PROJECT_ONLY_BRANDS.some((x) => b.includes(x)) ? 'project' : null;
}

/** Normalise the four header fields as typed in the form (datetime-local, blanks). */
export function sourceFieldsFromForm(h: Record<string, unknown>): Required<SourceFields> {
  const s = (v: unknown) => (typeof v === 'string' ? v.trim() : '') || null;
  const ch = s(h.source_channel);
  return {
    source_channel: ch && SOURCE_CHANNELS.some((c) => c.value === ch) ? ch : null,
    source_at: localInputToIso(typeof h.source_at === 'string' ? h.source_at : null),
    source_contact: s(h.source_contact),
    received_by: s(h.received_by),
  };
}

/**
 * A line's reason, ready to render: the reason's label (translate it at the
 * call site), what it points at — the project, sales order or old model, by
 * name when the caller can resolve it — and the note. Null when no reason.
 */
export function reasonParts(l: LineContext, nameOf: (id: string) => string | undefined): { label: string; target: string; note: string } | null {
  const def = reasonDef(l.reason);
  if (!def && !(l.reason_note ?? '').trim()) return null;
  const id = def?.needs === 'project' ? l.reason_project_quote_id
    : def?.needs === 'sales_order' ? l.reason_sales_quote_id
    : def?.needs === 'component' ? l.reason_replaces_component_id : null;
  return { label: def?.label ?? '', target: id ? (nameOf(id) ?? '') : '', note: (l.reason_note ?? '').trim() };
}
