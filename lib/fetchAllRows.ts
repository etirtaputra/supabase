/**
 * Read every row of a query, past the API's row cap.
 *
 * Supabase caps a single response at "Max rows" (Settings → API; **1000** for
 * this project, confirmed 2026-08-28). Past that the response is simply short —
 * no error, no flag, nothing in the console. A table that quietly crosses the
 * line takes every unbounded query with it, and the screens that total those
 * rows start under-reporting money.
 *
 * `10.2_quote_items` crossed it: 1,040 rows on 2026-08-28. `3.0_components`
 * was at 993 the same day, seven rows away.
 *
 * ── Why this exists rather than another local loop ──────────────────────────
 * Ten files had hand-copied the same `const PAGE = 1000` loop (the count was
 * recorded as seven on 2026-08-28; three more turned up in CommandPalette,
 * useSupabaseData and useItemScores when they were retired). They all shared a
 * flaw this one does not: they stop when a page comes back SHORTER
 * than the page size. That is only correct while the requested size is ≤ the
 * server's cap. Lower "Max rows" to 500 and every one of those loops silently
 * stops after the first page, believing it reached the end — the same class of
 * silent truncation they were written to avoid.
 *
 * So this advances by what the server actually RETURNED and stops only on an
 * empty page. It cannot be wrong-footed by the cap, whatever it is set to.
 */

import type { SupabaseClient } from '@supabase/supabase-js';

export interface PageResult<T> {
  data: T[] | null;
  error: { message: string } | null;
}

/**
 * @param page      builds one request; called fresh per page because a
 *                  PostgREST builder cannot be reused after it is awaited
 * @param pageSize  how many to ASK for. The server may return fewer — that is
 *                  handled — so this is a hint, not a contract.
 * @param maxPages  a stop so a misbehaving endpoint cannot spin forever
 */
export async function fetchAllRows<T>(
  page: (from: number, to: number) => PromiseLike<PageResult<T>>,
  pageSize = 1000,
  maxPages = 200,
): Promise<{ rows: T[]; error: string | null; truncated: boolean }> {
  const rows: T[] = [];
  let from = 0;

  for (let i = 0; i < maxPages; i++) {
    const { data, error } = await page(from, from + pageSize - 1);
    if (error) return { rows, error: error.message, truncated: true };
    if (!data || data.length === 0) return { rows, error: null, truncated: false };
    rows.push(...data);
    // Advance by what came back, NOT by pageSize: if the server's cap is lower
    // than pageSize the next window must start where this page actually ended,
    // or rows are skipped.
    from += data.length;
  }
  // Ran out of pages before running out of rows — say so rather than pretend.
  return { rows, error: null, truncated: true };
}

/**
 * Every row of the item catalogue, whatever "Max rows" is set to.
 *
 * Six screens read `3.0_components` in full, each with its own copy of the
 * paging loop. The COLUMN lists differ on purpose and stay at the call sites —
 * `brand` is buy-side, and a sell-side browser must not receive it even in a
 * network tab (the /products leak rule). The paging never differed, so it
 * lives here now, once.
 *
 * Ordered by `supplier_model`, which is what all six already asked for.
 */
export async function fetchAllComponents<T>(supabase: SupabaseClient, cols: string): Promise<T[]> {
  const { rows } = await fetchAllRows<T>((from, to) =>
    supabase.from('3.0_components').select(cols).order('supplier_model')
      .range(from, to) as unknown as PromiseLike<PageResult<T>>);
  return rows;
}
