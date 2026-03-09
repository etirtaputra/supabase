import { createClient, SupabaseClient } from "@supabase/supabase-js";

// Client-side Supabase client (singleton, lazy)
let clientInstance: SupabaseClient | null = null;

export function getSupabaseClient(): SupabaseClient {
  if (!clientInstance) {
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
    const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
    clientInstance = createClient(url, key);
  }
  return clientInstance;
}

// Server-side Supabase client (new instance per request)
export function createServerClient(): SupabaseClient {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
  return createClient(url, key, {
    auth: {
      persistSession: false,
    },
  });
}
