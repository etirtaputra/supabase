/**
 * Database View - Read-Only
 * Tab-based layout for mobile-first navigation
 */
'use client';
import { useState } from 'react';
import { useSupabaseData } from '@/hooks/useSupabaseData';
import SearchableTable from '@/components/ui/SearchableTable';
import ProductCostLookup from '@/components/ui/ProductCostLookup';
import POCashCycle from '@/components/ui/POCashCycle';
import { ToastProvider } from '@/hooks/useToast';
type TabId = 'lookup' | 'quotes' | 'orders' | 'financials' | 'cash' | 'reference';
const TABS: { id: TabId; label: string; color: string; activeColor: string }[] = [
  { id: 'lookup',     label: 'Cost Lookup',  color: 'text-slate-400 hover:text-sky-300 hover:bg-slate-800/50',      activeColor: 'bg-sky-500/15 text-sky-300 ring-1 ring-sky-500/30' },
  { id: 'quotes',     label: 'Quotes',       color: 'text-slate-400 hover:text-emerald-300 hover:bg-slate-800/50',  activeColor: 'bg-emerald-500/15 text-emerald-300 ring-1 ring-emerald-500/30' },
  { id: 'orders',     label: 'Orders',       color: 'text-slate-400 hover:text-amber-300 hover:bg-slate-800/50',    activeColor: 'bg-amber-500/15 text-amber-300 ring-1 ring-amber-500/30' },
  { id: 'financials', label: 'Financials',   color: 'text-slate-400 hover:text-rose-300 hover:bg-slate-800/50',     activeColor: 'bg-rose-500/15 text-rose-300 ring-1 ring-rose-500/30' },
  { id: 'cash',       label: 'Cash Cycle',   color: 'text-slate-400 hover:text-violet-300 hover:bg-slate-800/50',   activeColor: 'bg-violet-500/15 text-violet-300 ring-1 ring-violet-500/30' },
  { id: 'reference',  label: 'Reference',    color: 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/50',    activeColor: 'bg-slate-700 text-white ring-1 ring-slate-500/30' },
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
      <div className="min-h-screen bg-[#0B1120] text-slate-200 font-sans text-sm selection:bg-sky-500/30">
        {/* ── Sticky header + tab bar ── */}
        <div className="sticky top-0 z-50 bg-[#0B1120]/80 backdrop-blur-md border-b border-slate-800/60 shadow-lg shadow-black/20">
          <header className="px-4 md:px-8 pt-5 pb-3 max-w-[1600px] mx-auto flex flex-col sm:flex-row sm:items-end justify-between gap-2">
            <div>
              <h1 className="text-xl md:text-3xl font-extrabold text-white tracking-tight leading-tight">
                Supply Chain <span className="text-transparent bg-clip-text bg-gradient-to-r from-emerald-400 to-sky-400">Database</span>
              </h1>
              <p className="text-slate-400 text-xs mt-1 hidden sm:block font-medium">Read-only synchronized view</p>
            </div>
          </header>
          {/* Tab bar */}
          <nav className="px-4 md:px-8 pb-3 max-w-[1600px] mx-auto flex overflow-x-auto gap-2 scrollbar-none snap-x">
            {TABS.map((tab) => (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                className={`snap-start px-4 py-2 rounded-full text-xs font-semibold whitespace-nowrap transition-all duration-200 ${
                  activeTab === tab.id ? tab.activeColor : tab.color
                }`}
              >
                {tab.label}
              </button>
            ))}
          </nav>
        </div>
        {/* ── Tab content ── */}
        <main className="p-4 md:p-8 max-w-[1600px] mx-auto animate-in fade-in duration-300">
          {/* Cost Lookup */}
          <div className={activeTab !== 'lookup' ? 'hidden' : 'space-y-6'}>
            <div className="mb-6">
              <h2 className="text-lg md:text-xl font-bold text-sky-400 tracking-tight">Product Cost Lookup</h2>
              <p className="text-slate-400 text-xs mt-1 max-w-2xl">
                All amounts are <span className="text-slate-200 font-medium">ex-PPN (tax)</span>.
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
          <div className={activeTab !== 'quotes' ? 'hidden' : 'space-y-8'}>
            <div className="mb-2">
              <h2 className="text-lg md:text-xl font-bold text-emerald-400 tracking-tight">Quotes</h2>
              <p className="text-slate-400 text-xs mt-1">Active and historical price quotes from suppliers.</p>
            </div>
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
          <div className={activeTab !== 'orders' ? 'hidden' : 'space-y-8'}>
            <div className="mb-2">
              <h2 className="text-lg md:text-xl font-bold text-amber-400 tracking-tight">Purchase Orders</h2>
              <p className="text-slate-400 text-xs mt-1">Confirmed purchase orders and individual line items.</p>
            </div>
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
          <div className={activeTab !== 'financials' ? 'hidden' : 'space-y-8'}>
            <div className="mb-2">
              <h2 className="text-lg md:text-xl font-bold text-rose-400 tracking-tight">Financials</h2>
              <p className="text-slate-400 text-xs mt-1">Detailed breakdown of payments, bank fees, and landed costs.</p>
            </div>
            <SearchableTable
              title="PO Costs — Payments, Bank Fees & Landed Costs"
              data={data.poCosts}
              columns={[
                { key: 'payment_date', label: 'Date' },
                { key: 'cost_category', label: 'Category' },
                { key: 'amount', label: 'Amount', render: (r) => <span className="font-medium text-white">{`${r.currency} ${r.amount}`}</span> },
                { key: 'notes', label: 'Notes' },
              ]}
              isLoading={loading}
            />
          </div>
          {/* Cash Cycle */}
          <div className={activeTab !== 'cash' ? 'hidden' : 'space-y-6'}>
            <div className="mb-6">
              <h2 className="text-lg md:text-xl font-bold text-violet-400 tracking-tight">Cash Conversion Cycle</h2>
              <p className="text-slate-400 text-xs mt-1 max-w-2xl">
                Tracks cash commitment timing per PO. <span className="text-slate-200 font-medium">Cycle gap</span> = days between consecutive PO down payments.
                <span className="text-slate-200 font-medium ml-1">Settlement</span> = days from down payment to balance payment within the same PO.
              </p>
            </div>
            <POCashCycle
              pos={data.pos}
              poCosts={data.poCosts}
              isLoading={loading}
            />
          </div>

          {/* Reference */}
          <div className={activeTab !== 'reference' ? 'hidden' : 'space-y-8'}>
            <div className="mb-2">
              <h2 className="text-lg md:text-xl font-bold text-slate-200 tracking-tight">Reference Data</h2>
              <p className="text-slate-400 text-xs mt-1">Master lists for suppliers, components, and historical logs.</p>
            </div>
            <div className="grid grid-cols-1 xl:grid-cols-2 gap-6 md:gap-8">
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
