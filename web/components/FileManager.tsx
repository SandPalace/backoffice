'use client'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { FileViewer, type EditConfig, type ViewerFile } from './FileViewer'
import { CollisionModal, MoveModal, NewFolderModal, RenameModal } from './FileDialogs'
import {
  FILES_ROOT, MAX_EDIT_BYTES, ZONE_LABEL, baseName, childrenOf, dirOfKey, folderPrefixes, folderDepth, formatSize, isEditable, objectUrl,
  parentPrefix, previewKind, searchEntries, sortRows, stripSlash, trashItems, uniqueName, zipUrl, zoneCrumbs, zoneOf, zoneRoot,
} from '@/lib/files'
import type { FileEntry, FolderEntry, SortDir, SortField, TrashItem, Zone } from '@/lib/files'
import { ApiError, createFolder, listAll, moveKey, restoreFromTrash, restoredSet, trashKey } from '@/lib/fileApi'
import { collectDrop, fromInput, hasFiles, useUploads, type CollisionChoice } from '@/lib/useUploads'
import { SERVER, useBackOffice } from '@/lib/useBackOffice'

interface Row {
  id: string
  kind: 'folder' | 'file'
  name: string
  /** file key or folder prefix (for trash rows: the key inside trash/) */
  key: string
  size?: number
  last_modified?: string | number | null
  content_type?: string
  count?: number
  trash?: TrashItem
}

interface Toast { id: number; kind: 'info' | 'error' | 'undo'; text: string; undo?: () => void }

const fmtDate = (v: string | number | null | undefined) => {
  if (v == null) return ''
  const d = new Date(v)
  return Number.isNaN(d.getTime()) ? '' : d.toLocaleString('es-MX', { dateStyle: 'medium', timeStyle: 'short' })
}
const BTN = 'rounded-full border border-line bg-surface px-3 py-1.5 text-xs font-semibold hover:bg-bg disabled:opacity-40'
// Controles de la barra de herramientas: misma altura (h-8) y jerarquía primario / secundario / silencioso.
const TB = 'inline-flex h-8 items-center justify-center gap-1.5 rounded-full text-xs font-semibold disabled:opacity-40 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue'
const TB_PRIMARY = `${TB} bg-blue px-4 text-white hover:opacity-90`
const TB_QUIET = `${TB} border border-line bg-transparent px-3 text-ink hover:bg-bg`
const TB_ICON = `${TB} w-8 border border-line bg-transparent text-muted hover:bg-bg hover:text-ink`
function Ico({ d, className = 'h-3.5 w-3.5' }: { d: string; className?: string }) {
  return <svg aria-hidden viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={`flex-none ${className}`}><path d={d} /></svg>
}
const ICO = {
  upload: 'M12 16V4m0 0-4 4m4-4 4 4M4 16v3a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-3',
  folderUp: 'M3 6a1 1 0 0 1 1-1h5l2 2h8a1 1 0 0 1 1 1v9a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1zM12 16v-5m0 0-2 2m2-2 2 2',
  folderPlus: 'M3 6a1 1 0 0 1 1-1h5l2 2h8a1 1 0 0 1 1 1v9a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1zM12 10v5m-2.5-2.5h5',
  search: 'M11 4a7 7 0 1 0 0 14 7 7 0 0 0 0-14zm9 16-4-4',
  list: 'M8 6h12M8 12h12M8 18h12M4 6h.01M4 12h.01M4 18h.01',
  grid: 'M4 4h6v6H4zM14 4h6v6h-6zM4 14h6v6H4zM14 14h6v6h-6z',
  refresh: 'M20 11a8 8 0 0 0-14.9-3M4 4v4h4M4 13a8 8 0 0 0 14.9 3M20 20v-4h-4',
  up: 'M12 19V5m0 0-5 5m5-5 5 5',
  down: 'M12 5v14m0 0-5-5m5 5 5-5',
}
const ICON_TONE: Record<string, string> = { image: 'bg-purple', markdown: 'bg-blue', text: 'bg-muted', csv: 'bg-teal', html: 'bg-orange', pdf: 'bg-red', none: 'bg-muted' }

function FolderGlyph({ big }: { big?: boolean }) {
  return <svg aria-hidden viewBox="0 0 24 20" className={big ? 'h-12 w-14' : 'h-4 w-5'}><path d="M1 3a2 2 0 0 1 2-2h6l2 2h10a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2z" fill="#F5A524" /></svg>
}
function FileGlyph({ row, big }: { row: Row; big?: boolean }) {
  const kind = previewKind(row.content_type, row.name)
  const ext = (row.name.split('.').pop() ?? '').slice(0, 4).toUpperCase()
  return (
    <span aria-hidden className={`flex flex-none items-center justify-center rounded-sm font-mono font-bold text-white ${ICON_TONE[kind]} ${big ? 'h-14 w-11 text-[11px]' : 'h-5 w-4 text-[6px]'}`}>
      {big ? ext : ''}
    </span>
  )
}

export default function FileManager({ prefix, navigate }: { prefix: string; navigate: (p: string) => void }) {
  const { workspaceId: ws, conn, storage, subscribeFiles } = useBackOffice()
  const zone: Zone = zoneOf(prefix)
  const root = zoneRoot(zone)
  const writable = zone === 'files'

  const [data, setData] = useState<{ ws: string; zone: Zone; files: FileEntry[]; folders: FolderEntry[]; truncated: boolean } | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<ApiError | null>(null)
  const [query, setQuery] = useState('')
  const [sort, setSort] = useState<{ field: SortField; dir: SortDir }>({ field: 'name', dir: 'asc' })
  const [mode, setMode] = useState<'list' | 'grid'>('list')
  const [sel, setSel] = useState<Set<string>>(new Set())
  const [focusId, setFocusId] = useState<string | null>(null)
  const [anchorId, setAnchorId] = useState<string | null>(null)
  const [viewing, setViewing] = useState<{ row: Row; file: ViewerFile; edit?: EditConfig } | null>(null)
  const [dialog, setDialog] = useState<null | { type: 'rename'; row: Row } | { type: 'folder' } | { type: 'move'; rows: Row[] }>(null)
  const [collision, setCollision] = useState<{ names: string[]; resolve: (c: CollisionChoice) => void } | null>(null)
  const [toasts, setToasts] = useState<Toast[]>([])
  const [menu, setMenu] = useState<null | { row: Row; x: number; y: number }>(null)
  const [dragging, setDragging] = useState(false)
  const [dropTarget, setDropTarget] = useState<string | null>(null)
  const [flash, setFlash] = useState<Set<string>>(new Set())
  const [busy, setBusy] = useState(false)

  const [trashTick, setTrashTick] = useState(0)
  const dataRef = useRef(data)
  dataRef.current = data
  const selfKeys = useRef(new Map<string, number>())
  const reqId = useRef(0)
  const dragDepth = useRef(0)
  const toastId = useRef(1)
  const fileInput = useRef<HTMLInputElement>(null)
  const dirInput = useRef<HTMLInputElement>(null)
  const rowEls = useRef(new Map<string, HTMLElement>())
  const menuOpener = useRef<HTMLElement | null>(null)

  // ---- toasts -------------------------------------------------------------------------------------------
  const toast = useCallback((kind: Toast['kind'], text: string, undo?: () => void) => {
    const id = toastId.current++
    setToasts((l) => [...l.slice(-3), { id, kind, text, undo }])
    setTimeout(() => setToasts((l) => l.filter((t) => t.id !== id)), kind === 'undo' ? 10000 : kind === 'error' ? 9000 : 4500)
  }, [])
  const dismiss = (id: number) => setToasts((l) => l.filter((t) => t.id !== id))
  const markSelf = useCallback((...keys: string[]) => { const exp = Date.now() + 6000; for (const k of keys) selfKeys.current.set(k, exp) }, [])

  // ---- loading ------------------------------------------------------------------------------------------
  const load = useCallback(async (source: 'user' | 'event' = 'user') => {
    const my = ++reqId.current
    if (source === 'user') setLoading(true)
    try {
      const r = await listAll(ws, root, zone === 'trash')
      if (my !== reqId.current) return
      const prev = dataRef.current
      if (source === 'event' && prev && prev.ws === ws && prev.zone === zone) {
        const old = new Map(prev.files.map((f) => [f.key, `${f.size}|${f.last_modified}`]))
        const now = Date.now()
        const changed = r.files.filter((f) => old.get(f.key) !== `${f.size}|${f.last_modified}` && !((selfKeys.current.get(f.key) ?? 0) > now)).map((f) => f.key)
        if (changed.length) {
          setFlash(new Set(changed))
          setTimeout(() => setFlash((cur) => (cur.size === changed.length && changed.every((k) => cur.has(k)) ? new Set() : cur)), 4500)
        }
      }
      setData({ ws, zone, files: r.files, folders: r.folders, truncated: r.truncated })
      setError(null)
    } catch (e) {
      if ((e as Error).name === 'AbortError' || my !== reqId.current) return
      setError(e instanceof ApiError ? e : new ApiError(0, (e as Error).message))
    } finally { if (my === reqId.current) setLoading(false) }
  }, [ws, root, zone])

  useEffect(() => { load('user') }, [load, conn])
  // Live updates from agents/other tabs: refresh the listing, debounced.
  useEffect(() => {
    let t: ReturnType<typeof setTimeout> | undefined
    const off = subscribeFiles((e) => {
      if (e.workspace_id && e.workspace_id !== ws) return
      clearTimeout(t)
      t = setTimeout(() => load('event'), 350)
    })
    return () => { off(); clearTimeout(t) }
  }, [subscribeFiles, ws, load])
  // Fresh folder when navigating or switching workspace.
  useEffect(() => { setSel(new Set()); setFocusId(null); setAnchorId(null); setQuery(''); setMenu(null) }, [prefix, ws])

  const ready = data && data.ws === ws && data.zone === zone ? data : null

  // ---- derived rows -------------------------------------------------------------------------------------
  const rows: Row[] = useMemo(() => {
    if (!ready) return []
    if (zone === 'trash') {
      const done = restoredSet(ws)
      const items = trashItems(ready.files).filter((i) => !done.has(i.trashKey))
      const q = query.trim().toLowerCase()
      return items.filter((i) => !q || i.name.toLowerCase().includes(q)).map((i): Row => ({
        id: i.id, kind: i.isFolder ? 'folder' : 'file', name: i.name, key: i.trashKey, size: i.size, last_modified: i.date, count: i.count, trash: i,
        content_type: ready.files.find((f) => f.key === i.trashKey)?.content_type,
      }))
    }
    const v = query.trim() ? searchEntries(prefix, ready.files, ready.folders, query) : childrenOf(prefix, ready.files, ready.folders)
    const fo = sortRows(v.folders.map((f): Row => ({ id: f.prefix, kind: 'folder', name: f.name, key: f.prefix, size: f.size, last_modified: f.last_modified, count: f.count })), sort.field, sort.dir)
    const fi = sortRows(v.files.map((f): Row => ({ id: f.key, kind: 'file', name: f.name, key: f.key, size: f.size, last_modified: f.last_modified, content_type: f.content_type })), sort.field, sort.dir)
    return [...fo, ...fi]
  }, [ready, zone, prefix, query, sort, ws, trashTick])
  const trashRows = zone === 'trash'
  const siblings = useMemo(() => new Set(ready ? [...childrenOf(prefix, ready.files, ready.folders).folders.map((f) => f.name), ...childrenOf(prefix, ready.files, ready.folders).files.map((f) => f.name)] : []), [ready, prefix])
  const existingKeys = useCallback(() => new Set((dataRef.current?.files ?? []).map((f) => f.key)), [])
  const selRows = rows.filter((r) => sel.has(r.id))
  const crumbs = zoneCrumbs(prefix)

  // ---- uploads ------------------------------------------------------------------------------------------
  const askCollision = useCallback((names: string[]) => new Promise<CollisionChoice>((resolve) => setCollision({ names, resolve })), [])
  const uploads = useUploads({
    workspace: ws, existingKeys, askCollision, limitBytes: storage?.limits?.max_file_bytes,
    onKeyDone: (k) => markSelf(k),
    onBatchEnd: (s) => {
      load('user')
      if (s.failed) toast('error', `${s.failed} ${s.failed === 1 ? 'archivo no se pudo subir' : 'archivos no se pudieron subir'}. Revisa el panel de subidas.`)
      else if (s.done) toast('info', `${s.done} ${s.done === 1 ? 'archivo subido' : 'archivos subidos'}.`)
    },
    onNotice: (t) => toast('info', t),
  })
  // Successful uploads tidy themselves away; errors stay until the person closes the panel.
  const { clearFinished } = uploads
  const idle = uploads.summary.active === 0 && uploads.items.length > 0 && uploads.summary.failed === 0
  useEffect(() => {
    if (!idle) return
    const t = setTimeout(clearFinished, 6000)
    return () => clearTimeout(t)
  }, [idle, clearFinished, uploads.items.length])
  const chooseCollision = (c: CollisionChoice) => { collision?.resolve(c); setCollision(null) }
  const uploadTo = useCallback((dest: string, files: { rel: string; file: File }[], emptyDirs: string[] = []) => {
    if (!dest.startsWith(FILES_ROOT)) return toast('error', 'Solo puedes subir archivos a «Archivos del equipo».')
    uploads.add(files, dest, emptyDirs)
  }, [uploads, toast])
  const onDrop = async (e: React.DragEvent, dest: string) => {
    if (!hasFiles(e.dataTransfer)) return
    e.preventDefault(); e.stopPropagation()
    dragDepth.current = 0; setDragging(false); setDropTarget(null)
    if (!writable) return toast('error', 'Cambia a «Archivos del equipo» para subir archivos.')
    try {
      const r = await collectDrop(e.dataTransfer)
      if (!r.files.length && !r.emptyDirs.length) return toast('info', 'No encontré archivos para subir.')
      uploadTo(dest, r.files, r.emptyDirs)
    } catch { toast('error', 'No pude leer lo que soltaste. Intenta con el botón «Subir archivos».') }
  }

  // ---- actions ------------------------------------------------------------------------------------------
  const fail = (e: unknown) => toast('error', e instanceof Error ? e.message : 'Algo falló')

  const openRow = (row: Row) => {
    if (row.kind === 'folder') {
      if (row.trash) return // trash folders are restored, not browsed
      return navigate(row.key)
    }
    const key = row.trash ? row.key : row.key
    const file: ViewerFile = { name: row.name, contentType: row.content_type ?? '', size: row.size, url: objectUrl(SERVER, ws, key), downloadUrl: objectUrl(SERVER, ws, key, true) }
    const edit: EditConfig | undefined = writable && !row.trash && isEditable(row.content_type, row.name) && (row.size ?? 0) <= MAX_EDIT_BYTES
      ? { key: row.key, contentType: row.content_type ?? 'text/plain', onSaved: () => { markSelf(row.key); load('user'); toast('info', 'Cambios guardados.') } }
      : undefined
    setViewing({ row, file, edit })
  }

  const download = (row: Row) => {
    const a = document.createElement('a')
    a.href = row.kind === 'folder' ? zipUrl(SERVER, ws, row.trash ? row.key : row.key) : objectUrl(SERVER, ws, row.key, true)
    a.download = ''
    document.body.appendChild(a); a.click(); a.remove()
  }

  const copyName = async (row: Row) => {
    try {
      await navigator.clipboard.writeText(row.name)
      toast('info', `Nombre copiado: ${row.name}`)
    } catch {
      const ta = document.createElement('textarea'); ta.value = row.name; document.body.appendChild(ta); ta.select()
      try { document.execCommand('copy'); toast('info', `Nombre copiado: ${row.name}`) } catch { toast('error', 'No pude copiar el nombre.') }
      ta.remove()
    }
  }

  const removeRows = async (list: Row[]) => {
    if (!list.length || !writable) return
    setBusy(true)
    const done: { from: string; to: string; name: string }[] = []
    let failed: string | null = null
    for (const r of list) {
      try {
        const res = await trashKey(ws, r.key)
        markSelf(...(r.kind === 'file' ? [r.key] : []))
        done.push({ from: stripSlash(r.key), to: stripSlash(res.trash_prefix), name: r.name })
      } catch (e) { failed = `No se pudo eliminar «${r.name}»: ${(e as Error).message}` }
    }
    setBusy(false)
    setSel(new Set())
    await load('user')
    if (failed) toast('error', failed)
    if (done.length) {
      toast('undo', done.length === 1 ? `«${done[0].name}» se movió a la papelera.` : `${done.length} elementos se movieron a la papelera.`, async () => {
        try { for (const d of done) await restoreFromTrash(ws, d.to, d.from); await load('user'); toast('info', 'Se restauró lo que eliminaste.') } catch (e) { fail(e) }
      })
    }
  }

  const restoreRows = async (list: Row[]) => {
    setBusy(true)
    let ok = 0
    let renamed = 0
    for (const r of list) {
      const t = r.trash
      if (!t) continue
      try {
        try { await restoreFromTrash(ws, t.trashKey, t.originalKey) } catch (e) {
          if (!(e instanceof ApiError) || e.status !== 409) throw e
          // The original place is taken: restore next to it with a numbered name.
          const dir = dirOfKey(t.originalKey)
          const tried = new Set<string>()
          let moved = false
          for (let n = 0; n < 20 && !moved; n++) {
            const name = uniqueName(baseName(t.originalKey), (c) => tried.has(c) || c === baseName(t.originalKey))
            tried.add(name)
            try { await restoreFromTrash(ws, t.trashKey, dir + name); moved = true; renamed++ } catch (e2) { if (!(e2 instanceof ApiError) || e2.status !== 409) throw e2 }
          }
          if (!moved) throw new Error('Ya existe un elemento con ese nombre.')
        }
        ok++
      } catch (e) { toast('error', `No se pudo restaurar «${r.name}»: ${(e as Error).message}`) }
    }
    setBusy(false); setSel(new Set()); setTrashTick((n) => n + 1)
    await load('user')
    if (ok) toast('info', ok === 1 ? `«${list[0].name}» se restauró${renamed ? ' con otro nombre porque ya existía uno igual' : ''}.` : `${ok} elementos restaurados${renamed ? ` (${renamed} con otro nombre)` : ''}.`)
  }

  const doRename = async (row: Row, name: string) => {
    const from = stripSlash(row.key)
    await moveKey(ws, from, dirOfKey(from) + name)
    markSelf(row.key, dirOfKey(from) + name)
    await load('user')
    toast('info', `Renombrado a «${name}».`)
  }
  const doNewFolder = async (name: string) => {
    await createFolder(ws, prefix + name)
    await load('user')
    toast('info', `Carpeta «${name}» creada.`)
  }
  const doMove = async (list: Row[], dest: string) => {
    const keys = new Set((dataRef.current?.files ?? []).map((f) => f.key))
    const names = new Set(folderPrefixes(FILES_ROOT, dataRef.current?.files ?? [], dataRef.current?.folders ?? []))
    for (const r of list) {
      const target = dest + r.name + (r.kind === 'folder' ? '/' : '')
      if ((r.kind === 'file' && keys.has(target)) || (r.kind === 'folder' && names.has(target))) throw new Error(`Ya existe «${r.name}» en la carpeta de destino.`)
    }
    let n = 0
    try {
      for (const r of list) { await moveKey(ws, stripSlash(r.key), dest + r.name); markSelf(r.key, dest + r.name); n++ }
    } finally {
      await load('user')
      setSel(new Set())
    }
    toast('info', n === 1 ? `«${list[0].name}» se movió.` : `${n} elementos movidos.`)
  }

  // ---- keyboard on rows ---------------------------------------------------------------------------------
  const focusRow = (id: string | undefined) => { if (!id) return; setFocusId(id); rowEls.current.get(id)?.focus() }
  const toggle = (id: string, on?: boolean) => setSel((s) => { const n = new Set(s); (on ?? !n.has(id)) ? n.add(id) : n.delete(id); return n })
  const onRowKey = (e: React.KeyboardEvent, row: Row, i: number) => {
    if (e.target !== e.currentTarget) return
    const cols = mode === 'grid' ? Math.max(1, Math.floor((gridRef.current?.clientWidth ?? 600) / 150)) : 1
    const go = (j: number) => { e.preventDefault(); focusRow(rows[Math.max(0, Math.min(rows.length - 1, j))]?.id) }
    const target = sel.has(row.id) && sel.size > 0 ? selRows : [row]
    switch (e.key) {
      case 'ArrowDown': return go(i + cols)
      case 'ArrowUp': return go(i - cols)
      case 'ArrowRight': if (mode === 'grid') return go(i + 1); break
      case 'ArrowLeft': if (mode === 'grid') return go(i - 1); break
      case 'Home': return go(0)
      case 'End': return go(rows.length - 1)
      case 'Enter': e.preventDefault(); return openRow(row)
      case ' ': e.preventDefault(); toggle(row.id); setAnchorId(row.id); return
      case 'Delete': case 'Backspace': if (writable) { e.preventDefault(); removeRows(target) } return
      case 'F2': if (writable) { e.preventDefault(); setDialog({ type: 'rename', row }) } return
      case 'Escape': setSel(new Set()); return
      case 'a': case 'A': if (e.metaKey || e.ctrlKey) { e.preventDefault(); setSel(new Set(rows.map((r) => r.id))) } return
      case 'ContextMenu': { e.preventDefault(); const b = e.currentTarget.getBoundingClientRect(); openMenu(row, b.left + 40, b.top + b.height / 2, e.currentTarget as HTMLElement); return }
    }
    if (e.shiftKey && e.key === 'F10') { e.preventDefault(); const b = e.currentTarget.getBoundingClientRect(); openMenu(row, b.left + 40, b.top + b.height / 2, e.currentTarget as HTMLElement) }
  }
  const gridRef = useRef<HTMLDivElement>(null)
  const onRowClick = (e: React.MouseEvent, row: Row) => {
    setFocusId(row.id)
    if (e.shiftKey && anchorId) {
      const a = rows.findIndex((r) => r.id === anchorId)
      const b = rows.findIndex((r) => r.id === row.id)
      if (a >= 0 && b >= 0) setSel(new Set(rows.slice(Math.min(a, b), Math.max(a, b) + 1).map((r) => r.id)))
    } else if (e.metaKey || e.ctrlKey) { toggle(row.id); setAnchorId(row.id) }
    else { setSel(new Set([row.id])); setAnchorId(row.id) }
  }

  // ---- context menu -------------------------------------------------------------------------------------
  const openMenu = (row: Row, x: number, y: number, opener: HTMLElement | null) => {
    menuOpener.current = opener
    if (!sel.has(row.id)) setSel(new Set([row.id]))
    setMenu({ row, x, y })
  }
  const closeMenu = (refocus = true) => { setMenu(null); if (refocus) menuOpener.current?.focus() }
  const menuItems = (row: Row): { label: string; run: () => void; danger?: boolean }[] => {
    const many = sel.has(row.id) && sel.size > 1
    const target = many ? selRows : [row]
    const items: { label: string; run: () => void; danger?: boolean }[] = []
    if (trashRows) {
      items.push({ label: many ? `Restaurar ${target.length} elementos` : 'Restaurar', run: () => restoreRows(target) })
      if (row.kind === 'file' && !many) items.push({ label: 'Vista previa', run: () => openRow(row) }, { label: 'Descargar', run: () => download(row) })
      return items
    }
    if (!many) items.push({ label: row.kind === 'folder' ? 'Abrir' : 'Vista previa', run: () => openRow(row) })
    if (!many) items.push({ label: row.kind === 'folder' ? 'Descargar como ZIP' : 'Descargar', run: () => download(row) })
    if (writable) {
      if (!many) items.push({ label: 'Renombrar · F2', run: () => setDialog({ type: 'rename', row }) })
      items.push({ label: many ? `Mover ${target.length} elementos…` : 'Mover…', run: () => setDialog({ type: 'move', rows: target }) })
    }
    if (!many) items.push({ label: 'Copiar nombre', run: () => copyName(row) })
    if (writable) items.push({ label: many ? `Eliminar ${target.length} elementos` : 'Eliminar · Supr', run: () => removeRows(target), danger: true })
    return items
  }

  // ---- render -------------------------------------------------------------------------------------------
  const headerBtn = (field: SortField, label: string) => (
    <button onClick={() => setSort((s) => ({ field, dir: s.field === field && s.dir === 'asc' ? 'desc' : 'asc' }))} className="inline-flex items-center gap-1 font-semibold hover:text-ink" aria-label={`Ordenar por ${label}`}>
      {label}{sort.field === field && <span aria-hidden>{sort.dir === 'asc' ? '↑' : '↓'}</span>}
    </button>
  )
  const empty = !!ready && rows.length === 0
  const nFolders = rows.filter((r) => r.kind === 'folder').length
  const nFiles = rows.length - nFolders
  const tree = useMemo(() => (ready && !trashRows ? folderPrefixes(root, ready.files, ready.folders) : []), [ready, trashRows, root])
  const [expanded, setExpanded] = useState<Set<string>>(new Set())
  useEffect(() => {
    // keep the path to the current folder open in the tree
    setExpanded((s) => { const n = new Set(s); for (const c of zoneCrumbs(prefix).slice(1, -1)) n.add(c.prefix); n.add(root); return n })
  }, [prefix, root])
  const visibleTree = tree.filter((p) => { const parent = parentPrefix(p); return parent === root || (expanded.has(parent) && visibleParents(parent)) })
  function visibleParents(p: string): boolean { return p === root || p === '' || (expanded.has(parentPrefix(p)) && visibleParents(parentPrefix(p))) }
  const hasChildren = (p: string) => tree.some((x) => x !== p && x.startsWith(p) && folderDepth(p, x) === 1)

  const rowProps = (row: Row, i: number) => {
    const selected = sel.has(row.id)
    const changed = flash.has(row.key) || (row.kind === 'folder' && [...flash].some((k) => k.startsWith(row.key)))
    return {
      role: 'row' as const,
      'aria-selected': selected,
      tabIndex: (focusId ?? rows[0]?.id) === row.id ? 0 : -1,
      ref: (el: HTMLElement | null) => { if (el) rowEls.current.set(row.id, el); else rowEls.current.delete(row.id) },
      onKeyDown: (e: React.KeyboardEvent) => onRowKey(e, row, i),
      onClick: (e: React.MouseEvent) => { if ((e.target as HTMLElement).closest('button,a,input,label')) return; onRowClick(e, row) },
      onDoubleClick: () => openRow(row),
      onContextMenu: (e: React.MouseEvent) => { e.preventDefault(); openMenu(row, e.clientX, e.clientY, e.currentTarget as HTMLElement) },
      onFocus: () => setFocusId(row.id),
      onDragOver: row.kind === 'folder' && writable && !row.trash ? (e: React.DragEvent) => { if (hasFiles(e.dataTransfer)) { e.preventDefault(); e.stopPropagation(); setDropTarget(row.key) } } : undefined,
      onDragLeave: row.kind === 'folder' ? () => setDropTarget((t) => (t === row.key ? null : t)) : undefined,
      onDrop: row.kind === 'folder' && writable && !row.trash ? (e: React.DragEvent) => onDrop(e, row.key) : undefined,
      selected, changed,
      cls: `${selected ? 'bg-blue-soft/60' : 'hover:bg-bg/70'} ${dropTarget === row.key ? 'outline outline-2 -outline-offset-2 outline-blue' : ''} focus-visible:outline focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-blue`,
    }
  }
  const nameCell = (row: Row) => (
    <span className="flex min-w-0 items-center gap-2">
      {row.kind === 'folder' ? <FolderGlyph /> : <FileGlyph row={row} />}
      <button onClick={() => openRow(row)} tabIndex={-1} className="min-w-0 truncate text-left font-semibold hover:text-blue" title={row.name} disabled={!!row.trash && row.kind === 'folder'}>
        {row.name}{row.kind === 'folder' && !row.trash ? '/' : ''}
      </button>
    </span>
  )
  const flashBadge = <span className="ml-2 flex-none rounded-full bg-orange-soft px-2 py-0.5 text-[10px] font-semibold text-orange">Actualizado por un agente</span>
  const menuBtn = (row: Row) => (
    <button aria-label={`Acciones de ${row.name}`} aria-haspopup="menu" tabIndex={-1} onClick={(e) => { const b = e.currentTarget.getBoundingClientRect(); openMenu(row, b.right - 190, b.bottom + 4, e.currentTarget) }} className="rounded-full px-2 py-0.5 text-base font-bold leading-none text-muted hover:bg-bg hover:text-ink">⋯</button>
  )

  const uploadingNow = uploads.summary.active > 0
  return (
    <section
      className="card relative flex min-w-0 flex-col"
      aria-label="Administrador de archivos"
      onDragEnter={(e) => { if (hasFiles(e.dataTransfer)) { dragDepth.current++; setDragging(true) } }}
      onDragOver={(e) => { if (hasFiles(e.dataTransfer)) e.preventDefault() }}
      onDragLeave={() => { dragDepth.current = Math.max(0, dragDepth.current - 1); if (!dragDepth.current) setDragging(false) }}
      onDrop={(e) => onDrop(e, writable ? prefix : FILES_ROOT)}
    >
      {/* zone tabs */}
      <div className="border-b border-line px-4 pt-2">
        <div role="tablist" aria-label="Secciones de archivos" className="flex gap-1 overflow-x-auto">
          {(['files', 'outputs', 'trash'] as Zone[]).map((z) => (
            <button key={z} role="tab" aria-selected={zone === z} onClick={() => navigate(zoneRoot(z))} className={`-mb-px flex-none whitespace-nowrap border-b-2 px-3 py-2 text-xs font-semibold focus-visible:outline focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-blue ${zone === z ? 'border-blue text-ink' : 'border-transparent text-muted hover:text-ink'}`}>{ZONE_LABEL[z]}</button>
          ))}
        </div>
      </div>

      {/* ruta: solo dentro de una subcarpeta */}
      {crumbs.length > 1 && (
        <nav aria-label="Ruta" className="flex flex-wrap items-center gap-1 border-b border-line px-4 py-1.5 text-xs">
          {crumbs.map((c, i) => (
            <span key={c.prefix} className="flex items-center gap-1">
              {i > 0 && <span aria-hidden className="text-muted">/</span>}
              <button onClick={() => navigate(c.prefix)} className={`font-semibold ${i < crumbs.length - 1 ? 'text-blue hover:underline' : 'text-ink'}`} aria-current={i === crumbs.length - 1 ? 'page' : undefined}>{c.name}</button>
            </span>
          ))}
        </nav>
      )}

      {/* toolbar */}
      <div className="flex flex-wrap items-center gap-2 border-b border-line px-4 py-2.5">
        {writable && (
          <>
            <button className={TB_PRIMARY} onClick={() => fileInput.current?.click()}><Ico d={ICO.upload} />Subir archivos</button>
            <button className={TB_QUIET} onClick={() => dirInput.current?.click()}><Ico d={ICO.folderUp} />Subir carpeta</button>
            <button className={TB_QUIET} onClick={() => setDialog({ type: 'folder' })}><Ico d={ICO.folderPlus} />Nueva carpeta</button>
          </>
        )}
        <input ref={fileInput} type="file" multiple hidden aria-label="Elegir archivos" data-testid="file-input" onChange={(e) => { uploadTo(prefix, fromInput(e.target.files)); e.target.value = '' }} />
        <input ref={dirInput} type="file" hidden aria-label="Elegir carpeta" data-testid="dir-input" {...({ webkitdirectory: '', directory: '' } as object)} onChange={(e) => { uploadTo(prefix, fromInput(e.target.files)); e.target.value = '' }} />
        <div className="ml-auto flex flex-wrap items-center gap-2">
          <div className="relative">
            <label className="sr-only" htmlFor="fm-search">Buscar por nombre</label>
            <span className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-muted"><Ico d={ICO.search} /></span>
            <input id="fm-search" type="search" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Buscar por nombre" className="h-8 w-44 rounded-full border border-line bg-transparent pl-8 pr-3 text-xs outline-none focus:border-blue max-sm:w-36" />
          </div>
          {!trashRows && (
            <div role="group" aria-label="Orden" className="flex h-8 overflow-hidden rounded-full border border-line text-xs font-semibold">
              <label className="sr-only" htmlFor="fm-sort">Ordenar por</label>
              <select id="fm-sort" value={sort.field} onChange={(e) => setSort((s) => ({ ...s, field: e.target.value as SortField }))} className="h-full bg-surface pl-3 pr-1 text-xs outline-none hover:bg-bg">
                <option value="name">Nombre</option><option value="date">Fecha</option><option value="size">Tamaño</option>
              </select>
              <button className="flex w-8 items-center justify-center border-l border-line bg-surface text-muted hover:bg-bg hover:text-ink" aria-label={sort.dir === 'asc' ? 'Orden ascendente' : 'Orden descendente'} title={sort.dir === 'asc' ? 'Orden ascendente' : 'Orden descendente'} onClick={() => setSort((s) => ({ ...s, dir: s.dir === 'asc' ? 'desc' : 'asc' }))}><Ico d={sort.dir === 'asc' ? ICO.up : ICO.down} /></button>
            </div>
          )}
          <div role="group" aria-label="Vista" className="flex h-8 overflow-hidden rounded-full border border-line text-xs font-semibold">
            <button aria-pressed={mode === 'list'} aria-label="Lista" title="Lista" onClick={() => setMode('list')} className={`inline-flex items-center gap-1.5 px-3 ${mode === 'list' ? 'bg-ink text-bg' : 'bg-surface hover:bg-bg'}`}><Ico d={ICO.list} /><span className="max-xl:sr-only">Lista</span></button>
            <button aria-pressed={mode === 'grid'} aria-label="Cuadrícula" title="Cuadrícula" onClick={() => setMode('grid')} className={`inline-flex items-center gap-1.5 border-l border-line px-3 ${mode === 'grid' ? 'bg-ink text-bg' : 'bg-surface hover:bg-bg'}`}><Ico d={ICO.grid} /><span className="max-xl:sr-only">Cuadrícula</span></button>
          </div>
          <button className={TB_ICON} aria-label="Actualizar" title="Actualizar" onClick={() => load('user')} disabled={loading}><Ico d={ICO.refresh} className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} /></button>
        </div>
      </div>

      {/* selection bar */}
      {sel.size === 0 && ready && !empty && (
        <div className="overflow-hidden text-ellipsis whitespace-nowrap border-b border-line px-4 py-1.5 text-[11px] text-muted">
          {writable ? 'Haz clic para seleccionar, doble clic para abrir. Con el teclado: flechas, Enter, F2 para renombrar y Supr para eliminar.' : 'Haz clic para seleccionar y doble clic para abrir. Con el teclado: flechas y Enter.'}
        </div>
      )}
      {sel.size > 0 && (
        <div role="toolbar" aria-label="Acciones para la selección" className="flex h-[45px] flex-nowrap items-center gap-2 overflow-x-auto border-b border-line bg-blue-soft/50 px-4 text-xs">
          <span className="font-semibold" role="status">{sel.size === 1 ? '1 seleccionado' : `${sel.size} seleccionados`}</span>
          {trashRows ? (
            <button className={BTN} disabled={busy} onClick={() => restoreRows(selRows)}>Restaurar</button>
          ) : (
            <>
              {sel.size === 1 && <button className={BTN} onClick={() => download(selRows[0])}>{selRows[0]?.kind === 'folder' ? 'Descargar ZIP' : 'Descargar'}</button>}
              {sel.size === 1 && <button className={BTN} onClick={() => copyName(selRows[0])}>Copiar nombre</button>}
              {writable && sel.size === 1 && <button className={BTN} onClick={() => setDialog({ type: 'rename', row: selRows[0] })}>Renombrar</button>}
              {writable && <button className={BTN} onClick={() => setDialog({ type: 'move', rows: selRows })}>Mover</button>}
              {writable && <button className="rounded-full border border-red bg-surface px-3 py-1.5 text-xs font-semibold text-red hover:bg-red-soft disabled:opacity-40" disabled={busy} onClick={() => removeRows(selRows)}>Eliminar</button>}
            </>
          )}
          <button className="ml-auto font-semibold text-muted hover:text-ink" onClick={() => setSel(new Set())}>Quitar selección</button>
        </div>
      )}

      <div className="flex min-h-[240px] min-w-0">
        {/* folder tree */}
        {!trashRows && tree.length > 0 && (
          <nav aria-label="Carpetas" className="hidden w-[190px] flex-none overflow-y-auto border-r border-line p-2 lg:block" style={{ maxHeight: 560 }}>
            <button onClick={() => navigate(root)} aria-current={prefix === root ? 'page' : undefined} className={`flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-left text-xs font-semibold ${prefix === root ? 'bg-blue-soft text-blue' : 'hover:bg-bg'}`}><FolderGlyph /><span className="truncate">{ZONE_LABEL[zone]}</span></button>
            <ul role="tree" aria-label="Árbol de carpetas">
              {visibleTree.map((p) => {
                const open = expanded.has(p)
                const kids = hasChildren(p)
                return (
                  <li key={p} role="treeitem" aria-expanded={kids ? open : undefined} aria-selected={p === prefix} style={{ paddingLeft: folderDepth(root, p) * 12 }}>
                    <div className={`flex items-center rounded-sm ${p === prefix ? 'bg-blue-soft text-blue' : 'hover:bg-bg'}`}>
                      <button aria-label={open ? 'Contraer' : 'Expandir'} onClick={() => setExpanded((s) => { const n = new Set(s); open ? n.delete(p) : n.add(p); return n })} className={`h-6 w-5 flex-none text-[10px] text-muted ${kids ? '' : 'invisible'}`} tabIndex={kids ? 0 : -1}>{open ? '▾' : '▸'}</button>
                      <button onClick={() => navigate(p)} className="flex min-w-0 flex-1 items-center gap-1.5 py-1.5 pr-2 text-left text-xs font-semibold"><FolderGlyph /><span className="truncate">{baseName(p)}</span></button>
                    </div>
                  </li>
                )
              })}
            </ul>
          </nav>
        )}

        <div className="min-w-0 flex-1">
          <div className="sr-only" role="status" aria-live="polite">{ready ? `${nFolders} carpetas y ${nFiles} archivos` : ''}</div>
          {loading && !ready && <p className="p-5 text-sm text-muted" role="status">Cargando archivos…</p>}
          {error && (
            <div className="m-4 rounded-sm bg-amber-soft p-4 text-sm leading-relaxed" role="alert">
              <div className="font-semibold">No se pudieron cargar los archivos</div>
              <p className="mt-1 text-xs">{error.message}</p>
              <button onClick={() => load('user')} className={`${BTN} mt-3`}>Reintentar</button>
            </div>
          )}
          {ready?.truncated && <p className="m-4 rounded-sm bg-amber-soft px-3 py-2 text-xs" role="status">Hay muchísimos archivos y no se muestran todos. Usa carpetas para organizarlos.</p>}

          {empty && !error && (
            <div className="flex flex-col items-center gap-2 px-6 py-14 text-center">
              <p className="text-sm font-semibold">
                {query ? `Nada coincide con «${query}».` : trashRows ? 'La papelera está vacía.' : zone === 'outputs' ? 'Todavía no hay entregas de tareas.' : prefix !== root ? 'Esta carpeta está vacía.' : 'Todavía no hay archivos.'}
              </p>
              <p className="max-w-sm text-xs text-muted">
                {query ? 'Prueba con otra palabra o borra la búsqueda.' : trashRows ? 'Lo que elimines se queda aquí y puedes restaurarlo.' : zone === 'outputs' ? 'Cuando un agente entregue un archivo en una tarea, lo verás aquí.' : 'Arrastra archivos o carpetas aquí, o usa «Subir archivos». Tus agentes podrán leerlos sin que des ninguna ruta.'}
              </p>
              {writable && !query && <button className="mt-2 rounded-full bg-blue px-4 py-2 text-xs font-semibold text-white" onClick={() => fileInput.current?.click()}>Subir archivos</button>}
            </div>
          )}

          {ready && !empty && mode === 'list' && (
            <div role="grid" aria-label={`Contenido de ${crumbs[crumbs.length - 1].name}`} aria-multiselectable className="text-xs">
              <div role="row" className="grid grid-cols-[28px_minmax(0,1fr)_84px_150px_40px] items-center gap-2 border-b border-line px-3 py-2 text-muted max-sm:grid-cols-[28px_minmax(0,1fr)_40px]">
                <span role="columnheader" className="flex justify-center">
                  <input type="checkbox" aria-label="Seleccionar todo" checked={sel.size > 0 && sel.size === rows.length} onChange={(e) => setSel(e.target.checked ? new Set(rows.map((r) => r.id)) : new Set())} />
                </span>
                <span role="columnheader" aria-sort={sort.field === 'name' ? (sort.dir === 'asc' ? 'ascending' : 'descending') : 'none'}>{trashRows ? 'Nombre' : headerBtn('name', 'Nombre')}</span>
                <span role="columnheader" className="max-sm:hidden" aria-sort={sort.field === 'size' ? (sort.dir === 'asc' ? 'ascending' : 'descending') : 'none'}>{trashRows ? 'Tamaño' : headerBtn('size', 'Tamaño')}</span>
                <span role="columnheader" className="max-sm:hidden" aria-sort={sort.field === 'date' ? (sort.dir === 'asc' ? 'ascending' : 'descending') : 'none'}>{trashRows ? 'Eliminado' : headerBtn('date', 'Modificado')}</span>
                <span role="columnheader"><span className="sr-only">Acciones</span></span>
              </div>
              {rows.map((row, i) => {
                const p = rowProps(row, i)
                return (
                  <div
                    key={row.id} role={p.role} aria-selected={p.selected} tabIndex={p.tabIndex} ref={p.ref} onKeyDown={p.onKeyDown} onClick={p.onClick} onDoubleClick={p.onDoubleClick}
                    onContextMenu={p.onContextMenu} onFocus={p.onFocus} onDragOver={p.onDragOver} onDragLeave={p.onDragLeave} onDrop={p.onDrop}
                    data-testid="fm-row" data-name={row.name} data-kind={row.kind}
                    className={`grid grid-cols-[28px_minmax(0,1fr)_84px_150px_40px] items-center gap-2 border-b border-line px-3 py-2 max-sm:grid-cols-[28px_minmax(0,1fr)_40px] ${p.cls} ${p.changed ? 'bg-orange-soft/70' : ''}`}
                  >
                    <span role="gridcell" className="flex justify-center"><input type="checkbox" tabIndex={-1} aria-label={`Seleccionar ${row.name}`} checked={p.selected} onChange={(e) => { toggle(row.id, e.target.checked); setAnchorId(row.id) }} /></span>
                    <span role="gridcell" className="flex min-w-0 items-center">
                      {nameCell(row)}
                      {p.changed && flashBadge}
                      {row.trash && <span className="ml-2 hidden truncate text-[11px] text-muted md:inline">en {dirOfKey(row.trash.originalKey).replace(/^files\//, '') || 'Archivos del equipo'}</span>}
                      {query && row.kind === 'file' && row.name.includes('/') && <span className="sr-only"> en {dirOfKey(row.name)}</span>}
                    </span>
                    <span role="gridcell" className="whitespace-nowrap text-muted max-sm:hidden">{row.kind === 'folder' ? (row.count != null ? `${row.count} arch.` : '—') : formatSize(row.size)}</span>
                    <span role="gridcell" className="whitespace-nowrap text-muted max-sm:hidden">{fmtDate(row.last_modified)}</span>
                    <span role="gridcell" className="flex justify-end">{menuBtn(row)}</span>
                  </div>
                )
              })}
            </div>
          )}

          {ready && !empty && mode === 'grid' && (
            <div ref={gridRef} role="grid" aria-label={`Contenido de ${crumbs[crumbs.length - 1].name}`} aria-multiselectable className="grid grid-cols-[repeat(auto-fill,minmax(138px,1fr))] gap-3 p-4">
              {rows.map((row, i) => {
                const p = rowProps(row, i)
                const img = row.kind === 'file' && previewKind(row.content_type, row.name) === 'image' && (row.size ?? 0) < 4_000_000
                return (
                  <div
                    key={row.id} role={p.role} aria-selected={p.selected} tabIndex={p.tabIndex} ref={p.ref} onKeyDown={p.onKeyDown} onClick={p.onClick} onDoubleClick={p.onDoubleClick}
                    onContextMenu={p.onContextMenu} onFocus={p.onFocus} onDragOver={p.onDragOver} onDragLeave={p.onDragLeave} onDrop={p.onDrop}
                    data-testid="fm-row" data-name={row.name} data-kind={row.kind}
                    className={`relative flex flex-col items-center gap-2 rounded-sm border px-2 pb-2 pt-3 text-center ${p.selected ? 'border-blue' : 'border-line'} ${p.cls} ${p.changed ? 'bg-orange-soft/70' : ''}`}
                  >
                    <input type="checkbox" tabIndex={-1} className="absolute left-2 top-2" aria-label={`Seleccionar ${row.name}`} checked={p.selected} onChange={(e) => { toggle(row.id, e.target.checked); setAnchorId(row.id) }} />
                    <span className="absolute right-1 top-1">{menuBtn(row)}</span>
                    <button tabIndex={-1} onClick={() => openRow(row)} className="flex h-16 w-full items-center justify-center" aria-label={`Abrir ${row.name}`} disabled={!!row.trash && row.kind === 'folder'}>
                      {img ? <img loading="lazy" src={objectUrl(SERVER, ws, row.key)} alt="" className="max-h-16 max-w-full rounded-sm object-contain" /> : row.kind === 'folder' ? <FolderGlyph big /> : <FileGlyph row={row} big />}
                    </button>
                    <span className="w-full truncate text-xs font-semibold" title={row.name}>{row.name}</span>
                    <span className="text-[10px] text-muted">{row.kind === 'folder' ? (row.count != null ? `${row.count} archivos` : '') : formatSize(row.size)}</span>
                    {p.changed && <span className="rounded-full bg-orange-soft px-2 py-0.5 text-[10px] font-semibold text-orange">Actualizado por un agente</span>}
                  </div>
                )
              })}
            </div>
          )}
        </div>
      </div>

      {zone === 'trash' && !empty && <p className="border-t border-line px-4 py-2 text-[11px] text-muted">Restaurar devuelve el elemento a su carpeta original. La papelera no se vacía desde aquí.</p>}
      {zone === 'outputs' && !empty && <p className="border-t border-line px-4 py-2 text-[11px] text-muted">Las entregas de tareas son de solo lectura. Para trabajar con una, descárgala o súbela a «Archivos del equipo».</p>}

      {/* drag overlay */}
      {dragging && writable && (
        <div className="pointer-events-none absolute inset-0 z-20 flex items-center justify-center rounded-sm border-2 border-dashed border-blue bg-blue-soft/80" aria-hidden>
          <div className="rounded-full bg-surface px-5 py-3 text-sm font-bold text-blue">Suelta para subir a «{crumbs[crumbs.length - 1].name}»</div>
        </div>
      )}

      {/* upload panel */}
      {uploads.items.length > 0 && (
        <div className="fixed bottom-4 right-4 z-40 flex max-h-[50vh] w-[min(360px,calc(100vw-2rem))] flex-col overflow-hidden rounded-sm border border-line bg-surface" role="region" aria-label="Subidas">
          <div className="flex items-center justify-between gap-2 border-b border-line px-3 py-2">
            <div role="status" aria-live="polite" className="text-xs font-semibold">
              {uploadingNow ? `Subiendo ${uploads.summary.done} de ${uploads.summary.total} · ${uploads.summary.pct}%` : `Subidas: ${uploads.summary.done} listas${uploads.summary.failed ? `, ${uploads.summary.failed} con error` : ''}`}
            </div>
            <div className="flex gap-2 text-[11px] font-semibold">
              {uploadingNow && <button className="text-red hover:underline" onClick={uploads.cancelAll}>Cancelar todo</button>}
              {!uploadingNow && <button className="text-muted hover:text-ink" onClick={uploads.clearFinished}>Cerrar</button>}
            </div>
          </div>
          <ul className="overflow-y-auto">
            {uploads.items.map((u) => (
              <li key={u.id} className="border-b border-line px-3 py-2 text-xs last:border-b-0" data-testid="upload-item" data-status={u.status}>
                <div className="flex items-center justify-between gap-2">
                  <span className="truncate font-semibold" title={u.key}>{u.name}</span>
                  <span className="flex-none text-[11px] text-muted">
                    {u.status === 'done' ? 'Listo' : u.status === 'error' ? 'Error' : u.status === 'cancelled' ? 'Cancelado' : u.status === 'queued' ? 'En espera' : `${u.size ? Math.round((u.loaded / u.size) * 100) : 100}%`}
                  </span>
                </div>
                {(u.status === 'uploading' || u.status === 'queued') && (
                  <div className="mt-1 flex items-center gap-2">
                    <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-bg" role="progressbar" aria-label={`Progreso de ${u.name}`} aria-valuemin={0} aria-valuemax={100} aria-valuenow={u.size ? Math.round((u.loaded / u.size) * 100) : 0}><div className="h-full bg-blue" style={{ width: `${u.size ? (u.loaded / u.size) * 100 : 0}%` }} /></div>
                    <button className="text-[11px] font-semibold text-red hover:underline" onClick={() => uploads.cancel(u.id)} aria-label={`Cancelar subida de ${u.name}`}>Cancelar</button>
                  </div>
                )}
                {u.status === 'error' && <p role="alert" className="mt-1 text-[11px] leading-snug text-red">{u.error}</p>}
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* toasts */}
      <div className="pointer-events-none fixed bottom-4 left-1/2 z-50 flex w-[min(460px,calc(100vw-2rem))] -translate-x-1/2 flex-col gap-2">
        {toasts.map((t) => (
          <div key={t.id} role={t.kind === 'error' ? 'alert' : 'status'} className={`pointer-events-auto flex items-center justify-between gap-3 rounded-sm border px-4 py-2.5 text-xs font-semibold ${t.kind === 'error' ? 'border-red bg-red-soft text-red' : 'border-ink bg-ink text-bg'}`}>
            <span>{t.text}</span>
            <span className="flex flex-none items-center gap-3">
              {t.undo && <button className="font-bold text-amber hover:underline" onClick={() => { const u = t.undo; dismiss(t.id); u?.() }}>Deshacer</button>}
              <button aria-label="Cerrar aviso" className="opacity-70 hover:opacity-100" onClick={() => dismiss(t.id)}>✕</button>
            </span>
          </div>
        ))}
      </div>

      {/* context menu */}
      {menu && <ContextMenu x={menu.x} y={menu.y} items={menuItems(menu.row)} onClose={closeMenu} label={`Acciones de ${menu.row.name}`} />}

      {/* dialogs and viewer */}
      {dialog?.type === 'rename' && (
        <RenameModal name={dialog.row.name} isFolder={dialog.row.kind === 'folder'} siblings={siblings} onSubmit={(n) => doRename(dialog.row, n)} onClose={() => setDialog(null)} />
      )}
      {dialog?.type === 'folder' && <NewFolderModal siblings={siblings} where={crumbs[crumbs.length - 1].name} onSubmit={doNewFolder} onClose={() => setDialog(null)} />}
      {dialog?.type === 'move' && ready && (
        <MoveModal
          count={dialog.rows.length} files={ready.files} folders={ready.folders} current={prefix}
          blocked={dialog.rows.filter((r) => r.kind === 'folder').map((r) => r.key)}
          onSubmit={(d) => doMove(dialog.rows, d)} onClose={() => setDialog(null)}
        />
      )}
      {collision && <CollisionModal names={collision.names} onChoose={chooseCollision} />}
      {viewing && <FileViewer title={viewing.row.name} files={[viewing.file]} edit={viewing.edit} onClose={() => setViewing(null)} />}
    </section>
  )
}

function ContextMenu({ x, y, items, onClose, label }: { x: number; y: number; items: { label: string; run: () => void; danger?: boolean }[]; onClose: (refocus?: boolean) => void; label: string }) {
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    ref.current?.querySelector<HTMLElement>('[role=menuitem]')?.focus()
    const away = (e: MouseEvent) => { if (!ref.current?.contains(e.target as Node)) onClose(false) }
    const esc = () => onClose(false)
    document.addEventListener('mousedown', away)
    window.addEventListener('scroll', esc, true)
    window.addEventListener('resize', esc)
    return () => { document.removeEventListener('mousedown', away); window.removeEventListener('scroll', esc, true); window.removeEventListener('resize', esc) }
  }, [onClose])
  const onKey = (e: React.KeyboardEvent) => {
    const els = Array.from(ref.current?.querySelectorAll<HTMLElement>('[role=menuitem]') ?? [])
    const i = els.indexOf(document.activeElement as HTMLElement)
    if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); onClose() }
    else if (e.key === 'ArrowDown') { e.preventDefault(); els[(i + 1) % els.length]?.focus() }
    else if (e.key === 'ArrowUp') { e.preventDefault(); els[(i - 1 + els.length) % els.length]?.focus() }
    else if (e.key === 'Tab') { e.preventDefault(); onClose() }
  }
  const left = Math.max(8, Math.min(x, (typeof window === 'undefined' ? 1000 : window.innerWidth) - 210))
  const top = Math.max(8, Math.min(y, (typeof window === 'undefined' ? 800 : window.innerHeight) - items.length * 34 - 16))
  return (
    <div ref={ref} role="menu" aria-label={label} onKeyDown={onKey} style={{ left, top }} className="fixed z-50 w-[200px] rounded-sm border border-line bg-surface py-1">
      {items.map((it) => (
        <button key={it.label} role="menuitem" tabIndex={-1} onClick={() => { onClose(false); it.run() }} className={`block w-full px-3 py-2 text-left text-xs font-semibold hover:bg-bg focus:bg-bg focus:outline-none ${it.danger ? 'text-red' : ''}`}>{it.label}</button>
      ))}
    </div>
  )
}
