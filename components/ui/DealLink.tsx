'use client';
/**
 * A buy-side document number (Quote/PI ref or PO #) rendered as a link into
 * Deal Lookup — the house rule (owner, 2026-08-06): wherever one of these
 * numbers appears, it opens the deal, in a NEW TAB, like every document link.
 * Pass the styling; this only adds the href, hover underline and stopPropagation
 * (rows behind these numbers usually expand on click).
 */
export const dealLookupHref = (n: string) => `/purchasing?tab=lookup&q=${encodeURIComponent(n)}`;

export default function DealLink({ number, className = '', prefix = '', title }: {
  number?: string | null; className?: string; prefix?: string; title?: string;
}) {
  if (!number) return null;
  return (
    <a href={dealLookupHref(number)} target="_blank" rel="noopener noreferrer"
      onClick={(e) => e.stopPropagation()}
      title={title ?? `Open ${number} in Deal Lookup`}
      className={`hover:underline underline-offset-2 transition-colors ${className}`}>
      {prefix}{number}
    </a>
  );
}
