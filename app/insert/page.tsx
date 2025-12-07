'use client';

import { useState, useEffect, useRef } from 'react';
import { createSupabaseClient } from '@/lib/supabase';

// --- Types ---
type Tab = 'foundation' | 'quoting' | 'ordering' | 'financials' | 'history';

export default function MasterInsertPage() {
  const supabase = createSupabaseClient();
  const [activeTab, setActiveTab] = useState<Tab>('foundation');
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState('');

  // --- Data State ---
  const [companies, setCompanies] = useState<any[]>([]); 
  const [suppliers, setSuppliers] = useState<any[]>([]);
  const [components, setComponents] = useState<any[]>([]);
  const [quotes, setQuotes] = useState<any[]>([]);
  const [pis, setPis] = useState<any[]>([]);
  const [pos, setPos] = useState<any[]>([]);
    
  // --- Autocomplete Lists ---
  const [suggestions, setSuggestions] = useState({
    brands: [] as string[],
    locations: [] as string[],
    paymentTerms: [] as string[],
    incoterms: [] as string[],
    modelSkus: [] as string[],
    descriptions: [] as string[],
    supplierNames: [] as string[],
    poNumbers: [] as string[],
    quoteNumbers: [] as string[],
  });

  // --- ENUM Definitions ---
  const ENUMS = {
    currency: ['USD', 'RMB', 'IDR'],
    product_category: ['accessories', 'batteries', 'box_bsp', 'inverter_charger', 'mounting', 'non_stock', 'on_grid_inverter', 'portable_power', 'power_inverter', 'pv_cable', 'pv_module', 'solar_charge_controller', 'solar_pump_inverter', 'standing_cabinet', 'wallmount_cabinet'],
    payment_category: ['down_payment', 'balance_payment', 'additional_balance_payment', 'overpayment_credit', 'full_amount_bank_fee', 'telex_bank_fee', 'value_today_bank_fee', 'admin_bank_fee', 'inter_bank_transfer_fee'],
    landed_costs_type: ['local_import_duty', 'local_vat', 'local_income_tax', 'local_delivery', 'demurrage_fee', 'penalty_fee', 'dhl_advance_payment_fee', 'local_import_tax'],
    method_of_shipment: ['Sea', 'Air', 'Local Delivery'],
    price_quotes_status: ['Open', 'Accepted', 'Replaced', 'Rejected', 'Expired'],
    proforma_status: ['Open', 'Accepted', 'Replaced', 'Rejected', 'Expired'],
    purchases_status: ['Draft', 'Sent', 'Confirmed', 'Replaced', 'Partially Received', 'Fully Received', 'Cancelled'],
    lead_time: ['2 working day', '3 working days', '5 working days', '7 working days', '10 working days', '14 working days', '21 working days', '30 working days', '45 working days', '60 working days', '90 working days']
  };

  // --- Fetch Data ---
  const refreshData = async () => {
    const [compRows, sup, comp, quo, piData, poData] = await Promise.all([
      supabase.from('1.0_companies').select('company_id, legal_name'),
      supabase.from('2.0_suppliers').select('*'),
      supabase.from('3.0_components').select('*').order('model_sku', { ascending: true }),
      supabase.from('4.0_price_quotes').select('*').order('quote_date', { ascending: false }),
      supabase.from('5.0_proforma_invoices').select('*').order('pi_date', { ascending: false }),
      supabase.from('6.0_purchases').select('*').order('po_date', { ascending: false })
    ]);
     
    setCompanies(compRows.data || []);
    setSuppliers(sup.data || []);
    setComponents(comp.data || []);
    setQuotes(quo.data || []);
    setPis(piData.data || []);
    setPos(poData.data || []);

    // Helper to get unique values safely
    const getUnique = (arr: any[] | null, k: string) => {
        if (!arr) return [];
        return Array.from(new Set(arr.map(i => i[k]).filter(Boolean))).sort();
    };

    setSuggestions({
      brands: getUnique(comp.data || [], 'brand'),
      locations: getUnique(sup.data || [], 'location'),
      paymentTerms: Array.from(new Set([...getUnique(sup.data || [], 'payment_terms_default'), ...getUnique(poData.data || [], 'payment_terms')])).sort(),
      incoterms: getUnique(poData.data || [], 'incoterms'),
      modelSkus: getUnique(comp.data || [], 'model_sku'),
      descriptions: getUnique(comp.data || [], 'description'),
      supplierNames: getUnique(sup.data || [], 'supplier_name'),
      poNumbers: getUnique(poData.data || [], 'po_number'),
      // FIXED: Added || [] fallback here to prevent null error
      quoteNumbers: getUnique(quo.data || [], 'pi_number'),
    });
  };

  useEffect(() => { refreshData(); }, []);

  // --- Insert Handler ---
  const handleInsert = async (table: string, data: any) => {
    setLoading(true);
    setMessage('');
     
    const payload = Array.isArray(data) ? data : [data];
    const cleanPayload = payload.map(item => Object.fromEntries(
      Object.entries(item).map(([k, v]) => {
        if (v === '') return [k, null];
        if (k === 'specifications' && typeof v === 'string') {
          try { return [k, JSON.parse(v)]; } catch { return [k, v]; } 
        }
        return [k, v];
      })
    ));

    const { error } = await supabase.from(table).insert(cleanPayload);
    setLoading(false);

    if (error) {
      setMessage(`❌ Error in ${table}: ${error.message}`);
    } else {
      setMessage(`✅ Added ${cleanPayload.length} record(s)!`);
      refreshData(); 
    }
  };

  // --- Options ---
  const quoteOptions = quotes.map(q => ({ val: q.quote_id, txt: `${q.pi_number || 'No Ref'} | ${q.currency} ${q.total_value}` }));
  const piOptions = pis.map(p => ({ val: p.pi_id, txt: `${p.pi_number} (${p.pi_date})` }));
  const poOptions = pos.map(p => ({ val: p.po_id, txt: `${p.po_number} - ${p.po_date}` }));

  // --- Menu Config ---
  const menuItems = [
    { id: 'foundation', label: 'Add New Supplier or Component' },
    { id: 'quoting', label: 'Add Quotes' },
    { id: 'ordering', label: 'Add PI / PO' },
    { id: 'financials', label: 'Add Payments and Landed Costs' },
    { id: 'history', label: 'Import History' },
  ];

  return (
    <div className="flex min-h-screen bg-slate-950 text-slate-100 font-sans text-sm">
        
      {/* === LEFT SIDEBAR === */}
      <aside className="w-64 bg-slate-900 border-r border-slate-800 flex flex-col fixed h-full z-20 shadow-xl">
        <div className="p-6 border-b border-slate-800">
          <h1 className="text-base font-bold text-white tracking-wide uppercase leading-tight">
            Supabase | <br />
            <span className="text-emerald-500">ICA Supply Chain</span>
          </h1>
        </div>
        <nav className="flex-1 p-4 space-y-2">
          {menuItems.map((item) => (
            <button
              key={item.id}
              onClick={() => setActiveTab(item.id as Tab)}
              className={`w-full flex items-center px-4 py-3 rounded-md text-sm font-medium transition-all duration-200 text-left ${
                activeTab === item.id 
                ? 'bg-emerald-600/10 text-emerald-400 border border-emerald-600/20 shadow-sm' 
                : 'text-slate-400 hover:bg-slate-800 hover:text-slate-200'
              }`}
            >
              {item.label}
            </button>
          ))}
        </nav>
      </aside>

      {/* === MAIN CONTENT === */}
      <main className="flex-1 ml-64 p-8 bg-slate-950 min-h-screen overflow-x-hidden">
        <div className="max-w-6xl mx-auto">
            
          <div className="mb-8 flex justify-between items-center h-10">
            <h2 className="text-2xl font-bold text-white tracking-tight border-l-4 border-emerald-500 pl-4">
              {menuItems.find(m => m.id === activeTab)?.label}
            </h2>
            {message && (
              <div className={`px-4 py-2 rounded-md border text-xs font-bold shadow-lg flex items-center gap-2 animate-in fade-in slide-in-from-top-2 ${message.includes('Error') ? 'bg-red-950/50 border-red-900 text-red-200' : 'bg-emerald-950/50 border-emerald-900 text-emerald-200'}`}>
                <span>{message.includes('Error') ? '⚠️' : '✓'}</span>
                {message}
              </div>
            )}
          </div>

          {/* === TAB 1: FOUNDATION === */}
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
                onSubmit={(d: any) => handleInsert('2.0_suppliers', d)} loading={loading}
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
                onSubmit={(d: any) => handleInsert('3.0_components', d)} loading={loading}
              />
            </div>
          )}

          {/* === TAB 2: QUOTING === */}
          {activeTab === 'quoting' && (
            <div className="grid grid-cols-1 xl:grid-cols-2 gap-6 items-start">
              <div>
                <SimpleForm 
                  title="Step 1: Quote Header"
                  fields={[
                    { name: 'supplier_id', label: 'Supplier', type: 'rich-select', options: suppliers, config: { labelKey: 'supplier_name', valueKey: 'supplier_id', subLabelKey: 'location' }, req: true },
                    { name: 'company_id', label: 'Addressed To', type: 'select', options: companies.map(c => ({val: c.company_id, txt: c.legal_name})), req: true },
                    { name: 'quote_date', label: 'Date', type: 'date', req: true, default: new Date().toISOString().split('T')[0] },
                    { name: 'pi_number', label: 'Quote Ref', type: 'text' },
                    { name: 'currency', label: 'Currency', type: 'select', options: ENUMS.currency, req: true },
                    { name: 'total_value', label: 'Total Value', type: 'number', req: true },
                    { name: 'status', label: 'Status', type: 'select', options: ENUMS.price_quotes_status, default: 'Open' },
                    { name: 'estimated_lead_time_days', label: 'Lead Time', type: 'select', options: ENUMS.lead_time },
                    { name: 'replaces_quote_id', label: 'Replaces', type: 'select', options: quoteOptions },
                  ]}
                  onSubmit={(d: any) => handleInsert('4.0_price_quotes', d)} loading={loading}
                />
              </div>

              <div>
                <BatchLineItemsForm 
                  title="Step 2: Quote Items"
                  parentField={{ name: 'quote_id', label: 'Select Quote', options: quoteOptions }}
                  itemFields={[
                    { name: 'component_id', label: 'Component (Search SKU)', type: 'rich-select', options: components, config: { labelKey: 'model_sku', valueKey: 'component_id', subLabelKey: 'description' }, req: true, width: 'w-72' },
                    { name: 'supplier_description', label: 'Supplier Desc', type: 'text', placeholder: 'Override', width: 'w-40' },
                    { name: 'quantity', label: 'Qty', type: 'number', req: true, width: 'w-20' },
                    { name: 'unit_price', label: 'Price', type: 'number', req: true, width: 'w-24' },
                    { name: 'currency', label: 'Curr', type: 'select', options: ENUMS.currency, req: true, width: 'w-20' },
                  ]}
                  onSubmit={(items: any) => handleInsert('4.1_price_quote_line_items', items)}
                  loading={loading}
                />
              </div>
            </div>
          )}

          {/* === TAB 3: ORDERING === */}
          {activeTab === 'ordering' && (
            <div className="grid grid-cols-1 xl:grid-cols-2 gap-6 items-start">
              <div className="space-y-6">
                <SimpleForm 
                  title="1. Proforma Invoice"
                  fields={[
                    { name: 'quote_id', label: 'Link Quote', type: 'select', options: quoteOptions },
                    { name: 'pi_number', label: 'PI #', type: 'text', req: true },
                    { name: 'pi_date', label: 'PI Date', type: 'date', req: true, default: new Date().toISOString().split('T')[0] },
                    { name: 'status', label: 'Status', type: 'select', options: ENUMS.proforma_status, default: 'Open' },
                    { name: 'replaces_pi_id', label: 'Replaces', type: 'select', options: piOptions },
                  ]}
                  onSubmit={(d: any) => handleInsert('5.0_proforma_invoices', d)} loading={loading}
                />
                <SimpleForm 
                  title="2. Purchase Order"
                  fields={[
                    { name: 'pi_id', label: 'Link PI', type: 'select', options: piOptions },
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
                    { name: 'replaces_po_id', label: 'Replaces', type: 'select', options: poOptions },
                  ]}
                  onSubmit={(d: any) => handleInsert('6.0_purchases', d)} loading={loading}
                />
              </div>

              <div>
                <BatchLineItemsForm 
                  title="3. PO Items"
                  parentField={{ name: 'po_id', label: 'Select PO', options: poOptions }}
                  itemFields={[
                    { name: 'component_id', label: 'Component (Search SKU)', type: 'rich-select', options: components, config: { labelKey: 'model_sku', valueKey: 'component_id', subLabelKey: 'description' }, req: true, width: 'w-72' },
                    { name: 'supplier_description', label: 'Supplier Desc', type: 'text', placeholder: 'Override', width: 'w-40' },
                    { name: 'quantity', label: 'Qty', type: 'number', req: true, width: 'w-20' },
                    { name: 'unit_cost', label: 'Cost', type: 'number', req: true, width: 'w-24' },
                    { name: 'currency', label: 'Curr', type: 'select', options: ENUMS.currency, req: true, width: 'w-20' },
                  ]}
                  onSubmit={(items: any) => handleInsert('6.1_purchase_line_items', items)}
                  loading={loading}
                />
              </div>
            </div>
          )}

          {/* === TAB 4: FINANCIALS === */}
          {activeTab === 'financials' && (
            <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
              <SimpleForm 
                title="Payment Record"
                fields={[
                  { name: 'po_id', label: 'Select PO', type: 'select', options: poOptions, req: true },
                  { name: 'category', label: 'Category', type: 'select', options: ENUMS.payment_category, req: true },
                  { name: 'amount', label: 'Amount', type: 'number', req: true },
                  { name: 'currency', label: 'Currency', type: 'select', options: ENUMS.currency, req: true },
                  { name: 'payment_date', label: 'Date', type: 'date', req: true, default: new Date().toISOString().split('T')[0] },
                  { name: 'notes', label: 'Notes', type: 'textarea' },
                ]}
                onSubmit={(d: any) => handleInsert('7.0_payment_details', d)} loading={loading}
              />
              <SimpleForm 
                title="Landed Cost"
                fields={[
                  { name: 'po_id', label: 'Select PO', type: 'select', options: poOptions, req: true },
                  { name: 'cost_type', label: 'Type', type: 'select', options: ENUMS.landed_costs_type, req: true },
                  { name: 'amount', label: 'Amount', type: 'number', req: true },
                  { name: 'currency', label: 'Currency', type: 'select', options: ENUMS.currency, req: true },
                  { name: 'payment_date', label: 'Date', type: 'date' },
                  { name: 'notes', label: 'Notes', type: 'textarea' },
                ]}
                onSubmit={(d: any) => handleInsert('7.1_landed_costs', d)} loading={loading}
              />
            </div>
          )}

           {/* === TAB 5: HISTORY IMPORT (Batch Enabled) === */}
          {activeTab === 'history' && (
            <div className="grid grid-cols-1 gap-10">
              {/* PURCHASE HISTORY BATCH */}
              <BatchLineItemsForm 
                title="Add Purchase History (Batch)"
                // No parent field needed for flat history
                itemFields={[
                   // Sticky Fields (Left side - Header info)
                   { name: 'po_date', label: 'PO Date', type: 'date', width: 'w-32' },
                   { name: 'po_number', label: 'PO Number', type: 'text', suggestions: suggestions.poNumbers, width: 'w-36' },
                   { name: 'supplier_id', label: 'Supplier', type: 'rich-select', options: suppliers, config: { labelKey: 'supplier_name', valueKey: 'supplier_id', subLabelKey: 'location' }, width: 'w-48' },
                   
                   // Variable Fields (Right side - Item info)
                   { name: 'component_id', label: 'Component', type: 'rich-select', options: components, config: { labelKey: 'model_sku', valueKey: 'component_id', subLabelKey: 'description' }, width: 'w-64' },
                   { name: 'brand', label: 'Brand', type: 'text', suggestions: suggestions.brands, width: 'w-24' },
                   { name: 'description', label: 'Description', type: 'text', suggestions: suggestions.descriptions, width: 'w-40' },
                   { name: 'quantity', label: 'Qty', type: 'number', width: 'w-20' },
                   { name: 'unit_cost', label: 'Cost', type: 'number', width: 'w-24' },
                   { name: 'currency', label: 'Curr', type: 'select', options: ENUMS.currency, width: 'w-20' },
                ]}
                stickyFields={['po_date', 'po_number', 'supplier_id', 'currency']} // These won't clear after adding
                onSubmit={(items: any) => handleInsert('purchase_history', items)} 
                loading={loading}
              />
              
              {/* QUOTE HISTORY BATCH */}
              <BatchLineItemsForm 
                title="Add Quote History (Batch)"
                itemFields={[
                   { name: 'quote_date', label: 'Quote Date', type: 'date', width: 'w-32' },
                   { name: 'quote_number', label: 'Quote Ref', type: 'text', suggestions: suggestions.quoteNumbers, width: 'w-36' },
                   { name: 'supplier_id', label: 'Supplier', type: 'rich-select', options: suppliers, config: { labelKey: 'supplier_name', valueKey: 'supplier_id', subLabelKey: 'location' }, width: 'w-48' },
                   
                   { name: 'component_id', label: 'Component', type: 'rich-select', options: components, config: { labelKey: 'model_sku', valueKey: 'component_id', subLabelKey: 'description' }, width: 'w-64' },
                   { name: 'brand', label: 'Brand', type: 'text', suggestions: suggestions.brands, width: 'w-24' },
                   { name: 'description', label: 'Description', type: 'text', suggestions: suggestions.descriptions, width: 'w-40' },
                   { name: 'quantity', label: 'Qty', type: 'number', width: 'w-20' },
                   { name: 'unit_cost', label: 'Cost', type: 'number', width: 'w-24' },
                   { name: 'currency', label: 'Curr', type: 'select', options: ENUMS.currency, width: 'w-20' },
                ]}
                stickyFields={['quote_date', 'quote_number', 'supplier_id', 'currency']}
                onSubmit={(items: any) => handleInsert('quote_history', items)} 
                loading={loading}
              />
            </div>
          )}
        </div>
      </main>
    </div>
  );
}

// ============================================
// COMPONENT: Rich Dropdown (Searchable Combobox)
// REVISED: GENERIC VERSION
// ============================================
function RichDropdown({ options, value, onChange, placeholder = "Search...", config = {} }: any) {
  const [isOpen, setIsOpen] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');
  const wrapperRef = useRef<HTMLDivElement>(null);

  const labelKey = config.labelKey || 'model_sku';
  const subLabelKey = config.subLabelKey || 'description';
  const valueKey = config.valueKey || 'component_id';

  useEffect(() => {
    if (value) {
      const selected = options.find((o: any) => o[valueKey] === value);
      if (selected) {
        setSearchTerm(`${selected[labelKey]} - ${selected[subLabelKey] || ''}`);
      }
    } else {
      setSearchTerm('');
    }
  }, [value, options, labelKey, subLabelKey, valueKey]);

  useEffect(() => {
    function handleClickOutside(event: any) {
      if (wrapperRef.current && !wrapperRef.current.contains(event.target)) {
        setIsOpen(false);
        if (value) {
          const selected = options.find((o: any) => o[valueKey] === value);
          setSearchTerm(selected ? `${selected[labelKey]} - ${selected[subLabelKey] || ''}` : '');
        } else {
          setSearchTerm(''); 
        }
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [wrapperRef, value, options, valueKey, labelKey, subLabelKey]);

  const filtered = options.filter((c: any) => 
    (c[labelKey] || '').toLowerCase().includes(searchTerm.toLowerCase()) || 
    (c[subLabelKey] || '').toLowerCase().includes(searchTerm.toLowerCase())
  ).slice(0, 30); 

  const handleSelect = (item: any) => {
    onChange(item[valueKey]);
    setSearchTerm(`${item[labelKey]} - ${item[subLabelKey] || ''}`);
    setIsOpen(false);
  };

  const handleInputChange = (e: any) => {
    setSearchTerm(e.target.value);
    setIsOpen(true);
    onChange(null); 
  };

  return (
    <div className="relative w-full" ref={wrapperRef}>
      <div className="relative">
        <input
          type="text"
          className={`w-full p-2.5 bg-slate-900 border rounded text-sm text-white placeholder-slate-600 focus:outline-none transition-all ${
            isOpen ? 'border-emerald-500 ring-1 ring-emerald-500/50 rounded-b-none' : 'border-slate-700'
          }`}
          placeholder={placeholder}
          value={searchTerm}
          onChange={handleInputChange}
          onFocus={() => { setIsOpen(true); if(value === null) setSearchTerm(''); }}
        />
        <div className="absolute right-2 top-1/2 -translate-y-1/2 pointer-events-none text-slate-500 text-xs">
          ▼
        </div>
      </div>

      {isOpen && (
        <div className="absolute z-50 top-full left-0 w-full bg-slate-900 border border-t-0 border-emerald-500/50 rounded-b-lg shadow-2xl overflow-hidden animate-in fade-in zoom-in-95 duration-75">
          <div className="max-h-60 overflow-y-auto custom-scrollbar">
            {filtered.length === 0 ? (
              <div className="p-3 text-center text-xs text-slate-500 italic">
                No matching results.
              </div>
            ) : (
              filtered.map((c: any) => (
                <div
                  key={c[valueKey]}
                  onClick={() => handleSelect(c)}
                  className="p-2 border-b border-slate-800/50 cursor-pointer hover:bg-slate-800 transition-colors group flex flex-col gap-0.5 last:border-0"
                >
                  <div className="flex justify-between items-center">
                    <span className="font-mono text-emerald-400 font-bold text-xs">{c[labelKey]}</span>
                  </div>
                  <div className="text-[11px] text-slate-400 group-hover:text-slate-200 line-clamp-1">
                    {c[subLabelKey]}
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  );
}

// ============================================
// COMPONENT: Batch Form (Compact)
// UPDATED: Supports "Sticky Fields" & Optional Parent
// ============================================
function BatchLineItemsForm({ title, parentField, itemFields, onSubmit, loading, stickyFields = [] }: any) {
  const [parentId, setParentId] = useState('');
  const [items, setItems] = useState<any[]>([]);
  const [draft, setDraft] = useState<any>({});
  
  const handleDraftChange = (field: string, value: any) => setDraft({ ...draft, [field]: value });

  const addItem = () => {
    // Validation
    for (const f of itemFields) {
      // Check required only if it's explicitly required
      if (f.req && !draft[f.name]) return alert(`${f.label} is required`);
    }
    setItems([...items, { ...draft, _id: Date.now() }]);
    
    // Reset State with Sticky Logic
    const nextDraft: any = {};
    // 1. Keep sticky fields
    stickyFields.forEach((key: string) => {
        if(draft[key]) nextDraft[key] = draft[key];
    });
    // 2. Keep currency by default if not strictly passed
    if(draft.currency && !nextDraft.currency) nextDraft.currency = draft.currency;

    setDraft(nextDraft);
  };

  const removeItem = (id: number) => setItems(items.filter(i => i._id !== id));
    
  const handleSubmit = () => {
    // If parentField exists, require parentId
    if (parentField && !parentId) return alert(`Select ${parentField.label}`);
    if (items.length === 0) return alert("Add at least one item");
    
    // Inject parentId if applicable
    const payload = items.map(({ _id, ...rest }) => {
        if (parentField) return { ...rest, [parentField.name]: parentId };
        return rest;
    });

    onSubmit(payload);
    setItems([]);
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between border-b border-slate-800 pb-2 mb-4">
        <h3 className="text-sm font-semibold text-slate-300 flex items-center gap-2">
          <span className="w-1.5 h-1.5 rounded-full bg-emerald-500"></span> {title}
        </h3>
      </div>

      {/* Select Parent (Only if parentField provided) */}
      {parentField && (
        <div>
            <label className="block text-[10px] font-bold text-slate-500 mb-1 uppercase tracking-wider">{parentField.label}</label>
            <select 
            className="w-full p-2.5 bg-slate-900 border border-slate-700 rounded text-sm text-white focus:border-emerald-500 focus:outline-none transition-colors"
            value={parentId}
            onChange={(e) => setParentId(e.target.value)}
            >
            <option value="">-- Select --</option>
            {parentField.options.map((o:any) => <option key={o.val} value={o.val}>{o.txt}</option>)}
            </select>
        </div>
      )}

      {/* Add Item Row */}
      <div className="bg-slate-900/50 p-3 rounded border border-slate-800 overflow-visible">
        <div className="flex gap-3 items-end overflow-x-auto pb-4 lg:pb-0 lg:overflow-visible">
          {itemFields.map((f: any) => (
            <div key={f.name} className={`${f.width || 'w-32'} flex-shrink-0 relative`}>
              <label className="block text-[10px] text-slate-500 mb-1 font-semibold">{f.label}</label>
              
              {f.type === 'rich-select' ? (
                 <RichDropdown 
                   options={f.options} 
                   value={draft[f.name]} 
                   config={f.config}
                   onChange={(val: any) => handleDraftChange(f.name, val)}
                 />
              ) : f.type === 'select' ? (
                <select 
                  className="w-full p-2.5 bg-slate-900 border border-slate-700 rounded text-sm text-white focus:border-emerald-500 focus:outline-none"
                  value={draft[f.name] || ''}
                  onChange={(e) => handleDraftChange(f.name, e.target.value)}
                >
                   <option value="">-</option>
                   {f.options.map((o:any) => typeof o === 'string' ? <option key={o} value={o}>{o}</option> : <option key={o.val} value={o.val}>{o.txt}</option>)}
                </select>
              ) : (
                <input 
                  type={f.type} 
                  className="w-full p-2.5 bg-slate-900 border border-slate-700 rounded text-sm text-white focus:border-emerald-500 focus:outline-none placeholder-slate-700"
                  value={draft[f.name] || ''}
                  onChange={(e) => handleDraftChange(f.name, e.target.value)}
                  placeholder={f.placeholder}
                  list={f.suggestions ? `${f.name}-list` : undefined}
                />
              )}
               {/* Datalist for simple inputs */}
               {f.type === 'text' && f.suggestions && (
                  <datalist id={`${f.name}-list`}>
                    {(draft[f.name] || '').length >= 1 && f.suggestions.map((val: string, i: number) => <option key={i} value={val} />)}
                  </datalist>
               )}
            </div>
          ))}
          <button onClick={addItem} className="bg-emerald-600 hover:bg-emerald-500 text-white h-[42px] px-5 rounded text-sm font-bold shadow-lg shadow-emerald-900/20 transition-all active:scale-95">
            +
          </button>
        </div>
      </div>

      {/* Queue */}
      {items.length > 0 && (
        <div className="rounded border border-slate-800 overflow-hidden">
          <table className="w-full text-xs text-left text-slate-400">
            <thead className="bg-slate-900 uppercase font-semibold text-slate-500">
              <tr>
                {itemFields.map((f:any) => <th key={f.name} className="px-3 py-2 whitespace-nowrap">{f.label}</th>)}
                <th className="px-3 py-2 text-right">Action</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800">
              {items.map((item) => (
                <tr key={item._id} className="hover:bg-slate-800/50 transition-colors">
                  {itemFields.map((f:any) => (
                    <td key={f.name} className="px-3 py-2 whitespace-nowrap">
                      {f.type === 'rich-select' 
                        ? (f.options.find((o:any) => o[f.config?.valueKey || 'component_id'] === item[f.name])?.[f.config?.labelKey || 'model_sku']) 
                        : item[f.name]}
                    </td>
                  ))}
                  <td className="px-3 py-2 text-right">
                    <button onClick={() => removeItem(item._id)} className="text-red-500 hover:text-red-400 font-bold px-2">×</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <div className="bg-slate-900 p-3 flex justify-end border-t border-slate-800">
            <button 
              onClick={handleSubmit} 
              disabled={loading}
              className="bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-bold py-2 px-6 rounded shadow transition-all hover:scale-105 active:scale-95 disabled:opacity-50"
            >
              {loading ? 'Saving...' : `Save ${items.length} Items`}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

// ============================================
// COMPONENT: Simple Form (Compact)
// ============================================
function SimpleForm({ title, fields, onSubmit, loading }: any) {
  const [data, setData] = useState<any>({});
    
  useEffect(() => {
    const defaults: any = {};
    fields.forEach((f: any) => { if (f.default) defaults[f.name] = f.default; });
    setData(defaults);
  }, [fields]);

  const handleChange = (e: any) => setData({ ...data, [e.target.name]: e.target.value });
  const handleRichChange = (name: string, val: any) => setData({ ...data, [name]: val });

  return (
    <form onSubmit={(e) => { e.preventDefault(); onSubmit(data); }} className="bg-slate-900 rounded border border-slate-800 p-5 shadow-lg">
      <h3 className="text-sm font-semibold text-slate-200 border-b border-slate-800 pb-3 mb-4 flex items-center gap-2">
        <span className="w-1.5 h-1.5 rounded-full bg-emerald-500"></span>
        {title}
      </h3>
      <div className="grid gap-4">
        {fields.map((f: any) => (
          <div key={f.name}>
            <label className="block text-[10px] font-bold text-slate-500 mb-1 uppercase tracking-wider">
              {f.label} {f.req && <span className="text-emerald-500">*</span>}
            </label>
            {f.type === 'rich-select' ? (
              <RichDropdown 
                options={f.options} 
                value={data[f.name]} 
                config={f.config}
                onChange={(val: any) => handleRichChange(f.name, val)}
              />
            ) : f.type === 'select' ? (
              <select name={f.name} value={data[f.name] || ''} onChange={handleChange} required={f.req} className="w-full p-2.5 bg-slate-950 border border-slate-700 rounded text-sm text-white focus:border-emerald-500 focus:outline-none transition-colors">
                <option value="">-- Select --</option>
                {f.options?.map((opt: any) => typeof opt === 'string' ? <option key={opt} value={opt}>{opt}</option> : <option key={opt.val} value={opt.val}>{opt.txt}</option>)}
              </select>
            ) : f.type === 'textarea' ? (
              <textarea name={f.name} value={data[f.name] || ''} onChange={handleChange} className="w-full p-2.5 bg-slate-950 border border-slate-700 rounded text-sm text-white focus:border-emerald-500 focus:outline-none min-h-[80px]" placeholder={f.placeholder} />
            ) : (
              <input type={f.type} name={f.name} value={data[f.name] || ''} onChange={handleChange} required={f.req} list={f.suggestions ? `${f.name}-list` : undefined} className="w-full p-2.5 bg-slate-950 border border-slate-700 rounded text-sm text-white focus:border-emerald-500 focus:outline-none placeholder-slate-700" placeholder={f.placeholder} />
            )}
             {f.suggestions && <datalist id={`${f.name}-list`}>{(data[f.name] || '').length >= 1 && f.suggestions.map((val: string, i: number) => <option key={i} value={val} />)}</datalist>}
          </div>
        ))}
        <button type="submit" disabled={loading} className="w-full bg-emerald-600 hover:bg-emerald-500 text-white font-bold py-2.5 px-4 rounded text-sm shadow-lg shadow-emerald-900/20 transition-all hover:translate-y-[-1px] active:translate-y-[1px] disabled:opacity-50">
          {loading ? 'Saving...' : 'Save Record'}
        </button>
      </div>
    </form>
  );
}