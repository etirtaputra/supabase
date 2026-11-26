/**
 * System-size (Wp) helpers shared by the quote editor and the quotes list,
 * so "price per Wp" is computed from the same rules everywhere.
 *
 * Wp per module comes from the catalog (norm_value of pv_module components),
 * else is parsed from the description ("… 720Wp …"). Lines whose unit is
 * 'Wp' already carry the total Wp in their quantity.
 */

export interface WpComponent {
  component_id: string;
  category?: string;
  norm_value?: number | null;
}

export function wpPerModule(
  components: WpComponent[],
  componentId: string | null,
  description: string,
): number {
  if (componentId) {
    const comp = components.find((c) => c.component_id === componentId);
    if (comp?.category === 'pv_module' && Number(comp.norm_value) > 0) return Number(comp.norm_value);
  }
  const m = description.match(/(\d{2,4}(?:[.,]\d+)?)\s*wp\b/i);
  return m ? parseFloat(m[1].replace(',', '.')) : 0;
}

/** Total Wp contributed by one quote line (top-level lines only). */
export function lineWp(
  components: WpComponent[],
  item: { component_id: string | null; description: string; unit: string; quantity: number },
): number {
  if (item.unit.trim().toLowerCase() === 'wp') return item.quantity;
  return item.quantity * wpPerModule(components, item.component_id, item.description);
}

/**
 * The Wp a price per Wp is divided by (owner, 2026-11-26: "show the price per
 * Wp in the proposal editor too"). The Solar Panels lines decide when there
 * are any — the items ARE the system. Only when none can be counted does the
 * typed "PV Modules kWp DC" stand in (a lump-sum PV line, panels kept in
 * another section), and `fromSpecs` says so, so a screen can say where the
 * figure came from.
 */
export function systemWp(linesWp: number, kwpDc: unknown): { wp: number; fromSpecs: boolean } {
  if (linesWp > 0) return { wp: linesWp, fromSpecs: false };
  const k = Number(kwpDc);
  return Number.isFinite(k) && k > 0 ? { wp: k * 1000, fromSpecs: true } : { wp: 0, fromSpecs: false };
}
