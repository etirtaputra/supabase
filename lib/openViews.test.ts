/**
 * The buy-side read gate, kept honest from the application side.
 *
 * Supplier identities and unit costs were readable by every signed-in account
 * until 2026-09-16 — `authenticated read USING (true)` on five tables, with the
 * buy/sell separation enforced on writes and, for reads, only in React. The
 * database now gates them (`can_read_buy_side()`), and four column-limited
 * views carry the ids, quantities and dates the sell side legitimately needs.
 *
 * TWO WAYS THAT ARRANGEMENT ROTS, and this file is aimed at both:
 *
 *   1. Someone adds a cost column to a view. It is one word, it makes a screen
 *      work, and it silently grants that column to every signed-in account —
 *      including, once the Shop mints customer logins, people who are not
 *      staff. The views' column lists ARE the security boundary.
 *   2. Someone points a sell-side screen back at a base table. It works fine
 *      for whoever writes it (they are usually the owner) and returns empty for
 *      a salesperson, which reads as a broken feature rather than a refusal —
 *      and the quickest way to "fix" a broken feature is to reopen the table.
 *
 * Neither shows up in review as a security change, which is exactly why they
 * are asserted instead of remembered.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  V_PO_SCHEDULE, V_PO_LINE_QTY, V_QUOTE_LEAD_TIME, V_QUOTE_LINE_LINK,
  OPEN_VIEW_COLUMNS, BUY_SIDE_TABLES,
} from '../constants/openViews.ts';

const ROOT = process.cwd();
const read = (p: string) => readFileSync(join(ROOT, p), 'utf8');

/** Anything that names money, a price, or a buy-side document reference. */
const FORBIDDEN = /cost|price|total|value|amount|po_number|pi_number|currency|exchange/i;

test('no open view carries a cost, a price, or a document number', () => {
  for (const [view, cols] of Object.entries(OPEN_VIEW_COLUMNS)) {
    for (const c of cols) {
      assert.ok(!FORBIDDEN.test(c),
        `${view}.${c} — an open view is readable by EVERY signed-in account. ` +
        'If a sell-side screen needs this, that is a conversation, not a widening.');
    }
  }
});

test('the four views are the only ones, and each has its constant', () => {
  assert.deepEqual(Object.keys(OPEN_VIEW_COLUMNS).sort(),
    [V_PO_LINE_QTY, V_PO_SCHEDULE, V_QUOTE_LEAD_TIME, V_QUOTE_LINE_LINK].sort());
});

test('the migration and the constants agree on every column', () => {
  // The constants file is what the app reads and what the test above checks;
  // the migration is what the database actually has. A drift between them means
  // one of these tests is guarding a view that does not exist in that shape.
  const sql = read('migrations/buy_side_read_gate.sql');
  for (const [view, cols] of Object.entries(OPEN_VIEW_COLUMNS)) {
    const m = sql.match(new RegExp(`CREATE OR REPLACE VIEW public\\.${view}[\\s\\S]*?FROM public`));
    assert.ok(m, `${view} is not created in the migration`);
    for (const c of cols) assert.ok(m![0].includes(c), `${view} is missing ${c} in the migration`);
    // And nothing extra: a column in the SQL that the constants do not list
    // would escape the forbidden-column check above entirely.
    const selected = m![0].split('SELECT')[1].split('FROM')[0]
      .split(',').map((s) => s.trim()).filter(Boolean);
    assert.deepEqual(selected.sort(), [...cols].sort(), `${view}: SQL and constants disagree`);
  }
});

test('the migration gates every buy-side table, and adds viewer to the read role', () => {
  const sql = read('migrations/buy_side_read_gate.sql');
  for (const t of BUY_SIDE_TABLES) {
    assert.match(sql, new RegExp(`CREATE POLICY "buy side read" ON public\\."${t}"`),
      `${t} must be closed by the migration`);
  }
  // The read predicate is NOT the write predicate: `viewer` is read-only Deal
  // Lookup access with buySide:false, and would open an empty page without it.
  assert.match(sql, /can_read_buy_side[\s\S]*?'viewer'/,
    'can_read_buy_side() must include viewer');
});

test('sell-reachable screens read the views, never the line-item tables', () => {
  // These five are reachable by sales / sell_admin / engineer / warehouse. None
  // of them needs a cost, and the audit confirmed none ever read one.
  const files = [
    'app/products/page.tsx', 'app/sales/[id]/page.tsx',
    'hooks/useItemScores.ts', 'lib/catalogSignals.ts', 'lib/reorder.ts',
  ];
  for (const f of files) {
    const src = read(f);
    for (const t of ['5.1_purchase_line_items', '4.1_price_quote_line_items', '2.0_suppliers']) {
      assert.ok(!src.includes(`from('${t}')`),
        `${f} reads ${t} directly — a salesperson gets an empty result, which looks like a bug and invites reopening the table.`);
    }
  }
});

test('the three readers that may see money choose the relation by role', () => {
  // `5.0_purchases` carries po_number and total_value, so these read the TABLE
  // for buy-side eyes and the VIEW for everyone else. The ternary is the gate:
  // without it the column list alone decides, and a column list is easy to
  // widen by accident.
  for (const [f, flag] of [
    ['app/products/page.tsx', 'canSeePo'],
    ['lib/catalogSignals.ts', 'opts.buySide'],
    ['lib/inTransit.ts', 'opts.buySide'],
  ] as const) {
    assert.match(read(f), new RegExp(`from\\(${flag.replace('.', '\\.')} \\? '5\\.0_purchases' : V_PO_SCHEDULE\\)`),
      `${f} must pick the table or the view by role`);
  }
});

test('fetchInTransit defaults to buy-side, so a caller must opt OUT knowingly', () => {
  // Defaulting the other way would silently strip money from every existing
  // buy-side caller the day this shipped — a quiet wrong answer beats nothing,
  // and this way a forgotten call site stays correct for the owner and only the
  // deliberate sell-side one narrows.
  assert.match(read('lib/inTransit.ts'), /opts: \{ buySide: boolean \} = \{ buySide: true \}/);
  assert.match(read('app/stock/page.tsx'), /fetchInTransit\(supabase, undefined, \{ buySide: canView \}\)/);
});
