"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { useRouter } from "next/navigation";
import { Search, X, Loader2 } from "lucide-react";
import Fuse from "fuse.js";
import { SearchResult } from "@/lib/types";
import { CATEGORIES } from "@/lib/types";
import { cn } from "@/lib/utils";
import CategoryBadge from "./CategoryBadge";

interface SearchBarProps {
  allProducts?: SearchResult[];
  placeholder?: string;
  className?: string;
}

export default function SearchBar({
  allProducts = [],
  placeholder = "Search components, models, specs... (⌘K)",
  className,
}: SearchBarProps) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SearchResult[]>([]);
  const [isOpen, setIsOpen] = useState(false);
  const [selectedIndex, setSelectedIndex] = useState(-1);
  const [isLoading, setIsLoading] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const router = useRouter();

  const fuse = useRef<Fuse<SearchResult> | null>(null);

  useEffect(() => {
    if (allProducts.length > 0) {
      fuse.current = new Fuse(allProducts, {
        keys: ["model", "keySummary", "categoryLabel"],
        threshold: 0.4,
        includeScore: true,
        minMatchCharLength: 1,
      });
    }
  }, [allProducts]);

  // Keyboard shortcut Cmd+K / Ctrl+K
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "k") {
        e.preventDefault();
        inputRef.current?.focus();
        setIsOpen(true);
      }
      if (e.key === "Escape") {
        setIsOpen(false);
        setQuery("");
        inputRef.current?.blur();
      }
    };
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, []);

  // Close on outside click
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (
        containerRef.current &&
        !containerRef.current.contains(e.target as Node)
      ) {
        setIsOpen(false);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  const performSearch = useCallback(
    async (searchQuery: string) => {
      if (!searchQuery.trim()) {
        setResults([]);
        setIsLoading(false);
        return;
      }

      setIsLoading(true);

      // Client-side fuzzy search
      if (fuse.current) {
        const fuseResults = fuse.current.search(searchQuery).slice(0, 10);
        setResults(fuseResults.map((r) => r.item));
        setIsLoading(false);
        return;
      }

      // Fallback: API search
      try {
        const res = await fetch(
          `/api/search?q=${encodeURIComponent(searchQuery)}`
        );
        const data = await res.json();
        setResults(data.results || []);
      } catch {
        setResults([]);
      } finally {
        setIsLoading(false);
      }
    },
    []
  );

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const value = e.target.value;
    setQuery(value);
    setIsOpen(true);
    setSelectedIndex(-1);

    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      performSearch(value);
    }, 150);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (!isOpen) return;

    if (e.key === "ArrowDown") {
      e.preventDefault();
      setSelectedIndex((prev) => Math.min(prev + 1, results.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setSelectedIndex((prev) => Math.max(prev - 1, -1));
    } else if (e.key === "Enter") {
      e.preventDefault();
      if (selectedIndex >= 0 && results[selectedIndex]) {
        const result = results[selectedIndex];
        navigateTo(result);
      }
    } else if (e.key === "Escape") {
      setIsOpen(false);
      setQuery("");
    }
  };

  const navigateTo = (result: SearchResult) => {
    router.push(`/${result.category}/${encodeURIComponent(result.model)}`);
    setIsOpen(false);
    setQuery("");
  };

  const clearSearch = () => {
    setQuery("");
    setResults([]);
    setIsOpen(false);
    inputRef.current?.focus();
  };

  // Group results by category
  const groupedResults = results.reduce(
    (acc, result) => {
      if (!acc[result.category]) acc[result.category] = [];
      acc[result.category].push(result);
      return acc;
    },
    {} as Record<string, SearchResult[]>
  );

  let flatIndex = 0;

  return (
    <div ref={containerRef} className={cn("relative w-full", className)}>
      {/* Search Input */}
      <div className="relative">
        <Search className="absolute left-4 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400 pointer-events-none" />
        <input
          ref={inputRef}
          type="text"
          value={query}
          onChange={handleInputChange}
          onKeyDown={handleKeyDown}
          onFocus={() => {
            setIsOpen(true);
            if (query) performSearch(query);
          }}
          placeholder={placeholder}
          className={cn(
            "w-full pl-11 pr-12 py-3.5 rounded-xl",
            "bg-slate-800/80 border border-slate-700",
            "text-slate-100 placeholder-slate-500",
            "focus:outline-none focus:border-slate-500 focus:bg-slate-800",
            "transition-all text-sm"
          )}
        />
        <div className="absolute right-3 top-1/2 -translate-y-1/2 flex items-center gap-2">
          {isLoading && (
            <Loader2 className="h-3.5 w-3.5 text-slate-500 animate-spin" />
          )}
          {query ? (
            <button
              onClick={clearSearch}
              className="p-1 rounded hover:bg-slate-700 text-slate-400 hover:text-slate-200 transition-colors"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          ) : (
            <kbd className="hidden sm:flex items-center gap-0.5 px-1.5 py-0.5 text-xs text-slate-500 bg-slate-700/50 border border-slate-600/50 rounded">
              <span>⌘K</span>
            </kbd>
          )}
        </div>
      </div>

      {/* Dropdown Results */}
      {isOpen && query && (
        <div className="absolute top-full left-0 right-0 mt-2 z-50 rounded-xl border border-slate-700 bg-slate-900 shadow-2xl shadow-black/50 overflow-hidden max-h-[480px] overflow-y-auto">
          {results.length === 0 && !isLoading ? (
            <div className="px-4 py-8 text-center text-slate-500 text-sm">
              No results for &ldquo;{query}&rdquo;
            </div>
          ) : (
            Object.entries(groupedResults).map(([categorySlug, categoryResults]) => {
              const catInfo = CATEGORIES.find((c) => c.slug === categorySlug);
              return (
                <div key={categorySlug}>
                  <div className="px-4 py-2 bg-slate-800/50 border-b border-slate-700/50">
                    <span
                      className={cn(
                        "text-xs font-semibold uppercase tracking-wider flex items-center gap-1.5",
                        catInfo?.textColor
                      )}
                    >
                      <span>{catInfo?.icon}</span>
                      {catInfo?.label}
                    </span>
                  </div>
                  {categoryResults.map((result) => {
                    const currentIndex = flatIndex++;
                    return (
                      <button
                        key={result.id}
                        onClick={() => navigateTo(result)}
                        className={cn(
                          "w-full flex items-center gap-3 px-4 py-3 text-left transition-colors border-b border-slate-800/50 last:border-0",
                          selectedIndex === currentIndex
                            ? "bg-slate-700/60"
                            : "hover:bg-slate-800/70"
                        )}
                      >
                        <div className="flex-1 min-w-0">
                          <span className="font-mono font-semibold text-slate-100 text-sm block">
                            {result.model}
                          </span>
                          <span className="text-xs text-slate-400 truncate block mt-0.5">
                            {result.keySummary}
                          </span>
                        </div>
                        {result.selling_price_idr !== null ? (
                          <span className="text-xs font-mono text-emerald-400 shrink-0">
                            {new Intl.NumberFormat("id-ID", {
                              style: "currency",
                              currency: "IDR",
                              minimumFractionDigits: 0,
                            }).format(result.selling_price_idr)}
                          </span>
                        ) : (
                          <span className="text-xs text-slate-600 shrink-0">—</span>
                        )}
                      </button>
                    );
                  })}
                </div>
              );
            })
          )}
          {results.length > 0 && (
            <div className="px-4 py-2 bg-slate-800/30 border-t border-slate-700/50 text-xs text-slate-500 flex items-center gap-3">
              <span>↑↓ navigate</span>
              <span>↵ select</span>
              <span>esc close</span>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
