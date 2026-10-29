'use client'
import { useEffect, useState } from 'react'
import Link from 'next/link'
import CanvasDetail from './CanvasDetail'
import { Preview, type ViewerFile } from './FileViewer'
import { ago, useAgentLabel } from './CanvasBoard'
import { SERVER, getJson, useBackOffice } from '@/lib/useBackOffice'
import type { HomeArtifact } from '@/lib/types'

export const HOME_PROMPT = 'arma el inicio de este proyecto'

// Inicio del proyecto: el artefacto «home» del Canvas que arma y actualiza Assistant (una página viva, sin revisión).
// Sin home todavía: un lienzo en blanco con la frase para pedírselo. Se refresca con los eventos `canvas` del SSE.
export default function ProjectHome() {
  const { workspaceId, workspace, canvasTick, conn } = useBackOffice()
  const label = useAgentLabel()
  const [home, setHome] = useState<HomeArtifact | null | undefined>(undefined)
  const [err, setErr] = useState<string | null>(null)
  const [open, setOpen] = useState(false)
  const [copied, setCopied] = useState(false)
  useEffect(() => {
    if (conn === 'down') return
    let alive = true
    getJson(`/api/workspaces/${encodeURIComponent(workspaceId)}/canvas/home`)
      .then((d: HomeArtifact | null) => { if (alive) { setHome(d); setErr(null) } })
      .catch((e: Error) => { if (alive) setErr(e.message || 'No se pudo cargar el inicio') })
    return () => { alive = false }
  }, [workspaceId, canvasTick, conn])

  const assistant = label('coo').name
  const projectName = workspace?.name ?? workspaceId
  const file: ViewerFile | null = home
    ? { name: `${home.title} v${home.current_version}`, contentType: home.content_type ?? '', size: home.size, url: `${SERVER}${home.url}`, downloadUrl: `${SERVER}${home.url}?download=1` }
    : null
  const copy = () => navigator.clipboard.writeText(HOME_PROMPT).then(() => { setCopied(true); setTimeout(() => setCopied(false), 1500) }).catch(() => {})

  return (
    <section className="card flex min-w-0 flex-col overflow-hidden" aria-label="Inicio del proyecto">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-line px-4 py-2.5">
        <div className="flex min-w-0 flex-wrap items-baseline gap-x-3 gap-y-0.5">
          <h2 className="truncate text-sm font-extrabold">{projectName}</h2>
          {home && (
            <span className="text-xs text-muted">
              Actualizado por {label(home.version_author ?? home.author_agent).name} · {ago(home.version_at ?? home.updated_at)} ·{' '}
              <span className="font-semibold text-ink">v{home.current_version}</span>
            </span>
          )}
        </div>
        <div className="flex flex-none flex-wrap items-center gap-2">
          {home && (
            <button onClick={() => setOpen(true)} className="rounded-full border border-line px-3 py-1 text-xs font-semibold hover:bg-bg">
              Historial y comentarios{home.comments ? ` (${home.comments})` : ''}
            </button>
          )}
          <Link href="/canvas" className="rounded-full border border-line px-3 py-1 text-xs font-semibold hover:bg-bg">Ver todo el Canvas</Link>
        </div>
      </div>
      {err && home === undefined ? (
        <p role="alert" className="p-5 text-sm text-red">{err}</p>
      ) : home === undefined ? (
        <p role="status" className="p-5 text-sm text-muted">Cargando…</p>
      ) : file ? (
        <div className="min-h-0 flex-1 overflow-auto">
          <Preview key={file.url} file={file} frameClass="h-[calc(100vh-15rem)] min-h-[480px]" />
        </div>
      ) : (
        // Lienzo en blanco: cuadrícula de puntos y el mensaje para pedírselo al encargado del proyecto.
        <div
          className="flex h-[calc(100vh-15rem)] min-h-[420px] items-center justify-center bg-surface p-6"
          style={{ backgroundImage: 'radial-gradient(rgb(var(--line)) 1.2px, transparent 1.2px)', backgroundSize: '22px 22px' }}
        >
          <div className="flex max-w-md flex-col items-center gap-3 rounded-sm border border-line bg-surface px-6 py-5 text-center">
            <p className="text-sm leading-relaxed">
              Este es el inicio de tu proyecto. Armarlo es trabajo del encargado del proyecto: pídeselo a él, a {assistant} o a cualquier agente: <span className="font-semibold">«{HOME_PROMPT}».</span>
            </p>
            <button onClick={copy} className="rounded-full bg-blue px-4 py-1.5 text-xs font-semibold text-white hover:opacity-90">
              {copied ? 'Copiado' : 'Copiar la frase'}
            </button>
          </div>
        </div>
      )}
      {open && home && <CanvasDetail id={home.id} onClose={() => setOpen(false)} />}
    </section>
  )
}
