'use client';

import { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import { createSupabaseClient } from '@/lib/supabase';

/**
 * Global Ctrl/Cmd+K search across the whole product:
 * - Components → Insights Cost Lookup, pre-searched
 * - Project quotes → the quote editor
 * - Suppliers → Catalog deal lookup
 * Self-contained: fetches its own slim datasets the first time it opens.
 */

interface Item {
  kind: 'component' | 'quote' | 'supplier';
  id: string;
  title: string;
  sub: string;
  href: string;
}

const KIND_META: Record<Item['kind'], { label: string; badge: string }> = {
  component: { label: 'Components',     badge: 'bg-emerald-500/15 text-emerald-300' },
  quote:     { label: 'Project Quotes', badge: 'bg-violet-500/15 text-violet-300' },
  supplier:  { label: 'Suppliers',      badge: 'bg-sky-500/15 text-sky-300' },
};

export default function CommandPalette() {
  const supabase = createSupabaseClient();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [index, setIndex] = useState(0);
  const [items, setItems] = useState<Item[] | null>(null); // null = not fetched yet
  const inputRef = useRef<HTMLInputElement>(null);

  // Ctrl/Cmd+K anywhere
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setOpen((v) => !v);
      }
      if (e.key === 'Escape') setOpen(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  useEffect(() => {
    if (open) {
      setQuery('');
      setIndex(0);
      setTimeout(() => inputRef.current?.focus({ preventScroll: true }), 0);
    }
  }, [open]);

  // Fetch slim datasets on first open
  const loadData = useCallback(async () => {
    const fetchAllComponents = async () => {
      const PAGE = 1000;
      let all: { component_id: string; supplier_model: string; brand: string | null; category: string | null }[] = [];
      let from = 0;
      for (;;) {
        const { data: page } = await supabase.from('3.0_components')
          .select('component_id, supplier_model, brand, category')
          .order('supplier_model').range(from, from + PAGE - 1);
        if (!page || page.length === 0) break;
        all = all.concat(page);
        if (page.length < PAGE) break;
        from += PAGE;
      }
      return all;
    };
    const [comps, quotes, suppliers] = await Promise.all([
      fetchAllComponents(),
      supabase.from('10.0_project_quotes').select('quote_id, quote_number, customer_name, status').order('quote_date', { ascending: false }).limit(500),
      supabase.from('2.0_suppliers').select('supplier_id, supplier_name, supplier_code'),
    ]);
    const list: Item[] = [
      ...comps.map((c) => ({
        kind: 'component' as const,
        id: c.component_id,
        title: c.supplier_model || '(no model)',
        sub: [c.brand, c.category].filter(Boolean).join(' · '),
        href: `/insights?tab=lookup&q=${encodeURIComponent(c.supplier_model ?? '')}`,
      })),
      ...(quotes.data ?? []).map((q) => ({
        kind: 'quote' as const,
        id: q.quote_id as string,
        title: (q.quote_number as string) || '(no number)',
        sub: [(q.customer_name as string) || 'No customer', ((q.status as string) || 'draft').toUpperCase()].join(' · '),
        href: `/quotes/${q.quote_id}`,
      })),
      ...(suppliers.data ?? []).map((s) => ({
        kind: 'supplier' as const,
        id: s.supplier_id as string,
        title: (s.supplier_name as string) || '(no name)',
        sub: (s.supplier_code as string) || 'Supplier',
        href: `/catalog?tab=lookup`,
      })),
    ];
    setItems(list);
  }, []);

  useEffect(() => {
    if (open && items === null) loadData();
  }, [open, items, loadData]);

  const results = useMemo(() => {
    if (!items) return [];
    const q = query.trim().toLowerCase();
    if (q.length < 2) return [];
    const matched = items.filter((i) =>
      i.title.toLowerCase().includes(q) || i.sub.toLowerCase().includes(q));
    // Quotes first (fewest, most specific), then components, then suppliers
    const order: Item['kind'][] = ['quote', 'component', 'supplier'];
    matched.sort((a, b) => order.indexOf(a.kind) - order.indexOf(b.kind));
    return matched.slice(0, 12);
  }, [items, query]);

  useEffect(() => { setIndex(0); }, [query]);

  function go(item: Item) {
    setOpen(false);
    window.location.assign(item.href);
  }

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[100] bg-black/60 flex items-start justify-center pt-[15vh] px-4" onClick={() => setOpen(false)}>
      <div className="w-full max-w-xl bg-slate-900 border border-slate-700 rounded-2xl shadow-2xl overflow-hidden" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center gap-3 px-4 py-3 border-b border-slate-800">
          <svg className="w-4 h-4 text-slate-500 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M21 21l-4.35-4.35M17 11a6 6 0 11-12 0 6 6 0 0112 0z" /></svg>
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'ArrowDown') { e.preventDefault(); setIndex((i) => Math.min(i + 1, results.length - 1)); }
              else if (e.key === 'ArrowUp') { e.preventDefault(); setIndex((i) => Math.max(i - 1, 0)); }
              else if (e.key === 'Enter' && results[index]) go(results[index]);
            }}
            placeholder="Search components, project quotes, suppliers…"
            className="flex-1 bg-transparent outline-none text-white text-sm placeholder:text-slate-600"
          />
          <kbd className="text-[10px] text-slate-600 border border-slate-700 rounded px-1.5 py-0.5">Esc</kbd>
        </div>

        <div className="max-h-[50vh] overflow-y-auto">
          {items === null && <p className="px-4 py-6 text-sm text-slate-500 text-center">Loading index…</p>}
          {items !== null && query.trim().length < 2 && (
            <p className="px-4 py-6 text-xs text-slate-600 text-center">
              Type at least 2 characters — components open in Cost Lookup, quotes open in the editor.
            </p>
          )}
          {items !== null && query.trim().length >= 2 && results.length === 0 && (
            <p className="px-4 py-6 text-sm text-slate-500 text-center">No matches for “{query}”.</p>
          )}
          {results.map((r, i) => (
            <button
              key={`${r.kind}-${r.id}`}
              onClick={() => go(r)}
              onMouseEnter={() => setIndex(i)}
              className={`w-full text-left px-4 py-2.5 flex items-center gap-3 transition-colors ${i === index ? 'bg-slate-800' : ''}`}
            >
              <span className={`px-1.5 py-0.5 rounded text-[9px] font-bold uppercase flex-shrink-0 ${KIND_META[r.kind].badge}`}>
                {r.kind === 'component' ? 'Item' : r.kind === 'quote' ? 'Quote' : 'Supplier'}
              </span>
              <span className="min-w-0 flex-1">
                <span className="block text-sm text-slate-200 truncate">{r.title}</span>
                <span className="block text-[11px] text-slate-500 truncate">{r.sub}</span>
              </span>
              <span className="text-[10px] text-slate-600 flex-shrink-0">↵</span>
            </button>
          ))}
        </div>

        <div className="px-4 py-2 border-t border-slate-800 text-[10px] text-slate-600 flex gap-4">
          <span>↑↓ navigate</span><span>↵ open</span><span>Esc close</span>
        </div>
      </div>
    </div>
  );
}
