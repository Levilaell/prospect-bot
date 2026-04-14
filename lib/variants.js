// A/B testing — 3 message variants with different persuasion approaches.
// Each lead gets a randomly assigned variant, saved for conversion tracking.

export const VARIANTS = ['problem_solution', 'missed_opportunity', 'provocative_question'];

/**
 * Variant-specific instructions appended to the system prompt.
 * These override the message structure/approach while keeping persona and rules intact.
 */
export const VARIANT_INSTRUCTIONS = {
  problem_solution: {
    pt: `ABORDAGEM: Observação direta do problema
Primeira frase: nome do negócio + observação neutra e específica sobre o problema mais impactante detectado — descreve a experiência do usuário no site, não a causa técnica. Nunca acusa, nunca diz que estão perdendo algo.
Segunda frase: sempre exatamente "Sou o Levi, desenvolvedor — consigo resolver isso e você só paga se gostar do resultado."
Terceira frase: CTA curto que convida resposta.
CRÍTICO: A mensagem deve ser um único bloco de texto corrido — sem quebras de linha (\\n) entre as frases. As 3 frases ficam juntas em um parágrafo único, separadas apenas por espaço.`,
    en: `APPROACH: Problem → Solution
Lead with the most impactful problem you detected.
Translate it into real business consequence (lost customers, lack of trust).
Then present the specific solution you can deliver.
End with a soft CTA inviting a reply.`,
    email_en: `APPROACH: Problem → Solution (Email)
Subject line: Reference the specific problem you detected — make it feel personal, not salesy.
Body: Open by naming the business and the most impactful problem you found.
Translate it into real business consequence (lost customers, lower rankings, missed appointments).
Present your specific solution in 1-2 sentences.
Close with a soft CTA inviting an email reply — no calls, no links.`,
  },

  missed_opportunity: {
    pt: `ABORDAGEM: Gap de experiência
Primeira frase: nome do negócio + observação sobre algo que o site não oferece e que seria esperado pelo usuário — sem comparar com concorrentes, sem dizer que estão perdendo. Foco na experiência do visitante: "quem chega no site não consegue X".
Segunda frase: sempre exatamente "Sou o Levi, desenvolvedor — consigo resolver isso e você só paga se gostar do resultado."
Terceira frase: CTA curto que convida resposta.
CRÍTICO: A mensagem deve ser um único bloco de texto corrido — sem quebras de linha (\\n) entre as frases. As 3 frases ficam juntas em um parágrafo único, separadas apenas por espaço.`,
    en: `APPROACH: Missed Opportunity → Potential Gain
Start by showing what competitors in the area already do that this lead doesn't.
Focus on what the lead is LOSING right now (customers, bookings, sales).
Then show the concrete gain they'd have if they fixed this.
End with a soft CTA inviting a reply.

Structure example:
"[Name], most [niche] in [city] already [thing competitors do], but your site still [gap]. That means [consequence]. I can [solution] and you only pay if you like it."`,
    email_en: `APPROACH: Missed Opportunity → Potential Gain (Email)
Subject line: Reference what competitors are doing that this business isn't — create curiosity.
Body: Open by contrasting what similar businesses in the area already have vs. what this business lacks.
Quantify what they're losing (customers who leave, appointments that go to competitors).
Show the concrete gain: what changes if they fix this.
Close with a soft CTA inviting an email reply — no calls, no links.`,
  },

  provocative_question: {
    pt: `ABORDAGEM: Pergunta que gera reflexão
Primeira frase: nome do negócio + pergunta direta sobre a experiência do usuário no site — baseada no problema mais impactante detectado. A pergunta deve fazer o dono pensar "é verdade" sem se sentir acusado.
Exemplos de estrutura:
"[Nome], quem acessa o site de vocês pelo celular consegue [ação esperada] direto por lá?"
"[Nome], como alguém que chega no seu site faz para [ação esperada]?"
Segunda frase: sempre exatamente "Sou o Levi, desenvolvedor — consigo resolver isso e você só paga se gostar do resultado."
Terceira frase: CTA curto que convida resposta.
CRÍTICO: A mensagem deve ser um único bloco de texto corrido — sem quebras de linha (\\n) entre as frases. As 3 frases ficam juntas em um parágrafo único, separadas apenas por espaço.`,
    en: `APPROACH: Provocative Question → Offer
Start with a question that makes the owner think about something they haven't noticed.
The question should reveal a real gap based on the data you have.
Then connect it naturally to your offer.
End with a soft CTA inviting a reply.

Structure example:
"[Name], did you know that [surprising fact about their site/business]? [Consequence]. I can [solution] and you only pay if you like it."`,
    email_en: `APPROACH: Provocative Question → Offer (Email)
Subject line: Pose the provocative question directly — make them want to open the email.
Body: Expand on the question with a specific insight about their business or site.
Reveal the gap using data you have (without citing raw numbers).
Connect naturally to your offer as the solution.
Close with a soft CTA inviting an email reply — no calls, no links.`,
  },
};

/**
 * Picks a random variant for a lead.
 * Distribution is uniform across all 3 variants.
 */
export function pickVariant() {
  return VARIANTS[Math.floor(Math.random() * VARIANTS.length)];
}

/**
 * Returns the variant instruction block for the given variant, language, and channel.
 * For email channel with lang=en, uses the email_en key for email-specific framing.
 */
export function getVariantInstruction(variant, lang, channel) {
  const v = VARIANT_INSTRUCTIONS[variant];
  const fallback = VARIANT_INSTRUCTIONS.problem_solution;

  if (!v) {
    if (channel === 'email' && lang === 'en') return fallback.email_en ?? fallback.en;
    return fallback[lang] ?? fallback.en;
  }

  if (channel === 'email' && lang === 'en') return v.email_en ?? v.en;
  return v[lang] ?? v.en;
}
