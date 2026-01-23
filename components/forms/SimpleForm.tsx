/**
 * Simple Form Component
 * Reusable form wrapper with loading states and validation
 * Mobile-optimized layout
 */

'use client';

import React, { useState, useEffect, useId } from 'react';
import FieldRenderer from './FieldRenderer';
import { Spinner } from '../ui/LoadingSkeleton';
import type { SimpleFormProps } from '../../types/forms';

export default function SimpleForm({ title, fields, onSubmit, loading }: SimpleFormProps) {
  const [data, setData] = useState<Record<string, any>>({});
  const formId = useId();

  // Initialize form with default values
  useEffect(() => {
    const defaults: Record<string, any> = {};
    fields.forEach((f) => {
      if (f.default !== undefined) defaults[f.name] = f.default;
    });
    setData(defaults);
  }, [fields]);

  const handleChange = (name: string, value: any) => {
    setData({ ...data, [name]: value });
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    onSubmit(data);
  };

  return (
    <form
      onSubmit={handleSubmit}
      className="bg-slate-900 rounded-xl border border-slate-800 p-5 md:p-6 shadow-xl h-full flex flex-col"
    >
      {/* Form Title */}
      <h3 className="text-base font-bold text-white border-b border-slate-800 pb-4 mb-6 flex items-center gap-3">
        <span className="w-2 h-2 rounded-full bg-emerald-500 shadow-[0_0_8px_rgba(16,185,129,0.5)]"></span>
        {title}
      </h3>

      {/* Form Fields */}
      <div className="grid gap-5 flex-1">
        {fields.map((field) => (
          <FieldRenderer
            key={field.name}
            field={field}
            value={data[field.name]}
            onChange={handleChange}
            formId={formId}
            disabled={loading}
          />
        ))}
      </div>

      {/* Submit Button */}
      <div className="mt-8">
        <button
          type="submit"
          disabled={loading}
          className="w-full bg-emerald-600 hover:bg-emerald-500 text-white font-bold py-3 px-4 rounded-lg text-sm shadow-lg shadow-emerald-900/20 transition-all hover:-translate-y-0.5 active:translate-y-0 disabled:opacity-50 disabled:transform-none disabled:cursor-not-allowed flex items-center justify-center gap-2"
        >
          {loading ? (
            <>
              <Spinner className="w-4 h-4" />
              Saving...
            </>
          ) : (
            'Save Record'
          )}
        </button>
      </div>
    </form>
  );
}
