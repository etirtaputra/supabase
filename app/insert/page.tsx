/**
 * Supply Chain Data Entry
 * Top-nav layout with URL-param tab sync, optimized for desktop & mobile
 */
'use client';
import { useState, useMemo, Suspense } from 'react';
import { useSearchParams, useRouter } from 'next/navigation';
import { createSupabaseClient } from '@/lib/supabase';
// Components
import SimpleForm from '@/components/forms/SimpleForm';
import BatchLineItemsForm from '@/components/forms/BatchLineItemsForm';
import ComponentEditor from '@/components/ui/ComponentEditor';
import CompetitorPriceForm from '@/components/forms/CompetitorPriceForm';
import MultiPaymentForm from '@/components/forms/MultiPaymentForm';
import POLookupTab from '@/components/ui/POLookupTab';
import { ToastContainer } from '@/components/ui/Toast';
import { ToastProvider } from '@/hooks/useToast';
import { FormSkeleton } from '@/components/ui/LoadingSkeleton';
// Hooks
import { useSupabaseData } from '@/hooks/useSupabaseData';
import { useSuggestions } from '@/hooks/useSuggestions';
import { useToast } from '@/hooks/useToast';
// Constants & Types
import { ENUMS } from '@/constants/enums';
import type { Tab, MenuItem } from '@/types/forms';

const MENU_ITEMS: MenuItem[] = [
  { id: 'catalog', label: 'Catalog', icon: '🗂️',
    color: 'text-slate-400 hover:text-emerald-300 hover:bg-slate-800/50',
    activeColor: 'bg-emerald-500/15 text-emerald-300 ring-1 ring-emerald-500/30' },
  { id: 'quoting', label: 'Quotes', icon: '📝',
    color: 'text-slate-400 hover:text-blue-300 hover:bg-slate-800/50',
    activeColor: 'bg-blue-500/15 text-blue-300 ring-1 ring-blue-500/30' },
  { id: 'ordering', label: 'PI / PO', icon: '📦',
    color: 'text-slate-400 hover:text-violet-300 hover:bg-slate-800/50',
    activeColor: 'bg-violet-500/15 text-violet-300 ring-1 ring-violet-500/30' },
  { id: 'financials', label: 'Payment', icon: '💰',
    color: 'text-slate-400 hover:text-rose-300 hover:bg-slate-800/50',
    activeColor: 'bg-rose-500/15 text-rose-300 ring-1 ring-rose-500/30' },
  { id: 'lookup', label: 'PO / PI Lookup', icon: '🔍',
    color: 'text-slate-400 hover:text-sky-300 hover:bg-slate-800/50',
    activeColor: 'bg-sky-500/15 text-sky-300 ring-1 ring-sky-500/30' },
  { id: 'market-intel', label: 'Market Intel', icon: '📊',
    color: 'text-slate-400 hover:text-slate-300 hover:bg-slate-800/50',
    activeColor: 'bg-slate-700/60 text-slate-200 ring-1 ring-slate-500/30' },
];

function MasterInsertPage() {
  const supabase = createSupabaseClient();
  const router = useRouter();
  const searchParams = useSearchParams();
  const initialTab = (searchParams.get('tab') as Tab) || 'catalog';
  const [activeTab, setActiveTab] = useState<Tab>(initialTab);
  const [catalogMode, setCatalogMode] = useState<'add' | 'edit'>('add');
  const [loading, setLoading] = useState(false);
  const [pdfData, setPdfData] = useState<any>(null);
  const [paymentMode, setPaymentMode] = useState<'single' | 'batch'>('single');
  const [singlePoId, setSinglePoId] = useState('');
  const [lastSaved, setLastSaved] = useState<{ message: string; cta: string; nextTab: Tab } | null>(null);
  const [pdfUploading, setPdfUploading] = useState(false);
  const [dupWarning, setDupWarning] = useState<string | null>(null);
  const [orderingPoId, setOrderingPoId] = useState('');

  const { data, loading: dataLoading, refetch } = useSupabaseData();
  const suggestions = useSuggestions(data);
  const { showToast } = useToast();

  const handleTabChange = (tab: Tab) => {
    setActiveTab(tab);
    setLastSaved(null);
    setDupWarning(null);
    router.replace(`/insert?tab=${tab}`, { scroll: false });
  };

  const handleStatusChange = async (poId: string, status: string) => {
    const { error } = await supabase.from('5.0_purchases').update({ status }).eq('po_id', poId);
    if (error) { showToast(`Error updating status: ${error.message}`, 'error'); throw error; }
    showToast(`Status updated to ${status}`, 'success');
    refetch();
  };

  const options = useMemo(
    () => ({
      companies: data.companies.map((c) => ({ val: c.company_id, txt: c.legal_name })),
      quotes: data.quotes.map((q) => {
        const supplier = data.suppliers.find((s) => s.supplier_id === q.supplier_id);
        const code = supplier?.supplier_code ? `[${supplier.supplier_code}] ` : '';
        return { val: q.quote_id, txt: `${code}${q.pi_number || 'No Ref'} | ${q.currency} ${q.total_value}` };
      }),
      pis: data.pis.map((p) => ({ val: p.pi_id, txt: `${p.pi_number} (${p.pi_date})` })),
      pos: data.pos.map((p) => {
        const quote    = p.quote_id ? data.quotes.find((q) => String(q.quote_id) === String(p.quote_id)) : null;
        const supplier = quote ? data.suppliers.find((s) => s.supplier_id === quote.supplier_id) : null;
        const code     = supplier?.supplier_code ? `[${supplier.supplier_code}] ` : '';
        const value    = p.total_value ? ` | ${p.currency || 'IDR'} ${Number(p.total_value).toLocaleString()}` : '';
        const piPart   = p.pi_number ? `${p.pi_number} · ` : '';
        return { val: p.po_id, txt: `${code}${piPart}${p.po_number} - ${p.po_date}${value}` };
      }),
    }),
    [data]
  );

  const pdfDefaults = useMemo(() => {
    if (!pdfData) return {};
    const defaults: any = {};
    if (pdfData.supplier_name && data.suppliers.length > 0) {
      const supplierName = pdfData.supplier_name.toLowerCase().trim();
      const matchedSupplier = data.suppliers.find((s: any) =>
        s.supplier_name?.toLowerCase().trim() === supplierName ||
        s.supplier_name?.toLowerCase().includes(supplierName) ||
        supplierName.includes(s.supplier_name?.toLowerCase())
      );
      if (matchedSupplier) defaults.supplier_id = matchedSupplier.supplier_id;
    }
    if (pdfData.company_name && data.companies.length > 0) {
      const companyName = pdfData.company_name.toLowerCase().trim();
      const matchedCompany = data.companies.find((c: any) =>
        c.legal_name?.toLowerCase().trim() === companyName ||
        c.legal_name?.toLowerCase().includes(companyName) ||
        companyName.includes(c.legal_name?.toLowerCase())
      );
      if (matchedCompany) defaults.company_id = matchedCompany.company_id;
    }
    return defaults;
  }, [pdfData, data.suppliers, data.companies]);

  const handleInsert = async (table: string, insertData: any) => {
    setLoading(true);
    const payload = Array.isArray(insertData) ? insertData : [insertData];
    const cleanPayload = payload.map((item) =>
      Object.fromEntries(
        Object.entries(item).map(([k, v]) => {
          if (v === '') return [k, null];
          if (k === 'specifications' && typeof v === 'string') {
            try { return [k, JSON.parse(v)]; } catch { return [k, v]; }
          }
          return [k, v];
        })
      )
    );
    const { error } = await supabase.from(table).insert(cleanPayload);
    setLoading(false);
    if (error) {
      showToast(`Error: ${error.message}`, 'error');
    } else {
      showToast(`✅ Added ${cleanPayload.length} record(s)!`, 'success');
      refetch();
      if (table === '4.0_price_quotes') {
        setLastSaved({ message: 'Quote saved!', cta: 'Create PO →', nextTab: 'ordering' });
      } else if (table === '5.0_purchases') {
        setLastSaved({ message: 'PO saved!', cta: 'Log payment →', nextTab: 'financials' });
      }
    }
  };

  const handleComponentDelete = async (component_id: string) => {
    const { error } = await supabase.from('3.0_components').delete().eq('component_id', component_id);
    if (error) { showToast(`Error deleting component: ${error.message}`, 'error'); throw error; }
    showToast('Component deleted.', 'success');
    refetch();
  };

  const handleSaveLineItem = async (item: Record<string, any>) => {
    const { quote_line_id, ...fields } = item;
    if (quote_line_id) {
      const { error } = await supabase.from('4.1_price_quote_line_items').update(fields).eq('quote_line_id', quote_line_id);
      if (error) { showToast(`Error updating line item: ${error.message}`, 'error'); throw error; }
      showToast('Line item updated.', 'success');
    } else {
      const { error } = await supabase.from('4.1_price_quote_line_items').insert(fields);
      if (error) { showToast(`Error adding line item: ${error.message}`, 'error'); throw error; }
      showToast('Line item added.', 'success');
    }
    refetch();
  };

  const handleDeleteLineItem = async (quote_line_id: number) => {
    const { error } = await supabase.from('4.1_price_quote_line_items').delete().eq('quote_line_id', quote_line_id);
    if (error) { showToast(`Error deleting line item: ${error.message}`, 'error'); throw error; }
    showToast('Line item deleted.', 'success');
    refetch();
  };

  const handleComponentUpdates = async (updates: { component_id: string; changes: Record<string, any> }[]) => {
    const errors: string[] = [];
    let saved = 0;
    for (const { component_id, changes } of updates) {
      if (!component_id || !changes || Object.keys(changes).length === 0) continue;
      const { data: updated, error } = await supabase.from('3.0_components').update(changes).eq('component_id', component_id).select();
      if (error) errors.push(`${component_id}: ${error.message}`);
      else if (!updated || updated.length === 0) errors.push(`${component_id}: no rows matched`);
      else saved++;
    }
    if (errors.length > 0) { showToast(`Error(s): ${errors.join(' | ')}`, 'error'); throw new Error('One or more updates failed'); }
    showToast(`Updated ${saved} component(s)!`, 'success');
    refetch();
  };

  const handlePdfUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || file.type !== 'application/pdf') { showToast('Please select a PDF file', 'error'); return; }
    setPdfUploading(true);
    try {
      const formData = new FormData();
      formData.append('pdf', file);
      const response = await fetch('/api/extract-pdf', { method: 'POST', body: formData });
      if (!response.ok) throw new Error('Failed to extract PDF data');
      const extractedData = await response.json();
      setPdfData(extractedData);
      let message = `✅ Extracted ${extractedData.line_items?.length || 0} items from PDF!`;
      if (extractedData.supplier_name) message += `\n📦 Supplier: ${extractedData.supplier_name}`;
      if (extractedData.company_name) message += `\n🏢 Addressed to: ${extractedData.company_name}`;
      showToast(message, 'success');
      e.target.value = '';
    } catch (error) {
      showToast('Failed to extract PDF data', 'error');
      console.error(error);
    } finally {
      setPdfUploading(false);
    }
  };

  const activeItem = MENU_ITEMS.find((m) => m.id === activeTab);

  return (
    <div className="min-h-screen bg-[#0B1120] text-slate-200 font-sans text-sm selection:bg-emerald-500/30">
      {/* ── Sticky top header + tab bar ── */}
      <div className="sticky top-0 z-50 bg-[#0B1120]/80 backdrop-blur-md border-b border-slate-800/60 shadow-lg shadow-black/20">
        <header className="px-4 md:px-8 pt-4 pb-2 max-w-[1800px] mx-auto flex flex-col sm:flex-row sm:items-end justify-between gap-1">
          <div>
            <h1 className="text-lg md:text-2xl font-extrabold text-white tracking-tight leading-tight">
              ICA Supply Chain{' '}
              <span className="text-transparent bg-clip-text bg-gradient-to-r from-emerald-400 to-sky-400">Data Entry</span>
            </h1>
            <p className="text-slate-500 text-[11px] mt-0.5 hidden sm:block font-medium">
              {activeItem?.icon} {activeItem?.label}
            </p>
          </div>
        </header>
        {/* Tab bar — scrollable pill tabs, works on both mobile & desktop */}
        <nav className="px-4 md:px-8 pb-3 max-w-[1800px] mx-auto flex overflow-x-auto gap-2 scrollbar-none snap-x snap-mandatory">
          {MENU_ITEMS.map((item) => (
            <button
              key={item.id}
              onClick={() => handleTabChange(item.id)}
              className={`snap-start px-3.5 py-2 rounded-full text-xs font-semibold whitespace-nowrap transition-all duration-200 flex items-center gap-1.5 flex-shrink-0 ${
                activeTab === item.id ? item.activeColor : item.color
              }`}
            >
              <span className="text-sm leading-none">{item.icon}</span>
              {item.label}
            </button>
          ))}
        </nav>
      </div>

      {/* ── Main content ── */}
      <main className={`max-w-[1800px] mx-auto animate-in fade-in duration-300 ${
        activeTab === 'catalog' && catalogMode === 'edit' ? 'p-3 md:p-4' : 'p-4 md:p-6'
      }`}>
        <div className="pb-8 md:pb-4">
          {dataLoading ? (
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 md:gap-6">
              <FormSkeleton />
              <FormSkeleton />
            </div>
          ) : (
            <>
              {/* Catalog Tab */}
              {activeTab === 'catalog' && (
                <>
                  {/* Add / Edit toggle */}
                  <div className="flex items-center gap-3 mb-5">
                    <div className="flex rounded-xl overflow-hidden border border-slate-700 text-xs font-semibold">
                      <button
                        onClick={() => setCatalogMode('add')}
                        className={`px-4 py-2 transition-colors ${catalogMode === 'add' ? 'bg-emerald-500/20 text-emerald-300' : 'bg-slate-800/60 text-slate-400 hover:text-slate-300'}`}
                      >Add New</button>
                      <button
                        onClick={() => setCatalogMode('edit')}
                        className={`px-4 py-2 transition-colors ${catalogMode === 'edit' ? 'bg-emerald-500/20 text-emerald-300' : 'bg-slate-800/60 text-slate-400 hover:text-slate-300'}`}
                      >Edit Components</button>
                    </div>
                    <p className="text-xs text-slate-500">
                      {catalogMode === 'add' ? 'Add suppliers and components to your catalog.' : 'Search, edit, and manage existing components.'}
                    </p>
                  </div>

                  {catalogMode === 'add' && (
                    <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 md:gap-6">
                      <SimpleForm
                        title="Add New Supplier"
                        fields={[
                          { name: 'supplier_name', label: 'Supplier Name', type: 'text', req: true, suggestions: suggestions.supplierNames },
                          { name: 'supplier_code', label: 'Supplier Code', type: 'text', placeholder: 'SUP-001' },
                          { name: 'location', label: 'Location', type: 'text', suggestions: suggestions.locations },
                          { name: 'primary_contact_email', label: 'Email', type: 'email' },
                          { name: 'payment_terms_default', label: 'Pay Terms', type: 'text', suggestions: suggestions.paymentTerms },
                          { name: 'supplier_bank_details', label: 'Bank Details', type: 'textarea' },
                        ]}
                        onSubmit={(d) => handleInsert('2.0_suppliers', d)}
                        loading={loading}
                      />
                      <BatchLineItemsForm
                        title="Add New Component"
                        gridLayout
                        itemFields={[
                          { name: 'supplier_model', label: 'Supplier Model / SKU', type: 'text', req: true, suggestions: suggestions.modelSkus },
                          { name: 'internal_description', label: 'Internal Description', type: 'text', req: true, suggestions: suggestions.descriptions },
                          { name: 'brand', label: 'Brand', type: 'text', suggestions: suggestions.brands },
                          { name: 'category', label: 'Category', type: 'select', options: ENUMS.product_category },
                          { name: 'specifications', label: 'Specs (JSON)', type: 'textarea', placeholder: '{"watts": 100}' },
                        ]}
                        onSubmit={(items) => handleInsert('3.0_components', items)}
                        loading={loading}
                      />
                    </div>
                  )}

                  {catalogMode === 'edit' && (
                    <ComponentEditor
                      components={data.components}
                      brandSuggestions={suggestions.brands}
                      quoteItems={data.quoteItems}
                      quotes={data.quotes}
                      pos={data.pos}
                      poItems={data.poItems}
                      onSave={handleComponentUpdates}
                      onDelete={handleComponentDelete}
                      onSaveLineItem={handleSaveLineItem}
                      onDeleteLineItem={handleDeleteLineItem}
                    />
                  )}
                </>
              )}

              {/* Quoting Tab */}
              {activeTab === 'quoting' && (
                <>
                  {/* What's next banner */}
                  {lastSaved?.nextTab === 'quoting' && (
                    <div className="mb-4 flex items-center gap-3 px-4 py-3 bg-emerald-500/10 border border-emerald-500/20 rounded-xl">
                      <span className="text-emerald-400 text-sm font-semibold">{lastSaved.message}</span>
                      <button onClick={() => handleTabChange(lastSaved.nextTab)} className="ml-auto px-3 py-1.5 bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-bold rounded-lg transition-colors">{lastSaved.cta}</button>
                      <button onClick={() => setLastSaved(null)} className="text-slate-500 hover:text-slate-300 text-sm leading-none">✕</button>
                    </div>
                  )}
                  {/* PDF Upload Banner */}
                  <div className="mb-6 bg-gradient-to-br from-blue-900/40 via-slate-900/40 to-indigo-900/40 backdrop-blur-sm border border-blue-500/30 rounded-2xl p-5 md:p-6 shadow-2xl ring-1 ring-white/5 relative overflow-hidden">
                    <div className="absolute top-0 right-0 w-64 h-64 bg-blue-500/10 rounded-full blur-3xl -mr-20 -mt-20 pointer-events-none"></div>
                    <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 relative z-10">
                      <div className="flex items-start sm:items-center gap-4">
                        <div className="p-2.5 bg-blue-500/20 rounded-xl border border-blue-500/30 shadow-inner flex-shrink-0">
                          <span className="text-2xl block leading-none">📄</span>
                        </div>
                        <div>
                          <h3 className="text-base font-bold text-white mb-0.5 tracking-tight">Upload Quote/PI PDF</h3>
                          <p className="text-xs text-blue-200/80 font-medium">AI extracts supplier info, quote details, and line items automatically.</p>
                          {pdfData && (
                            <div className="mt-2 inline-flex items-center gap-2 bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 px-3 py-1 rounded-lg text-xs font-bold">
                              <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" /></svg>
                              Extracted {pdfData.line_items?.length || 0} items from {pdfData.supplier_name || 'PDF'}
                            </div>
                          )}
                        </div>
                      </div>
                      <div className="flex gap-2 w-full sm:w-auto">
                        {pdfData && (
                          <button onClick={() => setPdfData(null)} className="px-4 py-2 bg-slate-800/80 hover:bg-slate-700 border border-slate-600/50 text-white rounded-xl text-xs font-bold transition-all w-full sm:w-auto">
                            Clear
                          </button>
                        )}
                        <label className="cursor-pointer w-full sm:w-auto">
                          <input type="file" accept="application/pdf" onChange={handlePdfUpload} disabled={pdfUploading} className="hidden" />
                          <span className={`flex items-center justify-center gap-2 bg-blue-600 hover:bg-blue-500 text-white px-5 py-2 rounded-xl text-xs font-bold shadow-lg shadow-blue-900/20 transition-all active:scale-[0.98] w-full sm:w-auto border border-blue-500 ${pdfUploading ? 'opacity-70 cursor-not-allowed' : ''}`}>
                            {pdfUploading ? <><span className="animate-spin text-base leading-none">⏳</span> Extracting...</> : <><span className="text-base leading-none">📤</span> Upload PDF</>}
                          </span>
                        </label>
                      </div>
                    </div>
                  </div>
                  <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 md:gap-6 items-start">
                    <SimpleForm
                      title="Step 1: Quote Header"
                      fields={[
                        { name: 'supplier_id', label: 'Supplier', type: 'rich-select', options: data.suppliers, config: { labelKey: 'supplier_name', valueKey: 'supplier_id', subLabelKey: 'location' }, req: true, default: pdfDefaults.supplier_id },
                        { name: 'company_id', label: 'Addressed To', type: 'select', options: options.companies, req: true, default: pdfDefaults.company_id },
                        { name: 'quote_date', label: 'Date', type: 'date', req: true, default: pdfData?.quote_date || pdfData?.pi_date || new Date().toISOString().split('T')[0] },
                        { name: 'pi_number', label: 'Quote Ref', type: 'text', suggestions: suggestions.quoteNumbers, default: pdfData?.quote_number || pdfData?.pi_number },
                        { name: 'currency', label: 'Currency', type: 'select', options: ENUMS.currency, req: true, default: pdfData?.currency },
                        { name: 'total_value', label: 'Total Value', type: 'number', default: pdfData?.total_value },
                        { name: 'status', label: 'Status', type: 'select', options: ENUMS.price_quotes_status, default: 'Open' },
                        { name: 'estimated_lead_time_days', label: 'Lead Time', type: 'select', options: ENUMS.lead_time, default: pdfData?.lead_time_days },
                        { name: 'replaces_quote_id', label: 'Replaces', type: 'select', options: options.quotes },
                      ]}
                      onSubmit={(d) => handleInsert('4.0_price_quotes', d)}
                      loading={loading}
                    />
                    <BatchLineItemsForm
                      title="Step 2: Quote Items"
                      enablePdfUpload={true}
                      parentField={{ name: 'quote_id', label: 'Select Quote', options: options.quotes }}
                      itemFields={[
                        { name: 'component_id', label: 'Component', type: 'rich-select', options: data.components, config: { labelKey: 'supplier_model', valueKey: 'component_id', subLabelKey: 'internal_description' }, req: true },
                        { name: 'supplier_description', label: 'Supplier Desc', type: 'text' },
                        { name: 'quantity', label: 'Qty', type: 'number', req: true },
                        { name: 'unit_price', label: 'Price', type: 'number', req: true },
                        { name: 'currency', label: 'Curr', type: 'select', options: ENUMS.currency, req: true },
                      ]}
                      stickyFields={['currency']}
                      onSubmit={(items) => handleInsert('4.1_price_quote_line_items', items)}
                      loading={loading}
                    />
                  </div>
                </>
              )}

              {/* Ordering Tab */}
              {activeTab === 'ordering' && (
                <>
                  {/* What's next banner */}
                  {lastSaved && (
                    <div className="mb-4 flex items-center gap-3 px-4 py-3 bg-emerald-500/10 border border-emerald-500/20 rounded-xl">
                      <span className="text-emerald-400 text-sm font-semibold">{lastSaved.message}</span>
                      <button onClick={() => handleTabChange(lastSaved.nextTab)} className="ml-auto px-3 py-1.5 bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-bold rounded-lg transition-colors">{lastSaved.cta}</button>
                      <button onClick={() => setLastSaved(null)} className="text-slate-500 hover:text-slate-300 text-sm leading-none">✕</button>
                    </div>
                  )}
                  {/* PDF Upload Banner */}
                  <div className="mb-6 bg-gradient-to-br from-blue-900/40 via-slate-900/40 to-indigo-900/40 backdrop-blur-sm border border-blue-500/30 rounded-2xl p-5 md:p-6 shadow-2xl ring-1 ring-white/5 relative overflow-hidden">
                    <div className="absolute top-0 right-0 w-64 h-64 bg-blue-500/10 rounded-full blur-3xl -mr-20 -mt-20 pointer-events-none"></div>
                    <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 relative z-10">
                      <div className="flex items-start sm:items-center gap-4">
                        <div className="p-2.5 bg-blue-500/20 rounded-xl border border-blue-500/30 shadow-inner flex-shrink-0">
                          <span className="text-2xl block leading-none">📄</span>
                        </div>
                        <div>
                          <h3 className="text-base font-bold text-white mb-0.5 tracking-tight">Upload PI/PO PDF</h3>
                          <p className="text-xs text-blue-200/80 font-medium">AI extracts PI details, PO information, and all line items automatically.</p>
                          {pdfData && (
                            <div className="mt-2 inline-flex items-center gap-2 bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 px-3 py-1 rounded-lg text-xs font-bold">
                              <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" /></svg>
                              Extracted {pdfData.line_items?.length || 0} items from PDF
                            </div>
                          )}
                        </div>
                      </div>
                      <div className="flex gap-2 w-full sm:w-auto">
                        {pdfData && (
                          <button onClick={() => setPdfData(null)} className="px-4 py-2 bg-slate-800/80 hover:bg-slate-700 border border-slate-600/50 text-white rounded-xl text-xs font-bold transition-all w-full sm:w-auto">
                            Clear
                          </button>
                        )}
                        <label className="cursor-pointer w-full sm:w-auto">
                          <input type="file" accept="application/pdf" onChange={handlePdfUpload} disabled={pdfUploading} className="hidden" />
                          <span className={`flex items-center justify-center gap-2 bg-blue-600 hover:bg-blue-500 text-white px-5 py-2 rounded-xl text-xs font-bold shadow-lg shadow-blue-900/20 transition-all active:scale-[0.98] w-full sm:w-auto border border-blue-500 ${pdfUploading ? 'opacity-70 cursor-not-allowed' : ''}`}>
                            {pdfUploading ? <><span className="animate-spin text-base leading-none">⏳</span> Extracting...</> : <><span className="text-base leading-none">📤</span> Upload PDF</>}
                          </span>
                        </label>
                      </div>
                    </div>
                  </div>
                  {dupWarning && (
                    <div className="mb-4 flex items-start gap-3 px-4 py-3 bg-amber-500/10 border border-amber-500/30 rounded-xl">
                      <span className="text-amber-400 text-sm flex-shrink-0 mt-0.5">⚠️</span>
                      <span className="text-amber-300 text-xs leading-relaxed">{dupWarning.replace('⚠️ ', '')}</span>
                      <button onClick={() => setDupWarning(null)} className="ml-auto text-slate-500 hover:text-slate-300 text-sm leading-none flex-shrink-0">✕</button>
                    </div>
                  )}
                  <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 md:gap-6 items-start">
                    <SimpleForm
                      title="1. Purchase Order (with PI fields)"
                      onFieldChange={(name, value) => {
                        const overrides: Record<string, any> = {};
                        if (name === 'quote_id') {
                          if (value) {
                            const q = data.quotes.find((q) => String(q.quote_id) === String(value));
                            if (q) {
                              overrides.pi_number = q.pi_number || '';
                              overrides.pi_date   = q.quote_date || '';
                              // Exchange rate memory: find most recent PO for same supplier with same currency
                              if (q.currency && q.currency !== 'IDR') {
                                const sameCurrencyPOs = data.pos
                                  .filter((p) => {
                                    const pq = p.quote_id ? data.quotes.find((pqq) => String(pqq.quote_id) === String(p.quote_id)) : null;
                                    return pq?.supplier_id === q.supplier_id && p.currency === q.currency && p.exchange_rate;
                                  })
                                  .sort((a, b) => b.po_date.localeCompare(a.po_date));
                                if (sameCurrencyPOs[0]?.exchange_rate) {
                                  overrides.exchange_rate = sameCurrencyPOs[0].exchange_rate;
                                }
                              }
                            }
                            // Duplicate detection: quote already linked to a PO?
                            const existingPO = data.pos.find((p) => p.quote_id && String(p.quote_id) === String(value));
                            setDupWarning(existingPO
                              ? `⚠️ This quote is already linked to PO ${existingPO.po_number}${existingPO.pi_number ? ` / ${existingPO.pi_number}` : ''} (${existingPO.po_date}). Creating another PO may be a duplicate.`
                              : null);
                          } else {
                            setDupWarning(null);
                          }
                        }
                        if (name === 'pi_number' && value) {
                          const existingPO = data.pos.find((p) => p.pi_number && p.pi_number.toLowerCase() === String(value).toLowerCase());
                          if (existingPO) {
                            setDupWarning(`⚠️ PI# "${value}" is already recorded on PO ${existingPO.po_number} (${existingPO.po_date}). Check before saving.`);
                          }
                        }
                        return overrides;
                      }}
                      fields={[
                        { name: 'quote_id', label: 'Link Quote', type: 'select', options: options.quotes },
                        { name: 'pi_number', label: 'PI #', type: 'text', default: pdfData?.pi_number },
                        { name: 'pi_date', label: 'PI Date', type: 'date', default: pdfData?.pi_date },
                        { name: 'pi_status', label: 'PI Status', type: 'select', options: ENUMS.proforma_status },
                        { name: 'po_number', label: 'PO #', type: 'text', req: true, suggestions: suggestions.poNumbers, default: pdfData?.po_number },
                        { name: 'po_date', label: 'PO Date', type: 'date', req: true, default: pdfData?.po_date || new Date().toISOString().split('T')[0] },
                        { name: 'incoterms', label: 'Incoterms', type: 'text', suggestions: ['FOB', 'EXW', 'CIF', 'DDP', ...suggestions.incoterms] },
                        { name: 'method_of_shipment', label: 'Ship Via', type: 'select', options: ENUMS.method_of_shipment },
                        { name: 'currency', label: 'Currency', type: 'select', options: ENUMS.currency, req: true, default: pdfData?.currency },
                        { name: 'exchange_rate', label: 'Exch Rate', type: 'number' },
                        { name: 'total_value', label: 'Total Value', type: 'number', default: pdfData?.total_value },
                        { name: 'payment_terms', label: 'Terms', type: 'text', suggestions: suggestions.paymentTerms, default: pdfData?.payment_terms },
                        { name: 'freight_charges_intl', label: 'Freight', type: 'number' },
                        { name: 'estimated_delivery_date', label: 'Est. Deliv', type: 'date' },
                        { name: 'actual_delivery_date', label: 'Act. Deliv', type: 'date' },
                        { name: 'actual_received_date', label: 'Received', type: 'date' },
                        { name: 'status', label: 'Status', type: 'select', options: ENUMS.purchases_status, default: 'Draft' },
                        { name: 'replaces_po_id', label: 'Replaces PO', type: 'select', options: options.pos },
                      ]}
                      onSubmit={(d) => handleInsert('5.0_purchases', d)}
                      loading={loading}
                    />
                    {(() => {
                      const selPo   = orderingPoId ? data.pos.find((p) => String(p.po_id) === orderingPoId) : null;
                      const selCosts = orderingPoId ? data.poCosts.filter((c) => String(c.po_id) === orderingPoId) : [];
                      const PRIN     = new Set(['down_payment','balance_payment','additional_balance_payment']);
                      const totIdr   = selPo ? (selPo.currency === 'IDR' ? Number(selPo.total_value) : Number(selPo.total_value) * (Number(selPo.exchange_rate) || 1)) : 0;
                      const paidIdr2 = selCosts.filter((c) => PRIN.has(c.cost_category)).reduce((s, c) => s + (c.currency === 'IDR' ? Number(c.amount) : Number(c.amount) * (Number(selPo?.exchange_rate) || 1)), 0);
                      const outIdr2  = Math.max(0, totIdr - paidIdr2);
                      const pct2     = totIdr > 0 ? Math.min(100, (paidIdr2 / totIdr) * 100) : 0;
                      const fmt2     = (n: number) => 'IDR ' + Math.round(n).toLocaleString('en-US');
                      return (<>
                        <BatchLineItemsForm
                          title="2. PO Items"
                          enablePdfUpload={true}
                          enableQuoteImport={true}
                          parentField={{ name: 'po_id', label: 'Select PO', options: options.pos }}
                          onParentChange={(id) => setOrderingPoId(id)}
                          itemFields={[
                            { name: 'component_id', label: 'Component', type: 'rich-select', options: data.components, config: { labelKey: 'supplier_model', valueKey: 'component_id', subLabelKey: 'internal_description' }, req: true },
                            { name: 'supplier_description', label: 'Supplier Desc', type: 'text' },
                            { name: 'quantity', label: 'Qty', type: 'number', req: true },
                            { name: 'unit_cost', label: 'Cost', type: 'number', req: true },
                            { name: 'currency', label: 'Curr', type: 'select', options: ENUMS.currency, req: true },
                          ]}
                          stickyFields={['currency']}
                          allQuoteItems={data.quoteItems}
                          allQuotes={data.quotes}
                          allPurchases={data.pos}
                          components={data.components}
                          onSubmit={(items) => handleInsert('5.1_purchase_line_items', items)}
                          loading={loading}
                        />
                        {selPo && totIdr > 0 && (
                          <div className="bg-slate-900/40 border border-slate-800/80 rounded-2xl ring-1 ring-white/5 p-4 mt-1">
                            <p className="text-[11px] font-bold uppercase tracking-wider text-slate-500 mb-2">Payment Status — {selPo.po_number}</p>
                            <div className="flex items-center gap-3 mb-2">
                              <div className="flex-1 h-2 bg-slate-800 rounded-full overflow-hidden">
                                <div className={`h-full rounded-full transition-all ${pct2 >= 100 ? 'bg-emerald-500' : 'bg-amber-400'}`} style={{ width: `${pct2}%` }} />
                              </div>
                              <span className={`text-xs font-bold flex-shrink-0 ${pct2 >= 100 ? 'text-emerald-400' : 'text-amber-300'}`}>{pct2.toFixed(1)}%</span>
                            </div>
                            <div className="grid grid-cols-3 gap-2 text-xs">
                              <div className="bg-slate-800/40 rounded-lg p-2.5">
                                <p className="text-[10px] text-slate-500 mb-0.5">PO Total</p>
                                <p className="font-bold text-white">{fmt2(totIdr)}</p>
                              </div>
                              <div className="bg-emerald-500/10 border border-emerald-500/20 rounded-lg p-2.5">
                                <p className="text-[10px] text-slate-500 mb-0.5">Paid</p>
                                <p className="font-bold text-emerald-300">{fmt2(paidIdr2)}</p>
                              </div>
                              <div className={`rounded-lg p-2.5 ${outIdr2 > 0 ? 'bg-amber-500/10 border border-amber-500/20' : 'bg-slate-800/40'}`}>
                                <p className="text-[10px] text-slate-500 mb-0.5">Outstanding</p>
                                <p className={`font-bold ${outIdr2 > 0 ? 'text-amber-300' : 'text-slate-400'}`}>{fmt2(outIdr2)}</p>
                              </div>
                            </div>
                          </div>
                        )}
                      </>);
                    })()}
                  </div>
                </>
              )}

              {/* Financials Tab */}
              {activeTab === 'financials' && (
                <div className="max-w-4xl">
                  {/* Single / Batch toggle */}
                  <div className="flex items-center gap-3 mb-6">
                    <div className="flex rounded-xl overflow-hidden border border-slate-700 text-xs font-semibold">
                      <button
                        onClick={() => setPaymentMode('single')}
                        className={`px-4 py-2 transition-colors ${paymentMode === 'single' ? 'bg-rose-500/20 text-rose-300' : 'bg-slate-800/60 text-slate-400 hover:text-slate-300'}`}
                      >Single PO</button>
                      <button
                        onClick={() => setPaymentMode('batch')}
                        className={`px-4 py-2 transition-colors ${paymentMode === 'batch' ? 'bg-rose-500/20 text-rose-300' : 'bg-slate-800/60 text-slate-400 hover:text-slate-300'}`}
                      >Multi-PO Batch</button>
                    </div>
                    <p className="text-xs text-slate-500">
                      {paymentMode === 'batch'
                        ? 'One bank transfer covering multiple POs — amounts split proportionally.'
                        : 'Log payments, bank fees, or landed costs for a single PO.'}
                    </p>
                  </div>

                  {paymentMode === 'single' && (() => {
                    const selPo = singlePoId ? data.pos.find((p) => String(p.po_id) === singlePoId) : null;
                    const selCosts = singlePoId ? data.poCosts.filter((c) => String(c.po_id) === singlePoId) : [];
                    const PRIN = new Set(['down_payment','balance_payment','additional_balance_payment']);
                    const totalIdr = selPo ? (selPo.currency === 'IDR' ? Number(selPo.total_value) : Number(selPo.total_value) * (Number(selPo.exchange_rate) || 1)) : 0;
                    const paidIdr  = selCosts.filter((c) => PRIN.has(c.cost_category)).reduce((s, c) => s + (c.currency === 'IDR' ? Number(c.amount) : Number(c.amount) * (Number(selPo?.exchange_rate) || 1)), 0);
                    const outIdr   = Math.max(0, totalIdr - paidIdr);
                    const pct      = totalIdr > 0 ? Math.min(100, (paidIdr / totalIdr) * 100) : 0;
                    const fmt      = (n: number) => 'IDR ' + Math.round(n).toLocaleString('en-US');
                    return (<>
                    <BatchLineItemsForm
                      title="PO Costs (Payments, Bank Fees & Landed Costs)"
                      onParentChange={(id) => setSinglePoId(id)}
                      parentField={{ name: 'po_id', label: 'Select PO', options: options.pos }}
                      itemFields={[
                        { name: 'cost_category', label: 'Cost Category', type: 'select', options: ENUMS.po_cost_category, req: true },
                        { name: 'amount', label: 'Amount', type: 'number', req: true },
                        { name: 'currency', label: 'Currency', type: 'select', options: ENUMS.currency, req: true },
                        { name: 'payment_date', label: 'Date', type: 'date' },
                        { name: 'notes', label: 'Notes', type: 'text' },
                      ]}
                      stickyFields={['currency', 'payment_date']}
                      onSubmit={(items) => handleInsert('6.0_po_costs', items)}
                      loading={loading}
                    />
                    {selPo && totalIdr > 0 && (
                      <div className="bg-slate-900/40 border border-slate-800/80 rounded-2xl ring-1 ring-white/5 p-4 mt-1">
                        <p className="text-[11px] font-bold uppercase tracking-wider text-slate-500 mb-2">Payment Status — {selPo.po_number}</p>
                        <div className="flex items-center gap-3 mb-2">
                          <div className="flex-1 h-2 bg-slate-800 rounded-full overflow-hidden">
                            <div className={`h-full rounded-full transition-all ${pct >= 100 ? 'bg-emerald-500' : 'bg-amber-400'}`} style={{ width: `${pct}%` }} />
                          </div>
                          <span className={`text-xs font-bold flex-shrink-0 ${pct >= 100 ? 'text-emerald-400' : 'text-amber-300'}`}>{pct.toFixed(1)}%</span>
                        </div>
                        <div className="grid grid-cols-3 gap-2 text-xs">
                          <div className="bg-slate-800/40 rounded-lg p-2.5">
                            <p className="text-[10px] text-slate-500 mb-0.5">PO Total</p>
                            <p className="font-bold text-white">{fmt(totalIdr)}</p>
                          </div>
                          <div className="bg-emerald-500/10 border border-emerald-500/20 rounded-lg p-2.5">
                            <p className="text-[10px] text-slate-500 mb-0.5">Paid</p>
                            <p className="font-bold text-emerald-300">{fmt(paidIdr)}</p>
                          </div>
                          <div className={`rounded-lg p-2.5 ${outIdr > 0 ? 'bg-amber-500/10 border border-amber-500/20' : 'bg-slate-800/40'}`}>
                            <p className="text-[10px] text-slate-500 mb-0.5">Outstanding</p>
                            <p className={`font-bold ${outIdr > 0 ? 'text-amber-300' : 'text-slate-400'}`}>{fmt(outIdr)}</p>
                          </div>
                        </div>
                      </div>
                    )}
                    </>);
                  })()}

                  {paymentMode === 'batch' && (
                    <MultiPaymentForm
                      pos={data.pos}
                      suppliers={data.suppliers}
                      quotes={data.quotes}
                      poCosts={data.poCosts}
                      onSuccess={() => { showToast('✅ Batch payment saved!', 'success'); refetch(); }}
                      onError={(msg) => showToast(`Error: ${msg}`, 'error')}
                    />
                  )}
                </div>
              )}

              {/* Market Intel Tab */}
              {activeTab === 'market-intel' && (
                <CompetitorPriceForm
                  components={data.components}
                  poItems={data.poItems}
                  pos={data.pos}
                  quoteItems={data.quoteItems}
                  quotes={data.quotes}
                  competitorPrices={data.competitorPrices}
                  onSubmit={(d) => handleInsert('7.0_competitor_prices', d)}
                  loading={loading}
                />
              )}

              {/* Lookup Tab */}
              {activeTab === 'lookup' && (
                <POLookupTab
                  pos={data.pos}
                  poItems={data.poItems}
                  poCosts={data.poCosts}
                  suppliers={data.suppliers}
                  quotes={data.quotes}
                  components={data.components}
                  onStatusChange={handleStatusChange}
                />
              )}
            </>
          )}
        </div>
      </main>
      <ToastContainer />
    </div>
  );
}

export default function Page() {
  return (
    <ToastProvider>
      <Suspense fallback={null}>
        <MasterInsertPage />
      </Suspense>
    </ToastProvider>
  );
}
