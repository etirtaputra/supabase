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
} from './lifecycles.ts';
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
  ];
  for (const [id, file, name] of cases) assert.deepEqual(checkList(file, name).sort(), stateIds(id).sort(), `${id} vs ${name}`);
  // The older tables carried their CHECK from the start.
  for (const [id, file] of [['aftersales_case', 'create_aftersales.sql'], ['support_letter', 'create_support_letters.sql'], ['serial_number', 'serial_numbers.sql']] as [LifecycleId, string][]) {
    const sql = readFileSync(join(process.cwd(), 'migrations', file), 'utf8');
    for (const s of stateIds(id)) assert.ok(sql.includes(`'${s}'`), `${id}: ${s} is not in ${file}'s CHECK`);
  }
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
