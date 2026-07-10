import { NextRequest, NextResponse } from 'next/server';
import Anthropic from '@anthropic-ai/sdk';
import { createClient } from '@supabase/supabase-js';

// Initialize Anthropic (Claude)
const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY,
});

interface HistoryMessage { role: 'user' | 'assistant'; content: string }

export async function POST(request: NextRequest) {
  try {
    const { query, history = [] } = await request.json() as { query: string; history?: HistoryMessage[] };

    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;

    // This route reads with the service-role key, so callers must prove they
    // are signed-in users first
    const token = (request.headers.get('authorization') ?? '').replace(/^Bearer\s+/i, '');
    if (!token) {
      return NextResponse.json({ error: 'Sign in required' }, { status: 401 });
    }
    const authClient = createClient(supabaseUrl, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, {
      auth: { persistSession: false },
    });
    const { data: { user } } = await authClient.auth.getUser(token);
    if (!user) {
      return NextResponse.json({ error: 'Sign in required' }, { status: 401 });
    }

    // Use Service Role Key (Admin) to bypass RLS policies
    const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;

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
      !['total', 'spend', 'supplier', 'suppliers', 'supplie', 'all', 'which', 'performance', 'best', 'worst', 'reliable', 'top'].includes(k)
    );
    const supplierFilterString = supplierKeywords.length > 0
      ? supplierKeywords.map((k: string) => `supplier_name.ilike.%${k}%`).join(',')
      : '';

    // History filter: search by brand, description, model_sku
    const historyFilterString = keywords.length > 0
      ? keywords.map((k: string) => `brand.ilike.%${k}%,description.ilike.%${k}%,model_sku.ilike.%${k}%,supplier_name.ilike.%${k}%`).join(',')
      : '';

    const [poReq, quoteReq, statsReq, supplierPerfReq, componentDemandReq, paymentTrackingReq, landedCostReq, quoteHistReq, poHistReq] = await Promise.all([
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
        ? supabase.from('v_supplier_performance').select('*').or(supplierFilterString).order('total_spend', { ascending: false, nullsFirst: false }).limit(10)
        : supabase.from('v_supplier_performance').select('*').order('total_spend', { ascending: false, nullsFirst: false }).limit(10),

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
        : supabase.from('v_landed_cost_summary').select('*').order('po_date', { ascending: false }).limit(5),

      // H. Quote History
      historyFilterString
        ? supabase.from('v_quote_history_analytics').select('*').or(historyFilterString).order('quote_date', { ascending: false }).limit(10)
        : supabase.from('v_quote_history_analytics').select('*').order('quote_date', { ascending: false }).limit(10),

      // I. Purchase History
      historyFilterString
        ? supabase.from('v_purchase_history_analytics').select('*').or(historyFilterString).order('po_date', { ascending: false }).limit(10)
        : supabase.from('v_purchase_history_analytics').select('*').order('po_date', { ascending: false }).limit(10)
    ]);

    // J. Project quotes (client-facing BOM quotes) + their subtotals
    const projectQuoteFilter = keywords.length > 0
      ? keywords.map((k: string) => `customer_name.ilike.%${k}%,quote_number.ilike.%${k}%,project_description.ilike.%${k}%,location.ilike.%${k}%`).join(',')
      : '';
    const [pqReq, pqItemsReq] = await Promise.all([
      projectQuoteFilter
        ? supabase.from('10.0_project_quotes').select('quote_id, quote_number, quote_date, customer_name, project_description, location, status, ppn_pct, created_by_email, updated_by_email').or(projectQuoteFilter).order('quote_date', { ascending: false }).limit(12)
        : supabase.from('10.0_project_quotes').select('quote_id, quote_number, quote_date, customer_name, project_description, location, status, ppn_pct, created_by_email, updated_by_email').order('quote_date', { ascending: false }).limit(12),
      supabase.from('10.2_quote_items').select('quote_id, quantity, sell_price, parent_item_id'),
    ]);
    const pqTotals = new Map<string, number>();
    for (const it of pqItemsReq.data ?? []) {
      if (it.parent_item_id) continue;
      const v = (Number(it.quantity) || 0) * (Number(it.sell_price) || 0);
      pqTotals.set(it.quote_id, (pqTotals.get(it.quote_id) ?? 0) + v);
    }

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

    const quoteHistContext = (quoteHistReq.data || []).map((r: any) =>
      `[QUOTE HIST] Date: ${r.quote_date}, Supplier: ${r.supplier_name || 'N/A'}, Brand: ${r.brand || 'N/A'}, SKU: ${r.model_sku || 'N/A'}, Item: ${r.description?.substring(0, 40) || 'N/A'}, Qty: ${r.quantity || 0}, Unit Cost: ${r.unit_cost} ${r.currency}`
    ).join('\n');

    const projectQuoteContext = (pqReq.data || []).map((r: any) => {
      const sub = pqTotals.get(r.quote_id) ?? 0;
      return `[PROJECT QUOTE] ${r.quote_number} (${(r.status || 'draft').toUpperCase()}), Customer: ${r.customer_name || 'N/A'}, Date: ${r.quote_date}, Project: ${r.project_description?.substring(0, 80) || 'N/A'}, Location: ${r.location || 'N/A'}, Subtotal excl. PPN: ${Math.round(sub)} IDR, Created by: ${r.created_by_email || 'N/A'}, Last edited by: ${r.updated_by_email || 'N/A'}`;
    }).join('\n');

    const poHistContext = (poHistReq.data || []).map((r: any) =>
      `[PO HIST] Date: ${r.po_date}, PO#: ${r.po_number || 'N/A'}, Supplier: ${r.supplier_name || 'N/A'}, Brand: ${r.brand || 'N/A'}, SKU: ${r.model_sku || 'N/A'}, Item: ${r.description?.substring(0, 40) || 'N/A'}, Qty: ${r.quantity || 0}, Unit Cost: ${r.unit_cost} ${r.currency}`
    ).join('\n');

    // --- STEP 4: SYSTEM PROMPT ---
    const prompt = `
    You are ICAPROC's supply-chain assistant for an Indonesian solar EPC company.
    Today's date is ${new Date().toISOString().slice(0, 10)}.
    Answer STRICTLY based on the 10 datasets below.

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

    === SOURCE 8: QUOTE HISTORY (Historical Quote Records) ===
    ${quoteHistContext || '(No quote history data available)'}

    === SOURCE 9: PURCHASE HISTORY (Historical Purchase Records) ===
    ${poHistContext || '(No purchase history data available)'}

    === SOURCE 10: PROJECT QUOTES (Client-facing sales quotes / BOM) ===
    ${projectQuoteContext || '(No project quotes found)'}

    GUIDELINES:
    1. Be direct and concise. Format with markdown: short paragraphs, bullet lists, and tables where they help.
    2. Prioritize True Cost data when discussing pricing. Write IDR amounts with thousand separators (Rp1,400,000,000).
    3. Use Source 4 for supplier reliability and delivery performance questions.
    4. Use Source 5 for demand forecasting and reorder analysis.
    5. Use Source 6 for payment status and cash flow questions.
    6. Use Source 7 for total cost calculations including duties and taxes.
    7. Use Sources 8 and 9 for historical price tracking, brand comparisons, and long-term trends.
    8. Use Source 10 for questions about client quotations, sales pipeline, quote status, and who created or edited a quote. Sources 1-9 are the BUYING side (suppliers); Source 10 is the SELLING side (customers) — never mix them up.
    9. When data is missing or insufficient, clearly state the limitation.
    `;

    // Keep short-term conversation memory so follow-up questions work
    const priorTurns = (Array.isArray(history) ? history : [])
      .filter((m) => (m?.role === 'user' || m?.role === 'assistant') && typeof m?.content === 'string')
      .slice(-8)
      .map((m) => ({ role: m.role, content: m.content.slice(0, 4000) }));

    const completion = await anthropic.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 2048,
      system: prompt,
      messages: [
        ...priorTurns,
        { role: 'user', content: query },
      ],
      temperature: 0.2,
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
