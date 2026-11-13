/**
 * Proposal checks: things a proposal must not be sent without (owner,
 * 2026-11-13).
 *
 * Abel Setiawan, on WhatsApp the same morning: *"ini untuk penawaran yang baru
 * yang Al belum ada groundingnya"* — "Al" meaning aluminium. The copper version
 * of the Bungasari BESS proposal (Q-20261104-R8A) carried its earthing
 * conductors (KMI NYA 50 mm² and NYA 240 mm²); the two aluminium versions
 * (R8B, R8C) did not: the NYA 50 had become an aluminium power cable
 * (NA2XY 70 mm²) and the NYA 240 had gone. They were copied from R6 (July),
 * which already had the gap. All three were sent. Nothing in ICAPROC looked at
 * what a proposal contains, so nothing could notice.
 *
 * A check is a rule over the proposal's lines. It WARNS — before "Sent", on the
 * editor and on the list — and the person decides; it never blocks, because an
 * earthing system priced by someone else is a real case. Add a rule by adding
 * an entry to RULES with a test built from the real proposal it would have
 * caught (lib/proposalChecks.test.ts).
 *
 * Pure functions, no I/O.
 */

export interface CheckLine {
  description: string;
  section_title?: string | null;
  quantity?: number | string | null;
}

export interface CheckResult {
  id: string;
  /** Short — the chip on the list and the heading in the editor. */
  title: string;
  /** What is wrong and what to add, in the words an engineer uses. */
  detail: string;
  /** The lines that triggered it (shown so the person sees what the rule saw). */
  evidence: string[];
}

interface Rule {
  id: string;
  title: string;
  detail: string;
  /** null = fine; otherwise the evidence lines. */
  test: (lines: CheckLine[]) => string[] | null;
}

/**
 * AC power cable — the phase/neutral conductors from inverter or BESS to the
 * panel and the grid, copper or aluminium. NYA is NOT here: in these proposals
 * a single-core NYA run is the earthing conductor.
 */
export const AC_POWER_CABLE = /\b(NYY|NAYY|NA2XY|N2XY|NYFGBY|NYRGBY|NYM|N2XSY|NA2XSY|N2XSEY|NA2XSEY)\b/i;

/**
 * Something that earths the AC side: an earthing conductor (NYA, the
 * green-yellow conductor; BC/BCC bare copper; a PE conductor) or a priced
 * grounding / earthing system. A PV-mounting kit's "grounding kits", clips and
 * lugs bond the module frames, not the AC side, so they do not count.
 */
export const EARTHING = /\bNYA\b|\bBCC?\b|kuning[\s-]*hijau|green[\s/-]*yellow|yellow[\s/-]*green|\bPE\b|pentanahan|\barde\b|earthing|grounding\s+(sistem|system|rod|cable|kabel|conductor|equipment|box)|\bground\s+rod\b/i;

const NOT_EARTHING = /grounding\s+(kits?|clip|lug)\b|c\/w\b.*grounding/i;

export const isAcPowerCable = (description: string): boolean => AC_POWER_CABLE.test(description ?? '');
export const isEarthing = (description: string): boolean => {
  const d = description ?? '';
  return EARTHING.test(d) && !(NOT_EARTHING.test(d) && !/\bNYA\b|\bBCC?\b|kuning[\s-]*hijau|grounding\s+(sistem|system)/i.test(d));
};

const RULES: Rule[] = [
  {
    id: 'ac_earthing',
    title: 'No earthing conductor',
    // One literal string: lib/i18n.test.ts looks for the English verbatim.
    detail: 'This proposal has AC power cables but no earthing conductor or grounding system. Add the earthing run beside the AC cables (e.g. NYA kuning-hijau or BC, sized for the circuit). When a copper proposal is turned into aluminium, change the phase and neutral cables only — the earthing conductor stays.',
    test: (lines) => {
      const ac = lines.filter((l) => isAcPowerCable(l.description));
      if (ac.length === 0) return null;
      if (lines.some((l) => isEarthing(l.description))) return null;
      return ac.map((l) => l.description);
    },
  },
];

/** Every check that fails for these lines, in rule order. Empty = nothing to warn about. */
export function proposalChecks(lines: CheckLine[]): CheckResult[] {
  const usable = lines.filter((l) => (l.description ?? '').trim().length > 0);
  const out: CheckResult[] = [];
  for (const r of RULES) {
    const evidence = r.test(usable);
    if (evidence) out.push({ id: r.id, title: r.title, detail: r.detail, evidence });
  }
  return out;
}

/** The rule ids, for tests and for agents. */
export const PROPOSAL_CHECK_IDS = RULES.map((r) => r.id);

/** Plain JSON for agents: what each check looks for. */
export const describeProposalChecks = () => RULES.map(({ id, title, detail }) => ({ id, title, detail }));
