/**
 * Matching what a supplier document SAYS to what ICAPROC already HAS — the
 * supplier, the buying company, and each line's catalogue item. ONE
 * implementation (2026-11-22): the New Deal pre-fill (app/purchasing) and the
 * Inbox's proposal (lib/inboxMatch) both call these, so the Inbox can never
 * promise a match the form then does not make. The rules are the ones the
 * purchasing page has used since PDF upload arrived, moved here unchanged.
 * Pure, no I/O.
 */

const norm = (s: unknown): string => String(s ?? '').toLowerCase().trim();

/** Exact name, then either name containing the other. */
export function matchByName<T>(name: string | null | undefined, rows: T[], nameOf: (r: T) => string | null | undefined): T | null {
  const n = norm(name);
  if (!n) return null;
  return rows.find((r) => norm(nameOf(r)) === n)
    ?? rows.find((r) => { const x = norm(nameOf(r)); return !!x && (x.includes(n) || n.includes(x)); })
    ?? null;
}

export interface DocLine { model_sku?: string | null; description?: string | null; brand?: string | null }
export interface CatalogueItem { component_id: string | number; supplier_model?: string | null; internal_description?: string | null; brand?: string | null }

/**
 * A document line's catalogue item: SKU exact → SKU contained either way →
 * same brand + description contained either way → description (over 10
 * characters) contained either way. Null when nothing fits.
 */
export function matchComponent<C extends CatalogueItem>(item: DocLine, comps: C[]): C | null {
  const sku = norm(item.model_sku);
  const desc = norm(item.description);
  const brand = norm(item.brand);
  let m: C | undefined = sku ? comps.find((c) => norm(c.supplier_model) === sku) : undefined;
  if (!m && sku) m = comps.find((c) => { const s = norm(c.supplier_model); return !!s && (s.includes(sku) || sku.includes(s)); });
  if (!m && brand && desc) {
    m = comps.find((c) => {
      const d = norm(c.internal_description);
      return norm(c.brand) === brand && !!d && (d.includes(desc) || desc.includes(d));
    });
  }
  if (!m && desc.length > 10) m = comps.find((c) => { const d = norm(c.internal_description); return !!d && (d.includes(desc) || desc.includes(d)); });
  return m ?? null;
}

/** A document number as people write it — case, spaces, slashes and dashes aside. */
export const docNumberKey = (s: string | null | undefined): string => norm(s).replace(/[\s/\\._-]+/g, '');
