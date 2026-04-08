// Calls Claude API to generate a personalized outreach message for each qualified lead

import Anthropic from "@anthropic-ai/sdk";
import { runBatch } from "../lib/utils.js";

const REASON_LABELS = {
  slow_mobile_severe: "website loads very slowly on mobile",
  slow_mobile_moderate: "website loads slowly on mobile",
  slow_mobile_mild: "website has room for speed improvement on mobile",
  no_pixel: "no Meta Pixel for retargeting",
  no_analytics: "no Google Analytics or tracking",
  no_whatsapp: "no WhatsApp contact link",
  no_form: "no contact form",
  no_booking: "no online booking or scheduling system",
  no_ssl: "no SSL certificate (HTTP only)",
  no_mobile_viewport: "not optimized for mobile screens",
};

function translateReasons(reasons, tech_stack) {
  return reasons.map((r) => {
    if (r === "outdated_builder") return `site built on ${tech_stack}`;
    return REASON_LABELS[r] ?? r;
  });
}

const SYSTEM_EN = `You are a cold outreach specialist for FastDevBuilds, a web and app development agency.
Write short, personalized outreach messages to small business owners who have detectable problems with their websites.

Rules:
- Maximum 4 sentences
- Open with the business name — never start with generic greetings like "Hey there", "Hi there", or "Hello"
- First sentence: one specific observation about their business based on a real detected problem — translate it into business impact, never cite technical metrics or numbers
- Do not mention scores, milliseconds, percentages, or technical jargon
- Do not sound like a mass message
- Do not use corporate or pushy sales language
- Never suggest a call, meeting, or video chat — the CTA must invite a text reply only (e.g. "Would that be useful?", "Want me to take a look?", "Interested?")
- Do not mention "other clients" or "other businesses we've helped" unless a specific result is provided
- Tone: casual but professional, direct
- Return only the message — no quotes, no prefix, no explanation
- Avoid clichés like "money left on the table", "game changer", "take it to the next level", "competitive edge"`;

const SYSTEM_PT = `You are Levi, a freelance developer who helps small businesses improve their digital presence.
Write a WhatsApp message in Brazilian Portuguese to a business owner based on their website problems.

Rules:
- Write in informal Brazilian Portuguese — use "você", casual tone
- Maximum 4 sentences — this is a hard limit, never exceed
- Never use emojis
- Open with the business name only — no "Oi", "Olá", "Opa" before it
- First sentence: specific observation about ONE problem only — the most impactful one from the list. Translate into business impact, never cite technical metrics, scores or milliseconds. Never mention multiple problems in the same message
- Second sentence: introduce yourself as Levi, a developer, and state the offer confidently — you will do the work first, the client only pays if they are satisfied. Make this sound like a guarantee, not a maybe
- Good offer phrasings: "Faço a melhoria no seu site, e você só paga se ficar satisfeito.", "Eu implemento, você vê funcionando, e decide se vale o pagamento.", "A gente faz, você aprova, aí a gente fala de valor."
- Third/fourth sentence: simple, confident, low-pressure CTA — a short question that invites a reply
- Good CTA examples: "Quer que eu dê uma olhada?", "Faz sentido?", "Bora?", "Te mando uma proposta?"
- Never mention calls, meetings or video chats
- Never use corporate or salesy language
- Never use clichés like "dinheiro na mesa", "próximo nível", "diferencial competitivo"
- Never claim to have helped other clients unless a specific result is provided
- Never say "pode ser", "talvez", "se quiser" when describing the offer — the offer is certain, the client's choice is what's optional
- The CTA must sound confident, not uncertain — avoid "pra ver se melhora mesmo", "talvez funcione", "pode ajudar"
- Write the message as a single flowing block of text — no line breaks between sentences
- End with exactly one question, never two questions in a row
- Return only the message — no quotes, no prefix, no explanation
- Sign the message as "Levi" at the end on a new line`;

function buildUserPrompt(lead, lang) {
  const problems = translateReasons(lead.score_reasons ?? [], lead.tech_stack);
  const lines = [
    `Business name: ${lead.business_name}`,
    `Niche: ${lead.niche ?? "local business"}`,
    `City: ${lead.city}`,
    `Detected problems:\n${problems.map((p) => `- ${p}`).join("\n")}`,
  ];

  if (lead.mobile_score !== null && lead.mobile_score !== undefined) {
    lines.push(`Mobile speed score: ${lead.mobile_score}/100`);
  }
  if (lead.tech_stack && lead.tech_stack !== "unknown") {
    lines.push(`Site platform: ${lead.tech_stack}`);
  }

  lines.push(
    `Language: ${lang === "pt" ? "Portuguese (Brazilian)" : "English"}`,
  );

  return lines.join("\n");
}

export async function generateMessages(leads, { lang = "en" } = {}) {
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
          max_tokens: 300,
          system: lang === "pt" ? SYSTEM_PT : SYSTEM_EN,
          messages: [{ role: "user", content: buildUserPrompt(lead, lang) }],
        });

        const message = response.content[0]?.text?.trim() ?? "";
        return { ...lead, message };
      } catch {
        return { ...lead, message: "" };
      }
    },
    5,
  );

  process.stdout.write("\n");
  return results;
}
