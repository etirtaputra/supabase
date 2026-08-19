/**
 * Where a sign-in lands — a regression guard for a bug that met a real user.
 *
 * Sign-in used to send EVERYONE to /purchasing. A sell-side admin has no
 * buy-side access, so the very first screen after a perfectly good sign-in was
 * "Access restricted" — an account that worked, reading as a broken one. The
 * rule this pins: no role is ever sent to a page its own permissions bounce.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { homeFor } from '../constants/navigation.ts';
import { ROLE_PERMISSIONS, type UserRole } from '../constants/roles.ts';

const landing = (r: UserRole) => homeFor(ROLE_PERMISSIONS[r]);

test('each role lands where its own permissions let it in', () => {
  assert.equal(landing('sell_admin'), '/sales');      // the reported case
  assert.equal(landing('sales'), '/sales');
  assert.equal(landing('engineer'), '/sales');
  assert.equal(landing('owner'), '/purchasing');
  assert.equal(landing('buy_admin'), '/purchasing');
  assert.equal(landing('data_entry'), '/purchasing');
  assert.equal(landing('finance'), '/purchasing');
  // A single-job role lands ON its job: an empty dashboard reads as broken
  assert.equal(landing('warehouse'), '/stock');
  assert.equal(landing('aftersales'), '/aftersales');
  assert.equal(landing('viewer'), '/');               // the dashboard is the safe floor
  assert.equal(homeFor(null), '/');
});

test('no role can be sent to a screen that would bounce it', () => {
  for (const r of Object.keys(ROLE_PERMISSIONS) as UserRole[]) {
    const p = ROLE_PERMISSIONS[r];
    const to = landing(r);
    // /purchasing turns away anyone with neither buy-side access nor a tab
    if (to === '/purchasing') {
      assert.ok(p.buySide || Object.values(p.tabs).some(Boolean), `${r} would be bounced from /purchasing`);
    }
    // /sales is gated on canEditSalesDocs
    if (to === '/sales') assert.ok(p.canEditSalesDocs, `${r} would be bounced from /sales`);
    if (to === '/stock') assert.ok(p.buySide || p.canManageStock, `${r} would be bounced from /stock`);
    if (to === '/aftersales') assert.ok(p.canHandleService, `${r} would be bounced from /aftersales`);
    // and the dashboard turns nobody away, so '/' always passes
  }
});
