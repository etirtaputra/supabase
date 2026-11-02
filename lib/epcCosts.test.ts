/**
 * EPC costs for the Project Engineer — "Std Cost only" (owner, 2026-11-02).
 *
 * THE FIELD REPORT. An engineer looked up the SUNKEAN aluminium PV cable,
 * quoted by Trisindo that morning at Rp 8,200/m, and the EPC editor said
 * "no price data". Since 2026-09-16 the supplier tables are closed to every
 * role off the buy side, and the editor computed costs from them in the
 * browser — so for an engineer the only cost left was "last used in a
 * proposal". 444 of the 521 priced items read "no price data".
 *
 * The fix runs the same formula on the server and hands the engineer the
 * result REDACTED: cost, date, PO or Quote. These tests pin that it is the
 * same formula, that the redaction keeps nothing that names a supplier, and
 * that the route asks who is calling before it reads anything.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  getComponentCost, costBase, pickCost, redactCostBase, epcCostOpts, EMPTY_COST_BASE,
  type TUCResult, type CostEntry,
} from './computeTUC.ts';
import type { PriceQuote, PriceQuoteLineItem } from '../types/database';

const ROOT = process.cwd();

const tuc = (cost: number, date: string): TUCResult => ({
  tuc: cost, avgTuc: cost, latestTuc: cost, latestPoDate: date, latestXr: null, poCount: 1,
  entries: [{ kind: 'tuc', label: 'PO-001-ISL-01-2026', date, unitCost: cost }],
} as unknown as TUCResult);
const quote = (id: string, date: string, label: string): PriceQuote =>
  ({ quote_id: id, quote_date: date, currency: 'IDR', pi_number: label, status: 'Open' } as unknown as PriceQuote);
const line = (quoteId: string, componentId: string, price: number, currency = 'IDR'): PriceQuoteLineItem =>
  ({ quote_id: quoteId, component_id: componentId, unit_price: price, currency } as unknown as PriceQuoteLineItem);
const used = (cost: number, date: string): CostEntry =>
  ({ kind: 'used', label: 'Q-20261001-ABC', date, unitCost: cost, customer: 'PT Contoh', system: 'PV On-Grid 50 kWp' });

const quotes = [quote('q1', '2026-11-02', 'WA Joe Trisindo to Wendy'), quote('q2', '2026-10-01', 'PI-88 Shenzhen Kstar')];
const lines = [line('q1', 'AL10', 8200), line('q2', 'INV', 500, 'USD')];
const tucMap = new Map([['CU6', tuc(14000, '2026-09-01')]]);
const fx = { USD: { rate: 17000, date: '2026-10-20', source: 'benchmark', label: 'Benchmark' } } as never;
const STD = { mode: 'buffered' as const, bufferPct: 5 };

test('costBase + pickCost is exactly getComponentCost (one formula, two halves)', () => {
  const cases: Array<[string, CostEntry[], typeof STD | { mode: 'hidden' } | undefined]> = [
    ['AL10', [], STD],                         // supplier quote only, buffered
    ['AL10', [used(9000, '2026-11-05')], STD], // a newer last-used cost wins the fallback
    ['CU6', [used(1, '2026-12-01')], STD],     // TUC wins whatever is newer
    ['CU6', [], { mode: 'hidden' }],           // TUC hidden: falls through
    ['INV', [], undefined],                    // USD quote, raw
    ['NONE', [], STD],                         // nothing at all
  ];
  for (const [id, u, opts] of cases) {
    assert.deepEqual(
      pickCost(costBase(id, tucMap, quotes, lines, opts, fx), u),
      getComponentCost(id, tucMap, quotes, lines, u, opts, fx),
      `diverged for ${id}`);
  }
  // The field case: Rp 8,200 quote + 5% Std Cost buffer.
  const al = pickCost(costBase('AL10', tucMap, quotes, lines, STD, fx));
  assert.equal(Math.round(al!.cost), 8610);
  assert.equal(al!.source, 'quote');
  assert.equal(al!.buffered, true);
  assert.equal(pickCost(EMPTY_COST_BASE), null);
});

test('redaction keeps the cost and drops everything that names the supplier', () => {
  const base = costBase('INV', tucMap, quotes, lines, STD, fx);
  const raw = JSON.stringify(base);
  assert.match(raw, /Kstar/, 'fixture sanity: the raw base names the supplier');
  const red = redactCostBase(base);
  const out = JSON.stringify(red);
  for (const leak of ['Kstar', 'Trisindo', 'PI-88', 'PO-001', 'USD', 'rawUnitCost', 'fxNote', 'fxSource', 'fxStale', 'customer', 'system']) {
    assert.ok(!out.includes(leak), `redacted cost still carries ${leak}`);
  }
  assert.deepEqual(red.entries.map((e) => e.unitCost), base.entries.map((e) => e.unitCost), 'costs unchanged');
  assert.deepEqual(red.entries.map((e) => e.label), ['Supplier quote']);
  // Only these keys may ever leave the server.
  for (const e of redactCostBase(costBase('CU6', tucMap, quotes, lines, STD, fx)).entries) {
    for (const k of Object.keys(e)) assert.ok(['kind', 'label', 'date', 'unitCost', 'buffered'].includes(k), `unexpected key ${k}`);
  }
  // And the engineer's result equals the owner's cost.
  assert.equal(pickCost(red)!.cost, pickCost(base)!.cost);
});

test('epcCostOpts is the rule the screens used inline', () => {
  assert.deepEqual(epcCostOpts(null, 5), { mode: 'buffered', bufferPct: 5 });
  assert.deepEqual(epcCostOpts({ show_tuc_in_quotes: false }, 5), { mode: 'hidden', bufferPct: 5 });
  assert.deepEqual(epcCostOpts({ quote_cost_mode: 'tuc', quote_cost_buffer_pct: 0 }, 5), { mode: 'tuc', bufferPct: 0 });
});

test('the route asks who is calling, gates on canEditQuotes, and only sends redacted costs', () => {
  const src = readFileSync(join(ROOT, 'app/api/epc/costs/route.ts'), 'utf8');
  const body = src.slice(src.indexOf('export async function GET'));
  const firstRead = body.indexOf('.from(');
  assert.ok(body.indexOf('callerFromRequest(request)') >= 0 && body.indexOf('callerFromRequest(request)') < firstRead, 'caller checked before the first read');
  assert.ok(body.indexOf('canEditQuotes') >= 0 && body.indexOf('canEditQuotes') < body.indexOf('SUPABASE_SERVICE_ROLE_KEY'), 'role gate before the service-role key is touched');
  assert.match(body, /costs\[c\.component_id\] = redactCostBase\(base\)/, 'every item is redacted before it is sent');
  assert.ok(!/NextResponse\.json\(\{[^}]*\b(quotes|quoteItems|pos|poItems|poCosts|tucMap)\b/.test(body), 'raw buy-side rows are never returned');
});

test('the EPC screens get costs through useEpcCostBase, never straight from the buy side', () => {
  for (const f of ['app/proposals/[id]/page.tsx', 'app/proposals/page.tsx', 'app/proposals/bom/[id]/page.tsx']) {
    const src = readFileSync(join(ROOT, f), 'utf8');
    assert.match(src, /useEpcCostBase\(/, `${f} must use useEpcCostBase`);
    assert.ok(!/getComponentCost\(/.test(src), `${f} calls getComponentCost directly — an engineer would see "no price data" again`);
  }
});
