/**
 * Read one Inbox document and store what the system proposes — shared by
 * POST /api/inbox (a new document) and POST /api/inbox/:id/read (read again).
 * Runs AS THE CALLER (their Supabase client): RLS decides what they may read
 * and update, exactly as on the screens. Server-only.
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import { fetchAllRows, fetchAllComponents, type PageResult } from './fetchAllRows.ts';
import { buildProposal, type InboxLookups } from './inboxMatch.ts';
import { readDocument, ReadFailure, type ReadableType } from './inboxRead.ts';

export const INBOX_TABLE = '43.0_inbox_items';
export const INBOX_BUCKET = 'inbox';

async function lookups(db: SupabaseClient): Promise<InboxLookups> {
  const all = <T>(table: string, cols: string) => fetchAllRows<T>((f, t) =>
    db.from(table).select(cols).range(f, t) as unknown as PromiseLike<PageResult<T>>).then((r) => r.rows);
  const [suppliers, companies, components, quotes, pos] = await Promise.all([
    all<InboxLookups['suppliers'][number]>('2.0_suppliers', 'supplier_id, supplier_name'),
    all<InboxLookups['companies'][number]>('1.0_companies', 'company_id, legal_name'),
    fetchAllComponents<InboxLookups['components'][number]>(db, 'component_id, supplier_model, internal_description, brand'),
    all<InboxLookups['quotes'][number]>('4.0_price_quotes', 'quote_id, pi_number, supplier_id'),
    all<InboxLookups['pos'][number]>('5.0_purchases', 'po_id, po_number, pi_number, supplier_id'),
  ]);
  return { suppliers, companies, components, quotes, pos };
}

/** Read the stored file, propose, and save the outcome on the row. Returns the updated row. */
export async function processInboxItem(db: SupabaseClient, item: { item_id: string; file_path: string; mime_type: string }) {
  let patch: Record<string, unknown>;
  try {
    const { data: blob, error } = await db.storage.from(INBOX_BUCKET).download(item.file_path);
    if (error || !blob) throw new ReadFailure(`The stored file could not be opened${error ? `: ${error.message}` : ''}.`);
    const { doc } = await readDocument(new Uint8Array(await blob.arrayBuffer()), item.mime_type as ReadableType);
    const proposal = buildProposal(doc, await lookups(db));
    patch = { status: 'proposed', kind: doc.document_type ?? 'other', extracted: doc, proposal, error: null, read_at: new Date().toISOString() };
  } catch (e) {
    if (!(e instanceof ReadFailure)) console.error('[inbox read]', e);
    patch = { status: 'failed', error: e instanceof ReadFailure ? e.message : 'The document could not be read — try again.', read_at: new Date().toISOString() };
  }
  const { data, error } = await db.from(INBOX_TABLE).update(patch).eq('item_id', item.item_id).select('*').single();
  if (error) throw new Error(`The result could not be saved: ${error.message}`);
  return data;
}
