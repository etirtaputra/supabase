/**
 * Paging past the API row cap.
 *
 * The case that matters is the one the seven hand-copied loops get wrong: a
 * server cap LOWER than the page size the caller asked for. Those loops read
 * "fewer rows than I asked for" as "that was the last page" and stop, which is
 * the exact silent truncation they were written to prevent.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fetchAllRows } from './fetchAllRows.ts';

/** A fake table of `total` rows whose server refuses to return more than `cap`. */
const server = (total: number, cap = 1000) => {
  const calls: [number, number][] = [];
  const page = async (from: number, to: number) => {
    calls.push([from, to]);
    const want = Math.min(to - from + 1, cap);
    const rows = [];
    for (let i = from; i < Math.min(from + want, total); i++) rows.push({ id: i });
    return { data: rows, error: null };
  };
  return { page, calls };
};

test('reads a table that fits in one page', async () => {
  const s = server(42);
  const r = await fetchAllRows<{ id: number }>(s.page);
  assert.equal(r.rows.length, 42);
  assert.equal(r.truncated, false);
  assert.equal(r.error, null);
});

test('reads PAST the cap — the whole point', async () => {
  // 1,040 rows against a 1,000 cap: exactly 10.2_quote_items on 2026-08-28.
  const s = server(1040, 1000);
  const r = await fetchAllRows<{ id: number }>(s.page);
  assert.equal(r.rows.length, 1040, 'all 1,040 rows, not the first 1,000');
  assert.deepEqual(r.rows.map((x) => x.id).slice(-2), [1038, 1039], 'and in order');
  assert.equal(r.truncated, false);
});

test('a page boundary landing exactly on the total is not an early stop', async () => {
  const s = server(2000, 1000);
  const r = await fetchAllRows<{ id: number }>(s.page);
  assert.equal(r.rows.length, 2000);
  assert.equal(r.truncated, false);
});

test('a server cap SMALLER than the page size does not truncate', async () => {
  // This is what the copied `if (page.length < PAGE) break;` loops get wrong:
  // asked for 1000, served 500, concluded "end of table" at row 500.
  const s = server(1200, 500);
  const r = await fetchAllRows<{ id: number }>(s.page, 1000);
  assert.equal(r.rows.length, 1200, 'advancing by rows RETURNED, not by page size');
  assert.equal(r.truncated, false);
});

test('an empty table reads as empty, not as an error', async () => {
  const s = server(0);
  const r = await fetchAllRows<{ id: number }>(s.page);
  assert.deepEqual(r.rows, []);
  assert.equal(r.truncated, false);
  assert.equal(r.error, null);
});

test('an error stops the read and is reported — never silently partial', async () => {
  let n = 0;
  const page = async () => (++n === 1
    ? { data: [{ id: 1 }], error: null }
    : { data: null, error: { message: 'connection reset' } });
  const r = await fetchAllRows<{ id: number }>(page, 1);
  assert.equal(r.error, 'connection reset');
  assert.equal(r.truncated, true, 'a caller must be able to tell this apart from a complete read');
});

test('the page ceiling reports truncated rather than looping forever', async () => {
  const s = server(10_000, 10);
  const r = await fetchAllRows<{ id: number }>(s.page, 10, 3);
  assert.equal(r.rows.length, 30);
  assert.equal(r.truncated, true);
});

test('windows are contiguous — no row is skipped or read twice', async () => {
  const s = server(2500, 1000);
  const r = await fetchAllRows<{ id: number }>(s.page);
  assert.equal(new Set(r.rows.map((x) => x.id)).size, 2500, 'no duplicates');
  assert.deepEqual(s.calls.map(([f]) => f), [0, 1000, 2000, 2500], 'each window starts where the last ended');
});
