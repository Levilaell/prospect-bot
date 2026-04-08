// Enriches each lead with an email address — scrapes the site first, falls back to Hunter.io

import { runBatch } from './utils.js';

const EMAIL_REGEX     = /[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}/g;
const SCRAPE_TIMEOUT  = 8000;
const USER_AGENT      = 'Mozilla/5.0 (compatible; ProspectBot/1.0)';
const HUNTER_MIN_CONF = 70;
const HUNTER_DELAY_MS = 200;

const EMAIL_NOISE = [
  'sentry', 'wix', 'wordpress', 'schema', 'example', 'pixel',
  'facebook', 'google', 'apple', 'microsoft', 'adobe', 'jquery', 'placeholder',
];

function isRelevantEmail(email) {
  const lower = email.toLowerCase();
  return !EMAIL_NOISE.some((noise) => lower.includes(noise));
}

async function scrapeEmail(url) {
  const controller = new AbortController();
  const timer      = setTimeout(() => controller.abort(), SCRAPE_TIMEOUT);

  try {
    const res  = await fetch(url, {
      signal:  controller.signal,
      headers: { 'User-Agent': USER_AGENT },
    });
    const html     = await res.text();
    const matches  = html.match(EMAIL_REGEX) ?? [];
    const relevant = matches.filter(isRelevantEmail);
    return relevant.length > 0 ? relevant[0] : null;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

async function hunterSearch(domain) {
  const apiKey = process.env.HUNTER_API_KEY;
  if (!apiKey) return null;

  await new Promise((r) => setTimeout(r, HUNTER_DELAY_MS));

  const params = new URLSearchParams({ domain, api_key: apiKey, limit: '1' });

  try {
    const res = await fetch(`https://api.hunter.io/v2/domain-search?${params}`);
    if (!res.ok) return null;

    const data   = await res.json();
    const emails = data?.data?.emails ?? [];
    const best   = emails.find((e) => (e.confidence ?? 0) >= HUNTER_MIN_CONF);
    return best?.value ?? null;
  } catch {
    return null;
  }
}

async function enrichLead(lead) {
  if (lead.scrape_failed) {
    return { ...lead, email: null, email_source: null };
  }

  // Phase 1 — scrape the site
  const scrapedEmail = await scrapeEmail(lead.website);
  if (scrapedEmail) {
    return { ...lead, email: scrapedEmail, email_source: 'scrape' };
  }

  // Phase 2 — Hunter.io fallback
  try {
    const domain      = new URL(lead.website).hostname.replace(/^www\./, '');
    const hunterEmail = await hunterSearch(domain);
    if (hunterEmail) {
      return { ...lead, email: hunterEmail, email_source: 'hunter' };
    }
  } catch {
    // malformed URL or Hunter error — fall through
  }

  return { ...lead, email: null, email_source: null };
}

export async function enrichLeads(leads) {
  const total = leads.length;
  let done    = 0;
  let scrapeCount  = 0;
  let hunterCount  = 0;

  const results = await runBatch(leads, async (lead) => {
    done++;
    process.stdout.write(`\r  🔎  Enriching emails [${done}/${total}]...`.padEnd(60));

    try {
      const enriched = await enrichLead(lead);
      if (enriched.email_source === 'scrape') scrapeCount++;
      if (enriched.email_source === 'hunter') hunterCount++;
      return enriched;
    } catch {
      return { ...lead, email: null, email_source: null };
    }
  }, 5);

  process.stdout.write('\n');

  const found    = scrapeCount + hunterCount;
  const notFound = total - found;
  console.log(`    Emails found: ${found}/${total} (${scrapeCount} scrape, ${hunterCount} hunter, ${notFound} not found)`);

  return results;
}
