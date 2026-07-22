'use client';

import { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import { createSupabaseClient } from '@/lib/supabase';

/**
 * Global Spotlight search — two presentations of one search index:
 *
 *  • variant="modal"  (default): a Ctrl/Cmd+I overlay. When closed it shows a
 *    small bottom-right reminder pill (unless showHint=false). Used in Catalog,
 *    Insights, and — gated to owners via `enabled` — Quotes.
 *  • variant="inline": an always-visible search bar that drops its results
 *    directly below it (the dashboard hero). No modal, no pill.
 *
 * Root results: suppliers, buying companies, project quotes, supplier quotes
 * (PI), POs, and catalog items. → drills a supplier/company/item into its
 * latest PIs & POs; Enter opens the item's context (Deal/Cost Lookup or the
 * quote editor). Ranking: prefix matches first; vendors/companies outrank
 * items; items sort by buying activity.
 */

interface DealLine { name: string; qty: number; price: number; ccy: string }

interface DealRef {
  kind: 'pi' | 'po';
  number: string;
  altNumber?: string;      // the paired PI/PO number when the two were merged
  date: string;
  extra: string;
  href: string;
  lines?: DealLine[];      // line items, for the hover/tap preview
}

interface Item {
  kind: 'supplier' | 'company' | 'customer' | 'quote' | 'pi' | 'po' | 'component';
  id: string;
  title: string;
  sub: string;
  href: string;
  date?: string;
  weight?: number;
  drill?: DealRef[];
  lines?: DealLine[];       // PI / PO line items, for the tap preview
  keywords?: string;        // extra searchable text (line-item names) — not shown
}

const KIND_BADGE: Record<Item['kind'], { label: string; cls: string }> = {
  supplier:  { label: 'Supplier', cls: 'bg-sky-500/15 text-sky-300' },
  company:   { label: 'Company',  cls: 'bg-rose-500/15 text-rose-300' },
  customer:  { label: 'Customer', cls: 'bg-teal-500/15 text-teal-300' },
  quote:     { label: 'Quote',    cls: 'bg-violet-500/15 text-violet-300' },
  pi:        { label: 'PI',       cls: 'bg-blue-500/15 text-blue-300' },
  po:        { label: 'PO',       cls: 'bg-amber-500/15 text-amber-300' },
  component: { label: 'Item',     cls: 'bg-emerald-500/15 text-emerald-300' },
};

const KIND_ORDER: Item['kind'][] = ['supplier', 'company', 'customer', 'quote', 'pi', 'po', 'component'];

const dealLookupHref = (n: string) => `/catalog?tab=lookup&q=${encodeURIComponent(n)}`;

interface Props {
  variant?: 'modal' | 'inline';
  /** modal only: show the bottom-right reminder pill when closed */
  showHint?: boolean;
  /** false renders nothing (e.g. Quotes for non-owners) */
  enabled?: boolean;
}

export default function CommandPalette({ variant = 'modal', showHint = true, enabled = true }: Props) {
  const supabase = createSupabaseClient();
  const inline = variant === 'inline';

  const [open, setOpen] = useState(false);       // modal visibility
  const [focused, setFocused] = useState(false); // inline dropdown visibility
  const active = inline ? focused : open;

  const [query, setQuery] = useState('');
  const [index, setIndex] = useState(0);
  const [items, setItems] = useState<Item[] | null>(null);
  const [recents, setRecents] = useState<Item[]>([]);
  const [drill, setDrill] = useState<{ title: string; refs: DealRef[] } | null>(null);
  const [openLines, setOpenLines] = useState<number | null>(null); // drill row whose items are expanded
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  const isMac = typeof navigator !== 'undefined' && /mac/i.test(navigator.platform || '');
  const modKey = isMac ? '⌘' : 'Ctrl';

  // Ctrl/Cmd+I anywhere; a custom event lets any affordance open/focus it
  useEffect(() => {
    if (!enabled) return;
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && !e.shiftKey && !e.altKey && e.key.toLowerCase() === 'i') {
        e.preventDefault();
        if (inline) inputRef.current?.focus();
        else setOpen((v) => !v);
      }
      if (e.key === 'Escape') {
        if (inline) { inputRef.current?.blur(); setFocused(false); }
        else setOpen(false);
      }
    };
    const onOpen = () => { if (inline) inputRef.current?.focus(); else setOpen(true); };
    window.addEventListener('keydown', onKey);
    window.addEventListener('icaproc:spotlight', onOpen);
    return () => {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('icaproc:spotlight', onOpen);
    };
  }, [enabled, inline]);

  // Reset + focus each time the modal opens
  useEffect(() => {
    if (open) {
      setQuery('');
      setIndex(0);
      setDrill(null);
      setTimeout(() => inputRef.current?.focus({ preventScroll: true }), 0);
    }
  }, [open]);

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

    const [comps, projectQuotes, suppliers, companies, customers, pis, pos, piLines, poLines, quoteLineItems] = await Promise.all([
      fetchAllComponents(),
      supabase.from('10.0_project_quotes').select('quote_id, quote_number, quote_date, customer_name, status').order('quote_date', { ascending: false }).limit(500),
      supabase.from('2.0_suppliers').select('supplier_id, supplier_name, supplier_code'),
      supabase.from('1.0_companies').select('company_id, legal_name'),
      supabase.from('20.0_customers').select('customer_id, customer_code, display_name, legal_name, tier, is_active').order('display_name'),
      supabase.from('4.0_price_quotes').select('quote_id, pi_number, quote_date, supplier_id, company_id, status').order('quote_date', { ascending: false }).limit(1500),
      supabase.from('5.0_purchases').select('po_id, po_number, po_date, quote_id, company_id, status').order('po_date', { ascending: false }).limit(1500),
      supabase.from('4.1_price_quote_line_items').select('quote_id, component_id, quantity, unit_price, currency, supplier_description').limit(8000),
      supabase.from('5.1_purchase_line_items').select('po_id, component_id, quantity, unit_cost, currency, supplier_description').limit(8000),
      supabase.from('10.2_quote_items').select('quote_id, description').limit(8000),
    ]);

    const supplierName = new Map((suppliers.data ?? []).map((s) => [s.supplier_id as string, (s.supplier_name as string) || '']));
    const piById = new Map((pis.data ?? []).map((q) => [q.quote_id as number, q]));
    const poById = new Map((pos.data ?? []).map((p) => [p.po_id as number, p]));
    const compModel = new Map(comps.map((c) => [c.component_id, c.supplier_model]));

    // ── Line items + a component×qty signature per PI and per PO ──────────────
    const pushArr = <T,>(m: Map<number, T[]>, k: number, v: T) => { const a = m.get(k); if (a) a.push(v); else m.set(k, [v]); };
    const linesByPi = new Map<number, DealLine[]>();
    const linesByPo = new Map<number, DealLine[]>();
    const sigPartsPi = new Map<number, string[]>();
    const sigPartsPo = new Map<number, string[]>();
    for (const l of piLines.data ?? []) {
      const id = l.quote_id as number;
      const qty = Number(l.quantity) || 0;
      pushArr(linesByPi, id, { name: compModel.get(l.component_id as string) || (l.supplier_description as string) || '(item)', qty, price: Number(l.unit_price) || 0, ccy: (l.currency as string) || '' });
      pushArr(sigPartsPi, id, `${l.component_id}:${qty}`);
    }
    for (const l of poLines.data ?? []) {
      const id = l.po_id as number;
      const qty = Number(l.quantity) || 0;
      pushArr(linesByPo, id, { name: compModel.get(l.component_id as string) || (l.supplier_description as string) || '(item)', qty, price: Number(l.unit_cost) || 0, ccy: (l.currency as string) || '' });
      pushArr(sigPartsPo, id, `${l.component_id}:${qty}`);
    }
    const sig = (parts?: string[]) => (parts && parts.length ? [...parts].sort().join('|') : '');
    const sigByPi = new Map<number, string>(); for (const [k, v] of sigPartsPi) sigByPi.set(k, sig(v));
    const sigByPo = new Map<number, string>(); for (const [k, v] of sigPartsPo) sigByPo.set(k, sig(v));

    // Searchable keywords per deal = the distinct item names on its lines, so
    // searching an item surfaces the PIs/POs/quotes that contain it.
    const kwFromLines = (lines?: DealLine[]) => lines ? [...new Set(lines.map((l) => l.name))].join(' ') : '';
    const kwByQuote = new Map<string, Set<string>>();
    for (const it of quoteLineItems.data ?? []) {
      const id = it.quote_id as string;
      const d = String(it.description ?? '').trim();
      if (!d) continue;
      const s = kwByQuote.get(id); if (s) s.add(d); else kwByQuote.set(id, new Set([d]));
    }
    const kwForQuote = (id: string) => { const s = kwByQuote.get(id); return s ? [...s].join(' ') : ''; };

    // A PO whose line items exactly match its originating PI is the same deal —
    // merge them into a single entry (the PO carries the PI's number as altNumber).
    const mergedPiIds = new Set<number>();
    const poAltPi = new Map<number, string>();
    for (const p of pos.data ?? []) {
      if (p.quote_id == null) continue;
      const sp = sigByPo.get(p.po_id as number);
      const sq = sigByPi.get(p.quote_id as number);
      if (sp && sq && sp === sq) {
        mergedPiIds.add(p.quote_id as number);
        const pi = piById.get(p.quote_id as number);
        poAltPi.set(p.po_id as number, (pi?.pi_number as string) || `Quote ${p.quote_id}`);
      }
    }

    const piRef = (q: any): DealRef => ({
      kind: 'pi',
      number: (q.pi_number as string) || `Quote ${q.quote_id}`,
      date: (q.quote_date as string) ?? '',
      extra: [supplierName.get(q.supplier_id as string), (q.status as string)].filter(Boolean).join(' · '),
      href: dealLookupHref((q.pi_number as string) || String(q.quote_id)),
      lines: linesByPi.get(q.quote_id as number),
    });
    const poRef = (p: any): DealRef => {
      const viaPi = p.quote_id != null ? piById.get(p.quote_id as number) : undefined;
      const sup = viaPi ? supplierName.get(viaPi.supplier_id as string) : '';
      return {
        kind: 'po',
        number: (p.po_number as string) || `PO ${p.po_id}`,
        altNumber: poAltPi.get(p.po_id as number),
        date: (p.po_date as string) ?? '',
        extra: [sup, (p.status as string)].filter(Boolean).join(' · '),
        href: dealLookupHref((p.po_number as string) || String(p.po_id)),
        lines: linesByPo.get(p.po_id as number),
      };
    };

    const bySupplier = new Map<string, DealRef[]>();
    const byCompany = new Map<string, DealRef[]>();
    const byComponent = new Map<string, DealRef[]>();
    const compActivity = new Map<string, { pi: Set<number>; po: Set<number> }>();
    const push = (map: Map<string, DealRef[]>, key: string | null | undefined, ref: DealRef) => {
      if (!key) return;
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(ref);
    };

    for (const q of pis.data ?? []) {
      if (mergedPiIds.has(q.quote_id as number)) continue; // shown as part of its PO
      const r = piRef(q);
      push(bySupplier, q.supplier_id as string, r);
      push(byCompany, q.company_id as string, r);
    }
    for (const p of pos.data ?? []) {
      const r = poRef(p);
      const viaPi = p.quote_id != null ? piById.get(p.quote_id as number) : undefined;
      push(bySupplier, viaPi?.supplier_id as string | undefined, r);
      push(byCompany, (p.company_id as string) || (viaPi?.company_id as string | undefined), r);
    }
    for (const l of piLines.data ?? []) {
      if (!l.component_id) continue;
      const q = piById.get(l.quote_id as number);
      if (q && !mergedPiIds.has(l.quote_id as number)) push(byComponent, l.component_id as string, piRef(q));
      if (!compActivity.has(l.component_id as string)) compActivity.set(l.component_id as string, { pi: new Set(), po: new Set() });
      compActivity.get(l.component_id as string)!.pi.add(l.quote_id as number);
    }
    for (const l of poLines.data ?? []) {
      if (!l.component_id) continue;
      const p = poById.get(l.po_id as number);
      if (p) push(byComponent, l.component_id as string, poRef(p));
      if (!compActivity.has(l.component_id as string)) compActivity.set(l.component_id as string, { pi: new Set(), po: new Set() });
      compActivity.get(l.component_id as string)!.po.add(l.po_id as number);
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
    finalize(byCompany);
    finalize(byComponent);

    const quoteItemsList: Item[] = (projectQuotes.data ?? []).map((q) => ({
      kind: 'quote' as const,
      id: q.quote_id as string,
      title: (q.quote_number as string) || '(no number)',
      sub: [(q.customer_name as string) || 'No customer', ((q.status as string) || 'draft').toUpperCase()].join(' · '),
      href: `/quotes/${q.quote_id}`,
      date: (q.quote_date as string) ?? '',
      keywords: kwForQuote(q.quote_id as string),
    }));
    const piItemsList: Item[] = (pis.data ?? []).map((q) => ({
      kind: 'pi' as const,
      id: String(q.quote_id),
      title: (q.pi_number as string) || `Quote ${q.quote_id}`,
      sub: ['Supplier quote', supplierName.get(q.supplier_id as string), q.quote_date as string].filter(Boolean).join(' · '),
      href: dealLookupHref((q.pi_number as string) || String(q.quote_id)),
      date: (q.quote_date as string) ?? '',
      lines: linesByPi.get(q.quote_id as number),
      keywords: kwFromLines(linesByPi.get(q.quote_id as number)),
    }));
    const poItemsList: Item[] = (pos.data ?? []).map((p) => ({
      kind: 'po' as const,
      id: String(p.po_id),
      title: (p.po_number as string) || `PO ${p.po_id}`,
      sub: ['Purchase order', p.po_date as string].filter(Boolean).join(' · '),
      href: dealLookupHref((p.po_number as string) || String(p.po_id)),
      date: (p.po_date as string) ?? '',
      lines: linesByPo.get(p.po_id as number),
      keywords: kwFromLines(linesByPo.get(p.po_id as number)),
    }));

    const list: Item[] = [
      ...(suppliers.data ?? []).map((s) => ({
        kind: 'supplier' as const,
        id: s.supplier_id as string,
        title: (s.supplier_name as string) || '(no name)',
        sub: [(s.supplier_code as string), 'Vendor'].filter(Boolean).join(' · '),
        href: dealLookupHref((s.supplier_name as string) || ''),
        drill: bySupplier.get(s.supplier_id as string) ?? [],
      })),
      ...(companies.data ?? []).map((c) => ({
        kind: 'company' as const,
        id: c.company_id as string,
        title: (c.legal_name as string) || '(no name)',
        sub: 'Buying company',
        href: dealLookupHref((c.legal_name as string) || ''),
        drill: byCompany.get(c.company_id as string) ?? [],
      })),
      ...(customers.data ?? []).map((c) => ({
        kind: 'customer' as const,
        id: c.customer_id as string,
        title: (c.display_name as string) || (c.legal_name as string) || '(no name)',
        sub: [(c.customer_code as string), (c.tier as string), (c.is_active === false ? 'Inactive' : 'Customer')].filter(Boolean).join(' · '),
        href: `/customers?open=${encodeURIComponent(c.customer_id as string)}`,
      })),
      ...quoteItemsList,
      ...piItemsList,
      ...poItemsList,
      ...comps.map((c) => {
        const act = compActivity.get(c.component_id);
        return {
          kind: 'component' as const,
          id: c.component_id,
          title: c.supplier_model || '(no model)',
          sub: [c.brand, c.category].filter(Boolean).join(' · '),
          href: `/insights?tab=lookup&q=${encodeURIComponent(c.supplier_model ?? '')}`,
          weight: (act?.po.size ?? 0) * 2 + (act?.pi.size ?? 0),
          drill: byComponent.get(c.component_id) ?? [],
        };
      }),
    ];
    setItems(list);

    setRecents(
      [...quoteItemsList.slice(0, 4), ...piItemsList.slice(0, 5), ...poItemsList.slice(0, 5)]
        .sort((a, b) => (b.date ?? '').localeCompare(a.date ?? ''))
        .slice(0, 8),
    );
  }, []);

  useEffect(() => {
    if (active && items === null) loadData();
  }, [active, items, loadData]);

  const results = useMemo(() => {
    if (!items) return [];
    const q = query.trim().toLowerCase();
    if (q.length < 2) return [];
    const tokens = q.split(/\s+/).filter(Boolean);
    const first = tokens[0];
    // A "strong" match hits the name/sub directly; a "weak" match hits only the
    // line-item keywords (i.e. this deal/quote *contains* the searched item).
    const strongText = (i: Item) => `${i.title} ${i.sub}`.toLowerCase();
    const fullText = (i: Item) => `${i.title} ${i.sub} ${i.keywords ?? ''}`.toLowerCase();
    const matched = items.filter((i) => {
      const hay = fullText(i);
      return tokens.every((t) => hay.includes(t));
    });
    const isStrong = (i: Item) => { const h = strongText(i); return tokens.every((t) => h.includes(t)); };
    // Tier priority: (0) suppliers/companies/customers — matched by code or
    // name — then (1) project quotes / supplier quotes (PI) / POs, then (2) items.
    const tier = (k: Item['kind']) =>
      k === 'supplier' || k === 'company' || k === 'customer' ? 0 : k === 'component' ? 2 : 1;
    // Prefix match on the name OR the sub line (supplier_code lives in sub)
    const startsWith = (i: Item) =>
      i.title.toLowerCase().startsWith(first) || i.sub.toLowerCase().startsWith(first);
    matched.sort((a, b) => {
      // Direct name/sub matches always rank above deals matched only via their items
      const sa = isStrong(a) ? 0 : 1, sb = isStrong(b) ? 0 : 1;
      if (sa !== sb) return sa - sb;
      const ta = tier(a.kind), tb = tier(b.kind);
      if (ta !== tb) return ta - tb;
      const ap = startsWith(a) ? 0 : 1;
      const bp = startsWith(b) ? 0 : 1;
      if (ap !== bp) return ap - bp;
      const ko = KIND_ORDER.indexOf(a.kind) - KIND_ORDER.indexOf(b.kind);
      if (ko !== 0) return ko;
      if (a.kind === 'component') return (b.weight ?? 0) - (a.weight ?? 0);
      return (b.date ?? '').localeCompare(a.date ?? '') || a.title.localeCompare(b.title);
    });
    return matched.slice(0, 20);
  }, [items, query]);

  const rootRows = query.trim().length >= 2 ? results : recents;

  useEffect(() => { setIndex(0); setOpenLines(null); }, [query, drill]);
  useEffect(() => {
    listRef.current?.querySelector(`[data-idx="${index}"]`)?.scrollIntoView({ block: 'nearest' });
  }, [index]);

  function go(href: string) {
    if (inline) {
      window.open(href, '_blank', 'noopener');
      setFocused(false);
    } else {
      setOpen(false);
      window.location.assign(href);
    }
  }
  function drillInto(item: Item) {
    if (!item.drill) return;
    setDrill({ title: item.title, refs: item.drill });
  }

  // Compact item/qty/price list — shared by the drill rows and the root rows
  const linePreview = (lines: DealLine[]) => (
    <div className="px-4 pb-3 pt-0.5">
      <div className="rounded-lg border border-slate-800 bg-slate-950/50 divide-y divide-slate-800/60">
        {lines.slice(0, 12).map((ln, li) => (
          <div key={li} className="flex items-center gap-3 px-3 py-1.5 text-[11px]">
            <span className="text-slate-500 tabular-nums flex-shrink-0 w-9 text-right">{ln.qty}×</span>
            <span className="text-slate-300 truncate flex-1">{ln.name}</span>
            <span className="text-slate-400 tabular-nums flex-shrink-0">{ln.price ? ln.price.toLocaleString('en-US') : '—'}{ln.ccy ? ` ${ln.ccy}` : ''}</span>
          </div>
        ))}
        {lines.length > 12 && <div className="px-3 py-1.5 text-[10px] text-slate-600">+{lines.length - 12} more line{lines.length - 12 > 1 ? 's' : ''}</div>}
      </div>
    </div>
  );

  const onInputKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (drill) {
      if (e.key === 'ArrowDown') { e.preventDefault(); setIndex((i) => Math.min(i + 1, drill.refs.length - 1)); }
      else if (e.key === 'ArrowUp') { e.preventDefault(); setIndex((i) => Math.max(i - 1, 0)); }
      // ← closes an open item preview first; otherwise steps back out of the drill
      else if (e.key === 'ArrowLeft' || e.key === 'Backspace') { e.preventDefault(); if (openLines !== null) setOpenLines(null); else setDrill(null); }
      else if (e.key === 'ArrowRight') { if (drill.refs[index]?.lines?.length) { e.preventDefault(); setOpenLines(index); } }
      else if (e.key === 'Enter' && drill.refs[index]) go(drill.refs[index].href);
      return;
    }
    if (e.key === 'ArrowDown') { e.preventDefault(); setIndex((i) => Math.min(i + 1, rootRows.length - 1)); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setIndex((i) => Math.max(i - 1, 0)); }
    else if (e.key === 'ArrowRight') {
      const r = rootRows[index];
      if (r?.drill && r.drill.length) { e.preventDefault(); drillInto(r); }
      else if (r?.lines?.length) { e.preventDefault(); setOpenLines(index); }
    }
    else if (e.key === 'ArrowLeft') { if (openLines !== null) { e.preventDefault(); setOpenLines(null); } }
    else if (e.key === 'Enter' && rootRows[index]) go(rootRows[index].href);
  };

  if (!enabled) return null;

  // Scrollable results list — shared by both variants
  const body = (
    <div ref={listRef} className="max-h-[50vh] overflow-y-auto">
      {items === null && (
        <div className="px-4 py-6 flex items-center justify-center gap-2 text-sm text-slate-500">
          <div className="w-3.5 h-3.5 border-2 border-slate-600 border-t-slate-300 rounded-full animate-spin" />
          Building search index…
        </div>
      )}

      {!drill && items !== null && rootRows.length === 0 && query.trim().length >= 2 && (
        <p className="px-4 py-6 text-sm text-slate-500 text-center">No matches for “{query}”.</p>
      )}
      {!drill && items !== null && query.trim().length < 2 && rootRows.length > 0 && (
        <p className="px-4 pt-3 pb-1 text-[9px] uppercase tracking-wider text-slate-600">Recent activity</p>
      )}
      {drill && drill.refs.length === 0 && (
        <p className="px-4 py-6 text-sm text-slate-500 text-center">No supplier quotes or POs recorded yet.</p>
      )}

      {!drill && items !== null && rootRows.map((r, i) => (
        <div key={`${r.kind}-${r.id}`} data-idx={i} className={`transition-colors ${i === index ? 'bg-slate-800' : ''}`}>
          <div className="flex items-stretch">
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
              {r.date && <span className="text-[10px] text-slate-600 flex-shrink-0 tabular-nums">{r.date}</span>}
            </button>
            {r.drill && r.drill.length > 0 ? (
              <button
                onClick={() => { setIndex(i); drillInto(r); }}
                title="Show latest quotes & POs (→)"
                className="px-3 flex items-center text-slate-600 hover:text-white transition-colors"
              >
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M9 5l7 7-7 7" /></svg>
              </button>
            ) : r.lines && r.lines.length > 0 ? (
              <button
                onClick={() => setOpenLines((o) => (o === i ? null : i))}
                title="Show items (→)"
                className="px-3 flex items-center text-slate-600 hover:text-white transition-colors"
              >
                <svg className={`w-4 h-4 transition-transform ${openLines === i ? 'rotate-90' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M9 5l7 7-7 7" /></svg>
              </button>
            ) : null}
          </div>
          {openLines === i && r.lines && r.lines.length > 0 && linePreview(r.lines)}
        </div>
      ))}

      {drill && drill.refs.map((r, i) => (
        <div key={`${r.kind}-${r.number}-${i}`} data-idx={i} className={`transition-colors ${i === index ? 'bg-slate-800' : ''}`}>
          <div className="flex items-stretch">
            <button
              onClick={() => go(r.href)}
              onMouseEnter={() => setIndex(i)}
              className="flex-1 min-w-0 text-left px-4 py-2.5 flex items-center gap-3"
            >
              <span className={`px-1.5 py-0.5 rounded text-[9px] font-bold uppercase flex-shrink-0 ${KIND_BADGE[r.kind].cls}`}>
                {r.altNumber ? 'PI+PO' : KIND_BADGE[r.kind].label}
              </span>
              <span className="min-w-0 flex-1">
                <span className="flex items-center gap-1.5">
                  <span className="text-sm text-slate-200 truncate">{r.number}</span>
                  {r.altNumber && (
                    <span className="px-1 py-0.5 rounded text-[9px] font-semibold bg-blue-500/15 text-blue-300 flex-shrink-0 whitespace-nowrap" title="Same line items — PI and PO shown as one deal">
                      PI {r.altNumber}
                    </span>
                  )}
                </span>
                <span className="block text-[11px] text-slate-500 truncate">{r.extra || '—'}</span>
              </span>
              <span className="text-[10px] text-slate-600 flex-shrink-0 tabular-nums">{r.date}</span>
            </button>
            {r.lines && r.lines.length > 0 && (
              <button
                onClick={() => setOpenLines((o) => (o === i ? null : i))}
                title="Show items (→)"
                className="px-3 flex items-center text-slate-600 hover:text-white transition-colors"
              >
                <svg className={`w-4 h-4 transition-transform ${openLines === i ? 'rotate-90' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M9 5l7 7-7 7" /></svg>
              </button>
            )}
          </div>
          {openLines === i && r.lines && r.lines.length > 0 && linePreview(r.lines)}
        </div>
      ))}
    </div>
  );

  // ── Inline variant: the search bar IS the UI (dashboard hero) ──────────────
  if (inline) {
    return (
      <div className="relative w-full max-w-2xl mx-auto">
        <div className="relative flex items-center gap-3 px-5 h-14 rounded-full bg-slate-900/80 border border-slate-700/80 focus-within:border-emerald-500/60 hover:border-emerald-500/40 shadow-xl ring-1 ring-white/5 transition-colors">
          {drill ? (
            <button onClick={() => { setDrill(null); inputRef.current?.focus(); }} onMouseDown={(e) => e.preventDefault()} className="flex items-center gap-1.5 min-w-0 text-slate-400 hover:text-white text-xs flex-shrink transition-colors">
              <svg className="w-4 h-4 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M15 19l-7-7 7-7" /></svg>
              <span className="truncate font-medium text-slate-300">{drill.title}</span>
            </button>
          ) : (
            <svg className="w-5 h-5 text-slate-500 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M21 21l-4.35-4.35M17 11a6 6 0 11-12 0 6 6 0 0112 0z" /></svg>
          )}
          <input
            ref={inputRef}
            value={drill ? '' : query}
            readOnly={!!drill}
            onFocus={() => setFocused(true)}
            onBlur={() => setFocused(false)}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={onInputKeyDown}
            placeholder={drill ? 'Enter opens Deal Lookup' : 'Search vendors, components, quotes, PI / PO numbers…'}
            // text-base (16px) on phones stops iOS from auto-zooming on focus.
            // min-w-0 lets the field shrink so the placeholder clips instead of
            // overflowing the pill on narrow screens.
            className="flex-1 min-w-0 bg-transparent outline-none text-white text-base sm:text-sm placeholder:text-[13px] sm:placeholder:text-sm placeholder:text-slate-500"
          />
          <span className="hidden sm:flex items-center gap-1 flex-shrink-0">
            <kbd className="text-[11px] font-mono text-slate-400 border border-slate-700 rounded px-1.5 py-0.5 leading-none">{modKey}</kbd>
            <kbd className="text-[11px] font-mono text-slate-400 border border-slate-700 rounded px-1.5 py-0.5 leading-none">I</kbd>
          </span>
        </div>
        {active && (query.trim().length >= 2 || rootRows.length > 0 || items === null || drill) && (
          <div
            onMouseDown={(e) => e.preventDefault()}
            className="absolute left-0 right-0 mt-2 bg-slate-900 border border-slate-700 rounded-2xl shadow-2xl overflow-hidden z-50"
          >
            {body}
            <div className="px-4 py-2 border-t border-slate-800 text-[10px] text-slate-600 flex gap-4">
              <span>↑↓ navigate</span>
              {drill ? <><span>← back</span><span>→ items</span></> : <span>→ drill in</span>}
              <span>↵ open in new tab</span>
            </div>
          </div>
        )}
      </div>
    );
  }

  // ── Modal variant ──────────────────────────────────────────────────────────
  if (!open) {
    if (!showHint) return null;
    return (
      <button
        onClick={() => setOpen(true)}
        title={`Spotlight search — ${modKey} + I`}
        // z-30: below every modal/side-panel backdrop (z-40+) so open panels cover the pill
        className="fixed bottom-5 right-5 z-30 flex items-center gap-2 px-3 py-2 rounded-full bg-slate-900/90 backdrop-blur border border-slate-700/80 text-slate-400 hover:text-white hover:border-emerald-500/40 shadow-lg transition-colors group"
      >
        <svg className="w-3.5 h-3.5 text-slate-500 group-hover:text-emerald-400 transition-colors" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M21 21l-4.35-4.35M17 11a6 6 0 11-12 0 6 6 0 0112 0z" /></svg>
        <span className="text-[11px] font-medium hidden sm:inline">Search</span>
        <kbd className="text-[10px] font-mono text-slate-500 border border-slate-700 rounded px-1.5 py-0.5 leading-none">{modKey} I</kbd>
      </button>
    );
  }

  return (
    <div className="fixed inset-0 z-[100] bg-black/60 flex items-start justify-center pt-[15vh] px-4" onClick={() => setOpen(false)}>
      <div className="w-full max-w-xl bg-slate-900 border border-slate-700 rounded-2xl shadow-2xl overflow-hidden" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center gap-3 px-4 py-3 border-b border-slate-800">
          {drill ? (
            <button onClick={() => setDrill(null)} className="flex items-center gap-1.5 min-w-0 text-slate-400 hover:text-white text-xs flex-shrink transition-colors">
              <svg className="w-3.5 h-3.5 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M15 19l-7-7 7-7" /></svg>
              <span className="truncate font-medium text-slate-300">{drill.title}</span>
            </button>
          ) : (
            <svg className="w-4 h-4 text-slate-500 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M21 21l-4.35-4.35M17 11a6 6 0 11-12 0 6 6 0 0112 0z" /></svg>
          )}
          <input
            ref={inputRef}
            value={drill ? '' : query}
            readOnly={!!drill}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={onInputKeyDown}
            placeholder={drill ? 'Enter opens Deal Lookup' : 'Search vendors, companies, items, quote/PI/PO numbers…'}
            className="flex-1 min-w-0 bg-transparent outline-none text-white text-base sm:text-sm placeholder:text-[13px] sm:placeholder:text-sm placeholder:text-slate-600"
          />
          <kbd className="text-[10px] text-slate-600 border border-slate-700 rounded px-1.5 py-0.5">Esc</kbd>
        </div>

        {body}

        <div className="px-4 py-2 border-t border-slate-800 text-[10px] text-slate-600 flex gap-4">
          <span>↑↓ navigate</span>
          {drill ? <><span>← back</span><span>→ items</span></> : <span>→ drill in</span>}
          <span>↵ open</span>
          <span>Esc close</span>
          <span className="ml-auto">{modKey} I</span>
        </div>
      </div>
    </div>
  );
}
