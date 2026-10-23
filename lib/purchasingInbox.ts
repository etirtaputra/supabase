/**
 * Purchasing › Deal Lookup — "Needs action": what to do next on the buy side
 * (owner, 2026-10-23, with the Purchasing menu cut to four entries).
 *
 * Four questions, each answered by an engine that already owns it:
 *   - arrived but not in stock ........ lib/receiptGap.ts
 *   - late against the usual lead time . this file, over lib/supplierLeadTimes timelines
 *   - short for a sales order .......... lib/reorder.ts (fetchShortages)
 *   - goods in, balance not paid ....... this file, over lib/dealBalance.ts poBalance
 *
 * Pure: no fetch, no React.
 */
import { poBalance, NOT_PAYABLE_PO_STATUS, type BalanceCost, type BalancePo } from './dealBalance.ts';
import type { SupplierLead } from './supplierLeadTimes.ts';

const DAY = 86_400_000;
const at = (iso: string) => Date.parse(`${iso.slice(0, 10)}T00:00:00Z`);
const addDays = (iso: string, d: number) => new Date(at(iso) + Math.round(d) * DAY).toISOString().slice(0, 10);

export interface LatePo {
  poId: string;
  poNumber: string;
  supplierId: string | null;
  /** The date it should have been fully in: the quote's promise, else PO date + the supplier's usual time. */
  due: string;
  lateDays: number;
  /** Where `due` came from. */
  basis: 'promised' | 'usual';
}

/**
 * Open POs past the day they should have arrived.
 *
 * The due day is the quote's promised date when it stated one; otherwise the PO
 * date plus this supplier's median PO → fully received — by the same way of
 * shipping when there is history for it (a sea median says nothing about an air
 * order). No promise and no history: no verdict, rather than a guess.
 */
export function latePos(leads: SupplierLead[], today: string): LatePo[] {
  const out: LatePo[] = [];
  for (const lead of leads) {
    const overall = lead.stages.poToReceived?.median ?? null;
    for (const p of lead.pos) {
      if (!p.open || !p.poDate) continue;
      const viaMedian = p.via ? lead.byVia.find((v) => v.via === p.via)?.poToReceived?.median ?? null : null;
      const usual = viaMedian ?? overall;
      const due = p.promised ?? (usual != null ? addDays(p.poDate, usual) : null);
      if (!due || today <= due) continue;
      out.push({
        poId: p.poId, poNumber: p.poNumber, supplierId: p.supplierId, due,
        lateDays: Math.round((at(today) - at(due)) / DAY), basis: p.promised ? 'promised' : 'usual',
      });
    }
  }
  return out.sort((a, b) => b.lateDays - a.lateDays);
}

/** Goods are in (fully or partly received) and the PO still has money to pay. */
export const GOODS_IN = new Set(['Fully Received', 'Partially Received']);

export interface UnpaidPo { poId: string; poNumber: string; currency: string; remaining: number; idr: number | null }

export function unpaidReceived(pos: (BalancePo & { status?: string | null })[], costs: BalanceCost[]): UnpaidPo[] {
  const out: UnpaidPo[] = [];
  for (const po of pos) {
    const status = po.status ?? '';
    if (!GOODS_IN.has(status) || NOT_PAYABLE_PO_STATUS.has(status)) continue;
    const b = poBalance(po, costs);
    if (b.settled || !(b.remaining > 0)) continue;
    out.push({ poId: b.poId, poNumber: b.poNumber ?? '', currency: b.currency, remaining: b.remaining, idr: b.idr });
  }
  return out.sort((a, b) => (b.idr ?? 0) - (a.idr ?? 0));
}
