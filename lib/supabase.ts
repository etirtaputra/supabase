import { createClient, SupabaseClient } from '@supabase/supabase-js';

// Singleton with `any` schema — no generated Supabase types in this project,
// so we use SupabaseClient<any> to avoid `never` type errors on all table ops.
let _client: SupabaseClient<any> | null = null;

export function createSupabaseClient(): SupabaseClient<any> {
  if (!_client) {
    _client = createClient<any>(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
    );
  }
  return _client;
}
