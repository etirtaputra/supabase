/**
 * Quote Items Import Modal
 * Allows users to select and import quote line items into PO line items
 * Mobile-optimized with full-screen modal on small screens
 */

'use client';

import React, { useState } from 'react';
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
  // Use ARRAY instead of Set - simpler and more reliable
  const [selectedIds, setSelectedIds] = useState<string[]>([]);

  // Force reset when modal opens
  React.useEffect(() => {
    if (isOpen) {
      console.log('[QuoteImport] Modal opened, resetting selection');
      setSelectedIds([]);
    }
  }, [isOpen]);

  // Helper to get component details
  const getComponent = (componentId: number) => {
    return components.find(c => c.component_id === componentId);
  };

  // Check if item is selected
  const isItemSelected = (itemId: any): boolean => {
    const idStr = String(itemId);
    const result = selectedIds.includes(idStr);
    console.log(`[QuoteImport] Checking if ${idStr} is selected:`, result, 'Array:', selectedIds);
    return result;
  };

  // Toggle selection
  const toggleItem = (itemId: any) => {
    const idStr = String(itemId);
    console.log('[QuoteImport] Toggle clicked for ID:', idStr);
    console.log('[QuoteImport] Current selected IDs:', selectedIds);

    setSelectedIds(prev => {
      const isCurrentlySelected = prev.includes(idStr);

      if (isCurrentlySelected) {
        console.log('[QuoteImport] Removing ID:', idStr);
        const newArray = prev.filter(id => id !== idStr);
        console.log('[QuoteImport] New selected IDs:', newArray);
        return newArray;
      } else {
        console.log('[QuoteImport] Adding ID:', idStr);
        const newArray = [...prev, idStr];
        console.log('[QuoteImport] New selected IDs:', newArray);
        return newArray;
      }
    });
  };

  // Select all
  const selectAll = () => {
    const allIds = quoteItems.map(item => String(item.quote_item_id));
    console.log('[QuoteImport] Select All:', allIds);
    setSelectedIds(allIds);
  };

  // Deselect all
  const deselectAll = () => {
    console.log('[QuoteImport] Clear All');
    setSelectedIds([]);
  };

  // Handle import
  const handleImport = () => {
    const selectedItems = quoteItems
      .filter(item => selectedIds.includes(String(item.quote_item_id)))
      .map(item => ({
        component_id: item.component_id,
        supplier_description: item.supplier_description,
        quantity: item.quantity,
        unit_cost: item.unit_price, // Convert price → cost
        currency: item.currency,
      }));

    console.log('[QuoteImport] Importing items:', selectedItems.length);
    onSelect(selectedItems);
    setSelectedIds([]); // Reset selection
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
              {selectedIds.length} of {quoteItems.length} selected
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
              const isSelected = isItemSelected(item.quote_item_id);
              const component = getComponent(item.component_id);

              return (
                <div
                  key={`quote-item-${item.quote_item_id}`}
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
                    {/* Custom Checkbox - Visual indicator only, parent div handles clicks */}
                    <div className={`
                      w-5 h-5 mt-1 rounded border-2 flex items-center justify-center transition-all flex-shrink-0
                      ${isSelected
                        ? 'bg-blue-600 border-blue-600'
                        : 'bg-slate-800 border-slate-600'
                      }
                    `}>
                      {isSelected && (
                        <svg className="w-3.5 h-3.5 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" />
                        </svg>
                      )}
                    </div>

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
              disabled={selectedIds.length === 0}
              className="flex-1 px-4 py-3 bg-blue-600 hover:bg-blue-500 disabled:bg-slate-700 disabled:text-slate-500 disabled:cursor-not-allowed text-white rounded-lg font-medium transition-all shadow-lg disabled:shadow-none"
            >
              Add {selectedIds.length > 0 ? `${selectedIds.length} Item${selectedIds.length !== 1 ? 's' : ''}` : 'Items'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
