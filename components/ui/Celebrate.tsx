'use client';
import { useEffect, useMemo, useState } from 'react';

/**
 * A short confetti burst — the win celebration (owner, 2026-10-05: "make
 * using ICAPROC more fun"). Pure CSS: ~90 coloured flecks fall for about two
 * seconds, then the layer removes itself. Nothing is fetched, nothing blocks a
 * click (`pointer-events: none`), and a person who has asked their system for
 * reduced motion gets no animation at all.
 *
 * Mount it with a changing `key` to fire again.
 */
const COLOURS = ['#1f5aa8', '#34d399', '#fbbf24', '#f472b6', '#60a5fa', '#a78bfa', '#fb923c'];

/** A scatter that looks random but is a pure function of the fleck's index
 *  (React may render a component twice; Math.random would scatter it twice). */
const scatter = (i: number, k: number): number => {
  const x = Math.sin(i * 12.9898 + k * 78.233) * 43758.5453;
  return x - Math.floor(x);
};

export default function Celebrate({ pieces = 90, ms = 2400 }: { pieces?: number; ms?: number }) {
  const [on, setOn] = useState(true);
  useEffect(() => {
    const t = setTimeout(() => setOn(false), ms + 600);
    return () => clearTimeout(t);
  }, [ms]);
  const flecks = useMemo(() => Array.from({ length: pieces }, (_, i) => ({
    left: scatter(i, 1) * 100,
    delay: scatter(i, 2) * 0.5,
    dur: (ms / 1000) * (0.7 + scatter(i, 3) * 0.5),
    drift: (scatter(i, 4) - 0.5) * 160,
    spin: (scatter(i, 5) - 0.5) * 900,
    w: 6 + scatter(i, 6) * 6,
    h: 8 + scatter(i, 7) * 8,
    color: COLOURS[i % COLOURS.length],
    round: scatter(i, 8) < 0.3,
  })), [pieces, ms]);
  if (!on) return null;
  return (
    <div aria-hidden className="icaproc-confetti fixed inset-0 z-[100] pointer-events-none overflow-hidden">
      {/* Reduced motion is the browser's call, in CSS — no frame of animation first. */}
      <style>{`@keyframes icaproc-confetti{0%{transform:translate3d(0,-10vh,0) rotate(0);opacity:1}85%{opacity:1}100%{transform:translate3d(var(--dx),105vh,0) rotate(var(--spin));opacity:0}}@media (prefers-reduced-motion:reduce){.icaproc-confetti{display:none}}`}</style>
      {flecks.map((f, i) => (
        <span key={i} style={{
          position: 'absolute', top: 0, left: `${f.left}%`, width: f.w, height: f.round ? f.w : f.h,
          background: f.color, borderRadius: f.round ? '50%' : 2,
          animation: `icaproc-confetti ${f.dur}s cubic-bezier(.2,.6,.4,1) ${f.delay}s forwards`,
          transform: 'translate3d(0,-10vh,0)',
          ['--dx' as string]: `${f.drift}px`, ['--spin' as string]: `${f.spin}deg`,
        } as React.CSSProperties} />
      ))}
    </div>
  );
}
