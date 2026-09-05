/**
 * The house filename convention for every document the app exports, in one
 * place — because a browser's Save-as-PDF uses `document.title` verbatim, and
 * a document that lands in someone's Downloads under a different shape than
 * its siblings is a document nobody can find again.
 *
 * The shape: identifying number first, then who it is for, then what it is —
 * underscores BETWEEN the parts, dashes INSIDE them, nothing that a file
 * system would reject.
 */

/** Join the parts of a document name under the house rule. */
export function documentFileName(parts: (string | null | undefined)[]): string {
  return parts
    .filter((p): p is string => !!p && !!String(p).trim())
    .join('_')
    .replace(/[/\\?%*:|"<>#,]/g, '-')
    .replace(/\s+/g, '-')
    .replace(/-{2,}/g, '-');
}

/**
 * Sales-side documents (quote / order confirmation / invoice / DO): the number
 * the document itself prints, then the customer —
 * "PQ-20260905-0036_PT-Indodaya-Surya-Lestari".
 */
export function salesFileName(docNumber: string, customerName: string): string {
  return documentFileName([docNumber || 'document', customerName]);
}

/**
 * Filename for exported quotes: quote number + customer + project identifiers
 * + location, e.g.
 * "082-0126_MidPlaza_Hybrid-1.8MWpDC-1.5MWAC-750kWPCS-1.53MWhBESS_RIVERSIDE-PV-FARM".
 * Falls back to the computed system size when no structured spec tag exists.
 * Illegal filename characters are stripped; spaces become dashes.
 */
export function quoteFileName(
  quoteNumber: string,
  customerName: string,
  totalWp: number,
  opts?: { specTag?: string; location?: string },
): string {
  const parts: string[] = [quoteNumber || 'quote'];
  if (customerName) parts.push(customerName);
  if (opts?.specTag) {
    parts.push(opts.specTag);
  } else if (totalWp > 0) {
    const kwp = totalWp / 1000;
    parts.push(kwp >= 1
      ? `${Number.isInteger(kwp) ? kwp : kwp.toFixed(1)}kWp`
      : `${Math.round(totalWp)}Wp`);
  }
  if (opts?.location) parts.push(opts.location);
  return documentFileName(parts);
}
