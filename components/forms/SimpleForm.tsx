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
      className="bg-slate-900/40 backdrop-blur-sm rounded-2xl border border-slate-800/80 p-5 md:p-8 shadow-xl ring-1 ring-white/5 h-full flex flex-col transition-all"
    >
      {/* Form Title */}
      <div className="flex items-center gap-3 border-b border-slate-800/80 pb-4 mb-6">
        <div className="w-8 h-8 rounded-lg bg-emerald-500/10 border border-emerald-500/20 flex items-center justify-center">
          <span className="w-2.5 h-2.5 rounded-full bg-emerald-500 shadow-[0_0_10px_rgba(16,185,129,0.8)]"></span>
        </div>
        <h3 className="text-lg font-bold text-white tracking-tight">{title}</h3>
      </div>
      {/* Form Fields */}
      <div className="grid gap-6 flex-1">
        {fields.map((field) => (
          <div key={field.name} className="group">
            <FieldRenderer
              field={field}
              value={data[field.name]}
              onChange={handleChange}
              formId={formId}
              disabled={loading}
            />
          </div>
        ))}
      </div>
      {/* Submit Button */}
      <div className="mt-8 pt-6 border-t border-slate-800/80">
        <button
          type="submit"
          disabled={loading}
          className="w-full bg-emerald-600 hover:bg-emerald-500 text-white font-bold py-3.5 px-4 rounded-xl text-sm shadow-lg shadow-emerald-900/20 border border-emerald-500/50 transition-all hover:-translate-y-0.5 active:translate-y-0 disabled:opacity-50 disabled:transform-none disabled:cursor-not-allowed flex items-center justify-center gap-2"
        >
          {loading ? (
            <>
              <Spinner className="w-4 h-4" />
              <span>Saving Record...</span>
            </>
          ) : (
            <>
              <span>Save Record</span>
              <svg className="w-4 h-4 ml-1 opacity-70" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" /></svg>
            </>
          )}
        </button>
      </div>
    </form>
  );
}
