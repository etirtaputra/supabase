import { NextRequest, NextResponse } from 'next/server';
import { callerFromRequest, AgentAuthError } from '@/lib/agentApi';
import { designContext, resolveAndPrice, designNotes, mountingInputFrom } from '@/lib/agentDesign';
import { calculateMounting, COST_PROBE_LINES, CUT_RAIL, MOUNTING_ENGINE_VERSION, RAIL_LENGTHS_MM, V11_PANEL_PRESETS, unitCostsFrom } from '@/lib/systemDesign/mounting';
import { mountingSystems, shortlist, type RailProfile } from '@/lib/systemDesign/mountingSystem';

/**
 * POST /api/agent/design/mounting — the mounting calculator, for agents
 * (the v11 port; since engine v12 it cuts the 4850 rail into 2400 / 1200
 * pieces when that buys fewer rails — `geometry.cutPlan` says how).
 *
 * Runs the SAME engine the Design Mounting screen runs, resolved against the
 * same catalogue at the same customer's tier. If this route and that screen
 * ever disagree, one of them is broken — there is no second implementation to
 * blame.
 *
 * Body: { panelCount, numberOfRows, panelLengthMm, panelWidthMm,
 *         panelThicknessMm, railLengthMm, panelSpacingMm,
 *         mountType: roof|ground|flat, orientation: portrait|landscape,
 *         customerId?, series?, railProfile? }
 *
 * GET returns the options an agent needs to fill that in.
 */
export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  try {
    const { client } = await callerFromRequest(request);
    const ctx = await designContext(client, { categories: ['mounting'] });
    return NextResponse.json({
      rail_lengths_mm: RAIL_LENGTHS_MM,
      mount_types: ['roof', 'ground', 'flat'],
      orientations: ['portrait', 'landscape'],
      panel_presets: V11_PANEL_PRESETS,
      cut_rails: { ...CUT_RAIL, rule: 'Up to two cut pieces (2400, 1200 mm) per rail line. Whole vs cut is decided on total cost (rails + joints + supports at the customer\'s prices); if a price is missing, cut only when it buys fewer 4850 rails. 50 mm per rail goes to the saw.' },
      mounting_systems: mountingSystems(ctx.candidates),
      note: 'ICA quotes MIBET MD with the T-slot rail. Parts from different systems do not fit together.',
    });
  } catch (e) {
    if (e instanceof AgentAuthError) return NextResponse.json({ error: e.message }, { status: e.status });
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const { client, email, role } = await callerFromRequest(request);
    const body = await request.json() as Record<string, unknown> & {
      customerId?: string | null; series?: string; railProfile?: RailProfile;
    };

    const { input, missing } = mountingInputFrom(body);
    if (missing.length) {
      return NextResponse.json({
        error: `Missing or zero: ${missing.join(', ')}. The engine refuses to guess a panel's size.`,
      }, { status: 400 });
    }

    const ctx = await designContext(client, { customerId: body.customerId, categories: ['mounting'] });
    // A kit is only valid within one system; an unshortlisted run can mix them.
    const scoped = body.series
      ? { ...ctx, candidates: shortlist(ctx.candidates, body.series, body.railProfile) }
      : ctx;
    // Engine v13: whole vs cut rails is decided on the cost of the rail, joint
    // and support at THIS customer's prices — the same lookup the screen makes.
    const unitCosts = unitCostsFrom(resolveAndPrice(COST_PROBE_LINES(input.railLengthMm, input.mountType), scoped).lines);
    const result = calculateMounting(input, { unitCosts });
    const reply = result.ok ? resolveAndPrice(result.lines, scoped)
                            : { lines: [], summary: { lines: 0, unresolved: 0, unpriced: 0, short: 0, total: 0 }, pricing: ctx.pricing };

    return NextResponse.json({
      engine: 'mounting', version: MOUNTING_ENGINE_VERSION,
      actor: { email, role },
      ok: result.ok,
      input,
      geometry: {
        numberOfRows: result.numberOfRows, panelsPerRow: result.panelsPerRow,
        arrayWidthMm: result.arrayWidthMm, railsPerLine: result.railsPerLine,
        edgeSpacingMm: result.edgeSpacingMm, railUtilPercent: result.railUtilPercent,
        totalRailLengthM: result.totalRailLengthM,
        // Engine v12: how the 4850 rails are cut, or null for whole rails.
        cutPlan: result.cutPlan,
        // Engine v13: 'cost' (with both totals) or 'rails' (a price was missing).
        layoutDecision: result.layoutDecision,
      },
      pricing: reply.pricing,
      summary: reply.summary,
      lines: reply.lines,
      notes: designNotes(result.warnings, reply),
    });
  } catch (e) {
    if (e instanceof AgentAuthError) return NextResponse.json({ error: e.message }, { status: e.status });
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}
