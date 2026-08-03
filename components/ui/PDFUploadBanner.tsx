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

export default function PDFUploadBanner({ title, description, pdfData, uploading, onUpload, onClear }: Props) {
  // One slim strip, not a hero card — the forms are the page, this is a shortcut.
  return (
    <div className="mb-4 flex flex-wrap items-center gap-x-3 gap-y-2 px-3.5 py-2 bg-slate-900/40 border border-slate-800 rounded-xl">
      <svg className="w-4 h-4 text-emerald-400/80 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="1.8"><path strokeLinecap="round" strokeLinejoin="round" d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12" /></svg>
      <span className="text-xs font-semibold text-slate-200">{title}</span>
      <span className="text-[11px] text-slate-500 truncate hidden sm:inline">{description}</span>
      {pdfData && (
        <span className="inline-flex items-center gap-1.5 text-emerald-400 text-[11px] font-semibold">
          <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2"><path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" /></svg>
          {pdfData.line_items?.length || 0} items extracted{pdfData.supplier_name ? ` from ${pdfData.supplier_name}` : ''}
        </span>
      )}
      <span className="ml-auto flex items-center gap-2">
        {pdfData && (
          <button onClick={onClear}
            className="px-2.5 py-1 rounded-md border border-slate-700/70 text-[11px] font-medium text-slate-400 hover:text-white hover:border-slate-500 transition-colors">
            Clear
          </button>
        )}
        <label className="cursor-pointer">
          <input type="file" accept="application/pdf" onChange={onUpload} disabled={uploading} className="hidden" />
          <span className={`flex items-center gap-1.5 px-3 py-1 rounded-md bg-emerald-600 hover:bg-emerald-500 text-white text-[11px] font-bold transition-colors ${uploading ? 'opacity-70 cursor-not-allowed' : ''}`}>
            {uploading ? <><Spin /> Extracting…</> : 'Upload PDF'}
          </span>
        </label>
      </span>
    </div>
  );
}

function Spin() {
  return <span className="w-3 h-3 border-2 border-white/30 border-t-white rounded-full animate-spin inline-block" />;
}
