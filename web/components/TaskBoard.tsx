'use client'
import Link from 'next/link'
import { useEffect, useRef, useState } from 'react'
import type { Output, Task, TaskStatus } from '@/lib/types'
import { SERVER, getCurrentWorkspace, post } from '@/lib/useBackOffice'
import { archivosHref, deliveryFolder, formatSize, outputFileUrl, previewKind, safeLink, storageBadge } from '@/lib/files'
import { OutputViewer } from './FileViewer'

const ORDER: TaskStatus[] = ['review', 'blocked', 'doing', 'todo', 'done']
const TITLE: Record<TaskStatus, string> = {
  review: 'Revisión',
  blocked: 'Atoradas',
  doing: 'En curso',
  todo: 'Por hacer',
  done: 'Aprobadas',
}
const PILL: Record<TaskStatus, string> = {
  review: 'bg-amber-soft text-amber',
  blocked: 'bg-red-soft text-red',
  doing: 'bg-blue-soft text-blue',
  todo: 'bg-bg text-muted',
  done: 'bg-teal-soft text-teal',
}

const base = (p: string | null) => (p ?? '').split('/').filter(Boolean).pop() ?? p ?? ''
const BADGE: Record<string, string> = { stored: 'bg-teal-soft text-teal', error: 'bg-red-soft text-red', link: 'bg-blue-soft text-blue' }

export function Delivery({ o, onPreview }: { o: Output; onPreview: (o: Output) => void }) {
  const name = o.title ?? base(o.path)
  const badge = storageBadge(o)
  const link = o.kind === 'link' && o.path ? safeLink(o.path) : null
  const isFolder = o.kind === 'folder'
  const ws = getCurrentWorkspace()
  const previewable = !isFolder && o.kind !== 'link' && previewKind(o.content_type, o.storage_key ?? o.path ?? '') !== 'none'
  const folder = o.kind === 'link' ? null : deliveryFolder(o.storage_key)
  const btn = 'rounded-full border border-line px-2.5 py-0.5 text-[11px] font-semibold hover:bg-bg'
  return (
    <li className="flex flex-col gap-1.5 rounded-sm bg-bg/60 px-2.5 py-2 text-xs">
      <div className="flex items-start justify-between gap-2">
        <span className="min-w-0">
          <span className="font-mono text-[10px] uppercase text-muted">{o.kind}</span> <span className="font-semibold">{name}</span>
          {o.size != null && o.kind !== 'link' && <span className="ml-1 text-muted">{formatSize(o.size)}</span>}
        </span>
        <span className="flex flex-none flex-col items-end gap-1">
          {badge && <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${BADGE[badge.kind]}`} title={o.storage_error ?? undefined}>{badge.label}</span>}
          {!o.exists && o.kind !== 'link' && !o.stored && <span className="text-red">no existe</span>}
        </span>
      </div>
      {o.storage_error && <div className="text-[11px] text-red">{o.storage_error}</div>}
      <div className="flex flex-wrap gap-1.5">
        {o.kind === 'link' ? (
          link ? <a href={link} target="_blank" rel="noopener noreferrer" className={btn}>Abrir enlace</a> : <span className="text-muted">Enlace no válido</span>
        ) : (
          <>
            {(previewable || isFolder) && <button className={btn} onClick={() => onPreview(o)}>{isFolder ? 'Ver archivos' : 'Vista previa'}</button>}
            {!isFolder && <a className={btn} href={outputFileUrl(SERVER, ws, o.id)} target="_blank" rel="noopener noreferrer">Abrir</a>}
            {!isFolder && <a className={btn} href={outputFileUrl(SERVER, ws, o.id, { download: true })}>Descargar</a>}
            {folder && <Link className={btn} href={archivosHref(folder)}>Ver en Archivos</Link>}
          </>
        )}
      </div>
    </li>
  )
}

export default function TaskBoard({ tasks, selectedId }: { tasks: Task[]; selectedId: string | null }) {
  const [err, setErr] = useState<string | null>(null)
  const [viewing, setViewing] = useState<Output | null>(null)
  const refs = useRef<Record<string, HTMLLIElement | null>>({})
  // Al tocar una nota en la pared, la tarea se resalta y se muestra.
  useEffect(() => {
    if (selectedId) refs.current[selectedId]?.scrollIntoView({ block: 'nearest', behavior: 'smooth' })
  }, [selectedId])
  const run = async (fn: () => Promise<unknown>) => {
    setErr(null)
    try {
      await fn()
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Algo falló')
    }
  }

  return (
    <section className="card p-4">
      <div className="label mb-3">Tareas</div>
      {err && <div className="mb-3 rounded-sm bg-red-soft px-3 py-2 text-xs text-red">{err}</div>}
      {tasks.length === 0 && <p className="text-sm text-muted">Todavía no hay tareas. Aparecen cuando un agente las crea con el MCP de Back Office.</p>}
      <div className="flex flex-col gap-5">
        {ORDER.map((st) => {
          const list = tasks.filter((t) => t.status === st)
          if (!list.length) return null
          return (
            <div key={st}>
              <div className="mb-2 flex items-center gap-2">
                <span className="text-xs font-semibold">{TITLE[st]}</span>
                <span className="text-xs text-muted">{list.length}</span>
              </div>
              <ul className="flex flex-col gap-2">
                {list.map((t) => (
                  <li key={t.id} ref={(el) => { refs.current[t.id] = el }} className={`rounded-sm border p-3 ${t.id === selectedId ? 'border-blue bg-blue-soft/40' : 'border-line'}`}>
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <div className="text-sm font-semibold leading-snug">{t.title}</div>
                        <div className="mt-0.5 text-xs text-muted">{t.agent ?? 'Sin agente'}</div>
                      </div>
                      <span className={`flex-none rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${PILL[t.status]}`}>{TITLE[t.status]}</span>
                    </div>

                    {(t.outputs.length > 0 || t.output_dir) && (
                      <div className="mt-3 border-t border-line pt-2">
                        <div className="label mb-1 !text-[10px]">Entregables</div>
                        <ul className="flex flex-col gap-1">
                          {t.outputs.map((o) => <Delivery key={o.id} o={o} onPreview={setViewing} />)}
                        </ul>
                        {t.output_dir && (t.outputs.length === 0 || t.outputs.some((o) => !o.virtual)) && (
                          <div className="mt-2">
                            <button
                              className="rounded-full border border-line px-3 py-1 text-[11px] font-semibold hover:bg-bg"
                              title={t.output_dir}
                              onClick={() => run(() => post('/api/human/open', { path: t.output_dir }))}
                            >
                              Abrir carpeta en tu equipo
                            </button>
                          </div>
                        )}
                      </div>
                    )}

                    {t.status === 'review' && (
                      <button
                        className="mt-3 w-full rounded-full bg-blue px-4 py-2 text-xs font-semibold text-white hover:opacity-90"
                        onClick={() => run(() => post(`/api/human/tasks/${t.id}/approve`, { by: 'tú' }))}
                      >
                        Aprobar
                      </button>
                    )}
                  </li>
                ))}
              </ul>
            </div>
          )
        })}
      </div>
      {viewing && <OutputViewer output={viewing} onClose={() => setViewing(null)} />}
    </section>
  )
}
