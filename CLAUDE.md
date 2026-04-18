# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project

**prospect-bot** is a Node.js CLI that runs an automated B2B outbound pipeline for **FastDevBuilds**. It finds local businesses via Google Places, grades them on "pain" (slow sites, outdated design, missing booking/forms/SSL, etc.), generates a personalized outreach message with Claude, and dispatches it through the right channel for the market (Instantly email for US, Evolution-API WhatsApp for BR). A small HTTP server in `bot-server/` exposes the same runner to a separate dashboard.

No TypeScript, no build step, native `fetch`, ESModules.

## Commands

```bash
# Install once
npm install                                # root (CLI + pipeline)
npm --prefix bot-server install            # only if running the HTTP server

# Manual run (one niche + city)
node prospect.js --niche "dentists" --city "Miami, FL" --limit 50 --lang en --export both
#   --lang en  → US pipeline (email/Instantly)
#   --lang pt  → BR pipeline (WhatsApp/Evolution) — also triggers BR-specific scoring + phone filtering
#   --dry      skip message generation + export
#   --send     after export, dispatch outreach (requires Instantly or Evolution keys)
#   --export   csv | supabase | both

# Autonomous run (consumes the queue built from AUTO_CONFIG ∖ already-prospected combos)
node prospect.js --auto --market BR --limit 20 --min-score 3 --send --max-send 30
#   --market     BR | US | all (ignored when --config passes externalConfig)
#   --max-send   hard stop after N successful sends in this process; remaining leads stay queued
#   --config     path to JSON with { niches, cities, country, lang, evolutionInstances?, evolutionApiUrl? }
#                → dashboard integration — overrides the built-in AUTO_CONFIG

# Bot HTTP server (dashboard-facing)
npm --prefix bot-server start              # POST /run, POST /run-auto, GET /run-status, POST /cancel, GET /api/bot/queue

# Integration tests (requires real Supabase + optional local bot-server)
node scripts/test-auto-mode.js
```

There is no `npm test`, no linter, and no type checker — `scripts/test-auto-mode.js` is the only test harness and it hits the live Supabase instance (writes rows prefixed `__TEST_AUTO_<ts>__` then cleans up).

## Architecture

### Pipeline stages (`steps/`)

```
collect → analyze → visual → score → message → (enrich → dispatch)
```

Each stage returns the same lead array shape with more fields attached. Concurrency is uniformly **5** via `runBatch(items, fn, 5)` in `lib/utils.js` — never use unbounded `Promise.all` on lead arrays.

- **`collect.js`** queries Google Places Text Search (paginated via `next_page_token`, 2s delay required between pages) then Place Details for `website` + `phone`. It splits results into two arrays: `leads` (usable website) and `noWebsiteLeads` (filters out listings that only point to facebook/instagram/yelp/tripadvisor/google/linkedin/twitter/tiktok — treated as "no website").
- **`analyze.js`** runs `fetchPageSpeed` and `scrapeWebsite` in parallel per lead. `scrapeWebsite` fetches the homepage, then walks a list of contact-page paths (`/contato`, `/contact`, `/fale-conosco`, ...) if no `<form>` was found — this matters because some BR sites only have forms on sub-pages. A failed scrape sets `scrape_failed: true`, which `score.js` interprets as `pain_score = 0` (we can't evaluate a site we couldn't read).
- **`visual.js`** uses Puppeteer with a mobile viewport (iPhone UA) to screenshot the homepage, then sends the JPEG to Claude Haiku 4.5 with `VISUAL_SYSTEM` to get a 0-10 `visual_score` + notes. Skipped entirely if `ANTHROPIC_API_KEY` is missing or `--dry` is set; errors per-lead just null-out the visual fields and keep going.
- **`score.js`** maps detected issues to a 0-10 `pain_score`. The weights differ by country — US weighs `no_booking` higher (+2 vs +1) and ignores `no_whatsapp` entirely. Outdated site builders (wix/squarespace/weebly/blogger) add +1.
- **`message.js`** generates outreach via Claude Haiku. Picks ONE "main reason" per lead (`pickMainReason`) and instructs the model to base the message only on that pain — multi-issue messages tested worse. Four distinct system prompts live in `lib/prompts.js`: `SYSTEM_EN`, `SYSTEM_PT`, `SYSTEM_NO_WEBSITE_*`, `SYSTEM_EMAIL_EN` (+ no-website email variant). `buildSystemPrompt` selects based on `(lang, channel, no_website)`. For email, the model returns JSON `{ subject, body }` and the code parses that; for WhatsApp, the raw text is the message.

### The two sub-pipelines merge before messaging

Leads without a usable website **skip** analyze/visual/score — they are given `pain_score = 10` and `score_reasons = ['no_website']` unconditionally, then joined with qualified website leads into `allQualified` before `generateMessages`. Both `prospect.js` (manual) and `steps/auto.js` do this the same way, and `lead.no_website === true` is the flag `message.js` uses to swap to the no-website prompt.

### Auto mode and the queue (`steps/auto.js` + `lib/queue.js` + `lib/auto-config.js`)

`runAuto` builds a queue of `{ niche, searchCity, lang, country }` combos by **diffing the config against Supabase**: it reads all distinct `(niche, search_city)` pairs from `leads` whose `status_updated_at >= now - 60 days` (`RECHECK_DAYS`), and removes those combos from the target set. Combos older than 60 days are re-prospected. The config source is either `externalConfig` (passed via `--config` from the dashboard) or the hardcoded `AUTO_CONFIG` in `lib/auto-config.js` — a fallback warning prints when the hardcoded config is used. Each city in `AUTO_CONFIG` can expand into multiple `regions` (neighborhoods/districts) that are searched individually to get around Google's ~60-result cap per query.

`search_city` column: this is the exact string passed to the Places query (e.g. "Pinheiros, São Paulo, SP"), stored separately from `city` (which is extracted from the result address). The queue dedups on `search_city`, so renaming the column would break auto mode. `lib/queue.js` falls back to `city` if `search_city` doesn't exist yet — run `migrations/001_add_search_city.sql` on any new Supabase.

Before running a full pipeline on each queue item, `auto.js` does a **place_id dedup query against Supabase** and skips leads already known — this saves PageSpeed + scrape + Claude API calls on re-runs. For `lang === 'pt'`, it also pre-filters leads whose phone doesn't match `/^55\d{2}9\d{8}$/` (BR mobile with the mandatory 9th digit), marks them `status: 'disqualified'`, and never routes them to WhatsApp.

### Dispatch routing

| `lang` | Channel | Requires | Module |
|---|---|---|---|
| `en` | Email via Instantly.ai | `email` enriched from site/Hunter.io | `lib/instantly.js` |
| `pt` | WhatsApp via Evolution API | `phone` validated as BR mobile | `lib/whatsapp.js` |

Both paths double-check `outreach_sent` on Supabase right before sending (`getAlreadySentPlaceIds` → skip) to guard against parallel runs. On success, they notify the CRM via `POST /api/bot/outreach/sent`; on failure, `POST /api/bot/outreach/failed`. The bot no longer writes to `leads.outreach_*` or `conversations` directly from the send path — the CRM owns those writes (see **CRM integration** below).

**Multi-instance WhatsApp rotation** (`lib/whatsapp.js`): when the dashboard sends `evolutionInstances`, each lead is assigned an instance via round-robin. On send failure the code retries with another instance; on 429 it marks that instance rate-limited and waits 60s; if all instances are rate-limited in one run it aborts the remaining sends. Per-lead delay is a random 45-120s to mimic human cadence. The `evolution_instance` column on `leads` records which instance was used — useful for debugging warm-up issues.

There is currently **no hard daily cap** on WhatsApp sends; an older 15/day cap was intentionally removed (commit 406a578). Use `--max-send` instead for per-run limits.

### CRM integration (post-send writes)

The bot delegates all post-send persistence to the fastdevbuilds-admin dashboard. Two endpoints:

- `POST /api/bot/outreach/sent` — called after Evolution / Instantly returns HTTP OK. The CRM inserts a `conversations` row (for both WhatsApp **and** email — previously email never hit the inbox), flips `leads.status` `prospected → sent`, extracts `whatsapp_jid` from the raw Evolution response body, sets `last_outbound_at`, schedules the 24h follow-up, and dismisses pending AI suggestions. Idempotent on `(place_id, direction='out', message)` within ±60s of `sent_at`, so retries are safe.
- `POST /api/bot/outreach/failed` — called when all instances failed (WhatsApp) or the Instantly POST rejected. The CRM writes `leads.outreach_error` only; `status`, `outreach_sent`, and `conversations` stay untouched so the lead remains retryable on the next run.

Both require `Authorization: Bearer $BOT_TO_CRM_SECRET`. Configure via env vars:

- `CRM_API_URL` — dashboard base URL (no trailing slash, e.g. `https://admin.fastdevbuilds.com`).
- `BOT_TO_CRM_SECRET` — shared secret with the CRM (generate: `openssl rand -hex 32`).

The client lives in `lib/crm-client.js` (`notifyCrmSent` / `notifyCrmFailed`). 10s timeout, 3 attempts with backoff 1s / 2s / 4s on timeouts, network errors, and 5xx; no retry on 4xx (permanent). On exhaustion it returns `{ ok: false, exhausted: true }` instead of throwing — callers log loudly and keep going (the message has already been delivered by the time we reach this point; re-sending would spam the prospect). `validateCrmEnv()` is called from `prospect.js` when `--send` is set, so missing env vars fail fast before any run starts.

Writes the bot still does directly against Supabase (out of scope for this refactor):

- `upsertLeads` in `lib/supabase.js` (collect / score / message bulk persist).
- `steps/auto.js` disqualified-minimal upsert (phone-filter + low pain_score leads).
- Read-only queries: `getAlreadySentPlaceIds`, dedup lookups, parallel-run pre-send check.

### Data model (Supabase `leads` table)

`place_id` is the upsert key everywhere (`onConflict: 'place_id'`, batch size 50 in `lib/supabase.js`). `LEAD_COLUMNS` in `supabase.js` is the single source of truth for which fields get persisted — new lead fields won't reach the DB unless added there. Arrays (`score_reasons`, `visual_notes`) are joined to comma-separated strings before upsert because the columns are `text`, not `text[]`. The `conversations` table is **not** written by the bot — the CRM inserts one outbound row per send (WhatsApp and email) when it receives `POST /api/bot/outreach/sent`.

Run `migrations/*.sql` in Supabase's SQL editor (they are `IF NOT EXISTS` and safe to re-run).

### bot-server

`bot-server/server.js` is a thin HTTP wrapper that spawns `prospect.js` as a child process and streams stdout. Two modes:

- `POST /run` — SSE stream, intended for short manual runs (small niche+city).
- `POST /run-auto` — fire-and-forget; returns `{ runId }` immediately, client polls `GET /run-status?runId=<id>&offset=<n>` for incremental logs. Only one auto run can be active at a time (409 if already running). `POST /cancel` kills the child.

All routes require `Authorization: Bearer $BOT_SERVER_SECRET` when that env var is set. Dashboard config is written to a temp JSON file and passed via `--config`; the temp file is deleted on process exit. The prospect.js path is resolved relative to `__dirname` first, then `cwd()` — this is deliberate for Railway deployments where those may differ.

## Environment

All required env vars are listed in `.env.example`. Notable ones:

- `GOOGLE_MAPS_API_KEY` — used for BOTH Places API **and** PageSpeed Insights. One key, two products enabled.
- `ANTHROPIC_API_KEY` — required for anything that isn't `--dry`.
- `SUPABASE_SERVICE_KEY` — must be the **service role** key (bypasses RLS), not the anon key.
- `HUNTER_API_KEY` — optional; without it, US leads won't get email fallback (scrape-only) and BR leads skip phase 2 of enrichment.
- `EVOLUTION_API_URL` / `EVOLUTION_API_KEY` / `EVOLUTION_INSTANCE` — only checked as a fallback when the dashboard didn't send its own instance list via `--config`.
- `BOT_SERVER_SECRET` / `PORT` — bot-server only.

## Conventions worth knowing

- Error handling is always **per-lead** — a single failure must never crash the pipeline. Stages use `Promise.allSettled`, try/catch per item, and `console.warn` rather than throwing upward. Fatal errors exist only for missing env vars and for the outer `main().catch`.
- Don't log from `lib/*` at the info level — reserve `console.log` for `prospect.js` and `steps/*`. Warnings with `⚠️` from `lib/*` are fine.
- CSV export uses `sanitizeLead` in `prospect.js` to force a consistent column order; adding a column means updating both `sanitizeLead`, the CSV header array, and `LEAD_COLUMNS` in `lib/supabase.js`.
- Niche-specific outreach context lives in `lib/niche-templates.js` (keyword → `{ focus, pain, tone }` in both languages). `getNicheContext` does a substring match against the keywords — there's a generic fallback if nothing matches.
