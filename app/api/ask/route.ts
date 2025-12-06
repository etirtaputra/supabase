import { NextRequest, NextResponse } from 'next/server';
import OpenAI from 'openai';
import { createSupabaseClient } from '@/lib/supabase';

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

export async function POST(request: NextRequest) {
  try {
    const { query, cleanMode = false } = await request.json();
    const supabase = createSupabaseClient();

    // Fetch line items (core data) AND components (for descriptions)
    const [
      lineItemsResult,
      purchases,
      components,
      suppliers
    ] = await Promise.all([
      supabase.from('6.1_purchase_line_items').select('*'),
      supabase.from('6.0_purchases').select('*').order('po_date', { ascending: false }),
      supabase.from('3.0_components').select('*'),
      supabase.from('2.0_suppliers').select('*'),
    ]);

    const lineItems = lineItemsResult.data || [];
    const purchaseOrders = purchases.data || [];
    const componentMaster = components.data || [];
    const supplierList = suppliers.data || [];

    const hasComponentData = componentMaster.length > 0;

    // Create a lookup map for faster AI processing
    const componentLookup = componentMaster.reduce((acc, comp) => {
      acc[comp.component_id] = {
        model_sku: comp.model_sku || 'N/A',
        description: comp.description || 'N/A',
        brand: comp.brand || 'N/A'
      };
      return acc;
    }, {} as Record<string, any>);

    const dataContext = {
      line_items: lineItems,
      component_lookup: componentLookup,
      has_component_master: hasComponentData,
      total_line_items: lineItems.length,
      total_components: componentMaster.length,
    };

    const prompt = `You are a data analysis engine. Process the provided data to answer the query.

# INCOMING DATA:
${JSON.stringify(dataContext, null, 2)}

# COMPONENT IDENTIFICATION RULES:
1. **Primary Key**: component_id (from 6.1_purchase_line_items)
2. **Detail Lookup**: Use component_lookup[component_id] to get model_sku, description, brand
3. **Fallback**: If component_lookup is empty or missing an ID, show:
   - component_id (always show this)
   - supplier_description (from line item if available)
   - "Component master data missing" as placeholder

# HOW TO DISPLAY COMPONENTS:
When showing component purchases, ALWAYS display:
| component_id | model_sku | description | quantity | ...other fields |

Example:
| fca1aa8e-1afd-489b-b605-d03296dc80e3 | ABC-123 | DC Fuse 15A | 90 | ...

# QUERY TO ANSWER:
${query}

# INSTRUCTIONS:
1. Group line_items by component_id
2. Sum quantities for each component
3. Look up model_sku/description from component_lookup
4. Sort by total_quantity descending
5. ${cleanMode ? 'Show markdown table only' : 'Explain analysis and show table'}

PROCESS THE DATA ABOVE:`;

    const completion = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [
        { role: 'system', content: prompt },
        { role: 'user', content: query },
      ],
      temperature: 0.1,
      max_tokens: 2000,
    });

    const answer = completion.choices[0]?.message?.content || 'No answer.';

    return NextResponse.json({ answer });
  } catch (error) {
    console.error('API Error:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    );
  }
}
