/**
 * The design engines, made callable by an agent.
 *
 * WHY THIS IS AN API AND NOT SQL: `lib/systemDesign/` is a line-for-line port
 * of the v11 mounting calculator and the v7 system calculator, pinned by
 * golden tests captured from the originals. Re-implementing any of it in SQL
 * so an agent could "just query" would create a second implementation of a
 * sizing rule, and the two would drift apart silently. One engine, two callers
 * — the Sales Quote screen and this route — is the whole point.
 *
 * It follows that this file must not do arithmetic of its own. It gathers the
 * catalogue, delegates to `calculateMounting` / `calculateSystem` and
 * `resolveBom`, and prices through `tierPriceFor` exactly as the sales editor
 * does (`app/sales/[id]/page.tsx`). A number this route returns that the
 * screen would not produce is a bug, not a variation.
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import { resolveBom, summarise, type DesignCandidate, type ResolveContext } from './systemDesign/resolve.ts';
import { computeTierChain, tierPriceFor, type ChainTier } from './tierPricing.ts';
import { VISIBILITY_COLUMNS } from './itemVisibility.ts';
import type { BomLine, ResolvedLine } from './systemDesign/types.ts';

/** Columns the resolver and the pricing path need — nothing about cost. */
const CANDIDATE_COLUMNS =
  `component_id, supplier_model, internal_description, brand, category, unit,
   specifications, selling_price_idr, ${VISIBILITY_COLUMNS}`.replace(/\s+/g, ' ');

export interface DesignPricing {
  /** The tier actually used, so a report can say which. */
  tierCode: string | null;
  tierName: string | null;
}

export interface DesignContext extends ResolveContext {
  candidates: (DesignCandidate & { selling_price_idr?: number | null })[];
  pricing: DesignPricing;
}

/**
 * Everything a design run needs, read AS THE CALLER so RLS and the offerable
 * rule apply. An archived or Cost-Basis-Hidden item can no more reach an
 * agent's bill of materials than it can reach the designer's.
 */
export async function designContext(
  client: SupabaseClient,
  opts: { customerId?: string | null; categories?: readonly string[] } = {},
): Promise<DesignContext> {
  const categories = opts.categories ?? [
    'mounting', 'pv_module', 'on_grid_inverter', 'inverter_charger', 'batteries',
    'accessories', 'switchgear', 'monitoring', 'pv_cable',
  ];

  const [{ data: comps }, { data: tiers }, { data: overrides }, { data: balances }, { data: settings }] =
    await Promise.all([
      client.from('3.0_components').select(CANDIDATE_COLUMNS)
        .in('category', categories as string[]).is('archived_at', null).limit(3000),
      client.from('21.0_price_tiers').select('tier_id, tier_code, name, default_discount_pct, sort_order, is_active')
        .eq('is_active', true).order('sort_order'),
      client.from('21.1_item_tier_prices').select('component_id, tier_id, override_price_idr'),
      client.from('30.1_stock_balances').select('component_id, qty_on_hand'),
      client.from('40.0_settings').select('key, value').eq('key', 'defaultCustomerTier').maybeSingle(),
    ]);

  const candidates = (comps ?? []) as unknown as DesignContext['candidates'];

  // The chain the sales editor uses: active tiers in sort order.
  //
  // `ChainTier` is deliberately narrow — the pricing engine wants the step
  // percentages and nothing else — so the human labels ride alongside rather
  // than being bolted onto the engine's type.
  const chain: ChainTier[] = (tiers ?? []).map((t) => ({
    tier_id: t.tier_id as string,
    default_discount_pct: Number(t.default_discount_pct) || 0,
    sort_order: Number(t.sort_order) || 0,
  }));
  const labelOf = new Map<string, { code: string; name: string }>(
    (tiers ?? []).map((t) => [t.tier_id as string, { code: String(t.tier_code ?? ''), name: String(t.name ?? '') }]));

  const houseDefault = String((settings as { value?: unknown } | null)?.value ?? '') || '';
  let tierCode: string | null = houseDefault || null;
  if (opts.customerId) {
    const { data: cust } = await client.from('20.0_customers')
      .select('tier').eq('customer_id', opts.customerId).maybeSingle();
    tierCode = (cust?.tier as string | undefined) || houseDefault || null;
  }
  const tier = chain.find((t) => labelOf.get(t.tier_id)?.code === tierCode) ?? null;

  const overrideByKey = new Map<string, number | null>();
  for (const o of overrides ?? []) {
    overrideByKey.set(`${o.component_id}:${o.tier_id}`, o.override_price_idr as number | null);
  }
  const onHand = new Map<string, number>();
  for (const b of balances ?? []) {
    onHand.set(b.component_id as string, (onHand.get(b.component_id as string) ?? 0) + Number(b.qty_on_hand ?? 0));
  }
  const netOf = new Map<string, number | null>();
  for (const c of candidates) netOf.set(c.component_id, c.selling_price_idr ?? null);

  return {
    candidates,
    pricing: { tierCode, tierName: tier ? (labelOf.get(tier.tier_id)?.name ?? null) : null },
    // Identical to `priceFor` in the sales editor: no tier means the net price.
    priceOf: (componentId: string) => {
      const net = netOf.get(componentId) ?? null;
      if (!tier) return net;
      return tierPriceFor(net, chain, tier.tier_id,
        (tid) => overrideByKey.get(`${componentId}:${tid}`));
    },
    stockOf: (componentId: string) => onHand.get(componentId) ?? null,
  };
}

export interface DesignReply {
  lines: ResolvedLine[];
  summary: ReturnType<typeof summarise>;
  pricing: DesignPricing;
}

/** Resolve engine lines against the catalogue and price them. */
export function resolveAndPrice(lines: BomLine[], ctx: DesignContext): DesignReply {
  const resolved = resolveBom(lines, ctx);
  return { lines: resolved, summary: summarise(resolved), pricing: ctx.pricing };
}

/**
 * Warnings are the point, not decoration. An agent that reports a bill of
 * materials without them has dropped the engineering.
 */
export const designNotes = (warnings: string[], reply: DesignReply): string[] => [
  ...warnings,
  ...(reply.summary.unresolved > 0
    ? [`${reply.summary.unresolved} line(s) are not in the catalog and must be priced by hand.`] : []),
  ...(reply.summary.unpriced > 0
    ? [`${reply.summary.unpriced} resolved line(s) carry no selling price.`] : []),
  ...(reply.summary.short > 0
    ? [`${reply.summary.short} line(s) exceed the stock on hand.`] : []),
];

export { mountingInputFrom } from './systemDesign/mountingInput.ts';

export { computeTierChain };
