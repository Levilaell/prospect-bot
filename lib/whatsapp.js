// Sends outreach messages via WhatsApp Business using Evolution API — BR market only.
// Supports multi-instance rotation when instances are provided via dashboard config.
//
// Post-send persistence is delegated to the CRM via lib/crm-client.js — this
// module no longer writes to `leads` or `conversations` from the send path.
// The CRM endpoints own status transitions, whatsapp_jid backfill, conversation
// row creation, and follow-up scheduling.

import { getClient } from './supabase.js';
import { notifyCrmSent, notifyCrmFailed } from './crm-client.js';

const DELAY_MIN_MS    = 45_000;
const DELAY_MAX_MS    = 120_000;
const RATE_LIMIT_WAIT_MS = 60_000;
const MAX_PER_INSTANCE_PER_DAY = 30;

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

/**
 * Returns next instance in round-robin that hasn't hit MAX_PER_INSTANCE_PER_DAY.
 * Returns null if ALL instances are at or over their daily cap.
 * Caller must treat null as "daily cap reached across all instances — stop".
 */
function nextInstance() {
  const instances = getInstances();
  if (instances.length === 0) throw new Error('No Evolution API instances configured');

  // Try up to `instances.length` times to find one below cap
  for (let tries = 0; tries < instances.length; tries++) {
    const inst = instances[_rrIndex % instances.length];
    _rrIndex++;
    const sentToday = _sentThisRun[inst.name] ?? 0;
    if (sentToday < MAX_PER_INSTANCE_PER_DAY) {
      return inst;
    }
  }

  // All instances are at cap
  return null;
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

// ── Evolution API ─────────────────────────────────────────────────────────────

/**
 * Send one WhatsApp message via Evolution. Always reads the response body (so
 * the caller can forward it to the CRM for remoteJid extraction). Never throws
 * on HTTP non-OK — every outcome is converted into an object.
 *
 * @returns {Promise<
 *   | { ok: true,  body: object|string|null, status: number }
 *   | { ok: false, body: object|string|null, status: number|null,
 *       error_code: 'rate_limited'|'timeout'|'network'|`http_${number}`,
 *       error_message: string }
 * >}
 */
async function sendMessage(phone, text, instance) {
  const { apiUrl, apiKey, name } = instance;

  let res;
  try {
    res = await fetch(`${apiUrl}/message/sendText/${name}`, {
      method:  'POST',
      headers: {
        'Content-Type': 'application/json',
        apikey:         apiKey,
      },
      body: JSON.stringify({ number: phone, textMessage: { text } }),
    });
  } catch (err) {
    const isTimeout = err?.name === 'TimeoutError' || err?.name === 'AbortError';
    return {
      ok: false,
      body: null,
      status: null,
      error_code: isTimeout ? 'timeout' : 'network',
      error_message: `${name}: ${err?.message ?? String(err)}`,
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

  const errorCode = res.status === 429 ? 'rate_limited' : `http_${res.status}`;
  const preview = typeof body === 'string'
    ? body
    : body != null
      ? JSON.stringify(body)
      : '';
  return {
    ok: false,
    body,
    status: res.status,
    error_code: errorCode,
    error_message: `Evolution API HTTP ${res.status} (${name}): ${preview.slice(0, 300)}`,
  };
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

    if (!instance) {
      console.log(`\n  ⛔  All instances reached daily cap (${MAX_PER_INSTANCE_PER_DAY}/day) — stopping run`);
      skipped += toSend.length - i;
      break;
    }

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
    let lastFailure = null;

    while (!sentOk && tried.size < allInstances.length) {
      tried.add(currentInst.name);
      const result = await sendMessage(phone, lead.message, currentInst);

      if (result.ok) {
        const now = new Date().toISOString();

        // In-memory fields are stamped the moment Evolution returned OK — the
        // message has been delivered to the prospect regardless of whether the
        // CRM write succeeds. steps/auto.js still reads these for run summary.
        recordSend(currentInst.name);
        lead.outreach_sent      = true;
        lead.outreach_sent_at   = now;
        lead.outreach_channel   = 'whatsapp';
        lead.evolution_instance = currentInst.name;

        sent++;
        sentOk = true;

        // Delegate all post-send persistence to the CRM: it writes the
        // conversation row, flips status, backfills whatsapp_jid from the
        // Evolution body, sets last_outbound_at, and schedules the follow-up.
        // If the CRM is unreachable after retries, we log loudly but do NOT
        // re-send the message (it was already delivered).
        const notifyResult = await notifyCrmSent({
          place_id:           lead.place_id,
          channel:            'whatsapp',
          message:            lead.message,
          evolution_response: result.body,
          evolution_instance: currentInst.name,
          sent_at:            now,
          is_follow_up:       false,
        });
        if (notifyResult?.exhausted) {
          console.error(
            `❗  CRM /sent failed for ${lead.place_id} — WhatsApp message WAS ` +
            `delivered via ${currentInst.name}; manual reconciliation needed. ` +
            `Error: ${notifyResult.error}`,
          );
        }
        break;
      }

      // Failure path — keep the latest diagnostic for a /failed call later.
      lastFailure = { ...result, instance: currentInst.name };

      if (result.error_code === 'rate_limited') {
        console.warn(`\n⚠️   Rate limited by Evolution API (${currentInst.name}) — waiting 60s`);
        rateLimitedInstances.add(currentInst.name);

        if (rateLimitedInstances.size >= allInstances.length) {
          console.log(`\n  ⛔  All instances rate limited — stopping sends for this run`);
          allRateLimited = true;
          break;
        }

        await new Promise((r) => setTimeout(r, RATE_LIMIT_WAIT_MS));
      } else {
        console.warn(
          `\n⚠️   ${currentInst.name} failed for ${lead.business_name}: ` +
          `${result.error_code} — ${result.error_message ?? ''}`,
        );
      }

      const fallback = allInstances.find(i => !tried.has(i.name));
      if (fallback) {
        console.log(`  🔄  Retrying with ${fallback.name}...`);
        currentInst = fallback;
      }
    }

    if (!sentOk) {
      // All instances failed for this lead — ask the CRM to record the error.
      const err = lastFailure ?? {
        error_code: 'unknown',
        status: null,
        error_message: 'unknown error',
        instance: currentInst?.name ?? null,
      };
      await notifyCrmFailed({
        place_id:           lead.place_id,
        channel:            'whatsapp',
        error:              err.error_message ?? err.error_code ?? 'unknown',
        error_code:         err.error_code ?? 'unknown',
        evolution_instance: err.instance ?? null,
        http_status:        typeof err.status === 'number' ? err.status : null,
      });
      failed++;
    }

    if (allRateLimited) {
      skipped += toSend.length - i - 1;
      break;
    }

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
