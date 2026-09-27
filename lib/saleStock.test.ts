/**
 * The stock leg of a mirrored (Dolibarr) sale.
 *
 * OWNER, 2026-09-17: *"mirror documents first then stock as a separate step"*.
 * On 2026-09-27 the ledger held five stock-outs in its whole life against ten
 * mirrored sales, so ICAPROC's on-hand was overstated by every Dolibarr sale.
 *
 * Moving stock is the one thing in this area that is expensive to get wrong:
 * the ledger is append-only, and a wrong out shows up as a wrong available-to-
 * sell, a wrong stock value and a wrong COGS all at once. So most of these
 * tests are about the ways it could take goods off TWICE, from the WRONG
 * PLACE, or for something that was never SOLD.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  planSaleStockOut, planSaleStockReversal, netOut, DELIVERABLE_STATUS,
  type SaleLine, type PostedMove, type BalanceRow,
} from './saleStock.ts';

const read = (p: string) => readFileSync(join(process.cwd(), p), 'utf8');
const ROUTE = read('app/api/agent/sales/stock/route.ts');
const SQL = read('migrations/sale_stock_leg.sql').split('\n').map((l) => l.replace(/--.*$/, '')).join('\n');

const TRINA = 'trina';
const CLIP = 'clip';
const line = (component_id: string | null, quantity: number, o: Partial<SaleLine> = {}): SaleLine =>
  ({ component_id, quantity, ...o });
const bal = (component_id: string, location: string, qty: number): BalanceRow =>
  ({ component_id, location, qty_on_hand: qty });
const out = (component_id: string, location: string, quantity: number, cost = 0): PostedMove =>
  ({ component_id, location, direction: 'out', quantity, unit_cost_idr: cost });
const inn = (component_id: string, location: string, quantity: number): PostedMove =>
  ({ component_id, location, direction: 'in', quantity });

// ── Where the goods come from ───────────────────────────────────────────────

test('goods leave from where they ARE, not from the default warehouse', () => {
  // Real: the TRINA panels sit in G25. Taking them out of MAIN would leave
  // MAIN negative and G25 overstated — two wrong numbers instead of one.
  const p = planSaleStockOut([line(TRINA, 13)], [], [bal(TRINA, 'G25', 720)], { defaultLocation: 'MAIN' });
  assert.deepEqual(p.moves, [{ component_id: TRINA, location: 'G25', quantity: 13 }]);
  assert.equal(p.shortfalls.length, 0);
});

test('the biggest holding first, split when one is not enough', () => {
  const p = planSaleStockOut(
    [line(CLIP, 150)], [],
    [bal(CLIP, 'MAIN', 100), bal(CLIP, 'G63', 80)],
    { defaultLocation: 'MAIN' },
  );
  assert.deepEqual(p.moves, [
    { component_id: CLIP, location: 'MAIN', quantity: 100 },
    { component_id: CLIP, location: 'G63', quantity: 50 },
  ]);
});

test('a named warehouse is obeyed, and a shortfall there is reported', () => {
  const p = planSaleStockOut([line(TRINA, 13)], [], [bal(TRINA, 'G25', 720)], { location: 'MAIN', defaultLocation: 'MAIN' });
  assert.deepEqual(p.moves, [{ component_id: TRINA, location: 'MAIN', quantity: 13 }]);
  assert.deepEqual(p.shortfalls, [{ component_id: TRINA, needed: 13, available: 0 }]);
});

// ── Never twice ─────────────────────────────────────────────────────────────

test('posting again takes nothing more off', () => {
  const p = planSaleStockOut([line(TRINA, 13)], [out(TRINA, 'G25', 13)], [bal(TRINA, 'G25', 707)], { defaultLocation: 'MAIN' });
  assert.equal(p.moves.length, 0);
  assert.equal(p.complete, true);
  assert.deepEqual(p.alreadyOut, [{ component_id: TRINA, quantity: 13 }]);
});

test('…including goods a delivery order already took off by the other door', () => {
  // The route passes BOTH `sale` movements and `delivery` movements from any
  // DO on the same order. Half went out on a DO; only the other half moves.
  const p = planSaleStockOut([line(TRINA, 13)], [out(TRINA, 'G25', 6)], [bal(TRINA, 'G25', 714)], { defaultLocation: 'MAIN' });
  assert.deepEqual(p.moves, [{ component_id: TRINA, location: 'G25', quantity: 7 }]);
  assert.match(ROUTE, /\[\.\.\.\(\(saleMoves \?\? \[\]\) as PostedMove\[\]\), \.\.\.doMoves\]/,
    'the route must count what BOTH paths have taken off');
});

test('a reversal is netted, so a re-delivery after one moves the goods again', () => {
  const p = planSaleStockOut(
    [line(TRINA, 13)],
    [out(TRINA, 'G25', 13), inn(TRINA, 'G25', 13)],
    [bal(TRINA, 'G25', 720)], { defaultLocation: 'MAIN' },
  );
  assert.deepEqual(p.moves, [{ component_id: TRINA, location: 'G25', quantity: 13 }]);
});

test('two lines for the same item are one requirement', () => {
  const p = planSaleStockOut([line(CLIP, 4), line(CLIP, 6)], [], [bal(CLIP, 'MAIN', 100)], { defaultLocation: 'MAIN' });
  assert.deepEqual(p.moves, [{ component_id: CLIP, location: 'MAIN', quantity: 10 }]);
});

// ── What does not move ──────────────────────────────────────────────────────

test('a line with no catalogue item moves nothing, and says so', () => {
  // "Karet Spons 12mm" is real revenue with no stock behind it.
  const p = planSaleStockOut([line(null, 1, { description: 'Karet Spons 12mm' })], [], [], { defaultLocation: 'MAIN' });
  assert.equal(p.moves.length, 0);
  assert.deepEqual(p.unmovable, [{ item_id: null, description: 'Karet Spons 12mm', quantity: 1 }]);
});

test('section headings and zero lines are not goods', () => {
  const p = planSaleStockOut(
    [line(CLIP, 5, { is_section: true }), line(CLIP, 0)], [], [bal(CLIP, 'MAIN', 100)], { defaultLocation: 'MAIN' });
  assert.equal(p.moves.length, 0);
  assert.equal(p.unmovable.length, 0);
});

test('an item ICAPROC holds none of is a shortfall, never a silent negative', () => {
  // Real: several items on these orders show NO balance anywhere in ICAPROC
  // although they were sold — a finding about ICAPROC's stock.
  const p = planSaleStockOut([line('nym', 25)], [], [], { defaultLocation: 'MAIN' });
  assert.deepEqual(p.shortfalls, [{ component_id: 'nym', needed: 25, available: 0 }]);
  // If the caller insists (allow_negative), it lands in the default warehouse.
  assert.deepEqual(p.moves, [{ component_id: 'nym', location: 'MAIN', quantity: 25 }]);
  assert.match(ROUTE, /if \(plan\.shortfalls\.length && !b\.allow_negative\)/,
    'a real post must refuse a shortfall unless the caller says allow_negative');
});

test('only something that was SOLD can leave', () => {
  for (const s of ['ordered', 'invoiced', 'preparing', 'delivered']) assert.ok(DELIVERABLE_STATUS.has(s), s);
  // Real: PR2609-2255 is a quotation ("validated"). Nothing was sold yet.
  for (const s of ['draft', 'validated', 'sent', 'accepted', 'cancelled', 'rejected']) {
    assert.ok(!DELIVERABLE_STATUS.has(s), `${s} has sold nothing — its goods are still on the shelf`);
  }
});

// ── Undo ────────────────────────────────────────────────────────────────────

test('a reversal returns exactly what is out, at the cost it left at', () => {
  const back = planSaleStockReversal([out(TRINA, 'G25', 10, 2_000_000), out(TRINA, 'G25', 3, 2_100_000)]);
  assert.equal(back.length, 1);
  assert.equal(back[0].quantity, 13);
  // Quantity-weighted, so the moving average is restored exactly.
  assert.equal(back[0].unit_cost_idr, Math.round((10 * 2_000_000 + 3 * 2_100_000) / 13));
  // Nothing out → nothing to return; already returned → nothing again.
  assert.deepEqual(planSaleStockReversal([]), []);
  assert.deepEqual(planSaleStockReversal([out(TRINA, 'G25', 13, 1), inn(TRINA, 'G25', 13)]), []);
});

test('netOut reads outs as positive and returns as negative, per warehouse', () => {
  const m = netOut([out(CLIP, 'MAIN', 10), inn(CLIP, 'MAIN', 4), out(CLIP, 'G63', 2)]);
  assert.equal(m.get(CLIP)?.get('MAIN'), 6);
  assert.equal(m.get(CLIP)?.get('G63'), 2);
});

// ── The route's own refusals, and the database's grant ─────────────────────

test('a native order is refused — its stock leaves through its delivery order', () => {
  assert.match(ROUTE, /if \(!order\.external_source\) \{/);
  assert.match(ROUTE, /This is a native ICAPROC order/);
});

test('cost is never stated by the caller — the database prices the out', () => {
  assert.match(ROUTE, /unit_cost_idr: 0,/);
  assert.match(ROUTE, /cogs_source: '30\.0_stock_movements\.unit_cost_idr/,
    'the COGS it reports carries its source');
});

test('it posts as the caller, never with a service role', () => {
  assert.match(ROUTE, /const \{ client, email, role \} = await callerFromRequest\(request\);/);
  assert.ok(!/SERVICE_ROLE|service_role/i.test(ROUTE));
});

test('the grant widens by one source name for OUTs, and never for an IN', () => {
  // Verified by impersonation (rolled back, 2026-09-27): a sell_admin took 10
  // clips off under "sale" (priced by the database at IDR 704 each, sent as
  // 0); booking 500 IN under "sale" was refused; an out under any other
  // source was refused.
  assert.match(SQL, /direction = 'out'\s*\n\s*AND source_type IN \('delivery', 'sale'\)/);
  assert.ok(!/direction = 'in'/.test(SQL), 'a sell-side role must never be able to raise a balance');
  assert.match(ROUTE, /if \(action === 'reverse' && !perms\.canManageStock\)/);
});

test('a status the role could not update is reported, not claimed', () => {
  assert.match(ROUTE, /const statusUpdated = !!upd\?\.length;/);
});
