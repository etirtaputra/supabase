/**
 * Sidebar Component (Desktop Only)
 * Fixed sidebar navigation for desktop screens
 * Hidden on mobile devices
 */
'use client';
import React from 'react';
import type { Tab, MenuItem } from '../../types/forms';
interface SidebarProps {
  activeTab: Tab;
  onTabChange: (tab: Tab) => void;
  menuItems: MenuItem[];
}
export default function Sidebar({ activeTab, onTabChange, menuItems }: SidebarProps) {
  return (
    <aside className="hidden md:flex w-64 bg-[#0B1120]/95 backdrop-blur-xl border-r border-slate-800/80 flex-col fixed h-full z-20 shadow-2xl">
      {/* Header */}
      <div className="p-6 border-b border-slate-800/80 bg-slate-900/30">
        <h1 className="text-sm font-extrabold tracking-widest text-slate-300 uppercase leading-snug">
          Supabase <span className="text-slate-600 mx-1">|</span> <br />
          <span className="text-transparent bg-clip-text bg-gradient-to-r from-emerald-400 to-sky-400 text-base">ICA Supply Chain</span>
        </h1>
      </div>
      {/* Navigation Menu */}
      <nav className="flex-1 p-4 space-y-2 overflow-y-auto">
        <div className="text-[10px] uppercase tracking-widest text-slate-500 font-bold mb-3 px-3">Data Entry</div>
        {menuItems.map((item) => (
          <button
            key={item.id}
            onClick={() => onTabChange(item.id)}
            className={`w-full flex items-center px-4 py-3 rounded-xl text-sm font-semibold transition-all duration-200 text-left group ${
              activeTab === item.id
                ? 'bg-emerald-500/15 text-emerald-300 border border-emerald-500/20 shadow-inner ring-1 ring-emerald-500/30'
                : 'text-slate-400 hover:bg-slate-800/60 hover:text-slate-200 border border-transparent'
            }`}
          >
            <span className={`mr-3 text-lg transition-transform duration-200 ${activeTab === item.id ? 'scale-110' : 'group-hover:scale-110'}`}>{item.icon}</span>
            {item.label}
          </button>
        ))}
      </nav>
      {/* Footer */}
      <div className="p-4 border-t border-slate-800/80 bg-slate-900/30">
        <div className="flex items-center gap-2 px-3">
          <div className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse shadow-[0_0_8px_rgba(16,185,129,0.5)]"></div>
          <p className="text-xs text-slate-500 font-medium tracking-wide">Supply Chain v2.0</p>
        </div>
      </div>
    </aside>
  );
}
