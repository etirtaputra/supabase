"use client";

import { CategorySlug } from "@/lib/types";
import { cn } from "@/lib/utils";

export interface FilterState {
  // PV Modules
  powerRange?: [number, number];
  // Hybrid/On-Grid Inverters
  phase?: string;
  // Batteries
  batteryType?: string;
  // Solar Charge Controllers
  systemVoltage?: string;
}

interface FilterBarProps {
  category: CategorySlug;
  filters: FilterState;
  onChange: (filters: FilterState) => void;
}

const PHASE_OPTIONS = ["All", "1-phase", "3-phase"];
const BATTERY_TYPE_OPTIONS = ["All", "Lead-Acid", "LiFePO4"];
const SYSTEM_VOLTAGE_OPTIONS = ["All", "12V", "24V", "48V", "12/24V", "12/24/48V", "12/24/36/48V"];

function FilterChip({
  label,
  active,
  onClick,
  color = "sky",
}: {
  label: string;
  active: boolean;
  onClick: () => void;
  color?: string;
}) {
  return (
    <button
      onClick={onClick}
      className={cn(
        "px-3 py-1.5 rounded-full text-xs font-medium border transition-all",
        active
          ? "bg-sky-500/20 border-sky-500 text-sky-300"
          : "bg-slate-800/50 border-slate-700 text-slate-400 hover:border-slate-500 hover:text-slate-300"
      )}
    >
      {label}
    </button>
  );
}

export default function FilterBar({ category, filters, onChange }: FilterBarProps) {
  if (category === "pv-modules") {
    const powerRanges: Array<{ label: string; range: [number, number] | undefined }> = [
      { label: "All Power", range: undefined },
      { label: "< 200W", range: [0, 199] },
      { label: "200–400W", range: [200, 400] },
      { label: "400–500W", range: [400, 500] },
      { label: "> 500W", range: [500, 9999] },
    ];

    return (
      <div className="flex items-center gap-2 flex-wrap">
        <span className="text-xs text-slate-500 font-medium">Power:</span>
        {powerRanges.map(({ label, range }) => (
          <FilterChip
            key={label}
            label={label}
            active={
              range === undefined
                ? filters.powerRange === undefined
                : filters.powerRange?.[0] === range[0] &&
                  filters.powerRange?.[1] === range[1]
            }
            onClick={() => onChange({ ...filters, powerRange: range })}
          />
        ))}
      </div>
    );
  }

  if (category === "hybrid-inverters" || category === "on-grid-inverters") {
    return (
      <div className="flex items-center gap-2 flex-wrap">
        <span className="text-xs text-slate-500 font-medium">Phase:</span>
        {PHASE_OPTIONS.map((phase) => (
          <FilterChip
            key={phase}
            label={phase}
            active={
              phase === "All"
                ? !filters.phase
                : filters.phase === phase
            }
            onClick={() =>
              onChange({ ...filters, phase: phase === "All" ? undefined : phase })
            }
          />
        ))}
      </div>
    );
  }

  if (category === "batteries") {
    return (
      <div className="flex items-center gap-2 flex-wrap">
        <span className="text-xs text-slate-500 font-medium">Chemistry:</span>
        {BATTERY_TYPE_OPTIONS.map((type) => (
          <FilterChip
            key={type}
            label={type}
            active={
              type === "All"
                ? !filters.batteryType
                : filters.batteryType === type
            }
            onClick={() =>
              onChange({
                ...filters,
                batteryType: type === "All" ? undefined : type,
              })
            }
          />
        ))}
      </div>
    );
  }

  if (category === "solar-charge-controllers") {
    return (
      <div className="flex items-center gap-2 flex-wrap">
        <span className="text-xs text-slate-500 font-medium">System Voltage:</span>
        {SYSTEM_VOLTAGE_OPTIONS.map((v) => (
          <FilterChip
            key={v}
            label={v}
            active={
              v === "All"
                ? !filters.systemVoltage
                : filters.systemVoltage === v
            }
            onClick={() =>
              onChange({
                ...filters,
                systemVoltage: v === "All" ? undefined : v,
              })
            }
          />
        ))}
      </div>
    );
  }

  return null;
}
