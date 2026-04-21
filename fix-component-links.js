#!/usr/bin/env node
/**
 * Fix inverted component links in 8.0_component_links table.
 * Ensures the main component (066ce835-45b4-4643-8a67-9d708e1728bf) is always component_id_a.
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

const MAIN_COMPONENT_ID = '066ce835-45b4-4643-8a67-9d708e1728bf'; // ICAL 4.8kWh

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseKey) {
  console.error('❌ Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey);

async function fixInvertedLinks() {
  console.log('🔍 Fetching all component links...');

  const { data: links, error: fetchError } = await supabase
    .from('8.0_component_links')
    .select('*');

  if (fetchError) {
    console.error('❌ Error fetching links:', fetchError);
    process.exit(1);
  }

  // Find links that should have MAIN_COMPONENT_ID as component_a but don't
  const inverted = links.filter(
    (link) =>
      (link.component_id_a === MAIN_COMPONENT_ID || link.component_id_b === MAIN_COMPONENT_ID) &&
      link.component_id_a !== MAIN_COMPONENT_ID
  );

  if (inverted.length === 0) {
    console.log('✅ No inverted links found. All links are correctly structured.');
    return;
  }

  console.log(`\n⚠️  Found ${inverted.length} inverted link(s):`);
  inverted.forEach((link) => {
    console.log(`  - Link ${link.link_id}`);
    console.log(`    Current: A=${link.component_id_a} (norm_a=${link.norm_value_a}), B=${link.component_id_b} (norm_b=${link.norm_value_b})`);
    console.log(`    Should:  A=${MAIN_COMPONENT_ID} (norm_a=${link.norm_value_b}), B=${link.component_id_a} (norm_b=${link.norm_value_a})`);
  });

  console.log('\n📝 Fixing inverted links...');

  for (const link of inverted) {
    const { error: updateError } = await supabase
      .from('8.0_component_links')
      .update({
        component_id_a: MAIN_COMPONENT_ID,
        component_id_b: link.component_id_a,
        norm_value_a: link.norm_value_b,
        norm_value_b: link.norm_value_a,
      })
      .eq('link_id', link.link_id);

    if (updateError) {
      console.error(`  ❌ Error fixing link ${link.link_id}:`, updateError);
    } else {
      console.log(`  ✅ Fixed link ${link.link_id}`);
    }
  }

  console.log('\n✨ All inverted links fixed!');
}

fixInvertedLinks().catch(console.error);
