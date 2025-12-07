import { createClient } from '@supabase/supabase-js';
import { OpenAIStream, StreamingTextResponse } from 'ai';
import OpenAI from 'openai';

// Initialize OpenAI
const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

// Initialize Supabase ADMIN Client
// We strictly require the Service Role Key to bypass RLS.
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;

if (!supabaseServiceKey) {
  throw new Error("CRITICAL: SUPABASE_SERVICE_ROLE_KEY is missing from .env.local");
}

const supabase = createClient(supabaseUrl, supabaseServiceKey, {
  auth: {
    persistSession: false,
    autoRefreshToken: false,
  },
});

export const runtime = 'edge';

export async function POST(req: Request) {
  try {
    const { messages } = await req.json();
    
    // Get the last user message
    const lastMessage = messages[messages.length - 1];
    const userQuery = lastMessage.content;

    // --- SMART SEARCH LOGIC ---
    // Split query into clean keywords
    const ignoreWords = ['show', 'me', 'the', 'cost', 'price', 'history', 'for', 'of', 'what', 'is', 'a', 'an'];
    const keywords = userQuery
      .toLowerCase()
      .replace(/[^\w\s]/g, '')
      .split(' ')
      .filter((w: string) => w.length > 2 && !ignoreWords.includes(w));

    console.log(`🔎 Searching for keywords: ${keywords.join(', ')}`);

    // --- PARALLEL DB FETCHING ---
    const [historyRes, recentRes, quoteRes] = await Promise.all([
      // 1. Historical Data (Materialized View)
      supabase
        .from('mv_component_analytics')
        .select('*')
        .or(keywords.map(k => `description.ilike.%${k}%,model_sku.ilike.%${k}%`).join(',')),

      // 2. Recent POs (Live Data View)
      supabase
        .from('6.0_purchases')
        .select('*')
        .order('po_date', { ascending: false })
        .limit(5)
        .or(keywords.map(k => `item_description.ilike.%${k}%,po_number.ilike.%${k}%`).join(',')),

      // 3. Active Quotes
      supabase
        .from('4.0_price_quotes')
        .select('*')
        .limit(5)
        .or(keywords.map(k => `item_description.ilike.%${k}%`).join(','))
    ]);

    // --- CONSTRUCT CONTEXT FOR AI ---
    let contextText = "";
    const fmt = (n: any) => n ? "$" + Number(n).toFixed(2) : 'N/A';

    if (historyRes.data && historyRes.data.length > 0) {
      contextText += "\n--- HISTORICAL STATS (MV) ---\n";
      historyRes.data.forEach((row: any) => {
        contextText += "- SKU: " + row.model_sku + "\n  Desc: " + row.description + "\n  True Cost (Avg): " + fmt(row.weighted_avg_true_cost) + "\n  Last PO Price: " + fmt(row.last_po_price) + "\n";
      });
    }

    if (recentRes.data && recentRes.data.length > 0) {
      contextText += "\n--- RECENT PURCHASE ORDERS ---\n";
      recentRes.data.forEach((po: any) => {
        contextText += "- PO: " + po.po_number + " (" + po.po_date + ")\n  Qty: " + po.quantity + " @ " + fmt(po.unit_price) + "\n";
      });
    }

    if (quoteRes.data && quoteRes.data.length > 0) {
      contextText += "\n--- ACTIVE QUOTES ---\n";
      quoteRes.data.forEach((q: any) => {
        contextText += "- Quote ID: " + q.quote_id + "\n  Offer: " + fmt(q.unit_price) + "\n";
      });
    }

    if (!contextText) {
      contextText = "No matching records found in the database.";
    }

    // --- SEND TO OPENAI ---
    const systemPrompt = `
      You are a Supply Chain Analyst Assistant.
      Answer the user's question using ONLY the provided context below.
      - If looking for "True Cost", prioritize the 'weighted_avg_true_cost' from Historical Stats.
      - If looking for "Recent Price", look at Recent Purchase Orders.
      - Be concise and professional.
      
      CONTEXT DATA:
      ${contextText}
    `;

    const response = await openai.chat.completions.create({
      model: 'gpt-4',
      stream: true,
      messages: [
        { role: 'system', content: systemPrompt },
        ...messages
      ],
    });

    return new StreamingTextResponse(OpenAIStream(response));

  } catch (error: any) {
    console.error('API Error:', error);
    return new Response(JSON.stringify({ error: error.message }), { status: 500 });
  }
}
