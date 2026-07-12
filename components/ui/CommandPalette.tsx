'use client';

import { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import { createSupabaseClient } from '@/lib/supabase';

/**
 * Global Ctrl/Cmd+I search — Spotlight-style, two levels deep.
 *
 * Root results: components, suppliers, project quotes, supplier quotes (PI)
 * and POs (searchable by number).
 * Press → on a supplier or component to drill into its latest PIs & POs;
 * Enter on a deal opens it in Catalog's Deal Lookup pre-searched, Enter on a
 * component opens Insights' Cost Lookup pre-searched.
 */

interface DealRef {
  kind: 'pi' | 'po';
  number: string;
  date: string;
  extra: string;   // supplier / status context
  href: string;
}

interface Item {
  kind: 'component' | 'quote' | 'supplier' | 'pi' | 'po';
  id: string;
  title: string;
  sub: string;
  href: string;
  drill?: DealRef[];   // present on suppliers & components: their latest deals
}

const KIND_BADGE: Record<Item['kind'] | DealRef['kind'], { label: string; cls: string }> = {
  component: { label: 'Item',     cls: 'bg-emerald-500/15 text-emerald-300' },
  quote:     { label: 'Quote',    cls: 'bg-violet-500/15 text-violet-300' },
  supplier:  { label: 'Supplier', cls: 'bg-sky-500/15 text-sky-300' },
  pi:        { label: 'PI',       cls: 'bg-blue-500/15 text-blue-300' },
  po:        { label: 'PO',       cls: 'bg-amber-500/15 text-amber-300' },
};

const dealLookupHref = (n: string) => `/catalog?tab=lookup&q=${encodeURIComponent(n)}`;

export default function CommandPalette() {
  const supabase = createSupabaseClient();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [index, setIndex] = useState(0);
  const [items, setItems] = useState<Item[] | null>(null); // null = not fetched yet
  const [drill, setDrill] = useState<{ title: string; refs: DealRef[] } | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // Ctrl/Cmd+I anywhere — I for ICAPROC
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && !e.shiftKey && !e.altKey && e.key.toLowerCase() === 'i') {
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
      setDrill(null);
      setTimeout(() => inputRef.current?.focus({ preventScroll: true }), 0);
    }
  }, [open]);

  // Fetch slim datasets on first open and build the index
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

    const [comps, projectQuotes, suppliers, pis, pos, piLines, poLines] = await Promise.all([
      fetchAllComponents(),
      supabase.from('10.0_project_quotes').select('quote_id, quote_number, customer_name, status').order('quote_date', { ascending: false }).limit(500),
      supabase.from('2.0_suppliers').select('supplier_id, supplier_name, supplier_code'),
      supabase.from('4.0_price_quotes').select('quote_id, pi_number, quote_date, supplier_id, status').order('quote_date', { ascending: false }).limit(1500),
      supabase.from('5.0_purchases').select('po_id, po_number, po_date, quote_id, status').order('po_date', { ascending: false }).limit(1500),
      supabase.from('4.1_price_quote_line_items').select('quote_id, component_id').limit(8000),
      supabase.from('5.1_purchase_line_items').select('po_id, component_id').limit(8000),
    ]);

    const supplierName = new Map((suppliers.data ?? []).map((s) => [s.supplier_id as string, (s.supplier_name as string) || '']));
    const piById = new Map((pis.data ?? []).map((q) => [q.quote_id as number, q]));

    // Deal refs per supplier and per component
    const bySupplier = new Map<string, DealRef[]>();
    const byComponent = new Map<string, DealRef[]>();
    const push = (map: Map<string, DealRef[]>, key: string, ref: DealRef) => {
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(ref);
    };

    const piRef = (q: any): DealRef => ({
      kind: 'pi',
      number: (q.pi_number as string) || `Quote ${q.quote_id}`,
      date: (q.quote_date as string) ?? '',
      extra: [supplierName.get(q.supplier_id as string), (q.status as string)].filter(Boolean).join(' · '),
      href: dealLookupHref((q.pi_number as string) || String(q.quote_id)),
    });
    const poRef = (p: any): DealRef => {
      const viaPi = p.quote_id != null ? piById.get(p.quote_id as number) : undefined;
      const sup = viaPi ? supplierName.get(viaPi.supplier_id as string) : '';
      return {
        kind: 'po',
        number: (p.po_number as string) || `PO ${p.po_id}`,
        date: (p.po_date as string) ?? '',
        extra: [sup, (p.status as string)].filter(Boolean).join(' · '),
        href: dealLookupHref((p.po_number as string) || String(p.po_id)),
      };
    };

    for (const q of pis.data ?? []) push(bySupplier, q.supplier_id as string, piRef(q));
    for (const p of pos.data ?? []) {
      const viaPi = p.quote_id != null ? piById.get(p.quote_id as number) : undefined;
      if (viaPi) push(bySupplier, viaPi.supplier_id as string, poRef(p));
    }
    const poById = new Map((pos.data ?? []).map((p) => [p.po_id as number, p]));
    for (const l of piLines.data ?? []) {
      const q = l.component_id ? piById.get(l.quote_id as number) : undefined;
      if (q && l.component_id) push(byComponent, l.component_id as string, piRef(q));
    }
    for (const l of poLines.data ?? []) {
      const p = l.component_id ? poById.get(l.po_id as number) : undefined;
      if (p && l.component_id) push(byComponent, l.component_id as string, poRef(p));
    }
    const finalize = (map: Map<string, DealRef[]>) => {
      for (const [k, refs] of map) {
        const seen = new Set<string>();
        map.set(k, refs
          .sort((a, b) => b.date.localeCompare(a.date))
          .filter((r) => { const key = r.kind + r.number; if (seen.has(key)) return false; seen.add(key); return true; })
          .slice(0, 10));
      }
    };
    finalize(bySupplier);
    finalize(byComponent);

    const list: Item[] = [
      ...comps.map((c) => ({
        kind: 'component' as const,
        id: c.component_id,
        title: c.supplier_model || '(no model)',
        sub: [c.brand, c.category].filter(Boolean).join(' · '),
        href: `/insights?tab=lookup&q=${encodeURIComponent(c.supplier_model ?? '')}`,
        drill: byComponent.get(c.component_id) ?? [],
      })),
      ...(projectQuotes.data ?? []).map((q) => ({
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
        href: dealLookupHref((s.supplier_name as string) || ''),
        drill: bySupplier.get(s.supplier_id as string) ?? [],
      })),
      ...(pis.data ?? []).map((q) => ({
        kind: 'pi' as const,
        id: String(q.quote_id),
        title: (q.pi_number as string) || `Quote ${q.quote_id}`,
        sub: ['Supplier quote', supplierName.get(q.supplier_id as string), q.quote_date as string].filter(Boolean).join(' · '),
        href: dealLookupHref((q.pi_number as string) || String(q.quote_id)),
      })),
      ...(pos.data ?? []).map((p) => ({
        kind: 'po' as const,
        id: String(p.po_id),
        title: (p.po_number as string) || `PO ${p.po_id}`,
        sub: ['Purchase order', p.po_date as string].filter(Boolean).join(' · '),
        href: dealLookupHref((p.po_number as string) || String(p.po_id)),
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
    const order: Item['kind'][] = ['quote', 'pi', 'po', 'component', 'supplier'];
    matched.sort((a, b) => {
      // Exact-prefix title matches first, then by kind
      const ap = a.title.toLowerCase().startsWith(q) ? 0 : 1;
      const bp = b.title.toLowerCase().startsWith(q) ? 0 : 1;
      if (ap !== bp) return ap - bp;
      return order.indexOf(a.kind) - order.indexOf(b.kind);
    });
    return matched.slice(0, 12);
  }, [items, query]);

  useEffect(() => { setIndex(0); }, [query, drill]);

  function go(href: string) {
    setOpen(false);
    window.location.assign(href);
  }

  function drillInto(item: Item) {
    if (!item.drill) return;
    setDrill({
      title: item.title,
      refs: item.drill.length ? item.drill : [],
    });
  }

  if (!open) return null;

  const rows = drill ? drill.refs : results;

  return (
    <div className="fixed inset-0 z-[100] bg-black/60 flex items-start justify-center pt-[15vh] px-4" onClick={() => setOpen(false)}>
      <div className="w-full max-w-xl bg-slate-900 border border-slate-700 rounded-2xl shadow-2xl overflow-hidden" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center gap-3 px-4 py-3 border-b border-slate-800">
          {drill ? (
            <button onClick={() => setDrill(null)} className="flex items-center gap-1.5 text-slate-400 hover:text-white text-xs flex-shrink-0 transition-colors">
              <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M15 19l-7-7 7-7" /></svg>
              <span className="max-w-[220px] truncate font-medium text-slate-300">{drill.title}</span>
            </button>
          ) : (
            <svg className="w-4 h-4 text-slate-500 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M21 21l-4.35-4.35M17 11a6 6 0 11-12 0 6 6 0 0112 0z" /></svg>
          )}
          <input
            ref={inputRef}
            value={drill ? '' : query}
            readOnly={!!drill}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (drill) {
                if (e.key === 'ArrowDown') { e.preventDefault(); setIndex((i) => Math.min(i + 1, drill.refs.length - 1)); }
                else if (e.key === 'ArrowUp') { e.preventDefault(); setIndex((i) => Math.max(i - 1, 0)); }
                else if (e.key === 'ArrowLeft' || e.key === 'Backspace') { e.preventDefault(); setDrill(null); }
                else if (e.key === 'Enter' && drill.refs[index]) go(drill.refs[index].href);
                return;
              }
              if (e.key === 'ArrowDown') { e.preventDefault(); setIndex((i) => Math.min(i + 1, results.length - 1)); }
              else if (e.key === 'ArrowUp') { e.preventDefault(); setIndex((i) => Math.max(i - 1, 0)); }
              else if (e.key === 'ArrowRight') {
                const r = results[index];
                if (r?.drill) { e.preventDefault(); drillInto(r); }
              }
              else if (e.key === 'Enter' && results[index]) go(results[index].href);
            }}
            placeholder={drill ? 'Latest supplier quotes & POs — Enter opens Deal Lookup' : 'Search items, quotes, PI/PO numbers, suppliers…'}
            className="flex-1 bg-transparent outline-none text-white text-sm placeholder:text-slate-600"
          />
          <kbd className="text-[10px] text-slate-600 border border-slate-700 rounded px-1.5 py-0.5">Esc</kbd>
        </div>

        <div className="max-h-[50vh] overflow-y-auto">
          {items === null && <p className="px-4 py-6 text-sm text-slate-500 text-center">Loading index…</p>}

          {!drill && items !== null && query.trim().length < 2 && (
            <p className="px-4 py-6 text-xs text-slate-600 text-center">
              Type at least 2 characters. On a supplier or item, press <kbd className="border border-slate-700 rounded px-1">→</kbd> to see its latest quotes &amp; POs.
            </p>
          )}
          {!drill && items !== null && query.trim().length >= 2 && results.length === 0 && (
            <p className="px-4 py-6 text-sm text-slate-500 text-center">No matches for “{query}”.</p>
          )}
          {drill && drill.refs.length === 0 && (
            <p className="px-4 py-6 text-sm text-slate-500 text-center">No supplier quotes or POs recorded yet.</p>
          )}

          {!drill && results.map((r, i) => (
            <div key={`${r.kind}-${r.id}`} className={`flex items-stretch transition-colors ${i === index ? 'bg-slate-800' : ''}`}>
              <button
                onClick={() => go(r.href)}
                onMouseEnter={() => setIndex(i)}
                className="flex-1 min-w-0 text-left px-4 py-2.5 flex items-center gap-3"
              >
                <span className={`px-1.5 py-0.5 rounded text-[9px] font-bold uppercase flex-shrink-0 ${KIND_BADGE[r.kind].cls}`}>
                  {KIND_BADGE[r.kind].label}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block text-sm text-slate-200 truncate">{r.title}</span>
                  <span className="block text-[11px] text-slate-500 truncate">{r.sub}</span>
                </span>
              </button>
              {r.drill && (
                <button
                  onClick={() => { setIndex(i); drillInto(r); }}
                  title="Show latest quotes & POs (→)"
                  className="px-3 flex items-center text-slate-600 hover:text-white transition-colors"
                >
                  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M9 5l7 7-7 7" /></svg>
                </button>
              )}
            </div>
          ))}

          {drill && drill.refs.map((r, i) => (
            <button
              key={`${r.kind}-${r.number}-${i}`}
              onClick={() => go(r.href)}
              onMouseEnter={() => setIndex(i)}
              className={`w-full text-left px-4 py-2.5 flex items-center gap-3 transition-colors ${i === index ? 'bg-slate-800' : ''}`}
            >
              <span className={`px-1.5 py-0.5 rounded text-[9px] font-bold uppercase flex-shrink-0 ${KIND_BADGE[r.kind].cls}`}>
                {KIND_BADGE[r.kind].label}
              </span>
              <span className="min-w-0 flex-1">
                <span className="block text-sm text-slate-200 truncate">{r.number}</span>
                <span className="block text-[11px] text-slate-500 truncate">{r.extra || '—'}</span>
              </span>
              <span className="text-[10px] text-slate-600 flex-shrink-0 tabular-nums">{r.date}</span>
            </button>
          ))}
        </div>

        <div className="px-4 py-2 border-t border-slate-800 text-[10px] text-slate-600 flex gap-4">
          <span>↑↓ navigate</span>
          {drill ? <span>← back</span> : <span>→ drill in</span>}
          <span>↵ open</span>
          <span>Esc close</span>
          <span className="ml-auto">Ctrl+I</span>
        </div>
      </div>
    </div>
  );
}
