// Assigns a pain score and an opportunity score to each lead.
//
// pain_score (0–12, one decimal): how bad is the site (technical + UX).
//   Clamp raised from 10 to 12 so heavy-issue leads aren't bucketed with medium-issue ones.
//   Weights lowered so an average SMB site doesn't max out — score keeps discriminative power.
//
// opportunity_score (0–5, integer): how much traction the business has (review_count + rating).
//   Used to sort qualified leads by commercial attractiveness, not just pain.

const OUTDATED_BUILDERS = new Set(["wix", "squarespace", "weebly", "blogger"]);

function scoreLead(lead, country) {
  const opportunity = opportunityScore(lead);

  if (lead.scrape_failed) {
    return {
      ...lead,
      pain_score: 0,
      score_reasons: ["scrape_failed"],
      opportunity_score: opportunity.opportunity_score,
      opportunity_reasons: opportunity.opportunity_reasons,
    };
  }

  const isUS = country === "US";
  const reasons = [];
  let points = 0;

  // ── Performance ──
  if (lead.mobile_score !== null && lead.mobile_score !== undefined) {
    if (lead.mobile_score < 30) {
      reasons.push("slow_mobile_severe");
      points += 2;
    } else if (lead.mobile_score < 50) {
      reasons.push("slow_mobile_moderate");
      points += 1.5;
    } else if (lead.mobile_score < 70) {
      reasons.push("slow_mobile_mild");
      points += 0.5;
    }
  }

  // ── Visual / Design ──
  if (lead.visual_score !== null && lead.visual_score !== undefined) {
    if (lead.visual_score < 4) {
      reasons.push("outdated_design");
      points += 2;
    } else if (lead.visual_score <= 5) {
      reasons.push("poor_visual_quality");
      points += 1.5;
    } else if (lead.visual_score <= 6) {
      reasons.push("mediocre_design");
      points += 0.5;
    }
  }

  // ── Conversion essentials ──
  if (!lead.has_form) {
    reasons.push("no_form");
    points += 1;
  }
  if (!lead.has_booking) {
    reasons.push("no_booking");
    points += isUS ? 1.5 : 1;
  }

  // WhatsApp is irrelevant for US — only penalize for BR
  if (!isUS && !lead.has_whatsapp) {
    reasons.push("no_whatsapp");
    points += 1;
  }

  // ── Technical ──
  if (OUTDATED_BUILDERS.has(lead.tech_stack)) {
    reasons.push("outdated_builder");
    points += 1;
  }
  if (!lead.has_ssl) {
    reasons.push("no_ssl");
    points += 1.5;
  }
  if (!lead.is_mobile_friendly) {
    reasons.push("no_mobile_viewport");
    points += 1;
  }

  return {
    ...lead,
    pain_score: Math.round(Math.min(points, 12)),
    score_reasons: reasons,
    opportunity_score: opportunity.opportunity_score,
    opportunity_reasons: opportunity.opportunity_reasons,
  };
}

/**
 * Computes an opportunity score (0-5) from Google Places traction signals.
 * Review count dominates (up to 3 pts) because it's harder to fake than rating.
 * Rating adds up to 2 extra pts. Independent of scrape success.
 */
export function opportunityScore(lead) {
  const reviewCount = lead.review_count;
  const rating = lead.rating;

  let points = 0;
  const reasons = [];

  if (reviewCount != null) {
    if (reviewCount >= 500) {
      points += 3;
      reasons.push("strong_traffic");
    } else if (reviewCount >= 200) {
      points += 2;
      reasons.push("consistent_traffic");
    } else if (reviewCount >= 80) {
      points += 1;
      reasons.push("minimal_traffic");
    }
  }

  if (rating != null) {
    if (rating >= 4.7) {
      points += 2;
      reasons.push("high_rating");
    } else if (rating >= 4.3) {
      points += 1;
      reasons.push("good_rating");
    }
  }

  return {
    opportunity_score: Math.min(points, 5),
    opportunity_reasons: reasons,
  };
}

/**
 * Scores leads and sorts by opportunity_score desc, then pain_score desc.
 * Leads with real traction surface first so operators message where the upside is highest.
 * @param {Array} leads
 * @param {Object} opts
 * @param {string} opts.country - 'US' | 'BR' (affects scoring weights)
 */
export function score(leads, { country = "BR" } = {}) {
  return leads
    .map((lead) => scoreLead(lead, country))
    .sort((a, b) => {
      if (b.opportunity_score !== a.opportunity_score) {
        return b.opportunity_score - a.opportunity_score;
      }
      return b.pain_score - a.pain_score;
    });
}
