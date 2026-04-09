/**
 * buildDealGroups
 *
 * Groups quotes and POs into unified "deal" records keyed by PI number.
 *
 * Key hierarchy per record:
 *   1. normPi(pi_number)          — shared across quote + PO
 *   2. `q-{quote_id}`             — quote with no PI#; PO linked via quote_id falls here too
 *   3. `po-{po_id}`               — PO with no PI# and no quote link
 *
 * PI numbers are normalised (trim + uppercase) before keying so that minor
 * formatting differences don't split the same deal into two groups.
 */

import type { PriceQuote, PurchaseOrder, Supplier, Company, POCost } from '@/types/database';
import { PRINCIPAL_CATS } from '@/constants/costCategories';

// ── Types ─────────────────────────────────────────────────────────────────────

export interface DealGroup {
  key: string;
  piNumber: string | null;       // display value (original casing)
  supplierId: string | null;
  supplier: Supplier | null;
  company: Company | null;
  quotes: PriceQuote[];
  pos: PurchaseOrder[];
  latestDate: string;            // max(quote_date, po_date) for sorting
  // derived
  quoteStatus: string | null;    // status of most recent quote
  poStatus: string | null;       // status of most recent PO
  totalIdr: number;              // committed (PO rate × total_value), excluding Replaced/Cancelled POs
  paidIdr: number;               // actual IDR paid (at payment rates)
  outstandingIdr: number;        // 0 when foreign obligation is met, even if paidIdr ≠ totalIdr
  fxVarianceIdr: number;         // paidIdr − totalIdr when obligation met (neg = gain, pos = loss)
  totalForeignCurrency: string | null; // non-IDR currency if all active POs share one currency
  totalForeignAmount: number;          // sum of total_value in that foreign currency
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function normPi(pi?: string | null): string | null {
  if (!pi?.trim()) return null;
  return pi.trim().toUpperCase();
}

function poTotalIdr(po: PurchaseOrder): number {
  const val = Number(po.total_value) || 0;
  if (po.currency === 'IDR') return val;
  return val * (Number(po.exchange_rate) || 1);
}

function costToIdr(cost: POCost, po: PurchaseOrder): number {
  if (cost.currency === 'IDR') return Number(cost.amount) || 0;
  // Prefer cost-level rate (actual bank rate on payment date) over PO rate
  const rate = Number(cost.exchange_rate) || Number(po.exchange_rate) || 1;
  return (Number(cost.amount) || 0) * rate;
}

// ── Main ──────────────────────────────────────────────────────────────────────

export function buildDealGroups(
  quotes: PriceQuote[],
  pos: PurchaseOrder[],
  suppliers: Supplier[],
  companies: Company[],
  poCosts: POCost[],
): DealGroup[] {
  const supplierMap: Record<number, Supplier> = {};
  for (const s of suppliers) supplierMap[s.supplier_id] = s;
  const companyMap: Record<number, Company> = {};
  for (const c of companies) companyMap[c.company_id] = c;

  // quote_id → group key (built during quote pass, used in PO pass)
  const quoteIdToKey: Record<string, string> = {};

  const map: Record<string, DealGroup> = {};

  const getOrCreate = (key: string): DealGroup => {
    if (!map[key]) {
      map[key] = {
        key,
        piNumber: null,
        supplierId: null,
        supplier: null,
        company: null,
        quotes: [],
        pos: [],
        latestDate: '',
        quoteStatus: null,
        poStatus: null,
        totalIdr: 0,
        paidIdr: 0,
        outstandingIdr: 0,
        fxVarianceIdr: 0,
        totalForeignCurrency: null,
        totalForeignAmount: 0,
      };
    }
    return map[key];
  };

  // ── Pass 1: quotes ───────────────────────────────────────────────────────
  for (const qt of quotes) {
    const pi  = normPi(qt.pi_number);
    const key = pi || `q-${qt.quote_id}`;
    const g   = getOrCreate(key);

    g.quotes.push(qt);
    quoteIdToKey[String(qt.quote_id)] = key;

    if (!g.piNumber && pi) g.piNumber = qt.pi_number!;
    if (!g.supplierId) {
      g.supplierId = String(qt.supplier_id);
      g.supplier   = supplierMap[qt.supplier_id] ?? null;
    }
    if (!g.company) g.company = companyMap[qt.company_id] ?? null;
    if (!g.latestDate || qt.quote_date > g.latestDate) g.latestDate = qt.quote_date;
  }

  // ── Pass 2: POs ──────────────────────────────────────────────────────────
  for (const po of pos) {
    const pi = normPi(po.pi_number);

    let key: string;
    if (pi) {
      // PI# present — use it as key (merges with any quote that shares this PI#)
      key = pi;
    } else if (po.quote_id && quoteIdToKey[String(po.quote_id)]) {
      // No PI# but linked quote exists — inherit that quote's group
      key = quoteIdToKey[String(po.quote_id)];
    } else {
      // Standalone PO with no PI# and no quote link
      key = `po-${po.po_id}`;
    }

    const g = getOrCreate(key);
    g.pos.push(po);

    if (!g.piNumber && po.pi_number) g.piNumber = po.pi_number;

    // Supplier fallback: resolve via PO's linked quote
    if (!g.supplierId && po.quote_id) {
      const qt = quotes.find((q) => String(q.quote_id) === String(po.quote_id));
      if (qt) {
        g.supplierId = String(qt.supplier_id);
        g.supplier   = supplierMap[qt.supplier_id] ?? null;
        if (!g.company) g.company = companyMap[qt.company_id] ?? null;
      }
    }

    if (!g.latestDate || po.po_date > g.latestDate) g.latestDate = po.po_date;
  }

  // ── Pass 3: derived fields ───────────────────────────────────────────────
  for (const g of Object.values(map)) {
    // Quote status: most recent quote
    if (g.quotes.length > 0) {
      const newest = g.quotes.reduce((a, b) => (a.quote_date >= b.quote_date ? a : b));
      g.quoteStatus = newest.status ?? null;
    }
    // PO status: most recent PO
    if (g.pos.length > 0) {
      const newest = g.pos.reduce((a, b) => (a.po_date >= b.po_date ? a : b));
      g.poStatus = newest.status ?? null;
    }
    // Financial totals — skip Replaced/Cancelled POs (superseded obligations)
    // Track whether all active POs share a single non-IDR currency for display
    let foreignCurrencySeen: string | null = null;
    let foreignCurrencyMixed = false;

    for (const po of g.pos) {
      // Voided POs don't contribute to outstanding balance
      if (po.status === 'Replaced' || po.status === 'Cancelled') continue;

      const tIdr       = poTotalIdr(po);
      const costs      = poCosts.filter((c) => String(c.po_id) === String(po.po_id));
      const princCosts = costs.filter((c) => PRINCIPAL_CATS.has(c.cost_category) && c.cost_category !== 'overpayment_credit');
      const paidActual = princCosts.reduce((s, c) => s + costToIdr(c, po), 0);

      // Foreign obligation check: if payments are in PO currency, track via foreign units
      // (handles rate-up and rate-down equally — obligation = units, not IDR)
      const foreignPaid = po.currency !== 'IDR'
        ? princCosts.filter((c) => c.currency === po.currency).reduce((s, c) => s + Number(c.amount), 0)
        : 0;
      const hasForeignTracking = po.currency !== 'IDR' && foreignPaid > 0;
      const foreignTotal       = hasForeignTracking ? (Number(po.total_value) || 0) : 0;
      const isObligationMet    = hasForeignTracking && (foreignTotal - foreignPaid) < 0.005;

      g.totalIdr       += tIdr;
      g.paidIdr        += paidActual;
      g.outstandingIdr += isObligationMet ? 0 : Math.max(0, tIdr - paidActual);
      g.fxVarianceIdr  += isObligationMet ? (paidActual - tIdr) : 0;

      // Track original currency (only if all active POs share the same non-IDR currency)
      if (po.currency !== 'IDR' && Number(po.total_value) > 0) {
        if (!foreignCurrencySeen) {
          foreignCurrencySeen = po.currency;
        } else if (foreignCurrencySeen !== po.currency) {
          foreignCurrencyMixed = true;
        }
        if (!foreignCurrencyMixed) {
          g.totalForeignAmount += Number(po.total_value) || 0;
        }
      }
    }

    if (!foreignCurrencyMixed && foreignCurrencySeen) {
      g.totalForeignCurrency = foreignCurrencySeen;
    }
  }

  return Object.values(map).sort((a, b) => b.latestDate.localeCompare(a.latestDate));
}
