// scoreOwner — heuristic 0-100 estimate of "this WhatsApp number reaches
// the decision-maker" (vs receptionist or auto-attendant bot).
//
// Pure function. No external calls. Used at upsert time to stamp
// `leads.owner_probability`. Used downstream as a HOT-lead filter.
//
// Rationale + signal weights documented in
// fastdevbuilds-admin/TOP_OF_FUNNEL_AUDIT.md §7. Recalibrate after 100+
// new sends produce a measurable signal. Initial calibration based on the
// 8 PRICE_REACHED leads vs 13 BOT_ONLY + 8 RECEPTIONIST in EXP-000.

const RECEPTIONIST_NAME_RE = /^\s*(dr\.?|dra\.?|cl[íi]nica)\b/i;
const RECEPTIONIST_ADDR_RE = /\b(sala|andar|conjunto|cj)\s*\d/i;

const PRIORITY_NICHE_TOKENS = [
  "salões",
  "saloes",
  "floriculturas",
  "fisioterapeutas",
  "nutricionistas",
  "academias",
  "lojas de roupas",
];

/**
 * Compute a 0-100 owner-reachability score for a Google Places-style lead.
 *
 * Field aliases: lead may carry either snake_case (database shape) or
 * Google Places shape (formatted_address, user_ratings_total). Function
 * accepts both — the bot's lead objects shift between the two depending
 * on pipeline stage.
 */
export function scoreOwner(lead) {
  if (!lead) return 50;
  let score = 50;

  const name = String(lead.business_name ?? lead.name ?? "");
  const address = String(lead.address ?? lead.formatted_address ?? "");
  const niche = String(lead.niche ?? "").toLowerCase();
  // Reviews-as-signal: only score when the value is explicitly known.
  // null/undefined leaves reviews neutral so minimal disqualify rows that
  // don't carry review_count don't get penalized as if they had 0 reviews.
  const reviewsRaw = lead.review_count ?? lead.user_ratings_total;
  const reviewsKnown = reviewsRaw !== null && reviewsRaw !== undefined;
  const reviews = Number(reviewsRaw ?? 0);

  // Receptionist signals — businesses fronted by clinical title or in
  // commercial real estate units almost always have staff intercepting WA.
  if (RECEPTIONIST_NAME_RE.test(name)) score -= 25;
  if (RECEPTIONIST_ADDR_RE.test(address)) score -= 20;

  // Reviews sweet spot — established but not enterprise-bot tier.
  if (reviewsKnown) {
    if (reviews >= 30 && reviews <= 300) score += 20;
    else if (reviews > 300 && reviews <= 1000) score += 10;
    else if (reviews < 10) score -= 15;
    else if (reviews > 1000) score -= 25;
  }

  // Niche tilt — owner-run service categories observed in PRICE_REACHED.
  if (PRIORITY_NICHE_TOKENS.some((token) => niche.includes(token))) {
    score += 20;
  }

  // Clamp 0..100
  if (score < 0) return 0;
  if (score > 100) return 100;
  return score;
}
