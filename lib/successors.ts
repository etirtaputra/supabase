/**
 * Successor lookup over 8.0_component_links.
 *
 * Successor links are DIRECTIONAL: link_type 'successor' stores
 * component_id_b SUCCEEDS component_id_a. An item therefore "has a newer
 * version" when a successor link carries it as component_id_a — the
 * newer item is component_id_b. (Same reading as ComponentEditor's
 * Successor ↑ / Predecessor ↓ badges.)
 */
export interface SuccessorLinkRow {
  component_id_a: string;
  component_id_b: string;
  link_type: string;
}

/** The id of the item that replaces `componentId`, or null when none does. */
export function successorIdOf(componentId: string | null | undefined, links: SuccessorLinkRow[]): string | null {
  if (!componentId) return null;
  for (const l of links) {
    if (l.link_type === 'successor' && String(l.component_id_a) === String(componentId)) {
      return String(l.component_id_b);
    }
  }
  return null;
}

/** Map of every superseded item → its successor, for list screens. */
export function successorMap(links: SuccessorLinkRow[]): Map<string, string> {
  const m = new Map<string, string>();
  for (const l of links) {
    if (l.link_type === 'successor') m.set(String(l.component_id_a), String(l.component_id_b));
  }
  return m;
}
