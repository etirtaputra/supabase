/**
 * Mounting SYSTEMS — which parts belong together.
 *
 * A mounting kit is only valid within one family: MIBET MD clamps ride MIBET
 * MD rails, and an MD T-slot rail takes the T-slot splice, not the symmetric
 * one. The catalog carries that knowledge in the model names ("MIBET MD
 * T-slot Rail H38.5", "MIBET MA Symmetric Rail H43", "SOEASY Base Rail F43"),
 * so this module reads it out and lets the designer SHORTLIST one system —
 * ICA quotes MIBET MD with T-slot rail (owner, 2026-08-06).
 *
 * `specifications.mounting_series` / `rail_profile` win when an item declares
 * them; otherwise the family is derived from brand + model, so the shortlist
 * works today without a data pass. Filling the specs later changes nothing but
 * the confidence.
 */
import type { DesignCandidate } from './resolve.ts';

export type RailProfile = 't_slot' | 'symmetric' | 'other';

export const RAIL_PROFILE_LABEL: Record<RailProfile, string> = {
  t_slot: 'T-slot',
  symmetric: 'Symmetric',
  other: 'Other profile',
};

const textOf = (c: DesignCandidate) =>
  `${c.supplier_model ?? ''} ${c.internal_description ?? ''}`.replace(/\s+/g, ' ').trim();

/** Brand without the stray whitespace some rows carry ("MIBET\n"). */
export const brandOf = (c: DesignCandidate & { brand?: string | null }): string =>
  (c.brand ?? '').replace(/\s+/g, ' ').trim();

/**
 * The system an item belongs to — "MIBET MD", "MIBET MA", "SOEASY" … The
 * series token is a whole word: "MD" must not match inside "MODULE".
 */
export function seriesOf(c: DesignCandidate & { brand?: string | null }): string {
  const declared = String((c.specifications ?? {}).mounting_series ?? '').trim();
  if (declared) return declared;

  const text = textOf(c);
  const brand = brandOf(c) || (text.split(' ')[0] ?? '');
  for (const token of ['MD', 'MA', 'Mini']) {
    if (new RegExp(`\\b${token}\\b`, 'i').test(text)) return `${brand} ${token}`.trim();
  }
  return brand || 'Unclassified';
}

/** T-slot vs symmetric — only meaningful for rails and their splices. */
export function railProfileOf(c: DesignCandidate): RailProfile {
  const declared = String((c.specifications ?? {}).rail_profile ?? '').trim().toLowerCase();
  if (declared === 't_slot' || declared === 't-slot') return 't_slot';
  if (declared === 'symmetric') return 'symmetric';
  const text = textOf(c);
  if (/t[-\s]?slot/i.test(text)) return 't_slot';
  if (/symmetric/i.test(text)) return 'symmetric';
  return 'other';
}

/** Roles whose part must match the rail's profile, not just its system. */
const PROFILE_SENSITIVE = new Set(['rail', 'rail_joint']);

export interface MountingSystemOption {
  series: string;
  items: number;
  /** Profiles this system's rails actually come in. */
  profiles: RailProfile[];
  /** Rail lengths on the shelf for this system+profile, ascending. */
  railLengths: number[];
}

/** Every system present in the catalog, with what it can actually build. */
export function mountingSystems(candidates: DesignCandidate[], profile?: RailProfile): MountingSystemOption[] {
  const bySeries = new Map<string, DesignCandidate[]>();
  for (const c of candidates) {
    const s = seriesOf(c);
    bySeries.set(s, [...(bySeries.get(s) ?? []), c]);
  }
  return [...bySeries.entries()]
    .map(([series, items]) => {
      const rails = items.filter((c) => String((c.specifications ?? {}).bom_role ?? '') === 'rail');
      const profiles = [...new Set(rails.map(railProfileOf))];
      const lengths = rails
        .filter((c) => !profile || railProfileOf(c) === profile)
        .map((c) => Number((c.specifications ?? {}).rail_length_mm))
        .filter((n) => Number.isFinite(n) && n > 0);
      return {
        series, items: items.length, profiles,
        railLengths: [...new Set(lengths)].sort((a, b) => a - b),
      };
    })
    .sort((a, b) => b.items - a.items || a.series.localeCompare(b.series));
}

/**
 * Narrow the catalog to one system (and, for rails and splices, one profile).
 * An empty series means "any" — the shortlist is a choice, never a cage.
 */
export function shortlist(candidates: DesignCandidate[], series: string, profile?: RailProfile): DesignCandidate[] {
  if (!series) return candidates;
  return candidates.filter((c) => {
    if (seriesOf(c) !== series) return false;
    if (!profile) return true;
    const role = String((c.specifications ?? {}).bom_role ?? '');
    return !PROFILE_SENSITIVE.has(role) || railProfileOf(c) === profile;
  });
}
