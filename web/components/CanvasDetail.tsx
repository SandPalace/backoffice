'use client'
import { useEffect, useState } from 'react'
import Link from 'next/link'
import Modal from './Modal'
import { Preview, type ViewerFile } from './FileViewer'
import { ARTIFACT_STATUS, StatusChip, ago, useAgentLabel } from './CanvasBoard'
import { formatSize } from '@/lib/files'
import { ROSTERS } from '@/lib/roster'
import { SERVER, getJson, post, useBackOffice } from '@/lib/useBackOffice'
import type { ArtifactDetail, TaskStatus } from '@/lib/types'

const TASK_STATUS: Record<TaskStatus, string> = { todo: 'Por hacer', doing: 'En curso', blocked: 'Atorada', review: 'En revisión', done: 'Aprobada' }
const SCOPE_LABEL = { workspace: 'Proyecto', team: 'Equipo', agent: 'Agente' } as const

// Detalle de un artefacto: vista de la versión elegida, versiones, hilo de comentarios y la decisión de la persona.
// Aprobar el artefacto NO cierra su tarea: la tarea se aprueba aparte (botón propio, igual que en Tareas).
export default function CanvasDetail({ id, onClose }: { id: string; onClose: () => void }) {
  const { workspaceId, canvasTick, tasks, teams } = useBackOffice()
  const label = useAgentLabel()
  const [a, setA] = useState<ArtifactDetail | null>(null)
  const [err, setErr] = useState<string | null>(null)
  const [sel, setSel] = useState<number | null>(null)
  const [text, setText] = useState('')
  const [busy, setBusy] = useState(false)
  const base = `/api/workspaces/${encodeURIComponent(workspaceId)}/canvas/${encodeURIComponent(id)}`
  useEffect(() => {
    let alive = true
    getJson(base)
      .then((d: ArtifactDetail) => { if (alive) { setA(d); setErr(null) } })
      .catch((e: Error) => { if (alive) setErr(e.message || 'No se pudo abrir el artefacto') })
    return () => { alive = false }
  }, [base, canvasTick])

  const n = sel ?? a?.current_version ?? 0
  const v = a?.versions.find((x) => x.n === n) ?? null
  const file: ViewerFile | null = a && v ? { name: `${a.title} v${v.n}`, contentType: v.content_type, size: v.size, url: `${SERVER}${v.url}`, downloadUrl: `${SERVER}${v.url}?download=1` } : null
  // La tarea ligada, en vivo desde el tablero (si no está en este proyecto, la del detalle).
  const task = a?.task_id ? tasks.find((t) => t.id === a.task_id) ?? a.task : null
  const scopeName = !a ? '' : a.scope_type === 'agent' ? label(a.scope_id).name : a.scope_type === 'team' ? teams.find((t) => t.id === a.scope_id)?.name ?? ROSTERS.find((g) => g.id === a.scope_id)?.name ?? a.scope_id : ''

  const run = async (fn: () => Promise<unknown>, clear = true) => {
    setBusy(true); setErr(null)
    try {
      const d = await fn()
      if (d && typeof d === 'object' && 'versions' in (d as object)) setA(d as ArtifactDetail)
      if (clear) setText('')
    } catch (e) { setErr((e as Error).message) } finally { setBusy(false) }
  }
  const comment = () => run(() => post(`${base}/comments`, { body: text.trim() }))
  const decide = (decision: 'approved' | 'changes_requested') => run(() => post(`${base}/decision`, { decision, ...(text.trim() ? { comment: text.trim() } : {}) }))
  const approveTask = () => task && run(() => post(`/api/human/tasks/${task.id}/approve`, { by: 'tú' }), false)

  return (
    <Modal title={a ? `Canvas: ${a.title}` : 'Canvas'} onClose={onClose} wide>
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line px-4 py-3">
        <div className="min-w-0">
          <div className="label">Canvas · {a ? (a.is_home ? 'Inicio del proyecto' : a.scope_type === 'workspace' ? SCOPE_LABEL.workspace : `${SCOPE_LABEL[a.scope_type]}: ${scopeName}`) : ''}</div>
          <div className="flex items-center gap-2">
            <h2 className="truncate text-sm font-bold">{a?.title ?? 'Cargando…'}</h2>
            {a && !a.is_home && <StatusChip status={a.status} />}
          </div>
        </div>
        <div className="flex flex-none items-center gap-2">
          {a && a.versions.length > 1 && (
            <select aria-label="Versión" value={n} onChange={(e) => setSel(Number(e.target.value))} className="rounded-full border border-line bg-surface px-2 py-1 text-xs font-semibold">
              {[...a.versions].reverse().map((x) => <option key={x.n} value={x.n}>v{x.n}{x.n === a.current_version ? ' (actual)' : ''}</option>)}
            </select>
          )}
          {file && <a href={file.url} target="_blank" rel="noopener noreferrer" className="rounded-full border border-line px-3 py-1 text-xs font-semibold hover:bg-bg">Abrir</a>}
          {file && <a href={file.downloadUrl} className="rounded-full border border-line px-3 py-1 text-xs font-semibold hover:bg-bg">Descargar</a>}
          <button onClick={onClose} className="rounded-full bg-ink px-3 py-1 text-xs font-semibold text-bg">Cerrar · Esc</button>
        </div>
      </div>
      <div className="flex min-h-0 flex-1 flex-col overflow-hidden md:flex-row">
        <div className="min-h-[240px] min-w-0 flex-1 overflow-auto border-b border-line md:border-b-0 md:border-r">
          {err && !a ? <p role="alert" className="p-5 text-sm text-red">{err}</p>
            : !file ? <p role="status" className="p-5 text-sm text-muted">Cargando…</p>
            : <Preview key={file.url} file={file} />}
        </div>
        {a && (
          <aside className="flex max-h-[70vh] min-h-0 w-full flex-none flex-col md:max-h-none md:w-[320px]" aria-label="Revisión">
            {/* Datos e hilo se desplazan; el formulario de decisión queda siempre a la vista */}
            <div className="min-h-0 flex-1 overflow-y-auto">
            <div className="flex flex-col gap-2 border-b border-line p-4 text-xs">
              <div className="flex items-center gap-2">
                <img src={`/faces/face-${label(a.author_agent).face}.png`} alt="" className="h-6 w-6 rounded-full border border-line bg-bg object-cover" style={{ imageRendering: 'pixelated' }} />
                <span><span className="font-semibold">{label(a.author_agent).name}</span> <span className="text-muted">· v{a.current_version} · {ago(a.updated_at)}</span></span>
              </div>
              {a.description && <p className="leading-relaxed">{a.description}</p>}
              {v?.note && <p className="text-muted">Nota de v{v.n}: {v.note}</p>}
              {v && <p className="text-muted">{formatSize(v.size)}{v.n !== a.current_version ? ' · versión anterior' : ''}</p>}
              {task && (
                <div className="mt-1 rounded-sm border border-line p-2">
                  <div className="label !text-[10px]">Tarea ligada</div>
                  <div className="font-semibold">{task.title}</div>
                  <div className="mt-1 flex flex-wrap items-center gap-2">
                    <span className="text-muted">{TASK_STATUS[task.status]}</span>
                    <Link href="/tareas" className="font-semibold text-blue hover:underline">Ver en Tareas</Link>
                    {task.status === 'review' && <button disabled={busy} onClick={approveTask} className="rounded-full border border-line px-2 py-0.5 font-semibold hover:bg-bg disabled:opacity-50">Aprobar tarea</button>}
                  </div>
                  <p className="mt-1 text-[11px] text-muted">Aprobar el artefacto no cierra la tarea.</p>
                </div>
              )}
            </div>
            <ol className="flex flex-col gap-2 p-4" aria-label="Comentarios">
              {a.comments.length === 0 && <li className="text-xs text-muted">Sin comentarios todavía.</li>}
              {a.comments.map((c) => {
                const human = c.author === 'humano'
                return (
                  <li key={c.id} className={`rounded-sm px-3 py-2 text-xs ${human ? 'bg-blue-soft' : 'bg-bg'}`}>
                    <div className="flex items-center justify-between gap-2 text-[11px] text-muted">
                      <span className="font-semibold text-ink">{human ? 'Tú' : label(c.author).name}{c.version_n ? ` · v${c.version_n}` : ''}</span>
                      <span>{ago(c.created_at)}</span>
                    </div>
                    {c.decision && <div className={`mt-1 inline-block rounded-full px-2 py-0.5 text-[10px] font-bold uppercase ${ARTIFACT_STATUS[c.decision].cls}`}>{c.decision === 'approved' ? 'Aprobó' : 'Pidió cambios'}</div>}
                    {c.body && <p className="mt-1 whitespace-pre-wrap break-words leading-relaxed">{c.body}</p>}
                  </li>
                )
              })}
            </ol>
            </div>
            <form className="flex flex-none flex-col gap-2 border-t border-line p-4" onSubmit={(e) => { e.preventDefault(); if (text.trim()) void comment() }}>
              <label htmlFor="canvas-comment" className="text-xs font-semibold text-muted">Comentario para {label(a.author_agent).name}</label>
              <textarea id="canvas-comment" value={text} onChange={(e) => setText(e.target.value)} rows={3} maxLength={4000} placeholder="Qué te gusta, qué cambiarías…" className="resize-y rounded-sm border border-line bg-surface px-3 py-2 text-xs leading-relaxed outline-none focus:border-blue" />
              {err && <p role="alert" className="text-xs text-red">{err}</p>}
              <div className="flex flex-wrap justify-end gap-2">
                <button type="submit" disabled={busy || !text.trim()} className="rounded-full border border-line px-3 py-1 text-xs font-semibold hover:bg-bg disabled:opacity-40">Comentar</button>
                {/* El inicio del proyecto es una página viva: sólo se comenta (Assistant publica la versión nueva) */}
                {!a.is_home && <button type="button" disabled={busy || !text.trim()} title={!text.trim() ? 'Escribe qué hay que cambiar' : undefined} onClick={() => decide('changes_requested')} className="rounded-full bg-red-soft px-3 py-1 text-xs font-semibold text-red hover:opacity-90 disabled:opacity-40">Pedir cambios</button>}
                {!a.is_home && <button type="button" disabled={busy || a.status === 'approved'} onClick={() => decide('approved')} className="rounded-full bg-blue px-3 py-1 text-xs font-semibold text-white hover:opacity-90 disabled:opacity-40">Aprobar</button>}
              </div>
            </form>
          </aside>
        )}
      </div>
    </Modal>
  )
}
