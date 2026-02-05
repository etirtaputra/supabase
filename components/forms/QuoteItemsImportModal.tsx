/**
 * Quote Items Import Modal
 * Allows users to select and import quote line items into PO line items
 * Mobile-optimized with full-screen modal on small screens
 */

'use client';

import React, { useState, useMemo } from 'react';
import type { PriceQuoteLineItem, Component } from '@/types/database';

interface QuoteItemsImportModalProps {
  isOpen: boolean;
  quoteItems: PriceQuoteLineItem[];
  components: Component[];
  onSelect: (items: any[]) => void;
  onClose: () => void;
}

export default function QuoteItemsImportModal({
  isOpen,
  quoteItems,
  components,
  onSelect,
  onClose,
}: QuoteItemsImportModalProps) {
  // Fix: quote_item_id can be UUID string OR number, use any for Set
  const [selectedIds, setSelectedIds] = useState<Set<any>>(new Set());

  // Helper to get component details
  const getComponent = (componentId: number) => {
    return components.find(c => c.component_id === componentId);
  };

  // Helper to format component name
  const getComponentName = (componentId: number) => {
    const comp = getComponent(componentId);
    if (!comp) return 'Unknown Component';
    return comp.model_sku || comp.description || 'Component';
  };

  // Toggle selection - accept any type for itemId
  const toggleItem = (itemId: any) => {
    const newSet = new Set(selectedIds);
    if (newSet.has(itemId)) {
      newSet.delete(itemId);
    } else {
      newSet.add(itemId);
    }
    setSelectedIds(newSet);
  };

  // Select all
  const selectAll = () => {
    setSelectedIds(new Set(quoteItems.map(item => item.quote_item_id)));
  };

  // Deselect all
  const deselectAll = () => {
    setSelectedIds(new Set());
  };

  // Handle import
  const handleImport = () => {
    const selectedItems = quoteItems
      .filter(item => selectedIds.has(item.quote_item_id))
      .map(item => ({
        component_id: item.component_id,
        supplier_description: item.supplier_description,
        quantity: item.quantity,
        unit_cost: item.unit_price, // Convert price → cost
        currency: item.currency,
      }));

    onSelect(selectedItems);
    setSelectedIds(new Set()); // Reset selection
    onClose();
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center">
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-black/80 backdrop-blur-sm"
        onClick={onClose}
      />

      {/* Modal Panel */}
      <div className="relative w-full h-[85vh] sm:h-auto sm:max-h-[80vh] max-w-2xl bg-slate-800 rounded-t-2xl sm:rounded-2xl shadow-2xl overflow-hidden flex flex-col m-0 sm:m-4">

        {/* Header - Fixed */}
        <div className="flex items-center justify-between p-4 border-b border-slate-700 bg-slate-800/95 backdrop-blur">
          <div>
            <h2 className="text-lg font-bold text-white">Import from Quote</h2>
            <p className="text-sm text-slate-400 mt-0.5">
              Select items to add to purchase order
            </p>
          </div>
          <button
            onClick={onClose}
            className="text-slate-400 hover:text-white p-2 -mr-2 transition-colors"
            aria-label="Close modal"
          >
            <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Bulk Actions */}
        {quoteItems.length > 1 && (
          <div className="flex items-center gap-2 px-4 py-3 bg-slate-900/50 border-b border-slate-700">
            <button
              onClick={selectAll}
              className="text-sm text-blue-400 hover:text-blue-300 font-medium transition-colors"
            >
              Select All
            </button>
            <span className="text-slate-600">•</span>
            <button
              onClick={deselectAll}
              className="text-sm text-slate-400 hover:text-slate-300 font-medium transition-colors"
            >
              Clear
            </button>
            <div className="ml-auto text-sm text-slate-400">
              {selectedIds.size} of {quoteItems.length} selected
            </div>
          </div>
        )}

        {/* Scrollable Item List */}
        <div className="flex-1 overflow-y-auto p-4 space-y-3">
          {quoteItems.length === 0 ? (
            <div className="text-center py-12 text-slate-400">
              <svg className="w-16 h-16 mx-auto mb-4 text-slate-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M20 13V6a2 2 0 00-2-2H6a2 2 0 00-2 2v7m16 0v5a2 2 0 01-2 2H6a2 2 0 01-2-2v-5m16 0h-2.586a1 1 0 00-.707.293l-2.414 2.414a1 1 0 01-.707.293h-3.172a1 1 0 01-.707-.293l-2.414-2.414A1 1 0 006.586 13H4" />
              </svg>
              <p className="text-lg font-medium">No items in this quote</p>
            </div>
          ) : (
            quoteItems.map((item) => {
              const isSelected = selectedIds.has(item.quote_item_id);
              const component = getComponent(item.component_id);

              return (
                <div
                  key={item.quote_item_id}
                  className={`
                    p-4 rounded-lg border cursor-pointer
                    transition-all active:scale-[0.98]
                    ${isSelected
                      ? 'bg-blue-900/30 border-blue-500 ring-2 ring-blue-500/20'
                      : 'bg-slate-900/50 border-slate-700 hover:border-slate-600 hover:bg-slate-900/70'
                    }
                  `}
                  onClick={() => toggleItem(item.quote_item_id)}
                >
                  <div className="flex items-start gap-3">
                    {/* Checkbox */}
                    <input
                      type="checkbox"
                      checked={isSelected}
                      onChange={(e) => {
                        e.stopPropagation();
                        toggleItem(item.quote_item_id);
                      }}
                      onClick={(e) => e.stopPropagation()}
                      className="w-5 h-5 mt-1 rounded border-slate-600 bg-slate-800 text-blue-600 focus:ring-2 focus:ring-blue-500 focus:ring-offset-0 transition pointer-events-none"
                    />

                    {/* Item Details */}
                    <div className="flex-1 min-w-0">
                      {/* Component Name */}
                      <div className="font-medium text-white mb-1">
                        {component?.model_sku || 'Unknown Component'}
                      </div>

                      {/* Component Description */}
                      {component?.description && (
                        <div className="text-sm text-slate-400 mb-2">
                          {component.description}
                        </div>
                      )}

                      {/* Supplier Description */}
                      {item.supplier_description && (
                        <div className="text-sm text-slate-300 bg-slate-800/50 px-2 py-1 rounded mb-2 border border-slate-700">
                          Supplier: {item.supplier_description}
                        </div>
                      )}

                      {/* Quantity and Price */}
                      <div className="flex flex-wrap gap-x-4 gap-y-1 text-sm">
                        <div className="text-slate-300">
                          Qty: <span className="font-medium text-white">{item.quantity}</span>
                        </div>
                        <div className="text-slate-300">
                          Price: <span className="font-medium text-emerald-400">
                            {item.currency} {Number(item.unit_price).toLocaleString()}
                          </span>
                        </div>
                        <div className="text-slate-300">
                          Total: <span className="font-medium text-emerald-400">
                            {item.currency} {(Number(item.unit_price) * Number(item.quantity)).toLocaleString()}
                          </span>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              );
            })
          )}
        </div>

        {/* Footer - Fixed */}
        <div className="p-4 border-t border-slate-700 bg-slate-800/95 backdrop-blur">
          <div className="flex gap-3">
            <button
              onClick={onClose}
              className="flex-1 px-4 py-3 bg-slate-700 hover:bg-slate-600 text-white rounded-lg font-medium transition-colors"
            >
              Cancel
            </button>
            <button
              onClick={handleImport}
              disabled={selectedIds.size === 0}
              className="flex-1 px-4 py-3 bg-blue-600 hover:bg-blue-500 disabled:bg-slate-700 disabled:text-slate-500 disabled:cursor-not-allowed text-white rounded-lg font-medium transition-all shadow-lg disabled:shadow-none"
            >
              Add {selectedIds.size > 0 ? `${selectedIds.size} Item${selectedIds.size !== 1 ? 's' : ''}` : 'Items'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
