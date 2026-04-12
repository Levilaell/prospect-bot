// Sends qualified leads to an Instantly.ai campaign and tracks outreach status in Supabase

import { getClient } from './supabase.js';

const INSTANTLY_URL = 'https://api.instantly.ai/api/v2/leads';

export async function getAlreadySentPlaceIds(placeIds) {
  if (!placeIds.length) return new Set();

  const client = getClient();
  const { data, error } = await client
    .from('leads')
    .select('place_id')
    .in('place_id', placeIds)
    .eq('outreach_sent', true);

  if (error) throw new Error(`Supabase query failed: ${error.message}`);
  return new Set((data ?? []).map((r) => r.place_id));
}

function buildInstantlyLead(lead) {
  return {
    email:       lead.email,
    first_name:  lead.business_name,
    company_name: lead.business_name,
    website:     lead.website ?? '',
    phone:       lead.phone   ?? '',
    custom_variables: {
      business_name: lead.business_name,
      city:          lead.city,
      niche:         lead.niche ?? '',
      pain_score:    String(lead.pain_score ?? 0),
      message:       lead.message ?? '',
      email_subject: lead.email_subject ?? '',
      score_reasons: Array.isArray(lead.score_reasons)
        ? lead.score_reasons.join(', ')
        : (lead.score_reasons ?? ''),
    },
  };
}

async function markSentInSupabase(placeIds, sentAt) {
  const client = getClient();
  const { error } = await client
    .from('leads')
    .update({ outreach_sent: true, outreach_sent_at: sentAt, outreach_channel: 'email' })
    .in('place_id', placeIds);

  if (error) console.warn(`⚠️   Supabase outreach update failed: ${error.message}`);
}

export async function sendToInstantly(leads) {
  const apiKey     = process.env.INSTANTLY_API_KEY;
  const campaignId = process.env.INSTANTLY_CAMPAIGN_ID;

  if (!apiKey)     throw new Error('INSTANTLY_API_KEY is not set');
  if (!campaignId) throw new Error('INSTANTLY_CAMPAIGN_ID is not set');

  // Filter out leads without a valid email
  const withEmail = leads.filter((l) => l.email);
  const noEmail   = leads.length - withEmail.length;
  if (noEmail > 0) {
    console.log(`    ⏭️  Skipping ${noEmail} leads without email`);
  }

  let sent   = 0;
  let skipped = noEmail;
  let failed  = 0;

  for (let i = 0; i < withEmail.length; i += 10) {
    const batch     = withEmail.slice(i, i + 10);
    const sentAt    = new Date().toISOString();

    try {
      // Instantly API v2 — send leads one by one (v2 doesn't support batch add to campaign)
      for (const lead of batch) {
        const payload = buildInstantlyLead(lead);
        const res = await fetch(INSTANTLY_URL, {
          method:  'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${apiKey}`,
          },
          body: JSON.stringify({
            campaign: campaignId,
            skip_if_in_workspace: true,
            ...payload,
          }),
        });

        if (!res.ok) {
          const text = await res.text().catch(() => String(res.status));
          throw new Error(`HTTP ${res.status}: ${text}`);
        }
      }

      await markSentInSupabase(batch.map((l) => l.place_id), sentAt);

      // Stamp outreach fields on in-memory lead objects
      for (const lead of batch) {
        lead.outreach_sent     = true;
        lead.outreach_sent_at  = sentAt;
        lead.outreach_channel  = 'email';
      }

      sent += batch.length;
    } catch (err) {
      console.warn(`⚠️   Instantly batch ${Math.floor(i / 10) + 1} failed: ${err.message}`);
      failed += batch.length;
    }
  }

  return { sent, skipped, failed };
}
