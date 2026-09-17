import { NextRequest, NextResponse } from 'next/server';
import { callerFromRequest, AgentAuthError } from '@/lib/agentApi';
import { ROLE_PERMISSIONS } from '@/constants/roles';
import { salesTotals, lineTotal } from '@/lib/salesTotals';

/**
 * POST /api/agent/sales/mirror — record a sales order that happened elsewhere.
 *
 * WHY THIS EXISTS. Owner, 2026-09-17, after MIRA asked instead of writing:
 * orders are still being taken in Dolibarr (the legacy ERP) and ICAPROC has no
 * record of them. MIRA was right to stop — the schema pack says *"read the sell
 * side, do not write it — not yet"*, and the reason is real: nothing in the
 * DATABASE computes `subtotal` / `ppn_amount` / `grand_total`. An agent
 * inserting rows directly would leave a document whose header disagrees with its
 * own lines — no error, nothing flagged, wrong only when somebody invoices it.
 *
 * So this is the safe path that replaces the prohibition. The totals come from
 * `lib/salesTotals.ts`, which the browser editor now also calls, so the two
 * cannot drift.
 *
 * ── WHAT THIS DELIBERATELY DOES NOT DO ───────────────────────────────────────
 *
 * **It does not move stock.** Owner's decision, 2026-09-17: *"mirror documents
 * first then stock as a separate step"*. That split is not caution for its own
 * sake — checked 2026-09-17, the ledger holds exactly FIVE stock-out movements
 * in total and nothing in the app writes them, while the goods in these orders
 * ARE in ICAPROC (720 TRINA panels, 240 EPEVER MPPTs on hand). So ICAPROC's
 * stock is already overstated by everything sold through Dolibarr, and this
 * endpoint does not make that better or worse. It records the documents; the
 * stock leg is a separate, deliberate action against an append-only ledger.
 *
 * Every mirrored document carries `external_source` + `external_ref`, so the
 * set of orders whose stock has not yet been taken off is a QUERY, not a memory.
 *
 * ── THE TWO THINGS IT REFUSES ────────────────────────────────────────────────
 *
 * 1. **An unmatched customer.** It will not invent a `20.0_customers` row.
 *    "Eddy" is exactly the name that becomes a duplicate, and merging customers
 *    later corrupts history. Unmatched → 409 with candidates, and a human picks.
 *    Pass `customer_id` explicitly to resolve it.
 * 2. **A second copy of the same order.** `external_source` + `external_ref` is
 *    the idempotency key: re-mirroring SO2609-4853 returns the existing document
 *    rather than a twin. An import that runs twice is the normal case, not the
 *    exception.
 *
 * A line with no catalogue match is NOT refused — `22.1.component_id` is
 * nullable and `description` exists, which is how the EPC builder has always
 * handled one-offs. "Karet Spons 12mm" becomes a description-only line: real
 * revenue, no stock implication, nothing invented in the catalogue.
 */
export const dynamic = 'force-dynamic';

const SALES = '22.0_sales_quotes';
const ITEMS = '22.1_sales_quote_items';

/** End states a mirrored order may land in. See the lifecycle note below. */
const ALLOWED_STATUS = ['ordered', 'invoiced', 'delivered', 'cancelled'] as const;
type MirrorStatus = typeof ALLOWED_STATUS[number];

interface InLine {
  component_id?: string | null;
  description?: string | null;
  unit?: string | null;
  quantity: number;
  unit_price: number;
}
interface InBody {
  external_ref?: string;
  external_source?: string;
  customer_id?: string | null;
  customer_name?: string | null;
  status?: string;
  quote_date?: string;
  ordered_at?: string | null;
  delivered_at?: string | null;
  invoiced_at?: string | null;
  ppn_pct?: number;
  notes?: string;
  lines?: InLine[];
}

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

export async function POST(request: NextRequest) {
  try {
    const { client, email, role } = await callerFromRequest(request);
    const perms = ROLE_PERMISSIONS[role as keyof typeof ROLE_PERMISSIONS];
    if (!perms?.canEditSalesDocs) {
      return NextResponse.json({
        error: 'Your role may not write sales documents.', actor: { email, role },
      }, { status: 403 });
    }

    const b = (await request.json().catch(() => ({}))) as InBody;
    const externalRef = String(b.external_ref ?? '').trim();
    const externalSource = String(b.external_source ?? 'dolibarr').trim().toLowerCase();
    const lines = Array.isArray(b.lines) ? b.lines : [];

    if (!externalRef) {
      return NextResponse.json({
        error: 'external_ref is required — it is what makes this import idempotent.',
      }, { status: 400 });
    }
    if (lines.length === 0) {
      return NextResponse.json({ error: 'At least one line is required.' }, { status: 400 });
    }
    const status = String(b.status ?? 'delivered') as MirrorStatus;
    if (!ALLOWED_STATUS.includes(status)) {
      return NextResponse.json({
        error: `status must be one of ${ALLOWED_STATUS.join(', ')}.`,
        note: 'A mirrored order records where it ENDED. Fabricating draft → sent → accepted stamps that never happened is a worse audit trail than none.',
      }, { status: 400 });
    }
    for (const [i, l] of lines.entries()) {
      if (!(Number(l.quantity) > 0)) return NextResponse.json({ error: `Line ${i + 1}: quantity must be > 0.` }, { status: 400 });
      if (!Number.isFinite(Number(l.unit_price))) return NextResponse.json({ error: `Line ${i + 1}: unit_price must be a number.` }, { status: 400 });
      if (!l.component_id && !String(l.description ?? '').trim()) {
        return NextResponse.json({ error: `Line ${i + 1}: needs a component_id or a description.` }, { status: 400 });
      }
    }

    // ── Already mirrored? Idempotency before anything else ──────────────────
    const { data: existing } = await client.from(SALES)
      .select('quote_id, quote_number, status, grand_total')
      .eq('external_source', externalSource).eq('external_ref', externalRef).maybeSingle();
    if (existing) {
      return NextResponse.json({
        created: false, outcome: 'already_mirrored',
        quote_id: existing.quote_id, quote_number: existing.quote_number,
        status: existing.status, grand_total: existing.grand_total,
        note: 'This order is already in ICAPROC. Nothing was written.',
      });
    }

    // ── The customer, or a refusal with candidates ──────────────────────────
    let customerId = String(b.customer_id ?? '').trim() || null;
    if (!customerId) {
      const wanted = String(b.customer_name ?? '').trim();
      if (!wanted) return NextResponse.json({ error: 'customer_id or customer_name is required.' }, { status: 400 });

      const { data: customers } = await client.from('20.0_customers')
        .select('customer_id, customer_code, display_name, legal_name, is_active');
      const rows = (customers ?? []) as { customer_id: string; customer_code: string | null; display_name: string | null; legal_name: string | null; is_active: boolean | null }[];
      const w = norm(wanted);
      const exact = rows.filter((c) => norm(c.display_name ?? '') === w || norm(c.legal_name ?? '') === w);
      if (exact.length === 1) {
        customerId = exact[0].customer_id;
      } else {
        // Never auto-create. A duplicate customer is cheap to make and
        // expensive to unpick, and "Eddy" is exactly the shape that duplicates.
        const near = rows.filter((c) => {
          const dn = norm(c.display_name ?? ''), ln = norm(c.legal_name ?? '');
          return dn.includes(w) || w.includes(dn) || ln.includes(w) || w.includes(ln);
        }).slice(0, 8);
        return NextResponse.json({
          created: false, outcome: 'unmatched_customer', customer_name: wanted,
          candidates: near.map((c) => ({
            customer_id: c.customer_id, code: c.customer_code,
            name: c.display_name || c.legal_name, active: c.is_active,
          })),
          note: exact.length > 1
            ? 'Several customers share that name — pass customer_id to say which.'
            : 'No confident match. Pick one of the candidates and pass customer_id, or create the customer in ICAPROC first. This endpoint will not invent one.',
        }, { status: 409 });
      }
    }

    // ── Totals: the same function the editor runs ───────────────────────────
    const ppnPct = Number.isFinite(Number(b.ppn_pct)) ? Number(b.ppn_pct) : 11;
    const tot = salesTotals(lines, ppnPct);

    const quoteDate = String(b.quote_date ?? '').trim() || new Date().toISOString().slice(0, 10);
    const header: Record<string, unknown> = {
      // The Dolibarr number IS the document's name here. Inventing an ICAPROC
      // number would make the same order impossible to find by what it is called.
      quote_number: externalRef,
      order_number: externalRef,
      external_source: externalSource,
      external_ref: externalRef,
      customer_id: customerId,
      quote_date: quoteDate,
      status,
      ppn_pct: ppnPct,
      subtotal: tot.subtotal, ppn_amount: tot.ppn, grand_total: tot.grand,
      notes: String(b.notes ?? '').trim() || `Mirrored from ${externalSource} ${externalRef}`,
      // Only the stamps that really happened. The earlier ones stay NULL, and
      // that NULL is the honest record: it says "this did not happen here".
      ordered_at: b.ordered_at ?? (status !== 'cancelled' ? `${quoteDate}T00:00:00Z` : null),
      invoiced_at: b.invoiced_at ?? null,
      delivered_at: b.delivered_at ?? (status === 'delivered' ? `${quoteDate}T00:00:00Z` : null),
    };

    const { data: made, error: hErr } = await client.from(SALES).insert(header)
      .select('quote_id, quote_number').single();
    if (hErr) return NextResponse.json({ error: hErr.message }, { status: 500 });

    const itemRows = lines.map((l, i) => ({
      quote_id: made.quote_id,
      component_id: l.component_id || null,
      description: String(l.description ?? '').trim() || null,
      unit: l.unit ?? null,
      quantity: Number(l.quantity),
      unit_price: Number(l.unit_price),
      line_total: lineTotal(l),
      sort_order: i + 1,
      is_section: false,
    }));
    const { error: iErr } = await client.from(ITEMS).insert(itemRows);
    if (iErr) {
      // A header with no lines is the exact shape this endpoint exists to
      // prevent — roll it back by hand, since PostgREST has no transaction.
      await client.from(SALES).delete().eq('quote_id', made.quote_id);
      return NextResponse.json({
        error: iErr.message,
        note: 'The header was removed again — a sales document with no lines would misreport its own total.',
      }, { status: 500 });
    }

    const unlinked = itemRows.filter((r) => !r.component_id).length;
    return NextResponse.json({
      created: true, outcome: 'mirrored',
      quote_id: made.quote_id, quote_number: made.quote_number,
      status, actor: { email, role },
      subtotal: tot.subtotal, ppn_amount: tot.ppn, grand_total: tot.grand,
      lines: itemRows.length, unlinked_lines: unlinked,
      stock_moved: false,
      note: 'Document only — NO stock movement was posted. The goods leaving the '
        + 'warehouse is a separate, deliberate step against an append-only ledger. '
        + `Find everything still awaiting it with external_source = '${externalSource}'.`,
    });
  } catch (e) {
    if (e instanceof AgentAuthError) return NextResponse.json({ error: e.message }, { status: e.status });
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}
