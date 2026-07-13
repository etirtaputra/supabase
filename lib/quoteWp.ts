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
