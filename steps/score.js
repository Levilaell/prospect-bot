// Assigns a pain score (0–10) to each lead based on technical issues found during analysis

const OUTDATED_BUILDERS = new Set(['wix', 'squarespace', 'weebly', 'blogger']);

function scoreLead(lead, country) {
  if (lead.scrape_failed) {
    return { ...lead, pain_score: 0, score_reasons: ['scrape_failed'] };
  }

  const isUS = country === 'US';
  const reasons = [];
  let points = 0;

  // ── Performance ──
  if (lead.mobile_score !== null && lead.mobile_score !== undefined) {
    if (lead.mobile_score < 30) {
      reasons.push('slow_mobile_severe');   points += 3;
    } else if (lead.mobile_score < 50) {
      reasons.push('slow_mobile_moderate'); points += 2;
    } else if (lead.mobile_score < 70) {
      reasons.push('slow_mobile_mild');     points += 1;
    }
  }

  // ── Visual / Design ──
  if (lead.visual_score !== null && lead.visual_score !== undefined) {
    if (lead.visual_score < 4) {
      reasons.push('outdated_design');      points += 3;
    } else if (lead.visual_score <= 5) {
      reasons.push('poor_visual_quality');  points += 2;
    } else if (lead.visual_score <= 6) {
      reasons.push('mediocre_design');      points += 1;
    }
  }

  // ── Conversion essentials ──
  if (!lead.has_form)    { reasons.push('no_form');    points += 2; }
  if (!lead.has_booking) { reasons.push('no_booking'); points += isUS ? 2 : 1; }

  // WhatsApp is irrelevant for US — only penalize for BR
  if (!isUS && !lead.has_whatsapp) {
    reasons.push('no_whatsapp'); points += 1;
  }

  // ── Technical ──
  if (OUTDATED_BUILDERS.has(lead.tech_stack)) {
                                  reasons.push('outdated_builder');   points += 1; }
  if (!lead.has_ssl)            { reasons.push('no_ssl');             points += 2; }
  if (!lead.is_mobile_friendly) { reasons.push('no_mobile_viewport'); points += 1; }

  return {
    ...lead,
    pain_score:    Math.min(points, 10),
    score_reasons: reasons,
  };
}

/**
 * Scores leads and sorts by pain_score descending.
 * @param {Array} leads
 * @param {Object} opts
 * @param {string} opts.country - 'US' | 'BR' (affects scoring weights)
 */
export function score(leads, { country = 'BR' } = {}) {
  return leads
    .map((lead) => scoreLead(lead, country))
    .sort((a, b) => b.pain_score - a.pain_score);
}
