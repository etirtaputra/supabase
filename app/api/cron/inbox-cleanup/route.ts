import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { verifyCronSecret } from '@/lib/cronAuth';
import { INBOX_TABLE, INBOX_BUCKET } from '@/lib/inboxProcess';
import { clearAfter, CLEAR_AFTER_DAYS } from '@/lib/inboxFiling';

/**
 * GET /api/cron/inbox-cleanup — the Inbox is a waiting room, not an archive.
 *
 * Owner, 2026-11-22: *"MIRA files to Drive, do the photo shrinking and
 * cleanup."* Every morning (vercel.json) this deletes the copy in storage
 * bucket `inbox` of:
 *   • a document filed in Drive (filed_at) more than 30 days ago, and
 *   • a dismissed document (dismissed_at) more than 30 days ago.
 * The ROW stays (what was read, what it became, where it is in Drive); only
 * the file goes, and `file_cleared_at` says when. A document that became a
 * deal but is NOT filed yet is never deleted — the Drive copy must exist first.
 *
 * Only the scheduler may call it (lib/cronAuth.ts, CRON_SECRET). Service-role:
 * storage objects can only be removed through the Storage API. `?dry=1` lists
 * what would go and deletes nothing.
 */
export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  if (!verifyCronSecret(request)) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return NextResponse.json({ error: 'Supabase service key is not configured' }, { status: 500 });
  const db = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
  const dry = new URL(request.url).searchParams.get('dry') === '1';

  const { data, error } = await db.from(INBOX_TABLE)
    .select('item_id, file_path, status, filed_at, dismissed_at')
    .is('file_cleared_at', null)
    .or('filed_at.not.is.null,dismissed_at.not.is.null')
    .limit(500);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  const now = Date.now();
  const due = (data ?? []).filter((r) => clearAfter(r) != null && (clearAfter(r) as number) <= now);
  if (dry || !due.length) return NextResponse.json({ dry, days: CLEAR_AFTER_DAYS, due: due.map((r) => r.item_id) });

  const { error: rmErr } = await db.storage.from(INBOX_BUCKET).remove(due.map((r) => r.file_path));
  if (rmErr) return NextResponse.json({ error: `Storage: ${rmErr.message}` }, { status: 502 });
  const { error: upErr } = await db.from(INBOX_TABLE).update({ file_cleared_at: new Date().toISOString() }).in('item_id', due.map((r) => r.item_id));
  if (upErr) return NextResponse.json({ error: upErr.message, removed: due.length }, { status: 500 });
  return NextResponse.json({ cleared: due.length });
}
