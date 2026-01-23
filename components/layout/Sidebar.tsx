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
    <aside className="hidden md:flex w-64 bg-slate-900 border-r border-slate-800 flex-col fixed h-full z-20 shadow-xl">
      {/* Header */}
      <div className="p-6 border-b border-slate-800">
        <h1 className="text-base font-bold text-white tracking-wide uppercase leading-tight">
          Supabase | <br />
          <span className="text-emerald-500">ICA Supply Chain</span>
        </h1>
      </div>

      {/* Navigation Menu */}
      <nav className="flex-1 p-4 space-y-2 overflow-y-auto">
        {menuItems.map((item) => (
          <button
            key={item.id}
            onClick={() => onTabChange(item.id)}
            className={`w-full flex items-center px-4 py-3 rounded-md text-sm font-medium transition-all duration-200 text-left ${
              activeTab === item.id
                ? 'bg-emerald-600/10 text-emerald-400 border border-emerald-600/20 shadow-sm'
                : 'text-slate-400 hover:bg-slate-800 hover:text-slate-200'
            }`}
          >
            <span className="mr-3 opacity-70 text-base">{item.icon}</span>
            {item.label}
          </button>
        ))}
      </nav>

      {/* Footer (Optional) */}
      <div className="p-4 border-t border-slate-800">
        <p className="text-xs text-slate-600 text-center">Supply Chain v2.0</p>
      </div>
    </aside>
  );
}
