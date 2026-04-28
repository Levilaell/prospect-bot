#!/usr/bin/env node
/* Synthetic-input test for steps/qualify.js using the BR-WA-PREVIEW filters.
 * Exercises every gate (rating, recency, franchise blacklist) without
 * touching Google Places or Supabase. Cheap to run any time you tweak the
 * filters in admin/lib/bot-config.ts.
 *
 * Usage:
 *   node scripts/test-qualify-br-wa-preview.js
 */

import { qualify } from '../steps/qualify.js';

// Mirror admin/lib/bot-config.ts → BR-WA-PREVIEW.qualificationFilters.
// If you change the filters there, mirror them here so the test stays honest.
const filters = {
  minRating: 3.5,
  recentReviewMonths: 12,
  requireOperational: true,
  franchiseBlacklist: [
    'Onodera',
    'Jacques Janine',
    'Body Lab',
    'Body Tech',
    'Dr. Hair',
    "L'Officiel",
    'Espaço Laser',
    'Espaçolaser',
    'Vialaser',
    'Pello Menos',
    'Spazio Laser',
    'Belezix',
    'Beleza Natural',
  ],
};

// Fixture timestamps in seconds. "fresh" = 2 months ago, "stale" = 18 months.
const NOW_SEC = Math.floor(Date.now() / 1000);
const REVIEW_FRESH = NOW_SEC - 2 * 30 * 86_400;
const REVIEW_STALE = NOW_SEC - 18 * 30 * 86_400;

const leads = [
  // ── Should PASS ────────────────────────────────────────────────────────
  {
    place_id: 'pass-1',
    business_name: 'Espaço Bella Pele',
    rating: 4.6,
    review_count: 120,
    _reviews_full: [{ time: REVIEW_FRESH }],
  },
  {
    place_id: 'pass-2',
    business_name: 'Clínica de Estética Renove',
    rating: 4.2,
    review_count: 45,
    _reviews_full: [{ time: NOW_SEC - 90 * 86_400 }, { time: NOW_SEC - 365 * 86_400 }],
  },

  // ── Should FAIL: low_rating ───────────────────────────────────────────
  {
    place_id: 'fail-rating-1',
    business_name: 'Estética Mediocre',
    rating: 3.2,
    review_count: 20,
    _reviews_full: [{ time: REVIEW_FRESH }],
  },
  {
    place_id: 'fail-rating-2-null',
    business_name: 'Sem Reviews Estética',
    rating: null,
    review_count: 0,
    _reviews_full: [],
  },

  // ── Should FAIL: outdated_reviews ─────────────────────────────────────
  {
    place_id: 'fail-recency-1',
    business_name: 'Clínica Abandonada',
    rating: 4.8,
    review_count: 200,
    _reviews_full: [{ time: REVIEW_STALE }],
  },
  {
    place_id: 'fail-recency-2-no-time',
    business_name: 'Clínica Sem Time',
    rating: 4.0,
    review_count: 10,
    _reviews_full: [{ time: 0 }], // missing/invalid time → treated as too old
  },

  // ── Should FAIL: franchise_blacklist (substring + accent-folded) ──────
  {
    place_id: 'fail-franchise-1',
    business_name: 'Espaço Onodera Jardim Paulista',
    rating: 4.7,
    review_count: 800,
    _reviews_full: [{ time: REVIEW_FRESH }],
  },
  {
    place_id: 'fail-franchise-2',
    business_name: 'Espaçolaser Ribeirão Preto Shopping',
    rating: 4.5,
    review_count: 500,
    _reviews_full: [{ time: REVIEW_FRESH }],
  },
  {
    place_id: 'fail-franchise-3',
    business_name: 'Salão Jacques Janine - Higienópolis',
    rating: 4.3,
    review_count: 300,
    _reviews_full: [{ time: REVIEW_FRESH }],
  },
  {
    place_id: 'fail-franchise-4-accent',
    business_name: "L'Officiel Estilo Salão de Beleza",
    rating: 4.4,
    review_count: 90,
    _reviews_full: [{ time: REVIEW_FRESH }],
  },

  // ── Edge: rating 3.5 exactly (boundary) — should PASS ─────────────────
  {
    place_id: 'edge-rating-equal',
    business_name: 'Estética Limítrofe',
    rating: 3.5,
    review_count: 25,
    _reviews_full: [{ time: REVIEW_FRESH }],
  },
];

// ── Run ──────────────────────────────────────────────────────────────────
const { qualified, rejected } = qualify(leads, filters);

console.log('━'.repeat(60));
console.log('QUALIFY GATE TEST — BR-WA-PREVIEW');
console.log('━'.repeat(60));
console.log(`Filters: minRating=${filters.minRating}, recentReviewMonths=${filters.recentReviewMonths}, blacklist=${filters.franchiseBlacklist.length} names`);
console.log(`Input:    ${leads.length} leads`);
console.log(`Passed:   ${qualified.length}`);
console.log(`Rejected: ${rejected.length}`);
console.log();

console.log('— PASSED —');
for (const l of qualified) {
  console.log(`  ✅  ${l.place_id.padEnd(28)} ${l.business_name}  (rating=${l.rating})`);
}
console.log();

console.log('— REJECTED —');
const breakdown = {};
for (const l of rejected) {
  const reason = (l.score_reasons && l.score_reasons[0]) || 'unknown';
  breakdown[reason] = (breakdown[reason] || 0) + 1;
  console.log(`  ❌  ${l.place_id.padEnd(28)} ${l.business_name}`);
  console.log(`        reason: ${reason}  (rating=${l.rating ?? 'null'})`);
}

console.log();
console.log('— BREAKDOWN —');
for (const [k, v] of Object.entries(breakdown)) {
  console.log(`  ${k.padEnd(24)} ${v}`);
}

console.log();

// ── Assert expected outcomes ─────────────────────────────────────────────
const expected = {
  pass: ['pass-1', 'pass-2', 'edge-rating-equal'],
  fail_low_rating: ['fail-rating-1', 'fail-rating-2-null'],
  fail_outdated_reviews: ['fail-recency-1', 'fail-recency-2-no-time'],
  fail_franchise: [
    'fail-franchise-1',
    'fail-franchise-2',
    'fail-franchise-3',
    'fail-franchise-4-accent',
  ],
};

const actualPass = new Set(qualified.map(l => l.place_id));
const reasonOf = new Map(rejected.map(l => [l.place_id, (l.score_reasons || [])[0]]));

let failures = 0;
for (const id of expected.pass) {
  if (!actualPass.has(id)) {
    console.error(`✗  expected ${id} to pass, got rejected (reason=${reasonOf.get(id)})`);
    failures++;
  }
}
for (const id of expected.fail_low_rating) {
  if (reasonOf.get(id) !== 'low_rating') {
    console.error(`✗  expected ${id} reason=low_rating, got ${reasonOf.get(id) ?? 'PASS'}`);
    failures++;
  }
}
for (const id of expected.fail_outdated_reviews) {
  if (reasonOf.get(id) !== 'outdated_reviews') {
    console.error(`✗  expected ${id} reason=outdated_reviews, got ${reasonOf.get(id) ?? 'PASS'}`);
    failures++;
  }
}
for (const id of expected.fail_franchise) {
  if (reasonOf.get(id) !== 'franchise_blacklist') {
    console.error(`✗  expected ${id} reason=franchise_blacklist, got ${reasonOf.get(id) ?? 'PASS'}`);
    failures++;
  }
}

if (failures === 0) {
  console.log('━'.repeat(60));
  console.log('  ✅  ALL ASSERTIONS PASSED');
  console.log('━'.repeat(60));
  process.exit(0);
} else {
  console.log('━'.repeat(60));
  console.log(`  ❌  ${failures} ASSERTION FAILURE(S)`);
  console.log('━'.repeat(60));
  process.exit(1);
}
