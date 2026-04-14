// Calls Claude API to generate a personalized outreach message for each qualified lead

import Anthropic from "@anthropic-ai/sdk";
import { runBatch } from "../lib/utils.js";
import {
  SYSTEM_EN, SYSTEM_PT,
  SYSTEM_NO_WEBSITE_EN, SYSTEM_NO_WEBSITE_PT,
  SYSTEM_EMAIL_EN, SYSTEM_NO_WEBSITE_EMAIL_EN,
  translateReasons,
} from "../lib/prompts.js";
import { getNicheContext } from "../lib/niche-templates.js";
import { pickVariant, getVariantInstruction } from "../lib/variants.js";

// ── Business size label based on review count ────────────────────────────────

function businessSizeLabel(reviewCount) {
  if (reviewCount == null) return null;
  if (reviewCount <= 10) return 'micro (few reviews — likely new or low visibility)';
  if (reviewCount <= 50) return 'small (some traction, growing)';
  if (reviewCount <= 200) return 'established (solid local presence)';
  return 'popular (well-known in the area)';
}

function businessSizeLabelPt(reviewCount) {
  if (reviewCount == null) return null;
  if (reviewCount <= 10) return 'micro (poucas avaliações — provavelmente novo ou pouca visibilidade)';
  if (reviewCount <= 50) return 'pequeno (alguma tração, crescendo)';
  if (reviewCount <= 200) return 'estabelecido (presença local sólida)';
  return 'popular (bem conhecido na região)';
}

// ── Clean business name (strip SEO descriptors) ────────────────────────────

function cleanBusinessName(name) {
  return name.split(/[|–—·]|  +/)[0].trim();
}

// ── User prompt builder ──────────────────────────────────────────────────────

function buildUserPrompt(lead, lang) {
  const isNoWebsite = lead.no_website === true;
  const niche = getNicheContext(lead.niche, lang);
  const sizeLabel = lang === 'pt'
    ? businessSizeLabelPt(lead.review_count)
    : businessSizeLabel(lead.review_count);

  const lines = [
    `Business name: ${cleanBusinessName(lead.business_name)}`,
    `Niche: ${lead.niche ?? "local business"}`,
    `City: ${lead.city}`,
  ];

  // ── Business context (rating, reviews, size) ────
  if (lead.rating != null) {
    lines.push(`Google rating: ${lead.rating}/5 (${lead.review_count ?? 0} reviews)`);
  }
  if (sizeLabel) {
    lines.push(`Business size: ${sizeLabel}`);
  }

  // ── Niche-specific context ────
  lines.push(`\nNiche-specific services to highlight: ${niche.focus}`);
  lines.push(`Niche market insight: ${niche.pain}`);
  lines.push(`Tone guidance: ${niche.tone}`);

  if (isNoWebsite) {
    // No-website leads: no tech analysis, different framing
    lines.push(`\nThis business has NO website. They are invisible online.`);
    if (lead.phone) {
      lines.push(`They have a phone number, so they exist — just no web presence.`);
    }
  } else {
    // Regular leads: include detected problems
    const problems = translateReasons(lead.score_reasons ?? [], lead.tech_stack);
    if (problems.length > 0) {
      lines.push(`\nDetected problems:\n${problems.map((p) => `- ${p}`).join("\n")}`);
    }

    if (Array.isArray(lead.visual_notes) && lead.visual_notes.length > 0) {
      lines.push(`Visual issues detected on the website:\n${lead.visual_notes.map((n) => `- ${n}`).join("\n")}`);
    }

    if (lead.mobile_score !== null && lead.mobile_score !== undefined) {
      lines.push(`Mobile speed score: ${lead.mobile_score}/100`);
    }
    if (lead.tech_stack && lead.tech_stack !== "unknown") {
      lines.push(`Site platform: ${lead.tech_stack}`);
    }
    if (lead.website) {
      lines.push(`Current website: ${lead.website}`);
    }
  }

  lines.push(
    `\nLanguage: ${lang === "pt" ? "Portuguese (Brazilian)" : "English"}`,
  );

  return lines.join("\n");
}

// ── System prompt assembler ──────────────────────────────────────────────────

function buildSystemPrompt(lead, lang, variant, channel) {
  const isNoWebsite = lead.no_website === true;

  // Base system prompt — email channel uses dedicated email prompts
  let base;
  if (channel === 'email' && lang === 'en') {
    base = isNoWebsite ? SYSTEM_NO_WEBSITE_EMAIL_EN : SYSTEM_EMAIL_EN;
  } else if (isNoWebsite) {
    base = lang === 'pt' ? SYSTEM_NO_WEBSITE_PT : SYSTEM_NO_WEBSITE_EN;
  } else {
    base = lang === 'pt' ? SYSTEM_PT : SYSTEM_EN;
  }

  // Append variant instruction
  const variantBlock = getVariantInstruction(variant, lang, channel);

  return `${base}\n\n--- MESSAGE VARIANT ---\n${variantBlock}`;
}

// ── Main export ──────────────────────────────────────────────────────────────

/**
 * Generates outreach messages for leads.
 * @param {Array} leads - leads to generate messages for
 * @param {Object} opts
 * @param {string} opts.lang - 'en' | 'pt'
 * @param {string} opts.channel - 'whatsapp' | 'email' (auto-detected from lang if omitted)
 */
export async function generateMessages(leads, { lang = "en", channel } = {}) {
  // Auto-detect channel from lang if not explicitly set
  const resolvedChannel = channel ?? (lang === 'pt' ? 'whatsapp' : 'email');
  const isEmail = resolvedChannel === 'email';

  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  const total = leads.length;
  let done = 0;

  const results = await runBatch(
    leads,
    async (lead) => {
      done++;
      process.stdout.write(
        `\r  ✉️   Generating messages [${done}/${total}]...`.padEnd(60),
      );

      // Assign A/B variant
      const variant = pickVariant();

      try {
        const response = await client.messages.create({
          model: "claude-haiku-4-5-20251001",
          max_tokens: isEmail ? 500 : 300,
          system: buildSystemPrompt(lead, lang, variant, resolvedChannel),
          messages: [{ role: "user", content: buildUserPrompt(lead, lang) }],
        });

        const rawText = response.content[0]?.text?.trim() ?? "";
        // Strip markdown code fences if Claude wraps response in ```json ... ```
        const raw = rawText.replace(/^```json\s*/i, '').replace(/^```\s*/i, '').replace(/```\s*$/i, '').trim();

        // Email channel: parse JSON {subject, body}
        if (isEmail) {
          try {
            const parsed = JSON.parse(raw);
            return {
              ...lead,
              message: parsed.body ?? raw,
              email_subject: parsed.subject ?? "",
              message_variant: variant,
            };
          } catch {
            // JSON parse failed — use raw text as body, empty subject
            return { ...lead, message: raw, email_subject: "", message_variant: variant };
          }
        }

        // WhatsApp channel: plain text message
        return { ...lead, message: raw, message_variant: variant };
      } catch {
        return { ...lead, message: "", email_subject: isEmail ? "" : undefined, message_variant: variant };
      }
    },
    5,
  );

  process.stdout.write("\n");
  return results;
}
