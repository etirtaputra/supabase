/**
 * Dolibarr → ICAPROC, batch 0: which Dolibarr records ICAPROC already holds.
 *
 * Owner, 2026-10-27: "which Dolibarr customers, suppliers, items and users
 * already exist in ICAPROC, which are new, and which are 'possible matches'
 * for me to confirm. No writes anywhere."
 *
 * Every Dolibarr row gets ONE of three answers:
 *   - `same`     — ICAPROC holds it; batch 1 only writes the Dolibarr id onto
 *                  that row (never creates a second one);
 *   - `possible` — a person confirms (the candidates and the reason are given);
 *   - `new`      — nothing in ICAPROC resembles it.
 *
 * `same` is deliberately narrow: an exact name once case, punctuation, PT/CV
 * and Bpk/Ibu are set aside, for exactly ONE ICAPROC row, claimed by exactly
 * ONE Dolibarr row. Anything looser is `possible`, because a wrong link in
 * batch 1 would move a customer's history onto someone else.
 *
 * Pure functions: no I/O, no Supabase, no Dolibarr. `scripts/dolibarr-match.ts`
 * feeds it the survey's keys.json and an ICAPROC snapshot.
 */

export type MatchStatus = 'same' | 'possible' | 'new';

export interface Candidate {
  id: string;
  label: string;
  /** 0–1; 1 = the same text once normalised. */
  score: number;
}

export interface Match<S> {
  source: S;
  status: MatchStatus;
  /** The ICAPROC row when `same`; the best guess when `possible`. */
  match: Candidate | null;
  /** Up to three ICAPROC rows a person should look at. */
  candidates: Candidate[];
  /** Plain words, shown to the person confirming. */
  why: string;
}

// ── Text keys ────────────────────────────────────────────────────────────────

const ascii = (s: string) => s.normalize('NFKD').replace(/[̀-ͯ]/g, '');

/** Legal forms: "PT. Abc" and "Abc, PT" are the same party. */
const LEGAL = new Set([
  'pt', 'cv', 'ud', 'tbk', 'persero', 'fa', 'firma', 'koperasi',
  'co', 'ltd', 'limited', 'inc', 'llc', 'corp', 'corporation', 'company', 'pte', 'gmbh', 'plc',
]);
/** Forms of address: "Bpk. Hendrik" is "Hendrik". */
const HONORIFIC = new Set(['bpk', 'bp', 'bapak', 'pak', 'ibu', 'bu', 'mr', 'mrs', 'ms', 'miss', 'sdr', 'sdri', 'tn', 'ny', 'nn']);
/** Spellings that mean the same word. Only for `possible`, never for `same`. */
const FOLD: Record<string, string> = {
  anugerah: 'anugrah', tehnik: 'teknik', tekhnik: 'teknik', technik: 'teknik', tecnic: 'teknik',
  energy: 'energi', enerji: 'energi', technology: 'teknologi', tekhnologi: 'teknologi',
  electric: 'elektrik', electrik: 'elektrik', sejahtra: 'sejahtera', solution: 'solusi', solutions: 'solusi',
};

/** "&", "and" and "dan" are one connective: "Science & Technology" is
 *  "Science and Technology". */
const words = (s: string | null | undefined) =>
  ascii(s ?? '').toLowerCase().replace(/&/g, ' and ').replace(/[^a-z0-9]+/g, ' ').trim().split(' ')
    .filter(Boolean).map((w) => (w === 'dan' ? 'and' : w));

/** Name words without legal forms and forms of address. A name made only of
 *  those ("PT", "Ibu") keeps them, so it still has a key. */
export function nameWords(name: string | null | undefined): string[] {
  const all = words(name);
  const kept = all.filter((w) => !LEGAL.has(w) && !HONORIFIC.has(w));
  return kept.length ? kept : all;
}

/** Exact key: case, punctuation, spacing, PT/CV, Bpk/Ibu set aside. */
export const partyKey = (name: string | null | undefined) => nameWords(name).join(' ');

/** Loose key: also spacing inside words ("Karangmas" = "Karang Mas") and the
 *  spellings in FOLD ("Anugerah" = "Anugrah"). */
export const looseKey = (name: string | null | undefined) => nameWords(name).map((w) => FOLD[w] ?? w).join('');

const bigrams = (s: string) => {
  const out = new Map<string, number>();
  for (let i = 0; i < s.length - 1; i++) {
    const g = s.slice(i, i + 2);
    out.set(g, (out.get(g) ?? 0) + 1);
  }
  return out;
};

/** Dice coefficient over letter pairs, 0–1. Order-sensitive; callers also
 *  compare word-sorted forms so "Mas Karang" still scores. */
export function similarity(a: string, b: string): number {
  if (!a || !b) return 0;
  if (a === b) return 1;
  if (a.length < 2 || b.length < 2) return 0;
  const A = bigrams(a), B = bigrams(b);
  let both = 0;
  for (const [g, n] of A) both += Math.min(n, B.get(g) ?? 0);
  return (2 * both) / (a.length - 1 + b.length - 1);
}

const sortedLoose = (name: string) => nameWords(name).map((w) => FOLD[w] ?? w).sort().join('');

const round2 = (x: number) => Math.round(x * 100) / 100;

// ── Parties: customers and suppliers ─────────────────────────────────────────

export interface Party {
  id: string;
  /** Every name the party goes by (legal name, display name, alias, code). */
  names: string[];
  /** What a person reads in the report. */
  label: string;
}

export interface PartyOptions {
  /** Below this, a similar name is not even worth asking about. */
  threshold?: number;
  /** Words too common to identify a supplier ("technology", "shenzhen"…).
   *  When given, a party whose distinctive words all appear in the other's
   *  name ("EPEVER" ⊂ "Huizhou Epever Technology Co., Ltd.") is `possible`. */
  generic?: Set<string>;
}

const DEFAULT_THRESHOLD = 0.82;

export function matchParties(source: Party[], target: Party[], opts: PartyOptions = {}): Match<Party>[] {
  const threshold = opts.threshold ?? DEFAULT_THRESHOLD;
  const strict = new Map<string, Set<string>>();
  const loose = new Map<string, Set<string>>();
  const byId = new Map(target.map((t) => [t.id, t]));
  const add = (m: Map<string, Set<string>>, k: string, id: string) => {
    if (!k) return;
    if (!m.has(k)) m.set(k, new Set());
    m.get(k)!.add(id);
  };
  const prepared = target.map((t) => ({
    t,
    loose: t.names.map(looseKey).filter(Boolean),
    sorted: t.names.map(sortedLoose).filter(Boolean),
    distinctive: new Set(t.names.flatMap((n) => nameWords(n).map((w) => FOLD[w] ?? w)).filter((w) => !opts.generic?.has(w))),
  }));
  for (const t of target) {
    for (const n of t.names) {
      add(strict, partyKey(n), t.id);
      add(loose, looseKey(n), t.id);
    }
  }
  const cand = (id: string, score: number): Candidate => ({ id, label: byId.get(id)!.label, score: round2(score) });

  const out: Match<Party>[] = source.map((s) => {
    const hits = new Set<string>();
    for (const n of s.names) for (const id of strict.get(partyKey(n)) ?? []) hits.add(id);
    if (hits.size === 1) {
      const c = cand([...hits][0], 1);
      return { source: s, status: 'same', match: c, candidates: [c], why: 'Nama sama' };
    }
    if (hits.size > 1) {
      const cs = [...hits].map((id) => cand(id, 1));
      return { source: s, status: 'possible', match: cs[0], candidates: cs.slice(0, 3), why: `${hits.size} baris ICAPROC bernama sama` };
    }
    const looseHits = new Set<string>();
    for (const n of s.names) for (const id of loose.get(looseKey(n)) ?? []) looseHits.add(id);
    if (looseHits.size) {
      const cs = [...looseHits].map((id) => cand(id, 0.97));
      return { source: s, status: 'possible', match: cs[0], candidates: cs.slice(0, 3), why: 'Nama sama, beda spasi atau ejaan' };
    }
    const sLoose = s.names.map(looseKey).filter(Boolean);
    const sSorted = s.names.map(sortedLoose).filter(Boolean);
    const sWords = new Set(s.names.flatMap((n) => nameWords(n).map((w) => FOLD[w] ?? w)).filter((w) => !opts.generic?.has(w)));
    const scored: Candidate[] = [];
    let contained: string | null = null;
    for (const p of prepared) {
      let best = 0;
      for (const a of sLoose) for (const b of p.loose) best = Math.max(best, similarity(a, b));
      for (const a of sSorted) for (const b of p.sorted) best = Math.max(best, similarity(a, b));
      if (opts.generic && sWords.size && p.distinctive.size) {
        const [small, big] = sWords.size <= p.distinctive.size ? [sWords, p.distinctive] : [p.distinctive, sWords];
        const inside = [...small].every((w) => big.has(w)) && [...small].some((w) => w.length >= 4);
        if (inside && best < threshold) { best = threshold; contained = p.t.id; }
      }
      if (best >= threshold) scored.push(cand(p.t.id, best));
    }
    if (!scored.length) return { source: s, status: 'new', match: null, candidates: [], why: 'Tidak ada yang mirip di ICAPROC' };
    scored.sort((a, b) => b.score - a.score || a.label.localeCompare(b.label));
    const why = contained === scored[0].id && scored[0].score === round2(threshold)
      ? 'Nama yang satu termuat di nama yang lain'
      : `Nama mirip (${Math.round(scored[0].score * 100)}%)`;
    return { source: s, status: 'possible', match: scored[0], candidates: scored.slice(0, 3), why };
  });

  return claimOnce(out);
}

/** An ICAPROC row can carry ONE Dolibarr id. When two Dolibarr rows land on
 *  the same ICAPROC row as `same`, neither is sure any more. */
function claimOnce<S>(out: Match<S>[]): Match<S>[] {
  const claims = new Map<string, number>();
  for (const m of out) if (m.status === 'same' && m.match) claims.set(m.match.id, (claims.get(m.match.id) ?? 0) + 1);
  return out.map((m) => (m.status === 'same' && m.match && claims.get(m.match.id)! > 1
    ? { ...m, status: 'possible', why: `${claims.get(m.match.id)} baris Dolibarr menunjuk baris ICAPROC yang sama` }
    : m));
}

/** Placeholders, not customers: "13213", "(UNTUK AFTER SALES SERVICE)".
 *  Dolibarr needs a third party on every document, so internal work gets one. */
export function looksInternal(name: string | null | undefined): boolean {
  const n = (name ?? '').trim();
  return n === '' || /^[\d\s.\-]+$/.test(n) || /^\(.*\)$/.test(n);
}

/** ICAPROC rows no Dolibarr row matched or might match. */
export function unclaimed<S>(target: Party[], matches: Match<S>[]): Party[] {
  const seen = new Set<string>();
  for (const m of matches) for (const c of m.candidates) seen.add(c.id);
  return target.filter((t) => !seen.has(t.id));
}

/** Groups of rows on ONE side that look like the same party (exact or loose
 *  key). Batch 1 cannot link a Dolibarr id to two ICAPROC rows, so these are
 *  for the owner to merge or keep apart first. */
export function lookAlikes(rows: Party[]): Party[][] {
  const groups = new Map<string, Party[]>();
  for (const r of rows) {
    const keys = new Set(r.names.map(looseKey).filter(Boolean));
    for (const k of keys) {
      if (!groups.has(k)) groups.set(k, []);
      groups.get(k)!.push(r);
    }
  }
  const seen = new Set<string>();
  const out: Party[][] = [];
  for (const g of groups.values()) {
    const uniq = [...new Map(g.map((r) => [r.id, r])).values()];
    if (uniq.length < 2) continue;
    const sig = uniq.map((r) => r.id).sort().join('|');
    if (seen.has(sig)) continue;
    seen.add(sig);
    out.push(uniq);
  }
  return out;
}

// ── Items ────────────────────────────────────────────────────────────────────

export interface DolibarrItem { id: string; ref: string; label: string; service?: boolean }
export interface IcaprocItem { id: string; model: string; brand: string | null }

/** Text without case, spacing or punctuation; "mm²" = "mm2". */
export const compact = (s: string | null | undefined) =>
  ascii((s ?? '').replace(/²/g, '2').replace(/³/g, '3')).toLowerCase().replace(/[^a-z0-9]/g, '');

const UNIT = /^\d+(?:[.,]\d+)?(?:a|v|w|kw|kwp|wp|kva|va|ah|kwh|wh|mm|mm2|cm|m|hp|p|kv|mw|vac|vdc|x)$/i;

/** Ratings stated in a name ("60A", "2P", "600V", "25 mm²"), normalised.
 *  Two items with the same model code but a different rating are different
 *  items (an MCB 25A is not an MCB 32A). */
export function ratings(s: string): Set<string> {
  const t = ascii(s.replace(/²/g, '2')).toLowerCase().replace(/(\d)\s+(mm2|mm|kva|kwp|kwh|kw|wp|ah|va|v|a|w|hp)\b/g, '$1$2');
  return new Set(t.split(/[^a-z0-9.,]+/).map((w) => w.replace(/,/g, '.')).filter((w) => UNIT.test(w)));
}

/** Lengths and heights ("L3600mm", "H43"), and alloy grades ("AL6005-T5",
 *  on 44 MIBET items): they describe, they do not identify. */
const DIMENSION = /^[LHWDT]\d+(?:MM|CM|M)?$/;
const MATERIAL = /^(?:AL|SUS|SS)\d{3,4}(?:T\d+)?$/;

/** Model codes in a name or ref: words with letters AND digits, five or more
 *  characters once dashes are dropped, that are not ratings. "EPEVER
 *  IT6420NC-G3 MPPT 60A" → {IT6420NCG3}. Underscores split (Dolibarr refs). */
export function modelCodes(s: string): Set<string> {
  const out = new Set<string>();
  for (const raw of ascii(s).split(/[\s_(),[\]+]+/)) {
    const w = raw.replace(/[-./]/g, '').toUpperCase();
    if (w.length >= 5 && /[A-Z]/.test(w) && /\d/.test(w) && !UNIT.test(w) && !DIMENSION.test(w) && !MATERIAL.test(w)) out.add(w);
  }
  return out;
}

const COMMON_CODE = 20;

const sameSet = (a: Set<string>, b: Set<string>) => a.size === b.size && [...a].every((x) => b.has(x));

/** Cable sizes written one way. Dolibarr says "Kabel NYAF 1 x 185mm", ICAPROC
 *  "Kabel NYAF 185 mm²" (and "NYY 1 x 185 mm²"): a single core drops "1 x",
 *  and a cross-section is always mm². Only for cables — "L35/40mm" on a clamp
 *  is a length. */
export function itemName(s: string): string {
  if (!/\b(kabel|cable)\b/i.test(s)) return s;
  return s.replace(/²/g, '2').replace(/\b1\s*x\s*(?=\d)/gi, '').replace(/(\d)\s*mm2?\b/gi, '$1 mm2');
}

export function matchItems(source: DolibarrItem[], target: IcaprocItem[], threshold = 0.85): Match<DolibarrItem>[] {
  const byCompact = new Map<string, IcaprocItem[]>();
  const byBrandless = new Map<string, IcaprocItem[]>();
  const byCode = new Map<string, IcaprocItem[]>();
  const brandOf = new Map<string, string>();
  const push = <K>(m: Map<K, IcaprocItem[]>, k: K, t: IcaprocItem) => {
    if (!m.has(k)) m.set(k, []);
    if (!m.get(k)!.includes(t)) m.get(k)!.push(t);
  };
  const info = new Map<string, { codes: Set<string>; ratings: Set<string>; sorted: string; name: string }>();
  for (const t0 of target) {
    const t = { ...t0, model: itemName(t0.model) };
    const c = compact(t.model);
    if (c) push(byCompact, c, t0);
    const brand = compact(t.brand);
    if (brand && c.startsWith(brand) && c.length > brand.length + 3) push(byBrandless, c.slice(brand.length), t0);
    const codes = modelCodes(t.model);
    for (const code of codes) push(byCode, code, t0);
    brandOf.set(t.id, compact(t.brand));
    info.set(t.id, { codes, ratings: ratings(t.model), sorted: words(t.model).sort().join(''), name: c });
  }
  // A code on more than COMMON items names a family, not an item.
  for (const [code, ts] of byCode) if (ts.length > COMMON_CODE) byCode.delete(code);
  const cand = (t: IcaprocItem, score: number): Candidate => ({ id: t.id, label: t.model, score: round2(score) });

  const out = source.map((s0): Match<DolibarrItem> => {
    const s = { ...s0, label: itemName(s0.label) };
    const keys = [compact(s.label), compact(s.ref)].filter((k) => k.length >= 4);
    const exact = [...new Set(keys.flatMap((k) => byCompact.get(k) ?? []))];
    if (exact.length === 1) {
      const c = cand(exact[0], 1);
      return { source: s, status: 'same', match: c, candidates: [c], why: 'Nama barang sama' };
    }
    if (exact.length > 1) {
      const cs = exact.map((t) => cand(t, 1));
      return { source: s, status: 'possible', match: cs[0], candidates: cs.slice(0, 3), why: `${exact.length} barang ICAPROC bernama sama` };
    }
    const sorted = words(s.label).sort().join('');
    const textScore = (t: IcaprocItem) => Math.max(similarity(compact(s.label), info.get(t.id)!.name), similarity(sorted, info.get(t.id)!.sorted));

    const brandless = [...new Set(keys.flatMap((k) => byBrandless.get(k) ?? []))];
    if (brandless.length) {
      const cs = brandless.map((t) => cand(t, 0.95));
      return { source: s, status: 'possible', match: cs[0], candidates: cs.slice(0, 3), why: brandless.length > 1 ? `Sama tanpa merek; ${brandless.length} merek di ICAPROC` : 'Sama, tapi merek tidak disebut di Dolibarr' };
    }

    const sCodes = new Set([...modelCodes(s.ref), ...modelCodes(s.label)]);
    const sRatings = ratings(s.label);
    const byCodeHits = [...new Set([...sCodes].flatMap((c) => byCode.get(c) ?? []))];
    if (byCodeHits.length) {
      const ranked = byCodeHits.map((t) => ({ t, score: textScore(t) })).sort((a, b) => b.score - a.score);
      const full = ranked.filter(({ t }) => {
        const tc = info.get(t.id)!.codes;
        const labelCodes = modelCodes(s.label);
        return sameSet(tc, labelCodes.size ? labelCodes : sCodes);
      });
      const top = full[0];
      if (full.length === 1 && [...info.get(top.t.id)!.codes].some((c) => c.length >= 6)) {
        const tr = info.get(top.t.id)!.ratings;
        const ratingClash = sRatings.size > 0 && tr.size > 0 && !sameSet(sRatings, tr);
        const brand = brandOf.get(top.t.id) ?? '';
        const brandUnsaid = brand !== '' && !compact(s.label).includes(brand);
        if (!ratingClash && brandUnsaid) {
          const c = cand(top.t, top.score);
          return { source: s, status: 'possible', match: c, candidates: [c], why: 'Kode model sama, merek tidak disebut' };
        }
        if (!ratingClash) {
          const c = cand(top.t, Math.max(top.score, 0.9));
          return { source: s, status: 'same', match: c, candidates: [c], why: 'Kode model sama' };
        }
        const cs = ranked.slice(0, 3).map(({ t, score }) => cand(t, score));
        return { source: s, status: 'possible', match: cand(top.t, top.score), candidates: cs, why: 'Kode model sama, rating berbeda' };
      }
      const cs = ranked.slice(0, 3).map(({ t, score }) => cand(t, score));
      return { source: s, status: 'possible', match: cs[0], candidates: cs, why: ranked.length > 1 ? `Kode model ada di ${ranked.length} barang ICAPROC` : 'Kode model mirip' };
    }

    // A code that starts the other ("…P65L2GF40" / "…P65L2GF40-Colombia").
    const prefixHits = new Set<IcaprocItem>();
    for (const code of sCodes) {
      if (code.length < 6) continue;
      for (const [tc, ts] of byCode) {
        if (tc.length >= 6 && (tc.startsWith(code) || code.startsWith(tc))) ts.forEach((t) => prefixHits.add(t));
      }
    }
    if (prefixHits.size) {
      const ranked = [...prefixHits].map((t) => ({ t, score: textScore(t) })).sort((a, b) => b.score - a.score);
      const cs = ranked.slice(0, 3).map(({ t, score }) => cand(t, score));
      return { source: s, status: 'possible', match: cs[0], candidates: cs, why: 'Kode model mirip (awalnya sama)' };
    }

    const scored = target.map((t) => ({ t, score: textScore(t) })).filter((x) => x.score >= threshold).sort((a, b) => b.score - a.score);
    if (scored.length) {
      const cs = scored.slice(0, 3).map(({ t, score }) => cand(t, score));
      return { source: s, status: 'possible', match: cs[0], candidates: cs, why: `Nama mirip (${Math.round(cs[0].score * 100)}%)` };
    }
    return { source: s, status: 'new', match: null, candidates: [], why: 'Tidak ada yang mirip di ICAPROC' };
  });

  return claimOnce(out.map((m, i) => ({ ...m, source: source[i] })));
}

// ── Users ────────────────────────────────────────────────────────────────────

export interface DolibarrUser { login: string; name: string; email: string | null }
export interface IcaprocUser { email: string; name: string | null; role: string }

export function matchUsers(source: DolibarrUser[], target: IcaprocUser[]): Match<DolibarrUser>[] {
  const lower = (s: string | null | undefined) => (s ?? '').trim().toLowerCase();
  const cand = (u: IcaprocUser, score: number): Candidate => ({ id: u.email, label: u.name ? `${u.name} <${u.email}>` : u.email, score });
  const out = source.map((s): Match<DolibarrUser> => {
    const byEmail = target.find((u) => lower(u.email) === lower(s.email) && lower(s.email));
    if (byEmail) {
      const c = cand(byEmail, 1);
      return { source: s, status: 'same', match: c, candidates: [c], why: 'Email sama' };
    }
    const sName = partyKey(s.name);
    const sWords = new Set(nameWords(s.name));
    const login = lower(s.login);
    const hits: Array<{ u: IcaprocUser; why: string; score: number }> = [];
    for (const u of target) {
      const local = lower(u.email).split('@')[0];
      if (sName && u.name && partyKey(u.name) === sName) hits.push({ u, why: 'Nama sama, email berbeda', score: 0.95 });
      else if (login && (local === login || local.replace(/[^a-z0-9]/g, '') === login.replace(/[^a-z0-9]/g, ''))) hits.push({ u, why: 'Login Dolibarr = nama email ICAPROC', score: 0.9 });
      else if (u.name) {
        const uWords = nameWords(u.name);
        const shared = uWords.filter((w) => w.length >= 3 && sWords.has(w));
        if (shared.length && (shared.length === uWords.length || shared.length === sWords.size)) hits.push({ u, why: 'Sebagian nama sama', score: 0.8 });
      }
    }
    if (!hits.length) return { source: s, status: 'new', match: null, candidates: [], why: 'Belum punya akun ICAPROC' };
    hits.sort((a, b) => b.score - a.score);
    const cs = hits.slice(0, 3).map((h) => cand(h.u, h.score));
    return { source: s, status: 'possible', match: cs[0], candidates: cs, why: hits[0].why };
  });
  return claimOnce(out);
}

// ── Summary ──────────────────────────────────────────────────────────────────

export function tally<S>(matches: Match<S>[]): Record<MatchStatus, number> {
  const t: Record<MatchStatus, number> = { same: 0, possible: 0, new: 0 };
  for (const m of matches) t[m.status]++;
  return t;
}
