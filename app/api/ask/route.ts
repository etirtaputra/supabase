import { NextRequest, NextResponse } from 'next/server';
import Anthropic from '@anthropic-ai/sdk';
import { createClient } from '@supabase/supabase-js';
import { fetchAllRows, fetchAllComponents, type PageResult } from '@/lib/fetchAllRows';
import { computeTUCMap } from '@/lib/computeTUC';
import type { POCost, PurchaseLineItem, PurchaseOrder } from '@/types/database';
import {
  askAllowed, askKeywords, companyCode, withQuoteParties, matchComponents, matchSuppliers,
  purchaseLines, formatPoLines, componentStats, supplierPerformance, formatSupplierPerf,
  type AskComponent, type AskLine, type AskPo,
} from '@/lib/askContext';

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

    // Service role ignores every grant, so this route applies the Ask screen's
    // own gate (buy side) — the menu hiding /ask is not a lock on /api/ask.
    const { data: prof } = await supabase.from('user_profiles').select('role').eq('id', user.id).maybeSingle();
    if (!askAllowed((prof as { role?: string } | null)?.role)) {
      return NextResponse.json({ error: 'Ask ICAPROC is for buy-side roles' }, { status: 403 });
    }

    // --- STEP 1: KEYWORDS ---
    const keywords = askKeywords(query);

    // A source that ERRORS must never read as "nothing matched" — that is how
    // four missing views went unnoticed (lib/askContext.ts).
    const failed: string[] = [];
    const rowsOf = <T,>(name: string, res: { data: T[] | null; error: { message: string } | null }): T[] => {
      if (res.error) { failed.push(name); console.error(`[ask] ${name}:`, res.error.message); }
      return res.data ?? [];
    };
    const allOf = async <T,>(name: string, r: { rows: T[]; error: string | null }): Promise<T[]> => {
      if (r.error) { failed.push(name); console.error(`[ask] ${name}:`, r.error); }
      return r.rows;
    };

    // --- STEP 2: THE BUY SIDE, FROM THE BASE TABLES ---
    // 242 POs / 729 lines / 402 cost rows on 2026-10-02 — read whole, so the
    // True Unit Cost comes from the same engine every screen uses.
    const [poRows, lines, costs, compRows, supplierRows, companyRows, quoteRows] = await Promise.all([
      fetchAllRows<AskPo>((f, t) => supabase.from('5.0_purchases')
        .select('po_id, po_number, po_date, status, quote_id, currency, exchange_rate, total_value, supplier_id, company_id, estimated_delivery_date, actual_received_date')
        .order('po_id').range(f, t)).then((r) => allOf('purchases', r)),
      fetchAllRows<AskLine>((f, t) => supabase.from('5.1_purchase_line_items')
        .select('po_id, component_id, supplier_description, quantity, unit_cost, currency')
        .order('po_line_item_id').range(f, t)).then((r) => allOf('purchase lines', r)),
      fetchAllRows<POCost>((f, t) => supabase.from('6.0_po_costs')
        .select('po_id, cost_category, amount, currency, exchange_rate')
        .order('cost_id').range(f, t) as unknown as PromiseLike<PageResult<POCost>>).then((r) => allOf('PO costs', r)),
      fetchAllComponents<AskComponent>(supabase, 'component_id, internal_description, supplier_model, brand, category'),
      supabase.from('2.0_suppliers').select('supplier_id, supplier_name').then((r) => rowsOf('suppliers', r)),
      supabase.from('1.0_companies').select('company_id, legal_name').then((r) => rowsOf('companies', r)),
      fetchAllRows<{ quote_id: string; supplier_id: string | null; company_id: string | null }>((f, t) => supabase.from('4.0_price_quotes')
        .select('quote_id, supplier_id, company_id').order('quote_id').range(f, t)).then((r) => allOf('supplier quotes', r)),
    ]);
    const pos = withQuoteParties(poRows, quoteRows);
    const comps = new Map(compRows.map((c) => [c.component_id, c]));
    const suppliers = new Map((supplierRows as { supplier_id: string; supplier_name: string }[]).map((s) => [s.supplier_id, s.supplier_name]));
    const companies = new Map((companyRows as { company_id: string; legal_name: string }[]).map((c) => [c.company_id, companyCode(c.legal_name)]));
    const tuc = computeTUCMap(pos as unknown as PurchaseOrder[], lines as unknown as PurchaseLineItem[], costs);

    const matchedComps = matchComponents(compRows, keywords);
    const compIds = new Set(matchedComps.map((c) => c.component_id));
    const suppIds = matchSuppliers(suppliers, keywords);
    const named = compIds.size > 0 || suppIds.size > 0;

    const poLineRows = purchaseLines({
      pos, lines, comps, suppliers, companies, tuc,
      componentIds: named ? compIds : null, supplierIds: named ? suppIds : null, limit: named ? 25 : 12,
    });
    const poContext = formatPoLines(poLineRows);
    const statsContext = componentStats({ componentIds: [...compIds], pos, lines, comps, companies, tuc, limit: 6 });
    const perf = supplierPerformance(pos, suppliers);
    const supplierPerfContext = formatSupplierPerf(
      suppIds.size ? perf.filter((r) => [...suppIds].some((id) => suppliers.get(id) === r.supplier)) : perf.slice(0, 10));

    // POs the question is about (for payments and landed costs, which have no
    // item columns to search): the POs of the matched lines.
    const poNumbers = [...new Set(poLineRows.map((r) => r.poNumber).filter(Boolean))].slice(0, 15);

    // Quote history (the legacy imported supplier quotes) by brand/description.
    const quoteHistFilter = keywords.map((k) => `brand.ilike.%${k}%,description.ilike.%${k}%`).join(',');
    const quoteFilter = keywords.map((k) => `supplier_name.ilike.%${k}%,model_sku.ilike.%${k}%,component_name.ilike.%${k}%`).join(',');

    const [quoteReq, componentDemandReq, paymentTrackingReq, landedCostReq, quoteHistReq] = await Promise.all([
      // Supplier price quotes (current, not superseded)
      keywords.length
        ? supabase.from('v_quotes_analytics').select('*').or(quoteFilter).order('quote_date', { ascending: false }).limit(10)
        : supabase.from('v_quotes_analytics').select('*').order('quote_date', { ascending: false }).limit(5),
      // Component demand
      keywords.length
        ? supabase.from('v_component_demand').select('*').or(keywords.map((k) => `model_sku.ilike.%${k}%,description.ilike.%${k}%,brand.ilike.%${k}%`).join(',')).order('order_frequency', { ascending: false }).limit(5)
        : supabase.from('v_component_demand').select('*').order('order_frequency', { ascending: false }).limit(5),
      // Payments and landed costs: for the POs above when the question names something
      named && poNumbers.length
        ? supabase.from('v_payment_tracking').select('*').in('po_number', poNumbers).order('po_date', { ascending: false }).limit(10)
        : supabase.from('v_payment_tracking').select('*').order('po_date', { ascending: false }).limit(5),
      named && poNumbers.length
        ? supabase.from('v_landed_cost_summary').select('*').in('po_number', poNumbers).order('po_date', { ascending: false }).limit(10)
        : supabase.from('v_landed_cost_summary').select('*').order('po_date', { ascending: false }).limit(5),
      keywords.length
        ? supabase.from('quote_history').select('quote_date, quote_number, supplier_id, brand, description, quantity, unit_cost, currency').or(quoteHistFilter).order('quote_date', { ascending: false }).limit(10)
        : supabase.from('quote_history').select('quote_date, quote_number, supplier_id, brand, description, quantity, unit_cost, currency').order('quote_date', { ascending: false }).limit(10),
    ]);

    // J. Project quotes (client-facing BOM quotes) + their subtotals
    const projectQuoteFilter = keywords.length > 0
      ? keywords.map((k: string) => `customer_name.ilike.%${k}%,quote_number.ilike.%${k}%,project_description.ilike.%${k}%,location.ilike.%${k}%`).join(',')
      : '';
    const [pqReq] = await Promise.all([
      projectQuoteFilter
        ? supabase.from('10.0_project_quotes').select('quote_id, quote_number, quote_date, customer_name, project_description, location, status, ppn_pct, created_by_email, updated_by_email').or(projectQuoteFilter).order('quote_date', { ascending: false }).limit(12)
        : supabase.from('10.0_project_quotes').select('quote_id, quote_number, quote_date, customer_name, project_description, location, status, ppn_pct, created_by_email, updated_by_email').order('quote_date', { ascending: false }).limit(12),
    ]);
    // Items for the quotes we actually selected, not the whole table. This
    // used to fetch every row of 10.2_quote_items to total twelve quotes —
    // which crossed the 1,000-row API cap on 2026-08-28 (1,040 rows) and
    // started silently dropping lines, so the totals came out short. Filtering
    // to the twelve is both correct and a fraction of the payload.
    const pqIds = ((pqReq.data ?? []) as { quote_id: string }[]).map((q) => q.quote_id);
    const pqItemsReq = pqIds.length
      ? await supabase.from('10.2_quote_items')
          .select('quote_id, quantity, sell_price, parent_item_id').in('quote_id', pqIds)
      : { data: [] as { quote_id: string; quantity: number; sell_price: number; parent_item_id: string | null }[] };
    const pqTotals = new Map<string, number>();
    for (const it of pqItemsReq.data ?? []) {
      if (it.parent_item_id) continue;
      const v = (Number(it.quantity) || 0) * (Number(it.sell_price) || 0);
      pqTotals.set(it.quote_id, (pqTotals.get(it.quote_id) ?? 0) + v);
    }

    // --- STEP 3: FORMATTING CONTEXT ---
    const quoteContext = rowsOf('supplier quotes', quoteReq).map((r: any) =>
      `[QUOTE] Date: ${r.quote_date}, Ref: ${r.supplier_quote_ref}, Supplier: ${r.supplier_name}, SKU: ${r.model_sku}, Price: ${r.unit_price} ${r.currency}, Status: ${r.status}`
    ).join('\n');

    const componentDemandContext = rowsOf('component demand', componentDemandReq).map((r: any) =>
      `[DEMAND] ${r.model_sku} (${r.description?.substring(0,30)}): Ordered ${r.order_frequency || 0}x, Total Qty: ${r.total_quantity_ordered || 0}, Avg Qty: ${r.avg_order_quantity?.toFixed(0) || 0}, Last Ordered: ${r.last_ordered_date || 'N/A'}, Price Range: ${r.min_unit_cost?.toFixed(0) || 0}-${r.max_unit_cost?.toFixed(0) || 0}`
    ).join('\n');

    const paymentTrackingContext = rowsOf('payment tracking', paymentTrackingReq).map((r: any) =>
      `[PAYMENT] PO: ${r.po_number}, Date: ${r.po_date}, Supplier: ${r.supplier_name}, Total: ${r.total_value} ${r.currency}, Paid: ${r.total_paid}, Outstanding: ${r.outstanding_balance}, Status: ${r.payment_status}, PO Status: ${r.po_status}`
    ).join('\n');

    const landedCostContext = rowsOf('landed costs', landedCostReq).map((r: any) =>
      `[LANDED COST] PO: ${r.po_number}, Date: ${r.po_date}, Supplier: ${r.supplier_name}, PO Value: ${r.po_value} ${r.currency}, Import Duty: ${r.import_duty}, VAT: ${r.vat}, Income Tax: ${r.income_tax}, Delivery: ${r.delivery_cost}, Total Landed Costs: ${r.total_landed_costs}, True Total: ${r.true_total_cost}`
    ).join('\n');

    const quoteHistContext = rowsOf('quote history', quoteHistReq).map((r: any) =>
      `[QUOTE HIST] Date: ${r.quote_date}, Ref: ${r.quote_number || 'N/A'}, Supplier: ${(r.supplier_id && suppliers.get(r.supplier_id)) || 'N/A'}, Brand: ${r.brand || 'N/A'}, Item: ${r.description?.substring(0, 60) || 'N/A'}, Qty: ${r.quantity || 0}, Unit Cost: ${r.unit_cost} ${r.currency}`
    ).join('\n');

    const projectQuoteContext = rowsOf('project quotes', pqReq).map((r: any) => {
      const sub = pqTotals.get(r.quote_id) ?? 0;
      return `[PROJECT QUOTE] ${r.quote_number} (${(r.status || 'draft').toUpperCase()}), Customer: ${r.customer_name || 'N/A'}, Date: ${r.quote_date}, Project: ${r.project_description?.substring(0, 80) || 'N/A'}, Location: ${r.location || 'N/A'}, Subtotal excl. PPN: ${Math.round(sub)} IDR, Created by: ${r.created_by_email || 'N/A'}, Last edited by: ${r.updated_by_email || 'N/A'}`;
    }).join('\n');


    // --- STEP 4: SYSTEM PROMPT ---
    const prompt = `
    You are ICAPROC's supply-chain assistant for an Indonesian solar EPC company.
    Today's date is ${new Date().toISOString().slice(0, 10)}.
    Answer STRICTLY based on the 9 datasets below.
    ${failed.length ? `\n    WARNING: these sources could not be read this time: ${failed.join(', ')}. Say so if the answer depends on them — do not treat them as "no data".\n` : ''}
    USER QUESTION: "${query}"

    === SOURCE 1: PURCHASE ORDER LINES (actual purchases, newest first; Draft and Replaced POs excluded) ===
    ${poContext || '(No matching purchase lines found)'}

    === SOURCE 2: ACTIVE QUOTES (Supplier Offers) ===
    ${quoteContext || '(No matching Quotes found)'}

    === SOURCE 3: COMPONENT COST STATISTICS (True Unit Cost per item) ===
    ${statsContext || (keywords.length ? '(No purchased item matches the question)' : '(Ask about a specific item to see its cost statistics)')}

    === SOURCE 4: SUPPLIER PERFORMANCE (Reliability & Spend Analysis) ===
    ${supplierPerfContext || '(No supplier performance data available)'}

    === SOURCE 5: COMPONENT DEMAND (Order Frequency & Patterns) ===
    ${componentDemandContext || '(No component demand data available)'}

    === SOURCE 6: PAYMENT TRACKING (Outstanding Balances) ===
    ${paymentTrackingContext || '(No payment tracking data available)'}

    === SOURCE 7: LANDED COSTS (Import Duties & Total Costs) ===
    ${landedCostContext || '(No landed cost data available)'}

    === SOURCE 8: QUOTE HISTORY (older supplier quote records) ===
    ${quoteHistContext || '(No quote history data available)'}

    === SOURCE 9: PROJECT QUOTES (Client-facing sales quotes / BOM) ===
    ${projectQuoteContext || '(No project quotes found)'}

    GUIDELINES:
    1. Be direct and concise. Format with markdown: short paragraphs, bullet lists, and tables where they help.
    2. Prioritize True Unit Cost when discussing what an item really cost: it includes freight, duty and bank fees, excludes VAT/income tax, and exists only for settled POs. Write IDR amounts with thousand separators (Rp1,400,000,000).
    3. Use Source 4 for supplier reliability and delivery performance questions.
    4. Use Source 5 for demand forecasting and reorder analysis.
    5. Use Source 6 for payment status and cash flow questions.
    6. Use Source 7 for total cost calculations including duties and taxes.
    7. Use Sources 1, 3 and 8 for historical price tracking, brand comparisons, and long-term trends.
    8. Use Source 9 for questions about client quotations, sales pipeline, quote status, and who created or edited a quote. Sources 1-8 are the BUYING side (suppliers); Source 9 is the SELLING side (customers) — never mix them up.
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
