// Sends outreach messages via WhatsApp Business using Evolution API. Supports
// BR and US markets — each instance carries its own country tag so a BR chip
// can never end up messaging a US number (and vice versa).
//
// Multi-instance rotation uses the set of instances that matches the country
// being dispatched. When dashboard passes per-run config via setInstances()
// it should only include chips that match the run's country.
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

function randomDelay() {
  return DELAY_MIN_MS + Math.floor(Math.random() * (DELAY_MAX_MS - DELAY_MIN_MS));
}

// ── Phone formatting ──────────────────────────────────────────────────────────

/**
 * Format a raw phone into the canonical form Evolution expects.
 *   BR → 55 + DDD + number
 *   US → 1 + area code + number
 *
 * Returns the normalized digits. Validation (mobile vs landline, expected
 * length) happens separately in isMobile{BR,US}().
 */
function formatPhone(raw, country = 'BR') {
  let digits = String(raw).replace(/\D/g, '');

  if (country === 'US') {
    if (digits.startsWith('1') && digits.length === 11) return digits;
    if (digits.length === 10) return '1' + digits;
    return digits;
  }

  // BR default
  if (digits.startsWith('0')) digits = digits.slice(1);
  if (!digits.startsWith('55')) digits = '55' + digits;
  return digits;
}

/**
 * BR mobile check: 9th digit after country+DDD must be 9.
 *   55 + 2-digit DDD + 9 + 8 digits = 13 digits total.
 */
function isMobileBR(phone) {
  return /^55\d{2}9\d{8}$/.test(phone);
}

/**
 * US number check: 1 + 10 digits. US doesn't encode mobile vs landline in
 * the number — we can't filter landlines here. Downstream, Evolution returns
 * `exists: false` for numbers not on WhatsApp; that's the real gate.
 */
function isValidUS(phone) {
  return /^1\d{10}$/.test(phone);
}

function isValidForCountry(phone, country) {
  if (country === 'US') return isValidUS(phone);
  return isMobileBR(phone);
}

// ── Instance management ──────────────────────────────────────────────────────

/** Cached instances — set once via setInstances() or falls back to env vars. */
let _instances = null;

/**
 * Set the Evolution API instances from dashboard config.
 * Call this before sendWhatsApp() if dashboard sent instances.
 * @param {{ name: string, apiKey: string, maxThisRun?: number }[]} instances
 * @param {string} apiUrl
 *
 * `maxThisRun` is optional per-instance. When set, the bot stops sending via
 * that instance once its counter reaches the value, even if the daily cap
 * hasn't been hit. Undefined = no run cap (only daily cap applies).
 */
export function setInstances(instances, apiUrl) {
  _instances = instances.map(i => ({ ...i, apiUrl }));
  const parts = _instances.map(i =>
    i.maxThisRun != null ? `${i.name}(run≤${i.maxThisRun})` : i.name,
  );
  console.log(`📱  ${_instances.length} WhatsApp instances configured: ${parts.join(', ')}`);
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
 * Returns next instance in round-robin that hasn't hit its run cap
 * (`maxThisRun`, set by dashboard per-run). Returns null if all instances
 * are capped — caller must treat null as "capacity exhausted this run,
 * stop the whole queue loop" (not just sends).
 *
 * The bot used to also enforce a daily_cap from `evolution_instance_config`,
 * but that was removed: the dashboard now treats each run as the unit of
 * intent (user picks the target count per run), and a daily cap in the DB
 * surprises users by silently blocking sends across runs. If you need
 * per-day protection, set a conservative `maxThisRun` per run.
 */
function nextInstance() {
  const instances = getInstances();
  if (instances.length === 0) throw new Error('No Evolution API instances configured');

  for (let tries = 0; tries < instances.length; tries++) {
    const inst = instances[_rrIndex % instances.length];
    _rrIndex++;
    const sentSoFar = _sentThisRun[inst.name] ?? 0;
    const runCap = inst.maxThisRun;  // undefined = unlimited for this run

    if (runCap == null || sentSoFar < runCap) return inst;
  }

  return null;
}

/** In-memory counter per instance for the current send batch. */
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

// ── WhatsApp registration check ───────────────────────────────────────────────

/**
 * Batch-check which phone numbers are registered on WhatsApp via Evolution's
 * `/chat/whatsappNumbers` endpoint. Lookup only — doesn't send anything, so
 * any active instance works (the endpoint doesn't care about country).
 *
 * Called from steps/auto.js before creating US projects: a number without
 * WhatsApp will never convert via WA outreach, so skipping it up front saves
 * ~$0.72/lead in downstream Opus + Getimg preview spend.
 *
 * Fail-open: if the Evolution lookup itself errors (network, timeout, 5xx),
 * we mark every input phone as "has WA" and set `errored: true`. The caller
 * logs a warning but continues — better to generate a few unnecessary previews
 * than block the entire run because one HTTP call hiccupped.
 *
 * @param {string[]} rawPhones - phones in any shape; normalized internally.
 * @param {object} [opts]
 * @param {'BR'|'US'} [opts.country] - formatting target. Defaults to 'US'.
 * @returns {Promise<{ existing: Set<string>, nonExisting: Set<string>, errored: boolean }>}
 *   Sets contain normalized digits-only phones (e.g. '17133642269').
 */
export async function checkWhatsappNumbers(rawPhones, { country = 'US' } = {}) {
  const instances = getInstances();
  if (instances.length === 0) {
    throw new Error('No Evolution API instances configured');
  }
  const inst = instances[0];

  const normalized = [];
  const seen = new Set();
  for (const raw of rawPhones) {
    if (!raw) continue;
    let phone;
    try { phone = formatPhone(raw, country); } catch { continue; }
    if (!isValidForCountry(phone, country)) continue;
    if (seen.has(phone)) continue;
    seen.add(phone);
    normalized.push(phone);
  }

  const existing = new Set();
  const nonExisting = new Set();

  if (normalized.length === 0) return { existing, nonExisting, errored: false };

  try {
    const res = await fetch(`${inst.apiUrl}/chat/whatsappNumbers/${inst.name}`, {
      method:  'POST',
      headers: {
        'Content-Type': 'application/json',
        apikey:         inst.apiKey,
      },
      body: JSON.stringify({ numbers: normalized }),
    });

    if (!res.ok) {
      const body = await res.text().catch(() => '');
      console.warn(
        `⚠️   checkWhatsappNumbers: Evolution returned HTTP ${res.status} (${inst.name}) — ` +
        `skipping pre-filter, assuming all ${normalized.length} numbers valid. ` +
        `Body: ${body.slice(0, 200)}`,
      );
      for (const p of normalized) existing.add(p);
      return { existing, nonExisting, errored: true };
    }

    const body = await res.json();
    if (!Array.isArray(body)) {
      console.warn(`⚠️   checkWhatsappNumbers: unexpected response shape — skipping pre-filter.`);
      for (const p of normalized) existing.add(p);
      return { existing, nonExisting, errored: true };
    }

    for (const row of body) {
      const key = row?.number || (row?.jid || '').replace(/@.*/, '');
      if (!key) continue;
      if (row.exists) existing.add(key);
      else nonExisting.add(key);
    }
    return { existing, nonExisting, errored: false };
  } catch (err) {
    console.warn(`⚠️   checkWhatsappNumbers failed: ${err?.message ?? err} — skipping pre-filter.`);
    for (const p of normalized) existing.add(p);
    return { existing, nonExisting, errored: true };
  }
}

/**
 * Normalize a raw phone the same way `checkWhatsappNumbers` does, so callers
 * can key the returned Sets against their own leads.
 */
export function normalizePhone(raw, country = 'US') {
  if (!raw) return null;
  let phone;
  try { phone = formatPhone(raw, country); } catch { return null; }
  if (!isValidForCountry(phone, country)) return null;
  return phone;
}

// ── Main export ───────────────────────────────────────────────────────────────

/**
 * Send outreach WhatsApp messages for a batch of leads.
 *
 * @param {Array} leads - qualified leads with `phone`, `message`, `place_id`
 * @param {Object} [opts]
 * @param {number} [opts.maxSend] - stop after N successful sends
 * @param {string} [opts.country] - 'BR' or 'US'. Gates phone formatting and
 *   mobile validation. Defaults to 'BR' for backwards compatibility with the
 *   legacy single-market setup.
 */
export async function sendWhatsApp(leads, { maxSend, country = 'BR' } = {}) {
  const instances = getInstances();
  if (instances.length === 0) {
    throw new Error('EVOLUTION_API_URL, EVOLUTION_API_KEY and EVOLUTION_INSTANCE must all be set');
  }

  // In-memory counters reset at the start of each send batch. We don't
  // pre-seed from Supabase any more: the dashboard treats each run as an
  // atomic unit of intent, so only `maxThisRun` gates the send, counting
  // sends done within *this* batch.
  for (const inst of instances) {
    _sentThisRun[inst.name] = 0;
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
      const status = getInstances().map(inst => {
        const sent = _sentThisRun[inst.name] ?? 0;
        const run = inst.maxThisRun;
        const reason = run != null && sent >= run ? `run ${sent}/${run}` : 'ok';
        return `${inst.name}(${reason})`;
      }).join(', ');
      console.log(`\n  ⛔  No instance available — ${status} — stopping run`);
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
      phone = formatPhone(lead.phone, country);
    } catch {
      console.warn(`\n⚠️   Could not format phone "${lead.phone}" for ${lead.business_name} — skipping.`);
      failed++;
      continue;
    }

    // Skip invalid-shape numbers. BR: mobile-only (9th-digit rule); US: 11
    // digits starting with 1 (no mobile/landline distinction possible from
    // the number — Evolution catches landlines with exists:false at send).
    if (!isValidForCountry(phone, country)) {
      const label = country === 'US' ? 'Invalid US number' : 'Landline detected';
      console.warn(`\n⚠️   ${label} for ${lead.business_name} (${phone}) — skipping.`);
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

    // Dedup por phone — previne enviar 2x para mesmo número via place_ids diferentes
    const { data: phoneAlreadySent, error: phoneCheckError } = await getClient()
      .rpc('check_phone_already_sent', {
        target_phone: lead.phone,
        exclude_place_id: lead.place_id,
      });
    if (phoneCheckError) {
      console.warn(`\n⚠️   phone dedup check failed for ${lead.business_name}: ${phoneCheckError.message} — proceeding with send`);
    } else if (phoneAlreadySent === true) {
      console.warn(`\n⚠️   ${lead.business_name} (${lead.phone}) — phone já enviado via outro place_id — skipping.`);
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
