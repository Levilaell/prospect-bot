// Queue generator — queries Supabase for already-prospected combos
// and returns only unprospected (niche, searchCity) pairs.

import { getClient } from './supabase.js';
import { getAllTargets } from './auto-config.js';

/** How many days before a combo can be re-prospected */
const RECHECK_DAYS = 60;

/**
 * Fetches all distinct (niche, search_city) pairs that were prospected within the
 * last RECHECK_DAYS days. Combos older than that are eligible for re-prospecting.
 * Returns a Set of "niche||search_city" keys for fast lookup.
 */
async function getProspectedCombos() {
  const client = getClient();
  const combos = new Set();

  // Only consider leads prospected within the recheck window
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - RECHECK_DAYS);
  const cutoffIso = cutoff.toISOString();

  const PAGE_SIZE = 1000;
  let offset = 0;
  let hasMore = true;

  // Try search_city first; fall back to city if column doesn't exist yet
  let useColumn = 'search_city';

  while (hasMore) {
    const { data, error } = await client
      .from('leads')
      .select(`niche, ${useColumn}`)
      .not('niche', 'is', null)
      .not(useColumn, 'is', null)
      .gte('status_updated_at', cutoffIso)
      .range(offset, offset + PAGE_SIZE - 1);

    if (error) {
      // If search_city column doesn't exist, fall back to city
      if (offset === 0 && error.message.includes('search_city') && useColumn === 'search_city') {
        console.warn('⚠️  search_city column not found — falling back to city column.');
        console.warn('    Run migrations/001_add_search_city.sql in Supabase SQL Editor to fix.');
        useColumn = 'city';
        continue;
      }
      console.warn(`⚠️  Failed to fetch prospected combos (offset ${offset}): ${error.message}`);
      break;
    }

    for (const row of data) {
      combos.add(`${row.niche}||${row[useColumn]}`);
    }

    hasMore = data.length === PAGE_SIZE;
    offset += PAGE_SIZE;
  }

  return combos;
}

/**
 * Gets count of WhatsApp messages sent today (UTC).
 */
export async function getWhatsAppSentToday() {
  const client = getClient();
  const todayStart = new Date();
  todayStart.setUTCHours(0, 0, 0, 0);

  const { count, error } = await client
    .from('leads')
    .select('*', { count: 'exact', head: true })
    .eq('outreach_channel', 'whatsapp')
    .eq('outreach_sent', true)
    .gte('outreach_sent_at', todayStart.toISOString());

  if (error) {
    console.warn(`⚠️  Failed to check WhatsApp daily count: ${error.message}`);
    return 0;
  }
  return count || 0;
}

/**
 * Generates the prospecting queue by diffing config targets against Supabase.
 *
 * Returns: {
 *   queue: [{ niche, searchCity, lang, country, cityName }],
 *   stats: { total, prospected, remaining, whatsappSentToday }
 * }
 */
/**
 * Generates the prospecting queue by diffing config targets against Supabase.
 *
 * @param {Object} opts
 * @param {string} opts.market - 'BR' | 'US' | 'all' (default 'all')
 * @param {object} [opts.externalConfig] - { niches, cities, country, lang } from dashboard
 */
export async function generateQueue({ market = 'all', externalConfig } = {}) {
  let allTargets = getAllTargets(externalConfig);
  if (!externalConfig && market !== 'all') {
    allTargets = allTargets.filter((t) => t.country === market);
  }

  const prospected = await getProspectedCombos();
  const sentToday = await getWhatsAppSentToday();

  const queue = allTargets.filter(
    (t) => !prospected.has(`${t.niche}||${t.searchCity}`)
  );

  return {
    queue,
    stats: {
      total: allTargets.length,
      prospected: allTargets.length - queue.length,
      remaining: queue.length,
      whatsappSentToday: sentToday,
    },
  };
}
