// Calls Claude API to generate a personalized outreach message for each qualified lead

import Anthropic from "@anthropic-ai/sdk";
import { runBatch } from "../lib/utils.js";
import {
  SYSTEM_EN,
  SYSTEM_PT,
  SYSTEM_NO_WEBSITE_EN,
  SYSTEM_NO_WEBSITE_PT,
  SYSTEM_EMAIL_EN,
  SYSTEM_NO_WEBSITE_EMAIL_EN,
  SYSTEM_SMS_EN,
  SYSTEM_NO_WEBSITE_SMS_EN,
  SYSTEM_WA_US_EN,
  SYSTEM_NO_WEBSITE_WA_US_EN,
} from "../lib/prompts.js";
import { getNicheContext } from "../lib/niche-templates.js";

// ── Business size label based on review count ────────────────────────────────

function businessSizeLabel(reviewCount) {
  if (reviewCount == null) return null;
  if (reviewCount <= 10)
    return "micro (few reviews — likely new or low visibility)";
  if (reviewCount <= 50) return "small (some traction, growing)";
  if (reviewCount <= 200) return "established (solid local presence)";
  return "popular (well-known in the area)";
}

function businessSizeLabelPt(reviewCount) {
  if (reviewCount == null) return null;
  if (reviewCount <= 10)
    return "micro (poucas avaliações — provavelmente novo ou pouca visibilidade)";
  if (reviewCount <= 50) return "pequeno (alguma tração, crescendo)";
  if (reviewCount <= 200) return "estabelecido (presença local sólida)";
  return "popular (bem conhecido na região)";
}

// ── Clean business name (strip SEO descriptors + geographic suffixes) ────────

// Strong visual-signal keywords → mainReason gets bumped to 'visual_broken'.
// Used by pickMainReason + findStrongVisualNote below.
const STRONG_VISUAL_KEYWORDS = [
  'broken', 'unfinished', 'placeholder', 'rev_slider',
  'código', 'codigo', 'error', 'erro',
  '[', '__', 'undefined', 'null', 'lorem ipsum',
];

function cleanBusinessName(name) {
  let s = name.split(/[|–—·]|  +/)[0].trim();

  // Strip trailing geographic suffixes. Idempotent on second call — if nothing matches, returns unchanged.
  s = s
    // " em Cidade" or " em Cidade/UF" at end
    .replace(/\s+em\s+[A-ZÀ-ÿ][\wÀ-ÿ\s]*?(?:\/[A-Za-z]{2})?\s*$/i, '')
    // " - Cidade" or " - Cidade/UF" at end (regular hyphen with spaces)
    .replace(/\s+-\s+[A-ZÀ-ÿ][\wÀ-ÿ\s]*?(?:\/[A-Za-z]{2})?\s*$/i, '')
    // ", Cidade/UF" at end
    .replace(/\s*,\s*[A-ZÀ-ÿ][\wÀ-ÿ\s]*?\/[A-Za-z]{2}\s*$/i, '')
    // "Cidade/UF" as trailing suffix (single capitalized word — multi-word cities
    // without a separator are ambiguous vs. business name and left untouched)
    .replace(/\s+[A-ZÀ-ÿ][\wÀ-ÿ]*\/[A-Za-z]{2}\s*$/, '')
    .trim();

  return s;
}

function findStrongVisualNote(visualNotes) {
  if (!Array.isArray(visualNotes) || visualNotes.length === 0) return null;
  for (const note of visualNotes) {
    if (typeof note !== 'string') continue;
    const lower = note.toLowerCase();
    if (STRONG_VISUAL_KEYWORDS.some((kw) => lower.includes(kw))) return note;
  }
  return null;
}

// ── Pick main reason (single dominant pain only) ─────────────────────────────

function pickMainReason(lead) {
  const reasons = lead.score_reasons ?? [];

  if (lead.no_website) return "no_website";

  // Strong visual signals (broken/unfinished/placeholder code) beat everything else:
  // a concrete finding is a better hook than a generic pain signal.
  if (findStrongVisualNote(lead.visual_notes)) return "visual_broken";

  if (reasons.includes("no_booking")) return "no_booking";
  if (reasons.includes("no_whatsapp")) return "no_whatsapp";
  if (reasons.includes("no_form")) return "no_contact";
  if (reasons.includes("slow_mobile_severe")) return "slow_mobile";
  if (lead.visual_score != null && lead.visual_score <= 4) return "poor_visual";

  return reasons[0] || "generic";
}

function getMainReasonDescription(reason, lang, lead) {
  const techStack =
    lead.tech_stack && lead.tech_stack !== "unknown" ? lead.tech_stack : null;

  const map = {
    pt: {
      no_website: "não tem site e não aparece para quem está pesquisando agora",
      no_booking: "não oferece agendamento online",
      no_whatsapp: "não mostra WhatsApp fácil no site",
      no_contact: "não deixa um caminho simples para contato",
      slow_mobile: "o site é lento no celular",
      poor_visual:
        "a primeira impressão visual no celular passa pouca confiança",
      visual_broken: "há problemas visíveis de implementação no site",
      outdated_builder: techStack
        ? `o site parece limitado pela plataforma ${techStack}`
        : "o site parece preso em uma plataforma limitada",
      no_ssl: "o site passa sensação de insegurança",
      no_mobile_viewport: "o site não está bem ajustado para celular",
      generic: "há um ponto claro no site que pode estar afastando clientes",
    },
    en: {
      no_website:
        "the business has no website and is invisible to people searching now",
      no_booking: "there is no online booking option",
      no_whatsapp: "there is no easy WhatsApp contact on the site",
      no_contact: "there is no simple contact path on the site",
      slow_mobile: "the site is slow on mobile",
      poor_visual: "the mobile first impression looks weak and hurts trust",
      visual_broken: "there are visible implementation issues on the site",
      outdated_builder: techStack
        ? `the site feels limited by the ${techStack} platform`
        : "the site feels limited by its current platform",
      no_ssl: "the site feels insecure to visitors",
      no_mobile_viewport:
        "the site is not properly optimized for mobile screens",
      generic:
        "there is a clear issue on the site that may be pushing customers away",
    },
  };

  return map[lang]?.[reason] ?? map[lang]?.generic ?? reason;
}

function getMainReasonContext(reason, lang) {
  const context = {
    pt: {
      no_website:
        "Contexto: quem pesquisa no Google ou pelo celular agora simplesmente não encontra a empresa.",
      no_booking:
        "Contexto: muitos clientes tentam agendar fora do horário comercial e vão para o concorrente se não conseguem.",
      no_whatsapp:
        "Contexto: quem quer tirar dúvida rápido desiste se não encontra contato imediato.",
      no_contact:
        "Contexto: quando o caminho de contato não é óbvio, a maioria simplesmente sai.",
      slow_mobile:
        "Contexto: a maior parte dos acessos vem do celular e páginas lentas fazem a pessoa desistir.",
      poor_visual:
        "Contexto: a primeira impressão visual influencia confiança antes mesmo da pessoa ler qualquer coisa.",
      visual_broken:
        "Contexto: elementos quebrados ou inacabados no site passam imagem de amadorismo e afastam cliente antes de converter.",
      outdated_builder:
        "Contexto: uma estrutura limitada costuma passar imagem de negócio parado ou desatualizado.",
      no_ssl:
        "Contexto: qualquer sensação de insegurança derruba confiança na hora.",
      no_mobile_viewport:
        "Contexto: se o site quebra no celular, a pessoa sai antes de entrar em contato.",
      generic:
        "Contexto: existe um ponto no site que pode estar reduzindo contatos e conversões.",
    },
    en: {
      no_website:
        "Context: people searching on Google or on their phone right now simply cannot find the business.",
      no_booking:
        "Context: many customers try to book outside business hours and move to a competitor if they can't.",
      no_whatsapp:
        "Context: people who want a quick answer leave if they cannot find immediate contact.",
      no_contact:
        "Context: when the contact path is not obvious, most visitors just leave.",
      slow_mobile:
        "Context: most traffic is mobile, and slow pages make people drop off fast.",
      poor_visual:
        "Context: first visual impression affects trust before people read anything.",
      visual_broken:
        "Context: broken or unfinished elements on the site create an amateur impression and scare off visitors.",
      outdated_builder:
        "Context: a limited platform often makes the business look outdated or stagnant.",
      no_ssl: "Context: any sense of insecurity hurts trust immediately.",
      no_mobile_viewport:
        "Context: if the site breaks on mobile, people leave before contacting.",
      generic:
        "Context: there is a clear issue on the site that may reduce inquiries and conversions.",
    },
  };

  return context[lang]?.[reason] ?? context[lang]?.generic ?? "";
}

// ── User prompt builder ──────────────────────────────────────────────────────

function buildUserPrompt(lead, lang) {
  const isNoWebsite = lead.no_website === true;
  const niche = getNicheContext(lead.niche, lang);
  const sizeLabel =
    lang === "pt"
      ? businessSizeLabelPt(lead.review_count)
      : businessSizeLabel(lead.review_count);

  const mainReason = pickMainReason(lead);
  const lines = [
    `Business name: ${cleanBusinessName(lead.business_name)}`,
    `Niche: ${lead.niche ?? "local business"}`,
    `City: ${lead.city}`,
  ];

  // Highlight real traction when review_count is credible proof — teaches the model
  // to open with review_count + rating instead of vague pain claims.
  const reviewCount = lead.review_count ?? 0;
  if (reviewCount >= 80 && lead.rating != null) {
    if (lang === "pt") {
      lines.push(
        `TRAÇÃO REAL: este negócio tem ${reviewCount} avaliações ${lead.rating} estrelas — use isso como prova de que eles têm clientes e reputação.`,
      );
    } else {
      lines.push(
        `REAL TRACTION: this business has ${reviewCount} reviews averaging ${lead.rating} stars — use this as proof they have traffic and reputation.`,
      );
    }
  }

  lines.push(
    `Main problem: ${getMainReasonDescription(mainReason, lang, lead)}`,
    getMainReasonContext(mainReason, lang),
  );

  if (lead.rating != null && reviewCount < 80) {
    lines.push(
      `Google rating: ${lead.rating}/5 (${lead.review_count ?? 0} reviews)`,
    );
  }

  if (sizeLabel) {
    lines.push(`Business size: ${sizeLabel}`);
  }

  lines.push(`\nNiche-specific services to highlight: ${niche.focus}`);
  lines.push(`Niche market insight: ${niche.pain}`);
  lines.push(`Tone guidance: ${niche.tone}`);

  if (isNoWebsite) {
    lines.push(`\nThis business has NO website.`);
    if (lead.phone) {
      lines.push(
        `They have a phone number, so they exist — just no web presence.`,
      );
    }
  } else {
    if (mainReason === "visual_broken") {
      const note = findStrongVisualNote(lead.visual_notes);
      if (note) {
        lines.push(`Visual issue to base the message on:\n- ${note}`);
      }
    }

    if (mainReason === "poor_visual") {
      if (Array.isArray(lead.visual_notes) && lead.visual_notes.length > 0) {
        lines.push(
          `Visual note to base the message on:\n- ${lead.visual_notes[0]}`,
        );
      }
    }

    if (mainReason === "slow_mobile") {
      if (lead.mobile_score !== null && lead.mobile_score !== undefined) {
        lines.push(`Mobile speed score: ${lead.mobile_score}/100`);
      }
    }

    if (
      mainReason === "outdated_builder" &&
      lead.tech_stack &&
      lead.tech_stack !== "unknown"
    ) {
      lines.push(`Site platform: ${lead.tech_stack}`);
    }

    if (lead.website) {
      lines.push(`Current website: ${lead.website}`);
    }
  }

  lines.push(
    `\nLanguage: ${lang === "pt" ? "Portuguese (Brazilian)" : "English"}`,
  );

  lines.push(
    `IMPORTANT: Base the message ONLY on the main problem above. Ignore all other possible issues.`,
  );

  return lines.filter(Boolean).join("\n");
}

// ── System prompt assembler ──────────────────────────────────────────────────

function buildSystemPrompt(lead, lang, channel) {
  const isNoWebsite = lead.no_website === true;

  if (channel === "email" && lang === "en") {
    return isNoWebsite ? SYSTEM_NO_WEBSITE_EMAIL_EN : SYSTEM_EMAIL_EN;
  }

  if (channel === "sms" && lang === "en") {
    return isNoWebsite ? SYSTEM_NO_WEBSITE_SMS_EN : SYSTEM_SMS_EN;
  }

  // US WhatsApp needs its own prompt — SYSTEM_EN is email-shaped and
  // uses "48h" and "only pay if you like it", which read as scam in a
  // US WhatsApp DM.
  if (channel === "whatsapp" && lang === "en") {
    return isNoWebsite ? SYSTEM_NO_WEBSITE_WA_US_EN : SYSTEM_WA_US_EN;
  }

  if (isNoWebsite) {
    return lang === "pt" ? SYSTEM_NO_WEBSITE_PT : SYSTEM_NO_WEBSITE_EN;
  }

  return lang === "pt" ? SYSTEM_PT : SYSTEM_EN;
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
  const resolvedChannel = channel ?? (lang === "pt" ? "whatsapp" : "email");
  const isEmail = resolvedChannel === "email";
  const isSms = resolvedChannel === "sms";

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

      try {
        const response = await client.messages.create({
          model: "claude-haiku-4-5-20251001",
          max_tokens: isEmail ? 500 : isSms ? 200 : 300,
          system: buildSystemPrompt(lead, lang, resolvedChannel),
          messages: [{ role: "user", content: buildUserPrompt(lead, lang) }],
        });

        const rawText = response.content[0]?.text?.trim() ?? "";
        const raw = rawText
          .replace(/^```json\s*/i, "")
          .replace(/^```\s*/i, "")
          .replace(/```\s*$/i, "")
          .trim();

        if (isEmail) {
          try {
            const parsed = JSON.parse(raw);
            return {
              ...lead,
              message: parsed.body ?? raw,
              email_subject: parsed.subject ?? "",
            };
          } catch {
            return {
              ...lead,
              message: raw,
              email_subject: "",
            };
          }
        }

        return { ...lead, message: raw };
      } catch {
        return {
          ...lead,
          message: "",
          email_subject: isEmail ? "" : undefined,
        };
      }
    },
    5,
  );

  process.stdout.write("\n");
  return results;
}
