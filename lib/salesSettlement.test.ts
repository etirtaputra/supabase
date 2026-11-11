/**
 * "Is it paid? Is it delivered?" — decided once (lib/salesSettlement.ts).
 * The oracles below are the formulas the five screens each carried until
 * 2026-11-11, so adopting the shared ones changed nothing on screen.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import {
  isSettled, isOwed, settlement, orderPayState, orderDeliveryState, PAID_TOLERANCE_IDR, SETTLEMENT_WORD,
} from './salesSettlement.ts';
import { stateIds, groupList } from './lifecycles.ts';

const AMOUNTS = [0, 0.4, 0.5, 0.6, 1, 999_999.4, 999_999.5, 999_999.6, 1_000_000, 1_000_000.5, 2_000_000];
const TOTALS = [0, 1, 1_000_000];

test('paid / partial / unpaid: the same answer every screen gave', () => {
  for (const total of TOTALS) for (const rcv of AMOUNTS) {
    // sales editor, print, invoices, sales list ("paidFull"):
    assert.equal(isSettled(total, rcv), total > 0 && rcv >= total - 0.5, `isSettled ${total}/${rcv}`);
    // customers paidState and both invoice chips:
    const old = total > 0 && rcv >= total - 0.5 ? 'paid' : rcv > 0 ? 'partial' : 'unpaid';
    assert.equal(settlement(total, rcv), old, `settlement ${total}/${rcv}`);
  }
  for (const a of AMOUNTS) assert.equal(isOwed(a), a > 0.5);
  assert.equal(PAID_TOLERANCE_IDR, 0.5);
  assert.deepEqual(SETTLEMENT_WORD, { paid: 'Paid', partial: 'Partial', unpaid: 'Unpaid' });
});

test('order payment state: the sales list’s rule, for every status', () => {
  const ORDER = groupList('sales_document', 'order');
  for (const status of [...stateIds('sales_document'), null]) for (const total of TOTALS) for (const rcv of AMOUNTS) {
    const old = (() => {
      if (!ORDER.includes(status as string) || total <= 0) return 'none';
      if (rcv >= total - 0.5) return 'paid';
      if (status === 'delivered') return 'outstanding';
      return rcv > 0 ? 'partial' : 'unpaid';
    })();
    assert.equal(orderPayState({ status, total, received: rcv }), old, `${status} ${total}/${rcv}`);
    assert.ok(stateIds('sales_payment').includes(orderPayState({ status, total, received: rcv })));
  }
});

test('order delivery state: from the order and its delivery orders', () => {
  assert.equal(orderDeliveryState('delivered', []), 'delivered');
  assert.equal(orderDeliveryState('preparing', ['preparing', 'delivered']), 'partial');
  assert.equal(orderDeliveryState('preparing', ['preparing']), 'preparing');
  assert.equal(orderDeliveryState('ordered', []), 'none');
  for (const s of ['delivered', 'partial', 'preparing', 'none']) assert.ok(stateIds('sales_delivery').includes(s));
});

function sourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) { if (name !== 'node_modules') out.push(...sourceFiles(p)); }
    else if (/\.tsx?$/.test(name) && !/\.test\.ts$/.test(name)) out.push(p);
  }
  return out;
}

test('no screen types the half-rupiah rule out again', () => {
  const offenders: string[] = [];
  for (const dir of ['app', 'components', 'hooks', 'lib']) {
    for (const f of sourceFiles(join(process.cwd(), dir))) {
      if (f.endsWith('lib/salesSettlement.ts')) continue;
      const src = readFileSync(f, 'utf8');
      // "received >= total - 0.5" in any spelling
      if (/>=\s*[\w.]+\s*-\s*0\.5\b/.test(src)) offenders.push(f.replace(process.cwd() + '/', ''));
    }
  }
  assert.deepEqual(offenders, [], 'use isSettled() / settlement() from lib/salesSettlement.ts');
});
