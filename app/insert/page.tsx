/**
 * Supply Chain Data Entry - Refactored Main Page
 * Clean, modular, and mobile-optimized
 * Database view moved to /database route
 */
'use client';
import { useState, useMemo } from 'react';
import { createSupabaseClient } from '@/lib/supabase';
// Components
import Sidebar from '@/components/layout/Sidebar';
import MobileNav from '@/components/layout/MobileNav';
import SimpleForm from '@/components/forms/SimpleForm';
import BatchLineItemsForm from '@/components/forms/BatchLineItemsForm';
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
// Menu configuration (removed database tab and history import)
const MENU_ITEMS: MenuItem[] = [
  { id: 'foundation', label: 'Suppliers & Components', icon: '🏢' },
  { id: 'quoting', label: 'Quotes', icon: '📝' },
  { id: 'ordering', label: 'PI / PO', icon: '📦' },
  { id: 'financials', label: 'Financials', icon: '💰' },
];
function MasterInsertPage() {
  const supabase = createSupabaseClient();
  const [activeTab, setActiveTab] = useState<Tab>('foundation');
  const [loading, setLoading] = useState(false);
  // PDF pre-fill state
  const [pdfData, setPdfData] = useState<any>(null);
  const [pdfUploading, setPdfUploading] = useState(false);
  // Data & Suggestions
  const { data, loading: dataLoading, refetch } = useSupabaseData();
  const suggestions = useSuggestions(data);
  const { showToast } = useToast();
  // Memoized options for selects
  const options = useMemo(
    () => ({
      companies: data.companies.map((c) => ({ val: c.company_id, txt: c.legal_name })),
      quotes: data.quotes.map((q) => ({
        val: q.quote_id,
        txt: `${q.pi_number || 'No Ref'} | ${q.currency} ${q.total_value}`,
      })),
      pis: data.pis.map((p) => ({ val: p.pi_id, txt: `${p.pi_number} (${p.pi_date})` })),
      pos: data.pos.map((p) => ({ val: p.po_id, txt: `${p.po_number} - ${p.po_date}${p.pi_number ? ` | PI: ${p.pi_number}` : ''}` })),
    }),
    [data]
  );
  // Auto-match supplier and company from PDF data
  const pdfDefaults = useMemo(() => {
    if (!pdfData) return {};
    const defaults: any = {};
    // Match supplier by name
    if (pdfData.supplier_name && data.suppliers.length > 0) {
      const supplierName = pdfData.supplier_name.toLowerCase().trim();
      const matchedSupplier = data.suppliers.find((s: any) =>
        s.supplier_name?.toLowerCase().trim() === supplierName ||
        s.supplier_name?.toLowerCase().includes(supplierName) ||
        supplierName.includes(s.supplier_name?.toLowerCase())
      );
      if (matchedSupplier) {
        defaults.supplier_id = matchedSupplier.supplier_id;
      }
    }
    // Match company by name
    if (pdfData.company_name && data.companies.length > 0) {
      const companyName = pdfData.company_name.toLowerCase().trim();
      const matchedCompany = data.companies.find((c: any) =>
        c.legal_name?.toLowerCase().trim() === companyName ||
        c.legal_name?.toLowerCase().includes(companyName) ||
        companyName.includes(c.legal_name?.toLowerCase())
      );
      if (matchedCompany) {
        defaults.company_id = matchedCompany.company_id;
      }
    }
    return defaults;
  }, [pdfData, data.suppliers, data.companies]);
  // Insert handler
  const handleInsert = async (table: string, insertData: any) => {
    setLoading(true);
    const payload = Array.isArray(insertData) ? insertData : [insertData];
    const cleanPayload = payload.map((item) =>
      Object.fromEntries(
        Object.entries(item).map(([k, v]) => {
          if (v === '') return [k, null];
          if (k === 'specifications' && typeof v === 'string') {
            try {
              return [k, JSON.parse(v)];
            } catch {
              return [k, v];
            }
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
    }
  };
  // PDF upload handler
  const handlePdfUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || file.type !== 'application/pdf') {
      showToast('Please select a PDF file', 'error');
      return;
    }
    setPdfUploading(true);
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
      setPdfData(extractedData);
      // Build success message with auto-match info
      let message = `✅ Extracted ${extractedData.line_items?.length || 0} items from PDF!`;
      if (extractedData.supplier_name) {
        message += `\n📦 Supplier: ${extractedData.supplier_name}`;
      }
      if (extractedData.company_name) {
        message += `\n🏢 Addressed to: ${extractedData.company_name}`;
      }
      showToast(message, 'success');
      // Reset file input
      e.target.value = '';
    } catch (error) {
      showToast('Failed to extract PDF data', 'error');
      console.error(error);
    } finally {
      setPdfUploading(false);
    }
  };
  return (
    <div className="flex flex-col md:flex-row min-h-screen bg-[#0B1120] text-slate-200 font-sans text-sm selection:bg-emerald-500/30">
      {/* Mobile Navigation */}
      <MobileNav activeTab={activeTab} onTabChange={setActiveTab} menuItems={MENU_ITEMS} />
      {/* Desktop Sidebar */}
      <Sidebar activeTab={activeTab} onTabChange={setActiveTab} menuItems={MENU_ITEMS} />
      {/* Main Content */}
      <main className="flex-1 md:ml-64 p-4 md:p-8 min-h-screen overflow-x-hidden">
        <div className="max-w-[1600px] mx-auto pb-24 md:pb-0 animate-in fade-in duration-300">
          {/* Page Header (Desktop) */}
          <div className="hidden md:flex mb-8 justify-between items-center h-10">
            <h2 className="text-2xl font-extrabold text-white tracking-tight border-l-4 border-emerald-500 pl-4">
              {MENU_ITEMS.find((m) => m.id === activeTab)?.label}
            </h2>
          </div>
          {/* Tab Content */}
          {dataLoading ? (
            <div className="grid grid-cols-1 xl:grid-cols-2 gap-6 md:gap-8">
              <FormSkeleton />
              <FormSkeleton />
            </div>
          ) : (
            <>
              {/* Foundation Tab */}
              {activeTab === 'foundation' && (
                <div className="grid grid-cols-1 xl:grid-cols-2 gap-6 md:gap-8">
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
                  <SimpleForm
                    title="Add New Component"
                    fields={[
                      { name: 'supplier_model', label: 'Supplier Model / SKU', type: 'text', req: true, suggestions: suggestions.modelSkus },
                      { name: 'internal_description', label: 'Internal Description', type: 'text', req: true, suggestions: suggestions.descriptions },
                      { name: 'brand', label: 'Brand', type: 'text', suggestions: suggestions.brands },
                      { name: 'category', label: 'Category', type: 'select', options: ENUMS.product_category },
                      { name: 'specifications', label: 'Specs (JSON)', type: 'textarea', placeholder: '{"watts": 100}' },
                    ]}
                    onSubmit={(d) => handleInsert('3.0_components', d)}
                    loading={loading}
                  />
                </div>
              )}
              {/* Quoting Tab */}
              {activeTab === 'quoting' && (
                <>
                  {/* PDF Upload Banner */}
                  <div className="mb-8 bg-gradient-to-br from-blue-900/40 via-slate-900/40 to-indigo-900/40 backdrop-blur-sm border border-blue-500/30 rounded-2xl p-6 md:p-8 shadow-2xl ring-1 ring-white/5 relative overflow-hidden">
                    <div className="absolute top-0 right-0 w-64 h-64 bg-blue-500/10 rounded-full blur-3xl -mr-20 -mt-20 pointer-events-none"></div>
                    <div className="flex flex-col md:flex-row items-start md:items-center justify-between gap-6 relative z-10">
                      <div className="flex items-start md:items-center gap-5">
                        <div className="p-3 bg-blue-500/20 rounded-xl border border-blue-500/30 shadow-inner">
                          <span className="text-3xl block leading-none">📄</span>
                        </div>
                        <div>
                          <h3 className="text-xl font-bold text-white mb-1 tracking-tight">Upload Quote/PI PDF</h3>
                          <p className="text-sm text-blue-200/80 font-medium">AI will extract supplier info, quote details, and all line items automatically.</p>
                          {pdfData && (
                            <div className="mt-3 inline-flex items-center gap-2 bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 px-3 py-1.5 rounded-lg text-xs font-bold">
                              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" /></svg>
                              Extracted {pdfData.line_items?.length || 0} items from {pdfData.supplier_name || 'PDF'}
                            </div>
                          )}
                        </div>
                      </div>
                      <div className="flex gap-3 w-full md:w-auto">
                        {pdfData && (
                          <button
                            onClick={() => setPdfData(null)}
                            className="px-5 py-2.5 bg-slate-800/80 hover:bg-slate-700 border border-slate-600/50 text-white rounded-xl text-sm font-bold transition-all w-full md:w-auto"
                          >
                            Clear
                          </button>
                        )}
                        <label className="cursor-pointer w-full md:w-auto">
                          <input
                            type="file"
                            accept="application/pdf"
                            onChange={handlePdfUpload}
                            disabled={pdfUploading}
                            className="hidden"
                          />
                          <span className={`flex items-center justify-center gap-2 bg-blue-600 hover:bg-blue-500 text-white px-6 py-2.5 rounded-xl text-sm font-bold shadow-lg shadow-blue-900/20 transition-all active:scale-[0.98] w-full md:w-auto border border-blue-500 ${pdfUploading ? 'opacity-70 cursor-not-allowed' : ''}`}>
                            {pdfUploading ? (
                              <><span className="animate-spin text-lg leading-none">⏳</span> Extracting...</>
                            ) : (
                              <><span className="text-lg leading-none">📤</span> Upload PDF</>
                            )}
                          </span>
                        </label>
                      </div>
                    </div>
                  </div>
                  <div className="grid grid-cols-1 xl:grid-cols-2 gap-6 md:gap-8 items-start">
                  <SimpleForm
                    title="Step 1: Quote Header"
                    fields={[
                      { name: 'supplier_id', label: 'Supplier', type: 'rich-select', options: data.suppliers, config: { labelKey: 'supplier_name', valueKey: 'supplier_id', subLabelKey: 'location' }, req: true, default: pdfDefaults.supplier_id },
                      { name: 'company_id', label: 'Addressed To', type: 'select', options: options.companies, req: true, default: pdfDefaults.company_id },
                      { name: 'quote_date', label: 'Date', type: 'date', req: true, default: pdfData?.quote_date || pdfData?.pi_date || new Date().toISOString().split('T')[0] },
                      { name: 'pi_number', label: 'Quote Ref', type: 'text', suggestions: suggestions.quoteNumbers, default: pdfData?.quote_number || pdfData?.pi_number },
                      { name: 'currency', label: 'Currency', type: 'select', options: ENUMS.currency, req: true, default: pdfData?.currency },
                      { name: 'total_value', label: 'Total Value', type: 'number', req: true, default: pdfData?.total_value },
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
                  {/* PDF Upload Banner */}
                  <div className="mb-8 bg-gradient-to-br from-blue-900/40 via-slate-900/40 to-indigo-900/40 backdrop-blur-sm border border-blue-500/30 rounded-2xl p-6 md:p-8 shadow-2xl ring-1 ring-white/5 relative overflow-hidden">
                    <div className="absolute top-0 right-0 w-64 h-64 bg-blue-500/10 rounded-full blur-3xl -mr-20 -mt-20 pointer-events-none"></div>
                    <div className="flex flex-col md:flex-row items-start md:items-center justify-between gap-6 relative z-10">
                      <div className="flex items-start md:items-center gap-5">
                        <div className="p-3 bg-blue-500/20 rounded-xl border border-blue-500/30 shadow-inner">
                          <span className="text-3xl block leading-none">📄</span>
                        </div>
                        <div>
                          <h3 className="text-xl font-bold text-white mb-1 tracking-tight">Upload PI/PO PDF</h3>
                          <p className="text-sm text-blue-200/80 font-medium">AI will extract PI details, PO information, and all line items automatically.</p>
                          {pdfData && (
                            <div className="mt-3 inline-flex items-center gap-2 bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 px-3 py-1.5 rounded-lg text-xs font-bold">
                              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" /></svg>
                              Extracted {pdfData.line_items?.length || 0} items from PDF
                            </div>
                          )}
                        </div>
                      </div>
                      <div className="flex gap-3 w-full md:w-auto">
                        {pdfData && (
                          <button
                            onClick={() => setPdfData(null)}
                            className="px-5 py-2.5 bg-slate-800/80 hover:bg-slate-700 border border-slate-600/50 text-white rounded-xl text-sm font-bold transition-all w-full md:w-auto"
                          >
                            Clear
                          </button>
                        )}
                        <label className="cursor-pointer w-full md:w-auto">
                          <input
                            type="file"
                            accept="application/pdf"
                            onChange={handlePdfUpload}
                            disabled={pdfUploading}
                            className="hidden"
                          />
                          <span className={`flex items-center justify-center gap-2 bg-blue-600 hover:bg-blue-500 text-white px-6 py-2.5 rounded-xl text-sm font-bold shadow-lg shadow-blue-900/20 transition-all active:scale-[0.98] w-full md:w-auto border border-blue-500 ${pdfUploading ? 'opacity-70 cursor-not-allowed' : ''}`}>
                            {pdfUploading ? (
                              <><span className="animate-spin text-lg leading-none">⏳</span> Extracting...</>
                            ) : (
                              <><span className="text-lg leading-none">📤</span> Upload PDF</>
                            )}
                          </span>
                        </label>
                      </div>
                    </div>
                  </div>
                <div className="grid grid-cols-1 xl:grid-cols-2 gap-6 md:gap-8 items-start">
                  <SimpleForm
                    title="1. Purchase Order (with PI fields)"
                    fields={[
                      // PI fields (optional - for POs that have a PI)
                      { name: 'quote_id', label: 'Link Quote', type: 'select', options: options.quotes },
                      { name: 'pi_number', label: 'PI #', type: 'text', default: pdfData?.pi_number },
                      { name: 'pi_date', label: 'PI Date', type: 'date', default: pdfData?.pi_date },
                      { name: 'pi_status', label: 'PI Status', type: 'select', options: ENUMS.proforma_status },
                      // PO fields (required)
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
                  <BatchLineItemsForm
                    title="2. PO Items"
                    enablePdfUpload={true}
                    enableQuoteImport={true}
                    parentField={{ name: 'po_id', label: 'Select PO', options: options.pos }}
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
                </div>
                </>
              )}
              {/* Financials Tab */}
              {activeTab === 'financials' && (
                <div className="max-w-4xl mx-auto">
                  <BatchLineItemsForm
                    title="PO Costs (Payments, Bank Fees & Landed Costs)"
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
                </div>
              )}
            </>
          )}
        </div>
      </main>
      {/* Toast Notifications */}
      <ToastContainer />
    </div>
  );
}
// Wrap with Toast Provider
export default function Page() {
  return (
    <ToastProvider>
      <MasterInsertPage />
    </ToastProvider>
  );
}
