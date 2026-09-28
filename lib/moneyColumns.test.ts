/**
 * "Rp once, in the column header" (owner, 2026-09-28). A table cell carries
 * digits — `fmtMoneyCell` — and the header carries the unit — `moneyUnit()`.
 * This fails a <td> that formats its figure with the symbol again.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const tsx = (dir: string): string[] => readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
  if (e.name === 'node_modules' || e.name.startsWith('.')) return [];
  const p = join(dir, e.name);
  return e.isDirectory() ? tsx(p) : p.endsWith('.tsx') ? [p] : [];
});

/**
 * Where a cell may still carry its currency, and why. Everything else may not.
 */
const MAY_CARRY_CURRENCY: Record<string, string> = {
  // Each deal owes in its own currency (CNY, USD, IDR) — no single unit to hoist.
  'components/ui/DealLookupTab.tsx': 'mixed currencies per row',
  // Supplier prices in the supplier's currency, with the rupiah beside them.
  'components/ui/PricingIntelligence.tsx': 'mixed currencies per row',
  'components/ui/ItemCostForensics.tsx': 'mixed currencies per row',
  // Autocomplete and price-history popups live INSIDE editor cells; they are
  // sentences, not the cell's figure.
  'app/proposals/[id]/page.tsx': 'popups and sentences inside editor cells',
};

test('a table cell shows digits; the unit lives in its header', () => {
  const bad: string[] = [];
  for (const f of [...tsx('app'), ...tsx('components')]) {
    if (/\/(print|do)\/|app\/shop\//.test(f) || f in MAY_CARRY_CURRENCY) continue;
    const src = readFileSync(f, 'utf8');
    for (const m of src.matchAll(/<td\b[\s\S]*?<\/td>/g)) {
      // Tooltips keep their symbol — a tooltip is a sentence, not the cell.
      const cell = m[0].replace(/title=\{`[^`]*`\}|title=\{[^}]*\}|title="[^"]*"/g, '');
      if (/\b(fmtRupiah|fmtIdr)\(/.test(cell)) bad.push(`${f}:${src.slice(0, m.index).split('\n').length}`);
    }
  }
  assert.deepEqual(bad, [], 'use fmtMoneyCell in the cell and put ({moneyUnit()}) in the column header');
});

test('the exemptions are still real files', () => {
  for (const f of Object.keys(MAY_CARRY_CURRENCY)) assert.ok(readFileSync(f, 'utf8').length > 0, f);
});
