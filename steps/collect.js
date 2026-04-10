// Fetches businesses from Google Places API and filters out those without usable websites

import { runBatch } from '../lib/utils.js';

const TEXT_SEARCH_URL  = 'https://maps.googleapis.com/maps/api/place/textsearch/json';
const PLACE_DETAILS_URL = 'https://maps.googleapis.com/maps/api/place/details/json';

const BLOCKED_DOMAINS = [
  'facebook.com', 'instagram.com', 'yelp.com',
  'tripadvisor.com', 'google.com', 'linkedin.com',
  'twitter.com', 'tiktok.com',
];

function isUsableWebsite(url) {
  if (!url) return false;
  try {
    const hostname = new URL(url).hostname.replace(/^www\./, '');
    return !BLOCKED_DOMAINS.some((d) => hostname === d || hostname.endsWith('.' + d));
  } catch {
    return false;
  }
}

function extractCity(formattedAddress) {
  const parts = formattedAddress.split(',');
  return parts.length > 1 ? parts[1].trim() : formattedAddress.trim();
}

async function textSearchPage(query, apiKey, pageToken) {
  const params = new URLSearchParams({ query, key: apiKey });
  if (pageToken) params.set('pagetoken', pageToken);

  const res = await fetch(`${TEXT_SEARCH_URL}?${params}`);
  if (!res.ok) throw new Error(`Places Text Search HTTP ${res.status}`);

  const data = await res.json();
  if (data.status !== 'OK' && data.status !== 'ZERO_RESULTS') {
    throw new Error(`Places API error: ${data.status}${data.error_message ? ' — ' + data.error_message : ''}`);
  }
  return data;
}

async function fetchDetails(placeId, apiKey) {
  const params = new URLSearchParams({
    place_id: placeId,
    fields:   'website,formatted_phone_number',
    key:      apiKey,
  });
  const res = await fetch(`${PLACE_DETAILS_URL}?${params}`);
  if (!res.ok) throw new Error(`Place Details HTTP ${res.status}`);

  const data = await res.json();
  if (data.status !== 'OK') {
    throw new Error(`Place Details error for ${placeId}: ${data.status}`);
  }
  return {
    website: data.result?.website ?? null,
    phone:   data.result?.formatted_phone_number ?? '',
  };
}

export async function collect({ niche, city, limit }) {
  const apiKey = process.env.GOOGLE_MAPS_API_KEY;
  if (!apiKey) throw new Error('GOOGLE_MAPS_API_KEY is not set');

  const query = `${niche} in ${city}`;
  const raw   = [];
  let pageToken = null;

  // ── Paginate Text Search until we have enough candidates ─────────────────
  do {
    if (pageToken) {
      // API requires a short delay before using next_page_token
      await new Promise((r) => setTimeout(r, 2000));
    }

    const page = await textSearchPage(query, apiKey, pageToken);

    for (const place of page.results) {
      raw.push({
        place_id:     place.place_id,
        business_name: place.name,
        address:      place.formatted_address ?? '',
        rating:       place.rating ?? null,
        review_count: place.user_ratings_total ?? 0,
      });
      if (raw.length >= limit) break;
    }

    pageToken = raw.length < limit ? (page.next_page_token ?? null) : null;
  } while (pageToken);

  // ── Fetch website + phone via Place Details (batches of 5) ───────────────
  let fetched = 0;
  const withDetails = await runBatch(raw, async (place) => {
    fetched++;
    process.stdout.write(`\r    🔍  Fetching details ${fetched}/${raw.length}...`);
    try {
      const details = await fetchDetails(place.place_id, apiKey);
      return { ...place, ...details };
    } catch {
      return { ...place, website: null, phone: '' };
    }
  }, 5);
  process.stdout.write('\n');

  // ── Filter: keep only leads with a usable, non-social website ────────────
  const collected_at = new Date().toISOString();
  const leads = withDetails
    .filter((p) => isUsableWebsite(p.website))
    .map((p) => ({
      place_id:      p.place_id,
      business_name: p.business_name,
      address:       p.address,
      city:          extractCity(p.address),
      niche:         niche,
      phone:         p.phone,
      website:       p.website,
      rating:        p.rating,
      review_count:  p.review_count,
      status:        'prospected',
      status_updated_at: collected_at,
      collected_at,
    }));

  return leads;
}
