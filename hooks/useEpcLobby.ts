'use client';
import { useEffect, useMemo, useRef, useState } from 'react';
import type { RealtimeChannel } from '@supabase/supabase-js';
import { createSupabaseClient } from '@/lib/supabase';
import { colorFor } from '@/lib/presence';

/**
 * EPC "lobby" presence — one shared Realtime channel that everyone in the
 * proposals area joins (the list AND every open editor). Each person
 * broadcasts where they are (`proposalId`, '' = browsing the list) and whether
 * they hold unsaved edits. The list uses this to show, per card, who is live
 * on that proposal right now; the editor uses it only to announce itself.
 *
 * Ephemeral (no DB writes). Complements the per-proposal ProposalPresence in
 * the editor — this is the cross-proposal, list-level view.
 */
export interface LobbyPeer {
  email: string; name: string; color: string;
  proposalId: string; quoteNumber: string; editing: boolean;
}

const LOBBY_CHANNEL = 'presence:epc-lobby';

export function useEpcLobby({ email, name, proposalId = '', quoteNumber = '', editing = false }: {
  email?: string; name?: string; proposalId?: string; quoteNumber?: string; editing?: boolean;
}) {
  const supabase = useMemo(() => createSupabaseClient(), []);
  const [peers, setPeers] = useState<LobbyPeer[]>([]);
  const chanRef = useRef<RealtimeChannel | null>(null);
  // Latest self-state, read at first subscribe without forcing a re-subscribe.
  const selfRef = useRef({ proposalId, quoteNumber, editing });
  selfRef.current = { proposalId, quoteNumber, editing };

  useEffect(() => {
    if (!email) return;
    const color = colorFor(email);
    const channel = supabase.channel(LOBBY_CHANNEL, { config: { presence: { key: email } } });
    chanRef.current = channel;

    const sync = () => {
      const state = channel.presenceState() as Record<string, Array<Partial<LobbyPeer>>>;
      const flat: LobbyPeer[] = [];
      for (const key in state) {
        // A person can appear more than once (multiple tabs) — keep them all;
        // grouping/dedup happens in the derived views below.
        for (const meta of state[key] ?? []) {
          if (!meta?.email) continue;
          flat.push({
            email: meta.email,
            name: meta.name || meta.email,
            color: meta.color || colorFor(meta.email),
            proposalId: meta.proposalId || '',
            quoteNumber: meta.quoteNumber || '',
            editing: !!meta.editing,
          });
        }
      }
      setPeers(flat);
    };

    channel.on('presence', { event: 'sync' }, sync);
    channel.subscribe(async (status) => {
      if (status === 'SUBSCRIBED') {
        const s = selfRef.current;
        await channel.track({ email, name: name || email, color, proposalId: s.proposalId, quoteNumber: s.quoteNumber, editing: s.editing });
      }
    });

    return () => { supabase.removeChannel(channel); chanRef.current = null; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [email, name]);

  // Re-broadcast whenever this user's location or editing flag changes.
  useEffect(() => {
    const ch = chanRef.current;
    if (ch && email) {
      ch.track({ email, name: name || email, color: colorFor(email), proposalId, quoteNumber, editing }).then(() => {}, () => {});
    }
  }, [email, name, proposalId, quoteNumber, editing]);

  // Per-proposal peers, excluding self (you needn't see your own avatar on the
  // card you're on) and deduped by email across tabs.
  const peersByProposal = useMemo(() => {
    const m = new Map<string, LobbyPeer[]>();
    for (const p of peers) {
      if (!p.proposalId || p.email === email) continue;
      const arr = m.get(p.proposalId) ?? [];
      const existing = arr.find((x) => x.email === p.email);
      if (existing) existing.editing = existing.editing || p.editing;
      else arr.push({ ...p });
      m.set(p.proposalId, arr);
    }
    return m;
  }, [peers, email]);

  // Everyone online (distinct by email, incl. self), for a header count.
  const online = useMemo(() => {
    const m = new Map<string, LobbyPeer>();
    for (const p of peers) {
      const cur = m.get(p.email);
      // Prefer an entry that's parked on a proposal (more informative) / editing
      if (!cur || (!cur.proposalId && p.proposalId) || (p.editing && !cur.editing)) m.set(p.email, p);
    }
    return [...m.values()].sort((a, b) => a.name.localeCompare(b.name));
  }, [peers]);

  return { peersByProposal, online, onlineCount: online.length };
}
