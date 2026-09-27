import { NextRequest, NextResponse } from 'next/server';
import { callerFromRequest, AgentAuthError } from '@/lib/agentApi';
import { ROLE_PERMISSIONS } from '@/constants/roles';
import {
  planSaleStockOut, planSaleStockReversal, DELIVERABLE_STATUS,
  type PostedMove, type BalanceRow, type SaleLine,
} from '@/lib/saleStock';

/**
 * POST /api/agent/sales/stock — the goods of a MIRRORED order have left.
 *
 * The second half of the Dolibarr mirror. `/api/agent/sales/mirror` records the
 * document and deliberately moves no stock (owner, 2026-09-17: *"mirror
 * documents first then stock as a separate step"*). This is that step.
 *
 * Body:
 *   { external_ref, external_source?  (default "dolibarr")   — or quote_id
 *     action?:        "deliver" (default) | "reverse"
 *     dry_run?:       true → the plan, and NOTHING written
 *     location?:      take everything from this warehouse (default: where each
 *                     item actually is — see lib/saleStock.ts)
 *     allow_negative?: post even where ICAPROC holds too little
 *     delivered_at?:  when the goods actually left (ISO) — dates the movement
 *     status_after?:  for "reverse": "ordered" | "invoiced" | "cancelled" }
 *
 * Every rule lives in lib/saleStock.ts. What this route adds is the three
 * refusals that need the database to decide:
 *
 *  1. **Only a mirrored order.** A native ICAPROC order takes its stock off
 *     through its delivery order. A second door for the same goods is how they
 *     leave twice.
 *  2. **Only something that was sold.** A quotation (draft, validated, sent,
 *     accepted) has sold nothing; a cancelled order never will.
 *  3. **Not past what ICAPROC holds**, unless the caller says `allow_negative`.
 *     A shortfall is a finding about ICAPROC's stock and comes back as one.
 *
 * Posts as the CALLER, never with a service role: every movement is stamped
 * with who took the goods off, which is the whole reason an agent has an
 * account. Cost is not stated — the database prices each out at the
 * moving-average landed cost on hand, the COGS rule every other out obeys, and
 * the response reads that cost back so the caller can report it with its
 * source.
 */
export const dynamic = 'force-dynamic';

const SALES = '22.0_sales_quotes';
const ITEMS = '22.1_sales_quote_items';
const MOVES = '30.0_stock_movements';
const SOURCE = 'sale';

interface InBody {
  quote_id?: string;
  external_ref?: string;
  external_source?: string;
  action?: string;
  dry_run?: boolean;
  location?: string | null;
  allow_negative?: boolean;
  delivered_at?: string | null;
  status_after?: string;
}

/** `ilike` without wildcards: the value is compared, never pattern-matched. */
const literal = (s: string) => s.replace(/[\\%_]/g, (c) => `\\${c}`);

export async function POST(request: NextRequest) {
  try {
    const { client, email, role } = await callerFromRequest(request);
    const perms = ROLE_PERMISSIONS[role as keyof typeof ROLE_PERMISSIONS];

    const b = (await request.json().catch(() => ({}))) as InBody;
    const action = String(b.action ?? 'deliver');
    if (action !== 'deliver' && action !== 'reverse') {
      return NextResponse.json({ error: 'action must be "deliver" or "reverse".' }, { status: 400 });
    }

    // The gates are the DATABASE's gates, stated up front so a caller gets a
    // sentence instead of a row-level-security error halfway through:
    //  · deliver writes an `out` and updates the order — the sell-side roles,
    //    exactly those who may mark a delivery order delivered
    //    (migrations/sale_stock_leg.sql widens their out-only grant to `sale`);
    //  · reverse writes an `in`, which puts stock BACK. That stays with roles
    //    that may book stock in at all, and must also be able to reopen the
    //    order — in practice, the owner.
    if (!perms?.canEditSalesDocs) {
      return NextResponse.json({ error: 'Your role may not record that a sale\'s goods have left.', actor: { email, role } }, { status: 403 });
    }
    if (action === 'reverse' && !perms.canManageStock) {
      return NextResponse.json({
        error: 'Only a role that may book stock IN can put a sale\'s goods back.', actor: { email, role },
        note: 'A sell-side role can take stock off but not add it; otherwise a reversal would be a way to raise any balance.',
      }, { status: 403 });
    }
    const dryRun = b.dry_run === true;

    // ── The order ────────────────────────────────────────────────────────────
    let q = client.from(SALES)
      .select('quote_id, quote_number, order_number, status, external_source, external_ref, delivered_at, invoiced_at');
    if (b.quote_id) {
      q = q.eq('quote_id', b.quote_id);
    } else {
      const ref = String(b.external_ref ?? '').trim();
      if (!ref) return NextResponse.json({ error: 'external_ref (or quote_id) is required.' }, { status: 400 });
      const src = String(b.external_source ?? 'dolibarr').trim();
      // Case-insensitive: rows mirrored before the endpoint existed say
      // "Dolibarr", rows mirrored through it say "dolibarr". Same system.
      q = q.eq('external_ref', ref).ilike('external_source', literal(src));
    }
    const { data: orders, error: oErr } = await q.limit(2);
    if (oErr) return NextResponse.json({ error: oErr.message }, { status: 500 });
    if (!orders?.length) return NextResponse.json({ error: 'No such order in ICAPROC. Mirror it first with /api/agent/sales/mirror.' }, { status: 404 });
    if (orders.length > 1) return NextResponse.json({ error: 'That reference matches more than one order — pass quote_id.' }, { status: 409 });
    const order = orders[0];
    const ref = order.external_ref || order.order_number || order.quote_number;

    if (!order.external_source) {
      return NextResponse.json({
        error: 'This is a native ICAPROC order. Its stock leaves through its delivery order (Sales → the order → Fulfillment).',
        note: 'A second way out for the same goods is how they get taken off twice.',
      }, { status: 409 });
    }

    // ── What has already left for this order, by EITHER path ─────────────────
    const { data: dos } = await client.from('24.0_delivery_orders').select('do_id').eq('quote_id', order.quote_id);
    const doIds = (dos ?? []).map((d: { do_id: string }) => d.do_id);
    const { data: saleMoves, error: mErr } = await client.from(MOVES)
      .select('component_id, location, direction, quantity, unit_cost_idr')
      .eq('source_type', SOURCE).eq('source_id', order.quote_id);
    if (mErr) return NextResponse.json({ error: mErr.message }, { status: 500 });
    let doMoves: PostedMove[] = [];
    if (doIds.length) {
      const { data } = await client.from(MOVES)
        .select('component_id, location, direction, quantity, unit_cost_idr')
        .eq('source_type', 'delivery').in('source_id', doIds);
      doMoves = (data ?? []) as PostedMove[];
    }

    // ── REVERSE ──────────────────────────────────────────────────────────────
    if (action === 'reverse') {
      const backIn = planSaleStockReversal((saleMoves ?? []) as PostedMove[]);
      const statusAfter = ['ordered', 'invoiced', 'cancelled'].includes(String(b.status_after))
        ? String(b.status_after) : (order.invoiced_at ? 'invoiced' : 'ordered');
      if (dryRun || backIn.length === 0) {
        return NextResponse.json({
          dry_run: dryRun, action, order: ref, quote_id: order.quote_id,
          would_return: backIn, status_after: statusAfter,
          note: backIn.length ? 'Dry run — nothing written.' : 'Nothing to reverse: no stock was taken off for this order through this endpoint.',
          ...(doIds.length ? { delivery_orders: doIds.length, note_do: 'Stock taken off by a delivery order is restored by reopening that DO, not from here.' } : {}),
        });
      }
      const { error } = await client.from(MOVES).insert(backIn.map((m) => ({
        ...m, direction: 'in', source_type: SOURCE, source_id: order.quote_id,
        notes: `Reversal — ${ref} (${order.external_source})`,
      })));
      if (error) return NextResponse.json({ error: error.message }, { status: 500 });
      await client.from(SALES).update({ status: statusAfter, delivered_at: null }).eq('quote_id', order.quote_id);
      return NextResponse.json({
        done: true, action, order: ref, quote_id: order.quote_id,
        returned: backIn, status_after: statusAfter, actor: { email, role },
      });
    }

    // ── DELIVER ──────────────────────────────────────────────────────────────
    if (!DELIVERABLE_STATUS.has(order.status)) {
      return NextResponse.json({
        error: `This document is "${order.status}" — nothing has been sold, so nothing can leave.`,
        note: 'Quotations (draft, validated, sent, accepted) and cancelled or rejected orders never move stock. If Dolibarr now shows it as ordered or shipped, mirror that first.',
      }, { status: 409 });
    }

    const { data: lineRows, error: lErr } = await client.from(ITEMS)
      .select('item_id, component_id, quantity, is_section, description').eq('quote_id', order.quote_id);
    if (lErr) return NextResponse.json({ error: lErr.message }, { status: 500 });
    const lines = (lineRows ?? []) as SaleLine[];
    const cids = [...new Set(lines.map((l) => l.component_id).filter((c): c is string => !!c))];

    const [{ data: bal }, { data: whs }, { data: comps }] = await Promise.all([
      cids.length
        ? client.from('30.1_stock_balances').select('component_id, location, qty_on_hand').in('component_id', cids)
        : Promise.resolve({ data: [] as BalanceRow[] }),
      client.from('30.3_warehouses').select('code, is_default'),
      cids.length
        ? client.from('3.0_components').select('component_id, internal_description, supplier_model').in('component_id', cids)
        : Promise.resolve({ data: [] as { component_id: string; internal_description: string | null; supplier_model: string | null }[] }),
    ]);
    const warehouses = (whs ?? []) as { code: string; is_default: boolean | null }[];
    const defaultLocation = warehouses.find((w) => w.is_default)?.code ?? warehouses[0]?.code ?? 'MAIN';
    if (b.location && !warehouses.some((w) => w.code === b.location)) {
      return NextResponse.json({ error: `No warehouse "${b.location}". Known: ${warehouses.map((w) => w.code).join(', ')}.` }, { status: 400 });
    }

    const plan = planSaleStockOut(
      lines,
      [...((saleMoves ?? []) as PostedMove[]), ...doMoves],
      (bal ?? []) as BalanceRow[],
      { location: b.location ?? null, defaultLocation },
    );

    const nameOf = new Map(((comps ?? []) as { component_id: string; internal_description: string | null; supplier_model: string | null }[])
      .map((c) => [c.component_id, c.internal_description || c.supplier_model || c.component_id]));
    const named = <T extends { component_id: string }>(xs: T[]) => xs.map((x) => ({ ...x, item: nameOf.get(x.component_id) ?? x.component_id }));

    const summary = {
      order: ref, quote_id: order.quote_id, status: order.status,
      would_take_off: named(plan.moves),
      already_taken_off: named(plan.alreadyOut),
      shortfalls: named(plan.shortfalls),
      not_moved: plan.unmovable,
    };

    if (dryRun) {
      return NextResponse.json({
        dry_run: true, action, ...summary,
        note: plan.complete
          ? 'Nothing left to take off — every catalogue line has already left.'
          : plan.shortfalls.length
            ? 'Dry run — nothing written. A real post would be REFUSED: ICAPROC does not hold enough of the items under shortfalls. Pass allow_negative to post anyway, or correct the stock first.'
            : 'Dry run — nothing written.',
      });
    }

    if (plan.complete) {
      return NextResponse.json({ done: true, action, moved: [], ...summary, note: 'Nothing to do — already taken off.' });
    }
    if (plan.shortfalls.length && !b.allow_negative) {
      return NextResponse.json({
        done: false, outcome: 'insufficient_stock', action, ...summary,
        note: 'Nothing was written. ICAPROC holds less than this order shipped — that is a finding about ICAPROC\'s stock. Pass allow_negative: true to post anyway, or correct the balance first.',
      }, { status: 409 });
    }

    const movedAt = String(b.delivered_at ?? '').trim() || null;
    const rows = plan.moves.map((m) => ({
      component_id: m.component_id,
      location: m.location,
      direction: 'out',
      quantity: m.quantity,
      // 0 on purpose: `stamp_stock_movement` prices it at the moving average.
      unit_cost_idr: 0,
      source_type: SOURCE,
      source_id: order.quote_id,
      notes: `${ref} · delivered (${order.external_source})`,
      allow_negative: !!b.allow_negative,
      ...(movedAt ? { moved_at: movedAt } : {}),
    }));
    // One statement for every row: PostgREST inserts an array atomically, so
    // an order is taken off whole or not at all.
    const { data: made, error: iErr } = await client.from(MOVES).insert(rows)
      .select('component_id, location, quantity, unit_cost_idr');
    if (iErr) return NextResponse.json({ error: iErr.message, note: 'Nothing was written.' }, { status: 500 });

    const { data: upd } = await client.from(SALES).update({
      status: 'delivered',
      delivered_at: order.delivered_at ?? movedAt ?? new Date().toISOString(),
    }).eq('quote_id', order.quote_id).select('quote_id');
    const statusUpdated = !!upd?.length;

    const moved = named(((made ?? []) as { component_id: string; location: string; quantity: number; unit_cost_idr: number }[])
      .map((m) => ({ ...m, cogs_idr: Math.round(Number(m.quantity) * Number(m.unit_cost_idr)) })));
    return NextResponse.json({
      done: true, action, ...summary, moved,
      cogs_idr: moved.reduce((s, m) => s + m.cogs_idr, 0),
      cogs_source: '30.0_stock_movements.unit_cost_idr, stamped at the moving-average landed cost on hand',
      order_status: statusUpdated ? 'delivered' : order.status,
      ...(statusUpdated ? {} : { warning: 'The stock was taken off, but the order\'s status could not be set to delivered by this role. Ask an owner or sales admin to update it.' }),
      actor: { email, role },
    });
  } catch (e) {
    if (e instanceof AgentAuthError) return NextResponse.json({ error: e.message }, { status: e.status });
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}
