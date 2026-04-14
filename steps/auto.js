// Autonomous runner — processes the queue item by item,
// respecting WhatsApp daily cap and stopping when done.

import { generateQueue, getWhatsAppSentToday } from '../lib/queue.js';
import { collect }          from './collect.js';
import { analyze }          from './analyze.js';
import { visualAnalysis }   from './visual.js';
import { score }            from './score.js';
import { generateMessages } from './message.js';
import { upsertLeads, getClient } from '../lib/supabase.js';
import { enrichLeads }      from '../lib/enricher.js';
import { sendWhatsApp }     from '../lib/whatsapp.js';
import { getAlreadySentPlaceIds, sendToInstantly } from '../lib/instantly.js';

import { getInstances } from '../lib/whatsapp.js';

const WHATSAPP_PER_INSTANCE = 15;
function getWhatsAppDailyLimit() {
  const count = getInstances().length;
  return WHATSAPP_PER_INSTANCE * (count || 1);
}

/**
 * Runs a single queue item through the full pipeline.
 * Returns { collected, qualified, sent } counts.
 */
async function processItem(item, { minScore, dry, send, limit, maxSend, totalSentSoFar = 0 }) {
  const { niche, searchCity, lang, country = lang === 'pt' ? 'BR' : 'US' } = item;
  const channel = lang === 'pt' ? 'whatsapp' : 'email';
  const tag = `[${niche} | ${searchCity}]`;

  // 1. Collect
  console.log(`\n🔍  ${tag} Collecting up to ${limit} leads...`);
  let leads;
  let noWebsiteLeads = [];
  try {
    const result = await collect({ niche, city: searchCity, limit, searchCity });
    leads = result.leads;
    noWebsiteLeads = result.noWebsiteLeads;
  } catch (err) {
    console.warn(`⚠️  ${tag} collect failed: ${err.message}`);
    return { collected: 0, qualified: 0, sent: 0 };
  }

  const totalFound = leads.length + noWebsiteLeads.length;
  if (totalFound === 0) {
    console.log(`    ${tag} No businesses found — skipping.`);
    return { collected: 0, qualified: 0, sent: 0 };
  }
  console.log(`    ${tag} Found ${totalFound} businesses (${leads.length} with website, ${noWebsiteLeads.length} without).`);

  // 1.5. Dedup — skip leads that already exist in Supabase (saves API calls)
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
        console.log(`    ${tag} Skipped ${skipped} already-known leads (dedup by place_id).`);
      }
    }
  } catch (err) {
    console.warn(`⚠️  ${tag} dedup check failed: ${err.message} — analyzing all`);
  }

  if (leads.length === 0 && noWebsiteLeads.length === 0) {
    console.log(`    ${tag} All leads already known — skipping.`);
    return { collected: 0, qualified: 0, sent: 0 };
  }

  // 1.6. Phone filter (BR only) — disqualify leads without valid WhatsApp number
  if (lang === 'pt') {
    const filterByPhone = (list) => {
      const valid = [];
      const invalid = [];
      for (const lead of list) {
        const digits = (lead.phone || '').replace(/\D/g, '');
        const normalized = digits.startsWith('55') ? digits
          : digits.startsWith('0') ? '55' + digits.slice(1)
          : '55' + digits;
        if (normalized.match(/^55\d{2}9\d{8}$/)) {
          valid.push(lead);
        } else {
          invalid.push(lead);
        }
      }
      return { valid, invalid };
    };

    const webResult = filterByPhone(leads);
    const noWebResult = filterByPhone(noWebsiteLeads);
    const allNoPhone = [...webResult.invalid, ...noWebResult.invalid];

    if (allNoPhone.length > 0) {
      const minimal = allNoPhone.map(l => ({
        place_id: l.place_id,
        niche: l.niche,
        search_city: l.search_city,
        city: l.city,
        business_name: l.business_name,
        phone: l.phone || null,
        no_website: l.no_website || false,
        pain_score: 0,
        status: 'disqualified',
        status_updated_at: new Date().toISOString(),
      }));
      await upsertLeads(minimal);
      console.log(`    ${tag} Disqualified ${allNoPhone.length} leads without valid WhatsApp number.`);
    }
    leads = webResult.valid;
    noWebsiteLeads = noWebResult.valid;
    if (leads.length === 0 && noWebsiteLeads.length === 0) {
      console.log(`    ${tag} No leads with valid WhatsApp — skipping.`);
      return { collected: allNoPhone.length, qualified: 0, sent: 0 };
    }
  }

  // ── Pipeline for leads WITH websites ────────────────────────────────────

  let qualified = [];

  if (leads.length > 0) {
    // 2. Analyze
    console.log(`⚡  ${tag} Analyzing ${leads.length} websites...`);
    try {
      leads = await analyze(leads);
    } catch (err) {
      console.warn(`⚠️  ${tag} analyze failed: ${err.message}`);
      return { collected: leads.length + noWebsiteLeads.length, qualified: 0, sent: 0 };
    }

    // 2.5. Visual analysis
    if (!dry && process.env.ANTHROPIC_API_KEY) {
      try {
        leads = await visualAnalysis(leads);
      } catch {
        leads = leads.map((l) => ({ ...l, visual_score: null, visual_notes: [] }));
      }
    } else {
      leads = leads.map((l) => ({ ...l, visual_score: null, visual_notes: [] }));
    }

    // 3. Score
    try {
      leads = score(leads, { country });
    } catch (err) {
      console.warn(`⚠️  ${tag} score failed: ${err.message}`);
    }

    qualified = leads.filter((l) => (l.pain_score ?? 0) >= minScore);
    const disqualified = leads.filter((l) => (l.pain_score ?? 0) < minScore);
    console.log(`🎯  ${tag} Qualified: ${qualified.length}/${leads.length} with-website leads (score >= ${minScore})`);

    if (disqualified.length > 0) {
      const minimal = disqualified.map(l => ({
        place_id: l.place_id,
        niche: l.niche,
        search_city: l.search_city,
        city: l.city,
        business_name: l.business_name,
        pain_score: l.pain_score,
        status: 'disqualified',
        status_updated_at: new Date().toISOString(),
      }));
      await upsertLeads(minimal);
      console.log(`    ${tag} Saved ${minimal.length} disqualified leads (minimal, dedup only).`);
    }
  }

  // ── Pipeline for leads WITHOUT websites ─────────────────────────────────
  // They skip analyze/score/visual — pain_score=10 (maximum need: no site at all)

  if (noWebsiteLeads.length > 0) {
    console.log(`🌐  ${tag} ${noWebsiteLeads.length} leads without website — marking as high-priority prospects.`);
    noWebsiteLeads = noWebsiteLeads.map(l => ({
      ...l,
      pain_score: 10,
      score_reasons: ['no_website'],
      scrape_failed: false,
    }));
  }

  // ── Merge both pipelines for message generation ─────────────────────────

  const allQualified = [...qualified, ...noWebsiteLeads];
  const totalWithWebsite = leads.length;
  const totalCollected = totalWithWebsite + noWebsiteLeads.length;

  if (dry) {
    if (allQualified.length > 0) await upsertLeads(allQualified);
    return { collected: totalCollected, qualified: allQualified.length, sent: 0 };
  }

  if (allQualified.length === 0) {
    return { collected: totalCollected, qualified: 0, sent: 0 };
  }

  // 4. Generate messages (handles both with-website and no-website via no_website flag)
  console.log(`✉️  ${tag} Generating ${lang.toUpperCase()} ${channel} messages for ${allQualified.length} leads (${noWebsiteLeads.length} no-website)...`);
  let withMessages = allQualified;
  try {
    withMessages = await generateMessages(allQualified, { lang, channel });
  } catch (err) {
    console.warn(`⚠️  ${tag} message generation failed: ${err.message}`);
  }

  // 5. Export to Supabase (full data)
  await upsertLeads(withMessages);

  // 6. Send outreach (if --send)
  let sentCount = 0;
  let maxSendReached = false;
  if (send) {
    // Enrich emails
    withMessages = await enrichLeads(withMessages, { country });

    if (lang === 'pt') {
      // WhatsApp — BR leads with phone
      const forWA = withMessages.filter((l) => l.phone);
      if (forWA.length > 0) {
        try {
          const alreadySent = await getAlreadySentPlaceIds(forWA.map((l) => l.place_id));
          const toSend = forWA.filter((l) => !alreadySent.has(l.place_id));
          const remaining = maxSend ? maxSend - totalSentSoFar : undefined;
          const result = await sendWhatsApp(toSend, { maxSend: remaining });
          sentCount += result.sent;
          maxSendReached = !!result.maxSendReached;
        } catch (err) {
          console.warn(`⚠️  ${tag} WhatsApp send failed: ${err.message}`);
        }
      }
    } else {
      // Instantly — email leads
      const forEmail = withMessages.filter((l) => l.email);
      if (forEmail.length > 0) {
        try {
          const alreadySent = await getAlreadySentPlaceIds(forEmail.map((l) => l.place_id));
          const toSend = forEmail.filter((l) => !alreadySent.has(l.place_id));
          if (toSend.length > 0) {
            const { sent } = await sendToInstantly(toSend);
            sentCount += sent;
          }
        } catch (err) {
          console.warn(`⚠️  ${tag} Instantly send failed: ${err.message}`);
        }
      }
    }
  }

  // 7. Update status to 'sent' for leads that were actually sent
  if (sentCount > 0) {
    try {
      const client = getClient();
      const sentIds = withMessages
        .filter(l => l.outreach_sent === true)
        .map(l => l.place_id);
      if (sentIds.length > 0) {
        await client.from('leads')
          .update({ status: 'sent', status_updated_at: new Date().toISOString() })
          .in('place_id', sentIds)
          .eq('status', 'prospected');
      }
    } catch (err) {
      console.warn(`⚠️  ${tag} status update to 'sent' failed: ${err.message}`);
    }
  }

  return { collected: totalCollected, qualified: allQualified.length, sent: sentCount, maxSendReached };
}

/**
 * Main autonomous runner.
 *
 * @param {object} opts - { minScore, dry, send, limit, market, externalConfig, maxSend }
 * @param {string} opts.market - 'BR' | 'US' | 'all' (default 'all')
 * @param {object} [opts.externalConfig] - { niches, cities, country, lang } from dashboard
 * @param {number} [opts.maxSend] - max messages to send this execution (stops cleanly when reached)
 */
export async function runAuto({ minScore = 3, dry = false, send = false, limit = 20, market = 'all', externalConfig, maxSend } = {}) {
  const startTime = Date.now();
  const marketLabel = externalConfig ? externalConfig.country : (market === 'all' ? 'BR + US' : market);

  console.log(`\n🤖  AUTONOMOUS MODE — ${marketLabel}`);
  console.log('━'.repeat(50));
  console.log(`    market: ${marketLabel}  |  min-score: ${minScore}  |  limit/item: ${limit}  |  dry: ${dry}  |  send: ${send}${maxSend ? `  |  max-send: ${maxSend}` : ''}`);

  // Generate queue from Supabase diff (filtered by market or external config)
  console.log('\n📋  Generating queue...');
  const { queue, stats } = await generateQueue({ market, externalConfig });

  console.log(`    Total combos in config:  ${stats.total}`);
  console.log(`    Already prospected:      ${stats.prospected}`);
  console.log(`    Remaining in queue:       ${stats.remaining}`);
  const dailyLimit = getWhatsAppDailyLimit();
  console.log(`    WhatsApp sent today:      ${stats.whatsappSentToday}/${dailyLimit}`);
  console.log(`    WhatsApp slots left:      ${stats.whatsappSlotsLeft}`);

  if (queue.length === 0) {
    console.log('\n✅  Queue is empty — all combos have been prospected.');
    return;
  }

  if (dry) {
    // In dry mode, just show the first 20 queue items as preview
    console.log(`\n📋  Queue preview (first ${Math.min(20, queue.length)} of ${queue.length}):\n`);
    for (const item of queue.slice(0, 20)) {
      console.log(`    → ${item.niche}  |  ${item.searchCity}  |  ${item.lang}`);
    }
    if (queue.length > 20) {
      console.log(`    ... and ${queue.length - 20} more`);
    }

    // Estimate leads
    const estimatedLeads = queue.length * limit;
    console.log(`\n📊  Estimated leads if fully run: ~${estimatedLeads.toLocaleString()}`);
    return;
  }

  // Process queue items one by one
  let totalCollected = 0;
  let totalQualified = 0;
  let totalSent      = 0;
  let processed      = 0;

  for (const item of queue) {
    // Check WhatsApp daily limit before each PT item
    if (send && item.lang === 'pt') {
      const sentToday = await getWhatsAppSentToday();
      const dailyLim = getWhatsAppDailyLimit();
      if (sentToday >= dailyLim) {
        console.log(`\n⚠️  WhatsApp daily limit reached (${dailyLim}) — stopping auto mode.`);
        break;
      }
    }

    processed++;
    console.log(`\n${'═'.repeat(50)}`);
    console.log(`📌  Queue item ${processed}/${queue.length}`);

    const result = await processItem(item, { minScore, dry, send, limit, maxSend, totalSentSoFar: totalSent });
    totalCollected += result.collected;
    totalQualified += result.qualified;
    totalSent      += result.sent;

    if (maxSend && totalSent >= maxSend) {
      console.log(`\n⛔  --max-send ${maxSend} reached — stopping auto mode.`);
      break;
    }
  }

  // Summary
  const elapsed = Math.round((Date.now() - startTime) / 1000);
  const mins = Math.floor(elapsed / 60);
  const secs = elapsed % 60;
  const timeStr = mins > 0 ? `${mins}m ${secs}s` : `${secs}s`;

  console.log(`\n${'━'.repeat(50)}`);
  console.log('✅  Autonomous run complete');
  console.log(`📦  Items processed:  ${processed}/${queue.length}`);
  console.log(`📦  Total collected:  ${totalCollected}`);
  console.log(`🎯  Total qualified:  ${totalQualified}`);
  if (send) console.log(`📤  Total sent:       ${totalSent}`);
  console.log(`⏱️   Time:            ${timeStr}`);
  console.log(`${'━'.repeat(50)}\n`);
}
