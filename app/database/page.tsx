/**
 * Database View - Read-Only
 * Tab-based layout for mobile-first navigation
 */

'use client';

import { useState } from 'react';
import { useSupabaseData } from '@/hooks/useSupabaseData';
import SearchableTable from '@/components/ui/SearchableTable';
import ProductCostLookup from '@/components/ui/ProductCostLookup';
import { ToastProvider } from '@/hooks/useToast';

type TabId = 'lookup' | 'quotes' | 'orders' | 'financials' | 'reference';

const TABS: { id: TabId; label: string; color: string; activeColor: string }[] = [
  { id: 'lookup',     label: 'Cost Lookup',  color: 'text-slate-400 hover:text-sky-300',     activeColor: 'bg-sky-600 text-white' },
  { id: 'quotes',     label: 'Quotes',       color: 'text-slate-400 hover:text-emerald-300', activeColor: 'bg-emerald-700 text-white' },
  { id: 'orders',     label: 'Orders',       color: 'text-slate-400 hover:text-amber-300',   activeColor: 'bg-amber-700 text-white' },
  { id: 'financials', label: 'Financials',   color: 'text-slate-400 hover:text-rose-300',    activeColor: 'bg-rose-700 text-white' },
  { id: 'reference',  label: 'Reference',    color: 'text-slate-400 hover:text-slate-200',   activeColor: 'bg-slate-600 text-white' },
];

export default function DatabaseViewPage() {
  const { data, loading } = useSupabaseData();
  const [activeTab, setActiveTab] = useState<TabId>('lookup');

  const getSupplierName = (id: any) =>
    data.suppliers.find((s) => s.supplier_id === id)?.supplier_name || 'Unknown';
  const getComponentSku = (id: any) =>
    data.components.find((c) => c.component_id === id)?.supplier_model || 'Unknown';

  return (
    <ToastProvider>
      <div className="min-h-screen bg-slate-950 text-slate-100 font-sans text-sm">

        {/* ── Sticky header + tab bar ── */}
        <div className="sticky top-0 z-50 bg-slate-900 border-b border-slate-800 shadow-lg">
          <header className="px-4 md:px-8 pt-4 pb-2 max-w-[1600px] mx-auto">
            <h1 className="text-lg md:text-2xl font-bold text-white leading-tight">
              Supply Chain <span className="text-emerald-500">Database</span>
            </h1>
            <p className="text-slate-500 text-xs mt-0.5 hidden sm:block">Read-only view</p>
          </header>

          {/* Tab bar */}
          <nav className="px-4 md:px-8 pb-0 max-w-[1600px] mx-auto flex overflow-x-auto gap-1 scrollbar-none">
            {TABS.map((tab) => (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                className={`px-3 md:px-4 py-2 rounded-t-lg text-xs font-semibold whitespace-nowrap transition-colors border-b-2 ${
                  activeTab === tab.id
                    ? `${tab.activeColor} border-transparent`
                    : `${tab.color} border-transparent hover:bg-slate-800/60`
                }`}
              >
                {tab.label}
              </button>
            ))}
          </nav>
        </div>

        {/* ── Tab content ── */}
        <main className="p-4 md:p-8 max-w-[1600px] mx-auto">

          {/* Cost Lookup */}
          <div className={activeTab !== 'lookup' ? 'hidden' : 'space-y-6'}>
            <div>
              <h2 className="text-base md:text-lg font-bold text-sky-400">Product Cost Lookup</h2>
              <p className="text-slate-500 text-xs mt-1">
                All amounts are <span className="text-slate-300">ex-PPN (tax)</span>.
                True unit cost = payments + bank fees + landed costs, split by line share of PO value.
              </p>
            </div>
            <ProductCostLookup
              components={data.components}
              quotes={data.quotes}
              quoteItems={data.quoteItems}
              pos={data.pos}
              poItems={data.poItems}
              poCosts={data.poCosts}
              suppliers={data.suppliers}
              isLoading={loading}
            />
          </div>

          {/* Quotes */}
          <div className={activeTab !== 'quotes' ? 'hidden' : 'space-y-6'}>
            <h2 className="text-base md:text-lg font-bold text-emerald-400">Quotes</h2>
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
              title="Quote Line Items"
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
          </div>

          {/* Orders */}
          <div className={activeTab !== 'orders' ? 'hidden' : 'space-y-6'}>
            <h2 className="text-base md:text-lg font-bold text-amber-400">Purchase Orders</h2>
            <SearchableTable
              title="Purchase Orders"
              data={data.pos}
              columns={[
                { key: 'po_date', label: 'PO Date' },
                { key: 'po_number', label: 'PO #' },
                { key: 'pi_number', label: 'PI #' },
                { key: 'pi_date', label: 'PI Date' },
                { key: 'total_value', label: 'Total', render: (r) => `${r.currency} ${r.total_value || ''}` },
                { key: 'status', label: 'Status' },
              ]}
              isLoading={loading}
            />
            <SearchableTable
              title="PO Line Items"
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
          </div>

          {/* Financials */}
          <div className={activeTab !== 'financials' ? 'hidden' : 'space-y-6'}>
            <h2 className="text-base md:text-lg font-bold text-rose-400">Financials</h2>
            <SearchableTable
              title="PO Costs — Payments, Bank Fees & Landed Costs"
              data={data.poCosts}
              columns={[
                { key: 'payment_date', label: 'Date' },
                { key: 'cost_category', label: 'Category' },
                { key: 'amount', label: 'Amount', render: (r) => `${r.currency} ${r.amount}` },
                { key: 'notes', label: 'Notes' },
              ]}
              isLoading={loading}
            />
          </div>

          {/* Reference */}
          <div className={activeTab !== 'reference' ? 'hidden' : 'space-y-6'}>
            <h2 className="text-base md:text-lg font-bold text-slate-300">Reference Data</h2>
            <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
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
                  { key: 'supplier_model', label: 'SKU' },
                  { key: 'internal_description', label: 'Description' },
                  { key: 'brand', label: 'Brand' },
                  { key: 'category', label: 'Category' },
                ]}
                isLoading={loading}
              />
            </div>
            <SearchableTable
              title="Purchase History"
              data={data.poHistory}
              columns={[
                { key: 'po_date', label: 'Date' },
                { key: 'po_number', label: 'PO #' },
                { key: 'supplier', label: 'Supplier', render: (r) => getSupplierName(r.supplier_id) },
                { key: 'description', label: 'Description' },
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
                { key: 'description', label: 'Description' },
                { key: 'quantity', label: 'Qty' },
                { key: 'unit_cost', label: 'Cost', render: (r) => `${r.currency} ${r.unit_cost}` },
              ]}
              isLoading={loading}
            />
          </div>

        </main>
      </div>
    </ToastProvider>
  );
}
