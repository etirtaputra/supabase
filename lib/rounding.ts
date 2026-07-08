/**
 * Round to ~3 significant digits (minimum step Rp100) so auto-computed sell
 * prices come out presentable: 13,333,333 → 13,300,000; 333,333,333 →
 * 333,000,000; 2,000,000 stays. Costs keep exact values — only prices we
 * invent from a margin get this treatment.
 */
export function roundNice(v: number): number {
  if (!(v > 0)) return 0;
  const step = Math.pow(10, Math.max(2, Math.floor(Math.log10(v)) - 2));
  return Math.round(v / step) * step;
}
