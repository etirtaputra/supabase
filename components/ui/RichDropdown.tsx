/**
 * Rich Dropdown Component
 * Searchable combobox with keyboard navigation support
 * Optimized for mobile with touch-friendly interface
 */

'use client';

import React, { useState, useEffect, useRef, memo } from 'react';
import type { RichSelectConfig } from '../../types/forms';
import { dropdownPool, BROWSE_LIMIT } from '@/lib/dropdownPool';

interface RichDropdownProps {
  options: any[];
  value: any;
  onChange: (value: any) => void;
  placeholder?: string;
  config?: Partial<RichSelectConfig>;
  /** Key on each option that browseValue is matched against (see BrowseScope). */
  browseKey?: string;
  /** The scope itself — empty/null means no scoping, show everything. */
  browseValue?: string | number | null;
  /** How the scope is named in the footer, e.g. "this supplier". */
  browseLabel?: string;
}

const RichDropdown = memo(function RichDropdown({
  options,
  value,
  onChange,
  placeholder = 'Search...',
  config = {} as Partial<RichSelectConfig>,
  browseKey,
  browseValue,
  browseLabel = 'this supplier',
}: RichDropdownProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');
  const [focusedIndex, setFocusedIndex] = useState(-1);
  const wrapperRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const labelKey = config.labelKey || 'supplier_model';
  const subLabelKey = config.subLabelKey || 'internal_description';
  const valueKey = config.valueKey || 'component_id';

  // Update display text when value changes
  useEffect(() => {
    if (value) {
      const selected = options.find((o) => o[valueKey] === value);
      if (selected) {
        setSearchTerm(`${selected[labelKey]} - ${selected[subLabelKey] || ''}`);
      }
    } else if (value === undefined || value === '') {
      setSearchTerm('');
    }
  }, [value, options, labelKey, subLabelKey, valueKey]);

  // Close dropdown when clicking outside
  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (wrapperRef.current && !wrapperRef.current.contains(event.target as Node)) {
        setIsOpen(false);
        if (value) {
          const selected = options.find((o) => o[valueKey] === value);
          setSearchTerm(selected ? `${selected[labelKey]} - ${selected[subLabelKey] || ''}` : '');
        } else {
          setSearchTerm('');
        }
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [value, options, valueKey, labelKey, subLabelKey]);

  // What to show is lib/dropdownPool.ts's one rule: browsing is a capped
  // suggestion that may be SCOPED to the deal the form is already on; a typed
  // search is answered from everything, uncapped. This component only renders it.
  const { items: filtered, scoped, poolSize, truncated: isTruncated } =
    dropdownPool(options, { search: searchTerm, labelKey, subLabelKey, browseKey, browseValue });

  const handleSelect = (item: any) => {
    onChange(item[valueKey]);
    setSearchTerm(`${item[labelKey]} - ${item[subLabelKey] || ''}`);
    setIsOpen(false);
    setFocusedIndex(-1);
  };

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setSearchTerm(e.target.value);
    setIsOpen(true);
    setFocusedIndex(-1);
    if (value !== null) onChange(null);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (!isOpen && (e.key === 'ArrowDown' || e.key === 'Enter')) {
      setIsOpen(true);
      return;
    }

    if (!isOpen) return;

    switch (e.key) {
      case 'ArrowDown':
        e.preventDefault();
        setFocusedIndex((prev) => (prev < filtered.length - 1 ? prev + 1 : prev));
        break;
      case 'ArrowUp':
        e.preventDefault();
        setFocusedIndex((prev) => (prev > 0 ? prev - 1 : 0));
        break;
      case 'Enter':
        e.preventDefault();
        if (focusedIndex >= 0 && filtered[focusedIndex]) {
          handleSelect(filtered[focusedIndex]);
        }
        break;
      case 'Escape':
        setIsOpen(false);
        setFocusedIndex(-1);
        break;
    }
  };

  return (
    <div className="relative w-full" ref={wrapperRef}>
      <div className="relative">
        <input
          ref={inputRef}
          type="text"
          className={`w-full px-2.5 py-2 bg-slate-950 border rounded-lg text-sm text-white placeholder-slate-600 focus:outline-none focus:ring-2 focus:ring-emerald-500/50 focus:border-emerald-500 transition-all ${
            isOpen ? 'border-emerald-500 rounded-b-none' : 'border-slate-700'
          }`}
          placeholder={placeholder}
          value={searchTerm}
          onChange={handleInputChange}
          onFocus={() => {
            setIsOpen(true);
            if (value === undefined) setSearchTerm('');
          }}
          onKeyDown={handleKeyDown}
          aria-expanded={isOpen}
          aria-haspopup="listbox"
          role="combobox"
        />
        <div className="absolute right-3 top-1/2 -translate-y-1/2 pointer-events-none text-slate-500 text-xs">
          ▼
        </div>
      </div>

      {isOpen && (
        <div className="absolute z-[60] top-full left-0 w-full bg-slate-900 border border-t-0 border-emerald-500/50 rounded-b-lg shadow-2xl overflow-hidden animate-in fade-in zoom-in-95 duration-75">
          <div className="max-h-60 md:max-h-72 overflow-y-auto custom-scrollbar" role="listbox">
            {filtered.length === 0 ? (
              <div className="p-4 md:p-6 text-center text-xs md:text-sm text-slate-500 italic">
                {!searchTerm && scoped
                  ? `Nothing on file for ${browseLabel} — type to search all ${options.length}.`
                  : 'No matching results.'}
              </div>
            ) : (
              <>
                {filtered.map((c, index) => (
                  <div
                    key={c[valueKey]}
                    onClick={() => handleSelect(c)}
                    className={`p-3 md:p-4 border-b border-slate-800/50 cursor-pointer transition-colors group flex flex-col gap-0.5 last:border-0 ${
                      index === focusedIndex ? 'bg-slate-800' : 'hover:bg-slate-800'
                    }`}
                    role="option"
                    aria-selected={index === focusedIndex}
                  >
                    <div className="flex justify-between items-center">
                      <span className="font-mono text-emerald-400 font-bold text-xs md:text-sm">
                        {c[labelKey]}
                      </span>
                    </div>
                    <div className="text-[11px] md:text-xs text-slate-400 group-hover:text-slate-200 line-clamp-1">
                      {c[subLabelKey]}
                    </div>
                  </div>
                ))}
                {/* Say what the list you are looking at IS, so a missing entry
                    reads as "out of scope", not "not on file". */}
                {!searchTerm && scoped ? (
                  <div className="px-4 py-2.5 text-center text-[11px] text-slate-500 italic border-t border-slate-800">
                    {isTruncated ? `First ${BROWSE_LIMIT} of ${poolSize}` : poolSize} for {browseLabel} — type to search all {options.length}
                  </div>
                ) : isTruncated ? (
                  <div className="px-4 py-2.5 text-center text-[11px] text-slate-500 italic border-t border-slate-800">
                    Showing {BROWSE_LIMIT} of {options.length} — type to search all
                  </div>
                ) : null}
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
});

export default RichDropdown;
