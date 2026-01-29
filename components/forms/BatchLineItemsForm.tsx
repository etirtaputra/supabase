/**
 * Batch Line Items Form Component
 * Allows adding multiple related items in batch mode
 * Supports sticky fields and mobile-optimized layout
 */

'use client';

import React, { useState, useId } from 'react';
import FieldRenderer from './FieldRenderer';
import { Spinner } from '../ui/LoadingSkeleton';
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
}: BatchLineItemsFormProps) {
  const uniqueFormId = useId();
  const formId = customFormId || uniqueFormId;

  const [parentId, setParentId] = useState('');
  const [items, setItems] = useState<any[]>([]);
  const [draft, setDraft] = useState<Record<string, any>>({});
  const [pdfUploading, setPdfUploading] = useState(false);
  const [pdfError, setPdfError] = useState('');

  const handleDraftChange = (field: string, value: any) => {
    setDraft({ ...draft, [field]: value });
  };

  const addItem = () => {
    // Validation
    for (const f of itemFields) {
      if (f.req && !draft[f.name]) {
        alert(`${f.label} is required`);
        return;
      }
    }

    setItems([...items, { ...draft, _id: Date.now() }]);

    // Reset draft with sticky logic
    const nextDraft: Record<string, any> = {};
    stickyFields.forEach((key) => {
      if (draft[key]) nextDraft[key] = draft[key];
    });
    // Keep currency by default if not in sticky fields
    if (draft.currency && !nextDraft.currency) nextDraft.currency = draft.currency;

    setDraft(nextDraft);
  };

  const removeItem = (id: number) => {
    if (confirm('Remove this item?')) {
      setItems(items.filter((i) => i._id !== id));
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

      // Pre-populate sticky fields (header fields)
      const newDraft: Record<string, any> = {};

      // Map extracted data to form fields
      if (extractedData.quote_date || extractedData.pi_date || extractedData.po_date) {
        newDraft.quote_date = extractedData.quote_date || extractedData.pi_date || extractedData.po_date;
        newDraft.po_date = extractedData.po_date || extractedData.quote_date;
      }

      if (extractedData.quote_number || extractedData.pi_number || extractedData.po_number) {
        newDraft.quote_number = extractedData.quote_number || extractedData.pi_number;
        newDraft.po_number = extractedData.po_number || extractedData.pi_number;
      }

      if (extractedData.currency) {
        newDraft.currency = extractedData.currency;
      }

      if (extractedData.supplier_name) {
        newDraft.supplier_name = extractedData.supplier_name;
      }

      setDraft(newDraft);

      // Pre-populate line items
      if (extractedData.line_items && extractedData.line_items.length > 0) {
        const newItems = extractedData.line_items.map((item: any, index: number) => ({
          _id: Date.now() + index,
          brand: item.brand || '',
          description: item.description || item.supplier_description || '',
          model_sku: item.model_sku || '',
          quantity: item.quantity || 0,
          unit_cost: item.unit_price || item.unit_cost || 0,
          unit_price: item.unit_price || item.unit_cost || 0,
          ...newDraft, // Include sticky fields
        }));

        setItems(newItems);
        alert(`✅ Extracted ${newItems.length} line items from PDF!\nPlease review and edit before submitting.`);
      } else {
        alert('PDF extracted but no line items found. Please add items manually.');
      }

      // Reset file input
      e.target.value = '';
    } catch (error) {
      setPdfError(error instanceof Error ? error.message : 'Failed to extract PDF');
      alert('Failed to extract PDF data. Please check the console for details.');
    } finally {
      setPdfUploading(false);
    }
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
    <div className="space-y-4">
      <div className="flex items-center justify-between border-b border-slate-800 pb-3 mb-2">
        <h3 className="text-base font-bold text-white flex items-center gap-2">
          <span className="w-2 h-2 rounded-full bg-emerald-500 shadow-[0_0_8px_rgba(16,185,129,0.5)]"></span>
          {title}
        </h3>
      </div>

      {/* PDF Upload Button (if enabled) */}
      {enablePdfUpload && (
        <div className="bg-blue-900/30 border border-blue-700/50 rounded-xl p-4">
          <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
            <div className="flex items-center gap-3">
              <span className="text-2xl">📄</span>
              <div>
                <h4 className="text-sm font-bold text-blue-300">Upload PDF to Pre-fill</h4>
                <p className="text-xs text-slate-400">
                  AI will extract data and populate the form below
                </p>
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
              <span className="inline-flex items-center gap-2 bg-blue-600 hover:bg-blue-500 text-white px-4 py-2 rounded-lg text-sm font-bold shadow-lg transition-all active:scale-95 disabled:opacity-50 disabled:cursor-not-allowed">
                {pdfUploading ? (
                  <>
                    <Spinner className="w-4 h-4" />
                    Extracting...
                  </>
                ) : (
                  <>
                    📤 Upload PDF
                  </>
                )}
              </span>
            </label>
          </div>
          {pdfError && (
            <div className="mt-3 p-3 bg-red-900/30 border border-red-700/50 rounded-lg text-xs text-red-300">
              {pdfError}
            </div>
          )}
        </div>
      )}

      {/* Parent Selector (if provided) */}
      {parentField && (
        <div className="mb-4 bg-slate-900/50 p-4 rounded-xl border border-slate-800">
          <label className="block text-xs font-bold text-slate-400 mb-2 uppercase tracking-wider">
            {parentField.label}
          </label>
          <select
            className="w-full md:w-1/2 p-3 bg-slate-950 border border-slate-700 rounded-lg text-sm text-white focus:border-emerald-500 focus:ring-2 focus:ring-emerald-500/20 focus:outline-none transition-all"
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
      <div className="bg-slate-900/80 p-4 md:p-5 rounded-xl border border-slate-800 shadow-xl">
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
              className="w-full md:w-auto h-[46px] bg-emerald-600 hover:bg-emerald-500 text-white px-8 rounded-lg text-sm font-bold shadow-lg shadow-emerald-900/20 transition-all active:scale-95 flex items-center justify-center"
            >
              Add Item +
            </button>
          </div>
        </div>
      </div>

      {/* Staged Items Table */}
      {items.length > 0 && (
        <div className="rounded-xl border border-slate-800 overflow-hidden shadow-lg animate-in fade-in slide-in-from-top-4 duration-300">
          <div className="overflow-x-auto">
            <table className="w-full text-xs text-left text-slate-400 min-w-[600px]">
              <thead className="bg-slate-900 uppercase font-bold text-slate-500 tracking-wider">
                <tr>
                  {itemFields.map((f) => (
                    <th key={f.name} className="px-4 py-3 whitespace-nowrap">
                      {f.label}
                    </th>
                  ))}
                  <th className="px-4 py-3 text-right">Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800 bg-slate-900/40">
                {items.map((item) => (
                  <tr key={item._id} className="hover:bg-slate-800/80 transition-colors">
                    {itemFields.map((f) => (
                      <td key={f.name} className="px-4 py-3 whitespace-nowrap text-slate-300 font-medium">
                        {f.type === 'rich-select'
                          ? f.options?.find(
                              (o: any) => o[f.config?.valueKey || 'component_id'] === item[f.name]
                            )?.[f.config?.labelKey || 'model_sku']
                          : item[f.name]}
                      </td>
                    ))}
                    <td className="px-4 py-3 text-right">
                      <button
                        onClick={() => removeItem(item._id)}
                        className="text-red-400 hover:text-red-300 hover:bg-red-900/30 w-8 h-8 rounded-full flex items-center justify-center transition-all text-lg font-bold"
                      >
                        ×
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Submit Section */}
          <div className="bg-slate-900 p-4 flex flex-col sm:flex-row justify-between items-center gap-3 border-t border-slate-800">
            <span className="text-xs text-slate-500">{items.length} items staged</span>
            <button
              onClick={handleSubmit}
              disabled={loading}
              className="w-full sm:w-auto bg-emerald-600 hover:bg-emerald-500 text-white text-sm font-bold py-2.5 px-6 rounded-lg shadow-md transition-all hover:scale-105 active:scale-95 disabled:opacity-50 disabled:scale-100 disabled:cursor-not-allowed flex items-center justify-center gap-2"
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
