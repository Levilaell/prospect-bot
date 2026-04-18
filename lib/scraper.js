// Fetches and parses business websites with cheerio; enforces 8s timeout per request

import * as cheerio from 'cheerio';

const SCRAPE_TIMEOUT_MS = 8000;
const USER_AGENT = 'Mozilla/5.0 (compatible; ProspectBot/1.0)';

const BOOKING_PATTERN = /booking|schedule|appointment|calendly|acuity|reserv/i;

const WHATSAPP_HTML_PATTERNS = [
  'wa.me',
  'api.whatsapp.com',
  'whatsapp.com/send',
];

const WHATSAPP_ATTR_PATTERN = /whatsapp|wpp|zap/i;

function detectWhatsApp(html, $) {
  // 1. Check raw HTML for known WhatsApp URL patterns
  const htmlLower = html.toLowerCase();
  for (const pattern of WHATSAPP_HTML_PATTERNS) {
    if (htmlLower.includes(pattern)) return true;
  }

  // 2. Check href attributes containing "whatsapp"
  const hasWhatsAppHref = $('a[href*="whatsapp"], a[href*="wpp"], a[href*="zap"]').length > 0;
  if (hasWhatsAppHref) return true;

  // 3. Check elements with class/id containing whatsapp/wpp/zap
  const hasWhatsAppClassOrId = $('[class*="whatsapp"], [class*="wpp"], [class*="zap"], [id*="whatsapp"], [id*="wpp"], [id*="zap"]').length > 0;
  if (hasWhatsAppClassOrId) return true;

  // 4. Check SVG/img alt or title containing "whatsapp"
  const hasWhatsAppImg = $('img[alt*="whatsapp" i], img[title*="whatsapp" i], svg[aria-label*="whatsapp" i]').length > 0;
  if (hasWhatsAppImg) return true;

  // 5. Check links/buttons with class/id matching whatsapp patterns that contain phone numbers
  const whatsAppButtons = $('a, button').filter(function () {
    const el = $(this);
    const cls = (el.attr('class') || '') + ' ' + (el.attr('id') || '');
    return WHATSAPP_ATTR_PATTERN.test(cls);
  });
  if (whatsAppButtons.length > 0) return true;

  return false;
}

function detectTechStack(html) {
  if (html.includes('wix.com') || html.includes('wixstatic.com'))         return 'wix';
  if (html.includes('squarespace.com'))                                    return 'squarespace';
  if (html.includes('weebly.com'))                                         return 'weebly';
  if (html.includes('blogger.com') || html.includes('blogspot.com'))       return 'blogger';
  if (html.includes('wp-content') || html.includes('wp-includes'))        return 'wordpress';
  return 'unknown';
}

const CONTACT_PATHS = [
  '/contato', '/contact', '/fale-conosco', '/contatos', '/contact-us',
  '/get-in-touch', '/about-us', '/get-a-quote', '/request-quote',
  '/schedule', '/book-now', '/reach-us',
];

async function fetchPage(url) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), SCRAPE_TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      signal: controller.signal,
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

export async function scrapeWebsite(url) {
  const html = await fetchPage(url);
  if (!html) throw new Error(`Failed to fetch ${url}`);

  const $ = cheerio.load(html);

  // Check homepage for form
  let hasForm = $('form').length > 0;

  // If no form on homepage, check common contact page paths
  if (!hasForm) {
    const base = url.replace(/\/+$/, '');
    for (const path of CONTACT_PATHS) {
      const contactHtml = await fetchPage(`${base}${path}`);
      if (contactHtml && contactHtml.includes('<form')) {
        hasForm = true;
        break;
      }
    }
  }

  // Also detect form links on homepage (nav links to /contato etc.)
  if (!hasForm) {
    const formLinks = $('a[href]').filter(function () {
      const href = ($(this).attr('href') || '').toLowerCase();
      return CONTACT_PATHS.some(p => href.includes(p)) || /contato|contact|fale.?conosco|get.?in.?touch|get.?a.?quote/i.test(href);
    });
    if (formLinks.length > 0) {
      const href = formLinks.first().attr('href') || '';
      const contactUrl = href.startsWith('http') ? href : `${url.replace(/\/+$/, '')}${href.startsWith('/') ? '' : '/'}${href}`;
      const contactHtml = await fetchPage(contactUrl);
      if (contactHtml && contactHtml.includes('<form')) {
        hasForm = true;
      }
    }
  }

  return {
    has_ssl:            url.startsWith('https://'),
    is_mobile_friendly: $('meta[name="viewport"]').length > 0,
    has_pixel:          html.includes('connect.facebook.net'),
    has_analytics:      html.includes('google-analytics.com') || html.includes('googletagmanager.com'),
    has_whatsapp:       detectWhatsApp(html, $),
    has_form:           hasForm,
    has_booking:        BOOKING_PATTERN.test(html),
    tech_stack:         detectTechStack(html),
  };
}
