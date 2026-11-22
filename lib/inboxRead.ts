/**
 * The Inbox's reader: one supplier document (PDF or photo) → what it says, as
 * JSON in the shape New Deal's pre-fill already reads (lib/inboxMatch
 * ReadDocument). Server-only — it spends the company's Anthropic key, so only
 * the authenticated /api/inbox routes call it.
 *
 * Claude Opus 5.5, adaptive thinking (its default). The installed SDK (0.71)
 * predates structured outputs and server-side refusal fallbacks, so the answer
 * is JSON in text, parsed defensively, and a decline or a cut-off answer is a
 * clear failure the person can retry — never a half-read document.
 */
import Anthropic from '@anthropic-ai/sdk';
import type { ReadDocument } from './inboxMatch.ts';

export const INBOX_MODEL = 'claude-opus-5-5';
export const READABLE_TYPES = ['application/pdf', 'image/jpeg', 'image/png', 'image/webp'] as const;
export type ReadableType = (typeof READABLE_TYPES)[number];

const PROMPT = `You read documents that arrive at an Indonesian solar and electrical distributor (ICAPROC). Most are from SUPPLIERS: proforma invoices (PI), quotations, purchase orders, payment proofs, invoices, delivery notes. Read this one and return ONLY a JSON object, no prose, no code fence.

{
  "document_type": "proforma_invoice" | "quote" | "purchase_order" | "payment_proof" | "invoice" | "delivery_note" | "other",
  "is_supplier_document": true | false,
  "summary": "one short line: who sent what, for how much",
  "supplier_name": "the seller's legal name as printed",
  "company_name": "the buyer the document is addressed to",
  "quote_number": "quotation number, if a quotation",
  "quote_date": "YYYY-MM-DD",
  "pi_number": "proforma invoice number, if a PI",
  "pi_date": "YYYY-MM-DD",
  "po_number": "purchase order number, if one is printed",
  "po_date": "YYYY-MM-DD",
  "currency": "USD" | "CNY" | "IDR" | "EUR",
  "total_value": 12345.67,
  "freight_charges_intl": 0,
  "payment_terms": "as printed",
  "incoterms": "FOB / CIF / EXW … as printed",
  "lead_time_days": 30,
  "line_items": [
    { "model_sku": "model or SKU", "description": "the line's text as printed", "brand": "brand if shown", "quantity": 100, "unit": "pcs / set / m …", "unit_price": 123.45 }
  ]
}

Rules:
- Every line item, in order — never skip, merge or summarise rows. Quantities and prices as numbers, without thousands separators.
- RMB, ¥ and 元 are CNY; Rp is IDR; $ is USD unless the document says otherwise.
- total_value is the document's own grand total; freight_charges_intl is freight or shipping billed on top of the goods, 0 when none.
- A field that is not on the document: null. Never invent a number.
- Dates as YYYY-MM-DD; a date written day-first (Indonesian, European) is read day-first.`;

export class ReadFailure extends Error {}

function parseJson(text: string): ReadDocument {
  const t = text.trim().replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, '');
  const a = t.indexOf('{'), b = t.lastIndexOf('}');
  if (a < 0 || b <= a) throw new ReadFailure('The reader did not return a document.');
  return JSON.parse(t.slice(a, b + 1)) as ReadDocument;
}

export async function readDocument(bytes: Uint8Array, mime: ReadableType): Promise<{ doc: ReadDocument; usage: { input: number; output: number } }> {
  if (!process.env.ANTHROPIC_API_KEY) throw new ReadFailure('The document reader is not configured on this deployment.');
  const client = new Anthropic();
  const data = Buffer.from(bytes).toString('base64');
  const file: Anthropic.ContentBlockParam = mime === 'application/pdf'
    ? { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data } }
    : { type: 'image', source: { type: 'base64', media_type: mime, data } };

  let res: Anthropic.Message;
  try {
    res = await client.messages.create({
      model: INBOX_MODEL,
      max_tokens: 16000,
      messages: [{ role: 'user', content: [file, { type: 'text', text: PROMPT }] }],
    });
  } catch (e) {
    if (e instanceof Anthropic.RateLimitError) throw new ReadFailure('The reader is busy — try again in a minute.');
    if (e instanceof Anthropic.BadRequestError) throw new ReadFailure(`The reader could not open this file: ${e.message}`);
    if (e instanceof Anthropic.APIError) throw new ReadFailure(`The reader failed (${e.status ?? 'network'}) — try again.`);
    throw e;
  }
  const stop = res.stop_reason as string | null;
  if (stop === 'refusal') throw new ReadFailure('The reader declined this document.');
  if (stop === 'max_tokens') throw new ReadFailure('The document is too long to read in one go — split it and add the parts.');
  const text = res.content.map((b) => (b.type === 'text' ? b.text : '')).join('');
  try {
    return { doc: parseJson(text), usage: { input: res.usage.input_tokens, output: res.usage.output_tokens } };
  } catch (e) {
    throw e instanceof ReadFailure ? e : new ReadFailure('The reader\'s answer could not be understood — try again.');
  }
}
