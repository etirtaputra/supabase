'use client';
/**
 * FitText — renders its text at the size the surrounding classes ask for, and
 * shrinks the FONT (never wraps, never truncates) when the text is wider than
 * the space it sits in.
 *
 * Exists for the house rule (owner, 2026-08-05) that money always shows FULL
 * digits — "IDR 21.553.000.000", never "IDR 21,55B". Full figures vary from 5
 * to 18 characters, so a fixed font size either wastes the tile or overflows
 * it; this measures and fits instead, which is what keeps the rule workable on
 * phones.
 */
import { useLayoutEffect, useRef } from 'react';

export default function FitText({ text, className = '' }: { text: string; className?: string }) {
  const ref = useRef<HTMLSpanElement>(null);
  useLayoutEffect(() => {
    const el = ref.current;
    const parent = el?.parentElement;
    if (!el || !parent) return;
    const fit = () => {
      el.style.fontSize = '';                      // measure at the natural size
      const avail = parent.clientWidth;
      const need = el.scrollWidth;
      if (need > avail && avail > 0 && need > 0) {
        const base = parseFloat(getComputedStyle(el).fontSize) || 16;
        el.style.fontSize = `${Math.max(10, base * (avail / need))}px`;
      }
    };
    fit();
    const ro = new ResizeObserver(fit);
    ro.observe(parent);
    return () => ro.disconnect();
  }, [text]);
  return <span ref={ref} className={`inline-block max-w-full whitespace-nowrap align-baseline ${className}`}>{text}</span>;
}
