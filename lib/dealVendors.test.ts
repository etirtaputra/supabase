/**
 * dealVendors — Deal Lookup's vendor sections.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { groupByVendor, NO_VENDOR } from './dealVendors.ts';

const D = (key: string, supplierId: string | null, name: string, latestDate: string) =>
  ({ key, supplierId, supplier: supplierId ? { supplier_name: name, supplier_code: name.slice(0, 5).toUpperCase() } : null, latestDate });

test('one section per vendor, newest deal first inside; vendors by their newest deal', () => {
  const s = groupByVendor([
    D('a', 'kstar', 'Kstar', '2026-09-07'),
    D('b', 'chinaland', 'Chinaland', '2026-10-01'),
    D('c', 'kstar', 'Kstar', '2026-10-23'),
    D('d', 'kstar', 'Kstar', '2026-10-13'),
    D('e', 'mbs', 'MBS', '2026-08-01'),
  ]);
  assert.deepEqual(s.map((x) => x.name), ['Kstar', 'Chinaland', 'MBS']);
  assert.deepEqual(s[0].deals.map((d) => d.key), ['c', 'd', 'a']);
  assert.equal(s[0].latestDate, '2026-10-23');
});

test('a deal with no supplier sits in its own last section', () => {
  const s = groupByVendor([D('x', null, '', '2026-10-24'), D('y', 'mbs', 'MBS', '2026-01-01')]);
  assert.deepEqual(s.map((x) => x.key), ['mbs', NO_VENDOR]);
});
