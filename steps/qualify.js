// Pre-message qualification gates applied right after collect, before
// analyze/score/visual. Reads `qualificationFilters` off the externalConfig
// the dashboard sends; if no filters are set, every lead passes through.
//
// Returns:
//   { qualified, rejected }
// Each rejected lead carries `score_reasons` (array) tagging the gate that
// dropped it — caller writes them as `status: 'disqualified'` in Supabase
// so dedup keeps them out of future runs.
//
// Gates (run in this order, first-fail wins):
//   1. minRating          — lead.rating < threshold (null counts as failure)
//   2. recentReviewMonths — newest review older than N months
//   3. franchiseBlacklist — business_name substring-match (case+accent-folded)

/**
 * Normalize a string for substring matching: lowercase, strip accents,
 * strip non-alphanumeric. "L'Officiel" → "loficiel". "Espaço Onodera" →
 * "espacoonodera".
 */
function normalize(s) {
  if (!s || typeof s !== 'string') return '';
  // Decompose accents (NFD), drop combining marks, keep only [a-z0-9].
  // \p{M}/u is the Unicode "mark" category — robust regardless of source-file
  // encoding (literal U+0300–U+036F regex is editor-fragile).
  return s
    .toLowerCase()
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .replace(/[^a-z0-9]/g, '');
}

/**
 * Apply qualification filters in-memory. Returns split arrays.
 *
 * @param {Array} leads - leads from collect (carry _reviews_full + _business_status)
 * @param {object} [filters] - qualificationFilters from externalConfig
 * @param {number} [filters.minRating]
 * @param {number} [filters.recentReviewMonths]
 * @param {string[]} [filters.franchiseBlacklist]
 * @returns {{ qualified: Array, rejected: Array }}
 */
export function qualify(leads, filters) {
  if (!filters || typeof filters !== 'object') {
    return { qualified: leads, rejected: [] };
  }

  const { minRating, recentReviewMonths, franchiseBlacklist } = filters;

  // Pre-normalize blacklist once.
  const normalizedBlacklist = Array.isArray(franchiseBlacklist)
    ? franchiseBlacklist.map(normalize).filter((s) => s.length >= 3)
    : [];

  const recencyCutoffSec =
    typeof recentReviewMonths === 'number' && recentReviewMonths > 0
      ? Math.floor(Date.now() / 1000) - recentReviewMonths * 30 * 86_400
      : null;

  const qualified = [];
  const rejected = [];

  for (const lead of leads) {
    // Gate 1: minRating
    if (typeof minRating === 'number') {
      if (lead.rating == null || lead.rating < minRating) {
        rejected.push({
          ...lead,
          score_reasons: ['low_rating'],
          status: 'disqualified',
          status_updated_at: new Date().toISOString(),
        });
        continue;
      }
    }

    // Gate 2: recentReviewMonths
    if (recencyCutoffSec != null) {
      const fullReviews = Array.isArray(lead._reviews_full) ? lead._reviews_full : [];
      // Google Places returns reviews newest-first by default. Defensive sort
      // anyway in case ordering changes — Place Details API has shifted shapes
      // before and silent regression here would let dead businesses through.
      const newest = fullReviews
        .map((r) => (typeof r.time === 'number' ? r.time : 0))
        .reduce((a, b) => (b > a ? b : a), 0);
      if (newest === 0 || newest < recencyCutoffSec) {
        rejected.push({
          ...lead,
          score_reasons: ['outdated_reviews'],
          status: 'disqualified',
          status_updated_at: new Date().toISOString(),
        });
        continue;
      }
    }

    // Gate 3: franchiseBlacklist (substring match on normalized name)
    if (normalizedBlacklist.length > 0) {
      const normName = normalize(lead.business_name);
      const hit = normalizedBlacklist.find((b) => normName.includes(b));
      if (hit) {
        rejected.push({
          ...lead,
          score_reasons: ['franchise_blacklist'],
          status: 'disqualified',
          status_updated_at: new Date().toISOString(),
        });
        continue;
      }
    }

    qualified.push(lead);
  }

  return { qualified, rejected };
}
