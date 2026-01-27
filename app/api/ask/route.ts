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
    const stopWords = ['show', 'me', 'the', 'last', 'compare', 'price', 'history', 'for', 'of', 'trend', 'cost', 'unit', 'true', 'and', 'qty', 'quote', 'quotes', 'po', 'pos', 'is', 'what', 'are', 'icl', 'isl', 'mbs'];
    const keywords = query.toLowerCase().split(/\s+/)
      .filter((w: string) => !stopWords.includes(w) && w.length > 1);

    let filterString = '';
    if (keywords.length > 0) {
      filterString = keywords.map((k: string) => `supplier_name.ilike.%${k}%,model_sku.ilike.%${k}%,component_name.ilike.%${k}%`).join(',');
    }

    // --- STEP 2: PARALLEL DATA FETCHING ---
    const [poReq, quoteReq, statsReq] = await Promise.all([
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
        : supabase.from('mv_component_analytics').select('*').limit(5)
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

    // --- STEP 4: SYSTEM PROMPT ---
    const prompt = `
    You are a Supply Chain Intelligence Assistant. Answer STRICTLY based on the 3 datasets below.

    USER QUESTION: "${query}"

    === SOURCE 1: RECENT PURCHASE ORDERS (Actual Spend) ===
    ${poContext || '(No matching POs found)'}

    === SOURCE 2: ACTIVE QUOTES (Supplier Offers) ===
    ${quoteContext || '(No matching Quotes found)'}

    === SOURCE 3: HISTORICAL STATISTICS (Trends) ===
    ${statsContext || '(No statistics found. NOTE: If empty, database view may need refreshing.)'}

    GUIDELINES:
    1. Be Direct.
    2. Prioritize True Cost.
    3. Use the counts in Source 3 for ISL/MBS/ICL questions.
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
