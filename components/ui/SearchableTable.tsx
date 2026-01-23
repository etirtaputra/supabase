/**
 * Searchable Table Component
 * Features: search, pagination, sorting, loading states
 * Mobile-optimized with horizontal scroll
 */

'use client';

import React, { useState, useMemo } from 'react';
import { TableSkeleton } from './LoadingSkeleton';
import type { SearchableTableProps, TableColumn } from '../../types/forms';

function SearchableTable<T = any>({ title, data, columns, isLoading = false }: SearchableTableProps<T>) {
  const [searchTerm, setSearchTerm] = useState('');
  const [currentPage, setCurrentPage] = useState(1);
  const [itemsPerPage, setItemsPerPage] = useState(25);
  const [sortColumn, setSortColumn] = useState<string | null>(null);
  const [sortDirection, setSortDirection] = useState<'asc' | 'desc'>('asc');

  // Filter data based on search term
  const filteredData = useMemo(() => {
    if (!searchTerm) return data;
    const lowerTerm = searchTerm.toLowerCase();

    return data.filter((row: any) => {
      return columns.some((col: TableColumn<T>) => {
        const val = col.render ? col.render(row) : row[col.key];
        return String(val || '').toLowerCase().includes(lowerTerm);
      });
    });
  }, [data, searchTerm, columns]);

  // Sort data
  const sortedData = useMemo(() => {
    if (!sortColumn) return filteredData;

    return [...filteredData].sort((a: any, b: any) => {
      const col = columns.find((c) => c.key === sortColumn);
      const aVal = col?.render ? String(col.render(a)) : a[sortColumn];
      const bVal = col?.render ? String(col.render(b)) : b[sortColumn];

      if (aVal < bVal) return sortDirection === 'asc' ? -1 : 1;
      if (aVal > bVal) return sortDirection === 'asc' ? 1 : -1;
      return 0;
    });
  }, [filteredData, sortColumn, sortDirection, columns]);

  // Paginate data
  const paginatedData = useMemo(() => {
    const startIndex = (currentPage - 1) * itemsPerPage;
    return sortedData.slice(startIndex, startIndex + itemsPerPage);
  }, [sortedData, currentPage, itemsPerPage]);

  const totalPages = Math.ceil(sortedData.length / itemsPerPage);

  const handleSort = (column: string) => {
    if (sortColumn === column) {
      setSortDirection(sortDirection === 'asc' ? 'desc' : 'asc');
    } else {
      setSortColumn(column);
      setSortDirection('asc');
    }
  };

  const Highlight = ({ text }: { text: string }) => {
    if (!searchTerm) return <>{text}</>;
    const parts = text.toString().split(new RegExp(`(${searchTerm})`, 'gi'));
    return (
      <>
        {parts.map((part, i) =>
          part.toLowerCase() === searchTerm.toLowerCase() ? (
            <span key={i} className="bg-emerald-500/50 text-white rounded px-0.5">
              {part}
            </span>
          ) : (
            part
          )
        )}
      </>
    );
  };

  if (isLoading) {
    return <TableSkeleton rows={itemsPerPage} columns={columns.length} />;
  }

  return (
    <div className="bg-slate-900 border border-slate-800 rounded-xl overflow-hidden shadow-xl flex flex-col">
      {/* Header + Search + Controls */}
      <div className="p-4 border-b border-slate-800 bg-slate-950/30 space-y-3">
        <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-3">
          <h3 className="font-bold text-slate-200 flex items-center gap-2 text-sm uppercase tracking-wide">
            {title}
            <span className="bg-slate-800 text-slate-400 px-2 py-0.5 rounded text-[10px]">
              {filteredData.length}
            </span>
          </h3>

          {/* Items per page selector */}
          <div className="flex items-center gap-2 text-xs">
            <span className="text-slate-500">Show:</span>
            <select
              value={itemsPerPage}
              onChange={(e) => {
                setItemsPerPage(Number(e.target.value));
                setCurrentPage(1);
              }}
              className="bg-slate-950 border border-slate-700 rounded px-2 py-1 text-white focus:outline-none focus:border-emerald-500"
            >
              <option value={10}>10</option>
              <option value={25}>25</option>
              <option value={50}>50</option>
              <option value={100}>100</option>
            </select>
          </div>
        </div>

        {/* Search bar */}
        <div className="relative">
          <input
            type="text"
            placeholder="Search table..."
            className="w-full bg-slate-950 border border-slate-700 rounded-lg py-2 pl-9 pr-3 text-xs text-white focus:outline-none focus:border-emerald-500 transition-colors"
            value={searchTerm}
            onChange={(e) => {
              setSearchTerm(e.target.value);
              setCurrentPage(1);
            }}
          />
          <span className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500 text-xs">🔍</span>
        </div>
      </div>

      {/* Table Area - Mobile horizontal scroll */}
      <div className="overflow-x-auto flex-1">
        <table className="w-full text-xs text-left text-slate-400 min-w-[600px]">
          <thead className="bg-slate-950 text-slate-500 uppercase font-bold tracking-wider sticky top-0 z-10">
            <tr>
              {columns.map((col) => (
                <th
                  key={col.key}
                  className="px-4 md:px-6 py-3 whitespace-nowrap cursor-pointer hover:text-emerald-400 transition-colors"
                  onClick={() => handleSort(col.key)}
                >
                  <div className="flex items-center gap-1">
                    {col.label}
                    {sortColumn === col.key && (
                      <span className="text-emerald-400">{sortDirection === 'asc' ? '↑' : '↓'}</span>
                    )}
                  </div>
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-800/50">
            {paginatedData.length === 0 ? (
              <tr>
                <td
                  colSpan={columns.length}
                  className="px-6 py-8 text-center text-slate-600 italic text-sm"
                >
                  No matching records found.
                </td>
              </tr>
            ) : (
              paginatedData.map((row: any, i: number) => (
                <tr key={i} className="hover:bg-slate-800/40 transition-colors group">
                  {columns.map((col) => {
                    const rawVal = col.render ? col.render(row) : row[col.key] || '-';
                    return (
                      <td
                        key={col.key}
                        className="px-4 md:px-6 py-3 whitespace-nowrap text-slate-300 group-hover:text-slate-200"
                      >
                        <Highlight text={String(rawVal)} />
                      </td>
                    );
                  })}
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {/* Pagination Controls */}
      {totalPages > 1 && (
        <div className="p-3 border-t border-slate-800 bg-slate-950/30 flex flex-col sm:flex-row justify-between items-center gap-3 text-xs">
          <span className="text-slate-500">
            Page {currentPage} of {totalPages} • {sortedData.length} total records
          </span>

          <div className="flex items-center gap-2">
            <button
              onClick={() => setCurrentPage(1)}
              disabled={currentPage === 1}
              className="px-3 py-1.5 bg-slate-800 text-white rounded hover:bg-slate-700 disabled:opacity-30 disabled:cursor-not-allowed transition-all"
            >
              ««
            </button>
            <button
              onClick={() => setCurrentPage((prev) => Math.max(1, prev - 1))}
              disabled={currentPage === 1}
              className="px-3 py-1.5 bg-slate-800 text-white rounded hover:bg-slate-700 disabled:opacity-30 disabled:cursor-not-allowed transition-all"
            >
              «
            </button>

            <span className="px-3 py-1.5 bg-emerald-600 text-white rounded font-bold min-w-[40px] text-center">
              {currentPage}
            </span>

            <button
              onClick={() => setCurrentPage((prev) => Math.min(totalPages, prev + 1))}
              disabled={currentPage === totalPages}
              className="px-3 py-1.5 bg-slate-800 text-white rounded hover:bg-slate-700 disabled:opacity-30 disabled:cursor-not-allowed transition-all"
            >
              »
            </button>
            <button
              onClick={() => setCurrentPage(totalPages)}
              disabled={currentPage === totalPages}
              className="px-3 py-1.5 bg-slate-800 text-white rounded hover:bg-slate-700 disabled:opacity-30 disabled:cursor-not-allowed transition-all"
            >
              »»
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

export default SearchableTable;
