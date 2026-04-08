// Runs PageSpeed API + HTML scraping in parallel batches of 5 to detect site problems

import { fetchPageSpeed } from '../lib/pagespeed.js';
import { scrapeWebsite }  from '../lib/scraper.js';
import { runBatch }       from '../lib/utils.js';

const SCRAPE_DEFAULTS = {
  has_ssl:            false,
  is_mobile_friendly: false,
  has_pixel:          false,
  has_analytics:      false,
  has_whatsapp:       false,
  has_form:           false,
  has_booking:        false,
  tech_stack:         'unknown',
};

async function analyzeLead(lead, index, total) {
  process.stdout.write(`\r  ⚡  Analyzing [${index + 1}/${total}] ${lead.business_name}...`.padEnd(72));

  const [speedResult, scrapeResult] = await Promise.allSettled([
    fetchPageSpeed(lead.website),
    scrapeWebsite(lead.website),
  ]);

  const speed  = speedResult.status  === 'fulfilled' ? speedResult.value  : {};
  const scrape = scrapeResult.status === 'fulfilled' ? scrapeResult.value : null;

  return {
    ...lead,
    // PageSpeed fields — remain null if API failed
    perf_score:   speed.perf_score   ?? null,
    mobile_score: speed.mobile_score ?? null,
    fcp:          speed.fcp          ?? null,
    lcp:          speed.lcp          ?? null,
    cls:          speed.cls          ?? null,
    // Scraper fields — defaults if scrape failed
    ...(scrape ?? SCRAPE_DEFAULTS),
    scrape_failed: scrapeResult.status === 'rejected',
  };
}

export async function analyze(leads) {
  const total = leads.length;
  const results = await runBatch(
    leads,
    (lead, index) => analyzeLead(lead, index, total),
    5,
  );
  process.stdout.write('\n');
  return results;
}
