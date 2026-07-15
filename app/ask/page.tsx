'use client';

import { useState, useRef, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { createSupabaseClient } from '@/lib/supabase';
import { useAuth } from '@/hooks/useAuth';
import BrandMenu from '@/components/ui/BrandMenu';

interface ChatMessage { role: 'user' | 'assistant'; content: string; error?: boolean }

const SUGGESTIONS = [
  'Which project quotes are still in draft, and what are they worth?',
  'Compare the min and max true unit cost for MCBs',
  'Which supplier has the best delivery performance this year?',
  'What is still outstanding to pay across active POs?',
];

// Minimal inline markdown: **bold** only — enough to make answers scannable
function renderInline(text: string) {
  const parts = text.split(/\*\*(.+?)\*\*/g);
  return parts.map((p, i) => (i % 2 === 1 ? <strong key={i} className="text-white font-semibold">{p}</strong> : p));
}

export default function AskPage() {
  const supabase = createSupabaseClient();
  const router = useRouter();
  const { user, profile, loading: authLoading, signOut } = useAuth();

  const [query, setQuery] = useState('');
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [loading, setLoading] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // Company data behind this — sign-in required (any role may ask)
  useEffect(() => {
    if (!authLoading && !user) router.replace('/login?next=/ask');
  }, [authLoading, user]);

  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
  }, [messages, loading]);

  useEffect(() => {
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto';
      textareaRef.current.style.height = `${Math.min(textareaRef.current.scrollHeight, 150)}px`;
    }
  }, [query]);

  const handleSubmit = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    if (!query.trim() || loading) return;

    const currentQuery = query.trim();
    const priorHistory = messages.filter((m) => !m.error).slice(-8);
    setQuery('');
    setLoading(true);
    setMessages((prev) => [...prev, { role: 'user', content: currentQuery }]);
    if (textareaRef.current) textareaRef.current.style.height = 'auto';

    try {
      const { data: { session } } = await supabase.auth.getSession();
      const response = await fetch('/api/ask', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${session?.access_token ?? ''}`,
        },
        body: JSON.stringify({ query: currentQuery, history: priorHistory }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || `HTTP ${response.status}`);
      setMessages((prev) => [...prev, { role: 'assistant', content: data.answer ?? 'No answer.' }]);
    } catch (error) {
      setMessages((prev) => [...prev, {
        role: 'assistant',
        error: true,
        content: `Something went wrong: ${error instanceof Error ? error.message : 'unknown error'}. Please try again.`,
      }]);
    } finally {
      setLoading(false);
    }
  };

  if (authLoading || !user) {
    return (
      <div className="min-h-screen bg-[#141518] flex items-center justify-center">
        <div className="w-6 h-6 border-2 border-emerald-500/30 border-t-emerald-500 rounded-full animate-spin" />
      </div>
    );
  }

  return (
    <div className="flex flex-col h-screen bg-[#141518] text-slate-200 font-sans text-sm overflow-hidden">

      {/* ── Header (house style) ── */}
      <div className="flex-none sticky top-0 z-40 bg-[#141518]/90 backdrop-blur-xl border-b border-white/[0.07]">
        <div className="max-w-4xl mx-auto px-6 py-4 flex items-center justify-between gap-4">
          <BrandMenu wordmarkClass="text-xl font-bold" subtitle="AI Assistant · Supply chain & quotes" />
          <div className="flex items-center gap-4">
            {profile && (
              <div className="text-right hidden sm:block">
                <p className="text-[11px] text-slate-400 leading-tight">{profile.email}</p>
                <button onClick={() => signOut()} className="text-[10px] text-slate-600 hover:text-slate-300 underline transition-colors">
                  Sign out
                </button>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* ── Chat ── */}
      <main className="flex-1 overflow-hidden flex flex-col max-w-4xl mx-auto w-full">
        <div ref={scrollRef} className="flex-1 overflow-y-auto px-6 py-6 space-y-4 scroll-smooth">
          {messages.length === 0 ? (
            <div className="h-full flex flex-col items-center justify-center px-4">
              <h3 className="text-base font-semibold text-white mb-2">Ask about your data</h3>
              <p className="text-xs text-slate-500 max-w-md text-center mb-8">
                Pricing history, supplier performance, outstanding payments, landed costs — and your
                project quotes: status, value, and who worked on them.
              </p>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5 w-full max-w-2xl">
                {SUGGESTIONS.map((text) => (
                  <button
                    key={text}
                    onClick={() => { setQuery(text); setTimeout(() => textareaRef.current?.focus(), 0); }}
                    className="text-left text-xs p-3.5 bg-slate-900/50 border border-slate-800 hover:border-slate-600 hover:bg-slate-900/80 rounded-2xl transition-colors text-slate-300 hover:text-white"
                  >
                    {text}
                  </button>
                ))}
              </div>
            </div>
          ) : (
            messages.map((msg, idx) => (
              <div key={idx} className={`flex w-full ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                <div
                  className={`max-w-[85%] rounded-2xl px-4 py-3 leading-relaxed ${
                    msg.role === 'user'
                      ? 'bg-violet-600 text-white rounded-br-md'
                      : msg.error
                      ? 'bg-red-500/10 border border-red-500/30 text-red-300 rounded-bl-md'
                      : 'bg-slate-900/70 border border-slate-800 text-slate-200 rounded-bl-md'
                  }`}
                >
                  {msg.role === 'assistant' ? (
                    <div className={`whitespace-pre-wrap overflow-x-auto ${msg.content.includes('|') ? 'font-mono text-xs' : 'text-sm'}`}>
                      {renderInline(msg.content)}
                    </div>
                  ) : (
                    <div className="break-words text-sm">{msg.content}</div>
                  )}
                </div>
              </div>
            ))
          )}

          {loading && (
            <div className="flex w-full justify-start">
              <div className="bg-slate-900/70 border border-slate-800 rounded-2xl rounded-bl-md px-4 py-3.5 flex items-center gap-1.5">
                <span className="w-1.5 h-1.5 bg-emerald-400 rounded-full animate-bounce" style={{ animationDelay: '0ms' }} />
                <span className="w-1.5 h-1.5 bg-emerald-400 rounded-full animate-bounce" style={{ animationDelay: '150ms' }} />
                <span className="w-1.5 h-1.5 bg-emerald-400 rounded-full animate-bounce" style={{ animationDelay: '300ms' }} />
              </div>
            </div>
          )}
          <div className="h-2" />
        </div>

        {/* ── Input ── */}
        <div className="flex-none px-6 pb-5 pt-2">
          <div className="flex items-end gap-2 bg-slate-900/70 p-2 rounded-2xl border border-slate-800 focus-within:border-emerald-500/60 transition-colors">
            <textarea
              ref={textareaRef}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSubmit(); }
              }}
              placeholder="Ask about POs, suppliers, costs, or project quotes…"
              className="w-full bg-transparent text-white placeholder:text-slate-600 text-sm px-2.5 py-2 min-h-[40px] max-h-[150px] outline-none resize-none"
              rows={1}
            />
            <button
              onClick={() => handleSubmit()}
              disabled={loading || !query.trim()}
              className="mb-0.5 px-4 py-2 bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-semibold rounded-xl transition-colors disabled:opacity-40 disabled:cursor-not-allowed flex-shrink-0"
            >
              Send
            </button>
          </div>
          <p className="text-[10px] text-slate-600 text-center mt-2">
            AI can make mistakes — verify important figures. Enter to send · Shift+Enter for a new line
          </p>
        </div>
      </main>
    </div>
  );
}
