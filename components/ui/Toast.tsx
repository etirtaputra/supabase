/**
 * Toast notification component
 * Displays dismissible toast notifications with animations
 */

'use client';

import React from 'react';
import { useToast } from '../../hooks/useToast';
import type { Toast as ToastType } from '../../types/forms';

export function ToastContainer() {
  const { toasts, hideToast } = useToast();

  return (
    <div className="fixed top-4 right-4 z-[100] flex flex-col gap-3 pointer-events-none max-w-sm w-full px-4 md:px-0">
      {toasts.map((toast) => (
        <ToastItem key={toast.id} toast={toast} onDismiss={() => hideToast(toast.id)} />
      ))}
    </div>
  );
}

function ToastItem({ toast, onDismiss }: { toast: ToastType; onDismiss: () => void }) {
  const getToastStyles = () => {
    switch (toast.type) {
      case 'success':
        return 'bg-emerald-950/95 border-emerald-900 text-emerald-200';
      case 'error':
        return 'bg-red-950/95 border-red-900 text-red-200';
      case 'info':
      default:
        return 'bg-slate-900/95 border-slate-700 text-slate-200';
    }
  };

  const getIcon = () => {
    switch (toast.type) {
      case 'success':
        return (
          <svg className="w-5 h-5 text-emerald-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
          </svg>
        );
      case 'error':
        return (
          <svg className="w-5 h-5 text-red-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M6 18L18 6M6 6l12 12"
            />
          </svg>
        );
      case 'info':
      default:
        return (
          <svg className="w-5 h-5 text-slate-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
            />
          </svg>
        );
    }
  };

  return (
    <div
      className={`${getToastStyles()} border rounded-lg shadow-2xl p-4 backdrop-blur-sm pointer-events-auto animate-in slide-in-from-top-5 fade-in duration-300`}
    >
      <div className="flex items-start gap-3">
        <div className="flex-shrink-0 mt-0.5">{getIcon()}</div>

        <div className="flex-1 text-sm font-medium leading-relaxed">{toast.message}</div>

        <button
          onClick={onDismiss}
          className="flex-shrink-0 ml-2 text-slate-400 hover:text-slate-200 transition-colors focus:outline-none focus:ring-2 focus:ring-slate-600 rounded"
          aria-label="Dismiss notification"
        >
          <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>
      </div>

      {/* Progress bar for auto-dismiss */}
      {toast.duration && toast.duration > 0 && (
        <div className="mt-3 h-1 bg-slate-800/50 rounded-full overflow-hidden">
          <div
            className="h-full bg-gradient-to-r from-emerald-500 to-emerald-600 rounded-full animate-[shrink_var(--duration)_linear]"
            style={{ ['--duration' as any]: `${toast.duration}ms` }}
          ></div>
        </div>
      )}
    </div>
  );
}

// Add to global CSS or tailwind.config.js:
// @keyframes shrink {
//   from { width: 100%; }
//   to { width: 0%; }
// }
