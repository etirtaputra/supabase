'use client';
import { useEffect, useState } from 'react';

/**
 * True at Tailwind's `lg` breakpoint and up.
 *
 * Used where the DIFFERENCE between mobile and desktop is behavioural rather
 * than visual — Spotlight, for instance, is an inline bar with a dropdown on a
 * wide screen but a full overlay on a phone, so ⌘I and the search trigger have
 * to know which one to talk to. Anything that is purely visual should use a
 * Tailwind `lg:` class instead and stay out of JavaScript.
 *
 * Starts false so the server and the first client paint agree; the effect
 * corrects it before anything interactive can happen.
 */
export function useIsDesktop(): boolean {
  const [desktop, setDesktop] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia('(min-width: 1024px)');
    const sync = () => setDesktop(mq.matches);
    sync();
    mq.addEventListener('change', sync);
    return () => mq.removeEventListener('change', sync);
  }, []);
  return desktop;
}
