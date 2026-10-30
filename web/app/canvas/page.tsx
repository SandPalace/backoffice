'use client'
import { useEffect, useMemo, useState } from 'react'
import Header from '@/components/Header'
import CanvasBoard, { ARTIFACT_STATUS, useAgentLabel } from '@/components/CanvasBoard'
import CanvasDetail from '@/components/CanvasDetail'
import { ROSTERS, ROSTER_AGENTS } from '@/lib/roster'
import { useBackOffice } from '@/lib/useBackOffice'
import type { ArtifactScope, ArtifactStatus } from '@/lib/types'

// Sin «Todo»: el Canvas siempre se ve por alcance (decisión del dueño, 22 oct 2026); abre en Proyecto.
const SCOPES: { id: ArtifactScope; label: string }[] = [
  { id: 'workspace', label: 'Empresa' },
  { id: 'team', label: 'Equipo' },
  { id: 'agent', label: 'Agente' },
]
const select = 'rounded-full border border-line bg-surface px-3 py-1.5 text-xs font-semibold text-ink outline-none focus:border-blue'

export default function CanvasPage() {
  const { conn, workspace, workspaceId, teams } = useBackOffice()
  const label = useAgentLabel()
  const [scope, setScope] = useState<ArtifactScope>('workspace')
  const [scopeId, setScopeId] = useState('')
  const [status, setStatus] = useState<ArtifactStatus | ''>('')
  // Link directo de un agente: ?ws=<proyecto>&artifact=<id> abre esa tarjeta (el proyecto lo elige useBackOffice con ?ws).
  const [linked, setLinked] = useState<{ ws: string | null; artifact: string } | null>(null)
  // «Ver su canvas» (oficina) llega con ?agent=<id>.
  useEffect(() => {
    const q = new URLSearchParams(window.location.search)
    const agent = q.get('agent')
    if (agent) { setScope('agent'); setScopeId(agent) }
    const artifact = q.get('artifact')
    if (artifact) setLinked({ ws: q.get('ws'), artifact })
  }, [])
  // Equipos del proyecto primero; luego los grupos del roster (un agente fuera de equipos publica en el de su plugin).
  const teamOptions = useMemo(() => [
    ...teams.map((t) => ({ id: t.id, name: t.name })),
    ...ROSTERS.filter((g) => !g.system).map((g) => ({ id: g.id, name: `${g.name} (roster)` })),
  ], [teams])
  const agentOptions = ROSTER_AGENTS.map((a) => ({ id: a.id, name: label(a.id).name })) // incluye a Assistant (coo)
  const pick = (s: ArtifactScope) => { setScope(s); setScopeId('') }
  return (
    <main className="mx-auto flex max-w-[1500px] flex-col gap-4 px-4 py-6 sm:px-6">
      <Header conn={conn} />
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold tracking-tight">Boards · {workspace?.name ?? workspaceId}</h1>
          <p className="mt-1 text-xs text-muted">Lo que tus agentes te piden revisar. Ábrelo, comenta, apruébalo o pide cambios: el agente se entera.</p>
        </div>
        <div className="flex flex-wrap items-center gap-2" role="group" aria-label="Filtros del Canvas">
          <div role="tablist" aria-label="Alcance" className="inline-flex rounded-full border border-line bg-surface p-1 text-xs font-semibold">
            {SCOPES.map((s) => (
              <button key={s.id} role="tab" aria-selected={scope === s.id} onClick={() => pick(s.id)} className={`rounded-full px-3 py-1 ${scope === s.id ? 'bg-ink text-bg' : 'text-muted hover:text-ink'}`}>{s.label}</button>
            ))}
          </div>
          {scope === 'team' && (
            <select aria-label="Equipo" value={scopeId} onChange={(e) => setScopeId(e.target.value)} className={select}>
              <option value="">Todos los equipos</option>
              {teamOptions.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
            </select>
          )}
          {scope === 'agent' && (
            <select aria-label="Agente" value={scopeId} onChange={(e) => setScopeId(e.target.value)} className={select}>
              <option value="">Todos los agentes</option>
              {agentOptions.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
            </select>
          )}
          <select aria-label="Estado" value={status} onChange={(e) => setStatus(e.target.value as ArtifactStatus | '')} className={select}>
            <option value="">Todos los estados</option>
            {(Object.keys(ARTIFACT_STATUS) as ArtifactStatus[]).map((s) => <option key={s} value={s}>{ARTIFACT_STATUS[s].label}</option>)}
          </select>
        </div>
      </div>
      <CanvasBoard scopeType={scope} scopeId={scopeId || undefined} status={status || undefined} />
      {linked && (!linked.ws || linked.ws === workspaceId) && <CanvasDetail id={linked.artifact} onClose={() => setLinked(null)} />}
    </main>
  )
}
