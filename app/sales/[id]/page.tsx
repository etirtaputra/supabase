/**
 * ICAPROC — Sell-side: a single Sales Quote at its own URL (/sales/[id], or
 * /sales/new). One document with a status lifecycle. Owner + sales.
 *  - Advancing status stays on this page (the quote's own link).
 *  - Confirm Customer Order reserves Live Stock; cancel/revert releases it;
 *    deliver writes stock-out movements.
 */
'use client';
import { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { createSupabaseClient } from '@/lib/supabase';
import { planLineWrite } from '@/lib/salesLines';
import { mergeLines, mergeHeader, sameLine, mergeMessage } from '@/lib/salesMerge';
import { useAuth } from '@/hooks/useAuth';
import { useRouter, useParams } from 'next/navigation';
import { ROLE_PERMISSIONS } from '@/constants/roles';
import { canOpenPath } from '@/constants/navigation';
import { useDragReorder, DRAGGING_ROW, REORDER_ROW, DROP_ZONE } from '@/components/ui/dragReorder';
import BrandMenu from '@/components/ui/BrandMenu';
import DocumentPresence from '@/components/ui/DocumentPresence';
import SalesMilestones from '@/components/ui/SalesMilestones';
import FulfillmentPanel, { type SoLine, type Invoice, type InvItem, type DeliveryOrder, type DoItem } from '@/components/ui/FulfillmentPanel';
import { SALES_STATUS as STATUS, COMMITTED_STATUSES as COMMITTED, displayDocNumber } from '@/lib/salesStatus';
import { tierPriceFor } from '@/lib/tierPricing';
import { evalCell } from '@/lib/formula';
import { fmtDay, fmtDayTime, fmtInt } from '@/lib/formatters';
import { useSettings } from '@/hooks/useSettings';
import { fetchBankAccounts, fetchAccountCompanies, accountLabelWithCompany, defaultAccountFor, type BankAccount } from '@/lib/banks';
import Autocomplete from '@/components/ui/Autocomplete';
import { todayISO } from '@/lib/dateRange';
import { successorMap } from '@/lib/successors';
import MountingDesigner, { type DesignedLine } from '@/components/ui/MountingDesigner';
import SystemDesigner from '@/components/ui/SystemDesigner';
import type { SystemDesign } from '@/lib/systemDesign/types';

interface Quote {
  quote_id: string; quote_number: string; order_number?: string; invoice_number?: string; do_number?: string;
  customer_id: string | null; company_id: string | null; quote_date: string; status: string;
  valid_until?: string | null; payment_terms?: string; delivery_terms?: string;
  ppn_pct: number; subtotal: number; ppn_amount: number; grand_total: number; notes: string;
  revision?: number;
  validated_at?: string | null; sent_at?: string | null; accepted_at?: string | null;
  ordered_at?: string | null; invoiced_at?: string | null; preparing_at?: string | null; delivered_at?: string | null;
  delivery_date?: string | null; delivery_time?: string; delivery_method?: string; delivery_via?: string;
  delivery_address?: string; delivery_map_url?: string; delivery_contact?: string;
  updated_at?: string; updated_by_email?: string;
  /** Set = this is an after-sales quote (repair / replacement) for that case. */
  case_id?: string | null;
}
interface CustContact { customer_id: string; name: string; title: string; phone: string; }
interface DbLine { item_id: string; component_id: string | null; is_section: boolean; description: string; brand: string; note: string; lead_time: string; unit: string; quantity: number; unit_price: number; qty_formula?: string; price_formula?: string; sort_order: number; design_role?: string | null; }
interface EditLine { key: string; component_id: string | null; is_section: boolean; description: string; brand: string; note: string; lead_time: string; unit: string; quantity: string; unit_price: string; qty_formula: string; price_formula: string; showNote: boolean;
  /** Which System Designer line this is; '' = typed by hand, never regenerated. */
  design_role: string; }
interface Customer { customer_id: string; display_name: string; legal_name: string; tier: string; shipping_address?: string; billing_address?: string; }
interface Company { company_id: string; legal_name: string; }
interface Tier { tier_id: string; tier_code: string; default_discount_pct: number; sort_order: number; is_active: boolean; }
interface Override { component_id: string; tier_id: string; override_price_idr: number | null; override_discount_pct: number | null; }
// Brand is deliberately NOT fetched here — it's buy-side vendor info; the
// customer-facing description already carries the brand when it should.
interface Comp { component_id: string; supplier_model: string; internal_description: string | null; unit: string | null; selling_price_idr: number | null; }
// Customer-facing product name: our internal description, never the supplier MODEL/SKU.
const compName = (c?: Comp | null) => (c?.internal_description?.trim() || c?.supplier_model || '');
interface LibEntry { entry_id: string; description: string; unit: string; default_price: number | null; section?: string | null; }
// Non-catalog suggestions: custom lines from past sales quotes (PREV) and
// owner-curated library entries (LIB)
interface Extra { kind: 'prev' | 'lib'; description: string; unit: string; price: number | null; count: number; section?: string }
interface DeliveryDetails { date: string; time: string; method: string; via: string; address: string; mapUrl: string; contact: string; }
interface Receipt {
  receipt_id: string; quote_id: string; receipt_number: string; category: string;
  amount: number; payment_method: string; payment_date: string; bank_ref: string; notes: string; created_by_email?: string;
  invoice_id?: string | null;
}

const METHOD_LABELS: Record<string, string> = {
  bank_transfer: 'Bank Transfer', cash: 'Cash', cheque: 'Cheque', giro: 'Giro', other: 'Other',
};
interface LogRow { log_id: string; at: string; actor_email: string; action: string; detail: string; }
const RECEIPT_CATS: { value: string; label: string }[] = [
  { value: 'down_payment', label: 'Down Payment (DP)' },
  { value: 'balance_payment', label: 'Balance Payment' },
];

// Same preset list as the EPC proposal editor's section lead times.
const LEAD_TIMES = ['Ready', '1 minggu', '2 minggu', '3 minggu', '1 bulan', '2 bulan', '3 bulan', 'Custom'];

/** One past sale of a component — the unit-price popover's history rows. */
interface PriceHistEntry { quote_number: string; date: string; customer: string; mine: boolean; qty: number; price: number; }
/** One tier option in the unit-price popover. */
interface TierOption { tier_id: string; code: string; price: number | null; chosen: boolean; }

const num = (v: unknown): number => {
  if (v === '' || v === null || v === undefined) return 0;
  const n = Number(String(v).replace(/[, ]/g, ''));
  return isNaN(n) ? 0 : n;
};

// Tier prices follow the markup chain (lib/tierPricing): the item's entered
// price is the Tier-1 NET; higher tiers mark up from the previous tier.

const blankLine = (): EditLine => ({ key: `new-${Date.now()}-${Math.random()}`, component_id: null, is_section: false, description: '', brand: '', note: '', lead_time: '', unit: '', quantity: '', unit_price: '', qty_formula: '', price_formula: '', showNote: false, design_role: '' });
/** ISO date + n days → ISO date (calendar arithmetic, timezone-safe at noon). */
const addDays = (iso: string, days: number): string => {
  const d = new Date(`${iso}T12:00:00`);
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
};
const blankQuote = (companyId: string | null, ppnPct: number, notes = '', validityDays = 30): Quote => {
  const today = todayISO();
  return {
    quote_id: '', quote_number: '', customer_id: null, company_id: companyId,
    quote_date: today, valid_until: addDays(today, validityDays), status: 'draft', ppn_pct: ppnPct,
    payment_terms: '', delivery_terms: '',
    subtotal: 0, ppn_amount: 0, grand_total: 0, notes,
  };
};
/** Order value from a line list — the same arithmetic whether it runs on the
 *  rows on screen or on the merged rows a save is about to write. */
const totalsOf = (ls: EditLine[], ppnPct: number) => {
  const subtotal = ls.reduce((s, l) => s + (l.is_section ? 0 : num(l.quantity) * num(l.unit_price)), 0);
  const ppn = subtotal * (ppnPct / 100);
  return { subtotal, ppn, grand: subtotal + ppn };
};
/**
 * The empty row the editor always keeps at the bottom is an affordance, not a
 * line — it is lifted off before a merge and put back after, so a colleague's
 * rows can never land underneath it.
 */
const isTailBlank = (l: EditLine) =>
  !l.is_section && !l.component_id && !l.description.trim() && !l.note.trim()
  && !num(l.quantity) && !num(l.unit_price);
const mapLine = (it: DbLine): EditLine => ({
  key: `db-${it.item_id}`, component_id: it.component_id, is_section: !!it.is_section,
  description: it.description, brand: it.brand ?? '', note: it.note ?? '', lead_time: it.lead_time ?? '', unit: it.unit,
  quantity: String(it.quantity ?? ''), unit_price: String(it.unit_price ?? ''),
  qty_formula: it.qty_formula ?? '', price_formula: it.price_formula ?? '', showNote: !!(it.note ?? ''),
  design_role: it.design_role ?? '',
});

export default function SalesQuotePage() {
  const supabase = createSupabaseClient();
  const router = useRouter();
  const { id } = useParams<{ id: string }>();
  const isNew = id === 'new';
  const { user, profile, loading: authLoading } = useAuth();
  const canEdit = !!profile && ROLE_PERMISSIONS[profile.role].canEditSalesDocs;
  // Item hub link only for roles that can open it (Analytics is owner-only)
  const canHub = !!profile && ROLE_PERMISSIONS[profile.role].canViewAnalytics;
  // GP per order and per line (Dolibarr-style margins) — OWNER ONLY, the same
  // capability that guards /profitability. Cost columns are not even fetched
  // for other roles (the /products network-tab leak rule).
  const canGP = !!profile && ROLE_PERMISSIONS[profile.role].canViewEconomics;
  // What a brand-new quotation starts with (Settings)
  const { defaultPpnPct, defaultCompanyId, defaultSalesTerms, defaultCustomerTier, quoteValidityDays, salesPaymentTermsOptions, salesDeliveryTermsOptions } = useSettings();

  const [editing, setEditing] = useState<Quote | null>(null);
  const [lines, setLines] = useState<EditLine[]>([]);
  // The System Designer run behind the generated lines (22.0.system_design)
  const [systemDesign, setSystemDesign] = useState<SystemDesign | null>(null);
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [companies, setCompanies] = useState<Company[]>([]);
  const [tiers, setTiers] = useState<Tier[]>([]);
  const [overrides, setOverrides] = useState<Override[]>([]);
  const [comps, setComps] = useState<Comp[]>([]);
  const [extras, setExtras] = useState<Extra[]>([]);
  const [custContacts, setCustContacts] = useState<CustContact[]>([]);
  const [physical, setPhysical] = useState<Record<string, number>>({});
  const [reserved, setReserved] = useState<Record<string, number>>({});
  // Owner-only: current moving-average landed cost per component (30.1,
  // quantity-weighted across warehouses) — the per-line GP basis.
  const [unitCost, setUnitCost] = useState<Record<string, number>>({});
  // component_id -> the item that replaces it (8.0 successor links) — quoting
  // an outdated model should say so on the line.
  const [successors, setSuccessors] = useState<Map<string, string>>(new Map());
  // Every sales quote's header + catalog lines, for the unit-price history
  // popover (what did we sell this item for, to whom, when).
  const [histQuotes, setHistQuotes] = useState<{ quote_id: string; status: string; customer_id: string | null; quote_date: string; quote_number: string }[]>([]);
  const [histItems, setHistItems] = useState<{ quote_id: string; component_id: string; quantity: number; unit_price: number; created_at: string }[]>([]);
  // Average PO-created → received days per component (fully-received POs only)
  // — the same lead-time reading Purchasing / Deal Lookup derive. Empty when
  // the role can't read buy-side tables; the suggestion simply won't appear.
  const [leadDaysByComp, setLeadDaysByComp] = useState<Record<string, number>>({});
  const [receipts, setReceipts] = useState<Receipt[]>([]);
  const [logs, setLogs] = useState<LogRow[]>([]);
  // Set when this quote is an after-sales quote — badge links back to the case
  const [caseInfo, setCaseInfo] = useState<{ case_id: string; case_number: string } | null>(null);
  // Service quotes see the after-sales library first; regular quotes see it
  // last — one combined picker, ordered for the document at hand. (Stable
  // sort, so recency order inside each group is preserved.)
  const sortedExtras = useMemo(() => {
    const svc = !!editing?.case_id;
    const hit = (x: Extra) => ((x.section === 'aftersales') === svc ? 1 : 0);
    return [...extras].sort((a, b) => hit(b) - hit(a));
  }, [extras, editing?.case_id]);
  // Split fulfillment: this order's child invoices + delivery orders
  const [savedLines, setSavedLines] = useState<SoLine[]>([]);
  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [invItems, setInvItems] = useState<InvItem[]>([]);
  const [dos, setDos] = useState<DeliveryOrder[]>([]);
  const [doItems, setDoItems] = useState<DoItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);
  const [busy, setBusy] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const flash = (m: string) => { setToast(m); setTimeout(() => setToast(null), 2400); };
  // Entered via "+ New Order" (?as=order): this deal skips the quotation dance,
  // so Confirm Order is the PRIMARY action on the draft instead of Validate.
  const [asOrder] = useState(() => typeof window !== 'undefined' && new URLSearchParams(window.location.search).get('as') === 'order');

  useEffect(() => {
    if (authLoading) return;
    if (!user) { router.replace(`/login?next=${encodeURIComponent(`/sales/${id}`)}`); return; }
    if (profile && !canOpenPath(ROLE_PERMISSIONS[profile.role], '/sales')) router.replace('/unauthorized');
  }, [authLoading, user, profile, id, router]);

  const load = useCallback(async (silent = false) => {
    if (!silent) setLoading(true);
    const [custRes, coRes, tierRes, ovRes, compRes, balRes, allQRes, allIRes, libRes, contactRes] = await Promise.all([
      supabase.from('20.0_customers').select('customer_id, display_name, legal_name, tier, shipping_address, billing_address').order('display_name'),
      supabase.from('1.0_companies').select('company_id, legal_name').order('legal_name'),
      supabase.from('21.0_price_tiers').select('tier_id, tier_code, default_discount_pct, sort_order, is_active'),
      supabase.from('21.1_item_tier_prices').select('component_id, tier_id, override_price_idr, override_discount_pct'),
      supabase.from('3.0_components').select('component_id, supplier_model, internal_description, unit, selling_price_idr').order('supplier_model').limit(2000),
      supabase.from('30.1_stock_balances').select(canGP ? 'component_id, qty_on_hand, avg_cost_idr' : 'component_id, qty_on_hand'),
      supabase.from('22.0_sales_quotes').select('quote_id, status, customer_id, quote_date, quote_number, order_number'),
      supabase.from('22.1_sales_quote_items').select('quote_id, component_id, quantity, is_section, description, unit, unit_price, created_at'),
      supabase.from('22.2_sales_description_library').select('entry_id, description, unit, default_price, section'),
      supabase.from('20.1_customer_contacts').select('customer_id, name, title, phone'),
    ]);
    // Successor links are informational — tolerate RLS hiding 8.0 from a role.
    supabase.from('8.0_component_links').select('component_id_a, component_id_b, link_type').eq('link_type', 'successor')
      .then(({ data: lk, error: lkErr }) => setSuccessors(successorMap(lkErr ? [] : ((lk as any[]) ?? []))));
    const coList = (coRes.data as Company[]) ?? [];
    setCustomers((custRes.data as Customer[]) ?? []);
    setCompanies(coList);
    setTiers((tierRes.data as Tier[]) ?? []);
    setOverrides((ovRes.data as Override[]) ?? []);
    setComps((compRes.data as Comp[]) ?? []);
    setCustContacts(contactRes.error ? [] : ((contactRes.data as CustContact[]) ?? []));
    // 30.1 is keyed (component, warehouse): SUM quantities across warehouses
    // (assignment instead of += would show only one warehouse's stock), and —
    // owner only — take the quantity-weighted average landed cost, falling
    // back to the last known cost when nothing is on hand.
    const phys: Record<string, number> = {};
    const costAgg: Record<string, { qty: number; value: number; last: number }> = {};
    for (const b of (balRes.data as unknown as { component_id: string; qty_on_hand: number; avg_cost_idr?: number | null }[]) ?? []) {
      const q = Number(b.qty_on_hand) || 0;
      phys[b.component_id] = (phys[b.component_id] ?? 0) + q;
      if (canGP) {
        const avg = Number(b.avg_cost_idr) || 0;
        const e = (costAgg[b.component_id] ??= { qty: 0, value: 0, last: 0 });
        if (q > 0 && avg > 0) { e.qty += q; e.value += q * avg; }
        if (avg > 0) e.last = Math.max(e.last, avg);
      }
    }
    setPhysical(phys);
    if (canGP) {
      const costs: Record<string, number> = {};
      for (const [cid, e] of Object.entries(costAgg)) {
        const v = e.qty > 0 ? e.value / e.qty : e.last;
        if (v > 0) costs[cid] = v;
      }
      setUnitCost(costs);
    }

    // Reserved = qty on committed orders MINUS what their delivered DOs
    // already shipped (partial shipments release their share of the reserve).
    const [allDoRes, allDoItemRes, poRes, poLineRes] = await Promise.all([
      supabase.from('24.0_delivery_orders').select('do_id, quote_id, status'),
      supabase.from('24.1_delivery_order_items').select('do_id, component_id, qty'),
      supabase.from('5.0_purchases').select('po_id, po_date, actual_received_date, status'),
      supabase.from('5.1_purchase_line_items').select('po_id, component_id'),
    ]);

    // Historical lead time per component: PO created → fully received.
    // (5.0's po_id is a UUID live — always String() it before keying.)
    if (!poRes.error && !poLineRes.error) {
      const daysByPo = new Map<string, number>();
      for (const p of (poRes.data as { po_id: unknown; po_date: string | null; actual_received_date: string | null; status: string }[]) ?? []) {
        if (p.status !== 'Fully Received' || !p.actual_received_date || !p.po_date) continue;
        const d = Math.round((new Date(p.actual_received_date).getTime() - new Date(p.po_date).getTime()) / 86_400_000);
        if (d >= 0) daysByPo.set(String(p.po_id), d);
      }
      const sums = new Map<string, { total: number; n: number }>();
      for (const li of (poLineRes.data as { po_id: unknown; component_id: string | null }[]) ?? []) {
        const d = daysByPo.get(String(li.po_id));
        if (d == null || !li.component_id) continue;
        const s = sums.get(li.component_id) ?? { total: 0, n: 0 };
        s.total += d; s.n += 1;
        sums.set(li.component_id, s);
      }
      const avg: Record<string, number> = {};
      for (const [cid, s] of sums) avg[cid] = Math.round(s.total / s.n);
      setLeadDaysByComp(avg);
    }
    type QHead = { quote_id: string; status: string; customer_id: string | null; quote_date: string; quote_number: string };
    setHistQuotes(((allQRes.data as QHead[]) ?? []));
    setHistItems((((allIRes.data as { quote_id: string; component_id: string | null; quantity: number; is_section: boolean; unit_price: number; created_at: string }[]) ?? [])
      .filter((x) => x.component_id && !x.is_section) as { quote_id: string; component_id: string; quantity: number; unit_price: number; created_at: string }[]));
    const committed = new Set(((allQRes.data as { quote_id: string; status: string }[]) ?? []).filter((q) => COMMITTED.has(q.status)).map((q) => q.quote_id));
    const orderedByQC = new Map<string, number>();
    for (const it of (allIRes.data as { quote_id: string; component_id: string | null; quantity: number; is_section: boolean }[]) ?? []) {
      if (it.component_id && !it.is_section && committed.has(it.quote_id)) {
        const k = `${it.quote_id}·${it.component_id}`;
        orderedByQC.set(k, (orderedByQC.get(k) ?? 0) + (Number(it.quantity) || 0));
      }
    }
    if (!allDoRes.error && !allDoItemRes.error) {
      const doQuote = new Map(((allDoRes.data ?? []) as { do_id: string; quote_id: string; status: string }[])
        .filter((d) => d.status === 'delivered').map((d) => [d.do_id, d.quote_id]));
      for (const it of ((allDoItemRes.data ?? []) as { do_id: string; component_id: string | null; qty: number }[])) {
        const qid = doQuote.get(it.do_id);
        if (!qid || !it.component_id || !committed.has(qid)) continue;
        const k = `${qid}·${it.component_id}`;
        if (orderedByQC.has(k)) orderedByQC.set(k, (orderedByQC.get(k) ?? 0) - (Number(it.qty) || 0));
      }
    }
    const rsv: Record<string, number> = {};
    for (const [k, q] of orderedByQC) {
      if (q <= 0) continue;
      const cid = k.split('·')[1];
      rsv[cid] = (rsv[cid] ?? 0) + q;
    }
    setReserved(rsv);

    // Custom (non-catalog) lines from other sales quotes → PREV suggestions
    type PastLine = { quote_id: string; component_id: string | null; is_section: boolean; description: string; unit: string; unit_price: number; created_at: string };
    const past = new Map<string, Extra & { at: string }>();
    for (const it of ((allIRes.data as unknown as PastLine[]) ?? [])) {
      if (it.is_section || it.component_id || it.quote_id === id) continue;
      const desc = (it.description ?? '').trim();
      if (desc.length < 3) continue;
      const k = desc.toLowerCase();
      const existing = past.get(k);
      if (existing) {
        existing.count += 1;
        if ((it.created_at ?? '') > existing.at) {
          Object.assign(existing, { description: desc, unit: it.unit ?? '', price: Number(it.unit_price) || null, at: it.created_at ?? '' });
        }
      } else {
        past.set(k, { kind: 'prev', description: desc, unit: it.unit ?? '', price: Number(it.unit_price) || null, count: 1, at: it.created_at ?? '' });
      }
    }
    // Owner-curated library entries join in where no past usage carries the text
    for (const e of ((libRes.error ? [] : libRes.data) as LibEntry[] ?? [])) {
      const desc = (e.description ?? '').trim();
      if (desc.length < 3 || past.has(desc.toLowerCase())) continue;
      past.set(desc.toLowerCase(), { kind: 'lib', section: e.section ?? 'sales', description: desc, unit: e.unit ?? '', price: e.default_price != null ? Number(e.default_price) : null, count: 0, at: '' });
    }
    setExtras([...past.values()].sort((a, b) => (b.at || '').localeCompare(a.at || '')).map(({ at: _at, ...x }) => x));

    if (isNew) {
      // Issuing company: the configured one when it still exists, else the first
      const issuer = coList.find((c) => c.company_id === defaultCompanyId)?.company_id ?? coList[0]?.company_id ?? null;
      const q = blankQuote(issuer, defaultPpnPct, defaultSalesTerms, quoteValidityDays);
      // ?case=<id> starts an AFTER-SALES quote: linked to the case, customer
      // pre-selected — the path of least resistance from the case screen.
      const sp = new URLSearchParams(window.location.search);
      const caseId = sp.get('case');
      const custId = sp.get('customer');
      if (caseId) {
        const { data: cs } = await supabase.from('27.0_aftersales_cases')
          .select('case_id, case_number, customer_id').eq('case_id', caseId).single();
        if (cs) {
          q.case_id = cs.case_id as string;
          q.customer_id = (cs.customer_id as string | null) ?? custId ?? null;
          setCaseInfo({ case_id: cs.case_id as string, case_number: (cs.case_number as string) ?? '' });
        }
      } else if (custId) {
        q.customer_id = custId;
      }
      const ls = [blankLine()];
      setEditing((prev) => prev ?? q);
      setLines((prev) => (prev.length ? prev : ls));
      if (savedSnapRef.current === null) savedSnapRef.current = snapshotOf(q, ls);
    } else {
      const [qRes, iRes, rRes, invRes, invIRes, doRes, doIRes, logRes] = await Promise.all([
        supabase.from('22.0_sales_quotes').select('*').eq('quote_id', id).single(),
        supabase.from('22.1_sales_quote_items').select('*').eq('quote_id', id).order('sort_order'),
        supabase.from('26.0_customer_receipts').select('*').eq('quote_id', id).order('payment_date', { ascending: false }),
        supabase.from('25.0_sales_invoices').select('*').eq('quote_id', id).order('created_at'),
        supabase.from('25.1_sales_invoice_items').select('*'),
        supabase.from('24.0_delivery_orders').select('*').eq('quote_id', id).order('created_at'),
        supabase.from('24.1_delivery_order_items').select('*').order('sort_order'),
        supabase.from('22.3_sales_activity_log').select('*').eq('quote_id', id).order('at', { ascending: false }).limit(200),
      ]);
      if (!qRes.data) { setNotFound(true); setLoading(false); return; }
      const loadedQ = qRes.data as Quote;
      const loadedLines = [...((iRes.data as DbLine[]) ?? []).map(mapLine), blankLine()];
      setEditing(loadedQ);
      setLines(loadedLines);
      // The stored designer run comes back with the quote, so REGENERATE
      // reopens on the same answers even after a reload.
      setSystemDesign(((loadedQ as unknown as { system_design?: SystemDesign | null }).system_design) ?? null);
      // What the DB just returned IS the saved state — stamp it as such, so
      // dirty can never stick after a save + reload from normalization
      // differences between typed values and their stored round-trip.
      savedSnapRef.current = snapshotOf(loadedQ, loadedLines);
      knownItemIdsRef.current = new Set(((iRes.data as DbLine[]) ?? []).map((l) => l.item_id));
      // …and it is also the BASE this tab merges and saves against: the
      // version it has agreed with the database, stamp and all.
      baseRef.current = ((iRes.data as DbLine[]) ?? []).map(mapLine);
      baseHeaderRef.current = loadedQ;
      loadedStampRef.current = loadedQ.updated_at ?? null;
      setReceipts(rRes.error ? [] : ((rRes.data as Receipt[]) ?? []));
      setSavedLines(((iRes.data as DbLine[]) ?? []).map((l) => ({
        item_id: l.item_id, component_id: l.component_id, is_section: !!l.is_section,
        description: l.description, unit: l.unit, quantity: Number(l.quantity) || 0, unit_price: Number(l.unit_price) || 0,
      })));
      const invList = invRes.error ? [] : ((invRes.data as Invoice[]) ?? []);
      setInvoices(invList);
      const invIds = new Set(invList.map((i) => i.invoice_id));
      setInvItems(invIRes.error ? [] : (((invIRes.data as InvItem[]) ?? []).filter((x) => invIds.has(x.invoice_id))));
      const doList = doRes.error ? [] : ((doRes.data as DeliveryOrder[]) ?? []);
      setDos(doList);
      const doIds = new Set(doList.map((d) => d.do_id));
      setDoItems(doIRes.error ? [] : (((doIRes.data as DoItem[]) ?? []).filter((x) => doIds.has(x.do_id))));
      setLogs(logRes.error ? [] : ((logRes.data as LogRow[]) ?? []));
      if (loadedQ.case_id) {
        const { data: cs } = await supabase.from('27.0_aftersales_cases')
          .select('case_id, case_number').eq('case_id', loadedQ.case_id).single();
        if (cs) setCaseInfo({ case_id: cs.case_id as string, case_number: (cs.case_number as string) ?? '' });
      }
    }
    setLoading(false);
  }, [id, isNew, canGP, defaultPpnPct, defaultCompanyId, defaultSalesTerms, quoteValidityDays]);

  useEffect(() => { if (canEdit) load(); }, [canEdit, load]);

  const custById = useMemo(() => new Map(customers.map((c) => [c.customer_id, c])), [customers]);
  const compById = useMemo(() => new Map(comps.map((c) => [c.component_id, c])), [comps]);
  const tierByCode = useMemo(() => new Map(tiers.map((t) => [t.tier_code, t])), [tiers]);
  const activeTiers = useMemo(() => [...tiers].filter((t) => t.is_active !== false).sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0)), [tiers]);

  // Tab title mirrors the nav label + the document you are on
  useEffect(() => {
    const n = editing ? displayDocNumber(editing) : '';
    document.title = `Sales · ${n || 'New quotation'} — ICAPROC`;
  }, [editing?.order_number, editing?.quote_number]);
  const ovByKey = useMemo(() => { const m = new Map<string, Override>(); for (const o of overrides) m.set(`${o.component_id}:${o.tier_id}`, o); return m; }, [overrides]);

  const availableOf = (componentId: string | null) =>
    componentId ? (physical[componentId] ?? 0) - (reserved[componentId] ?? 0) : null;

  function priceFor(componentId: string): number | null {
    const comp = compById.get(componentId);
    const cust = editing?.customer_id ? custById.get(editing.customer_id) : undefined;
    // The customer's tier, or the house default for a customer carrying none
    const tierCode = cust?.tier || defaultCustomerTier;
    const tier = tierCode ? tierByCode.get(tierCode) : undefined;
    if (!tier) return comp?.selling_price_idr ?? null; // no tier → the net price
    return tierPriceFor(comp?.selling_price_idr ?? null, activeTiers, tier.tier_id,
      (tid) => ovByKey.get(`${componentId}:${tid}`)?.override_price_idr);
  }

  // The customer's tier code (falling back to the house default) — what the
  // auto-filled price is based on, shown pre-chosen in the price popover.
  const custTierCode = (editing?.customer_id ? custById.get(editing.customer_id)?.tier : '') || defaultCustomerTier;

  /** Every active tier's price for a component, the customer's own marked. */
  function tierOptionsFor(componentId: string): TierOption[] {
    const comp = compById.get(componentId);
    return activeTiers.map((t) => ({
      tier_id: t.tier_id,
      code: t.tier_code,
      price: tierPriceFor(comp?.selling_price_idr ?? null, activeTiers, t.tier_id,
        (tid) => ovByKey.get(`${componentId}:${tid}`)?.override_price_idr),
      chosen: t.tier_code === custTierCode,
    }));
  }

  /** Past SALES-QUOTE sales of this component — this customer's deals first,
   *  then newest. Deliberately sales-only (owner's call): EPC proposals keep
   *  their own price log in the EPC editor; the two libraries never mix. */
  function priceHistoryFor(componentId: string): PriceHistEntry[] {
    const qById = new Map(histQuotes.map((q) => [q.quote_id, q]));
    const out: PriceHistEntry[] = [];
    for (const it of histItems) {
      if (it.component_id !== componentId || !(Number(it.unit_price) > 0)) continue;
      const q = qById.get(it.quote_id);
      if (!q || q.quote_id === editing?.quote_id) continue;
      const c = q.customer_id ? custById.get(q.customer_id) : undefined;
      out.push({
        quote_number: displayDocNumber(q as any), date: q.quote_date,
        customer: c ? (c.display_name || c.legal_name) : '—',
        mine: !!editing?.customer_id && q.customer_id === editing.customer_id,
        qty: Number(it.quantity) || 0, price: Number(it.unit_price) || 0,
      });
    }
    out.sort((a, b) => (Number(b.mine) - Number(a.mine)) || b.date.localeCompare(a.date));
    return out.slice(0, 10);
  }

  /**
   * Suggested lead time for a line: live stock covers the quantity → "Ready";
   * otherwise the item's historical PO→received average, always rounded UP to
   * whole months (82 days → "3 bulan", 53 → "2 bulan"). Null when there is
   * neither stock cover nor history.
   */
  function suggestLeadFor(componentId: string, qty: number): { value: string; why: string } | null {
    const avail = availableOf(componentId);
    if (avail != null && avail > 0 && avail >= Math.max(qty, 1)) {
      return { value: 'Ready', why: `Live stock (${fmtInt(avail)}) covers this quantity` };
    }
    const days = leadDaysByComp[componentId];
    if (days != null) {
      const months = Math.max(1, Math.ceil(days / 30));
      return { value: `${months} bulan`, why: `Average PO → received on this item is ${days} days, rounded up to whole months` };
    }
    return null;
  }

  const setHeader = <K extends keyof Quote>(k: K, v: Quote[K]) => setEditing((e) => (e ? { ...e, [k]: v } : e));
  const setLine = (key: string, patch: Partial<EditLine>) => setLines((ls) => ls.map((l) => (l.key === key ? { ...l, ...patch } : l)));
  const removeLine = (key: string) => setLines((ls) => ls.filter((l) => l.key !== key));
  // ── System Designer (mounting) ──────────────────────────────────────────
  // The engine sizes and prices the structure; the generated lines land in the
  // editor like any other, stamped with design_role so a REGENERATE replaces
  // only them. Whatever the salesperson typed is never touched.
  const [designerOpen, setDesignerOpen] = useState(false);
  const [systemDesignerOpen, setSystemDesignerOpen] = useState(false);
  const hasDesignLines = useMemo(() => lines.some((l) => !!l.design_role), [lines]);

  const applyDesign = (designed: DesignedLine[], design: SystemDesign) => {
    setLines((ls) => {
      const kept = ls.filter((l) => !l.design_role);
      const generated: EditLine[] = designed.map((d, i) => ({
        ...blankLine(),
        key: `design-${Date.now()}-${i}`,
        component_id: d.component_id,
        description: d.description,
        unit: d.unit,
        quantity: d.quantity,
        unit_price: d.unit_price,
        note: d.note,
        showNote: !!d.note,
        design_role: d.design_role,
      }));
      // Generated lines sit above the trailing blank the editor always keeps
      const tailIdx = kept.findIndex((l, i) => i === kept.length - 1 && !l.description.trim() && !l.component_id);
      if (tailIdx >= 0) return [...kept.slice(0, tailIdx), ...generated, ...kept.slice(tailIdx)];
      return [...kept, ...generated];
    });
    setSystemDesign(design);
    flash(`${design.engine === 'system' ? 'System' : 'Mounting'} BoM ${hasDesignLines ? 'regenerated' : 'added'} — ${designed.length} lines.`);
  };

  const addItem = () => setLines((ls) => [...ls, blankLine()]);
  const addSection = () => setLines((ls) => [...ls, { ...blankLine(), is_section: true }]);

  // ── Drag & drop reordering ─────────────────────────────────────────────────
  // The landing seam is drawn as a line by components/ui/dragReorder, the same
  // one every reorderable list in the app draws. A section drags as a BLOCK
  // (header + its items, up to the next section). Order persists via
  // sort_order on save.
  const [dropEnd, setDropEnd] = useState(false);   // the "move to the end" zone

  function blockOf(ls: EditLine[], key: string): [number, number] {
    const i = ls.findIndex((l) => l.key === key);
    if (i < 0) return [-1, -1];
    if (!ls[i].is_section) return [i, i + 1];
    let j = i + 1;
    while (j < ls.length && !ls[j].is_section) j++;
    return [i, j];
  }

  function moveLines(fromKey: string, toKey: string, after = false) {
    setLines((ls) => {
      const [s, e] = blockOf(ls, fromKey);
      if (s < 0) return ls;
      const block = ls.slice(s, e);
      const rest = [...ls.slice(0, s), ...ls.slice(e)];
      if (toKey === '__end__') return [...rest, ...block];
      let insert = rest.findIndex((l) => l.key === toKey);
      if (insert < 0) return ls; // target was inside the dragged block
      // Below the midline means below the WHOLE target block, not just its
      // header — dropping under a section lands after its last item.
      if (after) {
        const [, te] = blockOf(rest, toKey);
        insert = te;
      }
      return [...rest.slice(0, insert), ...block, ...rest.slice(insert)];
    });
  }

  const drag = useDragReorder<string>((from, to, after) => moveLines(from, to, after));
  const endDrag = () => { drag.end(); setDropEnd(false); };

  function pickComponent(key: string, comp: Comp) {
    const price = priceFor(comp.component_id);
    setLines((ls) => ls.map((l) => {
      if (l.key !== key) return l;
      // Auto-fill the lead time on pick when it's still blank — the chip in
      // the row lets the user re-apply the suggestion after qty changes.
      const suggested = l.lead_time ? null : suggestLeadFor(comp.component_id, num(l.quantity) || 1);
      return {
        ...l, component_id: comp.component_id, description: compName(comp) || l.description,
        unit: comp.unit || l.unit,
        unit_price: price != null ? String(Math.round(price)) : l.unit_price, quantity: l.quantity || '1',
        price_formula: price != null ? '' : l.price_formula,
        lead_time: suggested ? suggested.value : l.lead_time,
      };
    }));
  }

  function pickExtra(key: string, x: Extra) {
    setLines((ls) => ls.map((l) => (l.key === key ? {
      ...l, component_id: null, description: x.description,
      unit: x.unit || l.unit,
      unit_price: x.price != null ? String(Math.round(x.price)) : l.unit_price,
      price_formula: x.price != null ? '' : l.price_formula,
      quantity: l.quantity || '1',
    } : l)));
  }

  const totals = useMemo(
    () => totalsOf(lines, num(editing?.ppn_pct ?? defaultPpnPct)),
    [lines, editing?.ppn_pct, defaultPpnPct]);

  // Owner-only order margin: Σ (price − avg landed cost) × qty over the lines
  // whose catalog item carries a cost. Custom lines have no cost basis and are
  // excluded — the note below the figure says how many, so a flattering
  // "GP" over half the document can never pass silently as the whole story.
  const gpTotals = useMemo(() => {
    if (!canGP) return null;
    let cogs = 0, costedRevenue = 0, costed = 0, items = 0;
    for (const l of lines) {
      if (l.is_section) continue;
      const q = num(l.quantity), p = num(l.unit_price);
      if (q <= 0 || p <= 0) continue;                    // blank / unfinished line
      items++;
      const c = l.component_id ? unitCost[l.component_id] : undefined;
      if (c != null && c > 0) { cogs += c * q; costedRevenue += p * q; costed++; }
    }
    const gp = costedRevenue - cogs;
    return { cogs, gp, costed, items, margin: costedRevenue > 0 ? (gp / costedRevenue) * 100 : null };
  }, [canGP, lines, unitCost]);

  // ── Draft autosave ─────────────────────────────────────────────────────────
  // A draft someone walks away from should not be lost: 2.5s after the last
  // edit (and again when the tab is hidden) the draft persists itself. Only
  // drafts — once a quote is validated/sent, saving stays an explicit act.
  // A brand-new doc gets its row on first autosave; the URL is fixed up with
  // replaceState so typing is never interrupted by a navigation.
  const [autoSavedAt, setAutoSavedAt] = useState<string | null>(null);
  const savedSnapRef = useRef<string | null>(null);
  const autosavingRef = useRef(false);
  // Every item_id THIS TAB knows about — loaded, or written by an earlier save.
  // A row another tab added is not in the set, so this tab will never delete
  // it. planLineWrite (lib/salesLines.ts) turns it into the save plan.
  const knownItemIdsRef = useRef<Set<string>>(new Set());
  // ── Concurrent editing: BASE snapshot + stale-tab guard ──────────────────
  // The EPC proposal editor has run this since August; the sales editor had
  // nothing, so two people on the same line was last-one-wins. Same mechanism,
  // not a second one — see lib/salesMerge.ts for the rule.
  //
  //   loadedStampRef  the 22.0 `updated_at` this tab last agreed with. The
  //                   trigger stamps it on EVERY write, so a value newer than
  //                   this one means somebody else has saved.
  //   baseRef         the rows as the database held them at that moment. A
  //                   save writes only rows that differ from base, so a line
  //                   this tab never touched is never written back.
  const loadedStampRef = useRef<string | null>(null);
  const baseRef = useRef<EditLine[]>([]);
  const baseHeaderRef = useRef<Quote | null>(null);
  const editingRef = useRef<Quote | null>(editing); editingRef.current = editing;
  const linesRef = useRef<EditLine[]>(lines); linesRef.current = lines;

  const snapshotOf = (q: Quote | null, ls: EditLine[]) => JSON.stringify([
    q?.customer_id, q?.company_id, q?.quote_date, q?.valid_until ?? null, q?.payment_terms ?? '', q?.delivery_terms ?? '', q?.ppn_pct, q?.notes,
    ls.map((l) => [l.component_id, l.is_section, l.description, l.brand, l.note, l.lead_time, l.unit, l.quantity, l.unit_price, l.qty_formula, l.price_formula]),
  ]);
  const snapshot = snapshotOf(editing, lines);
  const draftLike = !!editing && (editing.status === 'draft' || !editing.quote_id);
  const hasContent = !!editing?.customer_id || lines.some((l) => l.description.trim() || l.component_id);

  // ── Fold in what a colleague saved ─────────────────────────────────────────
  /** What a merge did, so the caller can write with it and say what happened. */
  interface RemoteMerge {
    changed: boolean; actor: string; conflicts: number;
    lines: EditLine[]; header: Quote; stamp: string | null;
  }
  const mergeInFlight = useRef<Promise<RemoteMerge> | null>(null);

  /**
   * Pull the document as the database holds it now and fold it into this tab:
   * rows this tab has not touched since base take the database's values, rows
   * it HAS touched keep this tab's, and only rows both sides moved count as
   * conflicts. Returns what it did — a save uses the merged rows rather than
   * the state it cannot see yet.
   *
   * Concurrent callers (the 15s poll and a save that starts mid-poll) share
   * one round trip: the second gets the first one's result instead of a stale
   * no-op that would then write over the merge.
   */
  function mergeRemote(): Promise<RemoteMerge> {
    if (mergeInFlight.current) return mergeInFlight.current;
    const p = doMergeRemote().finally(() => { mergeInFlight.current = null; });
    mergeInFlight.current = p;
    return p;
  }

  async function doMergeRemote(): Promise<RemoteMerge> {
    const localHeader = editingRef.current;
    const localLines = linesRef.current;
    const noop: RemoteMerge = {
      changed: false, actor: '', conflicts: 0,
      lines: localLines, header: localHeader as Quote, stamp: loadedStampRef.current,
    };
    if (!localHeader?.quote_id) return noop;
    const [qRes, iRes] = await Promise.all([
      supabase.from('22.0_sales_quotes').select('*').eq('quote_id', localHeader.quote_id).single(),
      supabase.from('22.1_sales_quote_items').select('*').eq('quote_id', localHeader.quote_id).order('sort_order'),
    ]);
    if (qRes.error || !qRes.data || iRes.error) return noop;
    const remoteHeader = qRes.data as Quote;
    const stamp = remoteHeader.updated_at ?? null;
    // Nothing new since this tab last looked — and nothing to tell anyone.
    if (!stamp || !loadedStampRef.current || stamp <= loadedStampRef.current) return noop;

    const dbLines = (iRes.data as DbLine[]) ?? [];
    const remoteLines = dbLines.map(mapLine);
    // Empty rows at the bottom are the editor's affordance, never saved rows.
    // They come off before the merge and go back on after, so a colleague's
    // lines cannot land underneath them — and so `dirty` below compares like
    // with like instead of arming the autosaver on every single poll.
    let cut = localLines.length;
    while (cut > 0 && isTailBlank(localLines[cut - 1])) cut -= 1;
    const tail = localLines.slice(cut);
    const { lines: mergedLines, conflicts: lineConflicts } =
      mergeLines(baseRef.current, localLines.slice(0, cut), remoteLines);
    const merged = [...mergedLines, ...tail];
    const { header: mergedHeader, conflicts: headerConflicts } =
      mergeHeader(baseHeaderRef.current ?? remoteHeader, localHeader, remoteHeader);

    setLines(merged);
    setEditing(mergedHeader);
    // Saved state is what the DATABASE now holds, so `dirty` still means
    // exactly "this tab is holding edits nobody else has seen" — a colleague's
    // row arriving must not, by itself, arm the autosaver.
    savedSnapRef.current = snapshotOf(remoteHeader, [...remoteLines, ...tail]);
    baseRef.current = remoteLines;
    baseHeaderRef.current = remoteHeader;
    loadedStampRef.current = stamp;
    // Every id the database actually holds. A row a colleague added is now
    // this tab's to keep; one they deleted is no longer this tab's to delete.
    knownItemIdsRef.current = new Set(dbLines.map((l) => l.item_id));
    return {
      changed: true, actor: remoteHeader.updated_by_email || '',
      conflicts: lineConflicts + headerConflicts, lines: merged, header: mergedHeader, stamp,
    };
  }

  // Background sync: a cheap stamp read every 15s and on window focus, and a
  // full merge only when the stamp has actually moved. Presence also calls it
  // the moment a colleague's "editing" flag clears, which is usually a save.
  const syncRef = useRef({ mergeRemote, busy });
  syncRef.current = { mergeRemote, busy };
  const syncNow = useCallback(async () => {
    const qid = editingRef.current?.quote_id;
    if (!qid || !loadedStampRef.current) return;
    if (syncRef.current.busy || mergeInFlight.current || autosavingRef.current) return;
    const { data } = await supabase.from('22.0_sales_quotes')
      .select('updated_at').eq('quote_id', qid).single();
    const stamp = (data as { updated_at?: string } | null)?.updated_at;
    if (!stamp || !loadedStampRef.current || stamp <= loadedStampRef.current) return;
    const res = await syncRef.current.mergeRemote();
    if (res.changed) flash(mergeMessage(res.actor, res.conflicts));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  useEffect(() => {
    const timer = setInterval(() => { void syncNow(); }, 15_000);
    const onFocus = () => { void syncNow(); };
    window.addEventListener('focus', onFocus);
    return () => { clearInterval(timer); window.removeEventListener('focus', onFocus); };
  }, [syncNow]);

  const autosave = useCallback(async () => {
    if (!editing || autosavingRef.current || busy) return;
    if (!draftLike || !hasContent) return;
    if (snapshotOf(editing, lines) === savedSnapRef.current) return;
    autosavingRef.current = true;
    const wasNew = !editing.quote_id;
    const qid = await persist();
    if (qid) {
      // persist() stamps savedSnapRef itself, from the POST-merge state — the
      // closure here may be one colleague's save out of date.
      setAutoSavedAt(new Date().toISOString());
      // persist() already adopted the new row's id + SQ number in place;
      // just fix the URL without a router navigation mid-typing.
      if (wasNew) window.history.replaceState(null, '', `/sales/${qid}`);
    }
    autosavingRef.current = false;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editing, lines, busy, draftLike, hasContent]);
  const autosaveRef = useRef(autosave);
  autosaveRef.current = autosave;

  // (load() stamps savedSnapRef itself — freshly loaded state IS saved state.)

  // Debounce: each change re-arms a 2.5s timer; the newest closure wins.
  useEffect(() => {
    if (loading || !draftLike || !hasContent || busy) return;
    if (snapshot === savedSnapRef.current) return;
    const t = setTimeout(() => { void autosaveRef.current(); }, 2500);
    return () => clearTimeout(t);
  }, [snapshot, loading, draftLike, hasContent, busy]);

  // Leaving the tab (switch, close, navigate): save immediately, best effort.
  // The unmount cleanup catches IN-APP navigation too (menu links) — the
  // request outlives the component.
  useEffect(() => {
    const onHide = () => { if (document.visibilityState === 'hidden') void autosaveRef.current(); };
    document.addEventListener('visibilitychange', onHide);
    window.addEventListener('pagehide', onHide);
    return () => {
      document.removeEventListener('visibilitychange', onHide);
      window.removeEventListener('pagehide', onHide);
      void autosaveRef.current();
    };
  }, []);

  // ── Unsaved-changes guard ──────────────────────────────────────────────────
  const dirty = !loading && !!editing && snapshot !== savedSnapRef.current;
  // Browser-level leave (close / refresh / external link): the native prompt.
  useEffect(() => {
    if (!dirty) return;
    const h = (e: BeforeUnloadEvent) => { e.preventDefault(); e.returnValue = ''; };
    window.addEventListener('beforeunload', h);
    return () => window.removeEventListener('beforeunload', h);
  }, [dirty]);
  // Ctrl+S / Cmd+S saves, exactly like the EPC editor. Refs carry the latest
  // state into the once-registered listener.
  const dirtyRef = useRef(dirty); dirtyRef.current = dirty;
  const busyRef = useRef(busy); busyRef.current = busy;
  const saveRef = useRef<() => void>(() => {});
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 's') {
        e.preventDefault();
        if (dirtyRef.current && !busyRef.current) saveRef.current();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  // Back to list: drafts save-and-go (the autosaver's job anyway); other
  // statuses get an explicit inline choice — NOT a confirm() dialog, which
  // browsers can suppress silently (the EPC Back-button lesson).
  const [leaveArmed, setLeaveArmed] = useState(false);
  async function backToList() {
    if (!dirty) { router.push('/sales'); return; }
    if (draftLike) { await persist(); router.push('/sales'); return; }
    setLeaveArmed(true);
  }

  async function persist(status?: string, extra?: Record<string, unknown>): Promise<string | null> {
    if (!editing) return null;
    // The autosaver must never open a dialog — it fires 2.5s after a keystroke
    // and again on tab-hide, so a confirm() there would ambush someone
    // mid-sentence. On that path the merge is reported in the toast instead.
    const quiet = autosavingRef.current;

    // ── 0. Stale-tab guard ───────────────────────────────────────────────────
    // Whatever a colleague saved since this tab last looked is folded in
    // BEFORE anything is written, so this save carries their rows forward
    // instead of writing over them.
    let liveHeader = editing;
    let liveLines = lines;
    let merged: RemoteMerge | null = null;
    if (editing.quote_id && loadedStampRef.current) {
      const { data: peek } = await supabase.from('22.0_sales_quotes')
        .select('updated_at').eq('quote_id', editing.quote_id).single();
      const stamp = (peek as { updated_at?: string } | null)?.updated_at;
      if (stamp && stamp > loadedStampRef.current) {
        const res = await mergeRemote();
        if (res.changed) { merged = res; liveHeader = res.header; liveLines = res.lines; }
      }
    }
    if (merged) {
      // A status somebody else moved while this tab sat open. The buttons on
      // screen were drawn from a status that no longer exists, so the
      // transition they name is not the one that would happen — say so rather
      // than, say, quietly reverting a confirmed order to a draft quotation.
      if (status && liveHeader.status !== editing.status) {
        flash(`Not saved — ${merged.actor || 'someone'} moved this to ${STATUS[liveHeader.status]?.label ?? liveHeader.status} while you had it open`);
        return null;
      }
      if (merged.conflicts > 0 && !quiet) {
        const n = merged.conflicts;
        const ok = window.confirm(
          `You and ${merged.actor || 'a colleague'} both edited ${n} of the same line${n > 1 ? 's' : ''}.\n\n`
          + 'Saving keeps YOUR version of those lines; everything else of theirs is already merged in.\n\nContinue?');
        if (!ok) { flash('Not saved'); return null; }
      } else {
        flash(mergeMessage(merged.actor, merged.conflicts));
      }
    }

    const kept = liveLines.filter((l) => l.is_section ? l.description.trim() : ((l.component_id || l.description.trim()) && num(l.quantity) > 0));
    // Totals come from the MERGED rows, not from the memo over this tab's
    // state — a colleague's line has to count towards the money too.
    const tot = totalsOf(liveLines, num(liveHeader.ppn_pct ?? defaultPpnPct));
    const header = {
      customer_id: liveHeader.customer_id, company_id: liveHeader.company_id, quote_date: liveHeader.quote_date,
      valid_until: liveHeader.valid_until || null,
      payment_terms: liveHeader.payment_terms ?? '', delivery_terms: liveHeader.delivery_terms ?? '',
      // No status argument means this save is not a transition, so the status
      // written is the DATABASE's — never this tab's, which may be stale.
      status: status ?? liveHeader.status, ppn_pct: num(liveHeader.ppn_pct),
      subtotal: tot.subtotal, ppn_amount: tot.ppn, grand_total: tot.grand, notes: liveHeader.notes,
      case_id: liveHeader.case_id ?? null,
      ...(systemDesign ? { system_design: systemDesign } : {}),
      ...(extra ?? {}),
    };
    let qid = editing.quote_id;
    if (qid) {
      // The stamp comes back from the same round trip: adopting what the
      // trigger just wrote is what stops this tab's OWN save looking like a
      // colleague's on the next poll.
      const { data, error } = await supabase.from('22.0_sales_quotes')
        .update(header).eq('quote_id', qid).select('updated_at').single();
      if (error) { flash(`Error: ${error.message}`); return null; }
      loadedStampRef.current = (data as { updated_at?: string } | null)?.updated_at ?? loadedStampRef.current;
    } else {
      // The DB trigger stamps the unique SQ number ON INSERT — a draft has its
      // number from the first (auto)save. Read it back so the header shows it
      // immediately instead of waiting for a reload.
      const { data, error } = await supabase.from('22.0_sales_quotes').insert(header).select('quote_id, quote_number, updated_at').single();
      if (error || !data) { flash(`Error: ${error?.message ?? 'insert failed'}`); return null; }
      qid = data.quote_id as string;
      const qnum = (data as { quote_number?: string }).quote_number ?? '';
      loadedStampRef.current = (data as { updated_at?: string }).updated_at ?? null;
      setEditing((e) => (e ? { ...e, quote_id: qid!, quote_number: e.quote_number || qnum } : e));
    }
    // ── Lines: UPSERT what survives, DELETE what went — IN THAT ORDER ────────
    // This was `delete every line for the quote, then insert them all back`,
    // which re-minted every item_id on every save — and the autosaver fires
    // one 2.5s after any keystroke. Two things broke silently:
    //
    //   • 24.1_delivery_order_items.so_item_id and
    //     25.1_sales_invoice_items.so_item_id are foreign keys onto these rows
    //     with ON DELETE SET NULL, so each save cut a delivered or invoiced
    //     line's link back to the order line it came from;
    //   • a second tab's save wiped the first tab's rows wholesale, no warning.
    //
    // Rows are written BY item_id now, so identity survives; and the delete
    // goes LAST and names only the rows this tab actually removed, so there is
    // never a moment where the order has no lines and a colleague's new row is
    // never collateral. Same shape as the PO-total fix — the data was right,
    // the ORDER of operations was the bug.
    //
    // Verified against the live schema in a rolled-back transaction
    // (2026-08-28): after this sequence the delivery line's so_item_id still
    // points at the kept order line, and the quote ends with the edited row
    // plus the new one.
    // A new row is given its uuid HERE rather than by the column default, so
    // the tab knows the id without matching returned rows back by position —
    // which upsert does not promise.
    const plan = planLineWrite(kept.map((l) => l.key), knownItemIdsRef.current, () => crypto.randomUUID());
    const byKey = new Map(kept.map((l) => [l.key, l]));
    // Where each surviving row sat in BASE — the version this tab agreed with
    // the database. Rows base holds that this save is dropping are deleted
    // below, so the ones that remain renumber; that renumbering is what the
    // position comparison has to be against.
    const basePos = new Map<string, { line: EditLine; idx: number }>();
    baseRef.current.filter((l) => byKey.has(l.key))
      .forEach((l, i) => basePos.set(l.key, { line: l, idx: i }));
    const planned = plan.assign.map(({ key, itemId }, i) => {
      const l = byKey.get(key)!;
      return {
        key,
        // A row identical to base — same values, same position — is not
        // written at all. That is what stops this tab's save from putting a
        // line it never touched back to the value it had when the tab opened.
        changed: (() => { const b = basePos.get(key); return !b || b.idx !== i || !sameLine(l, b.line); })(),
        row: {
          item_id: itemId, quote_id: qid, component_id: l.is_section ? null : l.component_id, is_section: l.is_section,
          description: l.description.trim(), brand: l.brand.trim(), note: l.note.trim(), lead_time: l.lead_time.trim(), unit: l.unit.trim(),
          quantity: l.is_section ? 0 : num(l.quantity), unit_price: l.is_section ? 0 : num(l.unit_price),
          qty_formula: l.is_section ? '' : l.qty_formula.trim(), price_formula: l.is_section ? '' : l.price_formula.trim(),
          line_total: l.is_section ? 0 : num(l.quantity) * num(l.unit_price), sort_order: i,
          design_role: l.design_role || null,
        },
      };
    });
    const rows = planned.filter((r) => r.changed).map((r) => r.row);

    let linesOk = true;
    if (rows.length) {
      const { error } = await supabase.from('22.1_sales_quote_items').upsert(rows, { onConflict: 'item_id' });
      if (error) { linesOk = false; flash(`Lines failed: ${error.message}`); }
    }
    // The delete runs LAST, and only if the write above succeeded — a failed
    // save must never be able to remove a line.
    if (linesOk) {
      if (plan.gone.length) {
        const { error } = await supabase.from('22.1_sales_quote_items').delete().in('item_id', plan.gone);
        if (error) flash(`Could not remove ${plan.gone.length} deleted line${plan.gone.length > 1 ? 's' : ''}: ${error.message}`);
      }
      knownItemIdsRef.current = new Set(plan.assign.map((a) => a.itemId));
      // The new rows exist now: carry their ids into the row keys so the NEXT
      // save updates them instead of inserting a second copy. snapshotOf()
      // ignores `key`, so this cannot mark the document dirty.
      if (Object.keys(plan.rekey).length) {
        setLines((ls) => ls.map((l) => (plan.rekey[l.key] ? { ...l, key: `db-${plan.rekey[l.key]}` } : l)));
      }
      // Rebase: the database now holds exactly what was just written, under
      // the ids it was written with. Without this the next save would compare
      // against a base that is one save behind and write every row again.
      // Base is what the DATABASE now holds, read back through mapLine — NOT
      // the rows on screen. `description` is trimmed on the way in, so basing
      // on the typed value would make a trailing space look like a colleague's
      // edit and report a conflict that never happened.
      baseRef.current = planned.map((r) => mapLine(r.row as unknown as DbLine));
      baseHeaderRef.current = { ...liveHeader, ...header } as Quote;
    }
    // Whatever just persisted is by definition the saved state — this keeps
    // the autosaver quiet after manual saves and status transitions too.
    savedSnapRef.current = snapshotOf(liveHeader, liveLines);
    return qid;
  }

  // Every busy-setter runs in try/finally: a thrown exception used to leave
  // `busy` true forever, silently disabling EVERY action button — clicks then
  // "did nothing" with no error in sight (field report 2026-08-19). Now the
  // exception is flashed and the buttons come back.
  async function save() {
    setBusy(true);
    try {
      const wasNew = !editing?.quote_id;
      const qid = await persist();
      if (!qid) return;
      flash('Saved');
      if (wasNew) router.replace(`/sales/${qid}${asOrder ? '?as=order' : ''}`); else load(true);
    } catch (e) {
      flash(`Save failed: ${e instanceof Error ? e.message : String(e)}`);
    } finally { setBusy(false); }
  }
  saveRef.current = () => { void save(); };

  async function printPdf() {
    setBusy(true);
    try {
      const qid = await persist();
      if (qid) { if (!editing?.quote_id) router.replace(`/sales/${qid}${asOrder ? '?as=order' : ''}`); window.open(`/sales/${qid}/print`, '_blank', 'noopener'); }
    } catch (e) {
      flash(`Save failed: ${e instanceof Error ? e.message : String(e)}`);
    } finally { setBusy(false); }
  }

  // Advance / revert status — stays on this page. Delivery writes stock-out movements.
  async function transition(next: string) {
    if (!editing) return;
    setBusy(true);
    try {
      const wasNew = !editing.quote_id;
      const qid = await persist(next);
      if (!qid) return;
      // Stock-outs are written PER DELIVERY ORDER (FulfillmentPanel), not on the
      // order-level status — partial shipments each move their own quantities.
      flash(`Marked ${STATUS[next]?.label ?? next}`);
      if (wasNew) router.replace(`/sales/${qid}${asOrder ? '?as=order' : ''}`); else load(true); // refresh status + stamped numbers in place
    } catch (e) {
      flash(`Could not mark ${STATUS[next]?.label ?? next}: ${e instanceof Error ? e.message : String(e)}`);
    } finally { setBusy(false); }
  }

  // Create Delivery Order: capture delivery instructions for the warehouse,
  // then move to 'preparing' (DO number stamps in the DB trigger). Editing
  // the details later (while still preparing) saves without a transition.
  const [showDoModal, setShowDoModal] = useState(false);
  async function submitDeliveryOrder(d: DeliveryDetails) {
    if (!editing) return;
    setBusy(true);
    try {
      const fields = {
        delivery_date: d.date || null, delivery_time: d.time, delivery_method: d.method,
        delivery_via: d.method === 'pickup' ? '' : d.via,
        delivery_address: d.method === 'pickup' ? '' : d.address,
        delivery_map_url: d.method === 'pickup' ? '' : d.mapUrl,
        delivery_contact: d.contact,
      };
      const qid = await persist(editing.status === 'preparing' ? undefined : 'preparing', fields);
      if (!qid) return;
      setShowDoModal(false);
      flash(editing.status === 'preparing' ? 'Delivery details updated' : 'Delivery Order created — warehouse can start preparing');
      load(true);
    } catch (e) {
      flash(`Could not save the delivery order: ${e instanceof Error ? e.message : String(e)}`);
    } finally { setBusy(false); }
  }

  // Revise: back to draft. The revision counter only bumps when the customer
  // has SEEN the quote (it was sent/accepted at some point) — a revision
  // number tracks what went out the door. Validated-but-never-sent simply
  // reopens under the same number; the trigger clears milestones only on a
  // bump, so that path clears validated_at itself.
  const reviseBumps = !!editing?.sent_at || ['sent', 'accepted'].includes(editing?.status ?? '');
  async function revise() {
    if (!editing?.quote_id) return;
    setBusy(true);
    try {
      // A bumped revision is a fresh offer — its validity restarts from today,
      // so an old quote doesn't come back already Expired.
      const qid = await persist('draft', reviseBumps
        ? { revision: (editing.revision ?? 0) + 1, valid_until: addDays(todayISO(), quoteValidityDays) }
        : { validated_at: null });
      if (!qid) return;
      flash(reviseBumps ? `Revision ${(editing.revision ?? 0) + 1} — back to draft` : 'Back to draft — same revision');
      load(true);
    } catch (e) {
      flash(`Could not revise: ${e instanceof Error ? e.message : String(e)}`);
    } finally { setBusy(false); }
  }

  if (authLoading || !profile || (loading && !editing)) return <CenterSpinner />;
  if (!canEdit) return <CenterSpinner />;
  if (notFound) return (
    <div className="min-h-screen bg-chrome flex flex-col items-center justify-center gap-3 text-slate-400">
      <p>Sales quote not found.</p>
      <button onClick={() => router.push('/sales')} className="px-4 py-2 rounded-xl bg-slate-800 text-slate-200 hover:bg-slate-700 text-sm">← Back to Sales</button>
    </div>
  );
  if (!editing) return <CenterSpinner />;

  const cust = editing.customer_id ? custById.get(editing.customer_id) : undefined;
  const newDoc = !editing.quote_id;
  const st = editing.status;
  const canRecord = ROLE_PERMISSIONS[profile.role].canRecordReceipts;
  const received = receipts.reduce((s, r) => s + (Number(r.amount) || 0), 0);
  const billTotal = Number(editing.grand_total) || totals.grand;
  const fullyPaid = billTotal > 0 && received >= billTotal - 0.5;
  const showPayments = !newDoc && ['ordered', 'invoiced', 'preparing', 'delivered'].includes(st);
  // Receipts per invoice — the link that makes an invoice's PAID/PARTIAL state
  // real. Shared by the Fulfillment rows and the Payments panel.
  const paidByInvoice = receipts.reduce((m, r) => {
    if (r.invoice_id) m[r.invoice_id] = (m[r.invoice_id] ?? 0) + (Number(r.amount) || 0);
    return m;
  }, {} as Record<string, number>);
  const todayIso = todayISO();
  // An offer past its own date, while still on the table (draft is not an
  // offer yet; accepted/ordered+ has already landed). NULL = no expiry.
  const expired = !!editing.valid_until && ['validated', 'sent'].includes(st)
    && editing.valid_until < todayIso;
  const actions: { label: string; to: string; primary?: boolean; danger?: boolean }[] = [];
  // Entered via "+ New Order": the quotation actions do not exist AT ALL on
  // the draft — offering Validate invited the wrong click and quietly turned
  // the order into a price quote (field report 2026-08-19). The only forward
  // action is Confirm Order.
  const orderMode = asOrder && st === 'draft';
  if (st === 'draft' && !orderMode) { actions.push({ label: 'Validate', to: 'validated', primary: true }); actions.push({ label: 'Sent', to: 'sent' }); }
  if (st === 'validated') actions.push({ label: 'Sent', to: 'sent', primary: true });
  if (st === 'sent') actions.push({ label: 'Accepted', to: 'accepted' });
  // Draft included (owner, 2026-08-19): not every order arrives through a
  // quotation — a customer who simply orders skips straight to the SO. The
  // same transition runs, the trigger stamps the SO number, stock reserves.
  if (['draft', 'validated', 'sent', 'accepted'].includes(st)) actions.push({ label: 'Confirm Order', to: 'ordered', primary: orderMode || !['draft', 'validated'].includes(st) });
  // Invoices and DOs are created from the Fulfillment panel below; every stage
  // stays revertible — including a delivered order.
  if (st === 'ordered') actions.push({ label: 'Revert', to: 'accepted' });
  if (st === 'invoiced') actions.push({ label: 'Revert', to: 'ordered' });
  if (st === 'preparing') actions.push({ label: 'Revert', to: 'invoiced' });
  if (st === 'delivered') actions.push({ label: 'Reopen', to: 'preparing' });
  if (['cancelled', 'rejected'].includes(st)) actions.push({ label: 'Reopen', to: 'draft' });
  if (['draft', 'validated', 'sent'].includes(st)) actions.push({ label: 'Reject', to: 'rejected', danger: true });
  if (['accepted', 'ordered', 'invoiced', 'preparing'].includes(st)) actions.push({ label: 'Cancel', to: 'cancelled', danger: true });
  // Revising re-opens the quote for edits with a bumped revision counter
  const canRevise = !!editing.quote_id && ['validated', 'sent', 'accepted'].includes(st);

  return (
    <div className="min-h-screen bg-chrome text-slate-200 font-sans text-sm">
      {/* ── One sticky command bar: identity (back · number · status) on the
             left, every action on the right — always in reach, directly above
             the milestone strip, instead of a bar hiding at the page bottom. ── */}
      <div className="border-b border-slate-800/60 bg-chrome/80 backdrop-blur-md sticky top-0 z-30">
        <div className="max-w-[1200px] 2xl:max-w-[1760px] mx-auto px-3 sm:px-4 md:px-6 pt-3 sm:pt-4">
          <BrandMenu wordmarkClass="text-xl md:text-2xl font-extrabold" subtitle="Sales · Quotation" mobileNav={false} />
        </div>
        <div className="max-w-[1200px] 2xl:max-w-[1760px] mx-auto px-3 sm:px-4 md:px-6 py-2 sm:py-2.5 flex items-center gap-2 sm:gap-2.5 overflow-x-auto scrollbar-none">
          {leaveArmed ? (
            <span className="flex items-center gap-2 flex-shrink-0">
              <span className="text-[11px] text-amber-300 font-semibold whitespace-nowrap">Unsaved —</span>
              <button onClick={async () => { await persist(); router.push('/sales'); }}
                className="text-xs font-bold px-3 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white transition-colors whitespace-nowrap">Save & leave</button>
              <button onClick={() => router.push('/sales')}
                className="text-[11px] font-medium px-2.5 py-1.5 rounded-lg border border-white/[0.06] text-slate-400 hover:text-red-300 hover:bg-red-500/10 transition-all">Discard</button>
              <button onClick={() => setLeaveArmed(false)} title="Stay on this quote"
                className="text-slate-500 hover:text-white px-1 transition-colors">✕</button>
            </span>
          ) : (
            <button onClick={backToList} title="Back to the sales list"
              className="flex-shrink-0 text-[11px] font-medium text-slate-400 hover:text-white px-2.5 py-1.5 border border-white/[0.06] rounded-lg hover:bg-white/10 transition-all whitespace-nowrap">←&nbsp;List</button>
          )}
          {/* Identity: the SQ number exists from the FIRST (auto)save — a
              draft carries its own unique number, not a placeholder. */}
          <h1 className="text-sm sm:text-base font-bold text-white whitespace-nowrap flex-shrink-0">
            {displayDocNumber(editing) || 'New Sales Quote'}
          </h1>
          {(editing.revision ?? 0) > 0 && (
            <span className="flex-shrink-0 px-2 py-0.5 rounded text-[11px] font-semibold bg-sky-500/15 text-sky-300">Rev {editing.revision}</span>
          )}
          {/* Who else is in this quotation right now. A colleague's amber dot
              means they are holding unsaved edits, and their flag clearing
              pulls their save in immediately instead of on the next poll. */}
          {editing.quote_id && profile?.email && (
            <DocumentPresence
              channelId={`sales:${editing.quote_id}`}
              email={profile.email}
              name={profile.display_name || profile.email}
              editing={dirty}
              onPeerSaved={syncNow}
            />
          )}
          {st !== 'delivered' && dos.some((d) => d.status === 'delivered') ? (
            <span className="flex-shrink-0 px-2 py-0.5 rounded text-[11px] font-semibold bg-teal-500/15 text-teal-300"
              title="Some delivery orders are delivered, the rest still preparing — the order completes when every item has shipped">
              Partly Delivered
            </span>
          ) : (
            <span className={`flex-shrink-0 px-2 py-0.5 rounded text-[11px] font-semibold ${STATUS[st]?.cls ?? ''}`}
              title={st === 'draft' && asOrder ? 'Entered via + New Order — the SO number stamps when you Confirm Order' : undefined}>
              {st === 'draft' && asOrder ? 'Draft order' : STATUS[st]?.label ?? st}
            </span>
          )}
          {/* After-sales quote — repair/replacement, badge links back to the case */}
          {(caseInfo || editing.case_id) && (
            <a href="/aftersales" target="_blank" rel="noopener noreferrer"
              className="flex-shrink-0 px-2 py-0.5 rounded text-[11px] font-semibold bg-orange-500/15 text-orange-300 ring-1 ring-orange-500/30 hover:bg-orange-500/25 transition-colors"
              title="After-sales quote — open the case list">
              Service{caseInfo?.case_number ? ` · ${caseInfo.case_number}` : ''}
            </a>
          )}
          {expired && (
            <span className="flex-shrink-0 px-2 py-0.5 rounded text-[11px] font-semibold bg-amber-500/15 text-amber-300 ring-1 ring-amber-500/30"
              title={`Offer expired ${fmtDay(editing.valid_until!)} — Revise to re-issue with fresh validity`}>
              Expired {fmtDay(editing.valid_until!)}
            </span>
          )}
          {showPayments && fullyPaid && (
            <span className="flex-shrink-0 px-2 py-0.5 rounded text-[11px] font-semibold bg-emerald-500/20 text-emerald-300 ring-1 ring-emerald-500/40">Paid</span>
          )}
          {/* Delivered with money open is its own state — goods are gone, so
              the missing rupiah outranks a mere "partial" note. */}
          {showPayments && !fullyPaid && st === 'delivered' && (
            <span className={`flex-shrink-0 px-2 py-0.5 rounded text-[11px] font-semibold ${received > 0 ? 'bg-amber-500/15 text-amber-300' : 'bg-red-500/10 text-red-300'}`}
              title={`Delivered, but Rp ${fmtInt(billTotal - received)} has not been received`}>
              Outstanding
            </span>
          )}
          {showPayments && !fullyPaid && received > 0 && st !== 'delivered' && (
            <span className="flex-shrink-0 px-2 py-0.5 rounded text-[11px] font-semibold bg-amber-500/15 text-amber-300">Partial</span>
          )}
          <span className="hidden lg:flex gap-2 flex-shrink-0">
            {/* Derived from the REAL child documents, not the legacy mirror of
                the first one — two invoices show as "INV-… +1", all numbers in
                the tooltip. */}
            {editing.order_number && <DocTag label="SO" value={editing.order_number} />}
            {invoices.length > 0 ? (
              <DocTag label="INV" title={invoices.map((i) => i.invoice_number).join(' · ')}
                value={invoices.length === 1 ? invoices[0].invoice_number : `${invoices[0].invoice_number} +${invoices.length - 1}`} />
            ) : editing.invoice_number ? <DocTag label="INV" value={editing.invoice_number} /> : null}
            {dos.length > 0 ? (
              <DocTag label="DO" title={dos.map((d) => d.do_number).join(' · ')}
                value={dos.length === 1 ? dos[0].do_number : `${dos[0].do_number} +${dos.length - 1}`} />
            ) : editing.do_number ? <DocTag label="DO" value={editing.do_number} /> : null}
          </span>
          {/* Actions — right side of the same bar */}
          <span className="ml-auto flex items-center gap-2 flex-shrink-0">
            {autoSavedAt && draftLike && (
              <span className="hidden md:inline text-[10px] text-slate-600 whitespace-nowrap" title="Drafts save themselves shortly after every change">
                Auto-saved {fmtDayTime(autoSavedAt)}
              </span>
            )}
            {busy && <span className="w-4 h-4 border-2 border-emerald-500/30 border-t-emerald-400 rounded-full animate-spin flex-shrink-0" />}
            {/* EPC command-bar grammar: quiet ghost buttons (hairline border,
                muted text that lights on hover) with ONE solid accent — Save.
                Status transitions keep their meaning through text colour only:
                emerald = the natural next step, red = destructive, sky = revise. */}
            <button onClick={save} disabled={busy || !dirty} title="Ctrl+S / Cmd+S"
              className="flex-shrink-0 flex items-center gap-1.5 px-4 py-1.5 rounded-lg text-[11px] font-semibold bg-emerald-600 hover:bg-emerald-500 text-white transition-all disabled:opacity-40">
              {busy ? 'Saving…' : 'Save'}
              <span className="hidden sm:inline text-white/50 text-[9px] font-normal">⌘S</span>
            </button>
            <button onClick={printPdf} disabled={busy} title="Print / PDF"
              className="flex-shrink-0 flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[11px] font-medium text-slate-400 hover:text-white hover:bg-white/10 border border-white/[0.06] transition-all disabled:opacity-40 whitespace-nowrap">
              <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2"><path strokeLinecap="round" strokeLinejoin="round" d="M6 9V2h12v7M6 18H4a2 2 0 01-2-2v-5a2 2 0 012-2h16a2 2 0 012 2v5a2 2 0 01-2 2h-2M6 14h12v8H6v-8z" /></svg>
              PDF
            </button>
            {actions.map((a) => (
              <button key={a.to} onClick={() => transition(a.to)} disabled={busy}
                title={a.to === 'ordered' ? 'Confirming reserves these quantities from Live Stock' : undefined}
                className={`flex-shrink-0 whitespace-nowrap px-3 py-1.5 rounded-lg text-[11px] border transition-all disabled:opacity-40 ${a.danger
                  ? 'font-medium text-red-400/90 hover:text-red-300 hover:bg-red-500/10 border-white/[0.06]'
                  : a.primary
                    ? 'font-semibold text-emerald-300 hover:text-emerald-200 hover:bg-emerald-500/10 border-emerald-500/25'
                    : 'font-medium text-slate-400 hover:text-white hover:bg-white/10 border-white/[0.06]'}`}>
                {a.label}
              </button>
            ))}
            {canRevise && (
              <button onClick={revise} disabled={busy}
                title={reviseBumps
                  ? 'Re-open for edits as a new revision (Rev n) — the customer has seen this quote'
                  : 'Re-open for edits — not sent yet, so it keeps the same revision number'}
                className="flex-shrink-0 whitespace-nowrap px-3 py-1.5 rounded-lg text-[11px] font-medium text-sky-300/90 hover:text-sky-200 hover:bg-sky-500/10 border border-white/[0.06] transition-all disabled:opacity-40">
                Revise
              </button>
            )}
          </span>
        </div>
      </div>
      <main className="max-w-[1200px] 2xl:max-w-[1760px] mx-auto px-3 sm:px-4 md:px-6 py-4 sm:py-5 space-y-5">

        {/* Milestone timeline — the defined progression with each stage's doc code */}
        {!newDoc && <SalesMilestones q={editing} received={received} billTotal={billTotal} invoices={invoices} dos={dos} />}

        {/* Fulfillment: this order's invoices + delivery orders (split-capable) */}
        {!newDoc && ['ordered', 'invoiced', 'preparing', 'delivered'].includes(st) && (
          <FulfillmentPanel
            quote={editing}
            soLines={savedLines}
            invoices={invoices}
            invItems={invItems}
            dos={dos}
            doItems={doItems}
            paidByInvoice={paidByInvoice}
            contacts={custContacts.filter((c) => c.customer_id === editing.customer_id)}
            shippingAddress={editing.customer_id ? (custById.get(editing.customer_id)?.shipping_address || custById.get(editing.customer_id)?.billing_address || '') : ''}
            canEdit={canEdit}
            onChanged={() => load(true)}
            flash={flash}
          />
        )}

        {/* Payments live directly under Fulfillment — record money against the
            invoice it pays without scrolling past the whole document. */}
        {showPayments && (
          <PaymentsPanel
            receipts={receipts} billTotal={billTotal} received={received} canRecord={canRecord}
            quoteId={editing.quote_id} companyId={editing.company_id}
            docNumber={displayDocNumber(editing)}
            invoices={invoices} paidByInvoice={paidByInvoice}
            onChanged={() => load(true)} flash={flash}
          />
        )}

        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 bg-slate-900/40 border border-slate-800/80 rounded-2xl p-4">
          <FieldBox label="Customer" full>
            <CustomerPicker customers={customers} value={editing.customer_id} onPick={(cid) => setHeader('customer_id', cid)} />
          </FieldBox>
          <FieldBox label="Selling company" full>
            <select value={editing.company_id ?? ''} onChange={(e) => setHeader('company_id', e.target.value || null)} className={inp}>
              <option value="">— Select company —</option>
              {companies.map((c) => <option key={c.company_id} value={c.company_id}>{c.legal_name}</option>)}
            </select>
          </FieldBox>
          <FieldBox label="Quote date">
            <input type="date" value={editing.quote_date} onChange={(e) => setHeader('quote_date', e.target.value)} className={inp} />
            {/* Always right under the box — a fixed control, not one that
                appears and vanishes. Muted when the date is already today. */}
            <span className="mt-1.5 block">
              <button onClick={() => setHeader('quote_date', todayIso)} disabled={editing.quote_date === todayIso}
                title={editing.quote_date === todayIso ? 'The quote is already dated today' : undefined}
                className="px-2 py-1 rounded-lg border border-white/[0.06] text-[10px] font-medium text-slate-400 hover:text-white hover:bg-white/10 transition-all disabled:opacity-40 disabled:hover:bg-transparent disabled:hover:text-slate-400">
                Set to today&rsquo;s date
              </button>
            </span>
          </FieldBox>
          <FieldBox label="Valid until">
            <input type="date" value={editing.valid_until ?? ''} onChange={(e) => setHeader('valid_until', e.target.value || null)} className={inp} />
            {/* Segmented preset control — one hairline outline, divided cells,
                the active span tinted; same ghost grammar as the command bar. */}
            <span className="mt-1.5 flex items-center gap-2">
              <span className="inline-flex rounded-lg border border-white/[0.06] overflow-hidden divide-x divide-white/[0.06]">
                {[7, 14, 30].map((d) => {
                  const target = addDays(editing.quote_date, d);
                  const active = editing.valid_until === target;
                  return (
                    <button key={d} onClick={() => setHeader('valid_until', target)}
                      title={`Valid until ${fmtDay(target)} (quote date + ${d} days)`}
                      className={`px-2 py-1 text-[10px] transition-all ${active
                        ? 'bg-emerald-500/15 text-emerald-300 font-semibold'
                        : 'text-slate-400 hover:text-white hover:bg-white/10 font-medium'}`}>
                      {d}d
                    </button>
                  );
                })}
              </span>
              <span className="text-[10px] text-slate-600">
                {editing.valid_until
                  ? (() => {
                      const days = Math.round((new Date(`${editing.valid_until}T12:00:00`).getTime() - new Date(`${editing.quote_date}T12:00:00`).getTime()) / 86400000);
                      return days >= 0 ? `${days} day${days !== 1 ? 's' : ''}` : 'before quote date';
                    })()
                  : 'no expiry'}
              </span>
            </span>
          </FieldBox>
          <FieldBox label="PPN %">
            <input value={String(editing.ppn_pct)} onChange={(e) => setHeader('ppn_pct', num(e.target.value) as any)} className={`${inp} tabular-nums`} />
          </FieldBox>
          <FieldBox label="Payment terms" full>
            <TermSelect value={editing.payment_terms ?? ''} options={salesPaymentTermsOptions}
              placeholder="— Select payment terms —" onChange={(v) => setHeader('payment_terms', v)} />
          </FieldBox>
          <FieldBox label="Delivery terms" full>
            <TermSelect value={editing.delivery_terms ?? ''} options={salesDeliveryTermsOptions}
              placeholder="— Select delivery terms —" onChange={(v) => setHeader('delivery_terms', v)} />
          </FieldBox>
        </div>

        <div className="space-y-2">
          {lines.map((l) => (
            <div
              key={l.key}
              {...drag.rowProps(l.key)}
              className={`rounded-xl ${REORDER_ROW} ${drag.lineAt(l.key)} ${drag.dragKey === l.key ? DRAGGING_ROW : ''}`}
            >
              <LineCard line={l} comps={comps} extras={sortedExtras} canHub={canHub} available={availableOf(l.component_id)}
                unitCost={canGP && l.component_id ? unitCost[l.component_id] ?? null : null}
                successor={(() => {
                  const sid = l.component_id ? successors.get(l.component_id) : undefined;
                  return sid ? { id: sid, name: compName(compById.get(sid)) || 'newer item' } : null;
                })()}
                linkedName={l.component_id ? compName(compById.get(l.component_id)) : ''}
                tierOptions={l.component_id ? tierOptionsFor(l.component_id) : []}
                history={l.component_id ? priceHistoryFor(l.component_id) : []}
                customerTier={custTierCode}
                leadSuggestion={l.component_id && !l.is_section ? suggestLeadFor(l.component_id, num(l.quantity)) : null}
                onPick={(c) => pickComponent(l.key, c)} onPickExtra={(x) => pickExtra(l.key, x)}
                onField={(patch) => setLine(l.key, patch)} onRemove={() => removeLine(l.key)}
                dragHandle={drag.handleProps(l.key)} />
            </div>
          ))}
          {drag.isDragging && (
            <div
              onDragOver={(e) => { e.preventDefault(); setDropEnd(true); }}
              onDragLeave={() => setDropEnd(false)}
              onDrop={(e) => { e.preventDefault(); if (drag.dragKey) moveLines(drag.dragKey, '__end__'); endDrag(); }}
              className={`h-9 rounded-xl border border-dashed flex items-center justify-center text-[10px] transition-colors ${dropEnd ? DROP_ZONE.over : DROP_ZONE.idle}`}
            >
              Drop here to move to the end
            </div>
          )}
          <div className="flex flex-wrap gap-2 pt-1">
            <button onClick={addItem} className="px-3.5 py-2 rounded-xl bg-slate-800 text-slate-200 hover:bg-slate-700 text-xs font-semibold transition-colors">+ Add item</button>
            <button onClick={addSection} className="px-3.5 py-2 rounded-xl bg-slate-800/60 text-slate-300 hover:bg-slate-700 text-xs font-semibold transition-colors">+ Add section</button>
            <button onClick={() => setSystemDesignerOpen(true)}
              title="Size the whole system — inverter, battery bank, array, structure and balance of system — from the PLN connection or the load table, priced at this customer's tier"
              className="px-3.5 py-2 rounded-xl border border-emerald-500/40 text-emerald-300 hover:bg-emerald-500/10 text-xs font-semibold transition-colors">
              {systemDesign?.engine === 'system' && hasDesignLines ? '⚡ System design ·  regenerate' : '⚡ Design system'}
            </button>
            <button onClick={() => setDesignerOpen(true)}
              title="Size the mounting structure from the array — rails, clamps, supports, grounding — priced at this customer's tier"
              className="px-3.5 py-2 rounded-xl border border-sky-500/40 text-sky-300 hover:bg-sky-500/10 text-xs font-semibold transition-colors">
              {systemDesign?.engine !== 'system' && hasDesignLines ? '⚙ Mounting design ·  regenerate' : '⚙ Design mounting'}
            </button>
            <span className="text-[11px] text-slate-600 self-center">Pick a catalog product to autofill price, or just type a custom item.</span>
          </div>
        </div>

        {/* Notes stretch to the exact height of the totals card — the two
            columns share top and bottom edges instead of a ragged gap. */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 items-stretch">
          <div className="flex flex-col">
            <label className="block text-[11px] font-medium text-slate-500 mb-1">Notes / terms</label>
            <textarea value={editing.notes} onChange={(e) => setHeader('notes', e.target.value)} rows={4}
              className={`${inp} flex-1 min-h-[96px] resize-y rounded-2xl`} />
          </div>
          <div className="bg-slate-900/40 border border-slate-800/80 rounded-2xl p-4 space-y-2 text-sm">
            <Row label="Subtotal" value={fmtInt(totals.subtotal)} />
            <Row label={`PPN (${num(editing.ppn_pct)}%)`} value={fmtInt(totals.ppn)} />
            <div className="border-t border-slate-800 pt-2 flex justify-between items-baseline">
              <span className="text-slate-300 font-semibold">Grand Total</span>
              <span className="text-xl font-extrabold text-emerald-300 tabular-nums">IDR {fmtInt(totals.grand)}</span>
            </div>
            {cust?.tier && <p className="text-[10px] text-slate-600">Prices auto-filled at the customer’s <span className="text-slate-400">{cust.tier}</span> tier.</p>}
            {/* Owner-only order margin — same basis as the per-line chips. */}
            {gpTotals && gpTotals.costed > 0 && (
              <div className="border-t border-slate-800 pt-2 space-y-1">
                <div className="flex justify-between text-xs text-slate-500">
                  <span title="Σ current moving-average landed cost × qty over lines linked to a costed catalog item">Est. COGS · avg landed cost</span>
                  <span className="tabular-nums">{fmtInt(gpTotals.cogs)}</span>
                </div>
                <div className="flex justify-between items-baseline text-xs">
                  <span className="text-slate-400 font-semibold">Est. gross profit <span className="text-slate-600 font-normal">· owner-only</span></span>
                  <span className={`tabular-nums font-bold ${gpTotals.gp < 0 ? 'text-red-300' : 'text-emerald-300'}`}>
                    {fmtInt(gpTotals.gp)}{gpTotals.margin != null ? ` · ${gpTotals.margin.toFixed(1)}%` : ''}
                  </span>
                </div>
                {gpTotals.costed < gpTotals.items && (
                  <p className="text-[10px] text-amber-400/80">
                    {gpTotals.items - gpTotals.costed} line{gpTotals.items - gpTotals.costed !== 1 ? 's' : ''} without a landed cost — excluded from the estimate.
                  </p>
                )}
              </div>
            )}
          </div>
        </div>

        {/* Every change on this document — who, what, when. Written by
            database triggers, so nothing can happen without a row here. */}
        {!newDoc && logs.length > 0 && <ActivityPanel logs={logs} />}

      </main>
      {toast && <Toast msg={toast} />}

      {/* The calculator, inside the quote: sized by the engine, priced at the
          customer's tier, inserted as ordinary editable lines. */}
      <MountingDesigner
        open={designerOpen}
        onClose={() => setDesignerOpen(false)}
        priceOf={(cid) => priceFor(cid)}
        stockOf={(cid) => availableOf(cid)}
        onApply={applyDesign}
        hasExisting={hasDesignLines}
      />
      {/* The full-system wizard: PLN or loads in, a complete priced BoM out —
          same engine the golden tests pin to the standalone calculator. */}
      <SystemDesigner
        open={systemDesignerOpen}
        onClose={() => setSystemDesignerOpen(false)}
        priceOf={(cid) => priceFor(cid)}
        stockOf={(cid) => availableOf(cid)}
        onApply={applyDesign}
        hasExisting={hasDesignLines}
        initial={systemDesign}
      />
    </div>
  );
}

// ── Styles + small building blocks ──────────────────────────────────────────
const inp = 'w-full px-3 py-2 rounded-lg bg-slate-900 border border-slate-700 focus:border-emerald-500/60 outline-none text-white text-sm placeholder:text-slate-600 transition-colors';
const inpSm = 'w-full px-2.5 py-1.5 rounded-lg bg-slate-950 border border-slate-800 focus:border-emerald-500/50 outline-none text-white text-xs placeholder:text-slate-600 transition-colors';

function CenterSpinner() {
  return <div className="min-h-screen bg-chrome flex items-center justify-center"><div className="w-6 h-6 border-2 border-emerald-500/30 border-t-emerald-500 rounded-full animate-spin" /></div>;
}
// Type-to-search customer picker — a 500-customer <select> forced scrolling;
// this filters as you type (same Autocomplete the rest of the app uses).
function CustomerPicker({ customers, value, onPick }: {
  customers: Customer[]; value: string | null; onPick: (customerId: string | null) => void;
}) {
  const sel = value ? customers.find((c) => c.customer_id === value) : undefined;
  const selName = sel ? (sel.display_name || sel.legal_name) : '';
  const [text, setText] = useState(selName);
  useEffect(() => { setText(selName); }, [selName]);
  const names = useMemo(() => customers.map((c) => c.display_name || c.legal_name).filter(Boolean), [customers]);
  return (
    <Autocomplete
      value={text} onChange={setText} suggestions={names}
      placeholder="Type to search customers…" inputClassName={inp}
      onCommit={(v) => {
        const t = v.trim().toLowerCase();
        if (!t) { onPick(null); return; }
        const m = customers.find((c) => (c.display_name || c.legal_name).trim().toLowerCase() === t);
        if (m) onPick(m.customer_id);
        else setText(selName); // unknown text never silently clears the pick
      }}
    />
  );
}

// ── Activity log — the traceability panel ───────────────────────────────────
const LOG_LABELS: Record<string, { label: string; cls: string }> = {
  created:          { label: 'Created',          cls: 'text-slate-300' },
  status:           { label: 'Status',           cls: 'text-sky-300' },
  revised:          { label: 'Revised',          cls: 'text-sky-300' },
  invoice_created:  { label: 'Invoice created',  cls: 'text-emerald-300' },
  invoice_deleted:  { label: 'Invoice deleted',  cls: 'text-red-300' },
  do_created:       { label: 'DO created',       cls: 'text-orange-300' },
  do_delivered:     { label: 'Delivered',        cls: 'text-emerald-300' },
  do_reopened:      { label: 'DO reopened',      cls: 'text-amber-300' },
  do_deleted:       { label: 'DO deleted',       cls: 'text-red-300' },
  payment_recorded: { label: 'Payment recorded', cls: 'text-emerald-300' },
  payment_removed:  { label: 'Payment removed',  cls: 'text-red-300' },
};

function ActivityPanel({ logs }: { logs: LogRow[] }) {
  const [showAll, setShowAll] = useState(false);
  const visible = showAll ? logs : logs.slice(0, 8);
  return (
    <div className="bg-slate-900/40 border border-slate-800/80 rounded-2xl p-4 space-y-3">
      <div className="flex flex-wrap items-baseline gap-3">
        <h3 className="text-xs font-semibold uppercase tracking-widest text-slate-400">Activity</h3>
        <span className="text-[11px] text-slate-600">every change on this document — who and when</span>
      </div>
      <div className="rounded-xl border border-slate-800 divide-y divide-slate-800/60">
        {visible.map((l) => {
          const m = LOG_LABELS[l.action] ?? { label: l.action, cls: 'text-slate-300' };
          return (
            <div key={l.log_id} className="flex flex-wrap items-center gap-x-3 gap-y-0.5 px-3 py-1.5 text-[11px]">
              <span className="text-slate-600 tabular-nums whitespace-nowrap w-32 flex-shrink-0">{fmtDayTime(l.at)}</span>
              <span className={`font-semibold whitespace-nowrap ${m.cls}`}>{m.label}</span>
              {l.detail && <span className="text-slate-400 font-mono text-[10px] truncate">{l.detail}</span>}
              <span className="ml-auto text-slate-600 truncate">{l.actor_email}</span>
            </div>
          );
        })}
      </div>
      {logs.length > 8 && (
        <button onClick={() => setShowAll((v) => !v)}
          className="px-2 py-1 rounded-lg border border-white/[0.06] text-[10px] font-medium text-slate-400 hover:text-white hover:bg-white/10 transition-all">
          {showAll ? 'Show fewer' : `Show all ${logs.length}`}
        </button>
      )}
    </div>
  );
}

/** Preset-list dropdown that keeps a stored custom value selectable even after
 *  it disappears from the Settings list — an old document must reopen intact. */
function TermSelect({ value, options, placeholder, onChange }: {
  value: string; options: string[]; placeholder: string; onChange: (v: string) => void;
}) {
  return (
    <select value={value} onChange={(e) => onChange(e.target.value)} className={inp}>
      <option value="">{placeholder}</option>
      {options.map((o) => <option key={o} value={o}>{o}</option>)}
      {value && !options.includes(value) && <option value={value}>{value}</option>}
    </select>
  );
}
function FieldBox({ label, children, full }: { label: string; children: React.ReactNode; full?: boolean }) {
  return <div className={full ? 'col-span-2' : ''}><label className="block text-[11px] font-medium text-slate-500 mb-1">{label}</label>{children}</div>;
}
function Row({ label, value }: { label: string; value: string }) {
  return <div className="flex justify-between text-slate-400"><span>{label}</span><span className="tabular-nums text-slate-200">{value}</span></div>;
}
function DocTag({ label, value, title }: { label: string; value: string; title?: string }) {
  return <span title={title} className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-slate-800 text-[11px]"><span className="text-slate-500 font-semibold">{label}</span><span className="font-mono text-slate-300">{value}</span></span>;
}
function Toast({ msg }: { msg: string }) {
  return <div className="fixed bottom-6 right-6 z-[110] px-4 py-2.5 bg-slate-800 border border-slate-700 text-white text-sm font-semibold rounded-xl shadow-lg">{msg}</div>;
}

const GRIP = (
  <svg className="w-3.5 h-3.5" fill="currentColor" viewBox="0 0 24 24"><circle cx="9" cy="6" r="1.5" /><circle cx="15" cy="6" r="1.5" /><circle cx="9" cy="12" r="1.5" /><circle cx="15" cy="12" r="1.5" /><circle cx="9" cy="18" r="1.5" /><circle cx="15" cy="18" r="1.5" /></svg>
);

function LineCard({ line, comps, extras, available, linkedName, canHub, unitCost, successor, tierOptions, history, customerTier, leadSuggestion, onPick, onPickExtra, onField, onRemove, dragHandle }: {
  line: EditLine; comps: Comp[]; extras: Extra[]; available: number | null; linkedName: string; canHub: boolean;
  /** Owner-only moving-average landed cost — null hides the GP chip entirely. */
  unitCost: number | null;
  /** Set when the linked catalog item has a newer version (successor link). */
  successor: { id: string; name: string } | null;
  tierOptions: TierOption[]; history: PriceHistEntry[]; customerTier: string;
  leadSuggestion: { value: string; why: string } | null;
  onPick: (c: Comp) => void; onPickExtra: (x: Extra) => void; onField: (patch: Partial<EditLine>) => void; onRemove: () => void;
  /** Everything the grip needs to start a drag — from useDragReorder. */
  dragHandle: React.DOMAttributes<HTMLElement> & { draggable: boolean };
}) {
  // Price-intel popover, EPC-style: HOVER opens it when this customer has
  // bought/quoted the item before (the nudge that matters); FOCUS opens it
  // whenever there is anything to show (editing the price = wanting options).
  // A short grace delay keeps it alive while the mouse travels into it.
  const [priceOpen, setPriceOpen] = useState(false);
  const closeTimer = useRef<number | null>(null);
  const scheduleClose = () => { if (closeTimer.current) window.clearTimeout(closeTimer.current); closeTimer.current = window.setTimeout(() => setPriceOpen(false), 250); };
  const cancelClose = () => { if (closeTimer.current) { window.clearTimeout(closeTimer.current); closeTimer.current = null; } };
  const mineHistory = history.some((h) => h.mine);
  const hasPriceIntel = tierOptions.length > 0 || history.length > 0;
  // Excel-like formula cells (EPC parity): the field shows the VALUE with an
  // ƒ badge when a formula backs it; focusing swaps the formula back in for
  // editing; blur re-evaluates. An invalid =formula reverts to the last value.
  const [qtyDraft, setQtyDraft] = useState<string | null>(null);
  const [priceDraft, setPriceDraft] = useState<string | null>(null);
  const commitCell = (draft: string | null, valueKey: 'quantity' | 'unit_price', formulaKey: 'qty_formula' | 'price_formula') => {
    if (draft == null) return;
    const t = draft.trim();
    if (t.startsWith('=')) {
      const v = evalCell(t);
      if (v !== t) onField({ [valueKey]: v, [formulaKey]: t });
      // invalid formula: leave the line untouched — the field reverts on blur
    } else {
      onField({ [valueKey]: t, [formulaKey]: '' });
    }
  };
  // Badge sits on the RIGHT — the numbers are left-aligned, so the right edge
  // is the quiet corner of the field.
  const fBadge = (formula: string, editing: boolean) => (formula && !editing ? (
    <span className="absolute right-1.5 top-1/2 -translate-y-1/2 text-[9px] font-bold text-sky-500/80 italic pointer-events-none select-none" title={`Formula: ${formula}`}>ƒ</span>
  ) : null);
  const grip = (title: string) => (
    <span
      {...dragHandle}
      title={title}
      className="cursor-grab active:cursor-grabbing text-slate-600 hover:text-slate-300 flex-shrink-0 select-none -ml-1"
    >
      {GRIP}
    </span>
  );
  if (line.is_section) {
    return (
      <div className="flex flex-wrap items-center gap-2 bg-emerald-500/[0.06] border border-emerald-500/20 border-l-2 border-l-emerald-500/50 rounded-xl px-3 py-2.5 mt-3">
        {grip('Drag to move this section together with its items')}
        <span className="text-[9px] font-bold uppercase tracking-widest text-emerald-500/70 flex-shrink-0">Section</span>
        <input value={line.description} onChange={(e) => onField({ description: e.target.value })} placeholder="Section title (e.g. Solar Panels)"
          className="flex-1 min-w-[140px] bg-transparent outline-none text-sm font-bold text-slate-100 placeholder:text-slate-600" />
        <div className="flex items-center gap-1.5">
          <span className="text-[10px] text-slate-500 whitespace-nowrap">Lead time</span>
          <input value={line.lead_time} onChange={(e) => onField({ lead_time: e.target.value })} placeholder="e.g. 4–6 weeks"
            className="w-28 px-2 py-1 rounded-lg bg-slate-950 border border-slate-800 focus:border-emerald-500/50 outline-none text-xs text-white placeholder:text-slate-600" />
        </div>
        <button onClick={onRemove} className="text-slate-600 hover:text-red-400 transition-colors flex-shrink-0" title="Remove">×</button>
      </div>
    );
  }
  const qty = num(line.quantity);
  const short = available != null && qty > available;
  return (
    <div className="bg-slate-900/40 border border-slate-800/80 rounded-xl px-3 py-2.5">
      {/* One aligned row on desktop: product grows, numbers in fixed columns */}
      <div className="flex flex-col lg:flex-row lg:items-end gap-2">
        <div className="hidden lg:flex items-center self-center">{grip('Drag to reorder')}</div>
        <div className="flex-1 min-w-0">
          <LabeledField label="Product / description">
            <ProductAutocomplete comps={comps} extras={extras} value={line.description} onText={(t) => onField({ description: t })} onPick={onPick} onPickExtra={onPickExtra} />
          </LabeledField>
        </div>
        <div className="grid grid-cols-4 gap-2 lg:w-[400px] flex-shrink-0">
          {/* Qty and Unit price accept Excel-style formulas (shared evalCell
              with the EPC editor): the field shows the value, the ƒ badge says
              a formula backs it, focus brings the formula back for editing. */}
          <LabeledField label={`Qty${short ? ' ⚠' : ''}`} labelCls={short ? 'text-red-400' : ''}>
            <span className="relative block">
              {fBadge(line.qty_formula, qtyDraft != null)}
              <input value={qtyDraft ?? line.quantity}
                onFocus={() => setQtyDraft(line.qty_formula || line.quantity)}
                onChange={(e) => setQtyDraft(e.target.value)}
                onBlur={() => { commitCell(qtyDraft, 'quantity', 'qty_formula'); setQtyDraft(null); }}
                placeholder="0" className={`${inpSm} tabular-nums`} />
            </span>
          </LabeledField>
          <LabeledField label="Unit">
            <input value={line.unit} onChange={(e) => onField({ unit: e.target.value })} placeholder="pcs" className={inpSm} />
          </LabeledField>
          <div className="relative"
            onMouseEnter={() => { if (mineHistory) { cancelClose(); setPriceOpen(true); } }}
            onMouseLeave={scheduleClose}
          >
            <LabeledField label={mineHistory ? (
              <span className="inline-flex items-center gap-1" title="This customer has bought or quoted this item before — hover the price for the log">
                Unit price <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 inline-block" />
              </span>
            ) : 'Unit price'}>
              <span className="relative block">
                {fBadge(line.price_formula, priceDraft != null)}
                <input value={priceDraft ?? line.unit_price}
                  onFocus={() => { setPriceDraft(line.price_formula || line.unit_price); if (hasPriceIntel) { cancelClose(); setPriceOpen(true); } }}
                  onChange={(e) => setPriceDraft(e.target.value)}
                  onBlur={() => { commitCell(priceDraft, 'unit_price', 'price_formula'); setPriceDraft(null); scheduleClose(); }}
                  onKeyDown={(e) => { if (e.key === 'Escape') setPriceOpen(false); }}
                  placeholder="0" title="Any typed price overrides the tier"
                  className={`${inpSm} tabular-nums ${mineHistory ? 'cursor-help border-emerald-500/30' : ''}`} />
              </span>
            </LabeledField>
            {priceOpen && (
              <PricePopover tierOptions={tierOptions} history={history} customerTier={customerTier}
                current={num(line.unit_price)}
                onPickPrice={(p) => { onField({ unit_price: String(Math.round(p)), price_formula: '' }); setPriceOpen(false); }}
                onHoverIn={cancelClose} onHoverOut={scheduleClose} />
            )}
          </div>
          <LabeledField label="Line total">
            <div className="px-2 py-1.5 text-right tabular-nums text-sm font-semibold text-slate-200">{fmtInt(qty * num(line.unit_price))}</div>
          </LabeledField>
        </div>
        <button onClick={onRemove} className="text-slate-600 hover:text-red-400 transition-colors text-lg leading-none px-1 self-start lg:self-end lg:pb-1.5 flex-shrink-0" title="Remove line">×</button>
      </div>
      {/* Meta row: catalog link, live stock, comment toggle. An INVISIBLE twin
          of the drag grip leads the row, so the chips align with the Product /
          description input above at every width and zoom (field report
          2026-08-19 — they used to start under the grip, a few px left). */}
      <div className="flex items-start gap-2 mt-1.5">
        <span className="hidden lg:inline-block invisible -ml-1 flex-shrink-0 select-none" aria-hidden>{GRIP}</span>
        <div className="flex items-center gap-3 flex-wrap flex-1 min-w-0">
          {line.component_id ? (
            <span className="inline-flex items-center gap-1.5 text-[10px] text-slate-500 bg-slate-800/60 border border-slate-700/60 rounded-md px-1.5 py-0.5">
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 flex-shrink-0" />
              <span className="truncate max-w-[200px]">{linkedName || 'Catalog item'}</span>
              <span className={`tabular-nums ${short ? 'text-red-400' : 'text-slate-500'}`}>· live {available != null ? fmtInt(available) : '—'}{short ? ' — short' : ''}</span>
              {canHub && (
                <a href={`/items/${line.component_id}`} target="_blank" rel="noopener noreferrer"
                  className="text-slate-600 hover:text-emerald-300 transition-colors" title="Open the item hub — stock, prices and history on one page">↗</a>
              )}
              <button onClick={() => onField({ component_id: null })} className="text-slate-600 hover:text-red-400 transition-colors" title="Unlink from catalog (keep as custom entry)">×</button>
            </span>
          ) : (
            <span className="text-[10px] text-slate-600 italic">Custom entry</span>
          )}
          {successor && (
            canHub ? (
              <a href={`/items/${successor.id}`} target="_blank" rel="noopener noreferrer"
                title={`This item is replaced by ${successor.name} — open the newer item`}
                className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-md border border-amber-500/40 bg-amber-500/10 text-amber-300 text-[10px] font-semibold hover:bg-amber-500/20 transition-colors">
                ↑ Newer version: <span className="truncate max-w-[160px]">{successor.name}</span> ↗
              </a>
            ) : (
              <span title={`This item is replaced by ${successor.name}`}
                className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-md border border-amber-500/40 bg-amber-500/10 text-amber-300 text-[10px] font-semibold">
                ↑ Newer version: <span className="truncate max-w-[160px]">{successor.name}</span>
              </span>
            )
          )}
          {/* Owner-only line margin (Dolibarr-style): est. GP at the current
              moving-average landed cost. Rendered only when the cost exists —
              other roles never receive `unitCost` at all. */}
          {unitCost != null && (() => {
            const price = num(line.unit_price);
            if (price <= 0 || qty <= 0) return null;
            const gp = (price - unitCost) * qty;
            const marginPct = ((price - unitCost) / price) * 100;
            return (
              <span className={`inline-flex items-center gap-1 text-[10px] font-semibold tabular-nums border rounded-md px-1.5 py-0.5 ${
                gp < 0 ? 'text-red-300 bg-red-500/10 border-red-500/30' : 'text-emerald-300 bg-emerald-500/[0.08] border-emerald-500/25'}`}
                title={`Owner-only — est. gross profit at the current moving-average landed cost of Rp ${fmtInt(unitCost)}/unit:\n(${fmtInt(price)} − ${fmtInt(unitCost)}) × ${fmtInt(qty)} = Rp ${fmtInt(gp)}`}>
                GP {fmtInt(gp)} · {marginPct.toFixed(1)}%
              </span>
            );
          })()}
          {/* Per-item lead time — same presets as the EPC proposal editor;
              "Custom" flips to free text, ↺ returns to the list. A line the
              stock can't cover must not claim "Ready" (and blank needs a real
              value) — the control turns amber and says so. */}
          <span className="inline-flex items-center gap-1.5 flex-wrap">
            <span className="text-[10px] text-slate-500 whitespace-nowrap">Lead time</span>
            {line.lead_time === '' || (LEAD_TIMES.includes(line.lead_time) && line.lead_time !== 'Custom') ? (
              <select value={line.lead_time} onChange={(e) => onField({ lead_time: e.target.value })}
                className={`bg-slate-950 border rounded-lg px-1.5 py-0.5 text-[11px] outline-none focus:border-emerald-500/50 transition-colors ${
                  short && (line.lead_time === 'Ready' || line.lead_time === '')
                    ? 'border-amber-500/60 text-amber-300'
                    : 'border-slate-800 text-slate-300'
                }`}>
                <option value="">—</option>
                {LEAD_TIMES.map((l) => <option key={l}>{l}</option>)}
              </select>
            ) : (
              <span className="inline-flex items-center gap-1">
                <input value={line.lead_time === 'Custom' ? '' : line.lead_time} autoFocus={line.lead_time === 'Custom'}
                  onChange={(e) => onField({ lead_time: e.target.value })} placeholder="e.g. 4 bulan"
                  className="w-24 bg-slate-950 border border-slate-800 focus:border-emerald-500/50 rounded-lg px-1.5 py-0.5 text-[11px] text-slate-300 outline-none transition-colors" />
                <button onClick={() => onField({ lead_time: '' })} className="text-slate-600 hover:text-slate-300 transition-colors text-xs" title="Back to preset list">↺</button>
              </span>
            )}
            {short && (line.lead_time === 'Ready' || line.lead_time === '') && (
              <span className="text-[10px] text-amber-400 whitespace-nowrap" title="Live stock cannot cover this quantity">
                ⚠ {line.lead_time === 'Ready' ? 'no stock for “Ready” — set the real lead time' : 'set the lead time — stock can’t cover this qty'}
              </span>
            )}
            {/* The suggestion: stock covers the qty → Ready; otherwise the
                item's historical PO→received average rounded up to months. */}
            {leadSuggestion && leadSuggestion.value !== line.lead_time && (
              <button onClick={() => onField({ lead_time: leadSuggestion.value })} title={leadSuggestion.why}
                className={`text-[10px] px-1.5 py-0.5 rounded-md border transition-colors ${
                  leadSuggestion.value === 'Ready'
                    ? 'border-emerald-500/30 text-emerald-400 hover:bg-emerald-500/10'
                    : 'border-sky-500/30 text-sky-400 hover:bg-sky-500/10'
                }`}>
                suggest: {leadSuggestion.value}
              </button>
            )}
          </span>
          <button onClick={() => onField({ showNote: !line.showNote })} className="text-[11px] text-slate-500 hover:text-slate-300 transition-colors ml-auto">
            {line.showNote || line.note ? 'Comment' : '+ Comment'}
          </button>
        </div>
      </div>
      {(line.showNote || line.note) && (
        <input value={line.note} onChange={(e) => onField({ note: e.target.value })} placeholder="Comment / extra description (toggle in PDF)" className={`${inpSm} mt-1.5`} />
      )}
    </div>
  );
}

function LabeledField({ label, labelCls, children }: { label: React.ReactNode; labelCls?: string; children: React.ReactNode }) {
  return <div><label className={`block text-[10px] font-medium text-slate-500 mb-0.5 ${labelCls ?? ''}`}>{label}</label>{children}</div>;
}

// ── Unit-price popover: the customer's tier price pre-chosen, every other
//    tier one click away, and what this item actually sold for before —
//    typing any number in the field still overrides everything. ─────────────
function PricePopover({ tierOptions, history, customerTier, current, onPickPrice, onHoverIn, onHoverOut }: {
  tierOptions: TierOption[]; history: PriceHistEntry[]; customerTier: string; current: number;
  onPickPrice: (p: number) => void; onHoverIn: () => void; onHoverOut: () => void;
}) {
  return (
    <>
      {/* Hover-driven, EPC-style: entering the panel cancels the grace-close;
          rows apply on MOUSEDOWN so a click lands before the input's blur. */}
      <div onMouseEnter={onHoverIn} onMouseLeave={onHoverOut}
        className="absolute right-0 top-full mt-1 z-50 w-72 bg-slate-900 border border-slate-700 rounded-xl shadow-2xl p-2 max-h-[340px] overflow-y-auto">
        {tierOptions.length > 0 && (
          <>
            <p className="px-1.5 pt-0.5 pb-1 text-[9px] font-bold uppercase tracking-widest text-slate-600">
              Tier prices{customerTier ? <span className="normal-case tracking-normal font-normal"> · customer is on <span className="text-emerald-400">{customerTier}</span></span> : ''}
            </p>
            {tierOptions.map((t) => (
              <button key={t.tier_id} disabled={t.price == null}
                onMouseDown={(e) => { e.preventDefault(); if (t.price != null) onPickPrice(t.price); }}
                className={`w-full flex items-center justify-between gap-2 px-2 py-1.5 rounded-lg text-xs transition-colors disabled:opacity-40 ${
                  t.chosen ? 'bg-emerald-500/10 text-emerald-300' : 'text-slate-300 hover:bg-white/10'
                }`}>
                <span className="flex items-center gap-1.5">
                  {t.code}
                  {t.chosen && <span className="text-[8px] font-bold uppercase tracking-wider text-emerald-500">customer’s tier</span>}
                </span>
                <span className={`tabular-nums font-semibold ${t.price != null && Math.round(t.price) === Math.round(current) ? 'text-emerald-300' : ''}`}>
                  {t.price != null ? fmtInt(t.price) : '—'}
                </span>
              </button>
            ))}
          </>
        )}
        {history.length > 0 && (
          <>
            <p className={`px-1.5 pb-1 text-[9px] font-bold uppercase tracking-widest text-slate-600 ${tierOptions.length ? 'pt-2 border-t border-slate-800 mt-1.5' : 'pt-0.5'}`}>
              Sold before
            </p>
            {history.map((h, i) => (
              <button key={i} onMouseDown={(e) => { e.preventDefault(); onPickPrice(h.price); }}
                className="w-full px-2 py-1.5 rounded-lg text-left hover:bg-white/10 transition-colors">
                <span className="flex items-center justify-between gap-2 text-xs">
                  <span className={`truncate ${h.mine ? 'text-emerald-300' : 'text-slate-300'}`}>{h.customer}</span>
                  <span className="tabular-nums font-semibold text-slate-200 flex-shrink-0">{fmtInt(h.price)}</span>
                </span>
                <span className="flex items-center justify-between gap-2 text-[10px] text-slate-600">
                  <span>{h.quote_number}{h.mine ? ' · this customer' : ''}</span>
                  <span className="tabular-nums">×{fmtInt(h.qty)} · {fmtDay(h.date)}</span>
                </span>
              </button>
            ))}
          </>
        )}
        {tierOptions.length === 0 && history.length === 0 && (
          <p className="px-2 py-3 text-[11px] text-slate-600">No tier prices or sales history for this item yet.</p>
        )}
        <p className="px-1.5 pt-1.5 pb-0.5 text-[9px] text-slate-700 border-t border-slate-800 mt-1.5">
          Click a price to use it — or just type your own in the field.
        </p>
      </div>
    </>
  );
}

// ── Payments (AR) — mirrors the buy-side PO payment pattern ─────────────────
function PaymentsPanel({ receipts, billTotal, received, canRecord, quoteId, companyId, docNumber, invoices, paidByInvoice, onChanged, flash }: {
  receipts: Receipt[]; billTotal: number; received: number; canRecord: boolean;
  quoteId: string; companyId: string | null; docNumber: string;
  invoices: Invoice[]; paidByInvoice: Record<string, number>;
  onChanged: () => void; flash: (m: string) => void;
}) {
  const supabase = createSupabaseClient();
  const [showModal, setShowModal] = useState(false);
  const outstanding = Math.max(0, billTotal - received);
  const pct = billTotal > 0 ? Math.min(100, (received / billTotal) * 100) : 0;
  const invNumById = useMemo(() => new Map(invoices.map((i) => [i.invoice_id, i.invoice_number])), [invoices]);

  async function removeReceipt(r: Receipt) {
    const { error } = await supabase.from('26.0_customer_receipts').delete().eq('receipt_id', r.receipt_id);
    if (error) { flash(`Failed: ${error.message}`); return; }
    flash('Payment removed');
    onChanged();
  }

  return (
    <div className="bg-slate-900/40 border border-slate-800/80 rounded-2xl p-4 space-y-3">
      <div className="flex flex-wrap items-center gap-3">
        <h3 className="text-xs font-semibold uppercase tracking-widest text-slate-400">Payments · {docNumber}</h3>
        <div className="flex items-center gap-2 ml-auto">
          <div className="w-28 h-1.5 bg-slate-700 rounded-full overflow-hidden">
            <div className={`h-full rounded-full ${pct >= 100 ? 'bg-emerald-500' : pct > 0 ? 'bg-amber-400' : 'bg-slate-600'}`} style={{ width: `${pct}%` }} />
          </div>
          <span className={`text-[11px] font-semibold tabular-nums ${pct >= 100 ? 'text-emerald-400' : pct > 0 ? 'text-amber-300' : 'text-slate-600'}`}>{pct.toFixed(0)}%</span>
        </div>
      </div>

      <div className="grid grid-cols-3 gap-3 text-center">
        <MiniStat label="Order total" value={fmtInt(billTotal)} cls="text-slate-200" />
        <MiniStat label="Received" value={fmtInt(received)} cls={received > 0 ? 'text-emerald-300' : 'text-slate-500'} />
        <MiniStat label="Outstanding" value={fmtInt(outstanding)} cls={outstanding > 0 ? 'text-amber-300' : 'text-emerald-400'} />
      </div>

      {receipts.length > 0 && (
        <div className="rounded-xl border border-slate-800 divide-y divide-slate-800/60">
          {receipts.map((r) => (
            <div key={r.receipt_id} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2 text-xs">
              <span className="font-mono text-[10px] text-slate-500">{r.receipt_number}</span>
              {r.invoice_id && invNumById.has(r.invoice_id) && (
                <span className="font-mono text-[10px] px-1.5 py-0.5 rounded bg-lime-500/10 text-lime-300/90" title="This payment is applied to this invoice">{invNumById.get(r.invoice_id)}</span>
              )}
              <span className="text-slate-400">{RECEIPT_CATS.find((c) => c.value === r.category)?.label ?? r.category}</span>
              <span className="text-slate-500">{METHOD_LABELS[r.payment_method] ?? r.payment_method}{r.bank_ref ? ` · ${r.bank_ref}` : ''}</span>
              <span className="ml-auto tabular-nums text-emerald-200 font-semibold">{fmtInt(Number(r.amount))}</span>
              <span className="text-slate-600 tabular-nums">{fmtDay(r.payment_date)}</span>
              {canRecord && (
                <button onClick={() => removeReceipt(r)} className="text-slate-600 hover:text-red-400 transition-colors" title="Remove payment">×</button>
              )}
            </div>
          ))}
        </div>
      )}

      {canRecord ? (
        <button onClick={() => setShowModal(true)}
          className="px-3 py-1.5 rounded-lg text-[11px] font-semibold text-emerald-300 hover:text-emerald-200 hover:bg-emerald-500/10 border border-emerald-500/25 transition-all">
          + Record Payment
        </button>
      ) : (
        <p className="text-[10px] text-slate-600">Payments are recorded by Finance / Owner.</p>
      )}

      {showModal && (
        <RecordPaymentModal quoteId={quoteId} companyId={companyId} outstanding={outstanding} received={received}
          invoices={invoices} paidByInvoice={paidByInvoice}
          onClose={() => setShowModal(false)} onDone={() => { setShowModal(false); onChanged(); }} flash={flash} />
      )}
    </div>
  );
}

function MiniStat({ label, value, cls }: { label: string; value: string; cls: string }) {
  return (
    <div className="bg-slate-950/50 border border-slate-800 rounded-xl py-2 px-1">
      <p className="text-[9px] font-semibold uppercase tracking-widest text-slate-600 mb-0.5">{label}</p>
      <p className={`text-sm font-bold tabular-nums ${cls}`}>{value}</p>
    </div>
  );
}

function RecordPaymentModal({ quoteId, companyId, outstanding, received, invoices, paidByInvoice, onClose, onDone, flash }: {
  quoteId: string; companyId: string | null; outstanding: number; received: number;
  invoices: Invoice[]; paidByInvoice: Record<string, number>;
  onClose: () => void; onDone: () => void; flash: (m: string) => void;
}) {
  const supabase = createSupabaseClient();
  // The payment applies to an INVOICE — that link is what turns the invoice's
  // UNPAID badge into PARTIAL/PAID. Defaults to the first invoice still owed;
  // the amount prefills with THAT invoice's outstanding and follows the pick.
  const invOutstanding = (id: string) => {
    const inv = invoices.find((i) => i.invoice_id === id);
    return inv ? Math.max(0, (Number(inv.grand_total) || 0) - (paidByInvoice[id] ?? 0)) : outstanding;
  };
  const firstOwed = invoices.find((i) => invOutstanding(i.invoice_id) > 0.5);
  const [invId, setInvId] = useState(firstOwed?.invoice_id ?? '');
  const fillFor = (id: string) => {
    const o = id ? invOutstanding(id) : outstanding;
    return o > 0 ? String(Math.round(o)) : '';
  };
  // First payment defaults to DP; later ones to balance — mirroring PO practice.
  const [category, setCategory] = useState(received > 0 ? 'balance_payment' : 'down_payment');
  const [amount, setAmount] = useState(() => fillFor(firstOwed?.invoice_id ?? ''));
  const [method, setMethod] = useState('bank_transfer');
  const [date, setDate] = useState(todayISO());
  const [bankRef, setBankRef] = useState('');
  const [notes, setNotes] = useState('');
  const [busy, setBusy] = useState(false);
  // Which bank account the money landed in — tagging it here is what makes the
  // account's statement on /banks complete.
  const [banks, setBanks] = useState<BankAccount[]>([]);
  const [bankCompanies, setBankCompanies] = useState<Map<string, string>>(new Map());
  const [bankId, setBankId] = useState('');
  useEffect(() => {
    fetchBankAccounts(supabase).then((list) => {
      setBanks(list);
      // The issuing company's default receipt account (Settings › Banks)
      setBankId((prev) => prev || (defaultAccountFor(list, 'receipt', companyId)?.bank_account_id ?? ''));
    });
    // Which PT each account belongs to — visible in the picker itself
    fetchAccountCompanies(supabase).then(setBankCompanies);
  }, [companyId]);   // eslint-disable-line react-hooks/exhaustive-deps

  async function submit() {
    const amt = num(amount);
    if (amt <= 0) { flash('Enter an amount'); return; }
    setBusy(true);
    const { error } = await supabase.from('26.0_customer_receipts').insert({
      quote_id: quoteId, invoice_id: invId || null, category, amount: amt, payment_method: method,
      payment_date: date, bank_ref: bankRef.trim(), notes: notes.trim(),
      bank_account_id: bankId || null,
    });
    setBusy(false);
    if (error) { flash(`Failed: ${error.message}`); return; }
    flash('Payment recorded');
    onDone();
  }

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center px-4" onClick={onClose}>
      <div className="absolute inset-0 bg-black/60" />
      <div className="relative w-full max-w-md bg-canvas border border-slate-800 rounded-2xl shadow-2xl p-6 space-y-3" onClick={(e) => e.stopPropagation()}>
        <h3 className="text-base font-bold text-white">Record customer payment</h3>

        <div className="grid grid-cols-2 gap-3">
          {invoices.length > 0 && (
            <FieldBox label="For invoice" full>
              <select value={invId}
                onChange={(e) => { setInvId(e.target.value); setAmount(fillFor(e.target.value)); }}
                className={inp}>
                {invoices.map((i) => {
                  const o = invOutstanding(i.invoice_id);
                  return (
                    <option key={i.invoice_id} value={i.invoice_id}>
                      {i.invoice_number} — {o > 0.5 ? `Rp ${fmtInt(o)} outstanding` : 'PAID'}
                    </option>
                  );
                })}
                <option value="">Whole order (not tied to an invoice)</option>
              </select>
            </FieldBox>
          )}
          <FieldBox label="Type" full>
            <select value={category} onChange={(e) => setCategory(e.target.value)} className={inp}>
              {RECEIPT_CATS.map((c) => <option key={c.value} value={c.value}>{c.label}</option>)}
            </select>
          </FieldBox>
          <FieldBox label="Amount (IDR)" full>
            <div className="flex gap-2">
              {/* =formulas evaluate on blur (shared evalCell) — "=2181773/2"
                  is how a split amount actually gets typed. */}
              <input value={amount} inputMode="decimal" onChange={(e) => setAmount(e.target.value)}
                onBlur={(e) => { const v = evalCell(e.target.value); if (v !== e.target.value) setAmount(String(Math.round(num(v)))); }}
                placeholder="0" className={`${inp} text-right tabular-nums`} />
              {(invId ? invOutstanding(invId) : outstanding) > 0 && (
                <button onClick={() => setAmount(fillFor(invId))}
                  title={invId ? 'Fill this invoice’s outstanding amount' : 'Fill the order’s outstanding amount'}
                  className="px-3 rounded-lg text-[11px] font-medium text-slate-400 hover:text-white hover:bg-white/10 border border-white/[0.06] whitespace-nowrap transition-all">
                  Fill remaining
                </button>
              )}
            </div>
          </FieldBox>
          <FieldBox label="Method">
            <select value={method} onChange={(e) => setMethod(e.target.value)} className={inp}>
              {Object.entries(METHOD_LABELS).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
            </select>
          </FieldBox>
          <FieldBox label="Payment date">
            <input type="date" value={date} onChange={(e) => setDate(e.target.value)} className={inp} />
          </FieldBox>
          <FieldBox label="Received in" full>
            <select value={bankId} onChange={(e) => setBankId(e.target.value)} className={inp}>
              <option value="">— not recorded —</option>
              {banks.map((b) => <option key={b.bank_account_id} value={b.bank_account_id}>{accountLabelWithCompany(b, bankCompanies)}</option>)}
            </select>
          </FieldBox>
          <FieldBox label="Bank ref / cheque no." full>
            <input value={bankRef} onChange={(e) => setBankRef(e.target.value)} placeholder="Optional reference" className={inp} />
          </FieldBox>
          <FieldBox label="Notes" full>
            <input value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Optional" className={inp} />
          </FieldBox>
        </div>

        <div className="flex justify-end gap-3 pt-1">
          <button onClick={onClose} className="px-4 py-2 rounded-xl text-slate-400 hover:text-white text-sm transition-colors">Cancel</button>
          <button onClick={submit} disabled={busy}
            className="px-5 py-2 rounded-xl bg-emerald-500/15 text-emerald-300 ring-1 ring-emerald-500/30 hover:bg-emerald-500/25 text-sm font-semibold transition-colors disabled:opacity-50 flex items-center gap-2">
            {busy && <span className="w-3.5 h-3.5 border-2 border-emerald-500/30 border-t-emerald-400 rounded-full animate-spin" />}
            Record payment
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Create Delivery Order — the warehouse instruction form ──────────────────
const TIME_OF_DAY = ['Pagi (08–11)', 'Siang (11–14)', 'Sore (14–17)'];
const VIA_SUGGESTIONS = ['Armada sendiri', 'Kurir instan (GoSend/Grab)', 'Ekspedisi / cargo', 'JNE/J&T', 'Truk sewa'];

function DeliveryOrderModal({ initial, contacts, isEdit, busy, onClose, onSubmit }: {
  initial: DeliveryDetails; contacts: CustContact[]; isEdit: boolean; busy: boolean;
  onClose: () => void; onSubmit: (d: DeliveryDetails) => void;
}) {
  const [d, setD] = useState<DeliveryDetails>(initial);
  const set = <K extends keyof DeliveryDetails>(k: K, v: DeliveryDetails[K]) => setD((x) => ({ ...x, [k]: v }));
  const isPickup = d.method === 'pickup';

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center px-4" onClick={onClose}>
      <div className="absolute inset-0 bg-black/60" />
      <div className="relative w-full max-w-lg max-h-[90vh] overflow-y-auto bg-canvas border border-slate-800 rounded-2xl shadow-2xl p-6 space-y-3" onClick={(e) => e.stopPropagation()}>
        <div>
          <h3 className="text-base font-bold text-white">{isEdit ? 'Edit delivery details' : 'Create Delivery Order'}</h3>
          <p className="text-[11px] text-slate-500 mt-0.5">
            {isEdit ? 'Update the warehouse instructions for this DO.' : 'This issues the DO number and moves the order to “Preparing Items” — the warehouse team\'s instruction to pick and pack.'}
          </p>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <FieldBox label="Target delivery date">
            <input type="date" value={d.date} onChange={(e) => set('date', e.target.value)} className={inp} />
          </FieldBox>
          <FieldBox label="Time of day">
            <select value={d.time} onChange={(e) => set('time', e.target.value)} className={inp}>
              <option value="">— Anytime —</option>
              {TIME_OF_DAY.map((t) => <option key={t} value={t}>{t}</option>)}
              {d.time && !TIME_OF_DAY.includes(d.time) && <option value={d.time}>{d.time}</option>}
            </select>
          </FieldBox>
          <FieldBox label="Method" full>
            <div className="flex gap-2">
              {[{ v: 'delivery', l: 'Delivery (we send)' }, { v: 'pickup', l: 'Customer pick-up' }].map((m) => (
                <button key={m.v} onClick={() => set('method', m.v)}
                  className={`flex-1 px-3 py-2 rounded-xl text-sm font-semibold border transition-colors ${d.method === m.v ? 'bg-emerald-500/15 text-emerald-300 border-emerald-500/40' : 'bg-slate-900 text-slate-400 border-slate-700 hover:border-slate-500'}`}>
                  {m.l}
                </button>
              ))}
            </div>
          </FieldBox>
          {!isPickup && (
            <FieldBox label="Through / carrier" full>
              <input list="via-suggestions" value={d.via} onChange={(e) => set('via', e.target.value)}
                placeholder="e.g. Armada sendiri, ekspedisi…" className={inp} />
              <datalist id="via-suggestions">
                {VIA_SUGGESTIONS.map((v) => <option key={v} value={v} />)}
              </datalist>
            </FieldBox>
          )}
          {!isPickup && (
            <FieldBox label="Delivery address" full>
              <textarea value={d.address} onChange={(e) => set('address', e.target.value)} rows={3}
                placeholder="Street address for the driver" className={inp} />
            </FieldBox>
          )}
          {!isPickup && (
            <FieldBox label="Google Maps link" full>
              <input value={d.mapUrl} onChange={(e) => set('mapUrl', e.target.value)}
                placeholder="https://maps.app.goo.gl/…" className={inp} />
            </FieldBox>
          )}
          <FieldBox label="Contact person (on site)" full>
            <input list="do-contacts" value={d.contact} onChange={(e) => set('contact', e.target.value)}
              placeholder={contacts.length ? 'Pick a customer contact or type one…' : 'Name · phone'} className={inp} />
            <datalist id="do-contacts">
              {contacts.map((c) => (
                <option key={`${c.name}-${c.phone}`} value={`${c.name}${c.phone ? ` · ${c.phone}` : ''}`}>{c.title}</option>
              ))}
            </datalist>
          </FieldBox>
        </div>

        <div className="flex justify-end gap-3 pt-1">
          <button onClick={onClose} className="px-4 py-2 rounded-xl text-slate-400 hover:text-white text-sm transition-colors">Cancel</button>
          <button onClick={() => onSubmit(d)} disabled={busy}
            className="px-5 py-2 rounded-xl bg-emerald-500/15 text-emerald-300 ring-1 ring-emerald-500/30 hover:bg-emerald-500/25 text-sm font-semibold transition-colors disabled:opacity-50 flex items-center gap-2">
            {busy && <span className="w-3.5 h-3.5 border-2 border-emerald-500/30 border-t-emerald-400 rounded-full animate-spin" />}
            {isEdit ? 'Save details' : 'Create Delivery Order'}
          </button>
        </div>
      </div>
    </div>
  );
}

function ProductAutocomplete({ comps, extras, value, onText, onPick, onPickExtra }: {
  comps: Comp[]; extras: Extra[]; value: string;
  onText: (t: string) => void; onPick: (c: Comp) => void; onPickExtra: (x: Extra) => void;
}) {
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);
  const results = useMemo(() => {
    const s = value.trim().toLowerCase();
    const list = s ? comps.filter((c) => `${c.internal_description ?? ''} ${c.supplier_model}`.toLowerCase().includes(s)) : comps;
    return list.slice(0, 20);
  }, [comps, value]);
  // PREV / LIB suggestions, excluding texts that duplicate a shown catalog item
  const extraResults = useMemo(() => {
    const s = value.trim().toLowerCase();
    const shown = new Set(results.map((c) => compName(c).trim().toLowerCase()));
    const list = extras.filter((x) => !shown.has(x.description.toLowerCase()) && (!s || x.description.toLowerCase().includes(s)));
    return list.slice(0, 6);
  }, [extras, results, value]);
  const total = results.length + extraResults.length;
  useEffect(() => { setActive(-1); }, [value]);

  const choose = (i: number) => {
    if (i < results.length) onPick(results[i]);
    else onPickExtra(extraResults[i - results.length]);
    setOpen(false);
  };
  const onKey = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (!open || total === 0) { if (e.key === 'ArrowDown') setOpen(true); return; }
    if (e.key === 'ArrowDown') { e.preventDefault(); setActive((i) => Math.min(i + 1, total - 1)); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setActive((i) => Math.max(i - 1, -1)); }
    else if (e.key === 'Enter' && active >= 0) { e.preventDefault(); choose(active); }
    else if (e.key === 'Escape') setOpen(false);
  };
  return (
    <div className="relative">
      <input value={value} onChange={(e) => { onText(e.target.value); setOpen(true); }} onFocus={() => setOpen(true)}
        onBlur={() => setTimeout(() => setOpen(false), 150)} onKeyDown={onKey}
        placeholder="Type a product or custom item…" autoComplete="off" className={inpSm} />
      {open && total > 0 && (
        <div className="absolute z-30 left-0 right-0 mt-1 max-h-60 overflow-y-auto bg-slate-900 border border-emerald-500/40 rounded-lg shadow-2xl">
          {results.map((c, i) => (
            <button key={c.component_id} onMouseDown={(e) => { e.preventDefault(); choose(i); }}
              className={`w-full text-left px-3 py-1.5 text-xs border-b border-slate-800/50 last:border-0 ${i === active ? 'bg-emerald-600/30 text-white' : 'hover:bg-slate-800 text-slate-300'}`}>
              <span className="block truncate">{compName(c)}</span>
              <span className="block text-[10px] text-slate-500 truncate">{[c.unit, c.selling_price_idr ? `Rp${fmtInt(c.selling_price_idr)}` : ''].filter(Boolean).join(' · ')}</span>
            </button>
          ))}
          {extraResults.length > 0 && (
            <p className="px-3 pt-1.5 pb-0.5 text-[9px] uppercase tracking-wider text-slate-600 border-t border-slate-800">Previous &amp; library entries</p>
          )}
          {extraResults.map((x, xi) => {
            const i = results.length + xi;
            return (
              <button key={`${x.kind}-${x.description}`} onMouseDown={(e) => { e.preventDefault(); choose(i); }}
                className={`w-full text-left px-3 py-1.5 text-xs border-b border-slate-800/50 last:border-0 ${i === active ? 'bg-emerald-600/30 text-white' : 'hover:bg-slate-800 text-slate-300'}`}>
                <span className="block truncate">
                  <span className={`mr-1.5 px-1 py-0.5 rounded text-[9px] font-bold align-middle ${x.kind === 'prev' ? 'bg-amber-500/20 text-amber-300' : x.section === 'aftersales' ? 'bg-orange-500/20 text-orange-300' : 'bg-violet-500/20 text-violet-300'}`}>{x.kind === 'prev' ? 'PREV' : x.section === 'aftersales' ? 'SVC' : 'LIB'}</span>
                  {x.description}
                </span>
                <span className="block text-[10px] text-slate-500 truncate">
                  {[x.unit, x.price != null ? `Rp${fmtInt(x.price)}` : '', x.kind === 'prev' && x.count > 1 ? `used ${x.count}×` : ''].filter(Boolean).join(' · ')}
                </span>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
