'use client';
import { useEffect, useMemo, useRef, useState } from 'react';
import type { RealtimeChannel } from '@supabase/supabase-js';
import { createSupabaseClient } from '@/lib/supabase';
import { colorFor } from '@/lib/presence';

/**
 * App-wide presence — the EPC lobby idea, generalised: ONE shared Realtime
 * channel every signed-in tab joins. Each person announces which screen they
 * are on (path + the page's own title, e.g. "Sales · SO-20260803-0002"), so
 * the header can show who is online and what they are looking at.
 *
 * Scale notes (30+ concurrent users is the expected load):
 * - Presence state is a small map (email → {path,title,…}); Supabase Realtime
 *   handles hundreds of members per channel — 30 is nothing.
 * - We re-track only on navigation (debounced), never on a timer, so a quiet
 *   tab costs zero messages.
 * - Multiple tabs per person collapse to their freshest announcement.
 *
 * Ephemeral by design: no DB writes, closing the tab removes the entry.
 */
export interface AppPeer {
  email: string; name: string; color: string;
  path: string; title: string; at: string;
}

const APP_CHANNEL = 'presence:app';

const pageTitle = (): string =>
  typeof document !== 'undefined' ? document.title.replace(/\s*—\s*ICAPROC\s*$/, '') : '';

export function useAppPresence({ email, name, path }: { email?: string; name?: string; path: string }) {
  const supabase = useMemo(() => createSupabaseClient(), []);
  const [peers, setPeers] = useState<AppPeer[]>([]);
  const chanRef = useRef<RealtimeChannel | null>(null);
  const selfRef = useRef({ path });
  selfRef.current = { path };

  useEffect(() => {
    if (!email) return;
    const channel = supabase.channel(APP_CHANNEL, { config: { presence: { key: email } } });
    chanRef.current = channel;

    const sync = () => {
      const state = channel.presenceState() as Record<string, Array<Partial<AppPeer>>>;
      const flat: AppPeer[] = [];
      for (const key in state) {
        for (const m of state[key] ?? []) {
          if (!m?.email) continue;
          flat.push({
            email: m.email, name: m.name || m.email, color: m.color || colorFor(m.email),
            path: m.path || '/', title: m.title || '', at: m.at || '',
          });
        }
      }
      setPeers(flat);
    };

    channel.on('presence', { event: 'sync' }, sync);
    channel.subscribe(async (status) => {
      if (status === 'SUBSCRIBED') {
        await channel.track({
          email, name: name || email, color: colorFor(email),
          path: selfRef.current.path, title: pageTitle(), at: new Date().toISOString(),
        });
      }
    });

    return () => { supabase.removeChannel(channel); chanRef.current = null; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [email, name]);

  // Re-announce on navigation — after a beat, so document.title (set by the
  // destination page's own effect) has caught up and peers see the real name.
  useEffect(() => {
    const ch = chanRef.current;
    if (!ch || !email) return;
    const t = setTimeout(() => {
      ch.track({
        email, name: name || email, color: colorFor(email),
        path, title: pageTitle(), at: new Date().toISOString(),
      }).then(() => {}, () => {});
    }, 900);
    return () => clearTimeout(t);
  }, [path, email, name]);

  // Distinct people — a person with several tabs shows their freshest location.
  const online = useMemo(() => {
    const m = new Map<string, AppPeer>();
    for (const p of peers) {
      const cur = m.get(p.email);
      if (!cur || p.at > cur.at) m.set(p.email, p);
    }
    return [...m.values()].sort((a, b) => a.name.localeCompare(b.name));
  }, [peers]);

  return { online, onlineCount: online.length };
}
