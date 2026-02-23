'use client';

import { useMoney } from '@/context/MoneyContext';

export default function TransactionActionMenu() {
  const {
    actionTransaction: t,
    closeActionMenu,
    openEditModal,
    handleDeleteTransaction,
    handleToggleBookmark,
    handleDuplicate,
  } = useMoney();

  if (!t) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center">
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-black/50 backdrop-blur-sm"
        onClick={closeActionMenu}
      />

      {/* Sheet */}
      <div className="relative w-full max-w-sm bg-slate-900 rounded-t-2xl shadow-2xl overflow-hidden z-10">
        {/* Handle */}
        <div className="flex justify-center pt-3 pb-1">
          <div className="w-10 h-1 rounded-full bg-slate-700" />
        </div>

        {/* Transaction info */}
        <div className="px-5 py-3 border-b border-slate-700/50">
          <p className="text-white font-semibold text-sm truncate">{t.note || t.category || '(no note)'}</p>
          <p className="text-slate-400 text-xs mt-0.5">{t.date} · {t.account}</p>
        </div>

        {/* Actions */}
        <div className="p-3 space-y-1">
          {/* Edit */}
          <button
            onClick={() => { closeActionMenu(); openEditModal(t); }}
            className="w-full flex items-center gap-3 px-4 py-3 rounded-xl hover:bg-slate-800 transition-colors text-left"
          >
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none"
              stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
              className="w-5 h-5 text-slate-400">
              <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/>
              <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/>
            </svg>
            <span className="text-white text-sm">Edit</span>
          </button>

          {/* Bookmark */}
          <button
            onClick={() => { handleToggleBookmark(t.id, t.bookmarked); closeActionMenu(); }}
            className="w-full flex items-center gap-3 px-4 py-3 rounded-xl hover:bg-slate-800 transition-colors text-left"
          >
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"
              fill={t.bookmarked ? 'currentColor' : 'none'}
              stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
              className={`w-5 h-5 ${t.bookmarked ? 'text-yellow-400' : 'text-slate-400'}`}>
              <path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z"/>
            </svg>
            <span className="text-white text-sm">
              {t.bookmarked ? 'Remove Bookmark' : 'Bookmark'}
            </span>
          </button>

          {/* Duplicate – same date */}
          <button
            onClick={() => handleDuplicate(t, false)}
            className="w-full flex items-center gap-3 px-4 py-3 rounded-xl hover:bg-slate-800 transition-colors text-left"
          >
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none"
              stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
              className="w-5 h-5 text-slate-400">
              <rect x="9" y="9" width="13" height="13" rx="2"/>
              <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>
            </svg>
            <span className="text-white text-sm">Duplicate</span>
          </button>

          {/* Duplicate – today's date */}
          <button
            onClick={() => handleDuplicate(t, true)}
            className="w-full flex items-center gap-3 px-4 py-3 rounded-xl hover:bg-slate-800 transition-colors text-left"
          >
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none"
              stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
              className="w-5 h-5 text-slate-400">
              <rect x="3" y="4" width="18" height="18" rx="2"/>
              <line x1="16" y1="2" x2="16" y2="6"/>
              <line x1="8"  y1="2" x2="8"  y2="6"/>
              <line x1="3"  y1="10" x2="21" y2="10"/>
              <line x1="12" y1="14" x2="12" y2="18"/>
              <line x1="10" y1="16" x2="14" y2="16"/>
            </svg>
            <span className="text-white text-sm">Duplicate with Today's Date</span>
          </button>

          {/* Delete */}
          <button
            onClick={() => {
              if (confirm('Delete this transaction?')) {
                handleDeleteTransaction(t.id);
              }
            }}
            className="w-full flex items-center gap-3 px-4 py-3 rounded-xl hover:bg-rose-500/10 transition-colors text-left"
          >
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none"
              stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
              className="w-5 h-5 text-rose-400">
              <polyline points="3 6 5 6 21 6"/>
              <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/>
              <path d="M10 11v6"/>
              <path d="M14 11v6"/>
              <path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/>
            </svg>
            <span className="text-rose-400 text-sm">Delete</span>
          </button>
        </div>

        {/* Cancel */}
        <div className="px-5 pb-6 pt-1">
          <button
            onClick={closeActionMenu}
            className="w-full py-3 rounded-xl bg-slate-800 text-slate-300 hover:bg-slate-700 text-sm font-semibold transition-colors"
          >
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}
