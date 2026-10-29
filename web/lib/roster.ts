import type { Member } from './team'

// Roster: los agentes disponibles para armar equipos, agrupados por equipo. Todo viene en un solo plugin (`backoffice`):
// `id` del grupo = carpeta en plugins/backoffice/teams/<id>/team.json; `id` de cada agente = archivo en plugins/backoffice/agents/.
// roster.test.ts comprueba que cada grupo coincida con su team.json.
export interface RosterGroup {
  id: string
  name: string
  /** Agentes del sistema: siempre presentes y fuera de los equipos (no se eligen en Equipos). */
  system?: boolean
  agents: Member[]
}

export const ROSTERS: RosterGroup[] = [
  {
    id: 'marketing-team',
    name: 'Marketing',
    agents: [
      { id: 'cmo', name: 'CMO', role: 'Dirige el equipo de marketing', color: '#1565c0', face: 17, hair: '#14161A' },
      { id: 'researcher', name: 'Investigador', role: 'Mercado y competencia, con fuentes', color: '#00897b', face: 4, hair: '#6B4A2F' },
      { id: 'creative', name: 'Creativo', role: 'Copy y prompts de imagen y video', color: '#ef6c00', face: 6, hair: '#C2410C' },
      { id: 'analyst', name: 'Analista', role: 'Números, métricas y reportes', color: '#7b1fa2', face: 7, hair: '#3B2A6B' },
    ],
  },
  {
    id: 'sales-team',
    name: 'Ventas',
    agents: [
      { id: 'sales-lead', name: 'Jefe de ventas', role: 'Prioriza el pipeline y reparte el trabajo', color: '#fdd835', face: 13, hair: '#14161A' },
      { id: 'lead-qualifier', name: 'Calificador', role: 'Perfila y puntúa leads', color: '#00bcd4', face: 20, hair: '#3B2A6B' },
      { id: 'proposal-writer', name: 'Propuestas', role: 'Cotizaciones y propuestas en borrador', color: '#ab47bc', face: 14, hair: '#6B4A2F' },
      { id: 'follow-up', name: 'Seguimiento', role: 'Mensajes y secuencias de seguimiento', color: '#66bb6a', face: 18, hair: '#C2410C' },
    ],
  },
  {
    id: 'collections-team',
    name: 'Cobranza',
    agents: [
      { id: 'collections-lead', name: 'Jefe de cobranza', role: 'Prioriza la cartera y escala casos delicados', color: '#c62828', face: 16, hair: '#14161A' },
      { id: 'portfolio-analyst', name: 'Analista de cartera', role: 'Antigüedad de saldos y riesgos', color: '#e91e8c', face: 9, hair: '#3B2A6B' },
      { id: 'collections-agent', name: 'Gestor de cobro', role: 'Recordatorios de pago en borrador', color: '#26c6da', face: 12, hair: '#14161A' },
      { id: 'reconciler', name: 'Conciliador', role: 'Cruza pagos contra facturas', color: '#8d9440', face: 15, hair: '#14161A' },
    ],
  },
  {
    id: 'executive-team',
    name: 'Dirección',
    agents: [
      { id: 'ceo', name: 'CEO', role: 'Visión y prioridades entre áreas', color: '#5c6bc0', face: 5, hair: '#5A6470' },
      { id: 'cfo', name: 'CFO', role: 'Flujo de caja, presupuesto y rentabilidad', color: '#2e7d32', face: 1, hair: '#14161A' },
      // Las 20 caras ya estaban ocupadas: el COO comparte la cara 13 (jefe de ventas) y se distingue por color y pelo.
      { id: 'operations-chief', name: 'COO', role: 'Operación diaria: procesos, entregas y coordinación entre áreas', color: '#0097a7', face: 13, hair: '#5A6470' },
    ],
  },
  {
    id: 'finance-team',
    name: 'Finanzas',
    agents: [
      // Las 20 caras ya estaban ocupadas: se reutilizan con colores propios (la pareja cara|color es única).
      { id: 'controller', name: 'Contralor', role: 'Estados financieros, cierre del mes y paquete al contador', color: '#00695c', face: 4, hair: '#14161A' },
      { id: 'financial-analyst', name: 'Analista financiero', role: 'Evalúa proyectos, razones financieras y punto de equilibrio', color: '#283593', face: 7, hair: '#6B4A2F' },
      { id: 'tax-compliance', name: 'Cumplimiento fiscal', role: 'Calendario SAT y revisión de CFDI (orientativo, con tu contador)', color: '#6d4c41', face: 16, hair: '#5A6470' },
      { id: 'personal-finance-advisor', name: 'Finanzas personales', role: 'Presupuesto familiar, deudas y metas de ahorro', color: '#d81b60', face: 14, hair: '#C2410C' },
    ],
  },
  {
    id: 'dev-team',
    name: 'Desarrollo web',
    agents: [
      { id: 'tech-lead', name: 'Líder técnico', role: 'Parte el trabajo y revisa antes de entregar', color: '#3a7dc9', face: 0, hair: '#14161A' },
      { id: 'frontend-designer', name: 'Diseñador frontend', role: 'Dirección visual y diseño de interfaces', color: '#c2704f', face: 19, hair: '#C2410C' },
      { id: 'frontend-engineer', name: 'Ingeniero frontend', role: 'Interfaces con Next.js, Tailwind y shadcn/ui', color: '#f59f00', face: 3, hair: '#3B2A6B' },
      { id: 'backend-engineer', name: 'Ingeniero backend', role: 'Base de datos, API y pagos (Stripe)', color: '#5c6bc0', face: 2, hair: '#1F2937' },
      { id: 'web-qa', name: 'QA web', role: 'Accesibilidad, rendimiento y responsive', color: '#7cb342', face: 8, hair: '#6B4A2F' },
      // Las 20 caras (0–20 salvo la del jugador) ya estaban ocupadas: comparte la cara 5 y se distingue por color y pelo.
      { id: 'shopify-developer', name: 'Desarrollador Shopify', role: 'Tiendas Shopify: Liquid, APIs y automatizaciones', color: '#95bf47', face: 5, hair: '#5B3A1E' },
    ],
  },
]

// Assistant (id interno `coo`) recibe a la persona en la recepción; la persona puede renombrarla en Equipos: cara femenina (11, de pelo largo) y su camisa naranja.
export const COO_AGENT: Member = { id: 'coo', name: 'Assistant', role: 'Recepción, puente y guía: roster, equipos y tareas', color: '#f4511e', hair: '#14161A', face: 11 }

ROSTERS.push({ id: 'backoffice-core', name: 'Back Office', system: true, agents: [COO_AGENT] })

export const ROSTER_AGENTS: Member[] = ROSTERS.flatMap((g) => g.agents)
export const findAgent = (id: string) => ROSTER_AGENTS.find((a) => a.id === id)
