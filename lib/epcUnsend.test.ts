/**
 * A Project Engineer may pull a SENT proposal back to draft — and may do
 * nothing else to it.
 *
 * OWNER, 2026-09-20: *"give project engineer role in icaproc the ability to
 * revert 'sent' epc proposals back to draft"*.
 *
 * The easy version of this change is much wider than the ask, in three ways
 * that would all have been invisible in review:
 *
 *   1. **`can_edit_quote()` governs ALL commands.** Widening it to let
 *      engineers past the sent check would have handed them DELETE of a sent
 *      proposal at the same time. So the existing policy is untouched and a
 *      new UPDATE-ONLY policy adds the single transition.
 *   2. **`isOwner` in the editor also gates the raw pre-buffer COST figures.**
 *      Folding the engineer into it would have leaked supplier costs as a side
 *      effect of a status permission. Hence a separate `canUnsend`.
 *   3. **Un-send is not edit.** The content stays locked; only the status
 *      control is live, and the database refuses anything else regardless of
 *      what the UI allows.
 *
 * Verified against production by impersonation (rolled back, 2026-09-20):
 * engineer sent→draft ALLOWED · sent→accepted blocked · un-send carrying a
 * content edit blocked · DELETE of a sent proposal blocked · editing a sent
 * proposal's content blocked.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const read = (p: string) => readFileSync(join(process.cwd(), p), 'utf8');
const SQL = read('migrations/epc_engineer_unsend.sql');
const UI = read('app/proposals/[id]/page.tsx');
const SQL_CODE = SQL.split('\n').map((l) => l.replace(/--.*$/, '')).join('\n');

test('the new policy is UPDATE-only, so delete stays where it was', () => {
  // `quotes write` (FOR ALL, can_edit_quote) governs INSERT and DELETE. If this
  // policy ever becomes FOR ALL, an engineer can delete a sent proposal.
  assert.match(SQL_CODE, /CREATE POLICY "quotes unsend"[\s\S]*?FOR UPDATE TO authenticated/);
  assert.ok(!/DROP POLICY IF EXISTS "quotes write"/.test(SQL_CODE),
    'the existing write policy must not be replaced — it is what still blocks DELETE');
  assert.ok(!/CREATE OR REPLACE FUNCTION public\.can_edit_quote/.test(SQL_CODE),
    'can_edit_quote() governs ALL commands; widening it would grant delete too');
});

test('the transition is pinned at both ends: from sent, to draft', () => {
  assert.match(SQL_CODE, /USING \(status = 'sent' AND public\.can_unsend_quote\(\)\)/);
  assert.match(SQL_CODE, /WITH CHECK \(status = 'draft' AND public\.can_unsend_quote\(\)\)/);
});

test('only owner and engineer may un-send', () => {
  assert.match(SQL_CODE, /can_unsend_quote[\s\S]*?role IN \('owner', 'engineer'\)/);
  for (const other of ['sales', 'sell_admin', 'warehouse', 'viewer', 'aftersales']) {
    assert.ok(!new RegExp(`can_unsend_quote[\\s\\S]*?'${other}'`).test(SQL_CODE),
      `${other} must not be able to un-send`);
  }
});

test('the guard holds a non-owner to the status column alone', () => {
  // Column-agnostic comparison: a business field added to this table next year
  // is protected the day it is added, with nobody having to remember this file.
  assert.match(SQL_CODE, /to_jsonb\(NEW\) - skip\) IS DISTINCT FROM \(to_jsonb\(OLD\) - skip\)/);
  assert.match(SQL_CODE, /skip\s+text\[\] := ARRAY\['status', 'sent_at', 'updated_at', 'updated_by_email'\]/,
    'only the status-lifecycle and audit columns may differ');
  // An owner editing a sent proposal is a long-standing power, left alone.
  assert.match(SQL_CODE, /IF is_owner THEN\s*RETURN NEW;/);
});

test('the guard runs BEFORE the activity log, so a refusal is never logged', () => {
  // Postgres fires BEFORE triggers in name order and `g` < `l`.
  assert.match(SQL_CODE, /CREATE TRIGGER guard_quote_unsend_trigger\s*\n?\s*BEFORE UPDATE ON public\."10\.0_project_quotes"/);
});

test('canUnsend is SEPARATE from isOwner — the cost figures stay owner-only', () => {
  // `isOwner` also gates the raw pre-buffer unit cost in the cost-history
  // popover. Widening it would have leaked supplier costs.
  assert.match(UI, /const canUnsend = isOwner \|\| gate\.profile\?\.role === 'engineer'/);
  assert.match(UI, /const isOwner = gate\.profile\?\.role === 'owner'/,
    'isOwner must keep its narrow meaning');
  assert.match(UI, /\{isOwner && h\.buffered && h\.rawUnitCost != null &&/,
    'the raw cost disclosure must still key on isOwner alone');
});

test('a sent proposal stays content-locked for the engineer', () => {
  // `locked` is what disables every content input. It must NOT learn about
  // canUnsend, or "revert" quietly becomes "edit".
  assert.match(UI, /const locked = savedStatus === 'sent' && !isOwner;/);
  assert.match(UI, /const unsendOnly = locked && canUnsend;/);
});

test('the status control offers only the move the engineer actually has', () => {
  // A control that promises sent → accepted and is then refused by the database
  // teaches people the app is unreliable.
  assert.match(UI, /\(unsendOnly \? \(\['sent', 'draft'\] as const\) : STATUS_OPTS\)/);
  assert.match(UI, /disabled=\{locked && !unsendOnly\}/);
});

test('the deliberate un-send is not eaten by the stale-tab guard', () => {
  // This guard once ate the owner's own un-send (field report 2026-07-31). It
  // would have eaten the engineer's for the same reason.
  assert.match(UI, /if \(unSending && statusTouchedRef\.current && !canUnsend\)/);
});

test('the header save is an UPDATE — an upsert is judged by the INSERT policy', () => {
  // This is what broke the first attempt in the field. PostgREST's `.upsert()`
  // is `INSERT … ON CONFLICT`, so Postgres applies the INSERT policy's WITH
  // CHECK — `can_edit_quote()`, FALSE for an engineer on a SENT quote — and the
  // UPDATE-only un-send policy is never consulted. The row always exists (New
  // Proposal inserts it), so the INSERT half was only ever a liability.
  assert.ok(!/from\('10\.0_project_quotes'\)\s*\.?\s*\n?\s*\.upsert\(/.test(UI),
    "the quote header must be written with .update(); .upsert() is INSERT … ON CONFLICT and is refused by the INSERT policy");
  assert.match(UI, /\.update\(headerPatch\)\.eq\('quote_id', quoteNow\.quote_id\)\.select\('quote_id'\)/);
});

test('a header write the policy filters out is reported, not swallowed', () => {
  // An UPDATE blocked by a USING clause is 0 rows and HTTP 200 — no error. Left
  // unchecked, the editor would say "Saved" for a change that never landed.
  assert.match(UI, /if \(!wrote\?\.length\) \{\s*\n\s*throw new Error\('Not saved/);
});
