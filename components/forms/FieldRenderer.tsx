/**
 * Field Renderer Component
 * Renders individual form fields based on configuration
 * Uses React.useId() for unique datalist IDs
 */

'use client';

import React, { useId } from 'react';
import RichDropdown from '../ui/RichDropdown';
import Autocomplete from '../ui/Autocomplete';
import { evalCell } from '@/lib/formula';
import type { FieldConfig } from '../../types/forms';

/** Shared empty list — see the rich-select branch below. */
const EMPTY_OPTIONS: any[] = [];

interface FieldRendererProps {
  field: FieldConfig;
  value: any;
  onChange: (name: string, value: any) => void;
  formId?: string;
  disabled?: boolean;
}

export default function FieldRenderer({
  field,
  value,
  onChange,
  formId,
  disabled = false,
}: FieldRendererProps) {
  const uniqueId = useId();
  const datalistId = `${formId || 'form'}-${field.name}-${uniqueId}`;

  // accent = the field belongs to a secondary document (violet border/label)
  const baseInputClasses = `w-full px-2.5 py-2 bg-slate-950 border rounded-lg text-sm text-white focus:ring-2 focus:outline-none placeholder-slate-600 transition-all disabled:opacity-50 disabled:cursor-not-allowed [&::-webkit-calendar-picker-indicator]:invert ${
    field.accent
      ? 'border-violet-500/50 focus:border-violet-400 focus:ring-violet-500/20'
      : 'border-slate-700 focus:border-emerald-500 focus:ring-emerald-500/20'}`;

  // truncate keeps every label to ONE line, so a long label can never push its
  // input below its row-mates — the grid stays aligned. The full label + hint
  // live in the tooltip.
  const labelClasses = `block text-[10px] font-bold mb-1 ml-0.5 transition-colors uppercase tracking-wider truncate ${
    field.accent
      ? 'text-violet-300/80 group-focus-within:text-violet-300'
      : 'text-slate-400 group-focus-within:text-emerald-400'}`;
  const labelTitle = [field.label, field.hint].filter(Boolean).join(' — ');

  return (
    <div className="relative w-full group">
      <label htmlFor={datalistId} className={labelClasses} title={labelTitle}>
        {field.label} {field.req && <span className="text-emerald-500">*</span>}
      </label>

      {field.type === 'rich-select' ? (
        /* A fresh [] every render would change the options identity and reset
           RichDropdown's search box mid-keystroke — share one instance. */
        <RichDropdown
          options={(field.options || EMPTY_OPTIONS) as any[]}
	  value={value}
          config={field.config}
          onChange={(val: any) => onChange(field.name, val)}
        />
      ) : field.type === 'select' ? (
        <div className="relative">
          <select
            id={datalistId}
            className={`${baseInputClasses} appearance-none`}
            value={value || ''}
            onChange={(e) => onChange(field.name, e.target.value)}
            required={field.req}
            disabled={disabled}
          >
            <option value="" className="bg-deep text-slate-400">- Select -</option>
            {field.options?.map((o: any) =>
              typeof o === 'string' ? (
                <option key={o} value={o} className="bg-deep text-white">
                  {o}
                </option>
              ) : (
                <option key={o.val} value={o.val} className="bg-deep text-white">
                  {o.txt}
                </option>
              )
            )}
          </select>
          <div className="absolute right-3 top-1/2 -translate-y-1/2 pointer-events-none text-slate-500 text-xs">
            ▼
          </div>
        </div>
      ) : field.type === 'textarea' ? (
        <textarea
          id={datalistId}
          className={`${baseInputClasses} min-h-[80px] md:min-h-[100px] resize-y`}
          value={value || ''}
          onChange={(e) => onChange(field.name, e.target.value)}
          placeholder={field.placeholder}
          required={field.req}
          disabled={disabled}
        />
      ) : field.type === 'text' && field.suggestions ? (
        <Autocomplete
          id={datalistId}
          inputClassName={baseInputClasses}
          value={value || ''}
          onChange={(val) => onChange(field.name, val)}
          suggestions={field.suggestions || []}
	  placeholder={field.placeholder}
          disabled={disabled}
          required={field.req}
        />
      ) : field.formula ? (
        /* Numeric field that accepts "=" formulas — text input so "=" can be
           typed, evaluated on blur (shared evalCell), same as the item rows. */
        <input
          id={datalistId}
          type="text"
          inputMode="decimal"
          className={baseInputClasses}
          value={value ?? ''}
          onChange={(e) => onChange(field.name, e.target.value)}
          onBlur={(e) => { const v = evalCell(e.target.value); if (v !== e.target.value) onChange(field.name, v); }}
          placeholder={field.placeholder}
          title={field.hint || 'Type = for a formula, e.g. =60765+1200'}
          required={field.req}
          disabled={disabled}
        />
      ) : (
        <input
          id={datalistId}
          type={field.type}
          className={baseInputClasses}
          value={value || ''}
          onChange={(e) => onChange(field.name, e.target.value)}
          placeholder={field.placeholder}
          title={field.hint}
          required={field.req}
          disabled={disabled}
        />
      )}
    </div>
  );
}
