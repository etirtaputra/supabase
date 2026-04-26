import { createClient } from '@supabase/supabase-js';

// Singleton — all hooks and components share one client instance so that
// auth state (JWT, session refresh) is consistent across the whole app.
let _client: ReturnType<typeof createClient> | null = null;

export function createSupabaseClient() {
  if (!_client) {
    _client = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
    );
  }
  return _client;
}
