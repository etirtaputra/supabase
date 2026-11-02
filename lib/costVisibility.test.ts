/**
 * Who may see COST — the owner's call, 2026-11-02:
 *
 *   "Ade shouldn't see costs, she will only make quotes and select the unit
 *    price using which tier."
 *
 * sell_admin (Ade, and MAX the sales agent) runs quotes, customers, invoices
 * and receipts. Money (AR) is hers; cost is not. Before this, two doors were
 * open: the Selling Prices screen (canManagePricing — cost, margin per tier,
 * floor audit) and the below_cost signal in "Needs you today", whose text
 * reads "Sells at X but landed cost is Y". Verified on production after the
 * change by impersonating her: 0 below_cost rows (4 before), owner still 4.
 *
 * The quotation screen needed nothing: tier prices auto-fill per customer,
 * every tier's price sits in the unit-price popover, and GP is owner-only
 * (canViewEconomics) with the cost column not even fetched.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { ROLE_PERMISSIONS, type UserRole } from '../constants/roles.ts';
import { canOpenPath } from '../constants/navigation.ts';
import { visibleKinds } from './agentApi.ts';

const NO_COST: UserRole[] = ['sell_admin', 'sales'];

test('sell-side roles never manage pricing or see economics', () => {
  for (const r of NO_COST) {
    assert.equal(ROLE_PERMISSIONS[r].canManagePricing, false, `${r} would see cost and margin on Selling Prices`);
    assert.equal(ROLE_PERMISSIONS[r].canViewEconomics, false, `${r} would see GP`);
    assert.equal(canOpenPath(ROLE_PERMISSIONS[r], '/pricing'), false, `${r} can open Selling Prices`);
    assert.ok(!visibleKinds(r).includes('below_cost'), `${r} sees below_cost, which prints the landed cost`);
  }
});

test('…but they still quote at the tier prices', () => {
  for (const r of NO_COST) {
    assert.equal(ROLE_PERMISSIONS[r].canEditSalesDocs, true, `${r} must still make quotes`);
    assert.equal(ROLE_PERMISSIONS[r].canViewSellingPrice, true, `${r} must see the tier prices`);
  }
  // The quote editor offers every tier's price and keeps GP to economics roles.
  const src = readFileSync(join(process.cwd(), 'app/sales/[id]/page.tsx'), 'utf8');
  assert.match(src, /function tierOptionsFor\(/);
  assert.match(src, /const canGP = !!profile && ROLE_PERMISSIONS\[profile\.role\]\.canViewEconomics/);
  assert.match(src, /select\(canGP \? 'component_id, qty_on_hand, avg_cost_idr' : 'component_id, qty_on_hand'\)/,
    'the landed cost is never fetched for a role without GP');
});

test('the below_cost signal is gated on buy-side read in the database too', () => {
  const sql = readFileSync(join(process.cwd(), 'migrations/below_cost_cost_roles_only.sql'), 'utf8');
  const branch = sql.slice(sql.indexOf("'below_cost'::text AS kind"), sql.indexOf("'stock_short'::text AS kind"));
  assert.match(branch, /WHERE can_read_buy_side\(\) AND c\.archived_at IS NULL/);
  assert.ok(!/can_see_money\(\)/.test(branch), 'money is not cost: can_see_money() includes sell_admin');
  assert.match(sql, /WITH \(security_invoker = true\)/, 'the view must keep applying the base tables’ RLS');
});
