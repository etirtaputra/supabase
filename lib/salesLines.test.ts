/**
 * The sales-order line write plan.
 *
 * These cases are the failure that prompted the file: a save that re-mints
 * item_ids severs `so_item_id` on every delivery-order and invoice line
 * derived from the order, and a second tab's save deletes the first tab's
 * work. Both are identity problems, so identity is what is asserted here.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { planLineWrite, dbItemId } from './salesLines.ts';

/** Deterministic id minting, so a plan can be asserted exactly. */
const minter = () => { let n = 0; return () => `mint-${++n}`; };

test('dbItemId reads identity out of a row key', () => {
  assert.equal(dbItemId('db-abc'), 'abc');
  assert.equal(dbItemId('new-1724-0.5'), null);
  assert.equal(dbItemId('db-'), null, 'an empty id is not an id');
});

test('an existing row KEEPS its item_id — this is what the FKs hang on', () => {
  const p = planLineWrite(['db-aaa', 'db-bbb'], ['aaa', 'bbb'], minter());
  assert.deepEqual(p.assign, [{ key: 'db-aaa', itemId: 'aaa' }, { key: 'db-bbb', itemId: 'bbb' }]);
  assert.deepEqual(p.gone, [], 'nothing was removed, so nothing may be deleted');
  assert.deepEqual(p.rekey, {}, 'and no existing row is re-keyed');
});

test('editing every field still deletes nothing — the old code deleted all of them', () => {
  // The keys are what carry identity; the field values never reach this plan.
  const p = planLineWrite(['db-aaa', 'db-bbb', 'db-ccc'], ['aaa', 'bbb', 'ccc'], minter());
  assert.deepEqual(p.gone, []);
  assert.equal(p.assign.length, 3);
});

test('a new row is given an id up front, and reported so the tab can re-key it', () => {
  const p = planLineWrite(['db-aaa', 'new-1'], ['aaa'], minter());
  assert.deepEqual(p.assign, [{ key: 'db-aaa', itemId: 'aaa' }, { key: 'new-1', itemId: 'mint-1' }]);
  assert.deepEqual(p.rekey, { 'new-1': 'mint-1' },
    'without this the next save inserts a SECOND copy of the same line');
  assert.deepEqual(p.gone, []);
});

test('a removed row is deleted — by id, not by wiping the quote', () => {
  const p = planLineWrite(['db-aaa'], ['aaa', 'bbb'], minter());
  assert.deepEqual(p.assign, [{ key: 'db-aaa', itemId: 'aaa' }]);
  assert.deepEqual(p.gone, ['bbb']);
});

test("a row THIS TAB never saw is never deleted — a colleague's line survives", () => {
  // Tab A loaded rows aaa+bbb. Tab B has since added ccc. Tab A saves.
  const p = planLineWrite(['db-aaa', 'db-bbb'], ['aaa', 'bbb'], minter());
  assert.deepEqual(p.gone, [], 'ccc is not in `known`, so it is not collateral');
  assert.ok(!p.assign.some((a) => a.itemId === 'ccc'));
});

test('reordering rows changes order, not identity', () => {
  const p = planLineWrite(['db-ccc', 'db-aaa', 'db-bbb'], ['aaa', 'bbb', 'ccc'], minter());
  assert.deepEqual(p.assign.map((a) => a.itemId), ['ccc', 'aaa', 'bbb']);
  assert.deepEqual(p.gone, [], 'a reorder must never delete a row');
});

test('a repeated key is collapsed — Postgres refuses to touch one row twice', () => {
  // ON CONFLICT DO UPDATE cannot affect the same row twice in one statement;
  // it fails the WHOLE save, so the plan must not emit a duplicate.
  const p = planLineWrite(['db-aaa', 'db-aaa'], ['aaa'], minter());
  assert.equal(p.assign.length, 1);
  assert.deepEqual(p.gone, []);
});

test('emptying a quote deletes its rows but writes nothing', () => {
  const p = planLineWrite([], ['aaa', 'bbb'], minter());
  assert.deepEqual(p.assign, []);
  assert.deepEqual(p.gone.sort(), ['aaa', 'bbb']);
});

test('a brand-new quote mints ids and has nothing to delete', () => {
  const p = planLineWrite(['new-1', 'new-2'], [], minter());
  assert.deepEqual(p.assign.map((a) => a.itemId), ['mint-1', 'mint-2']);
  assert.deepEqual(p.gone, []);
  assert.deepEqual(p.rekey, { 'new-1': 'mint-1', 'new-2': 'mint-2' });
});

test('the plan never deletes an id it is also writing', () => {
  // The invariant that actually protects the foreign keys: if a save both
  // wrote and deleted a row, ON DELETE SET NULL would still fire.
  const cases: [string[], string[]][] = [
    [['db-a', 'db-b'], ['a', 'b']],
    [['db-a', 'new-1'], ['a', 'b']],
    [[], ['a']],
    [['db-a', 'db-a'], ['a']],
  ];
  for (const [keys, known] of cases) {
    const p = planLineWrite(keys, known, minter());
    const written = new Set(p.assign.map((a) => a.itemId));
    for (const g of p.gone) assert.ok(!written.has(g), `${g} was both written and deleted`);
  }
});
