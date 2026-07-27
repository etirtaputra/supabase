/**
 * ICAPROC — bulk import / export of customers and order transactions.
 *
 * Built for the Dolibarr cutover, but deliberately not Dolibarr-shaped: the
 * column names are ICAPROC's own and the EXPORT of an entity is a valid IMPORT
 * of the same entity. That round-trip is the whole design. It means you can
 * export, fix in Excel, and re-import; it means a migration can be run twice
 * without fear; and it means the templates are always in step with the code,
 * because both come from the field list below.
 *
 * Idempotency: every row carries `external_ref` + `external_source`, and a
 * partial unique index on the pair (migrations/import_export_traceability.sql)
 * turns a re-import into an UPDATE. Rows created inside ICAPROC leave both
 * NULL and are never touched by an import.
 *
 * Dependency order — each entity needs the one before it to exist:
 *
 *     customers → contacts → orders → order_lines → invoices → receipts
 *
 * Deliberately NOT done: importing an order does not write stock movements.
 * The `30.x` ledger already holds the real receipt history, and replaying
 * historical deliveries into it would double-count against it. Imported orders
 * are DOCUMENTS — they restore the commercial record (what was sold, to whom,
 * at what price), which is what the Position and demand analyses read.
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import { csvNum, csvDate, csvBool, normalizeHeader } from './csv';

export type PortEntity = 'customers' | 'contacts' | 'orders' | 'order_lines' | 'invoices' | 'receipts';

export interface FieldSpec {
  key: string;
  label: string;
  /** Extra headers that mean this field — including the source system's own. */
  aliases?: string[];
  required?: boolean;
  hint?: string;
}

export interface EntitySpec {
  key: PortEntity;
  label: string;
  blurb: string;
  /** What must already be imported before this entity can land. */
  needs: PortEntity[];
  fields: FieldSpec[];
}

/** A problem with one row. `fatal` rows are not written; the rest are warnings. */
export interface RowIssue { row: number; field?: string; message: string; fatal: boolean }

export interface DryRun {
  entity: PortEntity;
  total: number;
  create: number;
  update: number;
  skip: number;
  issues: RowIssue[];
  /** First few resolved records, so a human can eyeball the mapping before committing. */
  sample: Record<string, unknown>[];
}

export interface CommitResult {
  created: number;
  updated: number;
  skipped: number;
  failed: number;
  issues: RowIssue[];
}

export const EXTERNAL_SOURCE = 'dolibarr';

// ── Entity definitions ──────────────────────────────────────────────────────
// `label` is the template header. `aliases` are matched after normalizeHeader,
// so "Date Commande" and "date_commande" both resolve.

export const ENTITIES: EntitySpec[] = [
  {
    key: 'customers',
    label: 'Customers',
    blurb: 'The customer master. Matched on external ref, then customer code, then name — so a second run updates rather than duplicates.',
    needs: [],
    fields: [
      { key: 'external_ref', label: 'external_ref', aliases: ['rowid', 'id', 'dolibarrid', 'refclient'], hint: "Dolibarr's own id. Blank = matched on code/name instead." },
      { key: 'customer_code', label: 'customer_code', aliases: ['code', 'codeclient', 'customercode'] },
      { key: 'display_name', label: 'display_name', aliases: ['name', 'nom', 'displayname', 'namealias'], required: true },
      { key: 'legal_name', label: 'legal_name', aliases: ['legalname', 'nomurl', 'fullname'] },
      { key: 'tier', label: 'tier', aliases: ['pricetier', 'pricelevel'] },
      { key: 'payment_terms', label: 'payment_terms', aliases: ['paymentterms', 'condreglement', 'terms'] },
      { key: 'default_currency', label: 'default_currency', aliases: ['currency', 'multicurrencycode'] },
      { key: 'tax_id', label: 'tax_id', aliases: ['taxid', 'npwp', 'tvaintra', 'idprof1'] },
      { key: 'billing_address', label: 'billing_address', aliases: ['address', 'billingaddress', 'adresse'] },
      { key: 'shipping_address', label: 'shipping_address', aliases: ['shippingaddress', 'deliveryaddress'] },
      { key: 'notes', label: 'notes', aliases: ['note', 'notepublic', 'noteprivate'] },
      { key: 'is_active', label: 'active', aliases: ['isactive', 'status', 'aktif'] },
      { key: 'account_manager_email', label: 'account_manager_email', aliases: ['accountmanager', 'salesrep', 'salesrepemail'] },
      { key: 'contact_name', label: 'contact_name', aliases: ['contact', 'primarycontact', 'contactname'] },
      { key: 'contact_email', label: 'contact_email', aliases: ['email', 'contactemail'] },
      { key: 'contact_phone', label: 'contact_phone', aliases: ['phone', 'contactphone', 'tel'] },
    ],
  },
  {
    key: 'contacts',
    label: 'Contacts',
    blurb: 'Extra contacts beyond the one carried on the customer row. Attaches by customer ref, code or name.',
    needs: ['customers'],
    fields: [
      { key: 'external_ref', label: 'external_ref', aliases: ['rowid', 'id'] },
      { key: 'customer_ref', label: 'customer_ref', aliases: ['fksoc', 'customerid', 'socid'], hint: "The customer's external_ref." },
      { key: 'customer_code', label: 'customer_code', aliases: ['code', 'codeclient'] },
      { key: 'customer_name', label: 'customer_name', aliases: ['customer', 'nom', 'company'] },
      { key: 'name', label: 'name', aliases: ['contactname', 'lastname', 'fullname'], required: true },
      { key: 'title', label: 'title', aliases: ['poste', 'jobtitle', 'position'] },
      { key: 'email', label: 'email', aliases: ['contactemail'] },
      { key: 'phone', label: 'phone', aliases: ['tel', 'phonepro', 'contactphone'] },
      { key: 'is_primary', label: 'is_primary', aliases: ['primary', 'isprimary'] },
    ],
  },
  {
    key: 'orders',
    label: 'Orders (headers)',
    blurb: 'One row per sales document. Totals are taken from the file as-is, so the migrated figures match what the old system reported.',
    needs: ['customers'],
    fields: [
      { key: 'external_ref', label: 'external_ref', aliases: ['rowid', 'id', 'ref'], required: true, hint: 'Order lines, invoices and receipts all attach to this.' },
      { key: 'order_number', label: 'order_number', aliases: ['ref', 'ordernumber', 'nocommande'] },
      { key: 'quote_number', label: 'quote_number', aliases: ['quotenumber', 'refpropal', 'noquote'] },
      { key: 'invoice_number', label: 'invoice_number', aliases: ['invoicenumber', 'reffacture'] },
      { key: 'customer_ref', label: 'customer_ref', aliases: ['fksoc', 'socid', 'customerid'], hint: "The customer's external_ref." },
      { key: 'customer_code', label: 'customer_code', aliases: ['codeclient'] },
      { key: 'customer_name', label: 'customer_name', aliases: ['customer', 'nom', 'company'] },
      { key: 'status', label: 'status', aliases: ['fkstatut', 'statut', 'state'], hint: 'ICAPROC status word, or a Dolibarr numeric code.' },
      { key: 'quote_date', label: 'quote_date', aliases: ['date', 'datecommande', 'datec', 'orderdate'] },
      { key: 'ordered_at', label: 'ordered_at', aliases: ['datevalid', 'confirmedat'] },
      { key: 'delivered_at', label: 'delivered_at', aliases: ['datelivraison', 'deliverydate'] },
      { key: 'currency', label: 'currency', aliases: ['multicurrencycode'] },
      { key: 'ppn_pct', label: 'ppn_pct', aliases: ['vatpct', 'tauxtva', 'taxpct'] },
      { key: 'subtotal', label: 'subtotal', aliases: ['totalht', 'nettotal', 'dpp'] },
      { key: 'ppn_amount', label: 'ppn_amount', aliases: ['totaltva', 'vatamount', 'ppn'] },
      { key: 'grand_total', label: 'grand_total', aliases: ['totalttc', 'total', 'grandtotal'] },
      { key: 'sales_rep_email', label: 'sales_rep_email', aliases: ['salesrep', 'commercial'] },
      { key: 'notes', label: 'notes', aliases: ['note', 'notepublic'] },
    ],
  },
  {
    key: 'order_lines',
    label: 'Order lines',
    blurb: 'Line items. Matched to a catalogue item by SKU then description; an unmatched line still imports as free text and is reported so you can link it later.',
    needs: ['orders'],
    fields: [
      { key: 'order_ref', label: 'order_ref', aliases: ['fkcommande', 'orderid', 'commandeid', 'externalref'], required: true },
      { key: 'line_no', label: 'line_no', aliases: ['rang', 'sortorder', 'lineno', 'no'] },
      { key: 'sku', label: 'sku', aliases: ['productref', 'ref', 'model', 'suppliermodel', 'partnumber'] },
      { key: 'description', label: 'description', aliases: ['label', 'productlabel', 'desc', 'itemname'], required: true },
      { key: 'unit', label: 'unit', aliases: ['uom', 'satuan'] },
      { key: 'quantity', label: 'quantity', aliases: ['qty', 'jumlah'], required: true },
      { key: 'unit_price', label: 'unit_price', aliases: ['subprice', 'price', 'harga', 'unitprice'] },
      { key: 'line_total', label: 'line_total', aliases: ['totalht', 'amount', 'linetotal'] },
      { key: 'is_section', label: 'is_section', aliases: ['section', 'issection'] },
      { key: 'brand', label: 'brand', aliases: ['merk'] },
      { key: 'lead_time', label: 'lead_time', aliases: ['leadtime'] },
      { key: 'note', label: 'note', aliases: ['description2', 'comment'] },
    ],
  },
  {
    key: 'invoices',
    label: 'Invoices',
    blurb: 'Sales invoices against an imported order. Set copy_lines=yes to bill the whole order — the lines are copied at their order prices, which is what makes invoiced quantity visible to Position.',
    needs: ['orders'],
    fields: [
      { key: 'external_ref', label: 'external_ref', aliases: ['rowid', 'id'], required: true },
      { key: 'order_ref', label: 'order_ref', aliases: ['fkcommande', 'orderid', 'sourceref'], required: true },
      { key: 'invoice_number', label: 'invoice_number', aliases: ['ref', 'facture', 'noinvoice'] },
      { key: 'issued_at', label: 'issued_at', aliases: ['datef', 'date', 'invoicedate', 'issuedate'] },
      { key: 'due_date', label: 'due_date', aliases: ['datelim', 'duedate', 'jatuhtempo'] },
      { key: 'subtotal', label: 'subtotal', aliases: ['totalht', 'dpp'] },
      { key: 'ppn_pct', label: 'ppn_pct', aliases: ['vatpct', 'tauxtva'] },
      { key: 'ppn_amount', label: 'ppn_amount', aliases: ['totaltva', 'ppn'] },
      { key: 'grand_total', label: 'grand_total', aliases: ['totalttc', 'total'] },
      { key: 'copy_lines', label: 'copy_lines', aliases: ['copylines', 'fulllines', 'linesfromorder'], hint: 'yes = copy the order lines onto this invoice.' },
      { key: 'notes', label: 'notes', aliases: ['note'] },
    ],
  },
  {
    key: 'receipts',
    label: 'Receipts (customer payments)',
    blurb: 'Money received against an imported order, and optionally against one of its invoices.',
    needs: ['orders'],
    fields: [
      { key: 'external_ref', label: 'external_ref', aliases: ['rowid', 'id'], required: true },
      { key: 'order_ref', label: 'order_ref', aliases: ['fkcommande', 'orderid'], required: true },
      { key: 'invoice_ref', label: 'invoice_ref', aliases: ['fkfacture', 'invoiceid'] },
      { key: 'receipt_number', label: 'receipt_number', aliases: ['ref', 'num', 'noreceipt'] },
      { key: 'amount', label: 'amount', aliases: ['montant', 'jumlah', 'paid'], required: true },
      { key: 'payment_date', label: 'payment_date', aliases: ['datep', 'date', 'paymentdate', 'tanggal'] },
      { key: 'payment_method', label: 'payment_method', aliases: ['method', 'modepaiement', 'cara'] },
      { key: 'category', label: 'category', aliases: ['type', 'kind'] },
      { key: 'bank_ref', label: 'bank_ref', aliases: ['numpaiement', 'bankref', 'reference'] },
      { key: 'notes', label: 'notes', aliases: ['note'] },
    ],
  },
];

export const entitySpec = (k: PortEntity): EntitySpec => ENTITIES.find((e) => e.key === k) ?? ENTITIES[0];

/** Import order — a file list is always run in this sequence. */
export const IMPORT_ORDER: PortEntity[] = ['customers', 'contacts', 'orders', 'order_lines', 'invoices', 'receipts'];

// ── Header mapping ──────────────────────────────────────────────────────────

/**
 * Guess which field each CSV header feeds. Exact label wins, then alias, then
 * a normalized-equality fallback. Anything unmatched is returned so the UI can
 * ask rather than silently dropping a column.
 */
export function autoMap(headers: string[], spec: EntitySpec): { map: Record<string, string>; unmatched: string[] } {
  const byNorm = new Map<string, string>();
  for (const f of spec.fields) {
    byNorm.set(normalizeHeader(f.label), f.key);
    byNorm.set(normalizeHeader(f.key), f.key);
    for (const a of f.aliases ?? []) byNorm.set(normalizeHeader(a), f.key);
  }
  const map: Record<string, string> = {};
  const unmatched: string[] = [];
  const taken = new Set<string>();
  for (const h of headers) {
    const key = byNorm.get(normalizeHeader(h));
    // First header to claim a field wins — a later 'ref' cannot steal order_number
    if (key && !taken.has(key)) { map[h] = key; taken.add(key); }
    else if (h) unmatched.push(h);
  }
  return { map, unmatched };
}

/** Apply a header→field map to raw parsed rows (which are keyed by normalized header). */
export function applyMap(rows: Record<string, string>[], headers: string[], map: Record<string, string>): Record<string, string>[] {
  const pairs = headers.map((h) => [normalizeHeader(h), map[h]] as const).filter(([, k]) => !!k);
  return rows.map((r) => {
    const out: Record<string, string> = {};
    for (const [norm, key] of pairs) if (r[norm] !== undefined) out[key] = r[norm];
    return out;
  });
}

// ── Status mapping ──────────────────────────────────────────────────────────

const ICAPROC_STATUSES = new Set([
  'draft', 'validated', 'sent', 'accepted', 'ordered', 'invoiced', 'preparing', 'delivered', 'cancelled', 'rejected',
]);

/**
 * Accept an ICAPROC status word, an obvious synonym, or a Dolibarr numeric
 * code. Dolibarr commande: -1 cancelled · 0 draft · 1 validated (a confirmed
 * order) · 2 in progress · 3 delivered. Anything unrecognised falls to 'draft'
 * and is reported, never guessed into a committed status — a wrong 'ordered'
 * would reserve stock that was never actually sold.
 */
export function mapStatus(raw: string | undefined): { status: string; guessed: boolean } {
  const s = (raw ?? '').trim().toLowerCase();
  if (!s) return { status: 'draft', guessed: false };
  if (ICAPROC_STATUSES.has(s)) return { status: s, guessed: false };
  const synonyms: Record<string, string> = {
    open: 'sent', signed: 'accepted', notsigned: 'rejected', closed: 'delivered',
    billed: 'invoiced', paid: 'invoiced', shipped: 'delivered', canceled: 'cancelled',
    confirmed: 'ordered', order: 'ordered', quotation: 'draft', proposal: 'draft',
  };
  const syn = synonyms[s.replace(/[^a-z]/g, '')];
  if (syn) return { status: syn, guessed: false };
  const numeric: Record<string, string> = {
    '-1': 'cancelled', '0': 'draft', '1': 'ordered', '2': 'preparing', '3': 'delivered', '4': 'invoiced',
  };
  if (numeric[s]) return { status: numeric[s], guessed: true };
  return { status: 'draft', guessed: true };
}

// ── Lookups ─────────────────────────────────────────────────────────────────

export interface Lookups {
  customerByExternal: Map<string, string>;
  customerByCode: Map<string, string>;
  customerByName: Map<string, string>;
  contactByExternal: Map<string, string>;
  orderByExternal: Map<string, string>;
  orderItemsByOrder: Map<string, { item_id: string; description: string; line_no: number; qty: number; unit_price: number; unit: string | null }[]>;
  invoiceByExternal: Map<string, string>;
  receiptByExternal: Map<string, string>;
  componentBySku: Map<string, string>;
  componentByDesc: Map<string, string>;
  userByEmail: Map<string, string>;
  tierCodes: Set<string>;
}

const lower = (s: string | null | undefined) => (s ?? '').trim().toLowerCase();

export async function loadLookups(supabase: SupabaseClient): Promise<Lookups> {
  const page = async <T,>(table: string, cols: string): Promise<T[]> => {
    const out: T[] = [];
    for (let from = 0; ; from += 1000) {
      const { data, error } = await supabase.from(table).select(cols).range(from, from + 999);
      if (error || !data || !data.length) break;
      out.push(...(data as T[]));
      if (data.length < 1000) break;
    }
    return out;
  };

  const [custs, contacts, orders, items, invs, rcpts, comps, users, tiers] = await Promise.all([
    page<{ customer_id: string; customer_code: string; display_name: string; legal_name: string; external_ref: string | null }>('20.0_customers', 'customer_id, customer_code, display_name, legal_name, external_ref'),
    page<{ contact_id: string; external_ref: string | null }>('20.1_customer_contacts', 'contact_id, external_ref'),
    page<{ quote_id: string; external_ref: string | null }>('22.0_sales_quotes', 'quote_id, external_ref'),
    page<{ item_id: string; quote_id: string; description: string; sort_order: number; quantity: number; unit_price: number; unit: string | null }>('22.1_sales_quote_items', 'item_id, quote_id, description, sort_order, quantity, unit_price, unit'),
    page<{ invoice_id: string; external_ref: string | null }>('25.0_sales_invoices', 'invoice_id, external_ref'),
    page<{ receipt_id: string; external_ref: string | null }>('26.0_customer_receipts', 'receipt_id, external_ref'),
    page<{ component_id: string; supplier_model: string | null; internal_description: string | null }>('3.0_components', 'component_id, supplier_model, internal_description'),
    page<{ id: string; email: string }>('user_profiles', 'id, email'),
    page<{ tier_code: string }>('21.0_price_tiers', 'tier_code'),
  ]);

  const orderItemsByOrder = new Map<string, Lookups['orderItemsByOrder'] extends Map<string, infer V> ? V : never>();
  for (const i of items) {
    const arr = orderItemsByOrder.get(i.quote_id) ?? [];
    arr.push({ item_id: i.item_id, description: i.description ?? '', line_no: Number(i.sort_order) || 0, qty: Number(i.quantity) || 0, unit_price: Number(i.unit_price) || 0, unit: i.unit });
    orderItemsByOrder.set(i.quote_id, arr);
  }

  const customerByName = new Map<string, string>();
  for (const c of custs) {
    if (c.display_name) customerByName.set(lower(c.display_name), c.customer_id);
    if (c.legal_name) customerByName.set(lower(c.legal_name), c.customer_id);
  }
  const componentByDesc = new Map<string, string>();
  const componentBySku = new Map<string, string>();
  for (const c of comps) {
    if (c.supplier_model) componentBySku.set(lower(c.supplier_model), c.component_id);
    if (c.internal_description) componentByDesc.set(lower(c.internal_description), c.component_id);
  }

  return {
    customerByExternal: new Map(custs.filter((c) => c.external_ref).map((c) => [lower(c.external_ref), c.customer_id])),
    customerByCode: new Map(custs.filter((c) => c.customer_code).map((c) => [lower(c.customer_code), c.customer_id])),
    customerByName,
    contactByExternal: new Map(contacts.filter((c) => c.external_ref).map((c) => [lower(c.external_ref), c.contact_id])),
    orderByExternal: new Map(orders.filter((o) => o.external_ref).map((o) => [lower(o.external_ref), o.quote_id])),
    orderItemsByOrder,
    invoiceByExternal: new Map(invs.filter((i) => i.external_ref).map((i) => [lower(i.external_ref), i.invoice_id])),
    receiptByExternal: new Map(rcpts.filter((r) => r.external_ref).map((r) => [lower(r.external_ref), r.receipt_id])),
    componentBySku,
    componentByDesc,
    userByEmail: new Map(users.filter((u) => u.email).map((u) => [lower(u.email), u.id])),
    tierCodes: new Set(tiers.map((t) => t.tier_code)),
  };
}

// ── Resolution: rows → database payloads ────────────────────────────────────

export interface Resolved {
  /** Existing row id when this is an update. */
  id: string | null;
  payload: Record<string, unknown>;
  /** Extra work the committer must do after the main row lands. */
  extra?: Record<string, unknown>;
  issues: RowIssue[];
  skip: boolean;
}

const req = (v: string | undefined) => (v ?? '').trim();
const orNull = (v: string | undefined) => { const s = (v ?? '').trim(); return s === '' ? null : s; };

function resolveCustomerId(r: Record<string, string>, L: Lookups): string | null {
  const byRef = req(r.customer_ref) && L.customerByExternal.get(lower(r.customer_ref));
  if (byRef) return byRef;
  const byCode = req(r.customer_code) && L.customerByCode.get(lower(r.customer_code));
  if (byCode) return byCode;
  const byName = req(r.customer_name) && L.customerByName.get(lower(r.customer_name));
  return byName || null;
}

export function resolveRows(entity: PortEntity, rows: Record<string, string>[], L: Lookups): Resolved[] {
  return rows.map((r, i) => {
    const n = i + 2;                       // +2: 1-based, and the header is row 1
    const issues: RowIssue[] = [];
    const bad = (message: string, field?: string) => { issues.push({ row: n, field, message, fatal: true }); };
    const warn = (message: string, field?: string) => { issues.push({ row: n, field, message, fatal: false }); };
    const ref = orNull(r.external_ref);

    switch (entity) {
      case 'customers': {
        const name = req(r.display_name);
        if (!name) { bad('display_name is empty', 'display_name'); return { id: null, payload: {}, issues, skip: true }; }
        const id = (ref && L.customerByExternal.get(lower(ref)))
          || (req(r.customer_code) && L.customerByCode.get(lower(r.customer_code)))
          || L.customerByName.get(lower(name)) || null;
        const tier = orNull(r.tier);
        if (tier && !L.tierCodes.has(tier)) warn(`tier "${tier}" is not a configured price tier — imported as-is`, 'tier');
        const am = orNull(r.account_manager_email);
        const amId = am ? L.userByEmail.get(lower(am)) ?? null : null;
        if (am && !amId) warn(`no ICAPROC user with email ${am} — account manager left unset`, 'account_manager_email');

        const payload: Record<string, unknown> = {
          customer_code: req(r.customer_code) || undefined,
          display_name: name,
          legal_name: req(r.legal_name) || name,
          tier: tier ?? undefined,
          payment_terms: orNull(r.payment_terms) ?? undefined,
          default_currency: (orNull(r.default_currency) ?? '').toUpperCase() || undefined,
          tax_id: orNull(r.tax_id) ?? undefined,
          billing_address: orNull(r.billing_address) ?? undefined,
          shipping_address: orNull(r.shipping_address) ?? undefined,
          notes: orNull(r.notes) ?? undefined,
          is_active: r.is_active !== undefined ? csvBool(r.is_active, true) : undefined,
          account_manager_id: amId ?? undefined,
          external_ref: ref ?? undefined,
          external_source: ref ? EXTERNAL_SOURCE : undefined,
        };
        const contact = req(r.contact_name) || req(r.contact_email) || req(r.contact_phone)
          ? { name: req(r.contact_name) || req(r.contact_email), email: orNull(r.contact_email), phone: orNull(r.contact_phone) }
          : undefined;
        return { id, payload: strip(payload), extra: contact ? { contact } : undefined, issues, skip: false };
      }

      case 'contacts': {
        const name = req(r.name);
        if (!name) { bad('name is empty', 'name'); return { id: null, payload: {}, issues, skip: true }; }
        const customerId = resolveCustomerId(r, L);
        if (!customerId) { bad('no matching customer (tried customer_ref, customer_code, customer_name)', 'customer_ref'); return { id: null, payload: {}, issues, skip: true }; }
        const id = ref ? L.contactByExternal.get(lower(ref)) ?? null : null;
        return {
          id,
          payload: strip({
            customer_id: customerId, name, title: orNull(r.title) ?? undefined,
            email: orNull(r.email) ?? undefined, phone: orNull(r.phone) ?? undefined,
            is_primary: r.is_primary !== undefined ? csvBool(r.is_primary) : undefined,
            external_ref: ref ?? undefined, external_source: ref ? EXTERNAL_SOURCE : undefined,
          }),
          issues, skip: false,
        };
      }

      case 'orders': {
        if (!ref) { bad('external_ref is empty — order lines and invoices have nothing to attach to', 'external_ref'); return { id: null, payload: {}, issues, skip: true }; }
        const customerId = resolveCustomerId(r, L);
        if (!customerId) { bad('no matching customer (tried customer_ref, customer_code, customer_name)', 'customer_ref'); return { id: null, payload: {}, issues, skip: true }; }
        const { status, guessed } = mapStatus(r.status);
        if (guessed) warn(`status "${req(r.status)}" not recognised — imported as ${status}`, 'status');

        const subtotal = csvNum(r.subtotal);
        const ppnAmt = csvNum(r.ppn_amount);
        const grand = csvNum(r.grand_total);
        if (subtotal != null && ppnAmt != null && grand != null && Math.abs(subtotal + ppnAmt - grand) > 1) {
          warn(`subtotal + PPN (${Math.round(subtotal + ppnAmt)}) does not equal grand_total (${Math.round(grand)}) — imported as given`, 'grand_total');
        }
        const rep = orNull(r.sales_rep_email);
        const repId = rep ? L.userByEmail.get(lower(rep)) ?? null : null;
        if (rep && !repId) warn(`no ICAPROC user with email ${rep} — sales rep left unset`, 'sales_rep_email');
        const date = csvDate(r.quote_date);
        if (req(r.quote_date) && !date) warn(`could not read quote_date "${r.quote_date}"`, 'quote_date');

        return {
          id: L.orderByExternal.get(lower(ref)) ?? null,
          payload: strip({
            customer_id: customerId,
            quote_number: req(r.quote_number) || req(r.order_number) || ref,
            order_number: orNull(r.order_number) ?? undefined,
            invoice_number: orNull(r.invoice_number) ?? undefined,
            status,
            quote_date: date ?? undefined,
            ordered_at: csvDate(r.ordered_at) ?? undefined,
            delivered_at: csvDate(r.delivered_at) ?? undefined,
            currency: (orNull(r.currency) ?? '').toUpperCase() || undefined,
            ppn_pct: csvNum(r.ppn_pct) ?? undefined,
            subtotal: subtotal ?? undefined,
            ppn_amount: ppnAmt ?? undefined,
            grand_total: grand ?? undefined,
            sales_rep_id: repId ?? undefined,
            notes: orNull(r.notes) ?? undefined,
            external_ref: ref, external_source: EXTERNAL_SOURCE,
          }),
          issues, skip: false,
        };
      }

      case 'order_lines': {
        const orderRef = req(r.order_ref);
        const quoteId = orderRef ? L.orderByExternal.get(lower(orderRef)) : undefined;
        if (!quoteId) { bad(`no imported order with external_ref "${orderRef}"`, 'order_ref'); return { id: null, payload: {}, issues, skip: true }; }
        const desc = req(r.description);
        if (!desc) { bad('description is empty', 'description'); return { id: null, payload: {}, issues, skip: true }; }

        const sku = orNull(r.sku);
        const componentId = (sku && L.componentBySku.get(lower(sku)))
          || L.componentByDesc.get(lower(desc)) || null;
        if (!componentId) warn(`no catalogue item matches ${sku ? `SKU "${sku}"` : `"${desc}"`} — imported as a text line`, 'sku');

        const qty = csvNum(r.quantity) ?? 0;
        const price = csvNum(r.unit_price) ?? 0;
        const total = csvNum(r.line_total) ?? qty * price;
        const isSection = csvBool(r.is_section);
        if (!isSection && qty <= 0) warn('quantity is zero', 'quantity');

        return {
          id: null,   // lines are replaced per order, never matched individually
          payload: {
            quote_id: quoteId,
            component_id: componentId,
            description: desc,
            unit: orNull(r.unit),
            quantity: qty,
            unit_price: price,
            line_total: total,
            sort_order: csvNum(r.line_no) ?? i,
            is_section: isSection,
            note: orNull(r.note),
            brand: orNull(r.brand),
            lead_time: orNull(r.lead_time),
          },
          issues, skip: false,
        };
      }

      case 'invoices': {
        if (!ref) { bad('external_ref is empty', 'external_ref'); return { id: null, payload: {}, issues, skip: true }; }
        const orderRef = req(r.order_ref);
        const quoteId = orderRef ? L.orderByExternal.get(lower(orderRef)) : undefined;
        if (!quoteId) { bad(`no imported order with external_ref "${orderRef}"`, 'order_ref'); return { id: null, payload: {}, issues, skip: true }; }
        const issued = csvDate(r.issued_at);
        if (!issued) warn('issued_at is empty — an invoice with no issue date is invisible to AR ageing and to Position', 'issued_at');
        const copy = csvBool(r.copy_lines, true);
        if (copy && !L.orderItemsByOrder.get(quoteId)?.length) {
          warn('copy_lines requested but the order has no lines yet — import order_lines first, then re-run', 'copy_lines');
        }
        return {
          id: L.invoiceByExternal.get(lower(ref)) ?? null,
          payload: strip({
            quote_id: quoteId,
            invoice_number: req(r.invoice_number) || ref,
            kind: 'items',
            issued_at: issued ?? undefined,
            due_date: csvDate(r.due_date) ?? undefined,
            subtotal: csvNum(r.subtotal) ?? undefined,
            ppn_pct: csvNum(r.ppn_pct) ?? undefined,
            ppn_amount: csvNum(r.ppn_amount) ?? undefined,
            grand_total: csvNum(r.grand_total) ?? undefined,
            notes: orNull(r.notes) ?? undefined,
            external_ref: ref, external_source: EXTERNAL_SOURCE,
          }),
          extra: { copyLines: copy, quoteId },
          issues, skip: false,
        };
      }

      case 'receipts': {
        if (!ref) { bad('external_ref is empty', 'external_ref'); return { id: null, payload: {}, issues, skip: true }; }
        const orderRef = req(r.order_ref);
        const quoteId = orderRef ? L.orderByExternal.get(lower(orderRef)) : undefined;
        if (!quoteId) { bad(`no imported order with external_ref "${orderRef}"`, 'order_ref'); return { id: null, payload: {}, issues, skip: true }; }
        const amount = csvNum(r.amount);
        if (amount == null || amount === 0) { bad('amount is empty or zero', 'amount'); return { id: null, payload: {}, issues, skip: true }; }
        const invRef = orNull(r.invoice_ref);
        const invoiceId = invRef ? L.invoiceByExternal.get(lower(invRef)) ?? null : null;
        if (invRef && !invoiceId) warn(`no imported invoice with external_ref "${invRef}" — receipt attached to the order only`, 'invoice_ref');
        const paid = csvDate(r.payment_date);
        if (!paid) warn('payment_date is empty — DSO cannot use this receipt', 'payment_date');

        return {
          id: L.receiptByExternal.get(lower(ref)) ?? null,
          payload: strip({
            quote_id: quoteId,
            invoice_id: invoiceId ?? undefined,
            receipt_number: req(r.receipt_number) || ref,
            category: orNull(r.category) ?? 'balance_payment',
            amount,
            payment_date: paid ?? undefined,
            payment_method: orNull(r.payment_method) ?? undefined,
            bank_ref: orNull(r.bank_ref) ?? undefined,
            notes: orNull(r.notes) ?? undefined,
            external_ref: ref, external_source: EXTERNAL_SOURCE,
          }),
          issues, skip: false,
        };
      }
    }
  });
}

/** Drop undefined keys so an update never blanks a column the file omitted. */
function strip(o: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(o)) if (v !== undefined) out[k] = v;
  return out;
}

// ── Dry run ─────────────────────────────────────────────────────────────────

export function dryRun(entity: PortEntity, resolved: Resolved[]): DryRun {
  const issues = resolved.flatMap((r) => r.issues);
  return {
    entity,
    total: resolved.length,
    create: resolved.filter((r) => !r.skip && !r.id).length,
    update: resolved.filter((r) => !r.skip && r.id).length,
    skip: resolved.filter((r) => r.skip).length,
    issues,
    sample: resolved.filter((r) => !r.skip).slice(0, 5).map((r) => r.payload),
  };
}

// ── Commit ──────────────────────────────────────────────────────────────────

const TABLE: Record<PortEntity, string> = {
  customers: '20.0_customers',
  contacts: '20.1_customer_contacts',
  orders: '22.0_sales_quotes',
  order_lines: '22.1_sales_quote_items',
  invoices: '25.0_sales_invoices',
  receipts: '26.0_customer_receipts',
};
const PK: Record<PortEntity, string> = {
  customers: 'customer_id', contacts: 'contact_id', orders: 'quote_id',
  order_lines: 'item_id', invoices: 'invoice_id', receipts: 'receipt_id',
};

/**
 * Write one entity. Rows are handled individually rather than in one bulk
 * upsert: a migration where 998 good rows are lost to 2 bad ones is worse than
 * a slower one that tells you exactly which 2 failed.
 */
export async function commit(
  supabase: SupabaseClient,
  entity: PortEntity,
  resolved: Resolved[],
  onProgress?: (done: number, total: number) => void,
): Promise<CommitResult> {
  const res: CommitResult = { created: 0, updated: 0, skipped: 0, failed: 0, issues: [] };
  const table = TABLE[entity];
  const pk = PK[entity];
  const live = resolved.filter((r) => !r.skip);
  res.skipped = resolved.length - live.length;

  // Order lines are a full replacement per order: re-importing a corrected
  // file must not leave the previous run's lines behind.
  if (entity === 'order_lines') {
    const byOrder = new Map<string, Resolved[]>();
    for (const r of live) {
      const q = String(r.payload.quote_id);
      byOrder.set(q, [...(byOrder.get(q) ?? []), r]);
    }
    let done = 0;
    for (const [quoteId, lines] of byOrder) {
      const { error: delErr } = await supabase.from(table).delete().eq('quote_id', quoteId);
      if (delErr) { res.failed += lines.length; res.issues.push({ row: 0, message: `could not clear existing lines for order ${quoteId}: ${delErr.message}`, fatal: true }); continue; }
      const { error } = await supabase.from(table).insert(lines.map((l) => l.payload));
      if (error) { res.failed += lines.length; res.issues.push({ row: 0, message: `order ${quoteId}: ${error.message}`, fatal: true }); }
      else res.created += lines.length;
      onProgress?.(++done, byOrder.size);
    }
    return res;
  }

  let done = 0;
  for (const r of live) {
    let insertedId: string | null = null;
    if (r.id) {
      const { error } = await supabase.from(table).update(r.payload).eq(pk, r.id);
      if (error) { res.failed++; res.issues.push({ row: 0, message: error.message, fatal: true }); }
      else res.updated++;
    } else {
      const { data, error } = await supabase.from(table).insert(r.payload).select(pk).single();
      if (error) { res.failed++; res.issues.push({ row: 0, message: error.message, fatal: true }); }
      else {
        res.created++;
        const newId = (data as unknown as Record<string, string> | null)?.[pk];
        insertedId = newId ?? null;
        // A customer row may carry its primary contact inline
        if (entity === 'customers' && r.extra?.contact && newId) {
          const c = r.extra.contact as { name: string; email: string | null; phone: string | null };
          await supabase.from('20.1_customer_contacts').insert({ customer_id: newId, name: c.name, email: c.email, phone: c.phone, is_primary: true });
        }
      }
    }

    // Billing the whole order: copy its lines onto the invoice so invoiced
    // QUANTITY exists — without it the Position tab sees revenue but no units.
    if (entity === 'invoices' && r.extra?.copyLines) {
      const targetId = r.id ?? insertedId;
      if (targetId) {
        await supabase.from('25.1_sales_invoice_items').delete().eq('invoice_id', targetId);
        const src = (r.extra.orderLines ?? []) as { item_id: string; description: string; qty: number; unit_price: number; unit: string | null; line_no: number }[];
        if (src.length) {
          await supabase.from('25.1_sales_invoice_items').insert(src.map((l, idx) => ({
            invoice_id: targetId, so_item_id: l.item_id, description: l.description,
            unit: l.unit, qty: l.qty, unit_price: l.unit_price, line_total: l.qty * l.unit_price, sort_order: l.line_no || idx,
          })));
        }
      }
    }
    onProgress?.(++done, live.length);
  }
  return res;
}

/** Attach each invoice's order lines so `commit` can copy them onto the invoice. */
export function attachOrderLines(resolved: Resolved[], L: Lookups): Resolved[] {
  return resolved.map((r) => {
    if (!r.extra?.copyLines) return r;
    const quoteId = String(r.extra.quoteId ?? '');
    const lines = (L.orderItemsByOrder.get(quoteId) ?? []).filter((l) => l.qty > 0);
    return { ...r, extra: { ...r.extra, orderLines: lines } };
  });
}

// ── Export ──────────────────────────────────────────────────────────────────

export interface ExportResult { headers: string[]; rows: (string | number | null)[][] }

/**
 * Export an entity using the SAME column names the importer reads, so
 * export → edit → re-import round-trips without a mapping step.
 * `from`/`to` filter on the entity's own date; blank means everything.
 */
export async function exportEntity(
  supabase: SupabaseClient, entity: PortEntity, from?: string, to?: string,
): Promise<ExportResult> {
  const spec = entitySpec(entity);
  const headers = spec.fields.map((f) => f.label);
  const key = (k: string) => spec.fields.findIndex((f) => f.key === k);
  const blank = () => new Array<string | number | null>(headers.length).fill(null);
  const inRange = (d: string | null | undefined) => {
    const s = (d ?? '').slice(0, 10);
    if (!s) return !from && !to;
    if (from && s < from) return false;
    if (to && s > to) return false;
    return true;
  };

  const page = async <T,>(table: string, cols: string): Promise<T[]> => {
    const out: T[] = [];
    for (let f = 0; ; f += 1000) {
      const { data, error } = await supabase.from(table).select(cols).range(f, f + 999);
      if (error || !data || !data.length) break;
      out.push(...(data as T[]));
      if (data.length < 1000) break;
    }
    return out;
  };

  const rows: (string | number | null)[][] = [];
  const put = (row: (string | number | null)[], k: string, v: string | number | null | undefined) => {
    const i = key(k); if (i >= 0) row[i] = v ?? null;
  };

  if (entity === 'customers') {
    const [cs, contacts, users] = await Promise.all([
      page<Record<string, string>>('20.0_customers', '*'),
      page<Record<string, string>>('20.1_customer_contacts', 'customer_id, name, email, phone, is_primary'),
      page<{ id: string; email: string }>('user_profiles', 'id, email'),
    ]);
    const byCust = new Map<string, Record<string, string>[]>();
    for (const c of contacts) byCust.set(c.customer_id, [...(byCust.get(c.customer_id) ?? []), c]);
    const email = new Map(users.map((u) => [u.id, u.email]));
    for (const c of cs) {
      if (!inRange(c.created_at)) continue;
      const cts = byCust.get(c.customer_id) ?? [];
      const primary = cts.find((x) => String(x.is_primary) === 'true') ?? cts[0];
      const row = blank();
      put(row, 'external_ref', c.external_ref); put(row, 'customer_code', c.customer_code);
      put(row, 'display_name', c.display_name); put(row, 'legal_name', c.legal_name);
      put(row, 'tier', c.tier); put(row, 'payment_terms', c.payment_terms);
      put(row, 'default_currency', c.default_currency); put(row, 'tax_id', c.tax_id);
      put(row, 'billing_address', c.billing_address); put(row, 'shipping_address', c.shipping_address);
      put(row, 'notes', c.notes); put(row, 'is_active', String(c.is_active) === 'false' ? 'no' : 'yes');
      put(row, 'account_manager_email', email.get(c.account_manager_id) ?? '');
      put(row, 'contact_name', primary?.name); put(row, 'contact_email', primary?.email); put(row, 'contact_phone', primary?.phone);
      rows.push(row);
    }
  }

  if (entity === 'contacts') {
    const [cs, contacts] = await Promise.all([
      page<Record<string, string>>('20.0_customers', 'customer_id, customer_code, display_name, external_ref'),
      page<Record<string, string>>('20.1_customer_contacts', '*'),
    ]);
    const byId = new Map(cs.map((c) => [c.customer_id, c]));
    for (const c of contacts) {
      const cust = byId.get(c.customer_id);
      const row = blank();
      put(row, 'external_ref', c.external_ref);
      put(row, 'customer_ref', cust?.external_ref); put(row, 'customer_code', cust?.customer_code);
      put(row, 'customer_name', cust?.display_name);
      put(row, 'name', c.name); put(row, 'title', c.title); put(row, 'email', c.email); put(row, 'phone', c.phone);
      put(row, 'is_primary', String(c.is_primary) === 'true' ? 'yes' : 'no');
      rows.push(row);
    }
  }

  if (entity === 'orders') {
    const [qs, cs, users] = await Promise.all([
      page<Record<string, string>>('22.0_sales_quotes', '*'),
      page<Record<string, string>>('20.0_customers', 'customer_id, customer_code, display_name, external_ref'),
      page<{ id: string; email: string }>('user_profiles', 'id, email'),
    ]);
    const byId = new Map(cs.map((c) => [c.customer_id, c]));
    const email = new Map(users.map((u) => [u.id, u.email]));
    for (const q of qs) {
      if (!inRange(q.quote_date ?? q.created_at)) continue;
      const cust = byId.get(q.customer_id);
      const row = blank();
      put(row, 'external_ref', q.external_ref || q.quote_id);
      put(row, 'order_number', q.order_number); put(row, 'quote_number', q.quote_number);
      put(row, 'invoice_number', q.invoice_number);
      put(row, 'customer_ref', cust?.external_ref); put(row, 'customer_code', cust?.customer_code);
      put(row, 'customer_name', cust?.display_name);
      put(row, 'status', q.status); put(row, 'quote_date', q.quote_date);
      put(row, 'ordered_at', (q.ordered_at ?? '').slice(0, 10)); put(row, 'delivered_at', (q.delivered_at ?? '').slice(0, 10));
      put(row, 'currency', q.currency); put(row, 'ppn_pct', Number(q.ppn_pct));
      put(row, 'subtotal', Number(q.subtotal)); put(row, 'ppn_amount', Number(q.ppn_amount));
      put(row, 'grand_total', Number(q.grand_total));
      put(row, 'sales_rep_email', email.get(q.sales_rep_id) ?? '');
      put(row, 'notes', q.notes);
      rows.push(row);
    }
  }

  if (entity === 'order_lines') {
    const [items, qs, comps] = await Promise.all([
      page<Record<string, string>>('22.1_sales_quote_items', '*'),
      page<Record<string, string>>('22.0_sales_quotes', 'quote_id, external_ref, quote_date'),
      page<Record<string, string>>('3.0_components', 'component_id, supplier_model'),
    ]);
    const byQuote = new Map(qs.map((q) => [q.quote_id, q]));
    const sku = new Map(comps.map((c) => [c.component_id, c.supplier_model]));
    for (const it of items) {
      const q = byQuote.get(it.quote_id);
      if (!inRange(q?.quote_date)) continue;
      const row = blank();
      put(row, 'order_ref', q?.external_ref || it.quote_id);
      put(row, 'line_no', Number(it.sort_order));
      put(row, 'sku', sku.get(it.component_id) ?? '');
      put(row, 'description', it.description); put(row, 'unit', it.unit);
      put(row, 'quantity', Number(it.quantity)); put(row, 'unit_price', Number(it.unit_price));
      put(row, 'line_total', Number(it.line_total));
      put(row, 'is_section', String(it.is_section) === 'true' ? 'yes' : 'no');
      put(row, 'brand', it.brand); put(row, 'lead_time', it.lead_time); put(row, 'note', it.note);
      rows.push(row);
    }
  }

  if (entity === 'invoices') {
    const [invs, qs] = await Promise.all([
      page<Record<string, string>>('25.0_sales_invoices', '*'),
      page<Record<string, string>>('22.0_sales_quotes', 'quote_id, external_ref'),
    ]);
    const byQuote = new Map(qs.map((q) => [q.quote_id, q]));
    for (const iv of invs) {
      if (!inRange(iv.issued_at ?? iv.created_at)) continue;
      const row = blank();
      put(row, 'external_ref', iv.external_ref || iv.invoice_id);
      put(row, 'order_ref', byQuote.get(iv.quote_id)?.external_ref || iv.quote_id);
      put(row, 'invoice_number', iv.invoice_number);
      put(row, 'issued_at', (iv.issued_at ?? '').slice(0, 10)); put(row, 'due_date', (iv.due_date ?? '').slice(0, 10));
      put(row, 'subtotal', Number(iv.subtotal)); put(row, 'ppn_pct', Number(iv.ppn_pct));
      put(row, 'ppn_amount', Number(iv.ppn_amount)); put(row, 'grand_total', Number(iv.grand_total));
      put(row, 'copy_lines', 'no');   // lines already exist; re-import must not duplicate them
      put(row, 'notes', iv.notes);
      rows.push(row);
    }
  }

  if (entity === 'receipts') {
    const [rs, qs, invs] = await Promise.all([
      page<Record<string, string>>('26.0_customer_receipts', '*'),
      page<Record<string, string>>('22.0_sales_quotes', 'quote_id, external_ref'),
      page<Record<string, string>>('25.0_sales_invoices', 'invoice_id, external_ref'),
    ]);
    const byQuote = new Map(qs.map((q) => [q.quote_id, q]));
    const byInv = new Map(invs.map((i) => [i.invoice_id, i]));
    for (const r of rs) {
      if (!inRange(r.payment_date ?? r.created_at)) continue;
      const row = blank();
      put(row, 'external_ref', r.external_ref || r.receipt_id);
      put(row, 'order_ref', byQuote.get(r.quote_id)?.external_ref || r.quote_id);
      put(row, 'invoice_ref', r.invoice_id ? byInv.get(r.invoice_id)?.external_ref || r.invoice_id : '');
      put(row, 'receipt_number', r.receipt_number); put(row, 'amount', Number(r.amount));
      put(row, 'payment_date', r.payment_date); put(row, 'payment_method', r.payment_method);
      put(row, 'category', r.category); put(row, 'bank_ref', r.bank_ref); put(row, 'notes', r.notes);
      rows.push(row);
    }
  }

  return { headers, rows };
}
