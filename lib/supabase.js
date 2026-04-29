// Initializes Supabase client and exposes upsert helper keyed by place_id

import { createClient } from "@supabase/supabase-js";
import { scoreOwner } from "./owner-score.js";

let _client = null;

export function getClient() {
  if (_client) return _client;

  const { SUPABASE_URL, SUPABASE_SERVICE_KEY } = process.env;
  if (!SUPABASE_URL) throw new Error("SUPABASE_URL is not set");
  if (!SUPABASE_SERVICE_KEY) throw new Error("SUPABASE_SERVICE_KEY is not set");

  _client = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);
  return _client;
}

// ── Experiment context (module-level) ────────────────────────────────────────
//
// Set once per run by prospect.js after reading the dashboard's externalConfig.
// Every lead upserted from this point on inherits campaign_code + bot_run_id
// without each call site needing to pass them. Mirrors the pattern of
// `setInstances` in lib/whatsapp.js.
//
// First-write wins: if a lead row already exists in the DB with a non-null
// campaign_code or bot_run_id, the upsert preserves the historical value.
// See preserveStickyAttributions() below.

let _experimentContext = {
  campaign_code: null,
  bot_run_id: null,
};

export function setExperimentContext(ctx) {
  _experimentContext = {
    campaign_code: ctx?.campaign_code ?? null,
    bot_run_id: ctx?.bot_run_id ?? null,
  };
}

export function getExperimentContext() {
  return _experimentContext;
}

// Only columns that exist in the Supabase `leads` table.
// Extra fields (collected_at, etc.) are stripped to avoid PostgREST errors.
const LEAD_COLUMNS = [
  "place_id",
  "business_name",
  "address",
  "city",
  "search_city",
  "phone",
  "website",
  "rating",
  "review_count",
  "hours",
  "reviews",
  "photos_urls",
  "perf_score",
  "mobile_score",
  "fcp",
  "lcp",
  "cls",
  "has_ssl",
  "is_mobile_friendly",
  "has_pixel",
  "has_analytics",
  "has_whatsapp",
  "has_form",
  "has_booking",
  "tech_stack",
  "scrape_failed",
  "visual_score",
  "visual_notes",
  "pain_score",
  "score_reasons",
  "opportunity_score",
  "opportunity_reasons",
  "message",
  "email",
  "email_source",
  "niche",
  "outreach_sent",
  "outreach_sent_at",
  "outreach_channel",
  "status",
  "status_updated_at",
  "no_website",
  "email_subject",
  "country",
  // Experiment tracking — see fastdevbuilds-admin migration
  // 20260428_experiment_tracking.sql.
  "campaign_code",
  "bot_run_id",
  "owner_probability",
  "outreach_variant",
];

function prepareRow(lead) {
  const row = {};
  for (const col of LEAD_COLUMNS) {
    if (lead[col] !== undefined) row[col] = lead[col];
  }
  // Convert arrays to comma-separated strings (Supabase text columns)
  if (Array.isArray(row.score_reasons))
    row.score_reasons = row.score_reasons.join(", ");
  if (Array.isArray(row.opportunity_reasons))
    row.opportunity_reasons = row.opportunity_reasons.join(", ");
  if (Array.isArray(row.visual_notes))
    row.visual_notes = row.visual_notes.join(", ");
  // Ensure numeric columns are null instead of empty string
  for (const col of [
    "rating",
    "review_count",
    "perf_score",
    "mobile_score",
    "fcp",
    "lcp",
    "cls",
    "visual_score",
    "pain_score",
    "opportunity_score",
    "owner_probability",
  ]) {
    if (row[col] === "" || row[col] === undefined) row[col] = null;
  }

  // Stamp experiment context if the call site didn't already set it.
  // Sticky preservation against existing DB values happens later in
  // preserveStickyAttributions() — here we just default in the run-level
  // values for the first-write case.
  if (row.campaign_code == null && _experimentContext.campaign_code != null) {
    row.campaign_code = _experimentContext.campaign_code;
  }
  if (row.bot_run_id == null && _experimentContext.bot_run_id != null) {
    row.bot_run_id = _experimentContext.bot_run_id;
  }

  // Compute owner_probability if not supplied and we have enough signal.
  // scoreOwner returns 50 for empty lead, so we only stamp when name OR
  // address OR niche is present — avoids defaulting every minimal disqualify
  // row to 50 with no real basis.
  if (row.owner_probability == null) {
    const hasSignal = !!(lead.business_name || lead.address || lead.niche);
    if (hasSignal) {
      row.owner_probability = scoreOwner(lead);
    }
  }

  return row;
}

// ── Sticky attribution preservation ─────────────────────────────────────────
//
// Plain `upsert(rows, { onConflict: 'place_id' })` translates to
// `ON CONFLICT (place_id) DO UPDATE SET col1=excluded.col1, ...` for every
// column present in the row object. That overwrites campaign_code +
// bot_run_id on re-collected leads, destroying the original attribution.
//
// Mitigation: pre-fetch existing values; if the DB already has a non-null
// campaign_code / bot_run_id for this place_id, REMOVE those fields from
// the row before upsert (Supabase doesn't include absent fields in the
// SET clause, so the DB value is preserved).
//
// This is read-then-modify, so technically race-y under concurrent runs.
// Acceptable today (1 active run at a time enforced by bot-server's
// activeRuns guard).

async function preserveStickyAttributions(rows) {
  const placeIds = rows.map((r) => r.place_id).filter(Boolean);
  if (placeIds.length === 0) return rows;

  const client = getClient();
  const existingMap = new Map();

  // Chunk to stay well under any IN-clause limits.
  for (let i = 0; i < placeIds.length; i += 200) {
    const slice = placeIds.slice(i, i + 200);
    const { data, error } = await client
      .from("leads")
      .select("place_id, campaign_code, bot_run_id")
      .in("place_id", slice);
    if (error) {
      console.warn(
        `⚠️   preserveStickyAttributions read failed: ${error.message} — proceeding without preservation`,
      );
      return rows; // fail open
    }
    for (const r of data ?? []) existingMap.set(r.place_id, r);
  }

  for (const row of rows) {
    const existing = existingMap.get(row.place_id);
    if (!existing) continue;
    // If DB already has a campaign_code, never overwrite it via this upsert.
    if (existing.campaign_code != null) {
      delete row.campaign_code;
    }
    if (existing.bot_run_id != null) {
      delete row.bot_run_id;
    }
  }
  return rows;
}

export async function upsertLeads(leads) {
  const client = getClient();
  const rows = leads.map(prepareRow);

  // Strip campaign_code / bot_run_id from rows whose DB row already has them
  // set — preserves first-write attribution across re-collections.
  await preserveStickyAttributions(rows);

  let saved = 0;

  for (let i = 0; i < rows.length; i += 50) {
    const batch = rows.slice(i, i + 50);
    const batchNum = Math.floor(i / 50) + 1;
    const { error } = await client
      .from("leads")
      .upsert(batch, { onConflict: "place_id" });

    if (error) {
      const sample = batch[0]?.place_id ?? "unknown";
      console.error(
        `❌  Supabase upsert batch ${batchNum} failed (${batch.length} leads, first: ${sample}): ${error.message}`,
      );
      // Continue with remaining batches instead of aborting
      continue;
    }
    saved += batch.length;
  }

  console.log(`    Supabase: ${saved}/${rows.length} leads saved`);
  if (saved < rows.length) {
    console.warn(
      `⚠️   ${rows.length - saved} leads failed to save — check errors above`,
    );
  }
}
