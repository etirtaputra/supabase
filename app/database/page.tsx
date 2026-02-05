/**
 * Database View - Read-Only
 * Separate page for viewing all supply chain data
 */

'use client';

import { useSupabaseData } from '@/hooks/useSupabaseData';
import SearchableTable from '@/components/ui/SearchableTable';
import { ToastProvider } from '@/hooks/useToast';

export default function DatabaseViewPage() {
  const { data, loading } = useSupabaseData();

  // Helper functions
  const getSupplierName = (id: any) => data.suppliers.find((s) => s.supplier_id === id)?.supplier_name || 'Unknown';
  const getComponentSku = (id: any) => data.components.find((c) => c.component_id === id)?.supplier_model || 'Unknown';

  return (
    <ToastProvider>
      <div className="min-h-screen bg-slate-950 text-slate-100 font-sans text-sm">
        {/* Header */}
        <header className="bg-slate-900 border-b border-slate-800 p-6 sticky top-0 z-50 shadow-lg">
          <div className="max-w-[1600px] mx-auto">
            <h1 className="text-2xl font-bold text-white">
              Supply Chain Database <span className="text-emerald-500">View</span>
            </h1>
            <p className="text-slate-400 text-sm mt-1">Read-only access to all supply chain data</p>
          </div>
        </header>

        {/* Content */}
        <main className="p-4 md:p-8">
          <div className="max-w-[1600px] mx-auto space-y-12">
            
            {/* Section 1: Foundation Data */}
            <section className="space-y-6">
              <h2 className="text-xl font-bold text-emerald-400 border-b border-emerald-900/50 pb-2">
                1. Foundation Data
              </h2>
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
                  isLoading={loading}
                />
                <SearchableTable
                  title="Components"
                  data={data.components}
                  columns={[
                    { key: 'supplier_model', label: 'Supplier Model' },
                    { key: 'internal_description', label: 'Internal Description' },
                    { key: 'brand', label: 'Brand' },
                    { key: 'category', label: 'Category' },
                  ]}
                  isLoading={loading}
                />
              </div>
            </section>

            {/* Section 2: Quoting */}
            <section className="space-y-6">
              <h2 className="text-xl font-bold text-emerald-400 border-b border-emerald-900/50 pb-2">
                2. Quoting
              </h2>
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
                isLoading={loading}
              />
              <SearchableTable
                title="Quote Items"
                data={data.quoteItems}
                columns={[
                  { key: 'quote_id', label: 'Quote ID' },
                  { key: 'sku', label: 'SKU', render: (r) => getComponentSku(r.component_id) },
                  { key: 'supplier_description', label: 'Description' },
                  { key: 'quantity', label: 'Qty' },
                  { key: 'unit_price', label: 'Price' },
                  { key: 'currency', label: 'Currency' },
                ]}
                isLoading={loading}
              />
            </section>

            {/* Section 3: Ordering */}
            <section className="space-y-6">
              <h2 className="text-xl font-bold text-emerald-400 border-b border-emerald-900/50 pb-2">
                3. Ordering
              </h2>
              <SearchableTable
                title="Purchase Orders (with PI fields)"
                data={data.pos}
                columns={[
                  { key: 'po_date', label: 'PO Date' },
                  { key: 'po_number', label: 'PO #' },
                  { key: 'pi_number', label: 'PI #' },
                  { key: 'pi_date', label: 'PI Date' },
                  { key: 'total_value', label: 'Total', render: (r) => `${r.currency} ${r.total_value || ''}` },
                  { key: 'status', label: 'PO Status' },
                  { key: 'pi_status', label: 'PI Status' },
                ]}
                isLoading={loading}
              />
              <SearchableTable
                title="Purchase Line Items"
                data={data.poItems}
                columns={[
                  { key: 'po_id', label: 'PO ID' },
                  { key: 'sku', label: 'SKU', render: (r) => getComponentSku(r.component_id) },
                  { key: 'supplier_description', label: 'Description' },
                  { key: 'quantity', label: 'Qty' },
                  { key: 'unit_cost', label: 'Cost' },
                  { key: 'currency', label: 'Currency' },
                ]}
                isLoading={loading}
              />
            </section>

            {/* Section 4: Financials */}
            <section className="space-y-6">
              <h2 className="text-xl font-bold text-emerald-400 border-b border-emerald-900/50 pb-2">
                4. Financials
              </h2>
              <SearchableTable
                title="PO Costs (Payments, Bank Fees & Landed Costs)"
                data={data.poCosts}
                columns={[
                  { key: 'payment_date', label: 'Date' },
                  { key: 'cost_category', label: 'Category' },
                  { key: 'amount', label: 'Amount', render: (r) => `${r.currency} ${r.amount}` },
                  { key: 'notes', label: 'Notes' },
                ]}
                isLoading={loading}
              />
            </section>

            {/* Section 5: Historical Data */}
            <section className="space-y-6">
              <h2 className="text-xl font-bold text-emerald-400 border-b border-emerald-900/50 pb-2">
                5. Historical Data
              </h2>
              <div className="grid grid-cols-1 gap-8">
                <SearchableTable
                  title="Purchase History"
                  data={data.poHistory}
                  columns={[
                    { key: 'po_date', label: 'Date' },
                    { key: 'po_number', label: 'PO #' },
                    { key: 'supplier', label: 'Supplier', render: (r) => getSupplierName(r.supplier_id) },
                    { key: 'brand', label: 'Brand' },
                    { key: 'description', label: 'Desc' },
                    { key: 'quantity', label: 'Qty' },
                    { key: 'unit_cost', label: 'Cost', render: (r) => `${r.currency} ${r.unit_cost}` },
                  ]}
                  isLoading={loading}
                />
                <SearchableTable
                  title="Quote History"
                  data={data.quoteHistory}
                  columns={[
                    { key: 'quote_date', label: 'Date' },
                    { key: 'quote_number', label: 'Ref #' },
                    { key: 'supplier', label: 'Supplier', render: (r) => getSupplierName(r.supplier_id) },
                    { key: 'brand', label: 'Brand' },
                    { key: 'description', label: 'Desc' },
                    { key: 'quantity', label: 'Qty' },
                    { key: 'unit_cost', label: 'Cost', render: (r) => `${r.currency} ${r.unit_cost}` },
                  ]}
                  isLoading={loading}
                />
              </div>
            </section>

          </div>
        </main>
      </div>
    </ToastProvider>
  );
}
