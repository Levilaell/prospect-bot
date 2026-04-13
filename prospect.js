// Entry point — parses CLI args and orchestrates the full prospecting pipeline

import 'dotenv/config';
import { parseArgs } from 'node:util';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import csvWriterPkg from 'csv-writer';
import { collect }          from './steps/collect.js';
import { analyze }          from './steps/analyze.js';
import { visualAnalysis }   from './steps/visual.js';
import { score }            from './steps/score.js';
import { generateMessages } from './steps/message.js';
import { upsertLeads, getClient }                  from './lib/supabase.js';
import { getAlreadySentPlaceIds, sendToInstantly } from './lib/instantly.js';
import { setInstances } from './lib/whatsapp.js';
import { sendWhatsApp }                            from './lib/whatsapp.js';
import { enrichLeads }                             from './lib/enricher.js';
import { runAuto }                                 from './steps/auto.js';

const { createObjectCsvWriter } = csvWriterPkg;
const __dirname = path.dirname(fileURLToPath(import.meta.url));

// ── Arg parsing ───────────────────────────────────────────────────────────────

let raw;
try {
  ({ values: raw } = parseArgs({
    options: {
      niche:         { type: 'string' },
      city:          { type: 'string' },
      limit:         { type: 'string',  default: '20' },
      export:        { type: 'string',  default: 'csv' },
      lang:          { type: 'string',  default: 'en' },
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
  console.error('    Usage: node prospect.js --niche <niche> --city <city> [--limit N] [--export csv|supabase|both] [--lang en|pt] [--min-score N] [--dry]');
  console.error('           node prospect.js --auto [--market BR|US|all] [--limit N] [--min-score N] [--dry] [--send]');
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

  // Prevent the manual pipeline from running — runAuto handles everything
} else {

if (!raw.niche)  fatal('--niche is required  (e.g. --niche "dentists")');
if (!raw.city)   fatal('--city is required   (e.g. --city "Miami, FL")');

const exportTarget = raw.export;
if (!['csv', 'supabase', 'both'].includes(exportTarget)) {
  fatal('--export must be one of: csv, supabase, both');
}

const lang = raw.lang;
if (!['en', 'pt'].includes(lang)) {
  fatal('--lang must be one of: en, pt');
}

const limit = parseInt(raw.limit, 10);
if (isNaN(limit) || limit < 1) fatal('--limit must be a positive integer');

const minScore = parseInt(raw['min-score'], 10);
if (isNaN(minScore) || minScore < 0) fatal('--min-score must be a non-negative integer');

const dry  = raw.dry;
const send = raw.send;

// ── API key validation ────────────────────────────────────────────────────────

if (!process.env.GOOGLE_MAPS_API_KEY) fatal('GOOGLE_MAPS_API_KEY is not set in .env');
if (!dry && !process.env.ANTHROPIC_API_KEY) fatal('ANTHROPIC_API_KEY is not set in .env');
if ((exportTarget === 'supabase' || exportTarget === 'both') && !process.env.SUPABASE_URL) {
  fatal('SUPABASE_URL is not set in .env (required for --export supabase/both)');
}
if ((exportTarget === 'supabase' || exportTarget === 'both') && !process.env.SUPABASE_SERVICE_KEY) {
  fatal('SUPABASE_SERVICE_KEY is not set in .env (required for --export supabase/both)');
}
if (send && !dry) {
  if (lang === 'en') {
    if (!process.env.INSTANTLY_API_KEY)    fatal('INSTANTLY_API_KEY is not set in .env (required for --send --lang en)');
    if (!process.env.INSTANTLY_CAMPAIGN_ID) fatal('INSTANTLY_CAMPAIGN_ID is not set in .env (required for --send --lang en)');
  }
  if (lang === 'pt') {
    if (!process.env.EVOLUTION_API_URL)  fatal('EVOLUTION_API_URL is not set in .env (required for --send --lang pt)');
    if (!process.env.EVOLUTION_API_KEY)  fatal('EVOLUTION_API_KEY is not set in .env (required for --send --lang pt)');
    if (!process.env.EVOLUTION_INSTANCE) fatal('EVOLUTION_INSTANCE is not set in .env (required for --send --lang pt)');
  }
  if (lang === 'pt' && !process.env.HUNTER_API_KEY) {
    console.warn('⚠️   HUNTER_API_KEY not set — email enrichment will rely on scraping only');
  }
}

const country = lang === 'pt' ? 'BR' : 'US';
const channel = lang === 'pt' ? 'whatsapp' : 'email';

const opts = {
  niche: raw.niche,
  city:  raw.city,
  limit,
  lang,
  country,
  channel,
  minScore,
  dry,
  send,
};

// ── CSV helpers ───────────────────────────────────────────────────────────────

function buildCsvPath(niche, city) {
  const slug = (s) =>
    s.toLowerCase().replace(/[,\s]+/g, '-').replace(/-+/g, '-').replace(/^-|-$/, '');
  const ts = new Date().toISOString().slice(0, 16).replace(/:/g, '-');
  return path.join(__dirname, 'output', `leads_${slug(niche)}_${slug(city)}_${ts}.csv`);
}

function sanitizeLead(lead) {
  const num = (v) => v ?? '';
  const str = (v) => v ?? '';
  const bool = (v) => v ?? false;
  const reasons = (v) => Array.isArray(v) ? v.join(', ') : (v ?? '');

  return {
    place_id:           str(lead.place_id),
    business_name:      str(lead.business_name),
    address:            str(lead.address),
    city:               str(lead.city),
    phone:              str(lead.phone),
    website:            str(lead.website),
    rating:             num(lead.rating),
    review_count:       num(lead.review_count),
    perf_score:         num(lead.perf_score),
    mobile_score:       num(lead.mobile_score),
    fcp:                num(lead.fcp),
    lcp:                num(lead.lcp),
    cls:                num(lead.cls),
    has_ssl:            bool(lead.has_ssl),
    is_mobile_friendly: bool(lead.is_mobile_friendly),
    has_pixel:          bool(lead.has_pixel),
    has_analytics:      bool(lead.has_analytics),
    has_google_ads:     bool(lead.has_google_ads),
    has_whatsapp:       bool(lead.has_whatsapp),
    has_form:           bool(lead.has_form),
    has_booking:        bool(lead.has_booking),
    tech_stack:         str(lead.tech_stack),
    scrape_failed:      bool(lead.scrape_failed),
    visual_score:       num(lead.visual_score),
    visual_notes:       reasons(lead.visual_notes),
    pain_score:         num(lead.pain_score),
    score_reasons:      reasons(lead.score_reasons),
    message:            str(lead.message),
    collected_at:       str(lead.collected_at),
    outreach_sent:      bool(lead.outreach_sent),
    outreach_sent_at:   str(lead.outreach_sent_at),
    outreach_channel:   str(lead.outreach_channel),
    email:              str(lead.email),
    email_source:       str(lead.email_source),
    niche:              str(lead.niche),
    status:             str(lead.status),
    status_updated_at:  str(lead.status_updated_at),
    message_variant:    str(lead.message_variant),
    no_website:         bool(lead.no_website),
    email_subject:      str(lead.email_subject),
    country:            str(lead.country),
  };
}

async function exportCsv(leads, filePath) {
  const writer = createObjectCsvWriter({
    path: filePath,
    header: [
      { id: 'place_id',           title: 'place_id' },
      { id: 'business_name',      title: 'business_name' },
      { id: 'address',            title: 'address' },
      { id: 'city',               title: 'city' },
      { id: 'phone',              title: 'phone' },
      { id: 'website',            title: 'website' },
      { id: 'rating',             title: 'rating' },
      { id: 'review_count',       title: 'review_count' },
      { id: 'perf_score',         title: 'perf_score' },
      { id: 'mobile_score',       title: 'mobile_score' },
      { id: 'fcp',                title: 'fcp' },
      { id: 'lcp',                title: 'lcp' },
      { id: 'cls',                title: 'cls' },
      { id: 'has_ssl',            title: 'has_ssl' },
      { id: 'is_mobile_friendly', title: 'is_mobile_friendly' },
      { id: 'has_pixel',          title: 'has_pixel' },
      { id: 'has_analytics',      title: 'has_analytics' },
      { id: 'has_google_ads',     title: 'has_google_ads' },
      { id: 'has_whatsapp',       title: 'has_whatsapp' },
      { id: 'has_form',           title: 'has_form' },
      { id: 'has_booking',        title: 'has_booking' },
      { id: 'tech_stack',         title: 'tech_stack' },
      { id: 'scrape_failed',      title: 'scrape_failed' },
      { id: 'visual_score',       title: 'visual_score' },
      { id: 'visual_notes',       title: 'visual_notes' },
      { id: 'pain_score',         title: 'pain_score' },
      { id: 'score_reasons',      title: 'score_reasons' },
      { id: 'message',            title: 'message' },
      { id: 'collected_at',       title: 'collected_at' },
      { id: 'outreach_sent',      title: 'outreach_sent' },
      { id: 'outreach_sent_at',   title: 'outreach_sent_at' },
      { id: 'outreach_channel',   title: 'outreach_channel' },
      { id: 'email',              title: 'email' },
      { id: 'email_source',       title: 'email_source' },
      { id: 'message_variant',    title: 'message_variant' },
      { id: 'no_website',         title: 'no_website' },
      { id: 'email_subject',      title: 'email_subject' },
      { id: 'country',            title: 'country' },
    ],
  });
  await writer.writeRecords(leads.map(sanitizeLead));
}

// ── Summary ───────────────────────────────────────────────────────────────────

function printSummary({ startTime, leads, qualified, csvPath, sendResult }) {
  const elapsed = Math.round((Date.now() - startTime) / 1000);
  const mins    = Math.floor(elapsed / 60);
  const secs    = elapsed % 60;
  const timeStr = mins > 0 ? `${mins}m ${secs}s` : `${secs}s`;

  const bar = '━'.repeat(44);
  console.log(`\n${bar}`);
  console.log('✅  Done');
  console.log(`📦  Collected:  ${leads.length}`);
  console.log(`⚡  Analyzed:   ${leads.filter((l) => !l.scrape_failed).length}`);
  console.log(`🎯  Qualified:  ${qualified.length}  (score ≥ ${minScore})`);

  if (!dry) {
    if (csvPath) {
      console.log(`📁  Exported:   ${qualified.length}  → ${path.relative(process.cwd(), csvPath)}`);
    } else {
      console.log(`📁  Exported:   ${qualified.length}  → Supabase`);
    }
    if (exportTarget === 'both') {
      console.log(`📁  Exported:   ${qualified.length}  → Supabase`);
    }
    if (sendResult) {
      const parts = [
        sendResult.instantly != null ? `${sendResult.instantly.sent} email (Instantly)` : null,
        sendResult.whatsapp  != null ? `${sendResult.whatsapp.sent} WhatsApp`           : null,
        sendResult.pending   > 0     ? `${sendResult.pending} pending`                   : null,
      ].filter(Boolean);
      console.log(`📤  Outreach:  ${parts.join(' | ')}`);
    }
  }

  console.log(`⏱️   Time:       ${timeStr}`);
  console.log(`${bar}\n`);
}

// ── Pipeline ──────────────────────────────────────────────────────────────────

async function main() {
  const startTime = Date.now();

  // 1. Collect
  console.log(`\n🔍  Collecting up to ${limit} "${opts.niche}" in ${opts.city}...`);
  let leads;
  let noWebsiteLeads = [];
  try {
    const result = await collect(opts);
    leads = result.leads;
    noWebsiteLeads = result.noWebsiteLeads;
  } catch (err) {
    fatal(`collect step failed: ${err.message}`);
  }

  const totalFound = leads.length + noWebsiteLeads.length;
  if (totalFound === 0) {
    fatal('No businesses found — check your --niche and --city values, and verify GOOGLE_MAPS_API_KEY.');
  }
  console.log(`    Found ${totalFound} businesses (${leads.length} with website, ${noWebsiteLeads.length} without).`);

  // 1.5. Dedup — skip leads already in Supabase (saves API calls)
  if (exportTarget === 'supabase' || exportTarget === 'both') {
    try {
      const allPlaceIds = [...leads, ...noWebsiteLeads].map(l => l.place_id);
      const client = getClient();
      const { data: existing } = await client
        .from('leads')
        .select('place_id')
        .in('place_id', allPlaceIds);

      if (existing && existing.length > 0) {
        const existingSet = new Set(existing.map(r => r.place_id));
        const beforeLeads = leads.length;
        const beforeNoWeb = noWebsiteLeads.length;
        leads = leads.filter(l => !existingSet.has(l.place_id));
        noWebsiteLeads = noWebsiteLeads.filter(l => !existingSet.has(l.place_id));
        const skipped = (beforeLeads - leads.length) + (beforeNoWeb - noWebsiteLeads.length);
        if (skipped > 0) {
          console.log(`    Skipped ${skipped} already-known leads (dedup by place_id).`);
        }
      }
    } catch (err) {
      console.warn(`⚠️   Dedup check failed: ${err.message} — analyzing all`);
    }

    if (leads.length === 0 && noWebsiteLeads.length === 0) {
      console.log('✅  All leads already in database — nothing new to analyze.');
      process.exit(0);
    }
  }

  // ── Pipeline for leads WITH websites ──────────────────────────────────────

  let qualified = [];

  if (leads.length > 0) {
    // 2. Analyze
    console.log(`\n⚡  Analyzing ${leads.length} websites (PageSpeed + scraping)...`);
    try {
      leads = await analyze(leads);
    } catch (err) {
      fatal(`analyze step failed: ${err.message}`);
    }

    const analyzedCount = leads.filter((l) => !l.scrape_failed).length;
    console.log(`    Analyzed: ${analyzedCount}/${leads.length}  (${leads.length - analyzedCount} failed)`);

    // 2.5. Visual analysis
    if (!dry && process.env.ANTHROPIC_API_KEY) {
      console.log(`\n👁️   Running visual analysis on ${leads.length} websites...`);
      try {
        leads = await visualAnalysis(leads);
        const visualized = leads.filter((l) => l.visual_score !== null).length;
        console.log(`    Visual: ${visualized}/${leads.length} sites analyzed`);
      } catch (err) {
        console.warn(`⚠️   Visual analysis failed (continuing without it): ${err.message}`);
        leads = leads.map((l) => ({ ...l, visual_score: null, visual_notes: [] }));
      }
    } else {
      leads = leads.map((l) => ({ ...l, visual_score: null, visual_notes: [] }));
    }

    // 3. Score
    console.log('\n🎯  Scoring leads...');
    try {
      leads = score(leads, { country });
    } catch (err) {
      fatal(`score step failed: ${err.message}`);
    }

    qualified = leads.filter((l) => (l.pain_score ?? 0) >= minScore);
    console.log(`    Qualified: ${qualified.length}/${leads.length}  (score ≥ ${minScore})`);
  }

  // ── Pipeline for leads WITHOUT websites ─────────────────────────────────
  if (noWebsiteLeads.length > 0) {
    console.log(`\n🌐  ${noWebsiteLeads.length} leads without website — marking as high-priority prospects.`);
    noWebsiteLeads = noWebsiteLeads.map(l => ({
      ...l,
      pain_score: 10,
      score_reasons: ['no_website'],
      scrape_failed: false,
    }));
  }

  // ── Merge pipelines ────────────────────────────────────────────────────
  const allQualified = [...qualified, ...noWebsiteLeads];

  if (dry) {
    console.log('\n    --dry mode: skipping message generation and export.');
    printSummary({ startTime, leads, qualified: allQualified, csvPath: null });
    return;
  }

  if (allQualified.length === 0) {
    console.log('\n    No leads met the minimum score — nothing to export.');
    printSummary({ startTime, leads, qualified: allQualified, csvPath: null });
    return;
  }

  // 4. Generate messages (handles both with-website and no-website via no_website flag)
  console.log(`\n✉️   Generating ${channel} messages (${lang.toUpperCase()}) for ${allQualified.length} leads (${noWebsiteLeads.length} no-website)...`);
  let withMessages;
  try {
    withMessages = await generateMessages(allQualified, { lang, channel });
  } catch (err) {
    fatal(`message step failed: ${err.message}`);
  }

  // 4.5. Enrich emails + route (only when --send)
  let forInstantly = [];
  let forWhatsApp  = [];
  let pending      = [];

  if (send) {
    console.log(`\n🔎  Enriching ${withMessages.length} leads with email...`);
    withMessages = await enrichLeads(withMessages, { country });

    forWhatsApp  = withMessages.filter((l) => lang === 'pt' && l.phone);
    forInstantly = withMessages.filter((l) => lang !== 'pt' && l.email);
    pending      = withMessages.filter((l) =>
      (lang === 'pt' && !l.phone) ||
      (lang !== 'pt' && !l.email)
    );

    console.log('\n📤  Routing outreach...');
    console.log(`    → Instantly (email):    ${forInstantly.length} leads`);
    console.log(`    → WhatsApp (BR):        ${forWhatsApp.length} leads`);
    console.log(`    → Pending (no channel): ${pending.length} leads`);
  }

  // 5. Export
  let csvPath = null;

  if (exportTarget === 'csv' || exportTarget === 'both') {
    csvPath = buildCsvPath(opts.niche, opts.city);
    try {
      await exportCsv(withMessages, csvPath);
    } catch (err) {
      fatal(`CSV export failed: ${err.message}`);
    }
  }

  if (exportTarget === 'supabase' || exportTarget === 'both') {
    await upsertLeads(withMessages);
  }

  // 6. Dispatch outreach
  let sendResult = null;
  if (send) {
    const result = { instantly: null, whatsapp: null, pending: pending.length };

    // 6a. Instantly — email leads
    if (forInstantly.length > 0) {
      try {
        const alreadySent = await getAlreadySentPlaceIds(forInstantly.map((l) => l.place_id));
        const toSend      = forInstantly.filter((l) => !alreadySent.has(l.place_id));
        const skipped     = alreadySent.size;

        if (toSend.length === 0) {
          console.log('\n    All email leads already sent to Instantly.');
          result.instantly = { sent: 0, skipped, failed: 0 };
        } else {
          const { sent, failed } = await sendToInstantly(toSend);
          result.instantly = { sent, skipped, failed };
          console.log(`\n    Instantly: sent=${sent} skipped=${skipped} failed=${failed}`);
        }
      } catch (err) {
        console.warn(`\n⚠️   Instantly send failed: ${err.message}`);
      }
    }

    // 6b. WhatsApp — BR leads without email
    if (forWhatsApp.length > 0) {
      try {
        const alreadySentWA = await getAlreadySentPlaceIds(forWhatsApp.map((l) => l.place_id));
        const toSendWA      = forWhatsApp.filter((l) => !alreadySentWA.has(l.place_id));
        if (alreadySentWA.size > 0) {
          console.log(`    ↳ ${alreadySentWA.size} already sent via WhatsApp — skipping duplicates`);
        }
        const { sent, skipped, failed } = await sendWhatsApp(toSendWA);
        result.whatsapp = { sent, skipped, failed };
        console.log(`    WhatsApp:  sent=${sent} skipped=${skipped} failed=${failed}`);
      } catch (err) {
        console.warn(`⚠️   WhatsApp send failed: ${err.message}`);
      }
    }

    // 6c. Pending — mark in Supabase, no send
    if (pending.length > 0) {
      try {
        const client = getClient();
        await client
          .from('leads')
          .upsert(
            pending.map((l) => ({ place_id: l.place_id, outreach_channel: 'pending' })),
            { onConflict: 'place_id' },
          );
        // Stamp in-memory so CSV reflects it
        for (const l of pending) l.outreach_channel = 'pending';
      } catch (err) {
        console.warn(`⚠️   Could not mark pending leads in Supabase: ${err.message}`);
      }
    }

    sendResult = result;
  }

  printSummary({ startTime, leads, qualified: withMessages, csvPath, sendResult });
}

main().catch((err) => {
  console.error(`❌  Fatal: ${err.message}`);
  process.exit(1);
});

} // end else (manual mode)
