/**
 * Batch Line Items Form Component
 * Allows adding multiple related items in batch mode
 * Supports sticky fields and mobile-optimized layout
 */
'use client';
import React, { useState, useId } from 'react';
import FieldRenderer from './FieldRenderer';
import { Spinner } from '../ui/LoadingSkeleton';
import QuoteItemsImportModal from './QuoteItemsImportModal';
import type { BatchLineItemsFormProps } from '../../types/forms';
export default function BatchLineItemsForm({
  title,
  parentField,
  itemFields,
  stickyFields = [],
  onSubmit,
  loading,
  formId: customFormId,
  enablePdfUpload = false,
  enableQuoteImport = false,
  allQuoteItems = [],
  allQuotes = [],
  allPurchases = [],
  components = [],
}: BatchLineItemsFormProps) {
  const uniqueFormId = useId();
  const formId = customFormId || uniqueFormId;

  const [parentId, setParentId] = useState('');
  const [items, setItems] = useState<any[]>([]);
  const [draft, setDraft] = useState<Record<string, any>>({});
  const [pdfUploading, setPdfUploading] = useState(false);
  const [pdfError, setPdfError] = useState('');
  const [showImportModal, setShowImportModal] = useState(false);
  const [importDismissed, setImportDismissed] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [editingData, setEditingData] = useState<Record<string, any>>({});

  // Compute linked quote data based on selected parent (PO)
  const linkedQuote = React.useMemo(() => {
    if (!enableQuoteImport || !parentId || !allPurchases.length) return null;

    const selectedPO = allPurchases.find((po: any) => po.po_id === parentId);
    if (!selectedPO?.quote_id) return null;

    const quote = allQuotes.find((q: any) => q.quote_id === selectedPO.quote_id);
    const quoteItems = allQuoteItems.filter((item: any) => item.quote_id === selectedPO.quote_id);

    return {
      quoteId: selectedPO.quote_id,
      quoteNumber: quote?.pi_number || `Quote #${selectedPO.quote_id}`,
      items: quoteItems,
    };
  }, [enableQuoteImport, parentId, allPurchases, allQuotes, allQuoteItems]);

  const handleDraftChange = (field: string, value: any) => {
    const updatedDraft = { ...draft, [field]: value };

    // Auto-populate supplier_description when component_id is selected
    if (field === 'component_id' && value) {
      const componentField = itemFields.find(f => f.name === 'component_id');
      if (componentField?.options) {
        const selectedComponent = componentField.options.find(
          (c: any) => c[componentField.config?.valueKey || 'component_id'] === value
        );
        if (selectedComponent) {
          updatedDraft.supplier_description = selectedComponent.internal_description || selectedComponent.supplier_model || '';
        }
      }
    }

    setDraft(updatedDraft);
  };

  const addItem = () => {
    for (const f of itemFields) {
      if (f.req && !draft[f.name]) {
        alert(`${f.label} is required`);
        return;
      }
    }

    setItems([...items, { ...draft, _id: Date.now() }]);

    const nextDraft: Record<string, any> = {};
    stickyFields.forEach((key) => {
      if (draft[key]) nextDraft[key] = draft[key];
    });
    if (draft.currency && !nextDraft.currency) nextDraft.currency = draft.currency;

    setDraft(nextDraft);
  };

  const removeItem = (id: number) => {
    if (confirm('Remove this item?')) {
      setItems(items.filter((i) => i._id !== id));
    }
  };

  const editItem = (id: number) => {
    const itemToEdit = items.find((i) => i._id === id);
    if (itemToEdit) {
      setEditingId(id);
      const { _id, ...itemData } = itemToEdit;
      setEditingData(itemData);
    }
  };

  const saveEdit = () => {
    if (editingId !== null) {
      setItems(items.map(item =>
        item._id === editingId
          ? { ...editingData, _id: editingId }
          : item
      ));
      setEditingId(null);
      setEditingData({});
    }
  };

  const cancelEdit = () => {
    setEditingId(null);
    setEditingData({});
  };

  const clearAllItems = () => {
    if (confirm('Remove all items? This cannot be undone.')) {
      setItems([]);
    }
  };

  const handlePdfUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || file.type !== 'application/pdf') {
      setPdfError('Please select a PDF file');
      return;
    }

    setPdfUploading(true);
    setPdfError('');

    try {
      const formData = new FormData();
      formData.append('pdf', file);

      const response = await fetch('/api/extract-pdf', {
        method: 'POST',
        body: formData,
      });

      if (!response.ok) {
        throw new Error('Failed to extract PDF data');
      }

      const extractedData = await response.json();

      const newDraft: Record<string, any> = {};
      const validFieldNames = itemFields.map(f => f.name);

      if (extractedData.quote_date || extractedData.pi_date || extractedData.po_date) {
        const dateValue = extractedData.quote_date || extractedData.pi_date || extractedData.po_date;
        if (validFieldNames.includes('quote_date')) newDraft.quote_date = dateValue;
        if (validFieldNames.includes('po_date')) newDraft.po_date = dateValue;
      }

      if (extractedData.quote_number || extractedData.pi_number || extractedData.po_number) {
        if (validFieldNames.includes('quote_number')) newDraft.quote_number = extractedData.quote_number || extractedData.pi_number;
        if (validFieldNames.includes('po_number')) newDraft.po_number = extractedData.po_number || extractedData.pi_number;
      }

      if (extractedData.currency && validFieldNames.includes('currency')) newDraft.currency = extractedData.currency;
      if (extractedData.supplier_name && validFieldNames.includes('supplier_name')) newDraft.supplier_name = extractedData.supplier_name;

      setDraft(newDraft);

      if (extractedData.line_items && extractedData.line_items.length > 0) {
        const hasComponentField = itemFields.some(f => f.name === 'component_id');

        const newItems = extractedData.line_items.map((item: any, index: number) => {
          const baseItem: Record<string, any> = {
            _id: Date.now() + index,
            ...newDraft,
          };

          if (hasComponentField) {
            const componentField = itemFields.find(f => f.name === 'component_id');
            let matchedComponent = null;

            if (componentField?.options) {
              const components = componentField.options as any[];
              const searchSku = item.model_sku?.toLowerCase().trim() || '';
              const searchDesc = item.description?.toLowerCase().trim() || '';
              const searchBrand = item.brand?.toLowerCase().trim() || '';

              if (searchSku) {
                matchedComponent = components.find(
                  (c: any) => c.supplier_model?.toLowerCase().trim() === searchSku
                );
              }
              if (!matchedComponent && searchSku) {
                matchedComponent = components.find(
                  (c: any) => c.supplier_model?.toLowerCase().includes(searchSku) ||
                             searchSku.includes(c.supplier_model?.toLowerCase())
                );
              }
              if (!matchedComponent && searchBrand && searchDesc) {
                matchedComponent = components.find((c: any) => {
                  const componentBrand = c.brand?.toLowerCase().trim() || '';
                  const componentDesc = c.internal_description?.toLowerCase().trim() || '';
                  const brandMatch = componentBrand === searchBrand;
                  const descMatch = componentDesc.includes(searchDesc) || searchDesc.includes(componentDesc);
                  return brandMatch && descMatch;
                });
              }
              if (!matchedComponent && searchDesc && searchDesc.length > 10) {
                matchedComponent = components.find((c: any) => {
                  const componentDesc = c.internal_description?.toLowerCase().trim() || '';
                  return componentDesc.includes(searchDesc) || searchDesc.includes(componentDesc);
                });
              }

              if (matchedComponent) {
                baseItem.component_id = matchedComponent.component_id;
                baseItem.supplier_description = matchedComponent.internal_description || matchedComponent.supplier_model || '';
                console.log(`✅ Auto-matched: "${searchSku || searchDesc}" → Component ID ${matchedComponent.component_id} (${matchedComponent.supplier_model})`);
              } else {
                baseItem.supplier_description = item.description || item.supplier_description || '';
                console.warn(`⚠️ No match found for: SKU="${item.model_sku}", Brand="${item.brand}", Desc="${item.description}"`);
              }
            }

            baseItem.quantity = item.quantity || 0;
            if (itemFields.some(f => f.name === 'unit_price')) baseItem.unit_price = item.unit_price || item.unit_cost || 0;
            if (itemFields.some(f => f.name === 'unit_cost')) baseItem.unit_cost = item.unit_cost || item.unit_price || 0;
          } else {
            baseItem.brand = item.brand || '';
            baseItem.description = item.description || item.supplier_description || '';
            baseItem.model_sku = item.model_sku || '';
            baseItem.quantity = item.quantity || 0;
            baseItem.unit_cost = item.unit_price || item.unit_cost || 0;
          }

          return baseItem;
        });

        setItems(newItems);

        const matchedCount = newItems.filter((item: Record<string, any>) => item.component_id).length;
        const unmatchedCount = newItems.length - matchedCount;

        let message = `✅ Extracted ${newItems.length} line items from PDF!\n`;
        if (hasComponentField) {
          message += `\n🎯 Auto-matched: ${matchedCount} components`;
          if (unmatchedCount > 0) message += `\n⚠️ Not matched: ${unmatchedCount} items - please select components manually`;
        }
        message += '\n\nPlease review and edit before submitting.';

        alert(message);
      } else {
        alert('PDF extracted but no line items found. Please add items manually.');
      }

      e.target.value = '';
    } catch (error) {
      setPdfError(error instanceof Error ? error.message : 'Failed to extract PDF');
      alert('Failed to extract PDF data. Please check the console for details.');
    } finally {
      setPdfUploading(false);
    }
  };

  const handleImportQuoteItems = (importedItems: any[]) => {
    const newItems = importedItems.map((item, index) => ({
      ...item,
      _id: Date.now() + index,
    }));
    setItems([...items, ...newItems]);
    setImportDismissed(true);
  };

  const handleStartFresh = () => {
    setImportDismissed(true);
  };

  const handleSubmit = () => {
    if (parentField && !parentId) {
      alert(`Select ${parentField.label}`);
      return;
    }
    if (items.length === 0) {
      alert('Add at least one item');
      return;
    }

    const payload = items.map(({ _id, ...rest }) => {
      if (parentField) return { ...rest, [parentField.name]: parentId };
      return rest;
    });

    onSubmit(payload);
    setItems([]);
  };

  const isHeaderField = (name: string) => stickyFields.includes(name);

  return (
    <div className="bg-slate-900/40 backdrop-blur-sm rounded-2xl border border-slate-800/80 p-5 md:p-8 shadow-xl ring-1 ring-white/5 space-y-6">
      {/* Title */}
      <div className="flex items-center gap-3 border-b border-slate-800/80 pb-4">
        <div className="w-8 h-8 rounded-lg bg-sky-500/10 border border-sky-500/20 flex items-center justify-center">
          <span className="w-2.5 h-2.5 rounded-full bg-sky-500 shadow-[0_0_10px_rgba(14,165,233,0.8)]"></span>
        </div>
        <h3 className="text-lg font-bold text-white tracking-tight">{title}</h3>
      </div>

      {/* PDF Upload Button (if enabled) */}
      {enablePdfUpload && (
        <div className="bg-blue-500/5 border border-blue-500/20 rounded-xl p-4 ring-1 ring-white/5">
          <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
            <div className="flex items-center gap-3">
              <div className="p-2 bg-blue-500/10 rounded-lg border border-blue-500/20">
                <span className="text-xl block leading-none">📄</span>
              </div>
              <div>
                <h4 className="text-sm font-bold text-blue-300">Upload PDF to Pre-fill</h4>
                <p className="text-xs text-slate-400">AI will extract data and populate the form below</p>
              </div>
            </div>
            <label className="cursor-pointer">
              <input
                type="file"
                accept="application/pdf"
                onChange={handlePdfUpload}
                disabled={pdfUploading}
                className="hidden"
              />
              <span className="inline-flex items-center gap-2 bg-blue-600 hover:bg-blue-500 text-white px-4 py-2 rounded-xl text-sm font-bold shadow-lg border border-blue-500 transition-all active:scale-[0.98] disabled:opacity-50 disabled:cursor-not-allowed">
                {pdfUploading ? (
                  <>
                    <Spinner className="w-4 h-4" />
                    Extracting...
                  </>
                ) : (
                  <>📤 Upload PDF</>
                )}
              </span>
            </label>
          </div>
          {pdfError && (
            <div className="mt-3 p-3 bg-red-500/10 border border-red-500/20 rounded-lg text-xs text-red-400">
              {pdfError}
            </div>
          )}
        </div>
      )}

      {/* Quote Import - Smart Prompt (when PO has linked quote) */}
      {enableQuoteImport && linkedQuote && !importDismissed && items.length === 0 && (
        <div className="bg-emerald-500/5 border border-emerald-500/20 rounded-xl p-4 ring-1 ring-white/5">
          <div className="flex flex-col gap-3">
            <div className="flex items-start gap-3">
              <span className="text-2xl">💡</span>
              <div className="flex-1">
                <h4 className="text-sm font-bold text-emerald-300 mb-1">
                  This PO is linked to {linkedQuote.quoteNumber}
                </h4>
                <p className="text-xs text-slate-400">
                  {linkedQuote.items.length > 0
                    ? `Found ${linkedQuote.items.length} item${linkedQuote.items.length !== 1 ? 's' : ''} in the quote. Import them to save time!`
                    : 'No items found in the linked quote.'
                  }
                </p>
              </div>
            </div>
            {linkedQuote.items.length > 0 && (
              <div className="flex flex-col sm:flex-row gap-2">
                <button
                  onClick={() => setShowImportModal(true)}
                  className="flex-1 bg-emerald-600 hover:bg-emerald-500 text-white px-4 py-2.5 rounded-xl font-bold text-sm transition-all shadow-lg border border-emerald-500/50 active:scale-[0.98]"
                >
                  📋 Import Quote Items
                </button>
                <button
                  onClick={handleStartFresh}
                  className="flex-1 bg-slate-800 hover:bg-slate-700 text-white px-4 py-2.5 rounded-xl font-bold text-sm transition-all border border-slate-700/50 active:scale-[0.98]"
                >
                  Start Fresh
                </button>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Quote Import - Manual Button */}
      {enableQuoteImport && linkedQuote && linkedQuote.items.length > 0 && (importDismissed || items.length > 0) && (
        <div className="flex justify-end">
          <button
            onClick={() => setShowImportModal(true)}
            className="inline-flex items-center gap-2 bg-slate-800 hover:bg-slate-700 text-white px-4 py-2 rounded-xl text-sm font-bold transition-all border border-slate-700/50 active:scale-[0.98]"
          >
            📋 Import from Quote
          </button>
        </div>
      )}

      {/* Quote Import Modal */}
      {enableQuoteImport && linkedQuote && (
        <QuoteItemsImportModal
          isOpen={showImportModal}
          quoteItems={linkedQuote.items}
          components={components}
          onSelect={handleImportQuoteItems}
          onClose={() => setShowImportModal(false)}
        />
      )}

      {/* Parent Selector (if provided) */}
      {parentField && (
        <div className="bg-slate-950/50 p-4 rounded-xl border border-slate-800/80">
          <label className="block text-xs font-bold text-slate-400 mb-2 uppercase tracking-widest">
            {parentField.label}
          </label>
          <select
            className="w-full md:w-1/2 p-3 bg-slate-950/70 border border-slate-700/80 rounded-xl text-sm text-white focus:border-emerald-500 focus:ring-2 focus:ring-emerald-500/20 focus:outline-none transition-all"
            value={parentId}
            onChange={(e) => setParentId(e.target.value)}
          >
            <option value="">-- Select --</option>
            {parentField.options.map((o) => (
              <option key={o.val} value={o.val}>
                {o.txt}
              </option>
            ))}
          </select>
        </div>
      )}

      {/* Add Item Section */}
      <div className="bg-slate-950/50 p-4 md:p-6 rounded-xl border border-slate-800/80">
        <div className="flex flex-col gap-6">
          {/* Header/Sticky Fields (if any) */}
          {stickyFields.length > 0 && (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 pb-6 border-b border-slate-700/50">
              {itemFields
                .filter((f) => isHeaderField(f.name))
                .map((f) => (
                  <FieldRenderer
                    key={f.name}
                    field={f}
                    value={draft[f.name]}
                    onChange={handleDraftChange}
                    formId={formId}
                  />
                ))}
            </div>
          )}

          {/* Variable Fields */}
          <div className="flex flex-col md:flex-row flex-wrap items-end gap-4">
            {itemFields
              .filter((f) => !isHeaderField(f.name))
              .map((f) => (
                <div
                  key={f.name}
                  className={`w-full ${
                    f.name.includes('description') || f.name.includes('component')
                      ? 'md:flex-[2]'
                      : 'md:flex-1'
                  } min-w-[140px]`}
                >
                  <FieldRenderer
                    field={f}
                    value={draft[f.name]}
                    onChange={handleDraftChange}
                    formId={formId}
                  />
                </div>
              ))}

            {/* Add Button */}
            <button
              type="button"
              onClick={addItem}
              className="w-full md:w-auto h-[46px] bg-emerald-600 hover:bg-emerald-500 text-white px-8 rounded-xl text-sm font-bold shadow-lg shadow-emerald-900/20 border border-emerald-500/50 transition-all active:scale-[0.98] flex items-center justify-center"
            >
              Add Item +
            </button>
          </div>
        </div>
      </div>

      {/* Staged Items List */}
      {items.length > 0 && (
        <div className="rounded-xl border border-slate-700/50 overflow-hidden shadow-lg ring-1 ring-white/5 animate-in fade-in slide-in-from-top-4 duration-300">
          {/* Header with Clear All button */}
          <div className="bg-slate-900/80 px-4 py-3 flex items-center justify-between border-b border-slate-800/80">
            <div className="text-sm font-bold text-slate-400 uppercase tracking-wider">
              {items.length} Item{items.length !== 1 ? 's' : ''} Added
            </div>
            <button
              onClick={clearAllItems}
              className="text-xs text-red-400 hover:text-red-300 hover:bg-red-500/10 px-3 py-1.5 rounded-lg transition-all font-bold border border-transparent hover:border-red-500/20"
            >
              🗑️ Clear All
            </button>
          </div>

          {/* Mobile-optimized list */}
          <div className="divide-y divide-slate-800/60 bg-slate-900/40">
            {items.map((item) => {
              const isEditing = editingId === item._id;
              const displayData = isEditing ? editingData : item;

              return (
                <div key={item._id} className="p-4 hover:bg-slate-800/40 transition-colors">
                  {isEditing ? (
                    /* Inline Editing Mode */
                    <div className="space-y-3">
                      <div className="text-xs font-bold text-sky-400 uppercase tracking-widest mb-3">
                        ✏️ Editing Item
                      </div>
                      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                        {itemFields.map((f) => (
                          <div key={f.name} className="flex flex-col gap-1">
                            <label className="text-xs text-slate-400 font-medium">{f.label}</label>
                            <FieldRenderer
                              field={f}
                              value={displayData[f.name]}
                              onChange={(name, value) => setEditingData({ ...editingData, [name]: value })}
                              formId={`${formId}-edit-${item._id}`}
                            />
                          </div>
                        ))}
                      </div>
                      <div className="flex gap-2 pt-2">
                        <button
                          onClick={saveEdit}
                          className="flex-1 bg-emerald-600 hover:bg-emerald-500 text-white px-4 py-2 rounded-xl text-sm font-bold transition-all border border-emerald-500/50"
                        >
                          ✓ Save
                        </button>
                        <button
                          onClick={cancelEdit}
                          className="flex-1 bg-slate-800 hover:bg-slate-700 text-white px-4 py-2 rounded-xl text-sm font-bold transition-all border border-slate-700/50"
                        >
                          Cancel
                        </button>
                      </div>
                    </div>
                  ) : (
                    /* Display Mode */
                    <div className="space-y-2">
                      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-x-4 gap-y-2">
                        {itemFields.map((f) => (
                          <div key={f.name} className="flex flex-col">
                            <span className="text-xs text-slate-500 font-medium">{f.label}</span>
                            <span className="text-sm text-slate-200 font-medium">
                              {f.type === 'rich-select'
                                ? f.options?.find(
                                    (o: any) => o[f.config?.valueKey || 'component_id'] === displayData[f.name]
                                  )?.[f.config?.labelKey || 'supplier_model'] || displayData[f.name]
                                : displayData[f.name] || '-'}
                            </span>
                          </div>
                        ))}
                      </div>
                      <div className="flex items-center gap-2 pt-2 border-t border-slate-800/60 mt-3">
                        <button
                          onClick={() => editItem(item._id)}
                          className="flex-1 sm:flex-initial text-sky-400 hover:text-sky-300 hover:bg-sky-500/10 px-4 py-2 rounded-xl transition-all text-sm font-bold border border-transparent hover:border-sky-500/20"
                        >
                          ✏️ Edit
                        </button>
                        <button
                          onClick={() => removeItem(item._id)}
                          className="flex-1 sm:flex-initial text-red-400 hover:text-red-300 hover:bg-red-500/10 px-4 py-2 rounded-xl transition-all text-sm font-bold border border-transparent hover:border-red-500/20"
                        >
                          🗑️ Remove
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>

          {/* Submit Section */}
          <div className="bg-slate-900/80 p-4 flex flex-col sm:flex-row justify-between items-center gap-3 border-t border-slate-800/80">
            <span className="text-xs text-slate-500 font-medium">{items.length} items staged</span>
            <button
              onClick={handleSubmit}
              disabled={loading}
              className="w-full sm:w-auto bg-emerald-600 hover:bg-emerald-500 text-white text-sm font-bold py-2.5 px-6 rounded-xl shadow-lg shadow-emerald-900/20 border border-emerald-500/50 transition-all hover:scale-[1.02] active:scale-[0.98] disabled:opacity-50 disabled:scale-100 disabled:cursor-not-allowed flex items-center justify-center gap-2"
            >
              {loading ? (
                <>
                  <Spinner className="w-4 h-4" />
                  Saving...
                </>
              ) : (
                `Save All Items`
              )}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
