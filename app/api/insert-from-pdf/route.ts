import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { TABLE_NAMES } from '@/constants/tableNames';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;

const supabase = createClient(supabaseUrl, supabaseKey, {
  auth: { persistSession: false }
});

interface LineItem {
  model_sku: string;
  description: string;
  quantity: number;
  unit_price: number;
  brand?: string;
}

interface ExtractedData {
  document_type: 'quote' | 'proforma_invoice' | 'purchase_order';
  supplier_name: string;
  supplier_id?: number;
  company_id?: number;
  quote_number?: string;
  quote_date?: string;
  pi_number?: string;
  pi_date?: string;
  po_number?: string;
  po_date?: string;
  currency: string;
  total_value: number;
  payment_terms?: string;
  lead_time_days?: number;
  line_items: LineItem[];
}

export async function POST(request: NextRequest) {
  try {
    const { data, mode } = await request.json();
    const extractedData = data as ExtractedData;

    if (!extractedData || !extractedData.line_items) {
      return NextResponse.json({ error: 'Invalid data' }, { status: 400 });
    }

    if (mode === 'history') {
      // Insert into simplified history tables
      return await insertToHistory(extractedData);
    } else {
      // Insert into formal tables (Quote → Quote Line Items → PI)
      return await insertToFormalTables(extractedData);
    }

  } catch (error) {
    console.error('Insert error:', error);
    return NextResponse.json(
      {
        error: 'Failed to insert data',
        details: error instanceof Error ? error.message : 'Unknown error',
      },
      { status: 500 }
    );
  }
}

async function insertToHistory(data: ExtractedData) {
  // Find or create supplier
  const supplierId = await findOrCreateSupplier(data.supplier_name);

  // Determine which history table
  const tableName = data.document_type === 'purchase_order'
    ? TABLE_NAMES.PURCHASE_HISTORY
    : TABLE_NAMES.QUOTE_HISTORY;

  // Insert each line item
  const historyRecords = data.line_items.map(item => {
    const baseRecord = {
      supplier_id: supplierId,
      brand: item.brand,
      description: item.description,
      quantity: item.quantity,
      unit_cost: item.unit_price,
      currency: data.currency,
    };

    if (data.document_type === 'purchase_order') {
      return {
        ...baseRecord,
        po_date: data.po_date,
        po_number: data.po_number,
      };
    } else {
      return {
        ...baseRecord,
        quote_date: data.quote_date || data.pi_date,
        quote_number: data.quote_number || data.pi_number,
      };
    }
  });

  const { data: inserted, error } = await supabase
    .from(tableName)
    .insert(historyRecords)
    .select();

  if (error) {
    throw new Error(`Failed to insert to ${tableName}: ${error.message}`);
  }

  return NextResponse.json({
    success: true,
    mode: 'history',
    table: tableName,
    records_inserted: inserted?.length || 0,
  });
}

async function insertToFormalTables(data: ExtractedData) {
  // Step 1: Find or create supplier
  const supplierId = await findOrCreateSupplier(data.supplier_name);

  // Step 2: Get default company (or you could add company selection to the UI)
  const { data: companies } = await supabase
    .from(TABLE_NAMES.COMPANIES)
    .select('company_id')
    .limit(1);

  const companyId = data.company_id || companies?.[0]?.company_id || 1;

  // Step 3: Find or create components for each line item
  const componentIds = await Promise.all(
    data.line_items.map(item => findOrCreateComponent(item))
  );

  // Step 4: Insert Price Quote
  const { data: quoteData, error: quoteError } = await supabase
    .from(TABLE_NAMES.PRICE_QUOTES)
    .insert({
      supplier_id: supplierId,
      company_id: companyId,
      quote_date: data.quote_date || data.pi_date || new Date().toISOString().split('T')[0],
      pi_number: data.pi_number || data.quote_number,
      currency: data.currency,
      total_value: data.total_value,
      status: 'accepted',
      estimated_lead_time_days: data.lead_time_days,
    })
    .select()
    .single();

  if (quoteError || !quoteData) {
    throw new Error(`Failed to insert quote: ${quoteError?.message}`);
  }

  const quoteId = quoteData.quote_id;

  // Step 5: Insert Quote Line Items
  const lineItems = data.line_items.map((item, index) => ({
    quote_id: quoteId,
    component_id: componentIds[index],
    supplier_description: item.description,
    quantity: item.quantity,
    unit_price: item.unit_price,
    currency: data.currency,
  }));

  const { data: lineItemsData, error: lineItemsError } = await supabase
    .from(TABLE_NAMES.PRICE_QUOTE_LINE_ITEMS)
    .insert(lineItems)
    .select();

  if (lineItemsError) {
    throw new Error(`Failed to insert line items: ${lineItemsError.message}`);
  }

  // Step 6: Insert Proforma Invoice (if it's a PI document)
  let piId = null;
  if (data.document_type === 'proforma_invoice' && data.pi_number) {
    const { data: piData, error: piError } = await supabase
      .from(TABLE_NAMES.PROFORMA_INVOICES)
      .insert({
        quote_id: quoteId,
        pi_number: data.pi_number,
        pi_date: data.pi_date || new Date().toISOString().split('T')[0],
        status: 'pending',
      })
      .select()
      .single();

    if (piError) {
      console.warn('Failed to insert PI:', piError.message);
    } else {
      piId = piData?.pi_id;
    }
  }

  return NextResponse.json({
    success: true,
    mode: 'formal',
    quote_id: quoteId,
    pi_id: piId,
    line_items_count: lineItemsData?.length || 0,
    supplier_id: supplierId,
  });
}

async function findOrCreateSupplier(supplierName: string): Promise<number> {
  // Try to find existing supplier (fuzzy match)
  const { data: existing } = await supabase
    .from(TABLE_NAMES.SUPPLIERS)
    .select('supplier_id')
    .ilike('supplier_name', `%${supplierName}%`)
    .limit(1);

  if (existing && existing.length > 0) {
    return existing[0].supplier_id;
  }

  // Create new supplier
  const { data: newSupplier, error } = await supabase
    .from(TABLE_NAMES.SUPPLIERS)
    .insert({ supplier_name: supplierName })
    .select('supplier_id')
    .single();

  if (error || !newSupplier) {
    throw new Error(`Failed to create supplier: ${error?.message}`);
  }

  return newSupplier.supplier_id;
}

async function findOrCreateComponent(item: LineItem): Promise<number> {
  // Try to find existing component by SKU
  const { data: existing } = await supabase
    .from(TABLE_NAMES.COMPONENTS)
    .select('component_id')
    .eq('model_sku', item.model_sku)
    .limit(1);

  if (existing && existing.length > 0) {
    return existing[0].component_id;
  }

  // Create new component
  const { data: newComponent, error } = await supabase
    .from(TABLE_NAMES.COMPONENTS)
    .insert({
      model_sku: item.model_sku,
      description: item.description,
      brand: item.brand,
    })
    .select('component_id')
    .single();

  if (error || !newComponent) {
    throw new Error(`Failed to create component: ${error?.message}`);
  }

  return newComponent.component_id;
}
