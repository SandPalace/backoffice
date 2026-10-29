'use client'
import { useEffect, useMemo, useRef, useState } from 'react'
import Modal from './Modal'
import { DEFAULT_WORKSPACE, useBackOffice } from '@/lib/useBackOffice'
import type { Workspace } from '@/lib/types'

type Dialog = { kind: 'create' } | { kind: 'rename'; ws: Workspace } | { kind: 'archive'; ws: Workspace } | null

const isEmpty = (w: Workspace) => w.counts.tasks + w.counts.teams + w.counts.outputs === 0

export default function WorkspaceSwitcher() {
  const { workspaces, workspace, workspaceId, setWorkspace, conn } = useBackOffice()
  const [open, setOpen] = useState(false)
  const [dialog, setDialog] = useState<Dialog>(null)
  const root = useRef<HTMLDivElement>(null)
  const trigger = useRef<HTMLButtonElement>(null)
  const menu = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent) => { if (!root.current?.contains(e.target as Node)) setOpen(false) }
    document.addEventListener('mousedown', onDown)
    // El foco va al proyecto ACTUAL (no al primero de la lista, que si no se ve como seleccionado).
    ;(menu.current?.querySelector<HTMLElement>('[aria-checked="true"]') ?? menu.current?.querySelector<HTMLElement>('[role^="menuitem"]'))?.focus()
    return () => document.removeEventListener('mousedown', onDown)
  }, [open])

  const onMenuKey = (e: React.KeyboardEvent) => {
    const items = Array.from(menu.current?.querySelectorAll<HTMLElement>('[role^="menuitem"]') ?? [])
    const i = items.indexOf(document.activeElement as HTMLElement)
    if (e.key === 'ArrowDown') { e.preventDefault(); items[(i + 1) % items.length]?.focus() }
    else if (e.key === 'ArrowUp') { e.preventDefault(); items[(i - 1 + items.length) % items.length]?.focus() }
    else if (e.key === 'Home') { e.preventDefault(); items[0]?.focus() }
    else if (e.key === 'End') { e.preventDefault(); items[items.length - 1]?.focus() }
    else if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); setOpen(false); trigger.current?.focus() }
    else if (e.key === 'Tab') setOpen(false)
  }
  const choose = (id: string) => { setWorkspace(id); setOpen(false); trigger.current?.focus() }
  const act = (d: Dialog) => { setOpen(false); setDialog(d) }
  // «Personal» siempre hasta arriba; el resto en orden alfabético sin distinguir acentos ni mayúsculas (colación en español).
  const sortedWorkspaces = useMemo(() => {
    const pinned = (w: Workspace) => (w.id === 'personal' ? 0 : 1)
    return [...workspaces].sort((a, b) => pinned(a) - pinned(b) || a.name.localeCompare(b.name, 'es', { sensitivity: 'base', numeric: true }))
  }, [workspaces])
  const cur = workspace ?? workspaces.find((w) => w.id === workspaceId) ?? null

  return (
    <div ref={root} className="relative">
      <button
        ref={trigger}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={`Espacio de trabajo: ${cur?.name ?? workspaceId}. Cambiar`}
        onClick={() => setOpen((o) => !o)}
        onKeyDown={(e) => { if (e.key === 'ArrowDown' && !open) { e.preventDefault(); setOpen(true) } }}
        className="flex items-center gap-2 rounded-full border border-line bg-surface px-3 py-1.5 text-xs font-semibold hover:bg-bg"
      >
        <span className="relative inline-block h-3 w-3"><i className="absolute left-0 top-0 h-[7px] w-[7px] rounded-sm bg-blue" /><i className="absolute bottom-0 right-0 h-[7px] w-[7px] rounded-sm bg-orange" /></span>
        <span className="max-w-[160px] truncate">{cur?.name ?? (conn === 'live' ? workspaceId : 'Espacio de trabajo')}</span>
        <span aria-hidden className="text-muted">▾</span>
      </button>
      {open && (
        <div ref={menu} role="menu" aria-label="Espacio de trabajo" onKeyDown={onMenuKey} className="card absolute left-0 z-40 mt-2 flex w-[min(290px,calc(100vw-2rem))] max-md:left-auto max-md:right-0 flex-col p-1 text-xs" style={{ zIndex: 2147483001 }}>
          <div className="label px-3 pb-1 pt-2">Espacio de trabajo</div>
          {sortedWorkspaces.map((w) => (
            <button key={w.id} role="menuitemradio" aria-checked={w.id === workspaceId} onClick={() => choose(w.id)} className={`flex items-center justify-between gap-3 rounded-sm px-3 py-2 text-left focus:outline-none focus-visible:ring-2 focus-visible:ring-blue/40 ${w.id === workspaceId ? 'bg-blue-soft/60' : 'hover:bg-bg'}`}>
              <span className="min-w-0">
                <span className="block truncate text-[13px] font-semibold">{w.name}</span>
                <span className="block text-[11px] text-muted">{w.counts.tasks_open} abiertas · {w.counts.tasks} tareas · {w.counts.teams} equipos</span>
              </span>
              {w.id === workspaceId && <span aria-hidden className="text-blue">✓</span>}
            </button>
          ))}
          <div className="my-1 border-t border-line" />
          <button role="menuitem" onClick={() => act({ kind: 'create' })} className="rounded-sm px-3 py-2 text-left font-semibold text-blue hover:bg-bg focus:bg-bg focus:outline-none">+ Nuevo espacio de trabajo</button>
          {cur && <button role="menuitem" onClick={() => act({ kind: 'rename', ws: cur })} className="rounded-sm px-3 py-2 text-left hover:bg-bg focus:bg-bg focus:outline-none">Renombrar «{cur.name}»</button>}
          {cur && cur.id !== DEFAULT_WORKSPACE && <button role="menuitem" onClick={() => act({ kind: 'archive', ws: cur })} className="rounded-sm px-3 py-2 text-left text-red hover:bg-bg focus:bg-bg focus:outline-none">Archivar «{cur.name}»…</button>}
        </div>
      )}
      {dialog?.kind === 'create' && <NameDialog title="Nuevo espacio de trabajo" cta="Crear y abrir" onClose={() => setDialog(null)} />}
      {dialog?.kind === 'rename' && <NameDialog title="Renombrar espacio de trabajo" cta="Guardar" ws={dialog.ws} onClose={() => setDialog(null)} />}
      {dialog?.kind === 'archive' && <ArchiveDialog ws={dialog.ws} onClose={() => setDialog(null)} />}
    </div>
  )
}

function NameDialog({ title, cta, ws, onClose }: { title: string; cta: string; ws?: Workspace; onClose: () => void }) {
  const { createWorkspace, renameWorkspace, setWorkspace } = useBackOffice()
  const [name, setName] = useState(ws?.name ?? '')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!name.trim() || busy) return
    setBusy(true); setErr(null)
    try {
      if (ws) await renameWorkspace(ws.id, name.trim())
      else { const w = await createWorkspace(name.trim()); setWorkspace(w.id) }
      onClose()
    } catch (e2) {
      const m = (e2 as Error).message
      setErr(/exist|409|conflict/i.test(m) ? 'Ya existe un espacio de trabajo con ese nombre.' : m)
      setBusy(false)
    }
  }
  return (
    <Modal title={title} onClose={onClose} initialFocus="input">
      <form onSubmit={submit} className="flex flex-col gap-4 p-5">
        <div className="text-sm font-bold">{title}</div>
        {!ws && <p className="text-xs leading-relaxed text-muted">Un espacio de trabajo separa equipos, tareas, entregables y archivos de una cuenta o proyecto. Empieza vacío; Assistant, la de la recepción, es la misma en todos tus proyectos.</p>}
        <label className="flex flex-col gap-1.5">
          <span className="label">Nombre</span>
          <input value={name} onChange={(e) => setName(e.target.value)} maxLength={80} placeholder="Ej. Mi inmobiliaria" className="rounded-sm border border-line px-3 py-2 text-sm outline-none focus:border-blue" />
        </label>
        {err && <div role="alert" className="rounded-sm bg-red-soft px-3 py-2 text-xs text-red">{err}</div>}
        <div className="flex justify-end gap-2">
          <button type="button" onClick={onClose} className="rounded-full border border-line px-4 py-2 text-xs font-semibold hover:bg-bg">Cancelar</button>
          <button type="submit" disabled={!name.trim() || busy} className="rounded-full bg-blue px-4 py-2 text-xs font-semibold text-white disabled:opacity-40">{busy ? 'Guardando…' : cta}</button>
        </div>
      </form>
    </Modal>
  )
}

function ArchiveDialog({ ws, onClose }: { ws: Workspace; onClose: () => void }) {
  const { archiveWorkspace } = useBackOffice()
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const empty = isEmpty(ws)
  const go = async () => {
    setBusy(true); setErr(null)
    try { await archiveWorkspace(ws.id, !empty); onClose() } catch (e) { setErr((e as Error).message); setBusy(false) }
  }
  return (
    <Modal title="Archivar espacio de trabajo" onClose={onClose} initialFocus="[data-cancel]">
      <div className="flex flex-col gap-4 p-5">
        <div className="text-sm font-bold">¿Archivar «{ws.name}»?</div>
        <p className="text-xs leading-relaxed text-muted">
          Deja de aparecer en la lista y vuelves al espacio «Default». <strong className="text-ink">No se borra ningún archivo</strong>: las tareas, los entregables, las carpetas en tu disco y los archivos guardados en Back Office quedan intactos. Si creas un espacio con el mismo identificador, se reactiva.
        </p>
        {!empty && <p className="rounded-sm bg-amber-soft px-3 py-2 text-xs text-ink">Tiene {ws.counts.tasks} {ws.counts.tasks === 1 ? 'tarea' : 'tareas'}, {ws.counts.teams} {ws.counts.teams === 1 ? 'equipo' : 'equipos'} y {ws.counts.outputs} {ws.counts.outputs === 1 ? 'entregable' : 'entregables'}.</p>}
        {err && <div role="alert" className="rounded-sm bg-red-soft px-3 py-2 text-xs text-red">{err}</div>}
        <div className="flex justify-end gap-2">
          <button data-cancel onClick={onClose} className="rounded-full border border-line px-4 py-2 text-xs font-semibold hover:bg-bg">Cancelar</button>
          <button onClick={go} disabled={busy} className="rounded-full bg-red px-4 py-2 text-xs font-semibold text-white disabled:opacity-40">{busy ? 'Archivando…' : 'Archivar'}</button>
        </div>
      </div>
    </Modal>
  )
}
