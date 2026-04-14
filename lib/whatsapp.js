// Sends outreach messages via WhatsApp Business using Evolution API — BR market only
// Supports multi-instance rotation when instances are provided via dashboard config.

import { getClient } from './supabase.js';

const DELAY_MIN_MS    = 45_000;
const DELAY_MAX_MS    = 120_000;
const RATE_LIMIT_WAIT_MS = 60_000;

class RateLimitError extends Error {
  constructor(instanceName, body) {
    super(`Evolution API HTTP 429 (${instanceName}): ${body}`);
    this.name = 'RateLimitError';
  }
}

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

// ── Instance management ──────────────────────────────────────────────────────

/** Cached instances — set once via setInstances() or falls back to env vars. */
let _instances = null;

/**
 * Set the Evolution API instances from dashboard config.
 * Call this before sendWhatsApp() if dashboard sent instances.
 * @param {{ name: string, apiKey: string }[]} instances
 * @param {string} apiUrl
 */
export function setInstances(instances, apiUrl) {
  _instances = instances.map(i => ({ ...i, apiUrl }));
  console.log(`📱  ${_instances.length} WhatsApp instances configured: ${_instances.map(i => i.name).join(', ')}`);
}

/** Get configured instances — falls back to single instance from env vars. */
export function getInstances() {
  if (_instances && _instances.length > 0) return _instances;
  const baseUrl  = process.env.EVOLUTION_API_URL;
  const apiKey   = process.env.EVOLUTION_API_KEY;
  const instance = process.env.EVOLUTION_INSTANCE;
  if (baseUrl && apiKey && instance) {
    return [{ name: instance, apiKey, apiUrl: baseUrl }];
  }
  return [];
}

/** Round-robin counter — rotates across instances for each new lead. */
let _rrIndex = 0;

function nextInstance() {
  const instances = getInstances();
  if (instances.length === 0) throw new Error('No Evolution API instances configured');
  const inst = instances[_rrIndex % instances.length];
  _rrIndex++;
  return inst;
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

/** Count how many messages a specific instance sent today. */
async function countSentTodayByInstance(instanceName) {
  const client = getClient();
  const startOfDay = new Date();
  startOfDay.setUTCHours(0, 0, 0, 0);

  const { count, error } = await client
    .from('leads')
    .select('*', { count: 'exact', head: true })
    .eq('outreach_channel', 'whatsapp')
    .eq('outreach_sent', true)
    .eq('evolution_instance', instanceName)
    .gte('outreach_sent_at', startOfDay.toISOString());

  if (error) return 0;
  return count ?? 0;
}

/** In-memory counter per instance for current run (faster than querying DB each time). */
const _sentThisRun = {};

function recordSend(instanceName) {
  _sentThisRun[instanceName] = (_sentThisRun[instanceName] ?? 0) + 1;
}

async function markSent(placeId, instanceName, messageText) {
  const client = getClient();
  const now = new Date().toISOString();

  const { error } = await client
    .from('leads')
    .update({
      outreach_sent:      true,
      outreach_sent_at:   now,
      outreach_channel:   'whatsapp',
      evolution_instance: instanceName,
    })
    .eq('place_id', placeId);

  if (error) console.warn(`⚠️   Supabase lead update failed for ${placeId}: ${error.message}`);

  // Save conversation record so it appears in inbox
  const { error: convError } = await client
    .from('conversations')
    .insert({
      place_id:       placeId,
      direction:      'out',
      channel:        'whatsapp',
      message:        messageText,
      sent_at:        now,
      suggested_by_ai: false,
    });

  if (convError) console.warn(`⚠️   Supabase conversation insert failed for ${placeId}: ${convError.message}`);
}

// ── Evolution API ─────────────────────────────────────────────────────────────

async function sendMessage(phone, text, instance) {
  const { apiUrl, apiKey, name } = instance;

  const res = await fetch(`${apiUrl}/message/sendText/${name}`, {
    method:  'POST',
    headers: {
      'Content-Type': 'application/json',
      apikey:         apiKey,
    },
    body: JSON.stringify({ number: phone, textMessage: { text } }),
  });

  if (!res.ok) {
    const body = await res.text().catch(() => String(res.status));
    if (res.status === 429) {
      throw new RateLimitError(name, body);
    }
    throw new Error(`Evolution API HTTP ${res.status} (${name}): ${body}`);
  }
}

// ── Main export ───────────────────────────────────────────────────────────────

export async function sendWhatsApp(leads, { maxSend } = {}) {
  const instances = getInstances();
  if (instances.length === 0) {
    throw new Error('EVOLUTION_API_URL, EVOLUTION_API_KEY and EVOLUTION_INSTANCE must all be set');
  }

  // Initialize per-instance counters from DB
  for (const inst of instances) {
    try {
      _sentThisRun[inst.name] = await countSentTodayByInstance(inst.name);
    } catch {
      _sentThisRun[inst.name] = 0;
    }
  }

  const toSend  = leads;
  let skipped   = 0;

  let sent   = 0;
  let failed = 0;
  const rateLimitedInstances = new Set();
  let allRateLimited = false;

  for (let i = 0; i < toSend.length; i++) {
    const lead      = toSend[i];
    const remaining = toSend.length - i - 1;
    const instance  = nextInstance();
    process.stdout.write(
      `\r  📱  Sending WhatsApp [${i + 1}/${toSend.length}] via ${instance.name}... (${remaining} remaining)`.padEnd(80),
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

    // Try sending — if instance fails or is at limit, try other instances
    let sentOk = false;
    const allInstances = getInstances();
    const tried = new Set();
    let currentInst = instance;

    while (!sentOk && tried.size < allInstances.length) {
      tried.add(currentInst.name);
      try {
        await sendMessage(phone, lead.message, currentInst);
        await markSent(lead.place_id, currentInst.name, lead.message);
        recordSend(currentInst.name);

        lead.outreach_sent    = true;
        lead.outreach_sent_at = new Date().toISOString();
        lead.outreach_channel = 'whatsapp';

        sent++;
        sentOk = true;
      } catch (err) {
        if (err instanceof RateLimitError) {
          console.warn(`\n⚠️   Rate limited by Evolution API — waiting 60s`);
          rateLimitedInstances.add(currentInst.name);

          if (rateLimitedInstances.size >= allInstances.length) {
            console.log(`\n  ⛔  All instances rate limited — stopping sends for this run`);
            allRateLimited = true;
            break;
          }

          await new Promise((r) => setTimeout(r, RATE_LIMIT_WAIT_MS));
        } else {
          console.warn(`\n⚠️   ${currentInst.name} failed for ${lead.business_name}: ${err.message}`);
        }

        const fallback = allInstances.find(i => !tried.has(i.name));
        if (fallback) {
          console.log(`  🔄  Retrying with ${fallback.name}...`);
          currentInst = fallback;
        }
      }
    }

    if (allRateLimited) {
      skipped += toSend.length - i - 1;
      break;
    }

    if (!sentOk) failed++;

    // Check --max-send limit
    if (maxSend && sent >= maxSend) {
      const queued = toSend.length - i - 1;
      process.stdout.write(`\n  📱  Sending WhatsApp [${sent}/${maxSend}]... (limit reached)\n`);
      console.log(`  ⛔  --max-send limit reached — ${queued} leads queued for next run`);
      skipped += queued;
      break;
    }

    // Random delay between sends (45-120s) — mimics human behavior
    if (i < toSend.length - 1) {
      const delay = randomDelay();
      process.stdout.write(`  ⏳  Waiting ${Math.round(delay / 1000)}s before next message...`);
      await new Promise((r) => setTimeout(r, delay));
    }
  }

  process.stdout.write('\n');
  return { sent, skipped, failed, maxSendReached: !!maxSend && sent >= maxSend };
}
