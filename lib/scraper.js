// Fetches and parses business websites with cheerio; enforces 8s timeout per request

import * as cheerio from 'cheerio';

const SCRAPE_TIMEOUT_MS = 8000;
const USER_AGENT = 'Mozilla/5.0 (compatible; ProspectBot/1.0)';

const BOOKING_PATTERN = /booking|schedule|appointment|calendly|acuity|reserv/i;

function detectTechStack(html) {
  if (html.includes('wix.com') || html.includes('wixstatic.com'))         return 'wix';
  if (html.includes('squarespace.com'))                                    return 'squarespace';
  if (html.includes('weebly.com'))                                         return 'weebly';
  if (html.includes('blogger.com') || html.includes('blogspot.com'))       return 'blogger';
  if (html.includes('wp-content') || html.includes('wp-includes'))        return 'wordpress';
  return 'unknown';
}

export async function scrapeWebsite(url) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), SCRAPE_TIMEOUT_MS);

  let res;
  try {
    res = await fetch(url, {
      signal:  controller.signal,
      headers: { 'User-Agent': USER_AGENT },
    });
  } finally {
    clearTimeout(timer);
  }

  const html = await res.text();
  const $    = cheerio.load(html);

  return {
    has_ssl:            url.startsWith('https://'),
    is_mobile_friendly: $('meta[name="viewport"]').length > 0,
    has_pixel:          html.includes('connect.facebook.net'),
    has_analytics:      html.includes('google-analytics.com') || html.includes('googletagmanager.com'),
    has_whatsapp:       html.includes('wa.me') || html.includes('api.whatsapp.com'),
    has_form:           $('form').length > 0,
    has_booking:        BOOKING_PATTERN.test(html),
    tech_stack:         detectTechStack(html),
  };
}
