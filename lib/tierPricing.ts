/**
 * Markup-chain tier pricing — THE canonical engine (decided 2026-07-24).
 *
 * Model: the price entered on an item (3.0_components.selling_price_idr) IS
 * the NET price = Tier-1. Every next tier marks UP from the previous tier:
 *
 *   tier[i] = tier[i-1] ÷ (1 − step%)        e.g. 100 → 100/(1−0.05) = 105.27
 *
 * …rounded UP to the nearest Rp 1,000, and the margin shown is the ACTUAL
 * margin achieved after rounding (1 − prev/price). A per-item override
 * (21.1_item_tier_prices.override_price_idr) replaces that tier's computed
 * price AND becomes the base the next tier chains from.
 *
 * Storage note: the step % lives in 21.0_price_tiers.default_discount_pct
 * (legacy column name from the old "list − discount" model, kept to avoid a
 * schema/deploy race). Tier order = sort_order; the FIRST active tier is the
 * net tier and its step is ignored.
 */

export interface ChainTier {
  tier_id: string;
  default_discount_pct: number; // the STEP % over the previous tier (first tier: ignored)
  sort_order?: number;
}

export interface ChainPrice {
  price: number | null;
  overridden: boolean;
  stepPct: number;               // configured step
  actualMarginPct: number | null; // achieved margin vs previous tier after rounding/overrides (first tier: null)
}

export const roundUp1000 = (v: number) => Math.ceil(v / 1000) * 1000;

/**
 * Compute every tier's price for one item.
 * @param net       the item's net (Tier-1) price — selling_price_idr
 * @param tiers     ACTIVE tiers, sorted by sort_order ascending
 * @param overrideOf per-tier absolute override lookup (21.1), or undefined/null for none
 */
export function computeTierChain(
  net: number | null,
  tiers: ChainTier[],
  overrideOf?: (tierId: string) => number | null | undefined,
): Map<string, ChainPrice> {
  const out = new Map<string, ChainPrice>();
  let prev: number | null = net != null && net > 0 ? net : null;
  tiers.forEach((t, i) => {
    const step = Number(t.default_discount_pct) || 0;
    const ov = overrideOf?.(t.tier_id);
    const base = prev;
    let price: number | null;
    if (ov != null && ov > 0) {
      price = ov;
    } else if (i === 0) {
      price = base; // net tier — exactly what the owner entered
    } else if (base != null && step < 95) {
      price = roundUp1000(base / (1 - step / 100));
    } else {
      price = null;
    }
    out.set(t.tier_id, {
      price,
      overridden: ov != null && ov > 0,
      stepPct: step,
      actualMarginPct: i > 0 && price != null && price > 0 && base != null ? (1 - base / price) * 100 : null,
    });
    if (price != null) prev = price;
  });
  return out;
}

/** One tier's effective price (convenience for "price this customer's tier"). */
export function tierPriceFor(
  net: number | null,
  tiers: ChainTier[],
  tierId: string,
  overrideOf?: (tierId: string) => number | null | undefined,
): number | null {
  return computeTierChain(net, tiers, overrideOf).get(tierId)?.price ?? null;
}
