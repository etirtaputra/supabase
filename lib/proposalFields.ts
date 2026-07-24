/**
 * Consistency helpers for the EPC proposal header fields (customer, site,
 * address). Autocomplete suggests existing values so the same entity is typed
 * the same way every time; the fuzzy match powers both the editor's
 * "did you mean" warning and the directory's duplicate clustering.
 */

export const PROPOSAL_FIELDS = {
  customer_name: 'Customers',
  location: 'Sites / Locations',
  customer_address: 'Addresses',
} as const;
export type ProposalFieldKey = keyof typeof PROPOSAL_FIELDS;

export const normField = (s: string) => (s || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
const tokenSet = (s: string) => new Set(normField(s).split(' ').filter(Boolean));

/** 0..1 similarity: Jaccard token overlap, lifted for substring containment. */
export function fieldSimilarity(a: string, b: string): number {
  const na = normField(a), nb = normField(b);
  if (!na || !nb) return 0;
  if (na === nb) return 1;
  const ta = tokenSet(a), tb = tokenSet(b);
  let inter = 0;
  for (const t of ta) if (tb.has(t)) inter += 1;
  const uni = ta.size + tb.size - inter;
  const jac = uni ? inter / uni : 0;
  // "Ayana Resort" ⊂ "Ayana Resort and Spa Bali" — strong signal, but ignore
  // trivially short containment (e.g. a bare "PT") to avoid false positives.
  const shorter = na.length <= nb.length ? na : nb;
  const longer = na.length <= nb.length ? nb : na;
  const contained = shorter.length >= 5 && longer.includes(shorter) ? 0.9 : 0;
  return Math.max(jac, contained);
}

/**
 * The closest EXISTING value that is similar to `value` but not identical to it
 * — i.e. the one the user probably meant to reuse. Returns null when `value`
 * already exactly matches an existing value (it's canonical, not a dup) or when
 * nothing is close enough.
 */
export function nearestDuplicate(value: string, candidates: string[], threshold = 0.6): string | null {
  const nv = normField(value);
  if (nv.length < 3) return null;
  let best: string | null = null;
  let bestScore = threshold;
  for (const c of candidates) {
    if (normField(c) === nv) return null; // exact value exists → not a duplicate
    const s = fieldSimilarity(value, c);
    if (s >= bestScore) { bestScore = s; best = c; }
  }
  return best;
}

export interface DupCluster { canonical: string; count: number; variants: { value: string; count: number }[] }

/**
 * Group a field's distinct values into near-duplicate clusters. Each cluster's
 * canonical is the most-used spelling; variants are the others that should
 * probably fold into it. Only clusters with >1 member are returned.
 */
export function clusterDuplicates(counts: Map<string, number>, threshold = 0.6): DupCluster[] {
  const values = [...counts.entries()]
    .map(([value, count]) => ({ value, count }))
    .sort((a, b) => b.count - a.count || a.value.localeCompare(b.value));
  const used = new Set<number>();
  const clusters: DupCluster[] = [];
  for (let i = 0; i < values.length; i++) {
    if (used.has(i)) continue;
    const members = [values[i]];
    used.add(i);
    for (let j = i + 1; j < values.length; j++) {
      if (used.has(j)) continue;
      if (fieldSimilarity(values[i].value, values[j].value) >= threshold) {
        members.push(values[j]);
        used.add(j);
      }
    }
    if (members.length > 1) {
      const canonical = members[0]; // highest count
      clusters.push({
        canonical: canonical.value,
        count: members.reduce((s, m) => s + m.count, 0),
        variants: members.filter((m) => m.value !== canonical.value),
      });
    }
  }
  return clusters;
}
