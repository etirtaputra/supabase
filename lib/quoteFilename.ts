/**
 * Filename for exported quotes: quote number + customer + system size,
 * e.g. "082-0126_Rumah-Ibu-Diana_62.5kWp". Illegal filename characters are
 * stripped; spaces become dashes.
 */
export function quoteFileName(quoteNumber: string, customerName: string, totalWp: number): string {
  const parts: string[] = [quoteNumber || 'quote'];
  if (customerName) parts.push(customerName);
  if (totalWp > 0) {
    const kwp = totalWp / 1000;
    parts.push(kwp >= 1
      ? `${Number.isInteger(kwp) ? kwp : kwp.toFixed(1)}kWp`
      : `${Math.round(totalWp)}Wp`);
  }
  return parts
    .join('_')
    .replace(/[/\\?%*:|"<>#]/g, '-')
    .replace(/\s+/g, '-')
    .replace(/-{2,}/g, '-');
}
