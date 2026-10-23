/**
 * A foreign-currency PO is never saved without a rate (owner, 2026-10-23).
 *
 * The KSTAR figures are production's on 2026-10-23: PIO-2026013 (CNY 750,000,
 * estimate 2650) was settled on 16 Oct for IDR 2,015,733,651.10 — a realised
 * 2687.64. That is the rate EB.42538, PIO-2026020 and PIO-2026021 should have
 * been saved with, and the one they were backfilled to.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { estimatePoRate } from './poRate.ts';
import type { ExchangeRateHistory } from '../types/database';

const row = (po_id: string, supplier_id: string, currency: string, implied_rate: number, payment_date: string) =>
  ({ rate_id: `derived-${po_id}`, po_id, supplier_id, currency, implied_rate, payment_date,
    quoted_amount_foreign: 0, paid_amount_idr: 0 }) as unknown as ExchangeRateHistory;

const KSTAR = 'kstar';
const history = [
  row('EB.41875', KSTAR, 'CNY', 2124757246 / 796020, '2026-07-13'),
  row('PIO-2026013', KSTAR, 'CNY', 2015733651.1 / 750000, '2026-10-16'),
  row('EPSIVO-1', 'epsivo', 'CNY', 2679.31, '2026-10-20'),
  row('RENA-1', 'rena', 'USD', 17809, '2026-08-20'),
];

test('KSTAR CNY: the rate actually paid on 16 Oct, rounded — 2688', () => {
  const r = estimatePoRate(history, KSTAR, 'CNY');
  assert.deepEqual(r, { rate: 2688, source: 'supplier', po_id: 'PIO-2026013', date: '2026-10-16' });
});

test('a supplier with no history borrows the latest rate in that currency', () => {
  const r = estimatePoRate(history, 'new-supplier', 'CNY');
  assert.equal(r?.source, 'currency');
  assert.equal(r?.rate, 2679);
  assert.equal(r?.po_id, 'EPSIVO-1');
});

test('no history in the currency at all: today\'s market rate', () => {
  assert.deepEqual(estimatePoRate(history, KSTAR, 'EUR', { EUR: 18950.4 }),
    { rate: 18950, source: 'live', po_id: null, date: null });
});

test('nothing to go on: null, so the save is refused instead of guessing 1', () => {
  assert.equal(estimatePoRate(history, KSTAR, 'EUR', null), null);
  assert.equal(estimatePoRate([], KSTAR, 'CNY', {}), null);
});

test('IDR never carries an estimate', () => {
  assert.equal(estimatePoRate(history, KSTAR, 'IDR', { IDR: 1 }), null);
});

test('the database refuses a non-IDR PO without a rate, and names the endpoint', () => {
  const sql = readFileSync(new URL('../migrations/po_exchange_rate_required.sql', import.meta.url), 'utf8');
  assert.match(sql, /BEFORE INSERT OR UPDATE OF currency, exchange_rate/);
  assert.match(sql, /\/api\/agent\/purchasing\/rate/);
});

test('the New Deal screen saves through the same rule', () => {
  const page = readFileSync(new URL('../app/purchasing/page.tsx', import.meta.url), 'utf8');
  assert.equal((page.match(/estimatePoRate\(/g) ?? []).length, 2, 'both PO save paths (new and revise)');
});

test('the company benchmark comes first; without one the history rule still answers', () => {
  const bm = [
    { benchmark_id: 1, currency: 'CNY', rate: 2650, set_at: '2026-08-01T03:00:00Z' },
    { benchmark_id: 2, currency: 'CNY', rate: 2688.4, set_at: '2026-10-20T03:00:00Z' },
  ];
  const r = estimatePoRate([], 'kstar', 'CNY', { CNY: 2704 }, bm);
  assert.deepEqual(r, { rate: 2688, source: 'benchmark', po_id: null, date: '2026-10-20' });
  // No USD benchmark: today's market rate, exactly as before.
  assert.equal(estimatePoRate([], 'kstar', 'USD', { USD: 16890 }, bm)?.source, 'live');
  assert.equal(estimatePoRate([], 'kstar', 'IDR', null, bm), null);
});
