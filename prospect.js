// Entry point — parses CLI args and orchestrates the autonomous prospecting pipeline

import 'dotenv/config';
import { parseArgs } from 'node:util';
import { readFileSync } from 'node:fs';
import { setInstances }   from './lib/whatsapp.js';
import { runAuto }        from './steps/auto.js';
import { validateCrmEnv } from './lib/crm-client.js';

// ── Arg parsing ───────────────────────────────────────────────────────────────

let raw;
try {
  ({ values: raw } = parseArgs({
    options: {
      limit:         { type: 'string',  default: '20' },
      'min-score':   { type: 'string',  default: '3' },
      dry:           { type: 'boolean', default: false },
      send:          { type: 'boolean', default: false },
      auto:          { type: 'boolean', default: false },
      market:        { type: 'string',  default: 'all' },
      config:        { type: 'string' },
      'max-send':    { type: 'string' },
    },
    strict: true,
    allowPositionals: true,
  }));
} catch (err) {
  console.error(`❌  Invalid arguments: ${err.message}`);
  console.error('    Usage: node prospect.js --auto [--market BR|US|all] [--limit N] [--min-score N] [--dry] [--send] [--max-send N] [--config <path>]');
  process.exit(1);
}

// ── Validation ────────────────────────────────────────────────────────────────

function fatal(msg) {
  console.error(`❌  ${msg}`);
  process.exit(1);
}

// ── Auto mode ─────────────────────────────────────────────────────────────────
if (raw.auto) {
  // Auto mode only requires Supabase + Google Maps keys
  if (!process.env.GOOGLE_MAPS_API_KEY) fatal('GOOGLE_MAPS_API_KEY is not set in .env');
  if (!process.env.SUPABASE_URL)        fatal('SUPABASE_URL is not set in .env (required for --auto)');
  if (!process.env.SUPABASE_SERVICE_KEY) fatal('SUPABASE_SERVICE_KEY is not set in .env (required for --auto)');

  const autoLimit    = parseInt(raw.limit, 10) || 20;
  const autoMinScore = parseInt(raw['min-score'], 10) || 3;
  const market       = raw.market?.toUpperCase() === 'BR' ? 'BR'
                     : raw.market?.toUpperCase() === 'US' ? 'US'
                     : 'all';

  // Load external config from dashboard if provided via --config <path>
  let externalConfig;
  if (raw.config) {
    try {
      externalConfig = JSON.parse(readFileSync(raw.config, 'utf-8'));
      console.log(`📂  External config loaded: ${externalConfig.country} — ${externalConfig.niches.length} niches, ${externalConfig.cities.length} cities`);
      if (externalConfig.evolutionInstances && externalConfig.evolutionApiUrl) {
        setInstances(externalConfig.evolutionInstances, externalConfig.evolutionApiUrl);
      }
    } catch (err) {
      console.warn(`⚠️  Failed to load config file: ${err.message} — using built-in config`);
    }
  }

  const maxSend = raw['max-send'] ? parseInt(raw['max-send'], 10) : undefined;

  // CRM client is required whenever we might actually send, so fail fast on
  // missing shared-secret / base URL.
  if (raw.send) {
    try { validateCrmEnv(); } catch (err) { fatal(err.message); }
  }

  runAuto({
    minScore: autoMinScore,
    dry:      raw.dry,
    send:     raw.send,
    limit:    autoLimit,
    market,
    externalConfig,
    maxSend,
  }).catch((err) => {
    console.error(`❌  Auto mode fatal: ${err.message}`);
    process.exit(1);
  });
}
