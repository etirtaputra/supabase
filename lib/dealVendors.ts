/**
 * Deal Lookup, sectioned by vendor (owner, 2026-10-24: "it should be arranged
 * by sections from the different Vendors, the organization is like sections
 * in EPC proposal … arrange the PO within that vendors by date. And the quote
 * should also be arranged by vendors").
 *
 * One section per supplier. Inside it the deals run newest first; the
 * sections themselves run by their newest deal, so the vendor you are working
 * with today is at the top. A deal with no supplier on record sits in a last
 * section of its own rather than vanishing.
 *
 * Pure: no fetch, no React.
 */
export interface VendorDeal {
  key: string;
  supplierId: string | null;
  supplier: { supplier_name?: string | null; supplier_code?: string | null } | null;
  latestDate: string;
}

export interface VendorSection<T extends VendorDeal> {
  key: string;
  name: string;
  code: string | null;
  deals: T[];
  latestDate: string;
}

export const NO_VENDOR = '__none__';

export function groupByVendor<T extends VendorDeal>(deals: T[]): VendorSection<T>[] {
  const map = new Map<string, VendorSection<T>>();
  for (const d of deals) {
    const key = d.supplierId ?? NO_VENDOR;
    let s = map.get(key);
    if (!s) {
      s = { key, name: d.supplier?.supplier_name?.trim() || '', code: d.supplier?.supplier_code ?? null, deals: [], latestDate: '' };
      map.set(key, s);
    }
    s.deals.push(d);
    if ((d.latestDate ?? '') > s.latestDate) s.latestDate = d.latestDate ?? '';
  }
  const byDateDesc = (a: T, b: T) => (b.latestDate ?? '').localeCompare(a.latestDate ?? '') || a.key.localeCompare(b.key);
  for (const s of map.values()) s.deals.sort(byDateDesc);
  return [...map.values()].sort((a, b) =>
    (a.key === NO_VENDOR ? 1 : 0) - (b.key === NO_VENDOR ? 1 : 0)
    || b.latestDate.localeCompare(a.latestDate)
    || a.name.localeCompare(b.name));
}
