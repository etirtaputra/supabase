'use client';
import React from 'react';

interface Props {
  title: string;
  description: string;
  pdfData: any;
  uploading: boolean;
  onUpload: (e: React.ChangeEvent<HTMLInputElement>) => void;
  onClear: () => void;
}

/**
 * The AI-extraction entry point is ONE left-aligned button — the forms are the
 * page. The explanation lives in the tooltip; after an extraction the result
 * ("12 items from EPEVER") and a Clear link appear beside it.
 */
export default function PDFUploadBanner({ title, description, pdfData, uploading, onUpload, onClear }: Props) {
  return (
    <div className="mb-4 flex flex-wrap items-center gap-3">
      <label className="cursor-pointer" title={description}>
        <input type="file" accept="application/pdf" onChange={onUpload} disabled={uploading} className="hidden" />
        <span className={`inline-flex items-center gap-2 px-3.5 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-bold transition-colors ${uploading ? 'opacity-70 cursor-not-allowed' : ''}`}>
          {uploading
            ? <span className="w-3.5 h-3.5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
            : <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2"><path strokeLinecap="round" strokeLinejoin="round" d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12" /></svg>}
          {uploading ? 'Extracting…' : title}
        </span>
      </label>
      {pdfData && (
        <>
          <span className="inline-flex items-center gap-1.5 text-emerald-400 text-[11px] font-semibold">
            <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2"><path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" /></svg>
            {pdfData.line_items?.length || 0} items extracted{pdfData.supplier_name ? ` from ${pdfData.supplier_name}` : ''}
          </span>
          <button onClick={onClear} className="text-[11px] text-slate-500 hover:text-slate-300 hover:underline underline-offset-2 transition-colors">
            Clear
          </button>
        </>
      )}
    </div>
  );
}
