/**
 * Every table or view a migration creates must GRANT its own access.
 *
 * Supabase, from 2026-10-30: a table created in `public` no longer gets the
 * automatic grants to `anon`, `authenticated` and `service_role`. Without a
 * GRANT the Data API (supabase-js — every screen, every /api/agent route)
 * answers "permission denied" (42501). The 59 tables that already exist keep
 * the grants they have; only NEW objects are affected.
 *
 * So a migration that creates one also says who may reach it:
 *
 *   GRANT SELECT, INSERT, UPDATE, DELETE ON public."31.0_example" TO authenticated;
 *   GRANT SELECT, INSERT, UPDATE, DELETE ON public."31.0_example" TO service_role;
 *
 * Row Level Security still decides WHICH rows; the grant only opens the door.
 * A view needs SELECT for both. `anon` is NOT required and should normally get
 * nothing: every ICAPROC screen is behind a login, and a grant to `anon` hands
 * the table to anyone holding the public key — only grant it to an object a
 * page reads before sign-in, and say why in the migration.
 *
 * The files listed in GRANDFATHERED were applied while the automatic grants
 * still existed; they are not re-checked. Do not add to that list.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const DIR = join(process.cwd(), 'migrations');

const GRANDFATHERED = new Set([
  '003_materialized_view_setup.sql', 'add_cost_basis.sql', 'add_customer_referral_links.sql', 'agent_attention.sql',
  'bank_accounts_defaults_and_library.sql', 'buy_side_read_gate.sql', 'create_aftersales.sql', 'create_bank_accounts.sql',
  'create_bom_calcs.sql', 'create_competitor_prices.sql', 'create_component_history.sql', 'create_component_links.sql',
  'create_crm_customers.sql', 'create_customer_receipts.sql', 'create_exchange_rate_history.sql', 'create_goods_receipts.sql',
  'create_margin_profiles.sql', 'create_pricing_tiers.sql', 'create_quote_notes.sql', 'create_sales_activity_log.sql',
  'create_sales_and_inventory.sql', 'create_sales_description_library.sql', 'create_settings.sql', 'create_split_fulfillment.sql',
  'create_support_letters.sql', 'create_user_profiles.sql', 'create_warehouses.sql', 'import_export_traceability.sql',
  'item_price_history.sql', 'landed_true_up_queue.sql', 'merge_costs_part2_safe.sql', 'merge_pi_and_costs.sql',
  'migrate_history_to_formal_tables.sql', 'recreate_cost_views.sql', 'serial_numbers.sql', 'usage_analytics.sql',
]);

/** `public."20.2_customer_links"` / `"20.2_customer_links"` / `app_settings` → one key. */
const norm = (raw: string) => {
  const s = raw.trim().replace(/^public\./i, '');
  return s.startsWith('"') ? s.replace(/"/g, '') : s.toLowerCase();
};

const stripComments = (sql: string) => sql.replace(/\/\*[\s\S]*?\*\//g, '').replace(/--.*$/gm, '');

/** What a migration creates in public, and which grants it is missing. */
function missingGrants(sqlRaw: string): string[] {
  const sql = stripComments(sqlRaw);
  const created: { name: string; view: boolean }[] = [];
  const createRe = /create\s+(?:or\s+replace\s+)?(?:(temp|temporary)\s+)?(?:(materialized)\s+)?(table|view)\s+(?:if\s+not\s+exists\s+)?((?:public\.)?(?:"[^"]+"|[\w.]+))/gi;
  for (const m of sql.matchAll(createRe)) {
    if (m[1]) continue;                                   // a temp table is not exposed
    if (/^(?!public\.)\w+\./i.test(m[4]) && !m[4].startsWith('"')) continue; // another schema
    created.push({ name: norm(m[4]), view: m[3].toLowerCase() === 'view' });
  }
  // role → object → privileges
  const granted = new Map<string, Map<string, Set<string>>>();
  const grantRe = /grant\s+([\w\s,]+?)\s+on\s+(?:table\s+)?([\s\S]+?)\s+to\s+([\w\s,]+?)\s*;/gi;
  for (const m of sql.matchAll(grantRe)) {
    const privs = m[1].split(',').map((p) => p.trim().toLowerCase().replace(/\s+privileges$/, ''));
    const objs = m[2].split(',').map(norm);
    for (const role of m[3].split(',').map((r) => r.trim().toLowerCase())) {
      const byObj = granted.get(role) ?? granted.set(role, new Map()).get(role)!;
      for (const o of objs) {
        const set = byObj.get(o) ?? byObj.set(o, new Set()).get(o)!;
        privs.forEach((p) => set.add(p));
      }
    }
  }
  const has = (role: string, obj: string, priv: string) => {
    const set = granted.get(role)?.get(obj);
    return !!set && (set.has('all') || set.has(priv));
  };
  const out: string[] = [];
  for (const { name, view } of created) {
    const need: [string, string[]][] = view
      ? [['authenticated', ['select']], ['service_role', ['select']]]
      : [['authenticated', ['select']], ['service_role', ['select', 'insert', 'update', 'delete']]];
    for (const [role, privs] of need) {
      const lacking = privs.filter((p) => !has(role, name, p));
      if (lacking.length) out.push(`${name}: ${lacking.join(', ')} to ${role}`);
    }
  }
  return out;
}

test('the checker: a new table with its grants passes, one without them fails', () => {
  const good = `CREATE TABLE IF NOT EXISTS public."31.0_example" (id uuid primary key);
    ALTER TABLE public."31.0_example" ENABLE ROW LEVEL SECURITY;
    GRANT SELECT, INSERT, UPDATE, DELETE ON public."31.0_example" TO authenticated;
    GRANT ALL ON TABLE "31.0_example" TO service_role;`;
  assert.deepEqual(missingGrants(good), []);
  const bad = `CREATE TABLE "31.0_example" (id uuid); -- GRANT SELECT ON "31.0_example" TO authenticated;`;
  assert.deepEqual(missingGrants(bad), ['31.0_example: select to authenticated', '31.0_example: select, insert, update, delete to service_role'],
    'a grant inside a comment is not a grant');
  const view = `CREATE OR REPLACE VIEW public.v_example AS SELECT 1;
    GRANT SELECT ON public.v_example, public.v_other TO authenticated, service_role;`;
  assert.deepEqual(missingGrants(view), []);
  assert.deepEqual(missingGrants('CREATE TEMP TABLE scratch (x int);'), []);
});

test('every migration that creates a table or view grants access to it (Supabase, 2026-10-30)', () => {
  const problems: string[] = [];
  for (const f of readdirSync(DIR).filter((n) => n.endsWith('.sql')).sort()) {
    if (GRANDFATHERED.has(f)) continue;
    for (const p of missingGrants(readFileSync(join(DIR, f), 'utf8'))) problems.push(`${f} — ${p}`);
  }
  assert.deepEqual(problems, [],
    'add the GRANT statements in the same migration (see the head of lib/migrationGrants.test.ts); without them the app gets "permission denied"');
});

test('the grandfathered list only shrinks', () => {
  // Every name on it must still be a file: a renamed migration would otherwise
  // slip past the check under its new name with a stale entry left behind.
  const files = new Set(readdirSync(DIR));
  assert.deepEqual([...GRANDFATHERED].filter((f) => !files.has(f)), []);
  assert.ok(GRANDFATHERED.size <= 36, 'nothing is added to the grandfathered list');
});
