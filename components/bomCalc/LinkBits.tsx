'use client';
/**
 * The two directions of every BOM Calculator link, shared by the tabs:
 * a result's value with the BOM rows that read it (LinkLines / UsedBy), and
 * the picker a row uses to read a result (LinkSelect).
 */
import React from 'react';
import { useT } from '@/hooks/useT';
import type { BomRow } from '@/lib/bomCalc';
import type { linkOptions } from '@/lib/bomCalc';
import type { Explanation, SourceTab } from '@/lib/bomCalc/links';
import { CELL } from './Fields';

/** The tab each calculated value lives on — English, translated where shown. */
export const TAB_LABEL: Record<SourceTab, string> = { strings: 'Strings & inverters', dc: 'DC cable', ac: 'AC cable', raceway: 'Cable raceway', civil: 'Civil & O&M' };
export const fmtN = (n: number, dp = 0) => n.toLocaleString('en-US', { minimumFractionDigits: dp, maximumFractionDigits: dp });

// ── Link helpers ─────────────────────────────────────────────────────────────
/** "→ Solar cable 6 mm²" — the BOM rows that read a result; amber when none does. */
export function UsedBy({ rows, onGo, quiet = false }: { rows: BomRow[]; onGo: (rowId: string) => void; quiet?: boolean }) {
  const { t } = useT();
  if (!rows.length) return quiet ? <span className="text-slate-600">—</span> : <span className="text-amber-300">{t('→ not in the Bill of Material')}</span>;
  return (
    <span className="inline-flex flex-wrap gap-x-1.5">
      <span className="text-slate-500">→</span>
      {rows.map((r) => (
        <button key={r.id} onClick={() => onGo(r.id)} title={t('Go to the row')}
          className="text-sky-300 hover:text-sky-200 underline decoration-dotted underline-offset-2">{r.description || t('Untitled')}</button>
      ))}
    </span>
  );
}

/** One line per result on a calculation tab: value, then where the BOM uses it. */
export function LinkLines({ keys, explain, usage, onGo, mustUse = [] }: {
  keys: string[]; explain: (key: string) => Explanation | null; usage: Map<string, BomRow[]>;
  onGo: (rowId: string) => void; mustUse?: string[];
}) {
  const shown = keys.map((k) => explain(k)).filter((e): e is Explanation => !!e && e.value > 0);
  if (!shown.length) return null;
  return (
    <div className="rounded-xl border border-slate-800 px-3 py-2 space-y-1 text-[11px]">
      {shown.map((e) => (
        <div key={e.key} className="flex flex-wrap gap-x-2">
          <span className="text-slate-300">{e.label}</span>
          <span className="tabular-nums text-white">{fmtN(e.value, e.value % 1 ? 2 : 0)} {e.unit}</span>
          <UsedBy rows={usage.get(e.key) ?? []} onGo={onGo} quiet={!mustUse.includes(e.key)} />
        </div>
      ))}
    </div>
  );
}

/** A link picker grouped by the tab each value is calculated on. */
export function LinkSelect({ links: all, value, onChange, placeholder, title, className = '', costs = false }: {
  links: ReturnType<typeof linkOptions>; value: string; onChange: (key: string) => void;
  placeholder?: string; title?: string; className?: string;
  /** Offer the cost-per-unit results (a row's cost) instead of the quantities. */
  costs?: boolean;
}) {
  const { t } = useT();
  const links = all.filter((l) => l.cost === costs);
  const known = links.some((l) => l.key === value);
  return (
    <select value={value} title={title} onChange={(e) => onChange(e.target.value)} className={`${CELL} ${className}`}>
      {placeholder !== undefined && <option value="">{placeholder}</option>}
      {!known && value && <option value={value}>{value}</option>}
      {(['strings', 'dc', 'ac', 'raceway', 'civil'] as SourceTab[]).map((tb) => (
        links.some((l) => l.tab === tb) && <optgroup key={tb} label={t(TAB_LABEL[tb])}>
          {links.filter((l) => l.tab === tb).map((l) => (
            <option key={l.key} value={l.key}>{l.label} — {fmtN(l.value, l.value % 1 ? 2 : 0)} {l.unit}</option>
          ))}
        </optgroup>
      ))}
    </select>
  );
}
