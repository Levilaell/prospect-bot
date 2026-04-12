// Niche-specific context for personalized outreach — maps niche keywords to
// services, typical pain context, and tone guidance for each language.

const TEMPLATES = [
  {
    keywords: ['dentist', 'dental', 'odonto', 'clínica odonto'],
    category: 'dental',
    pt: {
      focus: 'agendamento online 24h, lembretes automáticos, ficha do paciente digital',
      pain: 'Pacientes esperam agendar pelo celular a qualquer hora. Clínicas sem isso perdem para concorrentes que já oferecem.',
      tone: 'Profissional e acessível — destacar confiança e credibilidade visual',
    },
    en: {
      focus: 'online scheduling 24/7, automated appointment reminders, digital patient intake',
      pain: 'Patients expect to book online anytime. Practices without this lose to competitors who already offer it.',
      tone: 'Professional but approachable — highlight trust and visual credibility',
    },
  },
  {
    keywords: ['estética', 'med spa', 'aesthet', 'derma', 'skin'],
    category: 'aesthetics',
    pt: {
      focus: 'agendamento online, catálogo de procedimentos com fotos, antes e depois',
      pain: 'Clientes pesquisam procedimentos e resultados online antes de escolher. Sem portfólio visual, perdem confiança.',
      tone: 'Sofisticado e visual — destacar resultados e modernidade',
    },
    en: {
      focus: 'online booking, treatment catalog with photos, before/after gallery',
      pain: 'Clients research procedures and results online before choosing. Without a visual portfolio, they lose trust.',
      tone: 'Sophisticated and visual — highlight results and modernity',
    },
  },
  {
    keywords: ['psicol', 'therapy', 'therapist', 'counseli', 'mental'],
    category: 'therapy',
    pt: {
      focus: 'agendamento discreto online, informações sobre abordagens, blog educativo',
      pain: 'Pacientes buscam terapeutas no Google e escolhem quem passa mais confiança. Sem site profissional, ficam invisíveis.',
      tone: 'Acolhedor e discreto — foco em confiança e acessibilidade',
    },
    en: {
      focus: 'discreet online scheduling, information about approaches, educational blog',
      pain: 'Clients search for therapists on Google and choose whoever feels most trustworthy. Without a professional site, you are invisible.',
      tone: 'Warm and discreet — focus on trust and accessibility',
    },
  },
  {
    keywords: ['veterinár', 'vet', 'animal', 'pet clinic'],
    category: 'veterinary',
    pt: {
      focus: 'agendamento de consultas, lembretes de vacina, emergência 24h',
      pain: 'Donos de pets buscam "veterinário perto de mim" no celular. Sem site rápido e claro, vão pro primeiro resultado que funciona.',
      tone: 'Carinhoso e confiável — foco em cuidado e praticidade',
    },
    en: {
      focus: 'appointment scheduling, vaccination reminders, emergency info',
      pain: 'Pet owners search "vet near me" on their phones. Without a fast, clear site, they go to the first result that works.',
      tone: 'Caring and reliable — focus on care and convenience',
    },
  },
  {
    keywords: ['chiro', 'quiro'],
    category: 'chiropractic',
    pt: {
      focus: 'agendamento online, depoimentos de pacientes, explicação dos serviços',
      pain: 'Pacientes comparam profissionais online. Sem site profissional com depoimentos, perdem credibilidade.',
      tone: 'Profissional e educativo — foco em credibilidade e resultados',
    },
    en: {
      focus: 'online booking, patient testimonials, service explanations',
      pain: 'Patients compare practitioners online. Without a professional site with testimonials, you lose credibility.',
      tone: 'Professional and educational — focus on credibility and results',
    },
  },
  {
    keywords: ['academia', 'gym', 'fitness', 'crossfit'],
    category: 'gym',
    pt: {
      focus: 'agendamento de aulas, planos e preços online, galeria do espaço',
      pain: 'Alunos buscam horários e planos pelo celular. Sem site rápido com informação clara, vão pro concorrente.',
      tone: 'Energético e direto — foco em praticidade e modernidade',
    },
    en: {
      focus: 'class scheduling, membership plans online, facility gallery',
      pain: 'Members look up schedules and plans on their phones. Without a fast site with clear info, they go to competitors.',
      tone: 'Energetic and direct — focus on convenience and modern experience',
    },
  },
  {
    keywords: ['pilates', 'yoga', 'studio'],
    category: 'wellness_studio',
    pt: {
      focus: 'agendamento de aulas, grade de horários online, planos e pacotes',
      pain: 'Alunos querem ver horários e reservar aulas pelo celular. Sem isso, perdem pra estúdios com booking fácil.',
      tone: 'Calmo e sofisticado — foco em experiência e bem-estar',
    },
    en: {
      focus: 'class booking, online schedule, plans and packages',
      pain: 'Students want to check schedules and book classes on their phones. Without this, you lose to studios with easy booking.',
      tone: 'Calm and sophisticated — focus on experience and wellness',
    },
  },
  {
    keywords: ['salão', 'salon', 'hair', 'cabeleir', 'beleza', 'beauty'],
    category: 'beauty_salon',
    pt: {
      focus: 'agendamento online, portfólio de trabalhos, integração WhatsApp',
      pain: 'Clientes escolhem pelo Instagram e portfólio. Sem presença visual forte e booking fácil, perde pra quem mostra o trabalho.',
      tone: 'Criativo e visual — destacar portfólio e estilo',
    },
    en: {
      focus: 'online booking, work portfolio, WhatsApp/text integration',
      pain: 'Clients choose based on portfolios and reviews. Without strong visual presence and easy booking, you lose to those who showcase their work.',
      tone: 'Creative and visual — highlight portfolio and style',
    },
  },
  {
    keywords: ['barbearia', 'barber'],
    category: 'barbershop',
    pt: {
      focus: 'agendamento online, portfólio de cortes, preços atualizados',
      pain: 'Clientes querem agendar sem ligar e ver o estilo do barbeiro. Sem site com portfólio e booking, perdem pro concorrente.',
      tone: 'Descolado e direto — foco em estilo e praticidade',
    },
    en: {
      focus: 'online booking, haircut portfolio, updated pricing',
      pain: 'Clients want to book without calling and see your style. Without a site with portfolio and booking, they go to competitors.',
      tone: 'Cool and direct — focus on style and convenience',
    },
  },
  {
    keywords: ['tattoo', 'tatuagem', 'tattoo shop', 'estúdio de tatuagem'],
    category: 'tattoo',
    pt: {
      focus: 'portfólio online, agendamento de sessões, galeria de estilos',
      pain: 'Clientes pesquisam tatuadores pelo portfólio online. Sem galeria profissional, perde pra quem tem.',
      tone: 'Artístico e autêntico — foco em portfólio e identidade',
    },
    en: {
      focus: 'online portfolio, session booking, style gallery',
      pain: 'Clients research tattoo artists through online portfolios. Without a professional gallery, you lose to those who have one.',
      tone: 'Artistic and authentic — focus on portfolio and identity',
    },
  },
  {
    keywords: ['restaurante', 'restaurant', 'food', 'comida'],
    category: 'restaurant',
    pt: {
      focus: 'cardápio digital, pedidos/reservas online, fotos profissionais dos pratos',
      pain: 'Clientes decidem onde comer pelo celular. Sem cardápio online e fotos boas, perdem pedidos pra concorrentes com delivery fácil.',
      tone: 'Apetitoso e prático — foco em cardápio visual e facilidade de pedido',
    },
    en: {
      focus: 'digital menu, online ordering/reservations, professional food photos',
      pain: 'Customers decide where to eat on their phones. Without an online menu and good photos, you lose orders to competitors with easy delivery.',
      tone: 'Appetizing and practical — focus on visual menu and easy ordering',
    },
  },
  {
    keywords: ['pizza', 'pizzaria'],
    category: 'pizza',
    pt: {
      focus: 'cardápio digital com fotos, pedidos online direto pelo site, promoções',
      pain: 'Clientes pedem pelo celular. Sem cardápio bonito e pedido fácil, vão pro iFood ou concorrente com site próprio.',
      tone: 'Direto e apetitoso — foco em cardápio e praticidade de pedido',
    },
    en: {
      focus: 'digital menu with photos, online ordering, promotions',
      pain: 'Customers order from their phones. Without a beautiful menu and easy ordering, they go to delivery apps or competitors with their own site.',
      tone: 'Direct and appetizing — focus on menu and ordering convenience',
    },
  },
  {
    keywords: ['padaria', 'confeitaria', 'bakery', 'pastry', 'cake'],
    category: 'bakery',
    pt: {
      focus: 'catálogo de produtos com fotos, encomendas online, horários de funcionamento',
      pain: 'Clientes querem ver produtos e encomendar pelo celular. Sem catálogo bonito, perdem encomendas pra quem tem.',
      tone: 'Acolhedor e visual — foco em catálogo de produtos',
    },
    en: {
      focus: 'product catalog with photos, online ordering, business hours',
      pain: 'Customers want to see products and order from their phones. Without a beautiful catalog, you lose orders.',
      tone: 'Warm and visual — focus on product catalog',
    },
  },
  {
    keywords: ['pet shop', 'pet grooming', 'banho', 'tosa'],
    category: 'pet_shop',
    pt: {
      focus: 'agendamento de banho e tosa, loja online, lembretes de vacina',
      pain: 'Donos de pets agendam pelo celular. Sem booking online, perde clientes que querem praticidade.',
      tone: 'Amigável e carinhoso — foco em praticidade para donos de pets',
    },
    en: {
      focus: 'grooming appointments, online store, vaccination reminders',
      pain: 'Pet owners book on their phones. Without online booking, you lose clients who want convenience.',
      tone: 'Friendly and caring — focus on convenience for pet owners',
    },
  },
  {
    keywords: ['oficina', 'mecânic', 'auto repair', 'mechanic', 'car'],
    category: 'auto_repair',
    pt: {
      focus: 'orçamento online, agendamento de serviços, status do veículo',
      pain: 'Clientes querem agendar e acompanhar serviço sem ligar. Oficinas modernas já oferecem isso online.',
      tone: 'Confiável e transparente — foco em praticidade e confiança',
    },
    en: {
      focus: 'online estimates, service scheduling, vehicle status tracking',
      pain: 'Customers want to schedule and track service without calling. Modern shops already offer this online.',
      tone: 'Trustworthy and transparent — focus on convenience and trust',
    },
  },
  {
    keywords: ['autoescola', 'driving school', 'driving'],
    category: 'driving_school',
    pt: {
      focus: 'inscrição online, calendário de aulas, simulados, depoimentos',
      pain: 'Alunos comparam autoescolas pelo Google. Sem site claro com preços e inscrição fácil, escolhem quem facilita.',
      tone: 'Acessível e informativo — foco em facilidade de inscrição',
    },
    en: {
      focus: 'online enrollment, class calendar, practice tests, testimonials',
      pain: 'Students compare driving schools on Google. Without a clear site with pricing and easy enrollment, they choose whoever makes it easier.',
      tone: 'Accessible and informative — focus on easy enrollment',
    },
  },
  {
    keywords: ['escola de idioma', 'language school', 'idioma', 'english school'],
    category: 'language_school',
    pt: {
      focus: 'inscrição online, calendário de turmas, níveis disponíveis, depoimentos',
      pain: 'Alunos pesquisam e comparam escolas online. Sem informação clara e matrícula fácil, escolhem quem facilita.',
      tone: 'Acolhedor e profissional — foco em facilidade de matrícula',
    },
    en: {
      focus: 'online enrollment, class schedule, available levels, testimonials',
      pain: 'Students research and compare schools online. Without clear info and easy signup, they choose whoever makes it easier.',
      tone: 'Welcoming and professional — focus on easy enrollment',
    },
  },
  {
    keywords: ['imobiliária', 'real estate', 'imóve', 'property'],
    category: 'real_estate',
    pt: {
      focus: 'listagem de imóveis com fotos, filtros de busca, formulário de contato, tour virtual',
      pain: 'Clientes buscam imóveis pelo celular. Sem site profissional com fotos boas e busca fácil, perdem pra portais e concorrentes.',
      tone: 'Profissional e sofisticado — foco em credibilidade e apresentação visual',
    },
    en: {
      focus: 'property listings with photos, search filters, contact forms, virtual tours',
      pain: 'Clients search for properties on their phones. Without a professional site with good photos and easy search, you lose to portals and competitors.',
      tone: 'Professional and sophisticated — focus on credibility and visual presentation',
    },
  },
  {
    keywords: ['contabilidade', 'accounting', 'contador', 'accountant', 'bookkeep'],
    category: 'accounting',
    pt: {
      focus: 'site institucional, captação de leads, área do cliente, blog fiscal',
      pain: 'Empresas buscam contadores no Google. Sem site profissional e SEO, perde para quem aparece primeiro.',
      tone: 'Profissional e confiável — foco em autoridade e organização',
    },
    en: {
      focus: 'professional website, lead capture, client portal, tax blog',
      pain: 'Businesses search for accountants on Google. Without a professional site and SEO, you lose to those who rank first.',
      tone: 'Professional and trustworthy — focus on authority and organization',
    },
  },
  {
    keywords: ['loja de roupa', 'boutique', 'clothing', 'moda', 'fashion'],
    category: 'boutique',
    pt: {
      focus: 'loja online, catálogo com fotos, integração WhatsApp para pedidos',
      pain: 'Clientes querem ver produtos e comprar online. Sem catálogo digital, perde vendas pra quem tem e-commerce.',
      tone: 'Estiloso e convidativo — foco em catálogo e experiência de compra',
    },
    en: {
      focus: 'online store, product catalog with photos, WhatsApp/text ordering',
      pain: 'Customers want to browse and buy online. Without a digital catalog, you lose sales to those with e-commerce.',
      tone: 'Stylish and inviting — focus on catalog and shopping experience',
    },
  },
  {
    keywords: ['floricultura', 'florist', 'flower', 'flor'],
    category: 'florist',
    pt: {
      focus: 'catálogo online, encomendas pelo site, entrega programada',
      pain: 'Clientes compram flores de última hora pelo celular. Sem loja online com entrega, perde pra quem tem.',
      tone: 'Delicado e visual — foco em catálogo de arranjos',
    },
    en: {
      focus: 'online catalog, website orders, scheduled delivery',
      pain: 'Customers buy flowers last-minute on their phones. Without an online store with delivery, you lose to those who have it.',
      tone: 'Delicate and visual — focus on arrangement catalog',
    },
  },
  {
    keywords: ['plumber', 'encanador', 'plumbing'],
    category: 'plumber',
    pt: {
      focus: 'site profissional, formulário de orçamento, depoimentos, área de atuação',
      pain: 'Clientes buscam "encanador perto de mim" no Google. Sem site, não aparece e perde trabalho.',
      tone: 'Confiável e direto — foco em credibilidade e facilidade de contato',
    },
    en: {
      focus: 'professional website, quote request forms, testimonials, service area',
      pain: 'Customers search "plumber near me" on Google. Without a website, you don\'t show up and lose jobs.',
      tone: 'Reliable and direct — focus on credibility and easy contact',
    },
  },
  {
    keywords: ['landscap', 'jardinagem', 'garden', 'paisag'],
    category: 'landscaping',
    pt: {
      focus: 'portfólio de projetos, orçamento online, fotos antes/depois',
      pain: 'Clientes escolhem pelo portfólio. Sem site com fotos de projetos anteriores, perde pra quem mostra resultados.',
      tone: 'Natural e visual — foco em portfólio de projetos',
    },
    en: {
      focus: 'project portfolio, online quotes, before/after photos',
      pain: 'Clients choose based on portfolios. Without a site showing past projects, you lose to those who show results.',
      tone: 'Natural and visual — focus on project portfolio',
    },
  },
  {
    keywords: ['cleaning', 'limpeza', 'faxina'],
    category: 'cleaning',
    pt: {
      focus: 'agendamento online, pacotes de serviço, depoimentos de clientes',
      pain: 'Clientes querem agendar limpeza sem ligar. Sem site com booking e preços claros, perde pra concorrentes organizados.',
      tone: 'Organizado e confiável — foco em praticidade',
    },
    en: {
      focus: 'online scheduling, service packages, customer testimonials',
      pain: 'Customers want to book cleaning without calling. Without a site with booking and clear pricing, you lose to organized competitors.',
      tone: 'Organized and trustworthy — focus on convenience',
    },
  },
  {
    keywords: ['photo', 'fotograf', 'photography'],
    category: 'photography',
    pt: {
      focus: 'portfólio visual, galeria de ensaios, agendamento de sessões',
      pain: 'Clientes escolhem fotógrafo pelo portfólio online. Sem galeria profissional, perde pra quem tem.',
      tone: 'Artístico e emocional — foco em portfólio',
    },
    en: {
      focus: 'visual portfolio, photo gallery, session booking',
      pain: 'Clients choose photographers by their online portfolio. Without a professional gallery, you lose to those who have one.',
      tone: 'Artistic and emotional — focus on portfolio',
    },
  },
  {
    keywords: ['hvac', 'heating', 'air condition', 'ac repair'],
    category: 'hvac',
    en: {
      focus: 'service request forms, emergency booking, maintenance plans, service area map',
      pain: 'Homeowners search "HVAC near me" when their system breaks. Without a professional site with booking, they call the first company that looks legit.',
      tone: 'Trustworthy and urgent — focus on fast response and reliability',
    },
  },
  {
    keywords: ['roof', 'roofing'],
    category: 'roofing',
    en: {
      focus: 'free estimate forms, project gallery, testimonials, financing options',
      pain: 'Homeowners compare roofers online before calling. Without a site showing past work and easy quote requests, you lose to competitors who do.',
      tone: 'Solid and professional — focus on trust, quality, and proof of work',
    },
  },
  {
    keywords: ['electric', 'electrician'],
    category: 'electrician',
    en: {
      focus: 'service booking, emergency contact, service list, licensing info',
      pain: 'People search "electrician near me" and pick whoever looks most professional. Without a clean site with clear services and booking, you are invisible.',
      tone: 'Professional and reliable — focus on safety and credentials',
    },
  },
  {
    keywords: ['insurance', 'insurer'],
    category: 'insurance',
    en: {
      focus: 'quote request forms, coverage comparison, client testimonials, FAQ',
      pain: 'People compare insurance agents online. Without a professional site that explains coverage and captures leads, you lose to those who do.',
      tone: 'Trustworthy and informative — focus on clarity and credibility',
    },
  },
  {
    keywords: ['daycare', 'childcare', 'preschool'],
    category: 'daycare',
    en: {
      focus: 'enrollment forms, program info, virtual tour, parent testimonials',
      pain: 'Parents research daycares extensively online before visiting. Without a professional site with clear programs and enrollment, you miss families.',
      tone: 'Warm and trustworthy — focus on safety, care, and transparency',
    },
  },
  {
    keywords: ['wedding', 'event venue', 'banquet'],
    category: 'wedding_venue',
    en: {
      focus: 'venue gallery, availability calendar, virtual tours, package info',
      pain: 'Couples browse dozens of venues online. Without stunning photos and easy contact forms, you are skipped instantly.',
      tone: 'Elegant and aspirational — focus on visual impact and experience',
    },
  },
  {
    keywords: ['personal train', 'fitness coach', 'trainer'],
    category: 'personal_trainer',
    en: {
      focus: 'booking system, transformation gallery, programs, testimonials',
      pain: 'Clients choose trainers based on online presence and results. Without a site showing transformations and easy booking, you rely only on referrals.',
      tone: 'Motivating and results-driven — focus on transformations',
    },
  },
  {
    keywords: ['law firm', 'attorney', 'lawyer', 'legal'],
    category: 'law_firm',
    en: {
      focus: 'consultation booking, practice areas, attorney bios, case results, FAQ',
      pain: 'People search for lawyers in specific practice areas. Without a professional site with clear expertise and contact forms, you lose to firms that rank higher.',
      tone: 'Authoritative and professional — focus on expertise and trust',
    },
  },
];

// Default fallback for niches not in the list
const DEFAULT = {
  pt: {
    focus: 'site profissional, formulário de contato, agendamento online, integração WhatsApp',
    pain: 'Clientes buscam negócios no Google pelo celular. Sem site profissional e rápido, perdem pra concorrentes que têm.',
    tone: 'Direto e amigável — foco em profissionalismo e praticidade',
  },
  en: {
    focus: 'professional website, contact forms, online scheduling, WhatsApp integration',
    pain: 'Customers search for businesses on Google from their phones. Without a fast, professional site, you lose to competitors who have one.',
    tone: 'Direct and friendly — focus on professionalism and convenience',
  },
};

/**
 * Returns niche-specific context for the given niche and language.
 * Uses keyword matching (case-insensitive, partial match).
 */
export function getNicheContext(niche, lang) {
  if (!niche) return DEFAULT[lang] ?? DEFAULT.en;

  const lower = niche.toLowerCase();
  const match = TEMPLATES.find((t) =>
    t.keywords.some((kw) => lower.includes(kw) || kw.includes(lower)),
  );

  if (!match) return DEFAULT[lang] ?? DEFAULT.en;
  return match[lang] ?? match.en ?? DEFAULT[lang] ?? DEFAULT.en;
}
