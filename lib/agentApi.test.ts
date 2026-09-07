/**
 * The visibility map is the API's honesty guarantee, so it is pinned here.
 *
 * If a signal's SQL gate changes, `SIGNAL_CAPABILITY` must change with it or
 * the API will advertise a signal the database then withholds — which is worse
 * than either alone: the agent reports "0 overdue invoices" and believes it.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { visibleKinds, hiddenKinds, ALL_KINDS, SIGNAL_CAPABILITY } from './agentApi.ts';

test('every signal declares a capability, and every capability is real', () => {
  for (const [kind, cap] of Object.entries(SIGNAL_CAPABILITY)) {
    assert.ok(['money', 'buy_side', 'any'].includes(cap), `${kind} has an unknown capability ${cap}`);
  }
  assert.equal(ALL_KINDS.length, Object.keys(SIGNAL_CAPABILITY).length);
});

test('owner sees everything', () => {
  assert.deepEqual(visibleKinds('owner'), ALL_KINDS);
  assert.deepEqual(hiddenKinds('owner'), []);
});

test('the engineer login (MANDA) sees operations but no money and no buy side', () => {
  const seen = visibleKinds('engineer');
  assert.deepEqual(seen, ['no_specs', 'quote_quiet', 'stock_short', 'unpriced']);
  // These are the two that matter: she must never be able to imply a zero.
  assert.deepEqual(hiddenKinds('engineer'), ['ar_overdue', 'below_cost', 'po_late']);
});

test('sell_admin sees money but not the buy side', () => {
  const seen = visibleKinds('sell_admin');
  assert.ok(seen.includes('ar_overdue'), 'AR is a sell-side responsibility');
  assert.ok(seen.includes('below_cost'));
  assert.ok(!seen.includes('po_late'), 'purchase orders are not theirs');
});

test('buy_admin sees the buy side and cost', () => {
  const seen = visibleKinds('buy_admin');
  assert.ok(seen.includes('po_late'));
  assert.ok(seen.includes('below_cost'));
});

test('a role nobody granted anything still sees the ungated signals only', () => {
  assert.deepEqual(visibleKinds('viewer'), ['no_specs', 'quote_quiet', 'stock_short', 'unpriced']);
  assert.deepEqual(visibleKinds('made_up_role'), visibleKinds('viewer'));
});

test('visible and hidden always partition the whole set', () => {
  for (const role of ['owner', 'buy_admin', 'sell_admin', 'sales', 'engineer', 'warehouse',
                      'aftersales', 'viewer', 'data_entry', 'finance']) {
    assert.deepEqual(
      [...visibleKinds(role), ...hiddenKinds(role)].sort(), ALL_KINDS,
      `${role}: a signal is neither visible nor hidden`);
  }
});
