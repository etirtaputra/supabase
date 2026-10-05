/**
 * Recent EPC wins, for the team's celebration (owner, 2026-10-05: "make
 * using ICAPROC more fun" → celebrate wins).
 *
 * A win is a status change to `accepted` (the editor's word for won) in
 * 10.3_quote_activity — written by the log_quote_activity trigger, so it is the
 * database's record of who marked it and when, not the client's — on a
 * proposal that is STILL accepted (a win reversed by mistake is not a win).
 * Until 2026-10-05 not one proposal had ever been marked won.
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import { subtotalsByQuote } from './proposalNudges.ts';

export interface RecentWin {
  quoteId: string;
  quoteNumber: string;
  customer: string;
  site: string;
  /** Subtotal excl. PPN of the won proposal. */
  value: number;
  wonAt: string;
  markedBy: string;
  madeBy: string;
  /** Display names when known (user_profiles), else the email. */
  markedByName?: string;
  madeByName?: string;
}

export interface WinActivityRow { quote_id: string; actor_email: string | null; at: string; detail: string | null }
export interface WinQuoteRow { quote_id: string; quote_number: string | null; customer_name: string | null; location: string | null; status: string; created_by_email: string | null }

/** Newest first; one entry per proposal (its latest move to won). */
export function winsFrom(activity: WinActivityRow[], quotes: WinQuoteRow[], totals: Map<string, number>): RecentWin[] {
  const byId = new Map(quotes.map((q) => [q.quote_id, q]));
  const latest = new Map<string, WinActivityRow>();
  for (const a of activity) {
    if (!/->\s*accepted\s*$/.test(a.detail ?? '')) continue;
    const cur = latest.get(a.quote_id);
    if (!cur || a.at > cur.at) latest.set(a.quote_id, a);
  }
  const out: RecentWin[] = [];
  for (const [id, a] of latest) {
    const q = byId.get(id);
    if (!q || q.status !== 'accepted') continue;
    out.push({
      quoteId: id,
      quoteNumber: q.quote_number ?? '',
      customer: (q.customer_name ?? '').trim(),
      site: (q.location ?? '').trim(),
      value: totals.get(id) ?? 0,
      wonAt: a.at,
      markedBy: a.actor_email ?? '',
      madeBy: q.created_by_email ?? '',
    });
  }
  return out.sort((x, y) => y.wonAt.localeCompare(x.wonAt));
}

/** Wins in the last `days` days. Callers gate on the /proposals permission. */
export async function fetchRecentWins(supabase: SupabaseClient, days = 14): Promise<RecentWin[]> {
  const since = new Date(Date.now() - days * 86_400_000).toISOString();
  const { data: act, error } = await supabase.from('10.3_quote_activity')
    .select('quote_id, actor_email, at, detail')
    .eq('action', 'status').like('detail', '%-> accepted').gte('at', since);
  if (error || !act?.length) return [];
  const ids = [...new Set((act as WinActivityRow[]).map((a) => a.quote_id))];
  const [qRes, iRes] = await Promise.all([
    supabase.from('10.0_project_quotes').select('quote_id, quote_number, customer_name, location, status, created_by_email').in('quote_id', ids),
    supabase.from('10.2_quote_items').select('quote_id, parent_item_id, quantity, sell_price').in('quote_id', ids),
  ]);
  if (qRes.error) return [];
  const wins = winsFrom(act as WinActivityRow[], (qRes.data ?? []) as WinQuoteRow[], subtotalsByQuote(iRes.data ?? []));
  const emails = [...new Set(wins.flatMap((w) => [w.markedBy, w.madeBy]).filter(Boolean))];
  if (!emails.length) return wins;
  const { data: profs } = await supabase.from('user_profiles').select('email, display_name').in('email', emails);
  const nameOf = new Map(((profs ?? []) as { email: string; display_name: string | null }[]).map((p) => [p.email, p.display_name || p.email]));
  return wins.map((w) => ({ ...w, markedByName: nameOf.get(w.markedBy) ?? w.markedBy, madeByName: nameOf.get(w.madeBy) ?? w.madeBy }));
}

/** Wins this browser has not celebrated yet — remembered per person, per device. */
export const SEEN_WINS_KEY = 'icaproc_seen_wins';
export function unseenWins(wins: RecentWin[], seen: string[]): RecentWin[] {
  const s = new Set(seen);
  return wins.filter((w) => !s.has(`${w.quoteId}@${w.wonAt}`));
}
export const winSeenKey = (w: RecentWin) => `${w.quoteId}@${w.wonAt}`;
