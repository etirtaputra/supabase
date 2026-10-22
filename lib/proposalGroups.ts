/**
 * The EPC proposal list, organised by CUSTOMER → proposal → its versions.
 *
 * Measured 2026-10-02: 81 proposals in three months, 72 of them "sent", all
 * shown in one status pile. Most of the pile was versions of the same deal —
 * Imigrasi 31, Ayana 10, IRC Inoac 5 (REV, REV2, REV3) — and people had begun
 * typing notes into the NUMBER to tell versions apart
 * ("Q-20260724-RVSP (battery from AYANA)"). So the list groups by customer,
 * folds every version of one proposal under its newest, and shows only what is
 * live unless asked ("Archive").
 *
 * Read-side only: no column was added. A version is recognised by its number,
 * which `nextRevisionNumber` in app/proposals/page.tsx has always built as
 * `<base>-REV`, `-REV2`… on top of the house format `Q-YYYYMMDD-XXXX`.
 */
import { normField } from './proposalFields.ts';

export interface GroupableQuote {
  quote_id: string;
  quote_number?: string | null;
  customer_name?: string | null;
  status: string;
  created_at?: string | null;
  updated_at?: string | null;
  quote_date?: string | null;
  location?: string | null;
  project_description?: string | null;
  project_type?: string | null;
}

/** A sent proposal untouched for longer than this leaves the Active view. */
export const ACTIVE_DAYS = 60;

/**
 * The proposal a number belongs to: the house `Q-YYYYMMDD-XXXX` stem, so
 * `-REV`, `-REV2` and anything typed after it are versions of the same one.
 * A number in some other shape is its own proposal, minus any -REV suffix.
 */
export function familyKey(q: Pick<GroupableQuote, 'quote_id' | 'quote_number'>): string {
  const n = (q.quote_number ?? '').trim();
  if (!n) return `id:${q.quote_id}`;
  const stem = n.match(/^Q-\d{8}-[A-Z0-9]{4}/i);
  if (stem) return stem[0].toUpperCase();
  return n.replace(/-REV\d*\b.*$/i, '').toUpperCase() || `id:${q.quote_id}`;
}

/**
 * What a proposal is ABOUT: its site, unless the site only repeats the
 * customer, else its description — the same rule the list uses for the card
 * title. Empty when there is nothing to go on.
 */
export function titleKey(q: Pick<GroupableQuote, 'customer_name' | 'location' | 'project_description'>): string {
  const site = normField(q.location ?? '');
  if (site && site !== normField(q.customer_name ?? '')) return site;
  return normField(q.project_description ?? '');
}

/** One customer however it was typed — case, punctuation and spacing aside. */
export function customerKey(name: string | null | undefined): string {
  return normField(name ?? '') || '';
}

const activityOf = (q: GroupableQuote) => q.updated_at || q.created_at || '';

export interface ProposalFamily<Q extends GroupableQuote> {
  key: string;
  latest: Q;
  /** Every other version, newest first. */
  older: Q[];
  lastActivity: string;
  active: boolean;
}

export interface StatusCounts { total: number; draft: number; sent: number; won: number; rejected: number }

export interface CustomerGroup<Q extends GroupableQuote> {
  key: string;
  /** The most recent spelling of the customer's name. */
  name: string;
  families: ProposalFamily<Q>[];
  /** Over EVERY proposal of this customer, whatever the view or filter. */
  counts: StatusCounts;
  lastActivity: string;
}

export function countStatuses(qs: GroupableQuote[]): StatusCounts {
  const c: StatusCounts = { total: qs.length, draft: 0, sent: 0, won: 0, rejected: 0 };
  for (const q of qs) {
    if (q.status === 'draft') c.draft += 1;
    else if (q.status === 'sent') c.sent += 1;
    else if (q.status === 'accepted') c.won += 1;   // "accepted" is the editor's word for a won proposal
    else if (q.status === 'rejected') c.rejected += 1;
  }
  return c;
}

/**
 * Is this proposal still in play? Its newest version is a draft, or was sent
 * within ACTIVE_DAYS, or someone left a follow-up note on any version that is
 * still open — a live "waiting on the customer" never hides.
 */
export function isActive(latest: GroupableQuote, members: GroupableQuote[], hasOpenNote: (id: string) => boolean, now: number): boolean {
  if (members.some((m) => hasOpenNote(m.quote_id))) return true;
  if (latest.status === 'draft') return true;
  if (latest.status !== 'sent') return false;
  const t = Date.parse(activityOf(latest));
  return Number.isFinite(t) && now - t <= ACTIVE_DAYS * 86_400_000;
}

/**
 * Customers, newest activity first; inside each, proposals newest first, each
 * carrying its older versions. Built from ALL quotes so versions and counts
 * never depend on a filter; `show` then decides which proposals appear.
 */
export function groupProposals<Q extends GroupableQuote>(
  quotes: Q[],
  opts: {
    hasOpenNote?: (quoteId: string) => boolean;
    /** Which proposals to list — given the family; default all. */
    show?: (f: ProposalFamily<Q>) => boolean;
    now?: number;
  } = {},
): CustomerGroup<Q>[] {
  const hasOpenNote = opts.hasOpenNote ?? (() => false);
  const now = opts.now ?? Date.now();

  const byCustomer = new Map<string, Q[]>();
  for (const q of quotes) {
    const k = customerKey(q.customer_name);
    const arr = byCustomer.get(k) ?? [];
    arr.push(q);
    byCustomer.set(k, arr);
  }

  const groups: CustomerGroup<Q>[] = [];
  for (const [key, members] of byCustomer) {
    // Versions share a number stem — OR, for one customer, the same title and
    // project type (owner, 2026-10-22: the newest "Atap BOH & Atap Ballroom
    // AYANA BALI" was numbered Q-20260724-R4-PV+BESS_SBO, off the house
    // pattern, and stood apart from its three older versions). A number
    // family and a title family that meet are one proposal.
    const byNumber = new Map<string, Q[]>();
    for (const q of members) {
      const fk = familyKey(q);
      (byNumber.get(fk) ?? byNumber.set(fk, []).get(fk)!).push(q);
    }
    const parent = new Map<string, string>([...byNumber.keys()].map((k) => [k, k]));
    const root = (k: string): string => { let r = k; while (parent.get(r) !== r) r = parent.get(r)!; return r; };
    const firstWithTitle = new Map<string, string>();
    for (const [fk, vs] of byNumber) {
      for (const q of vs) {
        const t = titleKey(q);
        if (!t) continue;
        const tk = `${t}|${q.project_type || 'custom'}`;
        const other = firstWithTitle.get(tk);
        if (other === undefined) firstWithTitle.set(tk, fk);
        else if (root(other) !== root(fk)) parent.set(root(fk), root(other));
      }
    }
    const fams = new Map<string, Q[]>();
    for (const [fk, vs] of byNumber) {
      const r = root(fk);
      (fams.get(r) ?? fams.set(r, []).get(r)!).push(...vs);
    }
    const families: ProposalFamily<Q>[] = [];
    for (const [fk, vs] of fams) {
      // Newest version = most recently CREATED (a revision is a new row); an
      // edit to an old version does not make it the current one.
      const sorted = [...vs].sort((a, b) => (b.created_at ?? '').localeCompare(a.created_at ?? ''));
      const latest = sorted[0]!;
      // The rest by their own date, newest on top (owner, 2026-10-22).
      const dated = (q: Q) => `${(q.quote_date ?? '').slice(0, 10)}|${q.created_at ?? ''}`;
      const older = sorted.slice(1).sort((a, b) => dated(b).localeCompare(dated(a)));
      const lastActivity = vs.map(activityOf).sort().at(-1) ?? '';
      const fam: ProposalFamily<Q> = {
        key: fk, latest, older, lastActivity,
        active: isActive(latest, vs, hasOpenNote, now),
      };
      if (!opts.show || opts.show(fam)) families.push(fam);
    }
    if (!families.length) continue;
    families.sort((a, b) => b.lastActivity.localeCompare(a.lastActivity));
    const newest = [...members].sort((a, b) => activityOf(b).localeCompare(activityOf(a)))[0]!;
    groups.push({
      key,
      name: (newest.customer_name ?? '').trim(),
      families,
      counts: countStatuses(members),
      lastActivity: families[0]!.lastActivity,
    });
  }
  return groups.sort((a, b) => b.lastActivity.localeCompare(a.lastActivity));
}
