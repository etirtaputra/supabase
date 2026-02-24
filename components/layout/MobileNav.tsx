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
    <div className="md:hidden bg-[#0B1120]/80 backdrop-blur-md border-b border-slate-800/60 pt-4 pb-3 px-4 sticky top-0 z-50 shadow-lg shadow-black/20">
      {/* Header Row */}
      <div className="flex justify-between items-end mb-3">
        <div>
          <h1 className="font-extrabold text-transparent bg-clip-text bg-gradient-to-r from-emerald-400 to-sky-400 text-lg tracking-tight leading-none mb-1">Data Entry</h1>
          <p className="text-[10px] text-slate-400 uppercase tracking-widest font-bold">ICA Supply Chain</p>
        </div>
        {message && (
          <span
            className={`text-[10px] px-2.5 py-1 rounded-md font-bold border ${
              message.includes('Error') || message.includes('❌')
                ? 'bg-red-500/10 text-red-400 border-red-500/20'
                : 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20'
            }`}
          >
            {message}
          </span>
        )}
      </div>
      {/* Horizontal Scrollable Tabs */}
      <div className="flex overflow-x-auto gap-2 pb-1 scrollbar-none snap-x snap-mandatory">
        {menuItems.map((item) => (
          <button
            key={item.id}
            onClick={() => onTabChange(item.id)}
            className={`whitespace-nowrap px-4 py-2 rounded-full text-xs font-bold transition-all snap-center flex-shrink-0 min-h-[40px] flex items-center gap-2 border ${
              activeTab === item.id
                ? 'bg-emerald-500/15 text-emerald-300 border-emerald-500/30 ring-1 ring-emerald-500/20'
                : 'bg-slate-800/40 text-slate-400 border-transparent hover:bg-slate-800/80 hover:text-slate-200'
            }`}
          >
            <span className="text-sm">{item.icon}</span>
            <span>{item.label}</span>
          </button>
        ))}
      </div>
    </div>
  );
}
