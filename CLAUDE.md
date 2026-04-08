# prospect-bot — CLAUDE.md

## Project Overview

**prospect-bot** is a local Node.js CLI built for **FastDevBuilds**, a software house targeting international small businesses. The bot automates the full outbound prospecting pipeline:

1. Discovers small businesses via Google Places API
2. Analyzes their websites for technical pain points (PageSpeed + HTML scraping)
3. Assigns a "pain score" (0–10) representing how much they need a better site/app
4. Generates personalized outreach messages in English (or Portuguese) via Claude API
5. Exports qualified leads to a ranked CSV and/or Supabase table

The goal is to surface high-intent leads — businesses with real, detectable technical problems — and deliver ready-to-send cold outreach messages.

---

## Stack

| Concern | Tool |
|---|---|
| Runtime | Node.js 20+ with ESModules (`"type": "module"`) |
| HTTP | Native `fetch` (no axios) |
| HTML parsing | `cheerio` |
| CSV export | `csv-writer` |
| Database | `@supabase/supabase-js` |
| AI messages | `@anthropic-ai/sdk` (Claude) |
| Env vars | `dotenv` |

No TypeScript. No CLI frameworks. No build step.

---

## File Descriptions

| File | Purpose |
|---|---|
| `prospect.js` | Entry point — parses CLI args, validates them, and runs the pipeline steps in order |
| `steps/collect.js` | Queries Google Places API for businesses matching `--niche` + `--city`; filters out listings with no website or only social media URLs |
| `steps/analyze.js` | Runs PageSpeed Insights API and HTML scraping in parallel (batch size 5); attaches raw metrics to each lead object |
| `steps/score.js` | Reads analysis results and produces a numeric `pain_score` (0–10) with a `score_reasons` array explaining each deduction |
| `steps/message.js` | Calls Claude API to write a personalized cold outreach message per lead; respects `--lang` flag |
| `lib/supabase.js` | Creates and exports the Supabase client; exposes `upsertLeads(leads[])` using `place_id` as the unique key |
| `lib/pagespeed.js` | Wraps the PageSpeed Insights v5 API; returns normalized object with `perf_score`, `fcp`, `lcp`, `cls`, `mobile_score` |
| `lib/scraper.js` | Fetches a URL with an 8-second timeout using `AbortController`; parses HTML with cheerio; returns structured `ScrapeResult` |
| `output/.gitkeep` | Keeps the output directory tracked in git while staying empty |
| `.env.example` | Template for required environment variables |

---

## CLI Usage

```bash
node prospect.js --niche "dentists" --city "Miami, FL" --limit 50 --export both --min-score 4 --lang en
```

### Parameters

| Flag | Type | Default | Description |
|---|---|---|---|
| `--niche` | string | *(required)* | Type of business to search (e.g. `"dental clinics"`, `"gyms"`) |
| `--city` | string | *(required)* | City and state/country (e.g. `"Miami, FL"`, `"Austin, TX"`) |
| `--limit` | number | `20` | Maximum number of businesses to collect from Places API |
| `--export` | `csv` \| `supabase` \| `both` | `csv` | Where to write the final output |
| `--lang` | `en` \| `pt` | `en` | Language for generated outreach messages |
| `--min-score` | number | `3` | Minimum `pain_score` required to include a lead in the export |
| `--dry` | boolean flag | `false` | Skip message generation and export; only collect + analyze + score |
| `--send` | boolean flag | `false` | After export, push qualified leads to Instantly campaign |

---

## Error Handling Rules

- **Never crash the pipeline** because a single lead failed. Every lead is wrapped in its own `try/catch`.
- If `analyze` fails for a lead, set `scrape_failed: true` and continue with scoring (score will be low).
- If `message` generation fails for a lead, set `message: ""` and still export the lead.
- If Supabase upsert fails, log a warning and continue — the CSV export is the primary fallback.
- API key errors (401/403) should terminate early with a clear message indicating which key is invalid.
- Timeout errors from scraper must be caught silently and reflected in `scrape_failed: true`.

---

## Concurrency Rules

- Maximum **5 concurrent operations** at any stage of the pipeline.
- Implement a generic `runBatch(items, asyncFn, batchSize = 5)` utility for fan-out control.
- `analyze.js` runs PageSpeed + scrape in parallel **per lead**, but batches leads in groups of 5.
- `message.js` sends Claude API calls in batches of 5.
- Never use `Promise.all` on unbounded arrays — always chunk first.

---

## CSV Output Schema

The exported CSV file is named `leads_<niche>_<city>_<timestamp>.csv` and saved to `./output/`.

All 31 columns, in order:

| # | Column | Type | Description |
|---|---|---|---|
| 1 | `place_id` | string | Google Places unique ID |
| 2 | `business_name` | string | Business display name |
| 3 | `address` | string | Full formatted address |
| 4 | `city` | string | City extracted from address |
| 5 | `phone` | string | Phone number (if available) |
| 6 | `website` | string | Business website URL |
| 7 | `rating` | number | Google rating (1–5) |
| 8 | `review_count` | number | Total Google reviews |
| 9 | `perf_score` | number | PageSpeed performance score (0–100) |
| 10 | `mobile_score` | number | PageSpeed mobile score (0–100) |
| 11 | `fcp` | number | First Contentful Paint in ms |
| 12 | `lcp` | number | Largest Contentful Paint in ms |
| 13 | `cls` | number | Cumulative Layout Shift score |
| 14 | `has_ssl` | boolean | Site uses HTTPS |
| 15 | `is_mobile_friendly` | boolean | Whether viewport meta tag is present |
| 16 | `has_pixel` | boolean | Meta Pixel detected in scripts |
| 17 | `has_analytics` | boolean | Google Analytics or GTM detected |
| 18 | `has_whatsapp` | boolean | WhatsApp link detected (`wa.me` or `api.whatsapp.com`) |
| 19 | `has_form` | boolean | Contact form (`<form>` tag) detected |
| 20 | `has_booking` | boolean | Booking/scheduling widget detected |
| 21 | `tech_stack` | string | Detected builder: `wix`, `squarespace`, `weebly`, `blogger`, `wordpress`, `unknown` |
| 22 | `scrape_failed` | boolean | True if scraping/analysis errored out |
| 23 | `pain_score` | number | Composite score 0–10 (higher = more pain) |
| 24 | `score_reasons` | string | Comma-separated list of reasons (e.g. `slow_lcp, no_ssl, no_mobile`) — csv-writer wraps in quotes automatically |
| 25 | `message` | string | Claude-generated outreach message |
| 26 | `collected_at` | string | ISO 8601 timestamp of when the lead was collected |
| 27 | `outreach_sent` | boolean | Whether lead was sent via any outreach channel |
| 28 | `outreach_sent_at` | string | ISO 8601 timestamp of when outreach was sent |
| 29 | `outreach_channel` | string | Channel used: `instantly`, `whatsapp`, or empty |
| 30 | `email` | string | Email found via scraping or Hunter.io |
| 31 | `email_source` | string | `scrape`, `hunter`, or empty if not found |

---

## Supabase Rules

- **Table name:** `leads`
- **Primary key / upsert key:** `place_id`
- Use `upsert` with `onConflict: 'place_id'` so re-running the bot updates existing rows rather than duplicating.
- The Supabase table schema mirrors the CSV columns above exactly.
- Use `SUPABASE_SERVICE_KEY` (service role), never the anon key, to bypass RLS.
- Batch upserts in chunks of 50 rows to stay within Supabase request limits.

---

## Email Enrichment

**Strategy:** scrape first, Hunter.io fallback.

- **Step 1:** visit lead website, extract any emails from HTML using regex
- **Step 2:** if no email found and `HUNTER_API_KEY` is set, query Hunter.io Domain Search API
- **Results stored in:** `email` (string or empty), `email_source` (`"scrape"` | `"hunter"` | empty)
- **If both fail:** `email = null`, lead is sent to Instantly with empty email (campaign handles routing)

**Noise filter:** emails containing any of these strings are discarded:
`sentry`, `wix`, `wordpress`, `schema`, `example`, `pixel`, `facebook`, `google`, `apple`, `microsoft`, `adobe`, `jquery`, `placeholder`

**Hunter.io:** confidence threshold is 70. If `HUNTER_API_KEY` is absent, phase 2 is skipped silently. Rate limit: 200ms delay before each Hunter call.

**Required env var (optional):** `HUNTER_API_KEY`

---

## Instantly Integration

Leads are pushed to Instantly only when `--send` is active and `--dry` is inactive.

**Deduplication (two layers):**
1. Before sending, query Supabase for `outreach_sent = true` on matching `place_id`s — filter those out
2. Pass `skip_if_in_workspace: true` in the Instantly payload as a second safety net

**After a successful batch:**
- Update Supabase: `outreach_sent: true`, `outreach_sent_at: <ISO timestamp>`
- Stamp the same fields on the in-memory lead objects

**Batching:** 10 leads per Instantly API call. Individual batch failures log a warning and continue.

**Email field:** populated by `lib/enricher.js` (scrape → Hunter.io fallback) before the Instantly send step. If enrichment finds no email, the lead is sent with `email: ""` and the campaign handles sequencing.

**Required env vars for `--send`:** `INSTANTLY_API_KEY`, `INSTANTLY_CAMPAIGN_ID`

---

## WhatsApp Integration (BR Market)

**Tool:** Evolution API (self-hosted)
**Target:** leads with `--lang pt` that have a phone number and no email

**Daily hard cap:** 50 messages/day — checked live against Supabase before each run. Never exceeded.
- Query: `leads WHERE outreach_channel = 'whatsapp' AND outreach_sent = true AND outreach_sent_at >= start of today (UTC)`
- If cap already reached: all leads skipped, no sends

**Number formatting:**
1. Strip all non-digit characters
2. Remove leading `0`
3. Prefix with `55` if not already present
4. Final format: `5511999998888`

**Sequencing rules:**
- Always sequential — no parallelism, no `Promise.all`
- 3-second delay between each message (simulates human behaviour)
- Never include links in the first message
- Tone must be conversational — `lead.message` already enforces this via Claude prompt

**After successful send:**
- Update Supabase: `outreach_sent: true`, `outreach_sent_at: now`, `outreach_channel: "whatsapp"`

**Required env vars:** `EVOLUTION_API_URL`, `EVOLUTION_API_KEY`, `EVOLUTION_INSTANCE`

---

## Scoring Rules

Each condition adds points to the lead's `pain_score`. The score is capped at **10**.
If `scrape_failed: true`, the score is forced to **0** (no data to evaluate).

| Condition | Points |
|---|---|
| PageSpeed mobile < 30 | +3 |
| PageSpeed mobile 30–49 | +2 |
| PageSpeed mobile 50–69 | +1 |
| No Meta Pixel | +2 |
| No Google Analytics or GTM | +1 |
| No WhatsApp link | +1 |
| No contact form | +1 |
| No booking system | +1 |
| Site on Wix / Squarespace / Weebly / Blogger | +1 |
| No SSL | +2 |
| No mobile viewport | +1 |
| `scrape_failed: true` | score = 0 |
| *(maximum)* | **10** (cap) |

---

## Terminal Output Style

- Use emojis sparingly for status: `🔍` collecting, `⚡` analyzing, `🎯` scoring, `✉️` messaging, `✅` done, `❌` error.
- Show per-lead progress on a single updating line where possible.
- Final summary line: total collected → analyzed → qualified → exported.
- No `console.log` spam inside library files — only in `prospect.js` and step files.
