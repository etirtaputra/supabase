import { NextRequest, NextResponse } from 'next/server';
import Anthropic from '@anthropic-ai/sdk';
import { createClient } from '@supabase/supabase-js';

/**
 * The AI next-best-step card — the roadmap's operating principle made literal:
 * "the old era was telling the AI what to do; the new era is asking the AI
 * what it thinks we should do next."
 *
 * The client sends the SUMMARY IT ALREADY RENDERS for this role (position
 * tiles, month-in-motion, the ranked action queue) — nothing is read here
 * beyond proving the caller is a signed-in user, so the advice can never see
 * more than the person asking does. The reply is ONE step and its economic
 * consequence; the human decides.
 */

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

interface NextStepBody {
  position?: {
    cashIdr?: number | null;
    cashOther?: { currency: string; total: number }[];
    arOutstanding?: number; arOverdue?: number; arCount?: number;
    apOutstanding?: number; apReceivedOwed?: number; apCount?: number;
    ccc?: number | null; dio?: number | null; dso?: number | null; dpo?: number | null;
    stockValue?: number;
  };
  motion?: { label: string; now: number; prev: number }[];
  queue?: { title: string; detail: string; amount: number }[];
}

const idr = (n: number | null | undefined): string =>
  n == null ? 'n/a' : `Rp ${Math.round(n).toLocaleString('en-US')}`;

export async function POST(request: NextRequest) {
  try {
    const body = (await request.json()) as NextStepBody;

    const token = (request.headers.get('authorization') ?? '').replace(/^Bearer\s+/i, '');
    if (!token) return NextResponse.json({ error: 'Sign in required' }, { status: 401 });
    const authClient = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
      { auth: { persistSession: false } },
    );
    const { data: { user } } = await authClient.auth.getUser(token);
    if (!user) return NextResponse.json({ error: 'Sign in required' }, { status: 401 });

    const p = body.position ?? {};
    const lines: string[] = [];
    if (p.cashIdr != null) {
      const other = (p.cashOther ?? []).map((c) => `${c.currency} ${Math.round(c.total).toLocaleString('en-US')}`).join(', ');
      lines.push(`Cash in banks: ${idr(p.cashIdr)}${other ? ` (plus ${other})` : ''}`);
    }
    if (p.arOutstanding != null) lines.push(`Owed to us (AR): ${idr(p.arOutstanding)} across ${p.arCount ?? '?'} invoices, of which ${idr(p.arOverdue ?? 0)} overdue`);
    if (p.apOutstanding != null) lines.push(`We owe suppliers (AP): ${idr(p.apOutstanding)} across ${p.apCount ?? '?'} POs, of which ${idr(p.apReceivedOwed ?? 0)} for goods already received`);
    if (p.stockValue != null) lines.push(`Stock value: ${idr(p.stockValue)}`);
    if (p.ccc != null) lines.push(`Cash conversion cycle: ${Math.round(p.ccc)} days (DIO ${p.dio == null ? 'n/a' : Math.round(p.dio)}, DSO ${p.dso == null ? 'n/a' : Math.round(p.dso)}, DPO ${p.dpo == null ? 'n/a' : Math.round(p.dpo)} — negative DPO means we prepay imports)`);

    const motion = (body.motion ?? [])
      .map((m) => `${m.label}: ${idr(m.now)} this month-to-date vs ${idr(m.prev)} same days last month`)
      .join('\n');
    const queue = (body.queue ?? []).slice(0, 8)
      .map((q, n) => `${n + 1}. ${q.title} — ${q.detail}${q.amount > 0 ? ` (${idr(q.amount)})` : ''}`)
      .join('\n');

    const system = `You are ICAPROC's operating advisor for an Indonesian solar/electrical distribution business.
Distribution is air-traffic control and the cash conversion cycle is the runway: the business wins by cycling items through at a profit — buy, stock, sell, collect, repeat.
Given today's position, this month's motion, and the ranked action queue, propose the SINGLE next best step.

Rules:
- Pick ONE step — the one with the largest economic consequence per unit of effort. Name the number that moves and by roughly how much.
- 2–3 short sentences of plain text. No markdown, no lists, no preamble like "Based on the data".
- Speak like a sharp operations partner: direct, concrete, calm.
- If the queue is empty and the position is healthy, say what to check or improve next instead of inventing urgency.
- The human decides — phrase it as a recommendation, never as an executed action.`;

    const content = `TODAY'S POSITION
${lines.join('\n') || '(no position data for this role)'}

MONTH IN MOTION
${motion || '(no comparison data)'}

ACTION QUEUE (ranked by money at stake)
${queue || '(queue is empty — nothing blocked)'}`;

    const completion = await anthropic.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 300,
      system,
      messages: [{ role: 'user', content }],
      temperature: 0.4,
    });

    const suggestion = completion.content[0]?.type === 'text' ? completion.content[0].text.trim() : '';
    if (!suggestion) return NextResponse.json({ error: 'No suggestion' }, { status: 502 });
    return NextResponse.json({ suggestion });
  } catch (error) {
    console.error('next-step error:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 },
    );
  }
}
