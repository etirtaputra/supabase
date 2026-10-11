'use client';
/**
 * Inputs for the BOM Calculator. A number field keeps what is being typed
 * ("1.", "-0.2") as text and hands the number up only when it is one, so a
 * half-typed decimal never snaps back under the cursor.
 */
import React, { useState } from 'react';

export const CELL = 'w-full px-2 py-1.5 rounded-lg bg-slate-950 border border-slate-700 focus:border-emerald-500/60 focus:outline-none text-xs text-white placeholder:text-slate-600 transition-colors';

const parse = (s: string): number | null => {
  const t = s.replace(/,/g, '').trim();
  if (t === '') return null;
  const n = Number(t);
  return Number.isFinite(n) ? n : null;
};

export function NumField({ value, onChange, placeholder, className = '', align = 'right', title, disabled }: {
  value: number | null; onChange: (v: number | null) => void; placeholder?: string; className?: string;
  align?: 'left' | 'right'; title?: string; disabled?: boolean;
}) {
  const [text, setText] = useState(value == null ? '' : String(value));
  // Follow the value when it changes from outside (a catalogue pick, a reset) —
  // adjusted during render, React's pattern for state derived from a prop.
  const [seen, setSeen] = useState(value);
  if (value !== seen) {
    setSeen(value);
    if (parse(text) !== value) setText(value == null ? '' : String(value));
  }
  return (
    <input inputMode="decimal" value={text} placeholder={placeholder} title={title} disabled={disabled}
      onChange={(e) => { setText(e.target.value); const n = parse(e.target.value); if (n !== null || e.target.value.trim() === '') onChange(n); }}
      className={`${CELL} tabular-nums ${align === 'right' ? 'text-right' : ''} disabled:opacity-50 ${className}`} />
  );
}

export function TextField({ value, onChange, placeholder, className = '', title }: {
  value: string; onChange: (v: string) => void; placeholder?: string; className?: string; title?: string;
}) {
  return <input value={value} placeholder={placeholder} title={title} onChange={(e) => onChange(e.target.value)} className={`${CELL} ${className}`} />;
}

export function Labeled({ label, hint, children, className = '' }: { label: string; hint?: string; children: React.ReactNode; className?: string }) {
  return (
    <label className={`block space-y-1 ${className}`} title={hint}>
      <span className="block text-[10px] font-bold uppercase tracking-wider text-slate-500">{label}</span>
      {children}
    </label>
  );
}

export function Card({ title, action, children, className = '' }: { title?: string; action?: React.ReactNode; children: React.ReactNode; className?: string }) {
  return (
    <section className={`bg-slate-900/40 rounded-2xl border border-slate-800/80 p-4 space-y-3 ${className}`}>
      {(title || action) && (
        <div className="flex flex-wrap items-center gap-2">
          {title && <h3 className="text-sm font-bold text-white flex-1">{title}</h3>}
          {action}
        </div>
      )}
      {children}
    </section>
  );
}

export const SMALL_BTN = 'px-2.5 py-1 rounded-lg border border-slate-700 text-[11px] text-slate-300 hover:text-white hover:border-slate-500 transition-colors';
export const DEL_BTN = 'text-slate-600 hover:text-red-400 transition-colors text-base leading-none px-1';
