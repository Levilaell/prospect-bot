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

function prepareRow(lead) {
  return {
    ...lead,
    score_reasons: Array.isArray(lead.score_reasons)
      ? lead.score_reasons.join(', ')
      : (lead.score_reasons ?? ''),
  };
}

export async function upsertLeads(leads) {
  const client = getClient();
  const rows   = leads.map(prepareRow);

  for (let i = 0; i < rows.length; i += 50) {
    const batch = rows.slice(i, i + 50);
    const { error } = await client
      .from('leads')
      .upsert(batch, { onConflict: 'place_id' });

    if (error) throw new Error(`Supabase upsert failed: ${error.message}`);
  }
}
