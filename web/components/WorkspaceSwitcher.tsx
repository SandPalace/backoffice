'use client'
import { useEffect, useRef, useState } from 'react'
import Modal from './Modal'
import { useBackOffice } from '@/lib/useBackOffice'
import type { Workspace } from '@/lib/types'

type Dialog = { kind: 'rename'; ws: Workspace } | null


export default function WorkspaceSwitcher() {
  const { workspaces, workspace, workspaceId, conn } = useBackOffice()
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
  const act = (d: Dialog) => { setOpen(false); setDialog(d) }
  const cur = workspace ?? workspaces.find((w) => w.id === workspaceId) ?? null

  return (
    <div ref={root} className="relative">
      <button
        ref={trigger}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={`Empresa: ${cur?.name ?? workspaceId}. Renombrar`}
        onClick={() => setOpen((o) => !o)}
        onKeyDown={(e) => { if (e.key === 'ArrowDown' && !open) { e.preventDefault(); setOpen(true) } }}
        className="flex items-center gap-2 rounded-full border border-line bg-surface px-3 py-1.5 text-xs font-semibold hover:bg-bg"
      >
        <span className="relative inline-block h-3 w-3"><i className="absolute left-0 top-0 h-[7px] w-[7px] rounded-sm bg-blue" /><i className="absolute bottom-0 right-0 h-[7px] w-[7px] rounded-sm bg-orange" /></span>
        <span className="max-w-[160px] truncate">{cur?.name ?? (conn === 'live' ? workspaceId : 'Mi empresa')}</span>
        <span aria-hidden className="text-muted">▾</span>
      </button>
      {open && (
        <div ref={menu} role="menu" aria-label="Empresa" onKeyDown={onMenuKey} className="card absolute left-0 z-40 mt-2 flex w-[min(290px,calc(100vw-2rem))] max-md:left-auto max-md:right-0 flex-col p-1 text-xs" style={{ zIndex: 2147483001 }}>
          {/* One Back Office = one company: no project list, no «nuevo», no «archivar». Another company = another Back Office folder. */}
          <div className="label px-3 pb-1 pt-2">Tu empresa</div>
          <p className="px-3 pb-2 text-[11px] leading-relaxed text-muted">Este Back Office es de una sola empresa. Para otra empresa, instala otro Back Office en su propia carpeta.</p>
          {cur && <button role="menuitem" onClick={() => act({ kind: 'rename', ws: cur })} className="rounded-sm px-3 py-2 text-left hover:bg-bg focus:bg-bg focus:outline-none">Renombrar «{cur.name}»</button>}
        </div>
      )}
      {dialog?.kind === 'rename' && <NameDialog title="Nombre de tu empresa" cta="Guardar" ws={dialog.ws} onClose={() => setDialog(null)} />}
    </div>
  )
}

function NameDialog({ title, cta, ws, onClose }: { title: string; cta: string; ws: Workspace; onClose: () => void }) {
  const { renameWorkspace } = useBackOffice()
  const [name, setName] = useState(ws.name)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!name.trim() || busy) return
    setBusy(true); setErr(null)
    try {
      await renameWorkspace(ws.id, name.trim())
      onClose()
    } catch (e2) {
      const m = (e2 as Error).message
      setErr(/exist|409|conflict/i.test(m) ? 'Ese nombre ya está en uso.' : m)
      setBusy(false)
    }
  }
  return (
    <Modal title={title} onClose={onClose} initialFocus="input">
      <form onSubmit={submit} className="flex flex-col gap-4 p-5">
        <div className="text-sm font-bold">{title}</div>
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
