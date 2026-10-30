'use client'
import { useEffect, useState } from 'react'
import type { Artifact, ArtifactKind, ArtifactScope, ArtifactStatus } from '@/lib/types'
import { getJson, useBackOffice } from '@/lib/useBackOffice'
import { COO_AGENT, findAgent } from '@/lib/roster'
import CanvasDetail from './CanvasDetail'

export const ARTIFACT_STATUS: Record<ArtifactStatus, { label: string; cls: string }> = {
  draft: { label: 'Borrador', cls: 'bg-bg text-muted ring-1 ring-line' },
  in_review: { label: 'En revisión', cls: 'bg-amber-soft text-amber' },
  approved: { label: 'Aprobado', cls: 'bg-teal-soft text-teal' },
  changes_requested: { label: 'Cambios pedidos', cls: 'bg-red-soft text-red' },
}
const KIND_LABEL: Record<ArtifactKind, string> = { html: 'HTML', markdown: 'Documento', image: 'Imagen', pdf: 'PDF', csv: 'Tabla', text: 'Texto' }

export const ago = (ts: number) => {
  const m = Math.max(0, Math.round((Date.now() - ts) / 60000))
  if (m < 1) return 'ahora'
  if (m < 60) return `hace ${m} min`
  const h = Math.round(m / 60)
  if (h < 24) return `hace ${h} h`
  return `hace ${Math.round(h / 24)} d`
}

/** Nombre y cara de un agente: el que la persona le puso en un equipo de este proyecto, si no el del roster. */
export function useAgentLabel() {
  const { teams, coo } = useBackOffice()
  return (id: string | null | undefined): { name: string; face: number } => {
    if (!id) return { name: 'Sin agente', face: 0 }
    if (id === 'coo') return { name: coo?.display_name || COO_AGENT.name, face: coo?.avatar ?? COO_AGENT.face ?? 11 }
    const m = teams.flatMap((t) => t.members).find((x) => x.agent_id === id)
    const a = findAgent(id)
    return { name: m?.display_name || a?.name || id, face: m?.avatar ?? a?.face ?? 0 }
  }
}

function KindIcon({ kind }: { kind: ArtifactKind }) {
  const d: Record<ArtifactKind, string> = {
    html: 'M8 9l-3 3 3 3M16 9l3 3-3 3M13.5 7l-3 10',
    markdown: 'M7 3h7l5 5v13H7zM14 3v5h5M10 13h6M10 17h6',
    image: 'M4 5h16v14H4zM4 16l5-5 4 4 2-2 5 5M15.5 9.5h.01',
    pdf: 'M7 3h7l5 5v13H7zM14 3v5h5M9.5 15h5',
    csv: 'M4 5h16v14H4zM4 10h16M4 15h16M10 5v14',
    text: 'M7 3h7l5 5v13H7zM14 3v5h5M10 12h6M10 15h6M10 18h4',
  }
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" className="flex-none text-muted">
      <path d={d[kind]} />
    </svg>
  )
}

export function StatusChip({ status }: { status: ArtifactStatus }) {
  const s = ARTIFACT_STATUS[status]
  return <span className={`flex-none rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide ${s.cls}`}>{s.label}</span>
}

// Tablero de artefactos de un alcance (sin alcance = todo el proyecto). Se actualiza en vivo con los eventos `canvas`.
export default function CanvasBoard({ scopeType, scopeId, status, compact = false }: { scopeType?: ArtifactScope; scopeId?: string; status?: ArtifactStatus; compact?: boolean }) {
  const { workspaceId, canvasTick } = useBackOffice()
  const label = useAgentLabel()
  const [items, setItems] = useState<Artifact[] | null>(null)
  const [err, setErr] = useState<string | null>(null)
  const [open, setOpen] = useState<string | null>(null)
  useEffect(() => {
    let alive = true
    const q = new URLSearchParams()
    if (scopeType) q.set('scope_type', scopeType)
    if (scopeType && scopeId) q.set('scope_id', scopeId)
    if (status) q.set('status', status)
    getJson(`/api/workspaces/${encodeURIComponent(workspaceId)}/canvas?${q}`)
      .then((d: Artifact[]) => { if (alive) { setItems(d); setErr(null) } })
      .catch((e: Error) => { if (alive) setErr(e.message || 'No se pudo leer Boards') })
    return () => { alive = false }
  }, [workspaceId, canvasTick, scopeType, scopeId, status])

  return (
    <section aria-label="Boards">
      {err && <div role="alert" className="mb-3 rounded-sm bg-red-soft px-3 py-2 text-xs text-red">{err}</div>}
      {items === null && !err && <p role="status" className="text-sm text-muted">Cargando…</p>}
      {items?.length === 0 && (
        <div role="status" className={`${compact ? 'text-xs' : 'card p-5 text-sm'} text-muted`}>
          {compact
            ? 'Este agente todavía no ha publicado nada en su board.'
            : 'Todavía no hay nada que revisar aquí. Los agentes publican en Boards lo que necesitas ver y validar: borradores de posts, cotizaciones, reportes, diseños. Aquí los abres, comentas, apruebas o pides cambios.'}
        </div>
      )}
      {!!items?.length && (
        <ul className={`grid gap-3 ${compact ? 'sm:grid-cols-2' : 'sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4'}`}>
          {items.map((a) => {
            const who = label(a.author_agent)
            return (
              <li key={a.id}>
                <button onClick={() => setOpen(a.id)} className="flex h-full w-full flex-col gap-2 rounded-sm border border-line bg-surface p-3 text-left hover:border-blue focus-visible:outline focus-visible:outline-2 focus-visible:outline-blue">
                  <div className="flex w-full items-start justify-between gap-2">
                    <span className="flex min-w-0 items-start gap-2">
                      <KindIcon kind={a.kind} />
                      <span className="text-sm font-semibold leading-snug">{a.title}</span>
                    </span>
                    {a.is_home ? <span className="flex-none rounded-full bg-blue-soft px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-blue">Inicio</span> : <StatusChip status={a.status} />}
                  </div>
                  {a.description && !compact && <p className="line-clamp-2 text-xs text-muted">{a.description}</p>}
                  <div className="mt-auto flex w-full items-center justify-between gap-2 text-xs text-muted">
                    <span className="flex min-w-0 items-center gap-1.5">
                      <img src={`/faces/face-${who.face}.png`} alt="" className="h-5 w-5 flex-none rounded-full border border-line bg-bg object-cover" style={{ imageRendering: 'pixelated' }} />
                      <span className="truncate">{who.name}</span>
                    </span>
                    <span className="flex flex-none items-center gap-2">
                      {a.comments > 0 && (
                        <span className="flex items-center gap-0.5" title={`${a.comments} comentarios`}>
                          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M21 12a8 8 0 0 1-11.6 7.1L4 20l1-4.6A8 8 0 1 1 21 12z" /></svg>
                          {a.comments}
                        </span>
                      )}
                      <span className="rounded-full bg-bg px-1.5 py-0.5 font-mono text-[10px] font-semibold" title={KIND_LABEL[a.kind]}>v{a.current_version}</span>
                      <span>{ago(a.updated_at)}</span>
                    </span>
                  </div>
                </button>
              </li>
            )
          })}
        </ul>
      )}
      {open && <CanvasDetail id={open} onClose={() => setOpen(null)} />}
    </section>
  )
}

/** El canvas de un agente como sección plegable (Equipos): sólo pide datos al abrirse. */
export function AgentCanvasSection({ agentId, name }: { agentId: string; name: string }) {
  const [open, setOpen] = useState(false)
  return (
    <details className="group rounded-sm border border-line" onToggle={(e) => setOpen((e.currentTarget as HTMLDetailsElement).open)}>
      <summary className="cursor-pointer select-none px-3 py-2 text-xs font-semibold text-muted hover:text-ink">Board <span className="font-normal">(lo que {name} publicó para que lo revises)</span></summary>
      {open && <div className="border-t border-line p-3"><CanvasBoard scopeType="agent" scopeId={agentId} compact /></div>}
    </details>
  )
}
