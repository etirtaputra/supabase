/**
 * Field Renderer Component
 * Renders individual form fields based on configuration
 * Uses React.useId() for unique datalist IDs
 */

'use client';

import React, { useId } from 'react';
import RichDropdown from '../ui/RichDropdown';
import Autocomplete from '../ui/Autocomplete';
import type { FieldConfig } from '../../types/forms';

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

  const baseInputClasses =
    'w-full p-2.5 md:p-3 bg-slate-950 border border-slate-700 rounded-lg text-sm text-white focus:border-emerald-500 focus:ring-2 focus:ring-emerald-500/20 focus:outline-none placeholder-slate-600 transition-all disabled:opacity-50 disabled:cursor-not-allowed [&::-webkit-calendar-picker-indicator]:invert';

  const labelClasses =
    'block text-[11px] font-bold text-slate-400 mb-2 ml-1 group-focus-within:text-emerald-400 transition-colors uppercase tracking-wider';

  return (
    <div className="relative w-full group">
      <label htmlFor={datalistId} className={labelClasses}>
        {field.label} {field.req && <span className="text-emerald-500">*</span>}
      </label>

      {field.type === 'rich-select' ? (
        <RichDropdown
          options={(field.options || []) as any[]}
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
            <option value="">- Select -</option>
            {field.options?.map((o: any) =>
              typeof o === 'string' ? (
                <option key={o} value={o}>
                  {o}
                </option>
              ) : (
                <option key={o.val} value={o.val}>
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
          value={value || ''}
          onChange={(val) => onChange(field.name, val)}
          suggestions={field.suggestions || []}
	  placeholder={field.placeholder}
          disabled={disabled}
          required={field.req}
        />
      ) : (
        <input
          id={datalistId}
          type={field.type}
          className={baseInputClasses}
          value={value || ''}
          onChange={(e) => onChange(field.name, e.target.value)}
          placeholder={field.placeholder}
          required={field.req}
          disabled={disabled}
        />
      )}
    </div>
  );
}
