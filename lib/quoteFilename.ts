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
  return parts
    .join('_')
    .replace(/[/\\?%*:|"<>#,]/g, '-')
    .replace(/\s+/g, '-')
    .replace(/-{2,}/g, '-');
}
