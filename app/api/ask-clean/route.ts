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

    // Fetch the SAME comprehensive data as verbose mode
    const [
      suppliers,
      purchases,
      purchaseLines,
      payments,
      landedCosts,
      components,
      priceQuotes,
      quoteLineItems,
      proformaInvoices
    ] = await Promise.all([
      supabase.from('2.0_suppliers').select('*'),
      supabase.from('6.0_purchases').select('*').limit(20).order('po_date', { ascending: false }),
      supabase.from('6.1_purchase_line_items').select('*').limit(50),
      supabase.from('7.0_payment_details').select('*').limit(20),
      supabase.from('7.1_landed_costs').select('*').limit(20),
      supabase.from('3.0_components').select('*').limit(20),
      supabase.from('4.0_price_quotes').select('*').limit(10),
      supabase.from('4.1_price_quote_line_items').select('*').limit(30),
      supabase.from('5.0_proforma_invoices').select('*').limit(10),
    ]);

    // Try fetching materialized view
    let trueCostData: any[] = [];
    try {
      const result = await supabase.from('mv_po_line_item_true_cost').select('*').limit(10);
      trueCostData = result.data || [];
    } catch (e) {
      console.log('Materialized view not available, skipping...');
    }

    // Build REAL context with actual data
    const context = {
      schema_summary: {
        tables: [
          { name: '2.0_suppliers', rows: suppliers.data?.length || 0 },
          { name: '6.0_purchases', rows: purchases.data?.length || 0 },
          { name: '6.1_purchase_line_items', rows: purchaseLines.data?.length || 0 },
          { name: '7.0_payment_details', rows: payments.data?.length || 0 },
          { name: '7.1_landed_costs', rows: landedCosts.data?.length || 0 },
          { name: '3.0_components', rows: components.data?.length || 0 },
        ],
        materialized_views: [
          { name: 'mv_po_line_item_true_cost', rows: trueCostData.length }
        ]
      },
      real_data: {
        suppliers: suppliers.data || [],
        recent_purchase_orders: purchases.data || [],
        purchase_order_line_items: purchaseLines.data || [],
        payment_details: payments.data || [],
        landed_costs: landedCosts.data || [],
        components: components.data || [],
        true_cost_analysis: trueCostData,
      }
    };

    const systemPrompt = `You are a SQL query engine. Respond ONLY with real data from the provided context.

# REAL DATA PROVIDED:
${JSON.stringify(context.real_data.suppliers.slice(0, 3), null, 2)}

# CRITICAL RULES:
1. **NEVER make up fake data** like "Supplier A", "Supplier B"
2. **ONLY use the real supplier data** provided above
3. Show actual supplier names: Xiamen Mibet, PT Anugrah, etc.
4. Use markdown tables with ALL available fields
5. NO explanations, NO step-by-step, just tables
6. If data is missing, say "No data available"

# USER QUERY: ${query}

# RESPONSE FORMAT:
- Brief 1-sentence answer
- Markdown table with ALL columns from the table
- Use real values only
- Sort by most relevant column`;

    const completion = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: query },
      ],
      temperature: 0.1,
      max_tokens: 1000,
    });

    const answer = completion.choices[0]?.message?.content || 'No answer.';

    return NextResponse.json({ answer });
  } catch (error) {
    console.error('API Error:', error);
    return NextResponse.json(
      { error: 'Query failed' },
      { status: 500 }
    );
  }
}
