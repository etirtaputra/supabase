'use client';
import { useState, useMemo, useRef } from 'react';
import { normField, nearestDuplicate, fieldSimilarity } from '@/lib/proposalFields';

/**
 * Text input for an EPC proposal header field (site, address, …) that keeps
 * entries consistent:
 *  • an autocomplete of existing values, so the same site/address is typed the
 *    same way every time — filtered by what's typed;
 *  • a "did you mean" warning when the typed value is a near-duplicate of an
 *    existing one (adopt it in one click).
 * Crucially, neither the dropdown nor the warning ever surfaces a value that is
 * identical to the current input apart from casing/spacing — if you've already
 * typed it your way, it stays out of your way.
 */
export default function ProposalFieldInput({ label, value, onChange, suggestions, placeholder }: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  suggestions: string[];  // distinct existing values for this field
  placeholder?: string;
}) {
  const [open, setOpen] = useState(false);
  const [anchor, setAnchor] = useState<{ x: number; y: number; w: number } | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const nv = normField(value);

  // Dropdown matches: contain the typed text, exclude the exact value already
  // typed (any casing), best first.
  const matches = useMemo(() => {
    const q = value.trim().toLowerCase();
    return suggestions
      .filter((s) => normField(s) !== nv && (!q || s.toLowerCase().includes(q)))
      .sort((a, b) => fieldSimilarity(value, b) - fieldSimilarity(value, a) || a.localeCompare(b))
      .slice(0, 7);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [suggestions, value, nv]);

  // "Did you mean" — a close but non-identical existing value.
  const dup = useMemo(() => nearestDuplicate(value, suggestions), [value, suggestions]);

  const openAt = () => {
    const el = inputRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    setAnchor({ x: r.left, y: r.bottom, w: Math.max(r.width, 320) });
    setOpen(true);
  };

  return (
    <div>
      <label className="block text-[10px] uppercase tracking-widest text-slate-500 mb-1">{label}</label>
      <input
        ref={inputRef}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onFocus={openAt}
        onBlur={() => setOpen(false)}
        onKeyDown={(e) => { if (e.key === 'Escape' || e.key === 'Enter') setOpen(false); }}
        placeholder={placeholder}
        className="w-full bg-transparent border-b border-slate-700 focus:border-violet-500 outline-none text-white py-1 text-sm placeholder:text-slate-600 transition-colors"
      />
      {/* Did-you-mean warning (only when the dropdown isn't already showing it) */}
      {dup && !open && (
        <button
          type="button"
          onClick={() => onChange(dup)}
          className="mt-1 inline-flex items-center gap-1 text-[10px] text-amber-300/90 hover:text-amber-200 transition-colors"
          title="Use the existing spelling instead of creating a near-duplicate"
        >
          ⚠ Similar exists: <span className="font-semibold underline">{dup}</span> — use it
        </button>
      )}
      {open && matches.length > 0 && anchor && (
        <div
          style={{ position: 'fixed', left: anchor.x, top: anchor.y + 6, width: anchor.w }}
          className="z-50 bg-slate-900 border border-slate-700 rounded-xl shadow-2xl py-1 max-h-64 overflow-y-auto"
        >
          <p className="px-3 pt-1.5 pb-1 text-[9px] uppercase tracking-widest text-slate-600">Existing — pick to reuse</p>
          {matches.map((s) => (
            <button
              key={s}
              type="button"
              onMouseDown={(e) => { e.preventDefault(); onChange(s); setOpen(false); }}
              className="block w-full text-left px-3 py-1.5 hover:bg-violet-500/20 transition-colors"
            >
              <span className="block text-xs text-slate-200 truncate">{s}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
