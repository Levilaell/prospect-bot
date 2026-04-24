// SMS dispatcher stub. Twilio is the intended provider but 10DLC registration
// (required for A2P messaging to US consumers) needs an EIN/US-registered
// entity which doesn't exist yet. Until then, this module returns failures
// with a clear error_code so the admin CRM can mark leads as failed instead
// of silently succeeding.
//
// When 10DLC is ready:
//   1. Install twilio-node
//   2. Set TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, TWILIO_FROM_NUMBER in env
//   3. Replace sendSms() body with: client.messages.create({ from, to, body })
//   4. Parse response.sid into providerMessageId for record-outbound dedup
//   5. Handle Twilio errors (21610=opt-out, 21614=invalid number, etc.)
//
// Keep the interface identical to sendWhatsApp() so steps/auto.js can swap
// the dispatcher purely by channel.

import { notifyCrmSent, notifyCrmFailed } from './crm-client.js';

function formatPhoneUS(raw) {
  const digits = String(raw).replace(/\D/g, '');
  if (digits.startsWith('1') && digits.length === 11) return digits;
  if (digits.length === 10) return '1' + digits;
  return digits;
}

function isValidUS(phone) {
  return /^1\d{10}$/.test(phone);
}

/**
 * Send an SMS — NOT YET IMPLEMENTED.
 *
 * Returns the same shape as sendWhatsApp so callers don't branch on success.
 *
 * @param {string} phone
 * @param {string} text
 * @returns {Promise<{ok:true, providerMessageId?:string}|{ok:false, error_code:string, error_message:string}>}
 */
async function sendSingleSms(phone, text) {
  return {
    ok: false,
    error_code: 'sms_not_configured',
    error_message:
      'SMS provider (Twilio) not configured. Register A2P 10DLC and wire up ' +
      'lib/sms.js before routing US-SMS leads to this path.',
  };
}

/**
 * Batch dispatcher mirroring sendWhatsApp() so steps/auto.js can pick a
 * dispatcher by channel without special-casing the return shape.
 *
 * Today every lead fails with sms_not_configured — CRM records the failure
 * and the lead stays retryable. The run summary reports these as `failed`.
 */
export async function sendSms(leads, { maxSend } = {}) {
  let sent = 0;
  let skipped = 0;
  let failed = 0;

  for (let i = 0; i < leads.length; i++) {
    if (maxSend && sent >= maxSend) {
      skipped += leads.length - i;
      break;
    }

    const lead = leads[i];
    if (!lead.phone) {
      console.warn(`\n⚠️   No phone for ${lead.business_name} — skipping.`);
      failed++;
      continue;
    }

    const phone = formatPhoneUS(lead.phone);
    if (!isValidUS(phone)) {
      console.warn(`\n⚠️   Invalid US number for ${lead.business_name} (${phone}) — skipping.`);
      skipped++;
      continue;
    }

    const result = await sendSingleSms(phone, lead.message);

    if (result.ok) {
      const now = new Date().toISOString();
      lead.outreach_sent = true;
      lead.outreach_sent_at = now;
      lead.outreach_channel = 'sms';

      await notifyCrmSent({
        place_id: lead.place_id,
        channel: 'sms',
        message: lead.message,
        sent_at: now,
        is_follow_up: false,
        provider_message_id: result.providerMessageId ?? null,
      });
      sent++;
    } else {
      console.warn(
        `⚠️   SMS send failed for ${lead.place_id} (${phone}): ${result.error_code} — ${result.error_message}`,
      );
      await notifyCrmFailed({
        place_id: lead.place_id,
        channel: 'sms',
        error: result.error_message,
        error_code: result.error_code,
        http_status: null,
      });
      failed++;
    }
  }

  return { sent, skipped, failed, maxSendReached: !!maxSend && sent >= maxSend };
}
