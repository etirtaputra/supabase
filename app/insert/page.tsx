/**
 * Supply Chain Data Entry - Refactored Main Page
 * Clean, modular, and mobile-optimized
 */

'use client';

import { useState, useMemo } from 'react';
import { createSupabaseClient } from '@/lib/supabase';

// Components
import Sidebar from '@/components/layout/Sidebar';
import MobileNav from '@/components/layout/MobileNav';
import SimpleForm from '@/components/forms/SimpleForm';
import BatchLineItemsForm from '@/components/forms/BatchLineItemsForm';
import SearchableTable from '@/components/ui/SearchableTable';
import { ToastContainer } from '@/components/ui/Toast';
import { ToastProvider } from '@/hooks/useToast';
import { FormSkeleton, TableSkeleton } from '@/components/ui/LoadingSkeleton';

// Hooks
import { useSupabaseData } from '@/hooks/useSupabaseData';
import { useSuggestions } from '@/hooks/useSuggestions';
import { useToast } from '@/hooks/useToast';

// Constants & Types
import { ENUMS } from '@/constants/enums';
import type { Tab, MenuItem } from '@/types/forms';

// Menu configuration
const MENU_ITEMS: MenuItem[] = [
  { id: 'foundation', label: 'Suppliers & Components', icon: '🏢' },
  { id: 'quoting', label: 'Quotes', icon: '📝' },
  { id: 'ordering', label: 'PI / PO', icon: '📦' },
  { id: 'financials', label: 'Financials', icon: '💰' },
  { id: 'history', label: 'History Import', icon: '📂' },
  { id: 'database', label: 'Database View', icon: '🔍' },
];

function MasterInsertPage() {
  const supabase = createSupabaseClient();
  const [activeTab, setActiveTab] = useState<Tab>('foundation');
  const [loading, setLoading] = useState(false);

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
      pos: data.pos.map((p) => ({ val: p.po_id, txt: `${p.po_number} - ${p.po_date}` })),
    }),
    [data]
  );

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

  // Helper functions
  const getSupplierName = (id: any) => data.suppliers.find((s) => s.supplier_id === id)?.supplier_name || 'Unknown';
  const getComponentSku = (id: any) => data.components.find((c) => c.component_id === id)?.model_sku || 'Unknown';

  return (
    <div className="flex flex-col md:flex-row min-h-screen bg-slate-950 text-slate-100 font-sans text-sm">
      {/* Mobile Navigation */}
      <MobileNav activeTab={activeTab} onTabChange={setActiveTab} menuItems={MENU_ITEMS} />

      {/* Desktop Sidebar */}
      <Sidebar activeTab={activeTab} onTabChange={setActiveTab} menuItems={MENU_ITEMS} />

      {/* Main Content */}
      <main className="flex-1 md:ml-64 p-4 md:p-8 bg-slate-950 min-h-screen overflow-x-hidden">
        <div className="max-w-[1600px] mx-auto pb-20 md:pb-0">
          {/* Page Header (Desktop) */}
          <div className="hidden md:flex mb-8 justify-between items-center h-10">
            <h2 className="text-2xl font-bold text-white tracking-tight border-l-4 border-emerald-500 pl-4">
              {MENU_ITEMS.find((m) => m.id === activeTab)?.label}
            </h2>
          </div>

          {/* Tab Content */}
          {dataLoading ? (
            <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
              <FormSkeleton />
              <FormSkeleton />
            </div>
          ) : (
            <>
              {/* Foundation Tab */}
              {activeTab === 'foundation' && (
                <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
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
                      { name: 'model_sku', label: 'Model / SKU', type: 'text', req: true, suggestions: suggestions.modelSkus },
                      { name: 'description', label: 'Description', type: 'text', req: true, suggestions: suggestions.descriptions },
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
                <div className="grid grid-cols-1 xl:grid-cols-2 gap-6 items-start">
                  <SimpleForm
                    title="Step 1: Quote Header"
                    fields={[
                      { name: 'supplier_id', label: 'Supplier', type: 'rich-select', options: data.suppliers, config: { labelKey: 'supplier_name', valueKey: 'supplier_id', subLabelKey: 'location' }, req: true },
                      { name: 'company_id', label: 'Addressed To', type: 'select', options: options.companies, req: true },
                      { name: 'quote_date', label: 'Date', type: 'date', req: true, default: new Date().toISOString().split('T')[0] },
                      { name: 'pi_number', label: 'Quote Ref', type: 'text' },
                      { name: 'currency', label: 'Currency', type: 'select', options: ENUMS.currency, req: true },
                      { name: 'total_value', label: 'Total Value', type: 'number', req: true },
                      { name: 'status', label: 'Status', type: 'select', options: ENUMS.price_quotes_status, default: 'Open' },
                      { name: 'estimated_lead_time_days', label: 'Lead Time', type: 'select', options: ENUMS.lead_time },
                      { name: 'replaces_quote_id', label: 'Replaces', type: 'select', options: options.quotes },
                    ]}
                    onSubmit={(d) => handleInsert('4.0_price_quotes', d)}
                    loading={loading}
                  />
                  <BatchLineItemsForm
                    title="Step 2: Quote Items"
                    parentField={{ name: 'quote_id', label: 'Select Quote', options: options.quotes }}
                    itemFields={[
                      { name: 'component_id', label: 'Component', type: 'rich-select', options: data.components, config: { labelKey: 'model_sku', valueKey: 'component_id', subLabelKey: 'description' }, req: true },
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
              )}

              {/* Ordering Tab */}
              {activeTab === 'ordering' && (
                <div className="grid grid-cols-1 xl:grid-cols-2 gap-6 items-start">
                  <div className="space-y-6">
                    <SimpleForm
                      title="1. Proforma Invoice"
                      fields={[
                        { name: 'quote_id', label: 'Link Quote', type: 'select', options: options.quotes },
                        { name: 'pi_number', label: 'PI #', type: 'text', req: true },
                        { name: 'pi_date', label: 'PI Date', type: 'date', req: true, default: new Date().toISOString().split('T')[0] },
                        { name: 'status', label: 'Status', type: 'select', options: ENUMS.proforma_status, default: 'Open' },
                        { name: 'replaces_pi_id', label: 'Replaces', type: 'select', options: options.pis },
                      ]}
                      onSubmit={(d) => handleInsert('5.0_proforma_invoices', d)}
                      loading={loading}
                    />
                    <SimpleForm
                      title="2. Purchase Order"
                      fields={[
                        { name: 'pi_id', label: 'Link PI', type: 'select', options: options.pis },
                        { name: 'po_number', label: 'PO #', type: 'text', req: true },
                        { name: 'po_date', label: 'PO Date', type: 'date', req: true, default: new Date().toISOString().split('T')[0] },
                        { name: 'incoterms', label: 'Incoterms', type: 'text', suggestions: ['FOB', 'EXW', 'CIF', 'DDP', ...suggestions.incoterms] },
                        { name: 'method_of_shipment', label: 'Ship Via', type: 'select', options: ENUMS.method_of_shipment },
                        { name: 'currency', label: 'Currency', type: 'select', options: ENUMS.currency, req: true },
                        { name: 'exchange_rate', label: 'Exch Rate', type: 'number' },
                        { name: 'total_value', label: 'Total Value', type: 'number' },
                        { name: 'payment_terms', label: 'Terms', type: 'text', suggestions: suggestions.paymentTerms },
                        { name: 'freight_charges_intl', label: 'Freight', type: 'number' },
                        { name: 'estimated_delivery_date', label: 'Est. Deliv', type: 'date' },
                        { name: 'actual_delivery_date', label: 'Act. Deliv', type: 'date' },
                        { name: 'actual_received_date', label: 'Received', type: 'date' },
                        { name: 'status', label: 'Status', type: 'select', options: ENUMS.purchases_status, default: 'Draft' },
                        { name: 'replaces_po_id', label: 'Replaces', type: 'select', options: options.pos },
                      ]}
                      onSubmit={(d) => handleInsert('6.0_purchases', d)}
                      loading={loading}
                    />
                  </div>
                  <BatchLineItemsForm
                    title="3. PO Items"
                    parentField={{ name: 'po_id', label: 'Select PO', options: options.pos }}
                    itemFields={[
                      { name: 'component_id', label: 'Component', type: 'rich-select', options: data.components, config: { labelKey: 'model_sku', valueKey: 'component_id', subLabelKey: 'description' }, req: true },
                      { name: 'supplier_description', label: 'Supplier Desc', type: 'text' },
                      { name: 'quantity', label: 'Qty', type: 'number', req: true },
                      { name: 'unit_cost', label: 'Cost', type: 'number', req: true },
                      { name: 'currency', label: 'Curr', type: 'select', options: ENUMS.currency, req: true },
                    ]}
                    stickyFields={['currency']}
                    onSubmit={(items) => handleInsert('6.1_purchase_line_items', items)}
                    loading={loading}
                  />
                </div>
              )}

              {/* Financials Tab */}
              {activeTab === 'financials' && (
                <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
                  <SimpleForm
                    title="Payment Record"
                    fields={[
                      { name: 'po_id', label: 'Select PO', type: 'select', options: options.pos, req: true },
                      { name: 'category', label: 'Category', type: 'select', options: ENUMS.payment_category, req: true },
                      { name: 'amount', label: 'Amount', type: 'number', req: true },
                      { name: 'currency', label: 'Currency', type: 'select', options: ENUMS.currency, req: true },
                      { name: 'payment_date', label: 'Date', type: 'date', req: true, default: new Date().toISOString().split('T')[0] },
                      { name: 'notes', label: 'Notes', type: 'textarea' },
                    ]}
                    onSubmit={(d) => handleInsert('7.0_payment_details', d)}
                    loading={loading}
                  />
                  <SimpleForm
                    title="Landed Cost"
                    fields={[
                      { name: 'po_id', label: 'Select PO', type: 'select', options: options.pos, req: true },
                      { name: 'cost_type', label: 'Type', type: 'select', options: ENUMS.landed_costs_type, req: true },
                      { name: 'amount', label: 'Amount', type: 'number', req: true },
                      { name: 'currency', label: 'Currency', type: 'select', options: ENUMS.currency, req: true },
                      { name: 'payment_date', label: 'Date', type: 'date' },
                      { name: 'notes', label: 'Notes', type: 'textarea' },
                    ]}
                    onSubmit={(d) => handleInsert('7.1_landed_costs', d)}
                    loading={loading}
                  />
                </div>
              )}

              {/* History Import Tab */}
              {activeTab === 'history' && (
                <div className="flex flex-col gap-8">
                  <BatchLineItemsForm
                    title="Add Purchase History (Batch)"
                    formId="purchase_hist"
                    itemFields={[
                      { name: 'po_date', label: 'PO Date', type: 'date' },
                      { name: 'po_number', label: 'PO Number', type: 'text', suggestions: suggestions.poNumbers },
                      { name: 'supplier_id', label: 'Supplier', type: 'rich-select', options: data.suppliers, config: { labelKey: 'supplier_name', valueKey: 'supplier_id', subLabelKey: 'location' } },
                      { name: 'currency', label: 'Currency', type: 'select', options: ENUMS.currency },
                      { name: 'component_id', label: 'Component', type: 'rich-select', options: data.components, config: { labelKey: 'model_sku', valueKey: 'component_id', subLabelKey: 'description' } },
                      { name: 'brand', label: 'Brand', type: 'text', suggestions: suggestions.brands },
                      { name: 'description', label: 'Description', type: 'text', suggestions: suggestions.descriptions },
                      { name: 'quantity', label: 'Qty', type: 'number' },
                      { name: 'unit_cost', label: 'Cost', type: 'number' },
                    ]}
                    stickyFields={['po_date', 'po_number', 'supplier_id', 'currency']}
                    onSubmit={(items) => handleInsert('purchase_history', items)}
                    loading={loading}
                  />
                  <BatchLineItemsForm
                    title="Add Quote History (Batch)"
                    formId="quote_hist"
                    itemFields={[
                      { name: 'quote_date', label: 'Quote Date', type: 'date' },
                      { name: 'quote_number', label: 'Quote Ref', type: 'text', suggestions: suggestions.quoteNumbers },
                      { name: 'supplier_id', label: 'Supplier', type: 'rich-select', options: data.suppliers, config: { labelKey: 'supplier_name', valueKey: 'supplier_id', subLabelKey: 'location' } },
                      { name: 'currency', label: 'Currency', type: 'select', options: ENUMS.currency },
                      { name: 'component_id', label: 'Component', type: 'rich-select', options: data.components, config: { labelKey: 'model_sku', valueKey: 'component_id', subLabelKey: 'description' } },
                      { name: 'brand', label: 'Brand', type: 'text', suggestions: suggestions.brands },
                      { name: 'description', label: 'Description', type: 'text', suggestions: suggestions.descriptions },
                      { name: 'quantity', label: 'Qty', type: 'number' },
                      { name: 'unit_cost', label: 'Cost', type: 'number' },
                    ]}
                    stickyFields={['quote_date', 'quote_number', 'supplier_id', 'currency']}
                    onSubmit={(items) => handleInsert('quote_history', items)}
                    loading={loading}
                  />
                </div>
              )}

              {/* Database View Tab */}
              {activeTab === 'database' && (
                <div className="space-y-12 animate-in fade-in slide-in-from-bottom-4 duration-500">
                  <div className="space-y-6">
                    <h2 className="text-xl font-bold text-emerald-400 border-b border-emerald-900/50 pb-2">1. Foundation Data</h2>
                    <div className="grid grid-cols-1 xl:grid-cols-2 gap-8">
                      <SearchableTable
                        title="Suppliers"
                        data={data.suppliers}
                        columns={[
                          { key: 'supplier_name', label: 'Name' },
                          { key: 'location', label: 'Location' },
                          { key: 'supplier_code', label: 'Code' },
                          { key: 'primary_contact_email', label: 'Email' },
                        ]}
                        isLoading={dataLoading}
                      />
                      <SearchableTable
                        title="Components"
                        data={data.components}
                        columns={[
                          { key: 'model_sku', label: 'SKU' },
                          { key: 'description', label: 'Description' },
                          { key: 'brand', label: 'Brand' },
                          { key: 'category', label: 'Category' },
                        ]}
                        isLoading={dataLoading}
                      />
                    </div>
                  </div>

                  <div className="space-y-6">
                    <h2 className="text-xl font-bold text-emerald-400 border-b border-emerald-900/50 pb-2">2. Quoting</h2>
                    <SearchableTable
                      title="Price Quotes"
                      data={data.quotes}
                      columns={[
                        { key: 'quote_date', label: 'Date' },
                        { key: 'pi_number', label: 'Ref #' },
                        { key: 'supplier', label: 'Supplier', render: (r) => getSupplierName(r.supplier_id) },
                        { key: 'total_value', label: 'Total', render: (r) => `${r.currency} ${r.total_value}` },
                        { key: 'status', label: 'Status' },
                      ]}
                      isLoading={dataLoading}
                    />
                  </div>

                  <div className="space-y-6">
                    <h2 className="text-xl font-bold text-emerald-400 border-b border-emerald-900/50 pb-2">3. Ordering</h2>
                    <div className="grid grid-cols-1 xl:grid-cols-2 gap-8">
                      <SearchableTable
                        title="Proforma Invoices"
                        data={data.pis}
                        columns={[
                          { key: 'pi_date', label: 'Date' },
                          { key: 'pi_number', label: 'PI #' },
                          { key: 'status', label: 'Status' },
                        ]}
                        isLoading={dataLoading}
                      />
                      <SearchableTable
                        title="Purchase Orders"
                        data={data.pos}
                        columns={[
                          { key: 'po_date', label: 'Date' },
                          { key: 'po_number', label: 'PO #' },
                          { key: 'total_value', label: 'Total', render: (r) => `${r.currency} ${r.total_value}` },
                          { key: 'status', label: 'Status' },
                        ]}
                        isLoading={dataLoading}
                      />
                    </div>
                  </div>

                  <div className="space-y-6">
                    <h2 className="text-xl font-bold text-emerald-400 border-b border-emerald-900/50 pb-2">4. Financials</h2>
                    <div className="grid grid-cols-1 xl:grid-cols-2 gap-8">
                      <SearchableTable
                        title="Payments Made"
                        data={data.payments}
                        columns={[
                          { key: 'payment_date', label: 'Date' },
                          { key: 'category', label: 'Category' },
                          { key: 'amount', label: 'Amount', render: (r) => `${r.currency} ${r.amount}` },
                        ]}
                        isLoading={dataLoading}
                      />
                      <SearchableTable
                        title="Landed Costs"
                        data={data.landedCosts}
                        columns={[
                          { key: 'payment_date', label: 'Date' },
                          { key: 'cost_type', label: 'Type' },
                          { key: 'amount', label: 'Amount', render: (r) => `${r.currency} ${r.amount}` },
                        ]}
                        isLoading={dataLoading}
                      />
                    </div>
                  </div>

                  <div className="space-y-6">
                    <h2 className="text-xl font-bold text-emerald-400 border-b border-emerald-900/50 pb-2">5. Historical Data</h2>
                    <div className="grid grid-cols-1 gap-8">
                      <SearchableTable
                        title="Purchase History"
                        data={data.poHistory}
                        columns={[
                          { key: 'po_date', label: 'Date' },
                          { key: 'po_number', label: 'PO #' },
                          { key: 'supplier', label: 'Supplier', render: (r) => getSupplierName(r.supplier_id) },
                          { key: 'description', label: 'Desc' },
                          { key: 'quantity', label: 'Qty' },
                          { key: 'unit_cost', label: 'Cost', render: (r) => `${r.currency} ${r.unit_cost}` },
                        ]}
                        isLoading={dataLoading}
                      />
                      <SearchableTable
                        title="Quote History"
                        data={data.quoteHistory}
                        columns={[
                          { key: 'quote_date', label: 'Date' },
                          { key: 'quote_number', label: 'Ref #' },
                          { key: 'supplier', label: 'Supplier', render: (r) => getSupplierName(r.supplier_id) },
                          { key: 'description', label: 'Desc' },
                          { key: 'quantity', label: 'Qty' },
                          { key: 'unit_cost', label: 'Cost', render: (r) => `${r.currency} ${r.unit_cost}` },
                        ]}
                        isLoading={dataLoading}
                      />
                    </div>
                  </div>
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
