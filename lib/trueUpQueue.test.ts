/**
 * The true-up debt is recorded by the database, and settled by one function.
 *
 * WHAT WAS WRONG. Auto-post shipped 2026-09-13 wired into
 * `app/purchasing/page.tsx` — a React component. MIRA writes `6.0_po_costs`
 * directly over PostgREST, which is its documented procedure and a large share
 * of the payments this business enters, so every PO MIRA settled went un-trued.
 * The gap the feature closed had reopened for the path that mattered most.
 *
 * THE SHAPE OF THE FIX, and the two halves that must not swap places:
 *
 *   · A TRIGGER records the FACT — "this PO's bills went final" — from any
 *     path into `6.0_po_costs`.
 *   · The ROUTE does the arithmetic, using the same `lib/landedCost.ts` the
 *     reconcile screen runs.
 *
 * The tempting shortcut is a trigger that posts the revaluation itself. It
 * would work, and it would put pool, factor, per-line share and the
 * materiality floor into PL/pgSQL alongside the TypeScript — one rule, two
 * implementations, drifting the first time a cost category moves, silently,
 * inside the number every margin is measured against. This file asserts the
 * split holds.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { BALANCE_CATS } from '../constants/costCategories.ts';

const ROOT = process.cwd();
const read = (p: string) => readFileSync(join(ROOT, p), 'utf8');

const SQL   = read('migrations/landed_true_up_queue.sql');
const ROUTE = read('app/api/landed/autopost/route.ts');

/**
 * The migration with its prose removed. The file explains at length WHY the
 * arithmetic is not in SQL — and naming the things it refuses to do is exactly
 * how a check against those names trips on the explanation instead of the code.
 * Assert against what Postgres will run, never against the commentary.
 */
const SQL_CODE = SQL.split('\n').map((l) => l.replace(/--.*$/, '')).join('\n');

test('the trigger records the debt and NEVER computes the correction', () => {
  // The whole design in one assertion. If any of these appear in the trigger,
  // the allocation has been re-implemented in SQL.
  for (const forbidden of ['unit_cost', 'exchange_rate', 'qty_on_hand', 'avg_cost_idr',
                           '30.0_stock_movements', '5.1_purchase_line_items']) {
    assert.ok(!SQL_CODE.includes(forbidden),
      `migrations/landed_true_up_queue.sql executes against ${forbidden} — the trigger records a FACT; ` +
      'the arithmetic lives in lib/landedCost.ts so a landed cost means one thing.');
  }
});

test('the trigger fires on every path into the cost table', () => {
  // The previous version lived in one React component. Universality is the
  // point: an agent over PostgREST and a hand-run INSERT must both count.
  assert.match(SQL, /AFTER INSERT OR UPDATE OR DELETE ON public\."6\.0_po_costs"/);
  assert.match(SQL, /FOR EACH ROW EXECUTE FUNCTION public\.queue_landed_true_up/);
});

test('settled means what isSettled means — one definition, two languages', () => {
  // lib/landedCost.isSettled tests BALANCE_CATS. If the SQL and the constant
  // disagree, a PO trues up in one place and not the other.
  for (const cat of BALANCE_CATS) {
    assert.ok(SQL.includes(`'${cat}'`), `the trigger must treat ${cat} as settling the PO`);
  }
  // And nothing wider: a down payment does not make the bills final.
  assert.ok(!/'down_payment'/.test(SQL_CODE), 'a down payment must NOT queue a true-up');
});

test('a later bill on a settled PO re-opens a held row', () => {
  // Freight arriving after the balance payment is a NEW increment, and a row
  // parked as `held` must be judged again on the numbers as they now stand —
  // not left sitting on a verdict about a smaller number.
  assert.match(SQL, /ON CONFLICT \(po_id\) DO UPDATE SET[\s\S]*?outcome\s*=\s*'pending'/);
  assert.match(SQL, /ON CONFLICT \(po_id\) DO UPDATE SET[\s\S]*?attempts\s*=\s*0/);
});

test('the queue is a worklist, not a log: posted rows are deleted, held rows stay', () => {
  assert.match(ROUTE, /outcome: 'held'[\s\S]{0,200}?\.eq\('po_id'/,
    'a held PO must be PARKED in the queue as a standing question');
  assert.match(ROUTE, /from\(TRUE_UP_QUEUE\)\.delete\(\)\.eq\('po_id', q\.po_id\)/,
    'a posted PO must leave the queue — history is the ledger, which is append-only');
});

test('the drain reuses the screen’s verdict, and computes variance once per batch', () => {
  assert.match(ROUTE, /autoPostVerdict\(v\)/);
  // fetchLandedVariances pages the whole ledger. Calling it per queued PO would
  // turn a five-PO queue into five full scans for no extra truth.
  const drain = ROUTE.slice(ROUTE.indexOf('DRAIN MODE'), ROUTE.indexOf('const summary = await fetchLandedVariances(client);\n    const v ='));
  assert.equal((drain.match(/fetchLandedVariances/g) ?? []).length, 1,
    'the drain must compute variances once for the whole batch');
});

test('the drain still posts AS THE CALLER and keeps who settled it', () => {
  // Attribution has two halves now: 30.0_stock_movements records who drained
  // (via stamp_stock_movement), the queue records who made the bills final —
  // usually an agent, and worth being able to see.
  assert.match(ROUTE, /callerFromRequest/);
  assert.ok(!ROUTE.includes('SERVICE_ROLE'), 'never service-role — it stamps every row `system`');
  assert.match(SQL, /queued_by_email/);
  assert.match(ROUTE, /settled_by: q\.queued_by_email/);
});

test('the queue follows the buy side, and only stock managers may clear it', () => {
  assert.match(SQL, /FOR SELECT TO authenticated USING \(public\.can_read_buy_side\(\)\)/);
  assert.match(SQL, /USING \(public\.can_write_buy_side\(\)\)/);
});
