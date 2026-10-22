import { test } from 'node:test';
import assert from 'node:assert/strict';
import { familyKey, customerKey, groupProposals, countStatuses, ACTIVE_DAYS, type GroupableQuote } from './proposalGroups.ts';

const fk = (n: string) => familyKey({ quote_id: 'x', quote_number: n });

test('every version of one proposal shares a key — however the number was decorated', () => {
  // IRC Inoac: the original and its revisions.
  for (const n of ['Q-20260714-962Y', 'Q-20260714-962Y-REV', 'Q-20260714-962Y-REV2', 'Q-20260714-962Y-REV3']) {
    assert.equal(fk(n), 'Q-20260714-962Y', n);
  }
  // Ayana: notes typed into the number, and a revision of one of those.
  for (const n of ['Q-20260724-RVSP (battery from AYANA)', 'Q-20260724-RVSP (battery from ICA/MBS)',
    'Q-20260724-RVSP (battery from ICA/MBS)-REV (PV from AYANA)']) {
    assert.equal(fk(n), 'Q-20260724-RVSP', n);
  }
  // Imigrasi's -P / -N series are separate proposals (different codes), not versions.
  assert.notEqual(fk('Q-20260919-RJ11-P'), fk('Q-20260919-VQ56-P'));
  assert.equal(fk('Q-20260919-RJ11-P'), 'Q-20260919-RJ11');
  // Not the house format: its own proposal, minus a -REV suffix.
  assert.equal(fk('OLD-17-REV2'), 'OLD-17');
  assert.equal(familyKey({ quote_id: 'abc', quote_number: '' }), 'id:abc');
});

test('one customer however it was typed', () => {
  assert.equal(customerKey('PT IRC Inoac'), customerKey('pt  irc inoac '));
  assert.equal(customerKey(null), '');
});

const NOW = Date.parse('2026-10-02T00:00:00Z');
const daysAgo = (d: number) => new Date(NOW - d * 86_400_000).toISOString();
let seq = 0;
const q = (o: Partial<GroupableQuote>): GroupableQuote => ({
  quote_id: `q${++seq}`, quote_number: `Q-20260101-${String(seq).padStart(4, '0')}`, customer_name: 'Acme',
  status: 'sent', created_at: daysAgo(10), updated_at: daysAgo(10), ...o,
});

test('per customer: total, draft, sent, won, rejected — over every proposal, whatever is shown', () => {
  const qs = [
    q({ status: 'draft' }), q({ status: 'sent' }), q({ status: 'sent' }),
    q({ status: 'accepted' }), q({ status: 'rejected' }),
    q({ status: 'sent', updated_at: daysAgo(200), created_at: daysAgo(200) }),
  ];
  assert.deepEqual(countStatuses(qs), { total: 6, draft: 1, sent: 3, won: 1, rejected: 1 });
  const [g] = groupProposals(qs, { now: NOW, show: (f) => f.active });
  assert.deepEqual(g.counts, { total: 6, draft: 1, sent: 3, won: 1, rejected: 1 }, 'the Active view does not change the counts');
  assert.equal(g.families.length, 3, 'draft + two recent sent; won, rejected and the stale one are archive');
});

test('versions fold under the newest; Active follows the newest version', () => {
  const base = q({ quote_number: 'Q-20260714-962Y', created_at: daysAgo(90), updated_at: daysAgo(90) });
  const rev = q({ quote_number: 'Q-20260714-962Y-REV', created_at: daysAgo(20), updated_at: daysAgo(20) });
  const [g] = groupProposals([base, rev], { now: NOW });
  assert.equal(g.families.length, 1);
  assert.equal(g.families[0].latest.quote_id, rev.quote_id);
  assert.deepEqual(g.families[0].older.map((x) => x.quote_id), [base.quote_id]);
  assert.equal(g.families[0].active, true);
});

test('a sent proposal goes quiet after ACTIVE_DAYS — unless a follow-up note is open', () => {
  const old = q({ updated_at: daysAgo(ACTIVE_DAYS + 1), created_at: daysAgo(ACTIVE_DAYS + 1) });
  assert.equal(groupProposals([old], { now: NOW })[0].families[0].active, false);
  assert.equal(groupProposals([old], { now: NOW, hasOpenNote: (id) => id === old.quote_id })[0].families[0].active, true);
  const edge = q({ updated_at: daysAgo(ACTIVE_DAYS), created_at: daysAgo(ACTIVE_DAYS) });
  assert.equal(groupProposals([edge], { now: NOW })[0].families[0].active, true);
});

test('customers with nothing to show disappear; the rest sort by latest activity', () => {
  const a = q({ customer_name: 'Alpha', updated_at: daysAgo(5) });
  const b = q({ customer_name: 'Beta', updated_at: daysAgo(1) });
  const c = q({ customer_name: 'Gamma', status: 'rejected' });
  const gs = groupProposals([a, b, c], { now: NOW, show: (f) => f.active });
  assert.deepEqual(gs.map((g) => g.name), ['Beta', 'Alpha']);
});

test('AYANA: a version numbered off the house pattern folds in by title and type; the rest newest first', () => {
  const base = { customer_name: 'AYANA Resort and Spa BALI', location: 'Atap BOH & Atap Ballroom AYANA BALI', project_type: 'hybrid_bess' };
  const vs = [
    q({ ...base, quote_number: 'Q-20260724-RVSP (battery from AYANA)', quote_date: '2026-07-24', created_at: '2026-07-24T08:00:00Z' }),
    q({ ...base, quote_number: 'Q-20260724-RVSP (battery from ICA/MBS)', quote_date: '2026-07-24', created_at: '2026-07-24T09:00:00Z' }),
    q({ ...base, quote_number: 'Q-20260724-RVSP (battery from ICA/MBS)-REV (PV from AYANA)', quote_date: '2026-09-03', created_at: '2026-09-03T08:00:00Z' }),
    q({ ...base, quote_number: 'Q-20260724-R4-PV+BESS_SBO', quote_date: '2026-10-20', created_at: '2026-10-20T08:00:00Z', status: 'draft' }),
  ];
  const other = q({ customer_name: base.customer_name, location: 'Tower Lily dan After Rock', quote_number: 'Q-20260916-NRRW' });
  const [g] = groupProposals([...vs, other], { now: NOW });
  assert.equal(g.families.length, 2, 'Atap BOH is one proposal; Tower Lily stays its own');
  const fam = g.families.find((f) => f.older.length)!;
  assert.equal(fam.latest.quote_number, 'Q-20260724-R4-PV+BESS_SBO');
  assert.deepEqual(fam.older.map((o) => o.quote_number), [
    'Q-20260724-RVSP (battery from ICA/MBS)-REV (PV from AYANA)',
    'Q-20260724-RVSP (battery from ICA/MBS)',
    'Q-20260724-RVSP (battery from AYANA)',
  ], 'older versions by date, newest on top');
});

test('same title but a different project type, or no title at all, stays separate', () => {
  const a = q({ customer_name: 'Rajawali', location: 'Rajawali Place', project_type: 'on_grid', quote_number: 'Q-20261001-AAAA' });
  const b = q({ customer_name: 'Rajawali', location: 'Rajawali Place', project_type: 'custom', quote_number: 'Q-20261002-BBBB' });
  const c = q({ customer_name: 'Rajawali', quote_number: 'Q-20261003-CCCC' });
  const d = q({ customer_name: 'Rajawali', quote_number: 'Q-20261004-DDDD' });
  assert.equal(groupProposals([a, b, c, d], { now: NOW })[0].families.length, 4);
});
