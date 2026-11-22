/**
 * POST /api/inbox/:id/read — read an Inbox document again (it failed, or the
 * catalogue changed since). Same reader and matcher as a new document, as the
 * caller. Spends one Claude read: authenticated, buy side only (RLS).
 */
import { NextResponse } from 'next/server';
import { callerFromRequest, AgentAuthError } from '@/lib/agentApi';
import { processInboxItem, INBOX_TABLE } from '@/lib/inboxProcess';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 300;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const fail = (status: number, error: string) => NextResponse.json({ error }, { status });

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!UUID.test(id)) return fail(400, 'Not an inbox item');
  let caller;
  try { caller = await callerFromRequest(request); }
  catch (e) { return e instanceof AgentAuthError ? fail(e.status, e.message) : fail(500, 'Sign-in check failed'); }
  const { data: row } = await caller.client.from(INBOX_TABLE).select('item_id, file_path, mime_type, status').eq('item_id', id).maybeSingle();
  if (!row) return fail(404, 'No such inbox item (or not visible to your role).');
  if (row.status === 'done') return fail(409, 'This document already became a deal.');
  try {
    return NextResponse.json({ item: await processInboxItem(caller.client, row) });
  } catch (e) {
    return fail(500, e instanceof Error ? e.message : String(e));
  }
}
