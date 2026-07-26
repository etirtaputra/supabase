/**
 * The WhatsApp price message — one product or twenty, composed the same way.
 *
 * This is customer-facing text, so it uses the DOCUMENT number/date profile
 * (Settings › Formatting) exactly like the printed quotation, and it never
 * mentions a brand or a supplier model — the customer-facing name is the
 * item's internal description, the same rule the sell-side screens follow.
 *
 * WhatsApp markup: *bold* survives a paste; nothing else is worth the risk of
 * looking broken in a client that doesn't render it.
 */
import { fmtDayDoc, fmtRupiahDoc } from './formatters';
import { getSettings } from './settings';

export interface QuoteLine {
  /** Customer-facing name — never the brand or supplier model. */
  name: string;
  price: number;
  qty: number;
  unit?: string;
  /** Which tier this price came from, when it wasn't the plain sell price. */
  tier?: string;
}

export interface QuoteMessageOptions {
  /** Heading — the company writing, when Settings has one. */
  company?: string;
  /** Show the "excludes PPN" line and the total. Off for a bare price list. */
  withTotal?: boolean;
  /** Date printed under the heading; today when omitted. */
  date?: string;
}

const todayIso = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

/**
 * Compose the message. One line per item; the quantity only appears when it
 * is more than one, so a plain price list stays a plain price list.
 */
export function buildQuoteMessage(lines: QuoteLine[], opts: QuoteMessageOptions = {}): string {
  const s = getSettings();
  const kept = lines.filter((l) => l.name && Number.isFinite(l.price));
  if (kept.length === 0) return '';

  const company = (opts.company ?? s.companyName ?? '').trim();
  const head = ['*Penawaran Harga*', company, `Tanggal: ${fmtDayDoc(opts.date ?? todayIso())}`].filter(Boolean);

  const single = kept.length === 1;
  const body = kept.map((l, i) => {
    const qty = Math.max(1, Number(l.qty) || 1);
    const unit = (l.unit ?? '').trim();
    const label = single ? l.name : `${i + 1}. ${l.name}`;
    const priceTxt = fmtRupiahDoc(l.price);
    const tier = l.tier ? ` (${l.tier})` : '';
    return qty > 1
      ? `${label}\n${qty}${unit ? ` ${unit}` : ''} × ${priceTxt}${tier} = *${fmtRupiahDoc(l.price * qty)}*`
      : `${label}\n${priceTxt}${tier}`;
  });

  const out = [head.join('\n'), '', body.join('\n\n')];

  if (opts.withTotal !== false) {
    const total = kept.reduce((sum, l) => sum + l.price * Math.max(1, Number(l.qty) || 1), 0);
    // The exclusion belongs ON the total, not only in a footnote — a number
    // read out of context is how a PPN argument starts.
    if (kept.length > 1) out.push('', `*Total (belum termasuk PPN): ${fmtRupiahDoc(total)}*`);
    out.push('', `Semua harga belum termasuk PPN ${s.defaultPpnPct}%.`);
  }
  if (s.documentFooterNote.trim()) out.push('', s.documentFooterNote.trim());

  return out.join('\n');
}

/**
 * Put the message where the user wants it: the native share sheet when the
 * device has one (that is the path straight into WhatsApp on a phone), the
 * clipboard otherwise. Returns how it went so the caller can say so.
 */
export async function shareOrCopy(text: string): Promise<'shared' | 'copied' | 'failed'> {
  if (typeof navigator !== 'undefined' && typeof navigator.share === 'function') {
    try {
      await navigator.share({ text });
      return 'shared';
    } catch (e) {
      // A cancelled share is not a failure — fall through to the clipboard only
      // when sharing is genuinely unavailable.
      if (e instanceof DOMException && e.name === 'AbortError') return 'shared';
    }
  }
  try {
    await navigator.clipboard.writeText(text);
    return 'copied';
  } catch {
    return 'failed';
  }
}
