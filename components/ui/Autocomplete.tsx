/**
 * Autocomplete Component
 * Text input with dropdown suggestions
 */

'use client';

import React, { useState, useRef, useEffect } from 'react';

interface AutocompleteProps {
  value: string;
  onChange: (value: string) => void;
  suggestions: string[];
  placeholder?: string;
  disabled?: boolean;
  required?: boolean;
  id?: string;
}

export default function Autocomplete({
  value,
  onChange,
  suggestions,
  placeholder = '',
  disabled = false,
  required = false,
  id,
}: AutocompleteProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [filteredSuggestions, setFilteredSuggestions] = useState<string[]>([]);
  const wrapperRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (value) {
      const filtered = suggestions.filter((s) =>
        s.toLowerCase().includes(value.toLowerCase())
      );
      setFilteredSuggestions(filtered.slice(0, 20));
    } else {
      setFilteredSuggestions(suggestions.slice(0, 20));
    }
  }, [value, suggestions]);

  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (wrapperRef.current && !wrapperRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const handleSelect = (suggestion: string) => {
    onChange(suggestion);
    setIsOpen(false);
  };

  return (
    <div className="relative w-full" ref={wrapperRef}>
      <input
        id={id}
        type="text"
        className="w-full p-2.5 md:p-3 bg-slate-950 border border-slate-700 rounded-lg text-sm text-white focus:border-emerald-500 focus:ring-2 focus:ring-emerald-500/20 focus:outline-none placeholder-slate-600 transition-all disabled:opacity-50 disabled:cursor-not-allowed"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onFocus={() => setIsOpen(true)}
        placeholder={placeholder}
        disabled={disabled}
        required={required}
        autoComplete="off"
      />

      {isOpen && filteredSuggestions.length > 0 && (
        <div className="absolute z-50 top-full left-0 w-full bg-slate-900 border border-emerald-500/50 rounded-b-lg shadow-2xl overflow-hidden mt-1 animate-in fade-in zoom-in-95 duration-75">
          <div className="max-h-60 overflow-y-auto custom-scrollbar">
            {filteredSuggestions.map((suggestion, index) => (
              <div
                key={index}
                onClick={() => handleSelect(suggestion)}
                className="px-4 py-2.5 cursor-pointer hover:bg-slate-800 transition-colors text-sm text-slate-300 hover:text-white border-b border-slate-800/50 last:border-0"
              >
                {suggestion}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
