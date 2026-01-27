import { NextRequest, NextResponse } from 'next/server';
import Anthropic from '@anthropic-ai/sdk';
import { createClient } from '@supabase/supabase-js';

// Initialize Anthropic (Claude)
const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY,
});

export async function POST(request: NextRequest) {
  try {
    const { query } = await request.json();

    // --- CRITICAL FIX: USE ADMIN CLIENT ---
    // Try to use the Service Role Key (Admin) to bypass RLS policies.
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
    const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
    console.log("--- DEBUG VERCEL ---");
    console.log("Supabase URL:", supabaseUrl);
    console.log("Using Key (Last 5 chars):", supabaseKey.slice(-5));
    console.log("Is Service Key?", supabaseKey === process.env.SUPABASE_SERVICE_ROLE_KEY ? "YES (Admin)" : "NO (Public/RLS Blocked)");
    
    const supabase = createClient(supabaseUrl, supabaseKey, {
      auth: { persistSession: false }
    });

    // --- STEP 1: SMART KEYWORD EXTRACTION ---
    const stopWords = ['show', 'me', 'the', 'last', 'compare', 'price', 'history', 'for', 'of', 'trend', 'cost', 'unit', 'true', 'and', 'qty', 'quote', 'quotes', 'po', 'pos', 'is', 'what', 'are', 'icl', 'isl', 'mbs', 'by', 'with', 'from', 'to', 'in', 'on'];
    const keywords = query.toLowerCase().split(/\s+/)
      .filter((w: string) => !stopWords.includes(w) && w.length > 1);

    let filterString = '';
    if (keywords.length > 0) {
      filterString = keywords.map((k: string) => `supplier_name.ilike.%${k}%,model_sku.ilike.%${k}%,component_name.ilike.%${k}%`).join(',');
    }

    // --- STEP 2: PARALLEL DATA FETCHING ---
    // Smart filtering: Only filter by specific supplier/component names, not generic terms
    const supplierKeywords = keywords.filter((k: string) =>
      !['total', 'spend', 'supplier', 'suppliers', 'all', 'which', 'performance', 'best', 'worst', 'reliable'].includes(k)
    );
    const supplierFilterString = supplierKeywords.length > 0
      ? supplierKeywords.map((k: string) => `supplier_name.ilike.%${k}%`).join(',')
      : '';

    const [poReq, quoteReq, statsReq, supplierPerfReq, componentDemandReq, paymentTrackingReq, landedCostReq] = await Promise.all([
      // A. Purchase Orders
      filterString
        ? supabase.from('v_analytics_master').select('*').or(filterString).order('po_date', { ascending: false }).limit(10)
        : supabase.from('v_analytics_master').select('*').order('po_date', { ascending: false }).limit(5),

      // B. Price Quotes
      filterString
        ? supabase.from('v_quotes_analytics').select('*').or(filterString).order('quote_date', { ascending: false }).limit(10)
        : supabase.from('v_quotes_analytics').select('*').order('quote_date', { ascending: false }).limit(5),

      // C. Historical Stats
      keywords.length > 0
        ? supabase.from('mv_component_analytics').select('*').or(keywords.map((k: string) => `model_sku.ilike.%${k}%,description.ilike.%${k}%`).join(',')).limit(5)
        : supabase.from('mv_component_analytics').select('*').limit(5),

      // D. Supplier Performance - Only filter if specific supplier names mentioned
      supplierFilterString
        ? supabase.from('v_supplier_performance').select('*').or(supplierFilterString).order('total_spend', { ascending: false }).limit(10)
        : supabase.from('v_supplier_performance').select('*').order('total_spend', { ascending: false }).limit(10),

      // E. Component Demand
      keywords.length > 0
        ? supabase.from('v_component_demand').select('*').or(keywords.map((k: string) => `model_sku.ilike.%${k}%,description.ilike.%${k}%`).join(',')).order('order_frequency', { ascending: false }).limit(5)
        : supabase.from('v_component_demand').select('*').order('order_frequency', { ascending: false }).limit(5),

      // F. Payment Tracking
      filterString
        ? supabase.from('v_payment_tracking').select('*').or(filterString).order('po_date', { ascending: false }).limit(5)
        : supabase.from('v_payment_tracking').select('*').order('po_date', { ascending: false }).limit(5),

      // G. Landed Costs
      filterString
        ? supabase.from('v_landed_cost_summary').select('*').or(filterString).order('po_date', { ascending: false }).limit(5)
        : supabase.from('v_landed_cost_summary').select('*').order('po_date', { ascending: false }).limit(5)
    ]);

    // --- STEP 3: FORMATTING CONTEXT ---
    const poContext = (poReq.data || []).map((r: any) =>
      `[PO] Date: ${r.po_date}, Supplier: ${r.supplier_name}, SKU: ${r.model_sku}, Item: ${r.component_name?.substring(0,30)}, Qty: ${r.quantity}, True Cost: ${r.true_unit_cost_idr} IDR`
    ).join('\n');

    const quoteContext = (quoteReq.data || []).map((r: any) =>
      `[QUOTE] Date: ${r.quote_date}, Ref: ${r.supplier_quote_ref}, Supplier: ${r.supplier_name}, SKU: ${r.model_sku}, Price: ${r.unit_price} ${r.currency}, Status: ${r.status}`
    ).join('\n');

    const statsContext = (statsReq.data || []).map((r: any) =>
      `[STATS] Item: ${r.description}, Avg True Cost: ${r.average_true_unit_cost} IDR, Min: ${r.min_price}, Max: ${r.max_price}, Total Orders: ${r.number_of_po} (Split: ISL=${r.number_of_po_isl}, MBS=${r.number_of_po_mbs}, ICL=${r.number_of_po_icl})`
    ).join('\n');

    const supplierPerfContext = (supplierPerfReq.data || []).map((r: any) =>
      `[SUPPLIER] ${r.supplier_name}: Total Orders: ${r.total_orders || 0}, Total Spend: ${r.total_spend?.toFixed(0) || 0}, Avg Order Value: ${r.avg_order_value?.toFixed(0) || 0}, Avg Delay: ${r.avg_delay_days?.toFixed(1) || 'N/A'} days, Last Order: ${r.last_order_date || 'N/A'}`
    ).join('\n');

    const componentDemandContext = (componentDemandReq.data || []).map((r: any) =>
      `[DEMAND] ${r.model_sku} (${r.description?.substring(0,30)}): Ordered ${r.order_frequency || 0}x, Total Qty: ${r.total_quantity_ordered || 0}, Avg Qty: ${r.avg_order_quantity?.toFixed(0) || 0}, Last Ordered: ${r.last_ordered_date || 'N/A'}, Price Range: ${r.min_unit_cost?.toFixed(0) || 0}-${r.max_unit_cost?.toFixed(0) || 0}`
    ).join('\n');

    const paymentTrackingContext = (paymentTrackingReq.data || []).map((r: any) =>
      `[PAYMENT] PO: ${r.po_number}, Date: ${r.po_date}, Supplier: ${r.supplier_name}, Total: ${r.total_value} ${r.currency}, Paid: ${r.total_paid}, Outstanding: ${r.outstanding_balance}, Status: ${r.payment_status}, PO Status: ${r.po_status}`
    ).join('\n');

    const landedCostContext = (landedCostReq.data || []).map((r: any) =>
      `[LANDED COST] PO: ${r.po_number}, Date: ${r.po_date}, Supplier: ${r.supplier_name}, PO Value: ${r.po_value} ${r.currency}, Import Duty: ${r.import_duty}, VAT: ${r.vat}, Income Tax: ${r.income_tax}, Delivery: ${r.delivery_cost}, Total Landed Costs: ${r.total_landed_costs}, True Total: ${r.true_total_cost}`
    ).join('\n');

    // --- STEP 4: SYSTEM PROMPT ---
    const prompt = `
    You are a Supply Chain Intelligence Assistant. Answer STRICTLY based on the 7 datasets below.

    USER QUESTION: "${query}"

    === SOURCE 1: RECENT PURCHASE ORDERS (Actual Spend) ===
    ${poContext || '(No matching POs found)'}

    === SOURCE 2: ACTIVE QUOTES (Supplier Offers) ===
    ${quoteContext || '(No matching Quotes found)'}

    === SOURCE 3: HISTORICAL STATISTICS (Component Pricing Trends) ===
    ${statsContext || '(No statistics found. NOTE: If empty, database view may need refreshing.)'}

    === SOURCE 4: SUPPLIER PERFORMANCE (Reliability & Spend Analysis) ===
    ${supplierPerfContext || '(No supplier performance data available)'}

    === SOURCE 5: COMPONENT DEMAND (Order Frequency & Patterns) ===
    ${componentDemandContext || '(No component demand data available)'}

    === SOURCE 6: PAYMENT TRACKING (Outstanding Balances) ===
    ${paymentTrackingContext || '(No payment tracking data available)'}

    === SOURCE 7: LANDED COSTS (Import Duties & Total Costs) ===
    ${landedCostContext || '(No landed cost data available)'}

    GUIDELINES:
    1. Be Direct and concise.
    2. Prioritize True Cost data when discussing pricing.
    3. Use Source 4 for supplier reliability and delivery performance questions.
    4. Use Source 5 for demand forecasting and reorder analysis.
    5. Use Source 6 for payment status and cash flow questions.
    6. Use Source 7 for total cost calculations including duties and taxes.
    7. When data is missing or insufficient, clearly state the limitation.
    `;

    const completion = await anthropic.messages.create({
      model: 'claude-3-5-sonnet-20241022',
      max_tokens: 1024,
      system: prompt,
      messages: [
        { role: 'user', content: query },
      ],
      temperature: 0.0,
    });

    const answer = completion.content[0]?.type === 'text' ? completion.content[0].text : 'No answer.';
    const cleanAnswer = answer.replace(/^```markdown\n?/, '').replace(/\n?```$/, '').trim();

    return NextResponse.json({ answer: cleanAnswer });
  } catch (error) {
    console.error('API Error:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    );
  }
}
