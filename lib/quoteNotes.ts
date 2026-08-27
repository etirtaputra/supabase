import type { SupabaseClient } from '@supabase/supabase-js';

/**
 * The follow-up thread on an EPC proposal — `10.5_quote_notes`.
 *
 * The owner's ask (2026-08-27): "notes or status that can be written by users
 * and it will show also on the list… like a chat thread in Google Chat so you
 * can clear it later and can see the time logs."
 *
 * So: many short notes per proposal, each stamped with who and when, each
 * TICKED OFF individually when it stops mattering. The list shows the newest
 * note still open, and goes quiet when every note has been ticked.
 *
 * CLEARED IS NOT DELETED. Ticking a note sets `cleared_at`; the note keeps its
 * place in the thread, greyed, with both timestamps. That is the whole point of
 * a time log — "we chased them on the 21st and they answered on the 26th" is
 * the useful sentence, and deleting the note deletes the sentence.
 *
 * NOT the same thing as any of the three that already existed:
 *   • `10.0_project_quotes.notes` is the proposal's own notes and is PRINTED
 *     on the customer's copy. This is internal and never printed.
 *   • `10.3_quote_activity` is the machine audit log — written by the app,
 *     never typed by a person.
 *   • The proposal `status` is the document's state (draft/sent/accepted),
 *     not what anyone is waiting for.
 */
export interface QuoteNote {
  note_id: number;
  quote_id: string;
  body: string;
  author_email: string | null;
  created_at: string;
  cleared_at: string | null;
  cleared_by_email: string | null;
}

const COLS = 'note_id, quote_id, body, author_email, created_at, cleared_at, cleared_by_email';

/** A note counts as OPEN until somebody ticks it off. */
export const isOpen = (n: QuoteNote): boolean => !n.cleared_at;

/** Newest first — the same order every other feed in the app reads in. */
export const threadOrder = (notes: QuoteNote[]): QuoteNote[] =>
  [...notes].sort((a, b) => (b.created_at ?? '').localeCompare(a.created_at ?? '') || b.note_id - a.note_id);

/**
 * The one note each proposal shows on the list: its newest note still open.
 *
 * Cleared notes are ignored rather than shown greyed — a list row is a
 * standing question ("what is this proposal waiting on?"), and a settled note
 * is no longer an answer to it. The thread still has them.
 */
export function newestOpenByQuote(notes: QuoteNote[]): Map<string, QuoteNote> {
  const out = new Map<string, QuoteNote>();
  for (const n of threadOrder(notes.filter(isOpen))) {
    if (!out.has(n.quote_id)) out.set(n.quote_id, n);
  }
  return out;
}

/** How many notes are still open, per proposal. */
export function openCountByQuote(notes: QuoteNote[]): Map<string, number> {
  const out = new Map<string, number>();
  for (const n of notes) {
    if (!isOpen(n)) continue;
    out.set(n.quote_id, (out.get(n.quote_id) ?? 0) + 1);
  }
  return out;
}

/**
 * Every OPEN note across all proposals — what the list needs, in one query.
 * Empty on any error, so a missing table or a denied read costs the list its
 * notes and nothing else (the same shape `fetchDeliveredByQuoteComp` uses).
 */
export async function fetchOpenNotes(supabase: SupabaseClient): Promise<QuoteNote[]> {
  const { data, error } = await supabase
    .from('10.5_quote_notes').select(COLS).is('cleared_at', null)
    // note_id breaks the tie: two notes posted in the same second (or in one
    // transaction, where Postgres hands every row the same now()) would
    // otherwise come back in an arbitrary order. `threadOrder` applies the
    // same tiebreaker client-side and is the authority; this keeps the two
    // agreeing so a debugging query does not disagree with the screen.
    .order('created_at', { ascending: false }).order('note_id', { ascending: false });
  if (error) return [];
  return (data ?? []) as unknown as QuoteNote[];
}

/** One proposal's whole thread, cleared notes included. */
export async function fetchThread(supabase: SupabaseClient, quoteId: string): Promise<QuoteNote[]> {
  const { data, error } = await supabase
    .from('10.5_quote_notes').select(COLS).eq('quote_id', quoteId)
    .order('created_at', { ascending: false }).order('note_id', { ascending: false });
  if (error) return [];
  return (data ?? []) as unknown as QuoteNote[];
}

/** Post a note. Returns the stored row, or null if it did not save. */
export async function addNote(
  supabase: SupabaseClient, quoteId: string, body: string, authorEmail: string | null,
): Promise<QuoteNote | null> {
  const text = body.trim();
  if (!text) return null;
  const { data, error } = await supabase
    .from('10.5_quote_notes')
    .insert({ quote_id: quoteId, body: text, author_email: authorEmail })
    .select(COLS).single();
  if (error) return null;
  return data as unknown as QuoteNote;
}

/**
 * Tick a note off, or put it back. Un-ticking matters: ticking the wrong line
 * is a slip, and without this the only way back would be to retype the note
 * and lose the date it was actually raised.
 */
export async function setNoteCleared(
  supabase: SupabaseClient, noteId: number, cleared: boolean, byEmail: string | null,
): Promise<boolean> {
  const { error } = await supabase
    .from('10.5_quote_notes')
    .update(cleared
      ? { cleared_at: new Date().toISOString(), cleared_by_email: byEmail }
      : { cleared_at: null, cleared_by_email: null })
    .eq('note_id', noteId);
  return !error;
}
