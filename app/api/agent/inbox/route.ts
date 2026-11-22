import { NextRequest, NextResponse } from 'next/server';
import { callerFromRequest, AgentAuthError } from '@/lib/agentApi';
import { ROLE_PERMISSIONS } from '@/constants/roles';
import { inGroup } from '@/lib/lifecycles';
import { fetchAllRows, type PageResult } from '@/lib/fetchAllRows';
import { dealsFrom, findDuplicates, dupMessage, inboxDupView, DEAL_QUOTE_COLS, DEAL_PO_COLS, INBOX_DUP_COLS } from '@/lib/inboxDuplicates';
import { INBOX_TABLE, INBOX_BUCKET } from '@/lib/inboxProcess';

/**
 * GET /api/agent/inbox — the Inbox, for an agent (MIRA). 2026-11-22.
 *
 * Owner: *"MIRA files to Drive"* and *"how will the Inbox and MIRA check for
 * duplicates? This is important."* Three questions, one route:
 *
 *   ?doc=<number>   Is this document number already in ICAPROC or waiting in
 *                   the Inbox? Ask BEFORE creating a deal yourself (when
 *                   someone asks you to on Telegram). Optional &supplier_id=.
 *                   The answer runs the SAME check as the Inbox screen
 *                   (lib/inboxDuplicates findDuplicates): same / revision /
 *                   inbox. Empty `hits` = new.
 *   ?to_file=1      Documents that became a deal and are not in Drive yet:
 *                   each with its deal (PI, PO, supplier, the deal's Document
 *                   Folder link), the file's md5 (Drive's md5Checksum — check
 *                   before you upload) and a download link valid 1 hour.
 *   (none)          What still waits for a person (status received / proposed
 *                   / failed), each with its LIVE duplicate check.
 *
 * Sending a document IN is POST /api/inbox (multipart `file`, `source=agent`).
 * Recording what happened to one is POST /api/agent/inbox/:id.
 * Buy-side roles only, as the caller (RLS applies). Read-only.
 */
export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  try {
    const { client: db, email, role } = await callerFromRequest(request);
    if (!ROLE_PERMISSIONS[role as keyof typeof ROLE_PERMISSIONS]?.buySide) {
      return NextResponse.json({ error: 'Your role may not read purchasing.', actor: { email, role } }, { status: 403 });
    }
    const url = new URL(request.url);
    const all = <T,>(table: string, cols: string) => fetchAllRows<T>((f, t) =>
      db.from(table).select(cols).range(f, t) as unknown as PromiseLike<PageResult<T>>).then((r) => r.rows);

    if (url.searchParams.get('to_file') === '1') {
      const { data, error } = await db.from(INBOX_TABLE)
        .select('item_id, file_name, mime_type, file_bytes, file_md5, file_path, quote_id, po_id, done_at, done_by_email, received_at, source, proposal')
        .eq('status', 'done').is('filed_at', null).is('file_cleared_at', null).order('done_at');
      if (error) throw new Error(error.message);
      const rows = data ?? [];
      const poIds = rows.map((r) => r.po_id).filter(Boolean);
      const qIds = rows.map((r) => r.quote_id).filter(Boolean);
      const [{ data: pos }, { data: qs }] = await Promise.all([
        poIds.length ? db.from('5.0_purchases').select('po_id, po_number, pi_number, pi_date, document_url, supplier_id').in('po_id', poIds) : Promise.resolve({ data: [] as never[] }),
        qIds.length ? db.from('4.0_price_quotes').select('quote_id, pi_number, quote_date, document_url, supplier_id').in('quote_id', qIds) : Promise.resolve({ data: [] as never[] }),
      ]);
      const poBy = new Map((pos ?? []).map((p: { po_id: string }) => [String(p.po_id), p]));
      const qBy = new Map((qs ?? []).map((q: { quote_id: string }) => [String(q.quote_id), q]));
      const items = await Promise.all(rows.map(async (r) => {
        const { data: signed } = await db.storage.from(INBOX_BUCKET).createSignedUrl(r.file_path, 3600);
        const { file_path: _path, proposal, ...rest } = r;
        void _path;
        return {
          ...rest,
          supplier: proposal?.supplier?.matchedName ?? proposal?.supplier?.name ?? null,
          po: r.po_id ? poBy.get(String(r.po_id)) ?? null : null,
          quote: r.quote_id ? qBy.get(String(r.quote_id)) ?? null : null,
          download_url: signed?.signedUrl ?? null,
        };
      }));
      return NextResponse.json({ count: items.length, items });
    }

    const [quotes, pos, inboxRows] = await Promise.all([
      all<Parameters<typeof dealsFrom>[0][number]>('4.0_price_quotes', DEAL_QUOTE_COLS),
      all<Parameters<typeof dealsFrom>[1][number]>('5.0_purchases', DEAL_PO_COLS),
      all<Parameters<typeof inboxDupView>[0]>(INBOX_TABLE, INBOX_DUP_COLS),
    ]);
    const deals = dealsFrom(quotes, pos);
    const inbox = inboxRows.map(inboxDupView);
    const explain = (hits: ReturnType<typeof findDuplicates>) => hits.map((h) => {
      const m = dupMessage(h);
      return { ...h, message: m.text.replace(/\{(\w+)\}/g, (_, k: string) => String(m.vars[k] ?? '')) };
    });

    const docNo = (url.searchParams.get('doc') ?? '').trim();
    if (docNo) {
      const supplierId = url.searchParams.get('supplier_id') || null;
      const hits = findDuplicates({ supplier_id: supplierId, numbers: [docNo], total: null, currency: null, date: null }, deals, inbox);
      return NextResponse.json({ doc: docNo, supplier_id: supplierId, is_new: hits.length === 0, hits: explain(hits) });
    }

    const open = inbox.filter((i) => inGroup('inbox_item', 'open', i.status));
    const byId = new Map(inboxRows.map((r) => [r.item_id, r]));
    return NextResponse.json({
      count: open.length,
      items: open.map((i) => ({
        item_id: i.item_id, file_name: i.file_name, received_at: i.received_at, status: i.status,
        proposal: byId.get(i.item_id)?.proposal ?? null,
        duplicates: explain(findDuplicates({ ...i, item_id: i.item_id }, deals, inbox)),
      })),
    });
  } catch (e) {
    if (e instanceof AgentAuthError) return NextResponse.json({ error: e.message }, { status: e.status });
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}
