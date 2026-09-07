import { NextRequest, NextResponse } from 'next/server';
import { callerFromRequest, AgentAuthError, visibleKinds, hiddenKinds } from '@/lib/agentApi';

/**
 * GET /api/agent/attention/summary — the digest, for a daily message.
 *
 * One row per signal with counts and totals, so an agent can decide what to
 * report without pulling every item. `hidden_kinds` is part of the answer:
 * a digest that silently omits AR because the caller may not see it would
 * read as "nothing outstanding".
 */
export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  try {
    const { client, email, role } = await callerFromRequest(request);
    const { data, error } = await client.from('agent_attention_summary').select('*');
    if (error) return NextResponse.json({ error: error.message }, { status: 502 });

    const signals = (data ?? []).sort((a, b) => (b.high ?? 0) - (a.high ?? 0) || (b.items ?? 0) - (a.items ?? 0));
    return NextResponse.json({
      generated_at: new Date().toISOString(),
      actor: { email, role },
      visible_kinds: visibleKinds(role),
      hidden_kinds: hiddenKinds(role),
      totals: {
        items: signals.reduce((s, r) => s + Number(r.items ?? 0), 0),
        high: signals.reduce((s, r) => s + Number(r.high ?? 0), 0),
      },
      signals,
    });
  } catch (e) {
    if (e instanceof AgentAuthError) return NextResponse.json({ error: e.message }, { status: e.status });
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}
