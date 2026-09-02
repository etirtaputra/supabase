/**
 * The WhatsApp price message — one product or twenty, composed the same way.
 *
 * This is customer-facing text, so it uses the DOCUMENT number/date profile
 * (Settings › Formatting) exactly like the printed quotation, and it never
 * mentions a brand, a supplier model or the TIER a price came from — the
 * customer-facing name is the item's internal description, the same rule the
 * sell-side screens follow.
 *
 * WhatsApp markup: *bold* survives a paste; nothing else is worth the risk of
 * looking broken in a client that doesn't render it.
 *
 * LAYOUT, learned from a real message: WhatsApp turns "1. " at the start of a
 * line into an ORDERED LIST. Its wrapped lines indent under the number, but a
 * following line that is not part of that list item drops back to the left
 * margin — so a name on one line and its price on the next came out visually
 * detached. Each item is therefore ONE line ("1. Name — 3 unit × Rp… = Rp…"),
 * which lets WhatsApp's own list rendering wrap it as a single block, and the
 * items are not separated by blank lines (a blank line ends the list).
 */
import { fmtDayDoc, fmtRupiahDoc } from './formatters';
import { getSettings } from './settings';

export interface QuoteLine {
  /** Customer-facing name — never the brand or supplier model. */
  name: string;
  price: number;
  qty: number;
  unit?: string;
  /**
   * Which tier the price came from. INTERNAL ONLY — it tells the rep what they
   * picked and is never printed: a tier name exposes how the house prices its
   * customers, the same reason a brand or a supplier model never reaches a
   * customer-facing surface. The customer sees a price, not its provenance.
   */
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
    const priceTxt = fmtRupiahDoc(l.price);
    const amount = qty > 1
      ? `${qty}${unit ? ` ${unit}` : ''} × ${priceTxt} = *${fmtRupiahDoc(l.price * qty)}*`
      : `*${priceTxt}*`;
    // One item, no list: name above its price reads naturally.
    // Several: one line each, so WhatsApp's list rendering keeps a long name
    // and its price in the same block.
    return single ? `${l.name}\n${amount}` : `${i + 1}. ${l.name} — ${amount}`;
  });

  const out = [head.join('\n'), '', body.join('\n')];

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
 * The one-tap copy: what a rep pastes into a chat already in progress.
 *
 * ONE line, in the shape the owner's Dolibarr has been emitting for years and
 * the sales team already reads at a glance:
 *
 *     [2026-09-02] ICA SOLAR ICA550-72HMI 550Wp Mono, Rp 1.500.000 Exc. PPN
 *
 * Deliberately NOT `buildQuoteMessage`. That opens with "*Penawaran Harga*",
 * the company name and a date — right for a quote you send cold, noise inside
 * a conversation where the customer has just asked "berapa harga X?".
 *
 * Three things the shape gets right and are worth keeping: the date is ISO and
 * leads, so a price pasted into a chat months ago can still be dated; "Exc.
 * PPN" rides ON the number rather than sitting in a footnote, because a price
 * read out of context is how a PPN argument starts; and no WhatsApp *bold*,
 * which would show as literal asterisks anywhere else it gets pasted.
 *
 * The TIER is not printed — it tells the customer how the house grades them.
 */
export function buildPriceSnippet(line: QuoteLine, dateIso?: string): string {
  return `[${dateIso ?? todayIso()}] ${line.name}, ${fmtRupiahDoc(line.price)} Exc. PPN`;
}

/**
 * Put the message on the clipboard and nowhere else.
 *
 * Tapping a single price is a COPY, not a send: the person doing it has
 * already decided where the number is going, and a share sheet asking "which
 * app?" is a question they did not ask. `shareOrCopy` below is for the
 * finished multi-item quote, where choosing the destination IS the action.
 */
export async function copyOnly(text: string): Promise<'copied' | 'failed'> {
  try {
    if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return 'copied';
    }
  } catch { /* fall through — the textarea path below still works */ }
  // navigator.clipboard is absent on a page served over plain http and inside
  // some in-app browsers. The offscreen textarea is the path that survives.
  try {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.setAttribute('readonly', '');
    ta.style.position = 'fixed';
    ta.style.top = '-1000px';
    document.body.appendChild(ta);
    ta.select();
    const ok = document.execCommand('copy');
    document.body.removeChild(ta);
    return ok ? 'copied' : 'failed';
  } catch {
    return 'failed';
  }
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
