import type { SupabaseClient } from '@supabase/supabase-js';

/**
 * Margin profiles — what a category is SUPPOSED to earn (`21.2_margin_profiles`).
 *
 * The owner's spec (2026-08-27): commodity items ("Loss Leader") win the deal
 * on a thin margin; technical items ("Value Capture") fund the overall margin
 * and pay for the after-sales burden they create.
 *
 * THE TARGETS ARE DATA. Nothing here hardcodes 10–15 or 20–25 — an admin moves
 * the bands on /pricing and every screen follows without a deploy. That was an
 * explicit requirement, and it is why `bandOf()` takes the profile rather than
 * looking anything up.
 *
 * UNCLASSIFIED IS A REAL ANSWER, not a missing one. An item with no profile is
 * NOT quietly treated as either tier: 693 of 990 items are unclassified today,
 * and the Item Editor says so out loud so the gap can be closed deliberately.
 */
export interface MarginProfile {
  id: string;
  code: string;
  label: string;
  margin_target_min: number;
  margin_target_max: number;
  description: string | null;
}

const COLS = 'id, code, label, margin_target_min, margin_target_max, description';

/** Where a margin sits against its profile's band. */
export type MarginStanding = 'unclassified' | 'below' | 'within' | 'above';

/**
 * Judge one margin against one profile.
 *
 * `below` is the one that costs money and is what the soft warning is for.
 * `above` is reported too but is not a fault — beating the target is fine, and
 * the caller decides whether to mention it.
 *
 * No profile means `unclassified`: we do not know what this item should earn,
 * so we must not claim it is doing well or badly.
 */
export function standingOf(marginPct: number | null | undefined, profile: MarginProfile | null | undefined): MarginStanding {
  if (!profile) return 'unclassified';
  if (marginPct == null || !Number.isFinite(marginPct)) return 'unclassified';
  if (marginPct < Number(profile.margin_target_min)) return 'below';
  if (marginPct > Number(profile.margin_target_max)) return 'above';
  return 'within';
}

/** "10–15%" — the band as a person reads it. Built from the row, never fixed. */
export const bandOf = (p: MarginProfile): string =>
  `${trimPct(p.margin_target_min)}–${trimPct(p.margin_target_max)}%`;

/** 10.00 → "10", 12.50 → "12,5" is the formatter's job; here just drop ".00". */
const trimPct = (n: number | string): string => {
  const v = Number(n);
  return Number.isInteger(v) ? String(v) : String(v).replace(/0+$/, '');
};

/** Is this a range a person could have meant? The DB enforces it too. */
export function rangeError(min: number, max: number): string | null {
  if (!Number.isFinite(min) || !Number.isFinite(max)) return 'Both ends of the range need a number.';
  if (min < 0 || max > 100) return 'A margin target sits between 0 and 100%.';
  if (min > max) return 'The lowest target cannot be above the highest.';
  return null;
}

/** Profiles, cheapest band first, so the list reads as a ladder. */
export async function fetchMarginProfiles(supabase: SupabaseClient): Promise<MarginProfile[]> {
  const { data, error } = await supabase
    .from('21.2_margin_profiles').select(COLS).order('margin_target_min', { ascending: true });
  if (error) return [];
  return (data ?? []) as unknown as MarginProfile[];
}

/** Index them by id — what every list needs to turn a column into a label. */
export const byId = (profiles: MarginProfile[]): Map<string, MarginProfile> =>
  new Map(profiles.map((p) => [p.id, p]));

export async function saveMarginProfile(
  supabase: SupabaseClient, id: string,
  patch: Partial<Pick<MarginProfile, 'label' | 'margin_target_min' | 'margin_target_max' | 'description'>>,
): Promise<boolean> {
  const { error } = await supabase
    .from('21.2_margin_profiles').update({ ...patch, updated_at: new Date().toISOString() }).eq('id', id);
  return !error;
}

export async function createMarginProfile(
  supabase: SupabaseClient, row: Omit<MarginProfile, 'id'>,
): Promise<MarginProfile | null> {
  const { data, error } = await supabase
    .from('21.2_margin_profiles').insert(row).select(COLS).single();
  if (error) return null;
  return data as unknown as MarginProfile;
}

export async function deleteMarginProfile(supabase: SupabaseClient, id: string): Promise<boolean> {
  const { error } = await supabase.from('21.2_margin_profiles').delete().eq('id', id);
  return !error;
}

/**
 * Put many items on one profile (or clear them, with null).
 *
 * Bulk, because classifying 603 unclassified items one row at a time is not a
 * job anybody finishes (owner's ask, 2026-08-27).
 */
export async function assignProfile(
  supabase: SupabaseClient, componentIds: string[], profileId: string | null,
): Promise<boolean> {
  if (componentIds.length === 0) return true;
  const { error } = await supabase
    .from('3.0_components').update({ margin_profile_id: profileId }).in('component_id', componentIds);
  return !error;
}
