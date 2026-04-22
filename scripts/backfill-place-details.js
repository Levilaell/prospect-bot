// Backfill Google Places Details (hours, reviews, photos_urls) for an existing lead.
// Usa a mesma função fetchDetails do collect.js pra garantir consistência.
//
// Uso:
//   node scripts/backfill-place-details.js <place_id>
//
// Ex:
//   node scripts/backfill-place-details.js ChIJaYQriOZDzpQRfDaa4ROGG2k

import 'dotenv/config'
import { createClient } from '@supabase/supabase-js'

const PLACE_DETAILS_URL = 'https://maps.googleapis.com/maps/api/place/details/json'

// Réplica da fetchDetails do collect.js (mantém simetria)
async function fetchDetails(placeId, apiKey) {
  const params = new URLSearchParams({
    place_id: placeId,
    fields:   'opening_hours,reviews,photos,formatted_address',
    key:      apiKey,
  })
  const res = await fetch(`${PLACE_DETAILS_URL}?${params}`)
  if (!res.ok) throw new Error(`Place Details HTTP ${res.status}`)
  const data = await res.json()
  if (data.status !== 'OK') {
    throw new Error(`Place Details error: ${data.status}`)
  }
  const result = data.result ?? {}
  const oh = result.opening_hours
  const hours = oh ? {
    weekday_text: Array.isArray(oh.weekday_text) ? oh.weekday_text : [],
    open_now:     Boolean(oh.open_now),
  } : null
  // Filtrar reviews curtas (<80 chars) antes do slice — reviews tipo "Top!" ou
  // "Muito bom" não agregam valor no site e poluem a seção Depoimentos.
  const reviewsFiltered = Array.isArray(result.reviews)
    ? result.reviews.filter((r) => r.text && r.text.trim().length >= 80)
    : []
  const reviews = reviewsFiltered.length > 0
    ? reviewsFiltered.slice(0, 3).map((r) => ({
        author_name:               r.author_name ?? '',
        rating:                    typeof r.rating === 'number' ? r.rating : 0,
        text:                      r.text ?? '',
        relative_time_description: r.relative_time_description ?? '',
        time:                      typeof r.time === 'number' ? r.time : 0,
      }))
    : null
  const photos_urls = Array.isArray(result.photos) && result.photos.length > 0
    ? result.photos
        .slice(0, 5)
        .map((p) => p.photo_reference
          ? `https://maps.googleapis.com/maps/api/place/photo?maxwidth=1600&photo_reference=${p.photo_reference}&key=${apiKey}`
          : null)
        .filter(Boolean)
    : null
  return { hours, reviews, photos_urls }
}

async function main() {
  const placeId = process.argv[2]
  if (!placeId) {
    console.error('Uso: node scripts/backfill-place-details.js <place_id>')
    process.exit(1)
  }

  const apiKey = process.env.GOOGLE_MAPS_API_KEY
  if (!apiKey) {
    console.error('GOOGLE_MAPS_API_KEY não configurada')
    process.exit(1)
  }

  const supabaseUrl = process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL
  const supabaseKey = process.env.SUPABASE_SERVICE_KEY ?? process.env.SUPABASE_SERVICE_ROLE_KEY

  if (!supabaseUrl || !supabaseKey) {
    console.error('SUPABASE_URL + SUPABASE_SERVICE_KEY são obrigatórios')
    process.exit(1)
  }

  const supabase = createClient(supabaseUrl, supabaseKey)

  console.log(`Fetching Place Details for ${placeId}...`)
  const details = await fetchDetails(placeId, apiKey)

  console.log('\nPlace Details retornados:')
  console.log('  hours:        ', details.hours ? `${details.hours.weekday_text.length} dias` : 'null')
  console.log('  reviews:      ', details.reviews ? `${details.reviews.length} items` : 'null')
  console.log('  photos_urls:  ', details.photos_urls ? `${details.photos_urls.length} URLs` : 'null')

  console.log('\nAtualizando Supabase...')
  const { data, error } = await supabase
    .from('leads')
    .update({
      hours:       details.hours,
      reviews:     details.reviews,
      photos_urls: details.photos_urls,
    })
    .eq('place_id', placeId)
    .select('place_id, business_name')

  if (error) {
    console.error('Erro no update:', error.message)
    process.exit(1)
  }
  if (!data || data.length === 0) {
    console.error(`Lead ${placeId} não encontrado no banco`)
    process.exit(1)
  }

  console.log(`\n✓ Atualizado: ${data[0].business_name}`)
}

main().catch((err) => {
  console.error('Erro:', err.message)
  process.exit(1)
})
