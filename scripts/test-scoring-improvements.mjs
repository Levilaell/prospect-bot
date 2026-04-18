// Sanity harness for the score/message refactor — run: node scripts/test-scoring-improvements.mjs
// Not a real test suite; prints before/after values so we can eyeball the shape.

import { score, opportunityScore } from '../steps/score.js';

// ── cleanBusinessName + findStrongVisualNote + pickMainReason live inside message.js
// and aren't exported. We re-derive cleanBusinessName here to test it in isolation.
function cleanBusinessName(name) {
  let s = name.split(/[|–—·]|  +/)[0].trim();
  s = s
    .replace(/\s+em\s+[A-ZÀ-ÿ][\wÀ-ÿ\s]*?(?:\/[A-Za-z]{2})?\s*$/i, '')
    .replace(/\s+-\s+[A-ZÀ-ÿ][\wÀ-ÿ\s]*?(?:\/[A-Za-z]{2})?\s*$/i, '')
    .replace(/\s*,\s*[A-ZÀ-ÿ][\wÀ-ÿ\s]*?\/[A-Za-z]{2}\s*$/i, '')
    .replace(/\s+[A-ZÀ-ÿ][\wÀ-ÿ]*\/[A-Za-z]{2}\s*$/, '')
    .trim();
  return s;
}

console.log('━'.repeat(60));
console.log('1. cleanBusinessName');
console.log('━'.repeat(60));

const cbTests = [
  // [input, expected]
  ['Fisest Estética Facial e Corporal em Campinas/SP', 'Fisest Estética Facial e Corporal'],
  ['Barbearia Razor | Jardim São Vicente', 'Barbearia Razor'],
  ['Hugle Education – Escola de Inglês e Espanhol Online ao vivo e presencial de Taubaté – SP', 'Hugle Education'],
  // Idempotency check — already cleaned name stays put
  ['Fisest Estética Facial e Corporal', 'Fisest Estética Facial e Corporal'],
  // Additional geo variants
  ['Salão Beleza - São Paulo', 'Salão Beleza'],
  ['Clínica Dente, Campinas/SP', 'Clínica Dente'],
  ['Oficina Carro Campinas/SP', 'Oficina Carro'], // single-word suffix stripped
];

for (const [input, expected] of cbTests) {
  const got = cleanBusinessName(input);
  const pass = got === expected ? '✓' : '✗';
  console.log(`${pass} "${input}"`);
  console.log(`  expected: "${expected}"`);
  console.log(`  got:      "${got}"`);
  // Idempotency: run twice
  const twice = cleanBusinessName(got);
  if (twice !== got) {
    console.log(`  ⚠️  NOT idempotent — second pass: "${twice}"`);
  }
}

console.log();
console.log('━'.repeat(60));
console.log('2. opportunityScore');
console.log('━'.repeat(60));

const opTests = [
  { review_count: 500, rating: 4.9 },
  { review_count: 302, rating: 4.9 },
  { review_count: 200, rating: 4.3 },
  { review_count: 80, rating: 4.2 },
  { review_count: 10, rating: 4.2 },
  { review_count: null, rating: null },
];
for (const lead of opTests) {
  const r = opportunityScore(lead);
  console.log(`  rc=${lead.review_count} rating=${lead.rating} → ${JSON.stringify(r)}`);
}

console.log();
console.log('━'.repeat(60));
console.log('3. scoreLead — three fictional leads');
console.log('━'.repeat(60));

const leadA = {
  place_id: 'A',
  business_name: 'Top Clínica Campinas/SP',
  review_count: 500,
  rating: 4.9,
  has_form: false,
  has_ssl: false,
  mobile_score: 45,
  visual_score: 5,
  has_booking: true,
  has_whatsapp: true,
  is_mobile_friendly: true,
  tech_stack: 'custom',
  scrape_failed: false,
};

const leadB = {
  place_id: 'B',
  business_name: 'No-name Shop',
  review_count: 10,
  rating: 4.2,
  has_form: false,
  has_ssl: false,
  mobile_score: 20,
  visual_score: 3,
  has_booking: false,
  has_whatsapp: false,
  is_mobile_friendly: false,
  tech_stack: 'wix',
  scrape_failed: false,
};

const leadC = {
  place_id: 'C',
  business_name: 'Perfect Site',
  review_count: null,
  rating: null,
  has_form: true,
  has_ssl: true,
  mobile_score: 95,
  visual_score: 9,
  has_booking: true,
  has_whatsapp: true,
  is_mobile_friendly: true,
  tech_stack: 'next.js',
  scrape_failed: false,
};

const scored = score([leadA, leadB, leadC], { country: 'BR' });
for (const s of scored) {
  console.log(`  ${s.place_id} "${s.business_name}"`);
  console.log(`    pain_score=${s.pain_score}  reasons=${JSON.stringify(s.score_reasons)}`);
  console.log(`    opportunity_score=${s.opportunity_score}  opp_reasons=${JSON.stringify(s.opportunity_reasons)}`);
}

console.log();
console.log('  Sort check → first lead should have highest opportunity_score, ties broken by pain:');
console.log('  Order:', scored.map(s => `${s.place_id}(op=${s.opportunity_score},pain=${s.pain_score})`).join(' → '));

console.log();
console.log('━'.repeat(60));
console.log('4. Quick US vs BR weight diff (same lead)');
console.log('━'.repeat(60));

const leadNoBooking = {
  place_id: 'D',
  business_name: 'Test No-Booking',
  review_count: 100,
  rating: 4.5,
  has_form: true,
  has_ssl: true,
  mobile_score: 80,
  visual_score: 8,
  has_booking: false,
  has_whatsapp: true,
  is_mobile_friendly: true,
  scrape_failed: false,
};
const br = score([leadNoBooking], { country: 'BR' })[0];
const us = score([leadNoBooking], { country: 'US' })[0];
console.log(`  BR: pain=${br.pain_score}  reasons=${JSON.stringify(br.score_reasons)}`);
console.log(`  US: pain=${us.pain_score}  reasons=${JSON.stringify(us.score_reasons)}`);
