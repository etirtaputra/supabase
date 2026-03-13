/**
 * SpecRenderer
 * Renders a component's JSONB `specifications` field as grouped,
 * human-readable tables. Unknown keys fall into a "General" group.
 */
'use client';
import React from 'react';

// ─── Field catalogue ────────────────────────────────────────────────────────

interface SpecMeta {
  label: string;
  unit?: string;
  group: string;
  highlight?: boolean; // show in accent colour
}

const GROUP_ORDER = [
  'Electrical (STC)',
  'Electrical (NOCT)',
  'Temperature Coefficients',
  'Physical',
  'Balance of System',
  'System Limits',
  'Logistics',
  'General',
];

const GROUP_ICONS: Record<string, string> = {
  'Electrical (STC)':        '⚡',
  'Electrical (NOCT)':       '🌡',
  'Temperature Coefficients': '📉',
  'Physical':                '📐',
  'Balance of System':       '🔌',
  'System Limits':           '🛡',
  'Logistics':               '📦',
  'General':                 '📋',
};

const GROUP_COLORS: Record<string, { header: string; badge: string; row: string }> = {
  'Electrical (STC)':        { header: 'text-amber-300',  badge: 'bg-amber-500/10 border-amber-500/20',  row: 'hover:bg-amber-500/5' },
  'Electrical (NOCT)':       { header: 'text-orange-300', badge: 'bg-orange-500/10 border-orange-500/20', row: 'hover:bg-orange-500/5' },
  'Temperature Coefficients': { header: 'text-rose-300',   badge: 'bg-rose-500/10 border-rose-500/20',    row: 'hover:bg-rose-500/5' },
  'Physical':                { header: 'text-sky-300',    badge: 'bg-sky-500/10 border-sky-500/20',      row: 'hover:bg-sky-500/5' },
  'Balance of System':       { header: 'text-violet-300', badge: 'bg-violet-500/10 border-violet-500/20', row: 'hover:bg-violet-500/5' },
  'System Limits':           { header: 'text-emerald-300',badge: 'bg-emerald-500/10 border-emerald-500/20', row: 'hover:bg-emerald-500/5' },
  'Logistics':               { header: 'text-cyan-300',   badge: 'bg-cyan-500/10 border-cyan-500/20',    row: 'hover:bg-cyan-500/5' },
  'General':                 { header: 'text-slate-300',  badge: 'bg-slate-500/10 border-slate-500/20',  row: 'hover:bg-slate-800/40' },
};

const SPEC_CATALOGUE: Record<string, SpecMeta> = {
  // ── Electrical STC ────────────────────────────────────────
  model:            { label: 'Model',                      group: 'Electrical (STC)' },
  power_stc_w:      { label: 'Peak Power (Pmax)',           unit: 'W',     group: 'Electrical (STC)', highlight: true },
  efficiency_percent:{ label: 'Module Efficiency',          unit: '%',     group: 'Electrical (STC)', highlight: true },
  voc_stc_v:        { label: 'Open-Circuit Voltage (Voc)', unit: 'V',     group: 'Electrical (STC)' },
  vmp_stc_v:        { label: 'Max Power Voltage (Vmp)',    unit: 'V',     group: 'Electrical (STC)' },
  isc_stc_a:        { label: 'Short-Circuit Current (Isc)',unit: 'A',     group: 'Electrical (STC)' },
  imp_stc_a:        { label: 'Operating Current (Imp)',    unit: 'A',     group: 'Electrical (STC)' },
  power_tolerance_w:{ label: 'Power Tolerance',            unit: 'W',     group: 'Electrical (STC)' },

  // ── Electrical NOCT ───────────────────────────────────────
  noct_c:           { label: 'NOCT',                       unit: '°C',    group: 'Electrical (NOCT)' },
  power_noct_w:     { label: 'Power at NOCT',              unit: 'W',     group: 'Electrical (NOCT)', highlight: true },
  voc_noct_v:       { label: 'Voc at NOCT',                unit: 'V',     group: 'Electrical (NOCT)' },
  vmp_noct_v:       { label: 'Vmp at NOCT',                unit: 'V',     group: 'Electrical (NOCT)' },
  isc_noct_a:       { label: 'Isc at NOCT',                unit: 'A',     group: 'Electrical (NOCT)' },
  imp_noct_a:       { label: 'Imp at NOCT',                unit: 'A',     group: 'Electrical (NOCT)' },

  // ── Temperature Coefficients ──────────────────────────────
  temp_coeff_pmax_percent_per_c: { label: 'Temp Coeff. Pmax', unit: '%/°C', group: 'Temperature Coefficients' },
  temp_coeff_voc_percent_per_c:  { label: 'Temp Coeff. Voc',  unit: '%/°C', group: 'Temperature Coefficients' },
  temp_coeff_isc_percent_per_c:  { label: 'Temp Coeff. Isc',  unit: '%/°C', group: 'Temperature Coefficients' },

  // ── Physical ──────────────────────────────────────────────
  dimensions_l_w_h_mm: { label: 'Dimensions (L × W × H)', unit: 'mm',    group: 'Physical' },
  weight_kg:            { label: 'Weight',                  unit: 'kg',    group: 'Physical' },
  number_of_cells:      { label: 'Number of Cells',         unit: 'cells', group: 'Physical' },
  cell_configuration:   { label: 'Cell Configuration',      group: 'Physical' },
  cell_size_mm:         { label: 'Cell Size',               unit: 'mm',    group: 'Physical' },
  cell_type:            { label: 'Cell Type',               group: 'Physical' },
  frame_material:       { label: 'Frame Material',          group: 'Physical' },
  glass_description:    { label: 'Glass',                   group: 'Physical' },

  // ── Balance of System ─────────────────────────────────────
  max_series_fuse_a:      { label: 'Max Series Fuse',      unit: 'A',   group: 'Balance of System' },
  cable_cross_section_mm2:{ label: 'Cable Cross-Section',  unit: 'mm²', group: 'Balance of System' },
  cable_length_mm:        { label: 'Cable Length',         unit: 'mm',  group: 'Balance of System' },
  connector_type:         { label: 'Connector Type',       group: 'Balance of System' },
  junction_box:           { label: 'Junction Box',         group: 'Balance of System' },

  // ── System Limits ─────────────────────────────────────────
  max_system_voltage_vdc:  { label: 'Max System Voltage',   unit: 'VDC', group: 'System Limits', highlight: true },
  operating_temp_range_c:  { label: 'Operating Temperature', unit: '°C', group: 'System Limits' },

  // ── Logistics ─────────────────────────────────────────────
  packing_container_40ft_total_pcs:              { label: 'Total Pcs / 40ft',         unit: 'pcs',     group: 'Logistics' },
  packing_container_40ft_pcs_per_pallet:         { label: 'Pcs per Pallet',            unit: 'pcs',     group: 'Logistics' },
  packing_container_40ft_pallets_per_container:  { label: 'Pallets per Container',     unit: 'pallets', group: 'Logistics' },
};

// ─── Helpers ────────────────────────────────────────────────────────────────

function prettifyKey(key: string): string {
  return key
    .replace(/_/g, ' ')
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

function formatValue(val: unknown): string {
  if (val === null || val === undefined) return '—';
  if (Array.isArray(val)) return val.join(', ');
  if (typeof val === 'object') return JSON.stringify(val);
  return String(val);
}

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
  const highlightKeys = ['power_stc_w', 'efficiency_percent', 'voc_stc_v', 'max_system_voltage_vdc'];
  for (const key of highlightKeys) {
    if (key in specs) {
      const meta = SPEC_CATALOGUE[key];
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

  for (const [key, val] of Object.entries(specs)) {
    if (skipKeys.has(key)) continue;
    const meta = SPEC_CATALOGUE[key];
    const group = meta?.group ?? 'General';
    const label = meta?.label ?? prettifyKey(key);
    const unit = meta?.unit;
    const highlight = meta?.highlight;
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
          <p className="text-xs text-slate-500 mt-0.5">{Object.keys(specs).length} parameters stored</p>
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
