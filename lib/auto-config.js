// Static configuration for autonomous prospecting mode
// Niches, cities (by population), and regions for large cities

export const AUTO_CONFIG = {

  // ── Niches ────────────────────────────────────────────────────────────────

  niches: {
    BR: [
      'clínicas odontológicas',
      'academias',
      'salões de beleza',
      'barbearias',
      'clínicas de estética',
      'pet shops',
      'restaurantes',
      'pizzarias',
      'oficinas mecânicas',
      'clínicas veterinárias',
      'escolas de idiomas',
      'estúdios de pilates',
      'lojas de roupas',
      'imobiliárias',
      'escritórios de contabilidade',
      'clínicas de psicologia',
      'estúdios de tatuagem',
      'floriculturas',
      'padarias e confeitarias',
      'autoescolas',
    ],
    US: [
      'dental clinics',
      'gyms',
      'hair salons',
      'barbershops',
      'med spas',
      'pet grooming',
      'restaurants',
      'pizza shops',
      'auto repair shops',
      'veterinary clinics',
      'yoga studios',
      'pilates studios',
      'boutiques',
      'real estate agencies',
      'accounting firms',
      'therapy practices',
      'tattoo shops',
      'florists',
      'bakeries',
      'driving schools',
      'chiropractors',
      'plumbers',
      'landscaping companies',
      'cleaning services',
      'photography studios',
    ],
  },

  // ── Cities ────────────────────────────────────────────────────────────────
  // Ordered by population (largest first).
  // Cities with pop > 2M get regions to overcome Google Places 60-result limit.

  cities: {
    BR: [
      {
        name: 'São Paulo, SP',
        population: 12_300_000,
        regions: [
          'Centro de São Paulo, SP',
          'Pinheiros, São Paulo, SP',
          'Vila Mariana, São Paulo, SP',
          'Moema, São Paulo, SP',
          'Itaim Bibi, São Paulo, SP',
          'Jardins, São Paulo, SP',
          'Santana, São Paulo, SP',
          'Tatuapé, São Paulo, SP',
          'Santo Amaro, São Paulo, SP',
          'Lapa, São Paulo, SP',
          'Perdizes, São Paulo, SP',
          'Brooklin, São Paulo, SP',
          'Vila Madalena, São Paulo, SP',
          'Campo Belo, São Paulo, SP',
          'Saúde, São Paulo, SP',
        ],
      },
      {
        name: 'Rio de Janeiro, RJ',
        population: 6_700_000,
        regions: [
          'Copacabana, Rio de Janeiro, RJ',
          'Ipanema, Rio de Janeiro, RJ',
          'Botafogo, Rio de Janeiro, RJ',
          'Tijuca, Rio de Janeiro, RJ',
          'Barra da Tijuca, Rio de Janeiro, RJ',
          'Leblon, Rio de Janeiro, RJ',
          'Centro do Rio de Janeiro, RJ',
          'Flamengo, Rio de Janeiro, RJ',
          'Méier, Rio de Janeiro, RJ',
          'Recreio dos Bandeirantes, Rio de Janeiro, RJ',
        ],
      },
      {
        name: 'Brasília, DF',
        population: 3_000_000,
        regions: [
          'Asa Sul, Brasília, DF',
          'Asa Norte, Brasília, DF',
          'Lago Sul, Brasília, DF',
          'Lago Norte, Brasília, DF',
          'Águas Claras, Brasília, DF',
          'Taguatinga, Brasília, DF',
          'Sudoeste, Brasília, DF',
        ],
      },
      {
        name: 'Salvador, BA',
        population: 2_900_000,
        regions: [
          'Pituba, Salvador, BA',
          'Barra, Salvador, BA',
          'Itaigara, Salvador, BA',
          'Rio Vermelho, Salvador, BA',
          'Caminho das Árvores, Salvador, BA',
          'Paralela, Salvador, BA',
        ],
      },
      {
        name: 'Fortaleza, CE',
        population: 2_700_000,
        regions: [
          'Aldeota, Fortaleza, CE',
          'Meireles, Fortaleza, CE',
          'Centro de Fortaleza, CE',
          'Fátima, Fortaleza, CE',
          'Papicu, Fortaleza, CE',
          'Cocó, Fortaleza, CE',
        ],
      },
      {
        name: 'Belo Horizonte, MG',
        population: 2_500_000,
        regions: [
          'Savassi, Belo Horizonte, MG',
          'Funcionários, Belo Horizonte, MG',
          'Lourdes, Belo Horizonte, MG',
          'Centro de Belo Horizonte, MG',
          'Pampulha, Belo Horizonte, MG',
          'Buritis, Belo Horizonte, MG',
        ],
      },
      { name: 'Manaus, AM', population: 2_200_000, regions: [] },
      {
        name: 'Curitiba, PR',
        population: 1_960_000,
        regions: [],
      },
      { name: 'Recife, PE', population: 1_650_000, regions: [] },
      { name: 'Goiânia, GO', population: 1_550_000, regions: [] },
      { name: 'Belém, PA', population: 1_500_000, regions: [] },
      { name: 'Porto Alegre, RS', population: 1_490_000, regions: [] },
      { name: 'Guarulhos, SP', population: 1_390_000, regions: [] },
      { name: 'Campinas, SP', population: 1_220_000, regions: [] },
      { name: 'São Luís, MA', population: 1_110_000, regions: [] },
      { name: 'Maceió, AL', population: 1_020_000, regions: [] },
      { name: 'Campo Grande, MS', population: 910_000, regions: [] },
      { name: 'São Bernardo do Campo, SP', population: 840_000, regions: [] },
      { name: 'Natal, RN', population: 890_000, regions: [] },
      { name: 'Osasco, SP', population: 700_000, regions: [] },
      { name: 'João Pessoa, PB', population: 820_000, regions: [] },
      { name: 'Ribeirão Preto, SP', population: 710_000, regions: [] },
      { name: 'Uberlândia, MG', population: 700_000, regions: [] },
      { name: 'Sorocaba, SP', population: 690_000, regions: [] },
      { name: 'Florianópolis, SC', population: 510_000, regions: [] },
      { name: 'Vitória, ES', population: 370_000, regions: [] },
    ],

    US: [
      {
        name: 'New York, NY',
        population: 8_300_000,
        regions: [
          'Manhattan, NY',
          'Brooklyn, NY',
          'Queens, NY',
          'Bronx, NY',
          'Staten Island, NY',
          'Upper East Side, Manhattan, NY',
          'Upper West Side, Manhattan, NY',
          'Midtown, Manhattan, NY',
          'SoHo, Manhattan, NY',
          'Williamsburg, Brooklyn, NY',
        ],
      },
      {
        name: 'Los Angeles, CA',
        population: 3_900_000,
        regions: [
          'Hollywood, Los Angeles, CA',
          'Santa Monica, CA',
          'Beverly Hills, CA',
          'Downtown Los Angeles, CA',
          'Pasadena, CA',
          'Burbank, CA',
          'West Hollywood, CA',
          'Venice, Los Angeles, CA',
        ],
      },
      {
        name: 'Chicago, IL',
        population: 2_700_000,
        regions: [
          'Downtown Chicago, IL',
          'Lincoln Park, Chicago, IL',
          'Wicker Park, Chicago, IL',
          'River North, Chicago, IL',
          'Lakeview, Chicago, IL',
          'Logan Square, Chicago, IL',
        ],
      },
      {
        name: 'Houston, TX',
        population: 2_300_000,
        regions: [
          'Downtown Houston, TX',
          'Midtown, Houston, TX',
          'The Heights, Houston, TX',
          'Montrose, Houston, TX',
          'Galleria, Houston, TX',
          'Sugar Land, TX',
        ],
      },
      { name: 'Phoenix, AZ', population: 1_600_000, regions: [] },
      { name: 'Philadelphia, PA', population: 1_600_000, regions: [] },
      { name: 'San Antonio, TX', population: 1_500_000, regions: [] },
      { name: 'San Diego, CA', population: 1_400_000, regions: [] },
      { name: 'Dallas, TX', population: 1_300_000, regions: [] },
      { name: 'Austin, TX', population: 1_000_000, regions: [] },
      { name: 'Jacksonville, FL', population: 950_000, regions: [] },
      { name: 'San Jose, CA', population: 1_000_000, regions: [] },
      { name: 'Fort Worth, TX', population: 950_000, regions: [] },
      { name: 'Columbus, OH', population: 900_000, regions: [] },
      { name: 'Charlotte, NC', population: 880_000, regions: [] },
      { name: 'Indianapolis, IN', population: 880_000, regions: [] },
      { name: 'San Francisco, CA', population: 870_000, regions: [] },
      { name: 'Seattle, WA', population: 740_000, regions: [] },
      { name: 'Denver, CO', population: 710_000, regions: [] },
      { name: 'Nashville, TN', population: 690_000, regions: [] },
      { name: 'Oklahoma City, OK', population: 680_000, regions: [] },
      { name: 'Washington, DC', population: 670_000, regions: [] },
      { name: 'El Paso, TX', population: 680_000, regions: [] },
      { name: 'Las Vegas, NV', population: 640_000, regions: [] },
      { name: 'Portland, OR', population: 640_000, regions: [] },
      { name: 'Detroit, MI', population: 640_000, regions: [] },
      { name: 'Memphis, TN', population: 630_000, regions: [] },
      { name: 'Louisville, KY', population: 620_000, regions: [] },
      { name: 'Baltimore, MD', population: 600_000, regions: [] },
      { name: 'Milwaukee, WI', population: 570_000, regions: [] },
      { name: 'Albuquerque, NM', population: 560_000, regions: [] },
      { name: 'Tucson, AZ', population: 540_000, regions: [] },
      { name: 'Fresno, CA', population: 540_000, regions: [] },
      { name: 'Sacramento, CA', population: 520_000, regions: [] },
      { name: 'Mesa, AZ', population: 500_000, regions: [] },
      { name: 'Atlanta, GA', population: 500_000, regions: [] },
      { name: 'Omaha, NE', population: 490_000, regions: [] },
      { name: 'Raleigh, NC', population: 470_000, regions: [] },
      { name: 'Miami, FL', population: 440_000, regions: [] },
      { name: 'Tampa, FL', population: 400_000, regions: [] },
      { name: 'Orlando, FL', population: 310_000, regions: [] },
    ],
  },
};

// ── Helpers ───────────────────────────────────────────────────────────────

/**
 * Returns the country code ('BR' or 'US') for a given city string.
 * Matches against config city names and regions.
 */
export function detectCountry(searchCity) {
  for (const [country, cities] of Object.entries(AUTO_CONFIG.cities)) {
    for (const c of cities) {
      if (c.name === searchCity) return country;
      if (c.regions.includes(searchCity)) return country;
    }
  }
  return null;
}

/**
 * Detects language from a search city string.
 * BR cities → 'pt', US cities → 'en'
 */
export function detectLang(searchCity) {
  const country = detectCountry(searchCity);
  return country === 'BR' ? 'pt' : 'en';
}

/**
 * Expands a city config into search targets.
 * Large cities with regions → one target per region.
 * Small cities → one target using the city name directly.
 */
export function expandCityTargets(cityConfig) {
  if (cityConfig.regions && cityConfig.regions.length > 0) {
    return cityConfig.regions;
  }
  return [cityConfig.name];
}

/**
 * Returns all (niche, searchCity, lang) combos from config.
 */
export function getAllTargets() {
  const targets = [];

  for (const [country, cities] of Object.entries(AUTO_CONFIG.cities)) {
    const lang = country === 'BR' ? 'pt' : 'en';
    const niches = AUTO_CONFIG.niches[country];

    for (const cityConfig of cities) {
      const searchTargets = expandCityTargets(cityConfig);
      for (const searchCity of searchTargets) {
        for (const niche of niches) {
          targets.push({ niche, searchCity, lang, country, cityName: cityConfig.name });
        }
      }
    }
  }

  return targets;
}
