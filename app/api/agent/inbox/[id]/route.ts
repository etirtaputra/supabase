import { NextResponse } from 'next/server';
import { callerFromRequest, AgentAuthError } from '@/lib/agentApi';
import { ROLE_PERMISSIONS } from '@/constants/roles';
import { canMove } from '@/lib/lifecycles';
import { INBOX_TABLE } from '@/lib/inboxProcess';

/**
 * POST /api/agent/inbox/:id — record what happened to one Inbox document (MIRA).
 *
 * JSON body, one `action`:
 *   { "action": "filed", "drive_url": "https://drive.google.com/…" }
 *       The document is in the deal's Drive folder — uploaded by you, or the
 *       same file was ALREADY there (your upload script refused it: give that
 *       file's link). Only for a document that became a deal (status done).
 *       The copy in ICAPROC is deleted 30 days later (lifecycle inbox_file).
 *   { "action": "done", "quote_id": "…", "po_id": "…" }
 *       You created the deal yourself (someone asked you to on Telegram) from
 *       a document that was waiting in the Inbox: link it, so it does not
 *       stay open as a twin. At least one of quote_id / po_id.
 *   { "action": "dismiss", "reason": "…" }
 *       Not needed (a duplicate, not a supplier document).
 *
 * Buy-side writers only, as the caller (RLS: can_write_buy_side).
 */
export const dynamic = 'force-dynamic';

const bad = (status: number, error: string) => NextResponse.json({ error }, { status });

export async function POST(request: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const { client: db, email, role } = await callerFromRequest(request);
    if (!ROLE_PERMISSIONS[role as keyof typeof ROLE_PERMISSIONS]?.buySide) return bad(403, 'Your role may not change purchasing.');
    const { id } = await ctx.params;
    const body = await request.json().catch(() => null) as Record<string, unknown> | null;
    const action = String(body?.action ?? '');

    const { data: item, error: readErr } = await db.from(INBOX_TABLE).select('item_id, status, filed_at, quote_id, po_id').eq('item_id', id).maybeSingle();
    if (readErr) return bad(500, readErr.message);
    if (!item) return bad(404, 'No such Inbox document.');

    let patch: Record<string, unknown>;
    if (action === 'filed') {
      const driveUrl = String(body?.drive_url ?? '').trim();
      if (!/^https:\/\/(drive|docs)\.google\.com\//.test(driveUrl)) return bad(400, 'drive_url must be a Google Drive link.');
      if (item.status !== 'done') return bad(409, 'Only a document that became a deal is filed. Create (or link) the deal first.');
      if (item.filed_at) return bad(409, 'Already filed.');
      patch = { filed_at: new Date().toISOString(), filed_by_email: email || null, drive_url: driveUrl };
    } else if (action === 'done') {
      const quoteId = body?.quote_id ? String(body.quote_id) : null;
      const poId = body?.po_id ? String(body.po_id) : null;
      if (!quoteId && !poId) return bad(400, 'Give quote_id and/or po_id of the deal you created.');
      if (!canMove('inbox_item', item.status, 'done')) return bad(409, `A document that is "${item.status}" cannot be linked to a deal.`);
      patch = { status: 'done', quote_id: quoteId, po_id: poId, done_at: new Date().toISOString(), done_by_email: email || null };
    } else if (action === 'dismiss') {
      if (!canMove('inbox_item', item.status, 'dismissed')) return bad(409, `A document that is "${item.status}" cannot be dismissed.`);
      patch = { status: 'dismissed', dismissed_reason: String(body?.reason ?? '').trim() || null, dismissed_at: new Date().toISOString() };
    } else {
      return bad(400, 'action must be "filed", "done" or "dismiss".');
    }

    const { data, error } = await db.from(INBOX_TABLE).update(patch).eq('item_id', id).select('*').single();
    if (error) return bad(/row-level security/i.test(error.message) ? 403 : 500, error.message);
    return NextResponse.json({ item: data });
  } catch (e) {
    if (e instanceof AgentAuthError) return NextResponse.json({ error: e.message }, { status: e.status });
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}
