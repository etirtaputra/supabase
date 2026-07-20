/**
 * Round to ~4 significant digits (minimum step Rp1) so auto-computed sell
 * prices come out presentable without distorting the target margin:
 * 13,333,333 → 13,330,000; 333,333,333 → 333,300,000; 2,000,000 stays.
 *
 * The old version used a minimum step of Rp100, which was fine for large
 * line items but wrecked the margin on small ones — a Rp400 cost at 25% GM
 * wants Rp533, and snapping that to Rp500 dropped the realised GM to ~20%.
 * A Rp1 floor keeps the margin exact where it matters and still tidies the
 * long tails on big numbers. Costs keep exact values — only prices we
 * invent from a margin get this treatment.
 */
export function roundNice(v: number): number {
  if (!(v > 0)) return 0;
  const step = Math.pow(10, Math.max(0, Math.floor(Math.log10(v)) - 3));
  return Math.round(v / step) * step;
}
