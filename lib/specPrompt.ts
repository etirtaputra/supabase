/**
 * The AI prompt for turning a datasheet into an item's specifications
 * (owner, 2026-10-15: "do you have prompt on how to enter the json tech spec
 * for products the right way?").
 *
 * Built from the category's declared field set and field metadata — the same
 * two tables the Tech Specs form, the comparison and the shop read — so the
 * prompt can never ask for a key the catalogue does not store, or describe a
 * field differently from the form. Add a field in specSchema/specFields and
 * the prompt asks for it in the same commit.
 *
 * The template is the item's CURRENT specs (conformed), not a blank: a value
 * already on file survives unless the datasheet says otherwise, so pasting the
 * answer back cannot wipe what someone typed earlier.
 *
 * The answer goes back through Tech Specs → JSON → Save, where conformSpecs
 * renames old spellings, turns "49.6" into 49.6 and drops brand/model/price.
 */
import { CATEGORY_SPEC_FIELDS, conformSpecs, type Specs } from './specSchema.ts';
import { fieldMeta } from './specFields.ts';

const KIND_RULE = {
  number: 'a plain number',
  text: 'text, as printed',
  boolean: 'true or false',
  list: 'a list of strings',
} as const;

/** One line per field: key — label (unit) — what kind of value — an example. */
export function specFieldGuide(category: string): string[] {
  const fields = (CATEGORY_SPEC_FIELDS[category as keyof typeof CATEGORY_SPEC_FIELDS] ?? []) as readonly string[];
  return fields.map((key) => {
    const m = fieldMeta(key);
    const unit = m.unit ? ` (${m.unit})` : '';
    const eg = m.hint ? `, e.g. ${m.hint}` : '';
    return `- ${key}: ${m.label}${unit} — ${KIND_RULE[m.kind]}${eg}`;
  });
}

/** The full prompt for one item, ready to paste with the datasheet into ChatGPT or Claude. */
export function buildSpecPrompt(item: { category: string | null; supplier_model: string; specifications: Specs | null }): string {
  const category = item.category ?? '';
  const template = conformSpecs(category, item.specifications ?? {});
  return [
    'You are entering a product\'s technical specifications into our ERP.',
    'Read the attached datasheet and return ONE JSON object and nothing else:',
    'no explanation, no markdown, no ``` marks.',
    '',
    `MODEL: ${item.supplier_model}`,
    'If the datasheet covers several models, use ONLY the column for this model.',
    '',
    'RULES',
    '1. Use exactly the keys in the TEMPLATE, spelled as written, in the same order. Keep every key.',
    '2. A value already filled in the TEMPLATE comes from our records: keep it unless the datasheet clearly states a different value for this model.',
    '3. If the datasheet does not print a value, write null. Never guess, estimate or calculate a value the datasheet does not state.',
    '4. The unit is in the key name and in the FIELD GUIDE (_w watts, _kw kilowatts, _v/_vdc/_vac volts, _a amps, _mm, _kg, _c °C, _m metres, _percent per cent). Convert when the datasheet uses another unit (0.5 kW → 500 for a _w key).',
    '5. A "plain number" is 49.6, not "49.6 V"; 1500, not 1,500; a decimal point, not a comma. Percent as the number: 22.5, not 0.225. Temperature coefficients keep their sign: -0.24.',
    '6. Ranges as text "min-max": "200-1000". Temperatures "-40 to +85". Dimensions "a x b x c" in the order the field name says, e.g. "2384 x 1303 x 33".',
    '7. When the datasheet adds words to a text value (e.g. "400 3L+N+PE"), keep them. When trackers differ, write them all: "30/30/20".',
    '8. Never include the brand, the model name or any price.',
    '9. Before answering, check that every number comes from this model\'s column.',
    '',
    'FIELD GUIDE',
    ...specFieldGuide(category),
    '',
    'TEMPLATE',
    JSON.stringify(template, null, 2),
  ].join('\n');
}
