/**
 * "How much do I still have to transfer?" — asked of four real deals.
 *
 * OWNER, 2026-09-22: *"for the deals in deal lookup, it will be helpful for the
 * procurement and finance team to see the remaining balance to be paid so they
 * know how much to transfer without calculating manually."*
 *
 * The figures below were read out of production on 2026-09-22, and they are
 * the acceptance test: this module's job is to reproduce, from the rows the
 * app already holds, the arithmetic the team is currently doing on paper.
 * Three of the four are cases the previous outstanding figure got wrong.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  poBalance, dealBalance, remainingLabel, isPrincipal, settledTolerance,
  RATE_SUSPECT_FACTOR, type BalancePo, type BalanceCost,
} from './dealBalance.ts';

const read = (p: string) => readFileSync(join(process.cwd(), p), 'utf8');
const TAB = read('components/ui/DealLookupTab.tsx');

const po = (o: Partial<BalancePo> & { po_id: string }): BalancePo =>
  ({ status: 'Confirmed', currency: 'IDR', total_value: 0, ...o });
const pay = (o: Partial<BalanceCost> & { po_id: string }): BalanceCost =>
  ({ cost_category: 'down_payment', currency: 'IDR', amount: 0, ...o });

// ── The four production deals ───────────────────────────────────────────────

test('PIO-2026017 — paid in the PO currency: CNY 115,800 − 34,740 = 81,060', () => {
  const b = poBalance(
    po({ po_id: '1', po_number: 'PIO-2026017', currency: 'CNY', total_value: 115_800, exchange_rate: 2651 }),
    [pay({ po_id: '1', currency: 'CNY', amount: 34_740, exchange_rate: 2651 })],
  );
  assert.equal(b.remaining, 81_060);
  assert.equal(b.currency, 'CNY');
  assert.equal(b.derived, false, 'nothing was converted — this figure is exact');
  assert.equal(b.settled, false);
});

test('PIO-015-ISL-09-2026 — USD 43,865.91 − 12,962.91 = 30,903.00', () => {
  const b = poBalance(
    po({ po_id: '2', currency: 'USD', total_value: 43_865.91, exchange_rate: 17_675 }),
    [pay({ po_id: '2', currency: 'USD', amount: 12_962.91, exchange_rate: 17_675 })],
  );
  assert.ok(Math.abs(b.remaining - 30_903) < 0.005, `got ${b.remaining}`);
});

test('PIO-2026012 — the case the old figure could not see at all', () => {
  // A USD 60,765 order paid with an IDR 325,314,350 transfer. The old
  // `foreignPaid` counted only payments recorded IN the PO's currency, so this
  // order showed no foreign progress whatsoever and the buyer had to divide by
  // hand. The payment carries its own rate, so the dollars it bought are
  // knowable exactly: 325,314,350 ÷ 17,845 = 18,230.
  const b = poBalance(
    po({ po_id: '3', currency: 'USD', total_value: 60_765, exchange_rate: 17_809 }),
    [pay({ po_id: '3', currency: 'IDR', amount: 325_314_350, exchange_rate: 17_845 })],
  );
  assert.ok(Math.abs(b.paid - 18_230) < 0.005, `paid ${b.paid}`);
  assert.ok(Math.abs(b.remaining - 42_535) < 0.005, `remaining ${b.remaining}`);
  assert.equal(b.derived, true, 'the figure came from a conversion and must say so');
  assert.equal(b.assumedRate, false, "the payment's own rate was used, so it is not a guess");
});

test('PIO-013-ISL-07-2026 — an overpayment is reported, not clamped away', () => {
  // USD 216 ordered, IDR 5,652,000 paid at 18,000 = USD 314. Either the order
  // total is wrong or the transfer was; "nothing outstanding" hides both.
  const b = poBalance(
    po({ po_id: '4', currency: 'USD', total_value: 216, exchange_rate: 18_025 }),
    [pay({ po_id: '4', cost_category: 'balance_payment', currency: 'IDR', amount: 5_652_000, exchange_rate: 18_000 })],
  );
  assert.equal(b.remaining, 0, 'you cannot transfer a negative amount');
  assert.ok(Math.abs(b.overpaid - 98) < 0.005, `overpaid ${b.overpaid}`);
  assert.equal(b.settled, true);
});

// ── What counts as a payment ────────────────────────────────────────────────

test('only the principal counts — a transfer sized to include duty would be wrong', () => {
  assert.equal(isPrincipal({ po_id: '1', cost_category: 'down_payment' }), true);
  assert.equal(isPrincipal({ po_id: '1', cost_category: 'balance_payment' }), true);
  assert.equal(isPrincipal({ po_id: '1', cost_category: 'additional_balance_payment' }), true);
  for (const other of ['local_vat', 'local_import_duty', 'telex_bank_fee', 'freight_cost', 'local_delivery', 'penalty_fee']) {
    assert.equal(isPrincipal({ po_id: '1', cost_category: other }), false, `${other} is not money owed to this supplier on this order`);
  }
  // Excluded to match every other payment total in the app — one opinion about
  // what "paid" means, not two.
  assert.equal(isPrincipal({ po_id: '1', cost_category: 'overpayment_credit' }), false);
});

test('a payment with no rate of its own falls back, and says that it did', () => {
  // 60 of the 77 balance payments in production carry no rate, so this is the
  // COMMON path, not the edge case.
  const b = poBalance(
    po({ po_id: '5', currency: 'USD', total_value: 1000, exchange_rate: 16_000 }),
    [pay({ po_id: '5', currency: 'IDR', amount: 8_000_000, exchange_rate: null })],
  );
  assert.equal(b.paid, 500);
  assert.equal(b.assumedRate, true, 'an approximate figure must be marked approximate');
});

test('a payment that can be converted by nothing is counted as unpaid', () => {
  // Better to overstate what is owed than to under-transfer on a guess.
  const b = poBalance(
    po({ po_id: '6', currency: 'USD', total_value: 1000, exchange_rate: null }),
    [pay({ po_id: '6', currency: 'IDR', amount: 8_000_000, exchange_rate: null })],
  );
  assert.equal(b.paid, 0);
  assert.equal(b.remaining, 1000);
});

test('a converted total settles on a tolerance; an exact one does not need to', () => {
  assert.equal(settledTolerance(60_765, false), 0.01);
  assert.ok(settledTolerance(60_765, true) > 60, 'a tenth of a percent on a 60k order');
  // Paid to the last rupiah, but the division lands a cent short.
  const b = poBalance(
    po({ po_id: '7', currency: 'USD', total_value: 1000, exchange_rate: 16_000 }),
    [pay({ po_id: '7', currency: 'IDR', amount: 15_999_999, exchange_rate: 16_000 })],
  );
  assert.equal(b.settled, true, 'one rupiah short is settled, not outstanding');
  assert.equal(b.remaining, 0);
});

// ── The rupiah beside it ────────────────────────────────────────────────────

test("the rupiah estimate prefers TODAY's rate, and always names the one it used", () => {
  const base = po({ po_id: '8', currency: 'CNY', total_value: 115_800, exchange_rate: 2651 });
  const live = poBalance(base, [pay({ po_id: '8', currency: 'CNY', amount: 34_740 })], { liveRates: { CNY: 2300 } });
  assert.equal(live.idrSource, 'live');
  assert.equal(live.idr, 81_060 * 2300);

  // No live rate today — the booked rate is the fallback, and the label changes
  // with it so nobody reads a months-old rate as this morning's.
  const booked = poBalance(base, [pay({ po_id: '8', currency: 'CNY', amount: 34_740 })], { liveRates: null });
  assert.equal(booked.idrSource, 'po');
  assert.equal(booked.idr, 81_060 * 2651);
});

test('a booked rate far from the market is flagged, and the foreign figure is not touched by it', () => {
  // Real: PIO-2026013 is a CNY order booked at 17,881 — a USD rate on a CNY
  // order. Every rupiah total for it is ~7× too big. The CNY owed does not
  // depend on any rate, so it stays correct while the flag goes up.
  const b = poBalance(
    po({ po_id: '9', currency: 'CNY', total_value: 750_000, exchange_rate: 17_881 }),
    [], { liveRates: { CNY: 2300 } },
  );
  assert.equal(b.remaining, 750_000);
  assert.equal(b.rateSuspect, true);
  assert.ok(17_881 / 2300 > RATE_SUSPECT_FACTOR);
  // …and a normal rate is not cried wolf over.
  assert.equal(poBalance(po({ po_id: '9', currency: 'CNY', total_value: 1, exchange_rate: 2651 }), [], { liveRates: { CNY: 2300 } }).rateSuspect, false);
});

// ── A whole deal ────────────────────────────────────────────────────────────

test('a deal owing two currencies reports both, and never adds them together', () => {
  const d = dealBalance(
    [
      po({ po_id: 'a', currency: 'CNY', total_value: 115_800, exchange_rate: 2651 }),
      po({ po_id: 'b', currency: 'USD', total_value: 43_865.91, exchange_rate: 17_675 }),
    ],
    [
      pay({ po_id: 'a', currency: 'CNY', amount: 34_740 }),
      pay({ po_id: 'b', currency: 'USD', amount: 12_962.91 }),
    ],
    { liveRates: { CNY: 2300, USD: 16_500 } },
  );
  assert.equal(remainingLabel(d, (n, c) => `${c} ${Math.round(n)}`), 'CNY 81060 · USD 30903');
  assert.equal(d.lines.length, 2);
  // One rupiah figure is fine — it is the cash the week needs — but there is no
  // single rate behind it, so none is named.
  assert.equal(d.idrRate, null);
  assert.equal(d.idr, 81_060 * 2300 + 30_903 * 16_500);
});

test('a superseded or cancelled order is not a bill', () => {
  const d = dealBalance(
    [
      po({ po_id: 'a', currency: 'USD', total_value: 10_000, status: 'Replaced' }),
      po({ po_id: 'b', currency: 'USD', total_value: 12_000, status: 'Cancelled' }),
      po({ po_id: 'c', currency: 'USD', total_value: 500, exchange_rate: 16_000, status: 'Confirmed' }),
    ], [],
  );
  assert.equal(d.lines.length, 1);
  assert.equal(d.lines[0].remaining, 500);
});

test('nothing owed means no label at all, rather than a zero to read past', () => {
  const d = dealBalance(
    [po({ po_id: 'a', currency: 'CNY', total_value: 100, exchange_rate: 2651 })],
    [pay({ po_id: 'a', currency: 'CNY', amount: 100 })],
  );
  assert.equal(remainingLabel(d, (n, c) => `${c} ${n}`), null);
  assert.equal(d.settled, true);
});

// ── Where it is shown ───────────────────────────────────────────────────────

test('the screen shows the transfer amount in the currency, not rupiah alone', () => {
  assert.match(TAB, /const owed\s+= remainingLabel\(bal, fmtMoney\);/);
  assert.match(TAB, /\{owed\} to pay/);
  assert.match(TAB, /To transfer<\/span>/);
  assert.match(TAB, /\['outstanding', 'To transfer', 'text-right'\]/);
});

test('every rupiah estimate on the screen carries the rate that made it', () => {
  // A number without its source cannot be checked, and this one decides how
  // much money leaves the bank.
  const estimates = TAB.match(/≈ \{fmtIdr\(/g) ?? [];
  assert.ok(estimates.length >= 3, `expected the estimate in the card, the list and the PO panel, found ${estimates.length}`);
  assert.match(TAB, /rateNote\(bal\)/);
  assert.match(TAB, /rateNote\(b\)/);
  assert.match(TAB, /at today's rate|at the PO rate/);
});

test('the deal lookup does not keep its own copy of the arithmetic', () => {
  const body = TAB.slice(TAB.indexOf('const renderDealRow'));
  assert.ok(!/total_value\)\s*-\s*/.test(body), 'the remaining balance must come from lib/dealBalance');
  assert.match(TAB, /import \{ dealBalance, poBalance, remainingLabel/);
});
