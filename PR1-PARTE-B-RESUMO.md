# PR1 — Parte B (prospect-bot): delegar writes pós-envio ao CRM

## Checklist

- [x] Passo 1 — Leitura prévia (CLAUDE.md, AUDIT-REPORT.md, lib/whatsapp.js, lib/instantly.js, steps/auto.js, prospect.js, lib/supabase.js) → `RESUMO-LEITURA-B.md`.
- [x] Passo 2 — `lib/crm-client.js` criado (notifyCrmSent / notifyCrmFailed + validateCrmEnv).
- [x] Passo 3 — `lib/whatsapp.js`: sendMessage retorna objeto, `markSent` removido, notifyCrm no sucesso e na falha total, fields em memória preservados.
- [x] Passo 4 — `lib/instantly.js`: `markSentInSupabase` removido, dispatch por-lead (substitui fake-batching), notifyCrm no sucesso e na falha.
- [x] Passo 5 — `steps/auto.js`: UPDATE `status='sent'` pós-dispatch removido (owner agora é o CRM).
- [x] Passo 6 — `prospect.js`: upsert "pending" pós-dispatch removido; `validateCrmEnv()` invocado em ambos os caminhos (manual `--send` e `--auto --send`).
- [x] Passo 7 — `.env.example` + `CLAUDE.md` atualizados (seção "CRM integration").
- [x] Passo 8 — `node --check` OK em todos os arquivos modificados. Não há script de lint.
- [x] Passo 9 — este resumo.

## Arquivos

**Criados**
- `lib/crm-client.js` — cliente HTTP com retry 3x / backoff 1s·2s·4s / timeout 10s.
- `RESUMO-LEITURA-B.md`
- `PR1-PARTE-B-RESUMO.md`

**Modificados**
- `lib/whatsapp.js` — remoção de `markSent` (UPDATE leads + INSERT conversations) e da classe `RateLimitError`; reescrita de `sendMessage` (lê body sempre, nunca lança em HTTP); nova lógica de dispatch no loop com notifyCrmSent/Failed.
- `lib/instantly.js` — remoção de `markSentInSupabase`; nova função `postToInstantly` (lê body sempre); sendToInstantly agora é per-lead.
- `steps/auto.js` — remoção do bloco final que fazia `UPDATE leads SET status='sent' WHERE status='prospected'`.
- `prospect.js` — remoção do upsert parcial `{outreach_channel:'pending'}` pós-dispatch; chamada de `validateCrmEnv()` nos dois caminhos (`--auto --send` e manual `--send`); import de `validateCrmEnv`.
- `.env.example` — acrescentado `CRM_API_URL` + `BOT_TO_CRM_SECRET`.
- `CLAUDE.md` — nova seção "CRM integration (post-send writes)"; parágrafos de "Dispatch routing" e "Data model" atualizados para refletir o novo contrato.

## Linhas removidas (pontos de escrita direta)

- `lib/whatsapp.js` — função `markSent` (UPDATE `leads` + INSERT `conversations`), ~30 linhas.
- `lib/whatsapp.js` — classe `RateLimitError` (substituída por `error_code: 'rate_limited'` no retorno).
- `lib/instantly.js` — função `markSentInSupabase` (UPDATE `leads`), ~8 linhas.
- `steps/auto.js` — bloco `if (sentCount > 0) { … .from('leads').update({ status: 'sent', … }) … }`, ~16 linhas.
- `prospect.js` — bloco `6c. Pending — mark in Supabase, no send` (UPSERT parcial `{outreach_channel:'pending'}`), ~14 linhas.

## Teste manual

Pré-requisitos:

1. O CRM (`fastdevbuilds-admin`) rodando com `BOT_TO_CRM_SECRET` **igual** ao do bot.
2. Gerar secret, se ainda não existir:

```bash
openssl rand -hex 32
```

3. Exportar no ambiente do bot:

```bash
export CRM_API_URL=http://localhost:3000       # ou https://admin.fastdevbuilds.com
export BOT_TO_CRM_SECRET=<hex-gerado-acima>
```

Validar conectividade + auth sem mandar nenhum WhatsApp / email:

```bash
# Autenticação válida, lead inexistente → 404 lead_not_found
curl -sS -X POST "$CRM_API_URL/api/bot/outreach/sent" \
  -H "Authorization: Bearer $BOT_TO_CRM_SECRET" \
  -H "Content-Type: application/json" \
  -d '{"place_id":"__TEST__","channel":"whatsapp","message":"ping","evolution_response":null}' | jq .

# Autenticação inválida → 401
curl -sS -X POST "$CRM_API_URL/api/bot/outreach/sent" \
  -H "Authorization: Bearer WRONG" \
  -H "Content-Type: application/json" \
  -d '{}' -o /dev/null -w "%{http_code}\n"

# failed endpoint (não precisa de lead existente para retorno 200, só grava se achar)
curl -sS -X POST "$CRM_API_URL/api/bot/outreach/failed" \
  -H "Authorization: Bearer $BOT_TO_CRM_SECRET" \
  -H "Content-Type: application/json" \
  -d '{"place_id":"__TEST__","channel":"whatsapp","error":"probe","error_code":"unknown"}' | jq .
```

Exercitar o crm-client em isolação (sem chamar Evolution):

```bash
cd /home/levilaell/prospect-bot
node -e "
  import('./lib/crm-client.js').then(async ({ notifyCrmFailed }) => {
    const r = await notifyCrmFailed({
      place_id: '__TEST__',
      channel: 'whatsapp',
      error: 'local smoke test',
      error_code: 'unknown',
    });
    console.log('result:', r);
  });
"
# Esperado: log [crm-client:failed] attempt 1/3 ok status=200 e 'result: { ok: true }'
```

Run real end-to-end (com WhatsApp ou email reais):

```bash
# Dry — sem env do CRM configurada, deve ainda funcionar (não chama notifyCrm)
node prospect.js --niche "dentists" --city "São Paulo, SP" --lang pt --dry --limit 5

# Send — aqui o CRM precisa estar no ar
node prospect.js --niche "dentists" --city "São Paulo, SP" --lang pt \
  --send --export supabase --limit 1

# Auto + send
node prospect.js --auto --market BR --limit 5 --min-score 3 --send --max-send 1
```

O que observar nos logs:

- `[crm-client:sent] attempt 1/3 ok status=200` após cada envio Evolution OK.
- `[crm-client:failed] attempt 1/3 ok status=200` quando todas as instâncias falham.
- `❗  CRM /sent failed for <place_id>` caso o CRM exaure as 3 tentativas (mensagem FOI entregue, só a gravação falhou — requer reconciliação manual).

## Decisões tomadas sozinho

1. **`validateCrmEnv()` explícito em vez de throw em module-load.** O bot importa `lib/whatsapp.js` e `lib/instantly.js` incondicionalmente (mesmo em `--dry`). Se `crm-client.js` lançasse no top-level quando `CRM_API_URL` estivesse ausente, quebraria `--dry`. A validação é chamada em `prospect.js` junto com as outras checagens de `--send`, onde o crash natural deve acontecer.
2. **`notifyCrm*` nunca lança.** Mesmo com env vars ausentes retornam `{ ok: false, exhausted: true }`. Lançar de dentro do loop de envio faria com que o `try/catch` existente em `sendWhatsApp` tratasse o erro como falha da Evolution e re-tentasse em outra instância — **a mensagem já foi entregue**, re-tentar seria spam.
3. **Classe `RateLimitError` removida.** Virou dead code quando `sendMessage` deixou de lançar em HTTP não-OK. A classificação 429 agora é feita pelo campo `error_code: 'rate_limited'` do retorno, que alimenta tanto o branch de espera-60s quanto o payload de `/failed`.
4. **Upsert "pending" em `prospect.js` removido por completo** (incluindo o stamp em memória). A instrução `"manter só collect/score/message/upsert"` exclui esse write; o CSV é escrito antes desse ponto, então o stamp in-memory não chegava ao arquivo de qualquer forma. `result.pending` (contagem) continua existindo para o resumo do run.
5. **Dispatch per-lead no `lib/instantly.js`.** O código antigo fazia fake-batching em grupos de 10 — uma falha em um lead jogava o batch inteiro no contador de `failed`. Notificar `/sent` ou `/failed` **por lead** obriga a iterar um-a-um; aproveitei para corrigir esse comportamento (uma falha agora conta só o lead que falhou).
6. **Ordem de stamp em memória antes de `notifyCrmSent`** no WhatsApp. Assim `steps/auto.js` (que lê `lead.outreach_sent` no resumo do run) vê o lead como enviado mesmo se o CRM estiver lento ou fora do ar.
7. **Mantive `countSentToday()` (dead code desde antes do PR), `_sentThisRun` e o import do Supabase em `whatsapp.js`.** Tudo isso continua sendo usado por `countSentTodayByInstance` (init de contador) e pelo SELECT de parallel-run. Remover estaria fora do escopo.
8. **Endpoints `/sent` e `/failed` têm schemas mais ricos no CRM do que o payload mínimo da tarefa.** Incluí `is_follow_up: false` explícito, `subject` (email), `http_status` e `error_code` estruturado no payload de `/failed`, porque o validador do CRM aceita/usa todos eles. Não adicionei nenhum campo que o CRM não documente.

## Bloqueios

Nenhum bloqueio de código. Para validação end-to-end é preciso:

- O CRM no ar (local ou prod) com o endpoint `/api/bot/outreach/{sent,failed}` habilitado.
- `BOT_TO_CRM_SECRET` sincronizado entre bot e CRM.
- Pelo menos 1 lead pré-existente no `leads` do CRM para o endpoint `/sent` retornar 200 (idempotência + insert da conversation dependem do lead existir).

Nada foi commitado — o working tree fica com os diffs para revisão.
