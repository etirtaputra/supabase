/**
 * Batch Line Items Form Component
 * Allows adding multiple related items in batch mode
 * Supports sticky fields and mobile-optimized layout
 */
'use client';
import React, { useState, useEffect, useRef, useId, useMemo } from 'react';
import FieldRenderer from './FieldRenderer';
import { Spinner } from '../ui/LoadingSkeleton';
import QuoteItemsImportModal from './QuoteItemsImportModal';
import type { BatchLineItemsFormProps } from '../../types/forms';
import { useT } from '@/hooks/useT';
export default function BatchLineItemsForm({
  title,
  storageKey: storageKeyProp,
  parentField,
  itemFields,
  stickyFields = [],
  onSubmit,
  loading,
  formId: customFormId,
  enableQuoteImport = false,
  allQuoteItems = [],
  allQuotes = [],
  allPurchases = [],
  components = [],
  gridLayout = false,
  defaultParentId,
  onParentChange,
  fieldDefaultsOnParentChange = {},
}: BatchLineItemsFormProps) {
  const { t } = useT();
  const uniqueFormId = useId();
  const formId = customFormId || uniqueFormId;
  const storageKey = `form-draft:${storageKeyProp ?? title}`;

  const loadSaved = () => {
    try {
      const raw = localStorage.getItem(storageKey);
      if (raw) return JSON.parse(raw) as { parentId?: string; items?: any[]; draft?: Record<string, any> };
    } catch {}
    return null;
  };

  const [parentId, setParentId] = useState(() => {
    if (defaultParentId) return defaultParentId;
    if (typeof window !== 'undefined') return loadSaved()?.parentId ?? '';
    return '';
  });

  // Sync when parent pre-selects a new ID (e.g. after creating a quote/PO)
  useEffect(() => {
    if (defaultParentId && defaultParentId !== parentId) {
      setParentId(defaultParentId);
      onParentChange?.(defaultParentId);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [defaultParentId]);

  // ── Searchable parent combobox (hundreds of POs — scrolling doesn't scale) ──
  const [parentQuery, setParentQuery] = useState('');
  const [parentOpen, setParentOpen] = useState(false);
  const [parentIdx, setParentIdx] = useState(0);
  const parentBoxRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const h = (e: MouseEvent) => {
      if (parentBoxRef.current && !parentBoxRef.current.contains(e.target as Node)) setParentOpen(false);
    };
    document.addEventListener('mousedown', h);
    return () => document.removeEventListener('mousedown', h);
  }, []);

  const filteredParents = useMemo(() => {
    const opts = parentField?.options ?? [];
    const q = parentQuery.toLowerCase().trim();
    if (!q) return opts.slice(0, 100);
    const tokens = q.split(/\s+/).filter(Boolean);
    return opts.filter((o) => {
      const hay = o.txt.toLowerCase();
      return tokens.every((t) => hay.includes(t));
    }).slice(0, 100);
  }, [parentField?.options, parentQuery]);

  // Keep the highlighted option visible while arrowing
  useEffect(() => {
    parentBoxRef.current?.querySelector(`[data-parent-idx="${parentIdx}"]`)?.scrollIntoView({ block: 'nearest' });
  }, [parentIdx]);

  function selectParent(val: string) {
    setParentId(val);
    onParentChange?.(val);
    persistState(val, items, draft);
    setParentOpen(false);
  }

  const prevParentIdRef = useRef('');
  useEffect(() => {
    if (!parentId || parentId === prevParentIdRef.current) return;
    prevParentIdRef.current = parentId;
    if (!fieldDefaultsOnParentChange || Object.keys(fieldDefaultsOnParentChange).length === 0) return;
    setDraft(prev => {
      const updated = { ...prev, ...fieldDefaultsOnParentChange };
      persistState(parentId, items, updated);
      return updated;
    });
  }, [parentId, fieldDefaultsOnParentChange]); // eslint-disable-line react-hooks/exhaustive-deps

  const [items, setItems] = useState<any[]>(() => {
    if (typeof window !== 'undefined') return loadSaved()?.items ?? [];
    return [];
  });
  const [draft, setDraft] = useState<Record<string, any>>(() => {
    if (typeof window !== 'undefined') return loadSaved()?.draft ?? {};
    return {};
  });
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

  const persistState = (nextParentId: string, nextItems: any[], nextDraft: Record<string, any>) => {
    try { localStorage.setItem(storageKey, JSON.stringify({ parentId: nextParentId, items: nextItems, draft: nextDraft })); } catch {}
  };

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
    persistState(parentId, items, updatedDraft);
  };

  const addItem = () => {
    for (const f of itemFields) {
      if (f.req && !draft[f.name]) {
        alert(`${f.label} is required`);
        return;
      }
    }

    const nextItems = [...items, { ...draft, _id: Date.now() }];
    setItems(nextItems);

    const nextDraft: Record<string, any> = {};
    stickyFields.forEach((key) => {
      if (draft[key]) nextDraft[key] = draft[key];
    });
    if (draft.currency && !nextDraft.currency) nextDraft.currency = draft.currency;

    setDraft(nextDraft);
    persistState(parentId, nextItems, nextDraft);
  };

  const removeItem = (id: number) => {
    if (confirm('Remove this item?')) {
      const nextItems = items.filter((i) => i._id !== id);
      setItems(nextItems);
      persistState(parentId, nextItems, draft);
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

  const handleEditChange = (field: string, value: any) => {
    const updated = { ...editingData, [field]: value };

    if (field === 'component_id' && value) {
      const componentField = itemFields.find(f => f.name === 'component_id');
      if (componentField?.options) {
        const selected = componentField.options.find(
          (c: any) => c[componentField.config?.valueKey || 'component_id'] === value
        );
        if (selected) {
          updated.supplier_description = selected.internal_description || selected.supplier_model || '';
        }
      }
    }

    setEditingData(updated);
  };

  const cancelEdit = () => {
    setEditingId(null);
    setEditingData({});
  };

  const clearAllItems = () => {
    if (confirm('Remove all items? This cannot be undone.')) {
      setItems([]);
      persistState(parentId, [], draft);
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
    setDraft({});
    try { localStorage.removeItem(storageKey); } catch {}
  };

  const isHeaderField = (name: string) => stickyFields.includes(name);

  return (
    <div className="bg-slate-900/40 backdrop-blur-sm rounded-2xl border border-slate-800/80 p-4 md:p-5 shadow-xl ring-1 ring-white/5 space-y-4">
      {/* Title */}
      <div className="flex items-center gap-3 border-b border-slate-800/80 pb-3">
        <h3 className="text-sm font-bold text-white tracking-tight flex-1">{title}</h3>
      </div>

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
                  {t('Import quote items')}
                </button>
                <button
                  onClick={handleStartFresh}
                  className="flex-1 bg-slate-800 hover:bg-slate-700 text-white px-4 py-2.5 rounded-xl font-bold text-sm transition-all border border-slate-700/50 active:scale-[0.98]"
                >
                  {t('Start fresh')}
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
            {t('Import from quote')}
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

      {/* Parent Selector (if provided) — searchable: type to filter POs/quotes */}
      {parentField && (
        <div className="bg-slate-950/50 p-4 rounded-xl border border-slate-800/80">
          <label className="block text-xs font-bold text-slate-400 mb-2 uppercase tracking-widest">
            {parentField.label}
          </label>
          <div className="relative w-full md:w-1/2" ref={parentBoxRef}>
            <input
              value={parentOpen ? parentQuery : (parentField.options.find((o) => String(o.val) === String(parentId))?.txt ?? '')}
              onFocus={() => { setParentOpen(true); setParentQuery(''); setParentIdx(0); }}
              onChange={(e) => { setParentQuery(e.target.value); setParentOpen(true); setParentIdx(0); }}
              onKeyDown={(e) => {
                if (!parentOpen) return;
                if (e.key === 'ArrowDown') { e.preventDefault(); setParentIdx((i) => Math.min(i + 1, filteredParents.length - 1)); }
                else if (e.key === 'ArrowUp') { e.preventDefault(); setParentIdx((i) => Math.max(i - 1, 0)); }
                else if (e.key === 'Escape') { setParentOpen(false); }
                else if (e.key === 'Enter') {
                  e.preventDefault();
                  const o = filteredParents[parentIdx];
                  if (o) { selectParent(String(o.val)); }
                }
              }}
              placeholder="Type PO / PI number, supplier, date…"
              className="w-full p-3 bg-slate-950/70 border border-slate-700/80 rounded-xl text-sm text-white placeholder:text-slate-600 focus:border-emerald-500 focus:ring-2 focus:ring-emerald-500/20 focus:outline-none transition-all"
            />
            {parentOpen && (
              <div className="absolute z-30 mt-1 w-full max-h-72 overflow-y-auto bg-slate-900 border border-slate-700 rounded-xl shadow-2xl">
                {filteredParents.length === 0 && (
                  <p className="px-3 py-2.5 text-xs text-slate-500">No matches — try a PO number or supplier name</p>
                )}
                {filteredParents.map((o, i) => (
                  <button
                    key={o.val}
                    type="button"
                    data-parent-idx={i}
                    onMouseDown={(e) => { e.preventDefault(); selectParent(String(o.val)); }}
                    onMouseEnter={() => setParentIdx(i)}
                    className={`w-full text-left px-3 py-2 text-xs transition-colors ${i === parentIdx ? 'bg-slate-800' : ''} ${String(o.val) === String(parentId) ? 'text-emerald-300 font-semibold' : 'text-slate-200'}`}
                  >
                    {o.txt}
                  </button>
                ))}
              </div>
            )}
          </div>
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
          {gridLayout ? (
            <div className="flex flex-col gap-4">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                {itemFields
                  .filter((f) => !isHeaderField(f.name))
                  .map((f) => (
                    <div
                      key={f.name}
                      className={f.type === 'textarea' ? 'sm:col-span-2' : ''}
                    >
                      <FieldRenderer
                        field={f}
                        value={draft[f.name]}
                        onChange={handleDraftChange}
                        formId={formId}
                      />
                    </div>
                  ))}
              </div>
              <button
                type="button"
                onClick={addItem}
                className="w-full h-[46px] bg-emerald-600 hover:bg-emerald-500 text-white px-8 rounded-xl text-sm font-bold shadow-lg shadow-emerald-900/20 border border-emerald-500/50 transition-all active:scale-[0.98] flex items-center justify-center"
              >
                {t('Add item')}
              </button>
            </div>
          ) : (
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
                {t('Add item')}
              </button>
            </div>
          )}
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
              {t('Clear all')}
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
                              onChange={handleEditChange}
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
                          {t('Save')}
                        </button>
                        <button
                          onClick={cancelEdit}
                          className="flex-1 bg-slate-800 hover:bg-slate-700 text-white px-4 py-2 rounded-xl text-sm font-bold transition-all border border-slate-700/50"
                        >
                          {t('Cancel')}
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
                          {t('Edit')}
                        </button>
                        <button
                          onClick={() => removeItem(item._id)}
                          className="flex-1 sm:flex-initial text-red-400 hover:text-red-300 hover:bg-red-500/10 px-4 py-2 rounded-xl transition-all text-sm font-bold border border-transparent hover:border-red-500/20"
                        >
                          {t('Remove')}
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
