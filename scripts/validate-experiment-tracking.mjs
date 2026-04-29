// Validates the P0 experiment-tracking pipeline end-to-end without going
// through the bot UI / Google Places / dedup. Inserts one synthetic lead
// with setExperimentContext active, then reads back to confirm stamping.
//
// Usage:
//   node --env-file=.env scripts/validate-experiment-tracking.mjs
//
// (or whatever .env file name your bot-server uses — the env loader is
// node's --env-file, not dotenv.)

import { createClient } from '@supabase/supabase-js'
import { randomUUID } from 'node:crypto'
import { setExperimentContext, upsertLeads } from '../lib/supabase.js'

const SUPABASE_URL = process.env.SUPABASE_URL
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY
if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
  console.error('Missing SUPABASE_URL or SUPABASE_SERVICE_KEY in env')
  process.exit(1)
}

const FAKE_CAMPAIGN = 'BR-VALIDATION'
const FAKE_PLACE_ID = `test_validate_${Date.now()}`

// Insert a synthetic bot_runs row to satisfy the FK on leads.bot_run_id.
// Mirrors what /api/bot/run-auto does on the admin side before spawning
// prospect.js. We let Supabase generate the UUID via the column default.
const supabaseAdmin = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY)
const { data: runRow, error: runErr } = await supabaseAdmin
  .from('bot_runs')
  .insert({ status: 'running', campaign_code: FAKE_CAMPAIGN })
  .select('id')
  .single()
if (runErr) {
  console.error('❌  Failed to insert bot_runs row:', runErr.message)
  process.exit(1)
}
const FAKE_RUN_ID = runRow.id

console.log(`▶  Setting experiment context:`)
console.log(`   campaign_code: ${FAKE_CAMPAIGN}`)
console.log(`   bot_run_id:    ${FAKE_RUN_ID}`)
console.log(`   place_id:      ${FAKE_PLACE_ID}`)
console.log()

setExperimentContext({
  campaign_code: FAKE_CAMPAIGN,
  bot_run_id: FAKE_RUN_ID,
})

const fakeLead = {
  place_id: FAKE_PLACE_ID,
  business_name: 'Studio Test Validation',
  niche: 'salões de beleza',
  country: 'BR',
  city: 'Validation City',
  search_city: 'Validation City',
  rating: 5.0,
  review_count: 100,
  pain_score: 10,
  no_website: true,
  status: 'prospected',
  status_updated_at: new Date().toISOString(),
}

console.log(`▶  Calling upsertLeads with 1 synthetic lead...`)
await upsertLeads([fakeLead])
console.log()

console.log(`▶  Reading back from DB...`)
const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY)
const { data, error } = await supabase
  .from('leads')
  .select(
    'place_id, business_name, niche, country, campaign_code, bot_run_id, owner_probability',
  )
  .eq('place_id', FAKE_PLACE_ID)
  .maybeSingle()

if (error) {
  console.error('❌  SELECT failed:', error.message)
  process.exit(1)
}
if (!data) {
  console.error(`❌  Row not found — upsert silently failed for ${FAKE_PLACE_ID}`)
  // Cleanup orphaned bot_runs row before exiting
  await supabase.from('bot_runs').delete().eq('id', FAKE_RUN_ID)
  process.exit(1)
}

console.log(JSON.stringify(data, null, 2))
console.log()

const checks = [
  ['campaign_code', data.campaign_code === FAKE_CAMPAIGN],
  ['bot_run_id', data.bot_run_id === FAKE_RUN_ID],
  [
    'owner_probability',
    typeof data.owner_probability === 'number' &&
      data.owner_probability >= 0 &&
      data.owner_probability <= 100,
  ],
]

let pass = true
for (const [name, ok] of checks) {
  console.log(`  ${ok ? '✅' : '❌'}  ${name}`)
  if (!ok) pass = false
}
console.log()

if (pass) {
  console.log('▶  PASS — P0 stamping works end-to-end on fresh insert.')
  console.log()
  console.log('Bonus check: re-running same upsert should preserve campaign_code')
  console.log('(first-write-wins via preserveStickyAttributions).')
  console.log()

  // Try to overwrite with a different campaign — should be preserved
  const { data: runRow2, error: runErr2 } = await supabase
    .from('bot_runs')
    .insert({ status: 'running', campaign_code: 'OTHER-CAMPAIGN' })
    .select('id')
    .single()
  if (runErr2) {
    console.error('❌  Failed to insert second bot_runs row:', runErr2.message)
    process.exit(1)
  }
  const SECOND_RUN_ID = runRow2.id
  setExperimentContext({
    campaign_code: 'OTHER-CAMPAIGN',
    bot_run_id: SECOND_RUN_ID,
  })
  await upsertLeads([fakeLead])
  const { data: data2 } = await supabase
    .from('leads')
    .select('campaign_code, bot_run_id')
    .eq('place_id', FAKE_PLACE_ID)
    .maybeSingle()

  const stickyOk =
    data2?.campaign_code === FAKE_CAMPAIGN &&
    data2?.bot_run_id === FAKE_RUN_ID

  console.log(`  ${stickyOk ? '✅' : '❌'}  preserveStickyAttributions preserved original campaign_code/bot_run_id`)
  if (!stickyOk) {
    console.log(`     got: campaign_code=${data2?.campaign_code}, bot_run_id=${data2?.bot_run_id}`)
    console.log(`     expected: campaign_code=${FAKE_CAMPAIGN}, bot_run_id=${FAKE_RUN_ID}`)
  }
  console.log()

  // Cleanup
  console.log(`▶  Cleanup: deleting test lead + bot_runs rows...`)
  await supabase.from('leads').delete().eq('place_id', FAKE_PLACE_ID)
  await supabase.from('bot_runs').delete().in('id', [FAKE_RUN_ID, SECOND_RUN_ID])
  console.log('   done.')

  process.exit(stickyOk ? 0 : 1)
} else {
  console.log('▶  FAIL — fix bot-server P0 before running real prospects.')
  process.exit(1)
}
