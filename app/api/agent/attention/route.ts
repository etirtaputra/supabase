import { NextRequest, NextResponse } from 'next/server';
import { callerFromRequest, AgentAuthError, visibleKinds, hiddenKinds, ALL_KINDS } from '@/lib/agentApi';

/**
 * GET /api/agent/attention — what needs attention, as rows.
 *
 * The read-only half of the agent platform: an agent can be useful here
 * before it can write anything. Every row is one thing to look at, with a
 * severity, a subject, a number and a reference to drill into.
 *
 *   ?severity=high        only that severity
 *   ?kind=po_late,unpriced  one or more signal kinds
 *   ?limit=50             1..200, default 50
 *
 * The response always carries `visible_kinds` and `hidden_kinds` for the
 * caller's role. An agent must report against those, not against an empty
 * array: "no overdue invoices" and "I cannot see AR" are different claims.
 */
export const dynamic = 'force-dynamic';

const SEVERITY_RANK: Record<string, number> = { high: 0, medium: 1, low: 2 };

export async function GET(request: NextRequest) {
  try {
    const { client, email, role } = await callerFromRequest(request);
    const params = request.nextUrl.searchParams;

    const severity = params.get('severity');
    if (severity && !(severity in SEVERITY_RANK)) {
      return NextResponse.json(
        { error: `Unknown severity '${severity}'. Use high, medium or low.` }, { status: 400 });
    }

    const kinds = (params.get('kind') ?? '').split(',').map((k) => k.trim()).filter(Boolean);
    const unknown = kinds.filter((k) => !ALL_KINDS.includes(k));
    if (unknown.length) {
      return NextResponse.json(
        { error: `Unknown kind(s): ${unknown.join(', ')}`, valid_kinds: ALL_KINDS }, { status: 400 });
    }

    const rawLimit = Number(params.get('limit') ?? 50);
    const limit = Number.isFinite(rawLimit) ? Math.min(200, Math.max(1, Math.trunc(rawLimit))) : 50;

    let query = client.from('agent_attention').select('*');
    if (severity) query = query.eq('severity', severity);
    if (kinds.length) query = query.in('kind', kinds);

    const { data, error } = await query;
    if (error) return NextResponse.json({ error: error.message }, { status: 502 });

    // Ordered here rather than in SQL: severity is a word, not a sortable
    // value, and the view stays a plain UNION anyone can read.
    const rows = (data ?? []).sort((a, b) =>
      (SEVERITY_RANK[a.severity] ?? 9) - (SEVERITY_RANK[b.severity] ?? 9)
      || (b.age_days ?? -1) - (a.age_days ?? -1)
      || String(a.subject).localeCompare(String(b.subject)));

    return NextResponse.json({
      generated_at: new Date().toISOString(),
      actor: { email, role },
      visible_kinds: visibleKinds(role),
      hidden_kinds: hiddenKinds(role),
      returned: Math.min(rows.length, limit),
      total_matching: rows.length,
      items: rows.slice(0, limit),
    });
  } catch (e) {
    if (e instanceof AgentAuthError) return NextResponse.json({ error: e.message }, { status: e.status });
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}
