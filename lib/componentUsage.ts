/**
 * How actively an item trades: how many supplier quotes name it, and how many
 * purchase orders actually ordered it.
 *
 * WHY THIS IS A FILE AND NOT A `useMemo`. The agent MIRA reported, 2026-09-14,
 * that the Deals column was wrong — five newly-created components showing blank
 * against one real PO line each, and three components on two POs each showing
 * "1 PO". It proposed three causes: a stale denormalised column, a `LIMIT 1`
 * cap, or a missing trigger on insert.
 *
 * **All three were wrong, and the real cause was worse.** There is no cache, no
 * cap and no trigger: the count is computed live in the browser. It was
 * computed from the wrong table.
 *
 * The old code looped over `4.1_price_quote_line_items` ALONE and derived the
 * PO count by walking quote → `5.0_purchases.quote_id`. So it never answered
 * "which POs contain this component". It answered "which POs were raised from
 * a quote that happens to mention this component", which is a different
 * question with three distinct failure modes:
 *
 *   1. A component never quoted got NO MAP ENTRY AT ALL — the loop that creates
 *      the entry is the quote-items loop — so the cell rendered "—" however
 *      many POs had ordered it. That is MIRA's five new items: one PO line
 *      each, zero quote lines.
 *   2. A component on two POs where only one came from a quote listing it
 *      counted ONE. That is MIRA's other three.
 *   3. And the direction nobody looked for: a component quoted on a PI whose
 *      PO ordered entirely DIFFERENT items counted that PO anyway. The number
 *      could be too HIGH, which is the more dangerous error — an understated
 *      count looks like a new item, an overstated one looks like a track record
 *      that does not exist.
 *
 * Measured across the catalogue the day it was fixed: 321 components touched by
 * a PO, 208 right, **110 understated, 3 overstated**, and 85 showing a blank
 * Deals cell while genuinely sitting on a purchase order.
 *
 * The rule now: count what the line-item tables say, from the line-item tables.
 * `5.1_purchase_line_items` was ALREADY loaded and passed into the editor as
 * `poItems` — the join that answers this correctly was one table away the whole
 * time.
 *
 * Dedup is by ID, never by document number. `po_number` is a label a human
 * types and may be blank on a draft; `po_id` is identity. Counting by number
 * silently merges two POs that share one, and drops any PO that has none yet.
 */

/** The minimum each row must carry — structural, so callers keep their own types. */
export interface UsageQuoteLine { component_id: string | null; quote_id: number }
export interface UsagePoLine { component_id: string | null; po_id: number }
export interface UsageQuote { quote_id: number; pi_number?: string | null }
export interface UsagePo { po_id: number; po_number?: string | null }

export interface ComponentUsage {
  /** Distinct supplier quotes (`4.1`) that name this component. */
  quoteCount: number;
  /** Distinct purchase orders (`5.1`) that ORDERED this component. */
  poCount: number;
  /** Quote lines, not quotes — one quote can list an item twice. */
  lineItemCount: number;
  /** PI numbers of those quotes, for the tooltip and the PI filter. */
  piNumbers: string[];
  /** PO numbers of those POs. A PO with no number counts but cannot be listed. */
  poNumbers: string[];
}

const EMPTY: ComponentUsage = {
  quoteCount: 0, poCount: 0, lineItemCount: 0, piNumbers: [], poNumbers: [],
};

/** A component's usage, or a zeroed record — never undefined for a real item. */
export const usageOf = (map: Map<string, ComponentUsage>, componentId: string): ComponentUsage =>
  map.get(componentId) ?? EMPTY;

export function buildComponentUsage(
  quoteItems: UsageQuoteLine[],
  poItems: UsagePoLine[],
  quotes: UsageQuote[],
  pos: UsagePo[],
): Map<string, ComponentUsage> {
  const piByQuote = new Map<number, string>();
  for (const q of quotes) if (q.pi_number) piByQuote.set(q.quote_id, q.pi_number);

  const numberByPo = new Map<number, string>();
  for (const p of pos) if (p.po_number) numberByPo.set(p.po_id, p.po_number);

  const quoteIds = new Map<string, Set<number>>();
  const poIds = new Map<string, Set<number>>();
  const lineCounts = new Map<string, number>();

  for (const it of quoteItems) {
    const cid = it.component_id;
    if (!cid) continue;
    let s = quoteIds.get(cid);
    if (!s) { s = new Set(); quoteIds.set(cid, s); }
    s.add(it.quote_id);
    lineCounts.set(cid, (lineCounts.get(cid) ?? 0) + 1);
  }

  // The half that was missing. A separate pass, so a component that has only
  // ever been PURCHASED — never quoted — still gets an entry. Every new item
  // added straight onto a PO lives in exactly that state.
  for (const it of poItems) {
    const cid = it.component_id;
    if (!cid) continue;
    let s = poIds.get(cid);
    if (!s) { s = new Set(); poIds.set(cid, s); }
    s.add(it.po_id);
  }

  const out = new Map<string, ComponentUsage>();
  for (const cid of new Set([...quoteIds.keys(), ...poIds.keys()])) {
    const qids = quoteIds.get(cid);
    const pids = poIds.get(cid);
    out.set(cid, {
      quoteCount: qids?.size ?? 0,
      poCount: pids?.size ?? 0,
      lineItemCount: lineCounts.get(cid) ?? 0,
      piNumbers: [...new Set([...(qids ?? [])].map((id) => piByQuote.get(id)).filter((s): s is string => !!s))].sort(),
      poNumbers: [...new Set([...(pids ?? [])].map((id) => numberByPo.get(id)).filter((s): s is string => !!s))].sort(),
    });
  }
  return out;
}
