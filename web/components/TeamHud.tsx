import { useState } from 'react'
import type { Seat } from '@/lib/team'
import { STATUS_LABEL } from '@/lib/team'

const PILL: Record<string, string> = {
  working: 'bg-blue-soft text-blue',
  waiting: 'bg-amber-soft text-amber',
  error: 'bg-red-soft text-red',
  idle: 'bg-teal-soft text-teal',
  offline: 'bg-bg text-muted',
}

// El equipo como pantalla flotante (HUD) en la esquina inferior izquierda del juego.
// Un clic en un agente abre su conversación en Claude (la ligada en Equipos) o una nueva si no tiene.
// Un renglón por equipo que se despliega; los equipos con alguien trabajando o esperando arrancan desplegados.
export default function TeamHud({ seats, selectedKey, onOpen, linked, codexKeys = [], coworkKeys = [], teamNames = [] }: { codexKeys?: string[]; coworkKeys?: string[]; seats: Seat[]; selectedKey: string | null; onOpen: (key: string) => void; linked: (s: Seat) => boolean; teamNames?: string[] }) {
  const ready = seats.filter((s) => s.live || linked(s)).length
  const loose = seats.filter((s) => s.team === undefined || !teamNames[s.team])
  const groups = teamNames.map((name, i) => ({ i, name, seats: seats.filter((s) => s.team === i) })).filter((g) => g.seats.length)
  const busy = (g: { seats: Seat[] }) => g.seats.some((s) => s.status === 'working' || s.status === 'waiting' || s.status === 'error')
  const [toggled, setToggled] = useState<Record<number, boolean>>({})
  const isOpen = (g: { i: number; seats: Seat[] }) => toggled[g.i] ?? (busy(g) || g.seats.some((s) => s.key === selectedKey))
  const row = (s: Seat) => (
    <li key={s.key}>
      <button
        onClick={() => onOpen(s.key)}
        title={linked(s) ? `Abrir la conversación de ${s.member.name} en ${codexKeys.includes(s.key) ? 'Codex' : coworkKeys.includes(s.key) ? 'Cowork' : 'Claude Code'}` : `Empezar una conversación nueva con ${s.member.name}`}
        className={`flex w-full items-start gap-2.5 rounded-sm px-2 py-1.5 text-left hover:bg-bg ${s.key === selectedKey ? 'bg-blue-soft/60' : ''}`}
      >
        <span className="mt-1 h-2.5 w-2.5 flex-none rounded-sm" style={{ background: s.member.color }} />
        <span className="min-w-0 flex-1">
          <span className="flex items-center justify-between gap-2">
            <span className="truncate text-[12.5px] font-semibold">{s.member.name}</span>
            <span className={`flex-none rounded-full px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wide ${PILL[s.status]}`}>{STATUS_LABEL[s.status]}</span>
          </span>
          <span className="flex items-center gap-1 truncate text-[11px] text-muted">
            {linked(s) && (
              <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" className="flex-none text-blue" aria-label="Conversación ligada"><path d="M10 13a5 5 0 0 0 7.5.5l3-3a5 5 0 0 0-7-7l-1.7 1.7" /><path d="M14 11a5 5 0 0 0-7.5-.5l-3 3a5 5 0 0 0 7 7l1.7-1.7" /></svg>
            )}
            <span className="truncate">{s.live && s.detail ? s.detail : linked(s) ? 'Conversación ligada' : s.member.role}</span>
          </span>
        </span>
      </button>
    </li>
  )
  return (
    <section className="flex max-h-full w-full flex-col overflow-hidden rounded-sm border border-line bg-surface/95" aria-label="Equipos">
      <div className="flex items-center justify-between border-b border-line px-3 py-2">
        <span className="label">Equipos</span>
        <span className="text-[11px] text-muted" title="Con sesión en vivo o con conversación ligada en Equipos">{ready}/{seats.length} con conversación</span>
      </div>
      <ul className="min-h-0 flex-1 overflow-y-auto p-1.5">
        {loose.map(row)}
        {groups.map((g) => {
          const open = isOpen(g)
          const working = g.seats.filter((s) => s.status === 'working').length
          const waiting = g.seats.filter((s) => s.status === 'waiting').length
          return (
            <li key={`team-${g.i}`} className="mt-1">
              <button onClick={() => setToggled((t) => ({ ...t, [g.i]: !open }))} aria-expanded={open} className="flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-left hover:bg-bg">
                <span className={`text-[10px] text-muted transition-transform ${open ? 'rotate-90' : ''}`}>▸</span>
                <span className="min-w-0 flex-1 truncate text-[12px] font-bold">{g.name}</span>
                <span className="flex-none text-[10.5px] text-muted">
                  {working ? <b className="text-blue">{working} trabajando</b> : waiting ? <b className="text-amber">{waiting} te espera{waiting > 1 ? 'n' : ''}</b> : `${g.seats.length} agente${g.seats.length > 1 ? 's' : ''}`}
                </span>
              </button>
              {open && <ul className="ml-3 border-l border-line pl-1">{g.seats.map(row)}</ul>}
            </li>
          )
        })}
      </ul>
    </section>
  )
}
