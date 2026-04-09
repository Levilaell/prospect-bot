// Calls Claude API to generate a personalized outreach message for each qualified lead

import Anthropic from "@anthropic-ai/sdk";
import { runBatch } from "../lib/utils.js";
import { SYSTEM_EN, SYSTEM_PT, REASON_LABELS, translateReasons } from "../lib/prompts.js";

function buildUserPrompt(lead, lang) {
  const problems = translateReasons(lead.score_reasons ?? [], lead.tech_stack);
  const lines = [
    `Business name: ${lead.business_name}`,
    `Niche: ${lead.niche ?? "local business"}`,
    `City: ${lead.city}`,
    `Detected problems:\n${problems.map((p) => `- ${p}`).join("\n")}`,
  ];

  // Include visual notes if available
  if (Array.isArray(lead.visual_notes) && lead.visual_notes.length > 0) {
    lines.push(`Visual issues detected on the website:\n${lead.visual_notes.map((n) => `- ${n}`).join("\n")}`);
  }

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
