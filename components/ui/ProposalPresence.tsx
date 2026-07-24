'use client';
import { useEffect, useMemo, useRef, useState } from 'react';
import type { RealtimeChannel } from '@supabase/supabase-js';
import { createSupabaseClient } from '@/lib/supabase';
import { colorFor, initials, firstName as firstNameOf } from '@/lib/presence';

/**
 * Live presence for a shared document (Supabase Realtime Presence — no DB
 * writes, ephemeral). Shows colored avatars of everyone else viewing the same
 * proposal right now, an amber dot + warning when a colleague has UNSAVED
 * edits (conflict risk), and — because a peer's "editing" flag flipping off
 * usually means they just saved — fires onPeerSaved so the editor can pull
 * their changes immediately instead of waiting for the next poll.
 *
 * This is the presence layer that makes concurrent editing feel Google-Sheets
 * live; the existing delta-save + auto-merge is what actually reconciles the
 * edits safely underneath it.
 */

interface Peer { email: string; name: string; color: string; editing: boolean }

const firstName = (p: Peer) => firstNameOf(p.name, p.email);

export default function ProposalPresence({ channelId, email, name, editing, onPeerSaved }: {
  channelId: string;
  email: string;
  name: string;
  editing: boolean;             // is THIS user holding unsaved edits
  onPeerSaved?: () => void;     // a colleague's edit flag just cleared (likely saved)
}) {
  const supabase = useMemo(() => createSupabaseClient(), []);
  const [peers, setPeers] = useState<Peer[]>([]);
  const chanRef = useRef<RealtimeChannel | null>(null);
  const editingRef = useRef(editing);
  editingRef.current = editing;
  const prevEditors = useRef<Set<string>>(new Set());
  const savedCb = useRef(onPeerSaved);
  savedCb.current = onPeerSaved;

  useEffect(() => {
    if (!email) return;
    const color = colorFor(email);
    const channel = supabase.channel(`presence:${channelId}`, { config: { presence: { key: email } } });
    chanRef.current = channel;

    const sync = () => {
      const state = channel.presenceState() as Record<string, { email?: string; name?: string; color?: string; editing?: boolean }[]>;
      const byEmail = new Map<string, Peer>();
      for (const key in state) {
        const meta = state[key]?.[0];
        if (!meta?.email || meta.email === email) continue; // exclude self
        byEmail.set(meta.email, {
          email: meta.email,
          name: meta.name || meta.email,
          color: meta.color || colorFor(meta.email),
          editing: !!meta.editing,
        });
      }
      const list = [...byEmail.values()].sort((a, b) => a.name.localeCompare(b.name));
      // Detect a peer who WAS editing and now isn't → they most likely saved
      const now = new Set(list.filter((p) => p.editing).map((p) => p.email));
      let someoneJustSaved = false;
      for (const e of prevEditors.current) if (!now.has(e) && byEmail.has(e)) someoneJustSaved = true;
      prevEditors.current = now;
      setPeers(list);
      if (someoneJustSaved) savedCb.current?.();
    };

    channel.on('presence', { event: 'sync' }, sync);
    channel.subscribe(async (status) => {
      if (status === 'SUBSCRIBED') await channel.track({ email, name, color, editing: editingRef.current });
    });

    return () => { supabase.removeChannel(channel); chanRef.current = null; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [channelId, email, name]);

  // Re-broadcast whenever this user's editing flag flips
  useEffect(() => {
    const ch = chanRef.current;
    if (ch) ch.track({ email, name, color: colorFor(email), editing }).then(() => {}, () => {});
  }, [editing, email, name]);

  if (!peers.length) return null;
  const editors = peers.filter((p) => p.editing);

  return (
    <div className="flex items-center gap-2 flex-shrink-0">
      <div className="flex -space-x-2">
        {peers.slice(0, 5).map((p) => (
          <span key={p.email}
            title={`${p.name} — ${p.editing ? 'editing now (unsaved changes)' : 'viewing'}`}
            className="w-6 h-6 rounded-full flex items-center justify-center text-[9px] font-bold text-black/80 ring-2 ring-[#141518] relative"
            style={{ backgroundColor: p.color }}>
            {initials(p.name, p.email)}
            {p.editing && <span className="absolute -bottom-0.5 -right-0.5 w-2.5 h-2.5 rounded-full bg-amber-400 ring-2 ring-[#141518]" />}
          </span>
        ))}
        {peers.length > 5 && (
          <span className="w-6 h-6 rounded-full bg-slate-700 text-slate-300 text-[9px] font-bold flex items-center justify-center ring-2 ring-[#141518]">
            +{peers.length - 5}
          </span>
        )}
      </div>
      {editors.length > 0 && (
        <span className="hidden sm:flex items-center gap-1 text-[11px] font-semibold text-amber-300 whitespace-nowrap"
          title={`${editors.map((e) => e.name).join(', ')} ${editors.length > 1 ? 'have' : 'has'} unsaved edits — your changes auto-merge on save, but review overlaps`}>
          ⚠ {editors.length === 1 ? `${firstName(editors[0])} editing` : `${editors.length} editing`}
        </span>
      )}
    </div>
  );
}
