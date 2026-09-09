/**
 * Shared plumbing for the `/api/agent/*` routes.
 *
 * ONE RULE, and getting it wrong silently breaks the whole security model:
 * an agent route queries AS THE CALLER, never with the service-role key.
 *
 * `agent_attention` is a `security_invoker` view and its signals gate on
 * `can_see_money()` / `can_write_buy_side()`, which read `auth.uid()`. Under
 * the service-role key `auth.uid()` is NULL, so RLS is bypassed AND every
 * role-gated signal silently disappears — an agent would be told there are no
 * overdue invoices while sitting on a key that can read every one of them.
 * Passing the caller's bearer token through instead keeps both halves honest.
 *
 * (`app/api/ask` does use service-role; that predates this and is a separate
 * conversation. Do not copy it here.)
 */
import { createClient, type SupabaseClient } from '@supabase/supabase-js';

export interface AgentCaller {
  client: SupabaseClient;
  email: string;
  role: string;
}

/** Which capability each attention signal needs. Mirrors the SQL view's gates. */
export const SIGNAL_CAPABILITY: Record<string, 'money' | 'buy_side' | 'any'> = {
  ar_overdue: 'money',
  below_cost: 'money',
  po_late: 'buy_side',
  quote_quiet: 'any',
  stock_short: 'any',
  unpriced: 'any',
  no_specs: 'any',
  // Goods in, supplier paid, customs bill never entered. Buy-side because the
  // fix is a payment row — and because the figure it protects is landed cost.
  landed_cost_open: 'buy_side',
};

const MONEY_ROLES = ['owner', 'finance', 'buy_admin', 'sell_admin', 'data_entry'];
const BUY_SIDE_ROLES = ['owner', 'buy_admin', 'data_entry', 'finance'];

/**
 * The signal kinds this role can see AT ALL.
 *
 * Returned to the caller on every response, and it matters: an agent that
 * reports "no overdue invoices" when its role simply cannot see AR has told
 * the owner something false. With this it can say "AR is outside what I can
 * see" instead — the honesty doctrine, applied to an API.
 */
export function visibleKinds(role: string): string[] {
  const money = MONEY_ROLES.includes(role);
  const buySide = BUY_SIDE_ROLES.includes(role);
  return Object.entries(SIGNAL_CAPABILITY)
    .filter(([, cap]) => cap === 'any' || (cap === 'money' && money) || (cap === 'buy_side' && buySide))
    .map(([kind]) => kind)
    .sort();
}

export const ALL_KINDS = Object.keys(SIGNAL_CAPABILITY).sort();

/** Kinds this role cannot see, so a report can say so rather than imply zero. */
export const hiddenKinds = (role: string): string[] => {
  const seen = new Set(visibleKinds(role));
  return ALL_KINDS.filter((k) => !seen.has(k));
};

export class AgentAuthError extends Error {
  // Declared explicitly rather than as a constructor parameter property: the
  // test runner is `node --test` over raw .ts, which strips types rather than
  // compiling them, and parameter properties are real emit — not just a type.
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

/**
 * Verify the bearer token and return a client that acts AS that user.
 * Throws `AgentAuthError` rather than returning a shape each route re-checks.
 */
export async function callerFromRequest(request: Request): Promise<AgentCaller> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !anon) throw new AgentAuthError(500, 'Supabase is not configured on this deployment');

  const token = (request.headers.get('authorization') ?? '').replace(/^Bearer\s+/i, '').trim();
  if (!token) throw new AgentAuthError(401, 'Sign in required: send Authorization: Bearer <access_token>');

  // The token travels on every request this client makes, so `auth.uid()`
  // resolves to the caller inside the view's role gates.
  const client = createClient(url, anon, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { headers: { Authorization: `Bearer ${token}` } },
  });

  const { data: { user }, error } = await client.auth.getUser(token);
  if (error || !user) throw new AgentAuthError(401, 'That access token is not valid or has expired');

  const { data: profile } = await client
    .from('user_profiles').select('email, role').eq('id', user.id).maybeSingle();
  if (!profile?.role) throw new AgentAuthError(403, 'This account has no ICAPROC profile');

  return { client, email: profile.email ?? user.email ?? '', role: profile.role };
}
