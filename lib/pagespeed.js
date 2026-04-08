// Wraps the Google PageSpeed Insights API and normalizes the response into scored metrics

const PAGESPEED_URL = 'https://www.googleapis.com/pagespeedonline/v5/runPagespeed';

const NULL_RESULT = {
  perf_score:   null,
  mobile_score: null,
  fcp:          null,
  lcp:          null,
  cls:          null,
};

export async function fetchPageSpeed(url) {
  const apiKey = process.env.GOOGLE_MAPS_API_KEY;
  if (!apiKey) throw new Error('GOOGLE_MAPS_API_KEY is not set');

  const params = new URLSearchParams({ url, strategy: 'mobile', key: apiKey });

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 25000);

  let res;
  try {
    res = await fetch(`${PAGESPEED_URL}?${params}`, { signal: controller.signal });
  } catch {
    return NULL_RESULT;
  } finally {
    clearTimeout(timer);
  }

  if (!res.ok) return NULL_RESULT;

  let data;
  try {
    data = await res.json();
  } catch {
    return NULL_RESULT;
  }

  const lhr = data.lighthouseResult;
  if (!lhr) return NULL_RESULT;

  const score = lhr.categories?.performance?.score;
  const audits = lhr.audits ?? {};

  return {
    perf_score:   score != null ? Math.round(score * 100) : null,
    mobile_score: score != null ? Math.round(score * 100) : null,
    fcp:          audits['first-contentful-paint']?.numericValue ?? null,
    lcp:          audits['largest-contentful-paint']?.numericValue ?? null,
    cls:          audits['cumulative-layout-shift']?.numericValue ?? null,
  };
}
