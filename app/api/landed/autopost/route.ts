import { NextRequest, NextResponse } from 'next/server';
import { callerFromRequest, AgentAuthError } from '@/lib/agentApi';
import { ROLE_PERMISSIONS } from '@/constants/roles';
import { fetchLandedVariances, revaluationRows } from '@/lib/landedCost';
import { autoPostVerdict, HOLD_NOTE, HOLD_LABEL } from '@/lib/landedAutoPost';

/**
 * POST /api/landed/autopost — true up one PO the moment its bills go final.
 *
 * WHY THIS EXISTS. Owner, 2026-09-13:
 *
 *   *"when we already filled in all the payments, does it have to appear in
 *   true up?"* … *"yes do that, auto-post on settlement but hold back the
 *   anomalies"*
 *
 * A cost lives in two books and only one of them updates itself. `6.0_po_costs`
 * is the bills — current the moment a payment is entered. `30.0_stock_movements`
 * is a photograph taken on receipt day, append-only, and nothing rewrites a
 * photograph. I checked `pg_trigger`: `6.0_po_costs` carries exactly one
 * trigger and all it does is refresh an analytics view. There has never been a
 * path from "the final payment was entered" to "the stock ledger heard about
 * it" except a human remembering to press a button.
 *
 * Nobody remembered. This route IS that path.
 *
 * SCOPE — deliberately one PO, never a sweep. It is called with the id of the
 * PO whose payment was just entered, so it acts on the event that actually
 * happened. That keeps two promises at once: an ordinary settlement trues
 * itself up immediately, and the 24-PO backlog that predates this feature is
 * NOT swept into the ledger by a background job nobody asked for. IDR 777.9m of
 * stock revaluation is the owner's decision to make on the reconcile screen,
 * deliberately, which is where that button still lives.
 *
 * SAFE TO CALL TWICE, AND IT WILL BE. The variance is recomputed from the
 * ledger on every call, so a PO already trued up produces no rows and the route
 * reports `already_current`. Callers fire this after every cost write without
 * tracking which ones mattered.
 *
 * AS THE CALLER, never service-role (see `lib/agentApi`). The `revalue`
 * movements it writes are stamped by `stamp_stock_movement` with the identity
 * in the token — so the ledger records the person who entered the payment that
 * triggered the correction, which is the honest attribution. A service-role key
 * would stamp every one of them `'system'`.
 */
export const dynamic = 'force-dynamic';

export async function POST(request: NextRequest) {
  try {
    const { client, email, role } = await callerFromRequest(request);
    const perms = ROLE_PERMISSIONS[role as keyof typeof ROLE_PERMISSIONS];

    // The same two gates the reconcile screen applies: you must be allowed to
    // see buy-side costs AND to move stock. Auto-posting is still the caller
    // posting; it does not borrow authority the caller lacks.
    if (!perms?.buySide || !perms?.canManageStock) {
      return NextResponse.json({
        error: 'Your role may not post stock revaluations.',
        actor: { email, role },
      }, { status: 403 });
    }

    const body = await request.json().catch(() => ({}));
    const poId = String((body as { po_id?: unknown }).po_id ?? '').trim();
    if (!poId) {
      return NextResponse.json({ error: 'po_id is required — this route trues up one PO, never a sweep.' }, { status: 400 });
    }

    const summary = await fetchLandedVariances(client);
    const v = summary.pos.find((p) => p.poId === poId);

    // No variance at all is the NORMAL outcome and must not read as a failure:
    // the PO is trued up, or its correction is under the materiality floor, or
    // it is a domestic order with nothing to allocate. Callers fire this after
    // every payment; most of the time there is happily nothing to do.
    if (!v) {
      return NextResponse.json({
        posted: false, po_id: poId, outcome: 'already_current',
        note: 'Nothing to true up — the ledger already carries this PO at its final cost, or the difference is under the materiality floor.',
      });
    }

    const verdict = autoPostVerdict(v);
    if (!verdict.post) {
      const hold = verdict.hold!;
      return NextResponse.json({
        posted: false, po_id: poId, po_number: v.poNumber,
        outcome: 'held', hold, hold_label: HOLD_LABEL[hold], note: HOLD_NOTE[hold],
        delta_idr: Math.round(v.delta),
        delta_pct: v.deltaPct,
        inventory_delta_idr: Math.round(v.inventoryDelta),
        cogs_delta_idr: Math.round(v.cogsDelta),
        // Say where the human finishes the job. A hold that does not name its
        // next step is just a silent refusal.
        next: '/stock/reconcile',
      });
    }

    const rows = revaluationRows(v);
    const { error } = await client.from('30.0_stock_movements').insert(rows);
    if (error) {
      // The check constraint is the one failure with a specific remedy: a
      // deployment whose ledger predates `direction = 'revalue'`.
      const missingMigration = /violates check constraint/i.test(error.message);
      return NextResponse.json({
        posted: false, po_id: poId, po_number: v.poNumber, outcome: 'failed',
        error: missingMigration
          ? "This deployment's ledger does not accept revaluations yet — run migrations/landed_cost_revaluation.sql"
          : error.message,
      }, { status: 500 });
    }

    return NextResponse.json({
      posted: true, po_id: poId, po_number: v.poNumber, outcome: 'posted',
      actor: { email, role },
      entries: rows.length,
      inventory_delta_idr: Math.round(v.inventoryDelta),
      // Never silently swallowed: the share that belongs to units already sold
      // cannot be recovered, and the caller should be able to say so.
      cogs_delta_idr: Math.round(v.cogsDelta),
      delta_pct: v.deltaPct,
    });
  } catch (e) {
    if (e instanceof AgentAuthError) return NextResponse.json({ error: e.message }, { status: e.status });
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}
