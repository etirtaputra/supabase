/**
 * dropdownPool — browsing is a suggestion, searching is a question.
 *
 * The tests that matter are the ones proving the scope never hides anything
 * from someone who types: a supplier scope that swallowed a typed PI number
 * would be worse than no scope at all.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { dropdownPool, BROWSE_LIMIT } from './dropdownPool.ts';

const OPTS = { labelKey: '_label', subLabelKey: '_sub' };
const rows = [
  { _label: 'PI-001', _sub: 'Acme · 2026-01-02', supplier_id: 'a' },
  { _label: 'PI-002', _sub: 'Acme · 2026-02-02', supplier_id: 'a' },
  { _label: 'PI-003', _sub: 'Bolt · 2026-03-02', supplier_id: 'b' },
  { _label: 'PI-004', _sub: 'Cog · 2026-04-02',  supplier_id: '' },
];

test('browsing unscoped shows everything', () => {
  const p = dropdownPool(rows, { search: '', ...OPTS });
  assert.equal(p.items.length, 4);
  assert.equal(p.scoped, false);
  assert.equal(p.total, 4);
});

test('browsing scoped shows only the scope', () => {
  const p = dropdownPool(rows, { search: '', ...OPTS, browseKey: 'supplier_id', browseValue: 'a' });
  assert.deepEqual(p.items.map((r) => r._label), ['PI-001', 'PI-002']);
  assert.equal(p.scoped, true);
  assert.equal(p.poolSize, 2);
  assert.equal(p.total, 4);   // "type to search all 4"
});

test('searching ignores the scope entirely', () => {
  // The whole promise: a supplier scope must never hide a typed reference.
  const p = dropdownPool(rows, { search: 'PI-003', ...OPTS, browseKey: 'supplier_id', browseValue: 'a' });
  assert.deepEqual(p.items.map((r) => r._label), ['PI-003']);
  assert.equal(p.scoped, false);
});

test('search reads the sub-label too', () => {
  const p = dropdownPool(rows, { search: 'bolt', ...OPTS });
  assert.deepEqual(p.items.map((r) => r._label), ['PI-003']);
});

test('an empty scope value is no scope', () => {
  for (const v of ['', null, undefined]) {
    const p = dropdownPool(rows, { search: '', ...OPTS, browseKey: 'supplier_id', browseValue: v });
    assert.equal(p.scoped, false, String(v));
    assert.equal(p.items.length, 4);
  }
});

test('a scope nothing matches comes back empty, not full', () => {
  // Reported honestly as "nothing for this supplier" rather than quietly
  // widening — the person still has the search box.
  const p = dropdownPool(rows, { search: '', ...OPTS, browseKey: 'supplier_id', browseValue: 'zz' });
  assert.equal(p.items.length, 0);
  assert.equal(p.scoped, true);
  assert.equal(p.total, 4);
});

test('an option with no scope key is never in a scoped browse', () => {
  const p = dropdownPool(rows, { search: '', ...OPTS, browseKey: 'supplier_id', browseValue: 'b' });
  assert.deepEqual(p.items.map((r) => r._label), ['PI-003']);
});

test('browsing is capped, searching is not', () => {
  const many = Array.from({ length: BROWSE_LIMIT + 20 }, (_, i) => ({
    _label: `PI-${i}`, _sub: 'Acme', supplier_id: 'a',
  }));
  const browse = dropdownPool(many, { search: '', ...OPTS });
  assert.equal(browse.items.length, BROWSE_LIMIT);
  assert.equal(browse.truncated, true);
  assert.equal(browse.poolSize, BROWSE_LIMIT + 20);

  const search = dropdownPool(many, { search: 'acme', ...OPTS });
  assert.equal(search.items.length, BROWSE_LIMIT + 20);
  assert.equal(search.truncated, false);
});

test('the cap applies to the scoped pool, not the whole list', () => {
  const many = [
    ...Array.from({ length: BROWSE_LIMIT + 20 }, (_, i) => ({ _label: `X-${i}`, _sub: '', supplier_id: 'b' })),
    ...Array.from({ length: 3 }, (_, i) => ({ _label: `A-${i}`, _sub: '', supplier_id: 'a' })),
  ];
  const p = dropdownPool(many, { search: '', ...OPTS, browseKey: 'supplier_id', browseValue: 'a' });
  assert.equal(p.items.length, 3);
  assert.equal(p.truncated, false);
  assert.equal(p.poolSize, 3);
});
