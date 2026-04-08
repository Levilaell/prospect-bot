// Assigns a pain score (0–10) to each lead based on technical issues found during analysis

const OUTDATED_BUILDERS = new Set(['wix', 'squarespace', 'weebly', 'blogger']);

function scoreLead(lead) {
  if (lead.scrape_failed) {
    return { ...lead, pain_score: 0, score_reasons: ['scrape_failed'] };
  }

  const reasons = [];
  let points = 0;

  // Mobile performance (skip entirely if PageSpeed returned null)
  if (lead.mobile_score !== null && lead.mobile_score !== undefined) {
    if (lead.mobile_score < 30) {
      reasons.push('slow_mobile_severe');   points += 3;
    } else if (lead.mobile_score < 50) {
      reasons.push('slow_mobile_moderate'); points += 2;
    } else if (lead.mobile_score < 70) {
      reasons.push('slow_mobile_mild');     points += 1;
    }
  }

  if (!lead.has_pixel)          { reasons.push('no_pixel');           points += 2; }
  if (!lead.has_analytics)      { reasons.push('no_analytics');       points += 1; }
  if (!lead.has_whatsapp)       { reasons.push('no_whatsapp');        points += 1; }
  if (!lead.has_form)           { reasons.push('no_form');            points += 1; }
  if (!lead.has_booking)        { reasons.push('no_booking');         points += 1; }
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

export function score(leads) {
  return leads
    .map(scoreLead)
    .sort((a, b) => b.pain_score - a.pain_score);
}
