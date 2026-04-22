#!/usr/bin/env node
/**
 * Populate 9.0_exchange_rate_history with realized FX rates from existing POs
 * Extracts: quoted_amount (foreign) vs paid_amount_idr to calculate implied_rate
 */

const { createClient } = require('@supabase/supabase-js');
const fs = require('fs');
const path = require('path');

// Load .env.local
const envPath = path.join(process.cwd(), '.env.local');
if (fs.existsSync(envPath)) {
  const envContent = fs.readFileSync(envPath, 'utf-8');
  envContent.split('\n').forEach(line => {
    const [key, value] = line.split('=');
    if (key && value) process.env[key.trim()] = value.trim();
  });
}

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseKey) {
  console.error('❌ Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey);

const PRINCIPAL_CATS = new Set(['down_payment', 'balance_payment', 'additional_balance_payment']);

async function populateExchangeRates() {
  console.log('🔄 Fetching POs with quotes and payment data...');

  // Fetch all data
  const [
    { data: pos, error: posError },
    { data: quotes, error: quotesError },
    { data: quoteItems, error: quoteItemsError },
    { data: poCosts, error: poCostsError },
  ] = await Promise.all([
    supabase.from('5.0_purchases').select('*'),
    supabase.from('4.0_price_quotes').select('*'),
    supabase.from('4.1_price_quote_line_items').select('*'),
    supabase.from('6.0_po_costs').select('*'),
  ]);

  if (posError || quotesError || quoteItemsError || poCostsError) {
    console.error('❌ Error fetching data:', {
      posError,
      quotesError,
      quoteItemsError,
      poCostsError,
    });
    process.exit(1);
  }

  console.log(`✓ Fetched ${pos.length} POs, ${quotes.length} quotes, ${quoteItems.length} quote items, ${poCosts.length} cost records`);

  // Build maps
  const quoteMap = new Map(quotes.map(q => [q.quote_id, q]));
  const quoteItemsByQuote = new Map();
  quoteItems.forEach(item => {
    if (!quoteItemsByQuote.has(item.quote_id)) {
      quoteItemsByQuote.set(item.quote_id, []);
    }
    quoteItemsByQuote.get(item.quote_id).push(item);
  });

  const costsByPo = new Map();
  poCosts.forEach(cost => {
    if (!costsByPo.has(cost.po_id)) {
      costsByPo.set(cost.po_id, []);
    }
    costsByPo.get(cost.po_id).push(cost);
  });

  // Extract rates from POs
  const rates = [];

  for (const po of pos) {
    if (!po.quote_id || !po.po_date || !po.currency) continue;

    const quote = quoteMap.get(po.quote_id);
    if (!quote) continue;

    const items = quoteItemsByQuote.get(po.quote_id) || [];
    if (items.length === 0) continue;

    const costs = costsByPo.get(po.po_id) || [];
    if (costs.length === 0) continue;

    // Sum quoted amounts by currency
    const quotedByForeignCurrency = new Map();
    items.forEach(item => {
      const cur = item.currency || 'IDR';
      quotedByForeignCurrency.set(
        cur,
        (quotedByForeignCurrency.get(cur) || 0) + (Number(item.unit_price) * Number(item.quantity))
      );
    });

    // Sum principal payments in IDR
    const principalCosts = costs.filter(c => PRINCIPAL_CATS.has(c.cost_category));
    if (principalCosts.length === 0) continue;

    let totalPaidIdr = 0;
    let latestPaymentDate = null;

    principalCosts.forEach(cost => {
      const amount = cost.currency === 'IDR'
        ? Number(cost.amount)
        : Number(cost.amount) * (Number(cost.exchange_rate) || 1);
      totalPaidIdr += amount;

      if (cost.payment_date) {
        const payDate = new Date(cost.payment_date);
        if (!latestPaymentDate || payDate > latestPaymentDate) {
          latestPaymentDate = payDate;
        }
      }
    });

    if (totalPaidIdr <= 0 || !latestPaymentDate) continue;

    // For each foreign currency in the quote, calculate implied rate
    quotedByForeignCurrency.forEach((quotedAmount, foreignCurrency) => {
      if (foreignCurrency === 'IDR' || quotedAmount <= 0) return;

      const impliedRate = totalPaidIdr / quotedAmount;

      rates.push({
        po_id: po.po_id,
        supplier_id: quote.supplier_id,
        currency: foreignCurrency,
        quoted_amount_foreign: quotedAmount,
        paid_amount_idr: totalPaidIdr,
        implied_rate: impliedRate,
        payment_date: latestPaymentDate.toISOString().split('T')[0],
        notes: `Extracted from PO ${po.po_number} (${po.po_date})`,
      });
    });
  }

  if (rates.length === 0) {
    console.log('⚠️  No valid exchange rate data found in existing POs');
    return;
  }

  console.log(`\n📊 Found ${rates.length} historical exchange rates to insert`);

  // Insert rates
  console.log('\n💾 Inserting exchange rate history...');
  const { error: insertError, data: inserted } = await supabase
    .from('9.0_exchange_rate_history')
    .insert(rates);

  if (insertError) {
    console.error('❌ Error inserting rates:', insertError);
    process.exit(1);
  }

  console.log(`✅ Successfully inserted ${inserted?.length || rates.length} exchange rate records`);

  // Summary by currency
  const byCurrency = new Map();
  rates.forEach(r => {
    if (!byCurrency.has(r.currency)) {
      byCurrency.set(r.currency, []);
    }
    byCurrency.get(r.currency).push(r.implied_rate);
  });

  console.log('\n📈 Exchange rate summary by currency:');
  for (const [currency, ratesList] of byCurrency) {
    const sorted = ratesList.sort((a, b) => a - b);
    const latest = ratesList[ratesList.length - 1];
    const min = sorted[0];
    const max = sorted[sorted.length - 1];
    const avg = ratesList.reduce((a, b) => a + b) / ratesList.length;
    console.log(`  ${currency}: latest=${latest.toFixed(4)}, avg=${avg.toFixed(4)}, range=${min.toFixed(4)}-${max.toFixed(4)}`);
  }

  console.log('\n✨ Exchange rate history population complete!');
}

populateExchangeRates().catch(console.error);
