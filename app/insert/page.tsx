'use client';

import { useState, useEffect } from 'react';
import { createSupabaseClient } from '@/lib/supabase';

// --- Types ---
type Tab = 'foundation' | 'quoting' | 'ordering' | 'financials';

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
  });

  // --- ENUM Definitions ---
  const ENUMS = {
    currency: ['USD', 'RMB', 'IDR'],
    product_category: [
      'accessories', 'batteries', 'box_bsp', 'inverter_charger', 'mounting', 
      'non_stock', 'on_grid_inverter', 'portable_power', 'power_inverter', 
      'pv_cable', 'pv_module', 'solar_charge_controller', 'solar_pump_inverter', 
      'standing_cabinet', 'wallmount_cabinet'
    ],
    payment_category: [
      'down_payment', 'balance_payment', 'additional_balance_payment', 
      'overpayment_credit', 'full_amount_bank_fee', 'telex_bank_fee', 
      'value_today_bank_fee', 'admin_bank_fee', 'inter_bank_transfer_fee'
    ],
    landed_costs_type: [
      'local_import_duty', 'local_vat', 'local_income_tax', 'local_delivery', 
      'demurrage_fee', 'penalty_fee', 'dhl_advance_payment_fee', 'local_import_tax'
    ],
    method_of_shipment: ['Sea', 'Air', 'Local Delivery'],
    price_quotes_status: ['Open', 'Accepted', 'Replaced', 'Rejected', 'Expired'],
    proforma_status: ['Open', 'Accepted', 'Replaced', 'Rejected', 'Expired'],
    purchases_status: ['Draft', 'Sent', 'Confirmed', 'Replaced', 'Partially Received', 'Fully Received', 'Cancelled'],
    lead_time: [
      '2 working day', '3 working days', '5 working days', '7 working days', 
      '10 working days', '14 working days', '20 working days', '21 working days', 
      '30 working days', '35 working days', '45 working days', '60 working days', '90 working days'
    ]
  };

  // --- Helper: Extract Unique Values ---
  const getUnique = (data: any[], key: string) => {
    return Array.from(new Set(data.map(item => item[key]).filter(Boolean))).sort();
  };

  // --- Fetch Data Helper ---
  const refreshData = async () => {
    const [compRows, sup, comp, quo, piData, poData] = await Promise.all([
      supabase.from('1.0_companies').select('company_id, legal_name'),
      supabase.from('2.0_suppliers').select('*'),
      supabase.from('3.0_components').select('*'),
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

    if (sup.data && comp.data && poData.data) {
      setSuggestions({
        brands: getUnique(comp.data, 'brand'),
        locations: getUnique(sup.data, 'location'),
        paymentTerms: Array.from(new Set([
          ...getUnique(sup.data, 'payment_terms_default'),
          ...getUnique(poData.data, 'payment_terms')
        ])).sort(),
        incoterms: getUnique(poData.data, 'incoterms'),
        modelSkus: getUnique(comp.data, 'model_sku'),
        descriptions: getUnique(comp.data, 'description'),
      });
    }
  };

  useEffect(() => {
    refreshData();
  }, []);

  // --- Form Handlers ---
  const handleInsert = async (table: string, data: any) => {
    setLoading(true);
    setMessage('');
    
    // Clean up empty strings and handle JSON
    const cleanData = Object.fromEntries(
      Object.entries(data).map(([k, v]) => {
        if (v === '') return [k, null];
        if (k === 'specifications' && typeof v === 'string') {
          try { return [k, JSON.parse(v)]; } catch { return [k, v]; } 
        }
        return [k, v];
      })
    );

    const { error } = await supabase.from(table).insert([cleanData]);
    setLoading(false);

    if (error) {
      setMessage(`❌ Error in ${table}: ${error.message}`);
    } else {
      setMessage(`✅ Successfully added to ${table}!`);
      refreshData(); 
    }
  };

  // --- Options Generators (Centralized for Consistency) ---
  
  // Quotes: Show "Ref: [Supplier Ref]" instead of UUID
  const quoteOptions = quotes.map(q => ({
    val: q.quote_id,
    txt: `${q.pi_number ? `Ref: ${q.pi_number}` : 'No Ref'} | ${q.currency} ${q.total_value} (${q.quote_date})`
  }));

  // PIs: Standard display
  const piOptions = pis.map(p => ({
    val: p.pi_id,
    txt: `${p.pi_number} (${p.pi_date})`
  }));

  // POs: Show "PO Number (PI: [Related PI])"
  const poOptions = pos.map(p => {
    const relatedPi = pis.find(pi => pi.pi_id === p.pi_id);
    const piText = relatedPi ? ` (PI: ${relatedPi.pi_number})` : '';
    return {
      val: p.po_id,
      txt: `${p.po_number}${piText} - ${p.po_date}`
    };
  });

  return (
    <div className="min-h-screen bg-slate-900 text-slate-100 font-sans">
      <div className="container mx-auto px-4 py-8 max-w-6xl">
        <h1 className="text-3xl font-bold mb-8 text-white flex items-center gap-3">
          <span className="text-emerald-500 text-4xl">⚡</span> 
          <span>Supply Chain Operations</span>
        </h1>
        
        {message && (
          <div className={`p-4 mb-6 rounded-lg border flex items-center gap-2 ${message.includes('Error') ? 'bg-red-900/30 border-red-800 text-red-200' : 'bg-emerald-900/30 border-emerald-800 text-emerald-200'}`}>
            <span>{message.includes('Error') ? '⚠️' : '✓'}</span>
            {message}
          </div>
        )}

        {/* Tabs */}
        <div className="flex space-x-1 mb-6 border-b border-slate-700 overflow-x-auto">
          {[
            { id: 'foundation', label: '1. Foundation' },
            { id: 'quoting', label: '2. Quoting' },
            { id: 'ordering', label: '3. Ordering (PI/PO)' },
            { id: 'financials', label: '4. Financials' },
          ].map((tab) => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id as Tab)}
              className={`px-6 py-3 text-sm font-medium transition-colors whitespace-nowrap rounded-t-lg ${
                activeTab === tab.id 
                ? 'bg-slate-800 border-t border-x border-slate-700 text-emerald-400' 
                : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/50'
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>

        <div className="bg-slate-800 rounded-b-lg shadow-xl border border-slate-700 p-8 min-h-[600px]">
          
          {/* === TAB 1: FOUNDATION === */}
          {activeTab === 'foundation' && (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-10">
              <SimpleForm 
                title="Add New Supplier (2.0_suppliers)"
                fields={[
                  { name: 'supplier_name', label: 'Supplier Name', type: 'text', req: true },
                  { name: 'supplier_code', label: 'Supplier Code', type: 'text', placeholder: 'e.g. SUP-001' },
                  { name: 'location', label: 'Location', type: 'text', suggestions: suggestions.locations },
                  { name: 'primary_contact_email', label: 'Contact Email', type: 'email' },
                  { name: 'payment_terms_default', label: 'Default Payment Terms', type: 'text', suggestions: suggestions.paymentTerms },
                  { name: 'supplier_bank_details', label: 'Bank Details', type: 'textarea' },
                ]}
                onSubmit={(d) => handleInsert('2.0_suppliers', d)}
                loading={loading}
              />
              <SimpleForm 
                title="Add New Component (3.0_components)"
                fields={[
                  { name: 'model_sku', label: 'Model / SKU', type: 'text', req: true, suggestions: suggestions.modelSkus },
                  { name: 'description', label: 'Description', type: 'text', req: true, suggestions: suggestions.descriptions },
                  { name: 'brand', label: 'Brand', type: 'text', suggestions: suggestions.brands },
                  { name: 'category', label: 'Category', type: 'select', options: ENUMS.product_category },
                  { name: 'specifications', label: 'Specifications (JSON)', type: 'textarea', placeholder: '{"watts": 100, "color": "black"}' },
                ]}
                onSubmit={(d) => handleInsert('3.0_components', d)}
                loading={loading}
              />
            </div>
          )}

          {/* === TAB 2: QUOTING === */}
          {activeTab === 'quoting' && (
            <div className="space-y-10">
              <SimpleForm 
                title="Step 1: Create Price Quote Header (4.0_price_quotes)"
                fields={[
                  { name: 'supplier_id', label: 'Supplier', type: 'select', options: suppliers.map(s => ({val: s.supplier_id, txt: s.supplier_name})), req: true },
                  { name: 'company_id', label: 'Addressed To', type: 'select', options: companies.map(c => ({val: c.company_id, txt: c.legal_name})), req: true },
                  { name: 'quote_date', label: 'Quote Date', type: 'date', req: true, default: new Date().toISOString().split('T')[0] },
                  { name: 'pi_number', label: 'Supplier Quote Ref / PI #', type: 'text' },
                  { name: 'currency', label: 'Currency', type: 'select', options: ENUMS.currency, req: true },
                  { name: 'total_value', label: 'Total Value', type: 'number', req: true },
                  { name: 'status', label: 'Status', type: 'select', options: ENUMS.price_quotes_status, default: 'Open' },
                  { name: 'replaces_quote_id', label: 'Replaces Quote', type: 'select', options: quoteOptions },
                  { name: 'estimated_lead_time_days', label: 'Lead Time', type: 'select', options: ENUMS.lead_time },
                ]}
                onSubmit={(d) => handleInsert('4.0_price_quotes', d)}
                loading={loading}
              />
              <div className="border-t border-slate-700 pt-8">
                <SimpleForm 
                  title="Step 2: Add Line Items to Quote (4.1_price_quote_line_items)"
                  fields={[
                    { name: 'quote_id', label: 'Select Quote', type: 'select', options: quoteOptions, req: true },
                    { name: 'component_id', label: 'Component', type: 'select', options: components.map(c => ({val: c.component_id, txt: `${c.model_sku} - ${c.description}`})), req: true },
                    { name: 'supplier_description', label: 'Supplier Description (If different)', type: 'text' },
                    { name: 'quantity', label: 'Quantity', type: 'number', req: true },
                    { name: 'unit_price', label: 'Unit Price', type: 'number', req: true },
                    { name: 'currency', label: 'Currency', type: 'select', options: ENUMS.currency, req: true },
                  ]}
                  onSubmit={(d) => handleInsert('4.1_price_quote_line_items', d)}
                  loading={loading}
                />
              </div>
            </div>
          )}

          {/* === TAB 3: ORDERING === */}
          {activeTab === 'ordering' && (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-10">
               <div className="space-y-10">
                <SimpleForm 
                  title="1. Create Proforma Invoice (5.0_proforma_invoices)"
                  fields={[
                    { name: 'quote_id', label: 'Link to Quote', type: 'select', options: quoteOptions, req: true },
                    { name: 'pi_number', label: 'PI Number', type: 'text', req: true },
                    { name: 'pi_date', label: 'PI Date', type: 'date', req: true, default: new Date().toISOString().split('T')[0] },
                    { name: 'status', label: 'Status', type: 'select', options: ENUMS.proforma_status, default: 'Open' },
                    { name: 'replaces_pi_id', label: 'Replaces PI', type: 'select', options: piOptions },
                  ]}
                  onSubmit={(d) => handleInsert('5.0_proforma_invoices', d)}
                  loading={loading}
                />
                <SimpleForm 
                  title="2. Create Purchase Order (6.0_purchases)"
                  fields={[
                    { name: 'pi_id', label: 'Link to PI', type: 'select', options: piOptions, req: true },
                    { name: 'po_number', label: 'PO Number', type: 'text', req: true },
                    { name: 'po_date', label: 'PO Date', type: 'date', req: true, default: new Date().toISOString().split('T')[0] },
                    { name: 'incoterms', label: 'Incoterms', type: 'text', suggestions: ['FOB', 'EXW', 'CIF', 'DDP', ...suggestions.incoterms] },
                    { name: 'method_of_shipment', label: 'Shipment Method', type: 'select', options: ENUMS.method_of_shipment },
                    { name: 'currency', label: 'PO Currency', type: 'select', options: ENUMS.currency, req: true },
                    { name: 'exchange_rate', label: 'Exchange Rate', type: 'number' },
                    { name: 'total_value', label: 'Total Value', type: 'number' },
                    { name: 'payment_terms', label: 'Payment Terms', type: 'text', suggestions: suggestions.paymentTerms },
                    { name: 'freight_charges_intl', label: 'Freight Charges (Intl)', type: 'number' },
                    { name: 'estimated_delivery_date', label: 'Est. Delivery', type: 'date' },
                    { name: 'actual_delivery_date', label: 'Actual Delivery', type: 'date' },
                    { name: 'actual_received_date', label: 'Actual Received', type: 'date' },
                    { name: 'status', label: 'Status', type: 'select', options: ENUMS.purchases_status, default: 'Draft' },
                    { name: 'replaces_po_id', label: 'Replaces PO', type: 'select', options: poOptions },
                  ]}
                  onSubmit={(d) => handleInsert('6.0_purchases', d)}
                  loading={loading}
                />
              </div>
              <div className="border-l border-slate-700 pl-10">
                <SimpleForm 
                  title="3. Add PO Line Items (6.1_purchase_line_items)"
                  fields={[
                    { name: 'po_id', label: 'Select PO', type: 'select', options: poOptions, req: true },
                    { name: 'component_id', label: 'Component', type: 'select', options: components.map(c => ({val: c.component_id, txt: `${c.model_sku}`})), req: true },
                    { name: 'supplier_description', label: 'Supplier Description (Optional)', type: 'text' },
                    { name: 'quantity', label: 'Quantity', type: 'number', req: true },
                    { name: 'unit_cost', label: 'Unit Cost', type: 'number', req: true },
                    { name: 'currency', label: 'Currency', type: 'select', options: ENUMS.currency, req: true },
                  ]}
                  onSubmit={(d) => handleInsert('6.1_purchase_line_items', d)}
                  loading={loading}
                />
              </div>
            </div>
          )}

          {/* === TAB 4: FINANCIALS === */}
          {activeTab === 'financials' && (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-10">
              <SimpleForm 
                title="Add Payment Record (7.0_payment_details)"
                fields={[
                  { name: 'po_id', label: 'Select PO', type: 'select', options: poOptions, req: true },
                  { name: 'payment_date', label: 'Date', type: 'date', req: true, default: new Date().toISOString().split('T')[0] },
                  { name: 'category', label: 'Category', type: 'select', options: ENUMS.payment_category, req: true },
                  { name: 'amount', label: 'Amount', type: 'number', req: true },
                  { name: 'currency', label: 'Currency', type: 'select', options: ENUMS.currency, req: true },
                  { name: 'notes', label: 'Notes', type: 'textarea' },
                ]}
                onSubmit={(d) => handleInsert('7.0_payment_details', d)}
                loading={loading}
              />
              <SimpleForm 
                title="Add Landed Cost (7.1_landed_costs)"
                fields={[
                  { name: 'po_id', label: 'Select PO', type: 'select', options: poOptions, req: true },
                  { name: 'cost_type', label: 'Cost Type', type: 'select', options: ENUMS.landed_costs_type, req: true },
                  { name: 'amount', label: 'Amount', type: 'number', req: true },
                  { name: 'currency', label: 'Currency', type: 'select', options: ['IDR', 'USD'], default: 'IDR', req: true },
                  { name: 'payment_date', label: 'Payment Date', type: 'date' },
                  { name: 'notes', label: 'Notes', type: 'textarea' },
                ]}
                onSubmit={(d) => handleInsert('7.1_landed_costs', d)}
                loading={loading}
              />
            </div>
          )}

        </div>
      </div>
    </div>
  );
}

// --- Reusable Form Component ---
function SimpleForm({ title, fields, onSubmit, loading }: { 
  title: string; 
  fields: any[]; 
  onSubmit: (data: any) => void; 
  loading: boolean 
}) {
  const [data, setData] = useState<any>({});

  // Initialize defaults
  useEffect(() => {
    const defaults: any = {};
    fields.forEach(f => {
      if (f.default) defaults[f.name] = f.default;
      else if (f.type === 'select' && f.options && f.options.length > 0 && typeof f.options[0] === 'string') {
        defaults[f.name] = f.options[0];
      }
    });
    setData(defaults);
  }, [fields]);

  const handleChange = (e: any) => {
    setData({ ...data, [e.target.name]: e.target.value });
  };

  return (
    <form onSubmit={(e) => { e.preventDefault(); onSubmit(data); }} className="space-y-6">
      <h3 className="text-lg font-medium text-white border-b border-slate-700 pb-3 mb-5 flex items-center gap-2">
        <span className="w-2 h-2 rounded-full bg-emerald-500"></span>
        {title}
      </h3>
      <div className="space-y-5">
        {fields.map((f) => (
          <div key={f.name}>
            <label className="block text-xs font-semibold text-slate-400 mb-2 uppercase tracking-wider">
              {f.label} {f.req && <span className="text-emerald-400">*</span>}
            </label>
            
            {f.type === 'select' ? (
              <select
                name={f.name}
                value={data[f.name] || ''}
                onChange={handleChange}
                required={f.req}
                className="w-full p-3 border border-slate-600 rounded-md text-sm text-white bg-slate-700 focus:ring-2 focus:ring-emerald-500 focus:border-transparent placeholder-slate-400 shadow-sm transition-all outline-none"
              >
                <option value="">-- Select --</option>
                {f.options?.map((opt: any) => (
                  typeof opt === 'string' 
                    ? <option key={opt} value={opt}>{opt}</option>
                    : <option key={opt.val} value={opt.val}>{opt.txt}</option>
                ))}
              </select>
            ) : f.type === 'textarea' ? (
              <textarea
                 name={f.name}
                 value={data[f.name] || ''}
                 onChange={handleChange}
                 required={f.req}
                 className="w-full p-3 border border-slate-600 rounded-md text-sm text-white bg-slate-700 focus:ring-2 focus:ring-emerald-500 focus:border-transparent placeholder-slate-400 shadow-sm transition-all outline-none min-h-[100px]"
                 placeholder={f.placeholder}
              />
            ) : (
              <div className="relative">
                <input
                  type={f.type}
                  name={f.name}
                  value={data[f.name] || ''}
                  onChange={handleChange}
                  required={f.req}
                  list={f.suggestions ? `${f.name}-list` : undefined}
                  className="w-full p-3 border border-slate-600 rounded-md text-sm text-white bg-slate-700 focus:ring-2 focus:ring-emerald-500 focus:border-transparent placeholder-slate-400 shadow-sm transition-all outline-none"
                  step={f.type === 'number' ? '0.01' : undefined}
                  placeholder={f.placeholder}
                />
                {f.suggestions && (
                  // Conditional Rendering: Only render options if length >= 2
                  <datalist id={`${f.name}-list`}>
                    {(data[f.name] || '').length >= 2 && f.suggestions.map((val: string, idx: number) => (
                      <option key={idx} value={val} />
                    ))}
                  </datalist>
                )}
              </div>
            )}
          </div>
        ))}
        <button
          type="submit"
          disabled={loading}
          className="w-full bg-emerald-600 hover:bg-emerald-500 text-white font-bold py-3 px-4 rounded-md shadow-lg transition-all transform hover:scale-[1.02] active:scale-[0.98] text-sm mt-4 disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {loading ? 'Saving Record...' : 'Save Record'}
        </button>
      </div>
    </form>
  );
}
