/**
 * Description libraries (EPC 10.4, Sales 22.2): search, near-duplicates and
 * the "this should be a catalogue item" check — shared by both editors'
 * autocomplete and both library screens (owner, 2026-11-04).
 *
 * `libNorm` mirrors the database's `lib_norm()` (case, punctuation and
 * spacing set aside), which decides what is "the same wording": the editor
 * must never disagree with the trigger that links the line.
 *
 * Pure functions, no I/O.
 */
import { similarity } from './dolibarrMatch.ts';

export interface LibEntryLite {
  entry_id: string;
  description: string;
  brand?: string | null;
  aliases?: string[] | null;
  status?: string | null;
  uses?: number | null;
  last_used?: string | null;
}

/** Same rule as SQL lib_norm(): lowercase, non-alphanumerics → one space. */
export const libNorm = (s: string | null | undefined): string =>
  (s ?? '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

const words = (s: string) => libNorm(s).split(' ').filter(Boolean);
const compactOf = (s: string) => libNorm(s).replace(/ /g, '');
const sortedOf = (s: string) => words(s).sort().join('');

/**
 * Two wordings that differ in a rating or a variant are different ITEMS, not
 * duplicates, however alike they read: "AC MCB 1P 25A" / "AC MCB 1P 32A",
 * "Kabel NYA 6 mm²" / "Kabel NYA 300 mm²", "… Phase 1" / "… Phase 2", "AC …" /
 * "DC …", "SNV-GT" / "SNV-GH", "NYA 150mm" / "NYY 150mm". Found in the real
 * library (2026-11-04): without this, 40 of the 65 "similar" groups were
 * neighbours in a product range.
 */
export function differentItems(a: string, b: string): boolean {
  const nums = (s: string) => (libNorm(s).match(/\d+/g) ?? []).sort().join(',');
  const na = nums(a), nb = nums(b);
  if (na && nb && na !== nb) return true;
  const filler = new Set(['and', 'dan', 'the', 'of', 'for', 'with', 'w', 'c', 'n', 'dll', 'etc', 'acc']);
  const wa = new Set(words(a).filter((w) => !filler.has(w))), wb = new Set(words(b).filter((w) => !filler.has(w)));
  const diff = [...wa].filter((w) => !wb.has(w)).concat([...wb].filter((w) => !wa.has(w)));
  return diff.length > 0 && diff.every((w) => w.length <= 3);
}

/** 0–1: how alike two wordings are, word order and spacing aside. */
export function wordingSimilarity(a: string, b: string): number {
  const na = libNorm(a), nb = libNorm(b);
  if (!na || !nb) return 0;
  if (na === nb) return 1;
  return Math.max(similarity(compactOf(a), compactOf(b)), similarity(sortedOf(a), sortedOf(b)));
}

/**
 * Entries matching what was typed, best first: every typed word appears
 * (any order) in the wording, its brand or a merged spelling. Rank: starts
 * with the query › contains it as a phrase › all words; then most used, most
 * recent, A–Z. Approved entries before proposed ones at equal rank.
 */
export function rankLibrary<T extends LibEntryLite>(entries: T[], query: string, limit = 8): { shown: T[]; total: number } {
  const q = libNorm(query);
  const qw = q.split(' ').filter(Boolean);
  if (!qw.length) return { shown: [], total: 0 };
  const scored: { e: T; rank: number }[] = [];
  for (const e of entries) {
    const desc = libNorm(e.description);
    const hay = [desc, libNorm(e.brand), ...(e.aliases ?? []).map(libNorm)].join(' | ');
    if (!qw.every((w) => hay.includes(w))) continue;
    const alias = (e.aliases ?? []).map(libNorm);
    const rank = desc.startsWith(q) || alias.some((a) => a.startsWith(q)) ? 3
      : desc.includes(q) || alias.some((a) => a.includes(q)) ? 2 : 1;
    scored.push({ e, rank });
  }
  scored.sort((a, b) => b.rank - a.rank
    || Number(a.e.status === 'proposed') - Number(b.e.status === 'proposed')
    || (b.e.uses ?? 0) - (a.e.uses ?? 0)
    || (b.e.last_used ?? '').localeCompare(a.e.last_used ?? '')
    || a.e.description.localeCompare(b.e.description));
  return { shown: scored.slice(0, limit).map((s) => s.e), total: scored.length };
}

/** The entry this wording already IS (same normalised words, or a merged spelling). */
export function exactEntry<T extends LibEntryLite>(entries: T[], text: string): T | null {
  const k = libNorm(text);
  if (k.length < 3) return null;
  return entries.find((e) => libNorm(e.description) === k)
    ?? entries.find((e) => (e.aliases ?? []).some((a) => libNorm(a) === k)) ?? null;
}

/**
 * "Did you mean…?" — entries close to a wording that is NOT already one of
 * them, closest first. Used while typing a new line and in the review queue.
 */
export function nearEntries<T extends LibEntryLite>(entries: T[], text: string, threshold = 0.85, limit = 3): { entry: T; score: number }[] {
  const k = libNorm(text);
  if (k.length < 4) return [];
  const out: { entry: T; score: number }[] = [];
  for (const e of entries) {
    if (libNorm(e.description) === k || differentItems(text, e.description)) continue;
    const score = Math.max(wordingSimilarity(text, e.description),
      ...(e.aliases ?? []).map((a) => wordingSimilarity(text, a)), 0);
    if (score >= threshold && score < 1) out.push({ entry: e, score });
  }
  return out.sort((a, b) => b.score - a.score || (b.entry.uses ?? 0) - (a.entry.uses ?? 0)).slice(0, limit);
}

/**
 * Groups of entries that are probably one wording ("Equipment transport" /
 * "Equipment Transpot"), for the owner to merge. Only entries sharing a word
 * of 3+ letters are compared, so 500 entries stay instant.
 */
export function similarGroups<T extends LibEntryLite>(entries: T[], threshold = 0.85): T[][] {
  const parent = entries.map((_, i) => i);
  const find = (i: number): number => (parent[i] === i ? i : (parent[i] = find(parent[i])));
  const byWord = new Map<string, number[]>();
  entries.forEach((e, i) => {
    for (const w of new Set(words(e.description).filter((x) => x.length >= 3))) {
      if (!byWord.has(w)) byWord.set(w, []);
      byWord.get(w)!.push(i);
    }
  });
  const seen = new Set<string>();
  for (const idx of byWord.values()) {
    if (idx.length > 60) continue;              // a word that common ("cable") says nothing
    for (let a = 0; a < idx.length; a++) {
      for (let b = a + 1; b < idx.length; b++) {
        const i = idx[a], j = idx[b], key = i < j ? `${i}:${j}` : `${j}:${i}`;
        if (seen.has(key)) continue;
        seen.add(key);
        const da = entries[i].description, db = entries[j].description;
        if (!differentItems(da, db) && wordingSimilarity(da, db) >= threshold) parent[find(i)] = find(j);
      }
    }
  }
  const groups = new Map<number, T[]>();
  entries.forEach((e, i) => {
    const r = find(i);
    if (!groups.has(r)) groups.set(r, []);
    groups.get(r)!.push(e);
  });
  return [...groups.values()].filter((g) => g.length > 1)
    .map((g) => g.sort((a, b) => (b.uses ?? 0) - (a.uses ?? 0)))
    .sort((a, b) => b.reduce((s, e) => s + (e.uses ?? 0), 0) - a.reduce((s, e) => s + (e.uses ?? 0), 0));
}

export type MainKind = 'panel' | 'inverter' | 'battery';

/**
 * A main component typed as free text — its price then goes unmonitored
 * (owner: "solar panels ... batteries ... those are items we would like to
 * monitor for its prices"). Deliberately narrow: a rating must be stated, so
 * "Cable Jumper Battery", "Support Inverter" or "Battery Rack" are accessories.
 */
export function mainComponentKind(text: string): MainKind | null {
  const t = (text ?? '').toLowerCase();
  // A panel states its Wp; "PV module" alone is as often a service line
  // ("Material Unloading PV Module and Inverter").
  if (/\b\d{2,4}(\.\d+)?\s?wp\b/.test(t)) return 'panel';
  if (/\b(inverter|pcs|hybrid|on-?grid|\d+ktl)/.test(t) && /\b\d+(\.\d+)?\s?k(w|va)\b/.test(t)) return 'inverter';
  if (/\b\d+(\.\d+)?\s?kwh\b/.test(t)) return 'battery';
  if (/\b(lifepo4|battery|baterai|bess)\b/.test(t) && /\b\d+(\.\d+)?\s?ah\b/.test(t)) return 'battery';
  return null;
}

/**
 * Every message the library_* functions can refuse with
 * (migrations/description_libraries_v2.sql), so the screens can show it in
 * Indonesian. lib/libraryMatch.test.ts fails when the SQL gains one that is
 * not listed here.
 */
export const LIBRARY_SERVER_MESSAGES = [
  'Already in the library',
  'Already undone',
  'An undo cannot be undone — make the change again',
  'Another entry already has that wording — merge them instead',
  'Description too short',
  'Entry not found',
  'Log entry not found',
  'Merge target not found or archived',
  'Nothing to merge',
  'Only the owner approves library entries',
  'Only the owner archives library entries',
  'Only the owner edits library entries',
  'Only the owner merges library entries',
  'Only the owner undoes library changes',
  'Your role may not add to this library',
] as const;

/** A server refusal as a phrase-book key plus its values, for tf(). */
export function libraryErrorKey(message: string): { key: string; vars: Record<string, string> } {
  const later = /^A later change \(#(\d+)\) touched the same entries/.exec(message);
  if (later) return { key: 'A later change (#{n}) touched the same entries — undo that first', vars: { n: later[1] } };
  return { key: message, vars: {} };
}
