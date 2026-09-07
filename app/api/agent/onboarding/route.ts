import { NextRequest, NextResponse } from 'next/server';
import { callerFromRequest, AgentAuthError, visibleKinds, hiddenKinds } from '@/lib/agentApi';
import { AGENT_DOCS, AGENT_ENDPOINTS, AGENT_RULES } from '@/lib/agentDocs';

/**
 * GET /api/agent/onboarding — the first call an agent makes after signing in.
 *
 * Owner's ask, 2026-09-06: "AI agents know where to look to onboard themselves
 * to using ICAPROC." This is that call. Who am I, what may I see, what may I
 * not, which documents are current, what can I call, and the rules that hold
 * regardless of role.
 *
 * WHY IT IS AN ENDPOINT AND NOT JUST THE INDEX FILE: the packs live in a
 * shared Drive, and a copy in Drive can be months old without looking it. The
 * document names here come from `lib/agentDocs.ts`, which the test suite checks
 * against the files actually in `docs/agents/` — so this route cannot name a
 * pack that does not exist, and an agent comparing what it holds against what
 * this returns finds out immediately that it is reading a superseded file.
 *
 * It answers AS THE CALLER, like every other agent route: the capability lists
 * are this account's, not a general description of the system.
 */
export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  try {
    const { email, role } = await callerFromRequest(request);
    const visible = visibleKinds(role);
    const hidden = hiddenKinds(role);

    return NextResponse.json({
      generated_at: new Date().toISOString(),
      actor: { email, role },

      // Say it plainly rather than leaving it to be inferred from a role name.
      identity_note:
        `Every row you write is stamped ${email} by a database trigger reading your token. ` +
        'You cannot forge it and cannot forget it — which is the point of having your own account.',

      capabilities: {
        attention_kinds_visible: visible,
        attention_kinds_hidden: hidden,
        // The distinction that keeps a report honest: an empty result and a
        // signal you were never allowed to see are not the same claim.
        reporting_rule: hidden.length
          ? `Never report zero for ${hidden.join(', ')}. Say they are outside what your role can see.`
          : 'Your role can see every attention signal, so a zero is a real zero.',
      },

      endpoints: AGENT_ENDPOINTS,

      read_first: AGENT_DOCS.filter((d) => d.first).map((d) => d.file),
      documents: AGENT_DOCS.map(({ id, title, file, audience }) => ({
        id, title, file, audience, path: `docs/agents/${file}`,
      })),
      documents_note:
        'Filenames carry _v<N>_YYYY-MM-DD. If the copy you hold is named differently, it is superseded — ' +
        'ask for the file named here before relying on it.',

      rules: AGENT_RULES,
    });
  } catch (e) {
    if (e instanceof AgentAuthError) return NextResponse.json({ error: e.message }, { status: e.status });
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}
