# RESUMO-LEITURA-B

Pontos onde o bot grava em `leads` ou `conversations` hoje:

**A REMOVER (substituir por HTTP ao CRM):**
- lib/whatsapp.js:112-141 — `markSent`: UPDATE leads + INSERT conversations pós-envio WhatsApp
- lib/whatsapp.js:244 — chamada `markSent(...)` dentro do loop de sends (remover chamada também)
- lib/instantly.js:42-50 — `markSentInSupabase`: UPDATE leads pós-envio email (+ call em :97)
- steps/auto.js:253-268 — UPDATE leads SET status='sent' pós-dispatch
- prospect.js:524-538 — upsert parcial `{outreach_channel:'pending'}` (pós-dispatch)

**MANTÉM (fora do escopo — NÃO mexer):**
- lib/supabase.js `upsertLeads` (collect/score/message bulk persist)
- steps/auto.js:97-109, 157-168 — disqualified minimal upsert
- lib/instantly.js:7-19 — `getAlreadySentPlaceIds` (SELECT pre-send dedup)
- Dedup/parallel SELECTs em auto.js:44-66, whatsapp.js:222-232, prospect.js:336-358
