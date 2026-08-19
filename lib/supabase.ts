import { createClient, SupabaseClient } from '@supabase/supabase-js';

/**
 * In-process auth lock. supabase-js's default lock is the browser's
 * LockManager, SHARED ACROSS EVERY TAB of the origin — and a wedged or
 * backgrounded tab can hold it forever, after which every request in every
 * other tab queues silently with no network activity at all (field report
 * 2026-08-19: "Save changes takes forever" — the edge logs showed the PATCH
 * never left the browser, while a fresh tab saved in 440ms). ICAPROC runs in
 * many long-lived tabs, so cross-tab refresh serialization is not worth that
 * failure mode; two tabs refreshing a token simultaneously is harmless (both
 * land a valid session).
 */
let chain: Promise<unknown> = Promise.resolve();
const inProcessLock = async <R>(_name: string, _acquireTimeout: number, fn: () => Promise<R>): Promise<R> => {
  const run = chain.then(fn, fn);
  chain = run.catch(() => undefined);
  return run;
};

// Singleton with `any` schema — no generated Supabase types in this project,
// so we use SupabaseClient<any> to avoid `never` type errors on all table ops.
let _client: SupabaseClient<any> | null = null;

export function createSupabaseClient(): SupabaseClient<any> {
  if (!_client) {
    _client = createClient<any>(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
      { auth: { lock: inProcessLock } }
    );
  }
  return _client;
}
