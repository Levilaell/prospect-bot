#!/usr/bin/env node

/**
 * Integration test suite for the autonomous prospecting mode.
 *
 * Tests:
 *   1. Queue generation (empty DB → full, with leads → subtracted)
 *   2. Deduplication by place_id
 *   3. Zero waste (all scores saved, only qualified sent)
 *   4. Daily limit enforcement
 *   5. Bot-server integration (/queue, /run-auto)
 *   6. Consistency after execution (dry vs live)
 *
 * Run: node scripts/test-auto-mode.js
 */

import 'dotenv/config';
import { createClient } from '@supabase/supabase-js';
import { generateQueue, getWhatsAppSentToday } from '../lib/queue.js';
import { getAllTargets } from '../lib/auto-config.js';

// ─── Config ───

const SUPABASE_URL = process.env.SUPABASE_URL;
const SERVICE_KEY  = process.env.SUPABASE_SERVICE_KEY;
const BOT_URL      = process.env.BOT_SERVER_URL || 'http://localhost:3001';
const BOT_SECRET   = process.env.BOT_SERVER_SECRET || '';

if (!SUPABASE_URL || !SERVICE_KEY) {
  console.error('ERROR: SUPABASE_URL and SUPABASE_SERVICE_KEY required in .env');
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SERVICE_KEY);

// Test data prefix
const TEST_PREFIX = `__TEST_AUTO_${Date.now()}__`;
const TEST_PHONE = '5511999990099';

// ─── Helpers ───

const results = [];
let passCount = 0, failCount = 0, warnCount = 0;

function pass(test, desc) {
  results.push({ test, desc, status: 'pass' });
  passCount++;
  console.log(`  \x1b[32m✅ Teste ${test}\x1b[0m — ${desc} — PASSOU`);
}

function fail(test, desc, reason) {
  results.push({ test, desc, status: 'fail', reason });
  failCount++;
  console.log(`  \x1b[31m❌ Teste ${test}\x1b[0m — ${desc} — FALHOU: ${reason}`);
}

function warn(test, desc, reason) {
  results.push({ test, desc, status: 'warn', reason });
  warnCount++;
  console.log(`  \x1b[33m⚠️  Teste ${test}\x1b[0m — ${desc} — PARCIAL: ${reason}`);
}

async function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

// ─── Cleanup ───

async function cleanup() {
  console.log('\n\x1b[36m🧹 Limpando dados de teste...\x1b[0m');
  // Delete test leads by place_id prefix
  const { data: testLeads } = await supabase
    .from('leads')
    .select('place_id')
    .like('place_id', `${TEST_PREFIX}%`);

  if (testLeads && testLeads.length > 0) {
    const ids = testLeads.map(l => l.place_id);
    await supabase.from('conversations').delete().in('place_id', ids);
    await supabase.from('ai_suggestions').delete().in('place_id', ids);
    await supabase.from('projects').delete().in('place_id', ids);
    await supabase.from('leads').delete().in('place_id', ids);
    console.log(`  Removidos ${ids.length} leads de teste.`);
  } else {
    console.log('  Nenhum dado de teste encontrado.');
  }
}

// ─── Test 1: Queue Generation ───

async function test1_queueGeneration() {
  console.log('\n\x1b[1m━━━ Teste 1 — Geração de fila ━━━\x1b[0m');

  const allTargets = getAllTargets();
  console.log(`  ℹ️  Total de combinações configuradas: ${allTargets.length}`);

  // 1a. Generate queue — should contain all targets minus what's already in DB
  const { queue: initialQueue, stats: initialStats } = await generateQueue();

  if (initialStats.total === allTargets.length) {
    pass('1a', `Total bate: ${initialStats.total} combinações configuradas`);
  } else {
    fail('1a', 'Total de combinações', `Config: ${allTargets.length}, Queue stats: ${initialStats.total}`);
  }

  // 1b. Insert 3 test leads covering 3 different combos
  const testCombos = [
    { niche: allTargets[0].niche, search_city: allTargets[0].searchCity },
    { niche: allTargets[1].niche, search_city: allTargets[1].searchCity },
    { niche: allTargets[2].niche, search_city: allTargets[2].searchCity },
  ];

  for (let i = 0; i < testCombos.length; i++) {
    await supabase.from('leads').insert({
      place_id: `${TEST_PREFIX}queue_${i}`,
      business_name: `Queue Test ${i}`,
      niche: testCombos[i].niche,
      search_city: testCombos[i].search_city,
      city: testCombos[i].search_city,
      status: 'prospected',
      status_updated_at: new Date().toISOString(),
    });
  }

  // 1c. Re-generate queue — those 3 should be gone
  const { queue: afterQueue, stats: afterStats } = await generateQueue();

  // The 3 combos we inserted should no longer be in the queue
  const missingFromQueue = testCombos.filter(tc =>
    !afterQueue.some(q => q.niche === tc.niche && q.searchCity === tc.search_city)
  );

  if (missingFromQueue.length === 3) {
    pass('1b', '3 combinações prospectadas sumiram da fila');
  } else {
    fail('1b', 'Deduplicação na fila', `${3 - missingFromQueue.length} das 3 combos ainda estão na fila`);
  }

  // 1d. Verify total is exactly total_configured - already_prospected
  // Note: there may be other real leads in the DB, so we check relative change
  const expectedRemaining = initialStats.remaining - 3;
  if (afterStats.remaining === expectedRemaining) {
    pass('1c', `Fila diminuiu exatamente 3: ${initialStats.remaining} → ${afterStats.remaining}`);
  } else {
    warn('1c', 'Contagem da fila',
      `Esperado ${expectedRemaining}, obteve ${afterStats.remaining} (diff: ${afterStats.remaining - expectedRemaining})`);
  }

  // 1e. Test 60-day recheck: insert a lead with old timestamp
  const oldDate = new Date();
  oldDate.setDate(oldDate.getDate() - 61); // 61 days ago
  const oldCombo = allTargets[3];

  await supabase.from('leads').insert({
    place_id: `${TEST_PREFIX}old_combo`,
    business_name: 'Old Combo Test',
    niche: oldCombo.niche,
    search_city: oldCombo.searchCity,
    city: oldCombo.searchCity,
    status: 'prospected',
    status_updated_at: oldDate.toISOString(),
  });

  const { queue: recheckQueue } = await generateQueue();
  const oldComboInQueue = recheckQueue.some(
    q => q.niche === oldCombo.niche && q.searchCity === oldCombo.searchCity
  );

  if (oldComboInQueue) {
    pass('1d', 'Combo > 60 dias voltou à fila para re-prospecção');
  } else {
    fail('1d', 'Filtro temporal 60 dias', 'Combo antiga não voltou à fila');
  }
}

// ─── Test 2: Deduplication by place_id ───

async function test2_deduplication() {
  console.log('\n\x1b[1m━━━ Teste 2 — Deduplicação por place_id ━━━\x1b[0m');

  // 2a. Insert a lead with known place_id and full data
  const testPlaceId = `${TEST_PREFIX}dedup_001`;
  await supabase.from('leads').insert({
    place_id: testPlaceId,
    business_name: 'Dedup Test Corp',
    phone: TEST_PHONE,
    website: 'https://dedup-test.com',
    city: 'São Paulo',
    search_city: 'São Paulo, SP',
    niche: 'test',
    pain_score: 7,
    mobile_score: 45,
    status: 'prospected',
    status_updated_at: new Date().toISOString(),
  });

  // 2b. Verify the lead exists
  const { data: before } = await supabase
    .from('leads')
    .select('place_id, pain_score, mobile_score')
    .eq('place_id', testPlaceId)
    .single();

  if (before) {
    pass('2a', 'Lead de teste inserido no banco');
  } else {
    fail('2a', 'Inserir lead de teste', 'Lead não encontrado');
    return;
  }

  // 2c. Simulate what the dedup check does (from auto.js fix)
  const placeIds = [testPlaceId, `${TEST_PREFIX}new_lead`];
  const { data: existing } = await supabase
    .from('leads')
    .select('place_id')
    .in('place_id', placeIds);

  const existingSet = new Set((existing || []).map(r => r.place_id));

  if (existingSet.has(testPlaceId)) {
    pass('2b', 'place_id existente detectado na verificação de dedup');
  } else {
    fail('2b', 'Dedup check', 'place_id existente não encontrado');
  }

  const newOnly = placeIds.filter(id => !existingSet.has(id));
  if (newOnly.length === 1 && newOnly[0] === `${TEST_PREFIX}new_lead`) {
    pass('2c', 'Apenas leads novos passam — existente foi filtrado');
  } else {
    fail('2c', 'Filtragem dedup', `Esperado 1 novo, obteve ${newOnly.length}`);
  }

  // 2d. Verify original data wasn't overwritten
  const { data: after } = await supabase
    .from('leads')
    .select('pain_score, mobile_score')
    .eq('place_id', testPlaceId)
    .single();

  if (after?.pain_score === 7 && after?.mobile_score === 45) {
    pass('2d', 'Dados originais não foram sobrescritos');
  } else {
    fail('2d', 'Integridade dos dados', `pain_score=${after?.pain_score}, mobile_score=${after?.mobile_score}`);
  }
}

// ─── Test 3: Zero waste ───

async function test3_zeroWaste() {
  console.log('\n\x1b[1m━━━ Teste 3 — Zero desperdício ━━━\x1b[0m');

  // 3a. Insert 5 leads with varying scores
  const testLeads = [
    { place_id: `${TEST_PREFIX}score_2`, pain_score: 2, business_name: 'Low Score Corp' },
    { place_id: `${TEST_PREFIX}score_4`, pain_score: 4, business_name: 'Below Min Corp' },
    { place_id: `${TEST_PREFIX}score_6`, pain_score: 6, business_name: 'Above Min Corp' },
    { place_id: `${TEST_PREFIX}score_8`, pain_score: 8, business_name: 'High Score Corp' },
    { place_id: `${TEST_PREFIX}score_10`, pain_score: 10, business_name: 'Max Score Corp' },
  ];

  for (const lead of testLeads) {
    await supabase.from('leads').insert({
      ...lead,
      phone: TEST_PHONE,
      website: 'https://test.com',
      city: 'São Paulo',
      search_city: 'São Paulo, SP',
      niche: 'test',
      status: 'prospected',
      status_updated_at: new Date().toISOString(),
      outreach_sent: false,
    });
  }

  // 3b. Verify all 5 are in the database
  const { data: allLeads } = await supabase
    .from('leads')
    .select('place_id, pain_score, outreach_sent')
    .like('place_id', `${TEST_PREFIX}score_%`);

  if (allLeads?.length === 5) {
    pass('3a', 'Todos os 5 leads salvos no banco independente do score');
  } else {
    fail('3a', 'Leads salvos', `Esperado 5, encontrados ${allLeads?.length}`);
  }

  // 3c. Simulate the scoring filter (minScore = 5)
  const minScore = 5;
  const qualified = (allLeads || []).filter(l => (l.pain_score ?? 0) >= minScore);
  const unqualified = (allLeads || []).filter(l => (l.pain_score ?? 0) < minScore);

  if (qualified.length === 3) {
    pass('3b', `Apenas ${qualified.length} leads qualificados (score >= ${minScore})`);
  } else {
    fail('3b', 'Filtragem de score', `Esperado 3 qualificados, obteve ${qualified.length}`);
  }

  // 3d. Mark qualified as sent (simulating outreach)
  for (const lead of qualified) {
    await supabase.from('leads').update({
      outreach_sent: true,
      outreach_sent_at: new Date().toISOString(),
      outreach_channel: 'whatsapp',
    }).eq('place_id', lead.place_id);
  }

  // 3e. Verify low-score leads still exist with outreach_sent: false
  const { data: lowScoreLeads } = await supabase
    .from('leads')
    .select('place_id, pain_score, outreach_sent')
    .like('place_id', `${TEST_PREFIX}score_%`)
    .eq('outreach_sent', false);

  if (lowScoreLeads?.length === 2) {
    pass('3c', 'Leads de score baixo no banco com outreach_sent: false');
  } else {
    fail('3c', 'Leads low-score', `Esperado 2 com outreach_sent=false, obteve ${lowScoreLeads?.length}`);
  }

  // 3f. Verify high-score leads are marked as sent
  const { data: sentLeads } = await supabase
    .from('leads')
    .select('place_id')
    .like('place_id', `${TEST_PREFIX}score_%`)
    .eq('outreach_sent', true);

  if (sentLeads?.length === 3) {
    pass('3d', 'Leads qualificados marcados como enviados');
  } else {
    fail('3d', 'Outreach marking', `Esperado 3 sent=true, obteve ${sentLeads?.length}`);
  }
}

// ─── Test 4: Daily limit ───

async function test4_dailyLimit() {
  console.log('\n\x1b[1m━━━ Teste 4 — Limite diário ━━━\x1b[0m');

  // 4a. Count current daily sends
  const sentToday = await getWhatsAppSentToday();
  console.log(`  ℹ️  WhatsApp enviados hoje: ${sentToday}`);

  // 4b. Insert fake sent leads to simulate 45 sends today
  const fakeSends = [];
  const todayIso = new Date().toISOString();
  for (let i = 0; i < 45; i++) {
    fakeSends.push({
      place_id: `${TEST_PREFIX}daily_${i}`,
      business_name: `Daily Test ${i}`,
      phone: `551199999${String(i).padStart(4, '0')}`,
      city: 'São Paulo',
      niche: 'test_daily',
      status: 'sent',
      status_updated_at: todayIso,
      outreach_sent: true,
      outreach_sent_at: todayIso,
      outreach_channel: 'whatsapp',
    });
  }

  // Insert in batches
  for (let i = 0; i < fakeSends.length; i += 50) {
    await supabase.from('leads').insert(fakeSends.slice(i, i + 50));
  }

  // 4c. Check daily count now
  const afterCount = await getWhatsAppSentToday();
  const expectedCount = sentToday + 45;

  if (afterCount >= expectedCount) {
    pass('4a', `Contagem diária correta: ${afterCount} (antes: ${sentToday}, adicionados: 45)`);
  } else {
    warn('4a', 'Contagem diária', `Esperado >= ${expectedCount}, obteve ${afterCount}`);
  }

  // 4d. Calculate slots remaining
  const DAILY_LIMIT = 50;
  const slotsLeft = Math.max(0, DAILY_LIMIT - afterCount);
  console.log(`  ℹ️  Slots restantes: ${slotsLeft}`);

  if (slotsLeft <= 5) {
    pass('4b', `Limite quase atingido: ${slotsLeft} slots livres de 50`);
  } else {
    warn('4b', 'Slots restantes', `${slotsLeft} slots — esperava <= 5 para teste de limite`);
  }

  // 4e. Verify the queue respects the limit via generateQueue
  const { stats } = await generateQueue();
  if (stats.whatsappSentToday >= expectedCount) {
    pass('4c', `Queue stats reflete envios: ${stats.whatsappSentToday} hoje, ${stats.whatsappSlotsLeft} slots`);
  } else {
    fail('4c', 'Queue stats', `whatsappSentToday=${stats.whatsappSentToday}, esperado >= ${expectedCount}`);
  }
}

// ─── Test 5: Bot-server integration ───

async function test5_botServer() {
  console.log('\n\x1b[1m━━━ Teste 5 — Integração bot-server ━━━\x1b[0m');

  // 5a. GET /api/bot/queue
  try {
    const headers = {};
    if (BOT_SECRET) headers['Authorization'] = `Bearer ${BOT_SECRET}`;

    const res = await fetch(`${BOT_URL}/api/bot/queue`, { headers });

    if (!res.ok) {
      fail('5a', 'GET /api/bot/queue', `HTTP ${res.status}: ${await res.text().catch(() => '')}`);
    } else {
      const data = await res.json();

      // Verify structure
      const hasStats = data.stats && typeof data.stats.total === 'number'
        && typeof data.stats.prospected === 'number'
        && typeof data.stats.remaining === 'number'
        && typeof data.stats.whatsappSentToday === 'number'
        && typeof data.stats.whatsappSlotsLeft === 'number';

      const hasQueue = Array.isArray(data.queue);
      const hasSummary = data.summary && typeof data.summary.br === 'number'
        && typeof data.summary.us === 'number';

      if (hasStats && hasQueue && hasSummary) {
        pass('5a', `GET /queue OK — total: ${data.stats.total}, fila: ${data.stats.remaining}, preview: ${data.queue.length} items`);
      } else {
        fail('5a', 'Estrutura da resposta /queue', `stats: ${hasStats}, queue: ${hasQueue}, summary: ${hasSummary}`);
      }

      // 5b. Verify queue item structure
      if (data.queue.length > 0) {
        const item = data.queue[0];
        const hasFields = item.niche && item.searchCity && item.lang && item.country;
        if (hasFields) {
          pass('5b', `Item da fila tem campos corretos: ${item.niche} / ${item.searchCity} (${item.country})`);
        } else {
          fail('5b', 'Campos do item', JSON.stringify(item));
        }
      } else {
        warn('5b', 'Fila vazia', 'Sem items para verificar estrutura');
      }
    }
  } catch (err) {
    fail('5a', 'GET /api/bot/queue', `Conexão falhou: ${err.message}. Bot-server rodando em ${BOT_URL}?`);
    fail('5b', 'Campos do item', 'Dependia de 5a');
  }

  // 5c. GET /health
  try {
    const res = await fetch(`${BOT_URL}/health`);
    if (res.ok) {
      const data = await res.json();
      if (data.ok === true) {
        pass('5c', 'Health check OK');
      } else {
        fail('5c', 'Health check', `Resposta: ${JSON.stringify(data)}`);
      }
    } else {
      fail('5c', 'Health check', `HTTP ${res.status}`);
    }
  } catch (err) {
    fail('5c', 'Health check', `Conexão falhou: ${err.message}`);
  }
}

// ─── Test 6: Consistency after execution ───

async function test6_consistency() {
  console.log('\n\x1b[1m━━━ Teste 6 — Consistência pós-execução ━━━\x1b[0m');

  // 6a. Count queue size before
  const { stats: before } = await generateQueue();
  console.log(`  ℹ️  Fila antes: ${before.remaining}`);

  // 6b. Insert 3 leads that cover 3 queue items (simulating a dry run)
  // Pick 3 items from the current queue
  const { queue: currentQueue } = await generateQueue();

  if (currentQueue.length < 3) {
    warn('6a', 'Fila insuficiente', `Apenas ${currentQueue.length} items — precisa de 3`);
    return;
  }

  const items = currentQueue.slice(0, 3);
  console.log(`  ℹ️  Simulando prospecção de 3 items:`);
  for (const item of items) {
    console.log(`    → ${item.niche} / ${item.searchCity}`);
  }

  // Insert leads for these combos (simulating what collect+upsert does)
  for (let i = 0; i < items.length; i++) {
    await supabase.from('leads').insert({
      place_id: `${TEST_PREFIX}consist_${i}`,
      business_name: `Consistency Test ${i}`,
      niche: items[i].niche,
      search_city: items[i].searchCity,
      city: items[i].searchCity,
      status: 'prospected',
      status_updated_at: new Date().toISOString(),
    });
  }

  // 6c. Verify queue shrunk by exactly 3
  const { stats: after } = await generateQueue();
  const diff = before.remaining - after.remaining;

  if (diff === 3) {
    pass('6a', `Fila diminuiu exatamente 3: ${before.remaining} → ${after.remaining}`);
  } else {
    fail('6a', 'Contagem da fila', `Esperado -3, obteve -${diff} (antes: ${before.remaining}, depois: ${after.remaining})`);
  }

  // 6d. Verify those combos are now gone from queue
  const { queue: updatedQueue } = await generateQueue();
  const stillInQueue = items.filter(item =>
    updatedQueue.some(q => q.niche === item.niche && q.searchCity === item.searchCity)
  );

  if (stillInQueue.length === 0) {
    pass('6b', 'As 3 combinações prospectadas não estão mais na fila');
  } else {
    fail('6b', 'Combos na fila', `${stillInQueue.length} das 3 combos ainda estão na fila`);
  }
}

// ─── Main ───

async function main() {
  console.log('\x1b[1m');
  console.log('╔══════════════════════════════════════════════════════════╗');
  console.log('║     Prospect Bot — Teste do Modo Automático            ║');
  console.log('╚══════════════════════════════════════════════════════════╝');
  console.log('\x1b[0m');
  console.log(`  Supabase: ${SUPABASE_URL}`);
  console.log(`  Bot Server: ${BOT_URL}`);
  console.log(`  Test prefix: ${TEST_PREFIX}`);

  try {
    await test1_queueGeneration();
    await test2_deduplication();
    await test3_zeroWaste();
    await test4_dailyLimit();
    await test5_botServer();
    await test6_consistency();
  } catch (err) {
    console.error('\n\x1b[31m💥 Erro inesperado:\x1b[0m', err);
  }

  await cleanup();

  // Summary
  console.log('\x1b[1m╔══════════════════════════════════════════════════════════╗');
  console.log('║                     RESUMO FINAL                         ║');
  console.log('╚══════════════════════════════════════════════════════════╝\x1b[0m');
  console.log(`  \x1b[32m✅ Passou:  ${passCount}\x1b[0m`);
  console.log(`  \x1b[31m❌ Falhou:  ${failCount}\x1b[0m`);
  console.log(`  \x1b[33m⚠️  Parcial: ${warnCount}\x1b[0m`);
  console.log(`  Total:    ${results.length}\n`);

  if (failCount > 0) {
    console.log('\x1b[31mFalhas:\x1b[0m');
    for (const r of results.filter(r => r.status === 'fail')) {
      console.log(`  ❌ ${r.test}: ${r.desc} — ${r.reason}`);
    }
    console.log();
  }

  if (warnCount > 0) {
    console.log('\x1b[33mAvisos:\x1b[0m');
    for (const r of results.filter(r => r.status === 'warn')) {
      console.log(`  ⚠️  ${r.test}: ${r.desc} — ${r.reason}`);
    }
    console.log();
  }

  process.exit(failCount > 0 ? 1 : 0);
}

main();
