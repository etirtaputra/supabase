/**
 * The declared lifecycles (lib/lifecycles.ts) are the contract: the screens
 * read them, the database CHECKs mirror them, agents are served them. These
 * tests keep all three honest.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import {
  LIFECYCLES, lifecycle, stateIds, canMove, salesDocumentActions, describeLifecycles, type LifecycleId,
  groupList, groupSet, inGroup, menuFor,
} from './lifecycles.ts';
import { ENUMS } from '../constants/enums.ts';
import { SALES_STATUS, MILESTONE_ORDER, COMMITTED_STATUSES } from './salesStatus.ts';
import { SERIAL_STATUS } from './serials.ts';

test('every lifecycle is a well-formed graph', () => {
  const ids = LIFECYCLES.map((l) => l.id);
  assert.equal(new Set(ids).size, ids.length, 'duplicate lifecycle id');
  for (const l of LIFECYCLES) {
    const st = l.states.map((s) => s.id);
    assert.equal(new Set(st).size, st.length, `${l.id}: duplicate state`);
    assert.ok(st.includes(l.initial), `${l.id}: initial ${l.initial} is not a state`);
    assert.ok(l.enforced.length > 0, `${l.id}: say where (or that nowhere) it is enforced`);
    for (const m of l.moves) {
      assert.ok(st.includes(m.to), `${l.id}: move to unknown ${m.to}`);
      for (const f of m.from) assert.ok(st.includes(f), `${l.id}: move from unknown ${f}`);
      assert.ok(!m.from.includes(m.to), `${l.id}: ${m.to} → ${m.to} is not a move`);
    }
    // Every state a screen can reach is reachable from the initial one;
    // a state nothing writes must say so (`unused`) instead of looking live.
    const seen = new Set([l.initial]);
    for (let grew = true; grew;) {
      grew = false;
      for (const m of l.moves) if (!seen.has(m.to) && m.from.some((f) => seen.has(f))) { seen.add(m.to); grew = true; }
    }
    const stranded = l.states.filter((s) => !seen.has(s.id) && !s.unused && s.id !== l.initial).map((s) => s.id);
    assert.deepEqual(stranded, [], `${l.id}: states no move reaches — add the move or mark them unused`);
  }
});

/** The header buttons the sales editor built by hand until 2026-11-10 — kept as the oracle. */
function oldSalesButtons(st: string, orderMode: boolean) {
  const a: { label: string; to: string; primary?: boolean; danger?: boolean }[] = [];
  if (st === 'draft' && !orderMode) { a.push({ label: 'Validate', to: 'validated', primary: true }); a.push({ label: 'Sent', to: 'sent' }); }
  if (st === 'validated') a.push({ label: 'Sent', to: 'sent', primary: true });
  if (st === 'sent') a.push({ label: 'Accepted', to: 'accepted' });
  if (['draft', 'validated', 'sent', 'accepted'].includes(st)) a.push({ label: 'Confirm Order', to: 'ordered', primary: orderMode || !['draft', 'validated'].includes(st) });
  if (st === 'ordered') a.push({ label: 'Revert', to: 'accepted' });
  if (st === 'invoiced') a.push({ label: 'Revert', to: 'ordered' });
  if (st === 'preparing') a.push({ label: 'Revert', to: 'invoiced' });
  if (st === 'delivered') a.push({ label: 'Reopen', to: 'preparing' });
  if (['cancelled', 'rejected'].includes(st)) a.push({ label: 'Reopen', to: 'draft' });
  if (['draft', 'validated', 'sent'].includes(st)) a.push({ label: 'Reject', to: 'rejected', danger: true });
  if (['accepted', 'ordered', 'invoiced', 'preparing'].includes(st)) a.push({ label: 'Cancel', to: 'cancelled', danger: true });
  return a;
}

test('sales editor buttons: the same as before, every one a declared move', () => {
  for (const st of stateIds('sales_document')) {
    for (const orderMode of [false, true]) {
      const om = orderMode && st === 'draft';
      // With an invoice on the order, nothing changed at all.
      assert.deepEqual(salesDocumentActions(st, { orderMode: om, hasInvoice: true }), oldSalesButtons(st, om), `${st} orderMode=${om}`);
      for (const a of salesDocumentActions(st, { orderMode: om, hasInvoice: false })) {
        assert.ok(canMove('sales_document', st, a.to), `${st} → ${a.to} is offered but not declared`);
      }
    }
  }
  // The one deliberate change: Revert from Preparing without an invoice used to
  // land on Invoiced — an order "invoiced" with no invoice.
  assert.deepEqual(salesDocumentActions('preparing', { orderMode: false, hasInvoice: false }).find((a) => a.label === 'Revert')?.to, 'ordered');
});

test('the screens’ maps are the declaration', () => {
  assert.deepEqual(Object.keys(SALES_STATUS), stateIds('sales_document'));
  assert.deepEqual(Object.keys(SERIAL_STATUS), stateIds('serial_number'));
  for (const s of MILESTONE_ORDER) assert.ok(stateIds('sales_document').includes(s), `milestone ${s}`);
  for (const s of COMMITTED_STATUSES) assert.ok(stateIds('sales_document').includes(s), `committed ${s}`);
  // No screen keeps its own copy of a status colour map any more.
  for (const f of ['app/proposals/page.tsx', 'app/proposals/[id]/page.tsx', 'app/aftersales/page.tsx', 'lib/supportLetters.ts', 'lib/serials.ts', 'lib/salesStatus.ts']) {
    const src = readFileSync(join(process.cwd(), f), 'utf8');
    assert.ok(!/^\s+(draft|open|in_stock):\s*('|\{\s*label)/m.test(src), `${f} declares status colours again — read lib/lifecycles.ts`);
  }
});

/** CHECK (col IN ('a', 'b')) lists in the migrations, by table. */
function checkList(file: string, constraint: string): string[] {
  const sql = readFileSync(join(process.cwd(), 'migrations', file), 'utf8');
  const at = sql.lastIndexOf(constraint);
  assert.ok(at >= 0, `${constraint} not found in ${file}`);
  const m = /IN\s*\(([^)]*)\)/.exec(sql.slice(at));
  assert.ok(m, `${constraint}: no IN (...) list`);
  return [...m[1].matchAll(/'([^']+)'/g)].map((x) => x[1]);
}

test('the database CHECKs list exactly the declared states', () => {
  const cases: [LifecycleId, string, string][] = [
    ['epc_proposal', 'lifecycle_checks.sql', 'proposal_status_valid'],
    ['sales_document', 'lifecycle_checks.sql', 'sales_document_status_valid'],
    ['delivery_order', 'lifecycle_checks.sql', 'delivery_order_status_valid'],
    ['true_up_queue', 'true_up_queue_check.sql', 'landed_true_up_queue_outcome_valid'],
  ];
  for (const [id, file, name] of cases) assert.deepEqual(checkList(file, name).sort(), stateIds(id).sort(), `${id} vs ${name}`);
  // The older tables carried their CHECK from the start.
  for (const [id, file] of [['aftersales_case', 'create_aftersales.sql'], ['support_letter', 'create_support_letters.sql'], ['serial_number', 'serial_numbers.sql']] as [LifecycleId, string][]) {
    const sql = readFileSync(join(process.cwd(), 'migrations', file), 'utf8');
    for (const s of stateIds(id)) assert.ok(sql.includes(`'${s}'`), `${id}: ${s} is not in ${file}'s CHECK`);
  }
});

// The true-up queue keeps its state in `outcome`, which the status scan below
// does not read. The drain is its only app-side writer: every outcome it
// stores or filters on must be a declared queue state. (Its JSON reply says
// 'failed' and 'posted' — those are API verdicts, never written to the row.)
test('the true-up drain stores and filters only declared queue states', () => {
  const src = readFileSync(join(process.cwd(), 'app/api/landed/autopost/route.ts'), 'utf8');
  const known = new Set(stateIds('true_up_queue'));
  const used = [
    ...[...src.matchAll(/\.update\(\{\s*outcome:\s*'([^']+)'/g)].map((m) => m[1]),
    ...[...src.matchAll(/\.eq\(\s*'outcome'\s*,\s*'([^']+)'/g)].map((m) => m[1]),
  ];
  assert.ok(used.length >= 3, `the drain's queue writes were not found (${used.length}) — update this test`);
  assert.deepEqual(used.filter((v) => !known.has(v)), [], 'an undeclared outcome is written to 30.5');
});

// Status words the app compares that are NOT lifecycle states.
const NOT_LIFECYCLES = new Set([
  'SUBSCRIBED',            // Supabase realtime channel state
  'same', 'possible', 'new', // Dolibarr matching verdicts (lib/dolibarrMatch)
  'in', 'out', 'mixed',    // after-sales warranty verdict (computed per case)
]);

function sourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) { if (name !== 'node_modules' && name !== 'dev') out.push(...sourceFiles(p)); }
    else if (/\.tsx?$/.test(name) && !/\.test\.ts$/.test(name)) out.push(p);
  }
  return out;
}

test('every status the app compares or writes is a declared state', () => {
  const known = new Set(LIFECYCLES.flatMap((l) => l.states.map((s) => s.id)));
  const pats = [
    /status\s*(?:===|!==|=|:)\s*'([^']+)'/g,
    /\.(?:eq|neq)\(\s*'(?:status|pi_status)'\s*,\s*'([^']+)'/g,
  ];
  const unknown: string[] = [];
  for (const dir of ['app', 'components', 'lib', 'hooks']) {
    for (const f of sourceFiles(join(process.cwd(), dir))) {
      if (f.endsWith('lib/lifecycles.ts')) continue;
      const src = readFileSync(f, 'utf8');
      for (const re of pats) {
        for (const m of src.matchAll(re)) {
          if (/^(bg|text)-/.test(m[1])) continue; // a style map keyed `status:`, not a value
          if (!known.has(m[1]) && !NOT_LIFECYCLES.has(m[1])) unknown.push(`${f.replace(process.cwd() + '/', '')}: '${m[1]}'`);
        }
      }
      for (const m of src.matchAll(/\.in\(\s*'status'\s*,\s*\[([^\]]*)\]/g)) {
        for (const v of m[1].matchAll(/'([^']+)'/g)) if (!known.has(v[1])) unknown.push(`${f}: '${v[1]}'`);
      }
    }
  }
  assert.deepEqual(unknown, [], 'declare the state in lib/lifecycles.ts (or fix the typo)');
});

test('agents get every lifecycle as plain JSON', () => {
  const d = describeLifecycles();
  assert.equal(d.length, LIFECYCLES.length);
  const json = JSON.parse(JSON.stringify(d));
  const sales = json.find((l: { id: string }) => l.id === 'sales_document');
  assert.deepEqual(sales.states.map((s: { value: string }) => s.value), stateIds('sales_document'));
  assert.ok(sales.moves.some((m: { from: string[]; to: string }) => m.to === 'ordered' && m.from.includes('draft')));
  assert.equal(lifecycle('purchase_order').storage, 'enum');
});

// ── Groups: what code counts with (2026-11-10, second pass) ─────────────────
// Eleven buy-side files each kept their own "which PO statuses count" set and
// the sales screens spelled ['ordered','invoiced','preparing','delivered'] out
// nine times. They now read named groups. Each group's membership was copied
// from the code that used it, so adopting it changed nothing on screen; these
// pins make any change to a group a deliberate, visible decision.

test('every group names only states of its own lifecycle', () => {
  for (const l of LIFECYCLES) {
    const ids = new Set(l.states.map((s) => s.id));
    for (const [g, members] of Object.entries(l.groups ?? {})) {
      assert.ok(members.length > 0, `${l.id}.${g} is empty`);
      for (const m of members) assert.ok(ids.has(m), `${l.id}.${g}: ${m} is not a state`);
    }
  }
  assert.throws(() => groupList('purchase_order', 'recieved'), /no group/, 'a misspelt group must fail loudly, not match nothing');
});

test('the PO groups keep the membership each reader had before it adopted them', () => {
  const g = (name: string) => [...groupList('purchase_order', name)].sort();
  assert.deepEqual(g('received'), ['Fully Received', 'Partially Received']);             // receiptGap, purchasingInbox GOODS_IN, position, dashboard, Deal Lookup
  assert.deepEqual(g('open'), ['Confirmed', 'Partially Received', 'Sent']);              // stock receive, reorder, inTransit, incomingCost
  assert.deepEqual(g('placed'), ['Confirmed', 'Fully Received', 'Partially Received']);  // computeTUC FX_PO, askContext LIVE
  assert.deepEqual(g('notAnOrder'), ['Cancelled', 'Draft', 'Replaced']);                // dealBalance, supplierLeadTimes, position, stock receive
  assert.deepEqual(g('void'), ['Cancelled', 'Replaced']);                                // Deal Lookup action buttons
  assert.deepEqual([...groupList('price_quote', 'live')].sort(), ['Accepted', 'Open']);  // incomingCost
  assert.deepEqual([...groupList('price_quote', 'dead')].sort(), ['Expired', 'Rejected', 'Replaced']);
});

test('the sales-document groups keep their membership', () => {
  const g = (name: string) => [...groupList('sales_document', name)].sort();
  assert.deepEqual(g('committed'), ['invoiced', 'ordered', 'preparing']);
  assert.deepEqual(g('order'), ['delivered', 'invoiced', 'ordered', 'preparing']);
  assert.deepEqual(g('billed'), ['delivered', 'invoiced', 'preparing']);
  assert.deepEqual(g('offered'), ['accepted', 'sent', 'validated']);
  assert.deepEqual(g('awaitingAnswer'), ['sent', 'validated']);
  assert.deepEqual(g('mirrorable'), ['cancelled', 'delivered', 'invoiced', 'ordered']);
  assert.deepEqual(g('closedLost'), ['cancelled', 'rejected']);
});

test('the old exported sets are views of the groups', async () => {
  const { DELIVERABLE_STATUS } = await import('./saleStock.ts');
  const { NOT_PAYABLE_PO_STATUS } = await import('./dealBalance.ts');
  const { RECEIVED_STATUSES } = await import('./receiptGap.ts');
  const { INCOMING_PO_STATUSES } = await import('./inTransit.ts');
  assert.deepEqual([...COMMITTED_STATUSES], [...groupSet('sales_document', 'committed')]);
  assert.deepEqual([...DELIVERABLE_STATUS], [...groupSet('sales_document', 'order')]);
  assert.deepEqual([...NOT_PAYABLE_PO_STATUS], [...groupSet('purchase_order', 'notAnOrder')]);
  assert.deepEqual([...RECEIVED_STATUSES], [...groupSet('purchase_order', 'received')]);
  assert.deepEqual([...INCOMING_PO_STATUSES], [...groupSet('purchase_order', 'open')]);
});

test('the old enum lists name the same states as the lifecycles', () => {
  assert.deepEqual([...ENUMS.purchases_status].sort(), [...stateIds('purchase_order')].sort());
  assert.deepEqual([...ENUMS.price_quotes_status].sort(), [...stateIds('price_quote')].sort());
});

test('group checks never match null or a wrong spelling', () => {
  assert.equal(inGroup('purchase_order', 'void', null), false);
  assert.equal(inGroup('purchase_order', 'void', 'cancelled'), false, 'the stored value is capitalised');
  assert.equal(inGroup('purchase_order', 'void', 'Cancelled'), true);
});

test('a status menu puts the declared moves first and still offers every correction', () => {
  // From Draft the declared path is Confirmed / received / cancelled — Sent is unused, so a correction
  const draft = menuFor('purchase_order', 'Draft');
  assert.ok(draft.next.includes('Confirmed'));
  assert.ok(draft.corrections.includes('Sent'));
  // A fully received PO has no next step: everything is a correction
  assert.deepEqual(menuFor('purchase_order', 'Fully Received').next, []);
  // Nothing is ever taken away: current + next + corrections = every state, once
  for (const id of ['purchase_order', 'price_quote'] as LifecycleId[]) {
    for (const cur of stateIds(id)) {
      const { next, corrections } = menuFor(id, cur);
      assert.deepEqual([cur, ...next, ...corrections].sort(), [...stateIds(id)].sort(), `${id} from ${cur}`);
      for (const n of next) assert.ok(canMove(id, cur, n), `${id}: ${cur} → ${n} is shown as a step but not declared`);
    }
  }
  const deal = readFileSync(join(process.cwd(), 'components/ui/DealLookupTab.tsx'), 'utf8');
  assert.match(deal, /<StatusOptions lifecycle="purchase_order"/);
  assert.match(deal, /<StatusOptions lifecycle="price_quote"/);
});

test('agents are served the groups the screens count with', () => {
  const po = describeLifecycles().find((l) => l.id === 'purchase_order') as { groups?: Record<string, string[]> };
  assert.deepEqual(po.groups?.notAnOrder, groupList('purchase_order', 'notAnOrder'));
});

/**
 * Hand-written lists of statuses that may stay, and why — a COUNT per file.
 * One more fails the build; removing one means lowering the number here.
 */
const HAND_LISTS_ALLOWED: Record<string, number> = {
  // The sales editor's button ladder, in one place, held to the declared
  // moves by "sales editor buttons" above.
  'lib/lifecycles.ts': Infinity,
  // Fulfillment and the delivery list ask "can a delivery order start here"
  // — the `from` of the declared move to `preparing`.
  'components/ui/FulfillmentPanel.tsx': 1,
  'app/delivery/page.tsx': 1,
  // The agent's stock reverse picks the state to fall back to.
  'app/api/agent/sales/stock/route.ts': 1,
  // The ladder ORDER (index comparisons), not a group.
  'lib/salesStatus.ts': 1,
  // The legacy enum lists (price quote, proforma, PO), held equal above.
  'constants/enums.ts': 3,
  // Revise is offered from validated / sent / accepted.
  'app/sales/[id]/page.tsx': 2,
};

test('no file spells a group of statuses out by hand again', () => {
  const families = (['purchase_order', 'price_quote', 'sales_document', 'epc_proposal'] as LifecycleId[])
    .map((id) => new Set(stateIds(id)));
  const counts: Record<string, number> = {};
  for (const dir of ['app', 'components', 'lib', 'hooks', 'constants']) {
    for (const abs of sourceFiles(join(process.cwd(), dir))) {
      const f = abs.replace(process.cwd() + '/', '');
      const src = readFileSync(abs, 'utf8');
      for (const m of src.matchAll(/\[\s*(?:'[^'\n]+'\s*,\s*)+'[^'\n]+'\s*,?\s*\]/g)) {
        const vals = [...m[0].matchAll(/'([^']+)'/g)].map((x) => x[1]);
        if (families.some((fam) => vals.every((v) => fam.has(v)))) counts[f] = (counts[f] ?? 0) + 1;
      }
    }
  }
  const over = Object.entries(counts).filter(([f, n]) => n > (HAND_LISTS_ALLOWED[f] ?? 0));
  assert.deepEqual(over, [],
    'A list of statuses written by hand is how eleven files came to disagree about what a PO is. ' +
    'Ask lib/lifecycles.ts for a group (add one there if none fits) instead.');
  const stale = Object.entries(HAND_LISTS_ALLOWED).filter(([f, n]) => Number.isFinite(n) && (counts[f] ?? 0) < n);
  assert.deepEqual(stale, [], 'a hand-written list was removed — lower its count in HAND_LISTS_ALLOWED');
});

// ── Second pass (2026-11-11) ────────────────────────────────────────────────
test('the database trigger climbs the same sales ladder as the app', () => {
  // stamp_sales_quote stamps SO / INV / DO numbers by position in its own
  // `ladder` array — a second copy of MILESTONE_ORDER, in SQL. If they drift,
  // a status the app calls "past ordered" would stamp no order number.
  const sql = readFileSync(join(process.cwd(), 'migrations/fix_stamp_sales_quote_on_insert.sql'), 'utf8');
  const m = /ladder\s+TEXT\[\]\s*:=\s*ARRAY\[([^\]]*)\]/.exec(sql);
  assert.ok(m, 'stamp_sales_quote no longer declares its ladder — update this test with it');
  const ladder = [...m[1].matchAll(/'([^']+)'/g)].map((x) => x[1]);
  assert.deepEqual(ladder, [...MILESTONE_ORDER]);
});

test('the derived and date-kept lifecycles are declared, with where they are decided', () => {
  for (const id of ['sales_payment', 'sales_delivery'] as LifecycleId[]) {
    const l = lifecycle(id);
    assert.equal(l.storage, 'derived');
    assert.ok(l.enforced.some((e) => e.includes('lib/salesSettlement')), `${id} must name the one place that decides it`);
  }
  for (const id of ['catalogue_item', 'customer', 'support_letter_fee', 'quote_note'] as LifecycleId[]) {
    const l = lifecycle(id);
    assert.equal(l.storage, 'columns');
    assert.equal(l.states.length, 2);
    // Every two-state toggle goes both ways (archive/restore, tick/untick…).
    assert.ok(canMove(id, l.states[0].id, l.states[1].id) && canMove(id, l.states[1].id, l.states[0].id), id);
  }
});
