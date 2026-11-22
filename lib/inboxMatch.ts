/**
 * What the Inbox PROPOSES for a document the reader has understood
 * (zero-entry ERP, 2026-11-22). Pure: given what was read and what ICAPROC
 * already holds, it says which record to create, what it matched, and what a
 * person should look at before confirming. It never writes — the person
 * confirms in the pre-filled New Deal (app/purchasing?inbox=…), which runs the
 * same matcher (lib/docMatch) and saves through the usual rules.
 * Tested in lib/inboxMatch.test.ts.
 */
import { matchByName, matchComponent, type CatalogueItem } from './docMatch.ts';
import { dealsFrom, findDuplicates, dupMessage, type DupHit, type DupInboxItem } from './inboxDuplicates.ts';
import { checkPoTotal, totalDisagrees } from './poTotals.ts';

/** What the reader returns (lib/inboxRead.ts) — the shape New Deal's pre-fill reads. */
export interface ReadDocument {
  document_type?: string | null;   // proforma_invoice | quote | purchase_order | payment_proof | invoice | delivery_note | other
  is_supplier_document?: boolean | null;
  supplier_name?: string | null;
  company_name?: string | null;
  quote_number?: string | null; quote_date?: string | null;
  pi_number?: string | null; pi_date?: string | null;
  po_number?: string | null; po_date?: string | null;
  currency?: string | null;
  total_value?: number | null;
  freight_charges_intl?: number | null;
  line_items?: { model_sku?: string | null; description?: string | null; brand?: string | null; quantity?: number | null; unit?: string | null; unit_price?: number | null }[] | null;
  summary?: string | null;
}

export interface InboxLookups<C extends CatalogueItem = CatalogueItem> {
  suppliers: { supplier_id: string; supplier_name: string | null }[];
  companies: { company_id: string; legal_name: string | null }[];
  components: C[];
  quotes: Parameters<typeof dealsFrom>[0];
  pos: Parameters<typeof dealsFrom>[1];
  /** Other Inbox documents (lib/inboxDuplicates inboxDupView) — the same PI waiting twice. */
  inbox?: DupInboxItem[];
}

export interface ProposedLine { description: string; quantity: number | null; unit_price: number | null; component_id: string | null; component_name: string | null }

export interface InboxProposal {
  /** create_deal: a supplier's PI / quote / PO. review: anything else — a person decides. */
  action: 'create_deal' | 'review';
  /** A PI or PO goes in as quote + PO; a quote alone as a quote. */
  withPo: boolean;
  docType: string;
  docNumber: string | null;
  docDate: string | null;
  supplier: { name: string | null; id: string | null; matchedName: string | null };
  company: { name: string | null; id: string | null; matchedName: string | null };
  currency: string | null;
  total: number | null;
  itemsSum: number;
  freight: number;
  lines: ProposedLine[];
  matchedLines: number;
  /** Already in ICAPROC under the same supplier document number. */
  /** The strongest deal it repeats (same / revision), for links. */
  duplicate: { quote_id: string | null; po_id: string | null; label: string } | null;
  /** Every duplicate found when it was read (lib/inboxDuplicates). Screens re-check live. */
  duplicates?: DupHit[];
  /** Things a person should look at before confirming, in plain words. */
  /** In English, values filled in — what an agent reads. */
  warnings: string[];
  /** The same warnings as phrase-book entries + their values, for the screen to translate (tf). */
  notes?: { text: string; vars?: Record<string, string | number> }[];
}

const DEAL_TYPES = new Set(['proforma_invoice', 'quote', 'purchase_order']);
const num = (v: unknown): number | null => { const n = Number(v); return v == null || v === '' || !Number.isFinite(n) ? null : n; };

export function buildProposal<C extends CatalogueItem>(doc: ReadDocument, db: InboxLookups<C>): InboxProposal {
  const docType = String(doc.document_type || 'other');
  const isDeal = DEAL_TYPES.has(docType) && doc.is_supplier_document !== false;
  const docNumber = doc.pi_number || doc.quote_number || doc.po_number || null;
  const docDate = doc.pi_date || doc.quote_date || doc.po_date || null;

  const sup = matchByName(doc.supplier_name, db.suppliers, (s) => s.supplier_name);
  const com = matchByName(doc.company_name, db.companies, (c) => c.legal_name);

  const lines: ProposedLine[] = (doc.line_items ?? []).map((li) => {
    const m = matchComponent(li, db.components);
    return {
      description: String(li.description ?? li.model_sku ?? '').trim(),
      quantity: num(li.quantity), unit_price: num(li.unit_price),
      component_id: m ? String(m.component_id) : null,
      component_name: m ? String(m.internal_description || m.supplier_model || '') : null,
    };
  });
  const itemsSum = lines.reduce((s, l) => s + (l.quantity ?? 0) * (l.unit_price ?? 0), 0);
  const freight = num(doc.freight_charges_intl) ?? 0;
  const total = num(doc.total_value);

  // Already in ICAPROC, or waiting twice in the Inbox (lib/inboxDuplicates).
  const duplicates = findDuplicates(
    { supplier_id: sup ? String(sup.supplier_id) : null, numbers: [doc.pi_number ?? null, doc.quote_number ?? null, doc.po_number ?? null],
      total: total ?? (itemsSum || null), currency: doc.currency ?? null, date: docDate },
    dealsFrom(db.quotes, db.pos), db.inbox ?? []);
  const dealHit = duplicates.find((h) => h.where === 'deal' && (h.kind === 'same' || h.kind === 'revision'));
  const duplicate: InboxProposal['duplicate'] = dealHit ? { quote_id: dealHit.quote_id ?? null, po_id: dealHit.po_id ?? null, label: dealHit.label } : null;

  const warnings: string[] = [];
  const notes: NonNullable<InboxProposal['notes']> = [];
  const say = (text: string, vars?: Record<string, string | number>) => {
    notes.push(vars ? { text, vars } : { text });
    warnings.push(text.replace(/\{(\w+)\}/g, (_, k: string) => String(vars?.[k] ?? '')));
  };
  if (!isDeal) say(doc.is_supplier_document === false ? 'This does not look like a supplier document.' : 'This is not a PI, quote or PO — decide what it should become.');
  for (const h of duplicates) { const m = dupMessage(h); say(m.text, m.vars); }
  if (isDeal && !sup) {
    if (doc.supplier_name) say('Supplier "{name}" is not in ICAPROC yet — add it or pick the right one.', { name: doc.supplier_name });
    else say('No supplier name was found on the document.');
  }
  if (isDeal && !doc.currency) say('No currency was found — set it before saving.');
  if (isDeal && !lines.length) say('No line items were read.');
  const unmatched = lines.filter((l) => !l.component_id).length;
  if (unmatched) say(lines.length === 1 ? '{m} of {n} line not matched to a catalogue item — pick or add it.' : '{m} of {n} lines not matched to a catalogue item — pick or add them.', { m: unmatched, n: lines.length });
  if (total != null && lines.length && totalDisagrees(checkPoTotal({ docTotal: total, itemsSum, freight }))) {
    say(freight
      ? 'The document total ({total}) does not equal its lines + freight ({sum}) — check the quantities and prices read.'
      : 'The document total ({total}) does not equal its lines ({sum}) — check the quantities and prices read.',
      { total: total.toLocaleString('en-US'), sum: (itemsSum + freight).toLocaleString('en-US') });
  }

  return {
    action: isDeal ? 'create_deal' : 'review',
    withPo: isDeal && docType !== 'quote',
    docType, docNumber, docDate,
    supplier: { name: doc.supplier_name ?? null, id: sup ? String(sup.supplier_id) : null, matchedName: sup?.supplier_name ?? null },
    company: { name: doc.company_name ?? null, id: com ? String(com.company_id) : null, matchedName: com?.legal_name ?? null },
    currency: doc.currency ?? null,
    total, itemsSum, freight, lines,
    matchedLines: lines.length - unmatched,
    duplicate, duplicates, warnings, notes,
  };
}
