/**
 * Shared helpers for Supabase Realtime Presence UIs (per-proposal presence in
 * the editor + the EPC-lobby presence on the proposals list). Keeping the
 * colour/initials logic here means the same colleague is the same hue and the
 * same badge everywhere they appear.
 */

// Deterministic bright colour per person (hashed from email), so a colleague
// is always the same hue across sessions and across screens.
export const PRESENCE_COLORS = ['#f87171', '#fb923c', '#fbbf24', '#a3e635', '#34d399', '#22d3ee', '#60a5fa', '#a78bfa', '#f472b6', '#e879f9'];

export function colorFor(s: string): string {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  return PRESENCE_COLORS[h % PRESENCE_COLORS.length];
}

export function initials(name: string, email: string): string {
  const base = (name || email).trim();
  const parts = base.split(/[\s@._-]+/).filter(Boolean);
  return ((parts[0]?.[0] ?? '') + (parts[1]?.[0] ?? '')).toUpperCase() || base[0]?.toUpperCase() || '?';
}

export function firstName(name: string, email: string): string {
  return (name || email).split(/[\s@._-]+/)[0] || email;
}

/** Someone else in the same document, and the line they are on. */
export interface DocPeer {
  email: string;
  name: string;
  color: string;
  /** Holding unsaved edits. */
  editing: boolean;
  /** The line (item id) their cursor is in, or null — set by the editor, never saved. */
  focus: string | null;
}

/**
 * Who is on which line — for the live line marker in a document editor
 * (owner, 2026-10-02: "showing which line a colleague is editing live").
 * Peers with no line are left out; a line shows its people in name order.
 */
export function peersByFocus(peers: DocPeer[]): Map<string, DocPeer[]> {
  const m = new Map<string, DocPeer[]>();
  for (const p of peers) {
    if (!p.focus) continue;
    const arr = m.get(p.focus) ?? [];
    arr.push(p);
    m.set(p.focus, arr);
  }
  for (const arr of m.values()) arr.sort((a, b) => a.name.localeCompare(b.name));
  return m;
}
