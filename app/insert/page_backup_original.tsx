'use client';

import { useState, useEffect, useRef, useMemo } from 'react';
import { createSupabaseClient } from '@/lib/supabase';

// --- Types ---
type Tab = 'foundation' | 'quoting' | 'ordering' | 'financials' | 'history' | 'database';

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
  const [quoteItems, setQuoteItems] = useState<any[]>([]); 
  const [pis, setPis] = useState<any[]>([]);
  const [pos, setPos] = useState<any[]>([]);
  const [poItems, setPoItems] = useState<any[]>([]); 
  const [payments, setPayments] = useState<any[]>([]);
  const [landedCosts, setLandedCosts] = useState<any[]>([]);
  const [poHistory, setPoHistory] = useState<any[]>([]);
  const [quoteHistory, setQuoteHistory] = useState<any[]>([]);
    
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
    // 1. Fetch Foundation Data (Safe to wait for)
    try {
        const { data: compRows } = await supabase.from('1.0_companies').select('company_id, legal_name');
        const { data: sup } = await supabase.from('2.0_suppliers').select('*');
        const { data: comp } = await supabase.from('3.0_components').select('*');

        setCompanies(compRows || []);
        setSuppliers(sup || []);
        setComponents(comp || []);
        
        // 2. Fetch Transactional Data (Independent Fetches to prevent crashes)
        // We do not await these in a single Promise.all so one failure doesn't kill others.
        
        supabase.from('4.0_price_quotes').select('*').then(({ data }) => setQuotes(data || []));
        
        // REMOVED .order('created_at') to prevent crashes if column missing
        supabase.from('4.1_price_quote_line_items').select('*').then(({ data }) => {
            console.log('Quote Items Loaded:', data?.length); // Debug Log
            setQuoteItems(data || []);
        });

        supabase.from('5.0_proforma_invoices').select('*').then(({ data }) => setPis(data || []));
        
        supabase.from('6.0_purchases').select('*').then(({ data }) => setPos(data || []));

        // REMOVED .order('created_at')
        supabase.from('6.1_purchase_line_items').select('*').then(({ data }) => {
            console.log('PO Items Loaded:', data?.length); // Debug Log
            setPoItems(data || []);
        });

        supabase.from('7.0_payment_details').select('*').then(({ data }) => setPayments(data || []));
        supabase.from('7.1_landed_costs').select('*').then(({ data }) => setLandedCosts(data || []));
        
        supabase.from('purchase_history').select('*').then(({ data }) => {
            console.log('History Purchase Loaded:', data?.length); 
            setPoHistory(data || []);
        });
        
        supabase.from('quote_history').select('*').then(({ data }) => {
            console.log('History Quote Loaded:', data?.length);
            setQuoteHistory(data || []);
        });

        // 3. Build Autocomplete (Needs foundation data)
        const getUniqueCombined = (key: string, ...arrays: any[][]) => {
            const allValues = arrays.flatMap(arr => (arr || []).map(item => item[key])).filter(Boolean);
            return Array.from(new Set(allValues)).sort();
        };

        // Note: Suggestions might lag slightly behind transactional data load, which is fine
        // We use the initial foundation load + what we have for now.
    } catch (error) {
        console.error("Critical Data Load Error:", error);
        setMessage("❌ Error loading data foundation.");
    }
  };

  // Re-run suggestion builder when key data changes
  useEffect(() => {
    const getUniqueCombined = (key: string, ...arrays: any[][]) => {
        const allValues = arrays.flatMap(arr => (arr || []).map(item => item[key])).filter(Boolean);
        return Array.from(new Set(allValues)).sort();
    };
    
    setSuggestions({
        brands: getUniqueCombined('brand', components, poHistory, quoteHistory),
        locations: getUniqueCombined('location', suppliers),
        paymentTerms: getUniqueCombined('payment_terms', pos).concat(getUniqueCombined('payment_terms_default', suppliers)).sort(),
        incoterms: getUniqueCombined('incoterms', pos),
        modelSkus: getUniqueCombined('model_sku', components),
        descriptions: getUniqueCombined('description', components, poHistory, quoteHistory),
        supplierNames: getUniqueCombined('supplier_name', suppliers),
        poNumbers: getUniqueCombined('po_number', pos, poHistory),
        quoteNumbers: getUniqueCombined('pi_number', quotes).concat(getUniqueCombined('quote_number', quoteHistory)).sort(),
    });
  }, [suppliers, components, pos, quotes, poHistory, quoteHistory]);

  useEffect(() => { refreshData(); }, []);

  // --- Helper: Get Names from IDs (Safe Mapping) ---
  const getSupplierName = (id: any) => suppliers.find(s => s.supplier_id === id)?.supplier_name || 'Unknown';
  const getComponentSku = (id: any) => components.find(c => c.component_id === id)?.model_sku || 'Unknown';

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
      setMessage(`❌ Error: ${error.message}`);
    } else {
      setMessage(`✅ Added ${cleanPayload.length} record(s)!`);
      refreshData(); // Triggers reload
      setTimeout(() => setMessage(''), 3000);
    }
  };

  // --- Options ---
  const quoteOptions = quotes.map(q => ({ val: q.quote_id, txt: `${q.pi_number || 'No Ref'} | ${q.currency} ${q.total_value}` }));
  const piOptions = pis.map(p => ({ val: p.pi_id, txt: `${p.pi_number} (${p.pi_date})` }));
  const poOptions = pos.map(p => ({ val: p.po_id, txt: `${p.po_number} - ${p.po_date}` }));

  // --- Menu Config ---
  const menuItems = [
    { id: 'foundation', label: 'Suppliers & Components', icon: '🏢' },
    { id: 'quoting', label: 'Quotes', icon: '📝' },
    { id: 'ordering', label: 'PI / PO', icon: '📦' },
    { id: 'financials', label: 'Financials', icon: '💰' },
    { id: 'history', label: 'History Import', icon: '📂' },
    { id: 'database', label: 'Database View', icon: '🔍' },
  ];

  return (
    <div className="flex flex-col md:flex-row min-h-screen bg-slate-950 text-slate-100 font-sans text-sm">
      
      {/* === MOBILE NAVIGATION === */}
      <div className="md:hidden bg-slate-900 border-b border-slate-800 p-4 sticky top-0 z-50">
        <div className="flex justify-between items-center mb-4">
          <h1 className="font-bold text-white text-lg">Supply Chain</h1>
           {message && (
             <span className={`text-xs px-2 py-1 rounded ${message.includes('Error') ? 'bg-red-900 text-red-200' : 'bg-emerald-900 text-emerald-200'}`}>
               {message}
             </span>
           )}
        </div>
        <div className="flex overflow-x-auto space-x-2 pb-2 scrollbar-hide">
          {menuItems.map((item) => (
             <button
             key={item.id}
             onClick={() => setActiveTab(item.id as Tab)}
             className={`whitespace-nowrap px-4 py-2 rounded-full text-xs font-bold transition-all ${
               activeTab === item.id 
               ? 'bg-emerald-600 text-white shadow-lg' 
               : 'bg-slate-800 text-slate-400 hover:bg-slate-700'
             }`}
           >
             {item.label}
           </button>
          ))}
        </div>
      </div>

      {/* === DESKTOP SIDEBAR === */}
      <aside className="hidden md:flex w-64 bg-slate-900 border-r border-slate-800 flex-col fixed h-full z-20 shadow-xl">
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
              <span className="mr-3 opacity-70">{item.icon}</span>
              {item.label}
            </button>
          ))}
        </nav>
      </aside>

      {/* === MAIN CONTENT === */}
      <main className="flex-1 md:ml-64 p-4 md:p-8 bg-slate-950 min-h-screen overflow-x-hidden">
        <div className="max-w-[1600px] mx-auto pb-20 md:pb-0">
            
          {/* Header & Status Message (Desktop) */}
          <div className="hidden md:flex mb-8 justify-between items-center h-10">
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

          {/* === INSERT FORMS (Standard Tabs) === */}
          
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
                    { name: 'component_id', label: 'Component (Search SKU)', type: 'rich-select', options: components, config: { labelKey: 'model_sku', valueKey: 'component_id', subLabelKey: 'description' }, req: true },
                    { name: 'supplier_description', label: 'Supplier Desc', type: 'text', placeholder: 'Override' },
                    { name: 'quantity', label: 'Qty', type: 'number', req: true },
                    { name: 'unit_price', label: 'Price', type: 'number', req: true },
                    { name: 'currency', label: 'Curr', type: 'select', options: ENUMS.currency, req: true },
                  ]}
                  stickyFields={['currency']}
                  onSubmit={(items: any) => handleInsert('4.1_price_quote_line_items', items)}
                  loading={loading}
                />
              </div>
            </div>
          )}

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
                    { name: 'component_id', label: 'Component (Search SKU)', type: 'rich-select', options: components, config: { labelKey: 'model_sku', valueKey: 'component_id', subLabelKey: 'description' }, req: true },
                    { name: 'supplier_description', label: 'Supplier Desc', type: 'text', placeholder: 'Override' },
                    { name: 'quantity', label: 'Qty', type: 'number', req: true },
                    { name: 'unit_cost', label: 'Cost', type: 'number', req: true },
                    { name: 'currency', label: 'Curr', type: 'select', options: ENUMS.currency, req: true },
                  ]}
                  stickyFields={['currency']}
                  onSubmit={(items: any) => handleInsert('6.1_purchase_line_items', items)}
                  loading={loading}
                />
              </div>
            </div>
          )}

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

          {activeTab === 'history' && (
            <div className="flex flex-col gap-8">
              <BatchLineItemsForm 
                title="Add Purchase History (Batch)"
                formId="purchase_hist"
                itemFields={[
                   { name: 'po_date', label: 'PO Date', type: 'date' },
                   { name: 'po_number', label: 'PO Number', type: 'text', suggestions: suggestions.poNumbers },
                   { name: 'supplier_id', label: 'Supplier', type: 'rich-select', options: suppliers, config: { labelKey: 'supplier_name', valueKey: 'supplier_id', subLabelKey: 'location' } },
                   { name: 'currency', label: 'Currency', type: 'select', options: ENUMS.currency },
                   { name: 'component_id', label: 'Component', type: 'rich-select', options: components, config: { labelKey: 'model_sku', valueKey: 'component_id', subLabelKey: 'description' } },
                   { name: 'brand', label: 'Brand', type: 'text', suggestions: suggestions.brands },
                   { name: 'description', label: 'Description', type: 'text', suggestions: suggestions.descriptions },
                   { name: 'quantity', label: 'Qty', type: 'number' },
                   { name: 'unit_cost', label: 'Cost', type: 'number' },
                ]}
                stickyFields={['po_date', 'po_number', 'supplier_id', 'currency']}
                onSubmit={(items: any) => handleInsert('purchase_history', items)} 
                loading={loading}
              />
              <BatchLineItemsForm 
                title="Add Quote History (Batch)"
                formId="quote_hist"
                itemFields={[
                   { name: 'quote_date', label: 'Quote Date', type: 'date' },
                   { name: 'quote_number', label: 'Quote Ref', type: 'text', suggestions: suggestions.quoteNumbers },
                   { name: 'supplier_id', label: 'Supplier', type: 'rich-select', options: suppliers, config: { labelKey: 'supplier_name', valueKey: 'supplier_id', subLabelKey: 'location' } },
                   { name: 'currency', label: 'Currency', type: 'select', options: ENUMS.currency },
                   { name: 'component_id', label: 'Component', type: 'rich-select', options: components, config: { labelKey: 'model_sku', valueKey: 'component_id', subLabelKey: 'description' } },
                   { name: 'brand', label: 'Brand', type: 'text', suggestions: suggestions.brands },
                   { name: 'description', label: 'Description', type: 'text', suggestions: suggestions.descriptions },
                   { name: 'quantity', label: 'Qty', type: 'number' },
                   { name: 'unit_cost', label: 'Cost', type: 'number' },
                ]}
                stickyFields={['quote_date', 'quote_number', 'supplier_id', 'currency']}
                onSubmit={(items: any) => handleInsert('quote_history', items)} 
                loading={loading}
              />
            </div>
          )}

          {/* === NEW DATABASE VIEW TAB === */}
          {activeTab === 'database' && (
             <div className="space-y-12 animate-in fade-in slide-in-from-bottom-4 duration-500">
                {/* Section 1: Foundation */}
                <div className="space-y-6">
                    <h2 className="text-xl font-bold text-emerald-400 border-b border-emerald-900/50 pb-2">1. Foundation Data</h2>
                    <div className="grid grid-cols-1 xl:grid-cols-2 gap-8">
                        <SearchableTable 
                            title="Suppliers"
                            data={suppliers}
                            columns={[
                                { key: 'supplier_name', label: 'Name' },
                                { key: 'location', label: 'Location' },
                                { key: 'supplier_code', label: 'Code' },
                                { key: 'primary_contact_email', label: 'Email' }
                            ]}
                        />
                         <SearchableTable 
                            title="Components"
                            data={components}
                            columns={[
                                { key: 'model_sku', label: 'SKU' },
                                { key: 'description', label: 'Description' },
                                { key: 'brand', label: 'Brand' },
                                { key: 'category', label: 'Category' }
                            ]}
                        />
                         <SearchableTable 
                            title="Companies (Internal)"
                            data={companies}
                            columns={[
                                { key: 'legal_name', label: 'Legal Name' },
                            ]}
                        />
                    </div>
                </div>

                {/* Section 2: Quoting */}
                <div className="space-y-6">
                    <h2 className="text-xl font-bold text-emerald-400 border-b border-emerald-900/50 pb-2">2. Quoting</h2>
                    <div className="grid grid-cols-1 gap-8">
                        <SearchableTable 
                            title="Price Quotes (Headers)"
                            data={quotes}
                            columns={[
                                { key: 'quote_date', label: 'Date' },
                                { key: 'pi_number', label: 'Ref #' },
                                { key: 'supplier', label: 'Supplier', render: (r:any) => getSupplierName(r.supplier_id) },
                                { key: 'total_value', label: 'Total', render: (r:any) => `${r.currency} ${r.total_value}` },
                                { key: 'status', label: 'Status' }
                            ]}
                        />
                        <SearchableTable 
                            title="Quote Items (Detail)"
                            data={quoteItems}
                            columns={[
                                { key: 'sku', label: 'SKU', render: (r:any) => getComponentSku(r.component_id) },
                                { key: 'supplier_description', label: 'Supplier Desc' },
                                { key: 'quantity', label: 'Qty' },
                                { key: 'unit_price', label: 'Price' },
                                { key: 'currency', label: 'Curr' }
                            ]}
                        />
                    </div>
                </div>

                {/* Section 3: Ordering */}
                <div className="space-y-6">
                    <h2 className="text-xl font-bold text-emerald-400 border-b border-emerald-900/50 pb-2">3. Ordering</h2>
                    <div className="grid grid-cols-1 xl:grid-cols-2 gap-8">
                        <SearchableTable 
                            title="Proforma Invoices"
                            data={pis}
                            columns={[
                                { key: 'pi_date', label: 'Date' },
                                { key: 'pi_number', label: 'PI #' },
                                { key: 'status', label: 'Status' }
                            ]}
                        />
                        <SearchableTable 
                            title="Purchase Orders"
                            data={pos}
                            columns={[
                                { key: 'po_date', label: 'Date' },
                                { key: 'po_number', label: 'PO #' },
                                { key: 'total_value', label: 'Total', render: (r:any) => `${r.currency} ${r.total_value}` },
                                { key: 'status', label: 'Status' }
                            ]}
                        />
                    </div>
                     <SearchableTable 
                        title="Purchase Line Items (All)"
                        data={poItems}
                        columns={[
                            { key: 'po_id', label: 'PO ID' },
                            { key: 'sku', label: 'SKU', render: (r:any) => getComponentSku(r.component_id) },
                            { key: 'quantity', label: 'Qty' },
                            { key: 'unit_cost', label: 'Cost' },
                            { key: 'supplier_description', label: 'Desc' }
                        ]}
                    />
                </div>

                {/* Section 4: Financials */}
                <div className="space-y-6">
                    <h2 className="text-xl font-bold text-emerald-400 border-b border-emerald-900/50 pb-2">4. Financials</h2>
                    <div className="grid grid-cols-1 xl:grid-cols-2 gap-8">
                        <SearchableTable 
                            title="Payments Made"
                            data={payments}
                            columns={[
                                { key: 'payment_date', label: 'Date' },
                                { key: 'category', label: 'Category' },
                                { key: 'amount', label: 'Amount', render: (r:any) => `${r.currency} ${r.amount}` },
                                { key: 'notes', label: 'Notes' }
                            ]}
                        />
                        <SearchableTable 
                            title="Landed Costs"
                            data={landedCosts}
                            columns={[
                                { key: 'payment_date', label: 'Date' },
                                { key: 'cost_type', label: 'Type' },
                                { key: 'amount', label: 'Amount', render: (r:any) => `${r.currency} ${r.amount}` },
                                { key: 'notes', label: 'Notes' }
                            ]}
                        />
                    </div>
                </div>

                 {/* Section 5: History */}
                 <div className="space-y-6">
                    <h2 className="text-xl font-bold text-emerald-400 border-b border-emerald-900/50 pb-2">5. Historical Data</h2>
                    <div className="grid grid-cols-1 gap-8">
                        <SearchableTable 
                            title="Purchase History Import"
                            data={poHistory}
                            columns={[
                                { key: 'po_date', label: 'Date' },
                                { key: 'po_number', label: 'PO #' },
                                { key: 'supplier', label: 'Supplier', render: (r:any) => getSupplierName(r.supplier_id) },
                                { key: 'brand', label: 'Brand' },
                                { key: 'description', label: 'Desc' },
                                { key: 'quantity', label: 'Qty' },
                                { key: 'unit_cost', label: 'Cost', render: (r:any) => `${r.currency} ${r.unit_cost}` },
                            ]}
                        />
                        <SearchableTable 
                            title="Quote History Import"
                            data={quoteHistory}
                            columns={[
                                { key: 'quote_date', label: 'Date' },
                                { key: 'quote_number', label: 'Ref #' },
                                { key: 'supplier', label: 'Supplier', render: (r:any) => getSupplierName(r.supplier_id) },
                                { key: 'brand', label: 'Brand' },
                                { key: 'description', label: 'Desc' },
                                { key: 'quantity', label: 'Qty' },
                                { key: 'unit_cost', label: 'Cost', render: (r:any) => `${r.currency} ${r.unit_cost}` },
                            ]}
                        />
                    </div>
                </div>
             </div>
          )}

        </div>
      </main>
    </div>
  );
}

// ============================================
// COMPONENT: Searchable Table (NEW)
// Features: Local search, highlighting, pagination (limit 10 for view)
// ============================================
function SearchableTable({ title, data, columns }: any) {
    const [term, setTerm] = useState('');
    
    const filteredData = useMemo(() => {
        if (!term) return data;
        const lowerTerm = term.toLowerCase();
        return data.filter((row: any) => {
            return columns.some((col: any) => {
                const val = col.render ? col.render(row) : row[col.key];
                return String(val || '').toLowerCase().includes(lowerTerm);
            });
        });
    }, [data, term, columns]);

    const Highlight = ({ text }: { text: string }) => {
        if (!term) return <>{text}</>;
        const parts = text.toString().split(new RegExp(`(${term})`, 'gi'));
        return (
            <>
                {parts.map((part, i) => 
                    part.toLowerCase() === term.toLowerCase() 
                    ? <span key={i} className="bg-emerald-500/50 text-white rounded px-0.5">{part}</span> 
                    : part
                )}
            </>
        );
    };

    return (
        <div className="bg-slate-900 border border-slate-800 rounded-xl overflow-hidden shadow-xl flex flex-col h-full">
            {/* Header + Search Bar */}
            <div className="p-4 border-b border-slate-800 flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 bg-slate-950/30">
                <h3 className="font-bold text-slate-200 flex items-center gap-2 text-sm uppercase tracking-wide">
                    {title}
                    <span className="bg-slate-800 text-slate-400 px-2 py-0.5 rounded text-[10px]">
                        {filteredData.length}
                    </span>
                </h3>
                <div className="relative w-full sm:w-64">
                    <input 
                        type="text" 
                        placeholder="Search table..." 
                        className="w-full bg-slate-950 border border-slate-700 rounded-lg py-1.5 pl-9 pr-3 text-xs text-white focus:outline-none focus:border-emerald-500 transition-colors"
                        value={term}
                        onChange={(e) => setTerm(e.target.value)}
                    />
                    <span className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500 text-xs">🔍</span>
                </div>
            </div>

            {/* Table Area */}
            <div className="overflow-x-auto custom-scrollbar flex-1 max-h-[500px]">
                <table className="w-full text-xs text-left text-slate-400">
                    <thead className="bg-slate-950 text-slate-500 uppercase font-bold tracking-wider sticky top-0 z-10 shadow-sm">
                        <tr>
                            {columns.map((col: any) => <th key={col.key} className="px-6 py-3 whitespace-nowrap bg-slate-950">{col.label}</th>)}
                        </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-800/50">
                        {filteredData.length === 0 ? (
                            <tr><td colSpan={columns.length} className="px-6 py-8 text-center text-slate-600 italic">No matching records found.</td></tr>
                        ) : (
                            filteredData.map((row: any, i: number) => (
                                <tr key={i} className="hover:bg-slate-800/40 transition-colors group">
                                    {columns.map((col: any) => {
                                        const rawVal = col.render ? col.render(row) : (row[col.key] || '-');
                                        return (
                                            <td key={col.key} className="px-6 py-3 whitespace-nowrap text-slate-300 group-hover:text-slate-200">
                                                <Highlight text={String(rawVal)} />
                                            </td>
                                        );
                                    })}
                                </tr>
                            ))
                        )}
                    </tbody>
                </table>
            </div>
        </div>
    );
}

// ============================================
// COMPONENT: Rich Dropdown (Searchable Combobox)
// FIX: Handles typing state properly (doesn't clear on null)
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
    } 
    else if (value === undefined || value === '') {
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
    if (value !== null) onChange(null); 
  };

  return (
    <div className="relative w-full" ref={wrapperRef}>
      <div className="relative">
        <input
          type="text"
          className={`w-full p-2.5 bg-slate-950 border rounded-lg text-sm text-white placeholder-slate-600 focus:outline-none focus:ring-2 focus:ring-emerald-500/50 focus:border-emerald-500 transition-all ${
            isOpen ? 'border-emerald-500 rounded-b-none' : 'border-slate-700'
          }`}
          placeholder={placeholder}
          value={searchTerm}
          onChange={handleInputChange}
          onFocus={() => { 
             setIsOpen(true); 
             if(value === undefined) setSearchTerm(''); 
          }}
        />
        <div className="absolute right-3 top-1/2 -translate-y-1/2 pointer-events-none text-slate-500 text-xs">
          ▼
        </div>
      </div>

      {isOpen && (
        <div className="absolute z-[60] top-full left-0 w-full bg-slate-900 border border-t-0 border-emerald-500/50 rounded-b-lg shadow-2xl overflow-hidden animate-in fade-in zoom-in-95 duration-75">
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
                  className="p-3 border-b border-slate-800/50 cursor-pointer hover:bg-slate-800 transition-colors group flex flex-col gap-0.5 last:border-0"
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
// COMPONENT: Batch Form (Compact & Grid Layout)
// ============================================
function BatchLineItemsForm({ title, parentField, itemFields, onSubmit, loading, stickyFields = [], formId }: any) {
  const uniqueFormId = formId || title.toLowerCase().replace(/\s+/g, '_');
  
  const [parentId, setParentId] = useState('');
  const [items, setItems] = useState<any[]>([]);
  const [draft, setDraft] = useState<any>({});
  
  const handleDraftChange = (field: string, value: any) => setDraft({ ...draft, [field]: value });

  const addItem = () => {
    for (const f of itemFields) {
      if (f.req && !draft[f.name]) return alert(`${f.label} is required`);
    }
    setItems([...items, { ...draft, _id: Date.now() }]);
    
    const nextDraft: any = {};
    stickyFields.forEach((key: string) => {
        if(draft[key]) nextDraft[key] = draft[key];
    });
    if(draft.currency && !nextDraft.currency) nextDraft.currency = draft.currency;

    setDraft(nextDraft);
  };

  const removeItem = (id: number) => setItems(items.filter(i => i._id !== id));
    
  const handleSubmit = () => {
    if (parentField && !parentId) return alert(`Select ${parentField.label}`);
    if (items.length === 0) return alert("Add at least one item");
    
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
          <span className="w-2 h-2 rounded-full bg-emerald-500 shadow-[0_0_8px_rgba(16,185,129,0.5)]"></span> {title}
        </h3>
      </div>

      {parentField && (
        <div className="mb-4 bg-slate-900/50 p-4 rounded-xl border border-slate-800">
            <label className="block text-xs font-bold text-slate-400 mb-2 uppercase tracking-wider">{parentField.label}</label>
            <select 
            className="w-full md:w-1/2 p-3 bg-slate-950 border border-slate-700 rounded-lg text-sm text-white focus:border-emerald-500 focus:ring-2 focus:ring-emerald-500/20 focus:outline-none transition-all"
            value={parentId}
            onChange={(e) => setParentId(e.target.value)}
            >
            <option value="">-- Select --</option>
            {parentField.options.map((o:any) => <option key={o.val} value={o.val}>{o.txt}</option>)}
            </select>
        </div>
      )}

      <div className="bg-slate-900/80 p-4 md:p-5 rounded-xl border border-slate-800 shadow-xl">
        <div className="flex flex-col gap-6">
          {stickyFields.length > 0 && (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 pb-6 border-b border-slate-700/50">
                {itemFields.filter((f:any) => isHeaderField(f.name)).map((f: any) => (
                <FieldRenderer key={f.name} f={f} draft={draft} handleDraftChange={handleDraftChange} formId={uniqueFormId} />
                ))}
            </div>
          )}

          <div className="flex flex-col md:flex-row flex-wrap items-end gap-4">
             {itemFields.filter((f:any) => !isHeaderField(f.name)).map((f: any) => (
               <div key={f.name} className={`w-full ${f.name.includes('description') || f.name.includes('component') ? 'md:flex-[2]' : 'md:flex-1'} min-w-[140px]`}>
                 <FieldRenderer f={f} draft={draft} handleDraftChange={handleDraftChange} formId={uniqueFormId} />
               </div>
            ))}
            
            <button onClick={addItem} className="w-full md:w-auto h-[46px] bg-emerald-600 hover:bg-emerald-500 text-white px-8 rounded-lg text-sm font-bold shadow-lg shadow-emerald-900/20 transition-all active:scale-95 flex items-center justify-center">
              Add Item +
            </button>
          </div>
        </div>
      </div>

      {items.length > 0 && (
        <div className="rounded-xl border border-slate-800 overflow-hidden shadow-lg animate-in fade-in slide-in-from-top-4 duration-300">
          <div className="overflow-x-auto">
            <table className="w-full text-xs text-left text-slate-400">
              <thead className="bg-slate-900 uppercase font-bold text-slate-500 tracking-wider">
                <tr>
                  {itemFields.map((f:any) => <th key={f.name} className="px-4 py-3 whitespace-nowrap">{f.label}</th>)}
                  <th className="px-4 py-3 text-right">Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800 bg-slate-900/40">
                {items.map((item) => (
                  <tr key={item._id} className="hover:bg-slate-800/80 transition-colors">
                    {itemFields.map((f:any) => (
                      <td key={f.name} className="px-4 py-3 whitespace-nowrap text-slate-300 font-medium">
                        {f.type === 'rich-select' 
                          ? (f.options.find((o:any) => o[f.config?.valueKey || 'component_id'] === item[f.name])?.[f.config?.labelKey || 'model_sku']) 
                          : item[f.name]}
                      </td>
                    ))}
                    <td className="px-4 py-3 text-right">
                      <button onClick={() => removeItem(item._id)} className="text-red-400 hover:text-red-300 hover:bg-red-900/30 w-8 h-8 rounded-full flex items-center justify-center transition-all">×</button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="bg-slate-900 p-4 flex justify-between items-center border-t border-slate-800">
            <span className="text-xs text-slate-500">{items.length} items staged</span>
            <button 
              onClick={handleSubmit} 
              disabled={loading}
              className="bg-emerald-600 hover:bg-emerald-500 text-white text-sm font-bold py-2.5 px-6 rounded-lg shadow-md transition-all hover:scale-105 active:scale-95 disabled:opacity-50 disabled:scale-100"
            >
              {loading ? 'Saving...' : `Save All Items`}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

// ============================================
// COMPONENT: Field Renderer
// ============================================
function FieldRenderer({ f, draft, handleDraftChange, formId = 'def' }: any) {
  const listId = `${formId}-${f.name}-list`; 

  return (
    <div className="relative w-full group">
      <label className="block text-[11px] font-bold text-slate-400 mb-2 ml-1 group-focus-within:text-emerald-400 transition-colors">
        {f.label} {f.req && <span className="text-emerald-500">*</span>}
      </label>
      
      {f.type === 'rich-select' ? (
          <RichDropdown 
            options={f.options} 
            value={draft[f.name]} 
            config={f.config}
            onChange={(val: any) => handleDraftChange(f.name, val)}
          />
      ) : f.type === 'select' ? (
        <div className="relative">
             <select 
            className="w-full p-2.5 bg-slate-950 border border-slate-700 rounded-lg text-sm text-white focus:border-emerald-500 focus:ring-2 focus:ring-emerald-500/20 focus:outline-none transition-all appearance-none"
            value={draft[f.name] || ''}
            onChange={(e) => handleDraftChange(f.name, e.target.value)}
            >
                <option value="">- Select -</option>
                {f.options.map((o:any) => typeof o === 'string' ? <option key={o} value={o}>{o}</option> : <option key={o.val} value={o.val}>{o.txt}</option>)}
            </select>
            <div className="absolute right-3 top-1/2 -translate-y-1/2 pointer-events-none text-slate-500 text-xs">▼</div>
        </div>
      ) : (
        <input 
          type={f.type} 
          className="w-full p-2.5 bg-slate-950 border border-slate-700 rounded-lg text-sm text-white focus:border-emerald-500 focus:ring-2 focus:ring-emerald-500/20 focus:outline-none placeholder-slate-600 transition-all [&::-webkit-calendar-picker-indicator]:invert"
          value={draft[f.name] || ''}
          onChange={(e) => handleDraftChange(f.name, e.target.value)}
          placeholder={f.placeholder}
          list={f.suggestions ? listId : undefined} 
        />
      )}
        {f.type === 'text' && f.suggestions && (
          <datalist id={listId}> 
            {(draft[f.name] || '').length >= 1 && f.suggestions.map((val: string, i: number) => <option key={i} value={val} />)}
          </datalist>
        )}
    </div>
  )
}

// ============================================
// COMPONENT: Simple Form (Compact)
// ============================================
function SimpleForm({ title, fields, onSubmit, loading }: any) {
  const [data, setData] = useState<any>({});
  const formId = title.toLowerCase().replace(/\s+/g, '-'); 
    
  useEffect(() => {
    const defaults: any = {};
    fields.forEach((f: any) => { if (f.default) defaults[f.name] = f.default; });
    setData(defaults);
  }, [fields]);

  const handleChange = (e: any) => setData({ ...data, [e.target.name]: e.target.value });
  const handleRichChange = (name: string, val: any) => setData({ ...data, [name]: val });

  return (
    <form onSubmit={(e) => { e.preventDefault(); onSubmit(data); }} className="bg-slate-900 rounded-xl border border-slate-800 p-6 shadow-xl h-full flex flex-col">
      <h3 className="text-base font-bold text-white border-b border-slate-800 pb-4 mb-6 flex items-center gap-3">
        <span className="w-2 h-2 rounded-full bg-emerald-500 shadow-[0_0_8px_rgba(16,185,129,0.5)]"></span>
        {title}
      </h3>
      <div className="grid gap-5 flex-1">
        {fields.map((f: any) => (
          <FieldRenderer key={f.name} f={f} draft={data} handleDraftChange={(name: string, val: any) => {
             if (f.type === 'rich-select') handleRichChange(name, val);
             else handleChange({ target: { name, value: val } });
          }} formId={formId} />
        ))}
      </div>
      <div className="mt-8">
        <button type="submit" disabled={loading} className="w-full bg-emerald-600 hover:bg-emerald-500 text-white font-bold py-3 px-4 rounded-lg text-sm shadow-lg shadow-emerald-900/20 transition-all hover:-translate-y-0.5 active:translate-y-0 disabled:opacity-50 disabled:transform-none">
          {loading ? 'Saving...' : 'Save Record'}
        </button>
      </div>
    </form>
  );
}