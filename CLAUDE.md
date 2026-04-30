# FastDevBuilds Prospect Bot — contexto

Script de prospecção + coleta de Google Places details. Node.js puro, sem framework.

## Fluxo

1. `steps/collect.js` — busca leads no Google Places (Text Search), enriquece com Place Details (horários, reviews, fotos).
2. `lib/supabase.js` — `LEAD_COLUMNS` whitelist pra inserção.
3. `lib/whatsapp.js` — round-robin entre 3 chips, `MAX_PER_INSTANCE_PER_DAY=30`. Dedup via RPC `check_phone_already_sent`.
4. `scripts/backfill-place-details.js` — reprocessa leads antigos.
5. `scripts/reconcile-quarantine.js` — fuzzy match pushName ≈ business_name, resgata inbounds quarentenados.

## Filtros importantes

- Reviews só se `text.length >= 80` — curtas ("Top!", "Ótimo") não ajudam a descobrir o nicho real.
- Google Places key sem restrições (risco aceito).

## Não fazer

- Não adicionar deps sem motivo — `@supabase/supabase-js` + `dotenv` é suficiente.
- Reviews: nunca incluir se forem curtas demais.
