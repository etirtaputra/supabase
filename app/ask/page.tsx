'use client';

import { useState, useRef, useEffect } from 'react';

export default function AskPage() {
  const [query, setQuery] = useState('');
  const [messages, setMessages] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // Auto-scroll to bottom whenever messages change
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages, loading]);

  // Auto-resize textarea based on content
  useEffect(() => {
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto';
      const newHeight = Math.min(textareaRef.current.scrollHeight, 150);
      textareaRef.current.style.height = `${newHeight}px`;
    }
  }, [query]);

  const handleSubmit = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    if (!query.trim() || loading) return;

    const currentQuery = query;
    setQuery(''); // Clear input immediately
    setLoading(true);
    setMessages(prev => [...prev, { role: 'user', content: currentQuery }]);

    // Reset height of textarea
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto';
    }

    try {
      const response = await fetch('/api/ask', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ query: currentQuery }),
      });

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }

      const data = await response.json();

      setMessages(prev => [...prev, {
        role: 'assistant',
        content: data.error ? `❌ Error: ${data.error}` : data.answer
      }]);
    } catch (error) {
      console.error('Fetch error:', error);
      setMessages(prev => [...prev, {
        role: 'assistant',
        content: `❌ Network error: ${error instanceof Error ? error.message : 'Unknown'}`
      }]);
    } finally {
      setLoading(false);
    }
  };

  // Helper to allow submitting by clicking suggestion chips
  const handleChipClick = (text: string) => {
    setQuery(text);
    // Focus textarea after setting query
    setTimeout(() => textareaRef.current?.focus(), 0);
  };

  // Format assistant message for better readability
  const formatMessage = (content: string) => {
    // Check if content contains table-like structure or code
    if (content.includes('|') || content.includes('```')) {
      return content;
    }
    return content;
  };

  return (
    <div className="flex flex-col h-screen bg-gradient-to-br from-slate-950 via-slate-900 to-slate-950 text-slate-100 font-sans overflow-hidden">

      {/* === HEADER === */}
      <header className="flex-none bg-slate-900/80 backdrop-blur-xl border-b border-slate-800/50 p-3 md:p-5 shadow-2xl z-10">
        <div className="max-w-6xl mx-auto flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 md:w-12 md:h-12 rounded-xl bg-gradient-to-br from-emerald-500 via-teal-500 to-cyan-600 flex items-center justify-center shadow-lg shadow-emerald-900/30 ring-2 ring-emerald-500/20">
              <span className="text-xl md:text-2xl">🤖</span>
            </div>
            <div className="flex flex-col">
              <h1 className="text-lg md:text-2xl font-bold text-white leading-none tracking-tight">
                ICA AI Assistant
              </h1>
              <span className="text-[10px] md:text-xs font-mono text-emerald-400 font-normal mt-0.5 md:mt-1 opacity-80">
                Supply Chain Intelligence
              </span>
            </div>
          </div>
          <div className="hidden sm:flex items-center gap-2">
            <div className="text-[10px] md:text-xs text-slate-400 bg-slate-800/50 px-2 md:px-3 py-1 md:py-1.5 rounded-full border border-slate-700/50 backdrop-blur-sm">
              <span className="hidden md:inline">Powered by </span>Supabase & OpenAI
            </div>
            <div className="w-2 h-2 bg-emerald-500 rounded-full animate-pulse shadow-lg shadow-emerald-500/50"></div>
          </div>
        </div>
      </header>

      {/* === MAIN CHAT AREA === */}
      <main className="flex-1 overflow-hidden relative flex flex-col max-w-6xl mx-auto w-full">

        {/* Messages Scroll Container */}
        <div
          ref={scrollRef}
          className="flex-1 overflow-y-auto p-3 md:p-6 space-y-4 md:space-y-6 scrollbar-thin scrollbar-thumb-slate-700 scrollbar-track-transparent scroll-smooth"
          style={{
            scrollbarWidth: 'thin',
            scrollbarColor: '#475569 transparent'
          }}
        >
          {messages.length === 0 ? (
            <div className="h-full flex flex-col items-center justify-center text-slate-500 opacity-100 animate-in fade-in zoom-in-95 duration-500 px-4">
              <div className="w-16 h-16 md:w-20 md:h-20 bg-gradient-to-br from-slate-800 to-slate-900 rounded-2xl flex items-center justify-center mb-4 md:mb-6 border border-slate-700/50 shadow-2xl ring-1 ring-slate-700/30">
                <span className="text-3xl md:text-4xl">✨</span>
              </div>
              <h3 className="text-base md:text-lg font-semibold text-slate-200 mb-2">How can I help you today?</h3>
              <p className="text-xs md:text-sm text-slate-400 max-w-md text-center mb-6 md:mb-8 px-4">
                Ask about pricing history, supplier spend analysis, component details, or any supply chain insights.
              </p>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 md:gap-3 w-full max-w-2xl px-2">
                {[
                  { icon: "📊", text: "Compare min/max price for MCB" },
                  { icon: "💰", text: "Show total spend by Supplier A" },
                  { icon: "📦", text: "List latest POs for Batteries" },
                  { icon: "📈", text: "Analyze price trend for Solar Panels" }
                ].map((item, i) => (
                  <button
                    key={i}
                    onClick={() => handleChipClick(item.text)}
                    className="text-left text-xs md:text-sm p-3 md:p-4 bg-slate-800/50 border border-slate-700/50 hover:border-emerald-500/50 hover:bg-slate-800 rounded-xl md:rounded-2xl transition-all duration-200 text-slate-300 hover:text-emerald-300 group backdrop-blur-sm hover:shadow-lg hover:shadow-emerald-500/10 active:scale-[0.98]"
                  >
                    <span className="text-base md:text-lg mr-2 opacity-70 group-hover:opacity-100 transition-opacity">{item.icon}</span>
                    <span className="line-clamp-2">{item.text}</span>
                  </button>
                ))}
              </div>
            </div>
          ) : (
            messages.map((msg, idx) => (
              <div
                key={idx}
                className={`flex w-full animate-in fade-in slide-in-from-bottom-4 duration-300 ${
                  msg.role === 'user' ? 'justify-end' : 'justify-start'
                }`}
                style={{ animationDelay: `${idx * 50}ms` }}
              >
                <div className={`flex max-w-[95%] sm:max-w-[85%] lg:max-w-[75%] gap-2 md:gap-3 ${
                  msg.role === 'user' ? 'flex-row-reverse' : 'flex-row'
                }`}>

                  {/* Avatar */}
                  <div className={`flex-shrink-0 w-7 h-7 md:w-9 md:h-9 rounded-full flex items-center justify-center shadow-md mt-1 ring-2 ${
                    msg.role === 'user'
                      ? 'bg-gradient-to-br from-indigo-600 to-purple-600 ring-indigo-500/30'
                      : 'bg-gradient-to-br from-emerald-600 to-teal-600 ring-emerald-500/30'
                  }`}>
                    <span className="text-sm md:text-base">{msg.role === 'user' ? '👤' : '🤖'}</span>
                  </div>

                  {/* Bubble */}
                  <div className={`rounded-2xl md:rounded-3xl px-3 py-2.5 md:px-5 md:py-3.5 shadow-lg text-xs sm:text-sm md:text-base leading-relaxed ${
                    msg.role === 'user'
                      ? 'bg-gradient-to-br from-indigo-600 to-indigo-700 text-white rounded-tr-sm md:rounded-tr-md shadow-indigo-900/30'
                      : 'bg-slate-800/90 text-slate-100 rounded-tl-sm md:rounded-tl-md border border-slate-700/50 backdrop-blur-sm shadow-slate-900/50'
                  }`}>
                    {msg.role === 'assistant' ? (
                      <div className="whitespace-pre-wrap font-mono text-[10px] sm:text-xs md:text-sm overflow-x-auto custom-scrollbar">
                        {formatMessage(msg.content)}
                      </div>
                    ) : (
                      <div className="break-words">{msg.content}</div>
                    )}
                  </div>
                </div>
              </div>
            ))
          )}

          {loading && (
            <div className="flex w-full justify-start animate-in fade-in slide-in-from-bottom-4 duration-300">
              <div className="flex gap-2 md:gap-3 max-w-[85%]">
                <div className="w-7 h-7 md:w-9 md:h-9 rounded-full bg-gradient-to-br from-emerald-600 to-teal-600 flex items-center justify-center shadow-md ring-2 ring-emerald-500/30 mt-1">
                  <span className="text-sm md:text-base">🤖</span>
                </div>
                <div className="bg-slate-800/90 border border-slate-700/50 rounded-2xl md:rounded-3xl rounded-tl-sm md:rounded-tl-md px-4 md:px-5 py-3 md:py-4 flex items-center gap-1.5 shadow-lg backdrop-blur-sm">
                  <span className="w-1.5 h-1.5 md:w-2 md:h-2 bg-emerald-400 rounded-full animate-bounce" style={{ animationDelay: '0ms' }}></span>
                  <span className="w-1.5 h-1.5 md:w-2 md:h-2 bg-emerald-400 rounded-full animate-bounce" style={{ animationDelay: '150ms' }}></span>
                  <span className="w-1.5 h-1.5 md:w-2 md:h-2 bg-emerald-400 rounded-full animate-bounce" style={{ animationDelay: '300ms' }}></span>
                </div>
              </div>
            </div>
          )}
          <div className="h-2 md:h-4" /> {/* Spacer */}
        </div>

        {/* === INPUT AREA === */}
        <div className="p-3 md:p-4 bg-slate-900/80 backdrop-blur-xl border-t border-slate-800/50 z-20 shadow-2xl">
          <div className="max-w-4xl mx-auto">
            <div className="relative flex items-end gap-2 bg-slate-800/50 p-2 md:p-2.5 rounded-xl md:rounded-2xl border border-slate-700/50 shadow-xl focus-within:border-emerald-500/50 focus-within:ring-2 focus-within:ring-emerald-500/20 transition-all backdrop-blur-sm">
              <textarea
                ref={textareaRef}
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !e.shiftKey) {
                    e.preventDefault();
                    handleSubmit();
                  }
                }}
                placeholder="Ask anything about your supply chain data..."
                className="w-full bg-transparent text-white placeholder-slate-500 text-xs sm:text-sm md:text-base p-2 md:p-3 min-h-[44px] md:min-h-[50px] max-h-[120px] md:max-h-[150px] outline-none resize-none scrollbar-hide"
                rows={1}
                style={{
                  height: 'auto',
                  overflowY: query.split('\n').length > 3 ? 'auto' : 'hidden'
                }}
              />
              <button
                onClick={(e) => handleSubmit(e as any)}
                disabled={loading || !query.trim()}
                className="mb-0.5 md:mb-1 p-2 md:p-2.5 bg-gradient-to-br from-emerald-600 to-emerald-700 hover:from-emerald-500 hover:to-emerald-600 text-white rounded-lg md:rounded-xl transition-all duration-200 disabled:opacity-40 disabled:from-slate-700 disabled:to-slate-800 disabled:text-slate-500 disabled:cursor-not-allowed flex-shrink-0 active:scale-95 shadow-lg shadow-emerald-900/30 hover:shadow-emerald-900/50"
                aria-label="Send message"
              >
                <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" className="w-4 h-4 md:w-5 md:h-5">
                  <path d="M3.478 2.404a.75.75 0 00-.926.941l2.432 7.905H13.5a.75.75 0 010 1.5H4.984l-2.432 7.905a.75.75 0 00.926.94 60.519 60.519 0 0018.445-8.986.75.75 0 000-1.218A60.517 60.517 0 003.478 2.404z" />
                </svg>
              </button>
            </div>
            <p className="text-[9px] md:text-[10px] text-slate-500 text-center mt-2 md:mt-3 opacity-70">
              AI can make mistakes. Please verify important financial data. • Press Enter to send, Shift+Enter for new line
            </p>
          </div>
        </div>

      </main>

      <style jsx global>{`
        .scrollbar-hide {
          -ms-overflow-style: none;
          scrollbar-width: none;
        }
        .scrollbar-hide::-webkit-scrollbar {
          display: none;
        }

        .custom-scrollbar {
          scrollbar-width: thin;
          scrollbar-color: #475569 transparent;
        }

        .custom-scrollbar::-webkit-scrollbar {
          height: 6px;
        }

        .custom-scrollbar::-webkit-scrollbar-track {
          background: transparent;
        }

        .custom-scrollbar::-webkit-scrollbar-thumb {
          background-color: #475569;
          border-radius: 3px;
        }

        @keyframes bounce {
          0%, 100% {
            transform: translateY(0);
          }
          50% {
            transform: translateY(-4px);
          }
        }

        .animate-bounce {
          animation: bounce 1s infinite;
        }
      `}</style>
    </div>
  );
}
