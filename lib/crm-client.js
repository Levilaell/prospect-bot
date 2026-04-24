// HTTP client for fastdevbuilds-admin CRM.
// After a send, the bot calls POST /api/bot/outreach/sent or /failed so the
// CRM owns all post-send writes (leads.outreach_*, whatsapp_jid, conversations,
// status transitions, follow-up scheduling). The bot no longer touches those
// tables directly from the send path.

const TIMEOUT_MS = 10_000;
const MAX_ATTEMPTS = 3;
const BACKOFF_MS = [1_000, 2_000, 4_000];

// Per-endpoint overrides. project/create on the admin side runs Claude Opus
// + Getimg + Supabase upload; 30-90s is normal. The default 10s makes the
// bot give up mid-generation, retry, and see the project as "already_existed"
// — the work was done, but the counter treats it as reused.
const TIMEOUT_OVERRIDES = {
  '/api/bot/project/create': 180_000,
};

/**
 * Assert that CRM env vars are present. Call this at startup (next to other
 * --send env checks) so misconfiguration fails fast before any real work.
 * @throws {Error} with a clear message when a required var is missing.
 */
export function validateCrmEnv() {
  if (!process.env.CRM_API_URL) {
    throw new Error(
      'CRM_API_URL is not set — required to report sends to the CRM ' +
      '(e.g. https://admin.fastdevbuilds.com)',
    );
  }
  if (!process.env.BOT_TO_CRM_SECRET) {
    throw new Error(
      'BOT_TO_CRM_SECRET is not set — required shared secret for CRM auth',
    );
  }
}

function readConfig() {
  const baseUrl = process.env.CRM_API_URL;
  const secret = process.env.BOT_TO_CRM_SECRET;
  if (!baseUrl || !secret) return null;
  return { baseUrl: baseUrl.replace(/\/+$/, ''), secret };
}

function isRetryableStatus(status) {
  // Retry on 5xx (server-side hiccups). Not on 4xx (401/404/400 won't improve).
  return typeof status === 'number' && status >= 500 && status < 600;
}

async function postToCrm(path, payload, logPrefix) {
  const config = readConfig();
  if (!config) {
    const msg = 'CRM_API_URL or BOT_TO_CRM_SECRET is not set';
    console.error(`[crm-client] ${msg} — skipping ${path}. payload=${JSON.stringify(payload)}`);
    return { ok: false, error: msg, exhausted: true };
  }

  const url = `${config.baseUrl}${path}`;
  const timeoutMs = TIMEOUT_OVERRIDES[path] ?? TIMEOUT_MS;
  let lastError = 'unknown';
  let lastStatus = null;

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    let retryable = false;

    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${config.secret}`,
        },
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(timeoutMs),
      });

      let body = null;
      const raw = await res.text().catch(() => '');
      if (raw) { try { body = JSON.parse(raw); } catch { body = raw; } }

      if (res.ok) {
        console.log(`${logPrefix} attempt ${attempt}/${MAX_ATTEMPTS} ok status=${res.status}`);
        return typeof body === 'object' && body !== null ? body : { ok: true };
      }

      const bodyPreview = typeof body === 'string' ? body.slice(0, 200) : JSON.stringify(body)?.slice(0, 200);
      console.warn(`${logPrefix} attempt ${attempt}/${MAX_ATTEMPTS} http ${res.status} body=${bodyPreview}`);
      lastStatus = res.status;
      lastError = `http_${res.status}: ${bodyPreview ?? ''}`;
      retryable = isRetryableStatus(res.status);
    } catch (err) {
      const name = err?.name ?? '';
      const isTimeout = name === 'TimeoutError' || name === 'AbortError';
      const code = isTimeout ? 'timeout' : 'network';
      lastStatus = code;
      lastError = `${code}: ${err?.message ?? String(err)}`;
      console.warn(`${logPrefix} attempt ${attempt}/${MAX_ATTEMPTS} ${code}: ${err?.message ?? err}`);
      retryable = true;
    }

    if (attempt >= MAX_ATTEMPTS || !retryable) break;
    await new Promise((r) => setTimeout(r, BACKOFF_MS[attempt - 1] ?? 4_000));
  }

  console.error(
    `[crm-client] exhausted after ${MAX_ATTEMPTS} attempts path=${path} last=${lastError} ` +
    `payload=${JSON.stringify(payload)}`,
  );
  return { ok: false, error: lastError, exhausted: true, http_status: typeof lastStatus === 'number' ? lastStatus : null };
}

/**
 * Report a successful outreach send to the CRM. The CRM inserts a conversation
 * row, flips status prospected → sent, backfills whatsapp_jid from the raw
 * Evolution response, sets last_outbound_at, schedules the follow-up, and
 * dismisses any pending AI suggestions. Idempotent on (place_id, direction,
 * message) within ±60s of sent_at.
 *
 * @param {object} payload
 * @param {string} payload.place_id
 * @param {'whatsapp'|'email'} payload.channel
 * @param {string} payload.message
 * @param {string} [payload.subject]              Email subject (email only)
 * @param {unknown} [payload.evolution_response]  Raw Evolution body (WhatsApp)
 * @param {string} [payload.evolution_instance]
 * @param {string} [payload.sent_at]              ISO 8601
 * @param {boolean} [payload.is_follow_up]
 * @returns {Promise<object>} parsed CRM response or { ok:false, exhausted:true }
 */
export async function notifyCrmSent(payload) {
  return postToCrm('/api/bot/outreach/sent', payload, '[crm-client:sent]');
}

/**
 * Report a failed outreach send. The CRM writes `outreach_error` and leaves
 * status/outreach_sent/conversations untouched so the lead stays retryable.
 *
 * @param {object} payload
 * @param {string} payload.place_id
 * @param {'whatsapp'|'email'} payload.channel
 * @param {string} payload.error
 * @param {string} [payload.error_code]  'timeout'|'rate_limited'|'http_5xx'|'number_not_on_whatsapp'|'network'|'unknown'
 * @param {string} [payload.evolution_instance]
 * @param {number} [payload.http_status]
 * @returns {Promise<object>} parsed CRM response or { ok:false, exhausted:true }
 */
export async function notifyCrmFailed(payload) {
  return postToCrm('/api/bot/outreach/failed', payload, '[crm-client:failed]');
}

/**
 * Ask the CRM to create a Project for this qualified lead and generate its
 * Claude Code prompt + images. Used by the US-WhatsApp preview-first flow:
 * the bot qualifies but doesn't dispatch — the admin + Levi take it from
 * "Prompt pronto" onwards (paste URL + send).
 *
 * Idempotent on the CRM side: if a project already exists for the place_id,
 * returns 200 with already_existed=true.
 *
 * @param {object} payload
 * @param {string} payload.place_id
 * @returns {Promise<object>} { ok, project_id, already_existed } or { ok:false, exhausted:true }
 */
export async function notifyCrmProjectCreate(payload) {
  return postToCrm('/api/bot/project/create', payload, '[crm-client:project-create]');
}
