import type { SupabaseClient } from '@supabase/supabase-js';

/**
 * Proposal lines WAITING on someone — `10.7_quote_item_flags`.
 *
 * The owner's ask (2026-10-22): "flag a line items awaiting for price or
 * technical clarifications … for example in the latest AYANA BOH Atap ballroom
 * now we're just waiting for the updated price of the ACDP and we can tag who
 * is responsible." Then: "clear by hand (but the log should say who clears
 * what). Tag only owners and people on Project Engineers or Admin Project."
 *
 * A flag is OPEN until someone clears it by hand. Clearing keeps the row with
 * who and when; the database stamps both (the browser never says who it is)
 * and writes every raise/reassign/clear into the proposal's History.
 *
 * Never printed. The PDF only asks how many are open, to warn before it is
 * saved ("when someone is trying to save pdf and an item is still flagged, it
 * should have pop up of what items and it goes to that line").
 *
 * Pure apart from the two fetch/write helpers at the bottom.
 */
export type FlagKind = 'price' | 'technical';

export interface QuoteFlag {
  flag_id: number;
  quote_id: string;
  item_id: string;
  kind: FlagKind;
  assignee_email: string;
  note: string;
  created_by_email: string;
  created_at: string;
  resolved_at: string | null;
  resolved_by_email: string | null;
}

export const FLAG_COLS =
  'flag_id, quote_id, item_id, kind, assignee_email, note, created_by_email, created_at, resolved_at, resolved_by_email';

/** Who may be tagged: owners and project engineers (Admin Project is one). The database enforces the same list. */
export const TAGGABLE_ROLES = ['owner', 'engineer'] as const;

export const isOpenFlag = (f: QuoteFlag): boolean => !f.resolved_at;

/** "budi@ica.id" → "Budi". The name the office uses, without the domain. */
export const personName = (email: string | null | undefined): string => {
  const local = (email ?? '').split('@')[0].replace(/[._-]+/g, ' ').trim();
  return local ? local.replace(/\b\w/g, (c) => c.toUpperCase()) : '—';
};

/** The open flag on each line (newest wins if a line somehow carries two). */
export function openFlagByItem(flags: QuoteFlag[]): Map<string, QuoteFlag> {
  const m = new Map<string, QuoteFlag>();
  for (const f of flags) {
    if (!isOpenFlag(f)) continue;
    const prev = m.get(f.item_id);
    if (!prev || f.created_at > prev.created_at) m.set(f.item_id, f);
  }
  return m;
}

/** Every flag a line has had, newest first — open and cleared alike. */
export const lineHistory = (flags: QuoteFlag[], itemId: string): QuoteFlag[] =>
  flags.filter((f) => f.item_id === itemId).sort((a, b) => b.created_at.localeCompare(a.created_at));

export interface WaitingLine { flag: QuoteFlag; itemId: string; description: string }

/**
 * The open flags in the order the lines sit on the proposal, so the strip's
 * ‹ › and the PDF pop-up walk the page top to bottom. `lines` is the
 * proposal's live lines in display order; a flag whose line is not among them
 * (deleted in this tab, not saved yet) is left out — nobody can go to it.
 */
export function waitingLines(flags: QuoteFlag[], lines: { item_id: string; description: string }[]): WaitingLine[] {
  const open = openFlagByItem(flags);
  const out: WaitingLine[] = [];
  for (const l of lines) {
    const f = open.get(l.item_id);
    if (f) out.push({ flag: f, itemId: l.item_id, description: l.description.trim() });
  }
  return out;
}

/** Open flags per proposal, and who they are on — for the Proposals list. */
export function openFlagsByQuote(rows: { quote_id: string; assignee_email: string }[]): Map<string, { n: number; people: string[] }> {
  const m = new Map<string, { n: number; people: string[] }>();
  for (const r of rows) {
    const e = m.get(r.quote_id) ?? { n: 0, people: [] };
    e.n += 1;
    const who = personName(r.assignee_email);
    if (!e.people.includes(who)) e.people.push(who);
    m.set(r.quote_id, e);
  }
  return m;
}

// ── Database ────────────────────────────────────────────────────────────────

export async function fetchFlags(supabase: SupabaseClient, quoteId: string): Promise<QuoteFlag[]> {
  const { data, error } = await supabase.from('10.7_quote_item_flags')
    .select(FLAG_COLS).eq('quote_id', quoteId).order('created_at', { ascending: false });
  if (error) throw new Error(error.message);
  return (data ?? []) as QuoteFlag[];
}

export async function raiseFlag(supabase: SupabaseClient, f: { quote_id: string; item_id: string; kind: FlagKind; assignee_email: string; note: string }): Promise<void> {
  const { error } = await supabase.from('10.7_quote_item_flags').insert({ ...f, note: f.note.trim() });
  if (error) throw new Error(error.message);
}

export async function reassignFlag(supabase: SupabaseClient, flagId: number, assigneeEmail: string): Promise<void> {
  const { error } = await supabase.from('10.7_quote_item_flags').update({ assignee_email: assigneeEmail }).eq('flag_id', flagId);
  if (error) throw new Error(error.message);
}

/** Who cleared it and when are stamped by the database, whatever is sent. */
export async function clearFlag(supabase: SupabaseClient, flagId: number): Promise<void> {
  const { error } = await supabase.from('10.7_quote_item_flags')
    .update({ resolved_at: new Date().toISOString() }).eq('flag_id', flagId);
  if (error) throw new Error(error.message);
}
