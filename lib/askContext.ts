/**
 * Ask ICAPROC — what the assistant is allowed to read, and the buy-side
 * context it is given, built from the BASE tables.
 *
 * Until 2026-10-02 `app/api/ask/route.ts` read nine database views. Four no
 * longer existed (`v_analytics_master`, `mv_component_analytics`,
 * `v_supplier_performance`, `v_purchase_history_analytics`), two were filtered
 * on columns they do not have (`v_payment_tracking`, `v_landed_cost_summary`
 * by model/component) and one had been redefined as a per-supplier aggregate
 * (`v_quote_history_analytics`). PostgREST answers those with an error the
 * route never read, so a question with a keyword reached the model with seven
 * of ten sources EMPTY and the model reported "no data". Purchase lines,
 * component cost statistics and supplier performance are now computed here,
 * from `5.0`/`5.1`/`6.0`, with the app's own True Unit Cost engine
 * (`computeTUCMap`) — not a second formula.
 */
import { ROLE_PERMISSIONS, type UserRole } from '../constants/roles.ts';
import { canOpenPath } from '../constants/navigation.ts';
import type { TUCResult } from './computeTUC.ts';

/**
 * The route uses the service-role key, so it must apply the screen's gate
 * itself — the same rule the menu uses for /ask (buy side). An unknown role
 * is refused; `canOpenPath(null, …)` is permissive (a page still loading its
 * profile), which is right for a screen and wrong for a server.
 */
export function askAllowed(role: string | null | undefined): boolean {
  const perms = role ? ROLE_PERMISSIONS[role as UserRole] : undefined;
  return !!perms && canOpenPath(perms, '/ask');
}

const STOP_WORDS = new Set(['show', 'me', 'the', 'last', 'compare', 'price', 'prices', 'history', 'for', 'of', 'trend', 'cost', 'costs', 'unit', 'true', 'and', 'qty', 'quote', 'quotes', 'po', 'pos', 'is', 'what', 'are', 'icl', 'isl', 'mbs', 'by', 'with', 'from', 'to', 'in', 'on', 'how', 'much', 'did', 'we', 'pay', 'paid', 'buy', 'bought', 'a', 'an', 'our', 'which', 'who', 'when', 'all']);

/** Words of the question worth searching on: lowercased, no stop words, no punctuation. */
export function askKeywords(query: string): string[] {
  return [...new Set(query.toLowerCase()
    .split(/[\s,;:!?()"'`]+/)
    .map((w) => w.replace(/^[^a-z0-9]+|[^a-z0-9]+$/g, ''))
    .filter((w) => w.length > 1 && !STOP_WORDS.has(w)))];
}

/** Statuses that are a real purchase. A Draft is a scratchpad, a Replaced PO is history. */
export const LIVE_PO_STATUSES = new Set(['Confirmed', 'Partially Received', 'Fully Received']);

export interface AskPo {
  po_id: string; po_number: string | null; po_date: string | null; status: string;
  quote_id?: string | null;
  currency: string | null; exchange_rate: number | null; total_value: number | null;
  supplier_id: string | null; company_id: string | null;
  estimated_delivery_date: string | null; actual_received_date: string | null;
}
export interface AskLine {
  po_id: string; component_id: string | null; supplier_description: string | null;
  quantity: number; unit_cost: number; currency: string | null;
}
export interface AskComponent {
  component_id: string; internal_description: string | null; supplier_model: string | null;
  brand: string | null; category: string | null;
}

/**
 * 31 of 93 live POs (2026-10-02) carry no supplier_id / company_id of their
 * own; 29 of those name both on the supplier quote they came from — the join
 * `v_landed_cost_summary` already makes. Read-side only: nothing is written.
 */
export function withQuoteParties(pos: AskPo[], quotes: { quote_id: string; supplier_id: string | null; company_id: string | null }[]): AskPo[] {
  const byId = new Map(quotes.map((q) => [q.quote_id, q]));
  return pos.map((p) => {
    const q = p.quote_id ? byId.get(p.quote_id) : undefined;
    return q ? { ...p, supplier_id: p.supplier_id ?? q.supplier_id, company_id: p.company_id ?? q.company_id } : p;
  });
}

/** "PT Indodaya Surya Lestari" → "ISL": the codes the team already says out loud. */
export function companyCode(legalName: string | null | undefined): string {
  const words = String(legalName ?? '').replace(/^(PT|CV)\.?\s+/i, '').split(/\s+/).filter(Boolean);
  return words.map((w) => w[0]!.toUpperCase()).join('') || '?';
}

const hay = (...parts: (string | null | undefined)[]) => parts.filter(Boolean).join(' ').toLowerCase();

/**
 * The components the question is about: those matching the MOST keywords, so
 * "epever xtra3210n" is the one model rather than every EPEVER item.
 */
export function matchComponents(comps: AskComponent[], keywords: string[]): AskComponent[] {
  if (!keywords.length) return [];
  let best = 0;
  const scored: { c: AskComponent; s: number }[] = [];
  for (const c of comps) {
    const h = hay(c.internal_description, c.supplier_model, c.brand, c.category);
    const s = keywords.filter((k) => h.includes(k)).length;
    if (s > 0) { scored.push({ c, s }); if (s > best) best = s; }
  }
  return scored.filter((x) => x.s === best).map((x) => x.c);
}

export function matchSuppliers(suppliers: Map<string, string>, keywords: string[]): Set<string> {
  const out = new Set<string>();
  for (const [id, name] of suppliers) {
    const n = name.toLowerCase();
    if (keywords.some((k) => n.includes(k))) out.add(id);
  }
  return out;
}

/** PO amount in IDR at the PO's own rate (IDR passes through). Null when no rate is known. */
export function toIdr(amount: number, po: Pick<AskPo, 'currency' | 'exchange_rate'>): number | null {
  if (!po.currency || po.currency === 'IDR') return amount;
  const r = Number(po.exchange_rate);
  return r > 0 ? amount * r : null;
}

const daysBetween = (a: string, b: string) => Math.round((Date.parse(b) - Date.parse(a)) / 86_400_000);
const n0 = (v: number) => Math.round(v).toLocaleString('en-US');

export interface SupplierPerf {
  supplier: string; orders: number; spendIdr: number; avgOrderIdr: number;
  lastOrder: string; avgDelayDays: number | null; delaySamples: number;
}

/** One row per supplier over LIVE POs: orders, IDR spend, last order, average delay vs. the promised date. */
export function supplierPerformance(pos: AskPo[], suppliers: Map<string, string>): SupplierPerf[] {
  const acc = new Map<string, { orders: number; spend: number; last: string; delay: number; n: number }>();
  for (const p of pos) {
    if (!LIVE_PO_STATUSES.has(p.status) || !p.supplier_id) continue;
    const a = acc.get(p.supplier_id) ?? { orders: 0, spend: 0, last: '', delay: 0, n: 0 };
    a.orders += 1;
    a.spend += toIdr(Number(p.total_value) || 0, p) ?? 0;
    if ((p.po_date ?? '') > a.last) a.last = p.po_date ?? '';
    if (p.estimated_delivery_date && p.actual_received_date) {
      a.delay += daysBetween(p.estimated_delivery_date, p.actual_received_date);
      a.n += 1;
    }
    acc.set(p.supplier_id, a);
  }
  return [...acc].map(([id, a]) => ({
    supplier: suppliers.get(id) ?? 'Unknown supplier',
    orders: a.orders,
    spendIdr: a.spend,
    avgOrderIdr: a.orders ? a.spend / a.orders : 0,
    lastOrder: a.last,
    avgDelayDays: a.n ? a.delay / a.n : null,
    delaySamples: a.n,
  })).sort((x, y) => y.spendIdr - x.spendIdr);
}

export function formatSupplierPerf(rows: SupplierPerf[]): string {
  return rows.map((r) =>
    `[SUPPLIER] ${r.supplier}: Orders: ${r.orders}, Total Spend: Rp${n0(r.spendIdr)}, Avg Order: Rp${n0(r.avgOrderIdr)}, ` +
    `Last Order: ${r.lastOrder || 'N/A'}, Avg Delay vs promised date: ${r.avgDelayDays == null ? 'N/A' : `${r.avgDelayDays.toFixed(1)} days (${r.delaySamples} POs)`}`,
  ).join('\n');
}

export interface PoLineRow {
  date: string; poNumber: string; status: string; supplier: string; company: string;
  sku: string; item: string; qty: number; unitCost: number; currency: string;
  unitCostIdr: number | null; tucIdr: number | null;
}

/**
 * Purchase lines on LIVE POs, newest first. With a question that names
 * something, only lines of the matching components or suppliers; without one,
 * the latest lines overall. `tucIdr` is that PO's True Unit Cost for the line
 * (settled POs only — the TUC engine's rule), so "what did we really pay" has
 * an answer with freight, duty and fees in it.
 */
export function purchaseLines(opts: {
  pos: AskPo[]; lines: AskLine[]; comps: Map<string, AskComponent>;
  suppliers: Map<string, string>; companies: Map<string, string>;
  tuc: Map<string, TUCResult>;
  componentIds: Set<string> | null; supplierIds: Set<string> | null; limit: number;
}): PoLineRow[] {
  const poById = new Map(opts.pos.map((p) => [p.po_id, p]));
  const out: PoLineRow[] = [];
  for (const l of opts.lines) {
    const po = poById.get(l.po_id);
    if (!po || !LIVE_PO_STATUSES.has(po.status)) continue;
    const filtered = opts.componentIds || opts.supplierIds;
    if (filtered) {
      const byComp = !!l.component_id && !!opts.componentIds?.has(l.component_id);
      const bySupp = !!po.supplier_id && !!opts.supplierIds?.has(po.supplier_id);
      if (!byComp && !bySupp) continue;
    }
    const c = l.component_id ? opts.comps.get(l.component_id) : undefined;
    const tucEntry = l.component_id
      ? opts.tuc.get(l.component_id)?.entries.find((e) => e.label === (po.po_number || `PO ${po.po_id}`))
      : undefined;
    out.push({
      date: po.po_date ?? '',
      poNumber: po.po_number ?? '',
      status: po.status,
      supplier: (po.supplier_id && opts.suppliers.get(po.supplier_id)) || 'N/A',
      company: (po.company_id && opts.companies.get(po.company_id)) || '?',
      sku: c?.supplier_model || 'N/A',
      item: c?.internal_description || l.supplier_description || 'N/A',
      qty: Number(l.quantity) || 0,
      unitCost: Number(l.unit_cost) || 0,
      currency: l.currency || po.currency || 'IDR',
      unitCostIdr: toIdr(Number(l.unit_cost) || 0, po),
      tucIdr: tucEntry ? tucEntry.unitCost : null,
    });
  }
  return out.sort((a, b) => b.date.localeCompare(a.date) || b.poNumber.localeCompare(a.poNumber)).slice(0, opts.limit);
}

export function formatPoLines(rows: PoLineRow[]): string {
  return rows.map((r) =>
    `[PO LINE] Date: ${r.date}, PO#: ${r.poNumber} (${r.status}), Company: ${r.company}, Supplier: ${r.supplier}, ` +
    `SKU: ${r.sku}, Item: ${r.item.slice(0, 60)}, Qty: ${r.qty}, Unit Cost: ${r.unitCost} ${r.currency}` +
    `${r.currency !== 'IDR' && r.unitCostIdr != null ? ` (Rp${n0(r.unitCostIdr)} at the PO rate)` : ''}` +
    `, True Unit Cost: ${r.tucIdr != null ? `Rp${n0(r.tucIdr)}` : 'not settled yet'}`,
  ).join('\n');
}

/** Per matched component: the canonical TUC plus the raw purchase price range and who bought it. */
export function componentStats(opts: {
  componentIds: string[]; pos: AskPo[]; lines: AskLine[]; comps: Map<string, AskComponent>;
  companies: Map<string, string>; tuc: Map<string, TUCResult>; limit: number;
}): string {
  const poById = new Map(opts.pos.map((p) => [p.po_id, p]));
  const rows: { line: string; n: number }[] = [];
  for (const id of opts.componentIds) {
    const c = opts.comps.get(id);
    const prices: number[] = [];
    const poIds = new Set<string>();
    const byCompany = new Map<string, number>();
    for (const l of opts.lines) {
      if (l.component_id !== id) continue;
      const po = poById.get(l.po_id);
      if (!po || !LIVE_PO_STATUSES.has(po.status)) continue;
      const idr = toIdr(Number(l.unit_cost) || 0, po);
      if (idr != null && idr > 0) prices.push(idr);
      if (!poIds.has(po.po_id)) {
        poIds.add(po.po_id);
        const code = (po.company_id && opts.companies.get(po.company_id)) || '?';
        byCompany.set(code, (byCompany.get(code) ?? 0) + 1);
      }
    }
    if (!poIds.size) continue;
    const t = opts.tuc.get(id);
    const split = [...byCompany].map(([k, v]) => `${k}=${v}`).join(', ');
    rows.push({
      n: poIds.size,
      line: `[STATS] ${c?.supplier_model || 'N/A'} — ${(c?.internal_description || '').slice(0, 60)}: ` +
        `POs: ${poIds.size} (${split}), Purchase price at PO rate: min Rp${n0(Math.min(...prices))}, max Rp${n0(Math.max(...prices))}, ` +
        (t
          ? `True Unit Cost (headline = max of latest and average): Rp${n0(t.tuc)}, latest Rp${n0(t.latestTuc)} on ${t.latestPoDate}, average Rp${n0(t.avgTuc)} over ${t.poCount} settled POs`
          : 'True Unit Cost: none yet (no settled PO)'),
    });
  }
  return rows.sort((a, b) => b.n - a.n).slice(0, opts.limit).map((r) => r.line).join('\n');
}
