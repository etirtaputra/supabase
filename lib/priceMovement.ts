/**
 * Which way a price moved, and what colour that is.
 *
 * WHY THIS FILE EXISTS: the rule has now been flipped twice.
 *
 * It started green-up. It was reverted to RED-up on the reasoning that a rise
 * in material cost is bad news, which is true — and it still read wrong,
 * because a red ▲ makes a reader stop and work out which of the two things the
 * colour is about: the direction of the number, or somebody's opinion of it.
 * (Owner, 2026-09-10: *"at first I wanted to revert the colour because when
 * material price goes up it means it's bad. But I now realise it's not
 * intuitive."*)
 *
 * So the rule is: **the colour describes the ARROW, not the consequence.**
 * Up is green, down is red, everywhere a price is compared to an earlier
 * price. It is the convention every ticker in the world uses, and the reason
 * it wins is not that rising costs are good — it is that a reader should never
 * have to decide what a colour is an opinion about.
 *
 * Judgement still gets said, in words: "rising" beside the arrow, a warning
 * where one belongs, a margin figure that goes red on its own terms. Words can
 * carry a value judgement without making the reader guess. A colour cannot
 * carry two.
 *
 * The three call sites used to spell this out inline, which is why flipping it
 * was a three-file hunt with no test to say whether the hunt was complete.
 * `priceMovement.test.ts` reads their source and fails if one drifts.
 */

export type PriceMovement = 'up' | 'down' | 'flat' | 'unknown';

/**
 * Classify a percentage change.
 *
 * `deadbandPct` is the width of "flat" — a ticker showing 0.2 % as RISING is
 * noise wearing the clothes of a signal. 0 means any movement counts, which is
 * right where the number is a single price change rather than an average.
 */
export function priceMovement(deltaPct: number | null | undefined, deadbandPct = 0): PriceMovement {
  const d = Number(deltaPct);
  if (deltaPct == null || !Number.isFinite(d)) return 'unknown';
  const band = Math.abs(deadbandPct);
  if (d > band) return 'up';
  if (d < -band) return 'down';
  return 'flat';
}

/** The glyph. Solid triangles read at 10px where ↑↓ start to look like ⇅. */
export const PRICE_ARROW: Record<PriceMovement, string> = {
  up: '▲',
  down: '▼',
  flat: '→',
  unknown: '—',
};

/** Tailwind text colour. */
export const PRICE_TONE: Record<PriceMovement, string> = {
  up: 'text-emerald-400',
  down: 'text-rose-400',
  flat: 'text-slate-400',
  unknown: 'text-slate-600',
};

/**
 * The same rule as a palette VARIABLE NAME, for the surfaces that build their
 * colours through `ink()` / `tint()` rather than a class (SpendOverview's
 * ticker tiles). Red rather than rose because that is the family those tiles
 * were already painted in; the direction is what had to change, not the hue.
 */
export const PRICE_INK: Record<PriceMovement, string> = {
  up: '--c-emerald-400',
  down: '--c-red-400',
  flat: '--c-slate-400',
  unknown: '--c-slate-600',
};

/** "rising" / "falling" — the word that carries the judgement the colour must not. */
export const PRICE_WORD: Record<PriceMovement, string> = {
  up: 'rising',
  down: 'falling',
  flat: 'stable',
  unknown: 'no data',
};
