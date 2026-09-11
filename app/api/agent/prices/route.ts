import { NextRequest, NextResponse } from 'next/server';
import { callerFromRequest, AgentAuthError } from '@/lib/agentApi';
import { ROLE_PERMISSIONS } from '@/constants/roles';
import { computeTierChain } from '@/lib/tierPricing';
import { loadSettings } from '@/lib/settings';
import { fetchAllComponents } from '@/lib/fetchAllRows';

/**
 * GET /api/agent/prices — the tier ladder, as a number an agent can read.
 *
 * WHY THIS EXISTS. Owner, 2026-09-11, after an agent came back with *"All 8
 * items only have T1 set — T2/T3 are empty in ICAPROC itself"*:
 *
 *   *"see even my ai agents cannot read the Tier 2 and Tier 3 prices because
 *   it is as if it's not there."*
 *
 * The agent was RIGHT about the database and WRONG about the business, and
 * that gap is this file's whole reason to exist. Tier-2 and Tier-3 are not
 * stored anywhere:
 *
 *   · `3.0_components.selling_price_idr` holds the NET, which is Tier-1.
 *   · `21.1_item_tier_prices` holds OVERRIDES ONLY — a row exists exactly when
 *     somebody pinned a tier by hand. 159 of 203 priced items have any at all.
 *   · Every other tier is COMPUTED from the net by the markup chain
 *     (`lib/tierPricing.ts`) when a browser renders the page.
 *
 * So `DEYE BOS-A-Pack7.68` has a Tier-1 of 26,000,000 and zero override rows,
 * while the screen plainly shows Tier-2 27,369,000 and Tier-3 28,810,000. Any
 * agent, any SQL query, any future website reads the tables and honestly
 * reports "empty" — of prices the business uses every day.
 *
 * THE FIX IS NOT TO MATERIALISE THE CHAIN INTO SQL. That would give one rule
 * two implementations — the TypeScript one the screens use and a SQL one — and
 * they would drift the first time a step percentage or the rounding changed.
 * This route runs the SAME `computeTierChain` the grid runs, server-side, and
 * hands back the answer. One rule, two readers.
 *
 * It answers AS THE CALLER, like every agent route: a role that may not see a
 * selling price gets told so rather than quietly getting a shorter list.
 */
export const dynamic = 'force-dynamic';

interface TierRow { tier_id: string; tier_code: string; name: string; default_discount_pct: number; sort_order: number; is_active: boolean }
interface OvRow { component_id: string; tier_id: string; override_price_idr: number | null }
interface CompRow { component_id: string; internal_description: string | null; supplier_model: string; category: string | null; unit: string | null; selling_price_idr: number | null }

export async function GET(request: NextRequest) {
  try {
    const { client, email, role } = await callerFromRequest(request);
    const perms = ROLE_PERMISSIONS[role as keyof typeof ROLE_PERMISSIONS];

    if (!perms?.canViewSellingPrice) {
      // Say WHY, and say it as a refusal rather than as an empty result. An
      // agent handed `[]` will report "no prices exist", which is the exact
      // failure this endpoint was built to end.
      return NextResponse.json({
        error: 'Your role may not see selling prices.',
        actor: { email, role },
        note: 'This is a permission answer, not an empty catalogue. Do not report these items as unpriced.',
      }, { status: 403 });
    }

    const url = new URL(request.url);
    const wantId = (url.searchParams.get('component_id') ?? '').trim();
    const search = (url.searchParams.get('search') ?? '').trim().toLowerCase();
    const limit = Math.min(2000, Math.max(1, Number(url.searchParams.get('limit')) || 500));

    // The rounding step is a SETTING. Without this the server would round to
    // the built-in default and hand back prices that differ from the screen by
    // a few hundred rupiah — the worst kind of wrong, because it looks right.
    await loadSettings(client);

    const [tierRes, ovRes, comps] = await Promise.all([
      client.from('21.0_price_tiers')
        .select('tier_id, tier_code, name, default_discount_pct, sort_order, is_active')
        .order('sort_order'),
      client.from('21.1_item_tier_prices').select('component_id, tier_id, override_price_idr'),
      // ARCHIVED ITEMS ARE NOT PRICED (the rule Selling Prices has held since
      // 2026-09-09) — a retired item has no tier ladder worth serving.
      fetchAllComponents<CompRow>(client,
        'component_id, internal_description, supplier_model, category, unit, selling_price_idr',
        { activeOnly: true }),
    ]);
    if (tierRes.error) return NextResponse.json({ error: tierRes.error.message }, { status: 500 });

    const tiers = ((tierRes.data ?? []) as TierRow[]).filter((t) => t.is_active);
    const ovByKey = new Map<string, number | null>();
    for (const o of (ovRes.data ?? []) as OvRow[]) ovByKey.set(`${o.component_id}:${o.tier_id}`, o.override_price_idr);

    const nameOf = (c: CompRow) => (c.internal_description ?? '').trim() || c.supplier_model;
    const wanted = (comps ?? []).filter((c) => {
      if (wantId) return c.component_id === wantId;
      if (!(Number(c.selling_price_idr) > 0)) return false;
      if (!search) return true;
      return `${nameOf(c)} ${c.category ?? ''}`.toLowerCase().includes(search);
    }).slice(0, limit);

    const items = wanted.map((c) => {
      const chain = computeTierChain(c.selling_price_idr, tiers,
        (tid) => ovByKey.get(`${c.component_id}:${tid}`));
      return {
        component_id: c.component_id,
        description: nameOf(c),
        category: c.category,
        unit: c.unit,
        net_price_idr: c.selling_price_idr,
        tiers: tiers.map((t, i) => {
          const e = chain.get(t.tier_id);
          return {
            tier_code: t.tier_code,
            name: t.name,
            price_idr: e?.price ?? null,
            // The three ways a tier gets its number, named — so a consumer can
            // tell a negotiated price from a computed one without guessing.
            source: i === 0 ? 'net' : e?.overridden ? 'override' : 'chain',
            step_pct: i === 0 ? null : Number(t.default_discount_pct) || 0,
          };
        }),
      };
    });

    return NextResponse.json({
      generated_at: new Date().toISOString(),
      actor: { email, role },
      count: items.length,

      /**
       * The sentence that stops the mistake recurring. An agent that reads
       * this cannot go on to report a computed tier as missing.
       */
      how_to_read_this:
        'Tier-2 and Tier-3 are NOT stored in any table. Only the net price (Tier-1, on ' +
        '3.0_components.selling_price_idr) and hand-pinned overrides (21.1_item_tier_prices) are. ' +
        'Every other tier is computed from the net by the markup chain, and this endpoint is the ' +
        'only place that computation is available outside a browser. If you query 21.1 directly and ' +
        'find nothing, that means NO OVERRIDE — it does not mean no price. Never report a tier as ' +
        'empty on the strength of a table read; ask here instead.',
      source_of_truth: {
        net: '3.0_components.selling_price_idr',
        overrides: '21.1_item_tier_prices.override_price_idr',
        derived: 'lib/tierPricing.computeTierChain — the same function the Selling Prices grid runs',
      },
      tiers: tiers.map((t, i) => ({
        tier_code: t.tier_code, name: t.name, sort_order: t.sort_order,
        step_pct: i === 0 ? null : Number(t.default_discount_pct) || 0,
        is_net: i === 0,
      })),
      items,
    });
  } catch (e) {
    if (e instanceof AgentAuthError) return NextResponse.json({ error: e.message }, { status: e.status });
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}
