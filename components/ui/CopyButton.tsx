'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import { copyOnly } from '@/lib/whatsappQuote';

/**
 * Copy one short string — a description, a code, a number — to the clipboard.
 *
 * WHY IT CONFIRMS IN PLACE rather than raising a toast: this sits inside a
 * table row that a person will click many times in a row while building a
 * message. A toast for each one stacks into a column of identical banners, and
 * the fifth one tells you nothing the first did not. The tick appears on the
 * button you just pressed, which is where you are already looking.
 *
 * `copyOnly` rather than the Web Share sheet (owner, 2026-09-07): most of this
 * office is on Windows, where a share sheet is a dead end. It also falls back
 * to an offscreen textarea, which is the path that survives a page served over
 * plain http or inside an in-app browser.
 */
export default function CopyButton({ text, title, className = '' }: {
  text: string;
  /** What the tooltip says. Name the THING, e.g. "Copy the description". */
  title: string;
  className?: string;
}) {
  const [state, setState] = useState<'idle' | 'ok' | 'fail'>('idle');
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // A row can unmount while the tick is still showing — the grid re-sorts, the
  // filter changes — and setting state on a dead component is a React warning
  // nobody will read and everybody will learn to ignore.
  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);

  const copy = useCallback(async (e: React.MouseEvent) => {
    // The row around this may be clickable (expansion, selection). Copying is
    // not a reason to open anything.
    e.stopPropagation();
    e.preventDefault();
    const how = await copyOnly(text);
    setState(how === 'copied' ? 'ok' : 'fail');
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => setState('idle'), 1200);
  }, [text]);

  if (!text) return null;

  return (
    <button type="button" onClick={copy}
      title={state === 'fail' ? 'Could not reach the clipboard — select the text and copy by hand' : title}
      aria-label={title}
      className={`inline-flex items-center justify-center align-middle flex-shrink-0 w-6 h-6 -my-1 rounded transition-colors ${
        state === 'ok' ? 'text-emerald-400'
        : state === 'fail' ? 'text-amber-400'
        // Dim until the row is hovered, so 200 of these do not read as 200
        // buttons — then legible the moment the pointer is on the row. On a
        // touch screen there is no hover, so it stays visible: `group-hover`
        // never fires there and an invisible control is an absent one.
        : 'text-slate-600 md:opacity-0 md:group-hover/row:opacity-100 hover:text-emerald-300 focus-visible:opacity-100'
      } ${className}`}>
      {state === 'ok' ? (
        <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2.5">
          <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
        </svg>
      ) : (
        <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="1.8">
          <path strokeLinecap="round" strokeLinejoin="round" d="M8 5H6a2 2 0 00-2 2v12a2 2 0 002 2h8a2 2 0 002-2v-2M8 5a2 2 0 002 2h4a2 2 0 002-2M8 5a2 2 0 012-2h4a2 2 0 012 2m0 0h2a2 2 0 012 2v4" />
        </svg>
      )}
    </button>
  );
}
