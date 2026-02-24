/**
 * Loading skeleton components
 * Provides animated placeholder UI while data is loading
 */

import React from 'react';

// Shimmer animation effect
const shimmer = 'animate-pulse bg-gradient-to-r from-slate-800 via-slate-700 to-slate-800 bg-[length:200%_100%]';

export function TableSkeleton({ rows = 5, columns = 4 }: { rows?: number; columns?: number }) {
  return (
    <div className="bg-slate-900 border border-slate-800 rounded-xl overflow-hidden shadow-xl">
      {/* Header */}
      <div className="p-4 border-b border-slate-800 bg-slate-950/30">
        <div className={`h-4 ${shimmer} rounded w-32`}></div>
      </div>

      {/* Table */}
      <div className="overflow-hidden">
        <table className="w-full">
          <thead className="bg-slate-950">
            <tr>
              {Array.from({ length: columns }).map((_, i) => (
                <th key={i} className="px-6 py-3">
                  <div className={`h-3 ${shimmer} rounded w-20`}></div>
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-800/50">
            {Array.from({ length: rows }).map((_, rowIndex) => (
              <tr key={rowIndex} className="bg-slate-900/40">
                {Array.from({ length: columns }).map((_, colIndex) => (
                  <td key={colIndex} className="px-6 py-3">
                    <div className={`h-3 ${shimmer} rounded w-full max-w-[120px]`}></div>
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export function FormSkeleton({ fields = 6 }: { fields?: number }) {
  return (
    <div className="bg-slate-900 rounded-xl border border-slate-800 p-6 shadow-xl">
      {/* Form title */}
      <div className={`h-4 ${shimmer} rounded w-48 mb-6`}></div>

      {/* Form fields */}
      <div className="space-y-5">
        {Array.from({ length: fields }).map((_, i) => (
          <div key={i}>
            <div className={`h-3 ${shimmer} rounded w-24 mb-2`}></div>
            <div className={`h-10 ${shimmer} rounded w-full`}></div>
          </div>
        ))}
      </div>

      {/* Submit button */}
      <div className={`h-11 ${shimmer} rounded w-full mt-8`}></div>
    </div>
  );
}

export function CardSkeleton() {
  return (
    <div className="bg-slate-900 rounded-xl border border-slate-800 p-6 shadow-xl space-y-4">
      <div className={`h-5 ${shimmer} rounded w-3/4`}></div>
      <div className={`h-4 ${shimmer} rounded w-1/2`}></div>
      <div className={`h-4 ${shimmer} rounded w-full`}></div>
      <div className={`h-4 ${shimmer} rounded w-5/6`}></div>
    </div>
  );
}

// Inline spinner for button loading states
export function Spinner({ className = 'w-4 h-4' }: { className?: string }) {
  return (
    <svg
      className={`${className} animate-spin text-white`}
      xmlns="http://www.w3.org/2000/svg"
      fill="none"
      viewBox="0 0 24 24"
    >
      <circle
        className="opacity-25"
        cx="12"
        cy="12"
        r="10"
        stroke="currentColor"
        strokeWidth="4"
      ></circle>
      <path
        className="opacity-75"
        fill="currentColor"
        d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
      ></path>
    </svg>
  );
}

// Full page loading overlay
export function LoadingOverlay({ message = 'Loading...' }: { message?: string }) {
  return (
    <div className="fixed inset-0 bg-slate-950/80 backdrop-blur-sm z-50 flex items-center justify-center">
      <div className="bg-slate-900 rounded-xl border border-slate-800 p-8 shadow-2xl flex flex-col items-center gap-4">
        <Spinner className="w-10 h-10" />
        <p className="text-slate-300 font-medium">{message}</p>
      </div>
    </div>
  );
}
