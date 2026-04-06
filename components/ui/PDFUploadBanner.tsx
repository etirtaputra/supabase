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
  return (
    <div className="mb-6 bg-gradient-to-br from-blue-900/40 via-slate-900/40 to-indigo-900/40 backdrop-blur-sm border border-blue-500/30 rounded-2xl p-5 md:p-6 shadow-2xl ring-1 ring-white/5 relative overflow-hidden">
      <div className="absolute top-0 right-0 w-64 h-64 bg-blue-500/10 rounded-full blur-3xl -mr-20 -mt-20 pointer-events-none" />
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 relative z-10">
        <div className="flex items-start sm:items-center gap-4">
          <div className="p-2.5 bg-blue-500/20 rounded-xl border border-blue-500/30 shadow-inner flex-shrink-0">
            <span className="text-2xl block leading-none">📄</span>
          </div>
          <div>
            <h3 className="text-base font-bold text-white mb-0.5 tracking-tight">{title}</h3>
            <p className="text-xs text-blue-200/80 font-medium">{description}</p>
            {pdfData && (
              <div className="mt-2 inline-flex items-center gap-2 bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 px-3 py-1 rounded-lg text-xs font-bold">
                <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                </svg>
                Extracted {pdfData.line_items?.length || 0} items
                {pdfData.supplier_name ? ` from ${pdfData.supplier_name}` : ''}
              </div>
            )}
          </div>
        </div>
        <div className="flex gap-2 w-full sm:w-auto">
          {pdfData && (
            <button
              onClick={onClear}
              className="px-4 py-2 bg-slate-800/80 hover:bg-slate-700 border border-slate-600/50 text-white rounded-xl text-xs font-bold transition-all w-full sm:w-auto"
            >
              Clear
            </button>
          )}
          <label className="cursor-pointer w-full sm:w-auto">
            <input type="file" accept="application/pdf" onChange={onUpload} disabled={uploading} className="hidden" />
            <span className={`flex items-center justify-center gap-2 bg-blue-600 hover:bg-blue-500 text-white px-5 py-2 rounded-xl text-xs font-bold shadow-lg shadow-blue-900/20 transition-all active:scale-[0.98] w-full sm:w-auto border border-blue-500 ${uploading ? 'opacity-70 cursor-not-allowed' : ''}`}>
              {uploading
                ? <><span className="animate-spin text-base leading-none">⏳</span> Extracting...</>
                : <><span className="text-base leading-none">📤</span> Upload PDF</>}
            </span>
          </label>
        </div>
      </div>
    </div>
  );
}
