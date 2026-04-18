# AUDIT-REPORT — prospect-bot (static audit, read-only)

> Propósito: entender o que o bot faz hoje antes de unificar o contrato com o dashboard `fastdevbuilds-admin`.
> Nada foi alterado no código.

---

## Seção 1 — Arquitetura geral

### 1.1 Estrutura de diretórios (até 3 níveis)

```
prospect-bot/
├── prospect.js                    # CLI entrypoint (manual + --auto)
├── package.json                   # type: module, deps: @anthropic-ai/sdk, @supabase/supabase-js, cheerio, csv-writer, dotenv, puppeteer
├── .env / .env.example
├── CLAUDE.md
├── bot-server/
│   ├── server.js                  # HTTP wrapper (Node http, sem Express)
│   └── package.json
├── steps/
│   ├── collect.js                 # Google Places → leads
│   ├── analyze.js                 # PageSpeed + scrape
│   ├── visual.js                  # Puppeteer + Claude Vision
│   ├── score.js                   # pain_score 0-10
│   ├── message.js                 # Claude Haiku → texto
│   └── auto.js                    # runAuto (queue loop)
├── lib/
│   ├── supabase.js                # client + upsertLeads
│   ├── whatsapp.js                # Evolution API dispatch
│   ├── instantly.js               # Instantly.ai dispatch
│   ├── enricher.js                # email scrape + Hunter.io
│   ├── queue.js                   # diff config × Supabase
│   ├── auto-config.js             # niches/cities default (hardcoded)
│   ├── scraper.js                 # cheerio site scan
│   ├── pagespeed.js               # PageSpeed API
│   ├── prompts.js                 # 7 system prompts
│   ├── niche-templates.js         # contexto por nicho
│   └── utils.js                   # runBatch (concorrência 5)
├── migrations/
│   ├── 001_add_search_city.sql
│   └── 002_add_email_subject_country.sql
├── scripts/
│   ├── test-auto-mode.js
│   └── add-google-ads-column.sql
└── output/                        # CSVs gerados
```

### 1.2 Runtime

- **Node.js** com ES Modules (`"type": "module"` em `package.json:5`). Sem TS, sem build step, `fetch` nativo.
- **Sem `engines`** em `package.json` — qualquer versão Node ≥ 18 aceita. ⚠️ **DIVERGÊNCIA** pequena: não trava versão do Node.
- **Ambos CLI e servidor HTTP**:
  - CLI direto: `node prospect.js ...` (`prospect.js:1-551`).
  - Servidor HTTP: `node bot-server/server.js` (`bot-server/server.js:1-400`), que **spawna o CLI como child process** (`bot-server/server.js:204, 363`).

### 1.3 Entrypoints

| Entrypoint | Arquivo | Como é invocado |
|---|---|---|
| CLI manual | `prospect.js` (root) | `node prospect.js --niche X --city Y …` |
| CLI autônomo | mesmo `prospect.js` com `--auto` | delega para `runAuto` em `steps/auto.js:281` |
| HTTP server | `bot-server/server.js` | `npm --prefix bot-server start` |

### 1.4 Como é disparado em produção

- O bot **não tem cron próprio, nem scheduler**. Confirmado via grep: não há `setInterval`, não há `node-cron`, não há arquivo de CI/Railway schedule.
- **Fluxo real (observado nos endpoints + CLAUDE.md):**
  1. O dashboard `fastdevbuilds-admin` chama `POST /run-auto` no bot-server rodando no Railway.
  2. O bot-server gera um tempfile de config (`bot-server/server.js:171-191`) e spawna `node prospect.js --auto --config <tmpfile>` (`bot-server/server.js:204`).
  3. O child escreve logs em stdout que ficam acumulados em memória (`activeRuns` Map em `bot-server/server.js:38`).
  4. O dashboard faz polling em `GET /run-status?runId=...` (`bot-server/server.js:239-271`).
- Disparo **manual** (SSH ou terminal local) via CLI também é suportado.

### 1.5 Endpoints HTTP expostos (bot-server)

| Método | Path | Auth | Função | Arquivo:linha |
|---|---|---|---|---|
| `GET` | `/health` | pública | `{ ok: true, version: '2.0.0' }` | `bot-server/server.js:90-93` |
| `GET` \| `POST` | `/api/bot/queue` | Bearer `BOT_SERVER_SECRET` | Retorna a fila auto-mode como JSON (diff config × Supabase) | `bot-server/server.js:96-136` |
| `POST` | `/run-auto` | Bearer | Spawna `prospect.js --auto` em background, retorna `{ runId }`. 409 se já houver run ativa. | `bot-server/server.js:140-235` |
| `GET` | `/run-status?runId=&offset=` | Bearer | Polling — devolve logs incrementais + stats extraídas por regex | `bot-server/server.js:239-271` |
| `POST` | `/cancel` | Bearer | `child.kill()` do run ativo | `bot-server/server.js:275-301` |
| `POST` | `/run` | Bearer | Manual: spawna `prospect.js --niche --city …` e **streama SSE** | `bot-server/server.js:305-392` |
| `OPTIONS` (CORS) | qualquer | — | `Access-Control-Allow-Origin: *` | `bot-server/server.js:80-87` |

Auth — `checkAuth` em `bot-server/server.js:66-74`: se `BOT_SERVER_SECRET` não estiver definido, **todas as rotas ficam abertas** ⚠️ (fail-open). O CORS também é `*`.

---

## Seção 2 — Fluxo de prospecting

### 2.1 Arquivo que orquestra um run

Dois orquestradores quase idênticos:

- **Manual**: `main()` em `prospect.js:314-544`.
- **Auto (por item da fila)**: `processItem()` em `steps/auto.js:19-271`, chamado em loop por `runAuto()` em `steps/auto.js:281-355`.

Ambos seguem o mesmo pipeline: `collect → dedup → (phone-filter BR) → analyze → visual → score → message → enrich → export → dispatch`. ⚠️ **DIVERGÊNCIA menor**: lógica duplicada entre os dois — qualquer correção precisa ser feita em dois lugares.

Esqueleto de `processItem` (auto.js:19-271):

```js
async function processItem(item, { minScore, dry, send, limit, maxSend, totalSentSoFar = 0 }) {
  const { niche, searchCity, lang, country = lang === 'pt' ? 'BR' : 'US' } = item;
  // 1. collect (Google Places)
  const { leads, noWebsiteLeads } = await collect({ niche, city: searchCity, limit, searchCity });
  // 1.5 dedup place_id contra Supabase
  // 1.6 filtro de telefone BR (mobile 55DDD9XXXXXXXX)
  // 2. analyze (PageSpeed + scrape)
  // 2.5 visual (Puppeteer + Claude Vision)
  // 3. score (pain_score 0-10)
  // 4. generateMessages (Claude Haiku)
  // 5. upsertLeads(withMessages) — Supabase
  // 6. enrichLeads + sendWhatsApp | sendToInstantly
  // 7. UPDATE status='sent' WHERE status='prospected' AND place_id in (sentIds)
}
```

### 2.2 Como leads são coletados

`steps/collect.js:62-139`:

1. **Google Places Text Search** (`collect.js:29-41`) com query `"${niche} in ${city}"`. Paginado via `next_page_token` com `setTimeout 2000ms` (exigência da API) em `collect.js:72-74`.
2. **Place Details** (`collect.js:43-60`) por lead, pegando só `website` + `formatted_phone_number`.
3. **Campos que vêm da API**: `place_id`, `name`, `formatted_address`, `rating`, `user_ratings_total`, `website`, `formatted_phone_number`.
4. **Campos derivados**:
   - `city` = `extractCity(formatted_address)` — pega o 2º token após vírgula (`collect.js:24-27`).
   - `search_city` = string passada ao query (preserva ruído como "Pinheiros, São Paulo, SP") (`collect.js:115`).
   - `no_website` = true se URL cair em `facebook.com/instagram.com/yelp.com/tripadvisor.com/google.com/linkedin.com/twitter.com/tiktok.com` ou URL inválida (`collect.js:8-22, 121, 131-136`).
   - `status = 'prospected'` e `status_updated_at = collected_at` sempre (`collect.js:122-124`).

### 2.3 Pain score

- Calculado em `steps/score.js:5-56`, função `scoreLead(lead, country)`.
- Soma pontos por "sintomas": `slow_mobile_*` (até +3), `outdated_design`/`poor_visual` (até +3), `no_form` (+2), `no_booking` (+2 US, +1 BR), `no_whatsapp` (+1, **só BR**), `outdated_builder` wix/squarespace/weebly/blogger (+1), `no_ssl` (+2), `no_mobile_viewport` (+1).
- Clamp em `Math.min(points, 10)` (`score.js:53`).
- Sites sem website recebem `pain_score=10` direto, sem passar por scoring (`prospect.js:412-417`, `auto.js:177-182`).
- Se scrape falhar: `pain_score=0, score_reasons=['scrape_failed']` (`score.js:7`).

### 2.4 INSERT vs UPSERT

**Principal**: UPSERT. `lib/supabase.js:49-74`:

```js
export async function upsertLeads(leads) {
  const client = getClient();
  const rows   = leads.map(prepareRow);
  let saved = 0;

  for (let i = 0; i < rows.length; i += 50) {
    const batch = rows.slice(i, i + 50);
    const { error } = await client
      .from('leads')
      .upsert(batch, { onConflict: 'place_id' });   // ← chave de conflito
    …
  }
}
```

Conflict target = `place_id`. Batch fixo de 50. Se um batch falhar, o loop **continua** (não aborta) — só loga erro (`supabase.js:63-67`).

Outros writes em `leads`:
- `UPDATE` com filtro `.eq('place_id', …)` em `lib/whatsapp.js:117-124` (marca `outreach_sent`).
- `UPDATE` com `.in('place_id', …)` em `lib/instantly.js:45-47`.
- `UPDATE` final de status em `steps/auto.js:260-263`.
- `UPSERT` de leads "pending" (sem canal) em `prospect.js:527-532`.

Insert cru em outra tabela: `lib/whatsapp.js:129-138` (`conversations`).

⚠️ **DIVERGÊNCIA**: `prospect.js:527-532` cria upsert parcial só com `{ place_id, outreach_channel: 'pending' }`. Como o conflict target é `place_id`, isso **zera** qualquer coluna não listada no insert se o lead não existir — mas como o upsert anterior já fez o insert completo, na prática só altera `outreach_channel`. Confuso e propenso a regressão.

### 2.5 Quando `outreach_sent=true` é marcado?

**DEPOIS** de a Evolution API retornar `res.ok = true`, mas **sem** verificar o corpo da resposta.

`lib/whatsapp.js:240-253`:

```js
while (!sentOk && tried.size < allInstances.length) {
  tried.add(currentInst.name);
  try {
    await sendMessage(phone, lead.message, currentInst);   // ← só lança se !res.ok
    await markSent(lead.place_id, currentInst.name, lead.message);  // ← UPDATE outreach_sent=true
    recordSend(currentInst.name);
    lead.outreach_sent    = true;
    …
```

`sendMessage` em `whatsapp.js:145-164` **nunca chama `res.json()`**. A resposta é descartada no caso de sucesso. Isso significa:
- ⚠️ **DIVERGÊNCIA crítica**: marcamos `outreach_sent=true` mesmo que a Evolution retorne `HTTP 200` com corpo indicando `exists: false` no destinatário (Evolution às vezes responde 200 com `status: "ERROR"` no body).
- ⚠️ **DIVERGÊNCIA crítica**: `remoteJid` nunca é capturado (→ `whatsapp_jid` fica NULL).

Para Instantly (`lib/instantly.js:74-106`): o mesmo — só `res.ok`, sem parse do body. `markSentInSupabase` só roda depois do fetch bem-sucedido.

---

## Seção 3 — Envio WhatsApp (crítico)

### 3.1 Função de envio — `sendMessage`

`lib/whatsapp.js:145-164` (inteira):

```js
async function sendMessage(phone, text, instance) {
  const { apiUrl, apiKey, name } = instance;

  const res = await fetch(`${apiUrl}/message/sendText/${name}`, {
    method:  'POST',
    headers: {
      'Content-Type': 'application/json',
      apikey:         apiKey,
    },
    body: JSON.stringify({ number: phone, textMessage: { text } }),
  });

  if (!res.ok) {
    const body = await res.text().catch(() => String(res.status));
    if (res.status === 429) {
      throw new RateLimitError(name, body);
    }
    throw new Error(`Evolution API HTTP ${res.status} (${name}): ${body}`);
  }
}
```

E o loop envolvente — `sendWhatsApp` — em `whatsapp.js:168-303`.

### 3.2 Endpoint Evolution

`POST ${apiUrl}/message/sendText/${instanceName}` (`whatsapp.js:148`).
Header: `apikey: <instance.apiKey>`.
Body: `{ number: "55DDD9XXXXXXXX", textMessage: { text: "..." } }`.

### 3.3 Como a instância é escolhida

**Round-robin** entre N instâncias (`lib/whatsapp.js:58-67`):

```js
let _rrIndex = 0;

function nextInstance() {
  const instances = getInstances();
  if (instances.length === 0) throw new Error('No Evolution API instances configured');
  const inst = instances[_rrIndex % instances.length];
  _rrIndex++;
  return inst;
}
```

Fonte das instâncias (`whatsapp.js:47-56`):
- **Prioridade 1**: `setInstances(…)` chamado pelo CLI em `prospect.js:80` quando o dashboard manda `evolutionInstances + evolutionApiUrl` via `--config <tempfile>`.
- **Prioridade 2 (fallback)**: env vars `EVOLUTION_API_URL / EVOLUTION_API_KEY / EVOLUTION_INSTANCE` — **1 instância só**.

**Não há lookup no Supabase** para escolher instância. O contador `_rrIndex` é estado **global in-memory** — reseta a cada novo processo. Isso é OK porque cada run é um child process novo.

**Retry em outra instância (não round-robin puro): `whatsapp.js:240-275`** — se `sendMessage` falhar em uma instância, o código tenta a próxima até esgotar. Em 429 (rate limit), marca instância como rate-limited e espera 60s.

### 3.4 Resposta da Evolution após sucesso

**Nada é feito com a resposta.** Confirmação por grep:

```bash
$ grep -n "res.json\|response.json\|await res\." lib/whatsapp.js
# (só aparece 'await res.text()' dentro do bloco de ERRO, linha 158)
```

Item por item:

| Pergunta | Resposta |
|---|---|
| remoteJid é parseado? | **Não.** `sendMessage` termina sem tocar no body em caso de sucesso (`whatsapp.js:163`). |
| whatsapp_jid é gravado no lead? | **Não em lugar nenhum.** Grep por `whatsapp_jid` no repo inteiro → 0 matches. ⚠️ **DIVERGÊNCIA crítica** — confirma exatamente o observado em produção (só 2/6216 leads têm `whatsapp_jid` preenchido, e esses 2 provavelmente vieram por outro caminho). |
| O response é descartado? | **Sim**, silenciosamente. Nem mesmo logado. |

### 3.5 Quando o envio falha

Dependendo do tipo de falha:

**HTTP não-OK (incluindo timeouts de rede via exception)**: `whatsapp.js:253-274`
- `console.warn` do erro.
- Marca a instância como "tried" e tenta a próxima instância.
- Se esgotar instâncias, `sentOk` fica false → incrementa `failed++` (linha 282).
- **Lead NÃO é marcado `outreach_sent=true`** ✅ (só `markSent` roda dentro do try — `whatsapp.js:244`).
- ⚠️ **DIVERGÊNCIA**: `outreach_error` **nunca é gravado no banco**. Grep por `outreach_error` → 0 matches. Em produção, um lead que falhou fica indistinguível de um lead ainda não processado.

**429**: espera 60s, tenta próxima instância (`whatsapp.js:254-264`). Se todas rate-limited → `allRateLimited` break (`whatsapp.js:258-262`).

**Telefone não-mobile (falha no regex `/^55\d{2}9\d{8}$/`)**: `whatsapp.js:216-220`
- `console.warn`, `skipped++`, continue. Nada escrito no Supabase — o lead permanece como `status='prospected'` sem nenhum registro de que foi pulado por telefone inválido no dispatcher (o filtro prévio em `auto.js:73-118` cobre o modo auto, mas o manual pode pular por aqui).

**"Number not on WhatsApp"**: ⚠️ **DIVERGÊNCIA crítica** — o bot não sabe detectar isso, porque não lê o body da Evolution. Se a Evolution devolver 200 com `exists:false`, o lead é marcado como enviado erroneamente.

**Retry**: só entre instâncias diferentes. **Não há retry da mesma instância** após falha transitória.

---

## Seção 4 — Escrita direta no Supabase

### 4.1 Tabelas que o bot escreve (código de produção, excluindo `scripts/test-auto-mode.js`)

| Tabela | Tipo de write | Local |
|---|---|---|
| `leads` | UPSERT (bulk, conflict=`place_id`) | `lib/supabase.js:57-59` |
| `leads` | UPDATE (1 row por `place_id`) | `lib/whatsapp.js:117-124` |
| `leads` | UPDATE (N rows, `.in('place_id', ...)`) | `lib/instantly.js:45-47` |
| `leads` | UPDATE (status='sent' com filtro status='prospected') | `steps/auto.js:260-263` |
| `leads` | UPSERT parcial `{place_id, outreach_channel:'pending'}` | `prospect.js:527-532` |
| `leads` | UPSERT minimal (disqualified) | `steps/auto.js:109, 167` → via `upsertLeads` |
| `conversations` | INSERT | `lib/whatsapp.js:130-138` |

**Totais**: 2 tabelas em código de produção (`leads`, `conversations`). `ai_suggestions` e `projects` só aparecem em `scripts/test-auto-mode.js:78-79` (apagados como cleanup de teste — o bot **não grava** neles).

### 4.2 Campos que o bot já setou em `leads` (fonte de verdade: `LEAD_COLUMNS` em `lib/supabase.js:20-32`, + UPDATEs em outras rotas)

Via `upsertLeads` (todas as colunas em `LEAD_COLUMNS`):

```
place_id, business_name, address, city, search_city, phone, website,
rating, review_count, perf_score, mobile_score, fcp, lcp, cls,
has_ssl, is_mobile_friendly, has_pixel, has_analytics, has_google_ads, has_whatsapp,
has_form, has_booking, tech_stack, scrape_failed,
visual_score, visual_notes,
pain_score, score_reasons, message,
email, email_source, niche,
outreach_sent, outreach_sent_at, outreach_channel,
status, status_updated_at,
message_variant, no_website,
email_subject, country
```

Setados via UPDATE seletivo em outras rotas, **além** de `LEAD_COLUMNS`:
- `evolution_instance` — `lib/whatsapp.js:122` (só no update pós-envio, **não está em `LEAD_COLUMNS`** ⚠️ DIVERGÊNCIA: se um lead for re-upsertado depois, esse valor pode ser sobrescrito por null dependendo do payload — mas como `upsertLeads` só inclui colunas de `LEAD_COLUMNS`, valores antigos ficam preservados pelo Postgres).

**Campo fantasma**: `collected_at` é definido em `collect.js:108, 124` e exportado no CSV, mas **não está em `LEAD_COLUMNS`**, então nunca chega ao DB. `prepareRow` em `supabase.js:34-47` strippa silenciosamente. ⚠️ **DIVERGÊNCIA** pequena: o CSV terá `collected_at`, o banco não.

### 4.3 Campos esperados pelo dashboard — o bot grava?

| Campo | Grava? | Local ou motivo |
|---|---|---|
| `whatsapp_jid` | ❌ **NÃO** | Grep `whatsapp_jid` → 0 matches. `sendMessage` nunca parseia `res.json()` (`whatsapp.js:145-164`). |
| `last_outbound_at` | ❌ **NÃO** | Grep → 0 matches. Usa só `outreach_sent_at`. |
| `last_inbound_at` | ❌ **NÃO** | Grep → 0 matches. Bot não processa inbound — só saída. |
| `last_human_reply_at` | ❌ **NÃO** | Grep → 0 matches. |
| `follow_up_count` | ❌ **NÃO** | Grep → 0 matches. Bot não tem lógica de follow-up. |
| `next_follow_up_at` | ❌ **NÃO** | Grep → 0 matches. |
| `follow_up_paused` | ❌ **NÃO** | Grep → 0 matches. |
| `outreach_error` | ❌ **NÃO** | Grep → 0 matches. Falhas só aparecem em `console.warn` (`whatsapp.js:266`), não no DB. |
| `status_updated_at` | ✅ **SIM** | `steps/collect.js:123` (no collect inicial), `steps/auto.js:107, 165, 261` (nos updates de status). Consta em `LEAD_COLUMNS` (`lib/supabase.js:29`). |
| `evolution_instance` | ✅ **SIM**, parcialmente | `lib/whatsapp.js:122` — gravado só no UPDATE pós-envio. **Não está em `LEAD_COLUMNS`**, portanto re-upserts posteriores não tocam nele (OK por Postgres, mas frágil). |

Resumo: de 10 campos perguntados, o bot escreve **2** (`status_updated_at`, `evolution_instance`). Os 8 faltantes são a raiz do problema de dessincronização — todos relacionados a rastreamento de envio/follow-up/inbox.

### 4.4 Tabela `conversations`

Sim, **uma única inserção** em `lib/whatsapp.js:129-138`:

```js
const { error: convError } = await client
  .from('conversations')
  .insert({
    place_id:       placeId,
    direction:      'out',
    channel:        'whatsapp',
    message:        messageText,
    sent_at:        now,
    suggested_by_ai: false,
  });
```

Campos inseridos: `place_id`, `direction`, `channel`, `message`, `sent_at`, `suggested_by_ai`.

⚠️ **DIVERGÊNCIAS**:
- Só para **WhatsApp**. Instantly/email **não cria nenhum registro em `conversations`** — `lib/instantly.js:42-50` só atualiza `leads`, nunca toca em `conversations`. O inbox do dashboard nunca vê emails saindo.
- Campo `whatsapp_jid` não é inserido aqui (nem na tabela `leads`). Se a tabela `conversations` tiver FK ou relação com `whatsapp_jid`, fica quebrada.
- `suggested_by_ai` é hardcoded `false` — dashboard pode estar esperando `true` para mensagens geradas pelo Claude.

### 4.5 SDK / cliente Supabase

- Pacote: `@supabase/supabase-js` v2.49.4 (`package.json:12`).
- **Service role key** (`SUPABASE_SERVICE_KEY`, `lib/supabase.js:10-14`), que **bypassa RLS**. Confirmado no CLAUDE.md e validado em `prospect.js:65, 134-135`.
- Cliente é singleton global (`lib/supabase.js:5-16`).

---

## Seção 5 — Comunicação bot ↔ dashboard

### 5.1 O bot conhece a URL do dashboard?

**Não.** Grep completo:

```
fastdevbuilds      → só aparece em prompts de geração de mensagem (lib/prompts.js:236, 276)
                     e em textos descritivos (CLAUDE.md, package.json)
DASHBOARD_URL      → 0 matches
NEXT_PUBLIC_*      → 0 matches
API_URL / BOT_URL  → só em scripts/test-auto-mode.js:26 (BOT_URL apontando para o próprio bot-server)
```

O bot literalmente não tem endereço de backend do dashboard configurado.

### 5.2 O bot faz chamadas HTTP ao dashboard?

**Não.** Lista exaustiva de todos os `fetch(...)` em código de produção:

| Destino | Arquivo | Motivo |
|---|---|---|
| `maps.googleapis.com/.../textsearch/json` | `steps/collect.js:33` | Google Places |
| `maps.googleapis.com/.../details/json` | `steps/collect.js:49` | Google Place Details |
| `www.googleapis.com/pagespeedonline/v5/runPagespeed` | `lib/pagespeed.js:24` | PageSpeed |
| Site do lead (homepage + contact paths) | `lib/scraper.js:67`, `lib/enricher.js:28` | scraping |
| `api.hunter.io/v2/domain-search` | `lib/enricher.js:80` | Hunter.io |
| `api.instantly.ai/api/v2/leads` | `lib/instantly.js:78` | Instantly |
| `${apiUrl}/message/sendText/${name}` | `lib/whatsapp.js:148` | Evolution API |
| (Anthropic SDK) | `steps/message.js:269`, `steps/visual.js:29` | Claude Haiku |

**Zero chamadas para o dashboard.** Nenhum webhook, nenhum callback, nenhuma notificação.

### 5.3 Conclusão de comunicação

Comunicação é **unidirecional via shared Supabase DB + comando HTTP entrante**:

```
dashboard ──HTTP POST /run-auto──▶ bot-server ──spawn──▶ prospect.js ──writes──▶ Supabase
                                                                                    ▲
                                                                                    │
dashboard ──reads──────────────────────────────────────────────────────────────────┘
```

O bot **não tem como** avisar o dashboard de nada — o dashboard tem que descobrir sozinho lendo o DB. Isso confirma e explica: se o bot não grava `whatsapp_jid / outreach_error / last_outbound_at`, o dashboard nunca fica sabendo.

---

## Seção 6 — Configuração e secrets

### 6.1 Env vars usadas pelo bot

Lista completa via grep (`process.env.*`):

| Variável | Uso | Obrigatória? |
|---|---|---|
| `GOOGLE_MAPS_API_KEY` | Places + PageSpeed (1 key, 2 produtos) | Sim sempre |
| `ANTHROPIC_API_KEY` | Claude Haiku (mensagens + visual) | Sim, exceto `--dry` |
| `SUPABASE_URL` | Supabase client | Sim p/ `--auto` ou `--export supabase` |
| `SUPABASE_SERVICE_KEY` | Supabase client (service role, bypass RLS) | Sim p/ idem |
| `INSTANTLY_API_KEY` | Instantly.ai (US/email) | Sim se `--send --lang en` |
| `INSTANTLY_CAMPAIGN_ID` | Instantly.ai | Sim se `--send --lang en` |
| `HUNTER_API_KEY` | Hunter.io email fallback | Opcional |
| `EVOLUTION_API_URL` | Evolution base URL (fallback) | Só se dashboard **não** mandar via `--config` |
| `EVOLUTION_API_KEY` | idem | idem |
| `EVOLUTION_INSTANCE` | idem | idem |
| `BOT_SERVER_SECRET` | Auth Bearer do bot-server | Opcional (⚠️ fail-open se vazio) |
| `PORT` | Porta do bot-server | Opcional (default 3001) |
| `BOT_SERVER_URL` | Só usado em `scripts/test-auto-mode.js:26` | — |

### 6.2 Env vars compartilhadas com dashboard

Baseado em convenção + no fato de usarem o mesmo Supabase:

- **Compartilhadas obrigatoriamente**: `SUPABASE_URL`, `SUPABASE_SERVICE_KEY` (dashboard precisa ler os mesmos dados).
- **Provavelmente compartilhadas**: `EVOLUTION_API_URL`, `EVOLUTION_API_KEY`, instâncias — o dashboard configura quais instâncias usar e envia via `POST /run-auto` payload `evolutionInstances + evolutionApiUrl` (`bot-server/server.js:182-186`). Então o dashboard é a **fonte canônica** das credenciais Evolution, e o bot serve como fallback via env vars.
- **Provavelmente compartilhadas**: `ANTHROPIC_API_KEY`, `INSTANTLY_API_KEY`, `HUNTER_API_KEY` (todas integrações comuns).
- **Não compartilhadas**: `BOT_SERVER_SECRET` é o shared-secret do dashboard→bot-server apenas.

### 6.3 Config de niches/cities

**Vem do dashboard via `--config`** na prática. `lib/auto-config.js` é usado só como fallback hardcoded.

Caminho:
1. Dashboard chama `POST /run-auto` com body contendo `niches`, `cities`, `market`, `lang`, `evolutionInstances`, `evolutionApiUrl` (`bot-server/server.js:150-191`).
2. bot-server grava tudo num tempfile (`writeFileSync` em `server.js:186`) e passa `--config <path>` ao child (`server.js:187`).
3. `prospect.js:74-85` lê o tempfile como JSON e passa para `runAuto({ externalConfig })`.
4. `lib/queue.js:100-122` → `getAllTargets(externalConfig)` usa a config externa se existe; senão cai em `AUTO_CONFIG` hardcoded (`lib/auto-config.js:12+`).

CLAUDE.md do bot confirma: "Each city in `AUTO_CONFIG` can expand into multiple `regions`…" mas o CLAUDE.md do dashboard afirma que niches/cities chegam via `/api/bot/queue`. ✅ **Confirmado** — a rota `/api/bot/queue` aceita `niches/cities` no body POST (`bot-server/server.js:106-113`) e a rota `/run-auto` também (`server.js:172-191`).

⚠️ **DIVERGÊNCIA** latente: a config hardcoded em `lib/auto-config.js` (~28 KB de niches + cidades BR/US) duplica lógica que o dashboard provavelmente mantém atualizada em outro lugar. Se alguém rodar o bot sem passar `--config`, o fallback pode gerar dados desalinhados com o que o dashboard mostra.

---

## Seção 7 — Idempotência e estado

### 7.1 Interrupção no meio de um run

Cenário: Railway kill / crash / `POST /cancel` → `child.kill()`.

**O que sobrevive**: tudo que já foi persistido via `upsertLeads` (Supabase). O pipeline chama `upsertLeads` **duas vezes** por item de fila:
- **Primeiro**: para disqualified/minimal após scoring (`steps/auto.js:109, 167`).
- **Segundo**: lead completo com mensagem após `generateMessages` (`steps/auto.js:210`).

Entre essas duas escritas, se o processo morrer:
- Leads já enriquecidos com site-scan mas **sem mensagem gerada** ficam no DB com `pain_score`, `score_reasons`, `status='prospected'`, mas `message` vazia.
- Leads que **sobreviveram** até o dispatch mas morreram no meio do `sendWhatsApp`: os que já tinham sido marcados em `markSent` (whatsapp.js:112-141) estão com `outreach_sent=true`. Os que não chegaram lá ficam com `outreach_sent=false` + mensagem gerada.
- ⚠️ **DIVERGÊNCIA**: não há checkpoint no meio da `sendWhatsApp` — se o processo morre entre a linha 243 (Evolution responde OK) e a linha 244 (`markSent`), a mensagem **foi enviada via WhatsApp** mas o DB nunca soube. O cliente recebeu, o bot não registra. O re-run vai mandar de novo.

### 7.2 Re-run com mesma config

**Re-prospecta os mesmos `place_id`?** Não — há dois níveis de dedup:

1. **Queue-level** (`lib/queue.js:100-122`): diffar `(niche, search_city)` já prospectados nos últimos 60 dias (`RECHECK_DAYS = 60`, `queue.js:8`) contra a config. Combos já prospectados são filtrados da fila.
2. **Lead-level** (`steps/auto.js:45-67`, `prospect.js:336-358`): logo após Google Places, consulta `leads` por `place_id` e filtra os já conhecidos. Economiza PageSpeed + scrape + Claude.

**Re-envia para quem já foi enviado?** Não — há dois níveis:

1. **Batch-level** (pré-send): `getAlreadySentPlaceIds` em `lib/instantly.js:7-19` filtra leads com `outreach_sent=true`.
2. **Per-send** (anti-parallel-run): `whatsapp.js:223-232` consulta `outreach_sent` por lead **imediatamente antes** do envio, skipa se já enviado.

⚠️ **DIVERGÊNCIA**: se uma execução anterior conseguiu enviar mas crashou antes de gravar `markSent` (ver 7.1 acima), o lead fica como "não enviado" e **vai receber de novo**. Não há idempotency key na Evolution API — cada chamada é um novo envio.

### 7.3 `run_id` no lead?

**Não.** Grep: não há coluna `run_id`, `batch_id`, `execution_id`, `session_id` em `LEAD_COLUMNS` (`lib/supabase.js:20-32`). O `runId` que o bot-server gera (`bot-server/server.js:193`) é UUID usado **só para tracking de logs em memória**, nunca chega ao Supabase.

Rastreabilidade existente: `collected_at` (em memória, não persiste), `status_updated_at` (persiste), `outreach_sent_at` (persiste). Para correlacionar "quais leads vieram do run X" é preciso usar a janela `status_updated_at BETWEEN ?` — aproximado.

---

## Seção 8 — Resumo executivo

### 8.1 Top 5 problemas confirmados

1. **Resposta da Evolution API é 100% descartada** — `lib/whatsapp.js:145-164`. O bot nunca chama `res.json()`. Isso impede gravar `whatsapp_jid`, impede detectar `exists: false` em número não registrado, e impede qualquer confirmação real de entrega. **É a causa raiz do observado em produção** (2/6216 leads com `whatsapp_jid`).

2. **Campos de follow-up / inbox nunca são escritos** — `whatsapp_jid`, `last_outbound_at`, `last_inbound_at`, `last_human_reply_at`, `follow_up_count`, `next_follow_up_at`, `follow_up_paused`, `outreach_error` — todos 0 matches no código do bot. Se o dashboard depende deles, o bot precisa começar a gravar ou o dashboard precisa calcular a partir de `conversations` + `outreach_sent_at`.

3. **Falhas de envio somem silenciosamente** — `lib/whatsapp.js:266-267` só faz `console.warn`. Sem `outreach_error` no DB, o dashboard não tem como mostrar "falhou por X". Lead volta a ser elegível em re-runs (porque `outreach_sent` ficou false) e é tentado de novo sem diagnóstico.

4. **`conversations` só é populado para WhatsApp** — `lib/whatsapp.js:129-138` insere row de outbound para WhatsApp. `lib/instantly.js:42-50` (email) **nunca toca em `conversations`**. Inbox do dashboard vê só WhatsApp, nunca vê emails enviados.

5. **Janela entre `sendMessage` e `markSent` não é idempotente** — `lib/whatsapp.js:243-244`. Se o processo morrer entre a linha 243 (Evolution aceitou) e a linha 244 (DB UPDATE), a mensagem saiu mas o DB nunca sabe. Re-run envia de novo. Isso mascara ainda mais a ausência de `whatsapp_jid` — sem `jid` não dá nem para reconciliar pelo remoteJid retornado.

### 8.2 Qual deveria ser o contrato entre bot e dashboard?

**Recomendação: opção (b) híbrida — dashboard vira o dono das escritas pós-envio, bot só dispara o envio.**

**Justificativa** (com base estrita no que foi observado):

- O bot já é um **child process do bot-server**, que já é **invocado pelo dashboard**. O fluxo de controle já é "dashboard → bot-server → bot". Inverter para "bot → dashboard API" reaproveita uma direção natural que só ainda não existe.
- Os campos que faltam (`whatsapp_jid`, `last_outbound_at`, `follow_up_count`, `outreach_error`) são todos **derivados do que o dashboard mostra**. Faz sentido centralizar a lógica de "o que significa ter enviado com sucesso" no dashboard, em vez de re-implementar em JS no bot.
- O bot hoje tem **duplicação** entre `prospect.js` manual e `steps/auto.js` — qualquer correção precisa ser feita duas vezes. Mover dispatch para um endpoint do dashboard reduz superfície a um único lugar no bot.
- O parse do `remoteJid` da resposta da Evolution (para extrair o `whatsapp_jid`) precisa ser feito **em algum lugar**. Fazê-lo no dashboard (ou num serviço central) evita ter que propagar a lógica para o `sendMessage`. Porém, a alternativa também funciona: parsear no bot e incluir no payload do callback.
- **Mantém `leads` UPSERT direto do bot** — essa parte (collect/score/message) não se beneficia do round-trip HTTP: volume alto (6216 leads), sem dependência circular com dashboard, muita coluna.

Ressalva honesta: opção (a) — continuar escrevendo direto no DB — **também é viável** se você adicionar os ~8 campos faltantes ao bot. Menos mudança, menos superfície nova. A decisão é política: quem é o dono da definição de "enviado com sucesso"? Se for o dashboard, (b); se for o bot, (a) com os campos adicionados.

### 8.3 Endpoints que o bot precisaria chamar se escolher (b)

Endpoints que o bot passaria a chamar (dashboard expõe):

1. **`POST /api/bot/leads/bulk-upsert`** — substitui `upsertLeads` em `lib/supabase.js`. Recebe array de leads normalizados, dashboard aplica regra de merge + validação de schema. **Alternativa menos invasiva**: manter `upsertLeads` direto e só mover o dispatch. Essa é a decisão de escopo.

2. **`POST /api/bot/outreach/sent`** — substitui `markSent` em `lib/whatsapp.js:112-141` e `markSentInSupabase` em `lib/instantly.js:42-50`. Payload:
   ```json
   {
     "place_id": "...",
     "channel": "whatsapp" | "email",
     "message": "...",
     "evolution_instance": "...",
     "evolution_response": { /* body cru da Evolution, p/ dashboard extrair remoteJid → whatsapp_jid */ },
     "sent_at": "ISO"
   }
   ```
   Dashboard grava `leads` (`outreach_sent`, `outreach_sent_at`, `outreach_channel`, `whatsapp_jid`, `last_outbound_at`, `evolution_instance`) **e** `conversations` (inclusive para email), num único fluxo.

3. **`POST /api/bot/outreach/failed`** — endpoint novo. Substitui o `console.warn` em `whatsapp.js:266`. Payload:
   ```json
   { "place_id": "...", "channel": "...", "error": "...", "instance": "...", "http_status": 4xx }
   ```
   Dashboard grava `outreach_error`, aumenta `follow_up_count` ou marca lead como "bounced".

4. **`POST /api/bot/leads/disqualified`** — substitui o `upsertLeads(minimal)` em `auto.js:97-109, 157-168`. Menos crítico; pode ficar como DB direto.

5. **(Opcional) `GET /api/bot/config`** — substitui `--config` via tempfile. Bot pega niches/cities/instances direto do dashboard no startup. Remove a roundtrip via bot-server. **Não recomendado agora** — o fluxo via `--config` já funciona e a mudança seria invasiva demais.

**Escritas diretas que o bot pode parar de fazer** se (b) for adotado na forma mínima (só dispatch via API):

- `lib/whatsapp.js:112-141` (`markSent` — UPDATE `leads` + INSERT `conversations`).
- `lib/instantly.js:42-50` (`markSentInSupabase` — UPDATE `leads`).
- `steps/auto.js:253-268` (UPDATE `status='sent'`).

Escritas que o bot **mantém** (essenciais, alto volume, sem circular):

- `lib/supabase.js` `upsertLeads` (collect/score/message → bulk upsert).
- `prospect.js:527-532` (pending — ou migrar para API também, é 1 linha).
- `steps/auto.js:109, 167` (disqualified minimal upsert).

---

**Fim do relatório.** Próximo passo sugerido: decidir entre (a) e (b) e, se (b), desenhar o contrato JSON dos 3 endpoints do dashboard antes de mexer no código.
