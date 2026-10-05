import { test } from 'node:test';
import assert from 'node:assert/strict';
import { epcDue, epcNudges, subtotalsByQuote, EPC_OUTCOME_DAYS, type NudgeQuote } from './proposalNudges.ts';

const NOW = Date.parse('2026-10-05T00:00:00Z');
const ago = (d: number) => new Date(NOW - d * 86_400_000).toISOString();
let n = 0;
const q = (o: Partial<NudgeQuote>): NudgeQuote => ({
  quote_id: `q${++n}`, quote_number: `Q-20260101-${String(n).padStart(4, '0')}`, customer_name: 'Acme',
  status: 'sent', created_at: ago(40), updated_at: ago(40), sent_at: ago(40), ...o,
});

test('what a proposal needs: chase, close out, or pick up', () => {
  assert.equal(epcDue(q({ sent_at: ago(3) }), NOW, 7), null, 'sent this week: give it time');
  assert.equal(epcDue(q({ sent_at: ago(10) }), NOW, 7), 'followup');
  assert.equal(epcDue(q({ sent_at: ago(EPC_OUTCOME_DAYS) }), NOW, 7), 'outcome');
  assert.equal(epcDue(q({ status: 'draft', updated_at: ago(8) }), NOW, 7), 'idle');
  assert.equal(epcDue(q({ status: 'draft', updated_at: ago(2) }), NOW, 7), null);
  assert.equal(epcDue(q({ status: 'accepted' }), NOW, 7), null, 'won needs nothing');
  assert.equal(epcDue(q({ status: 'rejected' }), NOW, 7), null);
});

test('follow-ups are counted by customer; versions count once, newest decides', () => {
  const qs = [
    // Imigrasi-like: three proposals, one customer
    q({ customer_name: 'Imigrasi', sent_at: ago(10) }), q({ customer_name: 'Imigrasi', sent_at: ago(12) }), q({ customer_name: 'IMIGRASI ', sent_at: ago(20) }),
    q({ customer_name: 'Ayana', sent_at: ago(9) }),
    // a revised proposal: the old version is 50 days old, the REV 9 — only the REV counts
    q({ customer_name: 'IRC', quote_number: 'Q-20260714-962Y', created_at: ago(50), sent_at: ago(50) }),
    q({ customer_name: 'IRC', quote_number: 'Q-20260714-962Y-REV', created_at: ago(9), sent_at: ago(9) }),
    q({ customer_name: 'Old Co', sent_at: ago(45) }),
  ];
  const value = new Map(qs.map((x, i) => [x.quote_id, (i + 1) * 100]));
  const out = epcNudges(qs, { now: NOW, followUpDays: 7, valueOf: (id) => value.get(id) ?? 0 });
  const fu = out.find((x) => x.due === 'followup')!;
  assert.equal(fu.proposals, 5);
  assert.equal(fu.customers, 3, 'Imigrasi ×3 (however typed), Ayana, IRC');
  assert.equal(fu.oldestDays, 20);
  assert.equal(fu.value, 100 + 200 + 300 + 400 + 600, 'the IRC REV, not its 50-day-old original');
  const oc = out.find((x) => x.due === 'outcome')!;
  assert.deepEqual([oc.proposals, oc.customers, oc.value], [1, 1, 700]);
});

test('subtotals take top-level lines only', () => {
  const m = subtotalsByQuote([
    { quote_id: 'a', parent_item_id: null, quantity: 2, sell_price: 10 },
    { quote_id: 'a', parent_item_id: 'x', quantity: 5, sell_price: 999 },
    { quote_id: 'a', parent_item_id: null, quantity: '3', sell_price: '1' },
  ]);
  assert.equal(m.get('a'), 23);
});
