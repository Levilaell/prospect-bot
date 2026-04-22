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
    fields:   'website,formatted_phone_number,opening_hours,reviews,photos,formatted_address',
    key:      apiKey,
  });
  const res = await fetch(`${PLACE_DETAILS_URL}?${params}`);
  if (!res.ok) throw new Error(`Place Details HTTP ${res.status}`);

  const data = await res.json();
  if (data.status !== 'OK') {
    throw new Error(`Place Details error for ${placeId}: ${data.status}`);
  }

  const result = data.result ?? {};

  const oh = result.opening_hours;
  const hours = oh ? {
    weekday_text: Array.isArray(oh.weekday_text) ? oh.weekday_text : [],
    open_now:     Boolean(oh.open_now),
  } : null;

  const reviews = Array.isArray(result.reviews) && result.reviews.length > 0
    ? result.reviews.slice(0, 3).map((r) => ({
        author_name:               r.author_name ?? '',
        rating:                    typeof r.rating === 'number' ? r.rating : 0,
        text:                      r.text ?? '',
        relative_time_description: r.relative_time_description ?? '',
        time:                      typeof r.time === 'number' ? r.time : 0,
      }))
    : null;

  const photos_urls = Array.isArray(result.photos) && result.photos.length > 0
    ? result.photos
        .slice(0, 5)
        .map((p) => p.photo_reference
          ? `https://maps.googleapis.com/maps/api/place/photo?maxwidth=1600&photo_reference=${p.photo_reference}&key=${apiKey}`
          : null)
        .filter(Boolean)
    : null;

  return {
    website: result.website ?? null,
    phone:   result.formatted_phone_number ?? '',
    hours,
    reviews,
    photos_urls,
  };
}

export async function collect({ niche, city, limit, searchCity }) {
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
    } catch (err) {
      console.warn(`\n    ⚠️   Place Details failed for ${place.place_id}: ${err.message}`);
      return {
        ...place,
        website:     null,
        phone:       '',
        hours:       null,
        reviews:     null,
        photos_urls: null,
      };
    }
  }, 5);
  process.stdout.write('\n');

  // ── Separate leads with usable websites from those without ───────────────
  const collected_at = new Date().toISOString();

  const buildLead = (p, hasWebsite) => ({
    place_id:      p.place_id,
    business_name: p.business_name,
    address:       p.address,
    city:          extractCity(p.address),
    search_city:   searchCity || city,
    niche:         niche,
    phone:         p.phone,
    website:       hasWebsite ? p.website : null,
    rating:        p.rating,
    review_count:  p.review_count,
    hours:         p.hours ?? null,
    reviews:       p.reviews ?? null,
    photos_urls:   p.photos_urls ?? null,
    no_website:    !hasWebsite,
    status:        'prospected',
    status_updated_at: collected_at,
    collected_at,
  });

  const leads = [];
  const noWebsiteLeads = [];

  for (const p of withDetails) {
    if (isUsableWebsite(p.website)) {
      leads.push(buildLead(p, true));
    } else {
      noWebsiteLeads.push(buildLead(p, false));
    }
  }

  return { leads, noWebsiteLeads };
}
