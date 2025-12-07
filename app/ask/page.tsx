'use client';

import { useState, useRef, useEffect } from 'react';

export default function AskPage() {
  const [query, setQuery] = useState('');
  const [messages, setMessages] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);

  // Auto-scroll to bottom
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!query.trim()) return;

    setLoading(true);
    setMessages(prev => [...prev, { role: 'user', content: query }]);
    
    try {
      const response = await fetch('/api/ask', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ query }),
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
      setQuery('');
    }
  };

  return (
    <div className="min-h-screen bg-slate-900 text-slate-100 font-sans flex flex-col">
      <div className="container mx-auto px-4 py-8 max-w-5xl flex-1 flex flex-col">
        
        {/* Header */}
        <h1 className="text-3xl font-bold mb-8 text-white flex items-center gap-3">
          <span className="text-emerald-500 text-4xl">🤖</span> 
          <span>AI Query Assistant</span>
        </h1>
        
        {/* Chat Container */}
        <div className="flex-1 bg-slate-800 rounded-lg shadow-xl border border-slate-700 p-6 flex flex-col space-y-4 max-h-[70vh]">
          
          {/* Messages Area */}
          <div 
            ref={scrollRef}
            className="flex-1 overflow-y-auto space-y-6 pr-2 scrollbar-thin scrollbar-thumb-slate-600 scrollbar-track-transparent"
          >
            {messages.length === 0 ? (
              <div className="h-full flex flex-col items-center justify-center text-slate-500 opacity-60">
                <div className="text-6xl mb-4">💬</div>
                <p>Ask about pricing history, true costs, or supplier spend...</p>
              </div>
            ) : (
              messages.map((msg, idx) => (
                <div key={idx} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                  <div className={`max-w-[85%] rounded-2xl px-5 py-4 shadow-md ${
                    msg.role === 'user' 
                    ? 'bg-emerald-600 text-white rounded-br-none' 
                    : 'bg-slate-700 text-slate-100 rounded-bl-none border border-slate-600 font-mono text-sm whitespace-pre-wrap overflow-x-auto'
                  }`}>
                    {msg.content}
                  </div>
                </div>
              ))
            )}
            
            {loading && (
              <div className="flex justify-start">
                <div className="bg-slate-700 border border-slate-600 rounded-2xl rounded-bl-none px-5 py-4 flex items-center gap-2 text-slate-300">
                  <div className="w-2 h-2 bg-emerald-500 rounded-full animate-bounce"></div>
                  <div className="w-2 h-2 bg-emerald-500 rounded-full animate-bounce delay-75"></div>
                  <div className="w-2 h-2 bg-emerald-500 rounded-full animate-bounce delay-150"></div>
                </div>
              </div>
            )}
          </div>

          {/* Input Area */}
          <form onSubmit={handleSubmit} className="mt-4 pt-4 border-t border-slate-700">
            <div className="relative">
              <textarea
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !e.shiftKey) {
                    e.preventDefault();
                    handleSubmit(e);
                  }
                }}
                placeholder="Ex: Compare min and max price for MCB components..."
                className="w-full bg-slate-900 text-white placeholder-slate-500 border border-slate-600 rounded-xl p-4 pr-14 focus:ring-2 focus:ring-emerald-500 focus:border-transparent outline-none resize-none h-20 shadow-inner"
              />
              <button
                type="submit"
                disabled={loading || !query.trim()}
                className="absolute right-3 top-3 p-2 bg-emerald-600 hover:bg-emerald-500 text-white rounded-lg transition-all disabled:opacity-50 disabled:cursor-not-allowed shadow-lg"
              >
                <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" className="w-6 h-6">
                  <path d="M3.478 2.404a.75.75 0 00-.926.941l2.432 7.905H13.5a.75.75 0 010 1.5H4.984l-2.432 7.905a.75.75 0 00.926.94 60.519 60.519 0 0018.445-8.986.75.75 0 000-1.218A60.517 60.517 0 003.478 2.404z" />
                </svg>
              </button>
            </div>
            <p className="text-xs text-slate-500 mt-2 text-right">
              Press <span className="font-bold text-slate-400">Enter</span> to send, Shift+Enter for new line
            </p>
          </form>

        </div>
      </div>
    </div>
  );
}
