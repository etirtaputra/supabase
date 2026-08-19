'use client';
/**
 * ICAPROC — After Sales (Module 27)
 * The service history a WhatsApp thread can't give you: every warranty claim,
 * repair and replacement as a CASE — attached to the customer, the sales order
 * it came from, and the catalog items involved, so failure counts can roll up
 * per product and support cost per customer stops being a guess.
 *
 * A case is a lifecycle (open → in progress → waiting parts → resolved →
 * closed), a categorised cause (warranty / repair / replacement / …), the
 * parts touched (each with its own action: replaced / repaired / …), and a
 * dated log of updates. Parts link to `3.0_components` but keep their text
 * description, so history survives a catalog edit.
 *
 * Sell-side rules apply: items show internal descriptions only — never brand
 * or supplier model. Writes gate on `canEditSalesDocs`.
 */
import { useState, useEffect, useMemo, useCallback, useRef, Suspense } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { createPortal } from 'react-dom';
import { createSupabaseClient } from '@/lib/supabase';
import { useAuth } from '@/hooks/useAuth';
import { useT } from '@/hooks/useT';
import { ROLE_PERMISSIONS } from '@/constants/roles';
import { canOpenPath } from '@/constants/navigation';
import BrandMenu from '@/components/ui/BrandMenu';
import RichDropdown from '@/components/ui/RichDropdown';
import LayoutToggle from '@/components/ui/LayoutToggle';
import DateRangeFilter from '@/components/ui/DateRangeFilter';
import { useListLayout } from '@/hooks/useListLayout';
import { useListDefaults } from '@/hooks/useListDefaults';
import { inRange, type DateRange } from '@/lib/dateRange';
import { fmtDay, fmtDayTime, fmtInt, fmtQty } from '@/lib/formatters';
import { SALES_STATUS, displayDocNumber } from '@/lib/salesStatus';
import { fmtWarranty, warrantyRun, type WarrantyUnit } from '@/lib/warranty';
import { getSettings } from '@/lib/settings';
import {
  fetchSerials, lookupSerial, traceSerial, normSerial,
  type SerialRow, type SerialSalesDoc, type SerialDo, type SerialInvoice,
} from '@/lib/serials';

interface Case {
  case_id: string; case_number: string; customer_id: string | null; quote_id: string | null;
  category: string; status: string; subject: string; description: string; resolution: string;
  reported_at: string; resolved_at: string | null;
  created_at: string; updated_at: string; created_by_email: string; updated_by_email: string;
  /** The unit this ticket is about — the desk's starting point, not the order. */
  serial_id: string | null; serial_text: string; component_id: string | null; product_text: string;
  /** Bought somewhere else: no order of ours, and no warranty of ours. */
  is_external: boolean; purchased_from: string; purchased_at: string | null;
}
/** Columns the ticket table sorts by. Ticket numbers carry their own date. */
type TicketSort = 'ticket' | 'reported' | 'serial' | 'product' | 'customer' | 'order' | 'category' | 'status';

interface Part { part_id: string; case_id: string; component_id: string | null; description: string; action: string; quantity: number; notes: string }
interface Update { update_id: string; case_id: string; note: string; created_at: string; created_by_email: string }
interface Customer { customer_id: string; display_name: string; legal_name: string }
interface Order { quote_id: string; quote_number: string; order_number: string | null; status: string; customer_id: string | null; case_id?: string | null; grand_total?: number }
interface Comp {
  component_id: string; internal_description: string | null;
  warranty_value: number | null; warranty_unit: string | null;
  perf_warranty_value: number | null; perf_warranty_unit: string | null;
}

const CATEGORIES: Record<string, { label: string; cls: string }> = {
  warranty:    { label: 'Warranty',    cls: 'bg-violet-500/15 text-violet-300' },
  repair:      { label: 'Repair',      cls: 'bg-sky-500/15 text-sky-300' },
  replacement: { label: 'Replacement', cls: 'bg-amber-500/15 text-amber-300' },
  maintenance: { label: 'Maintenance', cls: 'bg-emerald-500/15 text-emerald-300' },
  complaint:   { label: 'Complaint',   cls: 'bg-rose-500/15 text-rose-300' },
  inspection:  { label: 'Inspection',  cls: 'bg-teal-500/15 text-teal-300' },
  other:       { label: 'Other',       cls: 'bg-slate-700/40 text-slate-300' },
};
const ACTIONS: Record<string, string> = {
  replaced: 'Replaced', repaired: 'Repaired', inspected: 'Inspected',
  returned: 'Returned', missing: 'Missing', other: 'Other',
};
// Open work first — the page exists to answer "what is still broken?"
const STATUS_SECTIONS: { key: string; label: string; accent: string; rule: string }[] = [
  { key: 'open',          label: 'Open',          accent: 'text-rose-300',    rule: 'bg-rose-500/20' },
  { key: 'in_progress',   label: 'In progress',   accent: 'text-sky-300',     rule: 'bg-sky-500/20' },
  { key: 'waiting_parts', label: 'Waiting parts', accent: 'text-amber-300',   rule: 'bg-amber-500/20' },
  { key: 'resolved',      label: 'Resolved',      accent: 'text-emerald-300', rule: 'bg-emerald-500/20' },
  { key: 'closed',        label: 'Closed',        accent: 'text-slate-500',   rule: 'bg-slate-700/40' },
];
const STATUS_BADGE: Record<string, string> = {
  open: 'bg-rose-500/15 text-rose-300', in_progress: 'bg-sky-500/15 text-sky-300',
  waiting_parts: 'bg-amber-500/15 text-amber-300', resolved: 'bg-emerald-500/15 text-emerald-300',
  closed: 'bg-slate-700/40 text-slate-400',
};
const statusLabel = (s: string) => STATUS_SECTIONS.find((x) => x.key === s)?.label ?? s;

// The warranty verdict chip — the direct answer "is this claim inside the
// period?", computed from the linked items' structured warranty.
const WTY_BADGE: Record<'in' | 'out' | 'mixed', { label: string; cls: string }> = {
  in:    { label: 'In warranty',        cls: 'bg-emerald-500/15 text-emerald-300' },
  out:   { label: 'Out of warranty',    cls: 'bg-rose-500/15 text-rose-300' },
  mixed: { label: 'Partly in warranty', cls: 'bg-amber-500/15 text-amber-300' },
};

interface DraftPart { part_id?: string; component_id: string | null; description: string; action: string; quantity: string; notes: string }
interface QuoteItem { quote_id: string; description: string; quantity: number; is_section: boolean }
interface Inv { invoice_id: string; quote_id: string; invoice_number: string; issued_at: string | null; created_at: string }
interface DoRow { do_id: string; quote_id: string; do_number: string; status: string; delivery_date: string | null; delivered_at: string | null }

function AfterSalesPage() {
  const supabase = createSupabaseClient();
  const router = useRouter();
  const { user, profile, loading: authLoading } = useAuth();
  const { t } = useT();
  const perms = profile ? ROLE_PERMISSIONS[profile.role] : null;
  const canEdit = !!perms?.canEditSalesDocs;

  const [cases, setCases] = useState<Case[]>([]);
  const [partsByCase, setPartsByCase] = useState<Map<string, Part[]>>(new Map());
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [orders, setOrders] = useState<Order[]>([]);
  const [comps, setComps] = useState<Comp[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [catFilter, setCatFilter] = useState('');
  // Settings › Lists decides the period this list opens on (reported date),
  // until someone widens it themselves.
  const listDefaults = useListDefaults('aftersales');
  const [range, setRange] = useState<DateRange>(listDefaults.range);
  const listTouched = useRef(false);
  useEffect(() => {
    if (!listTouched.current) setRange(listDefaults.range);
  }, [listDefaults.range.from, listDefaults.range.to]);   // eslint-disable-line react-hooks/exhaustive-deps
  const [layout, setLayout] = useListLayout('aftersales');
  const compact = layout === 'compact';

  // How the desk works. The house default lives in Settings; the toggle in the
  // toolbar is this person's own choice for this visit, so nobody is stuck in
  // a view that does not suit the job in front of them.
  const [mode, setMode] = useState<'ticket' | 'order'>(() => getSettings().aftersalesEntry ?? 'ticket');
  const [serials, setSerials] = useState<SerialRow[]>([]);
  const [ticketSort, setTicketSort] = useState<{ key: TicketSort; dir: 1 | -1 }>({ key: 'ticket', dir: -1 });
  /** What the serial box holds while it is being typed, and what it found. */
  const [serialInput, setSerialInput] = useState('');
  const [toast, setToast] = useState<string | null>(null);
  const flash = (m: string) => { setToast(m); setTimeout(() => setToast(null), 3500); };

  // Editor state
  const [editing, setEditing] = useState<Case | 'new' | null>(null);
  const [draft, setDraft] = useState<Partial<Case>>({});
  const [draftParts, setDraftParts] = useState<DraftPart[]>([]);
  const [quoteItems, setQuoteItems] = useState<QuoteItem[]>([]);
  const [invoices, setInvoices] = useState<Inv[]>([]);
  const [dos, setDos] = useState<DoRow[]>([]);
  // Row click expands an overview (like the Sales list); editing is a step deeper
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [updates, setUpdates] = useState<Update[]>([]);
  const [newNote, setNewNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [mounted, setMounted] = useState(false);
  useEffect(() => { setMounted(true); }, []);

  useEffect(() => { document.title = 'After Sales — ICAPROC'; }, []);
  useEffect(() => {
    if (authLoading) return;
    if (!user) { router.replace(`/login?next=${encodeURIComponent('/aftersales')}`); return; }
    if (profile && !canOpenPath(perms, '/aftersales')) router.replace('/unauthorized');
  }, [authLoading, user, profile, perms?.sellSide, router]);

  const load = useCallback(async () => {
    setLoading(true);
    const [cRes, pRes, custRes, oRes, compRes, qiRes, invRes, doRes] = await Promise.all([
      supabase.from('27.0_aftersales_cases').select('*').order('reported_at', { ascending: false }),
      supabase.from('27.1_aftersales_parts').select('*'),
      supabase.from('20.0_customers').select('customer_id, display_name, legal_name').order('display_name'),
      supabase.from('22.0_sales_quotes').select('quote_id, quote_number, order_number, status, customer_id, case_id, grand_total'),
      supabase.from('3.0_components').select('component_id, internal_description, warranty_value, warranty_unit, perf_warranty_value, perf_warranty_unit').order('internal_description'),
      supabase.from('22.1_sales_quote_items').select('quote_id, description, quantity, is_section').order('sort_order'),
      supabase.from('25.0_sales_invoices').select('invoice_id, quote_id, invoice_number, issued_at, created_at').order('created_at'),
      supabase.from('24.0_delivery_orders').select('do_id, quote_id, do_number, status, delivery_date, delivered_at').order('created_at'),
    ]);
    setCases((cRes.data as Case[]) ?? []);
    const by = new Map<string, Part[]>();
    for (const p of (pRes.data as Part[]) ?? []) by.set(p.case_id, [...(by.get(p.case_id) ?? []), p]);
    setPartsByCase(by);
    setCustomers((custRes.data as Customer[]) ?? []);
    setOrders((oRes.data as Order[]) ?? []);
    setComps(((compRes.data as Comp[]) ?? []).filter((c) => c.internal_description?.trim()));
    setQuoteItems(((qiRes.error ? [] : qiRes.data as QuoteItem[]) ?? []).filter((l) => !l.is_section && (l.description ?? '').trim()));
    setInvoices((invRes.error ? [] : invRes.data as Inv[]) ?? []);
    setDos((doRes.error ? [] : doRes.data as DoRow[]) ?? []);
    // The unit register — additive, and never allowed to cost the page
    fetchSerials(supabase).then(setSerials).catch(() => setSerials([]));
    setLoading(false);
  }, []);   // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (user && perms?.sellSide) load(); }, [user, perms?.sellSide, load]);

  // The documents the register's walk-back needs, in the shapes lib/serials wants
  const serialOrders = useMemo<SerialSalesDoc[]>(() => orders.map((o) => ({
    quote_id: o.quote_id, quote_number: o.quote_number, order_number: o.order_number,
    invoice_number: null, do_number: null, customer_id: o.customer_id, status: o.status,
  })), [orders]);
  const serialDos = useMemo<SerialDo[]>(() => dos.map((d) => ({
    do_id: d.do_id, do_number: d.do_number, quote_id: d.quote_id,
    delivery_date: d.delivery_date, delivered_at: d.delivered_at, status: d.status,
  })), [dos]);
  const serialInvoices = useMemo<SerialInvoice[]>(() => invoices.map((i) => ({
    invoice_id: i.invoice_id, invoice_number: i.invoice_number, quote_id: i.quote_id, issued_at: i.issued_at,
  })), [invoices]);
  const serialById = useMemo(() => new Map(serials.map((r) => [r.serial_id, r])), [serials]);

  /**
   * What the typed serial resolves to. Every match is kept: the same string can
   * belong to two products, and the desk must choose rather than be handed a
   * guess. Nothing is applied to the draft until a unit is picked.
   */
  const serialHits = useMemo(
    () => (serialInput.trim() ? lookupSerial(serialInput, serials) : []),
    [serialInput, serials]);
  const serialTrace = useMemo(() => {
    const picked = draft.serial_id ? serialById.get(draft.serial_id) : (serialHits.length === 1 ? serialHits[0] : null);
    return picked ? traceSerial(picked, serialOrders, serialDos, serialInvoices) : null;
  }, [draft.serial_id, serialById, serialHits, serialOrders, serialDos, serialInvoices]);

  /** Take a unit: its order, customer and product become the ticket's. */
  const applySerial = useCallback((row: SerialRow) => {
    const t = traceSerial(row, serialOrders, serialDos, serialInvoices);
    setSerialInput(row.serial);
    setDraft((d) => ({
      ...d,
      serial_id: row.serial_id,
      serial_text: row.serial,
      component_id: row.component_id,
      product_text: row.component_id ? '' : row.product_text,
      customer_id: t.customerId ?? d.customer_id ?? null,
      quote_id: t.order?.quote_id ?? d.quote_id ?? null,
      is_external: t.external,
    }));
  }, [serialOrders, serialDos, serialInvoices]);

  // Arriving from the serial register: open a new ticket already pointed at
  // that unit, so the walk from a label to a ticket is one click.
  const params = useSearchParams();
  const seededSerial = useRef(false);
  useEffect(() => {
    const q = params.get('serial');
    if (!q || seededSerial.current || !canEdit || loading) return;
    seededSerial.current = true;
    openEditor('new');
    setSerialInput(q);
    const hit = lookupSerial(q, serials);
    if (hit.length === 1) applySerial(hit[0]);
  }, [params, canEdit, loading, serials, applySerial]);   // eslint-disable-line react-hooks/exhaustive-deps

  const custName = useMemo(() => new Map(customers.map((c) => [c.customer_id, c.display_name || c.legal_name])), [customers]);
  const orderById = useMemo(() => new Map(orders.map((o) => [o.quote_id, o])), [orders]);
  const compByDesc = useMemo(() => new Map(comps.map((c) => [(c.internal_description ?? '').trim().toLowerCase(), c])), [comps]);
  const compById = useMemo(() => new Map(comps.map((c) => [c.component_id, c])), [comps]);

  const orderLabel = (id: string | null) => {
    const o = id ? orderById.get(id) : null;
    return o ? (displayDocNumber(o) || '—') : '';
  };

  // The case's warranty VERDICT — computable once a linked item carries a
  // structured warranty. The clock starts when the goods went out (first
  // delivery, else first invoice); every linked part gets its own run, and
  // the case's badge summarises: all inside → In warranty, all past → Out of
  // warranty, some of each → Partly in warranty.
  const warrantyVerdictFor = useCallback((parts: Part[], invs: Inv[], qdos: DoRow[]) => {
    const delivered = qdos.filter((d) => d.status === 'delivered').map((d) => d.delivered_at || d.delivery_date).filter(Boolean).sort() as string[];
    const issued = invs.map((i) => i.issued_at || i.created_at).filter(Boolean).sort() as string[];
    const start = delivered[0] ?? issued[0] ?? null;
    if (!start) return null;
    const runs = parts.flatMap((p) => {
      const cmp = p.component_id ? compById.get(p.component_id) : null;
      if (!cmp || !cmp.warranty_value) return [];
      return [{ p, cmp, run: warrantyRun(start, Number(cmp.warranty_value), (cmp.warranty_unit as WarrantyUnit) || 'years') }];
    });
    if (!runs.length) return null;
    const inCount = runs.filter((r) => !r.run.expired).length;
    const status: 'in' | 'out' | 'mixed' = inCount === runs.length ? 'in' : inCount === 0 ? 'out' : 'mixed';
    // The badge carries the tightest clock: the covered part ending soonest,
    // or (all lapsed) the one that expired most recently.
    const covered = runs.filter((r) => !r.run.expired).sort((a, b) => a.run.daysLeft - b.run.daysLeft);
    const lapsed = runs.filter((r) => r.run.expired).sort((a, b) => b.run.daysLeft - a.run.daysLeft);
    const headline = covered[0] ?? lapsed[0];
    return { status, runs, start, startKind: delivered[0] ? 'delivery' : 'invoice', headline };
  }, [compById]);

  // Elapsed time since a document date — the number the warranty judgement
  // needs ("13.4 months since the invoice"). Deliberately no verdict: the
  // period differs per product and supplier, so after-sales decides.
  const runningFor = (iso: string | null | undefined): string | null => {
    if (!iso) return null;
    const days = Math.floor((Date.now() - new Date(iso).getTime()) / 86400000);
    if (days < 0) return null;
    if (days < 31) return `${days} day${days === 1 ? '' : 's'}`;
    return `${(days / 30.44).toFixed(1)} months`;
  };

  const visible = useMemo(() => {
    const q = search.trim().toLowerCase();
    return cases.filter((c) => {
      if (catFilter && c.category !== catFilter) return false;
      if (!inRange((c.reported_at ?? '').slice(0, 10), range)) return false;
      if (!q) return true;
      const parts = (partsByCase.get(c.case_id) ?? []).map((p) => p.description).join(' ');
      // A serial matches however it was typed — the label rarely gets copied
      // the same way twice.
      const qn = normSerial(search);
      const serial = c.serial_text || (c.serial_id ? serialById.get(c.serial_id)?.serial ?? '' : '');
      if (qn && normSerial(serial).includes(qn)) return true;
      return `${c.case_number} ${c.subject} ${c.description} ${custName.get(c.customer_id ?? '') ?? ''} ${orderLabel(c.quote_id)} ${parts} ${serial} ${c.product_text}`
        .toLowerCase().includes(q);
    });
  }, [cases, search, catFilter, range, custName, partsByCase, orderById, serialById]);   // eslint-disable-line react-hooks/exhaustive-deps

  /** The ticket table's rows — the unit first, the order second. */
  const ticketRows = useMemo(() => {
    const val = (c: Case): string => {
      const row = c.serial_id ? serialById.get(c.serial_id) : null;
      const t = row ? traceSerial(row, serialOrders, serialDos, serialInvoices) : null;
      switch (ticketSort.key) {
        case 'reported': return c.reported_at ?? '';
        case 'serial':   return normSerial(c.serial_text || row?.serial || '');
        case 'product':  return (c.component_id ? compById.get(c.component_id)?.internal_description ?? '' : c.product_text).toLowerCase();
        case 'customer': return (custName.get(c.customer_id ?? '') ?? '').toLowerCase();
        case 'order':    return (t?.order ? displayDocNumber(t.order) : (c.quote_id ? orderLabel(c.quote_id) : '')).toLowerCase();
        case 'category': return c.category;
        case 'status':   return c.status;
        // The ticket number CARRIES its date (AS-YYYYMMDD-NNNN), so sorting on
        // it is chronological by construction — newest first by default.
        default:         return c.case_number;
      }
    };
    return [...visible].sort((a, b) => val(a).localeCompare(val(b)) * ticketSort.dir);
  }, [visible, ticketSort, serialById, serialOrders, serialDos, serialInvoices, compById, custName]);   // eslint-disable-line react-hooks/exhaustive-deps

  /** A sortable column head for the ticket table. */
  const ticketTh = (key: TicketSort, label: string) => (
    <button onClick={() => setTicketSort((t) => ({
      key,
      // Dates and ticket numbers read newest-first; words read A→Z
      dir: t.key === key ? (t.dir === 1 ? -1 : 1) : (key === 'ticket' || key === 'reported' ? -1 : 1),
    }))}
      className={`text-left font-semibold uppercase tracking-widest text-[10px] hover:text-white transition-colors ${ticketSort.key === key ? 'text-emerald-300' : 'text-slate-500'}`}>
      {label}{ticketSort.key === key ? (ticketSort.dir === 1 ? ' ↑' : ' ↓') : ''}
    </button>
  );

  const catCounts = useMemo(() => {
    const m = new Map<string, number>();
    for (const c of cases) m.set(c.category, (m.get(c.category) ?? 0) + 1);
    return m;
  }, [cases]);
  const openCount = cases.filter((c) => !['resolved', 'closed'].includes(c.status)).length;

  // ── Editor ────────────────────────────────────────────────────────────────
  const openEditor = async (c: Case | 'new') => {
    setEditing(c);
    setNewNote('');
    if (c === 'new') {
      setDraft({
        category: 'repair', status: 'open', reported_at: new Date().toISOString().slice(0, 10),
        subject: '', description: '', resolution: '', customer_id: null, quote_id: null,
        serial_id: null, serial_text: '', component_id: null, product_text: '',
        is_external: false, purchased_from: '', purchased_at: null,
      });
      setSerialInput('');
      setDraftParts([]);
      setUpdates([]);
    } else {
      setDraft({ ...c });
      setSerialInput(c.serial_text || (c.serial_id ? serialById.get(c.serial_id)?.serial ?? '' : ''));
      setDraftParts((partsByCase.get(c.case_id) ?? []).map((p) => ({
        part_id: p.part_id, component_id: p.component_id, description: p.description,
        action: p.action, quantity: String(p.quantity), notes: p.notes,
      })));
      const { data } = await supabase.from('27.2_aftersales_updates').select('*').eq('case_id', c.case_id).order('created_at', { ascending: false });
      setUpdates((data as Update[]) ?? []);
    }
  };

  const set = (k: keyof Case, v: unknown) => setDraft((d) => ({ ...d, [k]: v }));

  async function save() {
    if (!canEdit || busy) return;
    if (!draft.subject?.trim() && !draft.description?.trim()) { flash('Give the case a subject.'); return; }
    setBusy(true);
    try {
      const row = {
        customer_id: draft.customer_id || null,
        quote_id: draft.quote_id || null,
        category: draft.category ?? 'repair',
        status: draft.status ?? 'open',
        subject: draft.subject?.trim() ?? '',
        description: draft.description ?? '',
        resolution: draft.resolution ?? '',
        reported_at: draft.reported_at || new Date().toISOString().slice(0, 10),
        // The unit under service. The typed serial is kept even when the
        // register has never seen it — a ticket must open either way, and
        // matching it to a unit can happen later.
        serial_id: draft.serial_id || null,
        serial_text: (serialInput || draft.serial_text || '').trim(),
        component_id: draft.component_id || null,
        product_text: (draft.product_text ?? '').trim(),
        is_external: !!draft.is_external,
        purchased_from: (draft.purchased_from ?? '').trim(),
        purchased_at: draft.purchased_at || null,
      };
      let caseId = editing !== 'new' && editing ? editing.case_id : null;
      if (caseId) {
        const { error } = await supabase.from('27.0_aftersales_cases').update(row).eq('case_id', caseId);
        if (error) throw error;
      } else {
        const { data, error } = await supabase.from('27.0_aftersales_cases').insert(row).select('case_id').single();
        if (error) throw error;
        caseId = (data as { case_id: string }).case_id;
      }
      // Parts are replaced wholesale — same rule as imported order lines, so an
      // edit can remove a line without a separate delete flow.
      await supabase.from('27.1_aftersales_parts').delete().eq('case_id', caseId);
      const rows = draftParts
        .filter((p) => p.description.trim())
        .map((p) => ({
          case_id: caseId, component_id: p.component_id,
          description: p.description.trim(), action: p.action,
          quantity: Number(p.quantity) || 1, notes: p.notes,
        }));
      if (rows.length) {
        const { error } = await supabase.from('27.1_aftersales_parts').insert(rows);
        if (error) throw error;
      }
      setEditing(null);
      flash('Case saved.');
      load();
    } catch (e) {
      flash(`Could not save — ${(e as Error).message}`);
    } finally { setBusy(false); }
  }

  async function addNote() {
    if (!canEdit || !newNote.trim() || editing === 'new' || !editing) return;
    const { error } = await supabase.from('27.2_aftersales_updates').insert({ case_id: editing.case_id, note: newNote.trim() });
    if (error) { flash(`Could not add the note — ${error.message}`); return; }
    setNewNote('');
    const { data } = await supabase.from('27.2_aftersales_updates').select('*').eq('case_id', editing.case_id).order('created_at', { ascending: false });
    setUpdates((data as Update[]) ?? []);
  }

  const customerOrders = useMemo(
    () => orders.filter((o) => !draft.customer_id || o.customer_id === draft.customer_id),
    [orders, draft.customer_id]);
  const customerOptions = useMemo(() => customers.map((c) => ({
    customer_id: c.customer_id,
    name: c.display_name || c.legal_name,
    sub: c.legal_name && c.legal_name !== (c.display_name || c.legal_name) ? c.legal_name : '',
  })), [customers]);
  const orderOptions = useMemo(() => customerOrders.map((o) => ({
    quote_id: o.quote_id,
    label: displayDocNumber(o) || '—',
    sub: [custName.get(o.customer_id ?? ''), o.status].filter(Boolean).join(' · '),
  })), [customerOrders, custName]);
  // The items ON the selected order — offered as one-click chips, because a
  // case about SO-x is almost always about something that was on SO-x.
  const soItems = useMemo(
    () => (draft.quote_id ? quoteItems.filter((l) => l.quote_id === draft.quote_id) : []),
    [quoteItems, draft.quote_id]);
  // Quotes raised FOR this case (repair / replacement offers)
  const caseQuotes = useMemo(
    () => (editing && editing !== 'new' ? orders.filter((o) => o.case_id === editing.case_id) : []),
    [orders, editing]);

  if (authLoading || !user) {
    return <div className="min-h-screen bg-chrome flex items-center justify-center"><div className="w-6 h-6 border-2 border-emerald-500/30 border-t-emerald-500 rounded-full animate-spin" /></div>;
  }

  const inputCls = 'w-full h-9 px-3 rounded-lg bg-slate-900 border border-slate-700 focus:border-emerald-500/60 outline-none text-white text-sm placeholder:text-slate-600 transition-colors';

  return (
    <div className="min-h-screen bg-chrome text-slate-200 font-sans text-sm">
      <div className="border-b border-slate-800/60 bg-chrome/80 backdrop-blur-md sticky top-0 z-30">
        <div className="max-w-[1400px] 2xl:max-w-[1760px] mx-auto px-3 sm:px-4 md:px-6 py-3 sm:py-4 flex flex-col sm:flex-row sm:items-center justify-between sm:flex-wrap gap-2.5 sm:gap-4">
          <BrandMenu wordmarkClass="text-xl md:text-2xl font-extrabold" subtitle={t("After Sales · Service & warranty cases")} />
        </div>
      </div>

      <main className="max-w-[1400px] 2xl:max-w-[1760px] mx-auto px-3 sm:px-4 md:px-6 py-6 space-y-5">
        {toast && <div className="rounded-xl border border-emerald-500/30 bg-emerald-500/10 px-4 py-2.5 text-xs text-emerald-200">{toast}</div>}

        {/* ── Filters ── */}
        <div className="flex flex-wrap items-center gap-2">
          {/* Leftmost: the primary action, ghost-styled like the rest of the toolbar */}
          {canEdit && (
            <button onClick={() => openEditor('new')}
              className="flex items-center gap-1.5 px-3 h-10 rounded-xl border border-emerald-500/40 text-emerald-300 hover:bg-emerald-500/10 text-xs font-semibold whitespace-nowrap transition-colors flex-shrink-0">
              <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2"><path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" /></svg>
              New Case
            </button>
          )}
          <div className="relative flex-1 min-w-[180px]">
            <svg className="w-4 h-4 text-slate-500 absolute left-3.5 top-1/2 -translate-y-1/2" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M21 21l-4.35-4.35M17 11a6 6 0 11-12 0 6 6 0 0112 0z" /></svg>
            <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search serial, ticket, customer, order, item…"
              className="w-full pl-10 pr-4 h-10 rounded-xl bg-slate-900/80 border border-slate-700/80 focus:border-emerald-500/60 outline-none text-white text-base sm:text-sm placeholder:text-[13px] sm:placeholder:text-sm placeholder:text-slate-500 transition-colors" />
          </div>
          {Object.entries(CATEGORIES).map(([k, c]) => (
            <button key={k} onClick={() => setCatFilter(catFilter === k ? '' : k)}
              className={`text-[11px] px-2.5 py-1.5 rounded-lg border transition-colors whitespace-nowrap ${catFilter === k ? 'bg-emerald-500/15 border-emerald-500/40 text-emerald-300 font-bold' : 'border-slate-700/80 text-slate-500 hover:text-slate-300'}`}>
              {c.label}{catCounts.get(k) ? ` ${catCounts.get(k)}` : ''}
            </button>
          ))}
          <DateRangeFilter value={range} onChange={(r) => { listTouched.current = true; setRange(r); }} label="Reported" />
          {/* Two ways to work the same tickets. The house default is Settings ›
              Defaults; this switch is personal and lasts the visit. */}
          <div className="flex items-center rounded-lg border border-slate-700/80 overflow-hidden">
            {(['ticket', 'order'] as const).map((m) => (
              <button key={m} onClick={() => setMode(m)}
                title={m === 'ticket'
                  ? 'One row per service ticket, newest first — start from the serial number'
                  : 'Grouped by status, the way the desk worked before — start from the sales order'}
                className={`text-[11px] px-2.5 py-1.5 font-semibold transition-colors ${mode === m ? 'bg-emerald-500/15 text-emerald-300' : 'text-slate-500 hover:text-slate-300'}`}>
                {m === 'ticket' ? 'By ticket' : 'By order'}
              </button>
            ))}
          </div>
          {mode === 'order' && <LayoutToggle value={layout} onChange={setLayout} />}
        </div>

        {loading ? (
          <div className="space-y-2">{[...Array(4)].map((_, i) => <div key={i} className="h-16 bg-slate-800/40 rounded-2xl animate-pulse" />)}</div>
        ) : cases.length === 0 ? (
          <div className="bg-slate-900/50 border border-slate-800 rounded-2xl p-10 text-center space-y-2">
            <p className="text-slate-300 font-semibold">No after-sales cases yet</p>
            <p className="text-xs text-slate-500 max-w-md mx-auto">
              When a customer reports a fault, log it here — attached to their sales order and the items involved —
              and the service history builds itself.
            </p>
            {canEdit && (
              <button onClick={() => openEditor('new')} className="text-xs font-semibold text-emerald-300 hover:text-emerald-200 transition-colors">
                Log the first case →
              </button>
            )}
          </div>
        ) : visible.length === 0 ? (
          <p className="text-slate-500 text-xs italic py-10 text-center">No case matches.</p>
        ) : mode === 'ticket' ? (
          /* ── By ticket: one row per ticket, every column sorts ─────────── */
          <div className="bg-slate-900/40 border border-slate-800/80 rounded-2xl overflow-hidden">
            <div className="hidden lg:grid grid-cols-[165px_90px_150px_1fr_150px_120px_110px_100px] gap-3 px-4 py-2.5 border-b border-slate-800 bg-chrome">
              {ticketTh('ticket', 'Ticket')}{ticketTh('reported', 'Reported')}{ticketTh('serial', 'Serial')}
              {ticketTh('product', 'Product')}{ticketTh('customer', 'Customer')}{ticketTh('order', 'Order')}
              {ticketTh('category', 'Category')}{ticketTh('status', 'Status')}
            </div>
            <div className="divide-y divide-slate-800/60">
              {ticketRows.map((c) => {
                const cat = CATEGORIES[c.category] ?? CATEGORIES.other;
                const row = c.serial_id ? serialById.get(c.serial_id) : null;
                const t = row ? traceSerial(row, serialOrders, serialDos, serialInvoices) : null;
                const so = t?.order ?? (c.quote_id ? orderById.get(c.quote_id) : null);
                const product = c.component_id
                  ? compById.get(c.component_id)?.internal_description ?? '—'
                  : c.product_text || (partsByCase.get(c.case_id) ?? []).map((p) => p.description).filter(Boolean).join(', ') || c.subject || '—';
                const serialShown = c.serial_text || row?.serial || '';
                return (
                  <button key={c.case_id} onClick={() => openEditor(c)}
                    className="w-full text-left px-4 py-2.5 hover:bg-white/[0.03] transition-colors lg:grid lg:grid-cols-[165px_90px_150px_1fr_150px_120px_110px_100px] lg:gap-3 lg:items-center">
                    <span className="font-mono text-xs text-emerald-300">{c.case_number}</span>
                    <span className="hidden lg:block text-[11px] text-slate-500 tabular-nums">{fmtDay(c.reported_at)}</span>
                    <span className="hidden lg:block font-mono text-[11px] text-slate-300 truncate" title={serialShown}>
                      {serialShown || <span className="text-slate-600">—</span>}
                    </span>
                    <span className="text-xs text-slate-300 truncate block lg:inline" title={product}>
                      {product}
                      {c.is_external && <span className="ml-2 text-[9px] font-bold uppercase tracking-widest px-1.5 py-0.5 rounded bg-amber-500/15 text-amber-300">not ours</span>}
                    </span>
                    <span className="hidden lg:block text-[11px] text-slate-400 truncate">{custName.get(c.customer_id ?? '') || '—'}</span>
                    <span className="hidden lg:block text-[11px] text-sky-300 font-mono truncate">{so ? displayDocNumber(so) : '—'}</span>
                    <span className="hidden lg:block">
                      <span className={`px-1.5 py-0.5 rounded text-[9px] font-semibold ${cat.cls}`}>{cat.label}</span>
                    </span>
                    <span className="hidden lg:block">
                      <span className={`px-1.5 py-0.5 rounded text-[9px] font-semibold ${STATUS_BADGE[c.status]}`}>{statusLabel(c.status)}</span>
                    </span>
                    {/* Phone: the same facts, stacked */}
                    <span className="lg:hidden block text-[11px] text-slate-500 mt-0.5 truncate">
                      {[serialShown, custName.get(c.customer_id ?? ''), so ? displayDocNumber(so) : '', statusLabel(c.status)].filter(Boolean).join(' · ')}
                    </span>
                  </button>
                );
              })}
            </div>
          </div>
        ) : (
          <div className="space-y-7">
            {STATUS_SECTIONS.map(({ key, label, accent, rule }) => {
              const group = visible.filter((c) => c.status === key);
              if (!group.length) return null;
              return (
                <div key={key}>
                  <div className="flex items-center gap-3 mb-2.5 px-1">
                    <h2 className={`text-xs font-bold uppercase tracking-widest ${accent}`}>{label}</h2>
                    <span className="text-[11px] text-slate-600 tabular-nums">{group.length}</span>
                    <div className={`flex-1 h-px ${rule}`} />
                  </div>
                  <div className="space-y-2">
                    {group.map((c) => {
                      const parts = partsByCase.get(c.case_id) ?? [];
                      const cat = CATEGORIES[c.category] ?? CATEGORIES.other;
                      const open = expandedId === c.case_id;
                      // What is actually being repaired — subject, else the items, else the report
                      const what = c.subject || parts.map((p) => p.description).filter(Boolean).join(', ') || c.description || '—';
                      const so = c.quote_id ? orderById.get(c.quote_id) : null;
                      const invs = c.quote_id ? invoices.filter((i) => i.quote_id === c.quote_id) : [];
                      const qdos = c.quote_id ? dos.filter((d) => d.quote_id === c.quote_id) : [];
                      const svcQuotes = orders.filter((o) => o.case_id === c.case_id);
                      const wty = warrantyVerdictFor(parts, invs, qdos);
                      const wtyTitle = wty ? `${WTY_BADGE[wty.status].label} — ${wty.headline.run.label}, running from the ${wty.startKind} date` : undefined;
                      const lbl = 'w-20 flex-shrink-0 text-[9px] font-semibold uppercase tracking-widest text-slate-600';
                      const docLink = 'inline-flex items-center gap-1 font-mono text-[10px] text-slate-400 hover:text-emerald-300 transition-colors';
                      return (
                        <div key={c.case_id} className={`bg-slate-900/50 border transition-all overflow-hidden ${open ? 'border-slate-700' : 'border-slate-800 hover:border-slate-700'} ${compact ? 'rounded-lg' : 'rounded-2xl'}`}>
                          {/* div, not <button>: the row carries real <a> links inside */}
                          <div role="button" tabIndex={0} aria-expanded={open}
                            onClick={() => setExpandedId(open ? null : c.case_id)}
                            onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setExpandedId(open ? null : c.case_id); } }}
                            className={`w-full text-left cursor-pointer hover:bg-slate-900/80 transition-colors ${compact ? 'px-3 py-2' : 'px-4 sm:px-5 py-3.5'}`}>
                            {compact ? (
                              <div className="flex items-center gap-2 min-w-0">
                                <span className="font-semibold text-slate-100 text-[13px] truncate flex-shrink-0 max-w-[30%]">{custName.get(c.customer_id ?? '') || 'No customer'}</span>
                                <span className={`px-1.5 py-0.5 rounded text-[9px] font-semibold whitespace-nowrap flex-shrink-0 ${cat.cls}`}>{cat.label}</span>
                                {wty && <span className={`px-1.5 py-0.5 rounded text-[9px] font-semibold whitespace-nowrap flex-shrink-0 ${WTY_BADGE[wty.status].cls}`} title={wtyTitle}>{WTY_BADGE[wty.status].label}</span>}
                                <span className="text-[11px] text-slate-400 truncate">{what}</span>
                                <span className="ml-auto flex items-center gap-3 flex-shrink-0 tabular-nums">
                                  {/* The case's documents, one click away without expanding */}
                                  {(so || invs.length > 0 || qdos.length > 0) && (
                                    <span className="hidden lg:flex items-center gap-2 font-mono text-[10px]">
                                      {so && <a href={`/sales/${so.quote_id}`} target="_blank" rel="noopener noreferrer" onClick={(e) => e.stopPropagation()} className="text-slate-500 hover:text-emerald-300 transition-colors">{displayDocNumber(so)}</a>}
                                      {invs.slice(0, 1).map((i) => <a key={i.invoice_id} href={`/sales/${i.quote_id}/print?inv=${i.invoice_id}`} target="_blank" rel="noopener noreferrer" onClick={(e) => e.stopPropagation()} className="text-slate-500 hover:text-emerald-300 transition-colors">{i.invoice_number}</a>)}
                                      {qdos.slice(0, 1).map((d) => <a key={d.do_id} href={`/sales/${d.quote_id}/do?do=${d.do_id}`} target="_blank" rel="noopener noreferrer" onClick={(e) => e.stopPropagation()} className="text-slate-500 hover:text-emerald-300 transition-colors">{d.do_number}</a>)}
                                      {(invs.length > 1 || qdos.length > 1) && <span className="text-slate-600" title="More invoices / delivery orders — expand the row">+{Math.max(0, invs.length - 1) + Math.max(0, qdos.length - 1)}</span>}
                                    </span>
                                  )}
                                  {parts.length > 0 && <span className="text-[10px] text-slate-500">{fmtInt(parts.length)} item{parts.length !== 1 ? 's' : ''}</span>}
                                  <span className="font-mono text-[10px] text-slate-600 hidden sm:block">{c.case_number}</span>
                                  <span className="w-[4.5rem] text-right text-[10px] text-slate-500">{fmtDay(c.reported_at)}</span>
                                </span>
                              </div>
                            ) : (
                              <>
                                <div className="flex flex-wrap items-center gap-2 mb-1">
                                  <span className="font-semibold text-white truncate">{custName.get(c.customer_id ?? '') || 'No customer'}</span>
                                  <span className={`px-2 py-0.5 rounded-full text-[10px] font-semibold whitespace-nowrap flex-shrink-0 ${cat.cls}`}>{cat.label}</span>
                                  <span className={`px-2 py-0.5 rounded-full text-[10px] font-semibold whitespace-nowrap flex-shrink-0 ${STATUS_BADGE[c.status]}`}>{statusLabel(c.status)}</span>
                                  {wty && (
                                    <span className={`px-2 py-0.5 rounded-full text-[10px] font-semibold whitespace-nowrap flex-shrink-0 ${WTY_BADGE[wty.status].cls}`} title={wtyTitle}>
                                      {WTY_BADGE[wty.status].label} · {wty.headline.run.label}
                                    </span>
                                  )}
                                  {so && <a href={`/sales/${so.quote_id}`} target="_blank" rel="noopener noreferrer" onClick={(e) => e.stopPropagation()} className="font-mono text-[10px] text-slate-500 hover:text-emerald-300 transition-colors">{displayDocNumber(so)}</a>}
                                </div>
                                <p className="text-xs text-slate-400 truncate mb-1">{what}</p>
                                <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-slate-500">
                                  <span className="font-mono">{c.case_number}</span>
                                  <span>reported {fmtDay(c.reported_at)}</span>
                                  {c.resolved_at && <span className="text-emerald-400/80">resolved {fmtDay(c.resolved_at)}</span>}
                                  {invs.map((i) => <a key={i.invoice_id} href={`/sales/${i.quote_id}/print?inv=${i.invoice_id}`} target="_blank" rel="noopener noreferrer" onClick={(e) => e.stopPropagation()} className="font-mono text-[10px] text-slate-500 hover:text-emerald-300 transition-colors">{i.invoice_number}</a>)}
                                  {qdos.map((d) => <a key={d.do_id} href={`/sales/${d.quote_id}/do?do=${d.do_id}`} target="_blank" rel="noopener noreferrer" onClick={(e) => e.stopPropagation()} className="font-mono text-[10px] text-slate-500 hover:text-emerald-300 transition-colors">{d.do_number}</a>)}
                                </div>
                              </>
                            )}
                          </div>
                          {/* Expanded overview — the case in its commercial context:
                              order, invoice, delivery (each with its running age,
                              the two clocks warranty judgement runs on), items,
                              and any repair quotes. Editing is one more click. */}
                          {open && (
                            <div className="border-t border-slate-800/60 bg-slate-950/40 px-4 py-3 space-y-1.5 text-[11px]">
                              <p className="flex items-center gap-2 flex-wrap">
                                <span className={lbl}>Sales order</span>
                                {so ? (
                                  <>
                                    <a href={`/sales/${so.quote_id}`} target="_blank" rel="noopener noreferrer" className={docLink}>{displayDocNumber(so)}</a>
                                    <span className={`px-1.5 py-0.5 rounded text-[10px] font-semibold ${SALES_STATUS[so.status]?.cls ?? ''}`}>{SALES_STATUS[so.status]?.label ?? so.status}</span>
                                  </>
                                ) : <span className="text-slate-600 italic">none linked</span>}
                              </p>
                              <p className="flex items-center gap-x-3 gap-y-1 flex-wrap">
                                <span className={lbl}>Invoice{invs.length > 1 ? `s ×${invs.length}` : ''}</span>
                                {invs.length === 0 ? <span className="text-slate-600 italic">none</span> : invs.map((i) => (
                                  <span key={i.invoice_id} className="inline-flex items-center gap-1.5">
                                    <a href={`/sales/${i.quote_id}/print?inv=${i.invoice_id}`} target="_blank" rel="noopener noreferrer" className={docLink}>{i.invoice_number}</a>
                                    <span className="text-slate-500">issued {fmtDay(i.issued_at || i.created_at)}</span>
                                    {runningFor(i.issued_at || i.created_at) && <span className="text-amber-300/90 tabular-nums">{runningFor(i.issued_at || i.created_at)} running</span>}
                                  </span>
                                ))}
                              </p>
                              <p className="flex items-center gap-x-3 gap-y-1 flex-wrap">
                                <span className={lbl}>Delivery{qdos.length > 1 ? ` ×${qdos.length}` : ''}</span>
                                {qdos.length === 0 ? <span className="text-slate-600 italic">none</span> : qdos.map((d) => (
                                  <span key={d.do_id} className="inline-flex items-center gap-1.5">
                                    <a href={`/sales/${d.quote_id}/do?do=${d.do_id}`} target="_blank" rel="noopener noreferrer" className={docLink}>{d.do_number}</a>
                                    {d.status === 'delivered' ? (
                                      <>
                                        <span className="text-slate-500">delivered {fmtDay(d.delivered_at || d.delivery_date)}</span>
                                        {runningFor(d.delivered_at || d.delivery_date) && <span className="text-amber-300/90 tabular-nums">{runningFor(d.delivered_at || d.delivery_date)} running</span>}
                                      </>
                                    ) : <span className="text-orange-300/80">preparing</span>}
                                  </span>
                                ))}
                              </p>
                              {(invs.length > 0 || qdos.some((d) => d.status === 'delivered')) && (
                                <p className="flex items-start gap-2 flex-wrap">
                                  <span className={`${lbl} mt-0.5`}>Warranty</span>
                                  {wty ? (
                                    <span className="flex-1 min-w-0 space-y-0.5">
                                      <span className={`inline-block px-2 py-0.5 rounded-full text-[10px] font-semibold ${WTY_BADGE[wty.status].cls}`}>
                                        {WTY_BADGE[wty.status].label}
                                      </span>
                                      {wty.runs.map(({ p, cmp, run }) => (
                                        <span key={p.part_id} className="flex flex-wrap items-center gap-x-2">
                                          <span className="text-slate-400 truncate max-w-[260px]">{p.description}</span>
                                          <span className="text-slate-500">{fmtWarranty(cmp.warranty_value, cmp.warranty_unit)} from {wty.startKind} {fmtDay(wty.start)}</span>
                                          <span className={`font-semibold tabular-nums ${run.expired ? 'text-rose-300' : 'text-emerald-300'}`}>
                                            {run.expired ? '✕' : '✓'} {run.label} · until {fmtDay(run.end.toISOString())}
                                          </span>
                                          {fmtWarranty(cmp.perf_warranty_value, cmp.perf_warranty_unit) && (
                                            <span className="text-slate-600" title="Performance warranty — output guarantee, not a repair claim">
                                              perf {fmtWarranty(cmp.perf_warranty_value, cmp.perf_warranty_unit)}
                                            </span>
                                          )}
                                        </span>
                                      ))}
                                    </span>
                                  ) : (
                                    <span className="text-slate-500">
                                      runs from the invoice and delivery dates above — no structured warranty on the linked items yet; set it in Products or the Item Editor and the verdict computes itself
                                    </span>
                                  )}
                                </p>
                              )}
                              {parts.length > 0 && (
                                <p className="flex items-start gap-2 flex-wrap">
                                  <span className={`${lbl} mt-0.5`}>Items</span>
                                  <span className="flex-1 min-w-0 text-slate-400">
                                    {parts.map((p) => `${ACTIONS[p.action] ?? p.action}: ${p.description}${Number(p.quantity) !== 1 ? ` ×${fmtQty(Number(p.quantity))}` : ''}`).join(' · ')}
                                  </span>
                                </p>
                              )}
                              {svcQuotes.length > 0 && (
                                <p className="flex items-center gap-x-3 gap-y-1 flex-wrap">
                                  <span className={lbl}>Quotes</span>
                                  {svcQuotes.map((q) => (
                                    <span key={q.quote_id} className="inline-flex items-center gap-1.5">
                                      <a href={`/sales/${q.quote_id}`} target="_blank" rel="noopener noreferrer" className={docLink}>{displayDocNumber(q)}</a>
                                      <span className={`px-1.5 py-0.5 rounded text-[10px] font-semibold ${SALES_STATUS[q.status]?.cls ?? ''}`}>{SALES_STATUS[q.status]?.label ?? q.status}</span>
                                    </span>
                                  ))}
                                </p>
                              )}
                              <div className="pt-1.5">
                                <button onClick={() => openEditor(c)}
                                  className="px-2.5 py-1 rounded-md border border-slate-700/70 text-[11px] font-medium text-slate-400 hover:text-emerald-300 hover:border-emerald-500/40 transition-colors">
                                  {canEdit ? '✎ Open case' : 'View details'}
                                </button>
                              </div>
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </div>
              );
            })}
          </div>
        )}

        <p className="text-[10px] text-slate-600 max-w-3xl">
          {openCount > 0 ? `${fmtInt(openCount)} case${openCount !== 1 ? 's' : ''} still open. ` : ''}
          Parts logged here do not move stock — a warranty replacement that should leave the warehouse is issued from{' '}
          <Link href="/stock" className="text-emerald-500/80 hover:text-emerald-300">Stock</Link> as its own movement.
        </p>
      </main>

      {/* ── Case editor (portaled: headers use backdrop-blur, which WebKit
             treats as a containing block for fixed descendants) ── */}
      {editing && mounted && createPortal(
        <div className="fixed inset-0 z-[120] flex items-end sm:items-center justify-center">
          <div className="absolute inset-0 bg-black/60" onClick={() => !busy && setEditing(null)} />
          <div className="relative bg-slate-900 border border-slate-700 sm:rounded-2xl rounded-t-2xl w-full max-w-2xl max-h-[92vh] overflow-y-auto p-5 space-y-4">
            <div className="flex items-center justify-between gap-3">
              <div>
                <h3 className="font-semibold text-white">{editing === 'new' ? 'New after-sales case' : (editing.case_number || 'Case')}</h3>
                {editing !== 'new' && (
                  <p className="text-[10px] text-slate-600 mt-0.5">
                    opened by {editing.created_by_email || '—'} · {fmtDayTime(editing.created_at)}
                  </p>
                )}
              </div>
              <button onClick={() => !busy && setEditing(null)} className="text-slate-500 hover:text-white p-1 transition-colors">
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2"><path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" /></svg>
              </button>
            </div>

            {/* ── The unit ─────────────────────────────────────────────────
                The desk starts here, not at the order: a customer is holding a
                machine and reading a label. Type the serial and the order, the
                invoice, the delivery and the customer arrive with it. */}
            <div className="bg-slate-900/60 border border-emerald-500/20 rounded-xl p-3 space-y-2.5">
              <div className="flex flex-wrap items-end gap-2">
                <label className="block flex-1 min-w-[200px]">
                  <span className="block text-[10px] uppercase tracking-widest text-emerald-400/80 mb-1">Serial number</span>
                  <input value={serialInput} disabled={!canEdit}
                    onChange={(e) => {
                      setSerialInput(e.target.value);
                      // Typing past a chosen unit un-chooses it — no stale link
                      if (draft.serial_id && normSerial(e.target.value) !== normSerial(serialById.get(draft.serial_id)?.serial ?? '')) {
                        set('serial_id', null);
                      }
                    }}
                    placeholder="Read it off the label — dashes and spaces don't matter"
                    className={`${inputCls} font-mono`} />
                </label>
                <Link href={`/serials?q=${encodeURIComponent(serialInput)}`}
                  className="px-3 py-2 rounded-lg border border-slate-700 text-slate-400 hover:text-emerald-300 hover:border-emerald-500/40 text-[11px] font-semibold whitespace-nowrap transition-colors"
                  title={t("Open the serial register")}>Register ↗</Link>
              </div>

              {/* One match: taken. Several: the desk picks. None: say so plainly. */}
              {serialInput.trim() && !draft.serial_id && serialHits.length > 0 && (
                <div className="space-y-1.5">
                  <p className="text-[11px] text-slate-500">{serialHits.length === 1 ? 'Found this unit:' : `${serialHits.length} units carry that serial — pick the right product:`}</p>
                  {serialHits.map((r) => {
                    const t = traceSerial(r, serialOrders, serialDos, serialInvoices);
                    return (
                      <button key={r.serial_id} onClick={() => applySerial(r)} disabled={!canEdit}
                        className="w-full text-left px-3 py-2 rounded-lg bg-emerald-500/[0.07] border border-emerald-500/25 hover:bg-emerald-500/15 transition-colors">
                        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px]">
                          <span className="font-mono text-emerald-300">{r.serial}</span>
                          <span className="text-slate-300">{r.component_id ? compById.get(r.component_id)?.internal_description ?? '—' : r.product_text || '—'}</span>
                          <span className="text-slate-500">{custName.get(t.customerId ?? '') ?? 'no customer'}</span>
                          {t.order && <span className="text-sky-300 font-mono">{displayDocNumber(t.order)}</span>}
                          {t.delivery?.do_number && <span className="text-slate-500 font-mono">{t.delivery.do_number}</span>}
                          {t.external && <span className="text-amber-300">not sold by us</span>}
                        </div>
                      </button>
                    );
                  })}
                </div>
              )}

              {/* Typed, and the register has never seen it */}
              {serialInput.trim() && !draft.serial_id && serialHits.length === 0 && (
                <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 text-[11px]">
                  <span className="text-amber-300">No unit with that serial in the register.</span>
                  <span className="text-slate-500">Open the ticket anyway — the serial is kept as typed.</span>
                  <label className="flex items-center gap-1.5 text-slate-400 cursor-pointer">
                    <input type="checkbox" checked={!!draft.is_external} disabled={!canEdit}
                      onChange={(e) => set('is_external', e.target.checked)} className="w-3.5 h-3.5 accent-amber-500" />
                    not bought from us
                  </label>
                  <Link href="/serials" className="text-slate-500 hover:text-emerald-300 transition-colors">record it in the register ↗</Link>
                </div>
              )}

              {/* A unit is attached — show what came with it */}
              {draft.serial_id && serialTrace && (
                <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px]">
                  <span className="text-emerald-300 font-semibold">unit attached</span>
                  <span className="text-slate-300">
                    {draft.component_id ? compById.get(draft.component_id)?.internal_description ?? '—' : draft.product_text || '—'}
                  </span>
                  {serialTrace.order && <span className="text-sky-300 font-mono">{displayDocNumber(serialTrace.order)}</span>}
                  {serialTrace.invoice?.invoice_number && <span className="text-slate-400 font-mono">{serialTrace.invoice.invoice_number}</span>}
                  {serialTrace.delivery?.do_number && <span className="text-slate-400 font-mono">{serialTrace.delivery.do_number}</span>}
                  {serialTrace.deliveredAt && <span className="text-slate-500">delivered {fmtDay(serialTrace.deliveredAt)}</span>}
                  {serialTrace.external && <span className="text-amber-300">not sold by us — out of our warranty</span>}
                  {canEdit && (
                    <button onClick={() => { set('serial_id', null); setSerialInput(''); }}
                      className="ml-auto text-slate-500 hover:text-white transition-colors">detach</button>
                  )}
                </div>
              )}

              {/* Not ours: where it came from, so the history is not a blank */}
              {draft.is_external && (
                <div className="grid sm:grid-cols-3 gap-2">
                  <label className="block sm:col-span-1">
                    <span className="block text-[10px] uppercase tracking-widest text-slate-500 mb-1">Product</span>
                    <input value={draft.product_text ?? ''} disabled={!canEdit || !!draft.component_id}
                      onChange={(e) => set('product_text', e.target.value)}
                      placeholder="What is it?" className={inputCls} />
                  </label>
                  <label className="block">
                    <span className="block text-[10px] uppercase tracking-widest text-slate-500 mb-1">Bought from</span>
                    <input value={draft.purchased_from ?? ''} disabled={!canEdit}
                      onChange={(e) => set('purchased_from', e.target.value)}
                      placeholder="Which seller?" className={inputCls} />
                  </label>
                  <label className="block">
                    <span className="block text-[10px] uppercase tracking-widest text-slate-500 mb-1">Bought on</span>
                    <input type="date" value={draft.purchased_at ?? ''} disabled={!canEdit}
                      onChange={(e) => set('purchased_at', e.target.value || null)} className={inputCls} />
                  </label>
                </div>
              )}
            </div>

            <div className="grid sm:grid-cols-2 gap-3">
              {/* Searchable comboboxes (same component as the Payment pickers) —
                  489 customers do not fit a native select. */}
              <label className="block">
                <span className="block text-[10px] uppercase tracking-widest text-slate-500 mb-1">Customer</span>
                <fieldset disabled={!canEdit} className={!canEdit ? 'opacity-60 pointer-events-none' : ''}>
                  <RichDropdown
                    options={customerOptions}
                    value={draft.customer_id ?? ''}
                    placeholder="Search customer…"
                    config={{ labelKey: 'name', valueKey: 'customer_id', subLabelKey: 'sub' }}
                    onChange={(v: any) => { set('customer_id', v || null); set('quote_id', null); }}
                  />
                </fieldset>
              </label>
              <label className="block">
                <span className="block text-[10px] uppercase tracking-widest text-slate-500 mb-1">Sales order / document</span>
                <fieldset disabled={!canEdit} className={!canEdit ? 'opacity-60 pointer-events-none' : ''}>
                  <RichDropdown
                    options={orderOptions}
                    value={draft.quote_id ?? ''}
                    placeholder="Search SO / SQ number…"
                    config={{ labelKey: 'label', valueKey: 'quote_id', subLabelKey: 'sub' }}
                    onChange={(v: any) => v && !draft.customer_id
                      ? (set('quote_id', v), set('customer_id', orderById.get(String(v))?.customer_id ?? null))
                      : set('quote_id', v || null)}
                  />
                </fieldset>
              </label>
              <label className="block">
                <span className="block text-[10px] uppercase tracking-widest text-slate-500 mb-1">Category</span>
                <select className={inputCls} value={draft.category ?? 'repair'} disabled={!canEdit} onChange={(e) => set('category', e.target.value)}>
                  {Object.entries(CATEGORIES).map(([k, c]) => <option key={k} value={k}>{c.label}</option>)}
                </select>
              </label>
              <label className="block">
                <span className="block text-[10px] uppercase tracking-widest text-slate-500 mb-1">Status</span>
                <select className={inputCls} value={draft.status ?? 'open'} disabled={!canEdit} onChange={(e) => set('status', e.target.value)}>
                  {STATUS_SECTIONS.map((s) => <option key={s.key} value={s.key}>{s.label}</option>)}
                </select>
              </label>
              <label className="block">
                <span className="block text-[10px] uppercase tracking-widest text-slate-500 mb-1">Reported</span>
                <input type="date" className={inputCls} value={draft.reported_at ?? ''} disabled={!canEdit} onChange={(e) => set('reported_at', e.target.value)} />
              </label>
              <label className="block">
                <span className="block text-[10px] uppercase tracking-widest text-slate-500 mb-1">Subject</span>
                <input className={inputCls} value={draft.subject ?? ''} disabled={!canEdit} placeholder="e.g. Inverter fault E-07"
                  onChange={(e) => set('subject', e.target.value)} />
              </label>
            </div>

            <label className="block">
              <span className="block text-[10px] uppercase tracking-widest text-slate-500 mb-1">Description</span>
              <textarea rows={2} className="w-full px-3 py-2 rounded-lg bg-slate-900 border border-slate-700 focus:border-emerald-500/60 outline-none text-white text-sm placeholder:text-slate-600 resize-y transition-colors"
                value={draft.description ?? ''} disabled={!canEdit} placeholder="What the customer reported"
                onChange={(e) => set('description', e.target.value)} />
            </label>

            {/* ── Parts / items involved ── */}
            <div>
              <div className="flex items-center justify-between mb-1.5">
                <span className="text-[10px] uppercase tracking-widest text-slate-500">Items involved</span>
                {canEdit && (
                  <button onClick={() => setDraftParts((p) => [...p, { component_id: null, description: '', action: 'repaired', quantity: '1', notes: '' }])}
                    className="text-[11px] font-semibold text-emerald-300 hover:text-emerald-200 transition-colors">+ Add item</button>
                )}
              </div>
              {/* The selected SO's own lines, one click to log — items and case connected */}
              {canEdit && soItems.length > 0 && (
                <div className="flex flex-wrap items-center gap-1.5 mb-2">
                  <span className="text-[10px] text-slate-600 flex-shrink-0">On this order:</span>
                  {soItems.map((l, k) => {
                    const added = draftParts.some((p) => p.description.trim().toLowerCase() === l.description.trim().toLowerCase());
                    return (
                      <button key={k} type="button" disabled={added}
                        onClick={() => setDraftParts((p) => [...p, {
                          component_id: compByDesc.get(l.description.trim().toLowerCase())?.component_id ?? null,
                          description: l.description, action: 'repaired', quantity: '1', notes: '',
                        }])}
                        className={`px-2 py-0.5 rounded-md border text-[11px] max-w-[16rem] truncate transition-colors ${
                          added ? 'border-slate-800 text-slate-600 cursor-default'
                                : 'border-slate-700/70 text-slate-300 hover:border-emerald-500/40 hover:text-emerald-300'}`}
                        title={added ? 'Already listed' : `Add ${l.description}`}>
                        {added ? '✓' : '+'} {l.description}
                      </button>
                    );
                  })}
                </div>
              )}
              {draftParts.length === 0 ? (
                <p className="text-[11px] text-slate-600 italic">No items logged.</p>
              ) : (
                <div className="space-y-2">
                  {draftParts.map((p, i) => (
                    <div key={i} className="grid grid-cols-[1fr_auto] sm:grid-cols-[minmax(0,1fr)_120px_64px_auto] gap-2 items-start">
                      <div className="col-span-2 sm:col-span-1">
                        <input list="aftersales-items" className={inputCls} value={p.description} disabled={!canEdit}
                          placeholder="Item — type to search the catalog"
                          onChange={(e) => {
                            const v = e.target.value;
                            const hit = compByDesc.get(v.trim().toLowerCase());
                            setDraftParts((arr) => arr.map((x, j) => j === i ? { ...x, description: v, component_id: hit?.component_id ?? null } : x));
                          }} />
                        {p.component_id && (() => {
                          const w = fmtWarranty(compById.get(p.component_id!)?.warranty_value, compById.get(p.component_id!)?.warranty_unit);
                          return <p className="text-[9px] text-emerald-400/80 mt-0.5">linked to catalog{w ? ` · product warranty ${w}` : ''}</p>;
                        })()}
                      </div>
                      <select className={inputCls} value={p.action} disabled={!canEdit}
                        onChange={(e) => setDraftParts((arr) => arr.map((x, j) => j === i ? { ...x, action: e.target.value } : x))}>
                        {Object.entries(ACTIONS).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
                      </select>
                      <input type="number" min={1} className={inputCls} value={p.quantity} disabled={!canEdit} title="Quantity"
                        onChange={(e) => setDraftParts((arr) => arr.map((x, j) => j === i ? { ...x, quantity: e.target.value } : x))} />
                      {canEdit && (
                        <button onClick={() => setDraftParts((arr) => arr.filter((_, j) => j !== i))}
                          className="h-9 px-2 text-slate-600 hover:text-red-400 transition-colors">
                          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2"><path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" /></svg>
                        </button>
                      )}
                    </div>
                  ))}
                </div>
              )}
              <datalist id="aftersales-items">
                {comps.map((c) => <option key={c.component_id} value={c.internal_description ?? ''} />)}
              </datalist>
            </div>

            {/* ── Repair / replacement quotes — the case's own quote pipeline.
                One system: an after-sales quote IS a sales quote linked to
                this case, so it inherits the editor, library, print and the
                SO → invoice flow for billable work. ── */}
            {editing !== 'new' && (
              <div>
                <div className="flex items-center justify-between mb-1.5">
                  <span className="text-[10px] uppercase tracking-widest text-slate-500">Repair / replacement quotes</span>
                  {canEdit && (
                    <a href={`/sales/new?case=${(editing as Case).case_id}${draft.customer_id ? `&customer=${draft.customer_id}` : ''}`}
                      target="_blank" rel="noopener noreferrer"
                      className="text-[11px] font-semibold text-emerald-300 hover:text-emerald-200 transition-colors">+ New quote</a>
                  )}
                </div>
                {caseQuotes.length === 0 ? (
                  <p className="text-[11px] text-slate-600 italic">No quote for this case yet — repairs and component replacements are quoted from here.</p>
                ) : (
                  <div className="rounded-lg border border-slate-800 divide-y divide-slate-800/60">
                    {caseQuotes.map((q) => (
                      <a key={q.quote_id} href={`/sales/${q.quote_id}`} target="_blank" rel="noopener noreferrer"
                        className="flex items-center gap-2 px-2.5 py-1.5 text-[11px] hover:bg-slate-800/40 transition-colors">
                        <span className="font-mono text-slate-300">{displayDocNumber(q)}</span>
                        <span className={`px-1.5 py-0.5 rounded text-[10px] font-semibold ${SALES_STATUS[q.status]?.cls ?? ''}`}>{SALES_STATUS[q.status]?.label ?? q.status}</span>
                        <span className="ml-auto tabular-nums text-slate-200 font-semibold">{fmtInt(Number(q.grand_total) || 0)}</span>
                      </a>
                    ))}
                  </div>
                )}
              </div>
            )}

            {(draft.status === 'resolved' || draft.status === 'closed' || (draft.resolution ?? '') !== '') && (
              <label className="block">
                <span className="block text-[10px] uppercase tracking-widest text-slate-500 mb-1">Resolution</span>
                <textarea rows={2} className="w-full px-3 py-2 rounded-lg bg-slate-900 border border-slate-700 focus:border-emerald-500/60 outline-none text-white text-sm placeholder:text-slate-600 resize-y transition-colors"
                  value={draft.resolution ?? ''} disabled={!canEdit} placeholder="How it was fixed"
                  onChange={(e) => set('resolution', e.target.value)} />
              </label>
            )}

            {/* ── Update log (existing cases only) ── */}
            {editing !== 'new' && (
              <div>
                <span className="block text-[10px] uppercase tracking-widest text-slate-500 mb-1.5">Log</span>
                {canEdit && (
                  <div className="flex gap-2 mb-2">
                    <input className={inputCls} value={newNote} placeholder="Add an update — parts ordered, technician visit, customer called…"
                      onChange={(e) => setNewNote(e.target.value)}
                      onKeyDown={(e) => { if (e.key === 'Enter') addNote(); }} />
                    <button onClick={addNote} disabled={!newNote.trim()}
                      className="h-9 px-3 rounded-lg bg-slate-800 border border-slate-700 text-xs font-semibold text-slate-200 hover:bg-slate-700 transition-colors disabled:opacity-40 whitespace-nowrap">
                      Add
                    </button>
                  </div>
                )}
                {updates.length === 0 ? (
                  <p className="text-[11px] text-slate-600 italic">No updates yet.</p>
                ) : (
                  <div className="space-y-1.5 max-h-48 overflow-y-auto pr-1">
                    {updates.map((u) => (
                      <div key={u.update_id} className="rounded-lg bg-slate-950/50 border border-slate-800 px-3 py-2">
                        <p className="text-xs text-slate-300">{u.note}</p>
                        <p className="text-[10px] text-slate-600 mt-0.5">{u.created_by_email.split('@')[0] || '—'} · {fmtDayTime(u.created_at)}</p>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}

            {canEdit && (
              <div className="flex justify-end gap-3 pt-1">
                <button onClick={() => setEditing(null)} disabled={busy}
                  className="px-4 py-2 rounded-lg text-slate-400 hover:text-white hover:bg-white/10 text-sm transition-colors disabled:opacity-50">Cancel</button>
                <button onClick={save} disabled={busy}
                  className="px-5 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white text-sm font-semibold transition-colors disabled:opacity-50">
                  {busy ? 'Saving…' : 'Save case'}
                </button>
              </div>
            )}
          </div>
        </div>,
        document.body
      )}
    </div>
  );
}

export default function Page() {
  return (
    <Suspense fallback={<div className="min-h-screen bg-chrome" />}>
      <AfterSalesPage />
    </Suspense>
  );
}
