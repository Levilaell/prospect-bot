// Autonomous runner — processes the queue item by item,
// respecting WhatsApp daily cap and stopping when done.

import { generateQueue } from '../lib/queue.js';
import { collect }          from './collect.js';
import { analyze }          from './analyze.js';
import { visualAnalysis }   from './visual.js';
import { score }            from './score.js';
import { generateMessages } from './message.js';
import { upsertLeads, getClient } from '../lib/supabase.js';
import { enrichLeads }      from '../lib/enricher.js';
import { sendWhatsApp }     from '../lib/whatsapp.js';
import { sendSms }          from '../lib/sms.js';
import { getAlreadySentPlaceIds, sendToInstantly } from '../lib/instantly.js';
import { notifyCrmProjectCreate } from '../lib/crm-client.js';

/**
 * Runs a single queue item through the full pipeline.
 * Returns { collected, qualified, sent } counts.
 */
async function processItem(item, { minScore, dry, send, limit, maxSend, totalSentSoFar = 0 }) {
  const { niche, searchCity, lang, country = lang === 'pt' ? 'BR' : 'US' } = item;
  // Channel comes from the campaign config (dashboard sends it via externalConfig).
  // Fall back to lang-based defaults for direct CLI / legacy callers: BR→WA, US→email.
  const channel = item.channel ?? (lang === 'pt' ? 'whatsapp' : 'email');
  const tag = `[${niche} | ${searchCity}]`;

  // SMS provider (Twilio) isn't wired yet — every send would fail with
  // sms_not_configured AND the end-of-run cleanup would then delete the
  // prospected leads, so next run re-scrapes them (burns Google Places +
  // Claude budget on every pass). Block --send until SMS is live.
  if (channel === 'sms' && send) {
    console.warn(`\n⚠️   ${tag} SMS provider not configured — refusing --send to avoid burning collect/analyze budget on failed sends.`);
    console.warn(`    Re-run with --dry to scrape + score leads, or wire up lib/sms.js first.`);
    return { collected: 0, qualified: 0, sent: 0 };
  }

  // 1. Collect
  console.log(`\n🔍  ${tag} Collecting up to ${limit} leads...`);
  let leads;
  let noWebsiteLeads = [];
  try {
    const result = await collect({ niche, city: searchCity, limit, searchCity });
    leads = result.leads;
    noWebsiteLeads = result.noWebsiteLeads;
    // Stamp country on every lead before any persistence (Bot-A2 fix)
    leads = leads.map(l => ({ ...l, country }));
    noWebsiteLeads = noWebsiteLeads.map(l => ({ ...l, country }));
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

  // 1.6. Phone filter (WA + SMS campaigns only) — disqualify leads without a
  // valid mobile number for the target country. Email campaigns don't need
  // phone validation at this stage.
  if (channel === 'whatsapp' || channel === 'sms') {
    const normalize = (raw) => {
      const digits = (raw || '').replace(/\D/g, '');
      if (country === 'US') {
        if (digits.startsWith('1') && digits.length === 11) return digits;
        if (digits.length === 10) return '1' + digits;
        return digits;
      }
      // BR default
      if (digits.startsWith('55')) return digits;
      if (digits.startsWith('0')) return '55' + digits.slice(1);
      return '55' + digits;
    };
    const validShape = (phone) => {
      if (country === 'US') return /^1\d{10}$/.test(phone);
      // BR requires mobile (9th-digit rule) for WhatsApp sends
      return /^55\d{2}9\d{8}$/.test(phone);
    };

    const filterByPhone = (list) => {
      const valid = [];
      const invalid = [];
      for (const lead of list) {
        const normalized = normalize(lead.phone);
        if (validShape(normalized)) {
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
        country,
        business_name: l.business_name,
        phone: l.phone || null,
        no_website: l.no_website || false,
        pain_score: 0,
        status: 'disqualified',
        status_updated_at: new Date().toISOString(),
      }));
      await upsertLeads(minimal);
      const reason = country === 'US' ? 'valid US mobile' : 'valid WhatsApp number';
      console.log(`    ${tag} Disqualified ${allNoPhone.length} leads without ${reason}.`);
    }
    leads = webResult.valid;
    noWebsiteLeads = noWebResult.valid;
    if (leads.length === 0 && noWebsiteLeads.length === 0) {
      console.log(`    ${tag} No leads with valid phone for ${channel} — skipping.`);
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

    // Qualification requires BOTH sufficient pain AND a tracking signal
    // (opportunity_score >= 1 → lead has review_count >= 80 or rating >= 4.3).
    // minScore is CLI-controlled; the opportunity threshold is hardcoded for now.
    qualified = leads.filter((l) =>
      (l.pain_score ?? 0) >= minScore && (l.opportunity_score ?? 0) >= 1,
    );
    const disqualifiedByPain = leads.filter((l) => (l.pain_score ?? 0) < minScore);
    const disqualifiedByOpportunity = leads.filter(
      (l) => (l.pain_score ?? 0) >= minScore && (l.opportunity_score ?? 0) < 1,
    );
    const disqualified = [...disqualifiedByPain, ...disqualifiedByOpportunity];
    console.log(`🎯  ${tag} Qualified: ${qualified.length}/${leads.length} with-website leads (pain >= ${minScore}, opportunity >= 1)`);
    if (disqualifiedByPain.length > 0) {
      console.log(`    ${tag} Disqualified ${disqualifiedByPain.length} by pain_score < ${minScore}`);
    }
    if (disqualifiedByOpportunity.length > 0) {
      console.log(`    ${tag} Disqualified ${disqualifiedByOpportunity.length} by opportunity_score < 1 (no tracking signal)`);
    }

    if (disqualified.length > 0) {
      const minimal = disqualified.map(l => ({
        place_id: l.place_id,
        niche: l.niche,
        search_city: l.search_city,
        city: l.city,
        country,
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

  // ── US-WhatsApp preview-first branch ────────────────────────────────────
  // Instead of generating a cold outreach message and sending it, hand the
  // qualified leads off to the admin: it creates a Project, generates the
  // Claude Code prompt + images, and waits for Levi to run Claude Code
  // locally and paste the preview URL. Admin + Levi dispatch the outreach
  // (with the URL embedded) later via the /bot UI.
  if (channel === 'whatsapp' && country === 'US') {
    await upsertLeads(allQualified);
    let created = 0;
    let reused = 0;
    let failed = 0;
    for (const lead of allQualified) {
      const res = await notifyCrmProjectCreate({ place_id: lead.place_id });
      if (res?.ok) {
        if (res.already_existed) reused++;
        else created++;
      } else {
        failed++;
        console.warn(
          `⚠️  ${tag} CRM project/create failed for ${lead.place_id}: ${res?.error ?? 'unknown'}`,
        );
      }
    }
    console.log(
      `🧰  ${tag} US preview-first: ${created} project(s) created, ${reused} already existed, ${failed} failed.`,
    );
    // `sent=0` here — the outreach message hasn't been dispatched yet; admin
    // sends it once Levi pastes the preview URL. Returning qualified count so
    // run summary still makes sense.
    return { collected: totalCollected, qualified: allQualified.length, sent: 0 };
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
    // Email campaigns enrich email from the site before dispatching.
    if (channel === 'email') withMessages = await enrichLeads(withMessages);

    const remaining = maxSend ? maxSend - totalSentSoFar : undefined;

    if (channel === 'whatsapp') {
      const forWA = withMessages.filter((l) => l.phone);
      if (forWA.length > 0) {
        try {
          const alreadySent = await getAlreadySentPlaceIds(forWA.map((l) => l.place_id));
          const toSend = forWA.filter((l) => !alreadySent.has(l.place_id));
          const result = await sendWhatsApp(toSend, { maxSend: remaining, country });
          sentCount += result.sent;
          maxSendReached = !!result.maxSendReached;
        } catch (err) {
          console.warn(`⚠️  ${tag} WhatsApp send failed: ${err.message}`);
        }
      }
    } else if (channel === 'sms') {
      const forSms = withMessages.filter((l) => l.phone);
      if (forSms.length > 0) {
        try {
          const alreadySent = await getAlreadySentPlaceIds(forSms.map((l) => l.place_id));
          const toSend = forSms.filter((l) => !alreadySent.has(l.place_id));
          const result = await sendSms(toSend, { maxSend: remaining });
          sentCount += result.sent;
          maxSendReached = !!result.maxSendReached;
        } catch (err) {
          console.warn(`⚠️  ${tag} SMS send failed: ${err.message}`);
        }
      }
    } else if (channel === 'email') {
      const forEmail = withMessages.filter((l) => l.email);
      if (forEmail.length > 0) {
        try {
          const alreadySent = await getAlreadySentPlaceIds(forEmail.map((l) => l.place_id));
          const toSend = forEmail.filter((l) => !alreadySent.has(l.place_id));
          if (toSend.length > 0) {
            const result = await sendToInstantly(toSend, { maxSend: remaining });
            sentCount += result.sent;
            maxSendReached = !!result.maxSendReached;
          }
        } catch (err) {
          console.warn(`⚠️  ${tag} Instantly send failed: ${err.message}`);
        }
      }
    }
  }

  // Status transition (prospected → sent) is now owned by the CRM — each
  // successful send posts to /api/bot/outreach/sent and the CRM updates the
  // lead row there. Nothing to do here.

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
  const runStartedAt = new Date(startTime).toISOString();
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
  console.log(`    WhatsApp sent today:      ${stats.whatsappSentToday}`);

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
    processed++;
    console.log(`\n${'═'.repeat(50)}`);
    console.log(`📌  Queue item ${processed}/${queue.length}`);

    const result = await processItem(item, { minScore, dry, send, limit, maxSend, totalSentSoFar: totalSent });
    totalCollected += result.collected;
    totalQualified += result.qualified;
    totalSent      += result.sent;

    // Stop the whole run — not just sends — when all instances are capped.
    // Without this, the queue loop kept calling processItem, which re-ran
    // collect/analyze/score (expensive, burns Google Places + Claude budget)
    // for leads that would never be sent.
    if (result.maxSendReached) {
      console.log(`\n⛔  All instances hit their run cap — stopping auto mode.`);
      break;
    }

    if (maxSend && totalSent >= maxSend) {
      console.log(`\n⛔  --max-send ${maxSend} reached — stopping auto mode.`);
      break;
    }
  }

  // Invariant: "se foi prospectado, foi enviado". Any lead collected during
  // this run that's still sitting at status=prospected (landline, rate limit,
  // run cap hit, all-instances-failed) would otherwise leak as dead weight —
  // dedup would then block re-prospecting it next run. Delete instead of
  // disqualifying so the business can be re-tried cleanly. Only runs in
  // real send mode (dry runs intentionally save prospected leads for preview).
  if (send) {
    try {
      const supa = getClient();
      const { data: stale, error } = await supa
        .from('leads')
        .delete()
        .eq('status', 'prospected')
        .gte('collected_at', runStartedAt)
        .select('place_id');
      if (error) {
        console.warn(`⚠️   prospected cleanup failed: ${error.message}`);
      } else if (stale && stale.length > 0) {
        console.log(`🧹  Cleaned ${stale.length} prospected leads that were never sent (landline / cap / error).`);
      }
    } catch (err) {
      console.warn(`⚠️   prospected cleanup threw: ${err.message}`);
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
