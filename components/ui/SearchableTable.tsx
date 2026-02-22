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
            <span key={i} className="bg-emerald-500/30 text-emerald-300 font-medium rounded px-1">{part}</span>
          ) : (part)
        )}
      </>
    );
  };
  if (isLoading) {
    return <TableSkeleton rows={itemsPerPage} columns={columns.length} />;
  }
  return (
    <div className="bg-slate-900/40 backdrop-blur-sm border border-slate-800/80 rounded-2xl overflow-hidden shadow-2xl shadow-black/20 flex flex-col ring-1 ring-white/5">
      {/* Table Header Controls */}
      <div className="p-4 md:p-5 border-b border-slate-800/80 bg-slate-900/50 space-y-4">
        <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
          <h3 className="font-bold text-slate-100 flex items-center gap-3 text-sm md:text-base tracking-wide">
            {title}
            <span className="bg-slate-800 text-slate-300 px-2.5 py-0.5 rounded-full text-xs ring-1 ring-slate-700">
              {filteredData.length}
            </span>
          </h3>
          <div className="flex items-center gap-2 text-xs">
            <span className="text-slate-400 font-medium">Rows per page:</span>
            <select
              value={itemsPerPage}
              onChange={(e) => { setItemsPerPage(Number(e.target.value)); setCurrentPage(1); }}
              className="bg-slate-800/50 border border-slate-700 rounded-lg px-3 py-1.5 text-slate-200 focus:outline-none focus:ring-2 focus:ring-emerald-500/50 transition-all cursor-pointer"
            >
              <option value={10}>10</option>
              <option value={25}>25</option>
              <option value={50}>50</option>
              <option value={100}>100</option>
            </select>
          </div>
        </div>
        <div className="relative">
          <input
            type="text"
            placeholder="Search records..."
            className="w-full bg-slate-950/50 border border-slate-700/80 rounded-xl py-2.5 pl-10 pr-4 text-sm text-slate-200 placeholder-slate-500 focus:outline-none focus:bg-slate-900 focus:ring-2 focus:ring-emerald-500/40 focus:border-transparent transition-all"
            value={searchTerm}
            onChange={(e) => { setSearchTerm(e.target.value); setCurrentPage(1); }}
          />
          <svg className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
          </svg>
        </div>
      </div>
      {/* Table Content */}
      <div className="overflow-x-auto flex-1 scrollbar-thin scrollbar-thumb-slate-700 scrollbar-track-transparent">
        <table className="w-full text-sm text-left text-slate-300 min-w-[600px]">
          <thead className="bg-slate-900/80 text-slate-400 text-xs uppercase font-semibold tracking-wider sticky top-0 z-10 backdrop-blur-md">
            <tr>
              {columns.map((col) => (
                <th
                  key={col.key}
                  className="px-5 md:px-6 py-4 whitespace-nowrap cursor-pointer hover:text-emerald-400 transition-colors select-none group"
                  onClick={() => handleSort(col.key)}
                >
                  <div className="flex items-center gap-1.5">
                    {col.label}
                    <span className={`text-emerald-400 opacity-0 group-hover:opacity-100 transition-opacity ${sortColumn === col.key ? 'opacity-100' : ''}`}>
                      {sortColumn === col.key ? (sortDirection === 'asc' ? '↑' : '↓') : '↕'}
                    </span>
                  </div>
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-800/60">
            {paginatedData.length === 0 ? (
              <tr>
                <td colSpan={columns.length} className="px-6 py-12 text-center">
                  <p className="text-slate-500 text-sm">No matching records found.</p>
                </td>
              </tr>
            ) : (
              paginatedData.map((row: any, i: number) => (
                <tr key={i} className="hover:bg-slate-800/40 transition-colors group">
                  {columns.map((col) => {
                    const rawVal = col.render ? col.render(row) : row[col.key] || '-';
                    return (
                      <td key={col.key} className="px-5 md:px-6 py-3.5 whitespace-nowrap text-slate-300 group-hover:text-white transition-colors">
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
      {/* Pagination Footer */}
      {totalPages > 1 && (
        <div className="p-4 border-t border-slate-800/80 bg-slate-900/50 flex flex-col sm:flex-row justify-between items-center gap-4 text-xs">
          <span className="text-slate-400 font-medium">
            Showing <strong className="text-slate-200">{(currentPage - 1) * itemsPerPage + 1}</strong> to <strong className="text-slate-200">{Math.min(currentPage * itemsPerPage, sortedData.length)}</strong> of <strong className="text-slate-200">{sortedData.length}</strong> entries
          </span>
          <div className="flex items-center gap-1.5">
            <button onClick={() => setCurrentPage(1)} disabled={currentPage === 1} className="px-3 py-2 bg-slate-800/80 text-slate-300 rounded-lg hover:bg-slate-700 hover:text-white disabled:opacity-40 disabled:cursor-not-allowed transition-all font-medium border border-slate-700/50">First</button>
            <button onClick={() => setCurrentPage((prev) => Math.max(1, prev - 1))} disabled={currentPage === 1} className="px-3 py-2 bg-slate-800/80 text-slate-300 rounded-lg hover:bg-slate-700 hover:text-white disabled:opacity-40 disabled:cursor-not-allowed transition-all font-medium border border-slate-700/50">Prev</button>
            <div className="px-4 py-2 bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 rounded-lg font-bold min-w-[40px] text-center shadow-inner">
              {currentPage}
            </div>
            <button onClick={() => setCurrentPage((prev) => Math.min(totalPages, prev + 1))} disabled={currentPage === totalPages} className="px-3 py-2 bg-slate-800/80 text-slate-300 rounded-lg hover:bg-slate-700 hover:text-white disabled:opacity-40 disabled:cursor-not-allowed transition-all font-medium border border-slate-700/50">Next</button>
            <button onClick={() => setCurrentPage(totalPages)} disabled={currentPage === totalPages} className="px-3 py-2 bg-slate-800/80 text-slate-300 rounded-lg hover:bg-slate-700 hover:text-white disabled:opacity-40 disabled:cursor-not-allowed transition-all font-medium border border-slate-700/50">Last</button>
          </div>
        </div>
      )}
    </div>
  );
}
export default SearchableTable;
