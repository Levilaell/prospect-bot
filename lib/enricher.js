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

const EMAIL_EXTRA_PATHS = ['/contact', '/contact-us', '/about', '/about-us', '/get-in-touch'];

async function fetchPageText(url) {
  const controller = new AbortController();
  const timer      = setTimeout(() => controller.abort(), SCRAPE_TIMEOUT);

  try {
    const res = await fetch(url, {
      signal:  controller.signal,
      headers: { 'User-Agent': USER_AGENT },
      redirect: 'follow',
    });
    if (!res.ok) return null;
    return await res.text();
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

function extractEmail(html) {
  const matches  = html.match(EMAIL_REGEX) ?? [];
  const relevant = matches.filter(isRelevantEmail);
  return relevant.length > 0 ? relevant[0] : null;
}

async function scrapeEmail(url, { deepScrape = false } = {}) {
  // Phase 1: check homepage
  const html = await fetchPageText(url);
  if (html) {
    const email = extractEmail(html);
    if (email) return email;
  }

  // Phase 2: check contact/about pages (deep scrape for US leads)
  if (deepScrape) {
    const base = url.replace(/\/+$/, '');
    for (const path of EMAIL_EXTRA_PATHS) {
      const pageHtml = await fetchPageText(`${base}${path}`);
      if (pageHtml) {
        const email = extractEmail(pageHtml);
        if (email) return email;
      }
    }
  }

  return null;
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

async function enrichLead(lead, { country = 'BR' } = {}) {
  if (lead.scrape_failed || !lead.website) {
    return { ...lead, email: null, email_source: null };
  }

  const isUS = country === 'US';

  // Phase 1 — scrape the site (deep scrape for US: also checks contact/about pages)
  const scrapedEmail = await scrapeEmail(lead.website, { deepScrape: isUS });
  if (scrapedEmail) {
    return { ...lead, email: scrapedEmail, email_source: 'scrape' };
  }

  // Phase 2 — Hunter.io fallback (BR only, skip for US per user decision)
  if (!isUS) {
    try {
      const domain      = new URL(lead.website).hostname.replace(/^www\./, '');
      const hunterEmail = await hunterSearch(domain);
      if (hunterEmail) {
        return { ...lead, email: hunterEmail, email_source: 'hunter' };
      }
    } catch {
      // malformed URL or Hunter error — fall through
    }
  }

  return { ...lead, email: null, email_source: null };
}

/**
 * Enriches leads with email addresses.
 * @param {Array} leads
 * @param {Object} opts
 * @param {string} opts.country - 'US' | 'BR'. US skips Hunter.io, uses deep scrape.
 */
export async function enrichLeads(leads, { country = 'BR' } = {}) {
  const total = leads.length;
  let done    = 0;
  let scrapeCount  = 0;
  let hunterCount  = 0;

  const results = await runBatch(leads, async (lead) => {
    done++;
    process.stdout.write(`\r  🔎  Enriching emails [${done}/${total}]...`.padEnd(60));

    try {
      const enriched = await enrichLead(lead, { country });
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
