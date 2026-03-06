/**
 * Component Editor
 * Inline bulk editor for components with search, filter, sort, and before/after diff.
 */
'use client';

import React, { useState, useMemo, useRef, useEffect, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { Spinner } from './LoadingSkeleton';
import type { Component } from '../../types/database';
import { ENUMS } from '../../constants/enums';

interface ComponentEditorProps {
  components: Component[];
  brandSuggestions: string[];
  onSave: (updates: { component_id: number; changes: Partial<Component> }[]) => Promise<void>;
}

type SortCol = 'supplier_model' | 'internal_description' | 'brand' | 'category' | 'created_at' | 'updated_at';
type PendingEdits = Record<number, Partial<Component>>;

// --- Brand Autocomplete (fixed-position dropdown to escape table overflow) ---
interface BrandInputProps {
  value: string;
  onChange: (v: string) => void;
  suggestions: string[];
  isDirty: boolean;
}
function BrandInput({ value, onChange, suggestions, isDirty }: BrandInputProps) {
  const [open, setOpen] = useState(false);
  const [activeIdx, setActiveIdx] = useState(-1);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const [dropStyle, setDropStyle] = useState<React.CSSProperties>({});

  const filtered = useMemo(() => {
    const q = value.toLowerCase();
    const matches = q ? suggestions.filter((s) => s.toLowerCase().includes(q)) : suggestions;
    return matches.slice(0, 20);
  }, [value, suggestions]);

  const openDrop = useCallback(() => {
    if (!inputRef.current) return;
    const r = inputRef.current.getBoundingClientRect();
    setDropStyle({
      position: 'fixed',
      top: r.bottom + 2,
      left: r.left,
      width: r.width,
      zIndex: 9999,
    });
    setOpen(true);
    setActiveIdx(-1);
  }, []);

  // Close on outside click
  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (
        inputRef.current?.contains(e.target as Node) ||
        listRef.current?.contains(e.target as Node)
      )
        return;
      setOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);

  // Scroll active item into view
  useEffect(() => {
    if (activeIdx >= 0 && listRef.current) {
      const el = listRef.current.children[activeIdx] as HTMLElement;
      el?.scrollIntoView({ block: 'nearest' });
    }
  }, [activeIdx]);

  const select = (s: string) => {
    onChange(s);
    setOpen(false);
  };

  const handleKey = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (!open) {
      if (e.key === 'ArrowDown') { openDrop(); return; }
      return;
    }
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActiveIdx((i) => Math.min(i + 1, filtered.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActiveIdx((i) => Math.max(i - 1, -1));
    } else if (e.key === 'Enter' && activeIdx >= 0) {
      e.preventDefault();
      select(filtered[activeIdx]);
    } else if (e.key === 'Escape') {
      setOpen(false);
    }
  };

  const dropContent = open && filtered.length > 0 && (
    <div
      ref={listRef}
      style={dropStyle}
      className="bg-slate-900 border border-emerald-500/50 rounded-lg shadow-2xl max-h-52 overflow-y-auto custom-scrollbar"
    >
      {filtered.map((s, i) => (
        <div
          key={s}
          onMouseDown={() => select(s)}
          className={`px-3 py-2 text-sm cursor-pointer border-b border-slate-800/50 last:border-0 ${
            i === activeIdx
              ? 'bg-emerald-600/30 text-white'
              : 'text-slate-300 hover:bg-slate-800 hover:text-white'
          }`}
        >
          {s}
        </div>
      ))}
    </div>
  );

  return (
    <>
      <input
        ref={inputRef}
        type="text"
        value={value}
        onChange={(e) => { onChange(e.target.value); if (!open) openDrop(); }}
        onFocus={openDrop}
        onKeyDown={handleKey}
        autoComplete="off"
        className={`w-full px-2.5 py-1.5 rounded-lg text-sm text-white focus:outline-none focus:ring-2 transition-all ${
          isDirty
            ? 'bg-amber-500/10 border border-amber-500/50 focus:ring-amber-500/30'
            : 'bg-slate-950 border border-slate-700 focus:ring-emerald-500/20 focus:border-emerald-500'
        }`}
      />
      {typeof document !== 'undefined' &&
        createPortal(dropContent, document.body)}
    </>
  );
}

// --- Main Component Editor ---
export default function ComponentEditor({ components, brandSuggestions, onSave }: ComponentEditorProps) {
  const [search, setSearch] = useState('');
  const [filterBrand, setFilterBrand] = useState('');
  const [filterCategory, setFilterCategory] = useState('');
  const [sortCol, setSortCol] = useState<SortCol>('supplier_model');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('asc');
  const [editingIds, setEditingIds] = useState<Set<number>>(new Set());
  const [pending, setPending] = useState<PendingEdits>({});
  const [saving, setSaving] = useState(false);

  const uniqueBrands = useMemo(
    () => [...new Set(components.map((c) => c.brand).filter(Boolean))].sort() as string[],
    [components]
  );

  const filtered = useMemo(() => {
    let result = components;
    if (search) {
      const q = search.toLowerCase();
      result = result.filter(
        (c) =>
          c.supplier_model?.toLowerCase().includes(q) ||
          c.internal_description?.toLowerCase().includes(q) ||
          c.brand?.toLowerCase().includes(q)
      );
    }
    if (filterBrand) result = result.filter((c) => c.brand === filterBrand);
    if (filterCategory) result = result.filter((c) => c.category === filterCategory);
    return [...result].sort((a, b) => {
      if (sortCol === 'created_at' || sortCol === 'updated_at') {
        const av = a[sortCol] ? new Date(a[sortCol] as string).getTime() : 0;
        const bv = b[sortCol] ? new Date(b[sortCol] as string).getTime() : 0;
        return sortDir === 'asc' ? av - bv : bv - av;
      }
      const av = ((a[sortCol] as string) || '').toLowerCase();
      const bv = ((b[sortCol] as string) || '').toLowerCase();
      return sortDir === 'asc' ? av.localeCompare(bv) : bv.localeCompare(av);
    });
  }, [components, search, filterBrand, filterCategory, sortCol, sortDir]);

  const toggleSort = (col: SortCol) => {
    if (sortCol === col) setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
    else { setSortCol(col); setSortDir('asc'); }
  };

  const getVal = (c: Component, field: keyof Component): any =>
    pending[c.component_id] !== undefined && field in pending[c.component_id]
      ? pending[c.component_id][field]
      : c[field];

  const isDirtyField = (c: Component, field: keyof Component) => {
    const p = pending[c.component_id];
    return p !== undefined && field in p && p[field] !== c[field];
  };

  const setField = (c: Component, field: keyof Component, value: any) => {
    setPending((prev) => {
      const cur: Partial<Component> = { ...(prev[c.component_id] || {}) };
      const original = c[field];
      if (value === original || (value === '' && original == null) || (value === null && original == null)) {
        delete (cur as any)[field];
      } else {
        (cur as any)[field] = value === '' ? null : value;
      }
      if (Object.keys(cur).length === 0) {
        const next = { ...prev };
        delete next[c.component_id];
        return next;
      }
      return { ...prev, [c.component_id]: cur };
    });
  };

  const discardRow = (id: number) => {
    setPending((prev) => { const n = { ...prev }; delete n[id]; return n; });
    setEditingIds((prev) => { const n = new Set(prev); n.delete(id); return n; });
  };

  const discardAll = () => { setPending({}); setEditingIds(new Set()); };

  const dirtyIds = useMemo(() => Object.keys(pending).map(Number).filter((n) => !isNaN(n)), [pending]);
  const dirtyCount = dirtyIds.length;

  const handleSaveAll = async () => {
    if (!dirtyCount || saving) return;
    setSaving(true);
    try {
      await onSave(dirtyIds.map((id) => ({ component_id: id, changes: pending[id] })));
      setPending({});
      setEditingIds(new Set());
    } catch {
      // errors already surfaced via toast in onSave; keep pending so user can retry
    } finally {
      setSaving(false);
    }
  };

  const toggleEdit = (id: number) => {
    setEditingIds((prev) => {
      const n = new Set(prev);
      n.has(id) ? n.delete(id) : n.add(id);
      return n;
    });
  };

  const fmtDate = (ts?: string) => {
    if (!ts) return '—';
    return new Date(ts).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
  };

  const SortTh = ({ col, label, className = '' }: { col: SortCol; label: string; className?: string }) => (
    <th
      className={`px-4 py-3 text-left text-xs font-bold uppercase tracking-wider text-slate-400 cursor-pointer select-none hover:text-white transition-colors ${className}`}
      onClick={() => toggleSort(col)}
    >
      <span className="flex items-center gap-1.5">
        {label}
        {sortCol === col ? (
          <span className="text-emerald-400 text-[11px]">{sortDir === 'asc' ? '↑' : '↓'}</span>
        ) : (
          <span className="text-slate-700 text-[11px]">↕</span>
        )}
      </span>
    </th>
  );

  const DirtyBadge = ({ original }: { original: string | null | undefined }) => (
    <p className="mt-0.5 text-[11px] text-amber-400/80 leading-tight">
      was: <span className="font-mono">{original || '—'}</span>
    </p>
  );

  return (
    <div className="bg-slate-900/40 backdrop-blur-sm rounded-2xl border border-slate-800/80 shadow-xl ring-1 ring-white/5">
      {/* Header */}
      <div className="flex items-center gap-3 border-b border-slate-800/80 p-5 md:p-6">
        <div className="w-8 h-8 rounded-lg bg-amber-500/10 border border-amber-500/20 flex items-center justify-center flex-shrink-0">
          <span className="w-2.5 h-2.5 rounded-full bg-amber-400 shadow-[0_0_10px_rgba(251,191,36,0.8)]"></span>
        </div>
        <div>
          <h3 className="text-lg font-bold text-white tracking-tight">Component Editor</h3>
          <p className="text-xs text-slate-500 mt-0.5">Click ✎ to edit a row. Changes are staged until you save.</p>
        </div>
      </div>

      {/* Toolbar */}
      <div className="p-4 md:p-5 border-b border-slate-800/60 space-y-3">
        <div className="flex flex-wrap gap-3">
          {/* Search */}
          <div className="relative flex-1 min-w-[200px]">
            <svg className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-500 pointer-events-none" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
            </svg>
            <input
              type="text"
              placeholder="Search model, description, brand..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="w-full pl-9 pr-8 py-2.5 bg-slate-950 border border-slate-700 rounded-lg text-sm text-white focus:border-emerald-500 focus:ring-2 focus:ring-emerald-500/20 focus:outline-none placeholder-slate-600"
            />
            {search && (
              <button
                onClick={() => setSearch('')}
                className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-500 hover:text-white"
              >
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            )}
          </div>
          {/* Brand filter */}
          <select
            value={filterBrand}
            onChange={(e) => setFilterBrand(e.target.value)}
            className="py-2.5 px-3 bg-slate-950 border border-slate-700 rounded-lg text-sm text-white focus:border-emerald-500 focus:outline-none min-w-[140px]"
          >
            <option value="">All Brands</option>
            {uniqueBrands.map((b) => <option key={b} value={b}>{b}</option>)}
          </select>
          {/* Category filter */}
          <select
            value={filterCategory}
            onChange={(e) => setFilterCategory(e.target.value)}
            className="py-2.5 px-3 bg-slate-950 border border-slate-700 rounded-lg text-sm text-white focus:border-emerald-500 focus:outline-none min-w-[160px]"
          >
            <option value="">All Categories</option>
            {ENUMS.product_category.map((c) => <option key={c} value={c}>{c}</option>)}
          </select>
        </div>

        {/* Stats + action buttons */}
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <p className="text-xs text-slate-500">
            Showing <span className="text-slate-300 font-semibold">{filtered.length}</span> of {components.length} components
            {dirtyCount > 0 && (
              <span className="ml-2 text-amber-400 font-semibold">
                · {dirtyCount} unsaved {dirtyCount === 1 ? 'edit' : 'edits'}
              </span>
            )}
          </p>
          <div className="flex gap-2">
            {dirtyCount > 0 && (
              <button
                onClick={discardAll}
                disabled={saving}
                className="px-3 py-1.5 text-xs font-semibold bg-slate-800 hover:bg-slate-700 text-slate-300 border border-slate-700 rounded-lg transition-all disabled:opacity-50"
              >
                Discard All
              </button>
            )}
            <button
              onClick={handleSaveAll}
              disabled={dirtyCount === 0 || saving}
              className="flex items-center gap-1.5 px-4 py-1.5 text-xs font-bold bg-emerald-600 hover:bg-emerald-500 text-white rounded-lg shadow-lg shadow-emerald-900/20 transition-all disabled:opacity-40 disabled:cursor-not-allowed"
            >
              {saving ? (
                <><Spinner className="w-3.5 h-3.5" /> Saving...</>
              ) : (
                <>Save{dirtyCount > 0 ? ` ${dirtyCount}` : ''} Changes</>
              )}
            </button>
          </div>
        </div>
      </div>

      {/* Table */}
      <div className="overflow-x-auto">
        {filtered.length === 0 ? (
          <div className="py-16 text-center text-slate-500">
            <svg className="w-10 h-10 mx-auto mb-3 opacity-30" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9.172 16.172a4 4 0 015.656 0M9 10h.01M15 10h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
            <p className="font-medium">No components match your filters</p>
          </div>
        ) : (
          <table className="w-full">
            <thead className="bg-slate-900/80 border-b border-slate-800">
              <tr>
                <SortTh col="supplier_model" label="Model / SKU" />
                <SortTh col="internal_description" label="Description" />
                <SortTh col="brand" label="Brand" className="min-w-[160px]" />
                <SortTh col="category" label="Category" />
                <SortTh col="created_at" label="Created" className="min-w-[110px]" />
                <SortTh col="updated_at" label="Updated" className="min-w-[110px]" />
                <th className="px-4 py-3 w-28 text-right text-xs font-bold uppercase tracking-wider text-slate-600">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800/50">
              {filtered.map((c) => {
                const isEditing = editingIds.has(c.component_id);
                const isDirty = c.component_id in pending;

                return (
                  <tr
                    key={c.component_id}
                    className={`transition-colors ${
                      isDirty
                        ? 'bg-amber-500/5 border-l-2 border-amber-500/40'
                        : isEditing
                        ? 'bg-slate-800/25'
                        : 'hover:bg-slate-800/15'
                    }`}
                  >
                    {/* Model / SKU */}
                    <td className="px-4 py-3 align-top max-w-[200px]">
                      {isEditing ? (
                        <div>
                          <input
                            type="text"
                            value={(getVal(c, 'supplier_model') as string) ?? ''}
                            onChange={(e) => setField(c, 'supplier_model', e.target.value)}
                            className={`w-full px-2.5 py-1.5 rounded-lg text-sm text-white focus:outline-none focus:ring-2 transition-all ${
                              isDirtyField(c, 'supplier_model')
                                ? 'bg-amber-500/10 border border-amber-500/50 focus:ring-amber-500/30'
                                : 'bg-slate-950 border border-slate-700 focus:ring-emerald-500/20 focus:border-emerald-500'
                            }`}
                          />
                          {isDirtyField(c, 'supplier_model') && <DirtyBadge original={c.supplier_model} />}
                        </div>
                      ) : (
                        <span className="text-sm text-white font-medium">{c.supplier_model}</span>
                      )}
                    </td>

                    {/* Internal Description */}
                    <td className="px-4 py-3 align-top">
                      {isEditing ? (
                        <div>
                          <input
                            type="text"
                            value={(getVal(c, 'internal_description') as string) ?? ''}
                            onChange={(e) => setField(c, 'internal_description', e.target.value)}
                            className={`w-full px-2.5 py-1.5 rounded-lg text-sm text-white focus:outline-none focus:ring-2 transition-all ${
                              isDirtyField(c, 'internal_description')
                                ? 'bg-amber-500/10 border border-amber-500/50 focus:ring-amber-500/30'
                                : 'bg-slate-950 border border-slate-700 focus:ring-emerald-500/20 focus:border-emerald-500'
                            }`}
                          />
                          {isDirtyField(c, 'internal_description') && (
                            <DirtyBadge original={c.internal_description} />
                          )}
                        </div>
                      ) : (
                        <span className="text-sm text-slate-300">{c.internal_description}</span>
                      )}
                    </td>

                    {/* Brand */}
                    <td className="px-4 py-3 align-top min-w-[160px]">
                      {isEditing ? (
                        <div>
                          <BrandInput
                            value={(getVal(c, 'brand') as string) ?? ''}
                            onChange={(v) => setField(c, 'brand', v)}
                            suggestions={brandSuggestions}
                            isDirty={isDirtyField(c, 'brand')}
                          />
                          {isDirtyField(c, 'brand') && <DirtyBadge original={c.brand} />}
                        </div>
                      ) : (
                        <span className="text-sm text-slate-300">
                          {c.brand || <span className="text-slate-600">—</span>}
                        </span>
                      )}
                    </td>

                    {/* Category */}
                    <td className="px-4 py-3 align-top">
                      {isEditing ? (
                        <div>
                          <select
                            value={(getVal(c, 'category') as string) ?? ''}
                            onChange={(e) => setField(c, 'category', e.target.value || null)}
                            className={`w-full px-2.5 py-1.5 rounded-lg text-sm text-white focus:outline-none focus:ring-2 transition-all ${
                              isDirtyField(c, 'category')
                                ? 'bg-amber-500/10 border border-amber-500/50 focus:ring-amber-500/30'
                                : 'bg-slate-950 border border-slate-700 focus:ring-emerald-500/20 focus:border-emerald-500'
                            }`}
                          >
                            <option value="">— none —</option>
                            {ENUMS.product_category.map((cat) => (
                              <option key={cat} value={cat}>{cat}</option>
                            ))}
                          </select>
                          {isDirtyField(c, 'category') && <DirtyBadge original={c.category} />}
                        </div>
                      ) : (
                        <span className="text-sm text-slate-300">
                          {c.category || <span className="text-slate-600">—</span>}
                        </span>
                      )}
                    </td>

                    {/* Created At */}
                    <td className="px-4 py-3 align-top">
                      <span className={`text-xs ${sortCol === 'created_at' ? 'text-emerald-400 font-semibold' : 'text-slate-500'}`}>
                        {fmtDate(c.created_at)}
                      </span>
                    </td>

                    {/* Updated At */}
                    <td className="px-4 py-3 align-top">
                      <span className={`text-xs ${sortCol === 'updated_at' ? 'text-emerald-400 font-semibold' : 'text-slate-500'}`}>
                        {fmtDate(c.updated_at)}
                      </span>
                    </td>

                    {/* Row actions */}
                    <td className="px-4 py-3 align-top">
                      <div className="flex gap-1.5 justify-end">
                        {/* Edit / Done toggle */}
                        {isEditing ? (
                          <button
                            onClick={() => toggleEdit(c.component_id)}
                            className="px-2.5 py-1 text-xs font-semibold text-emerald-400 bg-emerald-500/10 border border-emerald-500/30 rounded-lg hover:bg-emerald-500/20 transition-all"
                            title="Collapse row"
                          >
                            Done
                          </button>
                        ) : (
                          <button
                            onClick={() => toggleEdit(c.component_id)}
                            className={`px-2.5 py-1 text-xs font-semibold rounded-lg border transition-all ${
                              isDirty
                                ? 'text-amber-400 bg-amber-500/10 border-amber-500/30 hover:bg-amber-500/20'
                                : 'text-slate-400 bg-slate-800/60 border-slate-700/60 hover:bg-slate-700 hover:text-white'
                            }`}
                            title="Edit row"
                          >
                            ✎
                          </button>
                        )}
                        {/* Discard row changes */}
                        {isDirty && (
                          <button
                            onClick={() => discardRow(c.component_id)}
                            className="px-2.5 py-1 text-xs font-semibold text-red-400 bg-red-500/10 border border-red-500/30 rounded-lg hover:bg-red-500/20 transition-all"
                            title="Discard this row's changes"
                          >
                            ✕
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>

      {/* Sticky save footer — only visible when there are pending edits */}
      {dirtyCount > 0 && (
        <div className="border-t border-amber-500/20 bg-amber-500/5 px-5 py-4 flex items-center justify-between rounded-b-2xl flex-wrap gap-3">
          <p className="text-sm text-amber-300 font-semibold">
            {dirtyCount} component{dirtyCount !== 1 ? 's' : ''} ready to save
          </p>
          <div className="flex gap-2">
            <button
              onClick={discardAll}
              disabled={saving}
              className="px-4 py-2 text-xs font-semibold bg-slate-800 hover:bg-slate-700 text-slate-300 border border-slate-700 rounded-lg transition-all disabled:opacity-50"
            >
              Discard All
            </button>
            <button
              onClick={handleSaveAll}
              disabled={saving}
              className="flex items-center gap-2 px-5 py-2 text-sm font-bold bg-emerald-600 hover:bg-emerald-500 text-white rounded-xl shadow-lg shadow-emerald-900/20 transition-all disabled:opacity-50"
            >
              {saving ? (
                <><Spinner className="w-4 h-4" /> Saving...</>
              ) : (
                'Save All Changes'
              )}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
