"use client";

import { useState } from "react";
import { Copy, Check } from "lucide-react";
import { cn, formatSpecValue } from "@/lib/utils";

export interface SpecRow {
  key: string;
  label: string;
  value: unknown;
  unit?: string;
}

export interface SpecSection {
  title: string;
  rows: SpecRow[];
}

interface SpecTableProps {
  sections: SpecSection[];
}

function SpecRowItem({ row }: { row: SpecRow }) {
  const [copied, setCopied] = useState(false);
  const displayValue = formatSpecValue(row.value, row.unit);

  const handleCopy = async () => {
    await navigator.clipboard.writeText(`${row.label}: ${displayValue}`);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const isNull = row.value === null || row.value === undefined || row.value === "";

  return (
    <tr className="group border-b border-slate-800/50 last:border-0 hover:bg-slate-800/30 transition-colors">
      <td className="py-2.5 px-3 text-slate-400 text-sm font-medium w-1/2">
        {row.label}
      </td>
      <td className="py-2.5 px-3 w-1/2">
        {isNull ? (
          <span className="text-slate-600 font-mono">—</span>
        ) : Array.isArray(row.value) ? (
          <div className="flex flex-wrap gap-1">
            {(row.value as string[]).map((cert, i) => (
              <span
                key={i}
                className="text-xs px-2 py-0.5 bg-slate-700/50 border border-slate-600/50 rounded-full text-slate-300"
              >
                {cert}
              </span>
            ))}
          </div>
        ) : (
          <span className="font-mono text-sm text-slate-100">{displayValue}</span>
        )}
      </td>
      <td className="py-2.5 pr-3 w-8">
        {!isNull && (
          <button
            onClick={handleCopy}
            className="opacity-0 group-hover:opacity-100 transition-opacity p-1 rounded hover:bg-slate-700 text-slate-400 hover:text-slate-200"
            title="Copy to clipboard"
          >
            {copied ? (
              <Check className="h-3 w-3 text-emerald-400" />
            ) : (
              <Copy className="h-3 w-3" />
            )}
          </button>
        )}
      </td>
    </tr>
  );
}

export default function SpecTable({ sections }: SpecTableProps) {
  return (
    <div className="space-y-6">
      {sections.map((section) => {
        const visibleRows = section.rows.filter(
          (row) =>
            row.value !== null &&
            row.value !== undefined &&
            row.value !== "" &&
            !(Array.isArray(row.value) && row.value.length === 0)
        );

        if (visibleRows.length === 0) return null;

        return (
          <div key={section.title} className="rounded-xl border border-slate-700/50 overflow-hidden bg-slate-900/30">
            <div className="px-4 py-2.5 bg-slate-800/50 border-b border-slate-700/50">
              <h3 className="text-sm font-semibold text-slate-300 uppercase tracking-wider">
                {section.title}
              </h3>
            </div>
            <table className="w-full">
              <tbody>
                {visibleRows.map((row) => (
                  <SpecRowItem key={row.key} row={row} />
                ))}
              </tbody>
            </table>
          </div>
        );
      })}
    </div>
  );
}
