import { NextRequest, NextResponse } from 'next/server';
import { callerFromRequest, AgentAuthError } from '@/lib/agentApi';
import { designContext, resolveAndPrice, designNotes, mountingInputFrom } from '@/lib/agentDesign';
import { calculateMounting, RAIL_LENGTHS_MM, V11_PANEL_PRESETS } from '@/lib/systemDesign/mounting';
import { mountingSystems, shortlist, type RailProfile } from '@/lib/systemDesign/mountingSystem';

/**
 * POST /api/agent/design/mounting — the v11 mounting calculator, for agents.
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

    const result = calculateMounting(input);
    const ctx = await designContext(client, { customerId: body.customerId, categories: ['mounting'] });
    // A kit is only valid within one system; an unshortlisted run can mix them.
    const scoped = body.series
      ? { ...ctx, candidates: shortlist(ctx.candidates, body.series, body.railProfile) }
      : ctx;
    const reply = result.ok ? resolveAndPrice(result.lines, scoped)
                            : { lines: [], summary: { lines: 0, unresolved: 0, unpriced: 0, short: 0, total: 0 }, pricing: ctx.pricing };

    return NextResponse.json({
      engine: 'mounting', version: 11,
      actor: { email, role },
      ok: result.ok,
      input,
      geometry: {
        numberOfRows: result.numberOfRows, panelsPerRow: result.panelsPerRow,
        arrayWidthMm: result.arrayWidthMm, railsPerLine: result.railsPerLine,
        edgeSpacingMm: result.edgeSpacingMm, railUtilPercent: result.railUtilPercent,
        totalRailLengthM: result.totalRailLengthM,
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
