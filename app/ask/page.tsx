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
      // Optional: auto-submit? Let's just set it for now so they can edit.
      // If you want auto-submit, uncomment next line:
      // handleSubmit(); 
  };

  return (
    <div className="flex flex-col h-screen bg-slate-950 text-slate-100 font-sans overflow-hidden">
      
      {/* === HEADER === */}
      <header className="flex-none bg-slate-900 border-b border-slate-800 p-4 md:p-6 shadow-md z-10">
        <div className="max-w-5xl mx-auto flex items-center justify-between">
            <h1 className="text-xl md:text-2xl font-bold text-white flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-emerald-500 to-teal-600 flex items-center justify-center shadow-lg shadow-emerald-900/20">
                <span className="text-2xl">🤖</span>
            </div>
            <div className="flex flex-col">
                <span className="leading-none">ICA AI</span>
                <span className="text-xs font-mono text-emerald-500 font-normal mt-1 opacity-80">Version 1.0</span>
            </div>
            </h1>
            <div className="hidden md:block text-xs text-slate-500 bg-slate-800 px-3 py-1 rounded-full border border-slate-700">
                Powered by Supabase & OpenAI
            </div>
        </div>
      </header>

      {/* === MAIN CHAT AREA === */}
      <main className="flex-1 overflow-hidden relative flex flex-col max-w-5xl mx-auto w-full">
        
        {/* Messages Scroll Container */}
        <div 
          ref={scrollRef}
          className="flex-1 overflow-y-auto p-4 md:p-6 space-y-6 scrollbar-thin scrollbar-thumb-slate-700 scrollbar-track-transparent scroll-smooth"
        >
          {messages.length === 0 ? (
            <div className="h-full flex flex-col items-center justify-center text-slate-500 opacity-100 animate-in fade-in zoom-in-95 duration-500">
              <div className="w-20 h-20 bg-slate-900 rounded-full flex items-center justify-center mb-6 border border-slate-800 shadow-xl">
                 <span className="text-4xl grayscale opacity-50">✨</span>
              </div>
              <h3 className="text-lg font-medium text-slate-300 mb-2">How can I help you today?</h3>
              <p className="text-sm text-slate-500 max-w-sm text-center mb-8">
                Ask about pricing history, supplier spend analysis, or component details.
              </p>
              
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3 w-full max-w-lg">
                {[
                    "Compare min/max price for MCB",
                    "Show total spend by Supplier A",
                    "List latest POs for Batteries",
                    "Analyze price trend for Solar Panels"
                ].map((text, i) => (
                    <button 
                        key={i}
                        onClick={() => handleChipClick(text)}
                        className="text-left text-xs md:text-sm p-3 bg-slate-900 border border-slate-800 hover:border-emerald-500/50 hover:bg-slate-800 rounded-xl transition-all text-slate-400 hover:text-emerald-400 group"
                    >
                        <span className="mr-2 opacity-50 group-hover:opacity-100">💡</span> {text}
                    </button>
                ))}
              </div>
            </div>
          ) : (
            messages.map((msg, idx) => (
              <div key={idx} className={`flex w-full ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                <div className={`flex max-w-[90%] md:max-w-[80%] gap-3 ${msg.role === 'user' ? 'flex-row-reverse' : 'flex-row'}`}>
                    
                    {/* Avatar */}
                    <div className={`flex-shrink-0 w-8 h-8 rounded-full flex items-center justify-center shadow-sm mt-1 ${
                        msg.role === 'user' ? 'bg-indigo-600 text-white' : 'bg-emerald-600 text-white'
                    }`}>
                        {msg.role === 'user' ? '👤' : '🤖'}
                    </div>

                    {/* Bubble */}
                    <div className={`rounded-2xl px-5 py-3.5 shadow-md text-sm md:text-base leading-relaxed ${
                        msg.role === 'user' 
                        ? 'bg-indigo-600 text-white rounded-tr-none' 
                        : 'bg-slate-800 text-slate-200 rounded-tl-none border border-slate-700/50'
                    }`}>
                        {msg.role === 'assistant' ? (
                             // Render markdown-like content safely (simple approach) or pre-wrap for data tables
                            <div className="whitespace-pre-wrap font-mono text-xs md:text-sm overflow-x-auto custom-scrollbar">
                                {msg.content}
                            </div>
                        ) : (
                            <div>{msg.content}</div>
                        )}
                    </div>
                </div>
              </div>
            ))
          )}
          
          {loading && (
             <div className="flex w-full justify-start">
                <div className="flex gap-3 max-w-[80%]">
                    <div className="w-8 h-8 rounded-full bg-emerald-600 flex items-center justify-center shadow-sm mt-1">🤖</div>
                    <div className="bg-slate-800 border border-slate-700/50 rounded-2xl rounded-tl-none px-5 py-4 flex items-center gap-1.5 shadow-md">
                        <span className="w-1.5 h-1.5 bg-emerald-500 rounded-full animate-bounce"></span>
                        <span className="w-1.5 h-1.5 bg-emerald-500 rounded-full animate-bounce delay-75"></span>
                        <span className="w-1.5 h-1.5 bg-emerald-500 rounded-full animate-bounce delay-150"></span>
                    </div>
                </div>
             </div>
          )}
          <div className="h-4" /> {/* Spacer */}
        </div>

        {/* === INPUT AREA === */}
        <div className="p-4 bg-slate-900 border-t border-slate-800 z-20">
            <div className="max-w-4xl mx-auto relative flex items-end gap-2 bg-slate-950 p-2 rounded-2xl border border-slate-800 shadow-lg focus-within:border-emerald-500/50 focus-within:ring-1 focus-within:ring-emerald-500/50 transition-all">
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
                    className="w-full bg-transparent text-white placeholder-slate-500 text-sm md:text-base p-3 min-h-[50px] max-h-[150px] outline-none resize-none scrollbar-hide"
                    rows={1}
                />
                <button
                    onClick={(e) => handleSubmit(e as any)}
                    disabled={loading || !query.trim()}
                    className="mb-1 p-2.5 bg-emerald-600 hover:bg-emerald-500 text-white rounded-xl transition-all disabled:opacity-50 disabled:bg-slate-800 disabled:text-slate-500 flex-shrink-0 active:scale-95"
                >
                    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" className="w-5 h-5">
                        <path d="M3.478 2.404a.75.75 0 00-.926.941l2.432 7.905H13.5a.75.75 0 010 1.5H4.984l-2.432 7.905a.75.75 0 00.926.94 60.519 60.519 0 0018.445-8.986.75.75 0 000-1.218A60.517 60.517 0 003.478 2.404z" />
                    </svg>
                </button>
            </div>
            <p className="text-[10px] text-slate-500 text-center mt-3 hidden md:block">
                AI can make mistakes. Please verify important financial data.
            </p>
        </div>

      </main>
    </div>
  );
}