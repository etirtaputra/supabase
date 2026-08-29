/**
 * The board must never lie about money.
 *
 * Every case here is a way the old Basecamp board drifted from the truth, or a
 * shape the production data actually contains — chiefly that most POs are paid
 * in one go with no down payment at all (15 of 223 carry one; 65 carry a
 * balance), so a strict stage sequence would strand two thirds of the board.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  milestonesReached, furthest, isComplete, nextAction, reachedCount, MILESTONE_IDS,
} from './poProgress.ts';

type AnyPo = Parameters<typeof milestonesReached>[0];
type AnyCost = Parameters<typeof milestonesReached>[1][number];

const po = (o: Partial<AnyPo> = {}): AnyPo => ({
  po_id: 1 as never, po_number: 'PIO-1', po_date: '2026-08-01', pi_number: 'PI-1',
  currency: 'CNY' as never, exchange_rate: 2645, total_value: 1000, status: 'Confirmed' as never,
  ...o,
} as AnyPo);

const cost = (cat: string, amount: number, currency = 'CNY', rate?: number): AnyCost =>
  ({ cost_id: `c${Math.random()}`, po_id: 1, cost_category: cat, amount,
     currency, exchange_rate: rate } as unknown as AnyCost);

// ── The two questions the data answers about documents ──────────────────────

test('a PI number, a PI date or a linked quote each count as PI received', () => {
  assert.equal(milestonesReached(po({ pi_number: 'PI-9' }), []).pi_received, true);
  assert.equal(milestonesReached(po({ pi_number: undefined, pi_date: '2026-08-01' }), []).pi_received, true);
  assert.equal(milestonesReached(po({ pi_number: undefined, quote_id: 4 as never }), []).pi_received, true);
  assert.equal(milestonesReached(po({ pi_number: undefined }), []).pi_received, false);
});

test('a Draft PO has not been sent, however complete it looks', () => {
  assert.equal(milestonesReached(po({ status: 'Draft' as never }), []).po_sent, false);
  assert.equal(milestonesReached(po({ status: 'Confirmed' as never }), []).po_sent, true);
  assert.equal(milestonesReached(po({ po_date: undefined }), []).po_sent, false);
});

// ── Payment: the part that must not be wrong ────────────────────────────────

test('a part payment is not a paid balance', () => {
  const r = milestonesReached(po(), [cost('down_payment', 300)]);
  assert.equal(r.dp_paid, true);
  assert.equal(r.balance_paid, false, '300 of 1000 is not settled');
});

test('DP plus balance reaching the total settles it', () => {
  const r = milestonesReached(po(), [cost('down_payment', 300), cost('balance_payment', 700)]);
  assert.equal(r.balance_paid, true);
});

test('paid in full in one go, with no DP — the common case in production', () => {
  const r = milestonesReached(po(), [cost('balance_payment', 1000)]);
  assert.equal(r.dp_paid, false, 'there was never a down payment');
  assert.equal(r.balance_paid, true);
  assert.equal(furthest(r), 'balance_paid', 'the missing DP must not hold the card back');
});

test('the obligation is measured in the currency owed, not in rupiah', () => {
  // Supplier is owed CNY 1000 and has had CNY 1000. A rate move since the PO
  // was raised is not an underpayment.
  const r = milestonesReached(po({ exchange_rate: 2645 }), [cost('balance_payment', 1000, 'CNY', 2100)]);
  assert.equal(r.balance_paid, true, 'a rate move is not a debt');
});

test('an IDR order is settled in IDR', () => {
  const p = po({ currency: 'IDR' as never, exchange_rate: undefined, total_value: 5_000_000 });
  assert.equal(milestonesReached(p, [cost('balance_payment', 4_000_000, 'IDR')]).balance_paid, false);
  assert.equal(milestonesReached(p, [cost('balance_payment', 5_000_000, 'IDR')]).balance_paid, true);
});

test('an IDR payment against a foreign PO converts at the payment rate', () => {
  // No same-currency payment, so the IDR fallback runs: 2,645,000 at the PO's
  // own rate is exactly the CNY 1000 owed.
  const r = milestonesReached(po(), [cost('balance_payment', 2_645_000, 'IDR')]);
  assert.equal(r.balance_paid, true);
});

test('a rounding shortfall of a few units still counts as paid', () => {
  assert.equal(milestonesReached(po(), [cost('balance_payment', 999.999)]).balance_paid, true,
    'a card stranded one fen short is the drift this board exists to stop');
});

test('a PO with no total and no payments is not silently "paid"', () => {
  assert.equal(milestonesReached(po({ total_value: 0 }), []).balance_paid, false);
  assert.equal(milestonesReached(po(), []).balance_paid, false);
});

// ── The import bundle ───────────────────────────────────────────────────────

test('any one of the import charges reaches PIB & OPS', () => {
  for (const c of ['local_import_duty', 'local_vat', 'local_income_tax', 'local_import_tax']) {
    assert.equal(milestonesReached(po(), [cost(c, 1)]).pib_paid, true, `${c} should count`);
  }
});

test('a bank fee is not an import charge', () => {
  assert.equal(milestonesReached(po(), [cost('telex_bank_fee', 50)]).pib_paid, false);
  assert.equal(milestonesReached(po(), [cost('local_delivery', 50)]).pib_paid, false);
});

// ── The two stored ticks ────────────────────────────────────────────────────

test('the manual checkpoints come only from their stored timestamps', () => {
  assert.equal(milestonesReached(po(), []).docs_checked, false);
  assert.equal(milestonesReached(po({ docs_checked_at: '2026-08-20T04:00:00Z' }), []).docs_checked, true);
  assert.equal(milestonesReached(po({ hard_copy_received_at: '2026-08-21T04:00:00Z' }), []).hard_copy, true);
});

// ── Which column the card sits in ───────────────────────────────────────────

test('the card sits in the FURTHEST stage reached, gaps and all', () => {
  // Docs checked early, before the balance went out. The card belongs at docs,
  // not parked back at PO Sent.
  const r = milestonesReached(po({ docs_checked_at: '2026-08-20T00:00:00Z' }), [cost('down_payment', 300)]);
  assert.equal(furthest(r), 'docs_checked');
  assert.equal(r.balance_paid, false, 'and the balance is still visibly outstanding');
});

test('nothing reached at all has no column', () => {
  const r = milestonesReached(po({ pi_number: undefined, po_date: undefined, status: 'Draft' as never }), []);
  assert.equal(furthest(r), null);
});

test('every milestone done is complete, and one short is not', () => {
  const all = milestonesReached(
    po({ docs_checked_at: 'x', hard_copy_received_at: 'y' }),
    [cost('down_payment', 300), cost('balance_payment', 700), cost('local_vat', 10)],
  );
  assert.equal(reachedCount(all), MILESTONE_IDS.length);
  assert.ok(isComplete(all));

  const noHardCopy = milestonesReached(
    po({ docs_checked_at: 'x' }),
    [cost('balance_payment', 1000), cost('local_vat', 10)],
  );
  assert.ok(!isComplete(noHardCopy), 'the hard copy is still outstanding');
});

// ── What the card offers next ───────────────────────────────────────────────

test('the next action skips the ticks and names real work', () => {
  const fresh = milestonesReached(po(), []);
  assert.equal(nextAction(fresh)?.id, 'dp_paid');

  const dpDone = milestonesReached(po(), [cost('down_payment', 300)]);
  assert.equal(nextAction(dpDone)?.id, 'balance_paid');

  const paid = milestonesReached(po(), [cost('balance_payment', 1000)]);
  assert.equal(nextAction(paid)?.id, 'pib_paid', 'a skipped DP is not offered again');
});

test('a finished deal has nothing left to offer', () => {
  const all = milestonesReached(
    po({ docs_checked_at: 'x', hard_copy_received_at: 'y' }),
    [cost('balance_payment', 1000), cost('local_vat', 10)],
  );
  assert.equal(nextAction(all), null);
});
