/**
 * POST /api/inbox — a document arrives (zero-entry ERP, 2026-11-22).
 *
 * The same door for every channel: the Inbox screen (upload / phone photo)
 * and agents like MIRA (source=agent). Multipart form: `file` (PDF, JPEG,
 * PNG, WebP; ≤ 20 MB), optional `note`, optional `source` ('upload' |
 * 'agent'). Authorization: Bearer <access_token>.
 *
 * Stores the file in the private `inbox` bucket, records the row, reads it
 * (lib/inboxRead, Claude) and stores the proposal (lib/inboxMatch) — all as
 * the caller, so RLS (buy side only) is the gate. The same file twice is not
 * stored twice: the existing row comes back with `duplicate: true`.
 *
 * THIS ROUTE SPENDS MONEY (one Claude read per new document) — never open it
 * to an unauthenticated caller (lib/apiAuth.test.ts).
 */
import { NextResponse } from 'next/server';
import { createHash, randomUUID } from 'node:crypto';
import { callerFromRequest, AgentAuthError } from '@/lib/agentApi';
import { READABLE_TYPES, type ReadableType } from '@/lib/inboxRead';
import { processInboxItem, INBOX_TABLE, INBOX_BUCKET } from '@/lib/inboxProcess';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 300;

const MAX_BYTES = 20 * 1024 * 1024;
const fail = (status: number, error: string) => NextResponse.json({ error }, { status });

export async function POST(request: Request) {
  let caller;
  try { caller = await callerFromRequest(request); }
  catch (e) { return e instanceof AgentAuthError ? fail(e.status, e.message) : fail(500, 'Sign-in check failed'); }
  const db = caller.client;

  const form = await request.formData().catch(() => null);
  const file = form?.get('file');
  if (!(file instanceof File)) return fail(400, 'Send the document as `file` (multipart form).');
  const mime = (file.type || '').toLowerCase();
  if (!(READABLE_TYPES as readonly string[]).includes(mime)) return fail(415, 'PDF, JPEG, PNG or WebP only.');
  if (file.size > MAX_BYTES) return fail(413, 'That file is over 20 MB.');
  const note = String(form?.get('note') ?? '').trim() || null;
  const source = form?.get('source') === 'agent' ? 'agent' : 'upload';

  const bytes = new Uint8Array(await file.arrayBuffer());
  const sha = createHash('sha256').update(bytes).digest('hex');

  // The same file again (forwarded twice, sent by two people): return the row.
  const { data: same } = await db.from(INBOX_TABLE).select('*').eq('file_sha256', sha).limit(1).maybeSingle();
  if (same) return NextResponse.json({ item: same, duplicate: true });

  const now = new Date();
  const safe = (file.name || 'document').replace(/[^\w.\-]+/g, '_').slice(-80);
  const path = `${now.getUTCFullYear()}/${String(now.getUTCMonth() + 1).padStart(2, '0')}/${randomUUID()}-${safe}`;
  const up = await db.storage.from(INBOX_BUCKET).upload(path, bytes, { contentType: mime, upsert: false });
  if (up.error) {
    const denied = /row-level security|not authorized|unauthorized/i.test(up.error.message);
    return fail(denied ? 403 : 500, denied ? 'Your role cannot add supplier documents.' : `The file could not be stored: ${up.error.message}`);
  }

  const { data: row, error } = await db.from(INBOX_TABLE).insert({
    received_by_email: caller.email || null, source, note,
    file_path: path, file_name: file.name || safe, mime_type: mime as ReadableType, file_bytes: file.size, file_sha256: sha,
  }).select('*').single();
  if (error || !row) return fail(error && /row-level security/i.test(error.message) ? 403 : 500, error?.message ?? 'The document could not be recorded.');

  try {
    const item = await processInboxItem(db, row);
    return NextResponse.json({ item, duplicate: false });
  } catch (e) {
    // Stored and recorded; only the reading failed to save — the row stays
    // "received" and can be read again from the Inbox.
    return NextResponse.json({ item: row, duplicate: false, warning: e instanceof Error ? e.message : String(e) });
  }
}
