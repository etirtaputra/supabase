/**
 * Send a supplier document to the Inbox — the ONE way a document is read
 * (owner, 2026-11-23: New Deal's "Upload Quote/PI" and the Inbox were two
 * readers; "Yes, merge them"). Both call sites use this: the Inbox screen
 * (read now, deal later) and New Deal (read now, form filled at once). Either
 * way the file is kept, duplicate-checked, and filed to Drive once it is a deal.
 * Browser-only.
 */
import { createSupabaseClient } from '@/lib/supabase';
import { shrinkPhoto } from '@/lib/shrinkPhoto';
import type { InboxProposal, ReadDocument } from '@/lib/inboxMatch';

export class InboxUploadError extends Error {}

export interface InboxRow {
  item_id: string; file_name: string; status: string;
  extracted: ReadDocument | null; proposal: InboxProposal | null; error: string | null;
}

export async function sendToInbox(original: File): Promise<{ item: InboxRow; duplicate: boolean }> {
  const supabase = createSupabaseClient();
  const { data: { session } } = await supabase.auth.getSession();
  if (!session?.access_token) throw new InboxUploadError('Your session has expired — sign in again.');
  const file = await shrinkPhoto(original);   // a 3 MB phone photo goes up as ~0.3 MB
  const body = new FormData();
  body.append('file', file);
  const res = await fetch('/api/inbox', { method: 'POST', headers: { Authorization: `Bearer ${session.access_token}` }, body });
  const j = await res.json().catch(() => ({}));
  if (!res.ok || !j.item) throw new InboxUploadError(j.error || `HTTP ${res.status}`);
  return { item: j.item as InboxRow, duplicate: !!j.duplicate };
}
