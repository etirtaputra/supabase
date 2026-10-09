'use client';
/**
 * Where a quote came from, and why a line was asked for — rendered the same
 * way everywhere a price is read (Deal Lookup, the Item Editor's price
 * history). Rules: lib/dealContext.ts.
 */
import { useT } from '@/hooks/useT';
import { channelLabel, fmtSourceAt, reasonParts, type SourceFields, type LineContext } from '@/lib/dealContext';

/** "WhatsApp · Jasmine → Wendy · 2026-09-15 15:34" — nothing when no source was recorded. */
export function SourceLine({ s, className = '' }: { s: SourceFields; className?: string }) {
  const { t } = useT();
  const when = fmtSourceAt(s.source_at);
  if (!s.source_channel && !when && !s.source_contact && !s.received_by) return null;
  return (
    <span className={`inline-flex flex-wrap items-center gap-x-1.5 gap-y-0.5 ${className}`}>
      {s.source_channel && <span className="px-1.5 py-px rounded bg-sky-500/10 border border-sky-500/25 text-sky-300 font-semibold">{t(channelLabel(s.source_channel))}</span>}
      {s.source_contact && <span className="text-slate-300">{s.source_contact}</span>}
      {s.received_by && <span className="text-slate-500" title={t('Our contact')}>→ {s.received_by}</span>}
      {when && <span className="text-slate-500 tabular-nums">· {when}</span>}
    </span>
  );
}

/** "For a project: PT Hon Chuan — phase 2" — nothing when the line has no reason. */
export function ReasonChip({ l, nameOf, className = '' }: { l: LineContext; nameOf: (id: string) => string | undefined; className?: string }) {
  const { t } = useT();
  const p = reasonParts(l, nameOf);
  if (!p) return null;
  return (
    <span className={`inline-flex flex-wrap items-center gap-x-1 text-[10px] ${className}`}>
      {p.label && <span className="px-1.5 py-px rounded bg-amber-500/10 border border-amber-500/25 text-amber-300 font-semibold">{t(p.label)}</span>}
      {p.target && <span className="text-slate-300">{p.target}</span>}
      {p.note && <span className="text-slate-500 italic">— {p.note}</span>}
    </span>
  );
}
