/**
 * Mobile Navigation Component
 * Sticky top navigation bar for mobile/tablet devices
 * Hidden on desktop screens
 */

'use client';

import React from 'react';
import type { Tab, MenuItem } from '../../types/forms';

interface MobileNavProps {
  activeTab: Tab;
  onTabChange: (tab: Tab) => void;
  menuItems: MenuItem[];
  message?: string;
}

export default function MobileNav({ activeTab, onTabChange, menuItems, message }: MobileNavProps) {
  return (
    <div className="md:hidden bg-slate-900 border-b border-slate-800 p-4 sticky top-0 z-50 shadow-lg">
      {/* Header Row */}
      <div className="flex justify-between items-center mb-4">
        <h1 className="font-bold text-white text-lg">Supply Chain</h1>
        {message && (
          <span
            className={`text-xs px-2 py-1 rounded font-bold ${
              message.includes('Error') || message.includes('❌')
                ? 'bg-red-900 text-red-200'
                : 'bg-emerald-900 text-emerald-200'
            }`}
          >
            {message}
          </span>
        )}
      </div>

      {/* Horizontal Scrollable Tabs */}
      <div className="flex overflow-x-auto space-x-2 pb-2 scrollbar-hide snap-x snap-mandatory">
        {menuItems.map((item) => (
          <button
            key={item.id}
            onClick={() => onTabChange(item.id)}
            className={`whitespace-nowrap px-4 py-2 rounded-full text-xs font-bold transition-all snap-center flex-shrink-0 min-h-[44px] flex items-center gap-2 ${
              activeTab === item.id
                ? 'bg-emerald-600 text-white shadow-lg'
                : 'bg-slate-800 text-slate-400 hover:bg-slate-700'
            }`}
          >
            <span className="text-base">{item.icon}</span>
            <span className="hidden sm:inline">{item.label}</span>
          </button>
        ))}
      </div>
    </div>
  );
}
