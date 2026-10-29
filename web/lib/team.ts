import type { Session, SessionStatus } from './types'
import { ROSTERS } from './roster'

// El equipo instalado. Cada agente tiene su escritorio aunque no haya sesión (aparece fuera de línea).
export interface Member {
  id: string
  name: string
  role: string
  color: string
  hair: string
  /** Cara de voxel por defecto (0–20); la persona puede cambiarla por equipo. */
  face?: number
}

// Equipo por defecto (cuando no hay un equipo activo): los agentes del primer roster.
export const TEAM: Member[] = ROSTERS.find((g) => g.id === 'marketing-team')!.agents

export interface Seat {
  key: string
  member: Member
  status: SessionStatus
  detail: string | null
  tool: string | null
  sessionId: string | null
  cwd: string | null
  live: boolean
  /** Índice del equipo al que pertenece (solo en `buildTeamSeats`); sin él va a las plazas del lobby. */
  team?: number
}

const WEIGHT: Record<SessionStatus, number> = { waiting: 4, working: 3, error: 2, idle: 1, offline: 0 }

const VISITOR_COLORS = ['#5A6470', '#0EA5E9', '#EC4899', '#84CC16']

// Une la lista del equipo con las sesiones en vivo. Una sesión se sienta en el escritorio de su agente;
// las que no pertenecen a nadie (sesiones sueltas de Claude) se sientan como visitantes.
// "backoffice:cmo" → "cmo": los hooks reportan el agente con el prefijo de su plugin.
const agentKey = (v: string | null | undefined) => (v ?? '').toLowerCase().split(':').pop()!.trim()

// El COO (`coo`) siempre va primero: es el agente por defecto del sistema y tiene su propia oficina.
export function buildSeats(sessions: Session[], padTo = 0, teamMembers: Member[] = TEAM, coo?: Member): Seat[] {
  const team = coo ? [coo, ...teamMembers.filter((m) => m.id !== coo.id)] : teamMembers
  const byAgent = new Map<string, Session>()
  const loose: Session[] = []
  for (const s of sessions) {
    if (s.status === 'offline') continue
    const member = s.agent && team.find((m) => m.id === agentKey(s.agent))
    if (member) {
      const cur = byAgent.get(member.id)
      if (!cur || WEIGHT[s.status] > WEIGHT[cur.status]) byAgent.set(member.id, s)
    } else loose.push(s)
  }
  const seats: Seat[] = team.map((m) => {
    const s = byAgent.get(m.id)
    return { key: m.id, member: m, status: s?.status ?? 'offline', detail: s?.detail ?? null, tool: s?.tool ?? null, sessionId: s?.id ?? null, cwd: s?.cwd ?? null, live: !!s }
  })
  loose
    .sort((a, b) => b.last_event_at - a.last_event_at)
    .slice(0, 4)
    .forEach((s, i) => {
      seats.push({
        key: s.id,
        member: { id: s.id, name: s.project ?? 'Sesión', role: 'Sesión de Claude', color: VISITOR_COLORS[i % VISITOR_COLORS.length], hair: '#14161A' },
        status: s.status,
        detail: s.detail,
        tool: s.tool,
        sessionId: s.id,
        cwd: s.cwd,
        live: true,
      })
    })
  // Vista previa de equipos más grandes (?equipo=12): completa con agentes sin sesión.
  for (let i = seats.length; i < padTo; i++) {
    seats.push({
      key: `extra-${i}`,
      member: { id: `extra-${i}`, name: `Agente ${i + 1}`, role: 'Vista previa', color: VISITOR_COLORS[i % VISITOR_COLORS.length], hair: '#14161A' },
      status: 'offline', detail: null, tool: null, sessionId: null, cwd: null, live: false,
    })
  }
  return seats
}

// Todos los equipos del proyecto: la COO primero; luego los miembros de cada equipo en orden (llave `${team.id}:${agente}`,
// porque un agente puede estar en dos equipos; la misma sesión viva lo enciende en todos), y al final las sesiones sueltas.
// `padTo` (vista previa ?equipo=N) completa con agentes de relleno como un equipo más.
export function buildTeamSeats(sessions: Session[], teams: { id: string; members: Member[] }[], padTo = 0, coo?: Member): { seats: Seat[]; teamSizes: number[] } {
  const known = new Set<string>([...(coo ? [coo.id] : []), ...teams.flatMap((t) => t.members.map((m) => m.id))])
  const byAgent = new Map<string, Session>()
  const loose: Session[] = []
  for (const s of sessions) {
    if (s.status === 'offline') continue
    const id = agentKey(s.agent)
    if (s.agent && known.has(id)) {
      const cur = byAgent.get(id)
      if (!cur || WEIGHT[s.status] > WEIGHT[cur.status]) byAgent.set(id, s)
    } else loose.push(s)
  }
  const mk = (key: string, m: Member, team?: number): Seat => {
    const s = byAgent.get(m.id)
    return { key, member: m, status: s?.status ?? 'offline', detail: s?.detail ?? null, tool: s?.tool ?? null, sessionId: s?.id ?? null, cwd: s?.cwd ?? null, live: !!s, ...(team === undefined ? {} : { team }) }
  }
  const seats: Seat[] = coo ? [mk(coo.id, coo)] : []
  const teamSizes: number[] = []
  teams.forEach((t, ti) => {
    const members = t.members.filter((m) => m.id !== coo?.id)
    members.forEach((m) => seats.push(mk(`${t.id}:${m.id}`, m, ti)))
    teamSizes.push(members.length)
  })
  const real = seats.length
  const extras = Math.max(0, padTo - real - Math.min(4, loose.length))
  if (extras > 0) {
    const ti = teamSizes.length
    for (let i = 0; i < extras; i++) {
      seats.push({
        key: `extra-${i}`,
        member: { id: `extra-${i}`, name: `Agente ${i + 1}`, role: 'Vista previa', color: VISITOR_COLORS[i % VISITOR_COLORS.length], hair: '#14161A' },
        status: 'offline', detail: null, tool: null, sessionId: null, cwd: null, live: false, team: ti,
      })
    }
    teamSizes.push(extras)
  }
  loose
    .sort((a, b) => b.last_event_at - a.last_event_at)
    .slice(0, 4)
    .forEach((s, i) => {
      seats.push({
        key: s.id,
        member: { id: s.id, name: s.project ?? 'Sesión', role: 'Sesión de Claude', color: VISITOR_COLORS[i % VISITOR_COLORS.length], hair: '#14161A' },
        status: s.status, detail: s.detail, tool: s.tool, sessionId: s.id, cwd: s.cwd, live: true,
      })
    })
  return { seats, teamSizes }
}

export const STATUS_LABEL: Record<SessionStatus, string> = {
  idle: 'Libre',
  working: 'Trabajando',
  waiting: 'Te espera',
  error: 'Con error',
  offline: 'Sin sesión',
}
