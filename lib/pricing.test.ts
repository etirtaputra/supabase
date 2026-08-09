/**
 * Pricing tests — the ideal price must respect the floor, the market band, FX,
 * and demand; the score must gate below-cost/below-floor and read the market.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { computePricing, type PricingInput } from './pricing.ts';

const base = (over: Partial<PricingInput>): PricingInput => ({
  landedCost: 100_000, currentPrice: 130_000, marginFloorPct: 15, targetMarginPct: 30,
  roundingStep: 1000, ...over,
});

test('with no market, ideal is cost-plus at the target margin', () => {
  const r = computePricing(base({ market: null, currentPrice: null, targetMarginPct: 30 }));
  // 100k / (1 - .30) = 142,857 → rounded to 143,000
  assert.equal(r.ideal, 143_000);
  assert.equal(r.hasMarket, false);
});

test('the market lifts an under-target price up toward what competitors charge', () => {
  // Target price 143k, but the cheapest competitor is 160k — leave no money.
  const r = computePricing(base({ market: { low: 160_000, mid: 180_000, high: 200_000, count: 5 }, demand: 'normal' }));
  assert.ok(r.ideal >= 160_000, `ideal ${r.ideal}`);
  assert.ok(r.ideal <= 180_000);   // capped at the mid (normal demand)
});

test('demand positions us in the band: strong aims high, weak aims low', () => {
  const m = { low: 160_000, mid: 180_000, high: 200_000, count: 5 };
  const strong = computePricing(base({ market: m, demand: 'strong' }));
  const weak = computePricing(base({ market: m, demand: 'weak' }));
  assert.ok(strong.ideal > weak.ideal);
  assert.ok(strong.ideal <= 200_000 && weak.ideal >= 160_000);
});

test('the FX buffer raises the floor ahead of the next restock', () => {
  const noFx = computePricing(base({ fxRiskPct: 0, currentPrice: null }));
  const fx = computePricing(base({ fxRiskPct: 10, currentPrice: null }));
  assert.ok(fx.floor > noFx.floor);
  assert.ok(fx.target > noFx.target);
});

test('below cost scores near zero and is flagged', () => {
  const r = computePricing(base({ currentPrice: 90_000 }));
  assert.equal(r.verdict, 'below-cost');
  assert.ok((r.score ?? 99) <= 10);
});

test('below the margin floor is capped low', () => {
  // floor = 100k/(1-.15) = 117,647; price 110k is above cost, below floor.
  const r = computePricing(base({ currentPrice: 110_000 }));
  assert.equal(r.verdict, 'below-floor');
  assert.ok((r.score ?? 99) <= 40);
});

test('dearer than the whole market reads as overpriced', () => {
  const r = computePricing(base({ currentPrice: 250_000, market: { low: 160_000, mid: 180_000, high: 200_000, count: 5 } }));
  assert.equal(r.verdict, 'overpriced');
});

test('cheaper than the cheapest competitor reads as underpriced (leaving money)', () => {
  const r = computePricing(base({ currentPrice: 150_000, market: { low: 160_000, mid: 180_000, high: 200_000, count: 5 } }));
  assert.equal(r.verdict, 'underpriced');
});

test('a price at the ideal scores high and reads well-priced', () => {
  const m = { low: 160_000, mid: 180_000, high: 200_000, count: 8 };
  const ideal = computePricing(base({ market: m, currentPrice: null })).ideal;
  const r = computePricing(base({ market: m, currentPrice: ideal }));
  assert.equal(r.verdict, 'well-priced');
  assert.ok((r.score ?? 0) >= 85);
});

test('when even the floor exceeds the market, it is uncompetitive (a cost problem)', () => {
  // Cost 300k → floor ~353k, but the market tops out at 200k.
  const r = computePricing(base({ landedCost: 300_000, currentPrice: 360_000, market: { low: 160_000, mid: 180_000, high: 200_000, count: 5 } }));
  assert.equal(r.uncompetitive, true);
  assert.equal(r.verdict, 'uncompetitive');
});

test('confidence grows with how many competitor points back the band', () => {
  const thin = computePricing(base({ market: { low: 160_000, mid: 180_000, high: 200_000, count: 1 } }));
  const deep = computePricing(base({ market: { low: 160_000, mid: 180_000, high: 200_000, count: 20 } }));
  assert.ok(deep.confidence > thin.confidence);
});
