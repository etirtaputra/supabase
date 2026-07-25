'use client';
import type { ListLayout } from '@/lib/settings';

/**
 * Compact ↔ Card switch for a list. Compact is the dense one-line-per-record
 * view; Card gives each record room for its secondary detail. The choice is
 * remembered per screen (see useListLayout); the house default lives in
 * Settings › Layout.
 */
export default function LayoutToggle({
  value, onChange, accent = 'emerald',
}: {
  value: ListLayout;
  onChange: (v: ListLayout) => void;
  accent?: 'emerald' | 'sky' | 'violet';
}) {
  const on = accent === 'sky'
    ? 'bg-sky-500/15 text-sky-300 border-sky-500/40'
    : accent === 'violet'
      ? 'bg-violet-500/15 text-violet-300 border-violet-500/40'
      : 'bg-emerald-500/15 text-emerald-300 border-emerald-500/40';
  const off = 'border-transparent text-slate-500 hover:text-slate-300 hover:bg-white/5';

  return (
    <div className="flex items-center gap-0.5 p-0.5 rounded-lg border border-slate-800 bg-slate-900/60 flex-shrink-0">
      {([
        ['compact', 'Compact', <path key="c" strokeLinecap="round" strokeLinejoin="round" d="M4 6h16M4 10h16M4 14h16M4 18h16" />],
        ['card', 'Card', <path key="k" strokeLinecap="round" strokeLinejoin="round" d="M4 5h16v6H4zM4 13h16v6H4z" />],
      ] as [ListLayout, string, React.ReactNode][]).map(([v, label, icon]) => (
        <button key={v} onClick={() => onChange(v)} title={`${label} view`} aria-pressed={value === v}
          className={`flex items-center gap-1.5 px-2 py-1 rounded-md text-[11px] font-medium border transition-colors ${value === v ? on : off}`}>
          <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="1.8">{icon}</svg>
          <span className="hidden sm:inline">{label}</span>
        </button>
      ))}
    </div>
  );
}
