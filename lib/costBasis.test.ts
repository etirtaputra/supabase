/**
 * "Landed wins, quote fills in" — and the honesty that has to travel with it.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { resolveCost, isMeasured, BASIS_LABEL, BASIS_NOTE, BASIS_TAG, NO_COST,
         type CostBasis } from './costBasis.ts';
import type { ComponentCost } from './computeTUC.ts';

const cc = (source: ComponentCost['source'], cost: number, asOf = '2026-08-01'): ComponentCost =>
  ({ cost, source, asOf, history: [] });

// ── The order ───────────────────────────────────────────────────────────────

test('landed cost wins whenever there is one', () => {
  const r = resolveCost(1_000_000, cc('quote', 800_000));
  assert.equal(r.cost, 1_000_000);
  assert.equal(r.basis, 'landed');
  assert.equal(r.provisional, false);
});

test('landed wins even against a NEWER and cheaper quote', () => {
  // The temptation is to prefer the fresher number. Refused: the ledger is the
  // only figure derived from goods that actually arrived, and a quote that
  // undercuts it has not paid freight yet.
  const r = resolveCost(1_000_000, cc('quote', 600_000, '2026-09-10'));
  assert.equal(r.basis, 'landed');
  assert.equal(r.cost, 1_000_000);
});

test('a settled PO carries it when the ledger cannot', () => {
  const r = resolveCost(null, cc('tuc', 950_000, '2026-07-04'));
  assert.equal(r.basis, 'tuc');
  assert.equal(r.cost, 950_000);
  assert.equal(r.asOf, '2026-07-04');
  assert.equal(r.provisional, false, 'a TUC includes freight and duty — it is a real landed cost');
});

test('a supplier quote is the last resort, and says so', () => {
  const r = resolveCost(null, cc('quote', 800_000, '2026-06-01'));
  assert.equal(r.basis, 'quote');
  assert.equal(r.cost, 800_000);
  assert.equal(r.provisional, true);
});

test('nothing priceable resolves to none, never to zero', () => {
  // Zero is a cost. "We do not know" is not, and a screen that shows 0 will
  // report a 100% margin on it.
  for (const [landed, fb] of [[null, null], [0, null], [null, cc('quote', 0)], [undefined, undefined]] as const) {
    const r = resolveCost(landed, fb);
    assert.deepEqual(r, NO_COST);
    assert.equal(r.cost, null);
  }
});

test('a negative or non-finite landed cost falls through instead of poisoning the row', () => {
  for (const bad of [-5, NaN, Infinity]) {
    assert.equal(resolveCost(bad, cc('quote', 800_000)).basis, 'quote');
  }
  assert.equal(resolveCost(-5, null).basis, 'none');
});

// ── The honesty ─────────────────────────────────────────────────────────────

test('only the quote basis is provisional', () => {
  assert.equal(resolveCost(1, null).provisional, false);
  assert.equal(resolveCost(null, cc('tuc', 1)).provisional, false);
  assert.equal(resolveCost(null, cc('quote', 1)).provisional, true);
});

/**
 * A "last used" cost is a figure somebody typed onto a past project quote. It
 * was never a landed cost, so it gets the same treatment a quote does.
 */
test('a last-used cost is provisional too — it was somebody’s working figure', () => {
  const r = resolveCost(null, cc('used', 700_000));
  assert.equal(r.provisional, true);
  assert.equal(r.basis, 'quote', 'anything that is not measured is grouped with the quote basis');
});

test('measured means goods proved it', () => {
  assert.equal(isMeasured('landed'), true);
  assert.equal(isMeasured('tuc'), true);
  assert.equal(isMeasured('quote'), false);
  assert.equal(isMeasured('none'), false);
});

/**
 * The note on the quote basis has to state the DIRECTION of the error, not
 * just that there is one.
 *
 * A quote is EXW/FOB: it excludes freight, duty, PIB and bank charges. So the
 * margin shown against it is systematically too good, and a floor cleared on
 * it can be breached the day the container lands. "Approximate" would let a
 * reader assume the error cuts both ways. It does not.
 */
test('the quote note says which way it is wrong', () => {
  assert.match(BASIS_NOTE.quote, /excludes freight, duty and fees/i);
  assert.match(BASIS_NOTE.quote, /BETTER than the real one/);
  assert.match(BASIS_NOTE.quote, /unproven/);
});

test('every basis has a label and a note a person could act on', () => {
  for (const b of ['landed', 'tuc', 'quote', 'none'] as CostBasis[]) {
    assert.ok(BASIS_LABEL[b]?.trim(), `${b} has no label`);
    assert.ok((BASIS_NOTE[b] ?? '').length > 40, `${b}'s note explains nothing`);
    assert.equal(typeof BASIS_TAG[b], 'string');
  }
  // The expected case earns no badge. A tag on every row is a tag nobody reads.
  assert.equal(BASIS_TAG.landed, '');
  assert.ok(BASIS_TAG.quote.trim(), 'the exception must be marked');
});

/**
 * A PO-derived landed cost is badged TUC, not "PO" (owner, 2026-09-11).
 *
 * The app has called this number Total Unit Cost since the cost lookup shipped
 * — it is TUC on Product Cost Lookup, TUC on the item hub, TUC in the
 * purchasing runbook. Badging the same number "PO" on one screen gives it a
 * second name, and two names for one number is how a reader starts wondering
 * whether they are two numbers.
 */
test('a PO-derived landed cost is badged TUC, the name the rest of the app uses', () => {
  assert.equal(BASIS_TAG.tuc, 'TUC');
  assert.match(BASIS_LABEL.tuc, /TUC/);
  assert.match(BASIS_NOTE.tuc, /paid in full/, 'the note must say the PO is settled, not merely raised');
});

/**
 * There must not be a second cost resolver.
 *
 * `getComponentCost` has resolved TUC → supplier quote, with FX conversion and
 * staleness, since the Project Quote builder shipped. This file puts the
 * ledger in front of it; it does not re-derive any of it. Re-implementing that
 * chain here would give one sentence two implementations, which is the exact
 * failure this codebase keeps having to undo.
 */
test('costBasis defers to computeTUC rather than re-deriving the chain', () => {
  const src = readFileSync(join(process.cwd(), 'lib', 'costBasis.ts'), 'utf8');
  assert.match(src, /from '\.\/computeTUC\.ts'/, 'the fallback chain is no longer imported');
  for (const reimplemented of ['quotePriceHistory', 'fxRateOf', 'computeTUC(']) {
    assert.ok(!src.includes(reimplemented), `costBasis re-implements ${reimplemented}`);
  }
});


// ─────────────────────────────────────────────────────────────────────────────
// The wiring. Selling Prices is the screen this rule exists for, and every one
// of these is a one-line regression that looks perfectly reasonable on screen:
// a quote-based margin reads exactly like a landed one unless something says so.
// ─────────────────────────────────────────────────────────────────────────────

const pricingPage = () => readFileSync(join(process.cwd(), 'app', 'pricing', 'page.tsx'), 'utf8');

test('Selling Prices resolves a basis instead of reading the ledger raw', () => {
  const src = pricingPage();
  assert.match(src, /from '@\/lib\/costBasis'/, 'the pricing screen no longer imports the rule');
  assert.ok(src.includes('const basisOf'), 'the basis resolver is gone');
  // costOf must be derived FROM the basis, not a second path to a number.
  assert.match(src, /const costOf = useCallback\(\(cid: string\): number \| null => basisOf\(cid\)\.cost/,
    'costOf has its own route to a cost again — that is two answers to one question');
});

test('the fallback chain is called, not re-implemented on the page', () => {
  const src = pricingPage();
  assert.ok(src.includes('getComponentCost('), 'the pricing screen stopped using the shared fallback');
  assert.ok(!/quotePriceHistory\(/.test(src), 'the page re-derives the quote history itself');
});

/**
 * A quote-based cost must be visibly marked wherever a person reads a margin
 * off it — the Set Pricing grid AND the Floor Audit row. The banner alone is
 * not enough: by the time somebody is reading a row they have stopped reading
 * the header.
 */
test('a provisional cost is marked at the number, in both places', () => {
  const src = pricingPage();
  const tags = (src.match(/QUOTE</g) ?? []).length;
  assert.ok(tags >= 2, `the QUOTE badge appears ${tags} time(s) — the grid and the audit both need it`);
  assert.ok(src.includes('BASIS_NOTE'), 'the badge carries no explanation on hover');
  assert.match(src, /provisional \? 'text-amber/, 'a quoted cost is not visually distinguished');
});

/**
 * The heading must not name one basis. "Landed cost" over a column that is
 * sometimes a supplier quote is wrong on every quoted row — and wrong in the
 * flattering direction, which is the kind of wrong that gets believed.
 */
test('the cost column does not claim to be landed cost', () => {
  const src = pricingPage();
  assert.ok(!/label="Landed cost"/.test(src), 'the sortable heading still says Landed cost');
  assert.ok(!/>Landed cost</.test(src), 'a table heading still says Landed cost');
  assert.ok(src.includes('Cost basis'), 'the column lost its heading entirely');
});

test('the floor audit separates proven breaches from quoted ones', () => {
  const src = pricingPage();
  assert.ok(src.includes('provisionalViolations'), 'the audit no longer counts provisional breaches');
  assert.match(src, /provisional: basis\.provisional/, 'a violation does not record its basis');
  // And it must say which direction the error runs.
  assert.match(src, /worse than shown, not better/, 'the audit caveat no longer states the direction of the bias');
});


/**
 * A suggestion needs a cost and a profile — NOT a price.
 *
 * The range used to render only when the item was out of band, which requires
 * a price to be out of band WITH. So the row where "here is what to charge" is
 * most useful — the one with no price at all — was the row that got nothing,
 * while `suggestRange` sat there able to answer from the cost and the profile
 * alone. An in-band price still gets no suggestion: that is a correct row, and
 * a prompt on it is noise.
 */
test('the price suggestion shows on unpriced rows, not only out-of-band ones', () => {
  const src = pricingPage();
  const gate = src.match(/i === 0 && canManage && range\s*\n?\s*&& \(([^)]*standingNow[^;]*?)\) && \(/);
  assert.ok(gate, 'the suggestion gate has moved — re-check it still covers unpriced rows');
  assert.match(gate[1], /!\(Number\(netNow\) > 0\)/,
    'an item with a cost and a profile but no price still gets no suggestion');
  assert.match(gate[1], /standingNow === 'below'/);
  assert.match(gate[1], /standingNow === 'above'/);
  assert.ok(!/standingNow === 'within'/.test(gate[1]),
    'a correctly priced row must not be prompted — that is noise, not help');
});

/**
 * The suggestion's LOOK is the owner's call; what it SAYS is not.
 *
 * It was briefly a pair of bordered pills, because a dotted underline reads as
 * "hover for a tooltip" elsewhere in this app rather than "press me". On a row
 * that already carries three bordered input boxes, two more boxes underneath
 * was box soup (owner, 2026-09-11: *"the box style is clashing too much"* and
 * *"i prefer the older style"*). He has seen both and chosen; taste on his own
 * screen is his.
 *
 * So this test pins the part that was never about looks: the tooltip must say
 * that clicking SETS THE NET, and that Tier-2 and Tier-3 follow from it. That
 * was the real question behind "how do I click this", and it costs nothing to
 * answer on hover.
 */
test('the price suggestion says what clicking does, and that the tiers follow', () => {
  const src = pricingPage();
  assert.match(src, /Set the net price to \$\{fmtRupiah\(range\.min\)\}/, 'the tooltip no longer says what clicking does');
  assert.match(src, /Set the net price to \$\{fmtRupiah\(range\.max\)\}/);
  assert.equal((src.match(/Tier-2 and Tier-3 recalculate from it; you never type those/g) ?? []).length, 2,
    'both ends of the suggestion must say the upper tiers are derived');
});

/**
 * The two clickable numbers on a row must share ONE shape, whichever shape is
 * in favour. The band suggestion and the "pinned · chain says" affordance sit
 * inches apart and do the same kind of thing.
 */
test('every clickable price hint on a row wears the same style', () => {
  const src = pricingPage();
  const hint = /className="tabular-nums text-amber-300\/80 hover:text-amber-200 underline underline-offset-2 decoration-dotted"/g;
  assert.equal((src.match(hint) ?? []).length, 3,
    'the band suggestion (2) and the unpin hint (1) have drifted apart in style');
});

/**
 * THE FAINT TIER BOX is the one that gets misread, so it has to explain itself.
 *
 * Owner, 2026-09-11: *"if it's feint color it just follow the suggested
 * price?"* — the mechanism is right, the cause is one word off. Faint means
 * NOTHING IS STORED: the number is the markup chain's, computed from the net,
 * and it follows the net wherever it goes. It has nothing to do with the
 * suggestion, which only ever sets the net. Typing into a faint box PINS it and
 * it stops following — which is the consequence worth knowing, and the reason
 * the four states each name themselves on hover now.
 */
test('each tier box explains its own state, especially the faint one', () => {
  const src = pricingPage();
  assert.match(src, /FAINT = nothing stored here/, 'the faint state does not say what it means');
  assert.match(src, /computed from the net by the markup chain and follows it/,
    'the faint state does not say the number is derived, not stored');
  assert.match(src, /Type to pin it, which stops it following/,
    'the faint state does not warn that typing pins it');
  assert.match(src, /PINNED: a stored override on this tier/, 'the pinned state no longer names itself');
});

/**
 * And the reason it can say that: the upper tiers are computed from the net
 * that is being TYPED, not the one that is saved.
 */
test('the upper tiers derive from the draft net, so one click fills the row', () => {
  const src = pricingPage();
  assert.match(src, /const chainNow = computeTierChain\(netNow, tiers,/,
    'the tier chain no longer recomputes from the edited net');
  assert.match(src, /const netNow = draft\[netKey\] !== undefined \? num\(draft\[netKey\]\) : r\.c\.selling_price_idr/,
    'the net preview no longer reads what is typed');
});
