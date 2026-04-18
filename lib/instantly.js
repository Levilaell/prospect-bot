// Sends qualified leads to an Instantly.ai campaign.
//
// Post-send persistence (leads.outreach_*, conversations) is delegated to the
// CRM via lib/crm-client.js. With this refactor the CRM also inserts a
// `conversations` row for each outbound email — which previously never existed.

import { getClient } from './supabase.js';
import { notifyCrmSent, notifyCrmFailed } from './crm-client.js';

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

/**
 * Send one lead to Instantly. Always reads the response body.
 *
 * @returns {Promise<
 *   | { ok: true,  body: object|string|null, status: number }
 *   | { ok: false, status: number|null,
 *       error_code: 'timeout'|'network'|`http_${number}`,
 *       error_message: string }
 * >}
 */
async function postToInstantly(payload, apiKey, campaignId) {
  let res;
  try {
    res = await fetch(INSTANTLY_URL, {
      method:  'POST',
      headers: {
        'Content-Type':  'application/json',
        'Authorization': `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        campaign:             campaignId,
        skip_if_in_workspace: true,
        ...payload,
      }),
    });
  } catch (err) {
    const isTimeout = err?.name === 'TimeoutError' || err?.name === 'AbortError';
    return {
      ok: false,
      status: null,
      error_code: isTimeout ? 'timeout' : 'network',
      error_message: err?.message ?? String(err),
    };
  }

  let body = null;
  const raw = await res.text().catch(() => '');
  if (raw) {
    try { body = JSON.parse(raw); } catch { body = raw; }
  }

  if (res.ok) {
    return { ok: true, body, status: res.status };
  }

  const preview = typeof body === 'string'
    ? body
    : body != null
      ? JSON.stringify(body)
      : '';
  return {
    ok: false,
    status: res.status,
    error_code: `http_${res.status}`,
    error_message: `Instantly HTTP ${res.status}: ${preview.slice(0, 300)}`,
  };
}

export async function sendToInstantly(leads, { maxSend } = {}) {
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

  let sent    = 0;
  let skipped = noEmail;
  let failed  = 0;

  // Per-lead dispatch — we need per-lead granularity to report sent/failed to
  // the CRM (the old code batched 10 at a time and treated any single failure
  // as a batch-wide failure).
  for (const lead of withEmail) {
    if (maxSend && sent >= maxSend) {
      process.stdout.write(`\n  📧  Sending Instantly [${sent}/${maxSend}]... (limit reached)\n`);
      break;
    }
    const sentAt  = new Date().toISOString();
    const payload = buildInstantlyLead(lead);
    const result  = await postToInstantly(payload, apiKey, campaignId);

    if (result.ok) {
      // In-memory stamp (read by CSV export + run summary)
      lead.outreach_sent    = true;
      lead.outreach_sent_at = sentAt;
      lead.outreach_channel = 'email';

      const notifyResult = await notifyCrmSent({
        place_id:     lead.place_id,
        channel:      'email',
        message:      lead.message ?? '',
        subject:      lead.email_subject ?? null,
        sent_at:      sentAt,
        is_follow_up: false,
      });
      if (notifyResult?.exhausted) {
        console.error(
          `❗  CRM /sent failed for ${lead.place_id} — email WAS accepted by ` +
          `Instantly for ${lead.email}; manual reconciliation needed. ` +
          `Error: ${notifyResult.error}`,
        );
      }
      sent++;
    } else {
      console.warn(
        `⚠️   Instantly send failed for ${lead.place_id} (${lead.email}): ` +
        `${result.error_code} — ${result.error_message}`,
      );
      await notifyCrmFailed({
        place_id:    lead.place_id,
        channel:     'email',
        error:       result.error_message ?? result.error_code ?? 'unknown',
        error_code:  result.error_code ?? 'unknown',
        http_status: typeof result.status === 'number' ? result.status : null,
      });
      failed++;
    }
  }

  return { sent, skipped, failed, maxSendReached: !!maxSend && sent >= maxSend };
}
