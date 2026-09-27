/**
 * Taking the goods of a MIRRORED sale off ICAPROC's stock.
 *
 * OWNER, 2026-09-17: *"mirror documents first then stock as a separate step"*.
 * OWNER, 2026-09-27: go ahead with it.
 *
 * Orders are still taken in Dolibarr. `/api/agent/sales/mirror` records the
 * DOCUMENT in ICAPROC and, by design, touches no stock. So every sale made in
 * Dolibarr has left ICAPROC's on-hand figure exactly where it was: the ledger
 * held five stock-out movements in its whole life on 2026-09-27, against ten
 * mirrored sales. Everything built on stock inherits that — available-to-sell
 * on Products, stock value, DIO and so the cash cycle, and GP per item (COGS
 * is read off the out-movements).
 *
 * ── WHEN STOCK LEAVES: ON DELIVERY, NOT ON ORDER ─────────────────────────────
 *
 * The native flow takes stock off when a delivery order is marked delivered
 * (FulfillmentPanel.markDelivered), and this follows the same rule. Of the ten
 * mirrored documents only two say "delivered", seven say "ordered" and one is a
 * QUOTATION (PR2609-2255, status validated). ICAPROC cannot see Dolibarr's
 * shipments, so it cannot know which ordered goods have physically gone — and
 * guessing would move real inventory on a hunch. The caller (MIRA, reading
 * Dolibarr's shipment, or a person) states that the goods left; this module
 * works out exactly what that means for the ledger.
 *
 * ── THE RULES, EACH FOR A REASON ─────────────────────────────────────────────
 *
 *  · **Idempotent, and blind to which door the goods went out of.** What has
 *    already left for this order is counted from BOTH paths — this endpoint's
 *    own `sale` movements and any `delivery` movements from a DO raised for
 *    the same order in ICAPROC. Only the remainder moves. Posting twice, or
 *    posting after somebody also made a DO, cannot take the goods off twice.
 *  · **From where the goods ARE.** With no warehouse named, each item is taken
 *    from the location holding the most of it, and split across locations if
 *    one is not enough. Taking TRINA panels out of MAIN when they sit in G25
 *    would leave MAIN negative and G25 overstated — two wrong numbers instead
 *    of one.
 *  · **A shortfall is reported, not absorbed.** If ICAPROC does not hold
 *    enough, that is a finding about ICAPROC's stock, and the caller must say
 *    `allow_negative` to post anyway. Silently driving a balance negative is
 *    how a count stops meaning anything.
 *  · **A line with no catalogue item moves nothing, and says so.** "Karet
 *    Spons 12mm" is real revenue with no stock behind it.
 *  · **Cost is never stated here.** The movement carries 0 and the database's
 *    `stamp_stock_movement` prices it at the moving-average landed cost on
 *    hand — the same COGS rule every other stock-out obeys.
 *
 * Pure: everything it needs is an argument, so the arithmetic is tested and the
 * endpoint cannot grow a second opinion.
 */

export interface SaleLine {
  item_id?: string | null;
  component_id: string | null;
  quantity: number | string | null;
  is_section?: boolean | null;
  description?: string | null;
}

export interface PostedMove {
  component_id: string;
  location: string;
  direction: string;
  quantity: number | string;
  unit_cost_idr?: number | string | null;
}

export interface BalanceRow {
  component_id: string;
  location: string;
  qty_on_hand: number | string | null;
}

export interface PlannedOut { component_id: string; location: string; quantity: number }
export interface Shortfall { component_id: string; needed: number; available: number }
export interface Unmovable { item_id: string | null; description: string | null; quantity: number }

export interface SaleStockPlan {
  /** The stock-outs to post now. Empty when everything has already left. */
  moves: PlannedOut[];
  /** Items ICAPROC does not hold enough of. Non-empty blocks a real post. */
  shortfalls: Shortfall[];
  /** Lines with no catalogue item — revenue with no stock behind it. */
  unmovable: Unmovable[];
  /** Net quantity already out for this order, per item, by either path. */
  alreadyOut: { component_id: string; quantity: number }[];
  /** Nothing left to move for any line that CAN move. */
  complete: boolean;
}

const EPS = 1e-9;
const num = (v: unknown): number => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};

/** Net quantity out (outs − ins) per item per location. */
export function netOut(posted: PostedMove[]): Map<string, Map<string, number>> {
  const m = new Map<string, Map<string, number>>();
  for (const p of posted) {
    const sign = p.direction === 'out' ? 1 : p.direction === 'in' ? -1 : 0;
    if (!sign) continue;
    let byLoc = m.get(p.component_id);
    if (!byLoc) { byLoc = new Map(); m.set(p.component_id, byLoc); }
    byLoc.set(p.location, (byLoc.get(p.location) ?? 0) + sign * num(p.quantity));
  }
  return m;
}

export function planSaleStockOut(
  lines: SaleLine[],
  posted: PostedMove[],
  balances: BalanceRow[],
  opts: { location?: string | null; defaultLocation: string },
): SaleStockPlan {
  const required = new Map<string, number>();
  const unmovable: Unmovable[] = [];
  for (const l of lines) {
    if (l.is_section) continue;
    const q = num(l.quantity);
    if (q <= 0) continue;
    if (!l.component_id) {
      unmovable.push({ item_id: l.item_id ?? null, description: l.description ?? null, quantity: q });
      continue;
    }
    required.set(l.component_id, (required.get(l.component_id) ?? 0) + q);
  }

  const out = netOut(posted);
  const alreadyOut: { component_id: string; quantity: number }[] = [];
  const moves: PlannedOut[] = [];
  const shortfalls: Shortfall[] = [];

  for (const [cid, need] of required) {
    const done = [...(out.get(cid)?.values() ?? [])].reduce((s, q) => s + q, 0);
    if (done > EPS) alreadyOut.push({ component_id: cid, quantity: done });
    let remaining = need - done;
    if (remaining <= EPS) continue;

    // Where the goods are, most first; ties broken by code so the plan is the
    // same every time it is asked for.
    const held = balances
      .filter((b) => b.component_id === cid && num(b.qty_on_hand) > EPS)
      .map((b) => ({ location: b.location, qty: num(b.qty_on_hand) }))
      .sort((a, b) => b.qty - a.qty || a.location.localeCompare(b.location));

    if (opts.location) {
      const there = held.find((h) => h.location === opts.location)?.qty ?? 0;
      moves.push({ component_id: cid, location: opts.location, quantity: remaining });
      if (there + EPS < remaining) shortfalls.push({ component_id: cid, needed: remaining, available: there });
      continue;
    }

    const available = held.reduce((s, h) => s + h.qty, 0);
    for (const h of held) {
      if (remaining <= EPS) break;
      const take = Math.min(h.qty, remaining);
      moves.push({ component_id: cid, location: h.location, quantity: take });
      remaining -= take;
    }
    if (remaining > EPS) {
      shortfalls.push({ component_id: cid, needed: need - done, available });
      // Only posted if the caller says allow_negative. It lands where most of
      // the item already is — or the default warehouse when ICAPROC holds none.
      const loc = held[0]?.location ?? opts.defaultLocation;
      const same = moves.find((m) => m.component_id === cid && m.location === loc);
      if (same) same.quantity += remaining;
      else moves.push({ component_id: cid, location: loc, quantity: remaining });
    }
  }

  return {
    moves,
    shortfalls,
    unmovable,
    alreadyOut,
    complete: moves.length === 0,
  };
}

export interface PlannedIn { component_id: string; location: string; quantity: number; unit_cost_idr: number }

/**
 * Put back what THIS path took out — a mirrored order cancelled after it was
 * delivered, or a delivery posted in error. The ledger is append-only, so the
 * undo is a compensating `in` at the cost the goods left at (quantity-weighted
 * over the outs), which restores the moving average exactly.
 *
 * Only `sale` movements are passed in: stock a DO took out is reversed by
 * reopening that DO, not from here, or the DO would still claim a delivery
 * whose goods are back on the shelf.
 */
export function planSaleStockReversal(posted: PostedMove[]): PlannedIn[] {
  const acc = new Map<string, { component_id: string; location: string; net: number; outQty: number; outCost: number }>();
  for (const p of posted) {
    const k = `${p.component_id}|${p.location}`;
    let a = acc.get(k);
    if (!a) { a = { component_id: p.component_id, location: p.location, net: 0, outQty: 0, outCost: 0 }; acc.set(k, a); }
    const q = num(p.quantity);
    if (p.direction === 'out') { a.net += q; a.outQty += q; a.outCost += q * num(p.unit_cost_idr); }
    else if (p.direction === 'in') a.net -= q;
  }
  return [...acc.values()]
    .filter((a) => a.net > EPS)
    .map((a) => ({
      component_id: a.component_id,
      location: a.location,
      quantity: a.net,
      unit_cost_idr: a.outQty > 0 ? Math.round(a.outCost / a.outQty) : 0,
    }));
}

/**
 * Which statuses may have their goods taken off. A QUOTATION has sold nothing
 * (draft · validated · sent · accepted), and a cancelled or rejected order
 * never will — posting stock for any of them would remove goods that are
 * still on the shelf.
 */
export const DELIVERABLE_STATUS = new Set(['ordered', 'invoiced', 'preparing', 'delivered']);
