// BR cities ordered by OPPORTUNITY PRIORITY (not population)
// Priority 1: Interior SP — high income, digitally behind, less agency competition
// Priority 2: Interior Sul (PR, SC, RS) — strong entrepreneurial culture, good income
// Priority 3: Interior MG, GO, MT, MS, ES — fast-growing mid-sized cities
// Priority 4: Interior NE/N — high volume, lower ticket expected
// Priority 5: Medium capitals — real market but more competitive
// Priority 6: Large capitals — last (most competitive, most saturated)
//
// EXCLUDED: São José do Rio Preto, SP (operator's city)
// Niches ordered by: ticket size + pain clarity + WhatsApp adoption

export const AUTO_CONFIG = {

  niches: {
    BR: [
      // Alta prioridade — ticket alto + dor clara + WhatsApp comum
      'clínicas odontológicas',
      'clínicas de estética',
      'clínicas veterinárias',
      'clínicas de psicologia',
      'imobiliárias',
      'escritórios de contabilidade',
      // Média prioridade — volume alto + dor moderada
      'academias',
      'estúdios de pilates',
      'salões de beleza',
      'barbearias',
      'pet shops',
      'autoescolas',
      'escolas de idiomas',
      'clínicas médicas',
      'fisioterapeutas',
      'nutricionistas',
      // Baixa prioridade — ticket menor ou alta concorrência
      'restaurantes',
      'padarias e confeitarias',
      'lojas de roupas',
      'floriculturas',
    ],
    US: [
      'dental clinics',
      'med spas',
      'veterinary clinics',
      'therapy practices',
      'real estate agencies',
      'accounting firms',
      'gyms',
      'pilates studios',
      'hair salons',
      'barbershops',
      'pet grooming',
      'driving schools',
      'yoga studios',
      'chiropractors',
      'physical therapists',
      'nutritionists',
      'auto repair shops',
      'cleaning services',
      'photography studios',
      'personal trainers',
      'law firms',
      'insurance agencies',
      'daycares',
      'HVAC companies',
      'electricians',
      'plumbers',
      'landscaping companies',
      'roofing contractors',
      'wedding venues',
      'tattoo shops',
    ],
  },

  cities: {
    BR: [

      // ─────────────────────────────────────────────────────────────
      // PRIORIDADE 1 — Interior SP
      // ─────────────────────────────────────────────────────────────
      { name: 'Campinas, SP', population: 1_220_000, regions: [
        'Centro de Campinas, SP',
        'Cambuí, Campinas, SP',
        'Taquaral, Campinas, SP',
        'Barão Geraldo, Campinas, SP',
        'Jardim Proença, Campinas, SP',
      ]},
      { name: 'Santo André, SP', population: 720_000, regions: [
        'Centro de Santo André, SP',
        'Vila Assunção, Santo André, SP',
        'Jardim, Santo André, SP',
      ]},
      { name: 'Ribeirão Preto, SP', population: 710_000, regions: [
        'Centro de Ribeirão Preto, SP',
        'Jardim Sumaré, Ribeirão Preto, SP',
        'Alto da Boa Vista, Ribeirão Preto, SP',
        'Vila Seixas, Ribeirão Preto, SP',
      ]},
      { name: 'Osasco, SP', population: 700_000, regions: [] },
      { name: 'Sorocaba, SP', population: 690_000, regions: [
        'Centro de Sorocaba, SP',
        'Campolim, Sorocaba, SP',
        'Jardim Emília, Sorocaba, SP',
      ]},
      { name: 'São Bernardo do Campo, SP', population: 840_000, regions: [
        'Centro de São Bernardo do Campo, SP',
        'Rudge Ramos, São Bernardo do Campo, SP',
        'Nova Petrópolis, São Bernardo do Campo, SP',
      ]},
      { name: 'São José dos Campos, SP', population: 730_000, regions: [
        'Centro de São José dos Campos, SP',
        'Jardim Aquarius, São José dos Campos, SP',
        'Urbanova, São José dos Campos, SP',
      ]},
      { name: 'Mogi das Cruzes, SP', population: 450_000, regions: [] },
      { name: 'Piracicaba, SP', population: 410_000, regions: [] },
      { name: 'Bauru, SP', population: 380_000, regions: [] },
      { name: 'São Vicente, SP', population: 370_000, regions: [] },
      { name: 'Santos, SP', population: 430_000, regions: [
        'Centro de Santos, SP',
        'Gonzaga, Santos, SP',
        'Boqueirão, Santos, SP',
      ]},
      { name: 'Guarujá, SP', population: 340_000, regions: [] },
      { name: 'Limeira, SP', population: 310_000, regions: [] },
      { name: 'Taubaté, SP', population: 320_000, regions: [] },
      { name: 'Praia Grande, SP', population: 330_000, regions: [] },
      { name: 'Suzano, SP', population: 300_000, regions: [] },
      { name: 'Carapicuíba, SP', population: 390_000, regions: [] },
      { name: 'Franca, SP', population: 360_000, regions: [] },
      { name: 'São Carlos, SP', population: 260_000, regions: [] },
      { name: 'Araraquara, SP', population: 240_000, regions: [] },
      { name: 'Marília, SP', population: 240_000, regions: [] },
      { name: 'Presidente Prudente, SP', population: 230_000, regions: [] },
      { name: 'Americana, SP', population: 240_000, regions: [] },
      { name: 'Araçatuba, SP', population: 200_000, regions: [] },
      { name: 'Barretos, SP', population: 120_000, regions: [] },
      { name: 'Botucatu, SP', population: 150_000, regions: [] },
      { name: 'Catanduva, SP', population: 120_000, regions: [] },
      { name: 'Hortolândia, SP', population: 230_000, regions: [] },
      { name: 'Indaiatuba, SP', population: 260_000, regions: [] },
      { name: 'Itu, SP', population: 170_000, regions: [] },
      { name: 'Itapetininga, SP', population: 180_000, regions: [] },
      { name: 'Jacareí, SP', population: 240_000, regions: [] },
      { name: 'Jundiaí, SP', population: 430_000, regions: [] },
      { name: 'Ourinhos, SP', population: 120_000, regions: [] },
      { name: 'Paulínia, SP', population: 110_000, regions: [] },
      { name: 'Registro, SP', population: 60_000, regions: [] },
      { name: 'Rio Claro, SP', population: 210_000, regions: [] },
      { name: 'Santa Bárbara d\'Oeste, SP', population: 200_000, regions: [] },
      { name: 'Sertãozinho, SP', population: 130_000, regions: [] },
      { name: 'Sumaré, SP', population: 290_000, regions: [] },
      { name: 'Taboão da Serra, SP', population: 290_000, regions: [] },
      { name: 'Valinhos, SP', population: 130_000, regions: [] },
      { name: 'Vinhedo, SP', population: 80_000, regions: [] },
      { name: 'Votuporanga, SP', population: 100_000, regions: [] },

      // ─────────────────────────────────────────────────────────────
      // PRIORIDADE 2 — Interior Sul (PR, SC, RS)
      // ─────────────────────────────────────────────────────────────
      { name: 'Joinville, SC', population: 600_000, regions: [
        'Centro de Joinville, SC',
        'América, Joinville, SC',
        'Atiradores, Joinville, SC',
      ]},
      { name: 'Londrina, PR', population: 560_000, regions: [
        'Centro de Londrina, PR',
        'Gleba Palhano, Londrina, PR',
        'Jardim Higienópolis, Londrina, PR',
      ]},
      { name: 'Maringá, PR', population: 430_000, regions: [
        'Centro de Maringá, PR',
        'Zona 7, Maringá, PR',
        'Zona 2, Maringá, PR',
      ]},
      { name: 'Caxias do Sul, RS', population: 520_000, regions: [
        'Centro de Caxias do Sul, RS',
        'São Pelegrino, Caxias do Sul, RS',
      ]},
      { name: 'Blumenau, SC', population: 360_000, regions: [
        'Centro de Blumenau, SC',
        'Velha, Blumenau, SC',
        'Itoupava Norte, Blumenau, SC',
      ]},
      { name: 'Pelotas, RS', population: 340_000, regions: [] },
      { name: 'Ponta Grossa, PR', population: 360_000, regions: [] },
      { name: 'Cascavel, PR', population: 340_000, regions: [] },
      { name: 'Santa Maria, RS', population: 280_000, regions: [] },
      { name: 'Foz do Iguaçu, PR', population: 260_000, regions: [] },
      { name: 'Novo Hamburgo, RS', population: 250_000, regions: [] },
      { name: 'São Leopoldo, RS', population: 240_000, regions: [] },
      { name: 'Canoas, RS', population: 340_000, regions: [] },
      { name: 'Chapecó, SC', population: 230_000, regions: [] },
      { name: 'Itajaí, SC', population: 230_000, regions: [] },
      { name: 'Passo Fundo, RS', population: 210_000, regions: [] },
      { name: 'Gravataí, RS', population: 280_000, regions: [] },
      { name: 'Viamão, RS', population: 260_000, regions: [] },
      { name: 'Umuarama, PR', population: 120_000, regions: [] },
      { name: 'Apucarana, PR', population: 140_000, regions: [] },
      { name: 'Guarapuava, PR', population: 190_000, regions: [] },
      { name: 'Toledo, PR', population: 150_000, regions: [] },
      { name: 'Paranaguá, PR', population: 160_000, regions: [] },
      { name: 'São José, SC', population: 250_000, regions: [] },
      { name: 'Criciúma, SC', population: 220_000, regions: [] },
      { name: 'Lages, SC', population: 160_000, regions: [] },
      { name: 'Balneário Camboriú, SC', population: 140_000, regions: [] },

      // ─────────────────────────────────────────────────────────────
      // PRIORIDADE 3 — Interior MG, GO, MT, MS, ES
      // ─────────────────────────────────────────────────────────────
      { name: 'Uberlândia, MG', population: 700_000, regions: [
        'Centro de Uberlândia, MG',
        'Saraiva, Uberlândia, MG',
        'Santa Mônica, Uberlândia, MG',
      ]},
      { name: 'Contagem, MG', population: 700_000, regions: [] },
      { name: 'Juiz de Fora, MG', population: 560_000, regions: [
        'Centro de Juiz de Fora, MG',
        'São Mateus, Juiz de Fora, MG',
        'Cascatinha, Juiz de Fora, MG',
      ]},
      { name: 'Aparecida de Goiânia, GO', population: 590_000, regions: [] },
      { name: 'Ribeirão das Neves, MG', population: 360_000, regions: [] },
      { name: 'Betim, MG', population: 440_000, regions: [] },
      { name: 'Anápolis, GO', population: 400_000, regions: [] },
      { name: 'Montes Claros, MG', population: 410_000, regions: [] },
      { name: 'Cuiabá, MT', population: 620_000, regions: [
        'Centro de Cuiabá, MT',
        'Bosque da Saúde, Cuiabá, MT',
        'Jardim Petrópolis, Cuiabá, MT',
      ]},
      { name: 'Várzea Grande, MT', population: 290_000, regions: [] },
      { name: 'Rondonópolis, MT', population: 240_000, regions: [] },
      { name: 'Dourados, MS', population: 230_000, regions: [] },
      { name: 'Três Lagoas, MS', population: 130_000, regions: [] },
      { name: 'Corumbá, MS', population: 110_000, regions: [] },
      { name: 'Serra, ES', population: 520_000, regions: [] },
      { name: 'Vila Velha, ES', population: 500_000, regions: [
        'Centro de Vila Velha, ES',
        'Itapoã, Vila Velha, ES',
        'Itaparica, Vila Velha, ES',
      ]},
      { name: 'Cariacica, ES', population: 400_000, regions: [] },
      { name: 'Sete Lagoas, MG', population: 240_000, regions: [] },
      { name: 'Divinópolis, MG', population: 240_000, regions: [] },
      { name: 'Ipatinga, MG', population: 240_000, regions: [] },
      { name: 'Uberaba, MG', population: 340_000, regions: [] },
      { name: 'Governador Valadares, MG', population: 290_000, regions: [] },
      { name: 'Patos de Minas, MG', population: 160_000, regions: [] },
      { name: 'Poços de Caldas, MG', population: 170_000, regions: [] },
      { name: 'Varginha, MG', population: 140_000, regions: [] },

      // ─────────────────────────────────────────────────────────────
      // PRIORIDADE 4 — Interior Nordeste e Norte
      // ─────────────────────────────────────────────────────────────
      { name: 'Feira de Santana, BA', population: 620_000, regions: [] },
      { name: 'Caruaru, PE', population: 360_000, regions: [] },
      { name: 'Petrolina, PE', population: 350_000, regions: [] },
      { name: 'Juazeiro do Norte, CE', population: 280_000, regions: [] },
      { name: 'Imperatriz, MA', population: 260_000, regions: [] },
      { name: 'Mossoró, RN', population: 300_000, regions: [] },
      { name: 'Campina Grande, PB', population: 420_000, regions: [] },
      { name: 'Arapiraca, AL', population: 240_000, regions: [] },
      { name: 'Ilhéus, BA', population: 180_000, regions: [] },
      { name: 'Vitória da Conquista, BA', population: 340_000, regions: [] },
      { name: 'Santarém, PA', population: 310_000, regions: [] },
      { name: 'Marabá, PA', population: 280_000, regions: [] },
      { name: 'Parauapebas, PA', population: 210_000, regions: [] },
      { name: 'Palmas, TO', population: 310_000, regions: [] },
      { name: 'Porto Velho, RO', population: 530_000, regions: [] },
      { name: 'Macapá, AP', population: 500_000, regions: [] },
      { name: 'Rio Branco, AC', population: 420_000, regions: [] },
      { name: 'Boa Vista, RR', population: 430_000, regions: [] },
      { name: 'Aracaju, SE', population: 660_000, regions: [
        'Centro de Aracaju, SE',
        'Atalaia, Aracaju, SE',
        'Grageru, Aracaju, SE',
      ]},
      { name: 'Teresina, PI', population: 870_000, regions: [
        'Centro de Teresina, PI',
        'Jóquei, Teresina, PI',
        'Noivos, Teresina, PI',
      ]},
      { name: 'Natal, RN', population: 890_000, regions: [
        'Centro de Natal, RN',
        'Ponta Negra, Natal, RN',
        'Lagoa Nova, Natal, RN',
      ]},
      { name: 'João Pessoa, PB', population: 820_000, regions: [
        'Centro de João Pessoa, PB',
        'Miramar, João Pessoa, PB',
        'Tambaú, João Pessoa, PB',
      ]},
      { name: 'São Luís, MA', population: 1_110_000, regions: [
        'Centro de São Luís, MA',
        'São Francisco, São Luís, MA',
        'Renascença, São Luís, MA',
        'Cohama, São Luís, MA',
      ]},
      { name: 'Maceió, AL', population: 1_020_000, regions: [
        'Centro de Maceió, AL',
        'Pajuçara, Maceió, AL',
        'Ponta Verde, Maceió, AL',
        'Jatiúca, Maceió, AL',
      ]},

      // ─────────────────────────────────────────────────────────────
      // PRIORIDADE 5 — Capitais médias
      // ─────────────────────────────────────────────────────────────
      { name: 'Florianópolis, SC', population: 510_000, regions: [
        'Centro de Florianópolis, SC',
        'Trindade, Florianópolis, SC',
        'Lagoa da Conceição, Florianópolis, SC',
        'Jurerê Internacional, Florianópolis, SC',
      ]},
      { name: 'Vitória, ES', population: 370_000, regions: [
        'Centro de Vitória, ES',
        'Praia do Canto, Vitória, ES',
        'Jardim da Penha, Vitória, ES',
        'Bento Ferreira, Vitória, ES',
      ]},
      { name: 'Curitiba, PR', population: 1_960_000, regions: [
        'Centro de Curitiba, PR',
        'Batel, Curitiba, PR',
        'Água Verde, Curitiba, PR',
        'Champagnat, Curitiba, PR',
        'Boa Vista, Curitiba, PR',
        'Portão, Curitiba, PR',
      ]},
      { name: 'Porto Alegre, RS', population: 1_490_000, regions: [
        'Centro de Porto Alegre, RS',
        'Moinhos de Vento, Porto Alegre, RS',
        'Bela Vista, Porto Alegre, RS',
        'Petrópolis, Porto Alegre, RS',
        'Menino Deus, Porto Alegre, RS',
        'Tristeza, Porto Alegre, RS',
      ]},
      { name: 'Campo Grande, MS', population: 910_000, regions: [
        'Centro de Campo Grande, MS',
        'Jardim dos Estados, Campo Grande, MS',
        'Chácara Cachoeira, Campo Grande, MS',
      ]},
      { name: 'Goiânia, GO', population: 1_550_000, regions: [
        'Setor Bueno, Goiânia, GO',
        'Setor Marista, Goiânia, GO',
        'Centro de Goiânia, GO',
        'Setor Oeste, Goiânia, GO',
        'Jardim Goiás, Goiânia, GO',
      ]},
      { name: 'Belém, PA', population: 1_500_000, regions: [
        'Centro de Belém, PA',
        'Batista Campos, Belém, PA',
        'Umarizal, Belém, PA',
        'Marco, Belém, PA',
      ]},
      { name: 'Manaus, AM', population: 2_200_000, regions: [
        'Centro de Manaus, AM',
        'Adrianópolis, Manaus, AM',
        'Ponta Negra, Manaus, AM',
        'Vieiralves, Manaus, AM',
        'Aleixo, Manaus, AM',
      ]},
      { name: 'Recife, PE', population: 1_650_000, regions: [
        'Boa Viagem, Recife, PE',
        'Graças, Recife, PE',
        'Centro de Recife, PE',
        'Casa Forte, Recife, PE',
        'Aflitos, Recife, PE',
      ]},
      { name: 'Fortaleza, CE', population: 2_700_000, regions: [
        'Aldeota, Fortaleza, CE',
        'Meireles, Fortaleza, CE',
        'Centro de Fortaleza, CE',
        'Fátima, Fortaleza, CE',
        'Papicu, Fortaleza, CE',
        'Cocó, Fortaleza, CE',
      ]},

      // ─────────────────────────────────────────────────────────────
      // PRIORIDADE 6 — Grandes capitais (por último)
      // ─────────────────────────────────────────────────────────────
      { name: 'Salvador, BA', population: 2_900_000, regions: [
        'Pituba, Salvador, BA',
        'Barra, Salvador, BA',
        'Itaigara, Salvador, BA',
        'Rio Vermelho, Salvador, BA',
        'Caminho das Árvores, Salvador, BA',
        'Paralela, Salvador, BA',
      ]},
      { name: 'Brasília, DF', population: 3_000_000, regions: [
        'Asa Sul, Brasília, DF',
        'Asa Norte, Brasília, DF',
        'Lago Sul, Brasília, DF',
        'Lago Norte, Brasília, DF',
        'Águas Claras, Brasília, DF',
        'Taguatinga, Brasília, DF',
        'Sudoeste, Brasília, DF',
      ]},
      { name: 'Rio de Janeiro, RJ', population: 6_700_000, regions: [
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
      ]},
      { name: 'São Paulo, SP', population: 12_300_000, regions: [
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
      ]},
    ],

    US: [
      {
        name: "New York, NY",
        population: 8_300_000,
        regions: [
          "Manhattan, NY",
          "Brooklyn, NY",
          "Queens, NY",
          "Bronx, NY",
          "Staten Island, NY",
          "Upper East Side, Manhattan, NY",
          "Upper West Side, Manhattan, NY",
          "Midtown, Manhattan, NY",
          "SoHo, Manhattan, NY",
          "Williamsburg, Brooklyn, NY",
        ],
      },
      {
        name: "Los Angeles, CA",
        population: 3_900_000,
        regions: [
          "Hollywood, Los Angeles, CA",
          "Santa Monica, CA",
          "Beverly Hills, CA",
          "Downtown Los Angeles, CA",
          "Pasadena, CA",
          "Burbank, CA",
          "West Hollywood, CA",
          "Venice, Los Angeles, CA",
        ],
      },
      {
        name: "Chicago, IL",
        population: 2_700_000,
        regions: [
          "Downtown Chicago, IL",
          "Lincoln Park, Chicago, IL",
          "Wicker Park, Chicago, IL",
          "River North, Chicago, IL",
          "Lakeview, Chicago, IL",
          "Logan Square, Chicago, IL",
        ],
      },
      {
        name: "Houston, TX",
        population: 2_300_000,
        regions: [
          "Downtown Houston, TX",
          "Midtown, Houston, TX",
          "The Heights, Houston, TX",
          "Montrose, Houston, TX",
          "Galleria, Houston, TX",
          "Sugar Land, TX",
        ],
      },
      {
        name: "Phoenix, AZ",
        population: 1_600_000,
        regions: ["Scottsdale, AZ", "Tempe, AZ", "Chandler, AZ", "Gilbert, AZ"],
      },
      {
        name: "Philadelphia, PA",
        population: 1_600_000,
        regions: [
          "Center City, Philadelphia, PA",
          "Old City, Philadelphia, PA",
          "Fishtown, Philadelphia, PA",
          "University City, Philadelphia, PA",
        ],
      },
      { name: "San Antonio, TX", population: 1_500_000, regions: [] },
      {
        name: "San Diego, CA",
        population: 1_400_000,
        regions: [
          "Downtown San Diego, CA",
          "La Jolla, CA",
          "Pacific Beach, San Diego, CA",
          "North Park, San Diego, CA",
        ],
      },
      {
        name: "Dallas, TX",
        population: 1_300_000,
        regions: [
          "Downtown Dallas, TX",
          "Uptown, Dallas, TX",
          "Deep Ellum, Dallas, TX",
          "Plano, TX",
          "Frisco, TX",
        ],
      },
      {
        name: "Austin, TX",
        population: 1_000_000,
        regions: [
          "Downtown Austin, TX",
          "South Congress, Austin, TX",
          "East Austin, TX",
          "Cedar Park, TX",
        ],
      },
      { name: "Jacksonville, FL", population: 950_000, regions: [] },
      { name: "San Jose, CA", population: 1_000_000, regions: [] },
      { name: "Fort Worth, TX", population: 950_000, regions: [] },
      { name: "Columbus, OH", population: 900_000, regions: [] },
      { name: "Charlotte, NC", population: 880_000, regions: [] },
      { name: "Indianapolis, IN", population: 880_000, regions: [] },
      {
        name: "San Francisco, CA",
        population: 870_000,
        regions: [
          "SoMa, San Francisco, CA",
          "Mission District, San Francisco, CA",
          "Marina District, San Francisco, CA",
          "North Beach, San Francisco, CA",
        ],
      },
      {
        name: "Seattle, WA",
        population: 740_000,
        regions: [
          "Downtown Seattle, WA",
          "Capitol Hill, Seattle, WA",
          "Ballard, Seattle, WA",
          "Bellevue, WA",
        ],
      },
      {
        name: "Denver, CO",
        population: 710_000,
        regions: [
          "Downtown Denver, CO",
          "Cherry Creek, Denver, CO",
          "RiNo, Denver, CO",
          "Aurora, CO",
        ],
      },
      {
        name: "Nashville, TN",
        population: 690_000,
        regions: [
          "Downtown Nashville, TN",
          "East Nashville, TN",
          "The Gulch, Nashville, TN",
          "Germantown, Nashville, TN",
        ],
      },
      { name: "Oklahoma City, OK", population: 680_000, regions: [] },
      { name: "Washington, DC", population: 670_000, regions: [] },
      { name: "El Paso, TX", population: 680_000, regions: [] },
      { name: "Las Vegas, NV", population: 640_000, regions: [] },
      { name: "Portland, OR", population: 640_000, regions: [] },
      { name: "Detroit, MI", population: 640_000, regions: [] },
      { name: "Memphis, TN", population: 630_000, regions: [] },
      { name: "Louisville, KY", population: 620_000, regions: [] },
      { name: "Baltimore, MD", population: 600_000, regions: [] },
      { name: "Milwaukee, WI", population: 570_000, regions: [] },
      { name: "Albuquerque, NM", population: 560_000, regions: [] },
      { name: "Tucson, AZ", population: 540_000, regions: [] },
      { name: "Fresno, CA", population: 540_000, regions: [] },
      { name: "Sacramento, CA", population: 520_000, regions: [] },
      { name: "Mesa, AZ", population: 500_000, regions: [] },
      {
        name: "Atlanta, GA",
        population: 500_000,
        regions: [
          "Midtown, Atlanta, GA",
          "Buckhead, Atlanta, GA",
          "Decatur, GA",
          "Sandy Springs, GA",
        ],
      },
      { name: "Omaha, NE", population: 490_000, regions: [] },
      { name: "Raleigh, NC", population: 470_000, regions: [] },
      {
        name: "Miami, FL",
        population: 440_000,
        regions: [
          "Downtown Miami, FL",
          "Coral Gables, FL",
          "Brickell, Miami, FL",
          "Doral, FL",
        ],
      },
      {
        name: "Tampa, FL",
        population: 400_000,
        regions: [
          "Downtown Tampa, FL",
          "South Tampa, FL",
          "Ybor City, Tampa, FL",
          "St. Petersburg, FL",
        ],
      },
      { name: "Orlando, FL", population: 310_000, regions: [] },
    ],
  },
};

// ── Helpers ───────────────────────────────────────────────────────────────

function expandCityTargets(cityConfig) {
  if (cityConfig.regions && cityConfig.regions.length > 0) {
    return cityConfig.regions;
  }
  return [cityConfig.name];
}

/**
 * Returns all (niche, searchCity, lang) combos.
 *
 * If `externalConfig` is provided, uses it as the source of truth
 * (sent by the dashboard). Otherwise falls back to the hardcoded AUTO_CONFIG.
 *
 * @param {object} [externalConfig] - { niches: string[], cities: string[], country: string, lang: string }
 */
export function getAllTargets(externalConfig) {
  if (externalConfig) {
    const { niches, cities, country, lang } = externalConfig;
    const targets = [];
    for (const city of cities) {
      for (const niche of niches) {
        targets.push({
          niche,
          searchCity: city,
          lang,
          country,
          cityName: city,
        });
      }
    }
    return targets;
  }

  // ⚠️ FALLBACK — only used for standalone CLI runs without dashboard config
  console.warn('[warn] No external config received — using local fallback. Run via dashboard for correct config.');
  const targets = [];

  for (const [country, cities] of Object.entries(AUTO_CONFIG.cities)) {
    const lang = country === "BR" ? "pt" : "en";
    const niches = AUTO_CONFIG.niches[country];

    for (const cityConfig of cities) {
      const searchTargets = expandCityTargets(cityConfig);
      for (const searchCity of searchTargets) {
        for (const niche of niches) {
          targets.push({
            niche,
            searchCity,
            lang,
            country,
            cityName: cityConfig.name,
          });
        }
      }
    }
  }

  return targets;
}
