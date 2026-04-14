// A/B testing — 3 message variants with different persuasion approaches.
// Each lead gets a randomly assigned variant, saved for conversion tracking.

export const VARIANTS = [
  "problem_solution",
  "missed_opportunity",
  "provocative_question",
];

/**
 * Variant-specific instructions appended to the system prompt.
 * These override the message structure/approach while keeping persona and rules intact.
 */
export const VARIANT_INSTRUCTIONS = {
  problem_solution: {
    pt: `ABORDAGEM: Problema → consequência leve → solução

Primeira frase:
- Observação real em primeira pessoa
- Descrever o que foi visto
- Incluir consequência leve (ex: desistência, não seguir)

Segunda frase:
- Oferta natural começando com "Sou o Levi"
- Mostrar solução direta para o problema observado

Terceira frase:
- CTA curto convidando resposta`,

    en: `APPROACH: Problem → Consequence → Solution`,
  },

  missed_opportunity: {
    pt: `ABORDAGEM: Oportunidade não aproveitada

Primeira frase:
- Mostrar gap entre qualidade do negócio e o site
- Incluir consequência leve (ex: pode não transmitir confiança, pode afastar clientes)

Segunda frase:
- Oferta mostrando como isso melhora a percepção do cliente

Terceira frase:
- CTA curto convidando resposta`,

    en: `APPROACH: Missed opportunity → Gain`,
  },

  provocative_question: {
    pt: `ABORDAGEM: Pergunta que faz pensar

Primeira frase:
- Pergunta baseada no que foi visto
- Deve sugerir uma possível consequência leve
- Gerar reflexão leve

Segunda frase:
- Oferta conectando diretamente com a pergunta feita

Terceira frase:
- CTA curto convidando resposta`,

    en: `APPROACH: Question → Insight → Offer`,
  },
};

/**
 * Picks a random variant for a lead.
 * Distribution is uniform across all 3 variants.
 */
export function pickVariant() {
  return VARIANTS[Math.floor(Math.random() * VARIANTS.length)];
}

export function getVariantInstruction(variant, lang) {
  const v = VARIANT_INSTRUCTIONS[variant];
  const fallback = VARIANT_INSTRUCTIONS.problem_solution;
  return v?.[lang] ?? fallback[lang];
}
