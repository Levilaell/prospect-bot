// Test config only — used by `prospect.js --auto` when no --config is passed.

// ── Lab message template override ────────────────────────────────────────
// When admin dispatches a variant via /api/experiments/[id]/run-variant the
// externalConfig carries a `message_template` field. setMessageTemplate
// stores it module-wide; steps/auto.js calls getMessageTemplate to know
// whether to skip the Claude generateMessages step and interpolate the
// variant template directly. Avoids per-lead Anthropic spend during lab runs.

let _messageTemplate = null;

export function setMessageTemplate(template) {
  _messageTemplate = typeof template === 'string' && template.trim() ? template : null;
}

export function getMessageTemplate() {
  return _messageTemplate;
}

/**
 * Interpolate {nome}, {cidade}, {vertical} placeholders in a variant template.
 * Missing fields render as empty string — caller is responsible for picking
 * variants whose templates make sense without optional fields.
 */
export function interpolateMessageTemplate(template, lead) {
  if (!template) return '';
  return template
    .replace(/\{nome\}/g, lead.business_name ?? '')
    .replace(/\{cidade\}/g, lead.city ?? '')
    .replace(/\{vertical\}/g, lead.niche ?? '');
}

// Production runs via dashboard pass the full niche/city lists as externalConfig
// through bot-server HTTP (see /api/bot/run-auto in the admin repo).
//
// Keep this small: reduced scope helps debugging by iterating fast.
// To edit the production lists, update admin/lib/bot-config.ts instead.

export const AUTO_CONFIG = {
  niches: {
    BR: [
      'clínicas odontológicas',
      'barbearias',
    ],
  },
  cities: {
    BR: [
      { name: 'Campinas, SP', regions: ['Centro de Campinas, SP'] },
      { name: 'Ribeirão Preto, SP', regions: ['Centro de Ribeirão Preto, SP'] },
    ],
  },
};

function expandCityTargets(cityConfig) {
  if (cityConfig.regions && cityConfig.regions.length > 0) {
    return cityConfig.regions;
  }
  return [cityConfig.name];
}

/**
 * Returns all (niche, searchCity, lang, channel) combos.
 *
 * If `externalConfig` is provided, uses it as the source of truth
 * (sent by the dashboard). Otherwise falls back to the hardcoded AUTO_CONFIG.
 *
 * @param {object} [externalConfig] - { niches, cities, country, lang, channel } from dashboard
 */
export function getAllTargets(externalConfig) {
  if (externalConfig) {
    const { niches, cities, country, lang, channel } = externalConfig;
    const resolvedChannel = channel ?? 'whatsapp';
    const targets = [];
    for (const city of cities) {
      for (const niche of niches) {
        targets.push({
          niche,
          searchCity: city,
          lang,
          country,
          channel: resolvedChannel,
          cityName: city,
        });
      }
    }
    return targets;
  }
  // ⚠️ FALLBACK — only used for standalone CLI runs without dashboard config
  console.warn('[warn] No external config received — using local fallback. Run via dashboard for correct config.');
  const targets = [];
  for (const cityConfig of AUTO_CONFIG.cities.BR) {
    const searchTargets = expandCityTargets(cityConfig);
    for (const searchCity of searchTargets) {
      for (const niche of AUTO_CONFIG.niches.BR) {
        targets.push({
          niche,
          searchCity,
          lang: 'pt',
          country: 'BR',
          channel: 'whatsapp',
          cityName: cityConfig.name,
        });
      }
    }
  }
  return targets;
}
