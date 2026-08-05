'use client';
import { useEffect, useRef, useState } from 'react';
import { usePathname } from 'next/navigation';
import { useAuth } from '@/hooks/useAuth';
import { useAppPresence } from '@/hooks/useAppPresence';
import { initials, firstName } from '@/lib/presence';

/**
 * "Who is online, looking at what" — the header pill next to the clock.
 * Green dot + count; click opens a panel listing every signed-in colleague
 * and the screen they are on right now (live, via app-wide presence).
 * Clicking a person's location opens that screen for you too.
 */
export default function OnlineUsers() {
  const pathname = usePathname();
  const { user, profile } = useAuth();
  const { online, onlineCount } = useAppPresence({
    email: profile?.email || user?.email || undefined,
    name: profile?.display_name || undefined,
    path: pathname,
  });
  const [open, setOpen] = useState(false);
  const boxRef = useRef<HTMLDivElement>(null);
  const selfEmail = profile?.email || user?.email || '';

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (boxRef.current && !boxRef.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => { document.removeEventListener('mousedown', onDown); document.removeEventListener('keydown', onKey); };
  }, [open]);

  if (!selfEmail || onlineCount === 0) return null;

  return (
    <div ref={boxRef} className="relative flex-shrink-0 print:hidden">
      <button onClick={() => setOpen((v) => !v)} aria-expanded={open}
        title={`${onlineCount} online — click to see who is looking at what`}
        className={`flex items-center gap-1.5 px-2 py-1 rounded-lg text-[11px] tabular-nums transition-colors ${
          open ? 'bg-slate-800 text-slate-200' : 'text-slate-500 hover:text-slate-300 hover:bg-slate-800/60'}`}>
        <span className="relative flex w-2 h-2">
          <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-40" />
          <span className="relative inline-flex rounded-full w-2 h-2 bg-emerald-400" />
        </span>
        {onlineCount}
      </button>

      {open && (
        <div className="absolute right-0 top-full mt-2 w-80 max-w-[90vw] rounded-xl bg-slate-900 border border-slate-700 shadow-2xl z-[90] overflow-hidden">
          <p className="px-3 pt-2.5 pb-1.5 text-[9px] font-bold uppercase tracking-widest text-slate-500 border-b border-slate-800">
            Online now — {onlineCount}
          </p>
          <div className="max-h-80 overflow-y-auto custom-scrollbar divide-y divide-slate-800/60">
            {online.map((p) => {
              const you = p.email === selfEmail;
              return (
                <div key={p.email} className="flex items-center gap-2.5 px-3 py-2">
                  <span className="w-6 h-6 rounded-full flex items-center justify-center text-[9px] font-bold text-slate-950 flex-shrink-0"
                    style={{ backgroundColor: p.color }} title={p.email}>
                    {initials(p.name, p.email)}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block text-xs text-slate-200 truncate">
                      {firstName(p.name, p.email)}{you && <span className="text-slate-500"> (you)</span>}
                    </span>
                    {you ? (
                      <span className="block text-[10px] text-slate-600 truncate">{p.title || p.path}</span>
                    ) : (
                      <a href={p.path} target="_blank" rel="noopener noreferrer"
                        title={`Open ${p.title || p.path} yourself`}
                        className="block text-[10px] text-slate-500 hover:text-emerald-300 truncate transition-colors">
                        {p.title || p.path}
                      </a>
                    )}
                  </span>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
