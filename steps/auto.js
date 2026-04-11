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

const WHATSAPP_DAILY_LIMIT = 50;

/**
 * Runs a single queue item through the full pipeline.
 * Returns { collected, qualified, sent } counts.
 */
async function processItem(item, { minScore, dry, send, limit }) {
  const { niche, searchCity, lang } = item;
  const tag = `[${niche} | ${searchCity}]`;

  // 1. Collect
  console.log(`\n🔍  ${tag} Collecting up to ${limit} leads...`);
  let leads;
  try {
    leads = await collect({ niche, city: searchCity, limit, searchCity });
  } catch (err) {
    console.warn(`⚠️  ${tag} collect failed: ${err.message}`);
    return { collected: 0, qualified: 0, sent: 0 };
  }

  if (!leads || leads.length === 0) {
    console.log(`    ${tag} No businesses found — skipping.`);
    return { collected: 0, qualified: 0, sent: 0 };
  }
  console.log(`    ${tag} Found ${leads.length} businesses.`);

  // 1.5. Dedup — skip leads that already exist in Supabase (saves API calls)
  try {
    const placeIds = leads.map(l => l.place_id);
    const client = getClient();
    const { data: existing } = await client
      .from('leads')
      .select('place_id')
      .in('place_id', placeIds);

    if (existing && existing.length > 0) {
      const existingSet = new Set(existing.map(r => r.place_id));
      const before = leads.length;
      leads = leads.filter(l => !existingSet.has(l.place_id));
      const skipped = before - leads.length;
      if (skipped > 0) {
        console.log(`    ${tag} Skipped ${skipped} already-known leads (dedup by place_id).`);
      }
    }
  } catch (err) {
    console.warn(`⚠️  ${tag} dedup check failed: ${err.message} — analyzing all`);
  }

  if (leads.length === 0) {
    console.log(`    ${tag} All leads already known — skipping analysis.`);
    return { collected: 0, qualified: 0, sent: 0 };
  }

  // 1.6. Phone filter (BR only) — disqualify leads without valid WhatsApp number
  if (lang === 'pt') {
    const validWA = [];
    const noPhone = [];
    for (const lead of leads) {
      const digits = (lead.phone || '').replace(/\D/g, '');
      const normalized = digits.startsWith('55') ? digits
        : digits.startsWith('0') ? '55' + digits.slice(1)
        : '55' + digits;
      if (normalized.match(/^55\d{2}9\d{8}$/)) {
        validWA.push(lead);
      } else {
        noPhone.push(lead);
      }
    }
    if (noPhone.length > 0) {
      const minimal = noPhone.map(l => ({
        place_id: l.place_id,
        niche: l.niche,
        search_city: l.search_city,
        city: l.city,
        business_name: l.business_name,
        phone: l.phone || null,
        pain_score: 0,
        status: 'disqualified',
        status_updated_at: new Date().toISOString(),
      }));
      await upsertLeads(minimal);
      console.log(`    ${tag} Disqualified ${noPhone.length} leads without valid WhatsApp number.`);
    }
    leads = validWA;
    if (leads.length === 0) {
      console.log(`    ${tag} No leads with valid WhatsApp — skipping analysis.`);
      return { collected: noPhone.length, qualified: 0, sent: 0 };
    }
  }

  // 2. Analyze
  console.log(`⚡  ${tag} Analyzing ${leads.length} websites...`);
  try {
    leads = await analyze(leads);
  } catch (err) {
    console.warn(`⚠️  ${tag} analyze failed: ${err.message}`);
    return { collected: leads.length, qualified: 0, sent: 0 };
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
    leads = await score(leads);
  } catch (err) {
    console.warn(`⚠️  ${tag} score failed: ${err.message}`);
  }

  const qualified = leads.filter((l) => (l.pain_score ?? 0) >= minScore);
  const disqualified = leads.filter((l) => (l.pain_score ?? 0) < minScore);
  console.log(`🎯  ${tag} Qualified: ${qualified.length}/${leads.length} (score >= ${minScore})`);

  // Save disqualified leads with minimal data — just enough for dedup, invisible in dashboard
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

  if (dry) {
    if (qualified.length > 0) await upsertLeads(qualified);
    return { collected: leads.length, qualified: qualified.length, sent: 0 };
  }

  if (qualified.length === 0) {
    return { collected: leads.length, qualified: 0, sent: 0 };
  }

  // 4. Generate messages
  console.log(`✉️  ${tag} Generating ${lang.toUpperCase()} messages for ${qualified.length} leads...`);
  let withMessages = qualified;
  try {
    withMessages = await generateMessages(qualified, { lang });
  } catch (err) {
    console.warn(`⚠️  ${tag} message generation failed: ${err.message}`);
  }

  // 5. Export qualified to Supabase (full data)
  await upsertLeads(withMessages);

  // 6. Send outreach (if --send)
  let sentCount = 0;
  if (send) {
    // Enrich emails
    withMessages = await enrichLeads(withMessages);

    if (lang === 'pt') {
      // WhatsApp — BR leads with phone
      const forWA = withMessages.filter((l) => l.phone);
      if (forWA.length > 0) {
        try {
          const alreadySent = await getAlreadySentPlaceIds(forWA.map((l) => l.place_id));
          const toSend = forWA.filter((l) => !alreadySent.has(l.place_id));
          const { sent } = await sendWhatsApp(toSend);
          sentCount += sent;
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

  return { collected: leads.length, qualified: qualified.length, sent: sentCount };
}

/**
 * Main autonomous runner.
 *
 * @param {object} opts - { minScore, dry, send, limit }
 */
export async function runAuto({ minScore = 3, dry = false, send = false, limit = 20 }) {
  const startTime = Date.now();

  console.log('\n🤖  AUTONOMOUS MODE');
  console.log('━'.repeat(50));
  console.log(`    min-score: ${minScore}  |  limit/item: ${limit}  |  dry: ${dry}  |  send: ${send}`);

  // Generate queue from Supabase diff
  console.log('\n📋  Generating queue...');
  const { queue, stats } = await generateQueue();

  console.log(`    Total combos in config:  ${stats.total}`);
  console.log(`    Already prospected:      ${stats.prospected}`);
  console.log(`    Remaining in queue:       ${stats.remaining}`);
  console.log(`    WhatsApp sent today:      ${stats.whatsappSentToday}/${WHATSAPP_DAILY_LIMIT}`);
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
      if (sentToday >= WHATSAPP_DAILY_LIMIT) {
        console.log(`\n⚠️  WhatsApp daily limit reached (${WHATSAPP_DAILY_LIMIT}) — stopping auto mode.`);
        break;
      }
    }

    processed++;
    console.log(`\n${'═'.repeat(50)}`);
    console.log(`📌  Queue item ${processed}/${queue.length}`);

    const result = await processItem(item, { minScore, dry, send, limit });
    totalCollected += result.collected;
    totalQualified += result.qualified;
    totalSent      += result.sent;
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
