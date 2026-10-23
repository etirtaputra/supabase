/**
 * fxBenchmark — the company exchange rate, its log, and payments set against
 * it. PIO-2026013 is the real one: CNY 750,000 paid with IDR 2,015,733,651.10.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { currentBenchmarks, benchmarkOn, benchmarkLog, ageDays, paidRate, compareToBenchmark, summarise } from './fxBenchmark.ts';

const B = (id: number, currency: string, rate: number, set_at: string) => ({ benchmark_id: id, currency, rate, set_at, set_by_email: 'eric@ica.id' });
const LOG = [B(1, 'CNY', 2650, '2026-08-01T03:00:00Z'), B(2, 'USD', 17800, '2026-08-01T03:01:00Z'), B(3, 'CNY', 2688, '2026-10-16T02:00:00Z')];

test('the current rate is the newest row; a day reads the rate in force then', () => {
  const cur = currentBenchmarks(LOG);
  assert.equal(cur.get('CNY')?.rate, 2688);
  assert.equal(cur.get('USD')?.rate, 17800);
  assert.equal(benchmarkOn(LOG, 'CNY', '2026-09-07')?.rate, 2650);
  assert.equal(benchmarkOn(LOG, 'CNY', '2026-10-16')?.rate, 2688, 'set that day counts that day');
  assert.equal(benchmarkOn(LOG, 'CNY', '2026-07-31'), null, 'before any benchmark there is none to borrow');
  assert.equal(ageDays(cur.get('CNY')!, '2026-10-23'), 7);
});

test('the log says what each change replaced', () => {
  const log = benchmarkLog(LOG);
  assert.deepEqual(log.map((r) => [r.currency, r.rate, r.previous]), [['CNY', 2688, 2650], ['USD', 17800, null], ['CNY', 2650, null]]);
});

const PIO13 = { po_id: 'p13', po_number: 'PIO-2026013', po_date: '2026-08-12', currency: 'CNY', total_value: 750000, supplier_id: 's1', status: 'Fully Received' };

test('PIO-2026013: rupiah with no rate reads once the balance is paid', () => {
  const costs = [
    { po_id: 'p13', cost_category: 'down_payment', amount: 600000000, currency: 'IDR', payment_date: '2026-08-13', bank_account_id: 'bca' },
    { po_id: 'p13', cost_category: 'balance_payment', amount: 1415733651.1, currency: 'IDR', payment_date: '2026-10-16', bank_account_id: 'bca' },
    { po_id: 'p13', cost_category: 'telex_bank_fee', amount: 150000, currency: 'IDR', payment_date: '2026-10-16' },
  ];
  const r = paidRate(PIO13, costs)!;
  assert.equal(Math.round(r.rate * 100) / 100, 2687.64);
  assert.equal(r.paidOn, '2026-10-16');
  assert.equal(r.bankAccountId, 'bca');
  // The down payment alone, rupiah with no rate, is not a rate yet.
  assert.equal(paidRate(PIO13, costs.slice(0, 1)), null);
});

test('a transfer that states its bank rate is read on its own, even part-paid', () => {
  const r = paidRate(PIO13, [{ po_id: 'p13', cost_category: 'down_payment', amount: 225000, currency: 'CNY', exchange_rate: 2700, payment_date: '2026-08-13' }])!;
  assert.equal(r.rate, 2700);
  assert.equal(r.foreign, 225000);
});

test('compared with the benchmark of its PO date: paid 2,687.64 against 2,650 → Rp 28.2M above', () => {
  const costs = [{ po_id: 'p13', cost_category: 'balance_payment', amount: 2015733651.1, currency: 'IDR', payment_date: '2026-10-16' }];
  const c = compareToBenchmark(PIO13, costs, LOG)!;
  assert.equal(c.benchmarkRate, 2650, 'the rate in force on 12 Aug, not the 2,688 set later');
  assert.equal(Math.round(c.diffIdr / 1e5) / 10, 28.2);
  assert.ok(c.diffPct > 1.4 && c.diffPct < 1.43);
  // A PO older than any benchmark is not compared at all.
  assert.equal(compareToBenchmark({ ...PIO13, po_date: '2026-07-01' }, costs, LOG), null);
  assert.equal(compareToBenchmark({ ...PIO13, currency: 'IDR' }, costs, LOG), null);
});

test('the summary adds up per key and per currency, most paid above first', () => {
  const costs = (id: string, idr: number) => [{ po_id: id, cost_category: 'balance_payment', amount: idr, currency: 'IDR', payment_date: '2026-10-16' }];
  const a = compareToBenchmark({ ...PIO13, po_id: 'a' }, costs('a', 750000 * 2700), LOG)!;   // +50/unit
  const b = compareToBenchmark({ ...PIO13, po_id: 'b' }, costs('b', 750000 * 2640), LOG)!;   // −10/unit
  const rows = summarise([a, b], (c) => c.paid.paidOn!.slice(0, 7));
  assert.equal(rows.length, 1);
  assert.equal(rows[0].pos, 2);
  assert.equal(Math.round(rows[0].diffIdr), 750000 * 40);
});
