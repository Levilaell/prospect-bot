// Sends outreach messages via WhatsApp Business using Evolution API — BR market only

import { getClient } from './supabase.js';

const DAILY_LIMIT     = 15;
const DELAY_MIN_MS    = 45_000;
const DELAY_MAX_MS    = 120_000;

function randomDelay() {
  return DELAY_MIN_MS + Math.floor(Math.random() * (DELAY_MAX_MS - DELAY_MIN_MS));
}

// ── Phone formatting ──────────────────────────────────────────────────────────

function formatPhone(raw) {
  let digits = raw.replace(/\D/g, '');
  if (digits.startsWith('0')) digits = digits.slice(1);
  if (!digits.startsWith('55')) digits = '55' + digits;
  return digits;
}

// ── Supabase helpers ──────────────────────────────────────────────────────────

async function countSentToday() {
  const client   = getClient();
  const startOfDay = new Date();
  startOfDay.setUTCHours(0, 0, 0, 0);

  const { count, error } = await client
    .from('leads')
    .select('*', { count: 'exact', head: true })
    .eq('outreach_channel', 'whatsapp')
    .eq('outreach_sent', true)
    .gte('outreach_sent_at', startOfDay.toISOString());

  if (error) throw new Error(`Supabase daily count failed: ${error.message}`);
  return count ?? 0;
}

async function markSent(placeId) {
  const client = getClient();
  const { error } = await client
    .from('leads')
    .update({
      outreach_sent:    true,
      outreach_sent_at: new Date().toISOString(),
      outreach_channel: 'whatsapp',
    })
    .eq('place_id', placeId);

  if (error) console.warn(`⚠️   Supabase update failed for ${placeId}: ${error.message}`);
}

// ── Evolution API ─────────────────────────────────────────────────────────────

async function sendMessage(phone, text) {
  const baseUrl   = process.env.EVOLUTION_API_URL;
  const apiKey    = process.env.EVOLUTION_API_KEY;
  const instance  = process.env.EVOLUTION_INSTANCE;

  if (!baseUrl || !apiKey || !instance) {
    throw new Error('EVOLUTION_API_URL, EVOLUTION_API_KEY and EVOLUTION_INSTANCE must all be set');
  }

  const res = await fetch(`${baseUrl}/message/sendText/${instance}`, {
    method:  'POST',
    headers: {
      'Content-Type': 'application/json',
      apikey:         apiKey,
    },
    body: JSON.stringify({ number: phone, textMessage: { text } }),
  });

  if (!res.ok) {
    const body = await res.text().catch(() => res.status);
    throw new Error(`Evolution API HTTP ${res.status}: ${body}`);
  }
}

// ── Main export ───────────────────────────────────────────────────────────────

export async function sendWhatsApp(leads) {
  let sentToday;
  try {
    sentToday = await countSentToday();
  } catch (err) {
    console.warn(`⚠️   Could not check daily WhatsApp count: ${err.message}`);
    sentToday = 0;
  }

  const slotsLeft = DAILY_LIMIT - sentToday;

  if (slotsLeft <= 0) {
    console.warn(`⚠️   Daily WhatsApp limit reached (${DAILY_LIMIT}/day) — all leads skipped.`);
    return { sent: 0, skipped: leads.length, failed: 0 };
  }

  const toSend  = leads.slice(0, slotsLeft);
  let skipped   = leads.length - toSend.length;

  let sent   = 0;
  let failed = 0;

  for (let i = 0; i < toSend.length; i++) {
    const lead      = toSend[i];
    const remaining = slotsLeft - sent - 1;
    process.stdout.write(
      `\r  📱  Sending WhatsApp [${i + 1}/${toSend.length}]... (${remaining} remaining today)`.padEnd(72),
    );

    if (!lead.phone) {
      console.warn(`\n⚠️   No phone for ${lead.business_name} — skipping.`);
      failed++;
      continue;
    }

    let phone;
    try {
      phone = formatPhone(lead.phone);
    } catch {
      console.warn(`\n⚠️   Could not format phone "${lead.phone}" for ${lead.business_name} — skipping.`);
      failed++;
      continue;
    }

    // Skip landlines — WhatsApp only works on mobile numbers
    // BR mobile: 9th digit is 9 after the area code (55 + 2-digit DDD + 9 + 8 digits)
    if (!phone.match(/^55\d{2}9\d{8}$/)) {
      console.warn(`\n⚠️   Landline detected for ${lead.business_name} (${phone}) — skipping.`);
      skipped++;
      continue;
    }

    // Re-check Supabase right before sending — guards against parallel runs
    const { data: existing } = await getClient()
      .from('leads')
      .select('outreach_sent')
      .eq('place_id', lead.place_id)
      .single();
    if (existing?.outreach_sent === true) {
      console.warn(`\n⚠️   ${lead.business_name} already sent (parallel run) — skipping.`);
      skipped++;
      continue;
    }

    try {
      await sendMessage(phone, lead.message);
      await markSent(lead.place_id);

      // Stamp in-memory
      lead.outreach_sent    = true;
      lead.outreach_sent_at = new Date().toISOString();
      lead.outreach_channel = 'whatsapp';

      sent++;
    } catch (err) {
      console.warn(`\n⚠️   WhatsApp send failed for ${lead.business_name}: ${err.message}`);
      failed++;
    }

    // Random delay between sends (45-120s) — mimics human behavior
    if (i < toSend.length - 1) {
      const delay = randomDelay();
      process.stdout.write(`  ⏳  Waiting ${Math.round(delay / 1000)}s before next message...`);
      await new Promise((r) => setTimeout(r, delay));
    }
  }

  process.stdout.write('\n');
  return { sent, skipped, failed };
}
