import { NextRequest, NextResponse } from 'next/server';
import OpenAI from 'openai';
import { createSupabaseClient } from '@/lib/supabase';

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

export async function POST(request: NextRequest) {
  try {
    const { query } = await request.json();
    const supabase = createSupabaseClient();

    // --- STEP 1: SMART KEYWORD EXTRACTION ---
    // Extract key terms to perform a targeted search across all tables
    const stopWords = ['show', 'me', 'the', 'last', 'compare', 'price', 'history', 'for', 'of', 'trend', 'cost', 'unit', 'true', 'and', 'qty', 'quote', 'quotes', 'po', 'pos', 'is', 'what', 'are', 'icl', 'isl', 'mbs'];
    const keywords = query.toLowerCase().split(/\s+/)
      .filter((w: string) => !stopWords.includes(w) && w.length > 1);

    let filterString = '';
    if (keywords.length > 0) {
      // Build a search filter for Supplier, SKU, or Description
      filterString = keywords.map(k => `supplier_name.ilike.%${k}%,model_sku.ilike.%${k}%,component_name.ilike.%${k}%`).join(',');
    }

    // --- STEP 2: PARALLEL DATA FETCHING (3 SOURCES) ---
    const [poReq, quoteReq, statsReq] = await Promise.all([
      
      // SOURCE A: Purchase Orders (v_analytics_master)
      // Filters by keywords or defaults to recent 5
      filterString 
        ? supabase.from('v_analytics_master').select('*').or(filterString).order('po_date', { ascending: false }).limit(10)
        : supabase.from('v_analytics_master').select('*').order('po_date', { ascending: false }).limit(5),
      
      // SOURCE B: Price Quotes (v_quotes_analytics) - INCORPORATED HERE
      // Filters by same keywords (Supplier/SKU) to find matching offers
      filterString
        ? supabase.from('v_quotes_analytics').select('*').or(filterString).order('quote_date', { ascending: false }).limit(10)
        : supabase.from('v_quotes_analytics').select('*').order('quote_date', { ascending: false }).limit(5),
        
      // SOURCE C: Historical Stats (mv_component_analytics)
      // Uses the Materialized View for ICL/ISL/MBS counts and True Cost Averages
      keywords.length > 0
        ? supabase.from('mv_component_analytics').select('*').or(keywords.map(k => `model_sku.ilike.%${k}%,description.ilike.%${k}%`).join(',')).limit(5)
        : supabase.from('mv_component_analytics').select('*').limit(5)
    ]);

    // --- STEP 3: FORMATTING CONTEXT ---
    
    // 1. POs (Actual Spend)
    const poContext = (poReq.data || []).map((r: any) => 
      `[PO] Date: ${r.po_date}, Supplier: ${r.supplier_name}, SKU: ${r.model_sku}, Item: ${r.component_name?.substring(0,30)}, Qty: ${r.quantity}, True Cost: ${r.true_unit_cost_idr} IDR`
    ).join('\n');

    // 2. Quotes (Offers)
    const quoteContext = (quoteReq.data || []).map((r: any) => 
      `[QUOTE] Date: ${r.quote_date}, Ref: ${r.supplier_quote_ref}, Supplier: ${r.supplier_name}, SKU: ${r.model_sku}, Price: ${r.unit_price} ${r.currency}, Status: ${r.status}`
    ).join('\n');

    // 3. Stats (Trends & Company Counts)
    const statsContext = (statsReq.data || []).map((r: any) => 
      `[STATS] Item: ${r.description}, Avg True Cost: ${r.average_true_unit_cost} IDR, Min: ${r.min_price}, Max: ${r.max_price}, Total Orders: ${r.number_of_po} (ISL=${r.number_of_po_isl}, MBS=${r.number_of_po_mbs}, ICL=${r.number_of_po_icl})`
    ).join('\n');

    // --- STEP 4: SYSTEM PROMPT ---
    const prompt = `
    You are a Supply Chain Intelligence Assistant. Answer STRICTLY based on the 3 datasets below.

    USER QUESTION: "${query}"

    === SOURCE 1: PURCHASE ORDERS (Actual Committed Spend) ===
    * 'True Cost' includes landed costs. Use this for "Last Price Paid".
    ${poContext || '(No matching POs found)'}

    === SOURCE 2: PRICE QUOTES (Supplier Offers) ===
    * Recent offers. Compare these against POs to see if prices are improving.
    ${quoteContext || '(No matching Quotes found)'}

    === SOURCE 3: HISTORICAL STATISTICS (Long-term) ===
    * Use for Averages, Min/Max records, and Company Volume (ICL/ISL/MBS).
    ${statsContext || '(No statistics found)'}

    GUIDELINES:
    1. **Check All Sources:** If the user asks for "Schneider", check both POs and Quotes.
    2. **Prioritize Facts:** If asking for "Volume", use the [STATS] counts (ISL/MBS/ICL).
    3. **Compare:** If you see a recent Quote lower than the last PO, mention it.
    4. **Direct Answer:** No fluff. Start with the data.

    EXAMPLE OUTPUT:
    Last 2 POs for Schneider:
    1. 2025-11-12: MCB 10A (Qty 100) @ 45,000 IDR True Cost
    2. 2025-10-01: Fuse Holder (Qty 50) @ 12,500 IDR True Cost
    
    We also have an active Quote (2025-12-01) offering MCB 10A at 42,000 IDR.
    `;

    const completion = await openai.chat.completions.create({
      model: 'gpt-4o-mini', 
      messages: [
        { role: 'system', content: prompt },
        { role: 'user', content: query },
      ],
      temperature: 0.0, // Strict fact-based
    });

    const answer = completion.choices[0]?.message?.content || 'No answer.';
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
