// Enriches each lead with an email address by scraping the website.
// Runs only for US leads — BR leads use WhatsApp, not email.

import { runBatch } from './utils.js';

const EMAIL_REGEX    = /[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}/g;
const SCRAPE_TIMEOUT = 8000;
const USER_AGENT     = 'Mozilla/5.0 (compatible; ProspectBot/1.0)';

const EMAIL_NOISE = [
  'sentry', 'wix', 'wordpress', 'schema', 'example', 'pixel',
  'facebook', 'google', 'apple', 'microsoft', 'adobe', 'jquery', 'placeholder',
];

const EXTRA_PATHS = ['/contact', '/contact-us', '/about', '/about-us', '/get-in-touch'];

function isRelevantEmail(email) {
  const lower = email.toLowerCase();
  return !EMAIL_NOISE.some((noise) => lower.includes(noise));
}

async function fetchPageText(url) {
  const controller = new AbortController();
  const timer      = setTimeout(() => controller.abort(), SCRAPE_TIMEOUT);
  try {
    const res = await fetch(url, {
      signal:   controller.signal,
      headers:  { 'User-Agent': USER_AGENT },
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
  return relevant[0] ?? null;
}

async function scrapeEmail(url) {
  // Phase 1: homepage
  const html = await fetchPageText(url);
  if (html) {
    const email = extractEmail(html);
    if (email) return email;
  }

  // Phase 2: contact/about pages
  const base = url.replace(/\/+$/, '');
  for (const path of EXTRA_PATHS) {
    const pageHtml = await fetchPageText(`${base}${path}`);
    if (pageHtml) {
      const email = extractEmail(pageHtml);
      if (email) return email;
    }
  }

  return null;
}

async function enrichLead(lead) {
  if (lead.scrape_failed || !lead.website) {
    return { ...lead, email: null, email_source: null };
  }

  const email = await scrapeEmail(lead.website);
  if (email) {
    return { ...lead, email, email_source: 'scrape' };
  }

  return { ...lead, email: null, email_source: null };
}

/**
 * Enriches US leads with email addresses via website scraping.
 * Caller is responsible for filtering — this runs for every lead passed in.
 */
export async function enrichLeads(leads) {
  const total = leads.length;
  let done    = 0;
  let scrapeCount = 0;

  const results = await runBatch(leads, async (lead) => {
    done++;
    process.stdout.write(`\r  🔎  Enriching emails [${done}/${total}]...`.padEnd(60));

    try {
      const enriched = await enrichLead(lead);
      if (enriched.email_source === 'scrape') scrapeCount++;
      return enriched;
    } catch {
      return { ...lead, email: null, email_source: null };
    }
  }, 5);

  process.stdout.write('\n');

  const notFound = total - scrapeCount;
  console.log(`    Emails found: ${scrapeCount}/${total} (${notFound} not found)`);

  return results;
}
