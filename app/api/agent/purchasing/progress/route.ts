import { NextRequest, NextResponse } from 'next/server';
import { callerFromRequest, AgentAuthError } from '@/lib/agentApi';
import { ROLE_PERMISSIONS } from '@/constants/roles';
import { progressRow } from '@/lib/progressExport';
import type { POCost } from '@/types/database';
import type { ProgressPo } from '@/lib/poProgress';

/**
 * GET /api/agent/purchasing/progress — the Progress board, for an agent.
 *
 * WHY THIS EXISTS (owner, 2026-10-13): *"I want MIRA to review and make sure
 * everything is in sync between what's in ICAPROC, Dolibarr and in Basecamp."*
 * The team still drags cards by hand on Basecamp's PROGRESS IMPOR board, and
 * on the day this was written it was already wrong: TRISINDO PO-038 sat in
 * "PO SENT" while ICAPROC had it Fully Received.
 *
 * ICAPROC computes five of the seven stages from payments and dates
 * (`lib/poProgress.ts`). An agent must not compute them again — a second
 * implementation drifts from the first in silence — so this route runs the
 * board's own functions through `progressRow` and hands back the answer,
 * including the title of the Basecamp column the card belongs in.
 *
 * Query:
 *   (none)                 every PO with track_progress = true (the board)
 *   ?po_number=… / ?pi_number=…
 *                          that PO, tracked or not — for a Basecamp card whose
 *                          PO left the board (e.g. received and untracked)
 *
 * Read-only. Buy-side roles only, as the caller (RLS applies).
 */
export const dynamic = 'force-dynamic';

const PO_COLS = 'po_id, po_number, pi_number, pi_date, quote_id, po_date, status, total_value, currency, '
  + 'exchange_rate, docs_checked_at, hard_copy_received_at, actual_received_date, track_progress, '
  + 'supplier_id, company_id';

type PoRow = ProgressPo;

export async function GET(request: NextRequest) {
  try {
    const { client, email, role } = await callerFromRequest(request);
    const perms = ROLE_PERMISSIONS[role as keyof typeof ROLE_PERMISSIONS];
    if (!perms?.buySide) {
      return NextResponse.json({
        error: 'Your role may not read purchasing.', actor: { email, role },
      }, { status: 403 });
    }

    const url = new URL(request.url);
    const poNumber = (url.searchParams.get('po_number') ?? '').trim();
    const piNumber = (url.searchParams.get('pi_number') ?? '').trim();

    let q = client.from('5.0_purchases').select(PO_COLS);
    if (poNumber) q = q.ilike('po_number', poNumber.replace(/[\\%_]/g, (c) => `\\${c}`));
    else if (piNumber) q = q.ilike('pi_number', piNumber.replace(/[\\%_]/g, (c) => `\\${c}`));
    else q = q.eq('track_progress', true);
    const { data: poData, error: poErr } = await q.order('po_date', { ascending: false });
    if (poErr) return NextResponse.json({ error: poErr.message }, { status: 500 });
    const pos = (poData ?? []) as unknown as PoRow[];

    const ids = pos.map((p) => p.po_id);
    const supplierIds = [...new Set(pos.map((p) => p.supplier_id).filter(Boolean))] as string[];
    const companyIds = [...new Set(pos.map((p) => p.company_id).filter(Boolean))] as string[];

    const [costRes, supRes, coRes] = await Promise.all([
      ids.length
        ? client.from('6.0_po_costs').select('po_id, cost_category, amount, currency, exchange_rate').in('po_id', ids)
        : Promise.resolve({ data: [], error: null }),
      supplierIds.length
        ? client.from('2.0_suppliers').select('supplier_id, supplier_name').in('supplier_id', supplierIds)
        : Promise.resolve({ data: [], error: null }),
      companyIds.length
        ? client.from('1.0_companies').select('company_id, legal_name').in('company_id', companyIds)
        : Promise.resolve({ data: [], error: null }),
    ]);
    if (costRes.error) return NextResponse.json({ error: costRes.error.message }, { status: 500 });

    const costsByPo = new Map<string, POCost[]>();
    for (const c of (costRes.data ?? []) as unknown as POCost[]) {
      const k = String(c.po_id);
      const list = costsByPo.get(k);
      if (list) list.push(c); else costsByPo.set(k, [c]);
    }
    const supplierName = new Map(((supRes.data ?? []) as { supplier_id: string; supplier_name: string }[])
      .map((s) => [String(s.supplier_id), s.supplier_name]));
    const companyName = new Map(((coRes.data ?? []) as { company_id: string; legal_name: string }[])
      .map((c) => [String(c.company_id), c.legal_name]));

    const items = pos.map((p) => ({
      po_id: p.po_id,
      po_number: p.po_number ?? null,
      pi_number: p.pi_number ?? null,
      po_date: p.po_date ?? null,
      status: p.status ?? null,
      supplier: p.supplier_id ? supplierName.get(String(p.supplier_id)) ?? null : null,
      company: p.company_id ? companyName.get(String(p.company_id)) ?? null : null,
      track_progress: Boolean(p.track_progress),
      ...progressRow(p, costsByPo.get(String(p.po_id)) ?? []),
    }));

    return NextResponse.json({
      generated_at: new Date().toISOString(),
      actor: { email, role },
      count: items.length,
      how_to_read_this:
        'stage is the FURTHEST milestone ICAPROC can prove, computed by lib/poProgress.ts — the same '
        + 'functions as the Purchasing → Progress screen. basecamp_column is the PROGRESS IMPOR column the '
        + 'card belongs in ("Done" when complete; null when the PO has reached no milestone). ICAPROC is '
        + 'the record: when Basecamp disagrees, the card is behind, not ICAPROC. Match cards by pi_number, '
        + 'then po_number — the card titles carry both. Docs Checked and Hard Copy Received are ticked by '
        + 'a person in ICAPROC; the other five follow from payments, dates and the receipt.',
      items,
    });
  } catch (e) {
    if (e instanceof AgentAuthError) return NextResponse.json({ error: e.message }, { status: e.status });
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}
