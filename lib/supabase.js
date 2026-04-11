// Initializes Supabase client and exposes upsert helper keyed by place_id

import { createClient } from '@supabase/supabase-js';

let _client = null;

export function getClient() {
  if (_client) return _client;

  const { SUPABASE_URL, SUPABASE_SERVICE_KEY } = process.env;
  if (!SUPABASE_URL)         throw new Error('SUPABASE_URL is not set');
  if (!SUPABASE_SERVICE_KEY) throw new Error('SUPABASE_SERVICE_KEY is not set');

  _client = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);
  return _client;
}

// Only columns that exist in the Supabase `leads` table.
// Extra fields (collected_at, etc.) are stripped to avoid PostgREST errors.
const LEAD_COLUMNS = [
  'place_id', 'business_name', 'address', 'city', 'search_city', 'phone', 'website',
  'rating', 'review_count', 'perf_score', 'mobile_score', 'fcp', 'lcp', 'cls',
  'has_ssl', 'is_mobile_friendly', 'has_pixel', 'has_analytics', 'has_whatsapp',
  'has_form', 'has_booking', 'tech_stack', 'scrape_failed',
  'visual_score', 'visual_notes',
  'pain_score', 'score_reasons', 'message',
  'email', 'email_source', 'niche',
  'outreach_sent', 'outreach_sent_at', 'outreach_channel',
  'status', 'status_updated_at',
  'message_variant', 'no_website',
];

function prepareRow(lead) {
  const row = {};
  for (const col of LEAD_COLUMNS) {
    if (lead[col] !== undefined) row[col] = lead[col];
  }
  // Convert arrays to comma-separated strings (Supabase text columns)
  if (Array.isArray(row.score_reasons)) row.score_reasons = row.score_reasons.join(', ');
  if (Array.isArray(row.visual_notes))  row.visual_notes  = row.visual_notes.join(', ');
  // Ensure numeric columns are null instead of empty string
  for (const col of ['rating', 'review_count', 'perf_score', 'mobile_score', 'fcp', 'lcp', 'cls', 'visual_score', 'pain_score']) {
    if (row[col] === '' || row[col] === undefined) row[col] = null;
  }
  return row;
}

export async function upsertLeads(leads) {
  const client = getClient();
  const rows   = leads.map(prepareRow);
  let saved = 0;

  for (let i = 0; i < rows.length; i += 50) {
    const batch = rows.slice(i, i + 50);
    const batchNum = Math.floor(i / 50) + 1;
    const { error } = await client
      .from('leads')
      .upsert(batch, { onConflict: 'place_id' });

    if (error) {
      const sample = batch[0]?.place_id ?? 'unknown';
      console.error(`❌  Supabase upsert batch ${batchNum} failed (${batch.length} leads, first: ${sample}): ${error.message}`);
      // Continue with remaining batches instead of aborting
      continue;
    }
    saved += batch.length;
  }

  console.log(`    Supabase: ${saved}/${rows.length} leads saved`);
  if (saved < rows.length) {
    console.warn(`⚠️   ${rows.length - saved} leads failed to save — check errors above`);
  }
}
