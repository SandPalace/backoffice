'use client'
import { useEffect, useMemo, useRef, useState } from 'react'
import type { Output, Sprint, Task, TaskStatus } from '@/lib/types'
import { post, send, useBackOffice } from '@/lib/useBackOffice'
import { ROSTER_AGENTS } from '@/lib/roster'
import { Delivery } from './TaskBoard'
import { OutputViewer } from './FileViewer'

const COLUMNS: { status: TaskStatus; title: string; hint: string; dot: string }[] = [
  { status: 'backlog', title: 'Backlog', hint: 'Planeadas, todavía no listas', dot: 'bg-line' },
  { status: 'todo', title: 'Por hacer', hint: 'Esperan a un agente', dot: 'bg-muted' },
  { status: 'doing', title: 'En curso', hint: 'Un agente trabaja en ellas', dot: 'bg-blue' },
  { status: 'blocked', title: 'Atoradas', hint: 'Necesitan una respuesta tuya', dot: 'bg-red' },
  { status: 'review', title: 'Revisión', hint: 'Aprueba o pide cambios', dot: 'bg-amber' },
  { status: 'done', title: 'Aprobadas', hint: 'Ya revisaste estas', dot: 'bg-teal' },
  { status: 'cancelled', title: 'Canceladas', hint: 'Sólo tú cancelas una tarea', dot: 'bg-muted' },
]

const ago = (ts: number) => {
  const m = Math.max(0, Math.round((Date.now() - ts) / 60000))
  if (m < 1) return 'ahora'
  if (m < 60) return `hace ${m} min`
  const h = Math.round(m / 60)
  if (h < 24) return `hace ${h} h`
  return `hace ${Math.round(h / 24)} d`
}

function TaskMenu({ t, busy, projects, sprints, onMove, onMoveProject, onSprint, onDelete, onOpenChange }: { t: Task; busy: boolean; projects: { id: string; name: string }[]; sprints: Sprint[]; onMove: (s: TaskStatus) => void; onMoveProject: (id: string) => void; onSprint: (id: string | null) => void; onDelete: () => void; onOpenChange?: (open: boolean) => void }) {
  const [pos, setPos] = useState<{ x: number; y: number } | null>(null)
  useEffect(() => { onOpenChange?.(pos !== null) }, [pos]) // eslint-disable-line react-hooks/exhaustive-deps
  const btn = useRef<HTMLButtonElement>(null)
  const menu = useRef<HTMLDivElement>(null)
  const close = (refocus = true) => { setPos(null); if (refocus) btn.current?.focus() }
  const openMenu = () => {
    const r = btn.current?.getBoundingClientRect()
    if (!r) return
    setPos({ x: Math.max(8, Math.min(r.right - 190, window.innerWidth - 198)), y: Math.min(r.bottom + 4, window.innerHeight - (projects.length ? 400 : 250)) })
  }
  useEffect(() => {
    if (!pos) return
    menu.current?.querySelector<HTMLElement>('[role=menuitem]')?.focus()
    const away = (e: MouseEvent) => { if (!menu.current?.contains(e.target as Node) && !btn.current?.contains(e.target as Node)) setPos(null) }
    const dismiss = (e?: Event) => { if (e?.target instanceof Node && menu.current?.contains(e.target)) return; setPos(null) } // el scroll de la lista de proyectos no cierra el menú
    document.addEventListener('mousedown', away)
    window.addEventListener('scroll', dismiss, true)
    window.addEventListener('resize', dismiss)
    return () => { document.removeEventListener('mousedown', away); window.removeEventListener('scroll', dismiss, true); window.removeEventListener('resize', dismiss) }
  }, [pos])
  const onKey = (e: React.KeyboardEvent) => {
    const els = Array.from(menu.current?.querySelectorAll<HTMLElement>('[role=menuitem]') ?? [])
    const i = els.indexOf(document.activeElement as HTMLElement)
    if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); close() }
    else if (e.key === 'ArrowDown') { e.preventDefault(); els[(i + 1) % els.length]?.focus() }
    else if (e.key === 'ArrowUp') { e.preventDefault(); els[(i - 1 + els.length) % els.length]?.focus() }
    else if (e.key === 'Home') { e.preventDefault(); els[0]?.focus() }
    else if (e.key === 'End') { e.preventDefault(); els[els.length - 1]?.focus() }
    else if (e.key === 'Tab') { e.preventDefault(); close() }
  }
  const item = 'block w-full px-3 py-2 text-left text-xs font-semibold hover:bg-bg focus:bg-bg focus:outline-none'
  return (
    <>
      <button
        ref={btn}
        type="button"
        aria-label="Acciones de la tarea"
        title="Acciones de la tarea"
        aria-haspopup="menu"
        aria-expanded={pos !== null}
        disabled={busy}
        onClick={() => (pos ? close(false) : openMenu())}
        onKeyDown={(e) => { if (e.key === 'ArrowDown' && !pos) { e.preventDefault(); openMenu() } }}
        className="-mr-1 -mt-1 flex h-6 w-6 flex-none items-center justify-center rounded-sm text-base font-bold leading-none text-muted hover:bg-bg hover:text-ink focus-visible:outline focus-visible:outline-2 focus-visible:outline-blue disabled:opacity-50"
      >
        <span aria-hidden="true">⋯</span>
      </button>
      {pos && (
        <div ref={menu} role="menu" aria-label={`Acciones de ${t.title}`} onKeyDown={onKey} style={{ left: pos.x, top: pos.y }} className="fixed z-50 w-[190px] rounded-sm border border-line bg-surface py-1 shadow-lg">
          <div className="label px-3 pb-1 pt-1 !text-[10px]" aria-hidden="true">Mover a</div>
          {COLUMNS.filter((c) => c.status !== t.status).map((c) => (
            <button key={c.status} role="menuitem" tabIndex={-1} className={item} onClick={() => { close(false); onMove(c.status) }}>
              <span className={`mr-2 inline-block h-2 w-2 rounded-full ${c.dot}`} aria-hidden="true" />{c.title}
            </button>
          ))}
          {sprints.length > 0 && (
            <>
              <div role="separator" className="my-1 border-t border-line" />
              <div className="label px-3 pb-1 pt-1 !text-[10px]" aria-hidden="true">Sprint</div>
              <div role="group" aria-label="Sprint" className="max-h-36 overflow-y-auto">
                {t.sprint_id && <button role="menuitem" tabIndex={-1} className={item} onClick={() => { close(false); onSprint(null) }}>Sin sprint</button>}
                {sprints.filter((sp) => sp.id !== t.sprint_id).map((sp) => (
                  <button key={sp.id} role="menuitem" tabIndex={-1} className={`${item} truncate`} title={sp.name} onClick={() => { close(false); onSprint(sp.id) }}>{sp.name}{sp.status === 'active' ? ' · activo' : ''}</button>
                ))}
              </div>
            </>
          )}
          {projects.length > 0 && (
            <>
              <div role="separator" className="my-1 border-t border-line" />
              <div className="label px-3 pb-1 pt-1 !text-[10px]" aria-hidden="true">Mover a proyecto</div>
              <div role="group" aria-label="Mover a proyecto" className="max-h-36 overflow-y-auto">
                {projects.map((p) => (
                  <button key={p.id} role="menuitem" tabIndex={-1} className={`${item} truncate`} title={p.name} onClick={() => { close(false); onMoveProject(p.id) }}>{p.name}</button>
                ))}
              </div>
            </>
          )}
          <div role="separator" className="my-1 border-t border-line" />
          <button role="menuitem" tabIndex={-1} className={`${item} text-red`} onClick={() => { close(false); onDelete() }}>Borrar tarea</button>
        </div>
      )}
    </>
  )
}

function NewTaskForm({ status, title, onDone, onError }: { status: TaskStatus; title: string; onDone: () => void; onError: (m: string | null) => void }) {
  const [text, setText] = useState('')
  const [agent, setAgent] = useState('')
  const [saving, setSaving] = useState(false)
  const submit = async () => {
    const name = text.trim()
    if (!name || saving) return
    setSaving(true)
    onError(null)
    try {
      await post('/api/human/tasks', { title: name, status, ...(agent ? { agent } : {}) })
      onDone()
    } catch (e) {
      onError(e instanceof Error ? e.message : 'No se pudo crear la tarea')
      setSaving(false)
    }
  }
  return (
    <form
      className="mb-2 rounded-sm border border-line bg-surface p-2"
      aria-label={`Nueva tarea en ${title}`}
      onSubmit={(e) => { e.preventDefault(); void submit() }}
      onKeyDown={(e) => { if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); onDone() } }}
    >
      <input
        autoFocus
        value={text}
        maxLength={200}
        onChange={(e) => setText(e.target.value)}
        placeholder="Título de la tarea"
        aria-label="Título de la tarea"
        className="w-full rounded-sm border border-line bg-bg px-2 py-1.5 text-xs text-ink placeholder:text-muted focus:border-blue focus:outline-none"
      />
      <select
        value={agent}
        onChange={(e) => setAgent(e.target.value)}
        aria-label="Agente asignado"
        className="mt-2 w-full rounded-sm border border-line bg-bg px-2 py-1.5 text-xs text-ink focus:border-blue focus:outline-none"
      >
        <option value="">Sin asignar</option>
        {ROSTER_AGENTS.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
      </select>
      <div className="mt-2 flex justify-end gap-2">
        <button type="button" onClick={onDone} className="rounded-full border border-line px-3 py-1 text-xs font-semibold text-muted hover:text-ink">Cancelar</button>
        <button type="submit" disabled={!text.trim() || saving} className="rounded-full bg-blue px-3 py-1 text-xs font-semibold text-white hover:opacity-90 disabled:opacity-50">Crear</button>
      </div>
    </form>
  )
}

function Card({ t, projects, sprints, storyTitle, onPreview, onApprove, onMove, onMoveProject, onSprint, onDelete, busy, dragLocked, dragging, onDragStart, onDragEnd }: { t: Task; onPreview: (o: Output) => void; onApprove: (t: Task) => void; onMove: (t: Task, s: TaskStatus) => void; onMoveProject: (t: Task, id: string) => void; onSprint: (t: Task, id: string | null) => void; onDelete: (t: Task) => void; projects: { id: string; name: string }[]; sprints: Sprint[]; storyTitle: string | null; busy: boolean; dragLocked: boolean; dragging: boolean; onDragStart: (t: Task) => void; onDragEnd: () => void }) {
  const [menuOpen, setMenuOpen] = useState(false)
  const fromControl = useRef(false)
  const canDrag = !menuOpen && !busy && !dragLocked
  return (
    <li
      draggable={canDrag}
      aria-roledescription="tarjeta arrastrable"
      title="Arrástrala a otra columna o usa ⋯"
      onMouseDown={(e) => { fromControl.current = !!(e.target as HTMLElement).closest('button,a,input,select,textarea') }}
      onDragStart={(e) => {
        if (!canDrag || fromControl.current || e.target !== e.currentTarget) { e.preventDefault(); return }
        e.dataTransfer.effectAllowed = 'move'
        e.dataTransfer.setData('text/plain', t.id)
        onDragStart(t)
      }}
      onDragEnd={onDragEnd}
      className={`rounded-sm border border-line bg-surface p-3 ${canDrag ? 'cursor-grab active:cursor-grabbing' : ''} ${dragging || busy ? 'opacity-50' : ''}`}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="text-sm font-semibold leading-snug">{t.title}</div>
        <TaskMenu t={t} busy={busy} projects={projects} sprints={sprints} onOpenChange={setMenuOpen} onMove={(st) => onMove(t, st)} onMoveProject={(id) => onMoveProject(t, id)} onSprint={(id) => onSprint(t, id)} onDelete={() => onDelete(t)} />
      </div>
      {storyTitle && <div className="mt-1 truncate text-[11px] text-muted" title={`Historia: ${storyTitle}`}>↳ {storyTitle}</div>}
      <div className="mt-1 flex items-center justify-between gap-2 text-xs text-muted">
        <span className="truncate">{t.agent ?? 'Sin agente'}</span>
        <span className="flex-none">{ago(t.updated_at)}</span>
      </div>
      {t.description && t.status === 'blocked' && <p className="mt-2 rounded-sm bg-red-soft px-2 py-1.5 text-xs text-red">{t.description}</p>}
      {t.outputs.length > 0 && (
        <div className="mt-3 border-t border-line pt-2">
          <div className="label mb-1 !text-[10px]">Entregables</div>
          <ul className="flex flex-col gap-1">{t.outputs.map((o) => <Delivery key={o.id} o={o} onPreview={onPreview} />)}</ul>
        </div>
      )}
      {t.cancel_proposal && (t.status === 'review' || t.status === 'cancelled') && (
        <p className="mt-2 rounded-sm bg-amber-soft px-2 py-1.5 text-xs text-amber">{t.status === 'review' ? 'Propone cancelarla: ' : 'Motivo: '}{t.cancel_proposal}</p>
      )}
      {t.status === 'review' && t.cancel_proposal && (
        <div className="mt-3 flex flex-col gap-1.5">
          <button className="w-full rounded-full bg-ink px-3 py-2 text-xs font-semibold text-bg hover:opacity-90 disabled:opacity-50" disabled={busy} onClick={() => onMove(t, 'cancelled')}>Cancelar tarea</button>
          <button className="w-full rounded-full border border-line px-3 py-1.5 text-xs font-semibold hover:bg-bg disabled:opacity-50" disabled={busy} onClick={() => onMove(t, 'todo')}>Seguir con ella</button>
        </div>
      )}
      {t.status === 'review' && !t.cancel_proposal && (
        <button
          className="mt-3 w-full rounded-full bg-blue px-4 py-2 text-xs font-semibold text-white hover:opacity-90 disabled:opacity-50"
          disabled={busy}
          onClick={() => onApprove(t)}
        >
          Aprobar
        </button>
      )}
    </li>
  )
}

export default function KanbanBoard({ tasks }: { tasks: Task[] }) {
  const { workspaces, workspaceId, stories, sprints: allSprints } = useBackOffice()
  const storyTitle = useMemo(() => new Map(stories.map((s) => [s.id, s.title])), [stories])
  const sprints = useMemo(() => allSprints.filter((s) => s.status !== 'completed'), [allSprints])
  const [showCancelled, setShowCancelled] = useState(false)
  const cancelledCount = tasks.filter((t) => t.status === 'cancelled').length
  const columns = showCancelled ? COLUMNS : COLUMNS.filter((c) => c.status !== 'cancelled')
  // Mismo orden que el selector de proyectos: «personal» primero, luego alfabético.
  const projects = useMemo(() => {
    const pinned = (w: { id: string }) => (w.id === 'personal' ? 0 : 1)
    return workspaces.filter((w) => w.id !== workspaceId).map((w) => ({ id: w.id, name: w.name }))
      .sort((a, b) => pinned(a) - pinned(b) || a.name.localeCompare(b.name, 'es', { sensitivity: 'base', numeric: true }))
  }, [workspaces, workspaceId])
  const [viewing, setViewing] = useState<Output | null>(null)
  const [err, setErr] = useState<string | null>(null)
  const [busyId, setBusyId] = useState<string | null>(null)
  const [adding, setAdding] = useState<TaskStatus | null>(null)
  const [drag, setDrag] = useState<Task | null>(null)
  const [over, setOver] = useState<TaskStatus | null>(null)
  const endDrag = () => { setDrag(null); setOver(null) }
  const run = async (id: string, fn: () => Promise<unknown>) => {
    setErr(null)
    setBusyId(id)
    try {
      await fn()
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Algo falló')
    } finally {
      setBusyId(null)
    }
  }
  const approve = (t: Task) => run(t.id, () => post(`/api/human/tasks/${t.id}/approve`, { by: 'tú' }))
  const move = (t: Task, status: TaskStatus) =>
    run(t.id, () => (status === 'done' && t.status === 'review' && !t.cancel_proposal ? post(`/api/human/tasks/${t.id}/approve`, { by: 'tú' }) : send('PATCH', `/api/human/tasks/${t.id}`, { status })))
  const setSprint = (t: Task, sprint_id: string | null) => run(t.id, () => send('PATCH', `/api/human/tasks/${t.id}`, { sprint_id }))
  const moveProject = (t: Task, to: string) => {
    const name = projects.find((p) => p.id === to)?.name ?? to
    if (!window.confirm(`¿Mover «${t.title}» a «${name}»? Sus entregables se van con ella.`)) return
    void run(t.id, () => post(`/api/human/tasks/${t.id}/move-project`, { to }))
  }
  const remove = (t: Task) => {
    if (!window.confirm(`¿Borrar la tarea «${t.title}»? Se quita del tablero y sus entregables dejan de listarse aquí; los archivos guardados en Archivos no se borran.`)) return
    void run(t.id, () => send('DELETE', `/api/human/tasks/${t.id}`))
  }
  return (
    <section aria-label="Tablero Kanban de tareas">
      {err && <div role="alert" className="mb-3 rounded-sm bg-red-soft px-3 py-2 text-xs text-red">{err}</div>}
      {tasks.length === 0 && (
        <div role="status" className="card mb-4 p-5 text-sm text-muted">Todavía no hay tareas. Aparecen cuando un agente las crea con el MCP de Back Office, o crea una con el botón + de una columna.</div>
      )}
      <div className="mb-2 flex justify-end">
        <button type="button" aria-pressed={showCancelled} onClick={() => setShowCancelled((v) => !v)} className="rounded-full border border-line px-3 py-1 text-[11px] font-semibold text-muted hover:text-ink">
          {showCancelled ? 'Ocultar canceladas' : `Ver canceladas (${cancelledCount})`}
        </button>
      </div>
      <div className={`grid auto-cols-[minmax(240px,1fr)] grid-flow-col gap-3 overflow-x-auto pb-2 xl:grid-flow-row xl:overflow-visible ${showCancelled ? 'xl:grid-cols-7' : 'xl:grid-cols-6'}`}>
        {columns.map((c) => {
          const list = tasks.filter((t) => t.status === c.status).sort((a, b) => b.updated_at - a.updated_at)
          return (
            <div
              key={c.status}
              aria-label={c.title}
              onDragOver={(e) => { if (!drag) return; e.preventDefault(); e.dataTransfer.dropEffect = drag.status === c.status ? 'none' : 'move'; if (over !== c.status) setOver(c.status) }}
              onDragLeave={(e) => { if (!e.currentTarget.contains(e.relatedTarget as Node | null) && over === c.status) setOver(null) }}
              onDrop={(e) => { if (!drag) return; e.preventDefault(); const t = drag; endDrag(); if (t.status !== c.status) void move(t, c.status) }}
              className={`flex min-h-[220px] flex-col rounded-sm border p-2 ${drag && over === c.status && drag.status !== c.status ? 'border-blue bg-blue-soft/40' : 'border-line bg-bg/70'}`}
            >
              <div className="mb-2 flex items-center justify-between gap-2 px-1">
                <div className="flex items-center gap-2">
                  <span className={`h-2 w-2 rounded-full ${c.dot}`} aria-hidden="true" />
                  <h2 className="text-xs font-bold uppercase tracking-wide">{c.title}</h2>
                </div>
                <div className="flex items-center gap-1">
                  <span className="rounded-full bg-surface px-2 py-0.5 text-[11px] font-semibold text-muted">{list.length}</span>
                  <button
                    type="button"
                    aria-label={`Nueva tarea en ${c.title}`}
                    title={`Nueva tarea en ${c.title}`}
                    aria-expanded={adding === c.status}
                    onClick={() => setAdding(adding === c.status ? null : c.status)}
                    className="flex h-6 w-6 items-center justify-center rounded-sm text-base font-bold leading-none text-muted hover:bg-surface hover:text-ink focus-visible:outline focus-visible:outline-2 focus-visible:outline-blue"
                  >
                    <span aria-hidden="true">+</span>
                  </button>
                </div>
              </div>
              {adding === c.status && <NewTaskForm status={c.status} title={c.title} onDone={() => setAdding(null)} onError={setErr} />}
              {list.length === 0 && adding !== c.status ? (
                <p className="px-1 py-3 text-xs text-muted">{c.hint}</p>
              ) : (
                <ul className="flex flex-col gap-2">
                  {list.map((t) => <Card key={t.id} t={t} projects={projects} sprints={sprints} storyTitle={t.story_id ? storyTitle.get(t.story_id) ?? null : null} onSprint={setSprint} onMoveProject={moveProject} onPreview={setViewing} onApprove={approve} onMove={move} onDelete={remove} busy={busyId === t.id} dragLocked={adding !== null} dragging={drag?.id === t.id} onDragStart={setDrag} onDragEnd={endDrag} />)}
                </ul>
              )}
            </div>
          )
        })}
      </div>
      {viewing && <OutputViewer output={viewing} onClose={() => setViewing(null)} />}
    </section>
  )
}
