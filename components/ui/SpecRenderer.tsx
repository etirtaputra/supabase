/**
 * SpecRenderer
 * Renders a component's JSONB `specifications` field as grouped,
 * human-readable tables. Unknown keys fall into a "General" group.
 */
'use client';
import React from 'react';
import {
  SPEC_GROUP_ORDER, fieldMeta, isAnswered, displaySpecValue,
} from '@/lib/specFields';

// ─── Field catalogue ────────────────────────────────────────────────────────

/**
 * Labels, units and groups come from lib/specFields — the same table the Tech
 * Specs form and the side-by-side comparison read. A field this panel calls
 * "Max PV Voc" is called that everywhere, or the comparison is a lie.
 */
const GROUP_ORDER = SPEC_GROUP_ORDER;

const GROUP_ICONS: Record<string, string> = {
  'Topology':                 '🧭',
  'AC Output':                '🔋',
  'Grid Export':              '🏭',
  'AC Input & Charger':       '🔄',
  'PV Input':                 '☀️',
  'Battery':                  '🪫',
  'Electrical (STC)':         '⚡',
  'Electrical (NOCT)':        '🌡',
  'Temperature Coefficients': '📉',
  'Physical':                 '📐',
  'Balance of System':        '🔌',
  'System Limits':            '🛡',
  'Logistics':                '📦',
  'General':                  '📋',
};

const GROUP_COLORS: Record<string, { header: string; badge: string; row: string }> = {
  'Topology':                 { header: 'text-slate-300',  badge: 'bg-slate-500/10 border-slate-500/20',   row: 'hover:bg-slate-800/40' },
  'AC Output':                { header: 'text-amber-300',  badge: 'bg-amber-500/10 border-amber-500/20',   row: 'hover:bg-amber-500/5' },
  'Grid Export':              { header: 'text-teal-300',   badge: 'bg-teal-500/10 border-teal-500/20',     row: 'hover:bg-teal-500/5' },
  'AC Input & Charger':       { header: 'text-violet-300', badge: 'bg-violet-500/10 border-violet-500/20', row: 'hover:bg-violet-500/5' },
  'PV Input':                 { header: 'text-yellow-300', badge: 'bg-yellow-500/10 border-yellow-500/20', row: 'hover:bg-yellow-500/5' },
  'Battery':                  { header: 'text-lime-300',   badge: 'bg-lime-500/10 border-lime-500/20',     row: 'hover:bg-lime-500/5' },
  'Electrical (STC)':         { header: 'text-amber-300',  badge: 'bg-amber-500/10 border-amber-500/20',   row: 'hover:bg-amber-500/5' },
  'Electrical (NOCT)':        { header: 'text-orange-300', badge: 'bg-orange-500/10 border-orange-500/20', row: 'hover:bg-orange-500/5' },
  'Temperature Coefficients': { header: 'text-rose-300',   badge: 'bg-rose-500/10 border-rose-500/20',     row: 'hover:bg-rose-500/5' },
  'Physical':                 { header: 'text-sky-300',    badge: 'bg-sky-500/10 border-sky-500/20',       row: 'hover:bg-sky-500/5' },
  'Balance of System':        { header: 'text-violet-300', badge: 'bg-violet-500/10 border-violet-500/20', row: 'hover:bg-violet-500/5' },
  'System Limits':            { header: 'text-emerald-300',badge: 'bg-emerald-500/10 border-emerald-500/20', row: 'hover:bg-emerald-500/5' },
  'Logistics':                { header: 'text-cyan-300',   badge: 'bg-cyan-500/10 border-cyan-500/20',     row: 'hover:bg-cyan-500/5' },
  'General':                  { header: 'text-slate-300',  badge: 'bg-slate-500/10 border-slate-500/20',   row: 'hover:bg-slate-800/40' },
};

const formatValue = displaySpecValue;

// ─── Sub-components ─────────────────────────────────────────────────────────

function StatBadge({ label, value, unit, color }: { label: string; value: string; unit?: string; color: string }) {
  return (
    <div className={`rounded-xl border px-4 py-3 flex flex-col gap-0.5 ${color}`}>
      <span className="text-[10px] text-slate-400 uppercase tracking-widest font-bold">{label}</span>
      <span className="text-xl font-extrabold text-white leading-tight">
        {value}
        {unit && <span className="text-xs font-normal text-slate-400 ml-1">{unit}</span>}
      </span>
    </div>
  );
}

function SpecRow({ label, value, unit, highlight, rowClass }: { label: string; value: string; unit?: string; highlight?: boolean; rowClass: string }) {
  return (
    <tr className={`transition-colors ${rowClass}`}>
      <td className="py-1.5 pr-4 text-xs text-slate-400 font-medium whitespace-nowrap">{label}</td>
      <td className={`py-1.5 text-xs font-semibold ${highlight ? 'text-emerald-300' : 'text-white'}`}>
        {value}
        {unit && <span className="text-slate-500 font-normal ml-1">{unit}</span>}
      </td>
    </tr>
  );
}

function GroupCard({ title, rows, color }: {
  title: string;
  rows: { label: string; value: string; unit?: string; highlight?: boolean }[];
  color: typeof GROUP_COLORS[string];
}) {
  const icon = GROUP_ICONS[title] ?? '📋';
  return (
    <div className="bg-slate-900/60 border border-slate-800/80 rounded-xl overflow-hidden">
      <div className={`px-4 py-2.5 border-b border-slate-800/60 flex items-center gap-2 bg-slate-900/80`}>
        <span className="text-base leading-none">{icon}</span>
        <span className={`text-xs font-bold uppercase tracking-wider ${color.header}`}>{title}</span>
      </div>
      <div className="px-4 py-2">
        <table className="w-full border-collapse">
          <tbody>
            {rows.map((r, i) => (
              <SpecRow key={i} {...r} rowClass={color.row} />
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ─── Main export ────────────────────────────────────────────────────────────

interface SpecRendererProps {
  specs: Record<string, unknown> | null | undefined;
  modelName?: string;
}

export default function SpecRenderer({ specs, modelName }: SpecRendererProps) {
  if (!specs || typeof specs !== 'object' || Object.keys(specs).length === 0) {
    return (
      <div className="py-6 text-center text-slate-500 text-sm">
        No specifications stored for this component.
      </div>
    );
  }

  // ── Build highlight key metrics ───────────────────────────
  const highlights: { label: string; value: string; unit?: string; color: string }[] = [];
  // PV-module headliners first, then the converter ones. Only keys that carry
  // a value render, so a module shows four and an inverter shows its own four.
  const highlightKeys = [
    'power_stc_w', 'efficiency_percent', 'voc_stc_v', 'max_system_voltage_vdc',
    'rated_output_power_w', 'battery_nominal_voltage_vdc',
    'pv_max_input_power_w', 'pv_max_open_circuit_voltage_vdc',
  ];
  for (const key of highlightKeys) {
    // `key in specs` is now true for every module — a null means unanswered,
    // and a headline stat reading "—" is worse than no stat.
    if (isAnswered(specs[key])) {
      const meta = fieldMeta(key);
      highlights.push({
        label: meta.label,
        value: formatValue(specs[key]),
        unit: meta.unit,
        color: GROUP_COLORS[meta.group].badge,
      });
    }
  }

  // ── Build certifications list ─────────────────────────────
  const certs = specs.certifications;
  const certList: string[] = Array.isArray(certs) ? certs.map(String) : [];

  // ── Group all other keys ──────────────────────────────────
  const groups: Record<string, { label: string; value: string; unit?: string; highlight?: boolean }[]> = {};
  const skipKeys = new Set([...highlightKeys, 'certifications']);

  // Since lib/specSchema gave each category a declared field set, every item
  // carries every key and writes null where its datasheet is silent. That is
  // what makes "which modules have no NOCT data?" answerable — but rendering
  // it would be twenty rows of "—". Unanswered fields are counted in the
  // header instead, so the gap is still visible without filling the panel.
  let unanswered = 0;
  for (const [key, val] of Object.entries(specs)) {
    if (skipKeys.has(key)) continue;
    if (!isAnswered(val)) { unanswered += 1; continue; }
    const meta = fieldMeta(key);
    const group = meta.group;
    const label = meta.label;
    const unit = meta.unit;
    const highlight = meta.highlight;
    if (!groups[group]) groups[group] = [];
    groups[group].push({ label, value: formatValue(val), unit, highlight });
  }

  const orderedGroups = GROUP_ORDER.filter((g) => g in groups);

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-base font-bold text-white">{modelName ?? 'Specifications'}</h3>
          <p className="text-xs text-slate-500 mt-0.5">
            {Object.keys(specs).length - unanswered} of {Object.keys(specs).length} parameters
            {unanswered > 0 && <span className="text-slate-600"> · {unanswered} not stated on the datasheet</span>}
          </p>
        </div>
      </div>

      {/* Key Metrics strip */}
      {highlights.length > 0 && (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          {highlights.map((h) => (
            <StatBadge key={h.label} label={h.label} value={h.value} unit={h.unit} color={h.color} />
          ))}
        </div>
      )}

      {/* Spec groups grid */}
      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-4">
        {orderedGroups.map((group) => (
          <GroupCard
            key={group}
            title={group}
            rows={groups[group]}
            color={GROUP_COLORS[group] ?? GROUP_COLORS['General']}
          />
        ))}
      </div>

      {/* Certifications */}
      {certList.length > 0 && (
        <div className="bg-slate-900/60 border border-slate-800/80 rounded-xl overflow-hidden">
          <div className="px-4 py-2.5 border-b border-slate-800/60 flex items-center gap-2 bg-slate-900/80">
            <span className="text-base leading-none">🏆</span>
            <span className="text-xs font-bold uppercase tracking-wider text-yellow-300">Certifications</span>
          </div>
          <div className="px-4 py-3 flex flex-wrap gap-2">
            {certList.map((cert, i) => (
              <span key={i} className="px-3 py-1 rounded-full text-xs font-semibold bg-yellow-500/10 border border-yellow-500/20 text-yellow-300">
                {cert}
              </span>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
