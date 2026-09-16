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
 * TWO MODES, and the second is what made this server-side (owner, 2026-09-16:
 * *"do the true-up server-side one next"*).
 *
 *   · `{ po_id }` — true up that one PO now. The purchasing screen fires it
 *     straight after a payment so the person who entered it sees the result.
 *   · no body — DRAIN the queue. A trigger on `6.0_po_costs`
 *     (`migrations/landed_true_up_queue.sql`) records every PO whose bills go
 *     final, from ANY path: the screen, an agent writing over PostgREST, a
 *     hand-run INSERT. Auto-post shipped on 2026-09-13 lived in a React
 *     component, so MIRA — which writes `6.0_po_costs` directly and enters a
 *     large share of the payments — settled POs that nothing ever trued up.
 *
 * THE TRIGGER DOES NOT DO THE ARITHMETIC, and that is deliberate. Re-deriving
 * pool, factor, per-line share and the materiality floor in PL/pgSQL would give
 * one rule two implementations that drift the first time a cost category moves.
 * The trigger records a FACT — this PO owes a true-up — and the maths stays in
 * `lib/landedCost.ts`, where `computeTUC` keeps it honest.
 *
 * STILL NOT A SWEEP. The queue is its own watermark: only a PO whose payment is
 * entered from now on is queued, so the IDR 777.9m backlog that predates all of
 * this stays exactly where it is — the owner's deliberate press on
 * `/stock/reconcile`, not a side effect of a deploy.
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

/** Where a settled PO's unpaid debt is recorded (migrations/landed_true_up_queue.sql). */
const TRUE_UP_QUEUE = '30.5_landed_true_up_queue';
/** One drain call pages the whole ledger once; this bounds the work per request. */
const QUEUE_BATCH = 25;

interface QueueRow { po_id: string; queued_by_email: string | null; attempts: number | null }
interface DrainResult {
  po_id: string; po_number?: string;
  outcome: 'posted' | 'held' | 'already_current' | 'failed';
  hold?: string; settled_by?: string | null; error?: string;
  inventory_delta_idr?: number; cogs_delta_idr?: number;
}

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

    // ── DRAIN MODE — no po_id ────────────────────────────────────────────────
    // The half that makes this server-side rather than screen-side. A trigger on
    // 6.0_po_costs queues every PO whose bills go final, from ANY path — the
    // purchasing screen, an agent writing over PostgREST, a hand-run INSERT —
    // and this clears the queue with the same verdict function the reconcile
    // screen shows. Nothing about the arithmetic lives in SQL.
    if (!poId) {
      const { data: queued, error: qErr } = await client
        .from(TRUE_UP_QUEUE)
        .select('po_id, queued_by_email, attempts')
        .eq('outcome', 'pending')
        .order('queued_at')
        .limit(QUEUE_BATCH);
      if (qErr) return NextResponse.json({ error: qErr.message }, { status: 500 });
      if (!queued?.length) return NextResponse.json({ drained: 0, posted: 0, held: 0, outcome: 'queue_empty' });

      // ONE variance computation for the whole batch — it pages the entire
      // ledger, so doing it per PO would turn a five-PO queue into five full
      // scans for no extra truth.
      const summary = await fetchLandedVariances(client);
      const results: DrainResult[] = [];

      for (const q of queued as QueueRow[]) {
        const v = summary.pos.find((p) => p.poId === String(q.po_id));
        // Nothing owing: already trued up, or under the materiality floor. The
        // debt is settled either way, so the row goes.
        if (!v) {
          await client.from(TRUE_UP_QUEUE).delete().eq('po_id', q.po_id);
          results.push({ po_id: String(q.po_id), outcome: 'already_current' });
          continue;
        }
        const verdict = autoPostVerdict(v);
        if (!verdict.post) {
          const hold = verdict.hold!;
          // PARKED, never dropped. A held PO stays in the queue as a standing
          // question for a human — deleting it is how the backlog rebuilt.
          await client.from(TRUE_UP_QUEUE).update({
            outcome: 'held', note: `${HOLD_LABEL[hold]} — ${HOLD_NOTE[hold]}`,
            attempts: (q.attempts ?? 0) + 1, last_attempt_at: new Date().toISOString(),
          }).eq('po_id', q.po_id);
          results.push({ po_id: String(q.po_id), po_number: v.poNumber, outcome: 'held', hold });
          continue;
        }
        const rows = revaluationRows(v);
        const { error: insErr } = await client.from('30.0_stock_movements').insert(rows);
        if (insErr) {
          await client.from(TRUE_UP_QUEUE).update({
            outcome: 'error', note: insErr.message,
            attempts: (q.attempts ?? 0) + 1, last_attempt_at: new Date().toISOString(),
          }).eq('po_id', q.po_id);
          results.push({ po_id: String(q.po_id), po_number: v.poNumber, outcome: 'failed', error: insErr.message });
          continue;
        }
        await client.from(TRUE_UP_QUEUE).delete().eq('po_id', q.po_id);
        results.push({
          po_id: String(q.po_id), po_number: v.poNumber, outcome: 'posted',
          settled_by: q.queued_by_email,
          inventory_delta_idr: Math.round(v.inventoryDelta),
          cogs_delta_idr: Math.round(v.cogsDelta),
        });
      }

      return NextResponse.json({
        drained: results.length,
        posted: results.filter((r) => r.outcome === 'posted').length,
        held:   results.filter((r) => r.outcome === 'held').length,
        failed: results.filter((r) => r.outcome === 'failed').length,
        posted_idr: results.reduce((s, r) => s + (r.inventory_delta_idr ?? 0), 0),
        actor: { email, role },
        results,
      });
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

    // The trigger queued this PO the moment the payment landed; the screen then
    // posted it directly. Clear the debt so the drain does not rediscover work
    // that is already done. (It would self-heal — no variance, row deleted —
    // but a queue that briefly lies is a queue nobody trusts.)
    await client.from(TRUE_UP_QUEUE).delete().eq('po_id', poId);

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
