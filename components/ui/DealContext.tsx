'use client';
/**
 * Where a quote came from, and why a line was asked for — rendered the same
 * way everywhere a price is read (Deal Lookup, the Item Editor's price
 * history, the Item Hub). Rules: lib/dealContext.ts.
 *
 * Quiet on purpose (owner, 2026-10-09: "this is too messy"): plain small text,
 * no boxes, one line under the row it belongs to. The figures are the row; the
 * context is a footnote to it. A long note is one truncated line (whole on
 * hover), or just a 📝 where even that would crowd.
 */
import { useT } from '@/hooks/useT';
import { channelLabel, fmtSourceAt, fmtSourceAtShort, reasonParts, type SourceFields, type LineContext } from '@/lib/dealContext';

const Dot = () => <span className="text-slate-700">·</span>;

/** "WhatsApp · Jasmine → Wendy · 2026-09-15 15:34" — nothing when no source was recorded. */
export function SourceLine({ s, className = '', rowDate, hideChannel = false }: {
  s: SourceFields; className?: string;
  /** The row's own date — the time then drops the day when it is the same one. */
  rowDate?: string | null;
  /** The reference beside it already says "WhatsApp · Joe". */
  hideChannel?: boolean;
}) {
  const { t } = useT();
  const when = rowDate !== undefined ? fmtSourceAtShort(s.source_at, rowDate) : fmtSourceAt(s.source_at);
  const who = hideChannel ? null : s.source_contact;
  const parts = [
    !hideChannel && s.source_channel ? <span key="c" className="text-sky-300/90">{t(channelLabel(s.source_channel))}</span> : null,
    who ? <span key="w" className="text-slate-400">{who}</span> : null,
    s.received_by ? <span key="r" className="text-slate-500" title={t('Our contact')}>→ {s.received_by}</span> : null,
    when ? <span key="t" className="text-slate-500 tabular-nums">{when}</span> : null,
  ].filter(Boolean);
  if (!parts.length) return null;
  return (
    <span className={`inline-flex flex-wrap items-center gap-x-1 ${className}`}>
      {parts.flatMap((p, i) => (i ? [<Dot key={`d${i}`} />, p] : [p]))}
    </span>
  );
}

/** "For a project: PT Hon Chuan — phase 2" — nothing when the line has no reason. */
export function ReasonChip({ l, nameOf, className = '', noteAsIcon = false }: {
  l: LineContext; nameOf: (id: string) => string | undefined; className?: string;
  /** Show a note as 📝 (whole text on hover) instead of a truncated line. */
  noteAsIcon?: boolean;
}) {
  const { t } = useT();
  const p = reasonParts(l, nameOf);
  if (!p) return null;
  return (
    <span className={`inline-flex min-w-0 items-center gap-x-1 text-[10px] ${className}`}>
      {p.label && <span className="text-amber-300/90 whitespace-nowrap">{t(p.label)}{p.target ? ':' : ''}</span>}
      {p.target && <span className="text-slate-400 truncate">{p.target}</span>}
      {p.note && (noteAsIcon
        ? <span className="cursor-help" title={p.note}>📝</span>
        : <span className="text-slate-500 italic truncate max-w-[32ch]" title={p.note}>— {p.note}</span>)}
    </span>
  );
}

/** Source and reason on ONE line — the footnote under a quote or PO row. */
export function DealContextLine({ s, l, nameOf, rowDate, hideChannel = false, noteAsIcon = false, className = '' }: {
  s?: SourceFields | null; l?: LineContext | null; nameOf: (id: string) => string | undefined;
  rowDate?: string | null; hideChannel?: boolean; noteAsIcon?: boolean; className?: string;
}) {
  const hasSrc = !!s && !!((!hideChannel && (s.source_channel || s.source_contact)) || s.received_by
    || (rowDate !== undefined ? fmtSourceAtShort(s.source_at, rowDate) : fmtSourceAt(s.source_at)));
  const src = hasSrc ? <SourceLine s={s!} rowDate={rowDate} hideChannel={hideChannel} /> : null;
  const why = l && reasonParts(l, nameOf) ? <ReasonChip l={l} nameOf={nameOf} noteAsIcon={noteAsIcon} /> : null;
  if (!src && !why) return null;
  return (
    <span className={`flex min-w-0 items-center gap-x-1 text-[10px] leading-tight ${className}`}>
      {src}
      {src && why && <Dot />}
      {why}
    </span>
  );
}
